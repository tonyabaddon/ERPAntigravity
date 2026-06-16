package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/llm"
)

func main() {
	key := os.Getenv("GEMINI_API_KEY")
	if key == "" {
		log.Fatal("GEMINI_API_KEY required")
	}
	client := llm.NewGeminiClient(key)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	resp, err := client.Complete(ctx, llm.CompletionRequest{
		Model: "gemini-2.5-flash-lite",
		Messages: []llm.Message{
			{Role: "system", Content: "You are Calista, asisten WhatsApp toko alat listrik. Balas dalam JSON: {\"reply\": \"...\"}"},
			{Role: "user", Content: "Halo bos, ada kabel 2.5mm?"},
		},
		MaxTokens: 100,
	})
	if err != nil {
		log.Fatalf("Complete failed: %v", err)
	}
	fmt.Printf("Body: %s\n", resp.Body)
	fmt.Printf("Tokens: prompt=%d completion=%d total=%d\n",
		resp.Usage.Prompt, resp.Usage.Completion, resp.Usage.Total)
}
