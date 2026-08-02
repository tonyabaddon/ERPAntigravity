import React, { useState, useRef, useEffect } from 'react';
import { X, GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { KasirExpenseCategoryRow } from '../../lib/kasirExpenseCategoryService';

interface Props {
  row: KasirExpenseCategoryRow;
  isEditable: boolean;
  onLabelSubmit: (newLabel: string) => void;
  onActiveToggle: (newActive: boolean) => void;
  onDelete: () => void;
}

export default function CategoryRow({ row, isEditable, onLabelSubmit, onActiveToggle, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: row.id });
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(row.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const startEdit = () => {
    if (!isEditable) return;
    setDraft(row.label);
    setIsEditing(true);
  };

  const submitLabel = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== row.label) {
      onLabelSubmit(trimmed);
    }
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setDraft(row.label);
    setIsEditing(false);
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`category-row-${row.id}`}
      className={`flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 ${!row.active ? 'opacity-50' : ''}`}
    >
      {isEditable && (
        <button
          {...attributes}
          {...listeners}
          aria-label="Ubah urutan kategori"
          className="text-slate-300 cursor-grab active:cursor-grabbing p-1"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      )}

      <div className="flex-1">
        {isEditing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submitLabel();
              else if (e.key === 'Escape') cancelEdit();
            }}
            onBlur={cancelEdit}
            className="w-full bg-white rounded-sm px-2 py-1 border border-slate-300 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#012749]"
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="text-xs font-semibold text-slate-800 hover:text-[#012749] text-left w-full"
            disabled={!isEditable}
          >
            {row.label}
          </button>
        )}
      </div>

      {isEditable && (
        <>
          <button
            type="button"
            role="switch"
            aria-checked={row.active}
            aria-label={`Toggle aktif ${row.label}`}
            onClick={() => onActiveToggle(!row.active)}
            className={`relative w-9 h-5 rounded-full transition-colors ${row.active ? 'bg-[#2d8a4e]' : 'bg-slate-200'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${row.active ? 'translate-x-4' : ''}`}
            />
          </button>

          <button
            type="button"
            aria-label={`Hapus kategori ${row.label}`}
            onClick={onDelete}
            className="text-slate-400 hover:text-red-600 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );
}
