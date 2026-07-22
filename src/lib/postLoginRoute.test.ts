// src/lib/postLoginRoute.test.ts
import { describe, it, expect } from 'vitest';
import { computePostLoginRoute } from './postLoginRoute';

describe('computePostLoginRoute — platform admin on admin.caleo.id', () => {
  it('honors /t/<slug>/* deep-link (App shows impersonation gate)', () => {
    expect(
      computePostLoginRoute({
        pathname: '/t/garindo/dashboard',
        isPlatformAdmin: true,
        tenantSlug: null,
        hostname: 'admin.caleo.id',
      }),
    ).toEqual({ action: 'stay' });
  });

  it('honors /admin/* deep-link', () => {
    expect(
      computePostLoginRoute({
        pathname: '/admin/tenants',
        isPlatformAdmin: true,
        tenantSlug: null,
        hostname: 'admin.caleo.id',
      }),
    ).toEqual({ action: 'stay' });
  });

  it('honors /admin exact', () => {
    expect(
      computePostLoginRoute({
        pathname: '/admin',
        isPlatformAdmin: true,
        tenantSlug: null,
        hostname: 'admin.caleo.id',
      }),
    ).toEqual({ action: 'stay' });
  });

  it('redirects to /admin when no deep-link', () => {
    expect(
      computePostLoginRoute({
        pathname: '/',
        isPlatformAdmin: true,
        tenantSlug: null,
        hostname: 'admin.caleo.id',
      }),
    ).toEqual({ action: 'redirect', href: '/admin' });
  });

  it('redirects to /admin from /login on staging.admin.caleo.id too', () => {
    expect(
      computePostLoginRoute({
        pathname: '/login',
        isPlatformAdmin: true,
        tenantSlug: null,
        hostname: 'staging.admin.caleo.id',
      }),
    ).toEqual({ action: 'redirect', href: '/admin' });
  });
});

describe('computePostLoginRoute — platform admin on app.caleo.id (tenant hostname)', () => {
  // Bug fix 2026-07-22: platform admin on app.caleo.id used to redirect to
  // /admin even though the user opened the tenant surface. Now defaults to
  // their tenant dashboard if they have one; else /select-tenant.
  it('redirects to /t/<slug>/dashboard when admin has a tenant slug', () => {
    expect(
      computePostLoginRoute({
        pathname: '/',
        isPlatformAdmin: true,
        tenantSlug: 'garindo',
        hostname: 'app.caleo.id',
      }),
    ).toEqual({ action: 'redirect', href: '/t/garindo/dashboard' });
  });

  it('redirects to /select-tenant when admin has no tenant slug', () => {
    expect(
      computePostLoginRoute({
        pathname: '/',
        isPlatformAdmin: true,
        tenantSlug: null,
        hostname: 'app.caleo.id',
      }),
    ).toEqual({ action: 'redirect', href: '/select-tenant' });
  });

  it('honors /admin/* deep-link even from app.caleo.id (rare, but explicit)', () => {
    expect(
      computePostLoginRoute({
        pathname: '/admin/tenants',
        isPlatformAdmin: true,
        tenantSlug: 'garindo',
        hostname: 'app.caleo.id',
      }),
    ).toEqual({ action: 'stay' });
  });

  it('honors /t/<slug>/* deep-link on app.caleo.id', () => {
    expect(
      computePostLoginRoute({
        pathname: '/t/tokojaya/piutang',
        isPlatformAdmin: true,
        tenantSlug: 'garindo',
        hostname: 'app.caleo.id',
      }),
    ).toEqual({ action: 'stay' });
  });

  it('treats localhost as tenant surface', () => {
    expect(
      computePostLoginRoute({
        pathname: '/',
        isPlatformAdmin: true,
        tenantSlug: 'garindo',
        hostname: 'localhost',
      }),
    ).toEqual({ action: 'redirect', href: '/t/garindo/dashboard' });
  });

  it('backward compat: no hostname defaults to tenant surface', () => {
    // Older callers (or tests) that omit hostname get the tenant-surface
    // behavior. This is safer than defaulting to admin because a missing
    // hostname is more likely to be a test/localhost than production admin.
    expect(
      computePostLoginRoute({
        pathname: '/',
        isPlatformAdmin: true,
        tenantSlug: 'garindo',
      }),
    ).toEqual({ action: 'redirect', href: '/t/garindo/dashboard' });
  });
});

describe('computePostLoginRoute — tenant user (non-admin)', () => {
  it('honors own /t/<slug>/* deep-link', () => {
    expect(
      computePostLoginRoute({
        pathname: '/t/mytenant/piutang',
        isPlatformAdmin: false,
        tenantSlug: 'mytenant',
      }),
    ).toEqual({ action: 'stay' });
  });

  it('stays on cross-tenant /t/<other>/* URL (App slug-guard will rewrite)', () => {
    expect(
      computePostLoginRoute({
        pathname: '/t/othertenant/dashboard',
        isPlatformAdmin: false,
        tenantSlug: 'mytenant',
      }),
    ).toEqual({ action: 'stay' });
  });

  it('redirects to /t/<slug>/dashboard when no deep-link', () => {
    expect(
      computePostLoginRoute({
        pathname: '/',
        isPlatformAdmin: false,
        tenantSlug: 'mytenant',
      }),
    ).toEqual({ action: 'redirect', href: '/t/mytenant/dashboard' });
  });

  it('redirects to /t/<slug>/dashboard even from /admin/* (non-admins cannot enter admin)', () => {
    expect(
      computePostLoginRoute({
        pathname: '/admin/tenants',
        isPlatformAdmin: false,
        tenantSlug: 'mytenant',
      }),
    ).toEqual({ action: 'redirect', href: '/t/mytenant/dashboard' });
  });

  it('redirects to /select-tenant when no tenant slug', () => {
    expect(
      computePostLoginRoute({
        pathname: '/',
        isPlatformAdmin: false,
        tenantSlug: null,
      }),
    ).toEqual({ action: 'redirect', href: '/select-tenant' });
  });
});
