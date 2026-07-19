/**
 * Path D — Silent customer follow-up
 *
 * Backdates a conversation's last_ai_message_at to 8 days ago (> 4h threshold)
 * so the follow-up poller (1-minute tick) will pick it up on its next run.
 * Polls for an outbound follow-up message within 90s (allows poller to fire).
 *
 * Requires: E2E_TEST_MODE=true, running backend with follow-up poller active.
 */
import { test, expect } from '@playwright/test';

const BE = (process.env.E2E_BE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const TENANT_ID = process.env.E2E_TENANT_ID ?? 'wa_1';
const CUSTOMER_PHONE = '628111222004';

test.describe('Path D — Silent customer follow-up', () => {
  test.setTimeout(120_000); // allow 2 min for poller tick

  test('follow-up message sent within 90s after silent customer setup', async ({ request, page }) => {
    // 1. Backdate last_ai_message_at to simulate 8-day silent customer.
    const silentResp = await request.post(`${BE}/api/v1/test/simulate-silent-customer`, {
      data: { tenantID: TENANT_ID, customerPhone: CUSTOMER_PHONE },
    });
    expect(silentResp.ok(), `simulate-silent-customer must return 2xx, got ${silentResp.status()}`).toBe(true);
    const silentBody = await silentResp.json();
    expect(silentBody.conversation_id, 'Expected conversation_id in response').toBeTruthy();

    // 2. Poll for outbound follow-up message (poller ticks every 60s).
    // Timeout: 90 attempts × 1s = 90s.
    let followupSent = false;
    for (let i = 0; i < 90; i++) {
      const msgsResp = await request.get(
        `${BE}/api/v1/test/messages?tenantID=${TENANT_ID}&customerPhone=${CUSTOMER_PHONE}`
      );
      if (msgsResp.ok()) {
        const rows: Array<{ direction: string; sender: string }> = await msgsResp.json();
        // Follow-up is sent as 'ai' sender outbound
        if (rows.some((r) => r.direction === 'OUTBOUND' && r.sender === 'ai')) {
          followupSent = true;
          break;
        }
      }
      await page.waitForTimeout(1000);
    }
    expect(followupSent, 'Expected follow-up OUTBOUND ai message within 90s').toBe(true);
  });
});
