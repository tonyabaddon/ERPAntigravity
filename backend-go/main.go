package main

import (
	"context"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/lib/pq"
	"github.com/username/sinar-elektrik-backend/config"
	"github.com/username/sinar-elektrik-backend/internal/assets"
	"github.com/username/sinar-elektrik-backend/internal/db"
	"github.com/username/sinar-elektrik-backend/internal/engine"
	"github.com/username/sinar-elektrik-backend/internal/gemini"
	"github.com/username/sinar-elektrik-backend/internal/heartbeat"
	"github.com/username/sinar-elektrik-backend/internal/models"
	"github.com/username/sinar-elektrik-backend/internal/followup"
	"github.com/username/sinar-elektrik-backend/internal/scheduler"
	"github.com/username/sinar-elektrik-backend/internal/whatsapp"
)

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

	// State machine
	machine := engine.NewMachine(geminiClient)

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
	// Task 15 will replace nil with a real DebounceHandler; nil keeps the legacy direct path.
	waHandler = whatsapp.NewHandler(dbClient, machine, sender, sched, waNumberID, cfg.SupabaseURL, cfg.SupabaseServiceKey, nil)
	waClient.AddEventHandler(waHandler.Handle)
	followup.NewPoller(dbClient, sender).Start(ctx)
	log.Println("[MAIN] Follow-up poller started (1-minute tick)")
	heartbeat.NewPoller(dbClient, sender).Start(ctx)
	log.Println("[MAIN] Heartbeat poller started (1-minute tick)")

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
	waClient.Disconnect()
}

func enableCors(w *http.ResponseWriter) {
	(*w).Header().Set("Access-Control-Allow-Origin", "*")
	(*w).Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
	(*w).Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
}
