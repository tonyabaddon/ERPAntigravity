import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { warehouseTransferService, WarehouseTransferHeader, WarehouseTransferStatus } from '../../lib/warehouseTransferService';
import { useWarehouses } from '../../hooks/useWarehouses';

type TabKey = 'ALL' | 'IN_TRANSIT' | 'WAITING_ME' | 'DONE' | 'CANCELLED';

export default function WarehouseTransferListScreen({
  currentUserId, onOpenDetail, onOpenCreate,
}: {
  currentUserId: string;
  onOpenDetail: (id: number) => void;
  onOpenCreate: () => void;
}) {
  const [tab, setTab] = useState<TabKey>('ALL');
  const [rows, setRows] = useState<WarehouseTransferHeader[]>([]);
  const [loading, setLoading] = useState(true);
  const { warehouses } = useWarehouses();

  useEffect(() => {
    setLoading(true);
    const filter =
      tab === 'IN_TRANSIT' ? { statusFilter: ['IN_TRANSIT' as WarehouseTransferStatus] } :
      tab === 'DONE'       ? { statusFilter: ['RECEIVED','PARTIAL'] as WarehouseTransferStatus[] } :
      tab === 'CANCELLED'  ? { statusFilter: ['CANCELLED' as WarehouseTransferStatus] } :
      {};
    warehouseTransferService.listTransfers(filter)
      .then(setRows).finally(() => setLoading(false));
  }, [tab]);

  const visibleRows = tab === 'WAITING_ME'
    ? rows.filter(r => r.status === 'IN_TRANSIT' && r.receiver_user_id === currentUserId)
    : rows;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Transfer Barang Antar Gudang</h1>
          <p className="mt-1 text-sm text-slate-500">Kirim barang antar gudang & konfirmasi terima</p>
        </div>
        <button onClick={onOpenCreate}
          className="flex items-center gap-1 rounded border border-emerald-600 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
          <Plus className="h-4 w-4" />Buat Transfer Baru
        </button>
      </div>

      {/* KPI cards — 4 columns, spec §UI/UX Section 1 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="In-Transit"          value={rows.filter(r => r.status === 'IN_TRANSIT').length} />
        <KpiCard label="Menunggu Konfirmasi Anda" value={rows.filter(r => r.status === 'IN_TRANSIT' && r.receiver_user_id === currentUserId).length} />
        <KpiCard label="Diterima Hari Ini"   value={rows.filter(r => r.status === 'RECEIVED' && isToday(r.received_at)).length} />
        <KpiCard label="Selisih 30 Hari"     value={rows.filter(r => r.status === 'PARTIAL' && withinDays(r.received_at, 30)).reduce((a,b)=>a+(b.total_loss_qty ?? 0),0)} suffix="pcs" />
      </div>

      {/* Tab pills */}
      <div className="flex gap-2 flex-wrap">
        {(['ALL','IN_TRANSIT','WAITING_ME','DONE','CANCELLED'] as TabKey[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${tab === t
              ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
            {tabLabel(t)}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm text-slate-500">Memuat…</div>}
      {!loading && visibleRows.length === 0 && (
        <div className="rounded border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
          {tab === 'WAITING_ME' ? 'Tidak ada transfer yang menunggu konfirmasi Anda.' : 'Belum ada transfer.'}
        </div>
      )}
      {!loading && visibleRows.map(r => (
        <TransferRow key={r.id} row={r} warehouses={warehouses} onClick={() => onOpenDetail(r.id)} />
      ))}
    </div>
  );
}

function KpiCard({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-800">{value}{suffix ? ` ${suffix}` : ''}</div>
    </div>
  );
}

function tabLabel(t: TabKey) {
  return { ALL: 'Semua', IN_TRANSIT: 'In-Transit', WAITING_ME: 'Menunggu Saya', DONE: 'Selesai', CANCELLED: 'Batal' }[t];
}

function isToday(iso: string | null) { if (!iso) return false; const d=new Date(iso); const n=new Date(); return d.toDateString()===n.toDateString(); }
function withinDays(iso: string | null, days: number) { if (!iso) return false; return (Date.now() - new Date(iso).getTime()) < days*24*3600*1000; }

function TransferRow({ row, warehouses, onClick }: { row: WarehouseTransferHeader; warehouses: Array<{id:string;name:string}>; onClick: () => void }) {
  const from = warehouses.find(w => w.id === row.from_warehouse_id)?.name ?? '?';
  const to   = warehouses.find(w => w.id === row.to_warehouse_id)?.name   ?? '?';
  const badge = statusBadge(row.status);
  return (
    <button onClick={onClick} className="w-full text-left rounded border border-slate-200 bg-white p-4 shadow-sm hover:bg-slate-50">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-xs text-slate-500">{row.doc_no}</div>
          <div className="mt-1 text-sm font-semibold text-slate-800">{from} → {to}</div>
          <div className="text-xs text-slate-500">{row.n_items} SKU · {row.total_qty_sent} pcs · {new Date(row.initiated_at).toLocaleString('id-ID')}</div>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${badge.className}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${badge.dotClassName}`} />{badge.label}
        </span>
      </div>
    </button>
  );
}

function statusBadge(s: WarehouseTransferStatus) {
  switch (s) {
    case 'IN_TRANSIT': return { label: 'In-Transit', className: 'bg-amber-50 text-amber-800',   dotClassName: 'bg-amber-500' };
    case 'RECEIVED':   return { label: 'Diterima',   className: 'bg-emerald-50 text-emerald-800', dotClassName: 'bg-emerald-500' };
    case 'PARTIAL':    return { label: 'Selisih',    className: 'bg-orange-50 text-orange-800',  dotClassName: 'bg-orange-500' };
    case 'CANCELLED':  return { label: 'Dibatal',    className: 'bg-slate-100 text-slate-600',   dotClassName: 'bg-slate-400' };
  }
}
