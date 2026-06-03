import React, { useState, useEffect } from 'react';
import { Settings, Building2, Users, Plus, Trash2, ToggleLeft, ToggleRight, Edit2, Save, X, MapPin } from 'lucide-react';
import { DbBankConfig, DbWaRecipient, DbCompanySettings } from '../types';
import { bankConfigService, waRecipientsService, companySettingsService, isSupabaseConfigured } from '../lib/supabaseClient';

interface PengaturanScreenProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function PengaturanScreen({ showToast }: PengaturanScreenProps) {
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
    Promise.all([bankConfigService.fetch(), waRecipientsService.fetchAll(), companySettingsService.fetch()])
      .then(([bank, recips, co]) => {
        setBankConfig(bank);
        setRecipients(recips);
        setCompany(co);
      })
      .catch(err => {
        console.error('PengaturanScreen load error:', err);
        showToast('Gagal memuat data pengaturan.', 'warning');
      })
      .finally(() => {
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

  if (!isSupabaseConfigured) {
    return (
      <div className="space-y-6 animate-fadeIn">
        <div className="flex items-center gap-3">
          <Settings className="w-6 h-6 text-gray-700" />
          <h1 className="text-2xl font-bold text-gray-800">Pengaturan Sistem</h1>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-yellow-800 text-sm font-medium">
          Supabase belum dikonfigurasi. Tambahkan VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY ke file .env untuk menggunakan fitur ini.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <Settings className="w-6 h-6 text-gray-700" />
        <h1 className="text-2xl font-bold text-gray-800">Pengaturan Sistem</h1>
      </div>

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
    </div>
  );
}
