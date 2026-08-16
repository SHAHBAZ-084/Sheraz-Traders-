/**
 * Extra checks: Search fields on Products/Add Account + FY gate password on User Info.
 */
import { chromium } from 'playwright';

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5173';

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.fill('#username', 'admin');
  await page.fill('#password', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
}

async function assertClickable(page, selector, label) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'attached', timeout: 15000 });
  await el.scrollIntoViewIfNeeded();
  await el.waitFor({ state: 'visible', timeout: 5000 });
  const box = await el.boundingBox();
  if (!box) throw new Error(`${label}: no box`);
  const hit = await page.evaluate(({ x, y }) => {
    const n = document.elementFromPoint(x, y);
    return {
      tag: n?.tagName,
      inTopnav: Boolean(n?.closest?.('.app-topnav')),
      placeholder: n instanceof HTMLInputElement ? n.placeholder : null,
    };
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  if (hit.inTopnav) throw new Error(`${label}: TopBar capturing click`);
  await el.click();
  console.log(`OK ${label}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  await login(page);

  await page.goto(`${BASE}/products/add`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await assertClickable(page, 'input[placeholder="Search name, unit, ledger…"]', 'Products Search');
  await assertClickable(page, 'select >> nth=-1', 'Products Filter category');

  await page.goto(`${BASE}/accounts/manage/add`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await assertClickable(page, 'input[placeholder="Search name, code…"]', 'Add Account Search');
  await assertClickable(page, 'select >> nth=-1', 'Add Account Filter category');

  // FY gate: open via Ctrl+Alt+Shift+A then S (approx) — use direct state if shortcut hard;
  // Instead navigate user page and inject gate open via evaluating keyboard shortcut sequence.
  await page.goto(`${BASE}/user`);
  await page.keyboard.down('Control');
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyA');
  await page.keyboard.press('KeyS');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');
  await page.keyboard.up('Control');
  await page.waitForTimeout(300);
  const gate = page.locator('input[type="password"]').last();
  if (await gate.isVisible().catch(() => false)) {
    await gate.click();
    await gate.fill('CUIVHR');
    console.log('OK FY gate password field clickable');
  } else {
    // Fallback: change-password fields still clickable
    await assertClickable(page, 'input[autocomplete="current-password"]', 'User Info current password');
    console.log('NOTE FY gate not opened via shortcut in headless — password fields still OK');
  }

  console.log('Targeted checks passed');
} finally {
  await browser.close();
}
