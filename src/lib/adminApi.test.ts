import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listTenantsAdmin,
  listAuditEvents,
  getPlatformDashboardStats,
  renewSubscription,
  suspendTenant,
  activateTenant,
  updatePlan,
  listAttentionTenants,
} from './adminApi';
import {
  PlatformAdminRequiredError,
  InvalidFilterError,
  TenantNotFoundError,
  InvalidRenewalDateError,
  InvalidPlanCodeError,
  SuperAdminRequiredError,
  CannotActivateArchivedError,
} from './adminTypes';

// ─── Mock supabaseClient ──────────────────────────────────────────────────────
// Use vi.hoisted so the mock factory runs before module-level imports resolve.
const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock('./supabaseClient', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
  isSupabaseConfigured: true,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const garindoTenantRow = {
  tenant_id: 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa',
  slug: 'garindo',
  name: 'Garindo',
  plan_code: 'PREMIUM',
  status: 'ACTIVE',
  expiry_mode: 'ACTIVE',
  activated_at: '2024-01-01',
  expires_at: '2099-12-31',
  days_until_expiry: 26842,
  user_count: 3,
  sku_count: 474,
  industry: 'Retail/Toko umum',
  employee_range: '4-19 orang (Kecil)',
  onboarded_at: '2024-01-01T00:00:00+00:00',
  last_login_at: '2026-07-03T08:01:00+00:00',
  txn_7d: 0,
  avg_daily_txn: 0,
  usage_status: 'IDLE',
  total_count: 1,
};

const auditEventRow = {
  id: 1001,                              // number — BIGINT
  ts: '2026-07-04T12:00:00+00:00',
  admin_email: 'admin@vosi.app',
  tenant_slug: 'garindo',
  action_code: 'SUSPEND_TENANT',        // action_code — not action
  detail: { reason: 'test' },
};

const dashboardStatsFixture = {
  tenants_total: 1,
  active_count: 1,
  suspended_count: 0,
  expiring_45d: 0,
  plans_count: 3,
  pending_imports: 0,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('listTenantsAdmin', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('happy path — returns typed rows', async () => {
    mockRpc.mockResolvedValue({ data: [garindoTenantRow], error: null });
    const rows = await listTenantsAdmin();
    expect(mockRpc).toHaveBeenCalledWith('list_tenants_admin', { p_filters: {} });
    expect(rows).toHaveLength(1);
    expect(rows[0].slug).toBe('garindo');
    expect(rows[0].usage_status).toBe('IDLE');
    expect(rows[0].total_count).toBe(1);
  });

  it('serializes filters correctly', async () => {
    mockRpc.mockResolvedValue({ data: [garindoTenantRow], error: null });
    await listTenantsAdmin({ search: 'garindo', plan_code: 'PREMIUM', page: 1, page_size: 25 });
    expect(mockRpc).toHaveBeenCalledWith('list_tenants_admin', {
      p_filters: { search: 'garindo', plan_code: 'PREMIUM', page: 1, page_size: 25 },
    });
  });

  it('returns empty array when data is null', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const rows = await listTenantsAdmin();
    expect(rows).toEqual([]);
  });

  it('throws PlatformAdminRequiredError on P0403', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0403', message: 'PLATFORM_ADMIN_REQUIRED' },
    });
    await expect(listTenantsAdmin()).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });

  it('PlatformAdminRequiredError carries Bahasa Indonesia userMessage', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0403', message: 'PLATFORM_ADMIN_REQUIRED' },
    });
    try {
      await listTenantsAdmin();
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformAdminRequiredError);
      expect((err as PlatformAdminRequiredError).userMessage).toContain('Akses ditolak');
    }
  });

  it('throws InvalidFilterError on 22023', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'Unknown filter key(s): foo' },
    });
    await expect(listTenantsAdmin()).rejects.toBeInstanceOf(InvalidFilterError);
  });

  it('InvalidFilterError carries Bahasa Indonesia userMessage', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'Unknown filter key(s): foo' },
    });
    try {
      await listTenantsAdmin();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidFilterError);
      expect((err as InvalidFilterError).userMessage).toContain('Filter tidak valid');
    }
  });
});

describe('listAuditEvents', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('happy path — returns typed rows with numeric id', async () => {
    mockRpc.mockResolvedValue({ data: [auditEventRow], error: null });
    const rows = await listAuditEvents();
    expect(mockRpc).toHaveBeenCalledWith('list_audit_events', { p_filters: {} });
    expect(rows).toHaveLength(1);
    expect(typeof rows[0].id).toBe('number');    // BIGINT → number
    expect(rows[0].id).toBe(1001);
    expect(rows[0].action_code).toBe('SUSPEND_TENANT');
  });

  it('serializes filters correctly', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await listAuditEvents({ tenant_id: 'abc', action_code: 'SUSPEND_TENANT', page: 2 });
    expect(mockRpc).toHaveBeenCalledWith('list_audit_events', {
      p_filters: { tenant_id: 'abc', action_code: 'SUSPEND_TENANT', page: 2 },
    });
  });

  it('returns empty array by default', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const rows = await listAuditEvents();
    expect(rows).toEqual([]);
  });

  it('throws PlatformAdminRequiredError on P0403', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0403', message: 'PLATFORM_ADMIN_REQUIRED' },
    });
    await expect(listAuditEvents()).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });

  it('throws InvalidFilterError on 22023', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'Unknown filter key(s): bad_key' },
    });
    await expect(listAuditEvents()).rejects.toBeInstanceOf(InvalidFilterError);
  });
});

describe('getPlatformDashboardStats', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('happy path — returns typed stats', async () => {
    mockRpc.mockResolvedValue({ data: dashboardStatsFixture, error: null });
    const stats = await getPlatformDashboardStats();
    expect(mockRpc).toHaveBeenCalledWith('_get_platform_dashboard_stats');
    expect(stats.tenants_total).toBe(1);
    expect(stats.active_count).toBe(1);
    expect(stats.suspended_count).toBe(0);
    expect(stats.expiring_45d).toBe(0);
    expect(stats.plans_count).toBe(3);
    expect(stats.pending_imports).toBe(0);
  });

  it('throws PlatformAdminRequiredError on P0403', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0403', message: 'PLATFORM_ADMIN_REQUIRED' },
    });
    await expect(getPlatformDashboardStats()).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });
});

// ─── Wave 4a tests ────────────────────────────────────────────────────────────

const TENANT_ID = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';

describe('renewSubscription', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('happy path — returns RenewSubscriptionResult', async () => {
    const result = {
      ok: true,
      tenant_id: TENANT_ID,
      new_expires_at: '2027-12-31',
      new_grace_expires_at: '2028-01-07',
      plan_code: 'PREMIUM',
    };
    mockRpc.mockResolvedValue({ data: result, error: null });
    const res = await renewSubscription({
      tenant_id: TENANT_ID,
      new_expires_at: '2027-12-31',
      new_plan_code: 'PREMIUM',
      notes: 'Renewed via admin panel',
    });
    expect(mockRpc).toHaveBeenCalledWith('renew_subscription', {
      p_tenant_id: TENANT_ID,
      p_new_expires_at: '2027-12-31',
      p_new_plan_code: 'PREMIUM',
      p_notes: 'Renewed via admin panel',
    });
    expect(res.ok).toBe(true);
    expect(res.new_expires_at).toBe('2027-12-31');
    expect(res.plan_code).toBe('PREMIUM');
  });

  it('coerces undefined optional params to null', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, tenant_id: TENANT_ID, new_expires_at: '2027-01-01', new_grace_expires_at: '2027-01-08', plan_code: 'STARTER' },
      error: null,
    });
    await renewSubscription({ tenant_id: TENANT_ID, new_expires_at: '2027-01-01' });
    expect(mockRpc).toHaveBeenCalledWith('renew_subscription', expect.objectContaining({
      p_new_plan_code: null,
      p_notes: null,
    }));
  });

  it('throws TenantNotFoundError on P0404', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0404', message: 'TENANT_NOT_FOUND' } });
    await expect(renewSubscription({ tenant_id: TENANT_ID, new_expires_at: '2027-01-01' }))
      .rejects.toBeInstanceOf(TenantNotFoundError);
  });

  it('TenantNotFoundError carries Bahasa Indonesia userMessage', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0404', message: 'TENANT_NOT_FOUND' } });
    try {
      await renewSubscription({ tenant_id: TENANT_ID, new_expires_at: '2027-01-01' });
    } catch (err) {
      expect((err as TenantNotFoundError).userMessage).toContain('Tenant tidak ditemukan');
    }
  });

  it('throws InvalidRenewalDateError on 22023 INVALID_EXPIRES_AT', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'INVALID_EXPIRES_AT' } });
    await expect(renewSubscription({ tenant_id: TENANT_ID, new_expires_at: '2020-01-01' }))
      .rejects.toBeInstanceOf(InvalidRenewalDateError);
  });

  it('InvalidRenewalDateError carries Bahasa Indonesia userMessage', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'INVALID_EXPIRES_AT' } });
    try {
      await renewSubscription({ tenant_id: TENANT_ID, new_expires_at: '2020-01-01' });
    } catch (err) {
      expect((err as InvalidRenewalDateError).userMessage).toContain('Tanggal perpanjangan');
    }
  });

  it('throws InvalidPlanCodeError on 22023 INVALID_PLAN_CODE', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'INVALID_PLAN_CODE' } });
    await expect(renewSubscription({ tenant_id: TENANT_ID, new_expires_at: '2027-01-01', new_plan_code: 'STARTER' }))
      .rejects.toBeInstanceOf(InvalidPlanCodeError);
  });

  it('throws PlatformAdminRequiredError on P0403', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0403', message: 'PLATFORM_ADMIN_REQUIRED' } });
    await expect(renewSubscription({ tenant_id: TENANT_ID, new_expires_at: '2027-01-01' }))
      .rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });
});

describe('suspendTenant', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('happy path — returns suspended_at + reason', async () => {
    const result = { ok: true, tenant_id: TENANT_ID, suspended_at: '2026-07-05T10:00:00+00:00', reason: 'Non-payment' };
    mockRpc.mockResolvedValue({ data: result, error: null });
    const res = await suspendTenant(TENANT_ID, 'Non-payment');
    expect(mockRpc).toHaveBeenCalledWith('suspend_tenant', { p_tenant_id: TENANT_ID, p_reason: 'Non-payment' });
    expect(res.ok).toBe(true);
    expect(res.reason).toBe('Non-payment');
  });

  it('throws TenantNotFoundError on P0404', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0404', message: 'TENANT_NOT_FOUND' } });
    await expect(suspendTenant(TENANT_ID, 'reason')).rejects.toBeInstanceOf(TenantNotFoundError);
  });

  it('throws PlatformAdminRequiredError on P0403', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0403', message: 'PLATFORM_ADMIN_REQUIRED' } });
    await expect(suspendTenant(TENANT_ID, 'reason')).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });

  it('throws InvalidFilterError on 22023 INVALID_REASON (falls through to generic 22023)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'INVALID_REASON' } });
    await expect(suspendTenant(TENANT_ID, '')).rejects.toBeInstanceOf(InvalidFilterError);
  });
});

describe('activateTenant', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('happy path — returns {ok, status: ACTIVE}', async () => {
    const result = { ok: true, tenant_id: TENANT_ID, status: 'ACTIVE' };
    mockRpc.mockResolvedValue({ data: result, error: null });
    const res = await activateTenant(TENANT_ID);
    expect(mockRpc).toHaveBeenCalledWith('activate_tenant', { p_tenant_id: TENANT_ID });
    expect(res.ok).toBe(true);
    expect(res.status).toBe('ACTIVE');
  });

  it('throws TenantNotFoundError on P0404', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0404', message: 'TENANT_NOT_FOUND' } });
    await expect(activateTenant(TENANT_ID)).rejects.toBeInstanceOf(TenantNotFoundError);
  });

  it('throws CannotActivateArchivedError on 22023 CANNOT_ACTIVATE_ARCHIVED', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'CANNOT_ACTIVATE_ARCHIVED' } });
    await expect(activateTenant(TENANT_ID)).rejects.toBeInstanceOf(CannotActivateArchivedError);
  });

  it('CannotActivateArchivedError carries Bahasa Indonesia userMessage', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'CANNOT_ACTIVATE_ARCHIVED' } });
    try {
      await activateTenant(TENANT_ID);
    } catch (err) {
      expect((err as CannotActivateArchivedError).userMessage).toContain('diarsipkan');
    }
  });

  it('throws PlatformAdminRequiredError on P0403', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0403', message: 'PLATFORM_ADMIN_REQUIRED' } });
    await expect(activateTenant(TENANT_ID)).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });
});

describe('updatePlan', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('happy path — returns ok + updated_keys', async () => {
    const result = { ok: true, plan_code: 'PRO', updated_keys: ['name', 'description'] };
    mockRpc.mockResolvedValue({ data: result, error: null });
    const res = await updatePlan('PRO', { name: 'Pro Plan', description: 'Updated desc' });
    expect(mockRpc).toHaveBeenCalledWith('update_plan_admin', {
      p_plan_code: 'PRO',
      p_updates: { name: 'Pro Plan', description: 'Updated desc' },
    });
    expect(res.ok).toBe(true);
    expect(res.updated_keys).toContain('name');
  });

  it('throws SuperAdminRequiredError on P0403 SUPER_ADMIN_REQUIRED', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0403', message: 'SUPER_ADMIN_REQUIRED' } });
    await expect(updatePlan('PRO', { name: 'x' })).rejects.toBeInstanceOf(SuperAdminRequiredError);
  });

  it('SuperAdminRequiredError carries Bahasa Indonesia userMessage', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0403', message: 'SUPER_ADMIN_REQUIRED' } });
    try {
      await updatePlan('PRO', { name: 'x' });
    } catch (err) {
      expect((err as SuperAdminRequiredError).userMessage).toContain('super admin');
    }
  });

  it('throws PlatformAdminRequiredError on P0403 PLATFORM_ADMIN_REQUIRED', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0403', message: 'PLATFORM_ADMIN_REQUIRED' } });
    await expect(updatePlan('PRO', { name: 'x' })).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });

  it('throws InvalidPlanCodeError on 22023 INVALID_PLAN_CODE', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'INVALID_PLAN_CODE' } });
    // planCode is typed but the RPC still validates server-side
    await expect(updatePlan('STARTER', {})).rejects.toBeInstanceOf(InvalidPlanCodeError);
  });

  it('throws InvalidFilterError on 22023 UNKNOWN_FIELD (falls through to generic 22023)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'UNKNOWN_FIELD' } });
    await expect(updatePlan('PRO', {})).rejects.toBeInstanceOf(InvalidFilterError);
  });
});

describe('listAttentionTenants', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  const attentionRows = [
    {
      tenant_id: TENANT_ID,
      slug: 'garindo',
      name: 'Garindo',
      plan_code: 'PREMIUM',
      status: 'SUSPENDED',
      expires_at: '2026-06-01',
      days_until_expiry: -34,
      attention_reason: 'EXPIRED_AND_SUSPENDED',
    },
  ];

  it('happy path — returns AttentionTenantRow[]', async () => {
    mockRpc.mockResolvedValue({ data: attentionRows, error: null });
    const rows = await listAttentionTenants();
    expect(mockRpc).toHaveBeenCalledWith('list_attention_tenants', { p_expiry_within_days: 45 });
    expect(rows).toHaveLength(1);
    expect(rows[0].attention_reason).toBe('EXPIRED_AND_SUSPENDED');
    expect(rows[0].days_until_expiry).toBe(-34);
  });

  it('passes custom withinDays', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await listAttentionTenants(30);
    expect(mockRpc).toHaveBeenCalledWith('list_attention_tenants', { p_expiry_within_days: 30 });
  });

  it('returns empty array when data is null', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const rows = await listAttentionTenants();
    expect(rows).toEqual([]);
  });

  it('throws PlatformAdminRequiredError on P0403', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0403', message: 'PLATFORM_ADMIN_REQUIRED' } });
    await expect(listAttentionTenants()).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });

  it('throws InvalidFilterError on 22023 INVALID_RANGE (falls through to generic 22023)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'INVALID_RANGE' } });
    await expect(listAttentionTenants(0)).rejects.toBeInstanceOf(InvalidFilterError);
  });
});
