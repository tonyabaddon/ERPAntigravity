/**
 * Runtime backend URL resolution.
 *
 * Vite bakes VITE_BACKEND_URL into the bundle at build time, which means
 * staging and prod would need separate images (defeating the purpose of
 * testing the same artifact in staging before promoting to prod).
 *
 * Instead we resolve the backend URL at runtime from window.location.hostname.
 * One image works for all environments — staging smoke tests validate the
 * exact same artifact that reaches prod.
 *
 * Hostname → backend mapping:
 *   staging.app.caleo.id   → garindo-jaya-panel-msme-erp-staging Cloud Run URL
 *   staging.admin.caleo.id → same staging backend
 *   app.caleo.id           → prod backend (Cloud Run base URL)
 *   admin.caleo.id         → prod backend
 *   *.run.app hostnames    → explicit map below (direct Cloud Run URLs still work)
 *   localhost / other      → VITE_BACKEND_URL env var (dev / CI fallback)
 */

const STAGING_BE = 'https://garindo-jaya-panel-msme-erp-staging-422860632808.asia-southeast1.run.app';
const PROD_BE = 'https://garindo-jaya-panel-msme-erp-422860632808.asia-southeast1.run.app';

const HOSTNAME_TO_BACKEND: Record<string, string> = {
  // Custom domains (primary)
  'staging.app.caleo.id': STAGING_BE,
  'staging.admin.caleo.id': STAGING_BE,
  'app.caleo.id': PROD_BE,
  'admin.caleo.id': PROD_BE,
  // Direct Cloud Run URLs — mapped so app still works when accessed via .run.app URLs
  // (e.g., during staging smoke tests or emergency debugging before DNS propagates)
  'garindo-jaya-panel-msme-erp-frontend-staging-422860632808.asia-southeast1.run.app': STAGING_BE,
  'garindo-jaya-panel-msme-erp-frontend-staging-xnrhcw7onq-as.a.run.app': STAGING_BE,
  'garindo-jaya-panel-msme-erp-frontend-422860632808.asia-southeast1.run.app': PROD_BE,
  'garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app': PROD_BE,
};

/**
 * Returns the backend API base URL for the current hostname.
 * Falls back to the Vite env var for local dev / unit tests.
 */
export function getBackendUrl(): string {
  if (typeof window !== 'undefined') {
    const mapped = HOSTNAME_TO_BACKEND[window.location.hostname];
    if (mapped) return mapped;
  }
  // Dev / CI / unit-test fallback
  return import.meta.env.VITE_BACKEND_URL ?? '';
}
