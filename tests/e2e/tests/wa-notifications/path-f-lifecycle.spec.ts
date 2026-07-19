/**
 * Path F — Payment/order lifecycle events
 *
 * Fires each lifecycle event via pg_notify and polls for the corresponding
 * customer WA message within 30s. Covers 5 sub-paths:
 *
 *   F1. payment_verified  → "Pembayaran anda telah dikonfirmasi"
 *   F2. dp_verified       → DP (down payment) confirmation
 *   F3. payment_rejected  → "Pembayaran anda ditolak"
 *   F4. order_approved    → order confirmation with shipping fee
 *   F5. order_shipped     → order completed / ready for pickup
 *
 * Requires: E2E_TEST_MODE=true, running backend with LISTEN/NOTIFY active.
 */
import { test, expect } from '@playwright/test';

const BE = (process.env.E2E_BE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const TENANT_ID = process.env.E2E_TENANT_ID ?? 'wa_1';

// Each sub-path uses a unique customer phone to avoid message cross-contamination.
const PHONES: Record<string, string> = {
  payment_verified: '628111222061',
  dp_verified:      '628111222062',
  payment_rejected: '628111222063',
  order_approved:   '628111222064',
  order_shipped:    '628111222065',
};

const LIFECYCLE_EVENTS = [
  'payment_verified',
  'dp_verified',
  'payment_rejected',
  'order_approved',
  'order_shipped',
] as const;

test.describe('Path F — Lifecycle events', () => {
  for (const eventType of LIFECYCLE_EVENTS) {
    test(`${eventType}: customer WA notification sent within 30s`, async ({ request, page }) => {
      const customerPhone = PHONES[eventType];

      // Fire the lifecycle event.
      const fireResp = await request.post(`${BE}/api/v1/test/fire-lifecycle-event`, {
        data: { tenantID: TENANT_ID, customerPhone, eventType },
      });
      expect(fireResp.ok(), `fire-lifecycle-event(${eventType}) must return 2xx, got ${fireResp.status()}`).toBe(true);
      const fireBody = await fireResp.json();
      expect(fireBody.order_id, 'Expected order_id in response').toBeTruthy();

      // Poll for outbound customer message.
      let notificationSent = false;
      for (let i = 0; i < 30; i++) {
        const msgsResp = await request.get(
          `${BE}/api/v1/test/messages?tenantID=${TENANT_ID}&customerPhone=${customerPhone}`
        );
        if (msgsResp.ok()) {
          const rows: Array<{ direction: string }> = await msgsResp.json();
          if (rows.some((r) => r.direction === 'OUTBOUND')) {
            notificationSent = true;
            break;
          }
        }
        await page.waitForTimeout(1000);
      }
      expect(
        notificationSent,
        `Expected OUTBOUND lifecycle message for ${eventType} within 30s`
      ).toBe(true);
    });
  }
});
