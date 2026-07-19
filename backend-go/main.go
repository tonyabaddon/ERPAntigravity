package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"
	sentryhttp "github.com/getsentry/sentry-go/http"
	_ "github.com/lib/pq"
	"github.com/username/sinar-elektrik-backend/config"
	"github.com/username/sinar-elektrik-backend/internal/api"
	"github.com/username/sinar-elektrik-backend/internal/approvals"
	"github.com/username/sinar-elektrik-backend/internal/assets"
	"github.com/username/sinar-elektrik-backend/internal/db"
	"github.com/username/sinar-elektrik-backend/internal/engine"
	"github.com/username/sinar-elektrik-backend/internal/followup"
	"github.com/username/sinar-elektrik-backend/internal/gemini"
	"github.com/username/sinar-elektrik-backend/internal/heartbeat"
	"github.com/username/sinar-elektrik-backend/internal/jobs"
	"github.com/username/sinar-elektrik-backend/internal/llm"
	"github.com/username/sinar-elektrik-backend/internal/logging"
	"github.com/username/sinar-elektrik-backend/internal/models"
	"github.com/username/sinar-elektrik-backend/internal/notification"
	"github.com/username/sinar-elektrik-backend/internal/notification/templates"
	"github.com/username/sinar-elektrik-backend/internal/recon"
	"github.com/username/sinar-elektrik-backend/internal/scheduler"
	"github.com/username/sinar-elektrik-backend/internal/sentryutil"
	"github.com/username/sinar-elektrik-backend/internal/whatsapp"
	"go.mau.fi/whatsmeow"
)

// approvalStoreAdapter bridges *db.Client (which returns sql.ErrNoRows for
// "no row" cases) to the api.ApprovalStore interface (which the T18 handler
// distinguishes via api.ErrNoApproval). Keeping the adapter in main.go
// preserves the unidirectional layering: internal/db has no knowledge of the
// HTTP layer's sentinel, and internal/api has no knowledge of database/sql.
//
// The lookup methods (FindApprovalByWAMessageID, LatestPendingApprovalID) are
// the only ones that need translation — the other three (IsActiveOwnerWANumber,
// FirstOwnerAdminUserID, DecideViaWAButton) pass straight through because the
// handler does not depend on a sentinel value for them.
type approvalStoreAdapter struct{ client *db.Client }

func (a approvalStoreAdapter) IsActiveOwnerWANumber(num string) (bool, error) {
	return a.client.IsActiveOwnerWANumber(num)
}

func (a approvalStoreAdapter) FirstOwnerAdminUserID() (string, error) {
	return a.client.FirstOwnerAdminUserID()
}

func (a approvalStoreAdapter) FindApprovalByWAMessageID(wamid string) (int64, error) {
	id, err := a.client.FindApprovalByWAMessageID(wamid)
	if err == sql.ErrNoRows {
		return 0, api.ErrNoApproval
	}
	return id, err
}

func (a approvalStoreAdapter) LatestPendingApprovalID() (int64, error) {
	id, err := a.client.LatestPendingApprovalID()
	if err == sql.ErrNoRows {
		return 0, api.ErrNoApproval
	}
	return id, err
}

func (a approvalStoreAdapter) DecideViaWAButton(approvalID int64, decision, ownerUserID string) error {
	return a.client.DecideViaWAButton(approvalID, decision, ownerUserID)
}

// messageInserterAdapter bridges *db.Client.InsertMessage (no ctx, returns
// *models.Message) to notification.messageInserter (ctx-aware, returns error).
// Discards the returned message — callers of NotifyCustomer don't need it.
// Adaptor lives in main.go to keep db and notification packages decoupled.
type messageInserterAdapter struct{ client *db.Client }

func (a messageInserterAdapter) InsertMessage(_ context.Context, convID, sender, text string) error {
	_, err := a.client.InsertMessage(convID, models.MessageSender(sender), text)
	return err
}

// recipientResolverAdapter bridges *db.Client.GetActiveRecipients() (no args,
// returns []*models.WaRecipient) to notification.recipientResolver (ctx +
// tenantID + filter, returns []notification.Recipient).
//
// Current db.GetActiveRecipients has no tenant filter — single-tenant Calista
// backend only has one set of recipients. Sprint 2+ will add per-tenant
// filtering once the backend migrates to full multi-tenancy. The tenantID
// arg is accepted but not forwarded to the DB query yet.
type recipientResolverAdapter struct{ client *db.Client }

func (a recipientResolverAdapter) GetActiveRecipients(_ context.Context, _ string, filter notification.RecipientFilter) ([]notification.Recipient, error) {
	raw, err := a.client.GetActiveRecipients()
	if err != nil {
		return nil, err
	}
	var out []notification.Recipient
	for _, r := range raw {
		if filter.Role != "" && r.Role != filter.Role {
			continue
		}
		out = append(out, notification.Recipient{Phone: r.WANumber, Role: r.Role})
	}
	return out, nil
}

func main() {
	// Init Sentry BEFORE logging so panics during startup are captured.
	// No-op (dormant) when SENTRY_DSN env var is absent.
	sentryutil.Init()
	// Always flush buffered Sentry events on shutdown, even if Init returned
	// false — sentry.Flush is safe to call on an uninitialised SDK.
	defer sentry.Flush(2 * time.Second)

	// Init structured logging first — all subsequent log calls use slog.
	// CloudHandler emits JSON to stdout compatible with Cloud Logging's
	// jsonPayload ingestion (severity/message/timestamp field names).
	logging.Init()

	cfg := config.Load()
	ctx := context.Background()

	// Build tenant identity for Calista prompt interpolation (MVP).
	// Falls back to Garindo Jaya Panel defaults when env vars are unset,
	// preserving zero-config behaviour for the current single tenant.
	calistaIdentity := llm.DefaultTenantIdentity()
	if cfg.TenantName != "" {
		calistaIdentity.Name = cfg.TenantName
	}
	if cfg.TenantPickupAddress != "" {
		calistaIdentity.PickupAddress = cfg.TenantPickupAddress
	}
	slog.Info("[CALISTA] tenant identity loaded",
		slog.String("tenant_name", calistaIdentity.Name))

	// waClient and dbClient are declared here so HTTP handler closures can
	// reference them. Both remain nil until their respective init loops
	// complete below; handlers guard against nil.
	var waClient *whatsapp.Client
	var dbClient *db.Client

	// Start HTTP server FIRST — Cloud Run startup probe checks port 8080.
	// If DB or WA init hangs, the probe still passes and Cloud Run marks the
	// revision healthy. WA-dependent endpoints return safe defaults while nil.
	mux := http.NewServeMux()
	// Task 16 gap-fix: CSP violation reports from FE Cloud Run land here.
	// Frontend serve.json sets `report-uri` to this endpoint. Reports are
	// logged to slog + Cloud Logging for observation before CSP is enforced.
	// Registered as /api/security/csp-report so VersionRouter (which strips
	// /api/v1/ → /api/) delivers a client request to /api/v1/security/csp-report
	// here. Non-/api/* paths are 404'd by VersionRouter.
	mux.HandleFunc("/api/security/csp-report", api.CSPReportHandler)
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		enableCors(&w)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "online",
			"time":   time.Now().Format(time.RFC3339),
		})
	})
	// /api/v1/live — liveness probe (process alive, no deps).
	// Cloud Run uses this to detect a stuck process and restart it.
	// Returns 200 unconditionally while the process is running.
	// Accessible as /api/v1/live (VersionRouter rewrites → /api/live).
	mux.HandleFunc("/api/live", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})
	// /api/v1/ready — readiness probe (dependency check).
	// Cloud Run uses this to stop sending traffic when deps are unavailable.
	// Checks Postgres reachability with a short timeout.
	// dbClient is nil during startup (before DB connect loop below); during
	// that window the probe returns 503, which is correct — don't route traffic
	// until the DB is confirmed reachable.
	// Accessible as /api/v1/ready (VersionRouter rewrites → /api/ready).
	mux.HandleFunc("/api/ready", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		if dbClient == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte("db not yet connected"))
			return
		}
		pingCtx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := dbClient.DB.PingContext(pingCtx); err != nil {
			slog.WarnContext(r.Context(), "[READY] DB ping failed", slog.Any("error", err))
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte("db unreachable"))
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ready"))
	})
	mux.HandleFunc("/api/wa/status", func(w http.ResponseWriter, r *http.Request) {
		enableCors(&w)
		w.Header().Set("Content-Type", "application/json")
		if waClient == nil {
			w.Write([]byte(`{"connected":false}`))
			return
		}
		paired := waClient.WA.IsConnected() && waClient.WA.Store.ID != nil
		if paired {
			w.Write([]byte(`{"connected":true}`))
		} else {
			w.Write([]byte(`{"connected":false}`))
		}
	})
	mux.HandleFunc("/api/wa/qr", func(w http.ResponseWriter, r *http.Request) {
		enableCors(&w)
		w.Header().Set("Content-Type", "application/json")
		if waClient == nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"qr":        "",
				"connected": false,
				"phone":     "",
			})
			return
		}
		qr := waClient.GetQR()
		// connected = WebSocket open AND pairing complete (Store.ID set after scan).
		// IsConnected() alone is true during QR phase before pairing, which would
		// hide the QR code in the frontend.
		connected := waClient.WA.IsConnected() && waClient.WA.Store.ID != nil
		phone := ""
		if connected {
			phone = waClient.WA.Store.ID.User
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"qr":        qr,
			"connected": connected,
			"phone":     phone,
		})
	})
	mux.HandleFunc("/api/wa/logout", func(w http.ResponseWriter, r *http.Request) {
		enableCors(&w)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if waClient == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"error": "not initialized"})
			return
		}
		if err := waClient.Logout(ctx); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "logged_out"})
	})
	mux.HandleFunc("/api/wa/pair-code", func(w http.ResponseWriter, r *http.Request) {
		enableCors(&w)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]string{"error": "POST only"})
			return
		}
		if waClient == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"error": "WhatsApp client not initialized"})
			return
		}
		var body struct {
			Phone string `json:"phone"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid JSON"})
			return
		}
		// Phone must be E.164 digits only (no +, no spaces). Strip common chars.
		phone := body.Phone
		cleaned := ""
		for _, c := range phone {
			if c >= '0' && c <= '9' {
				cleaned += string(c)
			}
		}
		if len(cleaned) < 10 || len(cleaned) > 15 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "phone must be 10-15 digits (E.164 without +)"})
			return
		}
		// WhatsApp pair-code requires an active WebSocket connection in QR mode.
		if waClient.WA.Store.ID != nil {
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": "device already paired; logout first"})
			return
		}
		// Display name MUST match `Browser (OS)` pattern with common browsers/OS,
		// else WA server returns 400 (see whatsmeow pair-code.go:88-89).
		code, err := waClient.WA.PairPhone(r.Context(), cleaned, true, whatsmeow.PairClientChrome, "Chrome (Linux)")
		if err != nil {
			slog.ErrorContext(r.Context(), "[WA] PairPhone error", slog.String("phone", cleaned), slog.Any("error", err))
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		slog.InfoContext(r.Context(), "[WA] Pair code generated", slog.String("phone", cleaned))
		json.NewEncoder(w).Encode(map[string]string{"code": code, "phone": cleaned})
	})
	mux.HandleFunc("/api/wa/debug", func(w http.ResponseWriter, r *http.Request) {
		enableCors(&w)
		w.Header().Set("Content-Type", "application/json")
		if waClient == nil {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"store_id":      "",
				"store_deleted": false,
				"is_connected":  false,
				"has_qr":        false,
			})
			return
		}
		storeID := ""
		if waClient.WA.Store.ID != nil {
			storeID = waClient.WA.Store.ID.String()
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"store_id":      storeID,
			"store_deleted": waClient.WA.Store.Deleted,
			"is_connected":  waClient.WA.IsConnected(),
			"has_qr":        waClient.GetQR() != "",
		})
	})
	// P2-B: Rate limit middleware — constructed before the server starts.
	// Uses a lazy getter for *sql.DB because the DB retry loop runs AFTER the
	// HTTP server goroutine is spawned. During the startup window (dbClient==nil)
	// the getter returns nil and loadRateConfig falls back to the safe default
	// (100 req/s). Health probes bypass rate limiting entirely regardless.
	rateLimiter := api.NewRateLimitMiddleware(func() *sql.DB {
		if dbClient == nil {
			return nil
		}
		return dbClient.DB
	})

	// Bind port synchronously so Cloud Run startup probe passes even if
	// subsequent init (DB, WA) fails or hangs. net.Listen reserves the port
	// in the OS before we do anything else.
	ln, err := net.Listen("tcp", ":"+cfg.Port)
	if err != nil {
		slog.Error("[MAIN] Cannot bind port", slog.String("port", cfg.Port), slog.Any("error", err))
		os.Exit(1)
	}
	go func() {
		slog.Info("[MAIN] HTTP server starting", slog.String("port", cfg.Port))
		// Middleware layer order (outermost → innermost):
		//   1. sentryhttp.Handle       — panic capture + Sentry request context (Task 11)
		//   2. SecurityHeadersMiddleware — HSTS, X-Content-Type-Options, X-Frame, Referrer, Permissions
		//   3. RequestContextMiddleware — extracts tenant_id/user_id/request_id from JWT
		//   4. rateLimiter.Wrap        — enforces per-tenant token-bucket rate limits
		//   5. VersionRouter           — rewrites /api/v1/* → /api/*
		//   6. mux                    — actual handlers
		// sentryhttp wraps outermost so panics anywhere in the chain are captured.
		// Repanic:true re-panics after capture so Cloud Run logs the crash too.
		// No-op when Sentry SDK is uninitialised (DSN absent).
		sh := sentryhttp.New(sentryhttp.Options{Repanic: true})
		handler := sh.Handle(api.SecurityHeadersMiddleware(api.RequestContextMiddleware(rateLimiter.Wrap(api.VersionRouter(mux)))))
		if err := http.Serve(ln, handler); err != nil {
			sentry.CaptureException(err)
			slog.Error("[MAIN] HTTP error", slog.Any("error", err))
		}
	}()

	// DB — split-pool init: query pool → txn pooler; listener pool → direct.
	// SUPABASE_DB_LISTENER_CONNECTION defaults to queryConn for local dev
	// (session pooler or local Postgres both support LISTEN).
	listenConn := cfg.SupabaseDBListenerConn
	if listenConn == "" {
		listenConn = cfg.SupabaseDBConn
	}
	for attempt := 1; ; attempt++ {
		dbClient, err = db.NewClient(cfg.SupabaseDBConn, listenConn)
		if err == nil {
			break
		}
		slog.Error("[MAIN] DB connect attempt failed — retrying in 10s", slog.Int("attempt", attempt), slog.String("error", err.Error()))
		time.Sleep(10 * time.Second)
	}
	defer dbClient.Close()

	// Gemini — retry until connected.
	var geminiClient *gemini.Client
	for attempt := 1; ; attempt++ {
		geminiClient, err = gemini.NewClient(ctx, cfg.GeminiAPIKey, llm.InterpolatePrompt(assets.CalistaSystemPrompt, calistaIdentity))
		if err == nil {
			break
		}
		slog.Error("[MAIN] Gemini init attempt failed — retrying in 10s", slog.Int("attempt", attempt), slog.Any("error", err))
		time.Sleep(10 * time.Second)
	}
	defer geminiClient.Close()

	// Initialize Gemini Document Client (separate from Calista's flash-lite)
	docClient, err := gemini.NewDocumentClient(ctx, cfg.GeminiAPIKey)
	if err != nil {
		slog.Error("[MAIN] failed to init Gemini Document Client", slog.Any("error", err))
		os.Exit(1)
	}
	defer docClient.Close()

	// Recon endpoints (monthly bank-statement reconciliation)
	reconHandler := &recon.Handler{DB: dbClient, Doc: docClient}
	closerHandler := &recon.CloserHandler{DB: dbClient}
	mux.HandleFunc("/api/recon/upload", reconHandler.Upload)
	mux.HandleFunc("/api/recon/close", closerHandler.Close)

	// Plan C: Cari by Foto — CLIP image-similarity search.
	searchH := NewSearchHandler(dbClient.DB)
	mux.HandleFunc("/api/products/search-by-photo", searchH.SearchByPhoto)
	mux.HandleFunc("/api/products/index-photos", searchH.IndexPhotos)
	slog.Info("[MAIN] Recon endpoints registered: /api/recon/upload, /api/recon/close")

	// State machine — wire LLMClient based on LLM_BACKEND + ENABLE_OPENROUTER.
	// Three modes:
	//   1. LLM_BACKEND=gemini → Phase 1A architecture (router/pin/cooldown/
	//      telemetry) backed by direct Google AI Studio API. Uses your own
	//      account's free quota (500-1500 RPD per model) instead of
	//      OpenRouter's shared pool.
	//   2. ENABLE_OPENROUTER=true → Phase 1A architecture backed by
	//      OpenRouter free-tier 10-model chain.
	//   3. Neither → legacy direct Gemini SDK (gemini.EngineAdapter).
	var llmClient engine.LLMClient
	if cfg.LLMBackend == "gemini" && cfg.GeminiAPIKey != "" {
		calistaStore := db.NewCalistaStore(dbClient.DB)
		cooldownReg, cdErr := llm.NewCooldownRegistry(calistaStore)
		if cdErr != nil {
			slog.Error("[MAIN] llm cooldown registry", slog.Any("error", cdErr))
			os.Exit(1)
		}
		pinMgr := llm.NewPinManager(calistaStore)
		recorder := llm.NewRecorder(calistaStore)
		completer := llm.NewGeminiClient(cfg.GeminiAPIKey)

		probeCtx, probeCancel := context.WithTimeout(ctx, 10*time.Second)
		_, probeErr := completer.Complete(probeCtx, llm.CompletionRequest{
			Model:     "gemini-2.5-flash-lite",
			Messages:  []llm.Message{{Role: "user", Content: "ping"}},
			MaxTokens: 10,
		})
		probeCancel()
		if probeErr != nil && llm.IsAuth(probeErr) {
			slog.Error("[CALISTA] Gemini auth probe FAILED — check GEMINI_API_KEY", slog.Any("error", probeErr))
			os.Exit(1)
		}
		if probeErr != nil {
			slog.Warn("[CALISTA] Gemini probe non-fatal error (proceeding)", slog.Any("error", probeErr))
		} else {
			slog.Info("[CALISTA] Gemini auth probe OK")
		}

		router := llm.NewRouter(completer, cooldownReg, pinMgr, recorder, llm.DefaultCalistaAgentGeminiWithIdentity(calistaIdentity))
		llmClient = llm.NewEngineAdapter(router)
		slog.Info("[CALISTA] Direct Gemini backend ENABLED — chain: [gemini-2.5-flash-lite]")
	} else if cfg.EnableOpenRouter && cfg.OpenRouterAPIKey != "" {
		calistaStore := db.NewCalistaStore(dbClient.DB)
		cooldownReg, cdErr := llm.NewCooldownRegistry(calistaStore)
		if cdErr != nil {
			slog.Error("[MAIN] llm cooldown registry", slog.Any("error", cdErr))
			os.Exit(1)
		}
		pinMgr := llm.NewPinManager(calistaStore)
		recorder := llm.NewRecorder(calistaStore)
		completer := llm.NewOpenRouterClient(cfg.OpenRouterAPIKey)

		// Boot probe: send a 1-token test request to verify the API key is
		// accepted. Without this, a bad key surfaces as silent universal
		// chain-exhaustion on the first customer message (10 models all 401)
		// — confusing to debug. Probe fails fast at startup instead.
		probeCtx, probeCancel := context.WithTimeout(ctx, 10*time.Second)
		_, probeErr := completer.Complete(probeCtx, llm.CompletionRequest{
			Model:     "google/gemma-4-31b",
			Messages:  []llm.Message{{Role: "user", Content: "ping"}},
			MaxTokens: 1,
		})
		probeCancel()
		if probeErr != nil && llm.IsAuth(probeErr) {
			slog.Error("[CALISTA] OpenRouter auth probe FAILED — check OPENROUTER_API_KEY", slog.Any("error", probeErr))
			os.Exit(1)
		}
		if probeErr != nil {
			slog.Warn("[CALISTA] OpenRouter probe non-fatal error (proceeding)", slog.Any("error", probeErr))
		} else {
			slog.Info("[CALISTA] OpenRouter auth probe OK")
		}

		router := llm.NewRouter(completer, cooldownReg, pinMgr, recorder, llm.DefaultCalistaAgentWithIdentity(calistaIdentity))
		llmClient = llm.NewEngineAdapter(router)
		slog.Info("[CALISTA] OpenRouter chain ENABLED — 10-model fallback active")
	} else {
		llmClient = gemini.NewEngineAdapter(geminiClient)
		slog.Info("[CALISTA] OpenRouter DISABLED — using direct Gemini 2.5 Flash Lite")
	}
	machine := engine.NewMachine(llmClient)

	// WhatsApp client — session stored in Supabase PostgreSQL (persists across redeploys).
	// Routes to direct connection (listenConn) so WA session writes are session-stable.
	// Whatsmeow sqlstore does not use db.Prepare(), but session data (identity keys,
	// prekeys) must be durable — direct pool avoids any pooler-side risk.
	waClient, err = whatsapp.NewClient(ctx, listenConn)
	if err != nil {
		slog.Error("[MAIN] WA client init failed", slog.Any("error", err))
		os.Exit(1)
	}
	sender := whatsapp.NewSender(waClient.WA)

	// Shared WA notifier — used by booking-expiry reminder (Sprint 1 B2 fix),
	// follow-up poller, and any future path that must write an audit trail
	// atomically with the WA send. Created here (before Scheduler) so the
	// booking-expiry closure can capture it.
	notifier := notification.NewNotifier(
		sender,
		messageInserterAdapter{dbClient},
		notification.NewQuota(dbClient.DB),
		notification.NewCachedResolver(recipientResolverAdapter{dbClient}),
		slog.Default(),
	)

	// Scheduler
	var waHandler *whatsapp.Handler
	sched := scheduler.NewScheduler(
		func(orderID string) {
			// Booking expiry reminder — 24h before booking expires (Sprint 1 B2 fix).
			// Previously used inline SendText with no InsertMessage → no audit trail.
			// Now routes through NotifyCustomer: quota enforced + message persisted atomically.
			ctx := context.Background()
			order, err := dbClient.GetOrderByID(orderID)
			if err != nil {
				slog.Error("[MAIN] Reminder: lookup failed", slog.String("order_id", orderID), slog.Any("error", err))
				return
			}
			tmpl := templates.BookingExpiry{}
			// invoice_no: prefer GJPOrderID if set (human-readable ref), fall back to order UUID.
			invoiceNo := order.GJPOrderID
			if invoiceNo == "" {
				invoiceNo = order.ID
			}
			msg, err := tmpl.Build(ctx, map[string]any{
				"customer_nama": order.CustomerName,
				"toko_nama":     cfg.TenantName,
				"invoice_no":    invoiceNo,
			})
			if err != nil {
				slog.ErrorContext(ctx, "[MAIN] Reminder: template render failed", slog.String("order_id", orderID), slog.Any("error", err))
				return
			}
			if err := notifier.NotifyCustomer(ctx, order.TenantID, order.ConversationID, order.CustomerPhone, "id", msg); err != nil {
				slog.ErrorContext(ctx, "[MAIN] Reminder: NotifyCustomer failed", slog.String("order_id", orderID), slog.Any("error", err))
			}
			dbClient.MarkReminderSent(orderID)
			dbClient.UpdateConversationState(order.ConversationID, models.StateTimeoutReminder)
		},
		func(orderID string) {
			slog.Info("[MAIN] Auto-cancelling order", slog.String("order_id", orderID))
			dbClient.UpdateOrderStatus(orderID, "CANCELLED")
		},
	)

	waNumberID := os.Getenv("WA_NUMBER_ID")
	if waNumberID == "" {
		waNumberID = "wa_1"
	}

	// Debounce wiring — opt-in via env. When DEBOUNCE_ENABLED=false (default),
	// debounceHandler stays nil and handler.go takes the legacy direct path.
	debounceEnabled := getEnvBoolDefault("DEBOUNCE_ENABLED", false)
	softWaitMs := getEnvIntDefault("DEBOUNCE_SOFT_WAIT_MS", 5000)
	hardWaitMs := getEnvIntDefault("DEBOUNCE_HARD_WAIT_MS", 12000)

	var debounceHandler *whatsapp.DebounceHandler
	if debounceEnabled {
		// Forward-reference closure: waHandler is declared above (line 178) but
		// assigned below, after debounceHandler is built. The closure captures
		// the variable, so it sees the assigned value at call time.
		flushFn := func(ctx context.Context, phone, joined string, originalTexts []string) error {
			if waHandler == nil {
				return nil
			}
			waHandler.ProcessJoinedMessage(ctx, phone, joined, originalTexts)
			return nil
		}
		debounceHandler = whatsapp.NewDebounceHandler(whatsapp.DebounceConfig{
			Clock:    whatsapp.NewRealClock(),
			FlushFn:  flushFn,
			SoftWait: time.Duration(softWaitMs) * time.Millisecond,
			HardWait: time.Duration(hardWaitMs) * time.Millisecond,
			Typing:   &whatsapp.WATypingNotifier{Client: waClient.WA},
		})
		slog.Info("[MAIN] Debounce enabled", slog.Int("soft_ms", softWaitMs), slog.Int("hard_ms", hardWaitMs))
	}

	// Pass UNTYPED nil when the debounce handler wasn't constructed. Without
	// this conversion the typed nil (*DebounceHandler)(nil) gets boxed into
	// a non-nil interface — handler.go's `if h.debounce != nil` returns true
	// and dispatch panics on the nil receiver inside DebounceHandler.Push.
	// Classic Go interface-vs-typed-nil pitfall; explicit nil at the call
	// site is the cleanest fix.
	if debounceHandler != nil {
		waHandler = whatsapp.NewHandler(dbClient, machine, sender, sched, waNumberID, cfg.SupabaseURL, cfg.SupabaseServiceKey, debounceHandler)
	} else {
		waHandler = whatsapp.NewHandler(dbClient, machine, sender, sched, waNumberID, cfg.SupabaseURL, cfg.SupabaseServiceKey, nil)
	}
	waClient.AddEventHandler(waHandler.Handle)
	// P2-E: Async job worker — polls t_jobs every 5s, dispatches to handlers.
	// Runs co-located with the HTTP server. Uses the same service_role DB
	// connection (bypasses RLS for cross-tenant polling via claim_next_job).
	// FOR UPDATE SKIP LOCKED in claim_next_job makes this safe if Cloud Run
	// scales to multiple instances.
	// Task 11 debug 2026-07-18: worker uses ListenDB (direct connection),
	// NOT dbClient.DB (which routes to transaction pooler).
	// lib/pq's parameterised queries use extended protocol + prepared
	// statements. Supavisor transaction mode drops prepared statements
	// between transactions → "pq: unnamed prepared statement does not exist"
	// error every 5s poll. Direct connection preserves prepared statement
	// lifetime for the connection's duration → worker functions correctly.
	jobWorker := jobs.NewWorker(dbClient.ListenDB)
	jobWorker.Register("echo_test", jobs.EchoHandler)
	// P2-D will add: jobWorker.Register("export_data", exportHandler)
	workerCtx, workerCancel := context.WithCancel(ctx)
	go jobWorker.Start(workerCtx)
	slog.Info("[MAIN] Async job worker started (5s poll interval)")

	followup.NewPoller(dbClient, notifier).Start(ctx)
	slog.Info("[MAIN] Follow-up poller started (1-minute tick)")
	heartbeat.NewPoller(dbClient, sender).Start(ctx)
	slog.Info("[MAIN] Heartbeat poller started (1-minute tick)")

	// Approval auto-expiry poller — flips stale pending rows to 'expired' via
	// the public.expire_pending_approvals() RPC once per minute. Matches the
	// heartbeat/follow-up Start(ctx) pattern: goroutine exits when ctx is
	// cancelled (process shutdown).
	approvals.NewPoller(dbClient).Start(ctx)
	slog.Info("[MAIN] Approval expiry poller started (1-minute tick)")

	// Approval WhatsApp button webhook — the WA bridge daemon POSTs decoded
	// button replies here. The adapter translates sql.ErrNoRows to the
	// handler's api.ErrNoApproval sentinel so the SQL driver detail does not
	// leak into HTTP status mapping.
	approvalHandler := api.NewApprovalWebhookHandler(approvalStoreAdapter{client: dbClient})
	mux.Handle("/api/approval/wa-webhook", approvalHandler)
	slog.Info("[MAIN] Approval WA webhook registered at /api/approval/wa-webhook")

	// Restore booking timers after restart
	bookings, err := dbClient.ListActiveBookings()
	if err != nil {
		slog.Error("[MAIN] RestoreOnBoot: list bookings error", slog.Any("error", err))
	} else {
		entries := make([]scheduler.BookingEntry, len(bookings))
		for i, b := range bookings {
			entries[i] = scheduler.BookingEntry{ID: b.ID, ExpiresAt: b.ExpiresAt}
		}
		sched.RestoreOnBoot(entries)
	}

	// LISTEN/NOTIFY handlers
	if err := dbClient.StartListening(db.NotifyHandlers{
		OnAdminMessage: func(conversationID, messageID string) {
			slog.Info("[MAIN] Admin message in conversation", slog.String("conversation_id", conversationID))
			msg, err := dbClient.GetMessageByID(messageID)
			if err != nil {
				slog.Error("[MAIN] GetMessageByID failed", slog.String("message_id", messageID), slog.Any("error", err))
				return
			}
			var customerPhone, waNumberID string
			// Task 11 gap-fix 2026-07-18: use ListenDB (direct connection).
			// See note at main.go:484 above.
			// waNumberID is used as tenantID surrogate — same approach as followup
			// poller. Sprint 2+ will add a proper tenant_id column to conversations.
			dbClient.ListenDB.QueryRow(`SELECT customer_phone, wa_number_id FROM conversations WHERE id = $1`, conversationID).Scan(&customerPhone, &waNumberID)
			if customerPhone == "" || msg.Text == "" {
				return
			}
			// B3 fix (Task 1.7): previously called sender.SendText directly,
			// skipping InsertMessage — messages typed in Sales Inbox were never
			// written to the audit trail. Route through NotifyCustomer for atomic
			// audit row write + quota enforcement.
			tmpl := templates.AdminForward{}
			rendered, err := tmpl.Build(ctx, map[string]any{"text": msg.Text})
			if err != nil {
				slog.ErrorContext(ctx, "[MAIN] admin_forward render failed", slog.Any("error", err))
				return
			}
			if err := notifier.NotifyCustomer(ctx, waNumberID, conversationID, customerPhone, "id", rendered); err != nil {
				slog.ErrorContext(ctx, "[MAIN] admin_forward send failed", slog.Any("error", err))
			}
		},
		OnOrderApproved: func(orderID, conversationID string, shippingFee float64) {
			waHandler.HandleApprovedOrder(ctx, orderID, conversationID, shippingFee)
		},
		OnPaymentVerified: func(orderID, conversationID string) {
			waHandler.HandlePaymentVerified(ctx, orderID, conversationID)
		},
		OnPaymentRejected: func(orderID, conversationID string) {
			waHandler.HandlePaymentRejected(ctx, orderID, conversationID)
		},
		OnDPVerified: func(orderID, conversationID string) {
			waHandler.HandleDPVerified(ctx, orderID, conversationID)
		},
		OnDPProofRejected: func(orderID, conversationID, reason string) {
			waHandler.HandleDPProofRejected(ctx, orderID, conversationID, reason)
		},
		OnApprovalCreated: func(evt db.ApprovalCreatedEvent) {
			// B1 fix (Task 1.8): approval WA card was built in internal/whatsapp but
			// the call site never existed — approvals were silently dropped.
			// Render the card template and broadcast to all owner-role recipients.
			tmpl := templates.ApprovalCard{}
			msg, err := tmpl.Build(ctx, map[string]any{
				"approval_id": evt.ApprovalID,
				"type":        evt.Type,
				"details":     evt.Details,
			})
			if err != nil {
				slog.ErrorContext(ctx, "[MAIN] approval_card render failed",
					slog.String("approval_id", evt.ApprovalID),
					slog.Any("error", err))
				return
			}
			filter := notification.RecipientFilter{Role: "owner", CritLevel: "critical"}
			if err := notifier.BroadcastToStaff(ctx, evt.TenantID, filter, msg); err != nil {
				slog.ErrorContext(ctx, "[MAIN] approval broadcast failed",
					slog.String("approval_id", evt.ApprovalID),
					slog.String("tenant_id", evt.TenantID),
					slog.Any("error", err))
				return
			}
			// Dedup: mark sent so a restart doesn't re-broadcast pending approvals.
			// Use DB (txn pooler) — the UPDATE is a short-lived write, no LISTEN needed.
			if _, dbErr := dbClient.DB.ExecContext(ctx,
				"UPDATE public.approval_requests SET sent_wa_card_at = NOW() WHERE id = $1 AND sent_wa_card_at IS NULL",
				evt.ApprovalID,
			); dbErr != nil {
				slog.ErrorContext(ctx, "[MAIN] approval sent_wa_card_at update failed",
					slog.String("approval_id", evt.ApprovalID),
					slog.Any("error", dbErr))
			}
		},
	}); err != nil {
		slog.Error("[MAIN] StartListening failed", slog.Any("error", err))
		os.Exit(1)
	}

	// Connect WhatsApp (non-blocking: QR loop runs in goroutine, stored for /api/wa/qr)
	if err := waClient.Connect(ctx); err != nil {
		slog.Warn("[MAIN] WA connect failed — daemon will keep running with HTTP only", slog.Any("error", err))
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("[MAIN] Shutting down...")
	workerCancel()
	jobWorker.Stop()
	if debounceHandler != nil {
		slog.Info("[MAIN] draining debounce buffers...")
		drainCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		debounceHandler.Shutdown(drainCtx)
		cancel()
	}
	waClient.Disconnect()
}

func getEnvBoolDefault(key string, def bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	return v == "true" || v == "1"
}

func getEnvIntDefault(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		slog.Warn("[CONFIG] bad env value, using default", slog.String("key", key), slog.String("value", v), slog.Int("default", def), slog.Any("error", err))
		return def
	}
	return n
}

func enableCors(w *http.ResponseWriter) {
	(*w).Header().Set("Access-Control-Allow-Origin", "*")
	(*w).Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
	(*w).Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
}
