// backend-go/internal/recon/name_similarity_test.go
package recon

import "testing"

func TestNormalizeName(t *testing.T) {
	cases := []struct{ in, want string }{
		{"PT Sinar Listrik Sejati TBK", "SINAR LISTRIK SEJATI"},
		{"CV Berkah Jaya", "BERKAH JAYA"},
		{"Bpk Hendra Kurniawan", "HENDRA KURNIAWAN"},
		{"  Ibu  Wati  ", "WATI"},
		{"Hendra K", "HENDRA K"},
	}
	for _, c := range cases {
		if got := NormalizeName(c.in); got != c.want {
			t.Errorf("NormalizeName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestNameSimilarity(t *testing.T) {
	cases := []struct {
		a, b   string
		minVal float64
		maxVal float64
	}{
		{"HENDRA K", "Hendra Kurniawan", 0.50, 0.95},
		{"Budi Setiawan", "BUDI SETIAWAN", 1.00, 1.00},
		{"CV Berkah Jaya", "Berkah Jaya CV", 0.85, 1.00},
		{"Anton", "Bambang", 0.0, 0.30},
	}
	for _, c := range cases {
		got := NameSimilarity(c.a, c.b)
		if got < c.minVal || got > c.maxVal {
			t.Errorf("NameSimilarity(%q,%q) = %.2f, want [%.2f, %.2f]", c.a, c.b, got, c.minVal, c.maxVal)
		}
	}
}
