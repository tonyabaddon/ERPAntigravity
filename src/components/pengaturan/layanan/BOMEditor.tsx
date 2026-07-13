import React, { useState } from 'react';
import type { ServiceCatalogBOMItem } from '../../../lib/serviceCatalog/types';
import { NumberInput } from '../../ui/NumberInput';
import ComponentPicker from './ComponentPicker';

interface Props {
  value: ServiceCatalogBOMItem[];
  onChange: (bom: ServiceCatalogBOMItem[]) => void;
  qtyLabel?: string;
}

export default function BOMEditor({
  value,
  onChange,
  qtyLabel = 'Qty',
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  function addItem(sku: string, name: string) {
    onChange([
      ...value,
      {
        component_sku: sku,
        component_name: name,
        default_qty: 1,
        notes: null,
        sort_order: value.length,
      },
    ]);
  }

  function updateItem(idx: number, patch: Partial<ServiceCatalogBOMItem>) {
    onChange(value.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <div className="text-[12px] text-slate-500 border border-dashed border-slate-300 rounded-lg px-4 py-3 text-center">
          BOM kosong — layanan ini akan diperlakukan sebagai labor-only atau
          custom mode.
        </div>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">
                  SKU / Nama
                </th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600 w-24">
                  {qtyLabel}
                </th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">
                  Catatan
                </th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {value.map((item, idx) => (
                <tr key={idx} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-[#012749]">
                      {item.component_name ?? item.component_sku}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      SKU: {item.component_sku}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <NumberInput
                      value={item.default_qty}
                      onChange={(n) => updateItem(idx, { default_qty: n })}
                      allowDecimal={true}
                      className="w-20 border border-slate-200 rounded px-2 py-1 text-right text-[13px]"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={item.notes ?? ''}
                      onChange={(e) =>
                        updateItem(idx, { notes: e.target.value || null })
                      }
                      placeholder="opsional"
                      className="w-full border border-slate-200 rounded px-2 py-1 text-[13px]"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => removeItem(idx)}
                      className="text-rose-500 hover:text-rose-700"
                      title="Hapus"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="text-[13px] font-semibold text-[#012749] hover:opacity-80"
      >
        + Tambah Komponen dari Master Stok
      </button>
      {pickerOpen && (
        <ComponentPicker
          onPick={addItem}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
