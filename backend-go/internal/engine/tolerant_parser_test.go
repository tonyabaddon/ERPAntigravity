package engine

import "testing"

func TestTolerantParseJSON_StripsMarkdownFences(t *testing.T) {
	raw := "```json\n{\"reply\":\"Halo!\"}\n```"
	got, err := tolerantParseJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got != `{"reply":"Halo!"}` {
		t.Errorf("expected stripped JSON, got %q", got)
	}
}

func TestTolerantParseJSON_ExtractsFirstBalancedObject(t *testing.T) {
	raw := "Sure, here is the JSON: {\"reply\":\"Halo!\",\"next\":\"X\"} that's all."
	got, err := tolerantParseJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got != `{"reply":"Halo!","next":"X"}` {
		t.Errorf("expected extracted JSON, got %q", got)
	}
}

func TestTolerantParseJSON_NoObject_Errors(t *testing.T) {
	_, err := tolerantParseJSON("no json here at all")
	if err == nil {
		t.Fatal("expected error for no-JSON input")
	}
}

func TestTolerantParseJSON_AlreadyClean_Passthrough(t *testing.T) {
	raw := `{"reply":"OK"}`
	got, err := tolerantParseJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got != raw {
		t.Errorf("expected passthrough, got %q", got)
	}
}
