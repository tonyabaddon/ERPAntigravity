import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  recordPayment,
  updatePayment,
  deletePayment,
  listPayments,
  getRevenueStats,
  generatePaymentProofSignedUrl,
  uploadPaymentProof,
} from './paymentsApi';
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

// ─── Mock supabaseClient ──────────────────────────────────────────────────────
// Use vi.hoisted so the mock factory runs before module-level imports resolve.
const { mockRpc, mockCreateSignedUrl, mockUpload } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockCreateSignedUrl: vi.fn(),
  mockUpload: vi.fn(),
}));

vi.mock('./supabaseClient', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    storage: {
      from: (_bucket: string) => ({
        createSignedUrl: (...args: unknown[]) => mockCreateSignedUrl(...args),
        upload: (...args: unknown[]) => mockUpload(...args),
      }),
    },
  },
  isSupabaseConfigured: true,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const PAYMENT_ID = 'cccccccc-0000-0000-0000-cccccccccccc';

const recordPaymentInput = {
  tenant_id: TENANT_ID,
  amount: 500_000,
  payment_method: 'BANK_TRANSFER' as const,
  payment_date: '2026-07-05',
  period_from: '2026-07-01',
  period_to: '2026-07-31',
  bank_name: 'BCA' as const,
};

const recordPaymentResult = {
  ok: true as const,
  payment_id: PAYMENT_ID,
  amount_paid_ytd: 500_000,
  coverage_ok: false,
  coverage_status: 'OVERDUE' as const,
};

const paymentRow = {
  id: PAYMENT_ID,
  tenant_id: TENANT_ID,
  amount: 500_000,
  currency: 'IDR' as const,
  payment_method: 'BANK_TRANSFER' as const,
  bank_name: 'BCA' as const,
  ewallet_provider: null,
  payment_date: '2026-07-05',
  period_from: '2026-07-01',
  period_to: '2026-07-31',
  proof_url: null,
  bank_reference: null,
  notes: null,
  recorded_by_admin: 'admin@vosi.app',
  created_at: '2026-07-05T10:00:00+00:00',
};

const revenueStatsFixture = {
  total: 1_500_000,
  breakdown: [
    { key: 'STARTER', amount: 500_000, count: 1 },
    { key: 'PRO', amount: 1_000_000, count: 2 },
  ],
  monthly_trend: Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    total: i === 6 ? 1_500_000 : 0,
  })),
};

// ─── Tests: recordPayment ─────────────────────────────────────────────────────

describe('recordPayment', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('happy path — returns RecordPaymentResult', async () => {
    mockRpc.mockResolvedValue({ data: recordPaymentResult, error: null });
    const result = await recordPayment(recordPaymentInput);
    expect(mockRpc).toHaveBeenCalledWith('record_payment', {
      p_payload: recordPaymentInput,
    });
    expect(result.ok).toBe(true);
    expect(result.payment_id).toBe(PAYMENT_ID);
    expect(result.coverage_status).toBe('OVERDUE');
    expect(result.amount_paid_ytd).toBe(500_000);
  });

  it('throws PlatformAdminRequiredError on P0403', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0403', message: 'PLATFORM_ADMIN_REQUIRED' } });
    await expect(recordPayment(recordPaymentInput)).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });

  it('throws TenantNotFoundError on P0404 TENANT_NOT_FOUND', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0404', message: 'TENANT_NOT_FOUND' } });
    await expect(recordPayment(recordPaymentInput)).rejects.toBeInstanceOf(TenantNotFoundError);
  });

  it('throws InvalidAmountError on 22023 INVALID_AMOUNT', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'INVALID_AMOUNT' } });
    await expect(recordPayment({ ...recordPaymentInput, amount: 0 })).rejects.toBeInstanceOf(InvalidAmountError);
  });

  it('InvalidAmountError carries Bahasa Indonesia userMessage', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'INVALID_AMOUNT' } });
    try {
      await recordPayment({ ...recordPaymentInput, amount: -1 });
    } catch (err) {
      expect((err as InvalidAmountError).userMessage).toContain('Nominal pembayaran');
    }
  });

  it('throws InvalidPeriodError on 22023 INVALID_PERIOD', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'INVALID_PERIOD' } });
    await expect(recordPayment(recordPaymentInput)).rejects.toBeInstanceOf(InvalidPeriodError);
  });

  it('throws MethodMismatchError on 23514', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'check_bank_required' } });
    await expect(recordPayment(recordPaymentInput)).rejects.toBeInstanceOf(MethodMismatchError);
  });

  it('MethodMismatchError carries Bahasa Indonesia userMessage', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'check_bank_required' } });
    try {
      await recordPayment(recordPaymentInput);
    } catch (err) {
      expect((err as MethodMismatchError).userMessage).toContain('bank atau e-wallet');
    }
  });

  it('throws InvalidFilterError on 22023 UNKNOWN_FIELD', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'UNKNOWN_FIELD' } });
    await expect(recordPayment(recordPaymentInput)).rejects.toBeInstanceOf(InvalidFilterError);
  });
});

// ─── Tests: updatePayment ─────────────────────────────────────────────────────

describe('updatePayment', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('happy path — returns {ok: true}', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    const result = await updatePayment(PAYMENT_ID, { amount: 600_000 });
    expect(mockRpc).toHaveBeenCalledWith('update_payment', {
      p_payment_id: PAYMENT_ID,
      p_updates:    { amount: 600_000 },
    });
    expect(result.ok).toBe(true);
  });

  it('throws PaymentNotFoundError on P0404 PAYMENT_NOT_FOUND', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0404', message: 'PAYMENT_NOT_FOUND' } });
    await expect(updatePayment(PAYMENT_ID, {})).rejects.toBeInstanceOf(PaymentNotFoundError);
  });

  it('PaymentNotFoundError carries Bahasa Indonesia userMessage', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0404', message: 'PAYMENT_NOT_FOUND' } });
    try {
      await updatePayment(PAYMENT_ID, {});
    } catch (err) {
      expect((err as PaymentNotFoundError).userMessage).toContain('tidak ditemukan');
    }
  });

  it('throws PlatformAdminRequiredError on P0403', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0403', message: 'PLATFORM_ADMIN_REQUIRED' } });
    await expect(updatePayment(PAYMENT_ID, {})).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });

  it('throws InvalidFilterError on 22023 UNKNOWN_FIELD', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'UNKNOWN_FIELD' } });
    await expect(updatePayment(PAYMENT_ID, {})).rejects.toBeInstanceOf(InvalidFilterError);
  });
});

// ─── Tests: deletePayment ─────────────────────────────────────────────────────

describe('deletePayment', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('happy path — returns {ok: true}', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    const result = await deletePayment(PAYMENT_ID, 'Duplicate entry');
    expect(mockRpc).toHaveBeenCalledWith('delete_payment', {
      p_payment_id: PAYMENT_ID,
      p_reason:     'Duplicate entry',
    });
    expect(result.ok).toBe(true);
  });

  it('throws PaymentNotFoundError on P0404 PAYMENT_NOT_FOUND', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0404', message: 'PAYMENT_NOT_FOUND' } });
    await expect(deletePayment(PAYMENT_ID, 'reason')).rejects.toBeInstanceOf(PaymentNotFoundError);
  });

  it('throws ReasonRequiredError on 22023 REASON_REQUIRED', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'REASON_REQUIRED' } });
    await expect(deletePayment(PAYMENT_ID, '')).rejects.toBeInstanceOf(ReasonRequiredError);
  });

  it('ReasonRequiredError carries Bahasa Indonesia userMessage', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'REASON_REQUIRED' } });
    try {
      await deletePayment(PAYMENT_ID, '');
    } catch (err) {
      expect((err as ReasonRequiredError).userMessage).toContain('wajib diisi');
    }
  });

  it('throws PlatformAdminRequiredError on P0403', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0403', message: 'PLATFORM_ADMIN_REQUIRED' } });
    await expect(deletePayment(PAYMENT_ID, 'reason')).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });
});

// ─── Tests: listPayments ──────────────────────────────────────────────────────

describe('listPayments', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('happy path — returns typed rows', async () => {
    mockRpc.mockResolvedValue({ data: [paymentRow], error: null });
    const rows = await listPayments();
    expect(mockRpc).toHaveBeenCalledWith('list_payments', { p_filters: {} });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(PAYMENT_ID);
    expect(rows[0].currency).toBe('IDR');
  });

  it('serializes filters correctly', async () => {
    mockRpc.mockResolvedValue({ data: [paymentRow], error: null });
    await listPayments({ tenant_id: TENANT_ID, payment_method: 'BANK_TRANSFER', page: 2, page_size: 10 });
    expect(mockRpc).toHaveBeenCalledWith('list_payments', {
      p_filters: { tenant_id: TENANT_ID, payment_method: 'BANK_TRANSFER', page: 2, page_size: 10 },
    });
  });

  it('returns empty array when data is null', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const rows = await listPayments();
    expect(rows).toEqual([]);
  });

  it('throws PlatformAdminRequiredError on P0403', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0403', message: 'PLATFORM_ADMIN_REQUIRED' } });
    await expect(listPayments()).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });

  it('throws InvalidFilterError on 22023 UNKNOWN_FIELD', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'UNKNOWN_FIELD' } });
    await expect(listPayments()).rejects.toBeInstanceOf(InvalidFilterError);
  });
});

// ─── Tests: getRevenueStats ───────────────────────────────────────────────────

describe('getRevenueStats', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('happy path — returns RevenueStats', async () => {
    mockRpc.mockResolvedValue({ data: revenueStatsFixture, error: null });
    const stats = await getRevenueStats();
    expect(mockRpc).toHaveBeenCalledWith('get_revenue_stats', { p_filters: {} });
    expect(stats.total).toBe(1_500_000);
    expect(stats.breakdown).toHaveLength(2);
    expect(stats.monthly_trend).toHaveLength(12);
  });

  it('serializes filters correctly', async () => {
    mockRpc.mockResolvedValue({ data: revenueStatsFixture, error: null });
    await getRevenueStats({ from_date: '2026-01-01', to_date: '2026-12-31', group_by: 'month' });
    expect(mockRpc).toHaveBeenCalledWith('get_revenue_stats', {
      p_filters: { from_date: '2026-01-01', to_date: '2026-12-31', group_by: 'month' },
    });
  });

  it('throws PlatformAdminRequiredError on P0403', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0403', message: 'PLATFORM_ADMIN_REQUIRED' } });
    await expect(getRevenueStats()).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });

  it('throws InvalidGroupByError on 22023 INVALID_GROUP_BY', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'INVALID_GROUP_BY' } });
    await expect(getRevenueStats()).rejects.toBeInstanceOf(InvalidGroupByError);
  });

  it('InvalidGroupByError carries Bahasa Indonesia userMessage', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'INVALID_GROUP_BY' } });
    try {
      await getRevenueStats();
    } catch (err) {
      expect((err as InvalidGroupByError).userMessage).toContain('tidak valid');
    }
  });

  it('throws InvalidFilterError on 22023 UNKNOWN_FIELD', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'UNKNOWN_FIELD' } });
    await expect(getRevenueStats()).rejects.toBeInstanceOf(InvalidFilterError);
  });
});

// ─── Tests: generatePaymentProofSignedUrl ─────────────────────────────────────

describe('generatePaymentProofSignedUrl', () => {
  beforeEach(() => { mockCreateSignedUrl.mockReset(); });

  it('happy path — returns signedUrl string', async () => {
    const url = 'https://storage.example.com/payment-proofs/garindo/2026-07-abc.pdf?token=xyz';
    mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: url }, error: null });
    const result = await generatePaymentProofSignedUrl('garindo/2026-07-abc.pdf');
    expect(mockCreateSignedUrl).toHaveBeenCalledWith('garindo/2026-07-abc.pdf', 3600);
    expect(result).toBe(url);
  });

  it('throws StorageAccessDeniedError on Storage 403 error', async () => {
    mockCreateSignedUrl.mockResolvedValue({
      data: null,
      error: { message: 'Access denied', statusCode: '403' },
    });
    await expect(generatePaymentProofSignedUrl('garindo/secret.pdf')).rejects.toBeInstanceOf(StorageAccessDeniedError);
  });

  it('StorageAccessDeniedError carries Bahasa Indonesia userMessage', async () => {
    mockCreateSignedUrl.mockResolvedValue({
      data: null,
      error: { message: 'Access denied', statusCode: '403' },
    });
    try {
      await generatePaymentProofSignedUrl('garindo/secret.pdf');
    } catch (err) {
      expect((err as StorageAccessDeniedError).userMessage).toContain('tidak berhak');
    }
  });

  it('throws StorageAccessDeniedError when no signedUrl returned', async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: null, error: null });
    await expect(generatePaymentProofSignedUrl('garindo/empty.pdf')).rejects.toBeInstanceOf(StorageAccessDeniedError);
  });
});

// ─── Tests: uploadPaymentProof ────────────────────────────────────────────────

const makeFile = (name: string, size: number, type: string): File => {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
};

// Migration 301: uploadPaymentProof now takes tenantId (UUID) instead of tenantSlug,
// and produces paths like tenants/{uuid}/YYYY-MM-{uuid}.{ext}
const TEST_TENANT_UUID = '11111111-1111-1111-1111-111111111111';

describe('uploadPaymentProof', () => {
  beforeEach(() => { mockUpload.mockReset(); });

  it('happy path — returns objectKey with correct path shape (tenants/{uuid}/...)', async () => {
    mockUpload.mockResolvedValue({ data: { path: `tenants/${TEST_TENANT_UUID}/2026-07-uuid.pdf` }, error: null });
    const file = makeFile('proof.pdf', 100, 'application/pdf');
    const result = await uploadPaymentProof(TEST_TENANT_UUID, file);
    // Path must be: tenants/{tenant_uuid}/YYYY-MM-{uuid}.{ext}
    expect(result.objectKey).toMatch(
      /^tenants\/[0-9a-f-]{36}\/\d{4}-\d{2}-[0-9a-f-]{36}\.pdf$/
    );
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('happy path — jpg file accepted', async () => {
    mockUpload.mockResolvedValue({ data: { path: `tenants/${TEST_TENANT_UUID}/2026-07-uuid.jpg` }, error: null });
    const file = makeFile('proof.jpg', 100, 'image/jpeg');
    const result = await uploadPaymentProof(TEST_TENANT_UUID, file);
    expect(result.objectKey).toMatch(/\.jpg$/);
  });

  it('happy path — png file accepted', async () => {
    mockUpload.mockResolvedValue({ data: { path: `tenants/${TEST_TENANT_UUID}/2026-07-uuid.png` }, error: null });
    const file = makeFile('proof.png', 100, 'image/png');
    const result = await uploadPaymentProof(TEST_TENANT_UUID, file);
    expect(result.objectKey).toMatch(/\.png$/);
  });

  it('throws PaymentFileTooLargeError BEFORE upload when file exceeds 5MB', async () => {
    const bigFile = makeFile('big.pdf', 5 * 1024 * 1024 + 1, 'application/pdf');
    await expect(uploadPaymentProof(TEST_TENANT_UUID, bigFile)).rejects.toBeInstanceOf(PaymentFileTooLargeError);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('PaymentFileTooLargeError carries Bahasa Indonesia userMessage', async () => {
    const bigFile = makeFile('big.pdf', 6 * 1024 * 1024, 'application/pdf');
    try {
      await uploadPaymentProof(TEST_TENANT_UUID, bigFile);
    } catch (err) {
      expect((err as PaymentFileTooLargeError).userMessage).toContain('5 MB');
    }
  });

  it('throws PaymentFileWrongTypeError BEFORE upload for disallowed mime type', async () => {
    const wrongFile = makeFile('proof.gif', 100, 'image/gif');
    await expect(uploadPaymentProof(TEST_TENANT_UUID, wrongFile)).rejects.toBeInstanceOf(PaymentFileWrongTypeError);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('PaymentFileWrongTypeError carries Bahasa Indonesia userMessage', async () => {
    const wrongFile = makeFile('proof.svg', 100, 'image/svg+xml');
    try {
      await uploadPaymentProof(TEST_TENANT_UUID, wrongFile);
    } catch (err) {
      expect((err as PaymentFileWrongTypeError).userMessage).toContain('JPG, PNG, atau PDF');
    }
  });

  it('throws PaymentFileWrongTypeError for mp4 (video not allowed)', async () => {
    const videoFile = makeFile('receipt.mp4', 100, 'video/mp4');
    await expect(uploadPaymentProof(TEST_TENANT_UUID, videoFile)).rejects.toBeInstanceOf(PaymentFileWrongTypeError);
  });

  it('throws generic Error when storage upload fails', async () => {
    mockUpload.mockResolvedValue({ data: null, error: { message: 'Bucket not found' } });
    const file = makeFile('proof.pdf', 100, 'application/pdf');
    await expect(uploadPaymentProof(TEST_TENANT_UUID, file)).rejects.toThrow('Upload failed');
  });
});
