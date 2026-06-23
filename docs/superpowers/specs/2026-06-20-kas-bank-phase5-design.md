# Kas & Bank — Phase 5 Design Spec (Auto Bank Feed) — TBD Level

> **⚠️ DEPRECATED (2026-06-21):** Phase ini di-DROP dari active roadmap saat user pivot ke GL pendekatan (Roadmap v2). Manual PDF upload pattern Rekonsiliasi existing dianggap cukup. API integrasi via aggregator (Brick/Cashlink) di-defer ke future tanpa fixed schedule.
>
> **Active roadmap:** `2026-06-21-kas-bank-gl-roadmap.md`
> **Reason:** User decision 2026-06-21 — "Pakai Manual auto-upload PDF cron aja seperti fitur rekonsiliasi saat ini, untuk connect API itu ke depan aja, jangan sekarang."
> Spec ini di-preserve untuk historical record + reference saat phase ini revisited di masa depan.

---

**Tanggal:** 2026-06-20
**Status:** ⚠️ DEPRECATED — see banner above
**Roadmap:** `2026-06-20-kas-bank-roadmap.md` (also superseded)
**Depends on:** Phase 1a-4 (fully live, with stable cash_movements + recon flow)

---

## 1. Goal

Tidak perlu upload PDF mutasi tiap bulan. Saldo Bank update real-time via API partner bank. Bisa initiate outbound transfer langsung dari aplikasi dengan dual-role (Maker / Releaser + OTP).

**Success criteria (saat phase ini scheduled):**
- Bank mutasi auto-pull harian (atau real-time webhook) → insert ke `bank_statement_lines` + auto-match ke `cash_movements`
- Saldo per akun bank update tanpa interaksi owner
- Outbound transfer dari aplikasi dengan Maker create + Releaser approve via OTP
- Audit trail per transaksi outbound (regulatory)

---

## 2. Trigger conditions untuk start Phase 5

Phase 5 di-defer sampai SATU dari kondisi berikut tercapai:

1. **Partner API siap untuk bank yang Garindo pakai.** Saat ini Cashlink Jurnal cuma support Mandiri. BCA punya OpenAPI tapi onboarding requires PT-level company + Rp xx jt deposit. Kondisi: ada partner aggregator yang cover bank Garindo + onboarding friction acceptable.
2. **Volume transaksi/bulan justify cost.** Cashlink-style integration biasanya: setup fee 1-5 jt + per-transaksi fee Rp 1000-5000. Break-even kalau owner save >10 jam/bulan dari manual upload.
3. **Paying tenant minta sebagai gating feature.** Jika tenant berbayar masuk dengan "wajib auto bank feed" as deal-breaker, Phase 5 unblock priority.

Default: **leave indefinitely deferred** sampai ada pull signal.

---

## 3. Vendor options (untuk evaluasi saat Phase 5 trigger)

### 3.1 Aggregator (multi-bank API)

| Vendor | Coverage | Pricing model | Notes |
|---|---|---|---|
| **Mekari Cashlink** | Mandiri only saat ini | TBD | Direct competitor; mungkin bisa partnership |
| **Brick (brick.org)** | BCA, Mandiri, BRI, BNI, CIMB, etc | Per API call | Indonesian aggregator, popular fintech choice |
| **Finantier** | BCA, Mandiri, BRI, BNI + e-wallet | Setup + per-call | Acquired by Brick; legacy |
| **Ayoconnect** | BCA, Mandiri + few more | Tier-based | Indonesian, B2B focus |
| **Xendit Direct Debit** | Limited bank coverage | Per-tx | Strong for payment processing, weaker for read-only |

### 3.2 Direct integration (per bank)

| Bank | API availability | Notes |
|---|---|---|
| **BCA** | BCA OpenAPI | PT-only onboarding, sandbox limited |
| **Mandiri** | Mandiri Open API | Same |
| **BRI** | BRI OpenAPI | Government-focused |
| **CIMB** | CIMB API Banking | Easier onboarding, limited features |

Direct = more control, more dev work, harder ops. Aggregator preferred untuk MSME multi-bank reality.

**Recommended initial pick saat trigger:** Brick (multi-bank coverage, Indonesian, B2B model fit).

---

## 4. Architecture sketch

### 4.1 Inbound: bank mutasi pull

```
[Brick API] ──(daily cron, webhook on push)──→ [backend-go /api/bank/sync]
                                                       │
                                                       v
                                          [insert bank_statement_lines]
                                                       │
                                                       v
                                          [auto-match via Phase 4 logic]
                                                       │
                                                       v
                                          [update cash_movements reconciled]
```

- New backend-go service `internal/banksync/`:
  - `client.go` — Brick API client (auth, list_accounts, get_transactions)
  - `poller.go` — daily cron job triggered by `cron.tab` (or cloud scheduler)
  - `webhook.go` — receive push from Brick
  - `sync.go` — transform Brick response → bank_statement_lines insert
- Idempotency: dedup_hash on (bank_account_id, txn_id from Brick)
- Error handling: retry queue for failed inserts

### 4.2 Outbound: app-initiated transfer

```
[Frontend: TransferOutModal] → [RPC create_outbound_transfer] (Maker role)
                                            │
                                            v
                              [outbound_transfers table: status=PENDING_RELEASER]
                                            │
                                            v
                              [Releaser opens approval inbox]
                                            │
                                            v
                              [RPC approve_outbound_transfer] (Releaser role + OTP)
                                            │
                                            v
                              [backend-go /api/bank/transfer]
                                            │
                                            v
                              [Brick API: initiate transfer]
                                            │
                                            v
                              [webhook: transfer SUCCESS / FAILED]
                                            │
                                            v
                              [update outbound_transfers + insert cash_movement OUT]
```

### 4.3 New tables

```sql
CREATE TABLE public.outbound_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_account_id uuid NOT NULL REFERENCES cash_accounts(id),
  to_bank_code text NOT NULL,
  to_account_number text NOT NULL,
  to_account_holder text NOT NULL,
  amount numeric(15,2) NOT NULL,
  description text,
  status text NOT NULL CHECK (status IN ('PENDING_RELEASER','APPROVED','SUBMITTED','SUCCESS','FAILED','CANCELLED')),
  maker_user_id uuid REFERENCES auth.users(id),
  releaser_user_id uuid REFERENCES auth.users(id),
  released_at timestamptz,
  bank_ref_id text,   -- Brick reference ID
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.bank_sync_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_account_id uuid NOT NULL REFERENCES cash_accounts(id) UNIQUE,
  vendor text NOT NULL CHECK (vendor IN ('BRICK','XENDIT','MEKARI_CASHLINK')),
  vendor_account_id text NOT NULL,    -- Brick account ID
  encrypted_credentials text NOT NULL, -- pgp_sym_encrypt the API token
  last_sync_at timestamptz,
  sync_status text DEFAULT 'IDLE' CHECK (sync_status IN ('IDLE','SYNCING','ERROR')),
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 4.4 Security model

- API credentials encrypted at rest using Supabase pgsodium / pgcrypto
- Maker/Releaser role separation: `bank_role` enum di admin_users (`MAKER`, `RELEASER`, `BOTH`)
- OTP: Google Authenticator (TOTP) — reuse existing PIN flow or add TOTP layer
- All outbound transfers require BOTH Maker create + Releaser approve
- Audit log every API call to Brick
- Rate limit: max N outbound/hour per account (configurable)
- Transfer limits: max amount per transaksi + per hari per akun (configurable owner)

---

## 5. UI components sketch

### 5.1 Bank sync setup (Pengaturan → Kas & Bank)

- "Connect Bank" button per akun bank → OAuth-like flow ke Brick
- After connect: show last_sync_at, sync_status badge, manual "Sync Now" button

### 5.2 Outbound transfer modal

- Trigger di AccountDetailScreen: "+ Transfer Keluar" (visible kalau akun has bank_sync_credentials)
- Form: from (auto-fill current account), to (bank code + account number + holder name), amount, description
- Maker submit → status PENDING_RELEASER
- Inbox card for Releaser dengan tombol "Setujui (OTP)"
- Releaser OTP modal: input 6 digit Google Authenticator code → submit

### 5.3 Outbound transfer history

- Tab di AccountDetailScreen "Transfer Keluar"
- List dengan status badge: pending, approved, submitted, success, failed
- Click → detail modal dengan timeline

---

## 6. Edge cases

| Case | Handling |
|---|---|
| Brick API outage during sync | Queue retry, alert owner via WA |
| Outbound transfer fails di Brick (insufficient balance, dll) | Update status=FAILED, owner notification, no cash_movement created |
| Releaser approval expired (>1 jam) | Auto-cancel; Maker re-submit |
| Webhook delivered twice (Brick retries) | Idempotency via bank_ref_id |
| API credential expired/revoked | Status=ERROR, owner re-auth |
| Multiple webhooks for partial settlement | Insert multiple bank_statement_lines linked to same outbound_transfer |
| Currency mismatch (rare untuk IDR only) | Reject di RPC |

---

## 7. Testing strategy

**Unit:**
- Brick API client mock (record/replay)
- Credential encryption/decryption roundtrip

**Integration:**
- Daily sync poller → insert bank_statement_lines + auto-match
- Outbound transfer Maker→Releaser flow → status transitions
- Webhook handler updates outbound_transfers correctly

**E2E (sandbox):**
- Connect sandbox bank account → sync 1 day of transactions
- Initiate outbound transfer di sandbox → verify status SUCCESS

---

## 8. Risk + mitigation

| Risk | Mitigation |
|---|---|
| Vendor lock-in (Brick) | Abstract via `internal/banksync/Provider` interface; allow multi-vendor |
| API cost runaway | Per-account monthly call limit + alert |
| Outbound transfer mis-route (typo account number) | Recipient validation API (Brick provides); manual confirm before submit |
| Credential leak | Encryption at rest + service-role-only access; rotate quarterly |
| Regulatory compliance (BI rules on payment automation) | Legal review pre-launch; compliance sign-off |
| Sandbox vs production parity | Soak in sandbox 1 minggu before prod |

---

## 9. Open questions (locked saat trigger condition tercapai)

**O1. Vendor pick.** Brick / Mekari Cashlink partnership / Direct BCA OpenAPI / mix?

**O2. Onboarding model.** Per-tenant self-service connect (OAuth-like) vs Vosi-managed (we onboard tenant via partner relationship)?

**O3. Outbound transfer enabled di MVP Phase 5 atau read-only first?**
- (a) MVP = read-only (auto-pull mutasi); outbound = Phase 5.1
- (b) MVP = both inbound + outbound (Maker/Releaser)

**O4. Pricing pass-through to tenant.** Phase 5 fee per bank account:
- (a) Vosi absorb cost (subscription tier upgrade)
- (b) Pass-through: tenant pay per-API-call surcharge
- (c) Hybrid: base tier includes N calls, overage pass-through

**O5. Maker/Releaser bisa orang yang sama (`BOTH` role)?**
- (a) No (mandatory separation, defensive)
- (b) Yes (founder tenant context where owner=admin)
- (c) Owner choice per tenant config

**O6. Cron frequency.** Default sync interval:
- (a) Daily (low cost, 1 day lag)
- (b) Hourly (more current, higher cost)
- (c) Real-time webhook only (cheapest if Brick supports)
- (d) Configurable per akun

**O7. WhatsApp notification untuk transfer events.**
- (a) No (reuse approval inbox UI)
- (b) Yes (WA to owner saat outbound SUCCESS/FAILED)
- (c) Configurable

---

## 10. Estimate (TBD ~10-15 hari)

| Komponen | Estimasi |
|---|---|
| Vendor evaluation + onboarding (Brick or alt) | 2-3 hari (research + sign contracts) |
| Schema: outbound_transfers + bank_sync_credentials | 0.5 hari |
| backend-go internal/banksync/ (client + poller + webhook) | 2-3 hari |
| RPC create_outbound + approve_outbound | 1 hari |
| Maker/Releaser UI + OTP integration | 1.5-2 hari |
| Bank connect Pengaturan UI | 1 hari |
| Outbound transfer modal + history tab | 1 hari |
| Security review (encryption, audit) | 1 hari |
| Sandbox soak + bug fixes | 1-2 hari |
| Compliance review | 1 hari |

Total: **~10-15 hari** termasuk vendor onboarding + security/compliance.

---

## 11. What this spec does NOT lock

Because Phase 5 trigger is external, this spec stays at **sketch level**. Final lock happens saat:
- Trigger condition met (Section 2)
- Vendor selected
- Partner onboarding initiated

Then re-write spec dengan vendor-specific details, pricing, contract terms.
