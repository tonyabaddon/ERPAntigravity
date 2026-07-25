// Step2Aktiva.tsx
// Wizard Step 2 — Aktiva (Assets)
// Sections: Piutang Usaha (aggregate|detail), Persediaan (auto|override),
// Aktiva Tetap, and collapsible "Akun Aktiva lain (opsional)".

import { useEffect, useRef, useState } from 'react';
import type { Step2Aktiva as Step2AktivaType, OpeningARDetailLine, LainLainLine } from '../../../lib/saldoAwal/types';
import { getPersediaanAutoValue } from '../../../lib/saldoAwal/api';
import { NumberInput } from '../../ui/NumberInput';
import { formatIDR } from '../../../lib/formatIDR';
import { supabase } from '../../../lib/supabaseClient';
import CoAPicker from './CoAPicker';
import type { CoaOption } from './CoAPicker';

interface Props {
  data: Step2AktivaType;
  onChange: (data: Step2AktivaType) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

// Inline customer autocomplete for AR detail mode
interface CustomerOption {
  id: string;
  name: string;
}

function CustomerPicker({
  value,
  onSelect,
}: {
  value: { id: string | null; name: string } | null;
  onSelect: (opt: CustomerOption | null) => void;
}) {
  const [query, setQuery] = useState(value?.name ?? '');
  const [results, setResults] = useState<CustomerOption[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = async (q: string) => {
    if (!supabase || !q.trim()) { setResults([]); return; }
    const { data } = await supabase
      .from('customers')
      .select('id, name')
      .ilike('name', `%${q}%`)
      .limit(15);
    setResults((data ?? []) as CustomerOption[]);
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void search(v); }, 250);
    // Allow free-text entry (no registered customer)
    onSelect(v.trim() ? { id: '', name: v.trim() } : null);
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={handleInput}
        onFocus={() => { setOpen(true); if (results.length === 0) void search(query); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Nama pelanggan…"
        className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-[#012749]/30"
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
          {results.map((r) => (
            <div
              key={r.id}
              className="px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-[12px]"
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery(r.name);
                onSelect(r);
                setOpen(false);
              }}
            >
              {r.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// import React for JSX (needed for CustomerPicker)
import React from 'react';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';

export default function Step2Aktiva({ data, onChange, showToast }: Props) {
  const [autoValue, setAutoValue] = useState<number | null>(null);
  const [autoLoading, setAutoLoading] = useState(true);
  const [lainLainOpen, setLainLainOpen] = useState(data.lain_lain.length > 0);

  // Fetch persediaan auto value once on mount
  useEffect(() => {
    getPersediaanAutoValue()
      .then((v) => {
        setAutoValue(v);
        // Seed auto value if persediaan not yet manually overridden
        if (!data.persediaan.manual_override) {
          onChange({
            ...data,
            persediaan: {
              ...data.persediaan,
              auto_computed_amount: v,
              final_amount: v,
            },
          });
        }
      })
      .catch((err: unknown) => {
        const msg = extractErrorMessage(err);
        showToast(`Gagal hitung persediaan auto: ${msg}`, 'warning');
        setAutoValue(0);
      })
      .finally(() => setAutoLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Piutang handlers ─────────────────────────────────────────────────────
  function setMode(mode: 'aggregate' | 'detail') {
    onChange({ ...data, piutang: { ...data.piutang, mode, lines: data.piutang.lines ?? [] } });
  }

  function addARLine() {
    const newLine: OpeningARDetailLine = {
      customer_id: null,
      customer_name: '',
      amount: 0,
      original_due_date: null,
      invoice_ref: null,
      notes: null,
    };
    onChange({
      ...data,
      piutang: {
        ...data.piutang,
        lines: [...(data.piutang.lines ?? []), newLine],
      },
    });
  }

  function updateARLine(idx: number, patch: Partial<OpeningARDetailLine>) {
    const lines = [...(data.piutang.lines ?? [])];
    lines[idx] = { ...lines[idx], ...patch };
    onChange({ ...data, piutang: { ...data.piutang, lines } });
  }

  function removeARLine(idx: number) {
    const lines = (data.piutang.lines ?? []).filter((_, i) => i !== idx);
    onChange({ ...data, piutang: { ...data.piutang, lines } });
  }

  // AR detail total
  const arDetailTotal = (data.piutang.lines ?? []).reduce((s, l) => s + l.amount, 0);

  // ── Lain-lain handlers ────────────────────────────────────────────────────
  function addLainLain() {
    const newLine: LainLainLine = { coa_code: '', coa_name: '', amount: 0, notes: '' };
    onChange({ ...data, lain_lain: [...data.lain_lain, newLine] });
  }

  function updateLainLain(idx: number, patch: Partial<LainLainLine>) {
    const lines = [...data.lain_lain];
    lines[idx] = { ...lines[idx], ...patch };
    onChange({ ...data, lain_lain: lines });
  }

  function removeLainLain(idx: number) {
    onChange({ ...data, lain_lain: data.lain_lain.filter((_, i) => i !== idx) });
  }

  return (
    <div className="space-y-6">
      {/* ── Piutang Usaha ─────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-[13px] font-bold text-slate-800">Piutang Usaha</h4>
            <p className="text-[12px] text-slate-500 mt-0.5">Total piutang ke pelanggan per cutover date</p>
          </div>
          <div className="flex gap-1.5">
            {(['aggregate', 'detail'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                  data.piutang.mode === m
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {m === 'aggregate' ? 'Agregat' : 'Detail per pelanggan'}
              </button>
            ))}
          </div>
        </div>

        {data.piutang.mode === 'aggregate' ? (
          <div className="flex items-center gap-3">
            <label className="text-[12px] text-slate-600 font-medium shrink-0">Total Piutang Usaha</label>
            <NumberInput
              value={data.piutang.aggregate_amount}
              onChange={(n) => onChange({ ...data, piutang: { ...data.piutang, aggregate_amount: n } })}
              allowDecimal={false}
              className="w-48 border border-slate-200 rounded-lg px-3 py-1.5 text-right text-[13px] focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
              placeholder="0"
            />
            <span className="text-[12px] text-slate-400">{formatIDR(data.piutang.aggregate_amount)}</span>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-left">
                    <th className="px-3 py-2 font-extrabold text-slate-500 uppercase tracking-wider text-[10.5px]">Pelanggan</th>
                    <th className="px-3 py-2 font-extrabold text-slate-500 uppercase tracking-wider text-[10.5px] text-right">Jumlah</th>
                    <th className="px-3 py-2 font-extrabold text-slate-500 uppercase tracking-wider text-[10.5px]">Jatuh Tempo</th>
                    <th className="px-3 py-2 font-extrabold text-slate-500 uppercase tracking-wider text-[10.5px]">No. Faktur</th>
                    <th className="px-3 py-2 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(data.piutang.lines ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-4 text-center text-slate-400 text-[12px]">
                        Belum ada baris. Klik + Tambah Baris.
                      </td>
                    </tr>
                  ) : (
                    (data.piutang.lines ?? []).map((line, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2 w-44">
                          <CustomerPicker
                            value={line.customer_id ? { id: line.customer_id, name: line.customer_name } : { id: null, name: line.customer_name }}
                            onSelect={(opt) => updateARLine(idx, {
                              customer_id: opt?.id || null,
                              customer_name: opt?.name ?? '',
                            })}
                          />
                        </td>
                        <td className="px-3 py-2 w-36">
                          <NumberInput
                            value={line.amount}
                            onChange={(n) => updateARLine(idx, { amount: n })}
                            allowDecimal={false}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-right text-[12px] focus:outline-none focus:ring-1 focus:ring-[#012749]/30"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-3 py-2 w-36">
                          <input
                            type="date"
                            value={line.original_due_date ?? ''}
                            onChange={(e) => updateARLine(idx, { original_due_date: e.target.value || null })}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-[#012749]/30"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={line.invoice_ref ?? ''}
                            onChange={(e) => updateARLine(idx, { invoice_ref: e.target.value || null })}
                            placeholder="INV-001"
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-[#012749]/30"
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeARLine(idx)}
                            className="text-slate-300 hover:text-rose-500 text-base leading-none"
                            title="Hapus baris"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {(data.piutang.lines ?? []).length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-50 border-t border-slate-200">
                      <td className="px-3 py-2 text-[11px] font-bold text-slate-600">Total</td>
                      <td className="px-3 py-2 text-right font-bold text-[12px] text-emerald-700">
                        {formatIDR(arDetailTotal)}
                      </td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <button
              type="button"
              onClick={addARLine}
              className="text-[12px] text-[#012749] font-semibold hover:underline"
            >
              + Tambah Baris
            </button>
          </div>
        )}
      </section>

      {/* ── Persediaan ─────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h4 className="text-[13px] font-bold text-slate-800">Persediaan</h4>
          <p className="text-[12px] text-slate-500 mt-0.5">Nilai stok per cutover date (dihitung dari harga modal × qty)</p>
        </div>

        <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
          {autoLoading ? (
            <p className="text-[12px] text-slate-400">Menghitung nilai persediaan otomatis…</p>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] text-slate-600">Nilai auto (dari master stok):</div>
                <div className="text-[14px] font-bold text-emerald-700 mt-0.5">
                  {autoValue === 0
                    ? <span className="text-slate-400">Rp 0 — belum ada master stok atau harga modal</span>
                    : formatIDR(autoValue ?? 0)}
                </div>
              </div>
              <div className="flex gap-1.5">
                {(['auto', 'manual'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      const isManual = m === 'manual';
                      onChange({
                        ...data,
                        persediaan: {
                          ...data.persediaan,
                          manual_override: isManual,
                          final_amount: isManual ? data.persediaan.final_amount : (autoValue ?? 0),
                        },
                      });
                    }}
                    className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                      (m === 'auto' ? !data.persediaan.manual_override : data.persediaan.manual_override)
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {m === 'auto' ? 'Pakai auto' : 'Override manual'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {data.persediaan.manual_override && (
            <div className="space-y-2 pt-2 border-t border-slate-200">
              <div className="flex items-center gap-3">
                <label className="text-[12px] text-slate-600 font-medium shrink-0">Nilai Persediaan (Rp)</label>
                <NumberInput
                  value={data.persediaan.final_amount}
                  onChange={(n) => onChange({ ...data, persediaan: { ...data.persediaan, final_amount: n } })}
                  allowDecimal={false}
                  className="w-48 border border-slate-200 rounded-lg px-3 py-1.5 text-right text-[13px] focus:outline-none focus:ring-2 focus:ring-[#012749]/30 bg-white"
                  placeholder="0"
                />
                <span className="text-[12px] text-slate-400">{formatIDR(data.persediaan.final_amount)}</span>
              </div>
              <div>
                <label className="block text-[12px] text-slate-600 font-medium mb-1">Alasan override</label>
                <input
                  type="text"
                  value={data.persediaan.override_reason ?? ''}
                  onChange={(e) => onChange({
                    ...data,
                    persediaan: { ...data.persediaan, override_reason: e.target.value || null },
                  })}
                  placeholder="Misal: Nilai stok dari laporan fisik opname"
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#012749]/30 bg-white"
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Aktiva Tetap ───────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h4 className="text-[13px] font-bold text-slate-800">Aktiva Tetap (Nilai Buku Bersih)</h4>
          <p className="text-[12px] text-slate-500 mt-0.5">Total aset tetap setelah penyusutan per cutover date</p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <label className="text-[12px] text-slate-600 font-medium shrink-0">Nilai Aktiva Tetap</label>
            <NumberInput
              value={data.aktiva_tetap.amount}
              onChange={(n) => onChange({ ...data, aktiva_tetap: { ...data.aktiva_tetap, amount: n } })}
              allowDecimal={false}
              className="w-48 border border-slate-200 rounded-lg px-3 py-1.5 text-right text-[13px] focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
              placeholder="0"
            />
            <span className="text-[12px] text-slate-400">{formatIDR(data.aktiva_tetap.amount)}</span>
          </div>
          <div>
            <label className="block text-[12px] text-slate-600 font-medium mb-1">Keterangan (opsional)</label>
            <input
              type="text"
              value={data.aktiva_tetap.notes}
              onChange={(e) => onChange({ ...data, aktiva_tetap: { ...data.aktiva_tetap, notes: e.target.value } })}
              placeholder="Misal: Rak gudang, forklift, PC toko"
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#012749]/30"
            />
          </div>
        </div>
      </section>

      {/* ── Akun Aktiva lain (collapsible) ────────────────────────────────────── */}
      <section>
        <button
          type="button"
          onClick={() => setLainLainOpen((v) => !v)}
          className="flex items-center gap-2 text-[13px] font-semibold text-slate-700 hover:text-[#012749]"
        >
          <span className="text-slate-400">{lainLainOpen ? '▾' : '▸'}</span>
          Akun Aktiva lain (opsional)
          {data.lain_lain.length > 0 && (
            <span className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full font-bold">
              {data.lain_lain.length}
            </span>
          )}
        </button>

        {lainLainOpen && (
          <div className="mt-3 space-y-2">
            <p className="text-[12px] text-slate-500">Piutang lain-lain, uang muka, biaya dibayar dimuka, dsb.</p>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-left">
                    <th className="px-3 py-2 font-extrabold text-slate-500 uppercase tracking-wider text-[10.5px]">Akun (COA)</th>
                    <th className="px-3 py-2 font-extrabold text-slate-500 uppercase tracking-wider text-[10.5px] text-right">Jumlah</th>
                    <th className="px-3 py-2 font-extrabold text-slate-500 uppercase tracking-wider text-[10.5px]">Keterangan</th>
                    <th className="px-3 py-2 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.lain_lain.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-4 text-center text-slate-400 text-[12px]">
                        Belum ada baris.
                      </td>
                    </tr>
                  ) : (
                    data.lain_lain.map((line, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2 w-56">
                          <CoAPicker
                            value={line.coa_code ? { coa_code: line.coa_code, coa_name: line.coa_name } : null}
                            onChange={(opt: CoaOption | null) => updateLainLain(idx, {
                              coa_code: opt?.coa_code ?? '',
                              coa_name: opt?.coa_name ?? '',
                            })}
                            filterPrefix="1-"
                            placeholder="Pilih akun aktiva…"
                          />
                        </td>
                        <td className="px-3 py-2 w-36">
                          <NumberInput
                            value={line.amount}
                            onChange={(n) => updateLainLain(idx, { amount: n })}
                            allowDecimal={false}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-right text-[12px] focus:outline-none focus:ring-1 focus:ring-[#012749]/30"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={line.notes}
                            onChange={(e) => updateLainLain(idx, { notes: e.target.value })}
                            placeholder="Keterangan…"
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-[#012749]/30"
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeLainLain(idx)}
                            className="text-slate-300 hover:text-rose-500 text-base leading-none"
                            title="Hapus baris"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={addLainLain}
              className="text-[12px] text-[#012749] font-semibold hover:underline"
            >
              + Tambah Baris
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
