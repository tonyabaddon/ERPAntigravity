import { test, expect } from '../fixtures/auth';
import path from 'path';

const PROD_ADMIN_URL = process.env.PROD_ADMIN_URL ?? 'https://admin.caleo.id';

test.describe.configure({ mode: 'serial' });

test('capture /admin/billing screenshot for founder review', async ({ adminPage }) => {
  const consoleErrors: string[] = [];
  const KNOWN_SAFE = [
    'favicon', 'net::ERR_', 'WebSocket', 'Manifest',
    'MISSING_TENANT_CONTEXT', 'Failed to fetch tenant slug',
    'status of 500',
  ];
  adminPage.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!KNOWN_SAFE.some((s) => text.includes(s))) consoleErrors.push(text);
    }
  });

  await adminPage.goto(`${PROD_ADMIN_URL}/admin/billing`, {
    waitUntil: 'networkidle',
    timeout: 30_000,
  });

  // Wait for dashboard to render (heading only — we'll snap regardless of data)
  const headingVisible = await adminPage.locator(
    'h1:has-text("Biaya Tenant"), [data-testid="cost-dashboard"]'
  ).first().isVisible({ timeout: 15_000 }).catch(() => false);
  await adminPage.waitForTimeout(4000);  // let RPC settle

  const shotPath = path.resolve(process.cwd(), '../../docs/screenshots/p2-a-billing-prod.png');
  await adminPage.screenshot({ path: shotPath, fullPage: true });
  console.log(`[SCREENSHOT] ${shotPath}`);
  console.log(`[URL] ${adminPage.url()}`);
  console.log(`[TITLE] ${await adminPage.title()}`);
  console.log(`[HEADING_VISIBLE] ${headingVisible}`);
  console.log(`[CONSOLE_ERRORS] ${consoleErrors.length}`);
  if (consoleErrors.length) {
    console.log(consoleErrors.map((e, i) => `  [${i}] ${e}`).join('\n'));
  }
  // Grab visible text so we can inspect state without opening the PNG
  const bodyText = await adminPage.locator('body').innerText().catch(() => '(empty)');
  console.log(`[BODY_TEXT_SAMPLE]`);
  console.log(bodyText.substring(0, 1200));
});
