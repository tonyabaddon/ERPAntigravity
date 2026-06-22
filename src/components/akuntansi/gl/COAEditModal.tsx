/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { updateCoaAccount } from '../../../lib/akuntansi/coaUpdate';
import type { CoaTreeRow } from '../../../lib/akuntansi/glQueries';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface COAEditModalProps {
  open: boolean;
  account: CoaTreeRow;
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function COAEditModal({
  open,
  account,
  onClose,
  onSaved,
  showToast,
}: COAEditModalProps): React.ReactElement | null {
  const [accountName, setAccountName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Initialize form when account changes
  useEffect(() => {
    setAccountName(account.account_name);
    setDescription(account.description || '');
    setIsActive(account.is_active);
  }, [account]);

  if (!open) return null;

  const nameLength = accountName.trim().length;
  const isNameValid = nameLength >= 3;
  const isSystemAccount = account.is_system;

  async function handleSave() {
    // Validate name length
    if (!isNameValid) {
      showToast('Nama akun minimal 3 karakter', 'warning');
      return;
    }

    setSaving(true);
    try {
      await updateCoaAccount({
        id: account.id,
        accountName: accountName.trim(),
        description: description.trim() || null,
        isActive,
      });
      showToast('✓ COA berhasil diupdate', 'success');
      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Gagal mengupdate COA';
      showToast(message, 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* ── Backdrop ── */}
      <div
        className="fixed inset-0 z-40 bg-black/40 transition-opacity"
        onClick={onClose}
      />

      {/* ── Modal ── */}
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div
          className="bg-white rounded-3xl shadow-lg max-w-md w-full mx-4 pointer-events-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* ── Header ── */}
          <div className="p-6 border-b border-gray-200 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-[#012749]">
                Edit COA · <span className="font-mono">{account.account_code}</span>
              </h3>
              <p className="text-xs text-gray-600 mt-0.5">
                Owner-only · system accounts protected
              </p>
            </div>
            <button
              className="p-1 rounded-lg hover:bg-gray-100 transition-colors text-gray-600 shrink-0"
              onClick={onClose}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* ── Body ── */}
          <div className="p-6 space-y-4">
            {/* Readonly: account code */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">
                Kode Akun
              </label>
              <div className="px-3 py-2 rounded-lg border border-[#c7d7f5] bg-gray-50 font-mono text-[13px] text-gray-600">
                {account.account_code}
              </div>
            </div>

            {/* Readonly: account type */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">
                Tipe Akun
              </label>
              <div className="px-3 py-2 rounded-lg border border-[#c7d7f5] bg-gray-50 text-[13px] text-gray-600">
                {account.account_type}
              </div>
            </div>

            {/* Readonly: parent (if any) */}
            {account.parent_id && (
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">
                  Akun Induk
                </label>
                <div className="px-3 py-2 rounded-lg border border-[#c7d7f5] bg-gray-50 text-[13px] text-gray-600">
                  {account.parent_id}
                </div>
              </div>
            )}

            {/* Editable: account name */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">
                Nama Akun *
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 rounded-lg border border-[#c7d7f5] bg-white text-[13px] text-[#43474e] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#c7d7f5]"
                value={accountName}
                onChange={e => setAccountName(e.target.value)}
                placeholder="Nama akun"
              />
              <p className="text-[10px] text-gray-500 mt-1">
                {nameLength} / 3 min
              </p>
            </div>

            {/* Editable: description */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">
                Deskripsi
              </label>
              <textarea
                className="w-full px-3 py-2 rounded-lg border border-[#c7d7f5] bg-white text-[13px] text-[#43474e] placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#c7d7f5] resize-none"
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Deskripsi (optional)"
              />
            </div>

            {/* Toggle: is_active */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={e => setIsActive(e.target.checked)}
                  disabled={isSystemAccount}
                  className="w-4 h-4 rounded border-[#c7d7f5] text-[#012749] focus:ring-[#c7d7f5] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <span className="text-xs font-bold text-gray-700">Aktif</span>
              </label>
              {isSystemAccount && (
                <p className="text-[10px] text-gray-500 mt-1">
                  Akun sistem tidak bisa dinonaktifkan
                </p>
              )}
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="px-6 py-4 border-t border-gray-200 flex items-center gap-2 justify-end">
            <button
              className="px-4 py-2 rounded-lg border border-[#c7d7f5] bg-white text-[13px] font-bold text-[#012749] hover:bg-gray-50 transition-colors"
              onClick={onClose}
              disabled={saving}
            >
              Batal
            </button>
            <button
              className="px-4 py-2 rounded-lg bg-[#012749] text-white text-[13px] font-bold hover:bg-[#0a1a2e] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSave}
              disabled={saving || !isNameValid}
            >
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
