# Reply-as `halo@caleo.id` — Setup Runbook

**Purpose:** enable founder to reply to prospects/customers from Gmail with sender address `halo@caleo.id` (not `tonywei.office@gmail.com`), so replies feel professional and brand-consistent.

**Status:** ✅ Infrastructure ready. Gmail Send-As setup requires 5 minutes of interactive clicking in Gmail Settings (founder does this once).

**Delivery model:**
- **Inbound**: Cloudflare Email Routing catches all `*@caleo.id` → forwards to `tonywei.office@gmail.com`. Already live per Task 11.
- **Outbound**: Gmail composes reply → sends via Resend SMTP relay → recipient sees `From: halo@caleo.id` with proper DKIM signing.

---

## Infrastructure state (verified via API 2026-07-19)

**Resend:**
- Domain `caleo.id` — status: `verified` (verified since 2026-07-17)
- Region: `ap-northeast-1`
- DKIM record: `resend._domainkey.caleo.id` — status: verified
- SPF record on `send.caleo.id`: `v=spf1 include:amazonses.com ~all` — verified
- MX return-path: `send.caleo.id` → `feedback-smtp.ap-northeast-1.amazonses.com` — verified

**Cloudflare Email Routing (inbound, already live):**
- `halo@caleo.id` → tonywei.office@gmail.com
- `admin@caleo.id` → tonywei.office@gmail.com
- `hello@caleo.id`, `info@caleo.id`, `no-reply@caleo.id`, `support@caleo.id` → all forward to Gmail
- Catch-all `*@caleo.id` → tonywei.office@gmail.com

**DMARC record:** `_dmarc.caleo.id` = `v=DMARC1; p=none; rua=mailto:tonywei.office@gmail.com; ruf=mailto:tonywei.office@gmail.com`
(Soft mode — reports failures but doesn't reject. Can tighten to `p=quarantine` later.)

**Autonomous test sent 2026-07-19** — Resend queued email ID `02aa4fce-2a92-4dcd-8a54-bc63eb01316d` from `halo@caleo.id` → `tonywei.office@gmail.com`. Confirm it arrived in Gmail inbox (not spam) before proceeding to Gmail setup below.

---

## Gmail Send-As setup (interactive — founder does once)

**Time:** 5 minutes.

### Step 1: Open Gmail Settings
1. Go to https://mail.google.com/
2. Click gear icon (top right) → **See all settings**
3. Click **Accounts and Import** tab

### Step 2: Add "Send mail as" address
1. In the **Send mail as** section, click **Add another email address**
2. A popup opens. Fill in:
   - **Name**: `Caleo Team` (or `Tim Caleo` for Bahasa)
   - **Email address**: `halo@caleo.id`
   - **Treat as an alias**: ✅ **CHECK** this box (so replies to your Gmail also show up in the halo@ threads)
3. Click **Next Step**

### Step 3: Configure SMTP (Resend)
1. Popup asks for SMTP settings. Fill in:
   - **SMTP Server**: `smtp.resend.com`
   - **Port**: `587`
   - **Username**: `resend`
   - **Password**: (paste RESEND_API_KEY from `.env` — starts with `re_`)
   - **Secured connection**: **TLS** (default, keep as-is)
2. Click **Add Account**

### Step 4: Verify ownership
1. Gmail sends a verification code to `halo@caleo.id`
2. Since CF Email Routing forwards `halo@caleo.id` → your Gmail, the verification code arrives at your inbox within ~10 seconds
3. Open the verification email, copy the code
4. Paste code in the Gmail popup → **Verify**

### Step 5: Set halo@caleo.id as default sender (optional but recommended)
1. Back in **Accounts and Import** → **Send mail as**
2. Next to `halo@caleo.id`, click **make default**
3. Now every new email you compose defaults to `halo@caleo.id` (you can still choose `tonywei.office@gmail.com` per-message via the From dropdown)

### Step 6: Configure Gmail reply behavior
1. Still in **Accounts and Import** → **When replying to a message**:
   - Select: **Reply from the same address the message was sent to**
2. Save

Now when a customer emails `halo@caleo.id`, CF forwards to your Gmail, you reply, Gmail sees the original recipient was `halo@caleo.id`, auto-picks `halo@caleo.id` as From, sends via Resend SMTP.

---

## Test end-to-end (do after Step 6)

1. From a **different** email account (personal or another Gmail), send email to `halo@caleo.id`
2. Wait ~30 seconds → email should appear in your Gmail inbox
3. Reply to it from Gmail
4. Verify the sent email in your Gmail's Sent folder shows `From: Caleo Team <halo@caleo.id>` (not tonywei.office@gmail.com)
5. Verify the recipient sees `From: Caleo Team <halo@caleo.id>` in their inbox
6. Check the email doesn't land in the recipient's spam folder

---

## Deliverability best practices (already applied)

- ✅ DKIM alignment: Resend DKIM record on caleo.id root
- ✅ SPF via send.caleo.id (Return-Path aligned to sending domain)
- ✅ DMARC published (p=none reporting mode)
- ✅ DNSSEC via Cloudflare
- ✅ HTTPS on caleo.id (visible from email footer links)

**Recommended follow-ups (optional, non-blocking):**
- After 2-4 weeks of stable sending, tighten DMARC: `p=quarantine` (fails go to spam instead of reject)
- Add BIMI record (visual brand logo in Gmail inbox) — requires VMC certificate, ~$1,500/year, defer
- Add sending IP warmup pattern if volume exceeds 1000/day (not applicable at current MSME volume)

---

## Troubleshooting

**Gmail rejects the SMTP credentials during Step 3:**
- Verify Resend API key is correct (starts with `re_`, no trailing whitespace)
- Verify port 587 (not 465) — Resend supports both but Gmail Send-As default expects 587
- Verify TLS (not SSL) selected

**Verification email doesn't arrive at Gmail in Step 4:**
- Check CF Email Routing rules exist (see Task 11 setup) — run:
  ```bash
  set -a; source .env; set +a
  curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/zones/0eebe4a22b779baf8d419eabb5ec73b6/email/routing/rules" \
    | jq '.result[] | select(.matchers[].value == "halo@caleo.id") | {name, enabled}'
  ```
- Verify Email Routing is enabled: `curl ... /email/routing | jq '.result.status'` should be `ready`

**Test email lands in spam:**
- Verify DKIM signing: use https://www.mail-tester.com/ (send test to their address, get scored)
- Warm up domain: send 5-10 real emails/day for a week before expecting good deliverability

---

## Cost impact

- **Resend free tier**: 3,000 emails/month, 100/day sending. Sufficient for MSME support volume.
- If exceeded: Resend Pro is USD 20/month for 50,000 emails.
- Current projection at 10 tenants: <300 emails/month. Free tier lasts easily.

**Total added cost: Rp 0/mo.**
