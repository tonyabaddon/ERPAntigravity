package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

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
	"github.com/username/sinar-elektrik-backend/internal/llm"
	"github.com/username/sinar-elektrik-backend/internal/models"
	"github.com/username/sinar-elektrik-backend/internal/recon"
	"github.com/username/sinar-elektrik-backend/internal/scheduler"
	"github.com/username/sinar-elektrik-backend/internal/whatsapp"
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

func main() {
	cfg := config.Load()
	ctx := context.Background()

	// waClient is declared here so HTTP handler closures can reference it.
	// It remains nil until whatsapp.NewClient completes below; handlers guard against nil.
	var waClient *whatsapp.Client

	// Start HTTP server FIRST — Cloud Run startup probe checks port 8080.
	// If DB or WA init hangs, the probe still passes and Cloud Run marks the
	// revision healthy. WA-dependent endpoints return safe defaults while nil.
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		enableCors(&w)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "online",
			"time":   time.Now().Format(time.RFC3339),
		})
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
	// Bind port synchronously so Cloud Run startup probe passes even if
	// subsequent init (DB, WA) fails or hangs. net.Listen reserves the port
	// in the OS before we do anything else.
	ln, err := net.Listen("tcp", ":"+cfg.Port)
	if err != nil {
		log.Fatalf("[MAIN] Cannot bind :%s: %v", cfg.Port, err)
	}
	go func() {
		log.Printf("[MAIN] HTTP server on :%s", cfg.Port)
		if err := http.Serve(ln, mux); err != nil {
			log.Printf("[MAIN] HTTP error: %v", err)
		}
	}()

	// DB — retry until connected so waClient can initialize even after a transient failure.
	var dbClient *db.Client
	for attempt := 1; ; attempt++ {
		dbClient, err = db.NewClient(cfg.SupabaseDBConn)
		if err == nil {
			break
		}
		log.Printf("[MAIN] DB connect attempt %d failed: %v — retrying in 10s (check SUPABASE_DB_CONNECTION)", attempt, err)
		time.Sleep(10 * time.Second)
	}
	defer dbClient.Close()

	// Gemini — retry until connected.
	var geminiClient *gemini.Client
	for attempt := 1; ; attempt++ {
		geminiClient, err = gemini.NewClient(ctx, cfg.GeminiAPIKey, assets.CalistaSystemPrompt)
		if err == nil {
			break
		}
		log.Printf("[MAIN] Gemini init attempt %d failed: %v — retrying in 10s (check GEMINI_API_KEY)", attempt, err)
		time.Sleep(10 * time.Second)
	}
	defer geminiClient.Close()

	// Initialize Gemini Document Client (separate from Calista's flash-lite)
	docClient, err := gemini.NewDocumentClient(ctx, cfg.GeminiAPIKey)
	if err != nil {
		log.Fatalf("[MAIN] failed to init Gemini Document Client: %v", err)
	}
	defer docClient.Close()

	// Recon endpoints (monthly bank-statement reconciliation)
	reconHandler := &recon.Handler{DB: dbClient, Doc: docClient}
	closerHandler := &recon.CloserHandler{DB: dbClient}
	mux.HandleFunc("/api/recon/upload", reconHandler.Upload)
	mux.HandleFunc("/api/recon/close", closerHandler.Close)
	log.Println("[MAIN] Recon endpoints registered: /api/recon/upload, /api/recon/close")

	// State machine — wire LLMClient behind ENABLE_OPENROUTER feature flag.
	// When enabled (Phase 1A post shadow-soak), Calista routes through the
	// 10-model OpenRouter chain with cooldown/pin/telemetry. When disabled,
	// fall back to direct Gemini 2.5 Flash Lite via gemini.EngineAdapter.
	var llmClient engine.LLMClient
	if cfg.EnableOpenRouter && cfg.OpenRouterAPIKey != "" {
		calistaStore := db.NewCalistaStore(dbClient.DB)
		cooldownReg, cdErr := llm.NewCooldownRegistry(calistaStore)
		if cdErr != nil {
			log.Fatalf("[MAIN] llm cooldown registry: %v", cdErr)
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
			log.Fatalf("[CALISTA] OpenRouter auth probe FAILED — check OPENROUTER_API_KEY: %v", probeErr)
		}
		if probeErr != nil {
			log.Printf("[CALISTA] OpenRouter probe non-fatal error (proceeding): %v", probeErr)
		} else {
			log.Println("[CALISTA] OpenRouter auth probe OK")
		}

		router := llm.NewRouter(completer, cooldownReg, pinMgr, recorder, llm.DefaultCalistaAgent())
		llmClient = llm.NewEngineAdapter(router)
		log.Println("[CALISTA] OpenRouter chain ENABLED — 10-model fallback active")
	} else {
		llmClient = gemini.NewEngineAdapter(geminiClient)
		log.Println("[CALISTA] OpenRouter DISABLED — using direct Gemini 2.5 Flash Lite")
	}
	machine := engine.NewMachine(llmClient)

	// WhatsApp client — session stored in Supabase PostgreSQL (persists across redeploys)
	waClient, err = whatsapp.NewClient(ctx, cfg.SupabaseDBConn)
	if err != nil {
		log.Fatalf("[MAIN] WA client init failed: %v", err)
	}
	sender := whatsapp.NewSender(waClient.WA)

	// Scheduler
	var waHandler *whatsapp.Handler
	sched := scheduler.NewScheduler(
		func(orderID string) {
			order, err := dbClient.GetOrderByID(orderID)
			if err != nil {
				log.Printf("[MAIN] Reminder: lookup failed for order %s: %v", orderID, err)
				return
			}
			var lang string
			dbClient.DB.QueryRow(`SELECT language FROM conversations WHERE id = $1`, order.ConversationID).Scan(&lang)
			reminderText := "Pesanan Anda akan kadaluarsa dalam 24 jam. Harap segera konfirmasi atau pesanan dibatalkan otomatis."
			if lang == "en" {
				reminderText = "Your order will expire in 24 hours. Please confirm payment or it will be automatically cancelled."
			}
			if err := sender.SendText(ctx, order.CustomerPhone, reminderText); err != nil {
				log.Printf("[MAIN] Reminder: WA send failed: %v", err)
			}
			dbClient.MarkReminderSent(orderID)
			dbClient.UpdateConversationState(order.ConversationID, models.StateTimeoutReminder)
		},
		func(orderID string) {
			log.Printf("[MAIN] Auto-cancelling order %s", orderID)
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
		log.Printf("[MAIN] Debounce enabled soft=%dms hard=%dms", softWaitMs, hardWaitMs)
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
	followup.NewPoller(dbClient, sender).Start(ctx)
	log.Println("[MAIN] Follow-up poller started (1-minute tick)")
	heartbeat.NewPoller(dbClient, sender).Start(ctx)
	log.Println("[MAIN] Heartbeat poller started (1-minute tick)")

	// Approval auto-expiry poller — flips stale pending rows to 'expired' via
	// the public.expire_pending_approvals() RPC once per minute. Matches the
	// heartbeat/follow-up Start(ctx) pattern: goroutine exits when ctx is
	// cancelled (process shutdown).
	approvals.NewPoller(dbClient).Start(ctx)
	log.Println("[MAIN] Approval expiry poller started (1-minute tick)")

	// Approval WhatsApp button webhook — the WA bridge daemon POSTs decoded
	// button replies here. The adapter translates sql.ErrNoRows to the
	// handler's api.ErrNoApproval sentinel so the SQL driver detail does not
	// leak into HTTP status mapping.
	approvalHandler := api.NewApprovalWebhookHandler(approvalStoreAdapter{client: dbClient})
	mux.Handle("/api/approval/wa-webhook", approvalHandler)
	log.Println("[MAIN] Approval WA webhook registered at /api/approval/wa-webhook")

	// Restore booking timers after restart
	bookings, err := dbClient.ListActiveBookings()
	if err != nil {
		log.Printf("[MAIN] RestoreOnBoot: list bookings error: %v", err)
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
			log.Printf("[MAIN] Admin message in conversation %s", conversationID)
			msg, err := dbClient.GetMessageByID(messageID)
			if err != nil {
				log.Printf("[MAIN] GetMessageByID failed for %s: %v", messageID, err)
				return
			}
			var customerPhone string
			dbClient.DB.QueryRow(`SELECT customer_phone FROM conversations WHERE id = $1`, conversationID).Scan(&customerPhone)
			if customerPhone != "" && msg.Text != "" {
				if err := sender.SendText(ctx, customerPhone, msg.Text); err != nil {
					log.Printf("[MAIN] Admin forward WA send failed: %v", err)
				}
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
	}); err != nil {
		log.Fatalf("[MAIN] StartListening failed: %v", err)
	}

	// Connect WhatsApp (non-blocking: QR loop runs in goroutine, stored for /api/wa/qr)
	if err := waClient.Connect(ctx); err != nil {
		log.Printf("[MAIN] WA connect failed: %v — daemon will keep running with HTTP only", err)
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("[MAIN] Shutting down...")
	if debounceHandler != nil {
		log.Println("[MAIN] draining debounce buffers...")
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
		log.Printf("[CONFIG] bad %s=%q, using default %d: %v", key, v, def, err)
		return def
	}
	return n
}

func enableCors(w *http.ResponseWriter) {
	(*w).Header().Set("Access-Control-Allow-Origin", "*")
	(*w).Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
	(*w).Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
}
