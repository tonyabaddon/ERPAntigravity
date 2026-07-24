# Customer Pricing Tier — Add-Form Fix (Phase 1a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the silent-eceran gap so wholesale customers can be created with the correct `default_pricing_tier` from the start (add form + edit form parity), gated by the existing `modul_multi_tier_price` flag.

**Architecture:** Frontend-only change — no migration, no RPC, no CHECK-constraint change. Add a `showTierField?: boolean` prop to `NewCustomerInlineForm`; when true, render segmented pills (Eceran / Grosir) styled to match the existing tier-filter chips on `PelangganScreen`. Extend `insertNewCustomer` to accept an optional `default_pricing_tier`. Propagate the flag through the two render sites (Pelanggan modal + wizard Step 1). Replace the existing edit-form `<select>` with the same pills for add/edit parity. Ship a read-only audit SQL for existing misclassified customers.

**Tech Stack:** React 19, TypeScript, Vitest + @testing-library/react, Tailwind (existing tokens only — no new colors), Supabase JS client (existing direct-insert path, no RPC).

**Spec:** [`docs/superpowers/specs/2026-07-24-customer-pricing-tier-add-form-fix-design.md`](../specs/2026-07-24-customer-pricing-tier-add-form-fix-design.md) (commit `bcf3ca1`)

## Global Constraints

- **No new design tokens.** Reuse the tier-filter chip palette already at `PelangganScreen.tsx:242-244`: eceran active = `bg-[#012749] text-white`; grosir active = `bg-purple-600 text-white`; inactive = `bg-gray-100 text-gray-500 hover:bg-gray-200`. Font sizes ≥ 11px per memory `font_sizing`.
- **No auto-heuristic tier default.** Always default `'eceran'`; user picks grosir explicitly (memory `no_fake_numbers`, `push_back_dont_follow`).
- **Bahasa Indonesia for all user-visible labels.** Label = `Harga:`; options = `Eceran` / `Grosir`. No emojis in labels.
- **Gating flag:** `isFieldVisible('tier_dropdown_customer', tenantSettings)` — maps to `settings.modul_multi_tier_price` (`src/lib/pengaturan/cascadeMap.ts:42`).
- **Backend Go WA-onboard path (`backend-go/internal/db/customers.go:22`) stays untouched.** DB default `'eceran'` fires; tenant edits later if needed.
- **CHECK constraint stays `IN ('eceran','grosir')`.** No schema change in Phase 1a.
- **Stage 1 hooks (blocking commit):** `npm run lint`, `npm run audit:numinput`, `npm run audit:secdef-null-tenant`, `npm run audit:csp-backend-allowlist`, `npx vitest run --changed`. All green before commit.
- **Stage 3 smoke tenant:** `Toko Jaya Makmur` only (memory `production-testing-tenant`); NEVER a real customer tenant.
- **Commit style:** Conventional-Commits scoped prefixes (`feat(pelanggan):`, `test(pelanggan):`, `chore(scripts):`) with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/customers/customerWrappers.ts` | Extend `insertNewCustomer` args + row to include optional `default_pricing_tier`. |
| `src/components/penjualan/wizard/NewCustomerInlineForm.tsx` | Add `showTierField` prop, tier state, pill UI, pass tier through insert. |
| `src/components/penjualan/wizard/Step1ChannelCustomer.tsx` | Accept `showTierField` prop, pass it to `NewCustomerInlineForm`. |
| `src/components/penjualan/CatatPenjualanWizard.tsx` | Compute `showTierField` (reuse existing `showTierPill`) and pass to `Step1ChannelCustomer`. |
| `src/components/PelangganScreen.tsx` | Pass `showTierField` to modal-embedded form; replace edit-mode `<select>` with pill UI (parity). |
| `src/components/PelangganScreen.test.tsx` | Add integration tests: pill visibility (flag on/off), pill selection persists via `insertNewCustomer`, edit-mode pill parity. |
| `scripts/audit-misclassified-customer-tier.sql` | Read-only audit SELECT — surfaces likely-misclassified customers per tenant. |
| `progress.md` | Log the fix (WHAT + WHY, link to spec + commit). |

---

## Task 1: `insertNewCustomer` accepts `default_pricing_tier`

**Files:**
- Modify: `src/lib/customers/customerWrappers.ts:9-31`
- Test: `src/components/PelangganScreen.test.tsx` (extend existing suite)

**Interfaces:**
- Consumes: existing `supabase.from('customers').insert(row)` path — unchanged.
- Produces:
  ```ts
  export async function insertNewCustomer(args: {
    name: string;
    wa_number: string;
    company?: string;
    address?: string;
    default_pricing_tier?: 'eceran' | 'grosir';
  }): Promise<DbCustomer>
  ```
  When `default_pricing_tier` is present, it appears in the insert row. When absent, the field is omitted from the row and the DB default `'eceran'` fires (existing behaviour, zero regression for callers that don't pass it).

- [ ] **Step 1: Write the failing test**

Add to `src/components/PelangganScreen.test.tsx` at the end of the file (before the last `});` at line 274), inside a new `describe` block:

```tsx
// ── F5-XX: Tier pills on add form ──────────────────────────────────────────────

describe('PelangganScreen — tier pills on Tambah Pelanggan (modul ON)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (supabaseClientModule.customersService.fetchAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (pengaturanServicesModule.tenantSettingsService.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...BASE_SETTINGS,
      modul_multi_tier_price: true,
    });
  });

  it('passes default_pricing_tier=grosir to insertNewCustomer when Grosir pill selected', async () => {
    const { insertNewCustomer } = await import('../lib/customers/customerWrappers');
    const mockInsert = insertNewCustomer as ReturnType<typeof vi.fn>;
    mockInsert.mockResolvedValue({
      id: 'new-1', name: 'Toko Berkah', wa_number: '628111222333',
      company: '', address: null, created_at: '2026-01-01T00:00:00Z',
      default_pricing_tier: 'grosir',
    });

    render(<PelangganScreen {...BASE_PROPS} />);
    await waitFor(() => expect(supabaseClientModule.customersService.fetchAll).toHaveBeenCalled());

    // Open Tambah modal
    fireEvent.click(screen.getByRole('button', { name: /tambah pelanggan/i }));

    // Fill required fields (Nama + WA)
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'Toko Berkah' } });
    fireEvent.change(inputs[1], { target: { value: '628111222333' } });

    // Click the Grosir tier pill inside the modal
    // Pills are role=button with accessible names Eceran / Grosir; the form
    // wraps them under a "Tipe Harga default" label so we target within the
    // modal region only.
    const grosirPill = screen.getByRole('button', { name: /^Grosir$/i });
    fireEvent.click(grosirPill);

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Toko Berkah',
        wa_number: '628111222333',
        default_pricing_tier: 'grosir',
      }));
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/PelangganScreen.test.tsx -t "passes default_pricing_tier=grosir"`

Expected: FAIL — either (a) the Grosir pill button doesn't exist yet (`Unable to find role="button" name /^Grosir$/i`), or (b) `insertNewCustomer` is called without the `default_pricing_tier` field.

- [ ] **Step 3: Add the `default_pricing_tier` arg + row field**

Edit `src/lib/customers/customerWrappers.ts` — replace the `insertNewCustomer` function body (lines 9-31):

```ts
export async function insertNewCustomer(args: {
  name: string;
  wa_number: string;
  company?: string;
  address?: string;
  default_pricing_tier?: 'eceran' | 'grosir';
}): Promise<DbCustomer> {
  if (!supabase) throw new Error('Supabase not configured');
  // customers.id is TEXT NOT NULL with no default; matches existing
  // customersService.createCustomer pattern (crypto.randomUUID).
  // customers.company is NOT NULL with default '' — passing null violates
  // the constraint, so coerce to ''.
  // default_pricing_tier is only included when caller supplies it; when
  // omitted the DB default 'eceran' fires (CHECK IN 'eceran'|'grosir').
  const row: Record<string, unknown> = {
    id: crypto.randomUUID(),
    name: args.name,
    wa_number: args.wa_number,
    company: args.company ?? '',
    address: args.address ?? null,
    allows_tempo: false,
  };
  if (args.default_pricing_tier !== undefined) {
    row.default_pricing_tier = args.default_pricing_tier;
  }
  const { data, error } = await supabase.from('customers').insert(row).select().single();
  if (error) throw error;
  return data as DbCustomer;
}
```

- [ ] **Step 4: Confirm the arg change alone doesn't yet pass**

Run: `npx vitest run src/components/PelangganScreen.test.tsx -t "passes default_pricing_tier=grosir"`

Expected: still FAIL — the pill UI doesn't exist yet on `NewCustomerInlineForm`, so the click on `/^Grosir$/i` still fails to find a button. Task 2 fixes that.

- [ ] **Step 5: Commit the wrapper change**

```bash
git add src/lib/customers/customerWrappers.ts
git commit -m "$(cat <<'EOF'
feat(pelanggan): insertNewCustomer accepts default_pricing_tier

Optional arg; when omitted, DB default 'eceran' fires (unchanged
behaviour). Enables NewCustomerInlineForm to persist tier when
modul_multi_tier_price is on. Spec: bcf3ca1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Tier pills in `NewCustomerInlineForm`

**Files:**
- Modify: `src/components/penjualan/wizard/NewCustomerInlineForm.tsx` (whole file)
- Test: `src/components/PelangganScreen.test.tsx` (test from Task 1 becomes green here)

**Interfaces:**
- Consumes: `insertNewCustomer` (extended in Task 1).
- Produces:
  ```ts
  interface Props {
    onSaved: (customer: DbCustomer) => void;
    onCancel: () => void;
    showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
    showTierField?: boolean; // default false — when true, render Eceran/Grosir pills
  }
  ```
  The pill row is rendered ONLY when `showTierField === true`. Internal state `tier` defaults to `'eceran'` and is passed as `default_pricing_tier` to `insertNewCustomer` only when the field is visible. When hidden, the arg is omitted, DB default fires.

- [ ] **Step 1: Write the failing render test (companion to Task 1's submit test)**

Append after the test from Task 1's Step 1, inside the same `describe('PelangganScreen — tier pills on Tambah Pelanggan (modul ON)')` block:

```tsx
it('modul ON → renders Eceran + Grosir pills with Eceran preselected', async () => {
  render(<PelangganScreen {...BASE_PROPS} />);
  await waitFor(() => expect(supabaseClientModule.customersService.fetchAll).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /tambah pelanggan/i }));

  const eceranPill = await screen.findByRole('button', { name: /^Eceran$/i });
  const grosirPill = screen.getByRole('button', { name: /^Grosir$/i });
  expect(eceranPill).toBeInTheDocument();
  expect(grosirPill).toBeInTheDocument();
  // Eceran preselected — aria-pressed="true" on active pill
  expect(eceranPill).toHaveAttribute('aria-pressed', 'true');
  expect(grosirPill).toHaveAttribute('aria-pressed', 'false');
});
```

Also add a companion `describe` block for modul-OFF to guard the regression:

```tsx
describe('PelangganScreen — tier pills on Tambah Pelanggan (modul OFF)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (supabaseClientModule.customersService.fetchAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (pengaturanServicesModule.tenantSettingsService.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...BASE_SETTINGS,
      modul_multi_tier_price: false,
    });
  });

  it('modul OFF → tier pills NOT rendered inside Tambah modal', async () => {
    render(<PelangganScreen {...BASE_PROPS} />);
    await waitFor(() => expect(supabaseClientModule.customersService.fetchAll).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /tambah pelanggan/i }));

    // Modal open, but no Eceran/Grosir pills visible
    expect(screen.getByText('Customer Baru')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Eceran$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Grosir$/i })).not.toBeInTheDocument();
  });

  it('modul OFF → insertNewCustomer called WITHOUT default_pricing_tier', async () => {
    const { insertNewCustomer } = await import('../lib/customers/customerWrappers');
    const mockInsert = insertNewCustomer as ReturnType<typeof vi.fn>;
    mockInsert.mockResolvedValue({
      id: 'new-1', name: 'Ibu Sri', wa_number: '628222333444',
      company: '', address: null, created_at: '2026-01-01T00:00:00Z',
    });

    render(<PelangganScreen {...BASE_PROPS} />);
    await waitFor(() => expect(supabaseClientModule.customersService.fetchAll).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /tambah pelanggan/i }));

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'Ibu Sri' } });
    fireEvent.change(inputs[1], { target: { value: '628222333444' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });
    const callArgs = mockInsert.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty('default_pricing_tier');
  });
});
```

- [ ] **Step 2: Run tests to verify all three fail**

Run: `npx vitest run src/components/PelangganScreen.test.tsx -t "tier pills"`

Expected: FAIL x3 (pills not rendered; Grosir button not found; render assertions fail).

- [ ] **Step 3: Add tier state + pill UI to `NewCustomerInlineForm`**

Edit `src/components/penjualan/wizard/NewCustomerInlineForm.tsx`. Update the interface + component to accept `showTierField` and render pills:

```tsx
import { useState } from 'react';
import type { DbCustomer } from '../../../types';
import { insertNewCustomer, requestCustomerCreditActivate } from '../../../lib/customers/customerWrappers';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';

interface Props {
  onSaved: (customer: DbCustomer) => void;
  onCancel: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  showTierField?: boolean;
}

export default function NewCustomerInlineForm({ onSaved, onCancel, showToast, showTierField = false }: Props) {
  const [name, setName] = useState('');
  const [wa, setWa] = useState('');
  const [company, setCompany] = useState('');
  const [address, setAddress] = useState('');
  const [tier, setTier] = useState<'eceran' | 'grosir'>('eceran');
  const [requestTempo, setRequestTempo] = useState(false);
  const [limit, setLimit] = useState('');
  const [term, setTerm] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0 && wa.trim().length > 0 && !submitting;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const customer = await insertNewCustomer({
        name: name.trim(),
        wa_number: wa.trim(),
        company: company.trim() || undefined,
        address: address.trim() || undefined,
        ...(showTierField ? { default_pricing_tier: tier } : {}),
      });
      if (requestTempo) {
        const parsedLimit = parseFloat(limit.replace(/[.,]/g, '')) || 0;
        const parsedTerm = parseInt(term, 10) || 0;
        if (parsedLimit > 0 && parsedTerm > 0) {
          try {
            await requestCustomerCreditActivate(customer.id, parsedTerm, parsedLimit, reason.trim() || undefined);
            showToast('Customer tersimpan; request TEMPO terkirim ke Owner.', 'success');
          } catch (e) {
            showToast('Customer tersimpan, tapi gagal kirim request TEMPO. Coba dari menu Pelanggan.', 'warning');
          }
        } else {
          showToast('Customer tersimpan. Limit/term TEMPO belum di-set; lewati.', 'info');
        }
      } else {
        showToast('Customer baru tersimpan.', 'success');
      }
      onSaved(customer);
    } catch (e) {
      const rawMsg = extractErrorMessage(e);
      // F5-05: map unique constraint violation to Bahasa-friendly message
      const friendlyMsg = rawMsg.includes('uq_customers_wa_tenant')
        ? 'Nomor HP sudah terdaftar untuk customer lain di toko ini. Cek dulu di daftar Pelanggan.'
        : rawMsg;
      showToast(`Gagal simpan customer: ${friendlyMsg}`, 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 border-2 border-[#012749]/30 rounded-lg p-4 bg-[#012749]/5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-extrabold text-[#012749]">Customer Baru</div>
          <div className="text-[11px] text-slate-600">Akan tersimpan ke daftar Pelanggan.</div>
        </div>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700 text-sm">×</button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Nama <span className="text-red-500">*</span></label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">No HP / WhatsApp <span className="text-red-500">*</span></label>
          <input value={wa} onChange={(e) => setWa(e.target.value)} placeholder="08xxx" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Perusahaan / PT</label>
          <input value={company} onChange={(e) => setCompany(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Alamat</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
        </div>
      </div>

      {showTierField && (
        <div className="mt-3 pt-3 border-t border-[#012749]/20">
          <label className="block text-[11px] font-bold text-slate-600 mb-1.5">Tipe Harga default</label>
          <div className="flex gap-1.5">
            {(['eceran', 'grosir'] as const).map((t) => {
              const active = tier === t;
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTier(t)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                    active
                      ? t === 'grosir'
                        ? 'bg-purple-600 text-white'
                        : 'bg-[#012749] text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {t === 'eceran' ? 'Eceran' : 'Grosir'}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-500 mt-1 italic">Otomatis dipakai saat customer ini transaksi; kasir bebas switch per pesanan.</p>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-[#012749]/20">
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
          <input type="checkbox" checked={requestTempo} onChange={(e) => setRequestTempo(e.target.checked)} className="rounded" />
          Ajukan TEMPO (kredit) untuk customer ini
        </label>
        {requestTempo && (
          <>
            <p className="text-[11px] text-slate-500 mt-1 ml-6">
              Centang kalau customer mau bayar nanti. <strong>Butuh approval Owner dulu</strong> — request masuk ke Persetujuan, customer baru bisa pakai TEMPO setelah disetujui.
            </p>
            <div className="mt-2 ml-6 space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Limit Kredit yang diminta (Rp)</label>
                  <input value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="Mis: 5.000.000" className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Term (hari)</label>
                  <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Mis: 14" className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg" />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Alasan / Justifikasi (optional)</label>
                <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mis: Customer regular, sudah belanja 3x via WA. Owner tetangga sebelah." className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg" />
                <p className="text-[10px] text-slate-500 mt-1 italic">Bantu Owner decide cepat. Tampil sebagai blockquote di Persetujuan inbox.</p>
              </div>
            </div>
            <p className="text-[11px] text-amber-700 mt-2 ml-6 italic">
              ⚠️ Untuk transaksi sekarang: customer baru saja dibuat & TEMPO belum di-approve, jadi pesanan ini harus pakai <strong>LUNAS</strong> atau <strong>DP</strong>. TEMPO bisa dipakai untuk pesanan berikutnya setelah Owner approve.
            </p>
          </>
        )}
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={submitting} className="px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50">Batal</button>
        <button type="button" onClick={onSubmit} disabled={!canSubmit} className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#012749] text-white hover:opacity-90 disabled:opacity-50">
          {submitting ? 'Menyimpan…' : '✓ Simpan & Pilih'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the modal in `PelangganScreen` to pass `showTierField`**

Edit `src/components/PelangganScreen.tsx` — locate the `<NewCustomerInlineForm ...>` block at line 204-212 and add the `showTierField` prop:

```tsx
              <NewCustomerInlineForm
                onSaved={(customer) => {
                  showToast(`Pelanggan ${customer.name} tersimpan.`, 'success');
                  setShowAddModal(false);
                  refreshCustomers();
                }}
                onCancel={() => setShowAddModal(false)}
                showToast={showToast}
                showTierField={showTierDropdown}
              />
```

`showTierDropdown` is already computed at line 113 of the same file — no new state needed.

- [ ] **Step 5: Run the tier-pill tests to verify they pass**

Run: `npx vitest run src/components/PelangganScreen.test.tsx -t "tier pills"`

Expected: PASS x4 (renders pills preselected eceran; submits with `default_pricing_tier: 'grosir'`; modul-off hides pills; modul-off omits arg).

- [ ] **Step 6: Run the full test file to guard against regression**

Run: `npx vitest run src/components/PelangganScreen.test.tsx`

Expected: ALL PASS (including pre-existing F5-01 and tier-dropdown tests).

- [ ] **Step 7: Commit**

```bash
git add src/components/penjualan/wizard/NewCustomerInlineForm.tsx src/components/PelangganScreen.tsx src/components/PelangganScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(pelanggan): tier pills on add-customer form

Gated by modul_multi_tier_price via existing tier_dropdown_customer
field key. Eceran preselected; user picks Grosir explicitly. Passed
through to insertNewCustomer as default_pricing_tier when modul is
on; omitted otherwise so DB default keeps firing.

Test coverage: modul-on renders pills + submits with tier, modul-off
hides pills + omits arg.

Spec: bcf3ca1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Propagate `showTierField` through the wizard render site

**Files:**
- Modify: `src/components/penjualan/wizard/Step1ChannelCustomer.tsx:9-22, 79-85`
- Modify: `src/components/penjualan/CatatPenjualanWizard.tsx` — locate the `<Step1ChannelCustomer ...>` render (search for it in the file) and pass `showTierField`

**Interfaces:**
- Consumes: `showTierPill: boolean` already computed at `CatatPenjualanWizard.tsx:140` via `isFieldVisible('tier_pill_kasir', tenantSettings)` — same underlying flag `modul_multi_tier_price`.
- Produces: `Step1ChannelCustomer` accepts `showTierField?: boolean` and forwards to `NewCustomerInlineForm`.

Rationale: `tier_pill_kasir` and `tier_dropdown_customer` both map to `settings.modul_multi_tier_price` (`cascadeMap.ts:41-44`), so reusing `showTierPill` here is semantically correct — the wizard already computed it for the kasir tier toggle.

- [ ] **Step 1: Add `showTierField` to `Step1ChannelCustomer` props**

Edit `src/components/penjualan/wizard/Step1ChannelCustomer.tsx`:

Update the `Props` interface (line 9-22) — add one line after `showToast`:

```tsx
interface Props {
  channel: KasirChannel;
  setChannel: (c: KasirChannel) => void;
  customer: DbCustomer | undefined;
  setCustomer: (c: DbCustomer | undefined) => void;
  customers: DbCustomerWithStats[];
  marketplaceOrderNo: string;
  setMarketplaceOrderNo: (s: string) => void;
  waPhone: string;
  setWaPhone: (s: string) => void;
  waChatUrl: string;
  setWaChatUrl: (s: string) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  showTierField?: boolean;
}
```

Update the `<NewCustomerInlineForm ...>` render (line 79-85) — add `showTierField`:

```tsx
        {showNewCustomerForm && (
          <NewCustomerInlineForm
            onSaved={(c) => { props.setCustomer(c); setShowNewCustomerForm(false); }}
            onCancel={() => setShowNewCustomerForm(false)}
            showToast={props.showToast}
            showTierField={props.showTierField}
          />
        )}
```

- [ ] **Step 2: Pass `showTierField` from `CatatPenjualanWizard`**

Edit `src/components/penjualan/CatatPenjualanWizard.tsx` — find where `<Step1ChannelCustomer ...>` is rendered.

Run first to locate it:

```bash
grep -n "Step1ChannelCustomer" src/components/penjualan/CatatPenjualanWizard.tsx
```

Add `showTierField={showTierPill}` to that render (`showTierPill` is already in scope at line 140). Example — if the current render looks like:

```tsx
<Step1ChannelCustomer
  channel={channel}
  setChannel={setChannel}
  customer={customer}
  setCustomer={setCustomer}
  customers={customers}
  marketplaceOrderNo={marketplaceOrderNo}
  setMarketplaceOrderNo={setMarketplaceOrderNo}
  waPhone={waPhone}
  setWaPhone={setWaPhone}
  waChatUrl={waChatUrl}
  setWaChatUrl={setWaChatUrl}
  showToast={showToast}
/>
```

change to:

```tsx
<Step1ChannelCustomer
  channel={channel}
  setChannel={setChannel}
  customer={customer}
  setCustomer={setCustomer}
  customers={customers}
  marketplaceOrderNo={marketplaceOrderNo}
  setMarketplaceOrderNo={setMarketplaceOrderNo}
  waPhone={waPhone}
  setWaPhone={setWaPhone}
  waChatUrl={waChatUrl}
  setWaChatUrl={setWaChatUrl}
  showToast={showToast}
  showTierField={showTierPill}
/>
```

If the actual prop set differs, keep everything else unchanged and simply add the `showTierField={showTierPill}` line.

- [ ] **Step 3: Type-check to confirm the chain compiles**

Run: `npx tsc --noEmit`

Expected: no new type errors. If TSC complains about `showTierPill` not being in scope inside the JSX (e.g., it's declared after the JSX), move the declaration up or use `tenantSettings ? isFieldVisible('tier_dropdown_customer', tenantSettings) : false` inline at the prop site.

- [ ] **Step 4: Run vitest to confirm no regression**

Run: `npx vitest run src/components/penjualan/`

Expected: any existing tests for `Step1ChannelCustomer` or `CatatPenjualanWizard` still pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/penjualan/wizard/Step1ChannelCustomer.tsx src/components/penjualan/CatatPenjualanWizard.tsx
git commit -m "$(cat <<'EOF'
feat(penjualan): pass showTierField through wizard to NewCustomerInlineForm

Reuses existing showTierPill (isFieldVisible tier_pill_kasir) since
both keys map to modul_multi_tier_price. Inline add-customer inside
Catat Penjualan wizard now shows Eceran/Grosir pills when modul on.

Spec: bcf3ca1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Unify edit-form dropdown → pills (parity)

**Files:**
- Modify: `src/components/PelangganScreen.tsx:347-361` (the `<select>` block inside profile-edit header)
- Test: `src/components/PelangganScreen.test.tsx` — update the existing `'modul ON → tier dropdown shows eceran default when editing'` test to target pills instead of the combobox.

**Interfaces:** none new; the edit path continues to call `customersService.updateTier(profile.id, editTier)` (unchanged, `supabaseClient.ts:873-880`).

- [ ] **Step 1: Update the existing test to expect pills**

Edit `src/components/PelangganScreen.test.tsx` — replace the existing test at lines 215-242 (the `it('modul ON → tier dropdown shows eceran default when editing', ...)` block):

```tsx
  it('modul ON → tier pills shown in edit mode with Eceran preselected; switching to Grosir persists via updateTier', async () => {
    (pengaturanServicesModule.tenantSettingsService.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...BASE_SETTINGS,
      modul_multi_tier_price: true,
    });

    (supabaseClientModule.customersService.fetchProfile as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ECERAN_CUSTOMER,
      orders: [],
      leads: [],
      kasir_transactions: [],
    });
    (supabaseClientModule.customersService.updateNameCompany as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (supabaseClientModule.customersService.updateTier as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(<PelangganScreen {...BASE_PROPS} />);

    await screen.findByText('Budi Santoso');
    fireEvent.click(screen.getByText('Budi Santoso'));

    const editBtn = await screen.findByRole('button', { name: /Edit/i });
    fireEvent.click(editBtn);

    // Pills visible; Eceran preselected in edit mode. Filter to the edit-panel
    // scope by finding the pill with aria-pressed inside the profile header.
    const eceranPill = await screen.findByRole('button', { name: 'Eceran', pressed: true });
    expect(eceranPill).toBeInTheDocument();

    // Switch to Grosir
    const grosirPill = screen.getByRole('button', { name: 'Grosir', pressed: false });
    fireEvent.click(grosirPill);

    // Save
    fireEvent.click(screen.getByRole('button', { name: /Simpan/i }));

    await waitFor(() => {
      expect(supabaseClientModule.customersService.updateTier).toHaveBeenCalledWith('cust-1', 'grosir');
    });
  });
```

Note: The test uses `pressed: true` / `pressed: false` matchers from RTL, which target `aria-pressed` — same attribute used on the add-form pills. This gives us a single semantic assertion pattern for both surfaces.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/PelangganScreen.test.tsx -t "tier pills shown in edit mode"`

Expected: FAIL — the current dropdown is a `<select>`, not `<button aria-pressed>`.

- [ ] **Step 3: Replace the `<select>` with pills**

Edit `src/components/PelangganScreen.tsx` — replace the block at lines 347-361 (the `{showTierDropdown && (<div>...<select>...</select>...</div>)}` block inside the edit header):

```tsx
                      {showTierDropdown && (
                        <div>
                          <label className="text-[11px] font-bold text-white/60">Tier Harga Default</label>
                          <div className="flex gap-1.5 mt-0.5">
                            {(['eceran', 'grosir'] as const).map((t) => {
                              const active = editTier === t;
                              return (
                                <button
                                  key={t}
                                  type="button"
                                  aria-pressed={active}
                                  onClick={() => setEditTier(t)}
                                  className={`text-xs font-semibold px-3 py-1 rounded-full transition-colors ${
                                    active
                                      ? t === 'grosir'
                                        ? 'bg-purple-500 text-white'
                                        : 'bg-white text-[#012749]'
                                      : 'bg-white/10 text-white/70 hover:bg-white/20'
                                  }`}
                                >
                                  {t === 'eceran' ? 'Eceran' : 'Grosir'}
                                </button>
                              );
                            })}
                          </div>
                          <p className="text-[10px] text-white/40 mt-1">Otomatis dipakai saat customer ini transaksi; kasir bebas switch.</p>
                        </div>
                      )}
```

Note on colors: this pill row sits on the dark navy profile header (`bg-[#012749]`), so the active/inactive palette is tuned for dark background: active eceran = `bg-white text-[#012749]`, active grosir = `bg-purple-500 text-white`, inactive = `bg-white/10 text-white/70`. Same visual language, contrast-safe on the dark header. No new design tokens — all values already used elsewhere on this same header (e.g., `bg-white/10` at line 339).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/PelangganScreen.test.tsx -t "tier pills shown in edit mode"`

Expected: PASS.

- [ ] **Step 5: Run the full test file**

Run: `npx vitest run src/components/PelangganScreen.test.tsx`

Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/PelangganScreen.tsx src/components/PelangganScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(pelanggan): unify edit-form tier control to pills

Replaces the <select> dropdown in the profile-edit header with the
same Eceran/Grosir pill pattern used on the add form. Palette tuned
for the dark navy header (bg-white / bg-purple-500 / bg-white/10 —
all existing tokens). Test updated to target aria-pressed on pills.

Spec: bcf3ca1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Read-only audit SQL for existing miscategorized customers

**Files:**
- Create: `scripts/audit-misclassified-customer-tier.sql`

**Interfaces:** SQL-only. No code change. Query is read-only (SELECT), safe to run against production without side effects.

- [ ] **Step 1: Create the audit script**

Create `scripts/audit-misclassified-customer-tier.sql` with exactly this content:

```sql
-- audit-misclassified-customer-tier.sql
--
-- Read-only audit: surface customers with default_pricing_tier = 'eceran'
-- but signals suggesting they should be 'grosir' (business context: they
-- have a company name filled in, OR they've been granted TEMPO — both
-- typical wholesale-buyer signals).
--
-- Usage (from MCP execute_sql or psql):
--   Set p_tenant_id to the target tenant UUID, then run:
--     :setvar tenant_id '<uuid-here>'
--   Or replace $1 with the literal UUID before running.
--
-- Output is a candidate list for the tenant owner to review. No auto-fix.
-- Owner corrects tier from the Pelanggan Screen edit modal.
--
-- Related spec: docs/superpowers/specs/2026-07-24-customer-pricing-tier-add-form-fix-design.md

SELECT
  id,
  name,
  company,
  wa_number,
  allows_tempo,
  created_at
FROM public.customers
WHERE tenant_id = $1
  AND default_pricing_tier = 'eceran'
  AND (
    (company IS NOT NULL AND company <> '')
    OR allows_tempo = TRUE
  )
ORDER BY created_at DESC;
```

- [ ] **Step 2: Smoke-execute against the prod-testing tenant via MCP**

Use `mcp__plugin_supabase_supabase__execute_sql` (or the psql equivalent) — substitute `$1` with the Toko Jaya Makmur tenant UUID. The query MUST return without error and produce zero rows or a small row set (whatever the current data reflects). Do NOT run this against a real customer tenant.

Expected: query runs without error. Row count is informational only; the value of the script is that it exists and is safe to point at any tenant.

- [ ] **Step 3: Commit**

```bash
git add scripts/audit-misclassified-customer-tier.sql
git commit -m "$(cat <<'EOF'
chore(scripts): read-only audit for miscategorized customer tier

Surfaces customers with default_pricing_tier='eceran' whose company
name or TEMPO grant signals they should be 'grosir'. Read-only,
no auto-fix — tenant owner reviews and corrects from Pelanggan
Screen edit modal.

Spec: bcf3ca1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Stage 1 gates + Stage 3 prod-testing smoke

**Files:** none new; verification only.

**Interfaces:** none.

This task is verification-before-completion. Every gate must be green before considering Phase 1a done. Do NOT skip any step; if any gate fails, back out to the failing task and fix at root.

- [ ] **Step 1: Stage 1 — lint clean**

Run: `npm run lint`

Expected: exit code 0, no errors, no new warnings on touched files.

- [ ] **Step 2: Stage 1 — numinput audit**

Run: `npm run audit:numinput`

Expected: exit code 0.

- [ ] **Step 3: Stage 1 — SECDEF null-tenant audit**

Run: `npm run audit:secdef-null-tenant`

Expected: exit code 0. (No SQL/RPC change in this plan, so no new findings expected.)

- [ ] **Step 4: Stage 1 — CSP backend allowlist audit**

Run: `npm run audit:csp-backend-allowlist`

Expected: exit code 0. (No backend hostname changes in this plan.)

- [ ] **Step 5: Stage 1 — changed-file vitest**

Run: `npx vitest run --changed`

Expected: all changed-file tests pass; no unrelated failures.

- [ ] **Step 6: Stage 1 — full PelangganScreen suite**

Run: `npx vitest run src/components/PelangganScreen.test.tsx`

Expected: all pass, including pre-existing F5-01, tier-filter, and new tier-pill tests.

- [ ] **Step 7: Stage 3 — manual smoke on Toko Jaya Makmur (modul ON path)**

Prerequisites: on the prod-testing tenant `Toko Jaya Makmur` (memory `production-testing-tenant`), confirm `tenant_settings.modul_multi_tier_price = TRUE`. If not, enable it via Pengaturan → Modul Switches. NEVER perform this smoke against a real customer tenant.

Then, via MCP chrome-devtools against the production URL `app.caleo.id` logged in as the test tenant:

1. Navigate to Pelanggan → click "+ Tambah Pelanggan" → modal opens.
2. Verify pills row is visible with `Eceran` preselected (dark navy pill), `Grosir` inactive (gray).
3. Fill Nama = "QA Smoke Grosir", WA = "628999000111", Company = "PT Smoke", tier = Grosir.
4. Click Simpan → toast confirms save, modal closes, customer appears in list with `Grosir` badge.
5. Click the new customer → click Edit → verify pills show `Grosir` preselected (dark header pills).
6. Cancel edit → navigate to Kasir → Catat Penjualan → select this customer → verify wizard tier toggle auto-syncs to `grosir` and any product line uses `price_grosir` where available.

Do NOT commit any created customer or transaction to production if it would pollute reports. Delete the smoke customer from the Pelanggan Screen once verification is complete (soft-delete or hard-delete per existing tenant tooling).

- [ ] **Step 8: Stage 3 — manual smoke on Toko Jaya Makmur (modul OFF regression)**

Toggle `modul_multi_tier_price = FALSE` on Toko Jaya Makmur.

1. Navigate to Pelanggan → click "+ Tambah Pelanggan" → verify pills row is NOT rendered inside the modal.
2. Click into an existing customer → click Edit → verify no tier pill row rendered.
3. Confirm the tier filter chips + tier badge in the customer list are also hidden (existing behaviour, must not regress).
4. Re-enable `modul_multi_tier_price = TRUE` to restore the test tenant to its usual state.

- [ ] **Step 9: If any smoke step fails, ROLLBACK**

Rollback path: revert the Cloud Run frontend revision to the previous tag URL (per memory `deploy_verify_after_push` and CLAUDE.md rollback protocol). Log an incident file per CLAUDE.md incident-logging discipline. Do NOT leave broken code in prod.

---

## Task 7: Log to `progress.md`

**Files:**
- Modify: `progress.md` (append entry)

**Interfaces:** none.

- [ ] **Step 1: Append an entry to `progress.md`**

Open `progress.md` and add a new entry at the top of the log body (below any date-sorted header). Use this exact text:

```markdown
## 2026-07-24 — Customer pricing tier: add-form fix (Phase 1a) SHIPPED

**What:** Add-customer form now exposes `Tipe Harga default` pills (Eceran / Grosir), gated by `modul_multi_tier_price`. Edit-customer form unified to the same pill pattern. `insertNewCustomer` accepts optional `default_pricing_tier`; when omitted, DB default `'eceran'` still fires (zero regression). Read-only audit script `scripts/audit-misclassified-customer-tier.sql` ships alongside for surfacing likely-misclassified existing customers.

**Why:** Wholesale customers were silently created as retail because the add form had no tier control (only edit did). Kasir/quotation would then quote retail prices until someone remembered to open Edit and change the tier. Bleeding fixed forward-only; existing data audited via the SQL script (owner corrects manually).

**Scope kept out:** Owner-configurable N tiers (Phase 1b — separate brainstorm, requires irreversible-architectural memo). SKU-quantity-based tiers (Phase 2 — deferred).

**Spec:** [`docs/superpowers/specs/2026-07-24-customer-pricing-tier-add-form-fix-design.md`](docs/superpowers/specs/2026-07-24-customer-pricing-tier-add-form-fix-design.md) (`bcf3ca1`).

**Plan:** [`docs/superpowers/plans/2026-07-24-customer-pricing-tier-add-form-fix-plan.md`](docs/superpowers/plans/2026-07-24-customer-pricing-tier-add-form-fix-plan.md).

**Verified:** Stage 1 gates green (lint, audit:numinput, audit:secdef-null-tenant, audit:csp-backend-allowlist, vitest full PelangganScreen suite). Stage 3 smoke completed on Toko Jaya Makmur — modul-on + modul-off both green; sales quotation for new grosir customer auto-picks price_grosir at line-add.
```

Preserve any surrounding structure — this is an append, not a replace of prior entries.

- [ ] **Step 2: Commit + push**

```bash
git add progress.md
git commit -m "$(cat <<'EOF'
docs(progress): customer pricing-tier add-form fix (Phase 1a) SHIPPED

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

- [ ] **Step 3: Confirm deploy succeeded**

Per memory `deploy_verify_after_push`, after the push run:

```bash
gcloud builds list --limit=2
```

Expected: latest build STATUS is `SUCCESS` (not `FAILURE`, not `QUEUED` past 10 minutes). If FAILURE, investigate the build log and rollback per Task 6 Step 9. If still QUEUED after ~10 minutes, wait and re-check.

---

## Self-review notes

**Spec coverage:**
- Design spec section "Files to touch" (6 files) → covered by Tasks 1-5 + 7. Task 6 is verification-only, no file change. ✅
- Design spec section "UX" (pill styling, Eceran preselected, Bahasa labels) → Task 2 Step 3. ✅
- Design spec section "Data flow" (state → args → row → DB default) → Tasks 1-3. ✅
- Design spec section "Regression risk" table (modul-off, WA path, quotation, kasir, CHECK) → Task 2 (modul-off tests) + Task 6 (WA smoke, kasir auto-sync smoke). ✅
- Design spec section "Testing" (Stage 1 gates + Stage 3 smoke) → Task 6. ✅
- Design spec section "Audit query" → Task 5. ✅
- Design spec section "Impact analysis" verdict "plan covers all" → verified: 2 render sites (Tasks 2 + 3), 1 call site (Task 1), 1 test file (updated in Tasks 2 + 4). ✅
- Non-goals: backend Go WA path deliberately untouched — no task modifies `backend-go/`. ✅

**Placeholder scan:** no `TBD`, no `TODO`, no `implement later`, no vague "add appropriate error handling" — every code step ships full code. ✅

**Type consistency:** `default_pricing_tier: 'eceran' | 'grosir'` used identically in Task 1 (`customerWrappers.ts`), Task 2 (state + submit), and Task 4 (`editTier`). Prop name `showTierField` used identically in Tasks 2 + 3. ✅

**Ambiguity check:**
- Task 3 Step 2 asks to grep for the `Step1ChannelCustomer` render site because the exact line varies with wizard file evolution — implementer runs the grep, not the plan author. This is intentional (protects against line drift) rather than a placeholder. ✅
- Task 6 Step 7 says "delete the smoke customer once verification is complete" — deliberately underspecified because tenant deletion tooling varies. The action is clear even if the mechanism is chosen at execution time. ✅
