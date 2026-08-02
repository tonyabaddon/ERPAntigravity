// Step3Kewajiban.tsx
// Wizard Step 3 — Kewajiban (Liabilities)
// Sections: Hutang Usaha (aggregate|detail per-supplier),
// and collapsible "Kewajiban lain (opsional)".

import React, { useRef, useState } from 'react';
import type { Step3Kewajiban as Step3KewajibanType, OpeningAPDetailLine, LainLainLine } from '../../../lib/saldoAwal/types';
import { NumberInput } from '../../ui/NumberInput';
import { formatIDR } from '../../../lib/formatIDR';
import { supabase } from '../../../lib/supabaseClient';
import CoAPicker from './CoAPicker';
import type { CoaOption } from './CoAPicker';

interface Props {
  data: Step3KewajibanType;
  onChange: (data: Step3KewajibanType) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

interface SupplierOption {
  id: string;
  name: string;
}

function SupplierPicker({
  value,
  onSelect,
}: {
  value: { id: string | null; name: string } | null;
  onSelect: (opt: SupplierOption | null) => void;
}) {
  const [query, setQuery] = useState(value?.name ?? '');
  const [results, setResults] = useState<SupplierOption[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = async (q: string) => {
    if (!supabase || !q.trim()) { setResults([]); return; }
    const { data } = await supabase
      .from('suppliers')
      .select('id, name')
      .ilike('name', `%${q}%`)
      .limit(15);
    setResults((data ?? []) as SupplierOption[]);
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void search(v); }, 250);
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
        placeholder="Nama supplier…"
        className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded shadow-lg max-h-40 overflow-y-auto">
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

export default function Step3Kewajiban({ data, onChange, showToast: _showToast }: Props) {
  const [lainLainOpen, setLainLainOpen] = useState(data.lain_lain.length > 0);

  // ── Hutang Usaha handlers ────────────────────────────────────────────────
  function setMode(mode: 'aggregate' | 'detail') {
    onChange({ ...data, hutang_usaha: { ...data.hutang_usaha, mode, lines: data.hutang_usaha.lines ?? [] } });
  }

  function addAPLine() {
    const newLine: OpeningAPDetailLine = {
      supplier_id: null,
      supplier_name: '',
      amount: 0,
      original_due_date: null,
      invoice_ref: null,
      notes: null,
    };
    onChange({
      ...data,
      hutang_usaha: {
        ...data.hutang_usaha,
        lines: [...(data.hutang_usaha.lines ?? []), newLine],
      },
    });
  }

  function updateAPLine(idx: number, patch: Partial<OpeningAPDetailLine>) {
    const lines = [...(data.hutang_usaha.lines ?? [])];
    lines[idx] = { ...lines[idx], ...patch };
    onChange({ ...data, hutang_usaha: { ...data.hutang_usaha, lines } });
  }

  function removeAPLine(idx: number) {
    const lines = (data.hutang_usaha.lines ?? []).filter((_, i) => i !== idx);
    onChange({ ...data, hutang_usaha: { ...data.hutang_usaha, lines } });
  }

  const apDetailTotal = (data.hutang_usaha.lines ?? []).reduce((s, l) => s + l.amount, 0);

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
      {/* ── Hutang Usaha ─────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-[13px] font-bold text-slate-800">Hutang Usaha</h4>
            <p className="text-[12px] text-slate-500 mt-0.5">Total hutang ke supplier per cutover date</p>
          </div>
          <div className="flex gap-1.5">
            {(['aggregate', 'detail'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                  data.hutang_usaha.mode === m
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {m === 'aggregate' ? 'Agregat' : 'Detail per supplier'}
              </button>
            ))}
          </div>
        </div>

        {data.hutang_usaha.mode === 'aggregate' ? (
          <div className="flex items-center gap-3">
            <label className="text-[12px] text-slate-600 font-medium shrink-0">Total Hutang Usaha</label>
            <NumberInput
              value={data.hutang_usaha.aggregate_amount}
              onChange={(n) => onChange({ ...data, hutang_usaha: { ...data.hutang_usaha, aggregate_amount: n } })}
              allowDecimal={false}
              className="w-48 border border-slate-200 rounded px-3 py-1.5 text-right text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
              placeholder="0"
            />
            <span className="text-[12px] text-slate-400">{formatIDR(data.hutang_usaha.aggregate_amount)}</span>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="border border-slate-200 rounded overflow-hidden">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-left">
                    <th className="px-3 py-2 font-extrabold text-slate-500 uppercase tracking-wider text-[10.5px]">Supplier</th>
                    <th className="px-3 py-2 font-extrabold text-slate-500 uppercase tracking-wider text-[10.5px] text-right">Jumlah</th>
                    <th className="px-3 py-2 font-extrabold text-slate-500 uppercase tracking-wider text-[10.5px]">Jatuh Tempo</th>
                    <th className="px-3 py-2 font-extrabold text-slate-500 uppercase tracking-wider text-[10.5px]">No. Faktur</th>
                    <th className="px-3 py-2 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(data.hutang_usaha.lines ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-4 text-center text-slate-400 text-[12px]">
                        Belum ada baris. Klik + Tambah Baris.
                      </td>
                    </tr>
                  ) : (
                    (data.hutang_usaha.lines ?? []).map((line, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2 w-44">
                          <SupplierPicker
                            value={line.supplier_id ? { id: line.supplier_id, name: line.supplier_name } : { id: null, name: line.supplier_name }}
                            onSelect={(opt) => updateAPLine(idx, {
                              supplier_id: opt?.id || null,
                              supplier_name: opt?.name ?? '',
                            })}
                          />
                        </td>
                        <td className="px-3 py-2 w-36">
                          <NumberInput
                            value={line.amount}
                            onChange={(n) => updateAPLine(idx, { amount: n })}
                            allowDecimal={false}
                            className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-right text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-3 py-2 w-36">
                          <input
                            type="date"
                            value={line.original_due_date ?? ''}
                            onChange={(e) => updateAPLine(idx, { original_due_date: e.target.value || null })}
                            className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={line.invoice_ref ?? ''}
                            onChange={(e) => updateAPLine(idx, { invoice_ref: e.target.value || null })}
                            placeholder="INV-SUPP-001"
                            className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeAPLine(idx)}
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
                {(data.hutang_usaha.lines ?? []).length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-50 border-t border-slate-200">
                      <td className="px-3 py-2 text-[11px] font-bold text-slate-600">Total</td>
                      <td className="px-3 py-2 text-right font-bold text-[12px] text-rose-700">
                        {formatIDR(apDetailTotal)}
                      </td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <button
              type="button"
              onClick={addAPLine}
              className="text-[12px] text-[var(--color-caleo-primary)] font-semibold hover:underline"
            >
              + Tambah Baris
            </button>
          </div>
        )}
      </section>

      {/* ── Kewajiban lain (collapsible) ──────────────────────────────────────── */}
      <section>
        <button
          type="button"
          onClick={() => setLainLainOpen((v) => !v)}
          className="flex items-center gap-2 text-[13px] font-semibold text-slate-700 hover:text-[var(--color-caleo-primary)]"
        >
          <span className="text-slate-400">{lainLainOpen ? '▾' : '▸'}</span>
          Kewajiban lain (opsional)
          {data.lain_lain.length > 0 && (
            <span className="text-[11px] bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded-full font-bold">
              {data.lain_lain.length}
            </span>
          )}
        </button>

        {lainLainOpen && (
          <div className="mt-3 space-y-2">
            <p className="text-[12px] text-slate-500">Hutang bank, uang muka pelanggan, hutang pajak, beban masih harus dibayar, dsb.</p>
            <div className="border border-slate-200 rounded overflow-hidden">
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
                            filterPrefix="2-"
                            placeholder="Pilih akun kewajiban…"
                          />
                        </td>
                        <td className="px-3 py-2 w-36">
                          <NumberInput
                            value={line.amount}
                            onChange={(n) => updateLainLain(idx, { amount: n })}
                            allowDecimal={false}
                            className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-right text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={line.notes}
                            onChange={(e) => updateLainLain(idx, { notes: e.target.value })}
                            placeholder="Keterangan…"
                            className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-caleo-gold"
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
              className="text-[12px] text-[var(--color-caleo-primary)] font-semibold hover:underline"
            >
              + Tambah Baris
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
