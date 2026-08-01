import {
  BoriThelaMode,
  InvoiceType,
  Prisma,
  StockBagType,
  StockDirection,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import {
  STOCK_TRACKING_STARTED_AT,
  bagTypeFromMode,
  computeStockInFromRow,
  computeStockOutBags,
  type StockBagKind,
} from './stock.calculations';

type Tx = Prisma.TransactionClient;

function toStockBagType(kind: StockBagKind): StockBagType {
  return kind === 'THELA' ? StockBagType.THELA : StockBagType.BORI;
}

async function getCarriedRemainderKg(
  tx: Tx,
  productId: number,
  bagType: StockBagType,
): Promise<number> {
  const row = await tx.stockRemainder.findUnique({
    where: { productId_bagType: { productId, bagType } },
  });
  return row ? Number(row.remainderKg) : 0;
}

async function setCarriedRemainderKg(
  tx: Tx,
  productId: number,
  bagType: StockBagType,
  remainderKg: number,
) {
  await tx.stockRemainder.upsert({
    where: { productId_bagType: { productId, bagType } },
    create: { productId, bagType, remainderKg },
    update: { remainderKg },
  });
}

export type PurchaseMaalStockLine = {
  boriOrThelaMode: BoriThelaMode;
  bagCount: number;
  bhartii: number;
  dharanCount: number;
  looseKg: number;
};

/** Post Stock IN movements for a Purchase to Maal invoice (same DB transaction). */
export async function postPurchaseMaalStockIn(
  tx: Tx,
  data: {
    productId: number;
    invoiceId: number;
    invoiceReference: string;
    invoiceDate: Date;
    lines: PurchaseMaalStockLine[];
  },
) {
  const remainders = new Map<StockBagType, number>();

  for (const line of data.lines) {
    const bagType = toStockBagType(bagTypeFromMode(line.boriOrThelaMode));
    if (!remainders.has(bagType)) {
      remainders.set(bagType, await getCarriedRemainderKg(tx, data.productId, bagType));
    }

    const carried = remainders.get(bagType) ?? 0;
    const result = computeStockInFromRow({
      wholeBags: Number(line.bagCount),
      dharanCount: Number(line.dharanCount),
      looseKg: Number(line.looseKg),
      bhartii: Number(line.bhartii),
      carriedRemainderKg: carried,
    });

    remainders.set(bagType, result.newRemainderKg);

    if (!(result.bagsIn > 0)) continue;

    await tx.stockMovement.create({
      data: {
        productId: data.productId,
        bagType,
        direction: StockDirection.IN,
        bags: result.bagsIn,
        date: data.invoiceDate,
        invoiceId: data.invoiceId,
        invoiceType: InvoiceType.PURCHASE_MAAL,
        invoiceReference: data.invoiceReference,
        description: data.invoiceReference,
      },
    });
  }

  for (const [bagType, remainderKg] of remainders) {
    await setCarriedRemainderKg(tx, data.productId, bagType, remainderKg);
  }
}

export type SalePaunchStockLine = {
  maalKhataAccountId: number;
  boriOrThelaMode: BoriThelaMode;
  bagCount: number;
  thelaCount: number;
};

/** Post Stock OUT movements for a Sale on Paunch invoice (same DB transaction). */
export async function postSalePaunchStockOut(
  tx: Tx,
  data: {
    invoiceId: number;
    invoiceReference: string;
    invoiceDate: Date;
    lines: SalePaunchStockLine[];
  },
) {
  for (const line of data.lines) {
    const product = await tx.product.findFirst({
      where: { accountId: line.maalKhataAccountId, isActive: true },
    });
    if (!product) {
      throw new AppError(400, 'Sale Paunch line Maal Khata is not linked to an active product');
    }

    const kind = bagTypeFromMode(line.boriOrThelaMode);
    const bagsOut = computeStockOutBags(line.bagCount, line.thelaCount, kind);
    if (!(bagsOut > 0)) continue;

    await tx.stockMovement.create({
      data: {
        productId: product.id,
        bagType: toStockBagType(kind),
        direction: StockDirection.OUT,
        bags: bagsOut,
        date: data.invoiceDate,
        invoiceId: data.invoiceId,
        invoiceType: InvoiceType.SALE_PAUNCH,
        invoiceReference: data.invoiceReference,
        description: data.invoiceReference,
      },
    });
  }
}

export async function getStockReport(params: {
  productId: number;
  bagType: 'BORI' | 'THELA';
}) {
  const product = await prisma.product.findFirst({
    where: { id: params.productId, isActive: true },
  });
  if (!product) throw new AppError(404, 'Product not found');

  const bagType = toStockBagType(params.bagType);
  const movements = await prisma.stockMovement.findMany({
    where: { productId: params.productId, bagType },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });

  const remainder = await prisma.stockRemainder.findUnique({
    where: { productId_bagType: { productId: params.productId, bagType } },
  });

  let running = 0;
  let totalIn = 0;
  let totalOut = 0;
  const rows = movements.map((m) => {
    const bags = Number(m.bags);
    if (m.direction === StockDirection.IN) {
      running += bags;
      totalIn += bags;
    } else {
      running -= bags;
      totalOut += bags;
    }
    return {
      id: m.id,
      date: m.date.toISOString(),
      description: m.description ?? m.invoiceReference,
      invoiceReference: m.invoiceReference,
      invoiceType: m.invoiceType,
      status: m.direction as 'IN' | 'OUT',
      bags,
      runningBalance: running,
    };
  });

  return {
    product: { id: product.id, name: product.name, code: product.code },
    bagType: params.bagType,
    trackingStartedAt: STOCK_TRACKING_STARTED_AT.toISOString(),
    /** Historical invoices before stock feature ship are not backfilled. */
    historicalBackfill: false as const,
    carriedRemainderKg: remainder ? Number(remainder.remainderKg) : 0,
    rows,
    totals: {
      totalIn,
      totalOut,
      netBalance: running,
    },
  };
}

/** Net Bori/Thela bag balances per product for dashboard glance. */
export async function getProductStockBalances() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  });
  if (products.length === 0) return [];

  const movements = await prisma.stockMovement.findMany({
    where: { productId: { in: products.map((p) => p.id) } },
    select: { productId: true, bagType: true, direction: true, bags: true },
  });

  const nets = new Map<number, { bori: number; thela: number }>();
  for (const m of movements) {
    const row = nets.get(m.productId) ?? { bori: 0, thela: 0 };
    const bags = Number(m.bags);
    const signed = m.direction === StockDirection.IN ? bags : -bags;
    if (m.bagType === StockBagType.THELA) row.thela += signed;
    else row.bori += signed;
    nets.set(m.productId, row);
  }

  return products
    .map((p) => {
      const net = nets.get(p.id) ?? { bori: 0, thela: 0 };
      return {
        productId: p.id,
        name: p.name,
        code: p.code,
        bori: net.bori,
        thela: net.thela,
      };
    })
    .filter((p) => p.bori !== 0 || p.thela !== 0);
}
