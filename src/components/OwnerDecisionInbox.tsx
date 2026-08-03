/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// OwnerDecisionInbox — owner reviews damaged claims awaiting decision.
// Per rev 3: admin flags rusak at opname, owner picks Dispose or Klaim per claim.
// - Dispose: reclass Piutang Klaim → Beban Barang Rusak (loss recognized)
// - Klaim: pick supplier, status → PENDING (awaiting supplier response)

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle, Package, Building2, RefreshCcw } from 'lucide-react';
import { listSupplierClaims, decideSupplierClaim } from '../lib/supplierClaims/api';
import type { SupplierClaimRow } from '../lib/supplierClaims/types';
import { supabase } from '../lib/supabaseClient';
import { useWarehouses } from '../hooks/useWarehouses';
import { extractErrorMessage } from '../lib/extractErrorMessage';
import { formatIDR } from '../lib/formatIDR';
import EmptyState from './ui/EmptyState';
import LoadingState from './ui/LoadingState';

interface OwnerDecisionInboxProps {
  showToast: (msg: string, tone?: 'success' | 'info' | 'warning') => void;
}

interface Supplier {
  id: string;
  name: string;
}

type AgingRow = {
  tenant_id: string;
  id: number;
  doc_no: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  sender_user_id: string;
  receiver_user_id: string;
  total_qty_sent: number;
  initiated_at: string;
  hours_pending: number;
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const SOURCE_LABEL: Record<SupplierClaimRow['sourceType'], string> = {
  STOCK_OPNAME: 'Opname',
  PO_RECEIPT: 'Penerimaan PO',
  STOCK_ADJUSTMENT: 'Adjustment',
};

export default function OwnerDecisionInbox({ showToast }: OwnerDecisionInboxProps) {
  const [claims, setClaims] = useState<SupplierClaimRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [agingRows, setAgingRows] = useState<AgingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { warehouses } = useWarehouses();
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [choosingKlaimFor, setChoosingKlaimFor] = useState<string | null>(null);
  const [chosenSupplierId, setChosenSupplierId] = useState<string>('');
  const [decisionNotes, setDecisionNotes] = useState<string>('');

  const refresh = async () => {
    try {
      const rows = await listSupplierClaims({ status: ['AWAITING_OWNER_DECISION'] });
      setClaims(rows);
    } catch (e) {
      showToast(extractErrorMessage(e), 'warning');
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await refresh();
        if (supabase) {
          const { data, error } = await supabase.from('suppliers').select('id, name').order('name');
          if (!error) setSuppliers((data ?? []) as Supplier[]);
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from('v_pengawasan_transfer_aging')
      .select('*')
      .then(({ data }) => setAgingRows((data ?? []) as AgingRow[]));
  }, []);

  const whName = (id: string): string =>
    warehouses.find((w) => w.id === id)?.name ?? id;

  const totalPendingValue = useMemo(
    () => claims.reduce((sum, c) => sum + c.bookValue, 0),
    [claims],
  );

  const decideDispose = async (claim: SupplierClaimRow) => {
    if (!window.confirm(
      `Terima kerugian ${claim.qty} unit ${claim.sku} (${formatIDR(claim.bookValue)}) sebagai Beban Barang Rusak?`,
    )) return;
    setDecidingId(claim.id);
    try {
      await decideSupplierClaim({
        claimId: claim.id,
        decision: 'DISPOSE',
        notes: decisionNotes || undefined,
      });
      showToast(`Kerugian dicatat (${formatIDR(claim.bookValue)})`, 'success');
      setDecisionNotes('');
      await refresh();
    } catch (e) {
      showToast(extractErrorMessage(e), 'warning');
    } finally {
      setDecidingId(null);
    }
  };

  const openKlaimPicker = (claim: SupplierClaimRow) => {
    setChoosingKlaimFor(claim.id);
    setChosenSupplierId('');
  };

  const submitKlaim = async (claim: SupplierClaimRow) => {
    if (!chosenSupplierId) {
      showToast('Pilih supplier untuk klaim', 'warning');
      return;
    }
    setDecidingId(claim.id);
    try {
      await decideSupplierClaim({
        claimId: claim.id,
        decision: 'KLAIM',
        supplierId: chosenSupplierId,
        notes: decisionNotes || undefined,
      });
      const supName = suppliers.find((s) => s.id === chosenSupplierId)?.name ?? 'supplier';
      showToast(`Klaim ke ${supName} dibuat — status PENDING`, 'success');
      setChoosingKlaimFor(null);
      setChosenSupplierId('');
      setDecisionNotes('');
      await refresh();
    } catch (e) {
      showToast(extractErrorMessage(e), 'warning');
    } finally {
      setDecidingId(null);
    }
  };

  if (loading) {
    return <LoadingState label="Memuat…" className="p-6" />;
  }

  return (
    <div className="max-w-4xl px-4 py-4" style={{ fontSize: '14px' }}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-800">
            <AlertTriangle className="h-6 w-6 text-orange-500" />
            Keputusan Owner
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Barang rusak yang ditandai admin di opname. Owner memilih: terima kerugian atau klaim ke supplier.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="flex items-center gap-1 rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          <RefreshCcw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {/* Summary strip */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Menunggu</div>
          <div className="mt-1 text-xl font-semibold text-slate-800">{claims.length}</div>
        </div>
        <div className="rounded border border-slate-200 bg-white px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Total nilai</div>
          <div className="mt-1 text-xl font-semibold text-orange-700">{formatIDR(totalPendingValue)}</div>
        </div>
      </div>

      {claims.length === 0 ? (
        <EmptyState
          message="Tidak ada barang rusak yang menunggu keputusan."
          icon={CheckCircle2}
          className="rounded border border-dashed border-slate-300 bg-white"
        />
      ) : (
        <div className="space-y-3">
          {claims.map((claim) => {
            const isDeciding = decidingId === claim.id;
            const isPickingKlaim = choosingKlaimFor === claim.id;
            return (
              <div
                key={claim.id}
                className="rounded border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Package className="h-4 w-4" />
                      <span className="uppercase tracking-wide">{SOURCE_LABEL[claim.sourceType]}</span>
                      <span className="text-slate-300">·</span>
                      <span>{formatDate(claim.createdAt)}</span>
                    </div>
                    <div className="mt-1 text-lg font-semibold text-slate-800">
                      {claim.sku} · {claim.qty} unit
                    </div>
                    <div className="text-sm text-slate-600">
                      Gudang {claim.warehouse.toUpperCase()} · @ {formatIDR(claim.unitCost)} ={' '}
                      <span className="font-medium text-orange-700">{formatIDR(claim.bookValue)}</span>
                    </div>
                    {claim.damageNotes && (
                      <div className="mt-2 rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        Kondisi: {claim.damageNotes}
                      </div>
                    )}
                    {(claim.evidenceUrls?.length ?? 0) > 0 && (
                      <div className="mt-2 text-xs text-slate-500">
                        📷 {claim.evidenceUrls?.length} foto bukti
                      </div>
                    )}
                  </div>
                </div>

                {isPickingKlaim ? (
                  <div className="mt-4 space-y-2 rounded border border-blue-200 bg-blue-50 px-3 py-3">
                    <div className="text-sm font-medium text-blue-800">
                      Klaim ke supplier mana?
                    </div>
                    <select
                      value={chosenSupplierId}
                      onChange={(e) => setChosenSupplierId(e.target.value)}
                      className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">-- pilih supplier --</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <textarea
                      value={decisionNotes}
                      onChange={(e) => setDecisionNotes(e.target.value)}
                      placeholder="Catatan untuk owner records (opsional)"
                      className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                      rows={2}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => { setChoosingKlaimFor(null); setChosenSupplierId(''); }}
                        className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                      >
                        Batal
                      </button>
                      <button
                        type="button"
                        disabled={!chosenSupplierId || isDeciding}
                        onClick={() => submitKlaim(claim)}
                        className="flex items-center gap-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        <Building2 className="h-4 w-4" />
                        {isDeciding ? 'Menyimpan...' : 'Kirim klaim'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      onClick={() => decideDispose(claim)}
                      disabled={isDeciding}
                      className="flex items-center gap-1 rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4 text-caleo-danger" />
                      Terima Kerugian
                    </button>
                    <button
                      type="button"
                      onClick={() => openKlaimPicker(claim)}
                      disabled={isDeciding}
                      className="flex items-center gap-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      <Building2 className="h-4 w-4" />
                      Klaim ke Supplier
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Aging alerts: warehouse transfers pending > 24 hours ── */}
      <section className="mt-6">
        <h2 className="text-lg font-semibold text-slate-800">Transfer tertunda &gt; 24 jam</h2>
        {agingRows.length === 0 && (
          <EmptyState message="Tidak ada transfer yang tertunda." inline className="mt-2" />
        )}
        {agingRows.map((a) => (
          <div key={a.id} className="mt-2 rounded border border-amber-200 bg-amber-50 p-3">
            <div className="font-mono text-xs text-amber-800">{a.doc_no}</div>
            <div className="mt-1 text-sm font-semibold text-slate-800">
              {whName(a.from_warehouse_id)} → {whName(a.to_warehouse_id)} · {a.total_qty_sent} pcs
            </div>
            <div className="text-xs text-slate-500">
              {Math.round(a.hours_pending)} jam mengambang · dikirim{' '}
              {new Date(a.initiated_at).toLocaleString('id-ID')}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
