import { supabase } from '../supabaseClient';
import type { FunnelSubStage, ProofSource } from './types';

export interface TransitionResult {
  ok: boolean;
  code?: 'STALE_VERSION' | 'STAGE_MISMATCH' | 'NOT_FOUND';
  newVersion?: number;
  newSubStage?: FunnelSubStage;
  currentVersion?: number;
  currentSubStage?: FunnelSubStage;
}

export async function transitionOrder(params: {
  id: string;
  fromSubStage: FunnelSubStage;
  toSubStage: FunnelSubStage;
  expectedVersion: number;
  reason?: string;
}): Promise<TransitionResult> {
  const { data, error } = await supabase.rpc('transition_order_stage', {
    p_order_id: params.id,
    p_from_sub_stage: params.fromSubStage,
    p_to_sub_stage: params.toSubStage,
    p_expected_version: params.expectedVersion,
    p_reason: params.reason ?? null,
  });
  if (error) throw error;
  return {
    ok: data.ok,
    code: data.code,
    newVersion: data.new_version,
    newSubStage: data.new_sub_stage,
    currentVersion: data.current_version,
    currentSubStage: data.current_sub_stage,
  };
}

export async function uploadPaymentProof(params: {
  orderId: string;
  file: File;
  source: ProofSource;
  field: 'payment_proof_url' | 'pelunasan_proof_url' | 'marketplace_proof_url';
}): Promise<string> {
  const safeName = params.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `${params.orderId}/${Date.now()}-${safeName}`;
  const { error: upErr } = await supabase.storage.from('payment-proofs').upload(filename, params.file);
  if (upErr) throw upErr;
  const { data: { publicUrl } } = supabase.storage.from('payment-proofs').getPublicUrl(filename);
  const { data: userResp } = await supabase.auth.getUser();
  const { error: updErr } = await supabase
    .from('kasir_transactions')
    .update({
      [params.field]: publicUrl,
      proof_source: params.source,
      proof_uploaded_at: new Date().toISOString(),
      proof_uploaded_by: userResp.user?.id ?? null,
    })
    .eq('id', params.orderId);
  if (updErr) throw updErr;
  return publicUrl;
}
