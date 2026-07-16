/**
 * Typed wrappers for the platform-admin payment RPCs (Phase B Wave 5).
 *
 * RPC parameter names (verified against migrations 20261115000023/24):
 *   record_payment(p_payload jsonb)
 *   update_payment(p_payment_id uuid, p_updates jsonb)
 *   delete_payment(p_payment_id uuid, p_reason text)
 *   list_payments(p_filters jsonb)
 *   get_revenue_stats(p_filters jsonb)
 *
 * generate_payment_proof_signed_url DOES NOT EXIST as a SQL RPC.
 * Per Task 5 concern: use client-side SDK `supabase.storage.from('payment-proofs').createSignedUrl()`.
 *
 * Error mapping:
 *   P0403              → PlatformAdminRequiredError
 *   P0404 PAYMENT_NOT_FOUND → PaymentNotFoundError
 *   P0404 TENANT_NOT_FOUND  → TenantNotFoundError
 *   22023 INVALID_AMOUNT    → InvalidAmountError
 *   22023 INVALID_PERIOD    → InvalidPeriodError
 *   22023 REASON_REQUIRED   → ReasonRequiredError
 *   22023 INVALID_GROUP_BY  → InvalidGroupByError
 *   22023 (other)           → InvalidFilterError
 *   23514                   → MethodMismatchError
 *   Storage 403             → StorageAccessDeniedError
 *   File > 5MB              → PaymentFileTooLargeError (client-side)
 *   Wrong mime              → PaymentFileWrongTypeError (client-side)
 */

import { supabase } from './supabaseClient';
import {
  PlatformAdminRequiredError,
  InvalidFilterError,
  TenantNotFoundError,
  InvalidAmountError,
  InvalidPeriodError,
  MethodMismatchError,
  PaymentNotFoundError,
  StorageAccessDeniedError,
  ReasonRequiredError,
  InvalidGroupByError,
  PaymentFileTooLargeError,
  PaymentFileWrongTypeError,
} from './adminTypes';
import type {
  RecordPaymentInput,
  RecordPaymentResult,
  UpdatePaymentInput,
  PaymentRow,
  PaymentsListFilters,
  RevenueStatsFilters,
  RevenueStats,
} from './paymentsTypes';

// ─── Internal helpers ─────────────────────────────────────────────────────────

const MAX_PROOF_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

/**
 * Normalize a raw Supabase/Postgres RPC error into a typed payment error.
 * Mirrors the logic in adminApi.normalizeRpcError but is local to this module.
 */
function normalizePaymentRpcError(error: { message?: string; code?: string }): never {
  // P0404 — check specific message before generic tenant fallthrough
  if (error.code === 'P0404') {
    if (error.message === 'PAYMENT_NOT_FOUND') {
      throw new PaymentNotFoundError(error.message);
    }
    throw new TenantNotFoundError(error.message);
  }
  // P0403 — platform admin gate
  if (error.code === 'P0403') {
    throw new PlatformAdminRequiredError(error.message);
  }
  // 23514 — CHECK constraint violation (method/bank/ewallet mismatch)
  if (error.code === '23514') {
    throw new MethodMismatchError(error.message);
  }
  // 22023 — dispatch by message
  if (error.code === '22023') {
    if (error.message === 'INVALID_AMOUNT') {
      throw new InvalidAmountError(error.message);
    }
    if (error.message === 'INVALID_PERIOD') {
      throw new InvalidPeriodError(error.message);
    }
    if (error.message === 'REASON_REQUIRED') {
      throw new ReasonRequiredError(error.message);
    }
    if (error.message === 'INVALID_GROUP_BY') {
      throw new InvalidGroupByError(error.message);
    }
    throw new InvalidFilterError(error.message);
  }
  throw new Error(error.message ?? 'RPC error');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call record_payment(p_payload jsonb).
 * Creates a new payment record and returns coverage status.
 *
 * @throws PlatformAdminRequiredError  when caller is not a platform admin
 * @throws TenantNotFoundError         when tenant_id does not exist
 * @throws InvalidAmountError          when amount ≤ 0
 * @throws InvalidPeriodError          when period_to is not after period_from
 * @throws MethodMismatchError         when payment_method requires bank/ewallet info
 * @throws InvalidFilterError          when an unknown field is passed
 */
export async function recordPayment(
  input: RecordPaymentInput,
): Promise<RecordPaymentResult> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.rpc('record_payment', {
    p_payload: input,
  });
  if (error) normalizePaymentRpcError(error);
  return data as RecordPaymentResult;
}

/**
 * Call update_payment(p_payment_id uuid, p_updates jsonb).
 * Updates an existing payment record.
 *
 * @throws PlatformAdminRequiredError  when caller is not a platform admin
 * @throws PaymentNotFoundError        when payment_id does not exist
 * @throws InvalidAmountError          when amount ≤ 0
 * @throws InvalidPeriodError          when period_to is not after period_from
 * @throws InvalidFilterError          when an unknown field is passed
 */
export async function updatePayment(
  id: string,
  updates: UpdatePaymentInput,
): Promise<{ ok: true }> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.rpc('update_payment', {
    p_payment_id: id,
    p_updates:    updates,
  });
  if (error) normalizePaymentRpcError(error);
  return data as { ok: true };
}

/**
 * Call delete_payment(p_payment_id uuid, p_reason text).
 * Soft-deletes a payment record.
 *
 * @throws PlatformAdminRequiredError  when caller is not a platform admin
 * @throws PaymentNotFoundError        when payment_id does not exist
 * @throws ReasonRequiredError         when reason is empty
 */
export async function deletePayment(
  id: string,
  reason: string,
): Promise<{ ok: true }> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.rpc('delete_payment', {
    p_payment_id: id,
    p_reason:     reason,
  });
  if (error) normalizePaymentRpcError(error);
  return data as { ok: true };
}

/**
 * Call list_payments(p_filters jsonb).
 * Returns paginated payment rows.
 *
 * @throws PlatformAdminRequiredError  when caller is not a platform admin
 * @throws InvalidFilterError          when an unknown filter key is supplied
 */
export async function listPayments(
  filters: PaymentsListFilters = {},
): Promise<PaymentRow[]> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.rpc('list_payments', {
    p_filters: filters,
  });
  if (error) normalizePaymentRpcError(error);
  return (data ?? []) as PaymentRow[];
}

/**
 * Call get_revenue_stats(p_filters jsonb).
 * Returns aggregated revenue statistics.
 *
 * @throws PlatformAdminRequiredError  when caller is not a platform admin
 * @throws InvalidGroupByError         when an invalid group_by value is passed
 * @throws InvalidFilterError          when an unknown filter key is supplied
 */
export async function getRevenueStats(
  filters: RevenueStatsFilters = {},
): Promise<RevenueStats> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.rpc('get_revenue_stats', {
    p_filters: filters,
  });
  if (error) normalizePaymentRpcError(error);
  return data as RevenueStats;
}

/**
 * Fetch coverage status for a single tenant from v_tenant_payment_coverage.
 * Returns null when the view row is missing or on any error (silent fallback).
 */
export async function getTenantCoverage(
  tenantId: string,
): Promise<import('./adminTypes').CoverageStatus | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('v_tenant_payment_coverage')
      .select('coverage_status')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { coverage_status: import('./adminTypes').CoverageStatus }).coverage_status ?? null;
  } catch {
    return null;
  }
}

/**
 * Generate a signed URL for a payment proof object.
 * Wraps `supabase.storage.from('payment-proofs').createSignedUrl()` — no SQL RPC.
 * URL expires in 3600 seconds (1 hour).
 *
 * @throws StorageAccessDeniedError  when RLS rejects the request (403)
 */
export async function generatePaymentProofSignedUrl(
  objectKey: string,
): Promise<string> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.storage
    .from('payment-proofs')
    .createSignedUrl(objectKey, 3600);
  if (error) {
    // Storage errors don't carry SQLSTATE — check HTTP status marker
    const statusCode =
      (error as unknown as { status?: number; statusCode?: string }).status ??
      (error as unknown as { status?: number; statusCode?: string }).statusCode;
    if (statusCode === 403 || statusCode === '403') {
      throw new StorageAccessDeniedError(error.message);
    }
    throw new StorageAccessDeniedError(error.message);
  }
  if (!data?.signedUrl) {
    throw new StorageAccessDeniedError('No signed URL returned');
  }
  return data.signedUrl;
}

/**
 * Upload a payment proof file to the `payment-proofs` bucket.
 *
 * Validates BEFORE uploading:
 *   - File size ≤ 5 MB → PaymentFileTooLargeError
 *   - MIME type must be image/jpeg, image/png, or application/pdf → PaymentFileWrongTypeError
 *
 * Object key: `tenants/<tenantId>/YYYY-MM-<uuid>.<ext>`
 * Path prefix uses tenant UUID (not slug) — consistent with chat-media and migration 301
 * tenant-scoped RLS policy (payment_proofs_read_own_tenant / payment_proofs_insert_own_tenant).
 * Returns the object key for use in RecordPaymentInput.proof_object_key.
 *
 * @param tenantId  - Tenant UUID (tenant.tenant_id from TenantRow)
 * @param file      - Proof file to upload
 *
 * @throws PaymentFileTooLargeError    when file.size > 5MB
 * @throws PaymentFileWrongTypeError   when file.type is not JPG/PNG/PDF
 */
export async function uploadPaymentProof(
  tenantId: string,
  file: File,
): Promise<{ objectKey: string }> {
  if (!supabase) throw new Error('Supabase client not configured');

  // Client-side validation — must happen before network call
  if (file.size > MAX_PROOF_SIZE_BYTES) {
    throw new PaymentFileTooLargeError(
      `File size ${file.size} exceeds maximum ${MAX_PROOF_SIZE_BYTES}`,
    );
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new PaymentFileWrongTypeError(
      `File type ${file.type} is not allowed`,
    );
  }

  // Build object key: tenants/{tenant_id}/YYYY-MM-<uuid>.<ext>
  // UUID path enforces payment_proofs_insert_own_tenant RLS (migration 301).
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const uuid = crypto.randomUUID();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
  const objectKey = `tenants/${tenantId}/${monthPrefix}-${uuid}.${ext}`;

  const { error } = await supabase.storage
    .from('payment-proofs')
    .upload(objectKey, file, { cacheControl: '3600', upsert: false });

  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  return { objectKey };
}
