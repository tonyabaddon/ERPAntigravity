/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  BellRing, 
  Clock, 
  PhoneCall, 
  CheckSquare, 
  Square,
  TrendingUp,
  AlertTriangle,
  Flame,
  Save,
  CheckCircle2
} from 'lucide-react';
import { NotificationConfig } from '../types';

interface NotificationSettingsScreenProps {
  config: NotificationConfig;
  onConfigChange: (updated: NotificationConfig) => void;
  showToast: (msg: string) => void;
}

export default function NotificationSettingsScreen({ config, onConfigChange, showToast }: NotificationSettingsScreenProps) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [interval, setIntervalVal] = useState(config.interval);

  // Checkboxes
  const [revenueChecked, setRevenueChecked] = useState(config.reportComponents.revenue);
  const [queueChecked, setQueueChecked] = useState(config.reportComponents.queue);
  const [activityChecked, setActivityChecked] = useState(config.reportComponents.activity);
  const [statusChecked, setStatusChecked] = useState(config.reportComponents.status);

  // Limit alert thresholds
  const [lowStockLimit, setLowStockLimit] = useState(config.lowStockAlert);
  const [delayLimit, setDelayLimit] = useState(config.delayAlert);

  const handleSave = () => {
    const updated: NotificationConfig = {
      enabled,
      interval,
      reportComponents: {
        revenue: revenueChecked,
        queue: queueChecked,
        activity: activityChecked,
        status: statusChecked
      },
      lowStockAlert: lowStockLimit,
      delayAlert: delayLimit
    };
    onConfigChange(updated);
    
    // Display the success banner as shown in screen 5
    showToast("✅ Pengaturan Berhasil Disimpan! Sistem 'Detak Jantung' otomatis aktif.");
  };

  return (
    <div className="space-y-8 animate-fadeIn pb-24">
      {/* Upper Brand Info card */}
      <section className="bg-white rounded-[2.5rem] p-8 border border-[#e5eeff] shadow-xl">
        <div className="flex flex-col gap-6">
          <div className="max-w-4xl">
            <div className="flex items-center gap-4 mb-5">
              <div className="w-14 h-14 bg-blue-50 text-[#012749] rounded-2xl flex items-center justify-center shadow-lg shadow-blue-105/5">
                <span className="material-symbols-outlined text-[32px]">monitor_heart</span>
              </div>
              <div>
                <h2 className="text-[#012749] font-extrabold text-xl tracking-tight">
                  Konfigurasi Notifikasi Detak Jantung Otomatis
                </h2>
                <p className="text-xs text-gray-400 mt-1 uppercase font-extrabold tracking-widest">
                  MSME WHATSAPP REPORT ENGINE
                </p>
              </div>
            </div>

            <p className="text-sm text-[#43474e] mb-8 leading-relaxed font-medium">
              Sistem akan mengirimkan rangkuman performa toko kelistrikan Anda secara berkala langsung ke nomor WhatsApp Pemilik Bisnis (Owner) tanpa perlu membuka aplikasi secara manual.
            </p>

            {/* Config controls Grid matching screen 5 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Box 1: Status */}
              <div className="bg-[#eff4ff]/60 p-6 rounded-3xl flex flex-col justify-between hover:bg-white hover:shadow-lg hover:border-slate-100 border border-transparent transition-all group select-none">
                <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest mb-4">Status Layanan</span>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-extrabold text-[#012749]">Aktifkan Laporan</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => setEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#2d8a4e]" />
                  </label>
                </div>
              </div>

              {/* Box 2: Interval */}
              <div className="bg-[#eff4ff]/60 p-6 rounded-3xl flex flex-col justify-between hover:bg-white hover:shadow-lg hover:border-slate-100 border border-transparent transition-all group cursor-pointer relative">
                <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest mb-4">Interval Pengiriman</span>
                <div className="relative">
                  <select 
                    value={interval}
                    onChange={(e) => setIntervalVal(e.target.value)}
                    className="w-full bg-transparent border-none text-sm font-extrabold text-[#012749] p-0 focus:ring-0 appearance-none cursor-pointer outline-none"
                  >
                    <option value="Setiap 1 Jam">Setiap 1 Jam</option>
                    <option value="Setiap 4 Jam">Setiap 4 Jam</option>
                    <option value="Setiap 12 Jam">Setiap 12 Jam</option>
                    <option value="Setiap 24 Jam">Setiap 24 Jam</option>
                  </select>
                </div>
              </div>

              {/* Box 3: Target number — removed (managed via DbWaRecipient) */}
            </div>

            {/* Checklists for report segments components */}
            <div className="mt-10 pt-8 border-t border-slate-100 select-none">
              <h3 className="text-[10px] font-bold text-gray-400 block mb-6 uppercase tracking-widest">
                Komponen Laporan yang Dikirimkan
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-5">
                {/* Checkbox item 1 */}
                <label className="flex items-center gap-3.5 group cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={revenueChecked}
                    onChange={(e) => setRevenueChecked(e.target.checked)}
                    className="w-5 h-5 rounded text-[#2d8a4e] focus:ring-[#2d8a4e]/20 border-slate-300 cursor-pointer"
                  />
                  <span className="text-[#0b1c30] text-xs font-bold leading-none group-hover:text-black">
                    Total Omset &amp; Penjualan Terkini
                  </span>
                </label>

                {/* Checkbox item 2 */}
                <label className="flex items-center gap-3.5 group cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={queueChecked}
                    onChange={(e) => setQueueChecked(e.target.checked)}
                    className="w-5 h-5 rounded text-[#2d8a4e] focus:ring-[#2d8a4e]/20 border-slate-300 cursor-pointer"
                  />
                  <span className="text-[#0b1c30] text-xs font-bold leading-none group-hover:text-black">
                    Jumlah Antrean Chat <span className="font-extrabold text-[#2d8a4e] ml-1">⏳ Perlu Admin</span> yang Belum Diklaim
                  </span>
                </label>

                {/* Checkbox item 3 */}
                <label className="flex items-center gap-3.5 group cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={activityChecked}
                    onChange={(e) => setActivityChecked(e.target.checked)}
                    className="w-5 h-5 rounded text-[#2d8a4e] focus:ring-[#2d8a4e]/20 border-slate-300 cursor-pointer"
                  />
                  <span className="text-[#0b1c30] text-xs font-bold leading-none group-hover:text-black">
                    Ringkasan Log Aktivitas &amp; Klaim Admin Hari Ini
                  </span>
                </label>

                {/* Checkbox item 4 */}
                <label className="flex items-center gap-3.5 group cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={statusChecked}
                    onChange={(e) => setStatusChecked(e.target.checked)}
                    className="w-5 h-5 rounded text-[#2d8a4e] focus:ring-[#2d8a4e]/20 border-slate-300 cursor-pointer"
                  />
                  <span className="text-[#0b1c30] text-xs font-bold leading-none group-hover:text-black">
                    Status Akun &amp; Sisa Masa Aktif Sistem
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Grid containing secondary limit thresholds cards */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Alert Card 1: Low stock notification limits */}
        <div className="bg-white border border-[#e5eeff] rounded-[2.5rem] p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center shrink-0 border border-rose-100">
              <span className="material-symbols-outlined text-3xl font-black">inventory_2</span>
            </div>
            <div>
              <h3 className="text-base font-extrabold text-[#012749]">🚨 Alert Batas Stok Rendah</h3>
              <p className="text-[10px] text-gray-400 font-extrabold uppercase">Picu peringatan otomatis saat stok menipis</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[#eff4ff]/60 p-6 rounded-3xl border border-transparent hover:border-slate-100 hover:bg-white transition-all duration-300">
            <span className="text-xs font-bold text-slate-700 leading-none">Picu notifikasi jika stok kurang dari</span>
            <div className="flex items-center gap-2 bg-[#eff4ff] px-4 py-2 rounded-full border border-blue-50 shrink-0">
              <input 
                type="number"
                value={lowStockLimit}
                onChange={(e) => setLowStockLimit(parseInt(e.target.value) || 0)}
                className="w-8 border-none focus:ring-0 p-0 text-center font-extrabold text-sm text-[#012749] bg-transparent outline-none"
              />
              <span className="text-[10px] font-extrabold text-slate-400 uppercase select-none">Pcs</span>
            </div>
          </div>
        </div>

        {/* Alert Card 2: Delay thresholds */}
        <div className="bg-white border border-[#e5eeff] rounded-[2.5rem] p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center shrink-0 border border-amber-100">
              <span className="material-symbols-outlined text-3xl font-black">timer</span>
            </div>
            <div>
              <h3 className="text-base font-extrabold text-[#012749]">⏳ Alert Keterlambatan Respon Admin</h3>
              <p className="text-[10px] text-gray-400 font-extrabold uppercase font-sans">Optimalkan kepuasan pelanggan real-time</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[#eff4ff]/60 p-6 rounded-3xl border border-transparent hover:border-slate-100 hover:bg-white transition-all duration-300">
            <span className="text-xs font-bold text-slate-700 leading-none">Picu peringatan jika respon terhambat lebih dari</span>
            <div className="flex items-center gap-2 bg-[#eff4ff] px-4 py-2 rounded-full border border-blue-50 shrink-0">
              <input 
                type="number"
                value={delayLimit}
                onChange={(e) => setDelayLimit(parseInt(e.target.value) || 0)}
                className="w-8 border-none focus:ring-0 p-0 text-center font-extrabold text-sm text-[#012749] bg-transparent outline-none"
              />
              <span className="text-[10px] font-extrabold text-slate-400 uppercase select-none">Menit</span>
            </div>
          </div>
        </div>
      </section>

      {/* Floating Save controls footer button */}
      <div className="fixed bottom-10 right-10 z-50">
        <button 
          onClick={handleSave}
          className="bg-[#2d8a4e] text-white px-10 py-5 rounded-full shadow-[0_20px_40px_rgba(0,109,54,0.3)] hover:shadow-[0_25px_60px_rgba(0,109,54,0.4)] hover:-translate-y-1.5 transition-all outline-none flex items-center gap-2.5 cursor-pointer text-sm font-extrabold uppercase tracking-wide"
        >
          <Save className="w-5 h-5 text-emerald-200" />
          SIMPAN &amp; AKTIFKAN NOTIFIKASI
        </button>
      </div>

    </div>
  );
}
