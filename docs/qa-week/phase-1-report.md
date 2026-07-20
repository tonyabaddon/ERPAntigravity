# QA Week Phase 1 Report

## F5-05 Impact Analysis (2026-07-20)

**Direct importers of GetOrCreateCustomer:**
- `backend-go/internal/whatsapp/handler.go` (3 call sites: lines 176, 431, 463)

**Indirect callers:** none (helper is package-scoped, only handler consumes)

**Tests exercised:** 0 (no test mocks reference GetOrCreateCustomer)

**DB touchpoints:** `customers` table (INSERT), reads `gjp_cust_seq` sequence (to be deprecated)

**FE ID-format assumptions:** 0 grep matches for `GJP-CUST` or prefix startsWith

**Data safety:** 0 existing customer duplicates on (tenant_id, wa_number)

**Conversation struct:** `models.Conversation` has `TenantID` field available in handler.go context (verified line 162: `conv, created, err := h.db.GetOrCreateConversation(senderPhone, h.waNumberID)`)

**Verdict:** 3 call sites, 0 tests, 1 DB touchpoint. Plan updates 3 handlers to pass tenantID from conv.TenantID. Sequence gjp_cust_seq left intact (deprecated, not dropped). FE unaffected. Data safe for composite (tenant_id, wa_number) unique constraint.

## P2-03 Impact Analysis (2026-07-20)

**audit_log FKs referencing it:** 0 direct FKs to audit_log as parent; audit_log table has FK to tenants (audit_log_tenant_id_fkey)

**pembayaran FKs referencing it:** 1 (`pembayaran_items_pembayaran_id_fkey` references pembayaran.id)

**pembayaran_items has tenant_id column:** YES (uuid, NOT NULL)

**pembayaran_items data consistency:** 0 mismatched tenant_id vs parent pembayaran (verified via JOIN on pembayaran_id with tenant_id match check)

**Verdict:** audit_log migration = simple ADD CONSTRAINT composite PK on (tenant_id, id); safe since leaf table (no child FKs). pembayaran migration MUST drop FK first, add composite PK (tenant_id, pembayaran_id), re-add FK from pembayaran_items as composite.
