import { supabase } from '../supabaseClient';
import type {
  SaldoAwalStepData,
  SaldoAwalSnapshot,
  PreviewTotals,
  YearEndClosePreview,
} from './types';

export async function saveSaldoAwalDraft(
  step_data: SaldoAwalStepData,
  cutover_date: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('save_saldo_awal_draft', {
    p_step_data: step_data,
    p_cutover_date: cutover_date,
  });
  if (error) throw error;
  return data as string;
}

export async function previewSaldoAwalTotals(
  step_data: SaldoAwalStepData,
): Promise<PreviewTotals> {
  const { data, error } = await supabase.rpc('preview_saldo_awal_totals', {
    p_step_data: step_data,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as PreviewTotals | undefined) ?? {
    total_assets: 0,
    total_liab: 0,
    total_equity: 0,
    laba_ditahan_balancing: 0,
  };
}

export async function getPersediaanAutoValue(): Promise<number> {
  const { data, error } = await supabase.rpc('get_persediaan_auto_value');
  if (error) throw error;
  return Number(data) || 0;
}

export async function postSaldoAwalSnapshot(snapshot_id: string): Promise<string> {
  const { data, error } = await supabase.rpc('post_saldo_awal_snapshot', {
    p_snapshot_id: snapshot_id,
  });
  if (error) throw error;
  return data as string;
}

export async function reverseSaldoAwal(snapshot_id: string, reason: string): Promise<string> {
  const { data, error } = await supabase.rpc('reverse_saldo_awal', {
    p_snapshot_id: snapshot_id,
    p_reason: reason,
  });
  if (error) throw error;
  return data as string;
}

export async function getSaldoAwalState(): Promise<SaldoAwalSnapshot | null> {
  const { data, error } = await supabase.rpc('get_saldo_awal_state');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as SaldoAwalSnapshot | undefined) ?? null;
}

export async function previewYearEndClose(fiscal_year: number): Promise<YearEndClosePreview> {
  const { data, error } = await supabase.rpc('preview_year_end_close', {
    p_fiscal_year: fiscal_year,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as YearEndClosePreview | undefined) ?? {
    total_revenue: 0,
    total_expense: 0,
    net_income: 0,
  };
}

export async function postYearEndClose(fiscal_year: number): Promise<string> {
  const { data, error } = await supabase.rpc('post_year_end_close', {
    p_fiscal_year: fiscal_year,
  });
  if (error) throw error;
  return data as string;
}
