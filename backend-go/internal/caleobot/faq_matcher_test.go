package caleobot

import "testing"

func TestFaqMatcher_ExactKeyword(t *testing.T) {
	m := NewFaqMatcher([]FaqEntry{{ID: "harga", Keywords: []string{"harga", "biaya"}, Response: "X"}})
	hit, ok := m.Match("berapa harga paket premium?")
	if !ok || hit.ID != "harga" {
		t.Fatalf("expected match, got %+v ok=%v", hit, ok)
	}
}

func TestFaqMatcher_TypoTolerance(t *testing.T) {
	m := NewFaqMatcher([]FaqEntry{{ID: "harga", Keywords: []string{"harga"}, Response: "X"}})
	hit, ok := m.Match("berapa hraga premium?") // hraga = 1 edit distance
	if !ok || hit.ID != "harga" {
		t.Fatalf("expected typo tolerance, got %+v ok=%v", hit, ok)
	}
}

func TestFaqMatcher_NoMatch(t *testing.T) {
	m := NewFaqMatcher([]FaqEntry{{ID: "harga", Keywords: []string{"harga"}, Response: "X"}})
	_, ok := m.Match("hello are you a robot?")
	if ok {
		t.Fatal("expected no match")
	}
}
