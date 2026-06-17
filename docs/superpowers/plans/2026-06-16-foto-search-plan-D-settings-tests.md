# Foto-Search Plan D — Settings + Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the remaining settings UI (Costing method radio, CLIP Inference Monitor panel), the `initial_stock` approval handler with WhatsApp template, finish the bulk CSV upload/download port, and round out test coverage (unit + integration + smoke).

**Architecture:** All changes hit `PengaturanScreen.tsx` (new panels) + a new approval handler module + the existing `BulkUploadSection.tsx` scaffold from Plan A. Tests go in `src/lib/__tests__/` for pure helpers and a `tests/integration/` smoke script for the end-to-end Cari by Foto pipeline.

**Tech Stack:** Same as Plan A/C — React 19 + TypeScript + Vitest 4 + Tailwind + Supabase JS. WhatsApp via existing `whatsappService` pattern (no new dependency).

**Spec reference:** `docs/superpowers/specs/2026-06-14-product-photo-search-design.md` §6.1 Costing, §6.2 Monitor, §3.3 initial_stock approval, §9 Testing. Covers spec Phases 5 + 6.

**Prerequisites:**
- Plan A merged: `approval_request_type` enum has `initial_stock`; `min_stock` column exists.
- Plan C merged: `clip_inference_log` table populated by inference traffic.
- Branch off main after Plan C merge.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `supabase/migrations/20260616000020_company_settings_costing_method.sql` | Seed `company_settings.costing_method` key with default `'FIFO'` | Create |
| `src/components/pengaturan/CostingMethodPanel.tsx` | FIFO/Average radio + Simpan button | Create |
| `src/components/pengaturan/ClipMonitorPanel.tsx` | CLIP inference stats card | Create |
| `src/lib/clipMonitorService.ts` | Query `clip_inference_log` aggregations | Create |
| `src/lib/__tests__/clipMonitorService.test.ts` | Unit tests for aggregation logic | Create |
| `src/components/PengaturanScreen.tsx` | Mount both new panels | Modify |
| `src/lib/approvalService.ts` | Add `createInitialStockRequest()` helper | Modify |
| `src/components/produk/CatalogView.tsx` | Trigger `initial_stock` approval when stock &gt; 0 on create | Modify |
| `backend-go/handlers/approvals_whatsapp.go` | Handle `initial_stock` approval → WA template | Modify (or create if absent) |
| `src/components/produk/BulkUploadSection.tsx` | Finish CSV upload/download (port from old StockManagerScreen) | Modify |
| `src/components/produk/__tests__/bulkCsv.test.ts` | Pure CSV parse/format tests | Create |
| `tests/integration/foto-search-smoke.ts` | End-to-end smoke: upload → index → search → assert top-1 | Create |

---

### Task 1: Costing method DB seed

**Files:**
- Create: `supabase/migrations/20260616000020_company_settings_costing_method.sql`

- [ ] **Step 1: Write migration**

```sql
-- 20260616000020_company_settings_costing_method.sql
INSERT INTO public.company_settings (key, value)
VALUES ('costing_method', 'FIFO')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Apply + verify + commit**

```bash
./scripts/apply-pending-migrations.sh
psql "$DATABASE_URL" -c "SELECT key, value FROM company_settings WHERE key='costing_method';"
git add supabase/migrations/20260616000020_company_settings_costing_method.sql
git commit -m "feat(db): seed company_settings.costing_method = FIFO default"
```

---

### Task 2: `CostingMethodPanel.tsx`

**Files:**
- Create: `src/components/pengaturan/CostingMethodPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/pengaturan/CostingMethodPanel.tsx
import React, { useEffect, useState } from 'react';
import { companySettingsService } from '../../lib/supabaseClient';

interface Props {
  showToast: (msg: string, kind?: 'success' | 'info' | 'warning') => void;
}

type CostingMethod = 'FIFO' | 'Average';

export default function CostingMethodPanel({ showToast }: Props) {
  const [method, setMethod] = useState<CostingMethod>('FIFO');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void companySettingsService.fetch().then(row => {
      const m = (row?.value as any)?.costing_method ?? row?.costing_method;
      if (m === 'Average' || m === 'FIFO') setMethod(m);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await companySettingsService.upsert('costing_method', method);
      showToast('Metode costing tersimpan.', 'success');
    } catch (e) {
      showToast(`Gagal simpan: ${(e as Error).message}`, 'warning');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-[#e5eeff] p-6 shadow-sm">
      <h3 className="text-base font-extrabold text-[#012749] mb-3">Metode Costing Toko</h3>
      <div className="space-y-2 mb-4">
        <label className="flex items-start gap-3 p-3 rounded-2xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
          <input type="radio" name="costing" value="FIFO" checked={method === 'FIFO'} onChange={() => setMethod('FIFO')} className="mt-0.5" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-extrabold text-[#012749]">FIFO</span>
              <span className="text-[9px] font-extrabold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase">Default</span>
            </div>
            <p className="text-[11px] text-slate-600 mt-1">First-In-First-Out. Setiap penjualan ambil HPP dari lot pembelian paling lama. Akurat tapi butuh tracking per-lot.</p>
          </div>
        </label>
        <label className="flex items-start gap-3 p-3 rounded-2xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
          <input type="radio" name="costing" value="Average" checked={method === 'Average'} onChange={() => setMethod('Average')} className="mt-0.5" />
          <div>
            <span className="text-sm font-extrabold text-[#012749]">Average</span>
            <p className="text-[11px] text-slate-600 mt-1">Rata-rata tertimbang dari semua lot. Lebih sederhana, tapi HPP "blurry" — gak mencerminkan harga lot tertentu.</p>
          </div>
        </label>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-[11px] text-amber-900">
        ⚠ Mengubah metode akan menghitung ulang HPP semua transaksi setelah tanggal perubahan. Laporan profit historis sebelum tanggal ini tidak berubah.
      </div>
      <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-[#2d8a4e] text-white rounded-full text-xs font-bold disabled:opacity-50">
        {saving ? 'Menyimpan…' : 'Simpan'}
      </button>
    </div>
  );
}
```

> **Implementer note**: if `companySettingsService.upsert` doesn't exist, add it (1-line wrapper around Supabase upsert). Match the existing pattern in `supabaseClient.ts`.

- [ ] **Step 2: Commit**

```bash
npx tsc --noEmit
git add src/components/pengaturan/CostingMethodPanel.tsx
git commit -m "feat(pengaturan): CostingMethodPanel — FIFO/Average radio"
```

---

### Task 3: `clipMonitorService.ts` + tests

**Files:**
- Create: `src/lib/clipMonitorService.ts`
- Create: `src/lib/__tests__/clipMonitorService.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/clipMonitorService.test.ts
import { describe, it, expect } from 'vitest';
import { aggregateInferenceRows } from '../clipMonitorService';

describe('aggregateInferenceRows', () => {
  it('returns zeros when no rows', () => {
    expect(aggregateInferenceRows([])).toEqual({
      search: { success: 0, error: 0, coldStart: 0 },
      index: { success: 0, error: 0, coldStart: 0 },
      latencyP50: null,
      latencyP95: null,
      lastErrorAt: null,
    });
  });

  it('counts statuses per kind', () => {
    const rows = [
      { kind: 'search', status: 'success', latency_ms: 150, error_msg: null, called_at: '2026-06-16T03:00:00Z' },
      { kind: 'search', status: 'error',   latency_ms: 200, error_msg: 'boom', called_at: '2026-06-16T03:01:00Z' },
      { kind: 'search', status: 'cold_start_timeout', latency_ms: null, error_msg: null, called_at: '2026-06-16T03:02:00Z' },
      { kind: 'index',  status: 'success', latency_ms: 130, error_msg: null, called_at: '2026-06-16T03:03:00Z' },
    ];
    const agg = aggregateInferenceRows(rows);
    expect(agg.search.success).toBe(1);
    expect(agg.search.error).toBe(1);
    expect(agg.search.coldStart).toBe(1);
    expect(agg.index.success).toBe(1);
    expect(agg.lastErrorAt).toBe('2026-06-16T03:01:00Z');
  });

  it('computes p50/p95 latency from search rows only', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      kind: 'search', status: 'success', latency_ms: i + 1, error_msg: null, called_at: '2026-06-16T03:00:00Z',
    }));
    const agg = aggregateInferenceRows(rows as any);
    expect(agg.latencyP50).toBe(50);
    expect(agg.latencyP95).toBe(95);
  });
});
```

- [ ] **Step 2: Run test (expect fail — module missing)**

```bash
npx vitest run src/lib/__tests__/clipMonitorService.test.ts
```

Expected: FAIL with `Cannot find module '../clipMonitorService'`.

- [ ] **Step 3: Write the service**

```ts
// src/lib/clipMonitorService.ts
import { supabase } from './supabaseClient';

export interface InferenceRow {
  kind: 'search' | 'index';
  status: 'success' | 'error' | 'cold_start_timeout';
  latency_ms: number | null;
  error_msg: string | null;
  called_at: string;
}

export interface InferenceAggregate {
  search: { success: number; error: number; coldStart: number };
  index:  { success: number; error: number; coldStart: number };
  latencyP50: number | null;
  latencyP95: number | null;
  lastErrorAt: string | null;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

export function aggregateInferenceRows(rows: InferenceRow[]): InferenceAggregate {
  const agg: InferenceAggregate = {
    search: { success: 0, error: 0, coldStart: 0 },
    index:  { success: 0, error: 0, coldStart: 0 },
    latencyP50: null,
    latencyP95: null,
    lastErrorAt: null,
  };
  const searchLatencies: number[] = [];
  for (const r of rows) {
    const bucket = r.kind === 'search' ? agg.search : agg.index;
    if (r.status === 'success') bucket.success++;
    else if (r.status === 'error') {
      bucket.error++;
      if (!agg.lastErrorAt || r.called_at > agg.lastErrorAt) agg.lastErrorAt = r.called_at;
    } else if (r.status === 'cold_start_timeout') bucket.coldStart++;
    if (r.kind === 'search' && r.latency_ms != null) searchLatencies.push(r.latency_ms);
  }
  const sorted = searchLatencies.sort((a, b) => a - b);
  agg.latencyP50 = percentile(sorted, 0.50);
  agg.latencyP95 = percentile(sorted, 0.95);
  return agg;
}

export async function fetchTodayInferenceRows(): Promise<InferenceRow[]> {
  // Today = Asia/Jakarta. We compute the boundary in UTC.
  const now = new Date();
  const offsetMs = 7 * 60 * 60 * 1000; // WIB = UTC+7
  const todayWIB = new Date(now.getTime() + offsetMs);
  todayWIB.setUTCHours(0, 0, 0, 0);
  const startUTC = new Date(todayWIB.getTime() - offsetMs).toISOString();
  const { data, error } = await supabase
    .from('clip_inference_log')
    .select('kind, status, latency_ms, error_msg, called_at')
    .gte('called_at', startUTC)
    .order('called_at', { ascending: false })
    .limit(10000);
  if (error) throw error;
  return (data ?? []) as InferenceRow[];
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/lib/__tests__/clipMonitorService.test.ts
```

Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clipMonitorService.ts src/lib/__tests__/clipMonitorService.test.ts
git commit -m "feat(clip-monitor): aggregation service + unit tests"
```

---

### Task 4: `ClipMonitorPanel.tsx`

**Files:**
- Create: `src/components/pengaturan/ClipMonitorPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/pengaturan/ClipMonitorPanel.tsx
import React, { useEffect, useState } from 'react';
import { fetchTodayInferenceRows, aggregateInferenceRows, type InferenceAggregate } from '../../lib/clipMonitorService';

export default function ClipMonitorPanel() {
  const [agg, setAgg] = useState<InferenceAggregate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchTodayInferenceRows();
        if (cancelled) return;
        setAgg(aggregateInferenceRows(rows));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="bg-white rounded-3xl border border-[#e5eeff] p-6 shadow-sm">Memuat data inference…</div>;
  }
  if (!agg) return null;

  return (
    <div className="bg-white rounded-3xl border border-[#e5eeff] p-6 shadow-sm">
      <h3 className="text-base font-extrabold text-[#012749] mb-3">Aktivitas CLIP Inference — Hari Ini</h3>

      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 mb-4 text-[11px] text-[#012749]">
        ℹ️ CLIP berjalan di server kita. Angka di bawah adalah jumlah inference hari ini. Tidak ada quota eksternal — kapasitas dibatasi oleh CPU instance Cloud Run.
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700">Search Kasir</p>
          <p className="text-2xl font-black text-emerald-900 mt-1">{agg.search.success + agg.search.error + agg.search.coldStart}</p>
          <div className="flex gap-3 mt-1.5 text-[10.5px]">
            <span className="text-emerald-700"><strong>{agg.search.success}</strong> success</span>
            <span className="text-rose-700"><strong>{agg.search.error}</strong> error</span>
          </div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-blue-700">Indexing Upload</p>
          <p className="text-2xl font-black text-blue-900 mt-1">{agg.index.success + agg.index.error + agg.index.coldStart}</p>
          <div className="flex gap-3 mt-1.5 text-[10.5px]">
            <span className="text-blue-700"><strong>{agg.index.success}</strong> success</span>
            <span className="text-slate-500"><strong>{agg.index.error}</strong> error</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 text-center">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Latency p50</p>
          <p className="text-lg font-black text-[#012749] mt-1">{agg.latencyP50 != null ? `${agg.latencyP50} ms` : '—'}</p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 text-center">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Latency p95</p>
          <p className="text-lg font-black text-[#012749] mt-1">{agg.latencyP95 != null ? `${agg.latencyP95} ms` : '—'}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-center">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-amber-700">Cold start hit</p>
          <p className="text-lg font-black text-amber-900 mt-1">{agg.search.coldStart + agg.index.coldStart} ×</p>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
        <p className="text-[10.5px] font-extrabold uppercase tracking-widest text-amber-700 mb-1">Sinyal kapan tindak lanjut</p>
        <ul className="text-[11px] text-amber-900 list-disc ml-5 space-y-0.5">
          <li>Latency p95 &gt; 3 detik konsisten → mungkin perlu bump CPU 1→2 vCPU di Cloud Run (cek apakah masih free tier).</li>
          <li>Cold start &gt; 5/hari → instance terlalu sering scale-to-zero. Evaluasi keep-warm.</li>
          <li>Akurasi &lt; 80% top-1 (smoke test minggu 4) → eval Hybrid (CLIP + Gemini Vision re-rank), spec terpisah.</li>
        </ul>
      </div>

      {agg.lastErrorAt && (
        <p className="text-[10.5px] text-slate-500 italic mt-3">Last error: {new Date(agg.lastErrorAt).toLocaleString('id-ID')}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
npx tsc --noEmit
git add src/components/pengaturan/ClipMonitorPanel.tsx
git commit -m "feat(pengaturan): ClipMonitorPanel — honest CLIP inference stats"
```

---

### Task 5: Mount panels in `PengaturanScreen.tsx`

**Files:**
- Modify: `src/components/PengaturanScreen.tsx`

- [ ] **Step 1: Add imports + JSX**

Near the top imports:

```tsx
import CostingMethodPanel from './pengaturan/CostingMethodPanel';
import ClipMonitorPanel from './pengaturan/ClipMonitorPanel';
```

Inside the screen's return tree, in a section near other settings cards:

```tsx
<section className="space-y-4">
  <CostingMethodPanel showToast={showToast} />
  <ClipMonitorPanel />
</section>
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/PengaturanScreen.tsx
git commit -m "feat(pengaturan): mount CostingMethod + ClipMonitor panels"
```

---

### Task 6: `initial_stock` approval — service helper

**Files:**
- Modify: `src/lib/approvalService.ts` (or create if absent)

- [ ] **Step 1: Add helper**

```ts
// Append inside approvalService (or create new module).
export async function createInitialStockRequest(input: {
  sku: string;
  name: string;
  initialStock: number;
  warehouseId: string;
  requestedBy: string;
}): Promise<void> {
  const { error } = await supabase.from('approval_requests').insert({
    request_type: 'initial_stock',
    payload: {
      sku: input.sku,
      name: input.name,
      initial_stock: input.initialStock,
      warehouse_id: input.warehouseId,
    },
    requested_by: input.requestedBy,
    status: 'pending',
  });
  if (error) throw error;
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/lib/approvalService.ts
git commit -m "feat(approval): createInitialStockRequest helper"
```

---

### Task 7: Wire `initial_stock` approval into `CatalogView.handleSave`

**Files:**
- Modify: `src/components/produk/CatalogView.tsx`

- [ ] **Step 1: Trigger approval when `stock > 0` on new product**

After successful `upsertStockFull` (Plan A Task 15) and before `void indexPhotos(...)`:

```tsx
  if (!editing && (payload.stock ?? 0) > 0 && currentUser) {
    try {
      // Pick the default warehouse for initial stock.
      const defaultWh = warehouses.find(w => w.is_default) ?? warehouses[0];
      if (defaultWh) {
        await createInitialStockRequest({
          sku: payload.sku ?? '',
          name: payload.name ?? '',
          initialStock: payload.stock ?? 0,
          warehouseId: defaultWh.id,
          requestedBy: currentUser.id,
        });
        showToast('Stok awal di-submit untuk approval owner.', 'info');
      }
    } catch (e) {
      showToast(`Approval gagal di-submit: ${(e as Error).message}`, 'warning');
    }
  }
```

Add import:

```tsx
import { createInitialStockRequest } from '../../lib/approvalService';
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/produk/CatalogView.tsx
git commit -m "feat(produk): trigger initial_stock approval on Tambah Barang with stock>0"
```

---

### Task 8: Backend WhatsApp template for `initial_stock`

**Files:**
- Modify: `backend-go/handlers/approvals_whatsapp.go` (or wherever approval-triggered WA notifications live)

- [ ] **Step 1: Find existing approval WA handler**

```bash
grep -rn "request_type" backend-go/handlers/ | head -10
```

- [ ] **Step 2: Add case for `initial_stock`**

In the switch over `request_type`:

```go
case "initial_stock":
    sku := payload["sku"].(string)
    name := payload["name"].(string)
    qty := int(payload["initial_stock"].(float64))
    message = fmt.Sprintf(
        "🔔 *Approval Stok Awal*\n\nProduk: %s\nSKU: `%s`\nStok awal: *%d*\n\nApprove di app ERP.",
        name, sku, qty,
    )
```

- [ ] **Step 3: Commit**

```bash
cd backend-go &amp;&amp; go build ./...
git add backend-go/handlers/approvals_whatsapp.go
git commit -m "feat(approval): WhatsApp template for initial_stock approval"
```

---

### Task 9: Finish bulk CSV port

**Files:**
- Modify: `src/components/produk/BulkUploadSection.tsx`
- Create: `src/lib/bulkCsv.ts`

The original `StockManagerScreen.tsx` had CSV export/import logic — port the pure functions out into a tested module, then wire to the existing scaffold.

- [ ] **Step 1: Read old logic from git history**

```bash
git log --all --oneline -- src/components/StockManagerScreen.tsx | head
git show <commit-before-Plan-A-merge>:src/components/StockManagerScreen.tsx | sed -n '350,450p'
```

Extract `CSV_HEADER`, `CSV_SPEC_COLS`, the parse/format code paths.

- [ ] **Step 2: Write pure helper module**

```ts
// src/lib/bulkCsv.ts
import type { StockItem } from '../types';

export const CSV_SPEC_COLS = [
  'material', 'tipe_pasang', 'tinggi_cm', 'lebar_cm', 'tebal_cm',
  'ketebalan_mm', 'finishing', 'kelengkapan',
  'mcb_merek', 'mcb_ampere', 'mcb_phase',
  'kabel_tipe', 'kabel_mm2', 'kabel_panjang',
  'deskripsi',
] as const;

export const CSV_HEADER = ['sku', 'nama', 'kategori', 'harga', 'harga_modal', 'stok', ...CSV_SPEC_COLS].join(',');

export function stockItemsToCsv(items: StockItem[]): string {
  const rows = [CSV_HEADER];
  for (const it of items) {
    const specs = it.specs ?? {};
    const cells = [
      it.sku, escape(it.name), it.category, String(it.price), String(it.harga_modal ?? ''), String(it.stock),
      ...CSV_SPEC_COLS.map(c => escape(String(specs[c] ?? ''))),
    ];
    rows.push(cells.join(','));
  }
  return rows.join('\n');
}

function escape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export interface CsvParseResult {
  rows: Array<{
    sku: string; name: string; category: string;
    price: number; harga_modal: number | null; stock: number;
    specs: Record<string, string>;
  }>;
  errors: Array<{ line: number; message: string }>;
}

export function parseCsv(text: string): CsvParseResult {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return { rows: [], errors: [{ line: 0, message: 'Empty CSV' }] };
  const header = lines[0].split(',');
  const rows: CsvParseResult['rows'] = [];
  const errors: CsvParseResult['errors'] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]);
    if (cells.length < 6) {
      errors.push({ line: i + 1, message: `Expected ≥6 columns, got ${cells.length}` });
      continue;
    }
    const [sku, name, category, priceS, modalS, stockS, ...specCells] = cells;
    const specs: Record<string, string> = {};
    for (let j = 0; j < CSV_SPEC_COLS.length; j++) {
      const v = specCells[j];
      if (v) specs[CSV_SPEC_COLS[j]] = v;
    }
    rows.push({
      sku, name, category,
      price: parseInt(priceS) || 0,
      harga_modal: modalS ? (parseInt(modalS) || null) : null,
      stock: parseInt(stockS) || 0,
      specs,
    });
  }
  return { rows, errors };
}

function parseLine(line: string): string[] {
  const out: string[] = [];
  let i = 0, cur = '', inQ = false;
  while (i < line.length) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 2; continue; }
      if (ch === '"') { inQ = false; i++; continue; }
      cur += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ',') { out.push(cur); cur = ''; i++; continue; }
    cur += ch; i++;
  }
  out.push(cur);
  return out;
}
```

- [ ] **Step 3: Write unit tests**

```ts
// src/components/produk/__tests__/bulkCsv.test.ts
import { describe, it, expect } from 'vitest';
import { stockItemsToCsv, parseCsv, CSV_HEADER } from '../../../lib/bulkCsv';

describe('bulkCsv', () => {
  it('format header is stable', () => {
    expect(CSV_HEADER).toContain('sku,nama,kategori,harga,harga_modal,stok');
  });

  it('round-trips a simple row', () => {
    const item = {
      sku: 'AAA', name: 'MCB 6A', category: 'MCB',
      price: 50000, harga_modal: 30000, stock: 10, status: 'Sinkron' as const,
      specs: { mcb_merek: 'Schneider', mcb_ampere: '6', mcb_phase: '1P' },
    };
    const csv = stockItemsToCsv([item as any]);
    const parsed = parseCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0].sku).toBe('AAA');
    expect(parsed.rows[0].specs.mcb_ampere).toBe('6');
  });

  it('escapes commas in name', () => {
    const csv = stockItemsToCsv([
      { sku: 'X', name: 'Panel, big', category: 'Panel', price: 0, harga_modal: null, stock: 0, status: 'Sinkron', specs: {} } as any,
    ]);
    expect(csv).toContain('"Panel, big"');
    const parsed = parseCsv(csv);
    expect(parsed.rows[0].name).toBe('Panel, big');
  });

  it('reports errors for malformed rows', () => {
    const csv = `${CSV_HEADER}\nincomplete,row`;
    const parsed = parseCsv(csv);
    expect(parsed.errors.length).toBe(1);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/components/produk/__tests__/bulkCsv.test.ts
```

Expected: 4 PASS.

- [ ] **Step 5: Wire to `BulkUploadSection.tsx`**

Replace the scaffold:

```tsx
// src/components/produk/BulkUploadSection.tsx
import React, { useState } from 'react';
import type { StockItem } from '../../types';
import { stockItemsToCsv, parseCsv } from '../../lib/bulkCsv';
import { stockService } from '../../lib/supabaseClient';

interface Props {
  stockList: StockItem[];
  showToast: (msg: string, kind?: 'success' | 'info' | 'warning') => void;
  onReload: () => Promise<void>;
}

export default function BulkUploadSection({ stockList, showToast, onReload }: Props) {
  const [busy, setBusy] = useState(false);
  const [errorReport, setErrorReport] = useState<string[]>([]);

  const handleDownload = () => {
    const csv = stockItemsToCsv(stockList);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `katalog-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUpload = async (file: File) => {
    setBusy(true);
    setErrorReport([]);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.errors.length) {
        setErrorReport(parsed.errors.map(e => `Line ${e.line}: ${e.message}`));
        showToast(`${parsed.errors.length} baris error, ${parsed.rows.length} sukses parse`, 'warning');
      }
      for (const row of parsed.rows) {
        await stockService.upsertStockFull({
          sku: row.sku, name: row.name,
          sub_category_id: null, brand_id: null, unit_id: null,
          price: row.price, harga_modal: row.harga_modal,
          stock: row.stock, min_stock: 0,
          description: null, photo_urls: [],
        });
      }
      showToast(`✅ Import selesai: ${parsed.rows.length} baris.`, 'success');
      await onReload();
    } catch (e) {
      showToast(`Import gagal: ${(e as Error).message}`, 'warning');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-[#e5eeff] p-6 shadow-sm">
      <h3 className="text-base font-extrabold text-[#012749] mb-3">Bulk Upload CSV</h3>
      <div className="flex gap-3">
        <button onClick={handleDownload} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-full text-xs font-bold">
          Download template ({stockList.length} produk)
        </button>
        <label className={`px-4 py-2 bg-[#012749] text-white rounded-full text-xs font-bold cursor-pointer ${busy ? 'opacity-50' : ''}`}>
          {busy ? 'Mengimport…' : 'Upload CSV'}
          <input type="file" accept=".csv,text/csv" className="hidden" disabled={busy}
                 onChange={e => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }} />
        </label>
      </div>
      {errorReport.length > 0 && (
        <div className="mt-3 bg-rose-50 border border-rose-200 rounded-2xl p-3">
          <p className="text-[11px] font-extrabold text-rose-900 mb-1">Error report:</p>
          <ul className="text-[11px] text-rose-900 list-disc ml-5 space-y-0.5 max-h-32 overflow-y-auto">
            {errorReport.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Update CatalogView to pass props**

In `CatalogView.tsx`:

```tsx
{tab === 'bulk-upload' && (
  <BulkUploadSection
    stockList={stockList}
    showToast={showToast}
    onReload={async () => { const fresh = await stockService.list(); onStockUpdate(fresh); }}
  />
)}
```

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit
npx vitest run src/components/produk/__tests__/bulkCsv.test.ts
git add src/lib/bulkCsv.ts src/components/produk/__tests__/bulkCsv.test.ts src/components/produk/BulkUploadSection.tsx src/components/produk/CatalogView.tsx
git commit -m "feat(produk): full CSV bulk upload/download with unit tests"
```

---

### Task 10: End-to-end smoke script for Cari by Foto

**Files:**
- Create: `tests/integration/foto-search-smoke.ts`

- [ ] **Step 1: Write the script**

```ts
// tests/integration/foto-search-smoke.ts
// Run with: npx tsx tests/integration/foto-search-smoke.ts
// Requires backend running locally + VITE_BACKEND_URL set.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const BACKEND = process.env.VITE_BACKEND_URL ?? 'http://localhost:8080';
const SAMPLE_PHOTO = path.resolve('tests/integration/fixtures/sample-mcb.jpg');

async function main() {
  console.log('1. Loading sample photo…');
  const photo = await readFile(SAMPLE_PHOTO);
  const blob = new Blob([photo], { type: 'image/jpeg' });

  console.log('2. Posting to /api/products/search-by-photo…');
  const fd = new FormData();
  fd.append('photo', blob, 'sample.jpg');
  const t0 = Date.now();
  const resp = await fetch(`${BACKEND}/api/products/search-by-photo`, { method: 'POST', body: fd });
  const dt = Date.now() - t0;
  if (!resp.ok) {
    console.error(`FAIL: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  const body = await resp.json();
  console.log(`3. ${body.results?.length ?? 0} results in ${dt}ms`);
  if (!body.results || body.results.length === 0) {
    console.error('FAIL: empty results');
    process.exit(2);
  }
  for (const r of body.results) {
    console.log(`   - ${r.sku} | ${r.name} | similarity=${(r.similarity * 100).toFixed(1)}%`);
  }
  if (body.results[0].similarity < 0.70) {
    console.error(`FAIL: top similarity ${body.results[0].similarity} below 0.70 threshold`);
    process.exit(3);
  }
  console.log('✅ smoke pass');
}

main().catch(err => { console.error(err); process.exit(99); });
```

- [ ] **Step 2: Add `tests/integration/fixtures/sample-mcb.jpg`** — a real MCB photo for benchmarking.

```bash
mkdir -p tests/integration/fixtures
# Put a real MCB Schneider Easy9 6A photo at this path. Manual step.
ls tests/integration/fixtures/sample-mcb.jpg
```

- [ ] **Step 3: Run the script (after backend running + Plan C deployed)**

```bash
cd backend-go &amp;&amp; go run main.go &amp;
sleep 5
npx tsx tests/integration/foto-search-smoke.ts
```

Expected: prints top 5 results with similarity, exits 0 if top-1 ≥ 70%.

- [ ] **Step 4: Commit (without the JPG fixture if not yet sourced)**

```bash
git add tests/integration/foto-search-smoke.ts
git commit -m "test(integration): foto-search smoke script for top-1 ≥ 70% assertion"
```

---

### Task 11: Final smoke + update progress.md

**Files:**
- Modify: `progress.md`

- [ ] **Step 1: Run all unit tests**

```bash
npx vitest run
```

Expected: all green.

- [ ] **Step 2: Manual end-to-end smoke**

Open `http://localhost:5173/`. Walk:

1. `?screen=settings` → Pengaturan shows CostingMethod radio + ClipMonitor panel with today's counts.
2. Change costing FIFO → Average → Simpan → toast confirms.
3. `?screen=ai-stock` → Bulk Upload tab → Download template → CSV file downloads with 487 rows.
4. Modify a row in CSV, upload → row updates, toast confirms, error report empty.
5. `?screen=ai-stock` → Tambah Barang dengan Stok Awal = 50 → toast "Stok awal di-submit untuk approval owner."
6. Open owner WA → approval message muncul dengan SKU/nama/qty.
7. `?screen=kasir` → Cari by Foto → drag-drop MCB Schneider photo → results muncul → top-1 ≥ 70%.

- [ ] **Step 3: Append progress.md**

```markdown

---

## 2026-06-16 — Plan D Settings + Tests SHIPPED — foto-search FULL READY

- Costing method radio (FIFO/Average) shipped in PengaturanScreen.
- ClipMonitorPanel with today's inference stats (success/error/cold-start + p50/p95 latency).
- `initial_stock` approval triggers auto on Tambah Barang with stock > 0; WhatsApp template added.
- Bulk CSV download/upload finished port from old StockManagerScreen, with 4 unit tests.
- End-to-end smoke script `tests/integration/foto-search-smoke.ts` asserts top-1 ≥ 70%.
- All 4 plans (A foundation + B view modes + C CLIP + D settings/tests) merged.
- Full smoke pass: catalog → form → photo upload → CLIP indexing → kasir Cari by Foto → top-5 results.
```

- [ ] **Step 4: Commit**

```bash
git add progress.md
git commit -m "docs(progress): Plan D Settings + Tests shipped — foto-search complete"
```

---

## Out of scope (truly out — not deferred)

- Migrating `stock_atas`/`stock_bawah` columns to fully configurable per-warehouse stock table (Phase 3 cutover, separate spec).
- HPP recompute job triggered by costing method change (separate spec — flag TODO in spec §10).
- Cleanup orphaned photos cron (spec §10 TODO).
- Hybrid CLIP + Gemini Vision re-rank — only if smoke shows accuracy gap (spec §5.5, separate spec).
- ViT-Large / ViT-Base-16 upgrade — only if ViT-Base-32 insufficient (spec §10).
