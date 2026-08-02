// src/components/rekonsiliasi/NextActionBanner.tsx
import React from 'react';

interface Props {
  reviewCount: number;
  cashPending: number;
  piutangCount: number;
  onStart: () => void;
  onClose: () => void;
}

export default function NextActionBanner({ reviewCount, cashPending, piutangCount, onStart, onClose }: Props) {
  let text = '✓ Semua sudah punya pasangan! Siap tutup buku';
  let detail = 'Klik "Tutup buku" untuk generate PDF closing dan lock periode';
  let cta = 'Tutup buku →';
  let onClick = onClose;
  let success = true;

  if (reviewCount > 0) {
    text = `Review ${reviewCount} baris mutasi yang perlu konfirmasi manual`;
    detail = 'Klik tombol "Cari pasangan →" merah/kuning di kolom Mutasi. Mulai dari skor tertinggi.';
    cta = 'Mulai →';
    onClick = onStart;
    success = false;
  } else if (cashPending > 0) {
    text = `Verifikasi ${cashPending} batch kas — apakah sudah disetor ke bank?`;
    detail = 'Untuk setiap batch K⏳: cari setoran tunai di mutasi, atau tandai "carryover ke bulan depan"';
    cta = 'Verifikasi kas →';
    onClick = onStart;
    success = false;
  } else if (piutangCount > 0) {
    text = `Tindak ${piutangCount} piutang — extend tempo atau write-off`;
    detail = 'Total piutang ditampilkan di kolom Order Penjualan. Klik order untuk Geser tempo atau Write-off.';
    cta = 'Cek piutang →';
    onClick = onStart;
    success = false;
  }

  const bg = success
    ? 'linear-gradient(135deg,#059669 0%,#047857 100%)'
    : 'linear-gradient(135deg,#012749 0%,#1e3d60 100%)';

  return (
    <div
      className="flex items-center justify-between gap-5 p-5 rounded-sm text-white shadow-lg"
      style={{ background: bg }}
    >
      <div className="flex items-center gap-3">
        <div className="text-3xl">🎯</div>
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Langkah selanjutnya</div>
          <div className="text-base font-black mt-0.5">{text}</div>
          <div className="text-[11px] font-semibold mt-0.5 opacity-80">{detail}</div>
        </div>
      </div>
      <button
        onClick={onClick}
        className="bg-gradient-to-r from-emerald-500 to-emerald-700 text-white px-6 py-2.5 rounded-full text-xs font-extrabold shadow-md"
      >
        {cta}
      </button>
    </div>
  );
}
