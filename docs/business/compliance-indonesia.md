# Vosi — Indonesia Compliance Framework

**Date:** 2026-06-13 — initial draft
**Status:** Design-level interpretation. **Lawyer consultation required before tenant #2 onboards.**

> This doc lives **separate from the tech spec** because legal interpretation, DPA templates, and breach procedures evolve independently of architecture. Tech spec (`docs/superpowers/specs/2026-06-13-multi-tenant-prerequisites-design.md` §12.5) references decisions from this doc; implementation-level commitments are captured there.

---

## ⚠️ Disclaimer

I am not a lawyer. This document is based on public-source interpretation of Indonesian law as of 2026-06-13. Before any paying tenant onboards, this framework must be reviewed by an Indonesian lawyer specializing in data protection / IT contracts.

---

## 1. Applicable laws

### 1.1 UU No. 27 Tahun 2022 — Pelindungan Data Pribadi (UU PDP)

Indonesia's Personal Data Protection Law. Full effect since October 2024 (after 2-year transition).

Key provisions for Vosi:

| Pasal | Provision | Vosi implication |
|---|---|---|
| **5-13** | Data subject rights: access, correct, delete, port, withdraw consent | UI for tenant-of-customer to exercise these (Phase 2 self-serve; Phase 1 via tenant edit screens + SQL function) |
| **14** | Process data only as long as necessary for purpose, OR per other regulations | Aligns with retention design in §3 below |
| **20-22** | Privacy policy + consent required | Privacy policy required for Vosi (controller) + template for tenants (their controllership) |
| **21 + PP 71/2019** | Data of Indonesian citizens collected/processed in Indonesia should be stored at adequate-protection jurisdictions | Singapore PDPA = adequate protection (Supabase region `ap-southeast-1`). Backups to Indonesia for safety (GCS `asia-southeast2` Jakarta) |
| **31** | Data subject right to request deletion | Tenant handles per their controller relationship; Vosi as processor supports via tooling |
| **43-44** | Data security obligations | Encryption, access controls, audit logs — all in tech spec |
| **45 ayat (1)** | Pengendali (controller) wajib menghapus data ketika tujuan tercapai, persetujuan ditarik, atau diminta subjek | Tenant decides; Vosi provides tooling |
| **46 ayat (3)** | Data breach notification: 3×24 hours to Kominfo + affected subjects | **Critical** — included in `docs/runbooks/disaster-recovery.md`; contacts documented |
| **51** | Data Processing Agreement (DPA) required between controller and processor | DPA template required before tenant #2 onboards |
| **53-54** | DPO appointment threshold | Ambiguous in UU; lawyer interpretation. Likely Phase 2/3 for Vosi based on scale |

### 1.2 UU KUP Pasal 28(11) — Tax Records Retention

> "Buku, catatan, dan dokumen yang menjadi dasar pembukuan atau pencatatan dan dokumen lain... wajib disimpan selama 10 (sepuluh) tahun di Indonesia."

Every Indonesian business (Wajib Pajak) must retain accounting records for 10 years. Applies to every Vosi tenant (the toko).

**Critical insight:** This is the **tenant's** obligation, not Vosi's. But because tenants use Vosi as their record-keeping system, Vosi providing 10-year retention is a competitive feature — tenants don't need to export and manage their own archives.

### 1.3 The tension between UU PDP and UU KUP — resolved

UU PDP says: delete personal data when no longer needed.
UU KUP says: retain business records 10 years.

**Resolution in our design:**

- **PII** (customer name, phone, email, address in `customers` table) → deletable on data-subject request, even though referenced by transaction records.
- **Business records** (transactions, invoices, stock movements) → retained 10 years per UU KUP, but PII fields can be anonymized (replaced with hash) so transaction integrity is preserved without ongoing PDP exposure.

This is standard practice in SaaS serving regulated businesses — separate the "who" (PII, deletable) from the "what" (business record, retained).

---

## 2. Role assignment

| Actor | Role | Data category |
|---|---|---|
| **Tenant (toko using Vosi)** | **Data controller** | Their customers' PII (names, phones, addresses, transaction history) |
| | | They obtain customer consent, respond to deletion requests, own UU KUP retention obligation |
| **Vosi (as company)** | **Data processor** | Tenant's customer data — processed on tenant's behalf |
| | **Data controller** | Tenant's own data: Owner email, billing info, login logs, audit |
| **Customer of tenant** | **Data subject** | Their own PII held by tenant in Vosi system |

**Practical implications:**

- Customer-of-tenant deletion requests go to the tenant (toko), not Vosi.
- Vosi provides tooling for tenants to fulfill deletion requests (tenant UI edit/delete + `anonymize_customer()` SQL function in Phase 1).
- Vosi's own privacy policy covers tenant Owner accounts and billing.
- Vosi-tenant DPA (Pasal 51) spells out the processor obligations.

---

## 3. Retention policy

### 3.1 Tenant business records (the bulk of data)

```
Active subscription → full access
   ↓ subscription expires
Grace period (7 days) → full access
   ↓
Read-only mode → tenant can view + export indefinitely
   ↓
Hard delete → annual cron deletes rows aged 10+ years from creation
              (UU KUP retention period elapsed)
```

All data lives in Supabase Postgres. No cold storage Phase 1. Storage scaling triggers DB tier upgrade per tech spec §8.5.

### 3.2 PII (customer records)

- **Active:** Full access, tenant manages via UI.
- **On data-subject deletion request:** Tenant manages via their existing customer-edit UI. They decide per request whether to blank fields, delete the row outright, or keep as-is. This is the tenant's controllership role — Vosi does not provide a separate "anonymize" function.
- **On tenant churn:** Tenant decides via export + delete in their own UI before churning. After churn, Vosi retains business records 10 years (UU KUP); customer references survive as-is unless tenant cleaned up before exit.

### 3.3 Vosi's own audit & billing records

- `super_admin_audit_log`, `tenant_subscription_audit`, `security_audit_log` retained 10 years (Vosi's own business records, separate from tenant's books).

---

## 4. Data localization

| Data type | Location | Rationale |
|---|---|---|
| Live Postgres (active data) | Supabase `ap-southeast-1` (Singapore) | Singapore PDPA classed as "adequate protection" jurisdiction per UU PDP interpretation. Practical for Supabase availability. |
| Backups (DR / archive) | GCS `asia-southeast2` (Jakarta) | Physically in Indonesia. Maximum compliance safety for long-term retention. |
| Frontend / CDN | Global (Cloudflare or default) | No PII in static assets. |
| Operator console | Same as live Postgres | Operator queries cross-tenant data; same physical location. |

**To verify with lawyer:** Whether Singapore data residency is acceptable for tenant-of-customer PII, or whether all PII must be in Indonesia. If the latter, migrate to a Jakarta-region Postgres provider (option: Supabase doesn't have Jakarta yet; would need self-host or alternative).

---

## 5. Breach notification procedure (UU PDP Pasal 46 ayat 3)

**Deadline: 3×24 hours from confirmed breach to notify Kominfo + affected subjects.**

The runbook in `docs/runbooks/disaster-recovery.md` includes the following procedure (here for reference):

1. **Identify breach** — confirm data was actually exposed (not just suspected).
2. **Contain** — revoke compromised credentials, isolate affected systems.
3. **Assess scope** — which tenants affected, what PII categories exposed.
4. **Within 24 hours:** Internal incident report drafted; legal/operations stakeholders notified.
5. **Within 48 hours:** Notify affected tenants in writing (email, with template). Tenants then notify their data subjects (their controllership obligation).
6. **Within 72 hours:** File formal notification to Kominfo (Komdigi). Use Kominfo PDP reporting channel (URL/contact to be added once verified).
7. **Post-incident:** Public statement, technical post-mortem, mitigation plan documented.

**Contacts to record in runbook before tenant #2 onboards:**

- Kominfo (Komdigi) PDP reporting URL/email — TBD verify
- Vosi legal advisor (to engage) — TBD
- Cloud provider security contacts (Supabase, GCP) — well-documented in their respective dashboards

---

## 6. DPA & privacy policy templates

### 6.1 DPA between Vosi (processor) and tenant (controller)

**Status:** Rough template draft required before tenant #2 onboards. Refined with lawyer in Phase 2.

Minimum content (per UU PDP Pasal 51 interpretation):
- Scope of processing (what data, what purposes)
- Duration of processing (during subscription + retention period)
- Security obligations (encryption, access control, audit)
- Sub-processor list (Supabase, Cloud Run, Sentry, PostHog, Resend, Anthropic) with their respective data handling stance
- Breach notification commitment (3×24 hour pass-through to tenant)
- Data subject request handling (tooling provided to tenant; tenant fulfills)
- Termination handling (data export, retention, deletion)

### 6.2 Vosi privacy policy

Covers Vosi as controller of:
- Tenant Owner contact info (name, email, phone)
- Billing/subscription info
- Login & audit logs
- Operator activity logs
- Investigation agent data (sanitized stack traces, code references — no tenant PII)

Posted at `vosi.id/privacy` and linked from owner onboarding email + operator console footer.

### 6.3 Tenant privacy policy template

Vosi provides a **template** that tenants can adapt for their customer-facing privacy policy. Reduces legal burden on tenants, ensures consistent privacy stance across the SaaS network.

---

## 7. DPO (Data Protection Officer) — defer

UU PDP Pasal 53-54 requires a DPO when processing personal data:
- (a) for public services / state organs
- (b) processed on a "skala besar" (large scale) — threshold ambiguous
- (c) systematic monitoring of subjects
- (d) sensitive personal data

For Vosi at ≤50 tenants, "skala besar" is likely not met. Lawyer interpretation needed before scaling beyond that. Currently Phase 2/3 consideration.

---

## 8. PPN / e-Faktur / Coretax — conditional

UU KUP Pasal 4 ayat (2) regulates PPN. Threshold: Wajib Pajak revenue > Rp 4.8 billion/year must register as PKP and collect 11% PPN.

**Vosi's own PPN status:**

- At 50 tenants × Rp 559k average = Rp 27,950k/mo = Rp 335M/year — **well below PKP threshold**. Not PKP.
- No PPN collected on subscription invoices to tenants. PPh Final 0.5% applies as sole proprietorship under Rp 4.8B/yr revenue.

**Tenant-side PPN exposure (separate concern):**

Some tenants will be PKP themselves and want Vosi to handle their PPN/e-Faktur compliance. This is roadmap §4 coherence check — out of Phase 1 scope; conditional Phase 2 feature based on demand.

---

## 9. Open legal questions (for lawyer review)

1. **Vosi legal entity structure — sole proprietorship vs PT.** Critical decision before tenant #2 onboards. Implications:
   - **Sole proprietorship**: simpler, PPh Final 0.5% under Rp 4.8B/year revenue. But cannot issue invoice in PT format. Tenant who is PKP may need PT invoice to credit PPN / book as expense.
   - **PT (limited company)**: can issue PT invoice, register as PKP if/when revenue exceeds Rp 4.8B/year, signs DPA with own liability cap. Higher setup + ongoing accounting cost.
   - **Recommendation:** consult lawyer on whether starting as sole proprietorship is acceptable for first 5-10 tenants, with PT incorporation triggered later.
2. Is Singapore (Supabase `ap-southeast-1`) acceptable for tenant-of-customer PII under UU PDP Pasal 21, or must all PII be in Indonesia?
3. Vosi-tenant DPA template — does it adequately spell out the processor/controller split? Sub-processor disclosure (Supabase, GCS, Sentry, etc.)?
4. What level of customer-of-tenant consent does Vosi need to support (banner? click-through? signed paper?)?
5. DPO threshold — when does Vosi cross "skala besar" requiring DPO appointment?
6. Cross-border data transfer for Sentry (US-hosted) / PostHog (EU/US) / Anthropic (US) — does sanitized telemetry (stack traces without PII) require explicit consent / DPA addenda?
7. Liability cap for data breach — what's standard for processor in Indonesian DPA?
8. Termination clause — Vosi terminates tenant: data hand-off timeline. Tenant terminates Vosi: same. Differences?

---

*This is initial framework. Engage Indonesian lawyer specializing in data protection / IT contracts before tenant #2 onboards.*
