import { InvoiceStatus, InvoiceType, Prisma, ProductKind, StockDirection } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { SELECTABLE_PRODUCT } from '../../lib/record-status';
import { formatWeightMaundKg } from '../invoices/kachi-maal.calculations';
import { STOCK_TRACKING_STARTED_AT } from './stock.calculations';

type Tx = Prisma.TransactionClient;

type ActiveProductRef = { id: number; name: string };

function movementDelta(
  m: { direction: StockDirection; bags: unknown; weightKg: unknown | null },
  kind: ProductKind,
): number {
  const qty =
    kind === ProductKind.KACHI && m.weightKg != null ? Number(m.weightKg) : Number(m.bags);
  return m.direction === StockDirection.IN ? qty : -qty;
}

function formatStockQuantity(qty: number, kind: ProductKind): string {
  if (kind === ProductKind.KACHI) return formatWeightMaundKg(qty);
  return String(qty);
}

/** Net stock (IN − OUT) for many products in one query — used by product browse lists. */
export async function getCurrentStockBalancesForProducts(
  products: Array<{ id: number; kind: ProductKind }>,
  storeId?: number | null,
  db: Tx | typeof prisma = prisma,
): Promise<Map<number, number>> {
  const productIds = products.map((p) => p.id);
  const balances = new Map<number, number>();
  if (productIds.length === 0) return balances;

  for (const id of productIds) balances.set(id, 0);
  const kindById = new Map(products.map((p) => [p.id, p.kind]));

  const scopedStoreId = storeId != null && storeId > 0 ? storeId : undefined;
  const movements = await db.stockMovement.findMany({
    where: {
      productId: { in: productIds },
      ...(scopedStoreId != null ? { storeId: scopedStoreId } : {}),
    },
    select: { productId: true, direction: true, bags: true, weightKg: true },
  });

  for (const m of movements) {
    const kind = kindById.get(m.productId) ?? ProductKind.STANDARD;
    const delta = movementDelta(m, kind);
    balances.set(m.productId, (balances.get(m.productId) ?? 0) + delta);
  }

  return balances;
}

async function loadActiveProductsForLines(
  tx: Tx,
  lines: Array<{ productId: number; quantity: number }>,
): Promise<Map<number, ActiveProductRef>> {
  const productIds = [
    ...new Set(
      lines
        .filter((line) => Number(line.quantity) > 0)
        .map((line) => line.productId),
    ),
  ];
  if (productIds.length === 0) {
    return new Map();
  }

  const products = await tx.product.findMany({
    where: { id: { in: productIds }, ...SELECTABLE_PRODUCT },
    select: { id: true, name: true },
  });
  return new Map(products.map((product) => [product.id, product]));
}

export async function getStockReport(params: {
  productId: number;
  storeId?: number | null;
  limit?: number;
  offset?: number;
}) {
  const product = await prisma.product.findFirst({
    where: { id: params.productId, ...SELECTABLE_PRODUCT },
    select: { id: true, name: true, code: true, kind: true },
  });
  if (!product) throw new AppError(404, 'Product not found');

  const storeId = params.storeId != null && params.storeId > 0 ? params.storeId : undefined;
  const where = {
    productId: params.productId,
    ...(storeId != null ? { storeId } : {}),
  };

  const total = await prisma.stockMovement.count({ where });
  const movements = await prisma.stockMovement.findMany({
    where,
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    ...(params.limit != null ? { skip: params.offset ?? 0, take: params.limit } : {}),
  });

  const remainder = await prisma.stockRemainder.aggregate({
    where: {
      productId: params.productId,
      storeId: storeId ?? null,
    },
    _sum: { remainderKg: true },
  });

  let running = 0;
  let totalIn = 0;
  let totalOut = 0;
  let saleInvoiceTotal = 0;
  let purchaseInvoiceTotal = 0;
  const isKachi = product.kind === ProductKind.KACHI;
  const rows = movements.map((m) => {
    const qty =
      isKachi && m.weightKg != null ? Number(m.weightKg) : Number(m.bags);
    if (m.direction === StockDirection.IN) {
      running += qty;
      totalIn += qty;
    } else {
      running -= qty;
      totalOut += qty;
    }
    if (m.invoiceType === InvoiceType.SALE_INVOICE && m.direction === StockDirection.OUT) {
      saleInvoiceTotal += qty;
    }
    if (m.invoiceType === InvoiceType.PURCHASE_INVOICE && m.direction === StockDirection.IN) {
      purchaseInvoiceTotal += qty;
    }
    return {
      id: m.id,
      date: m.date.toISOString(),
      description: m.description ?? m.invoiceReference,
      invoiceReference: m.invoiceReference,
      invoiceType: m.invoiceType,
      status: m.direction,
      bags: Number(m.bags),
      weightKg: m.weightKg != null ? Number(m.weightKg) : null,
      quantity: qty,
      quantityDisplay: formatStockQuantity(qty, product.kind),
      runningBalance: running,
      runningBalanceDisplay: formatStockQuantity(running, product.kind),
    };
  });

  return {
    product: { id: product.id, name: product.name, code: product.code, kind: product.kind },
    storeId: storeId ?? null,
    trackingStartedAt: STOCK_TRACKING_STARTED_AT.toISOString(),
    historicalBackfill: false as const,
    carriedRemainderKg: remainder._sum.remainderKg ? Number(remainder._sum.remainderKg) : 0,
    totalCount: total,
    rows,
    totals: {
      totalIn,
      totalOut,
      netBalance: running,
      saleInvoiceQty: saleInvoiceTotal,
      purchaseInvoiceQty: purchaseInvoiceTotal,
      netBalanceDisplay: formatStockQuantity(running, product.kind),
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

  const productIds = grouped.map((g) => g.productId);
  return prisma.product.findMany({
    where: { id: { in: productIds }, ...SELECTABLE_PRODUCT },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  });
}

export async function getStockSummary() {
  const products = await prisma.product.findMany({
    where: { ...SELECTABLE_PRODUCT },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  });
  if (products.length === 0) return [];

  const movements = await prisma.stockMovement.findMany({
    where: {
      productId: { in: products.map((p) => p.id) },
      invoiceType: { in: [InvoiceType.SALE_INVOICE, InvoiceType.PURCHASE_INVOICE] },
    },
    select: { productId: true, direction: true, bags: true, invoiceType: true },
  });

  const nets = new Map<
    number,
    { totalQty: number; saleInvoiceQty: number; purchaseInvoiceQty: number }
  >();
  for (const m of movements) {
    const row = nets.get(m.productId) ?? {
      totalQty: 0,
      saleInvoiceQty: 0,
      purchaseInvoiceQty: 0,
    };
    const bags = Number(m.bags);
    const signed = m.direction === StockDirection.IN ? bags : -bags;
    row.totalQty += signed;
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
        totalQty: 0,
        saleInvoiceQty: 0,
        purchaseInvoiceQty: 0,
      };
      return {
        productId: p.id,
        name: p.name,
        code: p.code,
        totalQty: net.totalQty,
        saleInvoiceQty: net.saleInvoiceQty,
        purchaseInvoiceQty: net.purchaseInvoiceQty,
      };
    })
    .filter(
      (p) =>
        p.totalQty !== 0 ||
        p.saleInvoiceQty !== 0 ||
        p.purchaseInvoiceQty !== 0,
    );
}

export type StockQuantityProductRow = {
  productId: number;
  name: string;
  code: string;
  unit: string | null;
  totalQty: number;
  saleInvoiceQty: number;
  purchaseInvoiceQty: number;
};

async function loadSalePurchaseStockRows(options: {
  storeId?: number;
  categoryId?: number;
}): Promise<StockQuantityProductRow[]> {
  const products = await prisma.product.findMany({
    where: {
      ...SELECTABLE_PRODUCT,
      ...(options.categoryId != null ? { categoryId: options.categoryId } : {}),
    },
    select: { id: true, name: true, code: true, unit: true },
    orderBy: { name: 'asc' },
  });
  if (products.length === 0) return [];

  const movements = await prisma.stockMovement.findMany({
    where: {
      ...(options.storeId != null ? { storeId: options.storeId } : {}),
      productId: { in: products.map((p) => p.id) },
      invoiceType: { in: [InvoiceType.SALE_INVOICE, InvoiceType.PURCHASE_INVOICE] },
    },
    select: { productId: true, direction: true, bags: true, invoiceType: true },
  });

  const nets = new Map<
    number,
    { totalQty: number; saleInvoiceQty: number; purchaseInvoiceQty: number }
  >();
  for (const m of movements) {
    const row = nets.get(m.productId) ?? {
      totalQty: 0,
      saleInvoiceQty: 0,
      purchaseInvoiceQty: 0,
    };
    const bags = Number(m.bags);
    const signed = m.direction === StockDirection.IN ? bags : -bags;
    row.totalQty += signed;
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
        totalQty: 0,
        saleInvoiceQty: 0,
        purchaseInvoiceQty: 0,
      };
      return {
        productId: p.id,
        name: p.name,
        code: p.code,
        unit: p.unit,
        totalQty: net.totalQty,
        saleInvoiceQty: net.saleInvoiceQty,
        purchaseInvoiceQty: net.purchaseInvoiceQty,
      };
    })
    .filter(
      (p) =>
        p.totalQty !== 0 ||
        p.saleInvoiceQty !== 0 ||
        p.purchaseInvoiceQty !== 0,
    );
}

function optionalPositiveId(value?: number | null): number | undefined {
  return value != null && value > 0 ? value : undefined;
}

/** Store-scoped bag balances for Sale Invoice / Purchase Invoice stock only. */
export async function getStockByStore(storeId: number, categoryId?: number) {
  const store = await prisma.store.findFirst({ where: { id: storeId } });
  if (!store) throw new AppError(404, 'Store not found');

  return {
    store: { id: store.id, name: store.name },
    products: await loadSalePurchaseStockRows({
      storeId,
      categoryId: optionalPositiveId(categoryId),
    }),
  };
}

export async function getStockQuantityReport(params: {
  storeId?: number | null;
  categoryId?: number | null;
}) {
  const storeId = optionalPositiveId(params.storeId);
  const categoryId = optionalPositiveId(params.categoryId);

  if (storeId != null) {
    const result = await getStockByStore(storeId, categoryId);
    return {
      storeId: result.store.id,
      storeName: result.store.name,
      categoryId: categoryId ?? null,
      products: result.products,
    };
  }

  return {
    storeId: null,
    storeName: null,
    categoryId: categoryId ?? null,
    products: await loadSalePurchaseStockRows({ categoryId }),
  };
}

export async function getStockValueReport(params: {
  date: string;
  storeId?: number | null;
  categoryId?: number | null;
}) {
  const { getAccountBalancesAsOf } = await import('../accounting/accounting.service');
  const storeId = optionalPositiveId(params.storeId);
  const categoryId = optionalPositiveId(params.categoryId);

  if (storeId != null) {
    const store = await prisma.store.findFirst({ where: { id: storeId } });
    if (!store) throw new AppError(404, 'Store not found');
  }

  const products = await prisma.product.findMany({
    where: {
      ...SELECTABLE_PRODUCT,
      ...(categoryId != null ? { categoryId } : {}),
    },
    select: {
      id: true,
      name: true,
      code: true,
      kind: true,
      accountId: true,
      category: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  });

  const balances = await getAccountBalancesAsOf({
    date: params.date,
    ...(categoryId != null ? { productCategoryId: categoryId } : {}),
  });
  const ledgerByAccount = new Map(balances.accounts.map((row) => [row.accountId, row.balance]));

  const productRefs = products.map((p) => ({ id: p.id, kind: p.kind }));
  const qtyAllStores =
    storeId != null ? await getCurrentStockBalancesForProducts(productRefs) : null;
  const qtyInStore =
    storeId != null ? await getCurrentStockBalancesForProducts(productRefs, storeId) : null;

  const rows = products.map((product) => {
    const ledgerBalance = ledgerByAccount.get(product.accountId) ?? 0;
    let value = ledgerBalance;
    if (qtyAllStores && qtyInStore) {
      const totalQty = qtyAllStores.get(product.id) ?? 0;
      const storeQty = qtyInStore.get(product.id) ?? 0;
      value = totalQty === 0 ? 0 : (ledgerBalance / totalQty) * storeQty;
    }
    return {
      productId: product.id,
      code: product.code,
      name: product.name,
      category: product.category?.name ?? '',
      value,
    };
  });

  return {
    date: params.date,
    storeId: storeId ?? null,
    categoryId: categoryId ?? null,
    rows,
    totalValue: rows.reduce((sum, row) => sum + row.value, 0),
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
  const product = await db.product.findFirst({
    where: { id: productId },
    select: { kind: true },
  });
  const kind = product?.kind ?? ProductKind.STANDARD;

  const scopedStoreId = storeId != null && storeId > 0 ? storeId : undefined;
  const movements = await db.stockMovement.findMany({
    where: {
      productId,
      ...(scopedStoreId != null ? { storeId: scopedStoreId } : {}),
    },
    select: { direction: true, bags: true, weightKg: true },
  });

  let balance = 0;
  for (const m of movements) {
    balance += movementDelta(m, kind);
  }
  return balance;
}

/** Stock OUT for Sale Invoice — quantity treated as whole bags. */
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
  const productsById = await loadActiveProductsForLines(tx, data.lines);

  for (const line of data.lines) {
    const bagsOut = Number(line.quantity);
    if (!(bagsOut > 0)) continue;

    const product = productsById.get(line.productId);
    if (!product) throw new AppError(400, `Product #${line.productId} not found`);

    await tx.stockMovement.create({
      data: {
        productId: product.id,
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

/** Pure stock transfer between stores — OUT from source + IN to destination, shared TR- reference. No ledger entries. */
export async function createStockTransfer(
  data: {
    transferDate: string;
    fromStoreId: number;
    toStoreId: number;
    productId: number;
    quantity: number;
    createdById: number;
  },
) {
  if (data.fromStoreId === data.toStoreId) {
    throw new AppError(400, 'From store and To store must be different');
  }
  const qty = Number(data.quantity);
  if (!(qty > 0)) throw new AppError(400, 'Quantity must be greater than zero');

  return prisma.$transaction(async (tx) => {
    const fromStore = await tx.store.findFirst({ where: { id: data.fromStoreId, isActive: true } });
    if (!fromStore) throw new AppError(400, 'From store not found or inactive');
    const toStore = await tx.store.findFirst({ where: { id: data.toStoreId, isActive: true } });
    if (!toStore) throw new AppError(400, 'To store not found or inactive');

    const product = await tx.product.findFirst({ where: { id: data.productId, ...SELECTABLE_PRODUCT } });
    if (!product) throw new AppError(400, 'Product not found');

    const available = await getCurrentStockBalance(data.productId, data.fromStoreId, tx);
    if (qty > available) {
      throw new AppError(
        400,
        `Insufficient stock for ${product.name} at ${fromStore.name}: available ${available}, requested ${qty}`,
      );
    }

    const priorOuts = await tx.stockMovement.count({
      where: { invoiceType: InvoiceType.STOCK_TRANSFER, direction: StockDirection.OUT },
    });
    const reference = `TR-${String(priorOuts + 1).padStart(5, '0')}`;
    const transferDate = new Date(data.transferDate);

    const invoice = await tx.invoice.create({
      data: {
        type: InvoiceType.STOCK_TRANSFER,
        status: InvoiceStatus.POSTED,
        reference,
        invoiceDate: transferDate,
        storeId: data.fromStoreId,
        toStoreId: data.toStoreId,
        productId: data.productId,
        total: 0,
        notes: `Transfer ${qty} from ${fromStore.name} to ${toStore.name}`,
        createdById: data.createdById,
        items: {
          create: [
            {
              productId: product.id,
              label: product.name,
              quantity: qty,
              unitPrice: 0,
              total: 0,
            },
          ],
        },
      },
    });

    await tx.stockMovement.create({
      data: {
        productId: product.id,
        storeId: data.fromStoreId,
        direction: StockDirection.OUT,
        bags: qty,
        date: transferDate,
        invoiceId: invoice.id,
        invoiceType: InvoiceType.STOCK_TRANSFER,
        invoiceReference: reference,
        description: `${reference} → ${toStore.name}`,
      },
    });
    await tx.stockMovement.create({
      data: {
        productId: product.id,
        storeId: data.toStoreId,
        direction: StockDirection.IN,
        bags: qty,
        date: transferDate,
        invoiceId: invoice.id,
        invoiceType: InvoiceType.STOCK_TRANSFER,
        invoiceReference: reference,
        description: `${reference} ← ${fromStore.name}`,
      },
    });

    return invoice;
  });
}

/** Reverse stock movements for a cancelled invoice by posting opposite-direction rows. */
export async function reverseInvoiceStockMovements(
  tx: Tx,
  data: { invoiceId: number; invoiceReference: string; invoiceDate: Date },
) {
  const originals = await tx.stockMovement.findMany({
    where: {
      invoiceId: data.invoiceId,
      description: { not: { startsWith: 'Reversal —' } },
    },
    orderBy: { id: 'asc' },
  });

  // Already reversed if a reversal row exists for this invoice.
  const alreadyReversed = await tx.stockMovement.findFirst({
    where: {
      invoiceId: data.invoiceId,
      description: { startsWith: 'Reversal —' },
    },
  });
  if (alreadyReversed) return;

  for (const m of originals) {
    await tx.stockMovement.create({
      data: {
        productId: m.productId,
        storeId: m.storeId,
        direction: m.direction === StockDirection.IN ? StockDirection.OUT : StockDirection.IN,
        bags: m.bags,
        date: data.invoiceDate,
        invoiceId: data.invoiceId,
        invoiceType: m.invoiceType,
        invoiceReference: data.invoiceReference,
        description: `Reversal — ${data.invoiceReference}`,
      },
    });
  }
}

/** Stock IN for Purchase Invoice — quantity treated as whole bags. */
export async function postOpeningStockIn(
  tx: Tx,
  data: {
    productId: number;
    storeId: number;
    quantity: number;
    date?: Date;
  },
) {
  const qty = Number(data.quantity);
  if (!(qty > 0)) return;

  const product = await tx.product.findFirst({ where: { id: data.productId, isActive: true } });
  if (!product) throw new AppError(400, `Product #${data.productId} not found`);

  const store = await tx.store.findFirst({ where: { id: data.storeId, isActive: true } });
  if (!store) throw new AppError(400, 'Store not found or inactive');

  const existingOpening = await tx.stockMovement.findFirst({
    where: { productId: product.id, storeId: store.id, isOpeningStock: true },
  });
  if (existingOpening) {
    throw new AppError(400, 'Opening stock was already recorded for this product at this store');
  }

  await tx.stockMovement.create({
    data: {
      productId: product.id,
      storeId: store.id,
      direction: StockDirection.IN,
      bags: qty,
      date: data.date ?? new Date(),
      invoiceId: null,
      invoiceType: InvoiceType.OPENING_STOCK,
      invoiceReference: 'Opening Stock',
      description: 'Opening Stock',
      isOpeningStock: true,
    },
  });
}

/** Opening stock IN for Kachi products — stores precise total kg in weightKg. */
export async function postOpeningKachiStockIn(
  tx: Tx,
  data: {
    productId: number;
    storeId: number;
    weightKg: number;
    date?: Date;
  },
) {
  const weightKg = Number(data.weightKg);
  if (!(weightKg > 0)) return;

  const product = await tx.product.findFirst({
    where: { id: data.productId, isActive: true, kind: ProductKind.KACHI },
  });
  if (!product) throw new AppError(400, `Kachi product #${data.productId} not found`);

  const store = await tx.store.findFirst({ where: { id: data.storeId, isActive: true } });
  if (!store) throw new AppError(400, 'Store not found or inactive');

  const existingOpening = await tx.stockMovement.findFirst({
    where: { productId: product.id, storeId: store.id, isOpeningStock: true },
  });
  if (existingOpening) {
    throw new AppError(400, 'Opening stock was already recorded for this product at this store');
  }

  await tx.stockMovement.create({
    data: {
      productId: product.id,
      storeId: store.id,
      direction: StockDirection.IN,
      bags: 0,
      weightKg,
      date: data.date ?? new Date(),
      invoiceId: null,
      invoiceType: InvoiceType.OPENING_STOCK,
      invoiceReference: 'Opening Stock',
      description: 'Opening Stock (Kachi)',
      isOpeningStock: true,
    },
  });
}

/** Stock IN for valued adjustments on existing STANDARD products (not opening stock). */
export async function postStockAdjustmentStandardIn(
  tx: Tx,
  data: {
    productId: number;
    storeId: number;
    quantity: number;
    date: Date;
    description?: string;
  },
) {
  const qty = Number(data.quantity);
  if (!(qty > 0)) return;

  const product = await tx.product.findFirst({
    where: { id: data.productId, isActive: true, kind: ProductKind.STANDARD },
  });
  if (!product) throw new AppError(400, `Standard product #${data.productId} not found`);

  const store = await tx.store.findFirst({ where: { id: data.storeId, isActive: true } });
  if (!store) throw new AppError(400, 'Store not found or inactive');

  await tx.stockMovement.create({
    data: {
      productId: product.id,
      storeId: store.id,
      direction: StockDirection.IN,
      bags: qty,
      date: data.date,
      invoiceId: null,
      invoiceType: InvoiceType.OPENING_STOCK,
      invoiceReference: 'Stock Adjustment',
      description: data.description ?? `Stock Adjustment — ${product.name}`,
      isOpeningStock: false,
    },
  });
}

/** Stock IN for valued adjustments on existing Kachi products (not opening stock). */
export async function postStockAdjustmentKachiIn(
  tx: Tx,
  data: {
    productId: number;
    storeId: number;
    weightKg: number;
    date: Date;
    description?: string;
  },
) {
  const weightKg = Number(data.weightKg);
  if (!(weightKg > 0)) return;

  const product = await tx.product.findFirst({
    where: { id: data.productId, isActive: true, kind: ProductKind.KACHI },
  });
  if (!product) throw new AppError(400, `Kachi product #${data.productId} not found`);

  const store = await tx.store.findFirst({ where: { id: data.storeId, isActive: true } });
  if (!store) throw new AppError(400, 'Store not found or inactive');

  await tx.stockMovement.create({
    data: {
      productId: product.id,
      storeId: store.id,
      direction: StockDirection.IN,
      bags: 0,
      weightKg,
      date: data.date,
      invoiceId: null,
      invoiceType: InvoiceType.OPENING_STOCK,
      invoiceReference: 'Stock Adjustment',
      description: data.description ?? `Stock Adjustment — ${product.name}`,
      isOpeningStock: false,
    },
  });
}

/** Stock IN for Purchase Invoice — quantity treated as whole bags. */
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
  const productsById = await loadActiveProductsForLines(tx, data.lines);

  for (const line of data.lines) {
    const bagsIn = Number(line.quantity);
    if (!(bagsIn > 0)) continue;

    const product = productsById.get(line.productId);
    if (!product) throw new AppError(400, `Product #${line.productId} not found`);

    await tx.stockMovement.create({
      data: {
        productId: product.id,
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
