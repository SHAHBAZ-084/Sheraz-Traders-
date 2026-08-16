/**
 * Dev helper: open Products / Add Account and verify Search inputs are the topmost
 * hit target (not covered by TopBar). Run with:
 *   npx playwright test --config=playwright.overlap.config.mjs
 * or: node scripts/check-search-hit-target.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5173';

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.fill('#username', 'admin');
  await page.fill('#password', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
}

async function assertSearchClickable(page, path, placeholder) {
  await page.goto(`${BASE}${path}`);
  const input = page.locator(`input[placeholder="${placeholder}"]`).first();
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.scrollIntoViewIfNeeded();
  const box = await input.boundingBox();
  if (!box) throw new Error(`No bounding box for ${placeholder} on ${path}`);

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const top = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return {
        tag: el?.tagName ?? null,
        className: el?.className ?? null,
        placeholder: el instanceof HTMLInputElement ? el.placeholder : null,
        inTopnav: Boolean(el?.closest?.('.app-topnav')),
      };
    },
    { x: cx, y: cy },
  );

  if (top.inTopnav) {
    throw new Error(`${path}: click at Search is hitting TopBar (${JSON.stringify(top)})`);
  }
  if (top.placeholder !== placeholder && top.tag !== 'INPUT') {
    throw new Error(`${path}: expected Search input under cursor, got ${JSON.stringify(top)}`);
  }

  await input.click();
  const focused = await page.evaluate(() => document.activeElement?.getAttribute?.('placeholder'));
  if (focused !== placeholder) {
    throw new Error(`${path}: Search did not receive focus after click (active=${focused})`);
  }
  console.log(`OK ${path} — Search clickable, not under TopBar`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  await login(page);
  await assertSearchClickable(page, '/products/add', 'Search name, unit, ledger…');
  await assertSearchClickable(page, '/accounts/manage/add', 'Search name, code…');
  console.log('All search hit-target checks passed');
} finally {
  await browser.close();
}
