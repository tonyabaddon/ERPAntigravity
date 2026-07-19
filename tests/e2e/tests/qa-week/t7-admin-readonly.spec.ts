/**
 * T7 — Admin platform (read-only, uses adminPage fixture)
 * Verifies platform admin dashboard, revenue, audit log, cost dashboard render.
 *
 * Scenarios covered:
 *   F1 positive — admin dashboard loads
 *   F10 permission — admin sees platform-wide data (not tenant-scoped)
 *   F11 multi-tenant — admin can view any tenant via impersonation grant
 */

import { test, expect } from '../../fixtures/auth';

test.describe('T7 — Admin dashboard', () => {
  test('F1 — /admin dashboard loads', async ({ adminPage }) => {
    // TODO(qa-week): expand
    // - Assert URL contains /admin
    // - Assert KPI cards visible (Revenue, Tenants, Attention Queue)
    // - Assert no console errors
  });

  test('F1 — /admin/tenants list loads with 3 real tenants', async ({ adminPage }) => {
    // TODO(qa-week): expand
    // - Navigate to /admin/tenants
    // - Assert Garindo Jaya Panel, Toko Jaya Makmur, Warung Sinar Rezeki visible
  });

  test('F1 — /admin/revenue loads charts', async ({ adminPage }) => {
    // TODO(qa-week): expand
  });

  test('F1 — /admin/audit-log loads recent entries', async ({ adminPage }) => {
    // TODO(qa-week): expand
    // - Assert audit_row_change triggers show recent activity
  });

  test('F10 — impersonation banner appears when admin views a tenant', async ({ adminPage }) => {
    // TODO(qa-week): expand
    // - Grant impersonation to tenant (via UI or SECDEF)
    // - Navigate to tenant view
    // - Assert TenantImpersonationBanner visible with "impersonating" text
    // - Assert audit_log entry created for impersonation session
  });
});
