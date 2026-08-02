import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, Plus, ChevronRight, Package } from 'lucide-react';
import EmptyState from '../../ui/EmptyState';
import { DbSupplier, DbPurchaseOrder } from '../../../types';

interface SupplierPickerProps {
  suppliers: DbSupplier[];
  orders: DbPurchaseOrder[];          // for usage-frequency sort
  selectedSupplierId: string;
  onSelect: (supplier: DbSupplier) => void;
  onCreateNew: (prefilledName: string) => void;  // opens InlineSupplierForm in parent
}

export default function SupplierPicker({
  suppliers, orders, selectedSupplierId, onSelect, onCreateNew,
}: SupplierPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const supplierUsageCount = useMemo(() => {
    const counts = new Map<string, number>();
    orders.forEach(po => counts.set(po.supplier_id, (counts.get(po.supplier_id) ?? 0) + 1));
    return counts;
  }, [orders]);

  const sortedSuppliers = useMemo(() =>
    [...suppliers].sort((a, b) =>
      (supplierUsageCount.get(b.id) ?? 0) - (supplierUsageCount.get(a.id) ?? 0)
    ),
    [suppliers, supplierUsageCount]
  );

  const filtered = useMemo(() => {
    if (!search) return sortedSuppliers;
    const q = search.toLowerCase();
    return sortedSuppliers.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.contact_name ?? '').toLowerCase().includes(q)
    );
  }, [sortedSuppliers, search]);

  const selected = suppliers.find(s => s.id === selectedSupplierId);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function highlight(text: string): React.ReactNode {
    if (!search) return text;
    const i = text.toLowerCase().indexOf(search.toLowerCase());
    if (i === -1) return text;
    return (
      <>
        {text.slice(0, i)}
        <mark className="bg-amber-200 px-0.5 rounded">{text.slice(i, i + search.length)}</mark>
        {text.slice(i + search.length)}
      </>
    );
  }

  function handleSelect(supplier: DbSupplier) {
    onSelect(supplier);
    setOpen(false);
    setSearch('');
  }

  function handleCreate() {
    onCreateNew(search);
    setOpen(false);
    setSearch('');
  }

  // Render: showing selected (compact) vs picker (search box + dropdown)
  if (selected && !open) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full text-sm border border-gray-200 rounded pl-9 pr-3 py-2.5 bg-white relative flex items-center text-left hover:border-indigo-300"
        >
          <Search className="w-4 h-4 text-gray-400 absolute left-3" />
          <span className="text-base mr-2">🏪</span>
          <span className="flex-1">
            <span className="block text-sm font-semibold text-gray-800">{selected.name}</span>
            <span className="block text-caleo-11 text-gray-500">
              {selected.contact_name ? `${selected.contact_name} · ` : ''}
              {selected.phone ? `${selected.phone} · ` : ''}
              {selected.payment_term_days === 0 ? 'Cash' : `Net ${selected.payment_term_days} hari`}
            </span>
          </span>
          <span className="text-caleo-11 font-semibold text-indigo-600 ml-2">Ganti</span>
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3 z-10" />
      <input
        type="text"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Cari supplier..."
        className="w-full text-sm border-2 border-indigo-300 rounded pl-9 pr-3 py-2.5 focus-visible:outline-none bg-white"
      />

      {open && (
        <div className="absolute top-full left-0 right-0 z-20 bg-white border border-gray-200 rounded shadow-xl mt-1 overflow-hidden">
          <div className="max-h-72 overflow-y-auto">
            {suppliers.length === 0 ? (
              // State A: Empty DB
              <EmptyState
                message="Belum ada supplier"
                hint="Buat supplier pertama untuk mulai PO."
                icon={Package}
                inline
              />
            ) : filtered.length === 0 ? (
              // State D: Typed, no match
              <EmptyState
                message={`Tidak ada supplier dengan nama "${search}".`}
                inline
              />
            ) : (
              <>
                {/* State B/C: List with optional header */}
                <div className="px-3 py-1.5 bg-gray-50 text-caleo-10 font-bold uppercase tracking-wider text-gray-500 border-b border-gray-100">
                  {search ? `${filtered.length} Hasil` : 'Sering Dipakai'}
                </div>
                {filtered.map((s, idx) => {
                  const usage = supplierUsageCount.get(s.id) ?? 0;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleSelect(s)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-indigo-50 text-left ${idx > 0 ? 'border-t border-gray-100' : ''}`}
                    >
                      <span className="text-base">🏪</span>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-gray-800">{highlight(s.name)}</div>
                        <div className="text-caleo-11 text-gray-500">
                          {s.contact_name ? `${s.contact_name} · ` : ''}
                          {s.payment_term_days === 0 ? 'Cash' : `Net ${s.payment_term_days}`}
                        </div>
                      </div>
                      {usage > 0 && (
                        <span className={`text-caleo-10 font-bold px-2 py-0.5 rounded-full ${usage >= 3 ? 'text-emerald-700 bg-emerald-50' : 'text-gray-500 bg-gray-100'}`}>
                          {usage} PO
                        </span>
                      )}
                    </button>
                  );
                })}
              </>
            )}
          </div>

          {/* Pinned CTA: always visible */}
          <div className="border-t-2 border-gray-100 bg-indigo-50 px-3 py-2.5 sticky bottom-0">
            <button
              type="button"
              onClick={handleCreate}
              className="w-full flex items-center gap-2.5 text-left"
            >
              <div className={`rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold ${suppliers.length === 0 || filtered.length === 0 ? 'w-8 h-8 text-base' : 'w-7 h-7 text-sm'}`}>
                <Plus className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold text-indigo-700">
                  {suppliers.length === 0
                    ? 'Tambah supplier pertama'
                    : search
                      ? <>Buat baru: <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-indigo-200 text-indigo-700">"{search}"</span></>
                      : 'Tambah supplier baru'}
                </div>
                <div className="text-caleo-11 text-indigo-500">
                  {filtered.length === 0 && search
                    ? 'Nama otomatis terisi, tinggal lengkapi kontak & term'
                    : 'Tidak ada di list? Buat di sini tanpa keluar dari PO'}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-indigo-500" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
