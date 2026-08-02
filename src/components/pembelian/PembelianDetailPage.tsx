// src/components/pembelian/PembelianDetailPage.tsx
//
// Full-page standalone PO detail, opened in a new browser tab via the
// query-string route ?screen=pembelian&po=<po_number>. Replaces the
// PoDetailView modal. No sidebar — the X button closes the tab; to navigate
// elsewhere the operator returns to the list tab.

import React, { useState, useEffect } from 'react';
import {
  X, Printer, FileText, ShoppingCart, ArrowLeft, SearchX, Trash2, CheckCircle2,
} from 'lucide-react';
import {
  DbPurchaseOrder, DbPurchaseOrderItem, DbSupplier,
  StockItem, PermissionSet,
} from '../../types';
import { purchaseOrderService } from '../../lib/pembelianService';
import { adminUsersService } from '../../lib/supabaseClient';
import { fetchStoreSettings } from '../../lib/pengaturan/queries';
import type { StoreSettings } from '../../lib/pengaturan/types';
import { StorageLink } from '../ui/StorageLink';
import { StorageImage } from '../ui/StorageImage';
import ReceiveGoodsModal from './ReceiveGoodsModal';
import MarkAsPaidModal from './MarkAsPaidModal';
import ReceiveReplacementModal from './ReceiveReplacementModal';
import PurchaseOrderFormPage from './PurchaseOrderFormPage';
import { formatIDR } from '../../lib/formatIDR';
import { captureError } from '../../lib/captureError';

interface PembelianDetailPageProps {
  poNumber: string;
  stockList: StockItem[];
  suppliers: DbSupplier[];
  orders: DbPurchaseOrder[];   // for PurchaseOrderFormPage's usage-count sort when editing
  currentUserId?: string;
  currentUserPermissions?: PermissionSet;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onStockRefresh: () => void;
  onBackToList: () => void;    // called by the empty-state button when there's no opener tab
}

const DAMAGE_STATUS_OPTIONS = [
  { value: 'NONE',           label: 'None' },
  { value: 'PENDING_RETURN', label: 'Pending Return' },
  { value: 'RETURNED',       label: 'Returned' },
  { value: 'REPLACED',       label: 'Replaced' },
];
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', ORDERED: 'Dipesan', RECEIVED: 'Diterima', PAID: 'Lunas',
};
function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PembelianDetailPage({
  poNumber, stockList, suppliers, orders,
  currentUserId, currentUserPermissions,
  showToast, onStockRefresh, onBackToList,
}: PembelianDetailPageProps) {
  const [po, setPo] = useState<DbPurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Modal state
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [replaceItem, setReplaceItem] = useState<DbPurchaseOrderItem | null>(null);

  // Inline edit mode (for DRAFT)
  const [editMode, setEditMode] = useState(false);

  // PDF/print helpers
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);

  async function fetchPo() {
    setLoading(true);
    setNotFound(false);
    try {
      const row = await purchaseOrderService.fetchByNumber(poNumber);
      if (!row) {
        setNotFound(true);
        setPo(null);
      } else {
        setPo(row);
        document.title = `${row.po_number} — Pembelian`;
      }
    } catch (e) {
      captureError(e, { feature: 'pembelian_detail', action: 'load_detail' });
      showToast(e instanceof Error ? e.message : 'Gagal memuat detail PO.', 'warning');
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    document.title = `${poNumber} — Pembelian`;
    fetchPo();
    fetchStoreSettings().then(setStoreSettings).catch((err) => {
      captureError(err, { feature: 'pembelian_detail', action: 'fetch_store_settings' });
    });
  }, [poNumber]);

  async function handleDownloadPdf(printMode: 'normal' | 'dot_matrix' = 'normal') {
    if (!po || downloadingPdf) return;
    if (!po.supplier) {
      showToast('Data supplier tidak lengkap. Reload halaman.', 'warning');
      return;
    }
    if (!storeSettings?.alamat_lengkap || !storeSettings?.telp_wa) {
      const proceed = confirm('Alamat atau nomor telepon toko belum diisi di Pengaturan. PDF akan tampil tanpa info tersebut. Tetap generate?');
      if (!proceed) return;
    }
    setDownloadingPdf(true);
    try {
      let createdByName = '—';
      if (po.created_by_user_id) {
        try {
          const admins = await adminUsersService.fetchAll();
          const author = admins.find(a => a.id === po.created_by_user_id);
          if (author) createdByName = author.name;
        } catch { /* fallback */ }
      }
      const { generatePoPdf } = await import('../../lib/pdf/purchaseOrderPdf');
      const blob = await generatePoPdf({
        po,
        supplier: po.supplier,
        items: po.items ?? [],
        storeSettings,
        createdByName,
        printMode,
      });
      const url = URL.createObjectURL(blob);
      const suffix = printMode === 'dot_matrix' ? '-dotmatrix' : '';
      const a = document.createElement('a');
      if ('download' in a) {
        a.href = url; a.download = `${po.po_number}${suffix}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
      } else {
        window.open(url, '_blank');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      captureError(e, { feature: 'pembelian_detail', action: 'generate_pdf' });
      showToast('Gagal generate PDF. Coba lagi.', 'warning');
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function handleMarkOrdered() {
    if (!po) return;
    try {
      await purchaseOrderService.markOrdered(po.id);
      showToast(`${po.po_number} ditandai Dipesan.`, 'success');
      fetchPo();
    } catch (e) {
      captureError(e, { feature: 'pembelian_detail', action: 'mark_ordered' });
      showToast(e instanceof Error ? e.message : 'Gagal mengubah status PO.', 'warning');
    }
  }

  async function handleDelete() {
    if (!po) return;
    if (!confirm(`Hapus PO "${po.po_number}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      await purchaseOrderService.delete(po.id);
      showToast(`${po.po_number} dihapus.`, 'success');
      // Redirect to list URL so the operator isn't stranded on a deleted-PO URL.
      window.location.href = '/?screen=pembelian';
    } catch (e) {
      captureError(e, { feature: 'pembelian_detail', action: 'delete_po' });
      showToast(e instanceof Error ? e.message : 'Gagal menghapus PO.', 'warning');
    }
  }

  async function handleDamageStatusChange(item: DbPurchaseOrderItem, newStatus: string) {
    setUpdatingItemId(item.id);
    try {
      await purchaseOrderService.updateDamageStatus(item.id, newStatus);
      showToast('Status kerusakan diperbarui.', 'success');
      fetchPo();
    } catch (e) {
      captureError(e, { feature: 'pembelian_detail', action: 'update_damage_status' });
      showToast(e instanceof Error ? e.message : 'Gagal memperbarui status.', 'warning');
    } finally {
      setUpdatingItemId(null);
    }
  }

  // --- Render: loading skeleton ---
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
          <div className="w-5 h-5 bg-gray-200 rounded animate-pulse" />
          <div className="bg-gray-100 p-2 rounded w-9 h-9 animate-pulse" />
          <div className="space-y-1">
            <div className="h-4 w-40 bg-gray-200 rounded animate-pulse" />
            <div className="h-3 w-56 bg-gray-100 rounded animate-pulse" />
          </div>
        </div>
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          <div className="bg-white rounded border border-gray-200 p-6 h-24 animate-pulse" />
          <div className="bg-white rounded border border-gray-200 h-64 animate-pulse" />
        </div>
      </div>
    );
  }

  // --- Render: not found ---
  if (notFound || !po) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => {
              window.close();
              // If we're still here, window.close was a no-op (pasted URL, no opener).
              window.location.href = '/?screen=pembelian';
            }}
            aria-label="Tutup"
            className="text-gray-400 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="max-w-2xl mx-auto px-6 py-16">
          <div className="bg-white rounded border border-gray-200 p-10 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 text-gray-400 mb-4">
              <SearchX className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-bold text-[var(--color-caleo-primary)]">PO tidak ditemukan</h2>
            <p className="text-sm text-gray-500 mt-2">Nomor PO <span className="font-mono font-semibold">{poNumber}</span> sudah dihapus atau tidak pernah ada.</p>
            <button
              onClick={() => {
                window.close();
                // If window.close was a no-op (pasted URL), navigate to list URL —
                // a full reload resets the URL params so the chromeless detail-tab
                // branch in App.tsx falls through to the normal list view.
                window.location.href = '/?screen=pembelian';
              }}
              className="mt-6 inline-flex items-center gap-2 bg-[var(--color-caleo-primary)] text-white text-sm font-semibold px-4 py-2.5 rounded hover:bg-[#013865]"
            >
              <ArrowLeft className="w-4 h-4" /> Kembali ke Daftar Pembelian
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Render: inline edit mode ---
  if (editMode && po.status === 'DRAFT') {
    return (
      <PurchaseOrderFormPage
        po={po}
        suppliers={suppliers}
        orders={orders}
        stockList={stockList}
        currentUserId={currentUserId}
        currentUserPermissions={currentUserPermissions}
        onBack={() => setEditMode(false)}
        onSaved={() => { setEditMode(false); fetchPo(); }}
        onSupplierAdded={() => { /* suppliers come from parent, no-op here */ }}
        showToast={showToast}
      />
    );
  }

  // --- Render: detail body ---
  const damagedItems = (po.items ?? []).filter(i => i.qty_damaged > 0);
  const canEdit = currentUserPermissions?.can_edit_po === true;

  return (
    <div className="min-h-screen bg-gray-50" id="po-print-area">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              window.close();
              // If we're still here, window.close was a no-op (pasted URL, no opener).
              window.location.href = '/?screen=pembelian';
            }}
            aria-label="Tutup"
            className="text-gray-400 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="bg-indigo-100 p-2 rounded">
            <ShoppingCart className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-900">{po.po_number}</h1>
            <p className="text-xs text-gray-500">{po.supplier?.name ?? '—'} · <span className="font-semibold">{STATUS_LABEL[po.status]}</span></p>
          </div>
        </div>

        <div className="flex gap-2 items-center">
          {po.status !== 'DRAFT' && (
            <>
              <button
                type="button" onClick={() => handleDownloadPdf('normal')} disabled={downloadingPdf}
                className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 px-3 py-1.5 rounded border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50"
                title="A4 warna untuk printer laser/inkjet"
              >
                <FileText className="w-3.5 h-3.5" />
                {downloadingPdf ? 'Memproses...' : 'PDF A4'}
              </button>
              <button
                type="button" onClick={() => handleDownloadPdf('dot_matrix')} disabled={downloadingPdf}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
                title="Mono hitam-putih untuk Epson LX-310 / LX-2190 dan printer dot matrix lain"
              >
                <FileText className="w-3.5 h-3.5" />
                {downloadingPdf ? 'Memproses...' : 'Dot Matrix'}
              </button>
            </>
          )}
          <button onClick={() => window.print()} className="text-xs text-gray-600 px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50 flex items-center gap-1">
            <Printer className="w-3.5 h-3.5" /> Print
          </button>
          {po.status === 'DRAFT' && canEdit && (
            <button onClick={() => setEditMode(true)} className="text-xs font-semibold text-gray-700 px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50">Edit</button>
          )}
          {po.status === 'DRAFT' && (
            <button onClick={handleMarkOrdered} className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded">Tandai Dipesan</button>
          )}
          {po.status === 'DRAFT' && (
            <button onClick={handleDelete} className="flex items-center gap-1 text-xs font-semibold text-rose-600 px-3 py-1.5 rounded border border-rose-200 hover:bg-rose-50">
              <Trash2 className="w-3.5 h-3.5" /> Hapus
            </button>
          )}
          {po.status === 'ORDERED' && (
            <button onClick={() => setReceiveOpen(true)} className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded">Terima Barang</button>
          )}
          {po.status === 'RECEIVED' && (
            <button onClick={() => setPayOpen(true)} className="flex items-center gap-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded">
              <CheckCircle2 className="w-3.5 h-3.5" /> Tandai Lunas
            </button>
          )}
        </div>
      </div>

      {/* Print-only header (visible only on print) */}
      <div className="hidden print:block px-4 py-4 border-b border-gray-200">
        {storeSettings?.nama_toko && (
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">{storeSettings.nama_toko}</p>
        )}
        <h1 className="text-lg font-bold text-gray-900">Purchase Order</h1>
        <p className="text-sm text-gray-600">{po.po_number} · {formatDate(po.ordered_at ?? po.created_at)}</p>
        <p className="text-sm text-gray-600">Supplier: {po.supplier?.name ?? '—'}</p>
      </div>

      {/* Body */}
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* PO meta */}
        <div className="bg-white rounded border border-gray-200 p-6 grid grid-cols-3 gap-6 text-sm">
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Tanggal Pesan</p>
            <p className="font-semibold text-gray-800 mt-1">{formatDate(po.ordered_at)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Tanggal Terima</p>
            <p className="font-semibold text-gray-800 mt-1">{formatDate(po.received_at)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Jatuh Tempo</p>
            <p className={`font-semibold mt-1 ${po.payment_due_at ? 'text-amber-600' : 'text-gray-400'}`}>{formatDate(po.payment_due_at)}</p>
          </div>
        </div>

        {/* Items */}
        <div className="bg-white rounded border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Item Pembelian</p>
          </div>
          <div className="grid grid-cols-6 px-3 py-2 bg-gray-50 border-b border-gray-200 text-caleo-11 font-bold uppercase tracking-wide text-gray-500">
            <span className="col-span-2">Produk</span>
            <span className="text-center">Diterima</span>
            <span className="text-right">Harga Beli</span>
            <span className="text-right">Harga Jual</span>
            <span className="text-right">Margin</span>
          </div>
          {(po.items ?? []).map(item => {
            const stockItem = stockList.find(s => s.sku === item.sku);
            const sellingPrice = stockItem?.price ?? 0;
            const margin = sellingPrice > 0 ? ((sellingPrice - item.unit_cost) / sellingPrice * 100) : 0;
            return (
              <div key={item.id} className="grid grid-cols-6 px-3 py-2.5 border-b border-gray-100 items-center">
                <div className="col-span-2">
                  <div className="font-semibold text-gray-800">{item.product_name}</div>
                  <div className="font-mono text-caleo-11 text-gray-400">
                    {item.sku}{item.qty_damaged > 0 && <span className="text-rose-500"> · {item.qty_damaged} rusak</span>}
                  </div>
                </div>
                <span className="text-center text-gray-600">{item.qty_received}</span>
                <span className="text-right text-gray-600">{formatIDR(item.unit_cost)}</span>
                <span className="text-right text-gray-600">{sellingPrice > 0 ? formatIDR(sellingPrice) : '—'}</span>
                <span className={`text-right font-bold ${margin > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
                  {sellingPrice > 0 ? `+${margin.toFixed(1)}%` : '—'}
                </span>
              </div>
            );
          })}
          <div className="flex justify-end gap-8 px-3 py-2.5 border-t-2 border-gray-200 bg-gray-50 text-xs">
            <div className="text-right text-gray-400 leading-relaxed">
              Subtotal<br />
              {po.tax_rate > 0 && <>PPN ({(po.tax_rate * 100).toFixed(0)}%)<br /></>}
              <strong className="text-gray-700">Total</strong>
            </div>
            <div className="text-right text-gray-600 leading-relaxed min-w-[120px]">
              {formatIDR(po.subtotal)}<br />
              {po.tax_rate > 0 && <>{formatIDR(po.tax_amount)}<br /></>}
              <strong className="text-gray-800">{formatIDR(po.total)}</strong>
            </div>
          </div>
        </div>

        {/* Damaged goods */}
        {damagedItems.length > 0 && (
          <div className="bg-white rounded border border-rose-200 overflow-hidden print:hidden">
            <div className="flex items-center gap-2 px-6 py-4 border-b border-rose-100">
              <p className="text-xs font-bold uppercase tracking-wide text-rose-500">Barang Rusak</p>
              <span className="bg-rose-100 text-rose-700 text-caleo-11 font-semibold px-2 py-0.5 rounded-full">
                {damagedItems.reduce((s, i) => s + i.qty_damaged, 0)} item
              </span>
            </div>
            <div className="grid grid-cols-12 px-3 py-2 bg-rose-50 border-b border-rose-200 text-caleo-11 font-bold uppercase tracking-wide text-rose-400">
              <span className="col-span-3">Produk</span>
              <span className="col-span-1 text-center">Qty</span>
              <span className="col-span-4">Catatan</span>
              <span className="col-span-4 text-center">Status Retur</span>
            </div>
            {damagedItems.map(item => (
              <div key={item.id} className="grid grid-cols-12 px-3 py-2.5 items-center border-b border-rose-100 bg-white last:border-b-0">
                <div className="col-span-3">
                  <div className="font-semibold text-gray-800">{item.product_name}</div>
                  <div className="font-mono text-caleo-11 text-gray-400">{item.sku}</div>
                </div>
                <span className="col-span-1 text-center font-bold text-rose-600">{item.qty_damaged}</span>
                <span className="col-span-4 text-gray-500 text-xs">{item.damage_notes ?? '—'}</span>
                <div className="col-span-4 flex justify-center items-center gap-2">
                  {item.damage_status === 'REPLACED' ? (
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded">Replaced</span>
                  ) : (
                    <>
                      <select
                        value={item.damage_status}
                        disabled={updatingItemId === item.id}
                        onChange={e => handleDamageStatusChange(item, e.target.value)}
                        className="text-xs border border-amber-200 rounded px-2 py-1 bg-amber-50 text-amber-700 font-semibold focus-visible:outline-none disabled:opacity-50"
                      >
                        {DAMAGE_STATUS_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      {item.damage_status === 'RETURNED' && (
                        <button
                          onClick={() => setReplaceItem(item)}
                          className="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-2 py-1 rounded whitespace-nowrap"
                        >
                          Terima Pengganti
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Attachments */}
        {(po.invoice_url || po.payment_proof_url) && (
          <div className="bg-white rounded border border-gray-200 p-6 space-y-4 print:hidden">
            {po.invoice_url && (
              <div>
                <div className="text-caleo-11 font-bold uppercase tracking-wide text-gray-500 mb-2">Invoice Supplier</div>
                <StorageImage
                  bucket="purchase-documents"
                  path={po.invoice_url}
                  alt="Invoice Supplier"
                  className="w-32 h-40 border border-gray-200"
                  aspectRatio="4/5"
                />
                <StorageLink bucket="purchase-documents" storageRef={po.invoice_url} className="text-xs text-indigo-600 hover:underline block mt-1">Lihat Penuh ↗</StorageLink>
              </div>
            )}
            {po.payment_proof_url && (
              <div>
                <div className="text-caleo-11 font-bold uppercase tracking-wide text-gray-500 mb-2">Bukti Pembayaran</div>
                <StorageImage
                  bucket="purchase-documents"
                  path={po.payment_proof_url}
                  alt="Bukti Pembayaran"
                  className="w-32 h-40 border border-gray-200"
                  aspectRatio="4/5"
                />
                <StorageLink bucket="purchase-documents" storageRef={po.payment_proof_url} className="text-xs text-indigo-600 hover:underline block mt-1">Lihat Penuh ↗</StorageLink>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {receiveOpen && (
        <ReceiveGoodsModal
          po={po}
          onClose={() => setReceiveOpen(false)}
          onReceived={() => { setReceiveOpen(false); onStockRefresh(); fetchPo(); }}
          showToast={showToast}
        />
      )}
      {payOpen && (
        <MarkAsPaidModal
          po={po}
          onClose={() => setPayOpen(false)}
          onPaid={() => { setPayOpen(false); fetchPo(); }}
          showToast={showToast}
        />
      )}
      {replaceItem && (
        <ReceiveReplacementModal
          item={replaceItem}
          onClose={() => setReplaceItem(null)}
          onReplaced={() => { setReplaceItem(null); fetchPo(); }}
          showToast={showToast}
        />
      )}
    </div>
  );
}
