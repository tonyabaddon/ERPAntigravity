package rules

import "testing"

func TestWiringKeywords(t *testing.T) {
	cases := []struct {
		text     string
		expected EscalationType
	}{
		{"saya butuh instalasi panel", EscalationWiring},
		{"perlu grounding untuk gedung", EscalationWiring},
		{"mau order panel custom 200A", EscalationWiring},
		{"butuh diagram kelistrikan", EscalationWiring},
		{"proyek besar 3 lantai", EscalationWiring},
		{"mau beli kabel 10 meter", EscalationNone},
		{"harga kabel tembaga berapa", EscalationNone},
	}
	for _, tc := range cases {
		got := CheckEscalation(tc.text)
		if got != tc.expected {
			t.Errorf("CheckEscalation(%q) = %q, want %q", tc.text, got, tc.expected)
		}
	}
}

func TestAdminKeywords(t *testing.T) {
	cases := []struct {
		text     string
		expected EscalationType
	}{
		{"bisa kasih diskon?", EscalationAdmin},
		{"minta harga khusus dong", EscalationAdmin},
		{"can I get a discount please", EscalationAdmin},
		{"saya mau order kabel", EscalationNone},
	}
	for _, tc := range cases {
		got := CheckEscalation(tc.text)
		if got != tc.expected {
			t.Errorf("CheckEscalation(%q) = %q, want %q", tc.text, got, tc.expected)
		}
	}
}
