// src/lib/dateRange.ts
//
// Date-range helpers for the Pembelian filter bar (and any future screen that
// wants the same chip set). All math is WIB (Asia/Jakarta) so chip arithmetic
// doesn't drift with operator-local timezone.

import { wibDateString } from './format';

export type FilterPreset = 'bulan_ini' | '30_hari' | '90_hari' | 'custom';

export interface FilterState {
  preset: FilterPreset;
  customFrom?: string; // 'YYYY-MM-DD', only honoured when preset === 'custom'
  customTo?: string;
}

export interface ResolvedRange {
  from: string; // 'YYYY-MM-DD' inclusive
  to: string;   // 'YYYY-MM-DD' inclusive
}

const MONTHS_ID_LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const MONTHS_ID_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
                         'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function parseIso(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

function isoFromYmd(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}`;
}

function shiftDays(iso: string, days: number): string {
  // Use UTC math to avoid local-DST drift, then format back to YYYY-MM-DD.
  const { y, m, d } = parseIso(iso);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return isoFromYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function firstOfMonth(iso: string): string {
  const { y, m } = parseIso(iso);
  return isoFromYmd(y, m, 1);
}

function lastOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function resolveRange(filter: FilterState, todayWib: string = wibDateString()): ResolvedRange {
  switch (filter.preset) {
    case 'bulan_ini':
      return { from: firstOfMonth(todayWib), to: todayWib };
    case '30_hari':
      return { from: shiftDays(todayWib, -29), to: todayWib };
    case '90_hari':
      return { from: shiftDays(todayWib, -89), to: todayWib };
    case 'custom':
      if (filter.customFrom && filter.customTo) {
        return { from: filter.customFrom, to: filter.customTo };
      }
      return { from: firstOfMonth(todayWib), to: todayWib };
  }
}

function formatDateShort(iso: string, withYear: boolean): string {
  const { y, m, d } = parseIso(iso);
  return withYear ? `${d} ${MONTHS_ID_SHORT[m - 1]} ${y}` : `${d} ${MONTHS_ID_SHORT[m - 1]}`;
}

export function periodLabel(filter: FilterState, todayWib: string = wibDateString()): string {
  if (filter.preset === 'bulan_ini') return 'Bulan Ini';
  if (filter.preset === '30_hari') return '30 Hari Terakhir';
  if (filter.preset === '90_hari') return '90 Hari Terakhir';
  const r = resolveRange(filter, todayWib);
  const f = parseIso(r.from);
  const t = parseIso(r.to);
  const sameMonth = f.y === t.y && f.m === t.m;
  const fromIsFirst = f.d === 1;
  const toIsLast = t.d === lastOfMonth(t.y, t.m);
  if (sameMonth && fromIsFirst && toIsLast) {
    return `${MONTHS_ID_LONG[f.m - 1]} ${f.y}`;
  }
  const sameYear = f.y === t.y;
  if (sameYear) {
    return `${formatDateShort(r.from, false)} – ${formatDateShort(r.to, true)}`;
  }
  return `${formatDateShort(r.from, true)} – ${formatDateShort(r.to, true)}`;
}

export function resolvedRangeShort(filter: FilterState, todayWib: string = wibDateString()): string {
  const r = resolveRange(filter, todayWib);
  const f = parseIso(r.from);
  const t = parseIso(r.to);
  const sameYear = f.y === t.y;
  return sameYear
    ? `${formatDateShort(r.from, false)} – ${formatDateShort(r.to, true)}`
    : `${formatDateShort(r.from, true)} – ${formatDateShort(r.to, true)}`;
}

export function inRange(iso: string | null | undefined, range: ResolvedRange): boolean {
  if (!iso) return false;
  return iso >= range.from && iso <= range.to;
}
