package llm

import (
	"strings"
	"testing"
)

func TestExtractTone_TypicalReply(t *testing.T) {
	got := ExtractTone("Halo Pak Budi! Kabel 2.5mm tersedia. Mau berapa meter ya Pak?", "google/gemma-4-31b")
	if got.Greeting == "" {
		t.Error("expected non-empty Greeting")
	}
	if got.ModelUsed != "google/gemma-4-31b" {
		t.Errorf("expected ModelUsed=gemma-4-31b, got %q", got.ModelUsed)
	}
	if got.Sample == "" {
		t.Error("expected Sample to be populated")
	}
	if got.Formality != "casual_pak_bu" {
		t.Errorf("expected Formality=casual_pak_bu, got %q", got.Formality)
	}
}

func TestExtractTone_EmptyReply(t *testing.T) {
	got := ExtractTone("", "google/gemma-4-31b")
	if got.Sample != "" {
		t.Errorf("expected empty Sample for empty reply, got %q", got.Sample)
	}
}

func TestBuildToneHint_AllFields(t *testing.T) {
	tone := ToneSignature{
		Greeting:  "Halo Pak Budi",
		Signoff:   "",
		Formality: "casual_pak_bu",
		Sample:    "Halo Pak Budi! Kabel tersedia.",
		ModelUsed: "google/gemma-4-31b",
	}
	hint := BuildToneHint(tone)
	if !strings.Contains(hint, "Halo Pak Budi") {
		t.Errorf("expected hint to contain greeting, got %q", hint)
	}
	if !strings.Contains(strings.ToLower(hint), "match this voice") {
		t.Errorf("expected hint to contain 'match this voice' directive, got %q", hint)
	}
}

func TestBuildToneHint_EmptyToneReturnsEmpty(t *testing.T) {
	hint := BuildToneHint(ToneSignature{})
	if hint != "" {
		t.Errorf("expected empty hint for zero-value ToneSignature, got %q", hint)
	}
}
