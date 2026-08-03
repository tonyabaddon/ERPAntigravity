/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
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
  CheckCircle2,
  Plus,
  Trash2,
  Smartphone,
} from 'lucide-react';
import { NotificationConfig, DbWaRecipient } from '../types';
import { notificationConfigService, waRecipientsService, isSupabaseConfigured } from '../lib/supabaseClient';
import { captureError } from '../lib/captureError';
import EmptyState from './ui/EmptyState';

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

  // WA Recipients — read-only display. CRUD lives in Pengaturan (2026-06-12
  // e2e audit: the editor used to live here AND in Pengaturan; the two
  // could drift). Loading-flag retained for the initial fetch.
  const [recipients, setRecipients] = useState<DbWaRecipient[]>([]);

  const dbConfigIdRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    waRecipientsService.fetchAll().then(setRecipients).catch(err => captureError(err, { feature: 'notification_settings', action: 'fetch_wa_recipients' }));
    notificationConfigService.fetch().then(row => {
      if (!row) return;
      dbConfigIdRef.current = row.id;
      setEnabled(row.enabled);
      setIntervalVal(row.interval_label);
      setRevenueChecked(row.report_revenue);
      setQueueChecked(row.report_queue);
      setActivityChecked(row.report_activity);
      setStatusChecked(row.report_status);
      setLowStockLimit(row.low_stock_alert);
      setDelayLimit(row.delay_alert);
    }).catch(err => captureError(err, { feature: 'notification_settings', action: 'load_notification_config' }));
  }, []);

  // CRUD handlers for WA recipients moved to PengaturanScreen on 2026-06-12.
  // The screen now only renders the read-only summary above.

  const handleSave = async () => {
    const updated: NotificationConfig = {
      enabled,
      interval,
      reportComponents: {
        revenue: revenueChecked,
        queue: queueChecked,
        activity: activityChecked,
        status: statusChecked,
      },
      lowStockAlert: lowStockLimit,
      delayAlert: delayLimit,
    };

    if (isSupabaseConfigured) {
      try {
        await notificationConfigService.save({
          enabled,
          interval_label: interval,
          report_revenue: revenueChecked,
          report_queue: queueChecked,
          report_activity: activityChecked,
          report_status: statusChecked,
          low_stock_alert: lowStockLimit,
          delay_alert: delayLimit,
        }, dbConfigIdRef.current);
        if (dbConfigIdRef.current === undefined) {
          const row = await notificationConfigService.fetch();
          if (row) dbConfigIdRef.current = row.id;
        }
      } catch (err) {
        captureError(err, { feature: 'notification_settings', action: 'save_notification_config' });
        showToast("⚠️ Gagal menyimpan ke cloud. Tersimpan lokal.");
        onConfigChange(updated);
        return;
      }
    }

    onConfigChange(updated);
    showToast("✅ Pengaturan Berhasil Disimpan! Sistem 'Detak Jantung' otomatis aktif.");
  };

  return (
    <div className="space-y-8 animate-fadeIn pb-24">
      {/* Upper Brand Info card */}
      <section className="bg-white rounded-[2.5rem] p-8 border border-[var(--color-caleo-mist)] shadow-xl">
        <div className="flex flex-col gap-6">
          <div className="max-w-4xl">
            <div className="flex items-center gap-4 mb-5">
              <div className="w-14 h-14 bg-blue-50 text-[var(--color-caleo-primary)] rounded flex items-center justify-center shadow-lg shadow-blue-105/5">
                <span className="material-symbols-outlined text-[32px]">monitor_heart</span>
              </div>
              <div>
                <h2 className="text-[var(--color-caleo-primary)] font-extrabold text-xl tracking-tight">
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Box 1: Status */}
              <div className="bg-[var(--color-caleo-cloud)]/60 p-6 rounded flex flex-col justify-between hover:bg-white hover:shadow-lg hover:border-slate-100 border border-transparent transition-all group select-none">
                <span className="text-caleo-10 font-extrabold text-gray-400 uppercase tracking-widest mb-4">Status Layanan</span>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-extrabold text-[var(--color-caleo-primary)]">Aktifkan Laporan</span>
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
              <div className="bg-[var(--color-caleo-cloud)]/60 p-6 rounded flex flex-col justify-between hover:bg-white hover:shadow-lg hover:border-slate-100 border border-transparent transition-all group cursor-pointer relative">
                <span className="text-caleo-10 font-extrabold text-gray-400 uppercase tracking-widest mb-4">Interval Pengiriman</span>
                <div className="relative">
                  <select 
                    value={interval}
                    onChange={(e) => setIntervalVal(e.target.value)}
                    className="w-full bg-transparent border-none text-sm font-extrabold text-[var(--color-caleo-primary)] p-0 focus-visible:ring-0 appearance-none cursor-pointer outline-none"
                  >
                    <option value="Setiap 1 Jam">Setiap 1 Jam</option>
                    <option value="Setiap 4 Jam">Setiap 4 Jam</option>
                    <option value="Setiap 12 Jam">Setiap 12 Jam</option>
                    <option value="Setiap 24 Jam">Setiap 24 Jam</option>
                  </select>
                </div>
              </div>

            </div>

            {/* Checklists for report segments components */}
            <div className="mt-10 pt-8 border-t border-slate-100 select-none">
              <h3 className="text-caleo-10 font-bold text-gray-400 block mb-6 uppercase tracking-widest">
                Komponen Laporan yang Dikirimkan
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-5">
                {/* Checkbox item 1 */}
                <label className="flex items-center gap-3.5 group cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={revenueChecked}
                    onChange={(e) => setRevenueChecked(e.target.checked)}
                    className="w-5 h-5 rounded text-[#2d8a4e] focus-visible:ring-caleo-gold border-slate-300 cursor-pointer"
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
                    className="w-5 h-5 rounded text-[#2d8a4e] focus-visible:ring-caleo-gold border-slate-300 cursor-pointer"
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
                    className="w-5 h-5 rounded text-[#2d8a4e] focus-visible:ring-caleo-gold border-slate-300 cursor-pointer"
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
                    className="w-5 h-5 rounded text-[#2d8a4e] focus-visible:ring-caleo-gold border-slate-300 cursor-pointer"
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
        <div className="bg-white border border-[var(--color-caleo-mist)] rounded-[2.5rem] p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 bg-rose-50 text-caleo-danger rounded flex items-center justify-center shrink-0 border border-rose-100">
              <span className="material-symbols-outlined text-3xl font-black">inventory_2</span>
            </div>
            <div>
              <h3 className="text-base font-extrabold text-[var(--color-caleo-primary)]">🚨 Alert Batas Stok Rendah</h3>
              <p className="text-caleo-10 text-gray-400 font-extrabold uppercase">Picu peringatan otomatis saat stok menipis</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[var(--color-caleo-cloud)]/60 p-6 rounded border border-transparent hover:border-slate-100 hover:bg-white transition-all duration-300">
            <span className="text-xs font-bold text-slate-700 leading-none">Picu notifikasi jika stok kurang dari</span>
            <div className="flex items-center gap-2 bg-[var(--color-caleo-cloud)] px-4 py-2 rounded-full border border-blue-50 shrink-0">
              <input
                type="number"
                min="1"
                value={lowStockLimit}
                onChange={(e) => {
                  // Coerce empty/NaN to 1 (not 0) — 0 would mean "notify when
                  // stock < 0", i.e. never; user would silently disable alerts.
                  const raw = parseInt(e.target.value, 10);
                  setLowStockLimit(Number.isFinite(raw) && raw > 0 ? raw : 1);
                }}
                className="w-8 border-none focus-visible:ring-0 p-0 text-center font-extrabold text-sm text-[var(--color-caleo-primary)] bg-transparent outline-none"
              />
              <span className="text-caleo-10 font-extrabold text-slate-400 uppercase select-none">Pcs</span>
            </div>
          </div>
        </div>

        {/* Alert Card 2: Delay thresholds */}
        <div className="bg-white border border-[var(--color-caleo-mist)] rounded-[2.5rem] p-8 shadow-xl hover:shadow-2xl transition-all duration-300">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 bg-amber-50 text-amber-600 rounded flex items-center justify-center shrink-0 border border-amber-100">
              <span className="material-symbols-outlined text-3xl font-black">timer</span>
            </div>
            <div>
              <h3 className="text-base font-extrabold text-[var(--color-caleo-primary)]">⏳ Alert Keterlambatan Respon Admin</h3>
              <p className="text-caleo-10 text-gray-400 font-extrabold uppercase font-sans">Optimalkan kepuasan pelanggan real-time</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[var(--color-caleo-cloud)]/60 p-6 rounded border border-transparent hover:border-slate-100 hover:bg-white transition-all duration-300">
            <span className="text-xs font-bold text-slate-700 leading-none">Picu peringatan jika respon terhambat lebih dari</span>
            <div className="flex items-center gap-2 bg-[var(--color-caleo-cloud)] px-4 py-2 rounded-full border border-blue-50 shrink-0">
              <input
                type="number"
                min="1"
                value={delayLimit}
                onChange={(e) => {
                  const raw = parseInt(e.target.value, 10);
                  setDelayLimit(Number.isFinite(raw) && raw > 0 ? raw : 1);
                }}
                className="w-8 border-none focus-visible:ring-0 p-0 text-center font-extrabold text-sm text-[var(--color-caleo-primary)] bg-transparent outline-none"
              />
              <span className="text-caleo-10 font-extrabold text-slate-400 uppercase select-none">Menit</span>
            </div>
          </div>
        </div>
      </section>

      {/* WA Recipients — read-only summary. The editable list lives in
          Pengaturan → Penerima Notifikasi WA. Previously this screen
          duplicated the same editor and the two lists could drift
          (2026-06-12 e2e audit). Read-only mirror keeps the operator
          aware of who receives the heartbeat while the canonical source
          stays in Pengaturan. */}
      <section className="bg-white border border-[var(--color-caleo-mist)] rounded-[2.5rem] p-8 shadow-xl">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-emerald-50 text-caleo-success rounded flex items-center justify-center shrink-0 border border-emerald-100">
              <Smartphone className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-[var(--color-caleo-primary)]">Nomor WA Penerima Notifikasi</h3>
              <p className="text-caleo-10 text-gray-400 font-extrabold uppercase tracking-wider mt-0.5">
                Daftar dikelola di Pengaturan — di sini hanya tampilan
              </p>
            </div>
          </div>
          <span className="bg-emerald-50 text-caleo-success text-caleo-10 font-black uppercase tracking-wider px-3 py-1 rounded-full border border-emerald-100 whitespace-nowrap">
            {recipients.filter(r => r.is_active).length} aktif · {recipients.length} total
          </span>
        </div>

        <div className="space-y-2">
          {recipients.length === 0 ? (
            <EmptyState
              inline
              message="Belum ada nomor. Tambahkan di Pengaturan → Penerima Notifikasi WA."
              className="bg-gray-50 rounded"
            />
          ) : (
            recipients.map(r => (
              <div key={r.id} className={`flex items-center gap-3 px-4 py-2.5 rounded border ${r.is_active ? 'bg-[#f8f9ff] border-[#abc9f3]/40' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-sm text-[var(--color-caleo-primary)] truncate">{r.name}</span>
                    <span className={`text-caleo-9 font-black uppercase px-2 py-0.5 rounded-full shrink-0 ${r.role === 'owner' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                      {r.role}
                    </span>
                    {!r.is_active && (
                      <span className="text-caleo-9 font-black uppercase px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">
                        Nonaktif
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-caleo-11 text-gray-400 mt-0.5">+{r.wa_number}</p>
                </div>
              </div>
            ))
          )}
        </div>

        <p className="mt-5 text-caleo-11 text-gray-500 italic">
          Untuk menambah / mengubah / menonaktifkan: buka <b className="text-[var(--color-caleo-primary)]">Pengaturan → Penerima Notifikasi WA</b>.
        </p>
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
