/**
 * Full-app clickability audit — finds fields covered by TopBar / stacking bugs.
 *
 * Usage (dev server must be running):
 *   npm install -D playwright@1.49.0 --no-save
 *   npx playwright install chromium
 *   node scripts/audit-clickable-fields.mjs
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5173';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'audit-clickable-report.json');

/** Every routable page a shop user / admin can open. */
const PAGES = [
  { path: '/login', auth: false, name: 'Login' },
  { path: '/', auth: true, name: 'Home (blank)' },
  { path: '/dashboard', auth: true, name: 'Dashboard' },
  { path: '/accounts/categories/add', auth: true, name: 'Add Category' },
  { path: '/accounts/categories/edit', auth: true, name: 'Edit Category' },
  { path: '/accounts/categories/remove', auth: true, name: 'Remove Category' },
  { path: '/accounts/manage/add', auth: true, name: 'Add Account' },
  { path: '/accounts/manage/edit', auth: true, name: 'Edit Account' },
  { path: '/accounts/manage/remove', auth: true, name: 'Remove Account' },
  { path: '/products/add', auth: true, name: 'Add Product' },
  { path: '/products/remove', auth: true, name: 'Remove Product' },
  { path: '/accounts/sale-parties', auth: true, name: 'Sale Parties' },
  { path: '/accounts/purchase-parties', auth: true, name: 'Purchase Parties' },
  { path: '/invoices/kachi-maal', auth: true, name: 'Kachi Maal Invoice' },
  { path: '/invoices/sale-invoice', auth: true, name: 'Sale Invoice' },
  { path: '/invoices/purchase-invoice', auth: true, name: 'Purchase Invoice' },
  { path: '/invoices/view-invoice', auth: true, name: 'View Invoice' },
  { path: '/jama-naam', auth: true, name: 'Jama Naam Register' },
  { path: '/inventory/stock-transfer', auth: true, name: 'Stock Transfer' },
  { path: '/vouchers/payment', auth: true, name: 'Payment Voucher' },
  { path: '/vouchers/receipt', auth: true, name: 'Receipt Voucher' },
  { path: '/vouchers/journal', auth: true, name: 'Journal Voucher' },
  { path: '/vouchers/view', auth: true, name: 'View Vouchers' },
  { path: '/reports/accounts', auth: true, name: 'Account Ledger' },
  { path: '/reports/account-balance', auth: true, name: 'Account Balance' },
  { path: '/reports/vouchers', auth: true, name: 'Vouchers Report' },
  { path: '/reports/trial-balance', auth: true, name: 'Trial Balance' },
  { path: '/reports/profit-loss', auth: true, name: 'Profit & Loss' },
  { path: '/reports/stock', auth: true, name: 'Stock Report' },
  { path: '/reports/financial-year', auth: true, name: 'Financial Year Reports' },
  { path: '/system/database', auth: true, name: 'Database Maintenance' },
  { path: '/system/stores', auth: true, name: 'Stores' },
  { path: '/system/approvals', auth: true, name: 'Pending Approvals' },
  { path: '/system/preferences', auth: true, name: 'System Preferences' },
  { path: '/user', auth: true, name: 'User Information' },
  { path: '/user/fy-management', auth: true, name: 'FY Management' },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'wide', width: 1600, height: 900 },
  { name: 'narrow', width: 1024, height: 720 },
];

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', 'admin');
  await page.fill('#password', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20000 });
}

async function collectTargets(page) {
  return page.evaluate(() => {
    const scroll = document.querySelector('.app-main-scroll');
    const root = scroll ?? document.querySelector('.app-page') ?? document.body;
    const scrollRect = scroll ? scroll.getBoundingClientRect() : { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };

    const sel =
      'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [role="combobox"], a.quick-link-card, a[href^="/"]';
    const nodes = Array.from(root.querySelectorAll(sel));
    const results = [];
    for (const el of nodes) {
      if (el.closest('.app-topnav')) continue;
      if (el.closest('.minimized-tray')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;

      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;

      // Must be inside the visible scrollport / viewport intersection
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue;
      if (scroll) {
        if (cx < scrollRect.left || cx > scrollRect.right || cy < scrollRect.top || cy > scrollRect.bottom) {
          continue;
        }
      }

      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') {
        continue;
      }
      const label =
        el.getAttribute('placeholder') ||
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        (el instanceof HTMLButtonElement ? el.textContent?.trim().slice(0, 40) : '') ||
        el.tagName.toLowerCase();
      results.push({
        tag: el.tagName,
        type: el.getAttribute('type') || '',
        label: label || el.tagName,
        x: cx,
        y: cy,
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      });
    }
    return results;
  });
}

async function hitTest(page, target) {
  return page.evaluate(({ x, y, tag, label }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) {
      return { ok: false, reason: 'elementFromPoint returned null', hit: null };
    }
    const inTopnav = Boolean(el.closest('.app-topnav'));
    const hitLabel =
      el.getAttribute('placeholder') ||
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      (el instanceof HTMLElement ? el.innerText?.trim().slice(0, 40) : '') ||
      el.tagName;

    // Accept if the hit element is the target or a descendant/ancestor of the interactive control
    // (e.g. clicking a button hits an SVG child).
    const walk = (node) => {
      let n = node;
      while (n && n !== document.body) {
        if (n.tagName === tag) {
          const nLabel =
            n.getAttribute('placeholder') ||
            n.getAttribute('aria-label') ||
            n.getAttribute('title') ||
            (n instanceof HTMLElement ? n.innerText?.trim().slice(0, 40) : '') ||
            n.tagName;
          if (!label || !nLabel || nLabel === label || nLabel.includes(String(label).slice(0, 12)) || String(label).includes(String(nLabel).slice(0, 12))) {
            return true;
          }
          // Same tag near same point is good enough for buttons with icons
          if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT') return true;
        }
        // SearchSelect: input inside combobox root
        if (tag === 'INPUT' && (n.tagName === 'INPUT' || n.getAttribute('role') === 'combobox')) {
          return true;
        }
        n = n.parentElement;
      }
      return false;
    };

    if (inTopnav) {
      return {
        ok: false,
        reason: 'TopBar is capturing clicks over page content',
        hit: { tag: el.tagName, className: String(el.className || ''), label: hitLabel, inTopnav: true },
      };
    }

    if (walk(el)) {
      return { ok: true, hit: { tag: el.tagName, label: hitLabel, inTopnav: false } };
    }

    // Soft pass: hit is inside .app-main-scroll / .app-page and is interactive
    const inMain = Boolean(el.closest('.app-main-scroll, .app-page, form, [data-search-select-root]'));
    const interactive = /^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(el.tagName) || el.getAttribute('role') === 'combobox';
    if (inMain && interactive) {
      return { ok: true, hit: { tag: el.tagName, label: hitLabel, inTopnav: false, soft: true } };
    }

    return {
      ok: false,
      reason: `Click intercepted by unexpected element (${el.tagName} "${hitLabel}")`,
      hit: { tag: el.tagName, className: String(el.className || '').slice(0, 80), label: hitLabel, inTopnav: false },
    };
  }, target);
}

async function auditPage(page, meta, viewport) {
  const result = {
    name: meta.name,
    path: meta.path,
    viewport: viewport.name,
    status: 'pass',
    controls: 0,
    failures: [],
    notes: [],
  };

  try {
    await page.goto(`${BASE}${meta.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(400);

    // Fresh load (top)
    let targets = await collectTargets(page);
    result.controls = targets.length;

    if (targets.length === 0 && meta.path !== '/') {
      result.notes.push('No interactive controls found in viewport at top');
    }

    for (const t of targets) {
      const hit = await hitTest(page, t);
      if (!hit.ok) {
        result.failures.push({
          phase: 'top',
          control: t.label,
          tag: t.tag,
          top: Math.round(t.top),
          reason: hit.reason,
          hit: hit.hit,
        });
      }
    }

    // Scroll every control into view and re-check high-risk top zone + key search fields
    await page.evaluate(() => {
      const scroll = document.querySelector('.app-main-scroll');
      const inputs = Array.from(
        (scroll ?? document).querySelectorAll(
          'input:not([type="hidden"]):not([disabled]), select:not([disabled])',
        ),
      ).filter((el) => !el.closest('.app-topnav'));
      for (const el of inputs.slice(0, 12)) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    });
    await page.waitForTimeout(100);

    // After scrolling samples into view, test currently visible targets again
    const afterScrollTargets = await collectTargets(page);
    for (const t of afterScrollTargets) {
      const hit = await hitTest(page, t);
      if (!hit.ok) {
        result.failures.push({
          phase: 'scrolled-into-view',
          control: t.label,
          tag: t.tag,
          top: Math.round(t.top),
          reason: hit.reason,
          hit: hit.hit,
        });
      }
    }

    await page.evaluate(() => {
      const sc = document.querySelector('.app-main-scroll');
      if (sc) sc.scrollTop = 0;
      else window.scrollTo(0, 0);
    });
    await page.waitForTimeout(100);

    targets = await collectTargets(page);
    // Focus on top-of-page risk zone (just under header)
    const topZone = targets.filter((t) => t.top < 220);
    for (const t of topZone) {
      const hit = await hitTest(page, t);
      if (!hit.ok) {
        result.failures.push({
          phase: 'after-scroll-top',
          control: t.label,
          tag: t.tag,
          top: Math.round(t.top),
          reason: hit.reason,
          hit: hit.hit,
        });
      }
    }

    // Attempt real focus click on first text input if present
    const firstInput = page.locator('.app-main-scroll input:not([type="hidden"]):not([disabled]), .app-page input:not([type="hidden"]):not([disabled])').first();
    if ((await firstInput.count()) > 0 && (await firstInput.isVisible().catch(() => false))) {
      try {
        await firstInput.click({ timeout: 3000 });
        const focused = await page.evaluate(() => {
          const a = document.activeElement;
          return a ? a.tagName + (a.getAttribute('placeholder') || a.id || '') : null;
        });
        if (!focused || !focused.startsWith('INPUT')) {
          result.failures.push({
            phase: 'focus',
            control: 'first-input',
            reason: `Click did not focus an input (active=${focused})`,
          });
        }
      } catch (err) {
        result.failures.push({
          phase: 'focus',
          control: 'first-input',
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    result.status = 'error';
    result.failures.push({
      phase: 'load',
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  if (result.failures.length > 0 && result.status !== 'error') {
    result.status = 'fail';
  }

  return result;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const report = { base: BASE, startedAt: new Date().toISOString(), viewports: [], pages: [] };

  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();

      // Login once per viewport (except we still visit /login as its own page first)
      const loginPage = PAGES.find((p) => p.path === '/login');
      if (loginPage) {
        const r = await auditPage(page, loginPage, vp);
        report.pages.push(r);
        console.log(`[${vp.name}] ${r.status.toUpperCase()} ${r.name} (${r.controls} controls, ${r.failures.length} fails)`);
      }

      await login(page);

      for (const meta of PAGES.filter((p) => p.auth)) {
        const r = await auditPage(page, meta, vp);
        report.pages.push(r);
        const mark = r.status === 'pass' ? 'PASS' : r.status.toUpperCase();
        console.log(`[${vp.name}] ${mark} ${r.name} (${r.controls} controls, ${r.failures.length} fails)`);
        if (r.failures.length) {
          for (const f of r.failures.slice(0, 5)) {
            console.log(`    - [${f.phase}] ${f.control}: ${f.reason}`);
          }
        }
      }

      await context.close();
      report.viewports.push(vp.name);
    }
  } finally {
    await browser.close();
  }

  report.finishedAt = new Date().toISOString();
  const failed = report.pages.filter((p) => p.status !== 'pass');
  report.summary = {
    total: report.pages.length,
    passed: report.pages.filter((p) => p.status === 'pass').length,
    failed: failed.length,
    failedPages: [...new Set(failed.map((p) => p.name))],
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${report.summary.passed}/${report.summary.total}`);
  if (report.summary.failedPages.length) {
    console.log('Failed pages:', report.summary.failedPages.join(', '));
  }
  console.log(`Report: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
