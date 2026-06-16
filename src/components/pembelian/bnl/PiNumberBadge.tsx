import React from 'react';

export default function PiNumberBadge({ piNumber, onClick }: { piNumber: string; onClick?: () => void }) {
  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
        onClick ? 'cursor-pointer hover:underline' : ''
      }`}
      style={{ background: 'linear-gradient(135deg, #ede9fe 0%, #f5f3ff 100%)', color: '#5b21b6' }}
    >
      ⚡ {piNumber}
    </span>
  );
}
