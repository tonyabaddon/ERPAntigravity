import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { formatIDR } from '../../lib/formatIDR';
import { extractErrorMessage } from '../../lib/extractErrorMessage';
import LoadingState from '../ui/LoadingState';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';

interface LayananRow {
  service_catalog_id: string;
  service_name: string;
  category: string | null;
  order_count: number;
  total_revenue: number;
  total_hpp: number;
  margin_pct: number;
}

interface Props {
  days: number;
}

export default function LayananSection({ days }: Props) {
  const [rows, setRows] = useState<LayananRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - days);
      const sinceISO = sinceDate.toISOString();

      try {
        // Join rakit_job_lines → service_catalog → kasir_transactions
        const { data, error: qErr } = await supabase
          .from('rakit_job_lines')
          .select(
            `
            service_catalog_id,
            final_price,
            hpp_final,
            service_catalog:service_catalog!inner ( name, category ),
            transaction:kasir_transactions!inner ( created_at )
            `,
          )
          .not('service_catalog_id', 'is', null)
          .gte('transaction.created_at', sinceISO);
        if (qErr) throw qErr;
        if (cancelled) return;

        // Aggregate
        const agg = new Map<
          string,
          {
            name: string;
            category: string | null;
            order_count: number;
            revenue: number;
            hpp: number;
          }
        >();
        for (const row of data ?? []) {
          const r = row as unknown as {
            service_catalog_id: string;
            final_price: number | string | null;
            hpp_final: number | string | null;
            service_catalog:
              | { name: string; category: string | null }
              | Array<{ name: string; category: string | null }>
              | null;
          };
          const scId = r.service_catalog_id;
          const scRaw = r.service_catalog;
          const sc = Array.isArray(scRaw) ? scRaw[0] : scRaw;
          const revenue = Number(r.final_price ?? 0);
          const hpp = Number(r.hpp_final ?? 0);
          const existing = agg.get(scId);
          if (existing) {
            existing.order_count += 1;
            existing.revenue += revenue;
            existing.hpp += hpp;
          } else {
            agg.set(scId, {
              name: sc?.name ?? 'Unknown',
              category: sc?.category ?? null,
              order_count: 1,
              revenue,
              hpp,
            });
          }
        }

        const arr: LayananRow[] = Array.from(agg.entries())
          .map(([id, v]) => ({
            service_catalog_id: id,
            service_name: v.name,
            category: v.category,
            order_count: v.order_count,
            total_revenue: v.revenue,
            total_hpp: v.hpp,
            margin_pct:
              v.revenue > 0
                ? Math.round(((v.revenue - v.hpp) / v.revenue) * 100)
                : 0,
          }))
          .sort((a, b) => b.total_revenue - a.total_revenue);

        setRows(arr);
      } catch (err) {
        if (!cancelled) setError(extractErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <section className="bg-white rounded border border-slate-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-caleo-15 font-bold text-[var(--color-caleo-primary)]">🛠 Layanan</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Revenue, HPP, dan margin per layanan (Wiring Panel, Custom Panel,
            dst) dalam periode.
          </p>
        </div>
      </div>

      {loading ? (
        <LoadingState label="Memuat…" />
      ) : error ? (
        <ErrorState message={`Gagal memuat: ${error}`} inline />
      ) : rows.length === 0 ? (
        <EmptyState
          message="Belum ada layanan yang terjual dalam periode ini."
          hint="Setup service catalog di Pengaturan → Layanan lalu attach ke pesanan."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-caleo-13">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">
                  Layanan
                </th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">
                  Kategori
                </th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600">
                  Order
                </th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600">
                  Revenue
                </th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600">
                  HPP
                </th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600">
                  Margin
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.service_catalog_id}
                  className="border-t border-slate-100"
                >
                  <td className="px-3 py-2 font-semibold text-[var(--color-caleo-primary)]">
                    {r.service_name}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {r.category ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.order_count}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {formatIDR(r.total_revenue)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {formatIDR(r.total_hpp)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums font-bold ${
                      r.margin_pct >= 30
                        ? 'text-emerald-700'
                        : r.margin_pct >= 15
                          ? 'text-amber-600'
                          : 'text-rose-600'
                    }`}
                  >
                    {r.margin_pct}%
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 1 && (
              <tfoot className="bg-slate-50 font-bold">
                <tr>
                  <td className="px-3 py-2" colSpan={2}>
                    Total
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {rows.reduce((s, r) => s + r.order_count, 0)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatIDR(rows.reduce((s, r) => s + r.total_revenue, 0))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatIDR(rows.reduce((s, r) => s + r.total_hpp, 0))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">—</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  );
}
