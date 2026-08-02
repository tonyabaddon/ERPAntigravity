import React, { useEffect, useState } from 'react';
import { Clock, ToggleLeft, ToggleRight } from 'lucide-react';
import { fetchOperatingHours } from '../../lib/pengaturan/queries';
import { updateOperatingHour } from '../../lib/pengaturan/mutations';
import type { OperatingHour } from '../../lib/pengaturan/types';
import { captureError } from '../../lib/captureError';

// 0=Senin .. 6=Minggu per migration 010 convention.
const DAY_LABELS: Record<number, string> = {
  0: 'Senin',
  1: 'Selasa',
  2: 'Rabu',
  3: 'Kamis',
  4: 'Jumat',
  5: 'Sabtu',
  6: 'Minggu',
};

type DayRow = {
  day_of_week: number;
  is_open: boolean;
  open_time: string;  // 'HH:MM' for <input type="time">
  close_time: string;
};

function timeToInputValue(t: string | undefined): string {
  if (!t) return '';
  // Postgres returns 'HH:MM:SS'; <input type="time"> expects 'HH:MM'.
  return t.length >= 5 ? t.slice(0, 5) : t;
}

function buildDefaultRows(): DayRow[] {
  return Array.from({ length: 7 }, (_, i) => ({
    day_of_week: i,
    is_open: i !== 6, // Sunday closed by default
    open_time: '08:00',
    close_time: '17:00',
  }));
}

function isRlsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  return msg.includes('row-level security') || msg.includes('permission denied') || msg.includes('42501');
}

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function JamOperasionalCard({ showToast }: Props) {
  const [rows, setRows] = useState<DayRow[]>(buildDefaultRows());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOperatingHours()
      .then(data => {
        if (cancelled) return;
        const byDay = new Map<number, OperatingHour>();
        for (const row of data) byDay.set(row.day_of_week, row);
        const defaults = buildDefaultRows();
        const merged = defaults.map(d => {
          const found = byDay.get(d.day_of_week);
          if (!found) return d;
          return {
            day_of_week: d.day_of_week,
            is_open: !!found.is_open,
            open_time: timeToInputValue(found.open_time) || d.open_time,
            close_time: timeToInputValue(found.close_time) || d.close_time,
          };
        });
        setRows(merged);
      })
      .catch(err => {
        captureError(err, { feature: 'pengaturan_jam_operasional', action: 'fetch_operating_hours' });
        if (!cancelled) showToast('Gagal memuat jam operasional.', 'warning');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [showToast]);

  const updateRow = (day: number, patch: Partial<DayRow>) => {
    setRows(prev => prev.map(r => (r.day_of_week === day ? { ...r, ...patch } : r)));
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      // Sequential updates — small (7 rows) and order doesn't matter for UX; if one
      // row hits an RLS error, surface immediately rather than fanning out.
      for (const r of rows) {
        await updateOperatingHour(r.day_of_week, {
          is_open: r.is_open,
          open_time: r.is_open ? `${r.open_time}:00` : undefined,
          close_time: r.is_open ? `${r.close_time}:00` : undefined,
        });
      }
      showToast('Jam operasional diperbarui.', 'success');
    } catch (err) {
      captureError(err, { feature: 'pengaturan_jam_operasional', action: 'update_operating_hour' });
      if (isRlsError(err)) {
        showToast('Anda harus Owner untuk mengubah jam operasional.', 'warning');
      } else {
        showToast(`Gagal menyimpan: ${(err as Error).message}`, 'warning');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded border border-[var(--color-caleo-mist)] p-6 shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded bg-[var(--color-caleo-primary)] flex items-center justify-center shrink-0">
          <Clock className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h3 className="text-base font-extrabold text-[var(--color-caleo-primary)]">Jam Operasional</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Muncul di kontak WhatsApp Business dan invoice PDF.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Memuat…</p>
      ) : (
        <>
          <div className="space-y-2">
            {rows.map(row => (
              <div
                key={row.day_of_week}
                className="flex items-center gap-3 p-3 rounded border border-slate-200 hover:bg-slate-50"
              >
                <div className="w-20 text-sm font-bold text-[var(--color-caleo-primary)] shrink-0">
                  {DAY_LABELS[row.day_of_week]}
                </div>

                <button
                  type="button"
                  onClick={() => updateRow(row.day_of_week, { is_open: !row.is_open })}
                  disabled={saving}
                  className="flex items-center gap-2 shrink-0"
                  title={row.is_open ? 'Klik untuk Tutup' : 'Klik untuk Buka'}
                >
                  {row.is_open ? (
                    <ToggleRight size={28} className="text-emerald-600" />
                  ) : (
                    <ToggleLeft size={28} className="text-slate-300" />
                  )}
                  <span
                    className={`text-[11px] font-bold uppercase tracking-wide ${
                      row.is_open ? 'text-emerald-700' : 'text-slate-400'
                    }`}
                  >
                    {row.is_open ? 'Buka' : 'Tutup'}
                  </span>
                </button>

                <div className="flex-1 flex items-center gap-2 justify-end">
                  <input
                    type="time"
                    value={row.open_time}
                    disabled={!row.is_open || saving}
                    onChange={e => updateRow(row.day_of_week, { open_time: e.target.value })}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm font-mono disabled:bg-slate-100 disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold"
                  />
                  <span className="text-xs text-slate-400">—</span>
                  <input
                    type="time"
                    value={row.close_time}
                    disabled={!row.is_open || saving}
                    onChange={e => updateRow(row.day_of_week, { close_time: e.target.value })}
                    className="border border-slate-200 rounded px-2 py-1.5 text-sm font-mono disabled:bg-slate-100 disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end mt-6">
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={saving}
              className="px-4 py-2 bg-[var(--color-caleo-primary)] text-white rounded-full text-xs font-bold disabled:opacity-50 hover:bg-[#01365e]"
            >
              {saving ? 'Menyimpan…' : 'Simpan Semua'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
