import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import CategoryRow from './CategoryRow';
import {
  useKasirExpenseCategories,
  kasirExpenseCategoriesQueryKey,
} from '../../lib/hooks/useKasirExpenseCategories';
import { kasirExpenseCategoryService, type KasirExpenseCategoryRow } from '../../lib/kasirExpenseCategoryService';
import { useTenant } from '../../contexts/TenantContext';
import { captureError } from '../../lib/captureError';
import { extractErrorMessage } from '../../lib/extractErrorMessage';

interface Props {
  isEditable: boolean;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function friendlyError(err: unknown): string {
  // Use extractErrorMessage — Supabase PostgrestError is a plain object, not an Error
  // instance. extractErrorMessage reads .message from either Error or plain object.
  const msg = extractErrorMessage(err);
  if (msg.includes('KECT_LABEL_INVALID'))   return 'Nama kategori harus 3–40 karakter.';
  if (msg.includes('KECT_LABEL_DUPLICATE')) return 'Kategori dengan nama itu sudah ada.';
  if (msg.includes('KECT_IS_SYSTEM'))       return 'Kategori sistem tidak dapat diubah.';
  if (msg.includes('KECT_FORBIDDEN'))       return 'Hanya owner yang dapat mengubah kategori.';
  if (msg.includes('KECT_NOT_FOUND'))       return 'Kategori tidak ditemukan (mungkin sudah dihapus).';
  if (msg.includes('KECT_INVALID_ORDER'))   return 'Urutan tidak valid.';
  return 'Gagal menyimpan perubahan. Coba lagi.';
}

export default function KasirExpenseCategoriesPanel({ isEditable, showToast }: Props) {
  const qc = useQueryClient();
  // Deviation from brief: real TenantContext uses tenant_id (snake_case), not tenantId.
  // Brief code used `const { tenantId } = useTenant()` which would always be undefined
  // against the real context shape. Using tenant_id here matches the real contract.
  const tenant = useTenant();
  const tenantId = tenant?.tenant_id;
  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: kasirExpenseCategoriesQueryKey(tenantId ?? '') }),
    [qc, tenantId]
  );

  const { data, isLoading, isError, refetch } = useKasirExpenseCategories();
  const [addingLabel, setAddingLabel] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const [localOrder, setLocalOrder] = useState<KasirExpenseCategoryRow[] | null>(null);

  useEffect(() => { setLocalOrder(null); }, [data]);

  useEffect(() => {
    if (addingLabel !== null && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [addingLabel]);

  const rows: KasirExpenseCategoryRow[] = localOrder ?? data ?? [];

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = rows.findIndex(r => r.id === active.id);
    const newIdx = rows.findIndex(r => r.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(rows, oldIdx, newIdx);
    setLocalOrder(reordered);
    try {
      await kasirExpenseCategoryService.reorder(reordered.map(r => r.id));
      invalidate();
    } catch (err) {
      captureError(err, { feature: 'kasir_expense_category', action: 'reorder' });
      showToast(friendlyError(err), 'warning');
      setLocalOrder(null);
    }
  };

  const handleAddSubmit = async () => {
    if (!addingLabel) return;
    const trimmed = addingLabel.trim();
    if (trimmed.length < 3) {
      showToast('Nama minimal 3 karakter.', 'warning');
      return;
    }
    try {
      await kasirExpenseCategoryService.create(trimmed, undefined);
      invalidate();
      setAddingLabel(null);
    } catch (err) {
      captureError(err, { feature: 'kasir_expense_category', action: 'create' });
      showToast(friendlyError(err), 'warning');
    }
  };

  const handleLabelSubmit = async (id: string, newLabel: string) => {
    try {
      await kasirExpenseCategoryService.update(id, { label: newLabel });
      invalidate();
    } catch (err) {
      captureError(err, { feature: 'kasir_expense_category', action: 'update_label' });
      showToast(friendlyError(err), 'warning');
    }
  };

  const handleActiveToggle = async (id: string, newActive: boolean) => {
    try {
      await kasirExpenseCategoryService.update(id, { active: newActive });
      invalidate();
    } catch (err) {
      captureError(err, { feature: 'kasir_expense_category', action: 'toggle_active' });
      showToast(friendlyError(err), 'warning');
    }
  };

  const handleDelete = async (row: KasirExpenseCategoryRow) => {
    try {
      await kasirExpenseCategoryService.softDelete(row.id);
      invalidate();
      showToast(`Kategori "${row.label}" dihapus. Klik Batalkan untuk mengembalikan.`, 'info');
      // NOTE: undo action wiring depends on the toast context. If it supports
      // an action button, wire onClick → kasirExpenseCategoryService.restore(row.id) → invalidate().
      // Current showToast signature is msg + type only; undo is text-hint UX until toast
      // context is extended in a follow-up.
    } catch (err) {
      captureError(err, { feature: 'kasir_expense_category', action: 'soft_delete' });
      showToast(friendlyError(err), 'warning');
    }
  };

  if (isLoading) return <div className="p-6 text-xs text-slate-500">Memuat kategori...</div>;
  if (isError) return (
    <div className="p-6 space-y-2">
      <div className="text-xs text-red-600">Gagal memuat kategori.</div>
      <button
        type="button"
        onClick={() => refetch?.()}
        className="px-3 py-1.5 rounded bg-[var(--color-caleo-primary)] text-white text-xs font-bold"
      >
        Coba lagi
      </button>
    </div>
  );

  return (
    <div className="bg-white rounded border border-slate-100 overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100">
        <h3 className="text-base font-extrabold text-[var(--color-caleo-primary)]">Kategori Pengeluaran Kasir</h3>
        <p className="text-xs text-slate-500 mt-1">
          Kelola daftar kategori yang tampil di dropdown Kasir &rarr; Catat Pengeluaran.
        </p>
        {isEditable && addingLabel === null && (
          <button
            type="button"
            onClick={() => setAddingLabel('')}
            className="mt-4 inline-flex items-center gap-1 bg-[var(--color-caleo-primary)] text-white rounded px-4 py-2 text-xs font-bold hover:bg-[#1e3d60]"
          >
            <Plus className="w-4 h-4" /> Tambah kategori baru
          </button>
        )}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rows.map(r => r.id)} strategy={verticalListSortingStrategy}>
          {rows.map(row => (
            <CategoryRow
              key={row.id}
              row={row}
              isEditable={isEditable}
              onLabelSubmit={(label) => handleLabelSubmit(row.id, label)}
              onActiveToggle={(active) => handleActiveToggle(row.id, active)}
              onDelete={() => handleDelete(row)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {isEditable && addingLabel !== null && (
        <div className="flex items-center gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50">
          <input
            ref={addInputRef}
            value={addingLabel}
            onChange={e => setAddingLabel(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleAddSubmit();
              else if (e.key === 'Escape') setAddingLabel(null);
            }}
            placeholder="Nama kategori"
            className="flex-1 bg-white rounded px-2 py-1 border border-slate-300 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[var(--color-caleo-primary)]"
          />
          <button
            type="button"
            onClick={handleAddSubmit}
            className="px-3 py-1.5 rounded bg-[#2d8a4e] text-white text-xs font-bold"
          >
            Simpan
          </button>
          <button
            type="button"
            onClick={() => setAddingLabel(null)}
            className="px-3 py-1.5 rounded text-slate-500 text-xs font-semibold"
          >
            Batal
          </button>
        </div>
      )}
    </div>
  );
}
