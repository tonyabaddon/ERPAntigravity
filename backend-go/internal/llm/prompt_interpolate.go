package llm

import "strings"

// TenantIdentity holds the per-tenant strings that are injected into the
// Calista system prompt at startup. All fields have safe defaults so a
// partially-configured tenant still produces a coherent prompt.
//
// Scope: MVP (Phase 3 will extend with per-tenant SKU catalog injection).
// Fields intentionally omitted from this struct (deferred to Phase 3):
//   - Staff names ("Pak Herman" etc.)
//   - Order-ID prefix (GJP-)
//   - SKU catalog content
type TenantIdentity struct {
	// Name is the tenant's store name (e.g. "Garindo Jaya Panel").
	// Default: "toko ini"
	Name string

	// PickupAddress is the store's physical pickup address.
	// Default: "toko kami"
	PickupAddress string
}

// DefaultTenantIdentity returns the Garindo Jaya Panel identity values.
// Used as the zero-config default so existing deployments are unaffected.
func DefaultTenantIdentity() TenantIdentity {
	return TenantIdentity{
		Name:          "Garindo Jaya Panel",
		PickupAddress: "LTC Glodok, Lantai UG Blok C30 No. 15",
	}
}

// FallbackTenantIdentity returns safe generic values for when tenant data
// cannot be loaded (no env vars set, DB unavailable). Produces a prompt
// that still functions but uses generic store references.
func FallbackTenantIdentity() TenantIdentity {
	return TenantIdentity{
		Name:          "toko ini",
		PickupAddress: "toko kami",
	}
}

// InterpolatePrompt replaces template placeholders in rawPrompt with the
// values from t. It is called once at startup — not per-request — so the
// cost is a one-time string.Replacer pass over the ~1,100-line prompt.
//
// Placeholders:
//   - {{TENANT_NAME}}      → t.Name
//   - {{PICKUP_ADDRESS}}   → t.PickupAddress
func InterpolatePrompt(rawPrompt string, t TenantIdentity) string {
	name := t.Name
	if name == "" {
		name = FallbackTenantIdentity().Name
	}
	pickup := t.PickupAddress
	if pickup == "" {
		pickup = FallbackTenantIdentity().PickupAddress
	}
	r := strings.NewReplacer(
		"{{TENANT_NAME}}", name,
		"{{PICKUP_ADDRESS}}", pickup,
	)
	return r.Replace(rawPrompt)
}
