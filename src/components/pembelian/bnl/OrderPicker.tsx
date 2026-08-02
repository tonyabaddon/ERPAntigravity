// OrderPicker — search Sales Orders by id (orders.order_number doesn't exist;
// match against id::text per C4 correction).
import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { shortOrderRef } from '../../../lib/purchaseInvoiceService';

interface OrderPickerProps {
  value: { id: string; customer_name?: string } | null;
  onChange: (v: { id: string; customer_name?: string } | null) => void;
}

export default function OrderPicker({ value, onChange }: OrderPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ id: string; customer_name?: string }>>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!query || query.length < 2 || !supabase) { setResults([]); return; }
    const t = setTimeout(async () => {
      // PostgREST .or() doesn't support `id::text.ilike` cast syntax. Search
      // primarily by customer_name. For UUID-prefix lookup, fall back to
      // exact-prefix match on the id field (Postgres handles uuid LIKE).
      const isUuidish = /^[0-9a-f-]+$/i.test(query) && query.length >= 4;
      const orFilter = isUuidish
        ? `id.eq.${query},customer_name.ilike.%${query}%`
        : `customer_name.ilike.%${query}%`;
      const { data, error } = await supabase!.from('orders')
        .select('id, customer_name')
        .or(orFilter)
        .order('created_at', { ascending: false }).limit(20);
      if (error) {
        console.warn('OrderPicker search error:', error.message);
        setResults([]);
        return;
      }
      setResults((data ?? []) as Array<{ id: string; customer_name?: string }>);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  if (value) {
    return (
      <div className="border-2 border-indigo-300 bg-indigo-50/40 rounded-sm p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-bold text-sm" style={{ color: 'var(--color-caleo-primary)' }}>{shortOrderRef(value.id)}</div>
            {value.customer_name && <div className="text-xs text-gray-600 mt-0.5">{value.customer_name}</div>}
          </div>
          <button type="button" onClick={() => onChange(null)}
            className="text-xs font-semibold text-indigo-600 hover:underline">
            Ganti
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <input
          value={query} onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Cari Order (UUID atau nama customer)..."
          className="w-full text-sm py-2 pl-9 pr-3 rounded-sm border border-gray-300 focus:outline-none focus:border-indigo-500"
        />
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-auto bg-white rounded-sm border border-gray-200 shadow-lg">
          {results.map(r => (
            <button key={r.id} type="button"
              onMouseDown={() => onChange(r)}
              className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-100 last:border-0">
              <div className="font-semibold text-sm">{shortOrderRef(r.id)}</div>
              {r.customer_name && <div className="text-xs text-gray-500">{r.customer_name}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
