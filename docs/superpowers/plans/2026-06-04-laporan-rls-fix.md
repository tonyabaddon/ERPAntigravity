# Laporan RLS Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Laporan screen show real data by adding authenticated RLS policies on `orders`, `conversations`, and `messages` tables.

**Architecture:** Apply one Supabase SQL migration via the MCP tool. No frontend changes needed — the screen and service are already correct.

**Tech Stack:** Supabase MCP tool (`apply_migration`), project ID `zocefskkwykivbxhruoy`.

---

## File Map

| File | Action | What changes |
|---|---|---|
| Supabase DB | Migration | Add `authenticated` RLS policies on `orders`, `conversations`, `messages` |
| `progress.md` | Modify | Record completion |

---

## Task 1: Apply authenticated RLS policies migration

**Files:**
- Supabase project: `zocefskkwykivbxhruoy`

- [ ] **Step 1: Apply the migration via Supabase MCP tool**

Use `mcp__plugin_supabase_supabase__apply_migration` with:
- `project_id`: `zocefskkwykivbxhruoy`
- `name`: `add_authenticated_policies_orders_conversations_messages`
- `query`:
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

Expected: migration applied successfully, no errors.

- [ ] **Step 2: Verify policies exist**

Run a quick SQL check via `mcp__plugin_supabase_supabase__execute_sql`:
```sql
SELECT tablename, policyname, roles
FROM pg_policies
WHERE tablename IN ('orders', 'conversations', 'messages')
  AND roles::text LIKE '%authenticated%'
ORDER BY tablename;
```

Expected: 3 rows — one per table — each showing `{authenticated}` in the roles column.

- [ ] **Step 3: Update progress.md**

Append entry to `progress.md`:
```
## Laporan RLS Fix — DONE (2026-06-04)
Added authenticated RLS policies on orders, conversations, messages tables so
reportsService queries work after OTP login. LaporanScreen now shows real data.
```

- [ ] **Step 4: Commit**

```bash
git add progress.md
git commit -m "fix(db): add authenticated RLS policies for orders, conversations, messages"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Authenticated policy on `orders` — Step 1
- ✅ Authenticated policy on `conversations` — Step 1
- ✅ Authenticated policy on `messages` — Step 1
- ✅ Verification — Step 2

**2. Placeholder scan:** None. ✅

**3. Type consistency:** SQL only, no types. ✅
