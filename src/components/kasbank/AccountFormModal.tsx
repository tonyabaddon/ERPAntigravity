/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { X, Save, Landmark, Banknote, Bike } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { createCashAccount, updateCashAccount } from '../../lib/kasbank/service';
import { NumberInput } from '../ui/NumberInput';
import type {
  CashAccount,
  CashAccountInput,
  CashAccountType,
  CashAccountPurpose,
  BankCode,
} from '../../lib/kasbank/types';
import { wibDateString } from '../../lib/format';

interface AccountFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editingAccount?: CashAccount | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

const BANK_CODES: BankCode[] = ['BCA', 'MANDIRI', 'BRI', 'BNI', 'PERMATA', 'CIMB', 'OTHER'];

const WALLET_PROVIDERS = ['Lalamove', 'GoSend', 'Grab', 'OVO', 'DANA', 'GoPay', 'Lainnya'];

const PURPOSES: Array<{ value: CashAccountPurpose; label: string }> = [
  { value: 'OPERATIONAL', label: 'Operasional bisnis' },
  { value: 'SAVINGS', label: 'Tabungan bisnis' },
  { value: 'OWNER_PERSONAL', label: 'Pribadi owner' },
  { value: 'PETTY_CASH', label: 'Kas kecil / petty cash' },
  { value: 'OTHER', label: 'Lainnya' },
];

interface FormState {
  account_type: CashAccountType;
  bank_code: BankCode | null;
  account_number: string;
  account_holder: string;
  internal_label: string;
  provider: string;
  purpose: CashAccountPurpose;
  show_in_invoice: boolean;
  opening_balance: number;
  opening_balance_date: string;
}

const EMPTY_FORM: FormState = {
  account_type: 'BANK',
  bank_code: 'BCA',
  account_number: '',
  account_holder: '',
  internal_label: '',
  provider: 'Lalamove',
  purpose: 'OPERATIONAL',
  show_in_invoice: true,
  opening_balance: 0,
  opening_balance_date: wibDateString(),
};

/**
 * Resolve or create a sub-COA for this cash account.
 * - BANK → next 1-12NN under 1-1200 parent (or reuse existing if internal_label matches)
 * - E_WALLET → next 1-13NN under 1-1300 parent
 * - KAS → return existing 1-1110 Kas Toko id (no new COA)
 */
async function resolveCoaAccountId(
  accountType: CashAccountType,
  internalLabel: string,
): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured');

  if (accountType === 'KAS') {
    const { data, error } = await supabase
      .from('chart_of_accounts')
      .select('id')
      .eq('account_code', '1-1110')
      .single();
    if (error || !data) throw new Error('Akun 1-1110 Kas Toko tidak ditemukan di chart_of_accounts');
    return data.id;
  }

  const parentCode = accountType === 'BANK' ? '1-1200' : '1-1300';
  const childPrefix = accountType === 'BANK' ? '1-12' : '1-13';
  const subtype = accountType === 'BANK' ? 'BANK' : 'E_WALLET';

  const { data: parent, error: parentErr } = await supabase
    .from('chart_of_accounts')
    .select('id')
    .eq('account_code', parentCode)
    .single();
  if (parentErr || !parent) throw new Error(`Parent COA ${parentCode} tidak ditemukan`);

  // Count existing sub-COAs under this parent to derive next code
  const { data: children, error: childErr } = await supabase
    .from('chart_of_accounts')
    .select('account_code')
    .eq('parent_id', parent.id)
    .like('account_code', `${childPrefix}%`);
  if (childErr) throw childErr;

  // Start at 10 + count to leave 1-12{00..09} reserved as system codes
  const nextSuffix = 10 + (children?.length ?? 0);
  const newCode = `${childPrefix}${String(nextSuffix).padStart(2, '0')}`;

  const { data: inserted, error: insErr } = await supabase
    .from('chart_of_accounts')
    .insert({
      account_code: newCode,
      account_name: internalLabel,
      account_type: 'ASET',
      account_subtype: subtype,
      parent_id: parent.id,
      normal_balance: 'DEBIT',
      is_system: false,
      is_active: true,
    })
    .select('id')
    .single();
  if (insErr || !inserted) throw insErr ?? new Error('Failed to insert sub-COA');
  return inserted.id;
}

export default function AccountFormModal({
  open,
  onClose,
  onSaved,
  editingAccount,
  showToast,
}: AccountFormModalProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editingAccount) {
      setForm({
        account_type: editingAccount.account_type,
        bank_code: editingAccount.bank_code,
        account_number: editingAccount.account_number ?? '',
        account_holder: editingAccount.account_holder ?? '',
        internal_label: editingAccount.internal_label,
        provider: editingAccount.provider ?? 'Lalamove',
        purpose: editingAccount.purpose,
        show_in_invoice: editingAccount.show_in_invoice,
        opening_balance: editingAccount.opening_balance,
        opening_balance_date: editingAccount.opening_balance_date ?? wibDateString(),
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, editingAccount]);

  if (!open) return null;

  const isEdit = !!editingAccount;

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validate(): string | null {
    if (!form.internal_label.trim()) return 'Nickname / nama akun wajib diisi';
    if (form.account_type === 'BANK') {
      if (!form.bank_code) return 'Bank wajib dipilih untuk akun BANK';
      if (!form.account_number.trim()) return 'Nomor rekening wajib diisi untuk akun BANK';
    }
    if (form.account_type === 'E_WALLET' && !form.provider.trim()) {
      return 'Provider wajib diisi untuk E-Wallet';
    }
    return null;
  }

  async function handleSave() {
    const err = validate();
    if (err) {
      showToast(err, 'warning');
      return;
    }

    setSaving(true);
    try {
      if (isEdit && editingAccount) {
        const patch: Partial<CashAccountInput> = {
          internal_label: form.internal_label.trim(),
          account_holder: form.account_holder.trim() || null,
          account_number: form.account_type === 'BANK' ? form.account_number.trim() : null,
          bank_code: form.account_type === 'BANK' ? form.bank_code : null,
          provider: form.account_type === 'E_WALLET' ? form.provider.trim() : null,
          purpose: form.purpose,
          show_in_invoice: form.show_in_invoice,
          opening_balance: form.opening_balance,
          opening_balance_date: form.opening_balance_date || null,
        };
        await updateCashAccount(editingAccount.id, patch);
        showToast('✓ Akun berhasil diupdate', 'success');
      } else {
        const coaId = await resolveCoaAccountId(form.account_type, form.internal_label.trim());
        const input: CashAccountInput = {
          account_type: form.account_type,
          bank_code: form.account_type === 'BANK' ? form.bank_code : null,
          account_number: form.account_type === 'BANK' ? form.account_number.trim() : null,
          account_holder: form.account_holder.trim() || null,
          internal_label: form.internal_label.trim(),
          provider: form.account_type === 'E_WALLET' ? form.provider.trim() : null,
          purpose: form.purpose,
          show_in_invoice: form.show_in_invoice,
          sort_order: 0,
          is_active: true,
          opening_balance: form.opening_balance,
          opening_balance_date: form.opening_balance_date || null,
          coa_account_id: coaId,
        };
        await createCashAccount(input);
        showToast('✓ Akun berhasil dibuat', 'success');
      }
      onSaved();
      onClose();
    } catch (e) {
      showToast(`Gagal: ${e instanceof Error ? e.message : 'unknown error'}`, 'warning');
    } finally {
      setSaving(false);
    }
  }

  const TypeIcon = form.account_type === 'BANK' ? Landmark : form.account_type === 'KAS' ? Banknote : Bike;
  const typeTint =
    form.account_type === 'BANK'
      ? 'bg-blue-100 text-blue-700'
      : form.account_type === 'KAS'
      ? 'bg-emerald-100 text-caleo-success'
      : 'bg-amber-100 text-amber-700';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="bg-white rounded max-w-2xl w-full shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded flex items-center justify-center flex-shrink-0 ${typeTint}`}>
              <TypeIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold" style={{ color: 'var(--color-primary)' }}>
                {isEdit ? 'Edit Akun Kas & Bank' : 'Tambah Akun Kas & Bank'}
              </h2>
              <p className="text-xs text-gray-600 mt-0.5">
                {isEdit
                  ? 'Edit metadata akun · type tidak bisa diubah setelah create'
                  : 'Akun baru otomatis dapat sub-COA di chart_of_accounts'}
              </p>
            </div>
          </div>
          <button
            onClick={() => !saving && onClose()}
            className="text-gray-500 hover:text-gray-700 p-1 rounded hover:bg-gray-100"
            disabled={saving}
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 text-caleo-13">
          <div>
            <label className="block font-bold mb-1" style={{ color: 'var(--color-primary)' }}>
              Jenis akun *
            </label>
            <select
              value={form.account_type}
              onChange={(e) => updateField('account_type', e.target.value as CashAccountType)}
              disabled={isEdit}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 bg-white disabled:bg-slate-100 disabled:cursor-not-allowed"
            >
              <option value="BANK">🏦 Bank</option>
              <option value="KAS">💵 Kas</option>
              <option value="E_WALLET">👛 E-Wallet</option>
            </select>
            {isEdit && (
              <p className="text-caleo-10 text-gray-500 mt-1">
                Account type tidak bisa diubah setelah create.
              </p>
            )}
          </div>

          {form.account_type === 'BANK' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1" style={{ color: 'var(--color-primary)' }}>
                    Bank *
                  </label>
                  <select
                    value={form.bank_code ?? 'BCA'}
                    onChange={(e) => updateField('bank_code', e.target.value as BankCode)}
                    className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 bg-white"
                  >
                    {BANK_CODES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1" style={{ color: 'var(--color-primary)' }}>
                    Nomor rekening *
                  </label>
                  <input
                    type="text"
                    value={form.account_number}
                    onChange={(e) => updateField('account_number', e.target.value)}
                    placeholder="1234567890"
                    className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1" style={{ color: 'var(--color-primary)' }}>
                  Nama di buku tabungan
                </label>
                <input
                  type="text"
                  value={form.account_holder}
                  onChange={(e) => updateField('account_holder', e.target.value)}
                  placeholder="Nama sesuai buku rekening"
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
                />
                <p className="text-caleo-11 text-gray-500 mt-1">Untuk tampil di Invoice PDF customer (kalau Show in Invoice di-aktifkan)</p>
              </div>
            </>
          )}

          {form.account_type === 'E_WALLET' && (
            <div>
              <label className="block font-bold mb-1" style={{ color: 'var(--color-primary)' }}>
                Provider *
              </label>
              <select
                value={form.provider}
                onChange={(e) => updateField('provider', e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 bg-white"
              >
                {WALLET_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block font-bold mb-1" style={{ color: 'var(--color-primary)' }}>
              Nickname internal *
            </label>
            <input
              type="text"
              value={form.internal_label}
              onChange={(e) => updateField('internal_label', e.target.value)}
              placeholder={
                form.account_type === 'BANK'
                  ? 'BCA Operasional'
                  : form.account_type === 'KAS'
                  ? 'Kas Toko Cabang 2'
                  : 'Lalamove Balance'
              }
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
            />
            <p className="text-caleo-11 text-gray-500 mt-1">Untuk memudahkan identifikasi di UI internal</p>
          </div>

          <div>
            <label className="block font-bold mb-1" style={{ color: 'var(--color-primary)' }}>
              Peruntukan *
            </label>
            <select
              value={form.purpose}
              onChange={(e) => updateField('purpose', e.target.value as CashAccountPurpose)}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 bg-white"
            >
              {PURPOSES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="text-caleo-11 text-gray-500 mt-1">
              "Pribadi owner" otomatis di-tag chip Pribadi + di-exclude dari laporan bisnis
            </p>
          </div>

          {!isEdit && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold mb-1" style={{ color: 'var(--color-primary)' }}>
                  Saldo awal
                </label>
                <NumberInput
                  value={form.opening_balance}
                  onChange={(n) => updateField('opening_balance', n)}
                  placeholder="0"
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
                />
                <p className="text-caleo-10 text-gray-500 mt-1">Default 0 — adjust via Penyesuaian (Phase 2)</p>
              </div>
              <div>
                <label className="block font-bold mb-1" style={{ color: 'var(--color-primary)' }}>
                  Tanggal saldo awal
                </label>
                <input
                  type="date"
                  value={form.opening_balance_date}
                  onChange={(e) => updateField('opening_balance_date', e.target.value)}
                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
                />
              </div>
            </div>
          )}

          {form.account_type === 'BANK' && (
            <div className="border border-[var(--color-caleo-mist-dark)] bg-[#fafbff] rounded p-3 flex items-center gap-2">
              <input
                type="checkbox"
                id="show_in_invoice"
                checked={form.show_in_invoice}
                onChange={(e) => updateField('show_in_invoice', e.target.checked)}
                className="w-4 h-4"
              />
              <label htmlFor="show_in_invoice" className="text-xs">
                <strong>Tampilkan di Invoice PDF</strong> ke customer (default ON untuk akun bisnis)
              </label>
            </div>
          )}

          {!isEdit && (
            <div className="border border-[var(--color-caleo-mist-dark)] bg-[#fafbff] rounded p-3 text-caleo-11 text-gray-600">
              💡 Saat Simpan: sistem otomatis create sub-COA{' '}
              <span className="font-mono font-bold">
                {form.account_type === 'BANK' ? '1-12NN' : form.account_type === 'E_WALLET' ? '1-13NN' : '1-1110 (existing)'}
              </span>{' '}
              di Chart of Accounts dengan nama = nickname internal. Akun langsung siap dipakai sebagai source/destination di flow Phase 0b nanti.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 flex gap-2 justify-end">
          <button
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="border border-[var(--color-caleo-mist-dark)] bg-white text-[#1e3d60] rounded-full text-xs font-bold px-4 py-2 hover:bg-[var(--color-caleo-cloud)] disabled:opacity-50"
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-[var(--color-caleo-primary)] text-white rounded-full text-xs font-bold px-4 py-2 hover:bg-[#01365e] disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Menyimpan...' : isEdit ? 'Update Akun' : 'Simpan Akun'}
          </button>
        </div>
      </div>
    </div>
  );
}
