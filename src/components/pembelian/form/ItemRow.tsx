import React from 'react';
import { Trash2 } from 'lucide-react';
import { PoItemDraft } from '../../../lib/pembelianService';
import { formatIDR } from '../../../lib/formatIDR';

interface ItemRowProps {
  item: PoItemDraft;
  onChange: (patch: Partial<PoItemDraft>) => void;
  onRemove: () => void;
}


const ItemRow: React.FC<ItemRowProps> = ({ item, onChange, onRemove }) => {
  function updateQty(value: string) {
    const qty = parseFloat(value) || 0;
    onChange({ qty, subtotal: qty * item.unit_cost });
  }

  function updateUnitCost(value: string) {
    const unit_cost = parseFloat(value) || 0;
    onChange({ unit_cost, subtotal: item.qty * unit_cost });
  }

  return (
    <div className="grid grid-cols-12 px-4 py-3 border-b border-gray-100 items-center hover:bg-gray-50">
      <span className="col-span-2 font-mono text-xs text-gray-500">{item.sku}</span>
      <span className="col-span-4 text-sm font-semibold text-gray-800">{item.product_name}</span>
      <div className="col-span-2 flex justify-center">
        <input
          type="number"
          min="1"
          value={item.qty}
          onChange={(e) => updateQty(e.target.value)}
          className="w-16 text-center text-sm font-semibold border border-gray-200 rounded-sm px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>
      <div className="col-span-2 flex justify-end">
        <div className="relative w-32">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">Rp</span>
          <input
            type="number"
            min="0"
            value={item.unit_cost || ''}
            onChange={(e) => updateUnitCost(e.target.value)}
            placeholder="0"
            className="w-full text-right text-sm border border-gray-200 rounded-sm pl-7 pr-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
      </div>
      <span className="col-span-1 text-right text-sm font-bold text-gray-800">
        {formatIDR(item.subtotal)}
      </span>
      <div className="col-span-1 flex justify-end">
        <button
          type="button"
          onClick={onRemove}
          className="text-rose-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default ItemRow;
