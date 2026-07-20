# Task 4 Report: 2H Realtime tenant-filter on 13 subscribers

**Date:** 2026-07-20
**Status:** DONE

---

## Step 0: Schema check — tenant_id column presence

Query: `SELECT table_name, COUNT(*) FILTER (WHERE column_name = 'tenant_id') AS has_tenant_id FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (...) GROUP BY table_name`

| Table | has_tenant_id | Decision |
|---|---|---|
| `sales_channel_settings` | 1 | FILTER applied |
| `orders` | 1 | FILTER applied |
| `whatsapp_numbers` | 1 | FILTER applied |
| `conversations` | 1 | FILTER applied |
| `messages` | 1 | FILTER applied |
| `warehouses` | 1 | FILTER applied |
| `kasir_transactions` | 1 | FILTER applied |

All 7 tables confirmed to have `tenant_id` column. No alt-filter / skip branches needed.

**Note:** Brief references `sales_channels` table but actual subscriber uses `sales_channel_settings` — queried the correct table.

---

## Step 1: Subscriber enumeration + resolution

| # | File | Table | Event | Screen context | tenantId source | Decision |
|---|---|---|---|---|---|---|
| 1 | `SalesChannelsContext.tsx:82` | `sales_channel_settings` | `*` | Tenant + legacy non-tenant path | `useTenant()?.tenant_id` (null-guarded) | FILTER — guard: `if (!tenantId) return` |
| 2 | `OrderHistoryScreen.tsx:356` | `orders` | INSERT | Tenant screen | `useTenant()?.tenant_id` | FILTER |
| 3 | `OrderHistoryScreen.tsx:360` | `orders` | UPDATE | Tenant screen | `useTenant()?.tenant_id` | FILTER |
| 4 | `WhatsappAiScreen.tsx:92` | `whatsapp_numbers` | UPDATE | Tenant screen | `useTenant()?.tenant_id` | FILTER |
| 5 | `PiutangBadge.tsx:34` | `orders` | `*` | Tenant sidebar | `useTenant()?.tenant_id` | FILTER |
| 6 | `SalesInboxBadge.tsx:43` | `conversations` | `*` | Tenant sidebar | `useTenant()?.tenant_id` | FILTER |
| 7 | `useRealtimeConversations.ts:51` | `messages` | INSERT | Tenant screen | `useTenant()?.tenant_id` | FILTER |
| 8 | `useRealtimeConversations.ts:67` | `conversations` | UPDATE | Tenant screen | `useTenant()?.tenant_id` | FILTER |
| 9 | `useRealtimeConversations.ts:83` | `conversations` | INSERT | Tenant screen | `useTenant()?.tenant_id` | FILTER |
| 10 | `useRealtimeConversations.ts:95` | `orders` | INSERT | Tenant screen | `useTenant()?.tenant_id` | FILTER |
| 11 | `useRealtimeConversations.ts:104` | `orders` | UPDATE | Tenant screen | `useTenant()?.tenant_id` | FILTER |
| 12 | `useWarehouses.ts:72` | `warehouses` | `*` | Tenant screens (multiple) | `useTenant()?.tenant_id` | FILTER |
| 13 | `lib/sales/queries.ts:55` | `kasir_transactions` | `*` | Tenant screen (DaftarPesananScreen) | param added, passed from `useTenant()` | FILTER |

All 13 subscribers: FILTER applied. 0 skipped.

**Admin cross-tenant check:** Searched admin components (`/src/components/admin/`) — ZERO `postgres_changes` subscribers found there. All 13 are on tenant screens only.

---

## Files Modified

| File | Lines changed | Change |
|---|---|---|
| `src/contexts/SalesChannelsContext.tsx` | +import, +tenantId local, filter added, dep `[tenantId]` | Subscriber 1 |
| `src/components/OrderHistoryScreen.tsx` | +import, +tenantId local, guard added, 2 filters added, dep `[tenantId]` | Subscribers 2-3 |
| `src/components/WhatsappAiScreen.tsx` | +import, +tenantId local, guard added, filter added, dep `[tenantId]` | Subscriber 4 |
| `src/components/piutang/PiutangBadge.tsx` | +import, +tenantId local, guard added, filter added, dep `[tenantId]` | Subscriber 5 |
| `src/components/sales/SalesInboxBadge.tsx` | +import, +tenantId local, guard added, filter added, dep `[tenantId]` | Subscriber 6 |
| `src/hooks/useRealtimeConversations.ts` | +import, +tenantId at hook entry, guard added, 5 filters added, dep `[tenantId]` | Subscribers 7-11 |
| `src/hooks/useWarehouses.ts` | +import, +tenantId local, guard added, filter added, dep `[activeOnly, tenantId]` | Subscriber 12 |
| `src/lib/sales/queries.ts` | `subscribeOrders` signature: added `tenantId: string` param + filter | Subscriber 13 (factory) |
| `src/components/sales/DaftarPesananScreen.tsx` | +import `useTenant`, +tenantId local, guard added, pass tenantId to `subscribeOrders` | Call site for #13 |

---

## Design decisions

1. **`SalesChannelsContext` null guard:** `SalesChannelsProvider` has two mount sites in App.tsx — one inside `TenantProvider` (line 1027) and one outside (line 1183, legacy non-tenant fallback path). In the outer mount `useTenant()` returns null. Added `if (!tenantId) return` guard to skip subscription gracefully (RLS still enforces isolation on data fetch).

2. **`subscribeOrders` signature change:** This is a module-level factory (not a hook), so `useTenant()` cannot be called inside it. Chose to add `tenantId: string` as an explicit first param — callers must provide it. Caller `DaftarPesananScreen` was updated to read from `useTenant()` and pass it. Guard `if (!tenantId) return` added before the subscribe call.

3. **useEffect dep arrays extended:** All affected effects have `tenantId` added to deps, and `[tenantId]` or `[activeOnly, tenantId]` as appropriate. TenantProvider gates child render until state is non-null, so tenantId is stable at mount — but deps are explicit for correctness and to satisfy react-hooks/exhaustive-deps.

4. **JSDoc regression comment pattern:** Per Step 3 of brief, a `tenant_id filter is REQUIRED` comment block was added to each subscriber site (or as JSDoc on the factory function) explaining the billing/isolation rationale.

---

## Step 4: Smoke test

`npm run dev` at localhost:5173 requires user login — chrome-devtools MCP held by parallel session. **Smoke deferred to founder** per instructions ("if manual smoke is infeasible: RUN vitest instead + document that live-fire smoke is deferred to founder").

---

## Step 5: vitest --changed result

```
RUN  v4.1.8 /Users/tonywei/IdeaProjects/ERPAntigravity

 Test Files  5 passed (5)
       Tests  27 passed (27)
    Start at  21:25:17
    Duration  980ms
```

`npm run lint` (tsc --noEmit): CLEAN — 0 errors.

---

## Commit SHA

(see below after commit)

---

## Concerns / Open items

1. **Live-fire smoke deferred.** No test exercises the subscription filter config itself. Founder should login to app.caleo.id after deploy and verify no `[REALTIME] filter parse error` in browser console.
2. **Legacy non-tenant path** (second `SalesChannelsProvider` at App.tsx:1183) has no realtime subscription for sales_channel_settings — correct behavior since no tenant_id is available. If this path is ever deprecated, the null guard can be removed.
3. **`subscribeOrders` signature is now a breaking change** for any other caller that hasn't been updated. `grep 'subscribeOrders' src/` confirms only one call site: `DaftarPesananScreen.tsx:109`. Updated.
