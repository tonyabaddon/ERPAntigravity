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

func TestParseAddMore_AddAnother(t *testing.T) {
	raw := `{"reply":"Oke, silakan sebutkan produk berikutnya.","add_another":true,"language":"id"}`
	got := ParseAddMore(raw)
	if !got.AddAnother {
		t.Error("expected add_another=true")
	}
	if got.Reply == "" {
		t.Error("expected non-empty reply")
	}
	if got.Language != "id" {
		t.Errorf("expected language id, got %s", got.Language)
	}
}

func TestParseAddMore_Done(t *testing.T) {
	raw := `{"reply":"Oke, lanjut ke pengiriman.","add_another":false,"language":"id"}`
	got := ParseAddMore(raw)
	if got.AddAnother {
		t.Error("expected add_another=false")
	}
}

func TestParseAddMore_BadJSON(t *testing.T) {
	got := ParseAddMore("not-json")
	if got.AddAnother {
		t.Error("bad JSON should default to add_another=false")
	}
}
