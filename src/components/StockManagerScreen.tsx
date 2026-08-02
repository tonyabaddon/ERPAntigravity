/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { StockItem, ApprovalRequest, DbTenantSettings } from '../types';
import { isSupabaseConfigured, listPendingApprovals, stockService } from '../lib/supabaseClient';
import { fetchStoreSettings } from '../lib/pengaturan/queries';
import { tenantSettingsService } from '../lib/pengaturan/pengaturanServices';
import { isFieldVisible } from '../lib/pengaturan/cascadeMap';
import { captureError } from '../lib/captureError';
import { useWarehouses } from '../hooks/useWarehouses';
import StockAdjustmentModal from './stok/StockAdjustmentModal';
import PriceChangeRequestModal from './stok/PriceChangeRequestModal';
import PendingApprovalBadge from './approval/PendingApprovalBadge';
import BulkUploadSection from './produk/BulkUploadSection';
import BulkUpdateTierPricesSection from './produk/BulkUpdateTierPricesSection';
import StockTableView from './produk/StockTableView';
import CatalogGridView from './produk/CatalogGridView';
import ProductForm from './produk/ProductForm';
import ViewModeSwitcher, { type ViewMode } from './produk/ViewModeSwitcher';
import CatalogListView from './produk/CatalogListView';

interface StockManagerScreenProps {
  stockList: StockItem[];
  onStockUpdate: (updated: StockItem[]) => void;
  onStocksRefresh?: () => Promise<void> | void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  currentUser?: { id: string; name: string; role: string } | null;
  onNavigateToOpname?: () => void;
}

type Tab = 'katalog' | 'stok' | 'bulk' | 'tipis';

export default function StockManagerScreen({ stockList, onStockUpdate, onStocksRefresh, showToast, currentUser, onNavigateToOpname }: StockManagerScreenProps) {
  const [activeTab, setActiveTab] = useState<Tab>('katalog');
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  // View mode (Plan B foto-search) — fresh List default per visit, no persistence.
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState<Map<string, number>>(new Map());
  // Search + category filter lifted from CatalogGridView — shared across both modes.
  const [katalogSearch, setKatalogSearch] = useState('');
  const [katalogCategory, setKatalogCategory] = useState<string>('Semua');
  const katalogCategories = useMemo(
    () => ['Semua', ...Array.from(new Set(stockList.map(s => s.category)))],
    [stockList]
  );
  const filteredKatalog = useMemo(() => stockList.filter(s => {
    if (katalogCategory !== 'Semua' && s.category !== katalogCategory) return false;
    if (katalogSearch) {
      const q = katalogSearch.toLowerCase();
      if (!s.name.toLowerCase().includes(q) && !s.sku.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [stockList, katalogSearch, katalogCategory]);
  const toggleRow = (sku: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku); else next.add(sku);
      return next;
    });
    setCurrentPhotoIndex(prev => {
      if (prev.has(sku)) return prev;
      const next = new Map(prev); next.set(sku, 0); return next;
    });
  };
  const closeRow = (sku: string) => setExpandedRows(prev => {
    const next = new Set(prev); next.delete(sku); return next;
  });
  const closeAll = () => { setExpandedRows(new Set()); setCurrentPhotoIndex(new Map()); };
  const selectPhoto = (sku: string, idx: number) => setCurrentPhotoIndex(prev => new Map(prev).set(sku, idx));

  const { warehouses } = useWarehouses();

  // Phase 2: approval-gated cell editing
  const [adjustmentTarget, setAdjustmentTarget] = useState<{ item: StockItem; warehouseId: string } | null>(null);
  const [priceTarget, setPriceTarget] = useState<{ item: StockItem; field: 'price' | 'harga_modal' } | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [pendingRefreshTick, setPendingRefreshTick] = useState(0);
  // Company name is loaded from company_settings so the CSV filename
  // matches Pengaturan instead of the hardcoded "Sinar_Elektrik" that
  // shipped originally (2026-06-12 e2e audit). Falls back to a generic
  // label if the row isn't reachable.
  const [companyName, setCompanyName] = useState<string>('Stok');
  const [tenantSettings, setTenantSettings] = useState<DbTenantSettings | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listPendingApprovals();
        if (!cancelled) setPendingApprovals(rows);
      } catch {
        // silent: pending badges are non-critical
      }
    })();
    return () => { cancelled = true; };
  }, [pendingRefreshTick]);

  // One-shot store-name fetch for the CSV filename. Done separately from
  // the pending-approvals effect so the latter's tick doesn't refetch.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    void (async () => {
      try {
        const row = await fetchStoreSettings();
        if (cancelled) return;
        if (row?.nama_toko && row.nama_toko.trim()) setCompanyName(row.nama_toko.trim());
      } catch {
        // silent: hardcoded fallback used
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    tenantSettingsService.fetch().then(setTenantSettings).catch(err => captureError(err, { feature: 'stock_manager', action: 'fetch_tenant_settings' }));
  }, []);

  const showGrosir = tenantSettings ? isFieldVisible('price_grosir_column', tenantSettings) : false;

  const refreshPending = () => setPendingRefreshTick((n) => n + 1);

  const myPendingCount = useMemo(() => {
    if (!currentUser) return 0;
    return pendingApprovals.filter((r) => r.requestedBy === currentUser.id).length;
  }, [pendingApprovals, currentUser]);

  /**
   * Index pending approvals so cell renderers can ask in O(1) whether a
   * specific (sku, warehouse) or (sku, field) tuple has a pending request.
   */
  const pendingIndex = useMemo(() => {
    const adjMap = new Map<string, number>(); // key: `${sku}|${warehouse}`
    const priceMap = new Map<string, number>(); // key: `${sku}|${field}`
    for (const r of pendingApprovals) {
      const payload = r.payload ?? {};
      const sku = typeof payload.sku === 'string' ? payload.sku : null;
      if (!sku) continue;
      if (r.requestType === 'adjustment') {
        const wh = payload.warehouse;
        if (wh === 'atas' || wh === 'bawah') {
          const k = `${sku}|${wh}`;
          adjMap.set(k, (adjMap.get(k) ?? 0) + 1);
        }
      } else if (r.requestType === 'price_change') {
        const f = payload.field;
        if (f === 'price' || f === 'harga_modal') {
          const k = `${sku}|${f}`;
          priceMap.set(k, (priceMap.get(k) ?? 0) + 1);
        }
      }
    }
    return { adjMap, priceMap };
  }, [pendingApprovals]);

  const handleInlineSave = async (updatedItem: StockItem) => {
    // Was hard-coding threshold to 10; use the per-SKU value (fallback 5)
    // so the inline status flag matches the thinCount tab counter.
    const thin = updatedItem.min_stock_per_product ?? 5;
    const next: StockItem = {
      ...updatedItem,
      status: updatedItem.stock < thin ? 'Stok Tipis' : 'Sinkron',
    };
    const updated = stockList.map(i => (i.sku === next.sku ? next : i));
    onStockUpdate(updated);
  };

  const handleDeleteItem = (sku: string) => {
    const item = stockList.find(i => i.sku === sku);
    if (!item) return;
    // Was firing on click with no confirmation. Deleting a SKU affects
    // stock_movements + kasir history; require an explicit confirm.
    if (!window.confirm(`Hapus produk "${item.name}" (SKU: ${sku})?\nAksi ini tidak bisa di-undo.`)) return;
    onStockUpdate(stockList.filter(i => i.sku !== sku));
    showToast('🗑️ Produk berhasil dihapus.');
  };

  const thinThreshold = 5;
  const thinCount = useMemo(
    () => stockList.filter(s => s.stock <= (s.min_stock_per_product ?? thinThreshold)).length,
    [stockList],
  );

  return (
    <div className="space-y-8 animate-fadeIn pb-24">

      {/* Phase 2 banner: my pending requests */}
      {myPendingCount > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-900 flex items-center gap-3">
          <PendingApprovalBadge count={myPendingCount} size="md" tooltip="Permintaan Anda yang menunggu Owner" />
          <span className="font-semibold">
            Permintaan Anda yang menunggu: {myPendingCount} sedang menunggu persetujuan Owner.
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white/70 backdrop-blur-md p-6 rounded-[2.5rem] border border-[var(--color-caleo-mist)] shadow-lg">
        <div>
          <span className="text-[10px] font-black tracking-widest text-[#2d8a4e] uppercase bg-emerald-50 border border-emerald-100 px-3.5 py-1 rounded-full">
            Infrastruktur Backend
          </span>
          <h2 className="text-xl font-black text-[var(--color-caleo-primary)] tracking-tight mt-2.5">
            Manajemen Inventaris Stok &amp; Harga
          </h2>
          <p className="text-xs text-slate-500 font-semibold mt-1">
            Ubah harga atau modifikasi volume stok produk kelistrikan secara instan.
          </p>
        </div>
        {isSupabaseConfigured ? (
          <div className="bg-emerald-50/80 border border-emerald-200/60 px-4 py-3 rounded flex items-center gap-3">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
            </span>
            <div>
              <span className="text-[9px] font-black text-emerald-600 block uppercase tracking-wider">STATUS KONEKSI</span>
              <span className="text-xs font-black text-emerald-950">Terhubung ke Supabase Cloud DB</span>
            </div>
          </div>
        ) : (
          <div className="bg-amber-50/80 border border-amber-200/60 px-4 py-3 rounded flex items-center gap-3">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
            </span>
            <div>
              <span className="text-[9px] font-black text-amber-600 block uppercase tracking-wider">DATABASE SINKRONISASI</span>
              <span className="text-xs font-bold text-amber-950">Mode Demo (Penyimpanan Lokal Aktif)</span>
            </div>
          </div>
        )}
      </div>

      {/* Tab pills */}
      <div className="bg-white rounded border border-[var(--color-caleo-mist)] p-4 shadow-sm">
        {activeTab === 'katalog' && (
          <div className="flex flex-col lg:flex-row gap-3 mb-3">
            <input
              value={katalogSearch}
              onChange={e => setKatalogSearch(e.target.value)}
              placeholder="Cari nama atau SKU…"
              className="flex-1 px-4 py-2 bg-[var(--color-caleo-cloud)] rounded-full text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-300"
            />
            <select
              value={katalogCategory}
              onChange={e => setKatalogCategory(e.target.value)}
              className="px-4 py-2 bg-[var(--color-caleo-cloud)] rounded-full text-xs font-black"
            >
              {katalogCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <ViewModeSwitcher value={viewMode} onChange={(next) => { setViewMode(next); closeAll(); }} />
            {viewMode === 'list' && expandedRows.size > 0 && (
              <button
                type="button"
                onClick={closeAll}
                className="px-3 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-full text-xs font-bold inline-flex items-center gap-1.5"
                aria-label={`Tutup ${expandedRows.size} panel terbuka`}
              >
                <span className="material-symbols-outlined text-base">unfold_less</span>
                Tutup {expandedRows.size} panel
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAddProductModal(true)}
              className="px-4 py-2 bg-[#2d8a4e] text-white rounded-full text-xs font-extrabold uppercase tracking-wider hover:bg-emerald-700"
            >
              + Tambah Barang
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {([
            { id: 'katalog', label: '📋 Katalog', count: stockList.length, color: 'emerald' },
            { id: 'stok', label: '🏬 Stok per Gudang', count: null, color: 'slate' },
            { id: 'bulk', label: '📥 Bulk Upload', count: null, color: 'slate' },
            { id: 'tipis', label: '⚠️ Stok Tipis', count: thinCount, color: 'amber' },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 rounded-full text-xs font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5 ${
                activeTab === t.id
                  ? (t.color === 'amber' ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-[#2d8a4e] text-white shadow-md')
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {t.label}
              {t.count !== null && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                  activeTab === t.id && t.color !== 'amber' ? 'bg-white/20' : 'bg-amber-600 text-white'
                }`}>{t.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'katalog' && (viewMode === 'foto' ? (
        <CatalogGridView
          stockList={filteredKatalog}
          onAdd={() => setShowAddProductModal(true)}
          onEdit={setEditingSku}
          hideToolbar
        />
      ) : (
        <CatalogListView
          items={filteredKatalog}
          warehouses={warehouses}
          minStockThreshold={10}
          expandedRows={expandedRows}
          currentPhotoIndex={currentPhotoIndex}
          onToggleRow={toggleRow}
          onPhotoSelect={selectPhoto}
          onCloseRow={closeRow}
          onEdit={setEditingSku}
          onAddPhoto={setEditingSku}
          onHistory={(sku) => showToast(`Riwayat stok ${sku} — TODO`, 'info')}
          showToast={showToast}
          onPromoUpdated={(sku, promo) => {
            onStockUpdate(
              stockList.map((s) =>
                s.sku === sku
                  ? { ...s, promo_discount_type: promo.promo_discount_type ?? undefined, promo_discount_value: promo.promo_discount_value ?? undefined, promo_expires_at: promo.promo_expires_at ?? undefined }
                  : s,
              ),
            );
          }}
        />
      ))}

      {activeTab === 'stok' && (
        <StockTableView
          stockList={stockList}
          warehouses={warehouses}
          currentUser={currentUser}
          pendingIndex={pendingIndex}
          onDelete={handleDeleteItem}
          onTransfer={(_item) => { /* Task 23: wired to WarehouseTransferCreateScreen */ }}
          onInlineUpdate={handleInlineSave}
          onRequestPriceChange={(item, field) => setPriceTarget({ item, field })}
          onRequestAdjustment={(item, warehouseId) => setAdjustmentTarget({ item, warehouseId })}
          onOpname={onNavigateToOpname}
          showToast={showToast}
          showGrosir={showGrosir}
          onDataChanged={() => { void onStocksRefresh?.(); }}
        />
      )}

      {activeTab === 'bulk' && (
        <>
          <BulkUploadSection
            stockList={stockList}
            companyName={companyName}
            showToast={showToast}
            onStockUpdate={onStockUpdate}
            onUploaded={refreshPending}
          />
          {showGrosir && (
            <BulkUpdateTierPricesSection
              stockList={stockList}
              tenantSettings={tenantSettings}
              showToast={showToast}
              onApplied={() => { void onStocksRefresh?.(); }}
            />
          )}
        </>
      )}

      {activeTab === 'tipis' && (
        <StockTableView
          stockList={stockList}
          warehouses={warehouses}
          currentUser={currentUser}
          pendingIndex={pendingIndex}
          onDelete={handleDeleteItem}
          onTransfer={(_item) => { /* Task 23: wired to WarehouseTransferCreateScreen */ }}
          onInlineUpdate={handleInlineSave}
          onRequestPriceChange={(item, field) => setPriceTarget({ item, field })}
          onRequestAdjustment={(item, warehouseId) => setAdjustmentTarget({ item, warehouseId })}
          onOpname={onNavigateToOpname}
          showToast={showToast}
          thinOnly={true}
          showGrosir={showGrosir}
          onDataChanged={() => { void onStocksRefresh?.(); }}
        />
      )}

      {/* "Simpan Semua Perubahan" floating button removed — was misleading.
          Every individual edit (add / inline save / delete) already routes
          through onStockUpdate → App.handleStockUpdate → Supabase upsert; the
          button re-fired the same list, computed an empty diff, persisted
          nothing, but toasted "Berhasil Menyimpan". Users trusted a lie.
          Refresh-from-cloud is available inline per row action. */}

      {adjustmentTarget && (
        <StockAdjustmentModal
          item={adjustmentTarget.item}
          warehouseId={adjustmentTarget.warehouseId}
          currentUser={currentUser ?? null}
          onClose={() => setAdjustmentTarget(null)}
          onSubmitted={refreshPending}
          showToast={showToast}
        />
      )}

      {priceTarget && (
        <PriceChangeRequestModal
          item={priceTarget.item}
          field={priceTarget.field}
          currentUser={currentUser ?? null}
          onClose={() => setPriceTarget(null)}
          onSubmitted={refreshPending}
          showToast={showToast}
        />
      )}

      {showAddProductModal && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setShowAddProductModal(false)}
        >
          <div
            className="bg-white rounded-[2rem] shadow-2xl max-w-7xl w-full max-h-[90vh] overflow-y-auto p-6"
            onClick={e => e.stopPropagation()}
          >
            <ProductForm
              warehouses={warehouses}
              currentUserId={currentUser?.id ?? ''}
              onCancel={() => setShowAddProductModal(false)}
              onSubmit={async data => {
                await stockService.upsertProduct(data as Parameters<typeof stockService.upsertProduct>[0]);
                await onStocksRefresh?.();
                setShowAddProductModal(false);
              }}
              showToast={showToast}
              showGrosir={showGrosir}
              tenantSettings={tenantSettings}
            />
          </div>
        </div>
      )}

      {editingSku && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setEditingSku(null)}
        >
          <div
            className="bg-white rounded-[2rem] shadow-2xl max-w-7xl w-full max-h-[90vh] overflow-y-auto p-6"
            onClick={e => e.stopPropagation()}
          >
            <ProductForm
              initial={stockList.find(s => s.sku === editingSku)}
              warehouses={warehouses}
              currentUserId={currentUser?.id ?? ''}
              onCancel={() => setEditingSku(null)}
              onSubmit={async data => {
                await stockService.upsertProduct(data as Parameters<typeof stockService.upsertProduct>[0]);
                await onStocksRefresh?.();
                setEditingSku(null);
              }}
              showToast={showToast}
              showGrosir={showGrosir}
              tenantSettings={tenantSettings}
            />
          </div>
        </div>
      )}
    </div>
  );
}
