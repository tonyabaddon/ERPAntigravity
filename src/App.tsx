/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import * as Sentry from '@sentry/react';
import { captureError } from './lib/captureError';
import {
  Bot,
  Search,
  HelpCircle,
  UserCircle2,
  ShieldCheck,
  LogOut,
  Bell,
  Menu,
  Zap,
  Info,
  AlertTriangle
} from 'lucide-react';

import { ActivePage, StockItem, NotificationConfig, PermissionSet, ALL_PERMISSIONS, KasirChannel } from './types';
import { useURLRoute, navigate, replaceRoute, ACTIVE_PAGES, parseRoute } from './lib/urlRoute';
import { extractErrorMessage } from './lib/extractErrorMessage';
import { TenantProvider } from './contexts/TenantContext';
const AdminRoutes = React.lazy(() => import('./components/admin/AdminRoutes').then(m => ({ default: m.AdminRoutes })));
import { SelectTenantScreen } from './components/SelectTenantScreen';
import { TenantNotFound } from './components/errors/TenantNotFound';
import { TenantSuspended } from './components/errors/TenantSuspended';
import { AccessDenied } from './components/errors/AccessDenied';
import { TenantBootstrapError } from './components/errors/TenantBootstrapError';
import { ImpersonateFailureScreen } from './components/errors/ImpersonateFailureScreen';
import { NotFound } from './components/errors/NotFound';
import { TenantImpersonationBanner } from './components/TenantImpersonationBanner';
import { decodeJwt } from './lib/jwt';
import { ReadonlyBanner } from './components/ReadonlyBanner';
import { GraceBanner } from './components/GraceBanner';
import Sidebar from './components/Sidebar';
import AuthScreen from './components/AuthScreen';
import DashboardScreen from './components/DashboardScreen';
import SalesInboxScreen from './components/SalesInboxScreen';
const StockManagerScreen = React.lazy(() => import('./components/StockManagerScreen'));
const UserManagementScreen = React.lazy(() => import('./components/UserManagementScreen'));
const NotificationSettingsScreen = React.lazy(() => import('./components/NotificationSettingsScreen'));
const WhatsappAiScreen = React.lazy(() => import('./components/WhatsappAiScreen'));
const PengaturanScreen = React.lazy(() => import('./components/PengaturanScreen'));
const OrderHistoryScreen = React.lazy(() => import('./components/OrderHistoryScreen'));
const PelangganScreen = React.lazy(() => import('./components/PelangganScreen'));
const PiutangScreen = React.lazy(() => import('./components/piutang/PiutangScreen'));
const LaporanScreen = React.lazy(() => import('./components/LaporanScreen'));
const PembelianScreen = React.lazy(() => import('./components/PembelianScreen'));
const KasirScreen = React.lazy(() => import('./components/KasirScreen'));
const CatatPenjualanWizard = React.lazy(() => import('./components/penjualan/CatatPenjualanWizard'));
const InvoicePreviewScreen = React.lazy(() => import('./components/penjualan/InvoicePreviewScreen'));
const PenjualanScreen = React.lazy(() => import('./components/PenjualanScreen'));
const ApprovalInboxScreen = React.lazy(() => import('./components/approval/ApprovalInboxScreen'));
const OwnerDecisionInbox = React.lazy(() => import('./components/OwnerDecisionInbox'));
const StockOpnameScreen = React.lazy(() => import('./components/stok/StockOpnameScreen'));
const RekonsiliasiScreen = React.lazy(() => import('./components/RekonsiliasiScreen'));
const ManajemenGudangScreen = React.lazy(() => import('./components/ManajemenGudangScreen'));
const SalesLandingScreen = React.lazy(() => import('./components/sales/SalesLandingScreen').then(m => ({ default: m.SalesLandingScreen })));
const DaftarPesananScreen = React.lazy(() => import('./components/sales/DaftarPesananScreen').then(m => ({ default: m.DaftarPesananScreen })));
const DaftarPenawaranScreen = React.lazy(() => import('./components/penjualan/DaftarPenawaranScreen'));
const AkuntansiScreen = React.lazy(() => import('./components/akuntansi/AkuntansiScreen'));
const KasBankScreen = React.lazy(() => import('./components/kasbank/KasBankScreen'));
const AccountDetailScreen = React.lazy(() => import('./components/kasbank/AccountDetailScreen'));
const WarehouseTransferListScreen = React.lazy(() => import('./components/warehouseTransfer/WarehouseTransferListScreen'));
const WarehouseTransferCreateScreen = React.lazy(() => import('./components/warehouseTransfer/WarehouseTransferCreateScreen'));
const WarehouseTransferDetailScreen = React.lazy(() => import('./components/warehouseTransfer/WarehouseTransferDetailScreen'));
const PiutangWaReminderScreen = React.lazy(() => import('./components/pengaturan/PiutangWaReminderScreen').then(m => ({ default: m.PiutangWaReminderScreen })));
const NotificationTemplatesScreen = React.lazy(() => import('./components/pengaturan/NotificationTemplatesScreen').then(m => ({ default: m.NotificationTemplatesScreen })));
const NotificationCronScreen = React.lazy(() => import('./components/pengaturan/NotificationCronScreen').then(m => ({ default: m.NotificationCronScreen })));
const CustomerFeedbackScreen = React.lazy(() => import('./components/feedback/CustomerFeedbackScreen').then(m => ({ default: m.CustomerFeedbackScreen })));
const NotificationPrefsScreen = React.lazy(() => import('./components/pengaturan/NotificationPrefsScreen').then(m => ({ default: m.NotificationPrefsScreen })));

import { INITIAL_CONFIG } from './initialData';

import { isSupabaseConfigured, supabase, supabaseService, adminUsersService, tenantContextService } from './lib/supabaseClient';
import { SalesChannelsProvider } from './contexts/SalesChannelsContext';

// Local type guard for the channel URL param. Defensive — if URL is hand-edited
// with a bogus channel, fall back to undefined (UI shows default channel picker).
// Mirrors the KasirChannel union in src/types.ts (14 canonical sales channels).
function isKasirChannel(value: string | undefined): value is KasirChannel {
  if (!value) return false;
  return [
    'walkin', 'grosir', 'sales', 'expo',
    'tokopedia', 'shopee', 'lazada', 'blibli', 'bukalapak', 'ralali', 'bhinneka',
    'whatsapp', 'instagram', 'website',
  ].includes(value);
}

export default function App() {
  // URL is single source of truth for navigation. activePage and screen-scoped
  // params (customer, po, channel, bnl, bnl-new-for-order, bnl-new-customer)
  // all derive from the current route.
  const route = useURLRoute();
  // Pre-auth, the AuthScreen gate below uses `!currentUser` to decide what to
  // render — the URL doesn't carry 'auth' anymore. Post-auth, the URL wins.
  const activePage: ActivePage = route.screen;
  const openCustomerId: string | null = route.params.customer ?? null;
  const initialDetailPoNumber: string | null = route.params.po ?? null;
  const initialBnlPiNumber: string | null = route.params.bnl ?? null;
  const initialBnlPrefill: { orderId: string; customerName?: string } | null = (() => {
    const orderId = route.params['bnl-new-for-order'];
    if (!orderId) return null;
    return { orderId, customerName: route.params['bnl-new-customer'] || undefined };
  })();
  // Phase 2a deep-links — open Pesanan / Tagihan / Pembayaran detail by number.
  const initialPesananNumber: string | null = route.params.pesanan ?? null;
  const initialTagihanNumber: string | null = route.params.tagihan ?? null;
  // `?pembayaran=PMB-...` opens detail; `?pembayaran=new` opens create form
  // (Phase 2b uses this when "Bayar Tukar Faktur" navigates with `?prefill_tf=<id>`).
  const initialPembayaranNumber: string | null = route.params.pembayaran ?? null;
  const initialPembayaranPrefillTfId: string | null = route.params.prefill_tf ?? null;
  // Phase 2b: `?tf=TF-...` opens TF detail; `?tf=new` opens TF create form
  // (with optional `?prefill_tagihan=<id>` for the secondary entry from Tagihan Detail).
  const initialTfQuery: string | null = route.params.tf ?? null;
  const initialTfPrefillTagihanId: string | null = route.params.prefill_tagihan ?? null;
  // Validate channel param against KasirChannel; invalid → undefined.
  const penjualanInitialChannel: KasirChannel | undefined = isKasirChannel(route.params.channel)
    ? route.params.channel
    : undefined;
  // Optional SKU to pre-fill cart (set when navigating from Cari by Foto).
  const penjualanInitialPrefillSku: string | undefined = route.params.prefillSku || undefined;
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; role: string; permissions: PermissionSet; avatarUrl: string; storeName: string; gender: 'M' | 'F' | 'N' } | null>(null);
  // Tenant slug for the logged-in user's tenant, fetched once on session
  // restore. Drives the legacy-path redirect below and the URL/session slug
  // guard. Null while loading or when Supabase not configured (dev).
  const [sessionTenantSlug, setSessionTenantSlug] = useState<string | null>(null);
  // Tenant display name from tenants.name (via bootstrap RPC). Preferred
  // source over currentUser.storeName — the JWT user_metadata.store_name
  // isn't guaranteed to be populated for every onboarded user, but the
  // tenants row's name column always is.
  const [sessionTenantName, setSessionTenantName] = useState<string | null>(null);
  // Tracks whether the initial bootstrap_tenant_context RPC has resolved
  // (either success or failure). Blocks the tenant-name flash — without
  // this the header briefly renders the 'Toko Anda' fallback for ~200-500ms
  // after post-login reload while the async RPC is still in flight.
  const [sessionTenantLoaded, setSessionTenantLoaded] = useState<boolean>(false);
  // Cached JWT claims from session-restore. Used by the slug-guard effect to
  // detect platform admins synchronously (without racing an async isPlatformAdmin
  // RPC) so it can defer tenant-switch routing to the impersonation preflight.
  const [jwtClaims, setJwtClaims] = useState<Record<string, unknown> | null>(null);
  // Holds the kasir_transactions.id of the just-saved wizard transaction so
  // InvoicePreviewScreen can render its details after navigate('invoicePreview').
  // Kept in App state (not URL) because it's a transient hand-off — a refresh
  // on the invoicePreview route legitimately drops back to dashboard rather
  // than re-opening a stale invoice. T17 explicitly scopes this screen to
  // non-TEMPO transactions (TEMPO returns orders.id not kasir_transactions.id).
  const [invoicePreviewOrderId, setInvoicePreviewOrderId] = useState<string | null>(null);
  // Track which cash account to view in detail within KasBankDetail screen.
  const [kasBankDetailAccountId, setKasBankDetailAccountId] = useState<string | null>(null);

  // Multi-tenant: parse pathname route once per mount (full reload on platform transitions).
  const pathRoute = useMemo(
    () => parseRoute(window.location.pathname, new URLSearchParams(window.location.search)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Tenant error screen state: null = no error, otherwise show the specific error screen.
  type TenantErrorScreen = 'not-found' | 'suspended' | 'denied' | 'bootstrap' | null;
  const [tenantErrorScreen, setTenantErrorScreen] = useState<TenantErrorScreen>(null);
  const [tenantErrorCode, setTenantErrorCode] = useState<string>('');

  // Impersonation preflight state for platform admins landing on `/t/<slug>/*`
  // without a matching JWT impersonation claim. Silent auto-impersonate — no
  // confirm gate — because URL differentiates intent (`/admin/*` vs
  // `/t/<slug>/*`) and the persistent banner in tenant shell signals the
  // active impersonation.
  //   skip           — path is not tenant-scoped or Supabase not configured
  //   checking       — awaiting JWT claim inspection
  //   impersonating  — mid-flight impersonate_tenant RPC + refreshSession
  //   failed         — auto-impersonate failed; user can retry
  //   ok             — regular tenant user, OR admin already impersonating this slug
  type ImpersonateGateState = 'skip' | 'checking' | 'impersonating' | 'failed' | 'ok';
  const [impersonateGate, setImpersonateGate] = useState<ImpersonateGateState>('skip');
  const [impersonateError, setImpersonateError] = useState<string>('');

  // stockList is DB-scoped per tenant via RLS. Initialized empty; populated
  // by fetchStocks() on mount + refetch on tenant switch. Do NOT persist to
  // localStorage — that leaked another tenant's SKUs across sessions (a
  // browser opened first as Garindo would show Garindo's KOMODITAS STOK TIPIS
  // count on tenant #3's dashboard). config stays local-only (user prefs, not
  // tenant data).
  const [stockList, setStockList] = useState<StockItem[]>([]);

  const [config, setConfig] = useState<NotificationConfig>(() => {
    const saved = localStorage.getItem('sinar_elektrik_config');
    return saved ? JSON.parse(saved) : INITIAL_CONFIG;
  });

  // Global Floating Alert state
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'info' | 'warning'>('success');

  // Read deep-link (path + query) on boot. URL is already source of truth for
  // logged-in users (useURLRoute reads it directly). For logged-out users,
  // we stash BOTH pathname and search in sessionStorage so we can restore the
  // full URL after login — search-only stash lost tenant path `/t/<slug>/...`
  // when AuthScreen.afterLogin's hardcoded `/admin` redirect ran.
  useEffect(() => {
    if (currentUser) return; // Logged in — URL already drives state.
    const pathname = window.location.pathname;
    const search = window.location.search;
    const trivialPath = pathname === '' || pathname === '/' || pathname === '/login';
    const trivialSearch = !search || search === '?';
    if (trivialPath && trivialSearch) return;
    try {
      sessionStorage.setItem('pendingDeepLink', pathname + search);
    } catch {
      // sessionStorage unavailable (e.g., private window quota) — ignore.
    }
  }, []);

  // Restore Supabase auth session on page refresh
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user && !currentUser) {
        const user = session.user;
        // Look up real role + permissions from admin_users (was hardcoded to
        // 'Owner' + ALL_PERMISSIONS before — bypassed any per-role gating
        // including stok-opname blind-count). Fall back to Owner only when
        // no admin_users row exists, so existing auth users stay functional
        // until an Owner provisions them.
        let role: string = 'Owner';
        let permissions: PermissionSet = ALL_PERMISSIONS;
        let gender: 'M' | 'F' | 'N' = 'N';
        try {
          const adminRow = await adminUsersService.fetchById(user.id);
          if (adminRow) {
            role = adminRow.role;
            permissions = adminRow.permissions as PermissionSet;
            if (adminRow.gender === 'M' || adminRow.gender === 'F' || adminRow.gender === 'N') {
              gender = adminRow.gender;
            }
          } else {
            console.warn(`No admin_users row for ${user.id}; defaulting to Owner (provision via User Management)`);
          }
        } catch (err) {
          captureError(err, { feature: 'auth', action: 'fetch_admin_users_role_on_session_restore' });
        }
        setCurrentUser({
          id: user.id,
          name: user.user_metadata?.full_name ?? (user.email?.split('@')[0] ?? 'User'),
          role,
          permissions,
          avatarUrl: user.user_metadata?.avatar_url ?? '',
          storeName: user.user_metadata?.store_name ?? '',
          gender,
        });
        // Cache JWT claims for the slug-guard effect (see below).
        if (session.access_token) {
          setJwtClaims(decodeJwt(session.access_token));
        }
        // Fetch tenant slug for URL routing (drives the redirect + slug guard
        // below). Uses bootstrap_tenant_context RPC (SECURITY DEFINER) rather
        // than a direct SELECT on tenant_users — the latter hits the P1
        // tenant_users RLS self-recursion bug (42P17) for non-admin users.
        try {
          const ctx = await tenantContextService.bootstrap(window.location.hostname);
          if (ctx?.slug) setSessionTenantSlug(ctx.slug);
          if (ctx?.name) setSessionTenantName(ctx.name);
        } catch (err) {
          captureError(err, { feature: 'auth', action: 'fetch_tenant_slug_on_session_restore' });
        } finally {
          setSessionTenantLoaded(true);
        }
        // Sentry tenant scope: tag every subsequent event with tenant_id +
        // user_id so Sentry's Issues view can filter by tenant.
        // Reads tenant_id from the JWT payload (already decoded above).
        // Safe no-op when Sentry is uninitialised (DSN absent in dormant mode).
        if (session.access_token) {
          const claims = decodeJwt(session.access_token);
          const tenantId = typeof claims.tenant_id === 'string' ? claims.tenant_id : undefined;
          if (tenantId) Sentry.setTag('tenant_id', tenantId);
          Sentry.setUser({ id: user.id });
        }
        // Restore deep-link if stashed by AuthScreen; otherwise preserve the
        // current URL when it carries a valid screen (page reload while
        // logged in). Only normalize to dashboard when the URL is empty,
        // 'auth', or an unknown screen.
        try {
          const stashedSearch = sessionStorage.getItem('pendingDeepLink');
          if (stashedSearch) {
            sessionStorage.removeItem('pendingDeepLink');
            window.history.replaceState({}, '', stashedSearch);
            window.dispatchEvent(new Event('urlroute:change'));
          } else if (window.location.pathname.startsWith('/admin/')
                     || window.location.pathname === '/admin') {
            // Platform-admin area uses its own path-based routing (AdminRoutes.tsx);
            // do NOT force ?screen=dashboard here — that leaks tenant-side URL
            // scheme into admin URLs. Leave the URL alone.
          } else {
            const rawScreen = new URLSearchParams(window.location.search).get('screen');
            const isValidNonAuthScreen =
              rawScreen != null
              && rawScreen !== 'auth'
              && ACTIVE_PAGES.has(rawScreen as ActivePage);
            if (!isValidNonAuthScreen) {
              replaceRoute('dashboard');
            }
          }
        } catch {
          if (!(window.location.pathname.startsWith('/admin/')
                || window.location.pathname === '/admin')) {
            replaceRoute('dashboard');
          }
        }
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setCurrentUser(null);
        setSessionTenantSlug(null); // clear slug so next login re-fetches
        setJwtClaims(null); // clear cached JWT claims
        setSessionTenantName(null);
        setStockList([]); // don't bleed one tenant's stock into the next
        // Don't push 'auth' into URL — let the !currentUser gate render AuthScreen.
        // The next login will replaceRoute() to dashboard or stashed deep-link.
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Persist config (user preference — low-stock threshold, etc). stockList
  // deliberately NOT persisted; see the state initializer comment above.
  useEffect(() => {
    localStorage.setItem('sinar_elektrik_config', JSON.stringify(config));
  }, [config]);

  // Load stocks on mount + whenever the tenant slug changes (session
  // restore, tenant switch). Empty result = empty state, NOT a signal to
  // auto-seed legacy INITIAL_STOCK — that legacy path wrote Garindo's
  // Sinar Elektrik demo SKUs into fresh tenants' stocks tables. Real
  // tenants seed via VOSI admin or manual import.
  useEffect(() => {
    if (!isSupabaseConfigured || !sessionTenantSlug) return;
    supabaseService.fetchStocks().then(data => {
      const rows = data ?? [];
      const mapped: StockItem[] = rows.map(item => ({
        sku: item.sku,
        name: item.name,
        category: item.category,
        subcategory: item.subcategory ?? null,
        unit: item.unit ?? 'pcs',
        unit_alt: item.unit_alt ?? null,
        unit_alt_factor: item.unit_alt_factor ?? null,
        price: Number(item.price),
        stock: Number(item.stock),
        stock_atas: Number(item.stock_atas ?? item.stock),
        stock_bawah: Number(item.stock_bawah ?? 0),
        status: (item.status === 'Stok Tipis' ? 'Stok Tipis' : 'Sinkron') as 'Sinkron' | 'Stok Tipis',
        specs: (item.specs as Record<string, string | number>) ?? {},
        harga_modal: item.harga_modal ?? null,
        photo_urls: item.photo_urls ?? [],
        description: item.description ?? null,
        min_stock_per_product: item.min_stock_per_product ?? null,
        initial_stock_approved: item.initial_stock_approved ?? true,
        promo_discount_type: item.promo_discount_type ?? null,
        promo_discount_value: item.promo_discount_value != null ? Number(item.promo_discount_value) : null,
        promo_expires_at: item.promo_expires_at ?? null,
      }));
      setStockList(mapped);
      if (mapped.length > 0) {
        triggerToast('🌐 Database Supabase Sinkron! Ketersediaan stok live dimuat.', 'success');
      }
    }).catch(err => {
      captureError(err, { feature: 'stock', action: 'load_stocks' });
      triggerToast('⚠️ Gagal memuat stok dari Supabase.', 'warning');
    });
  }, [sessionTenantSlug]);

  const handleStockRefresh = async () => {
    if (!isSupabaseConfigured) return;
    try {
      const data = await supabaseService.fetchStocks();
      if (data && data.length > 0) {
        const mapped: StockItem[] = data.map(item => ({
          sku: item.sku,
          name: item.name,
          category: item.category,
          subcategory: item.subcategory ?? null,
          unit: item.unit ?? 'pcs',
          unit_alt: item.unit_alt ?? null,
          unit_alt_factor: item.unit_alt_factor ?? null,
          price: Number(item.price),
          stock: Number(item.stock),
          stock_atas: Number(item.stock_atas ?? item.stock),
          stock_bawah: Number(item.stock_bawah ?? 0),
          status: (item.status === 'Stok Tipis' ? 'Stok Tipis' : 'Sinkron') as 'Sinkron' | 'Stok Tipis',
          specs: (item.specs as Record<string, string | number>) ?? {},
          harga_modal: item.harga_modal ?? null,
          photo_urls: item.photo_urls ?? [],
          description: item.description ?? null,
          min_stock_per_product: item.min_stock_per_product ?? null,
          initial_stock_approved: item.initial_stock_approved ?? true,
          promo_discount_type: item.promo_discount_type ?? null,
          promo_discount_value: item.promo_discount_value != null ? Number(item.promo_discount_value) : null,
          promo_expires_at: item.promo_expires_at ?? null,
        }));
        setStockList(mapped);
      }
    } catch (err) {
      captureError(err, { feature: 'stock', action: 'refresh_stocks' });
    }
  };

  const handleStockUpdate = async (updatedStocks: StockItem[]) => {
    // Save to local state and localStorage
    setStockList(updatedStocks);

    if (isSupabaseConfigured) {
      try {
        // Find which items were deleted (exists in stockList but not in updatedStocks)
        const deletedItems = stockList.filter(oldItem => !updatedStocks.some(newItem => newItem.sku === oldItem.sku));
        for (const deleted of deletedItems) {
          await supabaseService.deleteStock(deleted.sku);
        }

        // Find which items were modified or added (exists in updatedStocks but either have different values or didn't exist in stockList)
        const itemsToUpsert = updatedStocks.filter(newItem => {
          const oldItem = stockList.find(o => o.sku === newItem.sku);
          if (!oldItem) return true; // Added
          return oldItem.name !== newItem.name ||
                 oldItem.category !== newItem.category ||
                 oldItem.price !== newItem.price ||
                 oldItem.stock !== newItem.stock ||
                 oldItem.status !== newItem.status ||
                 JSON.stringify(oldItem.specs) !== JSON.stringify(newItem.specs); // Modified
        });

        for (const item of itemsToUpsert) {
          await supabaseService.upsertStock(item);
        }
      } catch (err) {
        captureError(err, { feature: 'stock', action: 'supabase_update' });
        triggerToast('⚠️ Sinkronisasi Cloud Supabase gagal. Simpan lokal sukses.', 'warning');
      }
    }
  };


  // Handle successful login
  const handleLoginSuccess = (user: { id: string; name: string; role: string; permissions: PermissionSet; avatarUrl: string; storeName: string; gender: 'M' | 'F' | 'N' }) => {
    setCurrentUser(user);
    // Restore stashed deep-link if present; otherwise go to dashboard.
    try {
      const stashedSearch = sessionStorage.getItem('pendingDeepLink');
      if (stashedSearch) {
        sessionStorage.removeItem('pendingDeepLink');
        window.history.replaceState({}, '', stashedSearch);
        window.dispatchEvent(new Event('urlroute:change'));
        return;
      }
    } catch {
      // Stash unreadable — fall through.
    }
    replaceRoute('dashboard');
  };

  const handleOpenCustomer = (customerId: string) => {
    navigate('pelanggan', { customer: customerId });
  };

  // Handle logout
  const handleLogout = async () => {
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        // best-effort sign-out; clear local state regardless
      }
    }
    setCurrentUser(null);
    // Clear Sentry user/tenant scope on logout.
    Sentry.setUser(null);
    // Clear URL params so a refresh post-logout starts clean. AuthScreen renders
    // via the !currentUser gate, not via ?screen=auth.
    window.history.replaceState({}, '', window.location.pathname);
    window.dispatchEvent(new Event('urlroute:change'));
  };

  const triggerToast = useCallback((msg: string, type: 'success' | 'info' | 'warning' = 'success') => {
    setToastMessage(msg);
    setToastType(type);
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  }, []);

  // Multi-tenant: handle TenantProvider + interceptor error codes.
  const handleTenantError = useCallback((code: string) => {
    if (code === 'TENANT_NOT_FOUND') {
      setTenantErrorScreen('not-found');
    } else if (code === 'TENANT_SUSPENDED') {
      setTenantErrorScreen('suspended');
    } else if (code === 'NOT_A_MEMBER') {
      setTenantErrorScreen('denied');
    } else {
      setTenantErrorCode(code);
      setTenantErrorScreen('bootstrap');
    }
  }, []);

  // Global listener for caleo:tenant-error events from supabaseErrorInterceptor.
  useEffect(() => {
    const handler = (e: Event) => {
      const code = (e as CustomEvent).detail?.code as string | undefined;
      if (!code) return;
      if (code === 'SUBSCRIPTION_EXPIRED_READONLY') {
        triggerToast('Peringatan: subscription expired. Mode write dilarang — renew untuk melanjutkan.', 'warning');
      } else {
        handleTenantError(code);
      }
    };
    window.addEventListener('caleo:tenant-error', handler);
    return () => window.removeEventListener('caleo:tenant-error', handler);
  }, [triggerToast, handleTenantError]);

  // Multi-tenant: URL routing enforcement — two jobs:
  //   1. Legacy redirect: user on `/dashboard` or `?screen=...` (no tenant
  //      prefix) → send to `/t/<session-slug>/<screen>`.
  //   2. Slug guard: URL prefix `/t/wrong-slug/` doesn't match the session's
  //      tenant → correct the URL to `/t/<session-slug>/<screen>`. Prevents
  //      stale bookmarks + cross-tenant URL confusion when the same user
  //      re-logs into a different tenant. RLS still enforces data isolation;
  //      this guard is UX-only.
  // Only fires in production (Supabase configured); dev mode keeps the
  // legacy query-string shell to avoid a full-page reload loop.
  useEffect(() => {
    if (!currentUser) return;
    if (!sessionTenantSlug) return;             // wait until slug fetched
    if (pathRoute.isPlatformAdminArea) return;  // /admin — separate router
    if (pathRoute.screen === 'select-tenant') return;
    if (pathRoute.screen === 'login') return;
    if (!isSupabaseConfigured) return;          // dev mode
    if (pathRoute.tenantSlug === sessionTenantSlug) return; // already correct
    // Platform admins own tenant switching via the impersonation preflight
    // below — this slug-guard would race the preflight's impersonate+reload
    // and could land the admin on /t/<old-impersonation> when the URL says
    // /t/<new-target>. Non-admin tenant users are unaffected (isPlatformAdmin
    // claim absent → false → guard runs as before).
    if (jwtClaims?.is_platform_admin === true) return;
    const targetScreen = (route.screen !== 'dashboard' && ACTIVE_PAGES.has(route.screen as ActivePage))
      ? route.screen
      : 'dashboard';
    window.location.replace(`/t/${sessionTenantSlug}/${targetScreen}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, sessionTenantSlug, jwtClaims]);

  // Impersonation preflight: when a platform admin lands on `/t/<slug>/*`
  // without a matching JWT impersonation claim, silently swap the claim
  // (impersonate_tenant RPC + refreshSession) then reload. JWT is source of
  // truth — decoded locally to avoid an extra RPC round-trip. On success,
  // reload replaces the current URL with a JWT that satisfies TenantProvider
  // bootstrap; on failure, the failure UI offers a retry.
  useEffect(() => {
    if (!currentUser || !pathRoute.tenantSlug || !isSupabaseConfigured || !supabase) {
      setImpersonateGate('skip');
      return;
    }
    setImpersonateGate('checking');
    let cancelled = false;
    (async () => {
      const targetSlug = pathRoute.tenantSlug!;
      try {
        const { data } = await supabase!.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          if (!cancelled) setImpersonateGate('ok'); // TenantProvider will surface auth error
          return;
        }
        const claims = decodeJwt(token);
        const isAdmin = claims.is_platform_admin === true;
        const impersonatingSlug = typeof claims.impersonating_slug === 'string'
          ? claims.impersonating_slug
          : null;
        if (!isAdmin || impersonatingSlug === targetSlug) {
          if (!cancelled) setImpersonateGate('ok');
          return;
        }
        // Platform admin, JWT mismatch — auto-impersonate. On success reload
        // picks up the new claim; the effect re-runs and lands on 'ok'.
        if (!cancelled) setImpersonateGate('impersonating');
        await tenantContextService.impersonateTenant(targetSlug);
        if (!cancelled) window.location.reload();
      } catch (err) {
        if (!cancelled) {
          setImpersonateError(extractErrorMessage(err));
          setImpersonateGate('failed');
        }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, pathRoute.tenantSlug]);

  // Total alert indicators
  const lowStockCount = stockList.filter(item => item.stock < config.lowStockAlert).length;
  
  // Custom router render logic
  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return (
          <DashboardScreen
            showToast={triggerToast}
            onNavigate={(page) => navigate(page)}
            lowStockCount={lowStockCount}
            storeName={sessionTenantLoaded ? (sessionTenantName ?? currentUser?.storeName) : null}
          />
        );
      case 'sales-inbox':
        return (
          <SalesInboxScreen
            onNavigate={(page) => navigate(page)}
            userRole={currentUser?.role ?? null}
          />
        );
      case 'ai-stock':
        return (
          <StockManagerScreen
            stockList={stockList}
            onStockUpdate={handleStockUpdate}
            onStocksRefresh={handleStockRefresh}
            showToast={triggerToast}
            currentUser={currentUser}
            onNavigateToOpname={() => navigate('stok-opname')}
          />
        );
      case 'manajemen-gudang':
        return (
          <ManajemenGudangScreen
            currentUser={currentUser}
            showToast={triggerToast}
          />
        );
      case 'warehouse-transfer':
        return (
          <WarehouseTransferListScreen
            currentUserId={currentUser?.id ?? ''}
            onOpenDetail={(id) => navigate('warehouse-transfer-detail', { id: String(id) })}
            onOpenCreate={() => navigate('warehouse-transfer-create')}
          />
        );
      case 'warehouse-transfer-create':
        return (
          <WarehouseTransferCreateScreen
            currentUserId={currentUser?.id ?? ''}
            currentUserName={currentUser?.name}
            onDone={(id) => navigate('warehouse-transfer-detail', { id: String(id) })}
            onCancel={() => navigate('warehouse-transfer')}
            searchSKU={async (term, fromWarehouseId) => {
              // Fuzzy search stocks by sku or name; qty is from-warehouse stock only.
              // RLS on stocks scopes to tenant automatically. stock_levels are pulled
              // then reduced client-side, filtered to fromWarehouseId so the picker
              // "Stok" column matches the RPC's from-warehouse pre-check.
              const q = term.trim();
              if (!q || q.length < 1 || !fromWarehouseId) return [];
              const { data, error } = await supabase
                .from('stocks')
                .select('sku, name, stock_levels(qty, warehouse_id)')
                .or(`sku.ilike.%${q}%,name.ilike.%${q}%`)
                .limit(20);
              if (error) return [];
              return ((data ?? []) as Array<{ sku: string; name: string; stock_levels: Array<{ qty: number; warehouse_id: string }> }>)
                .map((row) => ({
                  sku: row.sku,
                  name: row.name,
                  qty: (row.stock_levels ?? [])
                    .filter(sl => sl.warehouse_id === fromWarehouseId)
                    .reduce((sum, sl) => sum + (sl.qty ?? 0), 0),
                }))
                // Hide SKUs with no stock at from-warehouse — RPC would reject with
                // TRANSFER_INSUFFICIENT_STOCK anyway, so surfacing them misleads the user.
                .filter(r => r.qty > 0);
            }}
            listReceivers={async (warehouseId) => {
              // Return admin_users in current tenant with can_receive_transfer=true.
              // Warehouse-id argument reserved for future per-warehouse assignment filtering.
              void warehouseId;
              const { data, error } = await supabase
                .from('admin_users')
                .select('id, name, permissions')
                .eq('status', 'Aktif');
              if (error) return [];
              return ((data ?? []) as Array<{ id: string; name: string; permissions: Record<string, unknown> | null }>)
                .filter((u) => u.permissions?.['can_receive_transfer'] === true)
                .map((u) => ({ id: u.id, name: u.name }));
            }}
          />
        );
      case 'warehouse-transfer-detail':
        return (
          <WarehouseTransferDetailScreen
            id={Number(route.params?.id ?? 0)}
            currentUserId={currentUser?.id ?? ''}
            onBack={() => navigate('warehouse-transfer')}
          />
        );
      case 'persetujuan':
        return (
          <ApprovalInboxScreen
            currentUser={currentUser}
            showToast={triggerToast}
          />
        );
      case 'keputusan-owner':
        return <OwnerDecisionInbox showToast={triggerToast} />;
      case 'stok-opname':
        return (
          <StockOpnameScreen
            currentUser={currentUser}
            showToast={triggerToast}
          />
        );
      case 'user-management':
        return (
          <UserManagementScreen
            showToast={triggerToast}
            currentUser={currentUser}
          />
        );
      case 'notifications':
        return (
          <NotificationSettingsScreen 
            config={config} 
            onConfigChange={setConfig} 
            showToast={triggerToast}
          />
        );
      case 'whatsapp-ai':
        return (
          <WhatsappAiScreen
            stockList={stockList}
            showToast={triggerToast}
            onNavigate={(page) => navigate(page)}
          />
        );
      case 'settings':
        return (
          <PengaturanScreen
            showToast={triggerToast}
            notificationConfig={config}
            onNotificationConfigChange={setConfig}
            stockList={stockList}
            onNavigate={(page) => navigate(page)}
            permissions={currentUser?.permissions}
            currentUserRole={currentUser?.role}
          />
        );
      case 'order-history':
        return (
          <OrderHistoryScreen
            currentUser={currentUser}
            onOpenCustomer={handleOpenCustomer}
            showToast={triggerToast}
          />
        );
      case 'pelanggan':
        return (
          <PelangganScreen
            openCustomerId={openCustomerId}
            onNavigate={(page) => navigate(page)}
            showToast={triggerToast}
          />
        );
      case 'piutang':
        return (
          <PiutangScreen
            currentUserId={currentUser?.id ?? ''}
            showToast={triggerToast}
            isOwner={!!(currentUser?.permissions?.can_approve_adjustment
              || currentUser?.permissions?.can_approve_price_change
              || currentUser?.permissions?.can_commit_opname
              || currentUser?.permissions?.can_approve_kasir_price_override
              || currentUser?.permissions?.can_approve_kasir_void
              || currentUser?.permissions?.can_approve_kasir_refund)}
          />
        );
      case 'laporan':
        return <LaporanScreen showToast={triggerToast} onNavigate={(page) => navigate(page as import('./types').ActivePage)} />;
      case 'pembelian':
        return (
          <PembelianScreen
            stockList={stockList}
            showToast={triggerToast}
            onStockRefresh={handleStockRefresh}
            currentUserId={currentUser?.id}
            currentUserPermissions={currentUser?.permissions}
            initialDetailPoNumber={initialDetailPoNumber}
            onDetailConsumed={() => { /* no-op: URL is source of truth; nothing to consume */ }}
            initialBnlPiNumber={initialBnlPiNumber}
            onBnlDetailConsumed={() => { /* no-op: URL is source of truth; nothing to consume */ }}
            initialBnlPrefill={initialBnlPrefill}
            onBnlPrefillConsumed={() => navigate('pembelian', {})}
            initialPesananNumber={initialPesananNumber}
            onPesananDetailConsumed={() => { /* no-op: URL is source of truth */ }}
            initialTagihanNumber={initialTagihanNumber}
            onTagihanDetailConsumed={() => { /* no-op: URL is source of truth */ }}
            initialPembayaranNumber={initialPembayaranNumber}
            onPembayaranDetailConsumed={() => { /* no-op: URL is source of truth */ }}
            initialPembayaranPrefillTfId={initialPembayaranPrefillTfId}
            initialTfQuery={initialTfQuery}
            initialTfPrefillTagihanId={initialTfPrefillTagihanId}
            onTfDetailConsumed={() => { /* no-op: URL is source of truth */ }}
          />
        );
      case 'kasir':
        return (
          <KasirScreen
            currentUser={currentUser}
            showToast={triggerToast}
            onOpenPenjualanBaru={(channel, prefillSku) => {
              navigate('penjualanBaru', { channel, prefillSku });
            }}
          />
        );
      case 'penjualan':
        return (
          <PenjualanScreen
            currentUser={currentUser}
            showToast={triggerToast}
            initialChannel={penjualanInitialChannel}
            onBack={() => navigate('kasir')}
            onSaved={(_txId) => navigate('kasir')}
            onNavigate={(page) => navigate(page)}
            onOpenCustomer={handleOpenCustomer}
          />
        );
      case 'penjualanBaru': {
        const wizardMode = route.params.mode === 'quote' ? 'quote' : 'invoice';
        const wizardFromSo = route.params.fromSo;
        return (
          <CatatPenjualanWizard
            currentUser={currentUser}
            showToast={triggerToast}
            initialChannel={penjualanInitialChannel}
            initialPrefillSku={penjualanInitialPrefillSku}
            mode={wizardMode}
            fromSalesOrderId={wizardFromSo}
            onBack={() => navigate('kasir')}
            onSaved={(txId) => {
              // Park the id in App-scoped state so the next page (chosen
              // separately by the orchestrator via onNavigate) can render it.
              // Both wizard paths that flow to invoicePreview (standard, wip)
              // call onSaved(txId) first then onNavigate('invoicePreview');
              // for TEMPO the orchestrator routes to 'piutang' and the id
              // is harmless (InvoicePreviewScreen would surface "not found"
              // anyway, but we never get there).
              setInvoicePreviewOrderId(txId);
            }}
            onNavigate={(page) => navigate(page)}
          />
        );
      }
      case 'invoicePreview':
        return invoicePreviewOrderId ? (
          <InvoicePreviewScreen
            orderId={invoicePreviewOrderId}
            adminName={currentUser?.name}
            onCatatLagi={() => { setInvoicePreviewOrderId(null); navigate('penjualanBaru'); }}
            onLihatDaftar={() => navigate('daftarPesanan')}
            onBack={() => navigate('kasir')}
            showToast={triggerToast}
          />
        ) : (
          <div className="p-6 text-slate-500 text-sm">
            Invoice tidak tersedia. Silakan catat penjualan baru.
          </div>
        );
      case 'daftarPenawaran':
        return <DaftarPenawaranScreen showToast={triggerToast} />;
      case 'rekonsiliasi':
        return (
          <RekonsiliasiScreen
            currentUser={currentUser}
            showToast={triggerToast}
          />
        );
      case 'akuntansi':
        return (
          <AkuntansiScreen
            currentUser={currentUser}
            showToast={triggerToast}
          />
        );
      case 'kasBank':
        return (
          <KasBankScreen
            currentUser={currentUser}
            showToast={triggerToast}
            onNavigate={(page, params) => {
              if (page === 'kasBank-detail') {
                setKasBankDetailAccountId(params as string);
                navigate('kasBankDetail');
              } else if (page === 'kasBank' || page === 'kasBankDetail') {
                navigate(page as ActivePage);
              }
            }}
          />
        );
      case 'kasBankDetail':
        if (!kasBankDetailAccountId) {
          navigate('kasBank');
          return null;
        }
        return (
          <AccountDetailScreen
            cashAccountId={kasBankDetailAccountId}
            currentUser={currentUser}
            showToast={triggerToast}
            onBack={() => navigate('kasBank')}
          />
        );
      case 'salesLanding':
        return <SalesLandingScreen />;
      case 'daftarPesanan':
        return (
          <DaftarPesananScreen
            currentUserRole={currentUser?.role}
            currentUserId={currentUser?.id}
            currentUserName={currentUser?.name}
          />
        );
      case 'piutang-wa-reminder':
        return <PiutangWaReminderScreen />;
      case 'notification-templates':
        return <NotificationTemplatesScreen />;
      case 'notification-cron':
        return <NotificationCronScreen />;
      case 'customer-feedback':
        return <CustomerFeedbackScreen />;
      case 'notification-prefs':
        return <NotificationPrefsScreen />;
      default:
        // Unknown screen — show 404 instead of blank page.
        return (
          <NotFound
            attempted={window.location.pathname + window.location.search}
            onGoHome={() => replaceRoute('dashboard')}
          />
        );
    }
  };

  // Detail-tab detection: route carries po param and we want a chromeless shell.
  const isDetailTab = route.screen === 'pembelian' && route.params.po != null;

  // ── Hostname-based admin routing (admin.caleo.id + staging.admin.caleo.id) ──
  // Must run BEFORE auth gate so the URL is always /admin/* on admin hostnames,
  // regardless of auth state. No infinite loop: once pathname starts with /admin
  // this branch is skipped.
  const isAdminHostname =
    window.location.hostname === 'admin.caleo.id' ||
    window.location.hostname === 'staging.admin.caleo.id';
  if (isAdminHostname && !window.location.pathname.startsWith('/admin')) {
    window.location.replace('/admin');
    return null;
  }

  // Switch to Auth Screen if no session active. activePage no longer encodes
  // 'auth' (URL never carries ?screen=auth) — gate purely on currentUser.
  if (!currentUser) {
    return <AuthScreen onLoginSuccess={handleLoginSuccess} />;
  }

  // ── Multi-tenant platform-level routing ────────────────────────────────────
  // Platform admin area: /admin/*
  if (pathRoute.isPlatformAdminArea) {
    return (
      <React.Suspense fallback={<div className="min-h-screen flex items-center justify-center text-[13px] text-slate-500 font-caleo">Memuat admin…</div>}>
        <AdminRoutes />
      </React.Suspense>
    );
  }

  // Tenant-selector screen: /select-tenant
  if (pathRoute.screen === 'select-tenant') {
    return <SelectTenantScreen />;
  }

  // Tenant-scoped area: /t/<slug>/*
  // Wrap the existing shell in TenantProvider when a slug is present.
  // In dev-mode (no Supabase), pathRoute.tenantSlug is null (URL is query-string
  // based), so we fall through to the legacy shell below.
  if (pathRoute.tenantSlug) {
    // Impersonation preflight — must run BEFORE any tenant-context bootstrap.
    // Silent auto-impersonate for platform admin/slug mismatch; regular
    // tenant users pass straight through.
    if (impersonateGate === 'checking' || impersonateGate === 'impersonating') {
      const label = impersonateGate === 'impersonating'
        ? `Masuk sebagai tenant ${pathRoute.tenantSlug}…`
        : 'Memeriksa akses tenant…';
      return (
        <div className="min-h-screen flex items-center justify-center text-[13px] text-slate-500 font-caleo">
          {label}
        </div>
      );
    }
    if (impersonateGate === 'failed') {
      // Branch on platform-admin status: admins went to a wrong/forbidden tenant
      // (show AccessDenied); regular users have a genuinely broken tenant (show
      // TenantBootstrapError). Sentry tag is emitted inside ImpersonateFailureScreen.
      return (
        <ImpersonateFailureScreen
          isPlatformAdmin={jwtClaims?.is_platform_admin === true}
          error={impersonateError}
          onRetry={() => window.location.reload()}
          onLogout={handleLogout}
        />
      );
    }

    // If a tenant error has been set (from onError callback or window event), render
    // the appropriate error screen instead of the normal shell.
    if (tenantErrorScreen === 'not-found') {
      return (
        <TenantNotFound
          slug={pathRoute.tenantSlug}
          onBackToLogin={() => {
            setTenantErrorScreen(null);
            window.location.href = '/login';
          }}
        />
      );
    }
    if (tenantErrorScreen === 'suspended') {
      return <TenantSuspended onLogout={handleLogout} />;
    }
    if (tenantErrorScreen === 'denied') {
      return <AccessDenied onLogout={handleLogout} />;
    }
    if (tenantErrorScreen === 'bootstrap') {
      return (
        <TenantBootstrapError
          code={tenantErrorCode || 'BOOTSTRAP_FAILED'}
          onRetry={() => { setTenantErrorScreen(null); window.location.reload(); }}
        />
      );
    }

    // Render tenant shell wrapped in TenantProvider.
    const tenantShell = (
      <TenantProvider slug={pathRoute.tenantSlug} onError={handleTenantError}>
        <TenantImpersonationBanner />
        <ReadonlyBanner />
        <GraceBanner />
        {isDetailTab ? (
          <div className="min-h-screen bg-gray-50 text-[#0b1c30] font-sans">
            {toastMessage && (
              <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[100] animate-bounce-subtle">
                <div className="bg-white px-8 py-4 rounded-full shadow-2xl flex items-center gap-3 border border-[#abc9f3] whitespace-nowrap">
                  {toastType === 'success' && <ShieldCheck className="w-5 h-5 text-[#2d8a4e] shrink-0 fill-emerald-50" />}
                  {toastType === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />}
                  {toastType === 'info' && <Info className="w-5 h-5 text-[#1e3d60] shrink-0" />}
                  <span className="font-extrabold text-xs text-[var(--color-caleo-primary)] tracking-tight">{toastMessage}</span>
                </div>
              </div>
            )}
            <PembelianScreen
              stockList={stockList}
              showToast={triggerToast}
              onStockRefresh={handleStockRefresh}
              currentUserId={currentUser?.id}
              currentUserPermissions={currentUser?.permissions}
              initialDetailPoNumber={initialDetailPoNumber}
              onDetailConsumed={() => { /* no-op: URL is source of truth; nothing to consume */ }}
              initialBnlPiNumber={initialBnlPiNumber}
              onBnlDetailConsumed={() => { /* no-op: URL is source of truth; nothing to consume */ }}
              initialBnlPrefill={initialBnlPrefill}
            onBnlPrefillConsumed={() => navigate('pembelian', {})}
              initialPesananNumber={initialPesananNumber}
              onPesananDetailConsumed={() => { /* no-op: URL is source of truth */ }}
              initialTagihanNumber={initialTagihanNumber}
              onTagihanDetailConsumed={() => { /* no-op: URL is source of truth */ }}
              initialPembayaranNumber={initialPembayaranNumber}
              onPembayaranDetailConsumed={() => { /* no-op: URL is source of truth */ }}
            />
          </div>
        ) : (
          <SalesChannelsProvider>
          <div
            className="min-h-screen bg-[#f8f9ff] text-[#0b1c30] flex font-sans"
            style={{ background: 'radial-gradient(circle at 70% 80%, var(--color-caleo-cloud) 0%, #f8f9ff 100%)' }}
          >
            {toastMessage && (
              <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[100] animate-bounce-subtle">
                <div className="bg-white px-8 py-4 rounded-full shadow-2xl flex items-center gap-3 border border-[#abc9f3] whitespace-nowrap">
                  {toastType === 'success' && <ShieldCheck className="w-5 h-5 text-[#2d8a4e] shrink-0 fill-emerald-50" />}
                  {toastType === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />}
                  {toastType === 'info' && <Info className="w-5 h-5 text-[#1e3d60] shrink-0" />}
                  <span className="font-extrabold text-xs text-[var(--color-caleo-primary)] tracking-tight">{toastMessage}</span>
                </div>
              </div>
            )}
            <Sidebar
              activePage={activePage}
              onPageChange={(page) => navigate(page)}
              currentUser={currentUser}
              onLogout={handleLogout}
            />
            <main className="flex-1 ml-[96px] mr-6 my-6 flex flex-col gap-6 min-h-[calc(100vh-48px)]">
              <header className="flex justify-between items-center w-full px-8 py-4 bg-white/60 backdrop-blur-xl rounded border border-white/60 shadow-sm shrink-0">
                <div className="flex items-center gap-5">
                  <div className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-[var(--color-caleo-primary)] fill-blue-950 shrink-0" />
                    <h1 className="font-extrabold text-lg text-primary tracking-tight">
                      {sessionTenantLoaded
                        ? (sessionTenantName || currentUser?.storeName || 'Toko Anda')
                        : ' '}
                    </h1>
                  </div>
                </div>
                <div className="flex items-center gap-3 select-none">
                  <div className="relative hidden md:block">
                    <input
                      type="text"
                      placeholder="Cari menu..."
                      onClick={() => triggerToast("Gunakan pintasan navigasi di sidebar untuk berpindah tab.", 'info')}
                      className="bg-[var(--color-caleo-cloud)] border-none rounded-full px-4 py-2 w-56 text-xs font-semibold focus-visible:ring-1 focus-visible:ring-caleo-gold"
                    />
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />
                  </div>
                  <button
                    onClick={() => navigate('notifications')}
                    className="w-9 h-9 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-100 relative cursor-pointer"
                    title="Notifikasi Laporan"
                  >
                    <Bell className="w-4 h-4" />
                    <span className="absolute top-1 right-1 w-2 h-2 bg-[#2d8a4e] rounded-full" />
                  </button>
                  <button
                    onClick={() => triggerToast(`Toko: ${sessionTenantName || currentUser?.storeName || 'Toko Anda'} — User: ${currentUser?.name} — Keamanan: Premium GPN`, 'info')}
                    className="w-9 h-9 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-100 cursor-pointer"
                    title="Informasi Sistem"
                  >
                    <HelpCircle className="w-4 h-4" />
                  </button>
                </div>
              </header>
              <div className="flex-1 min-h-0">
                <Suspense fallback={
                  <div className="flex items-center justify-center h-full text-slate-400 text-sm font-semibold">
                    Memuat…
                  </div>
                }>
                  {renderPage()}
                </Suspense>
              </div>
              <footer className="flex justify-between items-center py-4 px-2 shrink-0 select-none">
                <p className="text-[10px] uppercase font-bold tracking-widest text-[#43474e]/60">
                  © 2026 Caleo ERP • Powered by DeepMind &amp; Gemini AI
                </p>
                <div className="flex gap-4">
                  <span className="text-[10px] text-[#43474e]/50 font-bold hover:text-slate-700 cursor-pointer" onClick={() => triggerToast("Syarat Ketentuan Layanan Cloud SaaS Berlaku.", 'info')}>Terms</span>
                  <span className="text-[10px] text-[#43474e]/50 font-bold hover:text-slate-700 cursor-pointer" onClick={() => triggerToast("Kebijakan Privasi CRM Enkripsi GPN Aktif.", 'info')}>Privacy</span>
                </div>
              </footer>
            </main>
          </div>
          </SalesChannelsProvider>
        )}
      </TenantProvider>
    );
    return tenantShell;
  }
  // ── End multi-tenant routing ───────────────────────────────────────────────

  // Detail tab: no sidebar, no global header, no footer. Only the toast and the screen.
  // The screen itself owns its top bar (close X + action buttons).
  if (isDetailTab && activePage === 'pembelian') {
    return (
      <div className="min-h-screen bg-gray-50 text-[#0b1c30] font-sans">
        {toastMessage && (
          <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[100] animate-bounce-subtle">
            <div className="bg-white px-8 py-4 rounded-full shadow-2xl flex items-center gap-3 border border-[#abc9f3] whitespace-nowrap">
              {toastType === 'success' && <ShieldCheck className="w-5 h-5 text-[#2d8a4e] shrink-0 fill-emerald-50" />}
              {toastType === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />}
              {toastType === 'info' && <Info className="w-5 h-5 text-[#1e3d60] shrink-0" />}
              <span className="font-extrabold text-xs text-[var(--color-caleo-primary)] tracking-tight">{toastMessage}</span>
            </div>
          </div>
        )}
        <Suspense fallback={
          <div className="flex items-center justify-center h-full text-slate-400 text-sm font-semibold">
            Memuat…
          </div>
        }>
          <PembelianScreen
            stockList={stockList}
            showToast={triggerToast}
            onStockRefresh={handleStockRefresh}
            currentUserId={currentUser?.id}
            currentUserPermissions={currentUser?.permissions}
            initialDetailPoNumber={initialDetailPoNumber}
            onDetailConsumed={() => { /* no-op: URL is source of truth; nothing to consume */ }}
            initialBnlPiNumber={initialBnlPiNumber}
            onBnlDetailConsumed={() => { /* no-op: URL is source of truth; nothing to consume */ }}
            initialBnlPrefill={initialBnlPrefill}
            initialPesananNumber={initialPesananNumber}
            onPesananDetailConsumed={() => { /* no-op: URL is source of truth */ }}
            initialTagihanNumber={initialTagihanNumber}
            onTagihanDetailConsumed={() => { /* no-op: URL is source of truth */ }}
            initialPembayaranNumber={initialPembayaranNumber}
            onPembayaranDetailConsumed={() => { /* no-op: URL is source of truth */ }}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <SalesChannelsProvider>
    <div
      className="min-h-screen bg-[#f8f9ff] text-[#0b1c30] flex font-sans"
      style={{ background: 'radial-gradient(circle at 70% 80%, var(--color-caleo-cloud) 0%, #f8f9ff 100%)' }}
    >
      {/* Dynamic Animated Success / Alert Toaster */}
      {toastMessage && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[100] animate-bounce-subtle">
          <div className="bg-white px-8 py-4 rounded-full shadow-2xl flex items-center gap-3 border border-[#abc9f3] whitespace-nowrap">
            {toastType === 'success' && <ShieldCheck className="w-5 h-5 text-[#2d8a4e] shrink-0 fill-emerald-50" />}
            {toastType === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />}
            {toastType === 'info' && <Info className="w-5 h-5 text-[#1e3d60] shrink-0" />}
            <span className="font-extrabold text-xs text-[var(--color-caleo-primary)] tracking-tight">{toastMessage}</span>
          </div>
        </div>
      )}

      {/* Global Collapsible Sidebar Menu */}
      <Sidebar
        activePage={activePage}
        onPageChange={(page) => navigate(page)}
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      {/* Primary Layout Wrapper (Leaves room for the 80px fixed wide sidebar) */}
      <main className="flex-1 ml-[96px] mr-6 my-6 flex flex-col gap-6 min-h-[calc(100vh-48px)]">
        
        {/* Top Control Header Bar */}
        <header className="flex justify-between items-center w-full px-8 py-4 bg-white/60 backdrop-blur-xl rounded border border-white/60 shadow-sm shrink-0">
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-[var(--color-caleo-primary)] fill-blue-950 shrink-0" />
              <h1 className="font-extrabold text-lg text-primary tracking-tight">
                {sessionTenantName || currentUser?.storeName || 'Toko Anda'}
              </h1>
            </div>
            
            {/* Top-nav "Settings" + "Konfigurasi Histori" buttons removed
               on 2026-06-12 e2e audit — "Settings" routed to the same
               Notification Settings page as the sidebar entry, and
               "Konfigurasi Histori" opened a generic info modal whose name
               implied an audit-log view it didn't deliver. Sidebar is now
               the single source of nav. The notification bell on the right
               keeps the quick-access affordance with a recognized icon. */}
          </div>

          <div className="flex items-center gap-3 select-none">
            {/* Soft search helper */}
            <div className="relative hidden md:block">
              <input 
                type="text" 
                placeholder="Cari menu..." 
                onClick={() => triggerToast("🔍 Gunakan pintasan navigasi di sidebar untuk berpindah tab.", 'info')}
                className="bg-[var(--color-caleo-cloud)] border-none rounded-full px-4 py-2 w-56 text-xs font-semibold focus-visible:ring-1 focus-visible:ring-caleo-gold"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2" />
            </div>

            <button 
              onClick={() => navigate('notifications')}
              className="w-9 h-9 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-100 relative cursor-pointer"
              title="Notifikasi Laporan"
            >
              <Bell className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-[#2d8a4e] rounded-full" />
            </button>
            
            <button 
              onClick={() => triggerToast(`📌 Toko: ${sessionTenantName || currentUser?.storeName || 'Toko Anda'} • User: ${currentUser?.name} • Keamanan: Premium GPN`, 'info')}
              className="w-9 h-9 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-100 cursor-pointer"
              title="Informasi Sistem"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Core Screen Route Portlet */}
        <div className="flex-1 min-h-0">
          <Suspense fallback={
            <div className="flex items-center justify-center h-full text-slate-400 text-sm font-semibold">
              Memuat…
            </div>
          }>
            {renderPage()}
          </Suspense>
        </div>

        {/* Global Footer credits */}
        <footer className="flex justify-between items-center py-4 px-2 shrink-0 select-none">
          <p className="text-[10px] uppercase font-bold tracking-widest text-[#43474e]/60">
            © 2026 Caleo ERP • Powered by DeepMind &amp; Gemini AI
          </p>
          <div className="flex gap-4">
            <span className="text-[10px] text-[#43474e]/50 font-bold hover:text-slate-700 cursor-pointer" onClick={() => triggerToast("📜 Syarat Ketentuan Layanan Cloud SaaS Berlaku.", 'info')}>Terms</span>
            <span className="text-[10px] text-[#43474e]/50 font-bold hover:text-slate-700 cursor-pointer" onClick={() => triggerToast("🔒 Kebijakan Privasi CRM Enkripsi GPN Aktif.", 'info')}>Privacy</span>
          </div>
        </footer>
      </main>

    </div>
    </SalesChannelsProvider>
  );
}
