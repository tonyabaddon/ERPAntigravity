# Vosi — Tenant Onboarding Playbook

**Date:** 2026-06-13
**Audience:** Founder (Tony) — operational guide for finding, closing, and onboarding paying tenants #2 through ~#10.
**Companion docs:** `pricing.md` (tier + commitment terms), `compliance-indonesia.md` (legal framework), `../superpowers/specs/2026-06-13-multi-tenant-prerequisites-design.md` (tech architecture).

> This playbook captures the **non-technical work** required to actually onboard tenants. Tech infrastructure (operator console, RLS, magic-link invite, invoice generator, demo tenant) is covered in the design spec. This doc is the human side: sales, support, legal admin, and the founder action list.

---

## 0. Founder action TODO (start NOW — has lead time)

These items have 2-6 week lead times. **Start immediately, don't wait for technical Phase 1 to complete.**

- [ ] **Decide Vosi legal entity structure** — sole proprietorship vs PT.
  - Sole prop: simpler, PPh Final 0.5%, but cannot issue PT-format invoice to PKP tenants.
  - PT: can issue PT invoice, sign DPA with own liability cap, register PKP when revenue >Rp 4.8B/yr.
  - **Lawyer call this week.** See `compliance-indonesia.md` §9 question 1.
- [ ] **Vosi NPWP** (tax ID) — ~1 week pengurusan via KPP. Required for any formal invoice.
- [ ] **Bank account in Vosi entity name** — ~3-5 business days. Required for receiving tenant payment.
- [ ] **SIUP / NIB** (business license) — OSS online, ~2-3 days. Required if PT.
- [ ] **Identify 3-5 LTC Glodok prospects** for tenant #2 candidates. See §3 below.
- [ ] **Draft ToS + DPA + privacy policy** (rough cuts) — see §2 below. Lawyer review later.
- [ ] **Build pitch deck / one-pager** — see §3 below.
- [ ] **Decide founding customer offer** — see §3.4 below.
- [ ] **Wife alignment conversation** — Garindo becomes tenant #1 in the same DB as paying customers. Risk profile + time commitment for first month with tenant #2. Confirm her support.
- [ ] **Personal financial runway check** — first paying tenant revenue won't cover infra cost for the first 2-3 months. Ensure 3-6 months personal living expenses in reserve.

---

## 1. Pre-launch checklist (BEFORE approaching any prospect)

Both tech AND non-tech items must be ✅ before signing tenant #2.

### 1.1 Technical readiness (from design spec)

- [ ] Layer D-min complete: staging environment + DIY backup verified + DR runbook drilled
- [ ] Layer A complete: tenant_id everywhere + RLS verified + composite FK + cross-tenant leak tests pass + load test at 50-tenant scale passes
- [ ] Garindo cutover complete: 2-week shadow-mode clean, no anomalies
- [ ] Layer C-min complete: operator console can provision a tenant, send magic link + welcome email, generate invoice
- [ ] Demo tenant provisioned via `provision_demo_tenant()` — sample data renders correctly
- [ ] **End-to-end provisioning drill** completed on a dummy tenant (see §1.3 below)

### 1.2 Non-technical readiness

- [ ] Vosi legal entity registered, NPWP issued, bank account active
- [ ] ToS + DPA + privacy policy drafted (rough OK for tenant #2-3, refined later)
- [ ] Pitch one-pager prepared
- [ ] Founding customer offer decided + documented
- [ ] Help docs minimum: login flow, basic kasir flow, "what to do if X breaks"
- [ ] Support channel decided (WA number + dedicated email)
- [ ] First-week support cadence committed (daily check-in plan)
- [ ] Phase 0 product items complete (P&L, sales-margin report, de-Garindo-ified config, onboarding CSV wizard) — per roadmap §8

### 1.3 The provisioning drill (mandatory before tenant #2)

Run this on a dummy tenant before any real prospect:

1. Operator opens console, clicks "Provision Tenant"
2. Form filled: dummy name + your-own-email + Starter package + 3-month subscription
3. Confirm magic link email arrived in your inbox within 2 min
4. Confirm welcome email arrived
5. Click magic link, set password, log in to tenant app
6. Verify sidebar shows only Starter modules (no Pengawasan, no GL, no Calista — all disabled correctly)
7. Import a small CSV (10-20 SKUs) via onboarding wizard
8. Record 1 walk-in kasir transaction with a printed invoice
9. Go back to operator console, click "Generate Invoice"
10. Verify tenant Owner email gets invoice PDF within 2 min
11. Check `system_events`, `super_admin_audit_log`, `tenant_subscription_audit` for proper entries
12. Delete the dummy tenant (operator-only flow)

**Pass criteria:** all 12 steps work without manual intervention or hidden bugs. If anything fails, fix → re-drill before any real prospect.

---

## 2. Legal documents (drafts must exist)

Templates live in `docs/business/templates/` (create when drafted).

### 2.1 ToS / Subscription Agreement

Minimum content:
- Parties: Vosi entity (controller) + Tenant (controller of own customers)
- Service description: SaaS access to Vosi modules per chosen package
- Commitment + payment terms: quarterly / yearly upfront, no refund mid-term (or specify)
- Data ownership: tenant owns their data; Vosi is processor
- Service level: best-effort, no formal SLA; downtime expectation reasonable
- Limitation of liability: capped at last 3 months subscription fee
- Termination: 30-day notice; data export within 90 days post-termination
- Indonesian law jurisdiction

### 2.2 DPA (Data Processing Agreement, UU PDP Pasal 51)

Minimum content per UU PDP — see `compliance-indonesia.md` §6.1 for full requirements.

### 2.3 Privacy policy (public page at `vosi.id/privacy`)

Covers Vosi as controller of:
- Tenant Owner contact info, billing info, login logs
- Audit log data
- Sub-processor list (Supabase, Cloud Run, Sentry, PostHog, Resend, Anthropic)

### 2.4 Invoice template

Operator console renders PDF per generation. Template includes Vosi entity NPWP, tenant NPWP, sequential invoice number, line items, tax notes. Details in `pricing.md` "Tenant invoice format" section.

---

## 3. Sales kit & prospect engagement

### 3.1 Identifying tenant #2 prospects

LTC Glodok network is a referral-rich market. Candidate sources:

1. **Garindo's existing supplier or customer network** — tokos that buy from / sell to Garindo. They already know Garindo as a reliable counterpart.
2. **LTC Glodok physical walk-around** — visit other tokos in similar segment (electrical, panel makers, switchgear). Drop pitch one-pager.
3. **Friends-of-friends** — anyone in family/social network running a toko of similar size.
4. **WhatsApp business group** — LTC trader groups (if any).

Target profile for tenant #2:
- LTC-style trader (high-SKU, walk-in + grosir + maybe online)
- Owner-operated, 3-10 staff
- Currently using Excel or Mekari Jurnal (operational pain real)
- 100-1000+ SKUs in catalog
- Willing to commit quarterly at minimum
- Geographically close (you can visit weekly for first month)

### 3.2 Discovery call template (15-20 min)

**Pertanyaan utama:**

1. "Sekarang catat penjualan pakai apa? Buku tulis, Excel, atau software?"
2. "Berapa jumlah SKU yang Anda jual?"
3. "Pain terbesar saat ini apa? (Stok berantakan? Tidak tahu untung bersih? Khawatir staf curang?)"
4. "Berapa staf kasir? Apakah ada kekhawatiran staff fraud?"
5. "Pakai WhatsApp untuk jualan? Berapa persen omset dari WA?"
6. "Punya piutang grosir ke reseller?"
7. "Apakah owner bisa pantau toko remote, atau harus selalu di toko?"
8. "Pernah coba Mekari Jurnal atau software lain? Kenapa stop?"
9. "Kira-kira budget software ERP per bulan berapa yang nyaman?"
10. "Kalau ada sistem yang menyelesaikan [pain #1, #2, #3], kapan Anda bisa coba?"

### 3.3 Demo flow (15 menit dengan Demo Tenant)

Demo tenant pre-seeded dengan ~80 SKU electrical, sample customers, sample transactions.

Skrip walkthrough:
1. **Kasir multi-channel** (3 menit) — show walk-in + grosir + WA-manual channel toggle, FIFO HPP locked at sale
2. **Stock manager** (2 menit) — multi-warehouse, opname workflow, low-stock alert
3. **Pengawasan dashboard** (2 menit) — show kasir discount aggregation, stock adjustment outliers — "ini cara Anda monitor staff tanpa harus selalu di toko"
4. **Bank rekonsiliasi dengan OCR** (2 menit) — upload PDF rekening koran, AI match ke order
5. **Laporan P&L + sales margin** (2 menit) — "berapa untung bersih bulan lalu? Produk mana yang margin terbaik?"
6. **Pricing + commit terms** (2 menit) — show one-pager, ladder Starter/Pro
7. **Closing** (2 menit) — "kapan mau coba di toko Anda?"

### 3.4 Founding customer offer (decide before first call)

Recommended terms untuk tenant #2-5 (founding customers):
- **Pricing locked-in for 24 months** dari signup date (tidak naik walaupun pricing publik berubah)
- **Setup fee discount 50%** (Rp 750k bukan Rp 1.5M) untuk first 5 founding customers
- **First month free** kalau quarterly atau yearly commit upfront — service running, billing starts month 2
- **Direct WhatsApp support to founder** (kamu sendiri) untuk first 90 days — premium attention
- **Testimonial agreement**: tenant agree to give testimonial + name use in marketing kalau happy after 3 months

### 3.5 Sales materials TODO

- [ ] Pitch one-pager (PDF) — pain → solution → pricing → founder contact
- [ ] Competitor compare matrix (vs Mekari Jurnal, Mekari Kontak, Desty) — already in roadmap §2, convert to slide
- [ ] Demo script printed for reference
- [ ] Pricing card (PDF) per tier + commit option

---

## 4. Onboarding procedure (from "yes" to first transaction)

When prospect says yes, this is the sequence.

### 4.1 Day 0 — Contract & payment

- Prospect signs subscription agreement (sign in person or scan + email)
- Prospect transfers payment to Vosi bank account (upfront, per commit term)
- You verify payment received
- You manually update `subscription_expires_at` via operator console
- Operator runs "Provision Tenant" form → magic link + welcome email auto-sent

### 4.2 Day 1 — Owner login & first config

- Owner clicks magic link, sets password, logs in
- Sit with owner (physically or video call) — first login experience matters
- Configure `company_settings`: nama toko, alamat, logo upload, bank rekening
- Walkthrough sidebar, explain modul mereka aktif

### 4.3 Day 1-3 — Catalog import

This is the biggest single onboarding task. Plan 2-4 hours.

Procedure:
1. **Get tenant's current SKU list** in whatever format they have (Excel, paper, photo of price list)
2. **Normalize to Vosi CSV template** (you do this — they don't have time/skill)
3. **Validate**: SKU codes unique, prices reasonable, categories mapped
4. **Import via onboarding wizard** in dev/staging first (sanity check)
5. **Import to prod tenant** with owner present
6. **Confirm opening stock** — quantities per warehouse (Atas/Bawah by default)
7. **Spot-check 10-20 SKUs together** — does the screen match their physical reality?

### 4.4 Day 3-5 — Training

Schedule per tenant size. Default 3 sessions × 1 hour:

**Session 1 — Kasir basics**
- Login, sidebar tour
- Walk-in kasir transaction (cash, EDC, DP)
- Grosir transaction
- Print invoice (dotmatrix 9.5" × 11")
- Pelunasan flow (DP → Lunas)

**Session 2 — Stock & Purchase**
- Stock manager: cek stok per warehouse
- Create PO → terima barang → bayar supplier
- Inter-warehouse transfer
- Read low-stock alert

**Session 3 — Pengawasan + Reports**
- Pengawasan dashboard (top discount, adjustment outliers)
- Laporan: omset, top products, P&L bulanan
- WhatsApp button approvals (kalau Calista enabled — Garindo case)

### 4.5 Day 5 — Soft go-live

- Stop training session
- Tenant runs real transactions for 1 day, you on standby via WA
- End-of-day debrief: apa yang lancar, apa yang stuck

### 4.6 Day 6-30 — First-month high-touch support

**Cadence:**
- **Daily WA check-in** (week 1): "ada masalah hari ini?"
- **Weekly WA check-in** (week 2-4): same
- **Physical visit** at end of week 1 if geographically possible

**Bug report channel:** dedicated WA number to you, response within 4 hours business day.

**Escalation:** kalau sistem down >15 min, kamu mendapat email alert otomatis (monitoring §9 + §9.5). Whatever you're doing, drop it, fix it, follow up with tenant within 30 min.

---

## 5. Billing & invoicing

### 5.1 Payment collection (manual for first ≤10 tenants)

1. Tenant submits payment via bank transfer to Vosi account
2. Tenant sends bukti transfer via WA (text or screenshot)
3. You verify (Cek mutasi BCA / Mandiri / dst)
4. Operator console: extend `subscription_expires_at` per commit period
5. `tenant_subscription_audit` row written automatically
6. Operator console: "Generate Invoice" → PDF emailed to tenant

### 5.2 Renewal reminders

System sends automatic emails:
- T-14 days: "Subscription akan expire 14 hari lagi"
- T-7 days: red banner in tenant app
- T-0: grace period mulai
- T+grace: read-only mode, "subscription expired"

Manual follow-up: kamu juga WA tenant Owner H-7 untuk percakapan renewal.

### 5.3 If tenant churns

1. Tenant decides not to renew
2. They have 90-day read-only access to view + export data
3. Bulk export available via tenant settings UI (zipped CSV per table)
4. Their data stays in Vosi DB for 10 years (UU KUP retention) before annual hard-delete cron deletes individual rows

---

## 6. Support runbook (operational, daily)

### 6.1 Channels

- **WA support** to founder (primary, first 10 tenants)
- **Email** to support@vosi.id (eventually — Phase 2)
- **In-app help docs** (minimum login + kasir basics; expand over time)

### 6.2 Bug triage flow

1. Tenant reports issue via WA
2. You acknowledge within 1 hour business day, 4 hours otherwise
3. Operator console `/operator/impersonate/<tenant_id>` for reproduction (with reason logged)
4. If urgent: hot-fix path via Layer D safety (staging → off-peak deploy)
5. Communicate fix back to tenant + ETA

### 6.3 Maintenance window communication

When you deploy migration or major change:
- Email + WA notify tenant 24 hours ahead
- Off-peak window (WIB 22:00-04:00, ideally weekend)
- In-app banner: "Maintenance in 30 min"
- Post-maintenance: "Selesai, silakan reload"

---

## 7. Risk scenarios & responses

| Scenario | Response |
|---|---|
| Tenant data corruption from bad migration | DR runbook (§4.1 in spec) → restore from DIY backup OR Supabase PITR (when paid tier). Communicate honestly. Offer credit. |
| Tenant churns week 1 unhappy | First-month money-back — refund subscription, keep setup fee. Use for learning. |
| Tenant staff abuses system (internal fraud) | Vosi not liable for tenant's internal controls. Provide audit logs to tenant for their investigation. |
| Tenant disputes invoice / refund request | Mediate per ToS terms. Document conversation. |
| Tenant late paying | Grace period auto-runs. Day 5 of grace: WA reminder. Day 7: enter read-only. |
| Tenant requests custom feature | Politely decline if not in roadmap. Note demand; if 3+ tenants ask, consider. |
| Tenant moves to competitor | Bulk export + offboard professionally. Stay friendly — they might come back. |
| Vosi system-wide outage | Email + WA all tenants immediately. Communicate ETA. Postmortem within 24h. Compliance: if breach, Kominfo notification within 72h (`disaster-recovery.md`). |

---

## 8. Tenant #2 specific countdown (when prospect identified)

**T-30 days** before targeted go-live:

- [ ] Subscription agreement signed
- [ ] Setup fee + first period payment received
- [ ] Tenant Owner email confirmed
- [ ] Catalog data collected (Excel/photo/whatever)

**T-7 days:**

- [ ] Catalog normalized to CSV
- [ ] Provisioning drill (§1.3) re-run successfully (sanity)
- [ ] Calendar blocked for Days 1-5 onboarding

**T-1 day:**

- [ ] Provision tenant in operator console
- [ ] Confirm magic link + welcome email arrived (test with your own inbox first)
- [ ] WA Owner: "Besok kita mulai onboarding, jam berapa enaknya?"

**T-0 (Day 1):**

- [ ] In-person or video call with Owner
- [ ] First login + company_settings configuration
- [ ] Kick off catalog import

(Continue per §4 timeline)

---

## 9. Founder mindset notes

A few things worth holding at the front of mind through this:

- **Tenant #2 is a relationship, not a transaction.** First impressions and the first week make the difference between "I'll renew" and "this is too much."
- **Bugs are the cost of doing business pre-tenant-10.** Acknowledge fast, fix fast, communicate honestly. Tenants forgive bugs they understand; they leave over silence.
- **Don't over-promise.** "Tidak ada SLA tertulis untuk founding customers, tapi kalau ada masalah saya akan respons cepat" beats "99.9% uptime" you can't deliver.
- **Document the work you do for tenant #2.** Each manual step here becomes a candidate for automation later when tenant #3, #5, #10 come.
- **Wife's business comes first.** If Garindo is breaking during tenant #2 onboarding, drop everything for Garindo. Tenant #2 will understand; family doesn't get a refund.

---

*Update this playbook after tenant #2 — every assumption that didn't hold is a lesson.*
