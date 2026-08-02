import React, { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { StockItem } from '../../../types';

interface StockPickerProps {
  stockList: StockItem[];
  onPick: (stock: StockItem) => void;
  placeholder?: string;
}

export default function StockPicker({ stockList, onPick, placeholder }: StockPickerProps) {
  const [search, setSearch] = useState('');

  const suggestions = useMemo(() => {
    if (search.length === 0) return [];
    const q = search.toLowerCase();
    return stockList
      .filter(s => s.sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [stockList, search]);

  function handlePick(stock: StockItem) {
    onPick(stock);
    setSearch('');
  }

  return (
    <div className="relative">
      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded pl-9 pr-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
        placeholder={placeholder ?? 'Cari produk untuk tambah...'}
      />
      {suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-20 bg-white border border-gray-200 rounded shadow-lg mt-1 overflow-hidden">
          {suggestions.map(s => (
            <button
              key={s.sku}
              type="button"
              onClick={() => handlePick(s)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-indigo-50 text-left border-b border-gray-100 last:border-b-0"
            >
              <span className="font-semibold text-gray-800">{s.name}</span>
              <span className="font-mono text-gray-400">{s.sku}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
