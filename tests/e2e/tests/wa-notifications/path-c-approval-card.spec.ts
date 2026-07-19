/**
 * Path C — Approval WA card
 *
 * Creates an approval_requests row (fires notify_approval_created trigger →
 * OnApprovalCreated → ApprovalCard template broadcast to owner). The test
 * then polls the owner's messages for the approval card containing the
 * machine-parseable "approve:<id>" line.
 *
 * Requires: E2E_TEST_MODE=true, running backend.
 */
import { test, expect } from '@playwright/test';

const BE = (process.env.E2E_BE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const TENANT_ID = process.env.E2E_TENANT_ID ?? 'wa_1';
const OWNER_PHONE = process.env.E2E_OWNER_PHONE ?? '628999999001';

test.describe('Path C — Approval WA card', () => {
  test('approval card with approve: line sent to owner within 30s', async ({ request, page }) => {
    // 1. Insert approval_requests row — fires pg_notify → OnApprovalCreated handler.
    const approvalResp = await request.post(`${BE}/api/v1/test/create-approval-request`, {
      data: {
        tenantID: TENANT_ID,
        requestType: 'kasir_discount',
        details: 'Diskon 15% untuk pelanggan reguler',
      },
    });
    expect(approvalResp.ok(), `create-approval-request must return 2xx, got ${approvalResp.status()}`).toBe(true);
    const approvalBody = await approvalResp.json();
    const approvalID: number = approvalBody.approval_id;
    expect(approvalID, 'approval_id must be a positive integer').toBeGreaterThan(0);

    // 2. Poll owner's messages for a message containing "approve:<id>".
    // The ApprovalCard template always includes the machine-parseable line.
    let cardSent = false;
    for (let i = 0; i < 30; i++) {
      const msgsResp = await request.get(
        `${BE}/api/v1/test/messages?tenantID=${TENANT_ID}&customerPhone=${OWNER_PHONE}`
      );
      if (msgsResp.ok()) {
        const rows: Array<{ direction: string; text: string }> = await msgsResp.json();
        if (rows.some((r) => r.direction === 'OUTBOUND' && r.text.includes(`approve:${approvalID}`))) {
          cardSent = true;
          break;
        }
      }
      await page.waitForTimeout(1000);
    }
    expect(cardSent, `Expected approval card with "approve:${approvalID}" sent to owner within 30s`).toBe(true);
  });
});
