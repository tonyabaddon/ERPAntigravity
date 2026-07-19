import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Settings, Users, Plus, Trash2, ToggleLeft, ToggleRight, Save, X, Upload, Image as ImageIcon, Smartphone, Send } from 'lucide-react';
import { DbWaRecipient, DbCompanySettings, NotificationConfig, StockItem, PermissionSet, ActivePage } from '../types';
import { waRecipientsService, companySettingsService, adminUsersService, isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { normalizePhone } from '../lib/phone';
import { useTenant } from '../contexts/TenantContext';
import TabBar, { TabDef } from './ui/TabBar';
import CostingMethodPanel from './pengaturan/CostingMethodPanel';
import ClipMonitorPanel from './pengaturan/ClipMonitorPanel';
import NotificationSettingsScreen from './NotificationSettingsScreen';
import WhatsappAiScreen from './WhatsappAiScreen';
import SalesChannelConfigPanel from './pengaturan/SalesChannelConfigPanel';
import IdentitasTokoCard from './pengaturan/IdentitasTokoCard';
import JamOperasionalCard from './pengaturan/JamOperasionalCard';
import RekeningBankCard from './pengaturan/RekeningBankCard';
import ModulSwitchesPanel from './pengaturan/ModulSwitchesPanel';
import JenisJasaCrudPanel from './pengaturan/JenisJasaCrudPanel';
import ApprovalRulesPanel from './pengaturan/ApprovalRulesPanel';
import PajakSettingsPanel from './pengaturan/PajakSettingsPanel';
import SupportAccessPanel from './pengaturan/SupportAccessPanel';
import PromoProdukPanel from './pengaturan/PromoProdukPanel';
import SaldoAwalPanel from './pengaturan/SaldoAwalPanel';
import LayananPanel from './pengaturan/LayananPanel';
import { fetchStoreSettings } from '../lib/pengaturan/queries';
import { extractErrorMessage } from '../lib/extractErrorMessage';

type PengaturanTab = 'umum' | 'modul-jasa' | 'approval' | 'pajak' | 'notifikasi' | 'whatsapp-ai' | 'kanal-penjualan' | 'support-access' | 'promo-produk' | 'akuntansi' | 'layanan';

interface PengaturanScreenProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  notificationConfig: NotificationConfig;
  onNotificationConfigChange: (cfg: NotificationConfig) => void;
  stockList: StockItem[];
  onNavigate: (page: ActivePage) => void;
  permissions?: PermissionSet;
  initialTab?: PengaturanTab;
  currentUserRole?: string;
}

export default function PengaturanScreen(props: PengaturanScreenProps) {
  const { showToast } = props;
  const currentUserRole = props.currentUserRole;
  const tenant = useTenant();

  const tabs = useMemo<TabDef<PengaturanTab>[]>(() => {
    const perms = props.permissions;
    const isVisible = (key: keyof PermissionSet): boolean => {
      if (!perms) return true;
      const value = perms[key];
      if (typeof key === 'string' && key.startsWith('can_')) return value === true;
      return value !== false;
    };
    const list: TabDef<PengaturanTab>[] = [
      { id: 'umum', label: 'Umum' },
      { id: 'modul-jasa', label: 'Modul & Jasa' },
      { id: 'approval', label: 'Approval' },
      { id: 'layanan', label: '🛠 Layanan' },
      { id: 'promo-produk', label: '🏷 Promo Produk' },
      { id: 'akuntansi', label: '🧾 Akuntansi' },
      { id: 'pajak', label: 'Pajak' },
    ];
    if (isVisible('notifications')) list.push({ id: 'notifikasi', label: 'Notifikasi' });
    if (isVisible('whatsappAi')) list.push({ id: 'whatsapp-ai', label: 'WhatsApp AI' });
    if (isVisible('canConfigureSalesChannels')) list.push({ id: 'kanal-penjualan', label: 'Kanal Penjualan' });
    // Support Access: owner-only. F-10 Phase 2b.
    if (currentUserRole === 'Owner') list.push({ id: 'support-access', label: 'Support Access' });
    return list;
  }, [props.permissions, currentUserRole]);

  const [activeTab, setActiveTab] = useState<PengaturanTab>(() => {
    if (props.initialTab && tabs.some(t => t.id === props.initialTab)) return props.initialTab;
    return 'umum';
  });

  // Company settings state — retained (non-display use only):
  // - witness toggle reads opname_require_witness + sets it back
  // - logo upload (via dedicated logoUrl mirror below)
  const [company, setCompany]           = useState<DbCompanySettings | null>(null);
  const [companyLoading, setCompanyLoading] = useState(true);

  // Logo state
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoFileRef = useRef<HTMLInputElement | null>(null);

  // WA recipients state
  const [recipients, setRecipients] = useState<DbWaRecipient[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<{ role: 'admin' | 'owner'; name: string; wa_number: string }>({
    role: 'admin',
    name: '',
    wa_number: '',
  });
  const [addSaving, setAddSaving] = useState(false);
  // testSendingId: id of recipient whose test-send is in flight (null = none)
  const [testSendingId, setTestSendingId] = useState<number | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setRecipientsLoading(false);
      setCompanyLoading(false);
      return;
    }
    Promise.allSettled([
      waRecipientsService.fetchAll(),
      companySettingsService.fetch(),
      fetchStoreSettings(),
    ]).then(([recipsResult, coResult, storeResult]) => {
      if (recipsResult.status === 'fulfilled') setRecipients(recipsResult.value);
      else console.error('wa_recipients load error:', recipsResult.reason);

      if (coResult.status === 'fulfilled') {
        setCompany(coResult.value);
      } else {
        console.error('company_settings load error:', coResult.reason);
        showToast('Gagal memuat sebagian pengaturan. Coba refresh.', 'warning');
      }

      // Invoice PDF reads logo_url from store_settings — mirror it here so the
      // logo widget shows the same source that the PDF uses.
      if (storeResult.status === 'fulfilled') {
        setLogoUrl(storeResult.value?.logo_url ?? null);
      } else {
        console.error('store_settings load error:', storeResult.reason);
      }
    }).finally(() => {
      setRecipientsLoading(false);
      setCompanyLoading(false);
    });
  }, []);

  // WA recipients handlers
  const handleToggleRecipient = async (id: number, currentActive: boolean): Promise<void> => {
    const newActive = !currentActive;
    setRecipients(prev => prev.map(r => r.id === id ? { ...r, is_active: newActive } : r));
    try {
      await waRecipientsService.toggleActive(id, newActive);
    } catch (err) {
      console.error('toggleActive error:', err);
      setRecipients(prev => prev.map(r => r.id === id ? { ...r, is_active: currentActive } : r));
      showToast('Gagal mengubah status penerima.', 'warning');
    }
  };

  const handleDeleteRecipient = async (id: number, waNumber: string): Promise<void> => {
    if (!window.confirm(`Hapus penerima ${waNumber}?`)) return;
    setRecipients(prev => prev.filter(r => r.id !== id));
    try {
      await waRecipientsService.remove(id);
      showToast('Penerima berhasil dihapus.', 'success');
    } catch (err) {
      console.error('remove recipient error:', err);
      showToast('Gagal menghapus penerima.', 'warning');
      const refreshed = await waRecipientsService.fetchAll();
      setRecipients(refreshed);
    }
  };

  const handleTestSend = async (id: number): Promise<void> => {
    if (!supabase) { showToast('Supabase belum terkonfigurasi.', 'warning'); return; }
    setTestSendingId(id);
    try {
      const { data, error } = await supabase.rpc('send_notification_test', { p_template_id: 'test' });
      if (error) {
        showToast(`Gagal kirim tes: ${error.message}`, 'warning');
      } else {
        const row = Array.isArray(data) ? data[0] : data;
        if (row?.status === 'ERROR') {
          showToast(`Gagal kirim tes: ${row.message}`, 'warning');
        } else {
          showToast('Tes WA dikirim! Cek WhatsApp kamu dalam beberapa detik.', 'success');
        }
      }
    } catch (err) {
      console.error('handleTestSend error:', err);
      showToast('Gagal kirim tes WA.', 'warning');
    } finally {
      setTestSendingId(null);
    }
  };

  const handleAddRecipient = async (): Promise<void> => {
    if (!addForm.name || !addForm.wa_number) {
      showToast('Nama dan nomor WA wajib diisi.', 'warning');
      return;
    }
    // Normalize input: accept 085X, +628X, 62 8X, 62-8X variants
    const normalized = normalizePhone(addForm.wa_number);
    // WA format guard — DB may reject silently or accept malformed nums that
    // then fail at WA API send time. Require Indonesian format 62xxxxxxxxxx.
    if (!/^62\d{8,13}$/.test(normalized)) {
      showToast('Nomor WA tidak valid. Contoh: 085123456789 atau 628123456789.', 'warning');
      return;
    }
    setAddSaving(true);
    try {
      await waRecipientsService.add({ ...addForm, wa_number: normalized });
      const refreshed = await waRecipientsService.fetchAll();
      setRecipients(refreshed);
      setAddForm({ role: 'admin', name: '', wa_number: '' });
      setShowAddForm(false);
      showToast('Penerima berhasil ditambahkan.', 'success');
    } catch (err) {
      console.error('add recipient error:', err);
      showToast('Gagal menambahkan penerima.', 'warning');
    } finally {
      setAddSaving(false);
    }
  };

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      showToast('Logo maksimal 1 MB.', 'warning');
      return;
    }
    if (!['image/png','image/jpeg','image/jpg'].includes(file.type)) {
      showToast('Format logo harus PNG atau JPG.', 'warning');
      return;
    }
    if (!tenant) { showToast('Tenant belum dimuat.', 'warning'); return; }
    setLogoUploading(true);
    try {
      const url = await companySettingsService.uploadLogo(tenant.tenant_id, file);
      setLogoUrl(url);
      showToast('Logo berhasil di-upload.', 'success');
    } catch (err: any) {
      showToast(`Gagal upload logo: ${err.message ?? 'unknown'}`, 'warning');
    } finally {
      setLogoUploading(false);
      if (logoFileRef.current) logoFileRef.current.value = '';
    }
  }

  async function handleLogoClear() {
    if (!confirm('Hapus logo? Ini akan menghilangkan logo dari semua invoice baru.')) return;
    if (!tenant) { showToast('Tenant belum dimuat.', 'warning'); return; }
    try {
      await companySettingsService.clearLogo(tenant.tenant_id);
      setLogoUrl(null);
      showToast('Logo dihapus.', 'success');
    } catch (err: any) {
      showToast(`Gagal hapus logo: ${err.message ?? 'unknown'}`, 'warning');
    }
  }

  const umumContent = (
    <>
      {!isSupabaseConfigured ? (
        <div className="space-y-6 animate-fadeIn">
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-yellow-800 text-sm font-medium">
            Supabase belum dikonfigurasi. Tambahkan VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY ke file .env untuk menggunakan fitur ini.
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-fadeIn">
          {/* Phase 1B Pengaturan cards — source of truth for PDFs + WA. */}
          <IdentitasTokoCard showToast={showToast} />
          <JamOperasionalCard showToast={showToast} />
          <RekeningBankCard showToast={showToast} />

          {/* Logo Toko — used by invoice PDFs and on-screen invoices.
              Persisted on store_settings.logo_url (the table the invoice
              renderer reads). Uploaded to Storage bucket 'branding'. */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <label className="text-[11px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block mb-2">
              Logo Toko (untuk invoice PDF)
            </label>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center overflow-hidden">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
                ) : (
                  <ImageIcon className="w-8 h-8 text-slate-300" />
                )}
              </div>
              <div className="flex flex-col gap-2">
                <input
                  ref={logoFileRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
                <button
                  type="button"
                  onClick={() => logoFileRef.current?.click()}
                  disabled={logoUploading}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#012749] text-white text-xs font-bold rounded-lg hover:bg-[#01365e] disabled:opacity-60"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {logoUploading ? 'Mengunggah...' : (logoUrl ? 'Ganti Logo' : 'Upload Logo')}
                </button>
                {logoUrl && (
                  <button
                    type="button"
                    onClick={handleLogoClear}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-rose-200 text-rose-600 text-xs font-bold rounded-lg hover:bg-rose-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Hapus Logo
                  </button>
                )}
                <p className="text-[10px] text-slate-400">PNG / JPG, maks 1 MB. Rekomendasi 200×200 px (akan ter-dithered di printout dotmatrix).</p>
              </div>
            </div>
            {companyLoading && (
              <p className="text-[10px] text-slate-400 mt-2">Memuat status logo...</p>
            )}
          </div>

          {/* WA recipients card */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-gray-600" />
                <h2 className="text-lg font-bold text-gray-800">Penerima Notifikasi WA</h2>
              </div>
              {!showAddForm && (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700"
                >
                  <Plus className="w-4 h-4" /> Tambah Penerima
                </button>
              )}
            </div>

            {recipientsLoading ? (
              <p className="text-sm text-gray-400">Memuat...</p>
            ) : (
              <>
                {recipients.length === 0 && !showAddForm ? (
                  <p className="text-sm text-gray-500 py-4 text-center">
                    Belum ada penerima notifikasi. Tambahkan nomor admin yang akan menerima notifikasi pembayaran.
                  </p>
                ) : (
                  <div className="space-y-2 mb-3">
                    {recipients.map(r => (
                      <div key={r.id} className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-gray-800 truncate">{r.name}</span>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${
                              r.role === 'owner' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                            }`}>
                              {r.role === 'owner' ? 'Owner' : 'Admin'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 font-mono mt-0.5">{r.wa_number}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleToggleRecipient(r.id, r.is_active)}
                            title={r.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                            className="text-gray-400 hover:text-gray-700"
                          >
                            {r.is_active
                              ? <ToggleRight className="w-6 h-6 text-emerald-500" />
                              : <ToggleLeft className="w-6 h-6 text-gray-300" />
                            }
                          </button>
                          <button
                            onClick={() => handleDeleteRecipient(r.id, r.wa_number)}
                            title="Hapus"
                            className="text-gray-300 hover:text-red-500"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {showAddForm && (
                  <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
                    <p className="text-sm font-semibold text-gray-700">Tambah Penerima Baru</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Nama</label>
                        <input
                          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Nama admin"
                          value={addForm.name}
                          onChange={e => setAddForm(prev => ({ ...prev, name: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Role</label>
                        <select
                          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          value={addForm.role}
                          onChange={e => setAddForm(prev => ({ ...prev, role: e.target.value as 'admin' | 'owner' }))}
                        >
                          <option value="admin">Admin</option>
                          <option value="owner">Owner</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">Nomor WA</label>
                      <input
                        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="628xxxx"
                        value={addForm.wa_number}
                        onChange={e => setAddForm(prev => ({ ...prev, wa_number: e.target.value }))}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleAddRecipient}
                        disabled={addSaving}
                        className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Save className="w-4 h-4" />
                        {addSaving ? 'Menyimpan...' : 'Simpan'}
                      </button>
                      <button
                        onClick={() => { setShowAddForm(false); setAddForm({ role: 'admin', name: '', wa_number: '' }); }}
                        disabled={addSaving}
                        className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-50"
                      >
                        <X className="w-4 h-4" />
                        Batal
                      </button>
                    </div>
                  </div>
                )}

                <p className="text-xs text-gray-400 mt-3">
                  Nomor-nomor ini menerima notifikasi WA saat pelanggan mengunggah bukti pembayaran, admin memverifikasi, atau pesanan disetujui.
                </p>
              </>
            )}
          </div>

          {/* Modul Stok Opname — witness configurability (Task 14) */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-lg font-bold text-gray-800">Modul Stok Opname</h2>
            </div>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={company?.opname_require_witness ?? true}
                onChange={async (e) => {
                  const v = e.target.checked;
                  if (!tenant) { showToast('Tenant belum dimuat.', 'warning'); return; }
                  // Optimistic local update for snappy toggle UX.
                  setCompany(prev => prev ? { ...prev, opname_require_witness: v } : prev);
                  try {
                    await companySettingsService.updateOpnameRequireWitness(tenant.tenant_id, v);
                    showToast(`Saksi wajib: ${v ? 'AKTIF' : 'NONAKTIF'}`, 'success');
                  } catch (err) {
                    console.error('updateOpnameRequireWitness error:', err);
                    setCompany(prev => prev ? { ...prev, opname_require_witness: !v } : prev);
                    showToast('Gagal menyimpan pengaturan.', 'warning');
                  }
                }}
                className="mt-1"
              />
              <div>
                <div className="text-sm text-gray-800 font-medium">Wajibkan saksi saat opname</div>
                <div className="text-xs text-gray-500 mt-1">
                  Saat aktif: setiap sesi butuh saksi (counter ≠ saksi), saksi acknowledge sebelum submit.
                  Saat nonaktif: counter bisa kerja sendiri, tidak ada acknowledge step.
                  Rekomendasi: AKTIF untuk toko dengan staff &gt; 1.
                </div>
              </div>
            </label>
          </div>

          {/* Owner PIN Persetujuan — self-service PIN setup (Owner only) */}
          {currentUserRole === 'Owner' && (
            <OwnerPinCard showToast={showToast} />
          )}

          {/* Plan D: Costing method + CLIP inference monitor */}
          <CostingMethodPanel showToast={showToast} />
          <ClipMonitorPanel />
        </div>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-3 px-2">
        <div className="w-10 h-10 bg-[#012749] rounded-xl flex items-center justify-center shrink-0">
          <Settings className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-[#0b1c30]">Pengaturan</h2>
          <p className="text-xs text-[#0b1c30]/50">Konfigurasi umum, notifikasi, dan integrasi WhatsApp AI</p>
        </div>
      </div>

      <TabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />

      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'umum' && umumContent}
        {activeTab === 'modul-jasa' && (
          <div className="space-y-6 animate-fadeIn">
            <section>
              <h3 className="text-base font-bold text-[#012749] mb-3">📦 Modul ERP</h3>
              <p className="text-xs text-slate-500 mb-4">Modul yang aktif di toko. Mematikan modul = menu & fitur terkait disembunyikan.</p>
              <ModulSwitchesPanel showToast={showToast} />
            </section>
            <section>
              <h3 className="text-base font-bold text-[#012749] mb-3">🛠️ Master Jenis Jasa</h3>
              <p className="text-xs text-slate-500 mb-4">Jasa yang ditawarkan toko. Yang aktif muncul di Catat Penjualan Step 2.</p>
              <JenisJasaCrudPanel showToast={showToast} />
            </section>
          </div>
        )}
        {activeTab === 'approval' && <ApprovalRulesPanel showToast={showToast} />}
        {activeTab === 'layanan' && <LayananPanel showToast={showToast} />}
        {activeTab === 'promo-produk' && (
          <div className="space-y-4 animate-fadeIn">
            <div>
              <h3 className="text-base font-bold text-[#012749] mb-1">🏷 Promo Produk — auto-apply diskon per SKU</h3>
              <p className="text-xs text-slate-500 mb-4">
                Set diskon otomatis per SKU. Kasir tidak perlu input manual — diskon langsung terapplied saat SKU ditambahkan ke nota.
              </p>
            </div>
            <PromoProdukPanel showToast={showToast} />
          </div>
        )}
        {activeTab === 'akuntansi' && (
          <div className="space-y-4 animate-fadeIn">
            <div>
              <h3 className="text-base font-bold text-[#012749] mb-1">🧾 Akuntansi — Saldo Awal</h3>
              <p className="text-xs text-slate-500 mb-4">
                Input saldo awal (neraca) per tanggal cutover untuk onboarding akuntansi mid-year.
                Setelah dipost, laporan Neraca dan Aging Piutang/Hutang akan mencerminkan kondisi sebenarnya.
              </p>
            </div>
            <SaldoAwalPanel showToast={showToast} storeName={company?.name ?? 'Perusahaan Anda'} />
          </div>
        )}
        {activeTab === 'pajak' && <PajakSettingsPanel showToast={showToast} />}
        {activeTab === 'notifikasi' && (
          <NotificationSettingsScreen
            config={props.notificationConfig}
            onConfigChange={props.onNotificationConfigChange}
            showToast={showToast}
          />
        )}
        {activeTab === 'whatsapp-ai' && (
          <div className="space-y-4 animate-fadeIn">
            {/* Quick link to Universal Notification Template editor */}
            <button
              type="button"
              onClick={() => props.onNavigate('notification-templates')}
              className="w-full flex items-center justify-between bg-white rounded-xl border border-gray-200 px-5 py-4 hover:border-indigo-300 hover:shadow-sm transition-all text-left"
            >
              <div>
                <div className="text-sm font-bold text-gray-800">📋 Semua Template Notifikasi</div>
                <div className="text-xs text-gray-500 mt-0.5">Kustomisasi 10 template WA: order baru, pembayaran, pengiriman, stok, dan lainnya.</div>
              </div>
              <span className="text-gray-400 text-lg shrink-0 ml-3">›</span>
            </button>
            {/* Quick link to Piutang WA Reminder template editor */}
            <button
              type="button"
              onClick={() => props.onNavigate('piutang-wa-reminder')}
              className="w-full flex items-center justify-between bg-white rounded-xl border border-gray-200 px-5 py-4 hover:border-indigo-300 hover:shadow-sm transition-all text-left"
            >
              <div>
                <div className="text-sm font-bold text-gray-800">💬 Template WA Reminder Piutang</div>
                <div className="text-xs text-gray-500 mt-0.5">Atur template pesan H-3 dan H+3 untuk reminder invoice tempo customer.</div>
              </div>
              <span className="text-gray-400 text-lg shrink-0 ml-3">›</span>
            </button>
            {/* Quick link to Notification Cron config */}
            <button
              type="button"
              onClick={() => props.onNavigate('notification-cron')}
              className="w-full flex items-center justify-between bg-white rounded-xl border border-gray-200 px-5 py-4 hover:border-indigo-300 hover:shadow-sm transition-all text-left"
            >
              <div>
                <div className="text-sm font-bold text-gray-800">🕗 Notifikasi Terjadwal</div>
                <div className="text-xs text-gray-500 mt-0.5">Konfigurasi 4 notifikasi otomatis: ringkasan piutang/hutang, SLA breach, dan feedback customer.</div>
              </div>
              <span className="text-gray-400 text-lg shrink-0 ml-3">›</span>
            </button>
            {/* Quick link to Notification Prefs (Sprint 5) */}
            <button
              type="button"
              onClick={() => props.onNavigate('notification-prefs')}
              className="w-full flex items-center justify-between bg-white rounded-xl border border-gray-200 px-5 py-4 hover:border-indigo-300 hover:shadow-sm transition-all text-left"
            >
              <div>
                <div className="text-sm font-bold text-gray-800">🌙 Preferensi Notifikasi</div>
                <div className="text-xs text-gray-500 mt-0.5">Jam tenang, gabungkan notifikasi, dan skip ringkasan hari tanpa omset.</div>
              </div>
              <span className="text-gray-400 text-lg shrink-0 ml-3">›</span>
            </button>
            {/* Quick link to Customer Feedback dashboard */}
            <button
              type="button"
              onClick={() => props.onNavigate('customer-feedback')}
              className="w-full flex items-center justify-between bg-white rounded-xl border border-gray-200 px-5 py-4 hover:border-indigo-300 hover:shadow-sm transition-all text-left"
            >
              <div>
                <div className="text-sm font-bold text-gray-800">⭐ Feedback Customer</div>
                <div className="text-xs text-gray-500 mt-0.5">Lihat rating dan komentar dari customer setelah order selesai.</div>
              </div>
              <span className="text-gray-400 text-lg shrink-0 ml-3">›</span>
            </button>
            <WhatsappAiScreen
              stockList={props.stockList}
              showToast={showToast}
              onNavigate={props.onNavigate}
            />
          </div>
        )}
        {activeTab === 'kanal-penjualan' && <SalesChannelConfigPanel showToast={showToast} />}
        {activeTab === 'support-access' && <SupportAccessPanel showToast={showToast} />}
      </div>
    </div>
  );
}

// ─── OwnerPinCard ────────────────────────────────────────────────────────
// Self-service PIN management for the currently logged-in Owner.
// - First-time set: shows only New PIN + Confirm fields (no Old PIN).
// - Subsequent change: shows Old PIN + New PIN + Confirm fields.
// - Backend RPC change_owner_pin verifies role=Owner + status=Aktif and
//   bcrypt-checks old PIN when one is already set.
function OwnerPinCard({ showToast }: { showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void }) {
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminUsersService.currentOwnerHasPin()
      .then(setHasPin)
      .catch((err) => {
        console.error('currentOwnerHasPin error:', err);
        setHasPin(false);
      });
  }, []);

  const onSave = async () => {
    if (newPin.length < 4 || !/^\d+$/.test(newPin)) {
      showToast('PIN baru harus minimal 4 digit angka', 'warning');
      return;
    }
    if (newPin !== confirmPin) {
      showToast('PIN baru dan konfirmasi tidak cocok', 'warning');
      return;
    }
    if (hasPin && !oldPin) {
      showToast('Masukkan PIN lama dulu', 'warning');
      return;
    }
    setSaving(true);
    try {
      await adminUsersService.changeOwnerPin(oldPin, newPin);
      showToast(hasPin ? 'PIN berhasil diubah' : 'PIN berhasil diset', 'success');
      setOldPin('');
      setNewPin('');
      setConfirmPin('');
      setHasPin(true);
    } catch (err) {
      console.error('changeOwnerPin error:', err);
      const msg = extractErrorMessage(err);
      showToast(`Gagal: ${msg}`, 'warning');
    } finally {
      setSaving(false);
    }
  };

  if (hasPin === null) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-sm text-gray-500">
        Memuat status PIN…
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-bold text-gray-800">PIN Persetujuan Owner</h2>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${
          hasPin
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-amber-50 text-amber-700 border-amber-200'
        }`}>
          {hasPin ? 'Sudah di-set' : 'Belum di-set'}
        </span>
      </div>
      <p className="text-sm text-gray-600">
        PIN ini dipakai untuk approve permintaan adjustment stok, opname dengan selisih,
        perubahan harga, dan request kasir (refund/void/override). Hanya Owner aktif yang
        bisa set/ubah PIN sendiri.
      </p>
      <div className="space-y-3 max-w-md">
        {hasPin && (
          <div>
            <label className="block text-xs text-gray-600 mb-1">PIN Lama</label>
            <input
              type="password"
              inputMode="numeric"
              value={oldPin}
              onChange={(e) => setOldPin(e.target.value)}
              placeholder="Masukkan PIN saat ini"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              disabled={saving}
            />
          </div>
        )}
        <div>
          <label className="block text-xs text-gray-600 mb-1">PIN Baru (minimal 4 digit angka)</label>
          <input
            type="password"
            inputMode="numeric"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            placeholder="Misal 482917"
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            disabled={saving}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Konfirmasi PIN Baru</label>
          <input
            type="password"
            inputMode="numeric"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            placeholder="Ketik ulang PIN baru"
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            disabled={saving}
          />
        </div>
        <button
          onClick={onSave}
          disabled={saving || newPin.length < 4 || newPin !== confirmPin || (hasPin && !oldPin)}
          className="py-2 px-4 bg-emerald-600 text-white rounded-full text-sm disabled:opacity-50"
        >
          {saving ? 'Menyimpan…' : hasPin ? 'Ubah PIN' : 'Set PIN'}
        </button>
      </div>
      {!hasPin && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          ⚠️ Tanpa PIN, kamu tidak bisa approve permintaan opname dengan selisih
          atau stok adjustment. Set PIN dulu sebelum tim pakai modul Opname/Adjustment.
        </p>
      )}
    </div>
  );
}
