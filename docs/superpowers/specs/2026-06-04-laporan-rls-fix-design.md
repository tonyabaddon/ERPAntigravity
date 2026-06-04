# Laporan RLS Fix Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Laporan (Reports) screen show real data instead of empty charts.

**Architecture:** The LaporanScreen, reportsService, and DB schema are all correct. The only gap is missing RLS policies for the `authenticated` Supabase role on the tables that `reportsService` queries. After OTP login, the Supabase JS client uses the `authenticated` role — tables with only `anon` policies silently return empty arrays. One migration fixes this.

**Tech Stack:** Supabase SQL migration (applied via MCP tool), no frontend changes.

---

## Root Cause

`reportsService` queries three tables:
- `orders` — fetchSummary, fetchDailyRevenue, fetchTopProducts
- `conversations` — fetchSummary, fetchDailyConversations
- `messages` — not queried by Laporan directly, but queried by SalesInboxScreen

The original migration (`20260531000000_core_ai_engine.sql`) created `anon` role policies only. The `admin_users` fix applied earlier proved the pattern: adding `FOR ALL TO authenticated USING (true)` unblocks authenticated reads and writes.

## Migration

Apply one migration: `add_authenticated_policies_orders_conversations`

```sql
-- Authenticated policies for orders table
CREATE POLICY "auth_all_orders"
  ON orders FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Authenticated policies for conversations table
CREATE POLICY "auth_all_conversations"
  ON conversations FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Authenticated policies for messages table
CREATE POLICY "auth_all_messages"
  ON messages FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
```

## What Does NOT Change

- `LaporanScreen.tsx` — already correct
- `reportsService` in `supabaseClient.ts` — already correct
- DB schema — `orders.total`, `orders.items`, `conversations.ai_active` all exist
- Any other frontend files
