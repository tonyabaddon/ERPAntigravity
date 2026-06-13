package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOpenRouterClient_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("missing/invalid Authorization header: %q", r.Header.Get("Authorization"))
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "google/gemma-4-31b" {
			t.Errorf("expected model gemma-4-31b, got %v", body["model"])
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"Halo Pak!"}}],"usage":{"prompt_tokens":42,"completion_tokens":7,"total_tokens":49}}`))
	}))
	defer srv.Close()

	c := NewOpenRouterClient("test-key", WithBaseURL(srv.URL))
	resp, err := c.Complete(context.Background(), CompletionRequest{
		Model:    "google/gemma-4-31b",
		Messages: []Message{{Role: "user", Content: "halo"}},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Body != "Halo Pak!" {
		t.Errorf("expected body 'Halo Pak!', got %q", resp.Body)
	}
	if resp.Usage.Prompt != 42 || resp.Usage.Completion != 7 {
		t.Errorf("unexpected usage: %+v", resp.Usage)
	}
}

func TestOpenRouterClient_RateLimited(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte(`{"error":{"message":"Rate limit","code":429}}`))
	}))
	defer srv.Close()

	c := NewOpenRouterClient("test-key", WithBaseURL(srv.URL))
	_, err := c.Complete(context.Background(), CompletionRequest{
		Model:    "x",
		Messages: []Message{{Role: "user", Content: "halo"}},
	})
	if err == nil {
		t.Fatal("expected error on 429, got nil")
	}
	if !IsRateLimit(err) {
		t.Errorf("expected IsRateLimit(err)=true, got false; err=%v", err)
	}
}

func TestOpenRouterClient_Timeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := NewOpenRouterClient("test-key",
		WithBaseURL(srv.URL),
		WithHTTPTimeout(50*time.Millisecond),
	)
	_, err := c.Complete(context.Background(), CompletionRequest{
		Model:    "x",
		Messages: []Message{{Role: "user", Content: "halo"}},
	})
	if err == nil {
		t.Fatal("expected timeout error, got nil")
	}
	if !IsTimeout(err) && !strings.Contains(err.Error(), "deadline") {
		t.Errorf("expected timeout-shaped error, got %v", err)
	}
}
