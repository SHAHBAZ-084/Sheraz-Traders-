import { AccountType, InvoiceStatus, InvoiceType, Prisma, ProductKind, RecordStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { PaginatedResult, SELECTOR_MAX_PAGE_SIZE } from '../../utils/pagination';
import { AppError } from '../../utils/helpers';
import { SELECTABLE_PRODUCT } from '../../lib/record-status';
import { postOpeningBalanceInTx, postStockAdjustmentBalanceInTx, assertVoucherDateInActiveFinancialYear } from '../accounting/accounting.service';
import {
  computeKachiOpeningStockValue,
  type KachiBagMode,
} from '../invoices/kachi-maal.calculations';
import {
  getCurrentStockBalance,
  getCurrentStockBalancesForProducts,
  postOpeningKachiStockIn,
  postOpeningStockIn,
  postStockAdjustmentKachiIn,
  postStockAdjustmentStandardIn,
} from '../stock/stock.service';
import {
  ensureMaalKhataCategoryInTx,
  generateNextMaalKhataCodeInTx,
  maalKhataAccountName,
} from './maal-khata';

export { MAAL_KHATA_CATEGORY_NAME, maalKhataAccountName } from './maal-khata';

export async function listProductCategories(pagination?: { limit: number; offset: number }) {
  const limit = pagination?.limit ?? SELECTOR_MAX_PAGE_SIZE;
  const offset = pagination?.offset ?? 0;
  const where = { isActive: true };

  const [items, total] = await Promise.all([
    prisma.productCategory.findMany({
      where,
      select: { id: true, name: true, isActive: true, createdAt: true },
      orderBy: { name: 'asc' },
      take: limit,
      skip: offset,
    }),
    prisma.productCategory.count({ where }),
  ]);

  return { items, total, limit, offset };
}

export async function createProductCategory(nameInput: string) {
  const name = nameInput.trim();
  if (!name) throw new AppError(400, 'Category name is required');

  const active = await prisma.productCategory.findMany({ where: { isActive: true } });
  const duplicate = active.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (duplicate) throw new AppError(400, `Category "${duplicate.name}" already exists`);

  const inactive = await prisma.productCategory.findFirst({
    where: { isActive: false, name },
  });
  if (inactive) {
    return prisma.productCategory.update({
      where: { id: inactive.id },
      data: { isActive: true },
    });
  }

  try {
    return await prisma.productCategory.create({ data: { name } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(400, `Category "${name}" already exists`);
    }
    throw err;
  }
}

export async function listProducts(
  options?: {
    includeLedger?: boolean;
    search?: string;
    /** When set to `null`, only products with no business category. */
    categoryId?: number | null;
  },
  pagination?: { limit: number; offset: number },
): Promise<PaginatedResult<Awaited<ReturnType<typeof mapListedProduct>>>> {
  const includeLedger = options?.includeLedger !== false;
  const limit = pagination?.limit ?? SELECTOR_MAX_PAGE_SIZE;
  const offset = pagination?.offset ?? 0;
  const where: Prisma.ProductWhereInput = { ...SELECTABLE_PRODUCT };

  if (options?.categoryId === null) {
    where.categoryId = null;
  } else if (options?.categoryId != null) {
    where.categoryId = options.categoryId;
  }

  const search = options?.search?.trim();
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { code: { contains: search } },
      { unit: { contains: search } },
      { category: { is: { name: { contains: search } } } },
      { account: { is: { name: { contains: search } } } },
    ];
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        unit: true,
        kind: true,
        accountId: true,
        categoryId: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        category: { select: { id: true, name: true, isActive: true } },
        account: {
          select: {
            id: true,
            name: true,
            code: true,
            type: true,
            categoryId: true,
            isActive: true,
            ...(includeLedger
              ? { ledger: { select: { id: true, accountId: true, balance: true, updatedAt: true } } }
              : {}),
          },
        },
      },
      orderBy: { name: 'asc' },
      take: limit,
      skip: offset,
    }),
    prisma.product.count({ where }),
  ]);

  const stockBalances = await getCurrentStockBalancesForProducts(
    products.map((p) => ({ id: p.id, kind: p.kind })),
  );

  return {
    items: products.map((p) => mapListedProduct(p, stockBalances.get(p.id) ?? 0)),
    total,
    limit,
    offset,
  };
}

function mapListedProduct(product: {
  id: number;
  name: string;
  code: string;
  unit: string | null;
  kind: ProductKind;
  accountId: number;
  categoryId: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  category: { id: number; name: string; isActive: boolean } | null;
  account: {
    id: number;
    name: string;
    code: string;
    type: AccountType;
    categoryId: number;
    isActive: boolean;
    ledger?: { id: number; accountId: number; balance: unknown; updatedAt: Date } | null;
  };
}, stockBalance: number) {
  const { account, ...rest } = product;
  return {
    ...rest,
    stockBalance,
    account: {
      ...account,
      ledger: account.ledger
        ? { ...account.ledger, balance: Number(account.ledger.balance) }
        : null,
    },
  };
}

export type KachiOpeningStockInput = {
  bagMode: KachiBagMode;
  bagCount: number;
  dharanCount: number;
  looseKg: number;
  bhartii: number;
  ratePerMaund: number;
};

function parseAdjustmentDate(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'Invalid adjustment date');
  d.setHours(12, 0, 0, 0);
  return d;
}

function assertStoreForStock(storeId: number | null | undefined, message: string) {
  if (storeId == null || storeId <= 0) {
    throw new AppError(400, message);
  }
}

/** Post valued STANDARD stock IN + ledger (opening stock or adjustment). */
async function addStandardStockToProductInTx(
  tx: Prisma.TransactionClient,
  data: {
    productId: number;
    ledgerId: number;
    accountName: string;
    storeId: number;
    quantity: number;
    rate: number;
    mode: 'opening' | 'adjustment';
    date?: Date;
    financialYearId?: number;
    productName?: string;
  },
) {
  const quantity = Number(data.quantity);
  const rate = Number(data.rate);
  const amount = quantity * rate;
  if (!(quantity > 0) || !(amount > 0)) return;

  assertStoreForStock(data.storeId, 'Store is required when opening stock is greater than zero');

  if (data.mode === 'opening') {
    await postOpeningStockIn(tx, {
      productId: data.productId,
      storeId: data.storeId,
      quantity,
      date: data.date,
    });
    await postOpeningBalanceInTx(tx, {
      ledgerId: data.ledgerId,
      accountName: data.accountName,
      amount,
      side: 'DR',
      notes: 'Opening Stock',
    });
    return;
  }

  const entryDate = data.date ?? new Date();
  const notes = `Stock Adjustment — ${data.productName ?? data.accountName} (${quantity})`;
  await postStockAdjustmentStandardIn(tx, {
    productId: data.productId,
    storeId: data.storeId,
    quantity,
    date: entryDate,
    description: notes,
  });
  await postStockAdjustmentBalanceInTx(tx, {
    ledgerId: data.ledgerId,
    accountName: data.accountName,
    amount,
    side: 'DR',
    notes,
    financialYearId: data.financialYearId!,
    entryDate,
  });
}

/** Post valued Kachi stock IN + ledger (opening stock or adjustment). */
async function addKachiStockToProductInTx(
  tx: Prisma.TransactionClient,
  data: {
    productId: number;
    ledgerId: number;
    accountName: string;
    storeId: number;
    kachiOpening: KachiOpeningStockInput;
    mode: 'opening' | 'adjustment';
    date?: Date;
    financialYearId?: number;
    productName?: string;
  },
) {
  const computed = computeKachiOpeningStockValue({
    bagMode: data.kachiOpening.bagMode,
    bagCount: Number(data.kachiOpening.bagCount) || 0,
    dharanCount: Number(data.kachiOpening.dharanCount) || 0,
    looseKg: Number(data.kachiOpening.looseKg) || 0,
    bhartii: Number(data.kachiOpening.bhartii) || 0,
    ratePerMaund: Number(data.kachiOpening.ratePerMaund),
  });

  const { totalWeightKg: weightKg, amount } = computed;
  if (!(weightKg > 0) || !(amount > 0)) return;

  assertStoreForStock(
    data.storeId,
    data.mode === 'opening'
      ? 'Store is required when kachi opening stock is entered'
      : 'Store is required for stock adjustment',
  );

  if (data.mode === 'opening') {
    await postOpeningKachiStockIn(tx, {
      productId: data.productId,
      storeId: data.storeId,
      weightKg,
      date: data.date,
    });
    await postOpeningBalanceInTx(tx, {
      ledgerId: data.ledgerId,
      accountName: data.accountName,
      amount,
      side: 'DR',
      notes: 'Opening Stock',
    });
    return;
  }

  const entryDate = data.date ?? new Date();
  const notes = `Stock Adjustment — ${data.productName ?? data.accountName}`;
  await postStockAdjustmentKachiIn(tx, {
    productId: data.productId,
    storeId: data.storeId,
    weightKg,
    date: entryDate,
    description: notes,
  });
  await postStockAdjustmentBalanceInTx(tx, {
    ledgerId: data.ledgerId,
    accountName: data.accountName,
    amount,
    side: 'DR',
    notes,
    financialYearId: data.financialYearId!,
    entryDate,
  });
}

export async function createStockAdjustment(data: {
  adjustmentDate: string;
  productId: number;
  storeId: number;
  quantity?: number;
  rate?: number;
  kachiOpening?: KachiOpeningStockInput;
  createdById?: number;
  postImmediately?: boolean;
}) {
  assertStoreForStock(data.storeId, 'Store is required for stock adjustment');

  const adjustmentDate = parseAdjustmentDate(data.adjustmentDate);

  const product = await prisma.product.findFirst({
    where: { id: data.productId, ...SELECTABLE_PRODUCT },
    include: { account: { include: { ledger: true } } },
  });
  if (!product) throw new AppError(404, 'Product not found');
  if (!product.account.ledger) throw new AppError(400, 'Product ledger not found');

  const accountName = product.account.name;
  const ledgerId = product.account.ledger.id;
  const postImmediately = data.postImmediately !== false;

  return prisma.$transaction(async (tx) => {
    const financialYearId = await assertVoucherDateInActiveFinancialYear(tx, adjustmentDate, 'Invoice');

    let quantity: number | null = null;
    let rate: number | null = null;
    let kachiOpening: KachiOpeningStockInput | null = null;

    if (product.kind === ProductKind.KACHI) {
      if (data.quantity != null || data.rate != null) {
        throw new AppError(
          400,
          'Standard quantity/rate cannot be used with Kachi products — use kachi weight fields',
        );
      }
      const opening = data.kachiOpening;
      if (!opening) throw new AppError(400, 'Kachi weight details are required');
      if (opening.bagMode !== 'BORI' && opening.bagMode !== 'THELA') {
        throw new AppError(400, 'bagMode must be BORI or THELA');
      }
      if (!(Number(opening.ratePerMaund) > 0)) {
        throw new AppError(400, 'Purchase rate per maund is required');
      }
      if (Number(opening.bagCount) > 0 && !(Number(opening.bhartii) > 0)) {
        throw new AppError(400, 'Bhartii must be greater than zero when bag count is entered');
      }

      const computed = computeKachiOpeningStockValue({
        bagMode: opening.bagMode,
        bagCount: Number(opening.bagCount) || 0,
        dharanCount: Number(opening.dharanCount) || 0,
        looseKg: Number(opening.looseKg) || 0,
        bhartii: Number(opening.bhartii) || 0,
        ratePerMaund: Number(opening.ratePerMaund),
      });
      if (!(computed.totalWeightKg > 0)) {
        throw new AppError(400, 'Kachi adjustment weight must be greater than zero');
      }
      if (!(computed.amount > 0)) {
        throw new AppError(400, 'Kachi adjustment value must be greater than zero');
      }
      kachiOpening = opening;
    } else {
      if (data.kachiOpening != null) {
        throw new AppError(400, 'Kachi weight fields cannot be used with standard products');
      }

      const quantityRaw = data.quantity != null ? Number(data.quantity) : NaN;
      const rateRaw = data.rate != null ? Number(data.rate) : NaN;
      if (!Number.isFinite(quantityRaw) || quantityRaw <= 0) {
        throw new AppError(400, 'Quantity must be greater than zero');
      }
      if (!Number.isFinite(rateRaw) || rateRaw <= 0) {
        throw new AppError(400, 'Rate must be greater than zero');
      }
      quantity = quantityRaw;
      rate = rateRaw;
    }

    if (!postImmediately) {
      if (data.createdById == null) throw new AppError(400, 'createdById is required for pending adjustments');
      const pending = await tx.pendingAdjustment.create({
        data: {
          kind: 'STOCK',
          status: RecordStatus.PENDING_APPROVAL,
          adjustmentDate,
          createdById: data.createdById,
          productId: product.id,
          storeId: data.storeId,
          quantity,
          rate,
          kachiOpening: kachiOpening ? (kachiOpening as Prisma.InputJsonValue) : undefined,
        },
      });
      const balance = await getCurrentStockBalance(product.id, data.storeId, tx);
      return {
        pendingApproval: true as const,
        id: pending.id,
        productId: product.id,
        storeId: data.storeId,
        balance,
        productName: product.name,
      };
    }

    if (product.kind === ProductKind.KACHI && kachiOpening) {
      await addKachiStockToProductInTx(tx, {
        productId: product.id,
        ledgerId,
        accountName,
        storeId: data.storeId,
        kachiOpening,
        mode: 'adjustment',
        date: adjustmentDate,
        financialYearId,
        productName: product.name,
      });
    } else if (quantity != null && rate != null) {
      await addStandardStockToProductInTx(tx, {
        productId: product.id,
        ledgerId,
        accountName,
        storeId: data.storeId,
        quantity,
        rate,
        mode: 'adjustment',
        date: adjustmentDate,
        financialYearId,
        productName: product.name,
      });
    }

    const balance = await getCurrentStockBalance(product.id, data.storeId, tx);
    return {
      pendingApproval: false as const,
      productId: product.id,
      storeId: data.storeId,
      balance,
      productName: product.name,
    };
  });
}

function parseStoredKachiOpening(value: unknown): KachiOpeningStockInput | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const bagMode = row.bagMode === 'THELA' ? 'THELA' : row.bagMode === 'BORI' ? 'BORI' : null;
  if (!bagMode) return null;
  return {
    bagMode,
    bagCount: Number(row.bagCount) || 0,
    dharanCount: Number(row.dharanCount) || 0,
    looseKg: Number(row.looseKg) || 0,
    bhartii: Number(row.bhartii) || 0,
    ratePerMaund: Number(row.ratePerMaund) || 0,
  };
}

export async function approveStockAdjustment(id: number, _approvedById: number) {
  return prisma.$transaction(async (tx) => {
    const pending = await tx.pendingAdjustment.findFirst({
      where: { id, kind: 'STOCK', status: RecordStatus.PENDING_APPROVAL },
      include: {
        product: { include: { account: { include: { ledger: true } } } },
      },
    });
    if (!pending) throw new AppError(404, 'Pending stock adjustment not found');
    if (!pending.product?.account.ledger) throw new AppError(400, 'Product ledger not found');
    if (pending.product.status !== RecordStatus.ACTIVE || !pending.product.isActive) {
      throw new AppError(400, 'Product is not active');
    }
    if (pending.storeId == null) throw new AppError(400, 'Store is required');

    const financialYearId = await assertVoucherDateInActiveFinancialYear(tx, pending.adjustmentDate, 'Invoice');
    const product = pending.product;
    const ledgerId = product.account.ledger.id;
    const accountName = product.account.name;

    if (product.kind === ProductKind.KACHI) {
      const kachiOpening = parseStoredKachiOpening(pending.kachiOpening);
      if (!kachiOpening) throw new AppError(400, 'Kachi weight details are required');
      await addKachiStockToProductInTx(tx, {
        productId: product.id,
        ledgerId,
        accountName,
        storeId: pending.storeId,
        kachiOpening,
        mode: 'adjustment',
        date: pending.adjustmentDate,
        financialYearId,
        productName: product.name,
      });
    } else {
      const quantity = Number(pending.quantity ?? 0);
      const rate = Number(pending.rate ?? 0);
      await addStandardStockToProductInTx(tx, {
        productId: product.id,
        ledgerId,
        accountName,
        storeId: pending.storeId,
        quantity,
        rate,
        mode: 'adjustment',
        date: pending.adjustmentDate,
        financialYearId,
        productName: product.name,
      });
    }

    await tx.pendingAdjustment.update({
      where: { id: pending.id },
      data: { status: RecordStatus.ACTIVE },
    });

    const balance = await getCurrentStockBalance(product.id, pending.storeId, tx);
    return {
      productId: product.id,
      storeId: pending.storeId,
      balance,
      productName: product.name,
    };
  });
}

export async function rejectStockAdjustment(id: number) {
  const pending = await prisma.pendingAdjustment.findFirst({
    where: { id, kind: 'STOCK', status: RecordStatus.PENDING_APPROVAL },
  });
  if (!pending) throw new AppError(404, 'Pending stock adjustment not found');
  await prisma.pendingAdjustment.delete({ where: { id } });
  return { ok: true, id };
}

export async function createProduct(data: {
  name: string;
  unit?: string;
  code?: string;
  categoryId?: number | null;
  kind?: ProductKind;
  openingStock?: number;
  openingStockRate?: number;
  openingStoreId?: number;
  kachiOpening?: KachiOpeningStockInput;
  createdById?: number;
  postImmediately?: boolean;
}) {
  const name = data.name.trim();
  if (!name) throw new AppError(400, 'Product name is required');

  const kind = data.kind ?? ProductKind.STANDARD;
  const postImmediately = data.postImmediately !== false;
  if (!postImmediately && data.createdById == null) {
    throw new AppError(400, 'createdById is required for pending products');
  }

  if (kind === ProductKind.KACHI) {
    return createKachiProduct(data, name, { createdById: data.createdById, postImmediately });
  }

  return createStandardProduct(data, name, { createdById: data.createdById, postImmediately });
}

async function createStandardProduct(
  data: {
    name: string;
    unit?: string;
    code?: string;
    categoryId?: number | null;
    openingStock?: number;
    openingStockRate?: number;
    openingStoreId?: number;
  },
  name: string,
  opts: { createdById?: number; postImmediately: boolean },
) {
  const openingStockRaw =
    data.openingStock != null && data.openingStock !== undefined ? Number(data.openingStock) : 0;
  const openingStockRateRaw =
    data.openingStockRate != null && data.openingStockRate !== undefined
      ? Number(data.openingStockRate)
      : 0;

  if (!Number.isFinite(openingStockRaw) || openingStockRaw < 0) {
    throw new AppError(400, 'Opening stock quantity must be zero or greater');
  }
  if (!Number.isFinite(openingStockRateRaw) || openingStockRateRaw < 0) {
    throw new AppError(400, 'Opening stock rate must be zero or greater');
  }

  const hasQty = openingStockRaw > 0;
  const hasRate = openingStockRateRaw > 0;
  if (hasQty !== hasRate) {
    throw new AppError(
      400,
      'Opening stock quantity and rate must both be provided together (or both left blank)',
    );
  }

  const openingStock = hasQty ? openingStockRaw : 0;
  const openingStockRate = hasRate ? openingStockRateRaw : 0;

  if (openingStock > 0 && (data.openingStoreId == null || data.openingStoreId <= 0)) {
    throw new AppError(400, 'Store is required when opening stock is greater than zero');
  }

  const existing = await prisma.product.findFirst({
    where: { isActive: true, name },
  });
  if (existing) throw new AppError(400, `Product "${name}" already exists`);

  let categoryId: number | null = null;
  if (data.categoryId != null && data.categoryId !== undefined) {
    const businessCategory = await prisma.productCategory.findFirst({
      where: { id: data.categoryId, isActive: true },
    });
    if (!businessCategory) throw new AppError(400, 'Product category not found or inactive');
    categoryId = businessCategory.id;
  }

  return prisma.$transaction(async (tx) => {
    const category = await ensureMaalKhataCategoryInTx(tx);
    const accountName = maalKhataAccountName(name);
    const code = data.code?.trim() || (await generateNextMaalKhataCodeInTx(tx));

    const codeTaken = await tx.account.findFirst({ where: { code } });
    if (codeTaken) throw new AppError(400, `Account code "${code}" already exists`);

    const nameTaken = await tx.account.findFirst({
      where: { isActive: true, name: accountName, categoryId: category.id },
    });
    if (nameTaken) throw new AppError(400, `Product ledger "${accountName}" already exists`);

    const account = await tx.account.create({
      data: {
        categoryId: category.id,
        name: accountName,
        code,
        type: AccountType.ASSET,
        status: opts.postImmediately ? RecordStatus.ACTIVE : RecordStatus.PENDING_APPROVAL,
        createdById: opts.createdById ?? null,
      },
    });

    const product = await tx.product.create({
      data: {
        name,
        code,
        unit: data.unit?.trim() || null,
        kind: ProductKind.STANDARD,
        accountId: account.id,
        categoryId,
        status: opts.postImmediately ? RecordStatus.ACTIVE : RecordStatus.PENDING_APPROVAL,
        createdById: opts.createdById ?? null,
        pendingOpeningStoreId: opts.postImmediately || openingStock === 0 ? null : data.openingStoreId,
        pendingOpeningQty: opts.postImmediately || openingStock === 0 ? null : openingStock,
        pendingOpeningRate: opts.postImmediately || openingStock === 0 ? null : openingStockRate,
      },
      include: {
        account: { include: { ledger: true } },
        category: true,
      },
    });

    if (!opts.postImmediately) {
      return product;
    }

    const ledger = await tx.ledger.create({ data: { accountId: account.id, balance: 0 } });

    if (openingStock > 0) {
      await addStandardStockToProductInTx(tx, {
        productId: product.id,
        ledgerId: ledger.id,
        accountName,
        storeId: data.openingStoreId!,
        quantity: openingStock,
        rate: openingStockRate,
        mode: 'opening',
      });
    }

    return tx.product.findUniqueOrThrow({
      where: { id: product.id },
      include: {
        account: { include: { ledger: true } },
        category: true,
      },
    });
  });
}

async function createKachiProduct(
  data: {
    unit?: string;
    code?: string;
    categoryId?: number | null;
    openingStock?: number;
    openingStockRate?: number;
    openingStoreId?: number;
    kachiOpening?: KachiOpeningStockInput;
  },
  name: string,
  opts: { createdById?: number; postImmediately: boolean },
) {
  if (data.openingStock != null || data.openingStockRate != null) {
    throw new AppError(
      400,
      'Standard opening stock quantity/rate cannot be used with Kachi products — use kachiOpening weight fields',
    );
  }

  const opening = data.kachiOpening;
  const hasOpeningInput =
    opening != null
    && (
      Number(opening.bagCount) > 0
      || Number(opening.dharanCount) > 0
      || Number(opening.looseKg) > 0
      || Number(opening.ratePerMaund) > 0
    );

  let openingValue = 0;
  let openingWeightKg = 0;

  if (hasOpeningInput) {
    if (!opening) {
      throw new AppError(400, 'Kachi opening weight details are required');
    }
    if (opening.bagMode !== 'BORI' && opening.bagMode !== 'THELA') {
      throw new AppError(400, 'bagMode must be BORI or THELA');
    }
    if (data.openingStoreId == null || data.openingStoreId <= 0) {
      throw new AppError(400, 'Store is required when kachi opening stock is entered');
    }
    if (!(Number(opening.ratePerMaund) > 0)) {
      throw new AppError(400, 'Purchase rate per maund is required for kachi opening stock');
    }
    if (Number(opening.bagCount) > 0 && !(Number(opening.bhartii) > 0)) {
      throw new AppError(400, 'Bhartii must be greater than zero when bag count is entered');
    }

    const computed = computeKachiOpeningStockValue({
      bagMode: opening.bagMode,
      bagCount: Number(opening.bagCount) || 0,
      dharanCount: Number(opening.dharanCount) || 0,
      looseKg: Number(opening.looseKg) || 0,
      bhartii: Number(opening.bhartii) || 0,
      ratePerMaund: Number(opening.ratePerMaund),
    });

    openingWeightKg = computed.totalWeightKg;
    openingValue = computed.amount;

    if (!(openingWeightKg > 0)) {
      throw new AppError(400, 'Kachi opening weight must be greater than zero');
    }
    if (!(openingValue > 0)) {
      throw new AppError(400, 'Kachi opening stock value must be greater than zero');
    }
  }

  const existing = await prisma.product.findFirst({
    where: { isActive: true, name },
  });
  if (existing) throw new AppError(400, `Product "${name}" already exists`);

  let categoryId: number | null = null;
  if (data.categoryId != null && data.categoryId !== undefined) {
    const businessCategory = await prisma.productCategory.findFirst({
      where: { id: data.categoryId, isActive: true },
    });
    if (!businessCategory) throw new AppError(400, 'Product category not found or inactive');
    categoryId = businessCategory.id;
  }

  return prisma.$transaction(async (tx) => {
    const category = await ensureMaalKhataCategoryInTx(tx);
    const accountName = maalKhataAccountName(name);
    const code = data.code?.trim() || (await generateNextMaalKhataCodeInTx(tx));

    const codeTaken = await tx.account.findFirst({ where: { code } });
    if (codeTaken) throw new AppError(400, `Account code "${code}" already exists`);

    const nameTaken = await tx.account.findFirst({
      where: { isActive: true, name: accountName, categoryId: category.id },
    });
    if (nameTaken) throw new AppError(400, `Product ledger "${accountName}" already exists`);

    const account = await tx.account.create({
      data: {
        categoryId: category.id,
        name: accountName,
        code,
        type: AccountType.ASSET,
        status: opts.postImmediately ? RecordStatus.ACTIVE : RecordStatus.PENDING_APPROVAL,
        createdById: opts.createdById ?? null,
      },
    });

    const product = await tx.product.create({
      data: {
        name,
        code,
        unit: data.unit?.trim() || 'Kg',
        kind: ProductKind.KACHI,
        accountId: account.id,
        categoryId,
        status: opts.postImmediately ? RecordStatus.ACTIVE : RecordStatus.PENDING_APPROVAL,
        createdById: opts.createdById ?? null,
        pendingOpeningStoreId: opts.postImmediately || openingWeightKg === 0 ? null : data.openingStoreId,
        pendingKachiOpening:
          opts.postImmediately || openingWeightKg === 0
            ? undefined
            : (opening as Prisma.InputJsonValue),
      },
      include: {
        account: { include: { ledger: true } },
        category: true,
      },
    });

    if (!opts.postImmediately) {
      return product;
    }

    const ledger = await tx.ledger.create({ data: { accountId: account.id, balance: 0 } });

    if (openingWeightKg > 0) {
      await addKachiStockToProductInTx(tx, {
        productId: product.id,
        ledgerId: ledger.id,
        accountName,
        storeId: data.openingStoreId!,
        kachiOpening: opening!,
        mode: 'opening',
      });
    }

    return tx.product.findUniqueOrThrow({
      where: { id: product.id },
      include: {
        account: { include: { ledger: true } },
        category: true,
      },
    });
  });
}

export async function approveProduct(productId: number, _approvedById: number) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: productId, status: RecordStatus.PENDING_APPROVAL },
      include: { account: { include: { ledger: true } }, category: true },
    });
    if (!product) throw new AppError(404, 'Pending product not found');

    let ledger = product.account.ledger;
    if (!ledger) {
      ledger = await tx.ledger.create({ data: { accountId: product.accountId, balance: 0 } });
    }

    await tx.account.update({
      where: { id: product.accountId },
      data: { status: RecordStatus.ACTIVE },
    });
    await tx.product.update({
      where: { id: product.id },
      data: {
        status: RecordStatus.ACTIVE,
        pendingOpeningStoreId: null,
        pendingOpeningQty: null,
        pendingOpeningRate: null,
        pendingKachiOpening: Prisma.JsonNull,
      },
    });

    const accountName = product.account.name;
    if (product.kind === ProductKind.KACHI) {
      const kachiOpening = parseStoredKachiOpening(product.pendingKachiOpening);
      if (kachiOpening && product.pendingOpeningStoreId) {
        await addKachiStockToProductInTx(tx, {
          productId: product.id,
          ledgerId: ledger.id,
          accountName,
          storeId: product.pendingOpeningStoreId,
          kachiOpening,
          mode: 'opening',
        });
      }
    } else {
      const qty = Number(product.pendingOpeningQty ?? 0);
      const rate = Number(product.pendingOpeningRate ?? 0);
      if (qty > 0 && product.pendingOpeningStoreId) {
        await addStandardStockToProductInTx(tx, {
          productId: product.id,
          ledgerId: ledger.id,
          accountName,
          storeId: product.pendingOpeningStoreId,
          quantity: qty,
          rate,
          mode: 'opening',
        });
      }
    }

    return tx.product.findUniqueOrThrow({
      where: { id: product.id },
      include: { account: { include: { ledger: true } }, category: true },
    });
  });
}

export async function rejectProduct(productId: number) {
  const product = await prisma.product.findFirst({
    where: { id: productId, status: RecordStatus.PENDING_APPROVAL },
  });
  if (!product) throw new AppError(404, 'Pending product not found');
  const accountId = product.accountId;
  await prisma.product.delete({ where: { id: productId } });
  await prisma.account.delete({ where: { id: accountId } });
  return { ok: true, id: productId };
}

export async function removeProduct(id: number) {
  const product = await prisma.product.findFirst({
    where: { id, isActive: true },
    include: { account: { include: { ledger: true } } },
  });
  if (!product) throw new AppError(404, 'Product not found');

  const balance = product.account.ledger ? Number(product.account.ledger.balance) : 0;
  if (Math.abs(balance) > 0.005) {
    throw new AppError(400, 'Product ledger has a balance and cannot be removed');
  }

  await prisma.product.update({ where: { id }, data: { isActive: false } });
  await prisma.account.update({ where: { id: product.accountId }, data: { isActive: false } });
  return { ok: true };
}

export async function updateProduct(
  id: number,
  data: {
    name?: string;
    unit?: string | null;
    categoryId?: number | null;
  },
) {
  const product = await prisma.product.findFirst({
    where: { id, isActive: true },
    include: { account: { include: { category: true, ledger: true } }, category: true },
  });
  if (!product) throw new AppError(404, 'Product not found');

  const nextName =
    data.name !== undefined ? data.name.trim() : product.name;
  if (!nextName) throw new AppError(400, 'Product name is required');

  const nameChanged = nextName.toLowerCase() !== product.name.toLowerCase();
  if (nameChanged) {
    const duplicate = await prisma.product.findFirst({
      where: { isActive: true, name: nextName, NOT: { id } },
    });
    if (duplicate) throw new AppError(400, `Product "${duplicate.name}" already exists`);
  }

  let nextCategoryId: number | null =
    data.categoryId !== undefined ? data.categoryId : product.categoryId;
  if (data.categoryId !== undefined && data.categoryId != null) {
    const businessCategory = await prisma.productCategory.findFirst({
      where: { id: data.categoryId, isActive: true },
    });
    if (!businessCategory) throw new AppError(400, 'Product category not found or inactive');
    nextCategoryId = businessCategory.id;
  } else if (data.categoryId === null) {
    nextCategoryId = null;
  }

  const nextUnit =
    data.unit !== undefined
      ? data.unit == null || data.unit.trim() === ''
        ? null
        : data.unit.trim()
      : product.unit;

  const accountName = maalKhataAccountName(nextName);

  return prisma.$transaction(async (tx) => {
    if (nameChanged) {
      const nameTaken = await tx.account.findFirst({
        where: {
          isActive: true,
          name: accountName,
          categoryId: product.account.categoryId,
          NOT: { id: product.accountId },
        },
      });
      if (nameTaken) throw new AppError(400, `Product ledger "${accountName}" already exists`);

      await tx.account.update({
        where: { id: product.accountId },
        data: { name: accountName },
      });
    }

    return tx.product.update({
      where: { id },
      data: {
        name: nextName,
        unit: nextUnit,
        categoryId: nextCategoryId,
      },
      include: {
        account: { include: { ledger: true } },
        category: true,
      },
    });
  });
}

export type ProductInsight = {
  averageRate: number | null;
  storeStock: number;
  storeName: string;
};

/**
 * Read-only lookup for the "Add existing product" info popover on Sale/Purchase Invoice.
 * - averageRate: weighted average purchase rate (sum(qty*rate) / sum(qty)) across all
 *   POSTED Purchase Invoice line items for this product — null if there is no purchase
 *   history, never 0 (0 would misleadingly imply a known zero rate).
 * - storeStock: the product's StockRemainder.remainderKg for the given store — 0 if no
 *   remainder row exists yet, since genuinely-zero stock is a valid, common state.
 */
export async function getProductInsight(productId: number, storeId: number): Promise<ProductInsight> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw new AppError(404, 'Store not found');

  const [purchaseItems, storeStock] = await Promise.all([
    prisma.invoiceItem.findMany({
      where: {
        productId,
        invoice: { type: InvoiceType.PURCHASE_INVOICE, status: InvoiceStatus.POSTED },
      },
      select: { quantity: true, unitPrice: true },
    }),
    getCurrentStockBalance(productId, storeId),
  ]);

  const totalQty = purchaseItems.reduce((sum, item) => sum + Number(item.quantity), 0);
  const totalValue = purchaseItems.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
    0,
  );
  const averageRate = totalQty > 0 ? totalValue / totalQty : null;

  return {
    averageRate,
    storeStock,
    storeName: store.name,
  };
}
