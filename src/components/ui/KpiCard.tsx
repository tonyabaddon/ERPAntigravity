// src/components/ui/KpiCard.tsx
//
// Canonical KPI card used by Dashboard / Laporan / Pembelian. Lifted from
// the file-local helper in LaporanScreen so the visual is the same
// everywhere it's shown.

import React from 'react';

export interface KpiCardProps {
  icon: React.ReactNode;       // lucide icon element, e.g. <ShoppingCart className="w-6 h-6" />
  iconBg: string;              // tailwind class, e.g. 'bg-blue-50'
  iconColor: string;           // tailwind class, e.g. 'text-[#1e3d60]'
  badge: string;
  badgeClass: string;          // tailwind class, e.g. 'bg-blue-50 text-[#1e3d60]'
  label: string;
  value: string;
  sub: string;
  alarming?: boolean;          // when true: card uses rose-tinted bg (for cards like Terlambat Bayar)
}

export default function KpiCard({
  icon, iconBg, iconColor, badge, badgeClass,
  label, value, sub, alarming = false,
}: KpiCardProps) {
  const cardCls = alarming
    ? 'bg-rose-50/50 border-rose-100 shadow-rose-50/50'
    : 'bg-white border-[#e5eeff] shadow-primary/5';
  return (
    <div className={`rounded-3xl p-6 border shadow-lg hover:translate-y-[-4px] transition-all duration-300 ${cardCls}`}>
      <div className="flex justify-between items-start mb-4">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${iconBg} ${iconColor}`}>
          {icon}
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badgeClass}`}>{badge}</span>
      </div>
      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest block">{label}</span>
      <h3 className="text-[#012749] font-extrabold text-2xl tracking-tight mt-1">{value}</h3>
      <p className="text-sm text-[#43474e] mt-2 leading-snug">{sub}</p>
    </div>
  );
}
