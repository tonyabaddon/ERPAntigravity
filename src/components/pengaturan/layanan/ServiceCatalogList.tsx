import React, { useEffect, useState } from 'react';
import type { ServiceCatalogEntry } from '../../../lib/serviceCatalog/types';
import {
  listServiceCatalog,
  deactivateServiceCatalog,
} from '../../../lib/serviceCatalog/api';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';
import { formatIDR } from '../../../lib/formatIDR';
import ServiceCatalogEditModal from './ServiceCatalogEditModal';
import LoadingState from '../../ui/LoadingState';
import EmptyState from '../../ui/EmptyState';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function ServiceCatalogList({ showToast }: Props) {
  const [items, setItems] = useState<ServiceCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ServiceCatalogEntry | null | 'new'>(
    null,
  );

  async function load() {
    setLoading(true);
    try {
      setItems(await listServiceCatalog());
    } catch (err) {
      showToast(`Gagal memuat: ${extractErrorMessage(err)}`, 'warning');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleDeactivate(item: ServiceCatalogEntry) {
    if (!confirm(`Nonaktifkan "${item.name}"?`)) return;
    try {
      await deactivateServiceCatalog(item.id);
      showToast('Layanan dinonaktifkan', 'success');
      await load();
    } catch (err) {
      showToast(`Gagal: ${extractErrorMessage(err)}`, 'warning');
    }
  }

  const activeItems = items.filter((i) => i.is_active);
  const grouped = activeItems.reduce(
    (acc, item) => {
      const cat = item.category ?? 'Lainnya';
      if (!acc.has(cat)) acc.set(cat, []);
      acc.get(cat)!.push(item);
      return acc;
    },
    new Map<string, ServiceCatalogEntry[]>(),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-[var(--color-caleo-primary)]">
            Katalog Layanan
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Setup layanan yang bisa dijual — Wiring Panel, Custom Panel, Jasa
            dll. BOM link ke stok komponen.
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="px-4 py-2 text-caleo-13 font-bold bg-[var(--color-caleo-primary)] text-white rounded hover:opacity-90"
        >
          + Tambah Layanan
        </button>
      </div>

      {loading ? (
        <LoadingState label="Memuat…" />
      ) : activeItems.length === 0 ? (
        <EmptyState
          message="Belum ada layanan"
          hint="Klik &quot;+ Tambah Layanan&quot; untuk setup layanan pertama."
          action={{ label: '+ Tambah Layanan', onClick: () => setEditing('new') }}
        />
      ) : (
        Array.from(grouped.entries()).map(([cat, catItems]) => (
          <div key={cat} className="space-y-2">
            <div className="text-caleo-11 font-bold text-slate-500 uppercase tracking-wider">
              {cat}
            </div>
            <div className="space-y-2">
              {catItems.map((item) => (
                <div
                  key={item.id}
                  className="border border-slate-200 rounded px-4 py-3 flex items-center justify-between hover:border-[var(--color-caleo-primary)]/30"
                >
                  <div>
                    <div className="text-sm font-bold text-[var(--color-caleo-primary)]">
                      {item.name}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Labor: {formatIDR(item.default_labor_amount)} · BOM:{' '}
                      {item.bom.length} komponen ·{' '}
                      {item.invoice_display === 'lump_sum'
                        ? 'Lump Sum'
                        : 'Itemized'}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditing(item)}
                      className="px-3 py-1.5 text-xs font-semibold text-[var(--color-caleo-primary)] hover:bg-slate-50 rounded"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeactivate(item)}
                      className="px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded"
                    >
                      Nonaktif
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {editing !== null && (
        <ServiceCatalogEditModal
          initial={editing === 'new' ? null : editing}
          onDone={async () => {
            setEditing(null);
            await load();
          }}
          onCancel={() => setEditing(null)}
          showToast={showToast}
        />
      )}
    </div>
  );
}
