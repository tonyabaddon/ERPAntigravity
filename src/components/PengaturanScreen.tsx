import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Settings, Building2, Users, Plus, Trash2, ToggleLeft, ToggleRight, Edit2, Save, X, MapPin, Upload, Image as ImageIcon } from 'lucide-react';
import { DbBankConfig, DbWaRecipient, DbCompanySettings, NotificationConfig, StockItem, PermissionSet, ActivePage } from '../types';
import { bankConfigService, waRecipientsService, companySettingsService, adminUsersService, isSupabaseConfigured } from '../lib/supabaseClient';
import TabBar, { TabDef } from './ui/TabBar';
import NotificationSettingsScreen from './NotificationSettingsScreen';
import WhatsappAiScreen from './WhatsappAiScreen';
import SalesChannelConfigPanel from './pengaturan/SalesChannelConfigPanel';

type PengaturanTab = 'umum' | 'notifikasi' | 'whatsapp-ai' | 'kanal-penjualan';

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

  const tabs = useMemo<TabDef<PengaturanTab>[]>(() => {
    const perms = props.permissions;
    const isVisible = (key: keyof PermissionSet): boolean => {
      if (!perms) return true;
      const value = perms[key];
      if (typeof key === 'string' && key.startsWith('can_')) return value === true;
      return value !== false;
    };
    const list: TabDef<PengaturanTab>[] = [{ id: 'umum', label: 'Umum' }];
    if (isVisible('notifications')) list.push({ id: 'notifikasi', label: 'Notifikasi' });
    if (isVisible('whatsappAi')) list.push({ id: 'whatsapp-ai', label: 'WhatsApp AI' });
    if (isVisible('canConfigureSalesChannels')) list.push({ id: 'kanal-penjualan', label: 'Kanal Penjualan' });
    return list;
  }, [props.permissions]);

  const [activeTab, setActiveTab] = useState<PengaturanTab>(() => {
    if (props.initialTab && tabs.some(t => t.id === props.initialTab)) return props.initialTab;
    return 'umum';
  });

  // Bank config state
  const [bankConfig, setBankConfig] = useState<DbBankConfig | null>(null);
  const [bankLoading, setBankLoading] = useState(true);
  const [bankEditing, setBankEditing] = useState(false);
  const [bankForm, setBankForm] = useState({ bank_name: '', account_number: '', account_name: '' });
  const [bankSaving, setBankSaving] = useState(false);

  // Company settings state
  const [company, setCompany]           = useState<DbCompanySettings | null>(null);
  const [companyLoading, setCompanyLoading] = useState(true);
  const [companyEditing, setCompanyEditing] = useState(false);
  const [companyForm, setCompanyForm]   = useState({ company_name: '', address: '', phone: '', email: '' });
  const [companySaving, setCompanySaving] = useState(false);

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

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setBankLoading(false);
      setRecipientsLoading(false);
      setCompanyLoading(false);
      return;
    }
    Promise.allSettled([
      bankConfigService.fetch(),
      waRecipientsService.fetchAll(),
      companySettingsService.fetch(),
    ]).then(([bankResult, recipsResult, coResult]) => {
      if (bankResult.status === 'fulfilled') setBankConfig(bankResult.value);
      else console.error('bank_config load error:', bankResult.reason);

      if (recipsResult.status === 'fulfilled') setRecipients(recipsResult.value);
      else console.error('wa_recipients load error:', recipsResult.reason);

      if (coResult.status === 'fulfilled') {
        setCompany(coResult.value);
        setLogoUrl(coResult.value?.logo_url ?? null);
      } else {
        console.error('company_settings load error:', coResult.reason);
        showToast('Gagal memuat sebagian pengaturan. Coba refresh.', 'warning');
      }
    }).finally(() => {
      setBankLoading(false);
      setRecipientsLoading(false);
      setCompanyLoading(false);
    });
  }, []);

  // Bank config handlers
  const startEdit = () => {
    setBankForm({
      bank_name: bankConfig?.bank_name ?? '',
      account_number: bankConfig?.account_number ?? '',
      account_name: bankConfig?.account_name ?? '',
    });
    setBankEditing(true);
  };

  const cancelEdit = () => {
    setBankEditing(false);
  };

  const startCompanyEdit = () => {
    setCompanyForm({
      company_name: company?.company_name ?? '',
      address:      company?.address ?? '',
      phone:        company?.phone ?? '',
      email:        company?.email ?? '',
    });
    setCompanyEditing(true);
  };

  const cancelCompanyEdit = () => setCompanyEditing(false);

  const saveCompany = async (): Promise<void> => {
    if (!companyForm.company_name) {
      showToast('Nama perusahaan wajib diisi.', 'warning');
      return;
    }
    setCompanySaving(true);
    try {
      await companySettingsService.save(companyForm);
      const updated = await companySettingsService.fetch();
      setCompany(updated);
      setCompanyEditing(false);
      showToast('Profil perusahaan berhasil disimpan.', 'success');
    } catch (err) {
      console.error('saveCompany error:', err);
      showToast('Gagal menyimpan profil perusahaan.', 'warning');
    } finally {
      setCompanySaving(false);
    }
  };

  const saveBank = async (): Promise<void> => {
    if (!bankForm.bank_name || !bankForm.account_number || !bankForm.account_name) {
      showToast('Semua kolom rekening wajib diisi.', 'warning');
      return;
    }
    setBankSaving(true);
    try {
      await bankConfigService.save(bankForm, bankConfig?.id);
      const updated = await bankConfigService.fetch();
      setBankConfig(updated);
      setBankEditing(false);
      showToast('Rekening bank berhasil disimpan.', 'success');
    } catch (err) {
      console.error('saveBank error:', err);
      showToast('Gagal menyimpan rekening bank.', 'warning');
    } finally {
      setBankSaving(false);
    }
  };

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

  const handleAddRecipient = async (): Promise<void> => {
    if (!addForm.name || !addForm.wa_number) {
      showToast('Nama dan nomor WA wajib diisi.', 'warning');
      return;
    }
    setAddSaving(true);
    try {
      await waRecipientsService.add(addForm);
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
    setLogoUploading(true);
    try {
      const url = await companySettingsService.uploadLogo(file);
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
    try {
      await companySettingsService.clearLogo();
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
          {/* Bank config card */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-gray-600" />
                <h2 className="text-lg font-bold text-gray-800">Rekening Bank</h2>
              </div>
              {bankConfig && !bankEditing && (
                <button onClick={startEdit} className="p-2 rounded-lg hover:bg-gray-100" title="Edit rekening">
                  <Edit2 className="w-4 h-4 text-gray-600" />
                </button>
              )}
            </div>

            {bankLoading ? (
              <p className="text-sm text-gray-400">Memuat...</p>
            ) : bankEditing ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Nama Bank</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Contoh: BCA"
                    value={bankForm.bank_name}
                    onChange={e => setBankForm(prev => ({ ...prev, bank_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Nomor Rekening</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Contoh: 1234567890"
                    value={bankForm.account_number}
                    onChange={e => setBankForm(prev => ({ ...prev, account_number: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Nama Pemilik Rekening</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Contoh: PT Garindo Jaya Panel"
                    value={bankForm.account_name}
                    onChange={e => setBankForm(prev => ({ ...prev, account_name: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={saveBank}
                    disabled={bankSaving}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {bankSaving ? 'Menyimpan...' : 'Simpan'}
                  </button>
                  <button
                    onClick={cancelEdit}
                    disabled={bankSaving}
                    className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                    Batal
                  </button>
                </div>
              </div>
            ) : bankConfig ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-sm">
                  <span className="w-40 text-gray-500 font-medium">Nama Bank</span>
                  <span className="font-semibold text-gray-800">{bankConfig.bank_name}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="w-40 text-gray-500 font-medium">Nomor Rekening</span>
                  <span className="font-mono font-semibold text-gray-800">{bankConfig.account_number}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="w-40 text-gray-500 font-medium">Atas Nama</span>
                  <span className="font-semibold text-gray-800">{bankConfig.account_name}</span>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Detail ini tampil di setiap invoice yang dikirim ke pelanggan.
                </p>
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-sm text-gray-500 mb-3">Belum ada rekening tersimpan.</p>
                <button
                  onClick={startEdit}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 mx-auto"
                >
                  <Plus className="w-4 h-4" />
                  Tambah Rekening
                </button>
              </div>
            )}
          </div>

          {/* Company profile card */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-gray-600" />
                <h2 className="text-lg font-bold text-gray-800">Profil Perusahaan</h2>
              </div>
              {company && !companyEditing && (
                <button onClick={startCompanyEdit} className="p-2 rounded-lg hover:bg-gray-100" title="Edit profil">
                  <Edit2 className="w-4 h-4 text-gray-600" />
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400 mb-4">Data ini tampil di setiap invoice yang diterbitkan.</p>

            {companyLoading ? (
              <p className="text-sm text-gray-400">Memuat...</p>
            ) : companyEditing ? (
              <div className="space-y-3">
                {[
                  { key: 'company_name', label: 'Nama Perusahaan', placeholder: 'Garindo Jaya Panel' },
                  { key: 'address',      label: 'Alamat',          placeholder: 'Jl. Contoh No. 1, Jakarta' },
                  { key: 'phone',        label: 'Telepon',         placeholder: '+62 21-xxxx-xxxx' },
                  { key: 'email',        label: 'Email',           placeholder: 'toko@email.com' },
                ].map(field => (
                  <div key={field.key}>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">{field.label}</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={field.placeholder}
                      value={companyForm[field.key as keyof typeof companyForm]}
                      onChange={e => setCompanyForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={saveCompany}
                    disabled={companySaving}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {companySaving ? 'Menyimpan...' : 'Simpan'}
                  </button>
                  <button
                    onClick={cancelCompanyEdit}
                    disabled={companySaving}
                    className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                    Batal
                  </button>
                </div>
              </div>
            ) : company ? (
              <div className="space-y-2">
                {[
                  { label: 'Nama Perusahaan', value: company.company_name },
                  { label: 'Alamat',          value: company.address || '—' },
                  { label: 'Telepon',         value: company.phone || '—' },
                  { label: 'Email',           value: company.email || '—' },
                ].map(row => (
                  <div key={row.label} className="flex items-start gap-3 text-sm">
                    <span className="w-40 text-gray-500 font-medium shrink-0">{row.label}</span>
                    <span className="font-semibold text-gray-800">{row.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-gray-500 mb-3">Profil perusahaan belum diisi.</p>
                <button onClick={startCompanyEdit} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 mx-auto">
                  <Plus className="w-4 h-4" /> Isi Profil
                </button>
              </div>
            )}

            <div className="border-t border-slate-100 pt-5 mt-5">
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
            </div>
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
                  // Optimistic local update for snappy toggle UX.
                  setCompany(prev => prev ? { ...prev, opname_require_witness: v } : prev);
                  try {
                    await companySettingsService.updateOpnameRequireWitness(v);
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
        {activeTab === 'notifikasi' && (
          <NotificationSettingsScreen
            config={props.notificationConfig}
            onConfigChange={props.onNotificationConfigChange}
            showToast={showToast}
          />
        )}
        {activeTab === 'whatsapp-ai' && (
          <WhatsappAiScreen
            stockList={props.stockList}
            showToast={showToast}
            onNavigate={props.onNavigate}
          />
        )}
        {activeTab === 'kanal-penjualan' && <SalesChannelConfigPanel showToast={showToast} />}
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
      const msg = err instanceof Error ? err.message : String(err);
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
