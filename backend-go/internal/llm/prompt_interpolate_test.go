package llm

import (
	"strings"
	"testing"
)

func TestInterpolatePrompt_TenantName(t *testing.T) {
	raw := "Kamu adalah Calista dari {{TENANT_NAME}} — toko listrik."
	got := InterpolatePrompt(raw, TenantIdentity{Name: "Toko Jaya Makmur", PickupAddress: "Jl. Merdeka No. 1"})
	want := "Kamu adalah Calista dari Toko Jaya Makmur — toko listrik."
	if got != want {
		t.Errorf("TENANT_NAME not replaced:\n got:  %q\n want: %q", got, want)
	}
}

func TestInterpolatePrompt_PickupAddress(t *testing.T) {
	raw := "Ambil di toko: {{PICKUP_ADDRESS}}."
	got := InterpolatePrompt(raw, TenantIdentity{Name: "Toko A", PickupAddress: "Jl. Raya No. 5, Surabaya"})
	want := "Ambil di toko: Jl. Raya No. 5, Surabaya."
	if got != want {
		t.Errorf("PICKUP_ADDRESS not replaced:\n got:  %q\n want: %q", got, want)
	}
}

func TestInterpolatePrompt_BothPlaceholders(t *testing.T) {
	raw := "Selamat datang di {{TENANT_NAME}}. Alamat: {{PICKUP_ADDRESS}}."
	identity := TenantIdentity{Name: "Sinar Elektrik", PickupAddress: "Ruko Blok B No. 3"}
	got := InterpolatePrompt(raw, identity)
	want := "Selamat datang di Sinar Elektrik. Alamat: Ruko Blok B No. 3."
	if got != want {
		t.Errorf("both placeholders not replaced:\n got:  %q\n want: %q", got, want)
	}
}

func TestInterpolatePrompt_EmptyNameFallsBackToGeneric(t *testing.T) {
	raw := "Halo dari {{TENANT_NAME}}."
	got := InterpolatePrompt(raw, TenantIdentity{Name: "", PickupAddress: "Some addr"})
	// Empty name → falls back to FallbackTenantIdentity().Name
	if strings.Contains(got, "{{TENANT_NAME}}") {
		t.Error("placeholder should be replaced even when Name is empty")
	}
	if strings.Contains(got, "{{") {
		t.Errorf("unexpected placeholder remaining: %q", got)
	}
}

func TestInterpolatePrompt_EmptyAddressFallsBackToGeneric(t *testing.T) {
	raw := "Ambil di {{PICKUP_ADDRESS}}."
	got := InterpolatePrompt(raw, TenantIdentity{Name: "Toko X", PickupAddress: ""})
	if strings.Contains(got, "{{PICKUP_ADDRESS}}") {
		t.Error("PICKUP_ADDRESS placeholder should be replaced even when PickupAddress is empty")
	}
}

func TestInterpolatePrompt_NoPlaceholders(t *testing.T) {
	raw := "Teks biasa tanpa placeholder."
	got := InterpolatePrompt(raw, TenantIdentity{Name: "Toko Y", PickupAddress: "Jl. X"})
	if got != raw {
		t.Errorf("text without placeholders should be unchanged:\n got:  %q\n want: %q", got, raw)
	}
}

func TestInterpolatePrompt_DefaultIdentityNoGarindoRef(t *testing.T) {
	// Verify DefaultTenantIdentity restores the exact Garindo strings that were
	// in the prompt before templatization, so existing Garindo deployment is unaffected.
	d := DefaultTenantIdentity()
	if d.Name != "Garindo Jaya Panel" {
		t.Errorf("DefaultTenantIdentity.Name: got %q, want %q", d.Name, "Garindo Jaya Panel")
	}
	if d.PickupAddress != "LTC Glodok, Lantai UG Blok C30 No. 15" {
		t.Errorf("DefaultTenantIdentity.PickupAddress: got %q, want %q", d.PickupAddress, "LTC Glodok, Lantai UG Blok C30 No. 15")
	}
}

func TestInterpolatePrompt_MultipleOccurrences(t *testing.T) {
	raw := "{{TENANT_NAME}} — {{TENANT_NAME}} lagi."
	got := InterpolatePrompt(raw, TenantIdentity{Name: "Toko Z", PickupAddress: ""})
	want := "Toko Z — Toko Z lagi."
	if got != want {
		t.Errorf("multiple occurrences not all replaced:\n got:  %q\n want: %q", got, want)
	}
}
