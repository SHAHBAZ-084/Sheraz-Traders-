/**
 * One-time repair for production (.exe) and dev:
 * Legacy multi-product Sale/Purchase invoices stored the full combined description
 * on every product (Maal Khata) ledger entry. New posts already write per-product notes.
 *
 * Safety (does NOT harm production balances/ledgers/invoices):
 * - Updates ONLY LedgerEntry.notes
 * - Never touches amounts, balances, vouchers, invoices, stock, or parties
 * - Only product-linked accounts + SALE_INVOICE / PURCHASE_INVOICE
 * - Only when notes look combined ("A+B") and the new single-line text is already
 *   a segment of the old notes (narrowing, never inventing)
 * - Runs once per database (marker file next to the SQLite file); safe to leave
 *   wired into Electron production startup (backend/dist/index.js).
 */
import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import { InvoiceType, VoucherType } from '@prisma/client';
import { getDatabaseFilePath } from '../../lib/database-path';
import { logger } from '../../lib/logger';
import { formatInvoiceProductLinesDescription } from './invoice-voucher-descriptions';

type DbClient = PrismaClient;

const REPAIR_ID = 'product-ledger-desc-v1';

export type ProductLedgerDescriptionBackfillResult = {
  scanned: number;
  updated: number;
  skipped: number;
  alreadyDone: boolean;
};

function markerPath(): string {
  const dbPath = getDatabaseFilePath();
  return path.join(path.dirname(dbPath), `${path.basename(dbPath)}.${REPAIR_ID}.done`);
}

function isRepairAlreadyDone(): boolean {
  try {
    return fs.existsSync(markerPath());
  } catch {
    return false;
  }
}

function markRepairDone(result: Omit<ProductLedgerDescriptionBackfillResult, 'alreadyDone'>) {
  const file = markerPath();
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        id: REPAIR_ID,
        completedAt: new Date().toISOString(),
        ...result,
      },
      null,
      2,
    ),
    'utf8',
  );
}

function looksCombined(notes: string | null | undefined): boolean {
  if (!notes?.trim()) return false;
  return notes.includes('+');
}

/** New notes must already appear as a '+' segment of the old notes (narrowing only). */
function isSafeNarrowing(oldNotes: string, newNotes: string): boolean {
  const oldCore = oldNotes.replace(/\s+\([^)]*\)\s*$/, '').trim();
  if (!newNotes || !oldCore) return false;
  if (oldCore === newNotes) return false; // already single-line
  const segments = oldCore.split('+').map((s) => s.trim()).filter(Boolean);
  return segments.includes(newNotes);
}

/**
 * Idempotent one-time backfill. Safe for production .exe first launch after install/upgrade.
 */
export async function backfillProductLedgerDescriptions(
  db: DbClient,
): Promise<ProductLedgerDescriptionBackfillResult> {
  if (isRepairAlreadyDone()) {
    return { scanned: 0, updated: 0, skipped: 0, alreadyDone: true };
  }

  const entries = await db.ledgerEntry.findMany({
    where: {
      isReversal: false,
      isOpeningBalance: false,
      notes: { contains: '+' },
      voucher: {
        type: { in: [VoucherType.SALE_INVOICE, VoucherType.PURCHASE_INVOICE] },
        status: { not: 'PENDING_APPROVAL' },
      },
      ledger: {
        account: {
          product: { isNot: null },
        },
      },
    },
    select: {
      id: true,
      notes: true,
      voucherId: true,
      ledger: {
        select: {
          account: {
            select: {
              id: true,
              product: { select: { id: true, name: true } },
            },
          },
        },
      },
      voucher: {
        select: {
          id: true,
          type: true,
          description: true,
          invoiceLink: {
            select: {
              invoice: {
                select: {
                  type: true,
                  items: {
                    select: {
                      productId: true,
                      quantity: true,
                      unitPrice: true,
                      label: true,
                      product: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  let updated = 0;
  let skipped = 0;

  for (const entry of entries) {
    const oldNotes = entry.notes?.trim() ?? '';
    if (!looksCombined(oldNotes)) {
      skipped += 1;
      continue;
    }

    const productId = entry.ledger.account.product?.id;
    if (productId == null || entry.voucherId == null) {
      skipped += 1;
      continue;
    }

    const invoice = entry.voucher?.invoiceLink?.invoice;
    if (!invoice) {
      skipped += 1;
      continue;
    }

    if (
      invoice.type !== InvoiceType.SALE_INVOICE
      && invoice.type !== InvoiceType.PURCHASE_INVOICE
    ) {
      skipped += 1;
      continue;
    }

    // Prefer matching the invoice line for this product account.
    const line = invoice.items.find((item) => item.productId === productId);
    if (!line) {
      skipped += 1;
      continue;
    }

    const nextNotes = formatInvoiceProductLinesDescription([
      {
        productName: line.product?.name?.trim() || line.label?.trim() || 'Item',
        quantity: Number(line.quantity),
        rate: Number(line.unitPrice),
      },
    ]);

    if (!isSafeNarrowing(oldNotes, nextNotes)) {
      skipped += 1;
      continue;
    }

    // Preserve a trailing cost-note suffix if present: "A+B (note)" → "A (note)".
    const costNoteMatch = oldNotes.match(/\s+(\([^)]+\))\s*$/);
    const repaired = costNoteMatch ? `${nextNotes} ${costNoteMatch[1]}` : nextNotes;

    // Final guard: only the notes column changes.
    await db.ledgerEntry.update({
      where: { id: entry.id },
      data: { notes: repaired },
    });
    updated += 1;
  }

  const summary = { scanned: entries.length, updated, skipped };
  markRepairDone(summary);

  logger.info('Product ledger description one-time repair finished', {
    repairId: REPAIR_ID,
    ...summary,
    marker: markerPath(),
  });

  return { ...summary, alreadyDone: false };
}
