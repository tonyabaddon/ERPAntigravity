/**
 * Path E — 24h booking expiry reminder
 *
 * Creates a BOOKED order with booking_expires_at = NOW() + 24h. The in-process
 * scheduler fires the booking expiry reminder at T-24h. Because the reminder
 * fires at the exact 24h mark (not immediately), this test verifies only that:
 *   1. The order is created successfully.
 *   2. The scheduler registers the booking (visible via the API response).
 *
 * Full end-to-end time-travel testing (manipulating booking_expires_at to
 * NOW() + 1s) is deferred to a future integration harness with clock injection.
 * This scaffold verifies the scaffolding compiles and the API contract is correct.
 *
 * Requires: E2E_TEST_MODE=true, running backend.
 */
import { test, expect } from '@playwright/test';

const BE = (process.env.E2E_BE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const TENANT_ID = process.env.E2E_TENANT_ID ?? 'wa_1';
const CUSTOMER_PHONE = '628111222005';

test.describe('Path E — Booking expiry 24h reminder', () => {
  test('booking-with-24h-expiry endpoint registers order', async ({ request }) => {
    const resp = await request.post(`${BE}/api/v1/test/simulate-booking-with-24h-expiry`, {
      data: { tenantID: TENANT_ID, customerPhone: CUSTOMER_PHONE },
    });
    expect(resp.ok(), `simulate-booking-with-24h-expiry must return 2xx, got ${resp.status()}`).toBe(true);

    const body = await resp.json();
    expect(body.order_id, 'Expected order_id in response').toBeTruthy();
    expect(body.expires_at, 'Expected expires_at in response').toBeTruthy();

    // Verify expires_at is approximately 24h in the future (within 5 minute tolerance).
    const expiresAt = new Date(body.expires_at).getTime();
    const expectedMin = Date.now() + (24 * 60 - 5) * 60 * 1000;
    const expectedMax = Date.now() + (24 * 60 + 5) * 60 * 1000;
    expect(expiresAt, 'expires_at must be ~24h from now').toBeGreaterThan(expectedMin);
    expect(expiresAt, 'expires_at must be ~24h from now').toBeLessThan(expectedMax);
  });
});
