/**
 * Path B — Staff escalation (low-confidence scenario)
 *
 * Creates a low-confidence conversation (ai_active=false, ESCALATED_ADMIN state)
 * and verifies that the owner-role wa_recipients receive an escalation broadcast
 * message within 30s.
 *
 * The broadcast is sent via BroadcastToStaff → to owner recipients.
 * We poll the owner phone's outbound messages for the escalation notification.
 *
 * Requires: E2E_TEST_MODE=true, running backend, WA session not required
 * (testapi inserts DB rows only; actual WA send is exercised separately).
 */
import { test, expect } from '@playwright/test';

const BE = (process.env.E2E_BE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const TENANT_ID = process.env.E2E_TENANT_ID ?? 'wa_1';
const CUSTOMER_PHONE = '628111222002';
// Owner phone is read from E2E_OWNER_PHONE or defaults to a sentinel that the
// audit trail will contain if the escalation path fires correctly.
const OWNER_PHONE = process.env.E2E_OWNER_PHONE ?? '628999999001';

test.describe('Path B — Staff escalation', () => {
  test('escalation broadcast reaches owner within 30s', async ({ request, page }) => {
    // 1. Ensure a customer conversation exists first.
    const inboundResp = await request.post(`${BE}/api/v1/test/simulate-inbound`, {
      data: {
        tenantID: TENANT_ID,
        customerPhone: CUSTOMER_PHONE,
        body: 'Minta penawaran custom panel 200A',
      },
    });
    expect(inboundResp.ok(), `simulate-inbound must return 2xx, got ${inboundResp.status()}`).toBe(true);

    // 2. Flip to low-confidence (ESCALATED_ADMIN) so the handler notifies staff.
    const escResp = await request.post(`${BE}/api/v1/test/create-low-confidence-scenario`, {
      data: { tenantID: TENANT_ID, customerPhone: CUSTOMER_PHONE },
    });
    expect(escResp.ok(), `create-low-confidence-scenario must return 2xx, got ${escResp.status()}`).toBe(true);

    // 3. Poll owner's outbound messages for the escalation notification.
    // BroadcastToStaff writes to messages table for each recipient.
    let escalationSent = false;
    for (let i = 0; i < 30; i++) {
      const msgsResp = await request.get(
        `${BE}/api/v1/test/messages?tenantID=${TENANT_ID}&customerPhone=${OWNER_PHONE}`
      );
      if (msgsResp.ok()) {
        const rows: Array<{ direction: string; sender: string; text: string }> = await msgsResp.json();
        if (rows.some((r) => r.direction === 'OUTBOUND')) {
          escalationSent = true;
          break;
        }
      }
      await page.waitForTimeout(1000);
    }
    expect(escalationSent, 'Expected an OUTBOUND escalation message to owner within 30s').toBe(true);
  });
});
