package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	SupabaseDBConn         string // SUPABASE_DB_CONNECTION — transaction pooler URL
	SupabaseDBListenerConn string // SUPABASE_DB_LISTENER_CONNECTION — direct URL for pq.Listener
	GeminiAPIKey           string
	Port                   string
	SupabaseURL            string
	SupabaseServiceKey     string

	// Phase 1A — Calista OpenRouter wiring
	OpenRouterAPIKey string // OPENROUTER_API_KEY
	EnableOpenRouter bool   // ENABLE_OPENROUTER (default false in Phase 1A ship; flip to true after shadow soak)

	// LLMBackend selects which Completer the router uses when Phase 1A
	// architecture is active. Values: "openrouter" (default) or "gemini"
	// (direct Google AI Studio via OpenAI-compatible endpoint — uses your
	// own free-tier quota rather than OpenRouter's shared pool).
	LLMBackend string // LLM_BACKEND
}

func Load() *Config {
	if err := godotenv.Load(); err != nil {
		log.Println("[CONFIG] No .env file, reading from environment")
	}
	return &Config{
		SupabaseDBConn:         getEnv("SUPABASE_DB_CONNECTION", "postgresql://postgres:postgres@localhost:5432/postgres?sslmode=disable"),
		SupabaseDBListenerConn: getEnv("SUPABASE_DB_LISTENER_CONNECTION", ""),
		GeminiAPIKey:           getEnv("GEMINI_API_KEY", ""),
		Port:               getEnv("PORT", "8080"),
		SupabaseURL:        getEnv("SUPABASE_URL", "https://ekhhojaezdfjfwuxyjkl.supabase.co"),
		SupabaseServiceKey: getEnv("SUPABASE_SERVICE_KEY", ""),
		OpenRouterAPIKey:   os.Getenv("OPENROUTER_API_KEY"),
		EnableOpenRouter:   os.Getenv("ENABLE_OPENROUTER") == "true",
		LLMBackend:         os.Getenv("LLM_BACKEND"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
