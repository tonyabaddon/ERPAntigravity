/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// DamageFlagModal — admin flags damaged qty during opname counting (rev 3).
// Owner decides Dispose vs Klaim later via Keputusan Owner inbox.
// This modal captures: qty + optional photo(s) + optional notes.
// Photo is recommended but not required (opname bypass path — chk_evidence_for_loss
// only applies to stock_adjustments, not our supplier_claims direct-write flow).

import { useState } from 'react';
import { AlertTriangle, X, Camera } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { decodeJwt } from '../../lib/jwt';
import { recordOpnameDamage } from '../../lib/supplierClaims/api';
import { extractErrorMessage } from '../../lib/extractErrorMessage';

interface DamageFlagModalProps {
  open: boolean;
  sessionId: number;
  sku: string;
  skuName?: string;
  warehouse: 'atas' | 'bawah';
  countedQty: number;
  initialDamagedQty?: number;
  initialNotes?: string;
  initialEvidenceUrls?: string[];
  onClose: () => void;
  onSaved: (damagedQty: number) => void;
  showToast?: (msg: string, tone?: 'success' | 'warning' | 'info') => void;
}

export function DamageFlagModal({
  open,
  sessionId,
  sku,
  skuName,
  warehouse,
  countedQty,
  initialDamagedQty = 0,
  initialNotes = '',
  initialEvidenceUrls,
  onClose,
  onSaved,
  showToast,
}: DamageFlagModalProps) {
  const [damagedQty, setDamagedQty] = useState<number>(initialDamagedQty);
  const [notes, setNotes] = useState<string>(initialNotes);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const uploadFiles = async (): Promise<string[]> => {
    if (!supabase) throw new Error('Supabase belum dikonfigurasi');
    // Get tenant_id from JWT for tenant-prefixed path (RLS: stock_evidence_insert_own_tenant)
    const { data: { session } } = await supabase.auth.getSession();
    const tenantId: string = (session ? (decodeJwt(session.access_token).tenant_id as string | undefined) : undefined) ?? '';
    if (!tenantId) throw new Error('Missing tenant_id in JWT — cannot upload evidence');
    const urls: string[] = [];
    for (const f of files) {
      const safeName = f.name.replace(/[^\w.-]/g, '_').slice(0, 80);
      const rand = Math.random().toString(36).slice(2, 10);
      // Path: tenants/{tenant_id}/opname-damage/{sessionId}/{ts}-{rand}-{filename}
      const path = `tenants/${tenantId}/opname-damage/${sessionId}/${Date.now()}-${rand}-${safeName}`;
      const { error } = await supabase.storage.from('stock-evidence').upload(path, f);
      if (error) throw error;
      urls.push(path);
    }
    return urls;
  };

  const onSubmit = async () => {
    if (damagedQty < 0) {
      showToast?.('Qty rusak tidak boleh negatif', 'warning');
      return;
    }
    if (damagedQty > countedQty) {
      showToast?.(`Qty rusak maks ${countedQty} (jumlah hitungan)`, 'warning');
      return;
    }
    setSubmitting(true);
    try {
      let evidenceUrls = initialEvidenceUrls;
      if (files.length > 0) {
        const uploaded = await uploadFiles();
        evidenceUrls = [...(initialEvidenceUrls ?? []), ...uploaded];
      }
      await recordOpnameDamage({
        sessionId,
        sku,
        warehouse,
        damagedQty,
        notes: notes || undefined,
        evidenceUrls,
      });
      showToast?.(
        damagedQty === 0 ? 'Tanda rusak dihapus' : `${damagedQty} unit ditandai rusak`,
        'success',
      );
      onSaved(damagedQty);
      onClose();
    } catch (e) {
      showToast?.(extractErrorMessage(e), 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  const sellablePreview = Math.max(0, countedQty - damagedQty);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded bg-white shadow-lg" style={{ fontSize: '14px' }}>
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            <h2 className="font-semibold text-gray-800">Flag Barang Rusak</h2>
          </div>
          <button
            type="button"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            onClick={onClose}
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="rounded bg-gray-50 px-3 py-2 text-sm text-gray-700">
            <div className="font-medium">
              {skuName ?? sku} <span className="text-gray-400">({sku})</span>
            </div>
            <div className="text-xs text-gray-500">
              Gudang {warehouse.toUpperCase()} · Hitungan fisik: {countedQty}
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Qty rusak</span>
            <input
              type="number"
              min={0}
              max={countedQty}
              value={damagedQty}
              onChange={(e) => setDamagedQty(Math.max(0, parseInt(e.target.value || '0', 10)))}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none"
              aria-label="Qty rusak"
            />
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-gray-500">Max: {countedQty}</span>
              <span className="text-gray-600">
                Sellable: <strong>{sellablePreview}</strong>
              </span>
            </div>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Catatan (opsional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none"
              rows={2}
              placeholder="Kondisi kerusakan, misalnya: casing pecah"
            />
          </label>

          <div>
            <span className="text-sm font-medium text-gray-700">Foto bukti (opsional, disarankan)</span>
            <label className="mt-1 flex cursor-pointer items-center gap-2 rounded border border-dashed border-gray-300 px-3 py-2 hover:border-blue-400">
              <Camera className="h-4 w-4 text-gray-400" />
              <span className="text-sm text-gray-600">
                {files.length > 0 ? `${files.length} file dipilih` : 'Pilih foto...'}
              </span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
            </label>
            {(initialEvidenceUrls?.length ?? 0) > 0 && (
              <div className="mt-1 text-xs text-gray-500">
                {initialEvidenceUrls?.length} foto sebelumnya akan dipertahankan
              </div>
            )}
          </div>

          <div className="rounded bg-blue-50 px-3 py-2 text-xs text-blue-800">
            💡 Keputusan Dispose atau Klaim ke Supplier ditentukan Owner setelah opname
            selesai. Kamu hanya perlu menandai kerusakan di sini.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3">
          <button
            type="button"
            className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            onClick={onClose}
            disabled={submitting}
          >
            Batal
          </button>
          <button
            type="button"
            className="rounded bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
            onClick={onSubmit}
            disabled={submitting}
          >
            {submitting ? 'Menyimpan...' : damagedQty === 0 ? 'Hapus tanda rusak' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DamageFlagModal;
