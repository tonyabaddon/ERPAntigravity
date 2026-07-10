// src/lib/postLoginRoute.test.ts
import { describe, it, expect } from 'vitest';
import { computePostLoginRoute } from './postLoginRoute';

describe('computePostLoginRoute — platform admin', () => {
  it('honors /t/<slug>/* deep-link (App shows impersonation gate)', () => {
    expect(
      computePostLoginRoute({
        pathname: '/t/garindo/dashboard',
        isPlatformAdmin: true,
        tenantSlug: null,
      }),
    ).toEqual({ action: 'stay' });
  });

  it('honors /admin/* deep-link', () => {
    expect(
      computePostLoginRoute({
        pathname: '/admin/tenants',
        isPlatformAdmin: true,
        tenantSlug: null,
      }),
    ).toEqual({ action: 'stay' });
  });

  it('honors /admin exact', () => {
    expect(
      computePostLoginRoute({
        pathname: '/admin',
        isPlatformAdmin: true,
        tenantSlug: null,
      }),
    ).toEqual({ action: 'stay' });
  });

  it('redirects to /admin when no deep-link', () => {
    expect(
      computePostLoginRoute({
        pathname: '/',
        isPlatformAdmin: true,
        tenantSlug: null,
      }),
    ).toEqual({ action: 'redirect', href: '/admin' });
  });

  it('redirects to /admin from /login', () => {
    expect(
      computePostLoginRoute({
        pathname: '/login',
        isPlatformAdmin: true,
        tenantSlug: null,
      }),
    ).toEqual({ action: 'redirect', href: '/admin' });
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
