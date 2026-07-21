import React, { useState, useEffect } from 'react';
import { approvalSettingsService, tenantSettingsService } from '../../lib/pengaturan/pengaturanServices';
import { captureError } from '../../lib/captureError';
import { isApprovalGateVisible } from '../../lib/pengaturan/cascadeMap';
import type { DbApprovalSettings, DbTenantSettings, ApprovalRequestType } from '../../types';
import { ApprovalGateEditor, type ApprovalGateSettings } from './ApprovalGateEditor';

interface Props { showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void; }

interface GateDef { type: ApprovalRequestType; title: string; description: string; thresholdLabel?: string; }

const GROUPS: Array<{ heading: string; icon: string; bgClass: string; gates: GateDef[] }> = [
  { heading: 'STOK', icon: '📦', bgClass: '', gates: [
    { type: 'adjustment',     title: 'Adjustment manual (in/out tanpa nota)',   description: 'Saat admin minta ubah qty stok tanpa transaksi resmi.' },
    { type: 'opname',         title: 'Opname dengan selisih',                   description: 'Saat hasil counting ≠ stok di sistem.', thresholdLabel: 'Bypass kalau < (Rp value loss)' },
    { type: 'initial_stock',  title: 'Set saldo awal stok produk baru',         description: 'Saat input first-time stock.' },
  ]},
  { heading: 'KASIR / POS', icon: '💳', bgClass: '', gates: [
    { type: 'kasir_discount' as ApprovalRequestType,        title: 'Diskon Nota (di kasir)', description: 'Kasir kasih diskon melewati batas di nota → owner approve. Cegah fraud karyawan.' },
    { type: 'kasir_price_override', title: 'Override harga di kasir', description: 'Kasir set harga manual ≠ list price.' },
    { type: 'kasir_void',           title: 'Void transaksi',            description: 'Batal transaksi sebelum/sesudah cetak.' },
    { type: 'kasir_refund',         title: 'Refund tunai',              description: 'Refund cash ke pelanggan.' },
  ]},
  { heading: 'HARGA & PRODUK', icon: '💰', bgClass: '', gates: [
    { type: 'price_change', title: 'Ubah harga jual produk', description: 'Mengubah list price.' },
  ]},
  { heading: 'PELANGGAN & TEMPO', icon: '👥', bgClass: '', gates: [
    { type: 'customer_credit_activate',     title: 'Aktifkan TEMPO untuk pelanggan baru', description: 'Ubah customer dari Cash-Only ke boleh utang.' },
    { type: 'customer_credit_limit_change', title: 'Naikkan credit limit',                description: 'Tambah jumlah maksimal utang.', thresholdLabel: 'Bypass kalau <' },
    { type: 'customer_credit_deactivate',   title: 'Nonaktifkan TEMPO',                   description: 'Customer kembali Cash-Only.' },
    { type: 'piutang_write_off',            title: 'Write-off piutang macet',             description: 'Akui piutang tak tertagih sebagai kerugian.' },
  ]},
  { heading: 'PENJUALAN & JASA', icon: '🛠️', bgClass: '', gates: [
    { type: 'rakit_lock', title: 'Lock material untuk jasa', description: 'Saat mulai jasa Custom/Wiring.' },
  ]},
  { heading: 'PEMBELIAN (default off — sesuai SOP Garindo)', icon: '🛒', bgClass: 'border-2 border-amber-200 bg-amber-50/30', gates: [
    { type: 'purchase_order_create', title: 'Buat PO baru ke supplier',          description: 'Saat admin bikin PO baru.', thresholdLabel: 'Bypass kalau <' },
    { type: 'purchase_order_amend',  title: 'Ubah PO existing',                  description: 'Amend PO yang sudah confirmed.' },
    { type: 'tagihan_create',        title: 'Buat Tagihan supplier',             description: 'Saat terima invoice dari supplier.' },
    { type: 'supplier_payment',      title: 'Bayar supplier',                    description: 'Transfer/cash ke supplier.', thresholdLabel: 'Bypass kalau <' },
    { type: 'bnl_create',            title: 'Buat Beban Non Listing (BNL)',      description: 'Biaya operasional bukan pembelian SKU.' },
    { type: 'tukar_faktur',          title: 'Tukar Faktur',                      description: 'Bundling beberapa Tagihan jadi 1 invoice.' },
    { type: 'purchase_return',       title: 'Retur barang ke supplier',          description: 'Kembalikan barang ke supplier.' },
  ]},
];

export default function ApprovalRulesPanel({ showToast }: Props) {
  const [settings, setSettings] = useState<DbApprovalSettings[]>([]);
  const [tenant, setTenant] = useState<DbTenantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedType, setExpandedType] = useState<ApprovalRequestType | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    Promise.all([approvalSettingsService.fetch(), tenantSettingsService.fetch()])
      .then(([s, t]) => { setSettings(s); setTenant(t); })
      .catch(err => { captureError(err, { feature: 'pengaturan_approval', action: 'load_approval_settings' }); showToast('Gagal memuat approval settings', 'warning'); })
      .finally(() => setLoading(false));
  }, [refreshTick]);

  const findSetting = (type: ApprovalRequestType) => settings.find(s => s.request_type === type);

  const handleToggle = async (type: ApprovalRequestType, newRequired: boolean) => {
    const existing = findSetting(type);
    if (!existing) return;
    setSettings(prev => prev.map(s => s.request_type === type ? { ...s, approval_required: newRequired } : s));
    try {
      await approvalSettingsService.updateOne(type, {
        approval_required: newRequired,
        verification_method: newRequired ? 'PIN' : 'NONE',
      });
      showToast(`${type} → ${newRequired ? 'ON (PIN)' : 'OFF'}`, 'success');
    } catch (err) {
      captureError(err, { feature: 'pengaturan_approval', action: 'toggle_approval' });
      setSettings(prev => prev.map(s => s.request_type === type ? existing : s));
      showToast('Gagal simpan', 'warning');
    }
  };

  const handleThreshold = async (type: ApprovalRequestType, value: number | null) => {
    setSettings(prev => prev.map(s => s.request_type === type ? { ...s, threshold_amount: value } : s));
    try { await approvalSettingsService.updateOne(type, { threshold_amount: value }); }
    catch (err) { captureError(err, { feature: 'pengaturan_approval', action: 'save_threshold' }); showToast('Gagal simpan threshold', 'warning'); }
  };

  if (loading) return <p className="text-sm text-slate-500 p-6">Memuat…</p>;
  if (!tenant) return <p className="text-sm text-rose-600 p-6">Tenant settings tidak ditemukan</p>;

  return (
    <div className="space-y-4">
      {GROUPS.map(group => {
        const visibleGates = group.gates.filter(g => isApprovalGateVisible(g.type, tenant));
        if (visibleGates.length === 0) return null;
        const activeCount = visibleGates.filter(g => findSetting(g.type)?.approval_required).length;
        return (
          <div key={group.heading} className={`border rounded-xl overflow-hidden ${group.bgClass || 'border-slate-200'}`}>
            <div className="bg-slate-100 px-4 py-2 flex items-center justify-between">
              <div className="font-bold text-xs text-slate-700 uppercase tracking-wider">
                {group.icon} {group.heading}
              </div>
              <div className="text-[11px] text-slate-500">{activeCount} dari {visibleGates.length} aktif</div>
            </div>
            <div className="divide-y divide-slate-100">
              {visibleGates.map(g => {
                const s = findSetting(g.type);
                if (!s) return null;
                const isExpanded = expandedType === g.type;
                const initialEditor: ApprovalGateSettings = {
                  approval_required: s.approval_required,
                  verification_method: (s.verification_method as ApprovalGateSettings['verification_method']) ?? 'APP_INBOX',
                  threshold_amount: s.threshold_amount ?? null,
                  threshold_percent: s.threshold_percent ?? null,
                  threshold_qty: s.threshold_qty ?? null,
                  approver_role: s.approver_role ?? 'Owner',
                  requestor_bypass_self: s.requestor_bypass_self ?? false,
                  reason_required: s.reason_required ?? false,
                };
                return (
                  <div key={g.type} className="border-t border-slate-100 first:border-t-0">
                    <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={s.approval_required}
                        onChange={e => handleToggle(g.type, e.target.checked)}
                        className="w-4 h-4 cursor-pointer"
                      />
                      <div className="flex-1 cursor-pointer" onClick={() => setExpandedType(isExpanded ? null : g.type)}>
                        <div className="text-sm font-semibold text-slate-800">{g.title}</div>
                        <div className="text-[11px] text-slate-500">{g.description}</div>
                      </div>
                      {g.thresholdLabel && (
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="text-slate-500">{g.thresholdLabel}</span>
                          <input
                            type="text"
                            value={s.threshold_amount?.toLocaleString('id-ID') ?? ''}
                            onChange={e => {
                              const cleaned = e.target.value.replace(/[^\d]/g, '');
                              handleThreshold(g.type, cleaned ? Number(cleaned) : null);
                            }}
                            className="w-28 px-2 py-1 border border-slate-300 rounded text-xs text-right bg-white"
                            placeholder="0"
                          />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setExpandedType(isExpanded ? null : g.type)}
                        className="text-xs text-slate-400 hover:text-slate-600 ml-2 px-2 py-1 rounded hover:bg-slate-100"
                        title="Pengaturan lanjutan (semua 7 knob)"
                      >
                        {isExpanded ? '▲' : '⚙'}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3">
                        <ApprovalGateEditor
                          requestType={g.type}
                          initialValues={initialEditor}
                          onSaved={() => { setExpandedType(null); setRefreshTick(t => t + 1); }}
                          showToast={showToast}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <details className="mt-6 border border-slate-200 rounded-xl">
        <summary className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 cursor-pointer">
          <span className="font-bold text-xs text-slate-700">Pengaturan lanjutan</span>
          <span className="text-[11px] text-slate-400">Per-gate verification method · approver role · self-bypass · reason text</span>
        </summary>
        <div className="px-4 py-4 border-t border-slate-200 text-xs text-slate-600 bg-slate-50">
          <p>Advanced per-gate config disesuaikan kebutuhan tenant — override verification method (PIN/WA/INBOX), override approver role (default Owner), self-bypass (Owner sendiri minta auto-approve), reason text wajib.</p>
          <p className="mt-2 text-slate-500">(Build advanced UI: defer V2 — 90% tenant cukup checkbox + threshold di atas.)</p>
        </div>
      </details>
    </div>
  );
}
