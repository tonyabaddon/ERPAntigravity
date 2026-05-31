package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

// StockItem represents the database table structure for stocks
type StockItem struct {
	Sku       string    `json:"sku"`
	Name      string    `json:"name"`
	Category  string    `json:"category"`
	Price     int64     `json:"price"`
	Stock     int       `json:"stock"`
	Status    string    `json:"status"`
	UpdatedAt time.Time `json:"updated_at"`
}

var db *sql.DB

func initDB() {
	// ConnString can be retrieved from environment config inside Supabase dashboard:
	// Example: postgres://postgres.[your-supabase-project]:[password]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
	connStr := os.Getenv("SUPABASE_DB_CONNECTION")
	if connStr == "" {
		log.Println("[WARN] SUPABASE_DB_CONNECTION env not specified. Defaulting to local postgres connection string...")
		connStr = "postgresql://postgres:postgres@localhost:5432/postgres?sslmode=disable"
	}

	var err error
	db, err = sql.Open("postgres", connStr)
	if err != nil {
		log.Fatalf("Error opening connection to database: %v", err)
	}

	// Double-check active database ping
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(time.Minute * 5)

	err = db.Ping()
	if err != nil {
		log.Printf("[WARN] Failed to ping Supabase/Postgre SQL server: %v. Please make sure the credentials are correct.", err)
	} else {
		log.Println("[INFO] Successfully established Postgres tunnel connection to Supabase.")
		createTableIfNotExists()
	}
}

func createTableIfNotExists() {
	query := `
	CREATE TABLE IF NOT EXISTS stocks (
		sku VARCHAR(50) PRIMARY KEY,
		name TEXT NOT NULL,
		category VARCHAR(100) NOT NULL,
		price NUMERIC NOT NULL,
		stock INT NOT NULL,
		status VARCHAR(50) NOT NULL,
		updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
	);`
	_, err := db.Exec(query)
	if err != nil {
		log.Printf("[ERROR] Failed to run automated migration boilerplate: %v", err)
	} else {
		log.Println("[MIGRATION] Table 'stocks' verified/initialized.")
	}
}

// enableCors adds headers allowing connection from arbitrary client origins
func enableCors(w *http.ResponseWriter) {
	(*w).Header().Set("Access-Control-Allow-Origin", "*")
	(*w).Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
	(*w).Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
}

func main() {
	initDB()
	defer db.Close()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()

	// Base API check
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		enableCors(&w)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "online",
			"time":   time.Now().Format(time.RFC3339),
			"engine": "Go net/http + github.com/lib/pq",
		})
	})

	// /api/stocks controller handler
	mux.HandleFunc("/api/stocks", handleStocksRoute)
	mux.HandleFunc("/api/stocks/", handleSingleStockRoute)

	log.Printf("[SERVER] Sinar Elektrik Go Backend starting on port %s...", port)
	if err := http.ListenAndServe("0.0.0.0:"+port, mux); err != nil {
		log.Fatalf("Server aborted: %v", err)
	}
}

// Handle dual routes for collection level
func handleStocksRoute(w http.ResponseWriter, r *http.Request) {
	enableCors(&w)
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	switch r.Method {
	case "GET":
		getStocks(w, r)
	case "POST":
		upsertStock(w, r)
	default:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(map[string]string{"error": "Method not allowed"})
	}
}

// Handle single items path (e.g., PUT or DELETE /api/stocks/{sku})
func handleSingleStockRoute(w http.ResponseWriter, r *http.Request) {
	enableCors(&w)
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		http.Error(w, `{"error": "invalid path parameters"}`, http.StatusBadRequest)
		return
	}
	sku := parts[3]

	switch r.Method {
	case "PUT":
		updateStockPriceAndVolume(w, r, sku)
	case "DELETE":
		deleteStock(w, r, sku)
	default:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(map[string]string{"error": "Method not allowed"})
	}
}

func getStocks(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	rows, err := db.Query("SELECT sku, name, category, price, stock, status, updated_at FROM stocks ORDER BY sku ASC")
	if err != nil {
		log.Printf("Query error: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Database retrieval failed", "details": err.Error()})
		return
	}
	defer rows.Close()

	items := []StockItem{}
	for rows.Next() {
		var item StockItem
		err := rows.Scan(&item.Sku, &item.Name, &item.Category, &item.Price, &item.Stock, &item.Status, &item.UpdatedAt)
		if err != nil {
			log.Printf("Row scan error: %v", err)
			continue
		}
		items = append(items, item)
	}

	json.NewEncoder(w).Encode(items)
}

func upsertStock(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var item StockItem
	err := json.NewDecoder(r.Body).Decode(&item)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request payload format"})
		return
	}

	if item.Sku == "" || item.Name == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Fields SKU and Name are mandatory"})
		return
	}

	// Capitalize SKU code format
	item.Sku = strings.ToUpper(item.Sku)
	item.UpdatedAt = time.Now()

	// PostgreSQL / Supabase UPSERT syntax
	query := `
		INSERT INTO stocks (sku, name, category, price, stock, status, updated_at) 
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (sku) 
		DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, price = EXCLUDED.price, stock = EXCLUDED.stock, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
		RETURNING sku, name, category, price, stock, status, updated_at`

	err = db.QueryRow(query, item.Sku, item.Name, item.Category, item.Price, item.Stock, item.Status, item.UpdatedAt).
		Scan(&item.Sku, &item.Name, &item.Category, &item.Price, &item.Stock, &item.Status, &item.UpdatedAt)

	if err != nil {
		log.Printf("Upsert Error: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to upsert cloud row", "details": err.Error()})
		return
	}

	log.Printf("[SUCCESS] Upserted SKU: %s", item.Sku)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Stock record successfully synchronised with Supabase Cloud DB",
		"data":    item,
	})
}

func updateStockPriceAndVolume(w http.ResponseWriter, r *http.Request, sku string) {
	w.Header().Set("Content-Type", "application/json")
	sku = strings.ToUpper(sku)

	type UpdateBody struct {
		Price int64 `json:"price"`
		Stock int   `json:"stock"`
	}

	var payload UpdateBody
	err := json.NewDecoder(r.Body).Decode(&payload)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid JSON body format"})
		return
	}

	status := "Sinkron"
	if payload.Stock < 10 {
		status = "Stok Tipis"
	}

	query := `UPDATE stocks SET price = $1, stock = $2, status = $3, updated_at = $4 WHERE sku = $5`
	res, err := db.Exec(query, payload.Price, payload.Stock, status, time.Now(), sku)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "SQL update failed", "details": err.Error()})
		return
	}

	affected, _ := res.RowsAffected()
	if affected == 0 {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "SKU not found to update"})
		return
	}

	log.Printf("[SUCCESS] Updated pricing/stock details for SKU: %s", sku)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"sku":     sku,
		"price":   payload.Price,
		"stock":   payload.Stock,
		"status":  status,
	})
}

func deleteStock(w http.ResponseWriter, r *http.Request, sku string) {
	w.Header().Set("Content-Type", "application/json")
	sku = strings.ToUpper(sku)

	query := `DELETE FROM stocks WHERE sku = $1`
	res, err := db.Exec(query, sku)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "SQL Delete execution failed", "details": err.Error()})
		return
	}

	affected, _ := res.RowsAffected()
	if affected == 0 {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Target SKU does not exist"})
		return
	}

	log.Printf("[DELETED] SKU: %s removed from live cloud stocks index", sku)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("SKU %s successfully deleted on Supabase", sku),
	})
}
