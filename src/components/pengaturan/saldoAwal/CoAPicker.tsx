// CoAPicker.tsx
// Reusable searchable dropdown for Chart of Accounts.
// Searches by account_code or account_name. Optional filterPrefix restricts
// to specific account type prefixes (e.g. '1-' = Aktiva, '2-' = Kewajiban).
// Only shows is_active accounts; excludes Income/Expense for opening balance context.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';

export interface CoaOption {
  coa_code: string;
  coa_name: string;
}

interface CoaPickerProps {
  value: CoaOption | null;
  onChange: (opt: CoaOption | null) => void;
  filterPrefix?: string; // e.g. '1-', '2-', '3-'
  placeholder?: string;
  disabled?: boolean;
}

interface CoaRow {
  account_code: string;
  account_name: string;
}

export default function CoAPicker({
  value,
  onChange,
  filterPrefix,
  placeholder = 'Cari kode atau nama akun…',
  disabled = false,
}: CoaPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CoaRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (!supabase) return;
    setLoading(true);
    try {
      let qb = supabase
        .from('chart_of_accounts')
        .select('account_code, account_name')
        .eq('is_active', true)
        // Opening balance only applies to balance sheet accounts
        .not('account_code', 'like', '4-%')
        .not('account_code', 'like', '5-%')
        .not('account_code', 'like', '6-%');

      if (filterPrefix) {
        qb = qb.like('account_code', `${filterPrefix}%`);
      }

      if (q.trim()) {
        qb = qb.or(`account_code.ilike.%${q}%,account_name.ilike.%${q}%`);
      }

      const { data, error } = await qb.order('account_code').limit(30);
      if (!error) setResults((data ?? []) as CoaRow[]);
    } finally {
      setLoading(false);
    }
  }, [filterPrefix]);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void search(v); }, 250);
  };

  const handleFocus = () => {
    setOpen(true);
    if (results.length === 0) void search(query);
  };

  const handleSelect = (row: CoaRow) => {
    onChange({ coa_code: row.account_code, coa_name: row.account_name });
    setQuery(`${row.account_code} — ${row.account_name}`);
    setOpen(false);
  };

  const handleClear = () => {
    onChange(null);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Sync display when value changes externally
  useEffect(() => {
    if (value) {
      setQuery(`${value.coa_code} — ${value.coa_name}`);
    } else {
      setQuery('');
    }
  }, [value]);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={query}
          onChange={handleInput}
          onFocus={handleFocus}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full border border-slate-200 rounded px-3 py-1.5 text-caleo-13 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 disabled:bg-slate-50 disabled:cursor-not-allowed"
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="text-slate-400 hover:text-slate-600 text-lg leading-none px-1"
            title="Hapus"
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded shadow-lg max-h-52 overflow-y-auto">
          {loading ? (
            <div className="px-3 py-2 text-xs text-slate-400">Mencari…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">
              {query ? 'Tidak ada hasil.' : 'Ketik untuk cari…'}
            </div>
          ) : (
            results.map((row) => (
              <div
                key={row.account_code}
                className="px-3 py-2 hover:bg-slate-50 cursor-pointer flex items-center gap-2 text-caleo-13"
                onMouseDown={(e) => { e.preventDefault(); handleSelect(row); }}
              >
                <span className="font-mono text-slate-500 shrink-0">{row.account_code}</span>
                <span className="text-slate-800 truncate">{row.account_name}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
