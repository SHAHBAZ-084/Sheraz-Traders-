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
  storeId: number | null = null,
): Promise<number> {
  const row = await tx.stockRemainder.findFirst({
    where: { productId, bagType, storeId },
  });
  return row ? Number(row.remainderKg) : 0;
}

async function setCarriedRemainderKg(
  tx: Tx,
  productId: number,
  bagType: StockBagType,
  remainderKg: number,
  storeId: number | null = null,
) {
  const existing = await tx.stockRemainder.findFirst({
    where: { productId, bagType, storeId },
  });
  if (existing) {
    await tx.stockRemainder.update({
      where: { id: existing.id },
      data: { remainderKg },
    });
    return;
  }
  await tx.stockRemainder.create({
    data: { productId, bagType, storeId, remainderKg },
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
      throw new AppError(400, 'Sale Paunch line product ledger is not linked to an active product');
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
  storeId?: number | null;
}) {
  const product = await prisma.product.findFirst({
    where: { id: params.productId, isActive: true },
  });
  if (!product) throw new AppError(404, 'Product not found');

  const bagType = toStockBagType(params.bagType);
  const storeId = params.storeId != null && params.storeId > 0 ? params.storeId : undefined;
  const movements = await prisma.stockMovement.findMany({
    where: {
      productId: params.productId,
      bagType,
      ...(storeId != null ? { storeId } : {}),
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });

  const remainder = await prisma.stockRemainder.findFirst({
    where: {
      productId: params.productId,
      bagType,
      storeId: storeId ?? null,
    },
  });

  let running = 0;
  let totalIn = 0;
  let totalOut = 0;
  let saleInvoiceTotal = 0;
  let purchaseInvoiceTotal = 0;
  const rows = movements.map((m) => {
    const bags = Number(m.bags);
    if (m.direction === StockDirection.IN) {
      running += bags;
      totalIn += bags;
      if (m.invoiceType === InvoiceType.PURCHASE_INVOICE) purchaseInvoiceTotal += bags;
    } else {
      running -= bags;
      totalOut += bags;
      if (m.invoiceType === InvoiceType.SALE_INVOICE) saleInvoiceTotal += bags;
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
    storeId: storeId ?? null,
    trackingStartedAt: STOCK_TRACKING_STARTED_AT.toISOString(),
    /** Historical invoices before stock feature ship are not backfilled. */
    historicalBackfill: false as const,
    carriedRemainderKg: remainder ? Number(remainder.remainderKg) : 0,
    rows,
    totals: {
      totalIn,
      totalOut,
      netBalance: running,
      saleInvoiceQty: saleInvoiceTotal,
      purchaseInvoiceQty: purchaseInvoiceTotal,
    },
  };
}

/** Products that have at least one stock movement in the given store. */
export async function listProductsByStore(storeId: number) {
  const store = await prisma.store.findFirst({ where: { id: storeId } });
  if (!store) throw new AppError(404, 'Store not found');

  const grouped = await prisma.stockMovement.groupBy({
    by: ['productId'],
    where: { storeId },
  });
  if (grouped.length === 0) return [];

  return prisma.product.findMany({
    where: {
      isActive: true,
      id: { in: grouped.map((g) => g.productId) },
    },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  });
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
    select: { productId: true, bagType: true, direction: true, bags: true, invoiceType: true },
  });

  const nets = new Map<
    number,
    { bori: number; thela: number; saleInvoiceQty: number; purchaseInvoiceQty: number }
  >();
  for (const m of movements) {
    const row = nets.get(m.productId) ?? {
      bori: 0,
      thela: 0,
      saleInvoiceQty: 0,
      purchaseInvoiceQty: 0,
    };
    const bags = Number(m.bags);
    const signed = m.direction === StockDirection.IN ? bags : -bags;
    if (m.bagType === StockBagType.THELA) row.thela += signed;
    else row.bori += signed;
    if (m.invoiceType === InvoiceType.SALE_INVOICE && m.direction === StockDirection.OUT) {
      row.saleInvoiceQty += bags;
    }
    if (m.invoiceType === InvoiceType.PURCHASE_INVOICE && m.direction === StockDirection.IN) {
      row.purchaseInvoiceQty += bags;
    }
    nets.set(m.productId, row);
  }

  return products
    .map((p) => {
      const net = nets.get(p.id) ?? {
        bori: 0,
        thela: 0,
        saleInvoiceQty: 0,
        purchaseInvoiceQty: 0,
      };
      return {
        productId: p.id,
        name: p.name,
        code: p.code,
        bori: net.bori,
        thela: net.thela,
        saleInvoiceQty: net.saleInvoiceQty,
        purchaseInvoiceQty: net.purchaseInvoiceQty,
      };
    })
    .filter(
      (p) =>
        p.bori !== 0 ||
        p.thela !== 0 ||
        p.saleInvoiceQty !== 0 ||
        p.purchaseInvoiceQty !== 0,
    );
}

/** Store-scoped bag balances for Sale Invoice / Purchase Invoice stock only. */
export async function getStockByStore(storeId: number) {
  const store = await prisma.store.findFirst({ where: { id: storeId } });
  if (!store) throw new AppError(404, 'Store not found');

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  });
  if (products.length === 0) {
    return { store: { id: store.id, name: store.name }, products: [] };
  }

  const movements = await prisma.stockMovement.findMany({
    where: {
      storeId,
      productId: { in: products.map((p) => p.id) },
      invoiceType: { in: [InvoiceType.SALE_INVOICE, InvoiceType.PURCHASE_INVOICE] },
    },
    select: { productId: true, bagType: true, direction: true, bags: true, invoiceType: true },
  });

  const nets = new Map<
    number,
    { bori: number; thela: number; saleInvoiceQty: number; purchaseInvoiceQty: number }
  >();
  for (const m of movements) {
    const row = nets.get(m.productId) ?? {
      bori: 0,
      thela: 0,
      saleInvoiceQty: 0,
      purchaseInvoiceQty: 0,
    };
    const bags = Number(m.bags);
    const signed = m.direction === StockDirection.IN ? bags : -bags;
    if (m.bagType === StockBagType.THELA) row.thela += signed;
    else row.bori += signed;
    if (m.invoiceType === InvoiceType.SALE_INVOICE && m.direction === StockDirection.OUT) {
      row.saleInvoiceQty += bags;
    }
    if (m.invoiceType === InvoiceType.PURCHASE_INVOICE && m.direction === StockDirection.IN) {
      row.purchaseInvoiceQty += bags;
    }
    nets.set(m.productId, row);
  }

  return {
    store: { id: store.id, name: store.name },
    products: products
      .map((p) => {
        const net = nets.get(p.id) ?? {
          bori: 0,
          thela: 0,
          saleInvoiceQty: 0,
          purchaseInvoiceQty: 0,
        };
        return {
          productId: p.id,
          name: p.name,
          code: p.code,
          bori: net.bori,
          thela: net.thela,
          saleInvoiceQty: net.saleInvoiceQty,
          purchaseInvoiceQty: net.purchaseInvoiceQty,
        };
      })
      .filter(
        (p) =>
          p.bori !== 0 ||
          p.thela !== 0 ||
          p.saleInvoiceQty !== 0 ||
          p.purchaseInvoiceQty !== 0,
      ),
  };
}

/**
 * Net stock balance (IN − OUT) for a product.
 * When `storeId` is a positive number, only movements for that exact store count —
 * stock in other stores is never included. No movements at that store → 0.
 * When `storeId` is omitted/null, sums across all movements for the product.
 */
export async function getCurrentStockBalance(
  productId: number,
  storeId?: number | null,
  db: Tx | typeof prisma = prisma,
): Promise<number> {
  const scopedStoreId = storeId != null && storeId > 0 ? storeId : undefined;
  const movements = await db.stockMovement.findMany({
    where: {
      productId,
      ...(scopedStoreId != null ? { storeId: scopedStoreId } : {}),
    },
    select: { direction: true, bags: true },
  });

  let balance = 0;
  for (const m of movements) {
    const bags = Number(m.bags);
    balance += m.direction === StockDirection.IN ? bags : -bags;
  }
  return balance;
}

/** Stock OUT for Sale Invoice — quantity treated as whole BORI bags. New helper; does not alter Paunch/Maal stock posts. */
export async function postSaleInvoiceStockOut(
  tx: Tx,
  data: {
    invoiceId: number;
    invoiceReference: string;
    invoiceDate: Date;
    storeId: number;
    lines: Array<{ productId: number; quantity: number }>;
  },
) {
  for (const line of data.lines) {
    const bagsOut = Number(line.quantity);
    if (!(bagsOut > 0)) continue;

    const product = await tx.product.findFirst({ where: { id: line.productId, isActive: true } });
    if (!product) throw new AppError(400, `Product #${line.productId} not found`);

    await tx.stockMovement.create({
      data: {
        productId: product.id,
        bagType: StockBagType.BORI,
        storeId: data.storeId,
        direction: StockDirection.OUT,
        bags: bagsOut,
        date: data.invoiceDate,
        invoiceId: data.invoiceId,
        invoiceType: InvoiceType.SALE_INVOICE,
        invoiceReference: data.invoiceReference,
        description: data.invoiceReference,
      },
    });
  }
}

/** Stock IN for Purchase Invoice — quantity treated as whole BORI bags. New helper; does not alter Purchase Maal stock posts. */
export async function postPurchaseInvoiceStockIn(
  tx: Tx,
  data: {
    invoiceId: number;
    invoiceReference: string;
    invoiceDate: Date;
    storeId: number;
    lines: Array<{ productId: number; quantity: number }>;
  },
) {
  for (const line of data.lines) {
    const bagsIn = Number(line.quantity);
    if (!(bagsIn > 0)) continue;

    const product = await tx.product.findFirst({ where: { id: line.productId, isActive: true } });
    if (!product) throw new AppError(400, `Product #${line.productId} not found`);

    await tx.stockMovement.create({
      data: {
        productId: product.id,
        bagType: StockBagType.BORI,
        storeId: data.storeId,
        direction: StockDirection.IN,
        bags: bagsIn,
        date: data.invoiceDate,
        invoiceId: data.invoiceId,
        invoiceType: InvoiceType.PURCHASE_INVOICE,
        invoiceReference: data.invoiceReference,
        description: data.invoiceReference,
      },
    });
  }
}

