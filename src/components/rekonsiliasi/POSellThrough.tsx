// src/components/rekonsiliasi/POSellThrough.tsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { wibDateString } from '../../lib/format';

interface POSummary {
  id: string;
  po_number: string;
  supplier_name: string;
  received_at: string;
  payment_due_at: string;
  total: number;
  status: string;
  items: {
    sku: string;
    name: string;
    qty_received: number;
    qty_sold: number;
    consumed_by: { order_id: string; qty: number; date: string }[];
  }[];
}

function fmt(n: number) { return 'Rp ' + (n / 1_000_000).toFixed(1).replace('.', ',') + 'jt'; }
function fmtDate(s: string) { return new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }); }

export default function POSellThrough({ year, month }: { year: number; month: number }) {
  const [pos, setPos] = useState<POSummary[]>([]);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      if (!supabase) return;
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const end = wibDateString(new Date(year, month, 1));
      const { data: poRows } = await supabase
        .from('purchase_orders')
        .select(`id, po_number, total, status, received_at, payment_due_at, supplier:suppliers(name),
                 purchase_order_items(sku, name:product_name, qty:qty_received)`)
        .gte('received_at', start).lt('received_at', end);
      const { data: consumption } = await supabase
        .from('stock_lot_consumption')
        .select('order_id, sku, qty_consumed, consumed_at, lot:stock_lots(po_id)');
      const consBy = new Map<string, { order_id: string; sku: string; qty: number; date: string }[]>();
      for (const c of (consumption ?? [])) {
        const poId = (c as unknown as { lot?: { po_id?: string } }).lot?.po_id;
        if (!poId) continue;
        const arr = consBy.get(poId) ?? [];
        arr.push({ order_id: c.order_id, sku: c.sku, qty: c.qty_consumed, date: c.consumed_at });
        consBy.set(poId, arr);
      }
      setPos((poRows ?? []).map((p: Record<string, unknown>) => {
        const supplier = (p.supplier as { name?: string } | undefined)?.name ?? '?';
        const items = (p.purchase_order_items as Array<{ sku: string; name: string; qty: number }> | undefined) ?? [];
        return {
          id: p.id as string,
          po_number: p.po_number as string,
          supplier_name: supplier,
          received_at: p.received_at as string,
          payment_due_at: p.payment_due_at as string,
          total: p.total as number,
          status: p.status as string,
          items: items.map(it => {
            const consumed = (consBy.get(p.id as string) ?? []).filter(c => c.sku === it.sku);
            const qtySold = consumed.reduce((a, c) => a + c.qty, 0);
            return {
              sku: it.sku,
              name: it.name,
              qty_received: it.qty,
              qty_sold: qtySold,
              consumed_by: consumed.map(c => ({ order_id: c.order_id, qty: c.qty, date: c.date })),
            };
          }),
        };
      }));
    })();
  }, [year, month]);

  return (
    <div className="bg-white/78 backdrop-blur-xl rounded-[1.75rem] border border-[#e5eeff] shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-[#e5eeff]">
        <div className="text-[11px] font-black uppercase tracking-widest text-[#012749]">📦 Pembelian dari Supplier Bulan Ini</div>
        <div className="text-[10px] text-slate-500 font-semibold mt-0.5">Klik ▶ untuk lihat per-barang & sales order yang membeli</div>
      </div>
      <div className="p-4 space-y-3">
        {pos.map(po => {
          const totalSold = po.items.reduce((a, it) => a + it.qty_sold, 0);
          const totalRecv = po.items.reduce((a, it) => a + it.qty_received, 0);
          const pct = totalRecv === 0 ? 0 : Math.round(totalSold / totalRecv * 100);
          const isOpen = openIds.has(po.id);
          const toggle = () => setOpenIds(o => {
            const n = new Set(o); if (n.has(po.id)) n.delete(po.id); else n.add(po.id); return n;
          });
          const borderColor = po.status === 'PAID' ? '#e2e8f0' : pct >= 60 ? '#a7f3d0' : '#fecaca';
          const bgColor = po.status === 'PAID' ? 'rgba(248,250,252,0.4)' : pct >= 60 ? 'rgba(236,253,245,0.4)' : 'rgba(254,242,242,0.4)';
          const barColor = pct >= 60 ? '#10b981' : '#ef4444';
          const labelColor = pct >= 60 ? 'text-emerald-700' : 'text-red-700';
          return (
            <div key={po.id} className="rounded-2xl border overflow-hidden" style={{ background: bgColor, borderColor }}>
              <div onClick={toggle} className="p-4 flex justify-between items-start cursor-pointer">
                <div>
                  <div className="text-xs font-bold text-[#012749]">{isOpen ? '▼' : '▶'} {po.po_number} · {po.supplier_name}</div>
                  <div className="text-[10px] text-slate-500 font-semibold mt-0.5">Terima {fmtDate(po.received_at)} · Tempo {po.payment_due_at ? fmtDate(po.payment_due_at) : '—'}</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right"><div className="text-[10px] font-bold text-slate-500">Bayar</div><div className="text-sm font-black text-[#012749]">{fmt(po.total)}</div></div>
                  <div style={{ width: 140 }} className="text-right">
                    <div className={`text-[10px] font-bold ${labelColor}`}>Laku {pct}%</div>
                    <div className="h-1.5 mt-1 bg-slate-200 rounded-full overflow-hidden"><div className="h-full" style={{ width: pct + '%', background: barColor }} /></div>
                  </div>
                </div>
              </div>
              {isOpen && (
                <div className="border-t border-[#e5eeff] bg-white/60 p-4 space-y-3">
                  {po.items.map(it => (
                    <div key={it.sku}>
                      <div className="flex justify-between items-center mb-2">
                        <div><span className="text-xs font-bold text-[#012749]">{it.name}</span><span className="text-[10px] text-slate-500 font-semibold ml-2">({it.sku})</span></div>
                        <div className="text-[11px] font-bold"><span className="text-emerald-700">{it.qty_sold} laku</span> / <span className="text-[#012749]">{it.qty_received}</span></div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {it.consumed_by.map((c, idx) => (
                          <span key={idx} className="text-[9px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full font-mono">#{c.order_id.slice(0, 6)} · {c.qty} · {fmtDate(c.date)}</span>
                        ))}
                        {it.consumed_by.length === 0 && <span className="text-[10px] text-slate-400 font-semibold">— belum ada penjualan —</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {pos.length === 0 && <div className="text-center text-xs text-slate-400 font-semibold py-4">Tidak ada PO diterima bulan ini.</div>}
      </div>
    </div>
  );
}
