// src/components/admin/CaleoBotDashboard.tsx
// Sprint 7 Task 7.4 — Caleo Admin Bot analytics dashboard at /admin/caleo-bot.
// Reads from caleo_admin_bot_analytics (no RLS — service_role only). The
// frontend uses the anon-key client, so queries may return empty rows if the
// Supabase project's PostgREST is configured to block public reads. All data
// states (loading / empty / error) are handled gracefully.
import { useEffect, useState, useCallback } from 'react';
import { Bot, Users, TrendingUp, ArrowRight } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface AnalyticsRow {
  session_id: string;
  first_message_at: string;
  faq_hits: unknown; // JSONB — shape: string[] or null
  escalated_at: string | null;
  demo_scheduled_at: string | null;
  converted_to_signup_at: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function startOfDayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfWeekIso(): string {
  const d = new Date();
  const dow = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfMonthIso(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Aggregate faq_hits across rows → {keyword: count} */
function aggregateFaqHits(rows: AnalyticsRow[]): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const row of rows) {
    const hits = row.faq_hits;
    if (!hits || !Array.isArray(hits)) continue;
    for (const hit of hits as string[]) {
      if (typeof hit === 'string' && hit.length > 0) {
        acc[hit] = (acc[hit] ?? 0) + 1;
      }
    }
  }
  return acc;
}

/** Top N entries sorted by count desc */
function topN(counts: Record<string, number>, n: number): Array<{ key: string; count: number }> {
  return Object.entries(counts)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

/** Day label for x-axis: "S", "S", "R", ... (Mon→Sun in ID) */
const DAY_SHORT_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

interface EscalationDay {
  label: string;
  total: number;
  escalated: number;
}

/** Build 7-day escalation trend (newest day last, oldest first) */
function buildEscalationTrend(rows: AnalyticsRow[]): EscalationDay[] {
  const days: EscalationDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date();
    dayStart.setDate(dayStart.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const dayRows = rows.filter((r) => {
      const t = new Date(r.first_message_at).getTime();
      return t >= dayStart.getTime() && t < dayEnd.getTime();
    });

    days.push({
      label: DAY_SHORT_ID[dayStart.getDay()] ?? String(dayStart.getDate()),
      total: dayRows.length,
      escalated: dayRows.filter((r) => r.escalated_at !== null).length,
    });
  }
  return days;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse" data-testid="caleo-bot-loading">
      <div className="h-10 rounded-xl w-72" style={{ background: '#F1F3F6' }} />
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-xl" style={{ background: '#F1F3F6' }} />
        ))}
      </div>
      <div className="h-48 rounded-xl" style={{ background: '#F1F3F6' }} />
      <div className="h-40 rounded-xl" style={{ background: '#F1F3F6' }} />
    </div>
  );
}

// ── Prospect KPI cards ─────────────────────────────────────────────────────────

interface ProspectCardsProps {
  today: number;
  week: number;
  month: number;
}

function ProspectCards({ today, week, month }: ProspectCardsProps) {
  const cards = [
    { label: 'Hari Ini', value: today },
    { label: 'Minggu Ini', value: week },
    { label: 'Bulan Ini', value: month },
  ];
  return (
    <div className="grid grid-cols-3 gap-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl p-4 border"
          style={{ background: '#FFFFFF', borderColor: '#ECEEF1' }}
          data-testid={`bot-kpi-${c.label.toLowerCase().replace(/\s/g, '-')}`}
        >
          <div
            className="text-[11px] font-bold uppercase tracking-widest mb-1"
            style={{ fontFamily: 'JetBrains Mono, monospace', color: '#9DB2CE' }}
          >
            Prospek {c.label}
          </div>
          <div
            className="text-[28px] font-bold leading-none"
            style={{ fontFamily: 'JetBrains Mono, monospace', color: '#0B2545' }}
          >
            {c.value}
          </div>
          <div className="text-[11px] mt-1" style={{ color: '#9DB2CE' }}>
            sesi baru
          </div>
        </div>
      ))}
    </div>
  );
}

// ── FAQ bar chart ──────────────────────────────────────────────────────────────

interface FaqBarChartProps {
  items: Array<{ key: string; count: number }>;
}

const SVG_W = 480;
const SVG_H = 160;
const BAR_PAD_LEFT = 80; // room for labels
const BAR_PAD_RIGHT = 40;
const BAR_PAD_TOP = 12;
const BAR_PAD_BOTTOM = 12;
const CHART_INNER_W = SVG_W - BAR_PAD_LEFT - BAR_PAD_RIGHT;
const CHART_INNER_H = SVG_H - BAR_PAD_TOP - BAR_PAD_BOTTOM;

function FaqBarChart({ items }: FaqBarChartProps) {
  if (items.length === 0) {
    return (
      <p className="text-[13px] py-6 text-center" style={{ color: '#9DB2CE' }}>
        Belum ada FAQ hits (30 hari terakhir).
      </p>
    );
  }

  const maxCount = Math.max(...items.map((i) => i.count), 1);
  const barH = CHART_INNER_H / items.length;
  const barGap = 4;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        height={SVG_H}
        aria-label="Grafik FAQ terpopuler 30 hari"
        role="img"
        style={{ display: 'block' }}
      >
        {items.map((item, i) => {
          const y = BAR_PAD_TOP + i * barH;
          const barWidth = (item.count / maxCount) * CHART_INNER_W;
          const barY = y + barGap / 2;
          const barHeight = barH - barGap;

          return (
            <g key={item.key}>
              {/* Label */}
              <text
                x={BAR_PAD_LEFT - 6}
                y={barY + barHeight / 2 + 4}
                textAnchor="end"
                fontSize="10"
                fill="#0B2545"
                fontFamily="JetBrains Mono, monospace"
              >
                {item.key.length > 10 ? item.key.slice(0, 9) + '…' : item.key}
              </text>

              {/* Background track */}
              <rect
                x={BAR_PAD_LEFT}
                y={barY}
                width={CHART_INNER_W}
                height={barHeight}
                rx="3"
                fill="#F1F3F6"
              />

              {/* Value bar */}
              <rect
                x={BAR_PAD_LEFT}
                y={barY}
                width={Math.max(barWidth, 4)}
                height={barHeight}
                rx="3"
                fill="#F9B233"
              />

              {/* Count label */}
              <text
                x={BAR_PAD_LEFT + Math.max(barWidth, 4) + 6}
                y={barY + barHeight / 2 + 4}
                fontSize="10"
                fill="#64748B"
                fontFamily="JetBrains Mono, monospace"
              >
                {item.count}
              </text>

              <title>{`${item.key}: ${item.count} hits`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Escalation rate trend ──────────────────────────────────────────────────────

interface EscalationTrendProps {
  days: EscalationDay[];
}

const ESC_W = 480;
const ESC_H = 120;
const ESC_PAD_LEFT = 0;
const ESC_PAD_RIGHT = 0;
const ESC_PAD_TOP = 12;
const ESC_PAD_BOTTOM = 22;
const ESC_CW = ESC_W - ESC_PAD_LEFT - ESC_PAD_RIGHT;
const ESC_CH = ESC_H - ESC_PAD_TOP - ESC_PAD_BOTTOM;

function EscalationTrend({ days }: EscalationTrendProps) {
  const maxRate = 100;
  const n = days.length;

  const pts = days.map((d, i) => {
    const rate = d.total === 0 ? 0 : Math.round((d.escalated / d.total) * 100);
    const x = ESC_PAD_LEFT + (n <= 1 ? ESC_CW / 2 : (i / (n - 1)) * ESC_CW);
    const y = ESC_PAD_TOP + ESC_CH - (rate / maxRate) * ESC_CH;
    return { x, y, rate, label: d.label, total: d.total };
  });

  const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const first = pts[0];
  const last = pts[pts.length - 1];
  const baseY = ESC_PAD_TOP + ESC_CH;
  const area = first && last
    ? `M ${first.x},${baseY} ` + pts.map((p) => `L ${p.x},${p.y}`).join(' ') + ` L ${last.x},${baseY} Z`
    : '';

  const allZero = days.every((d) => d.total === 0);

  return (
    <div style={{ overflowX: 'auto' }}>
      {allZero ? (
        <p className="text-[13px] py-4 text-center" style={{ color: '#9DB2CE' }}>
          Belum ada sesi dalam 7 hari terakhir.
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${ESC_W} ${ESC_H}`}
          width="100%"
          height={ESC_H}
          aria-label="Grafik escalation rate 7 hari"
          role="img"
          style={{ display: 'block' }}
        >
          {area && (
            <path d={area} fill="#EF444420" stroke="none" />
          )}

          <polyline
            points={polyline}
            fill="none"
            stroke="#EF4444"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {pts.map((p, i) => (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r={p.total > 0 ? 4 : 2}
                fill={p.total > 0 ? '#EF4444' : '#ECEEF1'}
                stroke="white"
                strokeWidth="1.5"
              />
              <text
                x={p.x}
                y={ESC_H - 4}
                textAnchor="middle"
                fontSize="9"
                fill="#9DB2CE"
                fontFamily="JetBrains Mono, monospace"
              >
                {p.label}
              </text>
              {p.total > 0 && (
                <title>{`${p.label}: ${p.rate}% (${p.total} sesi)`}</title>
              )}
            </g>
          ))}

          <line
            x1={ESC_PAD_LEFT}
            y1={ESC_PAD_TOP + ESC_CH}
            x2={ESC_PAD_LEFT + ESC_CW}
            y2={ESC_PAD_TOP + ESC_CH}
            stroke="#ECEEF1"
            strokeWidth="1"
          />
        </svg>
      )}
    </div>
  );
}

// ── Funnel display ─────────────────────────────────────────────────────────────

interface FunnelProps {
  prospects: number;
  demos: number;
  signups: number;
}

function FunnelDisplay({ prospects, demos, signups }: FunnelProps) {
  const stages = [
    { label: 'Prospek', value: prospects, color: '#0B2545', testId: 'funnel-prospects' },
    { label: 'Demo Dijadwalkan', value: demos, color: '#F9B233', testId: 'funnel-demos' },
    { label: 'Signup', value: signups, color: '#16A34A', testId: 'funnel-signups' },
  ];

  return (
    <div className="flex items-stretch gap-0">
      {stages.map((stage, i) => (
        <div key={stage.label} className="flex items-center gap-0 flex-1">
          <div
            className="flex-1 rounded-xl p-4 text-center"
            style={{ background: `${stage.color}10`, border: `1px solid ${stage.color}30` }}
            data-testid={stage.testId}
          >
            <div
              className="text-[24px] font-bold leading-none"
              style={{ fontFamily: 'JetBrains Mono, monospace', color: stage.color }}
            >
              {stage.value}
            </div>
            <div
              className="text-[11px] font-bold uppercase tracking-widest mt-1"
              style={{ color: stage.color, fontFamily: 'JetBrains Mono, monospace' }}
            >
              {stage.label}
            </div>
            {i > 0 && prospects > 0 && (
              <div className="text-[10px] mt-0.5" style={{ color: '#9DB2CE' }}>
                {Math.round((stage.value / prospects) * 100)}% konversi
              </div>
            )}
          </div>
          {i < stages.length - 1 && (
            <div className="flex items-center justify-center w-8 shrink-0">
              <ArrowRight size={14} strokeWidth={2} style={{ color: '#9DB2CE' }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface BotStats {
  prospectsToday: number;
  prospectsWeek: number;
  prospectsMonth: number;
  topFaq: Array<{ key: string; count: number }>;
  escalationDays: EscalationDay[];
  demoCount: number;
  signupCount: number;
  totalProspects: number;
}

async function fetchBotStats(): Promise<BotStats> {
  if (!supabase) throw new Error('Supabase client not configured');

  const since30d = daysAgoIso(30);
  const todayStart = startOfDayIso();
  const weekStart = startOfWeekIso();
  const monthStart = startOfMonthIso();
  const now = nowIso();

  // Single fetch for last 30 days of sessions (≤ 10K rows bounded).
  const { data, error } = await supabase
    .from('caleo_admin_bot_analytics')
    .select('session_id,first_message_at,faq_hits,escalated_at,demo_scheduled_at,converted_to_signup_at')
    .gte('first_message_at', since30d)
    .lte('first_message_at', now)
    .order('first_message_at', { ascending: false })
    .limit(10000);

  if (error) {
    throw new Error(`Gagal memuat data bot: ${error.message}`);
  }

  const rows = (data ?? []) as AnalyticsRow[];

  const prospectsToday = rows.filter((r) => r.first_message_at >= todayStart).length;
  const prospectsWeek = rows.filter((r) => r.first_message_at >= weekStart).length;
  const prospectsMonth = rows.filter((r) => r.first_message_at >= monthStart).length;

  const faqCounts = aggregateFaqHits(rows);
  const topFaq = topN(faqCounts, 5);

  const escalationDays = buildEscalationTrend(rows);

  const demoCount = rows.filter((r) => r.demo_scheduled_at !== null).length;
  const signupCount = rows.filter((r) => r.converted_to_signup_at !== null).length;
  const totalProspects = rows.length;

  return {
    prospectsToday,
    prospectsWeek,
    prospectsMonth,
    topFaq,
    escalationDays,
    demoCount,
    signupCount,
    totalProspects,
  };
}

export function CaleoBotDashboard() {
  const [stats, setStats] = useState<BotStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await fetchBotStats();
      setStats(s);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.error('[CaleoBotDashboard] load error:', msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6 font-vosi" data-testid="caleo-bot-dashboard">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Bot size={18} strokeWidth={1.8} style={{ color: '#F9B233' }} />
            <h1 className="text-lg font-bold" style={{ color: '#0B2545' }}>
              Caleo Bot Analytics
            </h1>
          </div>
          <p className="text-[12px] mt-0.5" style={{ color: '#64748B' }}>
            Prospek masuk via landing page bot — data 30 hari terakhir.
            {' '}
            <span style={{ color: '#94A3B8' }}>
              Catatan: tabel tanpa RLS, akses dari browser mungkin terbatas.
            </span>
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-50"
          style={{ background: '#0B2545', color: '#FFFFFF' }}
          data-testid="bot-refresh-button"
        >
          {loading ? 'Memuat…' : 'Refresh'}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div
          className="rounded-xl p-4 text-[13px]"
          style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B' }}
          data-testid="bot-error"
          role="alert"
        >
          {error}
          {error.includes('terbatas') || error.includes('permission') || error.includes('401') ? (
            <p className="mt-1 text-[12px]" style={{ color: '#B91C1C' }}>
              Tabel bot analytics hanya accessible via service_role. Pertimbangkan membuat SECDEF RPC untuk akses admin.
            </p>
          ) : null}
        </div>
      )}

      {loading && <Skeleton />}

      {!loading && !error && stats && (
        <>
          {/* Row 1: Prospect KPI cards */}
          <section aria-label="Prospek hari ini / minggu ini / bulan ini">
            <div className="flex items-center gap-2 mb-3">
              <Users size={14} strokeWidth={1.8} style={{ color: '#9DB2CE' }} />
              <span
                className="text-[11px] font-bold uppercase tracking-widest"
                style={{ fontFamily: 'JetBrains Mono, monospace', color: '#9DB2CE' }}
              >
                Prospek Baru
              </span>
            </div>
            <ProspectCards
              today={stats.prospectsToday}
              week={stats.prospectsWeek}
              month={stats.prospectsMonth}
            />
          </section>

          {/* Row 2: Top FAQ bar chart */}
          <section
            className="rounded-xl p-5 border"
            style={{ background: '#FFFFFF', borderColor: '#ECEEF1' }}
            aria-label="FAQ terpopuler"
          >
            <h3
              className="text-[11px] font-bold uppercase tracking-widest mb-4"
              style={{ fontFamily: 'JetBrains Mono, monospace', color: '#9DB2CE' }}
            >
              Top 5 FAQ (30 Hari)
            </h3>
            <FaqBarChart items={stats.topFaq} />
          </section>

          {/* Row 3: Escalation rate 7-day trend */}
          <section
            className="rounded-xl p-5 border"
            style={{ background: '#FFFFFF', borderColor: '#ECEEF1' }}
            aria-label="Escalation rate 7 hari"
          >
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={14} strokeWidth={1.8} style={{ color: '#EF4444' }} />
              <h3
                className="text-[11px] font-bold uppercase tracking-widest"
                style={{ fontFamily: 'JetBrains Mono, monospace', color: '#9DB2CE' }}
              >
                Escalation Rate 7 Hari
              </h3>
            </div>
            <EscalationTrend days={stats.escalationDays} />
          </section>

          {/* Row 4: Funnel */}
          <section
            className="rounded-xl p-5 border"
            style={{ background: '#FFFFFF', borderColor: '#ECEEF1' }}
            aria-label="Funnel konversi prospek"
          >
            <h3
              className="text-[11px] font-bold uppercase tracking-widest mb-4"
              style={{ fontFamily: 'JetBrains Mono, monospace', color: '#9DB2CE' }}
            >
              Funnel Konversi (30 Hari)
            </h3>
            <FunnelDisplay
              prospects={stats.totalProspects}
              demos={stats.demoCount}
              signups={stats.signupCount}
            />
          </section>

          {/* Footnote */}
          <div className="text-[11px]" style={{ color: '#94A3B8' }}>
            Data dari <code>caleo_admin_bot_analytics</code>.
            Jika kosong di browser, tambahkan SECDEF RPC
            <code> get_bot_analytics_summary()</code> agar bisa diakses tanpa service_role.
          </div>
        </>
      )}
    </div>
  );
}
