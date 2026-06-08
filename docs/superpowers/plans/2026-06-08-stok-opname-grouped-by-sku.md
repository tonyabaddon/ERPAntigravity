# Stok Opname — Grouped Row by SKU Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `StockOpnameSessionView` so each SKU renders as one card with two stacked sub-rows (Atas + Bawah), instead of two separate flat rows.

**Architecture:** Pure React rendering change in one file. Group existing `filteredCounts` by SKU using a new `useMemo`, then replace the flat 12-column row map with a card-per-SKU map. Reuse existing draft/blur/busy logic verbatim — same hook ids (`${sku}-${warehouse}`), same RPC.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vite. No backend / migration / RPC change.

**Spec reference:** `docs/superpowers/specs/2026-06-08-stok-opname-grouped-by-sku-design.md` (commit `7c0f14e`).

**Testing approach:** No unit tests exist for this component in the codebase (per spec). Verification is via `npx tsc --noEmit` for type safety + manual browser testing per the spec's "Testing" section.

---

## File Structure

**Modified files (1):**
- `src/components/stok/StockOpnameSessionView.tsx` — replace flat row rendering with grouped-card rendering.

**Touched docs (1):**
- `progress.md` — add a "DONE" entry after implementation lands.

**No new files.** No backend / migration / type / client change.

---

## Task 1: Add `groupedBySku` useMemo (data only, no render change)

**Files:**
- Modify: `src/components/stok/StockOpnameSessionView.tsx` (insert after line 131)

This step is additive — adds the grouping memo but does not yet consume it in render, so behavior is unchanged. Lets us land + typecheck the data shape before touching JSX.

- [ ] **Step 1: Open the file and locate the `filteredCounts` useMemo block**

Read `src/components/stok/StockOpnameSessionView.tsx`. The block currently looks like:

```tsx
  const filteredCounts = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return counts;
    return counts.filter((c) =>
      c.sku.toLowerCase().includes(q)
      || (skuMeta[c.sku]?.name ?? '').toLowerCase().includes(q),
    );
  }, [counts, filter, skuMeta]);
```

It ends at line 131 (closing `}, [counts, filter, skuMeta]);`). The next line (133) is `const filledCount = counts.filter(...)`.

- [ ] **Step 2: Insert the `groupedBySku` useMemo immediately after `filteredCounts`**

Use the Edit tool with `old_string` being the existing `filteredCounts` block above and the blank line after it, and `new_string` being that same block PLUS the new memo below:

```tsx
  const filteredCounts = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return counts;
    return counts.filter((c) =>
      c.sku.toLowerCase().includes(q)
      || (skuMeta[c.sku]?.name ?? '').toLowerCase().includes(q),
    );
  }, [counts, filter, skuMeta]);

  const groupedBySku = useMemo(() => {
    const map = new Map<string, { atas?: OpnameCount; bawah?: OpnameCount }>();
    for (const c of filteredCounts) {
      const existing = map.get(c.sku) ?? {};
      existing[c.warehouse] = c;
      map.set(c.sku, existing);
    }
    return map;
  }, [filteredCounts]);
```

Iteration order follows first-seen order in `filteredCounts`, which preserves the RPC's natural ordering (PK ordered by sku then warehouse).

- [ ] **Step 3: Type-check the change**

Run from project root:

```bash
npm run lint
```

Expected: clean exit (no TypeScript errors). The file already imports `OpnameCount` (line 11), so no new import is needed. `useMemo` is already imported (line 1).

- [ ] **Step 4: Commit**

```bash
git add src/components/stok/StockOpnameSessionView.tsx
git commit -m "$(cat <<'EOF'
refactor(stok-opname): add groupedBySku useMemo (no render change)

Prepares for card-per-SKU layout. Pure data shape — render block
still consumes filteredCounts so behavior is unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Replace flat row render with card-per-SKU render

**Files:**
- Modify: `src/components/stok/StockOpnameSessionView.tsx` (replace lines 266-326, the `{/* Counts table */}` block)

- [ ] **Step 1: Locate the current render block**

The block to replace currently starts at line 266 with the comment `{/* Counts table */}` and ends at line 326 (closing the outer `</div>`). It contains: a wrapping `<div className="bg-white border ...">`, a 12-column grid header row, and the `filteredCounts.map(c => <row>)` body.

- [ ] **Step 2: Replace the block with card-per-SKU rendering**

Use the Edit tool. The `old_string` is the entire block from `{/* Counts table */}` through its closing `</div>`. The `new_string` is:

```tsx
      {/* Counts cards (grouped per SKU) */}
      {groupedBySku.size === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg px-3 py-6 text-sm text-slate-500 text-center">
          {counts.length === 0
            ? 'Sesi ini belum punya scope. Kembali ke daftar.'
            : 'Tidak ada SKU cocok dengan pencarian.'}
        </div>
      ) : (
        <div className="space-y-2">
          {Array.from(groupedBySku).map(([sku, group]) => {
            const bothFilled =
              group.atas?.countedQty !== null && group.atas?.countedQty !== undefined &&
              group.bawah?.countedQty !== null && group.bawah?.countedQty !== undefined;
            return (
              <div
                key={sku}
                className={`bg-white border border-slate-200 rounded-lg overflow-hidden ${
                  bothFilled ? 'border-l-4 border-l-emerald-500' : ''
                }`}
              >
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-slate-600">{sku}</span>
                  <span className="text-slate-400">·</span>
                  <span className="font-semibold text-slate-800 text-sm">
                    {skuMeta[sku]?.name ?? '—'}
                  </span>
                </div>
                {(['atas', 'bawah'] as const).map((wh) => {
                  const c = group[wh];
                  if (!c) return null;
                  const key = `${c.sku}-${c.warehouse}`;
                  const draftValue = draft[key];
                  const inputValue = draftValue !== undefined
                    ? draftValue
                    : (c.countedQty !== null && c.countedQty !== undefined ? String(c.countedQty) : '');
                  return (
                    <div
                      key={key}
                      className="grid grid-cols-12 px-3 py-2 items-center border-t border-slate-100 text-sm first:border-t-0"
                    >
                      <div className="col-span-2 text-xs uppercase tracking-wide text-slate-500">
                        {wh === 'atas' ? 'Atas' : 'Bawah'}
                      </div>
                      <div className="col-span-3 text-xs text-slate-500">
                        Sistem <span className="text-slate-800 font-medium">{c.systemQtySnapshot}</span>
                      </div>
                      <div className="col-span-3 text-right">
                        <input
                          type="number"
                          value={inputValue}
                          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                          onBlur={() => onBlurCount(c)}
                          disabled={!isEditable || busy === key}
                          className="border border-slate-300 rounded px-2 py-1 w-24 text-right text-sm disabled:bg-slate-50"
                        />
                      </div>
                      <div
                        className={`col-span-4 text-right font-semibold ${
                          c.varianceValue < 0 ? 'text-rose-600'
                          : c.varianceValue > 0 ? 'text-emerald-700'
                          : 'text-slate-400'
                        }`}
                      >
                        {c.countedQty !== null && c.countedQty !== undefined
                          ? formatRp(c.varianceValue)
                          : '—'}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
```

Key correspondences with the original:
- Empty state copy verbatim from current code (lines 277-279).
- Input element reuses identical `value`, `onChange`, `onBlur`, `disabled` logic.
- Varians color-coding logic verbatim (lines 312-321).
- `wh === 'atas' ? 'Atas' : 'Bawah'` matches current label logic (line 298).
- 12-column grid sums to 2 + 3 + 3 + 4 = 12 for sub-rows.
- `border-l-4 border-l-emerald-500` only when both warehouses have non-null `countedQty` (per spec).
- `if (!c) return null;` guards against a defensive case where a warehouse row is missing; in practice `start_opname_session` CROSS JOINs both warehouses so each group always has both, but the guard keeps TypeScript happy without `!`.

- [ ] **Step 3: Type-check the change**

```bash
npm run lint
```

Expected: clean exit. No new imports needed — `OpnameCount`, `useMemo`, `formatRp` are already in scope.

- [ ] **Step 4: Commit**

```bash
git add src/components/stok/StockOpnameSessionView.tsx
git commit -m "$(cat <<'EOF'
feat(stok-opname): render 1 card per SKU with Atas + Bawah sub-rows

Replaces flat 2-row-per-SKU table with grouped card layout. Each card
shows SKU + Nama header and two sub-rows (Atas, Bawah) with their own
Sistem/Hitung/Varians. Border-left emerald when both warehouses filled.
Auto-save on blur per warehouse unchanged. Backend untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Manual browser verification + progress.md update

**Files:**
- Modify: `progress.md` (flip the spec entry from "SPEC APPROVED" to "DONE")

- [ ] **Step 1: Start the dev server in background**

```bash
npm run dev
```

Run this in background. Vite serves on `http://localhost:3000`. Wait for the "ready" line in stdout.

- [ ] **Step 2: Reach the opname session view**

Open `http://localhost:3000` in a browser. Log in as a user with `stock_opname` permission (counter role). Navigate: Stok → Opname → "Mulai Sesi Baru" (pick `per_sku_list` with 2-3 SKUs for a small test) → click into the new session.

- [ ] **Step 3: Manual verification per spec testing checklist**

Run each scenario and visually verify:

1. **Card-per-SKU render**: each SKU appears as one card, with header (SKU + Nama) and two sub-rows labeled "Atas" / "Bawah". NOT as two separate flat rows.
2. **Auto-save Atas on blur**: type a number in "Atas" input → Tab/blur → spinner appears briefly → varians cell updates with formatted Rupiah.
3. **Border turns hijau when both filled**: also type a number in "Bawah" → blur → card's left border changes to a 4px emerald-500 stripe.
4. **Partial fill stays netral**: in a different SKU, fill only Atas → leave Bawah empty → border stays default (no emerald stripe).
5. **Filter works on cards**: type a SKU substring in the search box → only matching cards remain visible, still showing both sub-rows.
6. **Disabled state**: open a `committed` session (or sign in as a non-counter/non-witness user) → inputs are disabled, light bg.
7. **Witness + Submit flow unchanged**: as witness, click "Saya Saksi (Acknowledge)" → as counter, click "Kirim ke Owner untuk Commit" → both work.
8. **Empty state**: search for a SKU substring that matches nothing → "Tidak ada SKU cocok dengan pencarian." message.

If any scenario fails, drop back to Task 1 or Task 2, fix, and re-commit before continuing.

- [ ] **Step 4: Stop the dev server**

Kill the background process started in Step 1.

- [ ] **Step 5: Update progress.md**

Flip the existing entry. Use the Edit tool on `progress.md`.

Old string:
```markdown
## 2026-06-08 — Stok Opname: grouped row by SKU (Atas + Bawah in one card) — SPEC APPROVED

- **Goal**: Sesi opname saat ini menampilkan 1 baris tabel per `(sku, warehouse)`, jadi tiap SKU dirender sebagai 2 row terpisah (Atas + Bawah). Refactor UI: gabung jadi 1 card per SKU dengan 2 sub-row sejajar, supaya counter bisa menyelesaikan 1 SKU tanpa lompat baris.
- **Scope**: 1 file frontend (`src/components/stok/StockOpnameSessionView.tsx`). Zero backend / migration / RPC change — schema `stock_opname_counts` PK `(session_id, sku, warehouse)` dan RPC `record_opname_count` sudah per-warehouse.
- **Behavior decisions**: Auto-save per field on blur (mirror current), partial fill diperbolehkan (banyak SKU stoknya hanya di 1 gudang), border kiri card jadi hijau saat kedua warehouse terisi, tab order Atas → Bawah dalam card lalu lanjut SKU berikutnya.
- **Preserved**: Header sesi, filter SKU, witness ack, submit flow, status banner, permission gate — semua tidak berubah.
- **Spec file**: `docs/superpowers/specs/2026-06-08-stok-opname-grouped-by-sku-design.md`.
- **Next step**: User review spec → writing-plans skill → implementation.
```

New string:
```markdown
## 2026-06-08 — Stok Opname: grouped row by SKU (Atas + Bawah in one card) — DONE

- **Goal**: Sesi opname dulu render 1 baris per `(sku, warehouse)` — tiap SKU jadi 2 row terpisah. Sekarang 1 SKU = 1 card dengan 2 sub-row (Atas + Bawah) sejajar, sehingga counter dapat menyelesaikan 1 SKU tanpa lompat baris.
- **Scope**: 1 file frontend (`src/components/stok/StockOpnameSessionView.tsx`). Zero backend / migration / RPC change — schema `stock_opname_counts` PK `(session_id, sku, warehouse)` dan RPC `record_opname_count` sudah per-warehouse.
- **Behavior**: Auto-save per field on blur (mirror sebelumnya), partial fill tetap valid, border kiri card berubah `border-l-emerald-500` saat kedua warehouse terisi, tab order Atas → Bawah dalam card lalu SKU berikutnya.
- **Preserved**: Header sesi, filter SKU, witness ack, submit flow, status banner, permission gate.
- **Files**: `src/components/stok/StockOpnameSessionView.tsx`.
- **Verification**: `npm run lint` clean + manual browser test on dev server (lihat skenario di plan `docs/superpowers/plans/2026-06-08-stok-opname-grouped-by-sku.md`).
- **Spec / Plan**: `docs/superpowers/specs/2026-06-08-stok-opname-grouped-by-sku-design.md`, `docs/superpowers/plans/2026-06-08-stok-opname-grouped-by-sku.md`.
```

- [ ] **Step 6: Commit the plan + progress.md**

```bash
git add docs/superpowers/plans/2026-06-08-stok-opname-grouped-by-sku.md progress.md
git commit -m "$(cat <<'EOF'
docs: add plan for stok opname grouped-by-sku and flip progress to DONE

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage check** against `2026-06-08-stok-opname-grouped-by-sku-design.md`:
- Layout (header + 2 sub-rows, border-left when both filled) → Task 2 Step 2.
- `useMemo` `groupedBySku` building `Map<sku, {atas?, bawah?}>` → Task 1 Step 2.
- Tab order Atas → Bawah → next SKU → handled by DOM order in Task 2's card structure (inputs render top-to-bottom inside card, then next card).
- Save on blur per field → preserved by reusing existing `onBlurCount`, `draft[key]`, `busy === key` in Task 2.
- Partial fill valid (no "wajib isi keduanya") → preserved (no new validation added).
- Filter applied before grouping → guaranteed because `groupedBySku` depends on `filteredCounts` (Task 1 Step 2).
- Witness ack / Submit / status banners / permission gate / empty state → all untouched (only the inside of `{/* Counts table */}` block is replaced; everything outside it remains).
- Manual test scenarios from spec → Task 3 Step 3 lists 8 verification scenarios, one per spec bullet.

**Placeholder scan**: No "TBD", "TODO", "implement later", "similar to Task N", or undefined types. Every code step shows the actual code. All commit messages are spelled out. All file paths are absolute or relative to project root.

**Type / property consistency check**:
- `groupedBySku` typed `Map<string, { atas?: OpnameCount; bawah?: OpnameCount }>` in Task 1 — Task 2 destructures `group.atas?.countedQty` and `group.bawah?.countedQty`, both match.
- Sub-row iteration uses `(['atas', 'bawah'] as const)` so `wh` is `'atas' | 'bawah'`, matching the `OpnameCount.warehouse` union from `src/types.ts`.
- Key formula `${c.sku}-${c.warehouse}` identical to the original (line 139 / 283), so existing `draft` / `busy` state survives the refactor without migration.

No gaps found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-08-stok-opname-grouped-by-sku.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
