/**
 * Path A — Calista AI reply
 *
 * Simulates an inbound customer message and polls for an AI outbound reply
 * within 30 seconds. Requires backend running with E2E_TEST_MODE=true and a
 * live Gemini/OpenRouter connection.
 *
 * Run:
 *   E2E_TEST_MODE=true npm run backend:dev &
 *   npx playwright test tests/e2e/tests/wa-notifications/path-a-calista.spec.ts --config=tests/e2e/playwright.prod.config.ts
 */
import { test, expect } from '@playwright/test';

const BE = (process.env.E2E_BE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const TENANT_ID = process.env.E2E_TENANT_ID ?? 'wa_1';
const CUSTOMER_PHONE = '628111222001';

test.describe('Path A — Calista AI reply', () => {
  test('Calista AI reply within 30s', async ({ request, page }) => {
    // POST inbound customer message
    const inboundResp = await request.post(`${BE}/api/v1/test/simulate-inbound`, {
      data: {
        tenantID: TENANT_ID,
        customerPhone: CUSTOMER_PHONE,
        body: 'Halo, ada stok kabel NYA 2.5mm tidak?',
      },
    });
    expect(inboundResp.ok(), `simulate-inbound must return 2xx, got ${inboundResp.status()}`).toBe(true);
    const inboundBody = await inboundResp.json();
    expect(inboundBody.conversation_id, 'simulate-inbound must return conversation_id').toBeTruthy();

    // Poll for an outbound AI reply (max 30 attempts × 1s = 30s)
    let aiReplySent = false;
    for (let i = 0; i < 30; i++) {
      const msgsResp = await request.get(
        `${BE}/api/v1/test/messages?tenantID=${TENANT_ID}&customerPhone=${CUSTOMER_PHONE}`
      );
      expect(msgsResp.ok(), `messages query must return 2xx`).toBe(true);
      const rows: Array<{ direction: string; sender: string }> = await msgsResp.json();
      if (rows.some((r) => r.direction === 'OUTBOUND' && r.sender === 'ai')) {
        aiReplySent = true;
        break;
      }
      await page.waitForTimeout(1000);
    }
    expect(aiReplySent, 'Expected an OUTBOUND ai message within 30s').toBe(true);
  });
});
