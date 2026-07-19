/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// src/components/feedback/CustomerFeedbackScreen.tsx
// Sprint 4 Task 4.5 — Customer feedback dashboard.
// Reads from customer_feedback (RLS: t_select_own, to authenticated).
// "Approve untuk landing" toggle is READ-ONLY — a Sprint 5 backend SECDEF RPC
// (approve_customer_feedback) is required before writes can be made from the
// client (t_update_own is restricted to vosi_rpc_owner). See task-4.5-report.md.

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { navigate } from '../../lib/urlRoute';

type RatingFilter = 'all' | '5' | '4' | 'needs-attention';

interface FeedbackRow {
  id: string;
  customer_id: string;
  order_id: string;
  rating: number | null;
  comment: string | null;
  approved_for_landing: boolean;
  received_at: string;
}

function StarDisplay({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="cfs-no-rating">—</span>;
  return (
    <span className="cfs-stars" aria-label={`Rating ${rating} dari 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={i < rating ? 'cfs-star cfs-star--filled' : 'cfs-star'}>
          ★
        </span>
      ))}
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function CustomerFeedbackScreen() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RatingFilter>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      const { data, error } = await supabase
        .from('customer_feedback')
        .select('id, customer_id, order_id, rating, comment, approved_for_landing, received_at')
        .order('received_at', { ascending: false })
        .limit(500);
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      setRows((data ?? []) as FeedbackRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Summary stats (computed from full unfiltered list) ──────────────────────
  const stats = useMemo(() => {
    const rated = rows.filter((r) => r.rating !== null);
    if (rated.length === 0) return null;
    const avg = rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length;
    const byRating: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of rated) {
      if (r.rating !== null) byRating[r.rating] = (byRating[r.rating] ?? 0) + 1;
    }
    return { avg: Math.round(avg * 10) / 10, byRating, total: rated.length };
  }, [rows]);

  // ── Filtered rows ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === '5') return rows.filter((r) => r.rating === 5);
    if (filter === '4') return rows.filter((r) => r.rating === 4);
    if (filter === 'needs-attention') return rows.filter((r) => r.rating !== null && r.rating <= 2);
    return rows;
  }, [rows, filter]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="cfs-loading" role="status" aria-busy="true">
        Memuat feedback...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="cfs-error" role="alert">
        <strong>Gagal memuat feedback:</strong> {loadError}
      </div>
    );
  }

  return (
    <div className="cfs-screen">
      {/* ── Header ── */}
      <header className="cfs-header">
        <div className="cfs-header-top">
          <button
            type="button"
            className="cfs-back-btn"
            onClick={() => navigate('settings')}
            aria-label="Kembali ke Pengaturan"
          >
            ← Pengaturan
          </button>
        </div>
        <h1 className="cfs-title">Feedback Customer</h1>
        <p className="cfs-subtitle">
          Rating dan komentar dari customer setelah order selesai.
        </p>
      </header>

      {/* ── Summary stats ── */}
      {stats ? (
        <div className="cfs-stats" aria-label="Ringkasan statistik feedback">
          <div className="cfs-stat-card">
            <div className="cfs-stat-value">{stats.avg}</div>
            <div className="cfs-stat-label">Rata-rata rating</div>
            <div className="cfs-stat-stars">
              <StarDisplay rating={Math.round(stats.avg)} />
            </div>
          </div>
          <div className="cfs-stat-card">
            <div className="cfs-stat-value">{stats.total}</div>
            <div className="cfs-stat-label">Total feedback</div>
          </div>
          <div className="cfs-stat-card cfs-stat-card--dist">
            <div className="cfs-stat-label cfs-stat-label--heading">Distribusi rating</div>
            <div className="cfs-dist">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = stats.byRating[star] ?? 0;
                const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
                return (
                  <div key={star} className="cfs-dist-row">
                    <span className="cfs-dist-star">{star}★</span>
                    <div className="cfs-dist-bar-bg">
                      <div
                        className="cfs-dist-bar"
                        style={{ width: `${pct}%` }}
                        aria-hidden="true"
                      />
                    </div>
                    <span className="cfs-dist-count">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="cfs-empty-stats">
          Belum ada feedback yang masuk.
        </div>
      )}

      {/* ── Approval backend note ── */}
      <div className="cfs-rls-note" role="note">
        ℹ️ Kolom "Approve untuk landing" saat ini hanya bisa dilihat — fitur approve via UI akan tersedia setelah backend RPC
        <code>approve_customer_feedback</code> disiapkan di Sprint 5.
      </div>

      {/* ── Filter bar ── */}
      <div className="cfs-filters" role="group" aria-label="Filter feedback">
        {([
          ['all', 'Semua'],
          ['5', '5 bintang'],
          ['4', '4 bintang'],
          ['needs-attention', 'Perlu perhatian (1-2★)'],
        ] as [RatingFilter, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`cfs-filter-btn${filter === id ? ' cfs-filter-btn--active' : ''}`}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Table ── */}
      {filtered.length === 0 ? (
        <div className="cfs-empty">
          {rows.length === 0
            ? 'Belum ada feedback dari customer.'
            : 'Tidak ada feedback yang cocok dengan filter ini.'}
        </div>
      ) : (
        <div className="cfs-table-wrapper" role="region" aria-label="Tabel feedback customer">
          <table className="cfs-table">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">No. Order</th>
                <th scope="col">Rating</th>
                <th scope="col">Komentar</th>
                <th scope="col">Tanggal</th>
                <th scope="col">Approved landing</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  className={
                    row.rating !== null && row.rating <= 2 ? 'cfs-row--low' : ''
                  }
                >
                  <td className="cfs-td-customer">
                    <span className="cfs-customer-id" title={row.customer_id}>
                      {row.customer_id.length > 16
                        ? row.customer_id.slice(0, 14) + '…'
                        : row.customer_id}
                    </span>
                  </td>
                  <td className="cfs-td-order">
                    <code className="cfs-order-id" title={row.order_id}>
                      {row.order_id.slice(0, 8)}…
                    </code>
                  </td>
                  <td className="cfs-td-rating">
                    <StarDisplay rating={row.rating} />
                  </td>
                  <td className="cfs-td-comment">
                    {row.comment ? (
                      <span className="cfs-comment">{row.comment}</span>
                    ) : (
                      <span className="cfs-no-comment">—</span>
                    )}
                  </td>
                  <td className="cfs-td-date">{formatDate(row.received_at)}</td>
                  <td className="cfs-td-approved">
                    <span
                      className={
                        row.approved_for_landing
                          ? 'cfs-approved-badge cfs-approved-badge--yes'
                          : 'cfs-approved-badge cfs-approved-badge--no'
                      }
                      title="Approve via UI tersedia Sprint 5"
                    >
                      {row.approved_for_landing ? '✓ Approved' : 'Belum'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        .cfs-screen {
          max-width: 1100px;
          margin: 0 auto;
          padding: 24px;
          font-family: 'Inter', sans-serif;
        }
        .cfs-loading, .cfs-error, .cfs-empty, .cfs-empty-stats {
          padding: 32px;
          text-align: center;
          color: #475569;
          font-size: 14px;
        }
        .cfs-error { color: #991B1B; }

        /* Header */
        .cfs-header { margin-bottom: 24px; }
        .cfs-header-top { margin-bottom: 8px; }
        .cfs-back-btn {
          background: none;
          border: none;
          color: #475569;
          font-size: 13px;
          cursor: pointer;
          padding: 4px 0;
          text-decoration: underline;
        }
        .cfs-back-btn:hover { color: #0B2545; }
        .cfs-title {
          font-size: 22px;
          font-weight: 700;
          color: #0B2545;
          margin: 0 0 6px;
        }
        .cfs-subtitle {
          font-size: 14px;
          color: #64748B;
          margin: 0;
          line-height: 1.5;
        }

        /* Stats */
        .cfs-stats {
          display: grid;
          grid-template-columns: 1fr 1fr 2fr;
          gap: 16px;
          margin-bottom: 20px;
        }
        @media (max-width: 700px) {
          .cfs-stats { grid-template-columns: 1fr; }
        }
        .cfs-stat-card {
          background: white;
          border: 1px solid #E2E8F0;
          border-radius: 10px;
          padding: 16px 20px;
        }
        .cfs-stat-value {
          font-size: 28px;
          font-weight: 700;
          color: #0B2545;
          line-height: 1;
          margin-bottom: 4px;
        }
        .cfs-stat-label {
          font-size: 12px;
          color: #94A3B8;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .cfs-stat-label--heading {
          margin-bottom: 10px;
        }
        .cfs-stat-stars { margin-top: 6px; }

        /* Distribution */
        .cfs-dist { display: flex; flex-direction: column; gap: 5px; }
        .cfs-dist-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .cfs-dist-star {
          font-size: 12px;
          color: #64748B;
          width: 24px;
          text-align: right;
          flex-shrink: 0;
        }
        .cfs-dist-bar-bg {
          flex: 1;
          height: 8px;
          background: #F1F5F9;
          border-radius: 99px;
          overflow: hidden;
        }
        .cfs-dist-bar {
          height: 100%;
          background: #8B5CF6;
          border-radius: 99px;
          transition: width 0.3s;
        }
        .cfs-dist-count {
          font-size: 12px;
          color: #475569;
          width: 20px;
          text-align: right;
          flex-shrink: 0;
        }

        /* RLS note */
        .cfs-rls-note {
          font-size: 12px;
          color: #92400E;
          background: #FFFBEB;
          border: 1px solid #FDE68A;
          border-radius: 6px;
          padding: 8px 12px;
          margin-bottom: 16px;
          line-height: 1.5;
        }
        .cfs-rls-note code {
          font-family: 'JetBrains Mono', 'Fira Mono', monospace;
          font-size: 11px;
          background: #FEF3C7;
          padding: 1px 4px;
          border-radius: 3px;
        }

        /* Filter bar */
        .cfs-filters {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }
        .cfs-filter-btn {
          padding: 6px 14px;
          border-radius: 99px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid #CBD5E1;
          background: white;
          color: #475569;
          transition: background 0.1s, border-color 0.1s, color 0.1s;
        }
        .cfs-filter-btn:hover { background: #F8FAFC; border-color: #94A3B8; }
        .cfs-filter-btn--active {
          background: #8B5CF6;
          border-color: #8B5CF6;
          color: white;
        }
        .cfs-filter-btn--active:hover { background: #7C3AED; border-color: #7C3AED; }

        /* Table */
        .cfs-table-wrapper {
          overflow-x: auto;
          border: 1px solid #E2E8F0;
          border-radius: 10px;
        }
        .cfs-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .cfs-table th {
          background: #F8FAFC;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #64748B;
          padding: 10px 14px;
          text-align: left;
          border-bottom: 1px solid #E2E8F0;
          white-space: nowrap;
        }
        .cfs-table td {
          padding: 12px 14px;
          border-bottom: 1px solid #F1F5F9;
          vertical-align: middle;
          color: #334155;
        }
        .cfs-table tbody tr:last-child td { border-bottom: none; }
        .cfs-table tbody tr:hover td { background: #FAFBFC; }
        .cfs-row--low td { background: #FFF5F5; }
        .cfs-row--low:hover td { background: #FEE2E2; }

        /* Cell content */
        .cfs-customer-id {
          font-weight: 600;
          color: #0B2545;
        }
        .cfs-order-id {
          font-family: 'JetBrains Mono', 'Fira Mono', monospace;
          font-size: 12px;
          color: #64748B;
        }
        .cfs-comment {
          font-size: 13px;
          color: #334155;
          line-height: 1.4;
        }
        .cfs-no-comment { color: #CBD5E1; }
        .cfs-no-rating { color: #CBD5E1; }
        .cfs-td-date { font-size: 12px; color: #64748B; white-space: nowrap; }

        /* Stars */
        .cfs-stars { display: inline-flex; gap: 1px; }
        .cfs-star { font-size: 15px; color: #CBD5E1; }
        .cfs-star--filled { color: #F59E0B; }

        /* Approved badge */
        .cfs-approved-badge {
          display: inline-block;
          font-size: 11px;
          font-weight: 700;
          padding: 3px 10px;
          border-radius: 99px;
          white-space: nowrap;
        }
        .cfs-approved-badge--yes {
          background: #DCFCE7;
          color: #166534;
        }
        .cfs-approved-badge--no {
          background: #F1F5F9;
          color: #94A3B8;
        }

        @media (max-width: 600px) {
          .cfs-screen { padding: 16px; }
        }
      `}</style>
    </div>
  );
}
