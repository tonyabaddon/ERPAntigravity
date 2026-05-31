package engine

import "testing"

func TestParseGreeting(t *testing.T) {
	raw := `{"reply":"Halo! Selamat datang.","detected_language":"id"}`
	resp, err := ParseGreeting(raw)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Reply == "" {
		t.Error("reply should not be empty")
	}
	if resp.DetectedLanguage != "id" {
		t.Errorf("language = %q, want id", resp.DetectedLanguage)
	}
}

func TestParseGreetingInvalidJSON(t *testing.T) {
	resp, err := ParseGreeting("not json")
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
	_ = resp
}

func TestParseCollecting(t *testing.T) {
	raw := `{"reply":"Nama Anda?","collected":{"name":"Budi","company":"","address":"","product":""},"next_action":"CONTINUE"}`
	resp, err := ParseCollecting(raw)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Collected.Name != "Budi" {
		t.Errorf("name = %q, want Budi", resp.Collected.Name)
	}
}

func TestParseConfirming(t *testing.T) {
	raw := `{"reply":"Pesanan dikonfirmasi!","confirmed":true,"modification_requested":false}`
	resp, err := ParseConfirming(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !resp.Confirmed {
		t.Error("confirmed should be true")
	}
}

func TestFallbackReply(t *testing.T) {
	id := FallbackReply("id")
	en := FallbackReply("en")
	if id == "" || en == "" {
		t.Error("fallback replies should not be empty")
	}
	if id == en {
		t.Error("id and en fallback replies should differ")
	}
}
