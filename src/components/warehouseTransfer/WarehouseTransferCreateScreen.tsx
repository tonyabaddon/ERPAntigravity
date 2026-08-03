/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Info, Loader2 } from 'lucide-react';
import { warehouseTransferService } from '../../lib/warehouseTransferService';
import { useWarehouses } from '../../hooks/useWarehouses';
import { buildHref } from '../../lib/urlRoute';
import { extractErrorMessage } from '../../lib/extractErrorMessage';
import WarehouseTransferSKUPicker, { TransferLine } from './WarehouseTransferSKUPicker';

export default function WarehouseTransferCreateScreen({
  currentUserId,
  currentUserName,
  onDone,
  onCancel,
  searchSKU,
  listReceivers,
}: {
  currentUserId: string;
  currentUserName?: string;
  onDone: (transferId: number) => void;
  onCancel: () => void;
  searchSKU: (term: string, fromWarehouseId: string) => Promise<Array<{ sku: string; name: string; qty: number }>>;
  listReceivers: (warehouseId: string) => Promise<Array<{ id: string; name: string }>>;
}) {
  const { warehouses } = useWarehouses();

  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [receiverId, setReceiverId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [receivers, setReceivers] = useState<Array<{ id: string; name: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sameWarningVisible, setSameWarningVisible] = useState(false);

  // Dedupe on network retry — generated once per mount
  const clientRequestId = useMemo(() => crypto.randomUUID(), []);

  // When toId changes, load receiver options
  useEffect(() => {
    if (!toId) {
      setReceivers([]);
      setReceiverId('');
      return;
    }
    listReceivers(toId).then(list => {
      setReceivers(list);
      setReceiverId('');
    });
  }, [toId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-swap: when fromId === toId and both are set, clear toId
  function handleFromChange(val: string) {
    setFromId(val);
    if (val && val === toId) {
      setToId('');
      setReceivers([]);
      setReceiverId('');
      setSameWarningVisible(true);
    } else {
      setSameWarningVisible(false);
    }
  }

  function handleToChange(val: string) {
    if (val && val === fromId) {
      setSameWarningVisible(true);
      return; // block — don't set same warehouse
    }
    setSameWarningVisible(false);
    setToId(val);
  }

  // Derive warehouse names for the info banner
  const fromName = warehouses.find(w => w.id === fromId)?.name ?? '';
  const toName = warehouses.find(w => w.id === toId)?.name ?? '';
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);

  // Belt-and-suspenders: guard submit even if UI filtering is bypassed (keyboard/AT)
  const sameWarehouse = !!(fromId && toId && fromId === toId);

  // Validate and build payload
  function validate(): string | null {
    if (!fromId) return 'Pilih gudang pengirim.';
    if (!toId) return 'Pilih gudang tujuan.';
    if (!receiverId) return 'Pilih penerima.';
    if (lines.length === 0) return 'Tambahkan minimal 1 barang.';
    return null;
  }

  async function submit(withPDF = false) {
    // Belt-and-suspenders: catch same-warehouse even if the button wasn't disabled
    if (sameWarehouse) {
      setError('Gudang asal dan tujuan tidak boleh sama.');
      return;
    }
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setError(null);
    setSubmitting(true);
    try {
      const result = await warehouseTransferService.initiateTransfer({
        fromWarehouseId: fromId,
        toWarehouseId: toId,
        receiverUserId: receiverId,
        notes: notes.trim() || null,
        clientRequestId,
        items: lines.map(l => ({ sku: l.sku, qty: l.qty })),
      });

      if (withPDF) {
        try {
          const { renderTransferSuratJalan } = await import('../../lib/pdf/warehouseTransferPDF');
          const detail = await warehouseTransferService.getTransferDetail(result.transfer_id);
          if (detail) {
            const blob = await renderTransferSuratJalan(detail, {
              tenantName: '',
              tenantAddress: null,
              fromWarehouseName: fromName,
              toWarehouseName: toName,
              senderName: currentUserId,
              receiverName: receivers.find(r => r.id === receiverId)?.name ?? '',
              skuNames: Object.fromEntries(lines.map(l => [l.sku, l.name])),
              logoUrl: null,
            });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
          }
        } catch {
          // PDF failure is non-fatal — transfer is already created
        }
      }

      onDone(result.transfer_id);
    } catch (e) {
      const msg = extractErrorMessage(e);
      setError(msg.includes('TRANSFER_INSUFFICIENT_STOCK')
        ? 'Stok tidak cukup: ' + msg.split('TRANSFER_INSUFFICIENT_STOCK:').pop()?.trim()
        : msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onCancel}
          className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
          aria-label="Kembali">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-xl font-semibold text-slate-800">Buat Transfer Baru</h1>
      </div>

      {/* DARI GUDANG / KE GUDANG */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="from-warehouse" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Dari Gudang
          </label>
          <select
            id="from-warehouse"
            value={fromId}
            onChange={e => handleFromChange(e.target.value)}
            className="w-full rounded border border-slate-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
          >
            <option value="">— Pilih gudang —</option>
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="to-warehouse" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Ke Gudang
          </label>
          <select
            id="to-warehouse"
            value={toId}
            onChange={e => handleToChange(e.target.value)}
            className="w-full rounded border border-slate-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
          >
            <option value="">— Pilih gudang —</option>
            {warehouses.filter(w => w.id !== fromId).map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
      </div>

      {sameWarningVisible && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded border border-amber-200 px-3 py-2">
          Gudang pengirim dan tujuan tidak boleh sama.
        </p>
      )}

      {/* DIKIRIM OLEH + DIKIRIM KEPADA */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="sender" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Dikirim Oleh
          </label>
          <input
            id="sender"
            value={currentUserName || currentUserId}
            disabled
            className="w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
          />
        </div>
        <div>
          <label htmlFor="receiver" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Dikirim Kepada
          </label>
          <select
            id="receiver"
            value={receiverId}
            onChange={e => setReceiverId(e.target.value)}
            disabled={!toId || receivers.length === 0}
            className="w-full rounded border border-slate-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">— Pilih penerima —</option>
            {receivers.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          {toId && receivers.length === 0 && (
            <p className="text-xs text-slate-500 mt-1">
              Belum ada penerima.{' '}
              <a
                href={buildHref('user-management')}
                className="underline hover:text-slate-700"
              >
                Tambahkan user via Pengaturan → User Management.
              </a>
            </p>
          )}
        </div>
      </div>

      {/* CATATAN */}
      <div>
        <label htmlFor="notes" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Catatan <span className="font-normal text-slate-400">(opsional)</span>
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="Keterangan tambahan untuk driver atau penerima…"
          className="w-full rounded border border-slate-200 px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
        />
      </div>

      {/* Barang Dikirim */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Barang Dikirim</p>
        <WarehouseTransferSKUPicker
          fromWarehouseId={fromId || null}
          lines={lines}
          onChange={setLines}
          searchSKU={searchSKU}
        />
      </div>

      {/* Info banner */}
      {fromId && toId && lines.length > 0 && (
        <div className="flex gap-2 rounded border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Setelah &ldquo;Kirim&rdquo;, stok <strong>{fromName}</strong> berkurang{' '}
            <strong>{totalQty} pcs</strong> dan masuk In-Transit sampai penerima konfirmasi
            terima di <strong>{toName}</strong>.
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-caleo-danger">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="rounded border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Batal
        </button>
        <button
          onClick={() => submit(false)}
          disabled={submitting || sameWarehouse}
          className="flex items-center gap-1.5 rounded border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Kirim Transfer
        </button>
        <button
          onClick={() => submit(true)}
          disabled={submitting || sameWarehouse}
          className="flex items-center gap-1.5 rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Kirim + Cetak PDF
        </button>
      </div>
    </div>
  );
}
