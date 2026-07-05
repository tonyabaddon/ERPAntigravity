import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listTenantsAdmin,
  listAuditEvents,
  getPlatformDashboardStats,
} from './adminApi';
import { PlatformAdminRequiredError, InvalidFilterError } from './adminTypes';

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
