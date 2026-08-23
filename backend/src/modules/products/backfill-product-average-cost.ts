/**
 * Idempotent repair of Product.averageCost from real stock-in history
 * (Opening Stock, posted Purchase Invoices, approved Stock Adjustments).
 *
 * Safety: updates Product.averageCost only — never ledgers, vouchers, balances, or stock qty.
 * Safe to run on every app start: products that already have averageCost are skipped.
 */
import type { PrismaClient, ProductKind } from '@prisma/client';
import { logger } from '../../lib/logger';

type DbClient = PrismaClient;

export type AverageCostBackfillUpdate = {
  productId: number;
  name: string;
  code: string;
  kind: ProductKind;
  isActive: boolean;
  computedAverageCost: number;
  derivedFrom: string[];
};

export type AverageCostBackfillResult = {
  nullAverageCostProducts: number;
  updated: number;
  skippedNeedsHistory: number;
  updates: AverageCostBackfillUpdate[];
  needsHistory: Array<{
    productId: number;
    name: string;
    code: string;
    isActive: boolean;
    reason: string;
  }>;
};

type StockEvent = {
  direction: 'IN' | 'OUT';
  date: Date;
  seq: number;
  id: number;
  qty: number;
  unitCost: number;
  source: string;
};

function roundCost(n: number) {
  return Math.round(Number(n) * 1e8) / 1e8;
}

function sameInstant(a: Date | string, b: Date | string) {
  return new Date(a).getTime() === new Date(b).getTime();
}

function movementQty(
  productKind: ProductKind,
  movement: { bags: unknown; weightKg: unknown },
) {
  if (productKind === 'KACHI' && movement.weightKg != null) {
    return Number(movement.weightKg);
  }
  return Number(movement.bags);
}

/** Same WAC rule as addStandardStockToProductInTx / purchase posting. */
export function replayWac(events: StockEvent[]) {
  let qty = 0;
  let avg: number | null = null;
  const sources: string[] = [];

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

function takeMatchingLedger<T extends { id: number }>(
  candidates: T[],
  usedIds: Set<number>,
  predicate: (e: T) => boolean,
) {
  const hit = candidates.find((e) => !usedIds.has(e.id) && predicate(e));
  if (hit) usedIds.add(hit.id);
  return hit ?? null;
}

async function collectEventsForProduct(
  db: DbClient,
  product: { id: number; kind: ProductKind; accountId: number },
) {
  const events: StockEvent[] = [];
  let seq = 0;

  const purchases = await db.invoiceItem.findMany({
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

  const movements = await db.stockMovement.findMany({
    where: { productId: product.id },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });

  const ledgerIns = await db.ledgerEntry.findMany({
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

  const usedLedgerIds = new Set<number>();

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

    const isOpening = m.isOpeningStock === true || m.invoiceReference === 'Opening Stock';
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

  return events;
}

async function ledgerOverStockFallback(
  db: DbClient,
  product: { id: number; kind: ProductKind; accountId: number },
) {
  const [ledger, movements] = await Promise.all([
    db.ledger.findUnique({
      where: { accountId: product.accountId },
      select: { balance: true },
    }),
    db.stockMovement.findMany({
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

/** Preview what would be updated without writing (for CLI dry-run). */
export async function planProductAverageCostBackfill(
  db: DbClient,
): Promise<Omit<AverageCostBackfillResult, 'updated'> & { wouldUpdate: number }> {
  const products = await db.product.findMany({
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

  const updates: AverageCostBackfillUpdate[] = [];
  const needsHistory: AverageCostBackfillResult['needsHistory'] = [];

  for (const product of products) {
    const events = await collectEventsForProduct(db, product);
    let result = replayWac(events);

    if (result.averageCost == null) {
      const fallback = await ledgerOverStockFallback(db, product);
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

    updates.push({
      productId: product.id,
      name: product.name,
      code: product.code,
      kind: product.kind,
      isActive: product.isActive,
      computedAverageCost: result.averageCost,
      derivedFrom: result.sources,
    });
  }

  return {
    nullAverageCostProducts: products.length,
    wouldUpdate: updates.length,
    skippedNeedsHistory: needsHistory.length,
    updates,
    needsHistory,
  };
}

/**
 * Apply averageCost for products where it is still null and history exists.
 * Idempotent: already-set products are not touched; second run is a fast no-op when none are null.
 */
export async function backfillNullProductAverageCosts(
  db: DbClient,
): Promise<AverageCostBackfillResult> {
  const plan = await planProductAverageCostBackfill(db);

  let updated = 0;
  for (const row of plan.updates) {
    await db.product.update({
      where: { id: row.productId },
      data: { averageCost: row.computedAverageCost },
    });
    updated += 1;
  }

  if (updated > 0) {
    logger.info('Product averageCost backfill applied', {
      updated,
      skippedNeedsHistory: plan.skippedNeedsHistory,
      scannedNull: plan.nullAverageCostProducts,
    });
  }

  return {
    nullAverageCostProducts: plan.nullAverageCostProducts,
    updated,
    skippedNeedsHistory: plan.skippedNeedsHistory,
    updates: plan.updates,
    needsHistory: plan.needsHistory,
  };
}
