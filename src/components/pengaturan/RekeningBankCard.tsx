import React, { useEffect, useState } from 'react';
import { CreditCard, Plus, Trash2, Edit2, ToggleLeft, ToggleRight, X } from 'lucide-react';
import { fetchBankAccounts } from '../../lib/pengaturan/queries';
import { createBankAccount, updateBankAccount, deleteBankAccount } from '../../lib/pengaturan/mutations';
import { NumberInput } from '../ui/NumberInput';
import type { BankAccount } from '../../lib/pengaturan/types';
import { captureError } from '../../lib/captureError';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type EditForm = {
  bank_name: string;
  account_number: string;
  account_holder: string;
  is_active: boolean;
  sort_order: number;
};

const EMPTY_FORM: EditForm = {
  bank_name: '',
  account_number: '',
  account_holder: '',
  is_active: true,
  sort_order: 0,
};

function isRlsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  return msg.includes('row-level security') || msg.includes('permission denied') || msg.includes('42501');
}

export default function RekeningBankCard({ showToast }: Props) {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);

  async function refresh() {
    try {
      const data = await fetchBankAccounts();
      setAccounts(data);
    } catch (err) {
      captureError(err, { feature: 'pengaturan_rekening_bank', action: 'fetch_bank_accounts' });
      showToast('Gagal memuat daftar rekening', 'warning');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function openCreate() {
    const nextOrder = accounts.length === 0 ? 0 : Math.max(...accounts.map(a => a.sort_order)) + 1;
    setForm({ ...EMPTY_FORM, sort_order: nextOrder });
    setEditingId(null);
    setCreating(true);
  }

  function openEdit(account: BankAccount) {
    setForm({
      bank_name: account.bank_name,
      account_number: account.account_number,
      account_holder: account.account_holder,
      is_active: account.is_active,
      sort_order: account.sort_order,
    });
    setEditingId(account.id);
    setCreating(false);
  }

  function cancelForm() {
    setEditingId(null);
    setCreating(false);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    if (!form.bank_name.trim() || !form.account_number.trim() || !form.account_holder.trim()) {
      showToast('Bank, nomor rekening, dan nama pemilik wajib diisi', 'warning');
      return;
    }
    setBusyId(editingId ?? 'new');
    try {
      if (editingId) {
        await updateBankAccount(editingId, form);
        showToast('Rekening diperbarui', 'success');
      } else {
        await createBankAccount(form);
        showToast('Rekening ditambahkan', 'success');
      }
      cancelForm();
      await refresh();
    } catch (err) {
      captureError(err, { feature: 'pengaturan_rekening_bank', action: 'save_bank_account' });
      if (isRlsError(err)) {
        showToast('Anda harus Owner untuk mengubah rekening bank', 'warning');
      } else {
        showToast('Gagal menyimpan rekening', 'warning');
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleActive(account: BankAccount) {
    setBusyId(account.id);
    try {
      await updateBankAccount(account.id, { is_active: !account.is_active });
      await refresh();
    } catch (err) {
      captureError(err, { feature: 'pengaturan_rekening_bank', action: 'toggle_bank_active' });
      if (isRlsError(err)) {
        showToast('Anda harus Owner untuk mengubah rekening', 'warning');
      } else {
        showToast('Gagal mengubah status rekening', 'warning');
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(account: BankAccount) {
    if (!window.confirm(`Hapus rekening ${account.bank_name} (${account.account_number})?`)) return;
    setBusyId(account.id);
    try {
      await deleteBankAccount(account.id);
      showToast('Rekening dihapus', 'success');
      await refresh();
    } catch (err) {
      captureError(err, { feature: 'pengaturan_rekening_bank', action: 'delete_bank_account' });
      if (isRlsError(err)) {
        showToast('Anda harus Owner untuk menghapus rekening', 'warning');
      } else {
        showToast('Gagal menghapus rekening', 'warning');
      }
    } finally {
      setBusyId(null);
    }
  }

  const showForm = creating || editingId !== null;

  return (
    <div
      style={{
        background: 'white',
        borderRadius: 24,
        boxShadow: '0 2px 12px rgba(1,39,73,0.06)',
        border: '1px solid var(--color-caleo-mist)',
        padding: 24,
      }}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-sm bg-[var(--color-caleo-cloud)] flex items-center justify-center text-[var(--color-caleo-primary)]">
            <CreditCard size={20} />
          </div>
          <div>
            <h3 className="text-base font-bold" style={{ color: 'var(--color-primary)' }}>Rekening Bank</h3>
            <p className="text-xs text-gray-600 mt-0.5">
              Rekening yang muncul di invoice PDF. Centang aktif untuk ditampilkan.
            </p>
          </div>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-[var(--color-caleo-primary)] text-white rounded-full text-xs font-bold hover:bg-[#01365e]"
          >
            <Plus size={14} /> Tambah Rekening
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Memuat…</div>
      ) : (
        <>
          {showForm && (
            <div className="border border-[var(--color-caleo-mist-dark)] bg-[#fafbff] rounded-sm p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-bold text-[var(--color-caleo-primary)]">
                  {editingId ? 'Edit Rekening' : 'Rekening Baru'}
                </div>
                <button type="button" onClick={cancelForm} className="text-gray-500 hover:text-gray-700">
                  <X size={18} />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-gray-700">Nama Bank *</span>
                  <input
                    type="text"
                    value={form.bank_name}
                    onChange={e => setForm({ ...form, bank_name: e.target.value })}
                    placeholder="BCA"
                    className="border border-gray-300 rounded-sm px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-gray-700">Nomor Rekening *</span>
                  <input
                    type="text"
                    value={form.account_number}
                    onChange={e => setForm({ ...form, account_number: e.target.value })}
                    placeholder="1234567890"
                    className="border border-gray-300 rounded-sm px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 md:col-span-2">
                  <span className="text-xs font-semibold text-gray-700">Atas Nama *</span>
                  <input
                    type="text"
                    value={form.account_holder}
                    onChange={e => setForm({ ...form, account_holder: e.target.value })}
                    placeholder="Sinar Elektrik"
                    className="border border-gray-300 rounded-sm px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-gray-700">Urutan</span>
                  <NumberInput
                    allowDecimal={false}
                    value={form.sort_order}
                    onChange={n => setForm({ ...form, sort_order: n })}
                    className="border border-gray-300 rounded-sm px-3 py-2 text-sm w-32"
                  />
                </label>
                <label className="flex items-end gap-2 text-xs font-semibold text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={e => setForm({ ...form, is_active: e.target.checked })}
                  />
                  Aktif
                </label>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={cancelForm}
                  className="px-4 py-2 text-xs font-bold text-gray-700 rounded-full hover:bg-gray-100"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={busyId !== null}
                  className="px-4 py-2 bg-[var(--color-caleo-primary)] text-white rounded-full text-xs font-bold disabled:opacity-50 hover:bg-[#01365e]"
                >
                  {busyId !== null ? 'Menyimpan…' : 'Simpan'}
                </button>
              </div>
            </div>
          )}

          {accounts.length === 0 && !showForm && (
            <div className="text-sm text-gray-500 italic">
              Belum ada rekening. Klik <span className="font-semibold">Tambah Rekening</span> untuk mulai.
            </div>
          )}

          {accounts.length > 0 && (
            <div className="flex flex-col gap-2">
              {accounts.map(account => (
                <div
                  key={account.id}
                  className={`flex items-center gap-3 p-3 rounded-sm border ${
                    account.is_active ? 'border-[var(--color-caleo-mist-dark)] bg-[#fafbff]' : 'border-gray-200 bg-gray-50 opacity-70'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleToggleActive(account)}
                    disabled={busyId === account.id}
                    className="text-[var(--color-caleo-primary)] disabled:opacity-50"
                    title={account.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  >
                    {account.is_active
                      ? <ToggleRight size={28} color="#2d8a4e" />
                      : <ToggleLeft size={28} color="#9ca3af" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-[var(--color-caleo-primary)] truncate">
                      {account.bank_name}
                      <span className="text-xs font-normal text-gray-600 ml-2">#{account.sort_order}</span>
                    </div>
                    <div className="text-xs text-gray-700">
                      {account.account_number} · a.n. {account.account_holder}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEdit(account)}
                    disabled={busyId === account.id || showForm}
                    className="text-[var(--color-caleo-primary)] hover:bg-[var(--color-caleo-cloud)] p-2 rounded-sm disabled:opacity-30"
                    title="Edit"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(account)}
                    disabled={busyId === account.id}
                    className="text-red-600 hover:bg-red-50 p-2 rounded-sm disabled:opacity-30"
                    title="Hapus"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
