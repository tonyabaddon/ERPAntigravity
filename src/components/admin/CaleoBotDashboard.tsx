// src/components/admin/CaleoBotDashboard.tsx
// Sprint 7 Task 7.4 — Caleo Admin Bot analytics dashboard at /admin/caleo-bot.
// Data is fetched via SECDEF RPC get_bot_analytics_summary (restricted to
// platform admins). All data states (loading / empty / error / forbidden)
// are handled gracefully.
import { useEffect, useState, useCallback } from 'react';
import { Bot, Users, TrendingUp, ArrowRight } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { captureError } from '../../lib/captureError';
import { extractErrorMessage } from '../../lib/extractErrorMessage';

// ─── RPC response types ────────────────────────────────────────────────────────

interface BotAnalyticsSummary {
  prospects_today: number;
  prospects_week: number;
  prospects_month: number;
  top_faqs: Array<{ faq_id: string; count: number }>;
  escalation_rate_7d: Array<{ date: string; rate_pct: number }>;
  funnel: {
    prospects: number;
    demo_scheduled: number;
    signup: number;
  };
}

/** Day label for x-axis: "Min", "Sen", "Sel", ... (ID locale) */
const DAY_SHORT_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

interface EscalationDay {
  label: string;
  total: number;   // kept as 1 for any day with an escalation rate entry
  escalated: number; // derived from rate_pct
  rate_pct: number;
}

/** Map RPC escalation_rate_7d array → EscalationDay[] expected by EscalationTrend */
function mapEscalationDays(
  items: Array<{ date: string; rate_pct: number }>,
): EscalationDay[] {
  return items.map((item) => {
    const d = new Date(item.date + 'T00:00:00Z');
    const label = DAY_SHORT_ID[d.getUTCDay()] ?? item.date.slice(5); // "MM-DD" fallback
    // Synthesise total/escalated so EscalationTrend can compute the same ratio.
    // We use total=100 sentinel so rate_pct maps directly.
    const total = 100;
    const escalated = item.rate_pct;
    return { label, total, escalated, rate_pct: item.rate_pct };
  });
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

  // allZero: true only when there are no escalation entries from the RPC
  const allZero = days.length === 0;

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
                <title>{`${p.label}: ${p.rate}% eskalasi`}</title>
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

  const { data, error } = await supabase.rpc('get_bot_analytics_summary', {
    p_days: 30,
  });

  if (error) {
    // Surface a clear message for auth failures
    if (error.code === 'P0403' || error.message?.includes('BOT_ANALYTICS_FORBIDDEN')) {
      throw new Error('Akses ditolak: halaman ini hanya untuk Caleo platform admin.');
    }
    throw new Error(`Gagal memuat data bot: ${error.message}`);
  }

  const summary = data as BotAnalyticsSummary;

  const topFaq = (summary.top_faqs ?? []).map((item) => ({
    key: item.faq_id,
    count: item.count,
  }));

  const escalationDays = mapEscalationDays(summary.escalation_rate_7d ?? []);

  return {
    prospectsToday: summary.prospects_today ?? 0,
    prospectsWeek: summary.prospects_week ?? 0,
    prospectsMonth: summary.prospects_month ?? 0,
    topFaq,
    escalationDays,
    demoCount: summary.funnel?.demo_scheduled ?? 0,
    signupCount: summary.funnel?.signup ?? 0,
    totalProspects: summary.funnel?.prospects ?? 0,
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
      const msg = extractErrorMessage(err);
      setError(msg);
      captureError(msg, { feature: 'admin_caleo_bot', action: 'load_bot_analytics' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6 font-caleo" data-testid="caleo-bot-dashboard">
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
            Data dari <code>caleo_admin_bot_analytics</code> via{' '}
            <code>get_bot_analytics_summary()</code>.
          </div>
        </>
      )}
    </div>
  );
}
