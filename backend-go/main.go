package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	_ "github.com/lib/pq"
	"github.com/username/sinar-elektrik-backend/config"
	"github.com/username/sinar-elektrik-backend/internal/assets"
	"github.com/username/sinar-elektrik-backend/internal/db"
	"github.com/username/sinar-elektrik-backend/internal/engine"
	"github.com/username/sinar-elektrik-backend/internal/gemini"
	"github.com/username/sinar-elektrik-backend/internal/models"
	"github.com/username/sinar-elektrik-backend/internal/scheduler"
	"github.com/username/sinar-elektrik-backend/internal/whatsapp"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()

	// DB
	dbClient, err := db.NewClient(cfg.SupabaseDBConn)
	if err != nil {
		log.Fatalf("[MAIN] DB connect failed: %v", err)
	}
	defer dbClient.Close()

	// Gemini
	geminiClient, err := gemini.NewClient(ctx, cfg.GeminiAPIKey, assets.CalistaSystemPrompt)
	if err != nil {
		log.Fatalf("[MAIN] Gemini init failed: %v", err)
	}
	defer geminiClient.Close()

	// State machine
	machine := engine.NewMachine(geminiClient)

	// WhatsApp client (ctx required by new sqlstore.New API)
	waClient, err := whatsapp.NewClient(ctx, cfg.WAStorePath)
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
	waHandler = whatsapp.NewHandler(dbClient, machine, sender, sched, waNumberID, cfg.SupabaseURL, cfg.SupabaseServiceKey)
	waClient.AddEventHandler(waHandler.Handle)

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
	}); err != nil {
		log.Fatalf("[MAIN] StartListening failed: %v", err)
	}

	// HTTP server (start before WA connect so /api/wa/qr is available during pairing)
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
		paired := waClient.WA.Store.ID != nil
		if paired {
			w.Write([]byte(`{"connected":true}`))
		} else {
			w.Write([]byte(`{"connected":false}`))
		}
	})
	mux.HandleFunc("/api/wa/qr", func(w http.ResponseWriter, r *http.Request) {
		enableCors(&w)
		w.Header().Set("Content-Type", "application/json")
		qr := waClient.GetQR()
		paired := waClient.WA.Store.ID != nil
		json.NewEncoder(w).Encode(map[string]interface{}{
			"qr":        qr,
			"connected": paired,
		})
	})
	mux.HandleFunc("/api/stocks", handleStocksRoute(dbClient))
	mux.HandleFunc("/api/stocks/", handleSingleStockRoute(dbClient))

	go func() {
		log.Printf("[MAIN] HTTP server on :%s", cfg.Port)
		if err := http.ListenAndServe(":"+cfg.Port, mux); err != nil {
			log.Printf("[MAIN] HTTP error: %v", err)
		}
	}()

	// Connect WhatsApp (non-blocking: QR loop runs in goroutine, stored for /api/wa/qr)
	if err := waClient.Connect(ctx); err != nil {
		log.Fatalf("[MAIN] WA connect failed: %v", err)
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

func handleStocksRoute(dbClient *db.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		enableCors(&w)
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		switch r.Method {
		case "GET":
			getStocks(w, r, dbClient)
		case "POST":
			upsertStock(w, r, dbClient)
		default:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]string{"error": "Method not allowed"})
		}
	}
}

func handleSingleStockRoute(dbClient *db.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		enableCors(&w)
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		parts := strings.Split(r.URL.Path, "/")
		if len(parts) < 4 {
			http.Error(w, `{"error": "invalid path"}`, http.StatusBadRequest)
			return
		}
		sku := parts[3]
		switch r.Method {
		case "PUT":
			updateStockPriceAndVolume(w, r, sku, dbClient)
		case "DELETE":
			deleteStock(w, r, sku, dbClient)
		default:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]string{"error": "Method not allowed"})
		}
	}
}

type StockItem struct {
	Sku       string    `json:"sku"`
	Name      string    `json:"name"`
	Category  string    `json:"category"`
	Price     int64     `json:"price"`
	Stock     int       `json:"stock"`
	Status    string    `json:"status"`
	UpdatedAt time.Time `json:"updated_at"`
}

func getStocks(w http.ResponseWriter, r *http.Request, dbClient *db.Client) {
	w.Header().Set("Content-Type", "application/json")
	rows, err := dbClient.DB.Query("SELECT sku, name, category, price, stock, status, updated_at FROM stocks ORDER BY sku ASC")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	items := []StockItem{}
	for rows.Next() {
		var item StockItem
		rows.Scan(&item.Sku, &item.Name, &item.Category, &item.Price, &item.Stock, &item.Status, &item.UpdatedAt)
		items = append(items, item)
	}
	json.NewEncoder(w).Encode(items)
}

func upsertStock(w http.ResponseWriter, r *http.Request, dbClient *db.Client) {
	w.Header().Set("Content-Type", "application/json")
	var item StockItem
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request payload"})
		return
	}
	if item.Sku == "" || item.Name == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "SKU and Name are required"})
		return
	}
	item.Sku = strings.ToUpper(item.Sku)
	item.UpdatedAt = time.Now()
	query := `INSERT INTO stocks (sku, name, category, price, stock, status, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (sku) DO UPDATE SET
			name = EXCLUDED.name, category = EXCLUDED.category, price = EXCLUDED.price,
			stock = EXCLUDED.stock, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
		RETURNING sku, name, category, price, stock, status, updated_at`
	err := dbClient.DB.QueryRow(query, item.Sku, item.Name, item.Category, item.Price, item.Stock, item.Status, item.UpdatedAt).
		Scan(&item.Sku, &item.Name, &item.Category, &item.Price, &item.Stock, &item.Status, &item.UpdatedAt)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "data": item})
}

func updateStockPriceAndVolume(w http.ResponseWriter, r *http.Request, sku string, dbClient *db.Client) {
	w.Header().Set("Content-Type", "application/json")
	sku = strings.ToUpper(sku)
	var payload struct {
		Price int64 `json:"price"`
		Stock int   `json:"stock"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid JSON"})
		return
	}
	status := "Sinkron"
	if payload.Stock < 10 {
		status = "Stok Tipis"
	}
	res, err := dbClient.DB.Exec(`UPDATE stocks SET price = $1, stock = $2, status = $3, updated_at = $4 WHERE sku = $5`,
		payload.Price, payload.Stock, status, time.Now(), sku)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "SKU not found"})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "sku": sku, "price": payload.Price, "stock": payload.Stock})
}

func deleteStock(w http.ResponseWriter, r *http.Request, sku string, dbClient *db.Client) {
	w.Header().Set("Content-Type", "application/json")
	sku = strings.ToUpper(sku)
	res, err := dbClient.DB.Exec(`DELETE FROM stocks WHERE sku = $1`, sku)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "SKU not found"})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": fmt.Sprintf("SKU %s deleted", sku)})
}
