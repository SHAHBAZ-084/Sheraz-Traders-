/**
 * Backfill Product.averageCost from real stock-in history (Opening Stock,
 * posted Purchase Invoices, approved Stock Adjustments).
 *
 * Safe by default: dry-run only. Does NOT touch ledgers, balances, or vouchers —
 * only Product.averageCost.
 *
 * Usage:
 *   node backend/scripts/backfill-product-average-cost.mjs
 *   node backend/scripts/backfill-product-average-cost.mjs --apply
 *   node backend/scripts/backfill-product-average-cost.mjs --db="file:C:/path/to/copy.db"
 *   node backend/scripts/backfill-product-average-cost.mjs --db="file:C:/path/to/copy.db" --apply
 *
 * Prefer running dry-run against a DB *copy* first. Take a backup before --apply
 * on production.
 *
 * Confirmation (investigation): averageCost is written on Stock Adjustment *approval*
 * (addStandardStockToProductInTx), not on pending create. Products whose adjustments
 * were already approved should already have averageCost set; this script repairs the
 * remaining nulls from missed/legacy paths.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');
const apply = process.argv.includes('--apply');

function argValue(flag) {
  const prefixed = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

function loadEnv() {
  for (const envPath of [
    path.join(backendRoot, '.env'),
    path.join(repoRoot, 'backend', '.env'),
  ]) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] == null) process.env[key] = val;
    }
  }
}

loadEnv();

const dbOverride = argValue('--db');
if (dbOverride) {
  process.env.DATABASE_URL = dbOverride.startsWith('file:')
    ? dbOverride
    : `file:${dbOverride.replace(/\\/g, '/')}`;
}

const prisma = new PrismaClient();

function roundCost(n) {
  return Math.round(Number(n) * 1e8) / 1e8;
}

function sameInstant(a, b) {
  return new Date(a).getTime() === new Date(b).getTime();
}

function movementQty(productKind, movement) {
  if (productKind === 'KACHI' && movement.weightKg != null) {
    return Number(movement.weightKg);
  }
  return Number(movement.bags);
}

/**
 * Same WAC rule as addStandardStockToProductInTx / purchase posting:
 * OUT changes running qty only; IN updates avg (reset when qty <= 0 or avg unset).
 */
function replayWac(events) {
  let qty = 0;
  let avg = null;
  const sources = [];

  const sorted = [...events].sort((a, b) => {
    const da = a.date.getTime() - b.date.getTime();
    if (da !== 0) return da;
    if (a.seq !== b.seq) return a.seq - b.seq;
    return a.id - b.id;
  });

  for (const ev of sorted) {
    if (ev.direction === 'OUT') {
      qty -= ev.qty;
      continue;
    }
    if (!(ev.qty > 0) || !(ev.unitCost > 0)) continue;

    if (qty <= 0 || avg == null) {
      avg = ev.unitCost;
    } else {
      avg = (qty * avg + ev.qty * ev.unitCost) / (qty + ev.qty);
    }
    qty += ev.qty;
    sources.push(ev.source);
  }

  return {
    averageCost: avg != null && Number.isFinite(avg) ? roundCost(avg) : null,
    sources: [...new Set(sources)],
    finalQty: qty,
  };
}

function takeMatchingLedger(candidates, usedIds, predicate) {
  const hit = candidates.find((e) => !usedIds.has(e.id) && predicate(e));
  if (hit) usedIds.add(hit.id);
  return hit ?? null;
}

async function collectEventsForProduct(product) {
  const events = [];
  let seq = 0;

  const purchases = await prisma.invoiceItem.findMany({
    where: {
      productId: product.id,
      invoice: { type: 'PURCHASE_INVOICE', status: 'POSTED' },
    },
    include: {
      invoice: { select: { id: true, reference: true, invoiceDate: true, createdAt: true } },
    },
  });
  for (const item of purchases) {
    const qty = Number(item.quantity);
    const unitCost = Number(item.unitPrice);
    if (!(qty > 0) || !(unitCost > 0)) continue;
    const date = item.invoice.invoiceDate ?? item.invoice.createdAt;
    events.push({
      direction: 'IN',
      date: new Date(date),
      seq: seq++,
      id: item.id,
      qty,
      unitCost,
      source: `Purchase Invoice ${item.invoice.reference}`,
    });
  }

  const movements = await prisma.stockMovement.findMany({
    where: { productId: product.id },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });

  const ledgerIns = await prisma.ledgerEntry.findMany({
    where: {
      ledger: { accountId: product.accountId },
      type: 'DEBIT',
      isReversal: false,
      OR: [
        { isOpeningBalance: true, notes: { in: ['Opening Stock', 'Opening Balance'] } },
        {
          isOpeningBalance: false,
          voucherId: null,
          notes: { contains: 'Stock Adjustment' },
        },
      ],
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });

  const usedLedgerIds = new Set();

  for (const m of movements) {
    const qty = movementQty(product.kind, m);
    if (!(qty > 0)) continue;
    const date = new Date(m.date);

    if (m.direction === 'OUT') {
      events.push({
        direction: 'OUT',
        date,
        seq: seq++,
        id: m.id,
        qty,
        unitCost: 0,
        source: `Stock OUT ${m.invoiceReference}`,
      });
      continue;
    }

    const isOpening =
      m.isOpeningStock === true || m.invoiceReference === 'Opening Stock';
    const isAdjustment = m.invoiceReference === 'Stock Adjustment';

    if (isOpening) {
      let entry = takeMatchingLedger(ledgerIns, usedLedgerIds, (e) => {
        if (!e.isOpeningBalance) return false;
        if (!(e.notes === 'Opening Stock' || e.notes === 'Opening Balance')) return false;
        return sameInstant(e.date, m.date);
      });
      if (!entry) {
        entry = takeMatchingLedger(ledgerIns, usedLedgerIds, (e) => {
          if (!e.isOpeningBalance) return false;
          if (!(e.notes === 'Opening Stock' || e.notes === 'Opening Balance')) return false;
          return Math.abs(new Date(e.date).getTime() - date.getTime()) < 86_400_000;
        });
      }
      const amount = entry ? Number(entry.amount) : 0;
      if (!(amount > 0) || !(qty > 0)) continue;
      events.push({
        direction: 'IN',
        date,
        seq: seq++,
        id: m.id,
        qty,
        unitCost: amount / qty,
        source: `Opening Stock (movement #${m.id})`,
      });
      continue;
    }

    if (isAdjustment) {
      const desc = m.description;
      let entry = takeMatchingLedger(ledgerIns, usedLedgerIds, (e) => {
        if (e.isOpeningBalance || e.voucherId != null) return false;
        if (!(e.notes ?? '').includes('Stock Adjustment')) return false;
        if (!sameInstant(e.date, m.date)) return false;
        if (desc) return e.notes === desc;
        return true;
      });
      if (!entry) {
        entry = takeMatchingLedger(ledgerIns, usedLedgerIds, (e) => {
          if (e.isOpeningBalance || e.voucherId != null) return false;
          return (e.notes ?? '').includes('Stock Adjustment') && sameInstant(e.date, m.date);
        });
      }
      if (!entry) continue;
      const amount = Number(entry.amount);
      if (!(amount > 0)) continue;
      events.push({
        direction: 'IN',
        date,
        seq: seq++,
        id: m.id,
        qty,
        unitCost: amount / qty,
        source: `Stock Adjustment (movement #${m.id})`,
      });
    }
  }

  // Any leftover valued stock-in ledger rows without a paired movement (legacy) —
  // cannot form unit cost without qty; skip (ledger÷stock fallback may still help).
  void usedLedgerIds;

  return events;
}

async function ledgerOverStockFallback(product) {
  const [ledger, movements] = await Promise.all([
    prisma.ledger.findUnique({
      where: { accountId: product.accountId },
      select: { balance: true },
    }),
    prisma.stockMovement.findMany({
      where: { productId: product.id },
      select: { direction: true, bags: true, weightKg: true },
    }),
  ]);
  let stockQty = 0;
  for (const m of movements) {
    const q = movementQty(product.kind, m);
    stockQty += m.direction === 'IN' ? q : -q;
  }
  const balance = ledger ? Number(ledger.balance) : 0;
  if (stockQty > 0 && balance > 0) {
    return {
      averageCost: roundCost(balance / stockQty),
      sources: [`Ledger balance / stock qty (${balance.toFixed(2)} / ${stockQty})`],
      finalQty: stockQty,
    };
  }
  return null;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? '(unset)';
  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        databaseUrl: dbUrl,
        note: 'Only Product.averageCost is updated; ledgers/balances are never modified.',
      },
      null,
      2,
    ),
  );

  const products = await prisma.product.findMany({
    where: { averageCost: null },
    select: {
      id: true,
      name: true,
      code: true,
      kind: true,
      accountId: true,
      isActive: true,
    },
    orderBy: { id: 'asc' },
  });

  const toUpdate = [];
  const needsHistory = [];

  for (const product of products) {
    const events = await collectEventsForProduct(product);
    let result = replayWac(events);

    if (result.averageCost == null) {
      const fallback = await ledgerOverStockFallback(product);
      if (fallback) result = fallback;
    }

    if (result.averageCost == null) {
      needsHistory.push({
        productId: product.id,
        name: product.name,
        code: product.code,
        isActive: product.isActive,
        reason:
          'No Opening Stock / Purchase Invoice / Stock Adjustment value history found — needs a Stock Adjustment or Purchase Invoice',
      });
      continue;
    }

    toUpdate.push({
      productId: product.id,
      name: product.name,
      code: product.code,
      kind: product.kind,
      isActive: product.isActive,
      computedAverageCost: result.averageCost,
      derivedFrom: result.sources,
    });
  }

  console.log(
    JSON.stringify(
      {
        nullAverageCostProducts: products.length,
        wouldUpdate: toUpdate.length,
        needsStockInHistory: needsHistory.length,
        updates: toUpdate,
        needsHistory,
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log('\nDry-run only. Re-run with --apply to write Product.averageCost values.');
    return;
  }

  let updated = 0;
  for (const row of toUpdate) {
    await prisma.product.update({
      where: { id: row.productId },
      data: { averageCost: row.computedAverageCost },
    });
    updated += 1;
  }

  console.log(
    JSON.stringify(
      {
        applied: true,
        updated,
        skippedNeedsHistory: needsHistory.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
