// src/components/admin/SalesRepsList.tsx
// /admin/sales-reps — list of platform_admins with role = 'sales_rep'.
// Orchestrator pattern: useEffect + async fetch + skeleton, following TenantsList.tsx.
import { useEffect, useState } from 'react';
import { salesRepsApi } from '../../lib/salesRepsApi';
import type { SalesRep } from '../../lib/salesRepsApi';
import { adminToast } from '../../lib/adminToast';
import { SalesRepCreateModal } from './SalesRepCreateModal';
import { SalesRepDeactivateModal } from './SalesRepDeactivateModal';
import { extractErrorMessage } from '../../lib/extractErrorMessage';

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <div className="border rounded-xl overflow-hidden" style={{ borderColor: '#ECEEF1' }}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-10 animate-pulse"
          style={{ background: i % 2 === 0 ? '#ECEEF1' : '#f8f9fa', borderBottom: '1px solid #ECEEF1' }}
        />
      ))}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SalesRep['status'] }) {
  if (status === 'active') {
    return (
      <span
        className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800"
      >
        Aktif
      </span>
    );
  }
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ background: '#F1F5F9', color: '#64748B' }}
    >
      Nonaktif
    </span>
  );
}

// ─── SalesRepsList ────────────────────────────────────────────────────────────

export function SalesRepsList() {
  const [rows, setRows] = useState<SalesRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Refresh key — bumped after create/deactivate to re-fetch list.
  const [refreshKey, setRefreshKey] = useState(0);

  // Modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<SalesRep | null>(null);

  // ─── Fetch ──────────────────────────────────────────────────────────────────

  async function fetchSalesReps() {
    setLoading(true);
    setError(null);
    try {
      const data = await salesRepsApi.list();
      setRows(data);
    } catch (err) {
      const msg = extractErrorMessage(err);
      setError(msg);
      adminToast.error('Gagal memuat daftar sales rep', msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSalesReps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 font-vosi">
      {/* Page header */}
      <div className="flex justify-between items-center">
        <div>
          <h1
            className="text-[16px] font-bold"
            style={{ color: '#0B2545' }}
          >
            Sales Reps
          </h1>
          <p className="text-[13px] mt-0.5" style={{ color: '#9DB2CE' }}>
            {loading ? 'Memuat…' : `${rows.length} sales rep`}
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="font-semibold rounded-xl px-4 py-2 text-[13px] hover:opacity-90 transition-opacity"
          style={{ background: '#0B2545', color: '#ffffff' }}
          data-testid="tambah-salesrep-btn"
        >
          Tambah Sales Rep
        </button>
      </div>

      {/* Error inline retry */}
      {error && !loading && (
        <div
          className="border rounded-xl px-4 py-3 text-[13px] flex items-center justify-between"
          style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b' }}
          data-testid="salesreps-error"
        >
          <span>Gagal memuat sales rep: {error}</span>
          <button
            onClick={() => fetchSalesReps()}
            className="ml-4 px-3 py-1 rounded-lg border font-medium text-[12px] hover:opacity-80"
            style={{ borderColor: '#991b1b', color: '#991b1b' }}
          >
            Coba lagi
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <div
          className="border rounded-xl px-4 py-8 text-center text-[13px]"
          style={{ borderColor: '#ECEEF1', color: '#9DB2CE' }}
          data-testid="salesreps-empty"
        >
          Belum ada sales rep. Klik "Tambah Sales Rep" untuk menambahkan.
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden" style={{ borderColor: '#ECEEF1' }}>
          <table className="w-full border-collapse text-[13px]" aria-label="Daftar sales rep">
            <thead>
              <tr style={{ background: '#F8F9FA', borderBottom: '1px solid #ECEEF1' }}>
                <th
                  className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest"
                  style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace' }}
                >
                  Nama
                </th>
                <th
                  className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest"
                  style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace' }}
                >
                  Email
                </th>
                <th
                  className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest"
                  style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace' }}
                >
                  Status
                </th>
                <th
                  className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest"
                  style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace' }}
                >
                  Ditambahkan
                </th>
                <th className="px-4 py-2.5" aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {rows.map((rep, idx) => (
                <tr
                  key={rep.user_id}
                  style={{
                    background: idx % 2 === 0 ? '#ffffff' : '#FAFBFC',
                    borderBottom: '1px solid #ECEEF1',
                  }}
                  data-testid={`salesrep-row-${rep.user_id}`}
                >
                  <td className="px-4 py-2.5 font-medium" style={{ color: '#0B2545' }}>
                    {rep.name}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: '#5A6472' }}>
                    {rep.email}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={rep.status} />
                  </td>
                  <td className="px-4 py-2.5 text-[12px]" style={{ color: '#9DB2CE' }}>
                    {new Date(rep.created_at).toLocaleDateString('id-ID', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {rep.status === 'active' && (
                      <button
                        onClick={() => setDeactivateTarget(rep)}
                        className="border rounded-lg px-3 py-1 text-[12px] font-medium hover:bg-red-50 transition-colors"
                        style={{ borderColor: '#FCA5A5', color: '#DC2626' }}
                        data-testid={`nonaktifkan-btn-${rep.user_id}`}
                      >
                        Nonaktifkan
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      <SalesRepCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => setRefreshKey((k) => k + 1)}
      />
      <SalesRepDeactivateModal
        open={deactivateTarget !== null}
        salesRep={deactivateTarget}
        onClose={() => setDeactivateTarget(null)}
        onSuccess={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
