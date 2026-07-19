/**
 * Path G — Sales Inbox admin forward
 *
 * Simulates an admin-typed message in Sales Inbox by inserting an admin-sender
 * messages row and emitting pg_notify('admin_message', ...). The main.go
 * OnAdminMessage handler forwards it to the customer's WA via NotifyCustomer,
 * which writes an outbound audit message.
 *
 * Verifies:
 *   1. The simulate-admin-forward endpoint succeeds.
 *   2. An OUTBOUND message appears in the customer's message audit within 30s.
 *   3. The forwarded text matches what was sent.
 *
 * Requires: E2E_TEST_MODE=true, running backend with LISTEN/NOTIFY active.
 */
import { test, expect } from '@playwright/test';

const BE = (process.env.E2E_BE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const TENANT_ID = process.env.E2E_TENANT_ID ?? 'wa_1';
const CUSTOMER_PHONE = '628111222007';
const ADMIN_MSG = 'Pesanan Anda sedang diproses, estimasi siap dalam 2 hari kerja.';

test.describe('Path G — Admin forward (Sales Inbox)', () => {
  test('admin message forwarded to customer within 30s', async ({ request, page }) => {
    // 1. Simulate admin message — inserts row + emits pg_notify.
    const fwdResp = await request.post(`${BE}/api/v1/test/simulate-admin-forward`, {
      data: { tenantID: TENANT_ID, customerPhone: CUSTOMER_PHONE, text: ADMIN_MSG },
    });
    expect(fwdResp.ok(), `simulate-admin-forward must return 2xx, got ${fwdResp.status()}`).toBe(true);
    const fwdBody = await fwdResp.json();
    expect(fwdBody.message_id, 'Expected message_id in response').toBeTruthy();
    expect(fwdBody.conversation_id, 'Expected conversation_id in response').toBeTruthy();

    // 2. Poll for outbound message containing the forwarded text.
    // NotifyCustomer writes a second messages row with sender='admin' or applies
    // the AdminForward template. Either way an OUTBOUND row appears.
    let messageSent = false;
    for (let i = 0; i < 30; i++) {
      const msgsResp = await request.get(
        `${BE}/api/v1/test/messages?tenantID=${TENANT_ID}&customerPhone=${CUSTOMER_PHONE}`
      );
      if (msgsResp.ok()) {
        const rows: Array<{ direction: string; text: string }> = await msgsResp.json();
        // At least one OUTBOUND message should be present (the forwarded admin msg).
        if (rows.some((r) => r.direction === 'OUTBOUND')) {
          messageSent = true;
          break;
        }
      }
      await page.waitForTimeout(1000);
    }
    expect(messageSent, 'Expected OUTBOUND admin-forward message within 30s').toBe(true);

    // 3. Verify the outbound message text includes the original admin content.
    const finalMsgs = await request.get(
      `${BE}/api/v1/test/messages?tenantID=${TENANT_ID}&customerPhone=${CUSTOMER_PHONE}`
    );
    const rows: Array<{ direction: string; text: string }> = await finalMsgs.json();
    const outbound = rows.filter((r) => r.direction === 'OUTBOUND');
    const containsAdminText = outbound.some((r) =>
      // AdminForward template wraps the text, so we check for a substring.
      r.text.includes('Pesanan Anda sedang diproses')
    );
    expect(containsAdminText, 'Outbound message must contain the forwarded admin text').toBe(true);
  });
});
