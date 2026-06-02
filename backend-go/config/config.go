package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	SupabaseDBConn     string
	GeminiAPIKey       string
	Port               string
	WAStorePath        string
	SupabaseURL        string
	SupabaseServiceKey string
}

func Load() *Config {
	if err := godotenv.Load(); err != nil {
		log.Println("[CONFIG] No .env file, reading from environment")
	}
	return &Config{
		SupabaseDBConn:     getEnv("SUPABASE_DB_CONNECTION", "postgresql://postgres:postgres@localhost:5432/postgres?sslmode=disable"),
		GeminiAPIKey:       getEnv("GEMINI_API_KEY", ""),
		Port:               getEnv("PORT", "8080"),
		WAStorePath:        getEnv("WA_STORE_PATH", "wa_store.db"),
		SupabaseURL:        getEnv("SUPABASE_URL", ""),
		SupabaseServiceKey: getEnv("SUPABASE_SERVICE_KEY", ""),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
