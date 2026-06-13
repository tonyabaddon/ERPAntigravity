package llm

import (
	"errors"
	"testing"
)

func TestChainExhaustedError_ContainsTriedModels(t *testing.T) {
	err := &ChainExhaustedError{TriedModels: []string{"a", "b", "c"}}
	if err.Error() == "" {
		t.Fatal("expected non-empty error message")
	}
	if !errors.Is(err, ErrChainExhausted) {
		t.Errorf("expected errors.Is(err, ErrChainExhausted) to be true")
	}
}

func TestMessageRole_Validation(t *testing.T) {
	cases := []struct {
		role  string
		valid bool
	}{
		{"system", true},
		{"user", true},
		{"assistant", true},
		{"customer", false},
		{"", false},
	}
	for _, c := range cases {
		got := IsValidRole(c.role)
		if got != c.valid {
			t.Errorf("IsValidRole(%q): want %v, got %v", c.role, c.valid, got)
		}
	}
}
