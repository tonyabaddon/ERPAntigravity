import React from 'react';
import ServiceCatalogList from './layanan/ServiceCatalogList';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function LayananPanel({ showToast }: Props) {
  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-3">
        <h2 className="text-base font-extrabold text-[var(--color-caleo-primary)]">
          🛠 Layanan
        </h2>
        <p className="text-caleo-13 text-slate-500 mt-1">
          Katalog layanan yang bisa dijual — panel wiring, jasa custom, dst.
          BOM link ke stok komponen.
        </p>
      </div>
      <ServiceCatalogList showToast={showToast} />
    </div>
  );
}
