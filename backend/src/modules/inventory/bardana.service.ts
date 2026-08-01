import {
  BoriThelaMode,
  EmptyBardanaDirection,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';

type Tx = Prisma.TransactionClient;

export type EmptyBardanaBagKind = 'BORI' | 'THELA';

const BAG_TYPES: BoriThelaMode[] = [BoriThelaMode.BORI, BoriThelaMode.THELA];

function toBagType(kind: EmptyBardanaBagKind | BoriThelaMode): BoriThelaMode {
  return kind === 'THELA' ? BoriThelaMode.THELA : BoriThelaMode.BORI;
}

async function ensureBalances(tx: Tx | typeof prisma = prisma) {
  for (const bagType of BAG_TYPES) {
    await tx.emptyBardanaBalance.upsert({
      where: { bagType },
      create: { bagType, balance: 0 },
      update: {},
    });
  }
}

async function adjustBalance(
  tx: Tx,
  data: {
    bagType: BoriThelaMode;
    qty: number;
    direction: EmptyBardanaDirection;
    date: Date;
    source: string;
    description?: string | null;
    invoiceId?: number | null;
  },
) {
  const qty = Math.max(0, Number(data.qty) || 0);
  if (!(qty > 0)) return;

  await ensureBalances(tx);

  const delta = data.direction === EmptyBardanaDirection.IN ? qty : -qty;
  const current = await tx.emptyBardanaBalance.findUniqueOrThrow({
    where: { bagType: data.bagType },
  });
  const nextBalance = Number(current.balance) + delta;

  await tx.emptyBardanaBalance.update({
    where: { bagType: data.bagType },
    data: { balance: nextBalance },
  });

  await tx.emptyBardanaMovement.create({
    data: {
      bagType: data.bagType,
      direction: data.direction,
      qty,
      date: data.date,
      source: data.source,
      description: data.description ?? null,
      invoiceId: data.invoiceId ?? null,
    },
  });
}

export async function getEmptyBardanaReport() {
  await ensureBalances();

  const [balances, movements] = await Promise.all([
    prisma.emptyBardanaBalance.findMany({
      orderBy: { bagType: 'asc' },
    }),
    prisma.emptyBardanaMovement.findMany({
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: 200,
    }),
  ]);

  return {
    balances: BAG_TYPES.map((bagType) => {
      const row = balances.find((b) => b.bagType === bagType);
      return {
        bagType: bagType as EmptyBardanaBagKind,
        balance: row ? Number(row.balance) : 0,
      };
    }),
    movements: movements.map((m) => ({
      id: m.id,
      date: m.date.toISOString(),
      bagType: m.bagType as EmptyBardanaBagKind,
      direction: m.direction as 'IN' | 'OUT',
      qty: Number(m.qty),
      source: m.source,
      description: m.description,
      invoiceId: m.invoiceId,
    })),
  };
}

/** Manual top-up of empty Bori or Thela bags. */
export async function addEmptyBardana(data: {
  bagType: EmptyBardanaBagKind;
  quantity: number;
}) {
  const quantity = Number(data.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new AppError(400, 'Quantity must be greater than zero');
  }

  const bagType = toBagType(data.bagType);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await adjustBalance(tx, {
      bagType,
      qty: quantity,
      direction: EmptyBardanaDirection.IN,
      date: now,
      source: 'MANUAL',
      description: 'Manual add',
    });
  });

  return getEmptyBardanaReport();
}

export type EmptyBardanaSalePaunchLine = {
  boriOrThelaMode: BoriThelaMode;
  bagCount: number;
  thelaCount: number;
};

/** Sale on Paunch: always reduce empty bags by the row's Bori/Thela count. */
export async function postSalePaunchEmptyBardanaOut(
  tx: Tx,
  data: {
    invoiceId: number;
    invoiceReference: string;
    invoiceDate: Date;
    lines: EmptyBardanaSalePaunchLine[];
  },
) {
  for (const line of data.lines) {
    const bagType = toBagType(line.boriOrThelaMode);
    const qty = Math.max(
      0,
      Number(bagType === BoriThelaMode.THELA ? line.thelaCount : line.bagCount) || 0,
    );
    if (!(qty > 0)) continue;

    await adjustBalance(tx, {
      bagType,
      qty,
      direction: EmptyBardanaDirection.OUT,
      date: data.invoiceDate,
      source: 'SALE_PAUNCH',
      description: data.invoiceReference,
      invoiceId: data.invoiceId,
    });
  }
}

/** Reverse empty-bardana OUT rows posted by a Sale Paunch invoice (restore bags). */
export async function reverseSalePaunchEmptyBardana(
  tx: Tx,
  data: { invoiceId: number; invoiceReference: string; invoiceDate: Date },
) {
  const originals = await tx.emptyBardanaMovement.findMany({
    where: {
      invoiceId: data.invoiceId,
      source: 'SALE_PAUNCH',
      description: { not: { startsWith: 'Reversal —' } },
    },
    orderBy: { id: 'asc' },
  });

  const alreadyReversed = await tx.emptyBardanaMovement.findFirst({
    where: {
      invoiceId: data.invoiceId,
      description: { startsWith: 'Reversal —' },
    },
  });
  if (alreadyReversed) return;

  for (const m of originals) {
    const opposite =
      m.direction === EmptyBardanaDirection.OUT
        ? EmptyBardanaDirection.IN
        : EmptyBardanaDirection.OUT;
    await adjustBalance(tx, {
      bagType: m.bagType,
      qty: Number(m.qty),
      direction: opposite,
      date: data.invoiceDate,
      source: 'SALE_PAUNCH',
      description: `Reversal — ${data.invoiceReference}`,
      invoiceId: data.invoiceId,
    });
  }
}
