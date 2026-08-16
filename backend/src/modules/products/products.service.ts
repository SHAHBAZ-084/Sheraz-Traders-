import { AccountType, InvoiceStatus, InvoiceType, Prisma, ProductKind } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { PaginatedResult, SELECTOR_MAX_PAGE_SIZE } from '../../utils/pagination';
import { AppError } from '../../utils/helpers';
import { postOpeningBalanceInTx } from '../accounting/accounting.service';
import {
  computeKachiOpeningStockValue,
  type KachiBagMode,
} from '../invoices/kachi-maal.calculations';
import { getCurrentStockBalance, postOpeningKachiStockIn, postOpeningStockIn } from '../stock/stock.service';
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
  options?: { includeLedger?: boolean },
  pagination?: { limit: number; offset: number },
): Promise<PaginatedResult<Awaited<ReturnType<typeof mapListedProduct>>>> {
  const includeLedger = options?.includeLedger !== false;
  const limit = pagination?.limit ?? SELECTOR_MAX_PAGE_SIZE;
  const offset = pagination?.offset ?? 0;
  const where = { isActive: true };

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

  return {
    items: products.map(mapListedProduct),
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
}) {
  const { account, ...rest } = product;
  return {
    ...rest,
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
}) {
  const name = data.name.trim();
  if (!name) throw new AppError(400, 'Product name is required');

  const kind = data.kind ?? ProductKind.STANDARD;

  if (kind === ProductKind.KACHI) {
    return createKachiProduct(data, name);
  }

  return createStandardProduct(data, name);
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
  const openingStockValue = openingStock * openingStockRate;

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
      },
    });

    const ledger = await tx.ledger.create({ data: { accountId: account.id, balance: 0 } });

    const product = await tx.product.create({
      data: {
        name,
        code,
        unit: data.unit?.trim() || null,
        kind: ProductKind.STANDARD,
        accountId: account.id,
        categoryId,
      },
      include: {
        account: { include: { ledger: true } },
        category: true,
      },
    });

    if (openingStock > 0) {
      await postOpeningStockIn(tx, {
        productId: product.id,
        storeId: data.openingStoreId!,
        quantity: openingStock,
      });

      // Debit product Maal Khata (same account purchase invoices use for inventory value),
      // Credit Opening Balance Equity — mirrors account opening balances.
      await postOpeningBalanceInTx(tx, {
        ledgerId: ledger.id,
        accountName,
        amount: openingStockValue,
        side: 'DR',
        notes: 'Opening Stock',
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
      },
    });

    const ledger = await tx.ledger.create({ data: { accountId: account.id, balance: 0 } });

    const product = await tx.product.create({
      data: {
        name,
        code,
        unit: data.unit?.trim() || 'Kg',
        kind: ProductKind.KACHI,
        accountId: account.id,
        categoryId,
      },
      include: {
        account: { include: { ledger: true } },
        category: true,
      },
    });

    if (openingWeightKg > 0) {
      await postOpeningKachiStockIn(tx, {
        productId: product.id,
        storeId: data.openingStoreId!,
        weightKg: openingWeightKg,
      });

      await postOpeningBalanceInTx(tx, {
        ledgerId: ledger.id,
        accountName,
        amount: openingValue,
        side: 'DR',
        notes: 'Opening Stock',
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
