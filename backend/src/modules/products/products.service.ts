import { AccountType, InvoiceStatus, InvoiceType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { getCurrentStockBalance } from '../stock/stock.service';
import {
  ensureMaalKhataCategoryInTx,
  generateNextMaalKhataCodeInTx,
  maalKhataAccountName,
} from './maal-khata';

export { MAAL_KHATA_CATEGORY_NAME, maalKhataAccountName } from './maal-khata';

export async function listProductCategories() {
  return prisma.productCategory.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
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

export async function listProducts() {
  return prisma.product.findMany({
    where: { isActive: true },
    include: {
      account: { include: { ledger: true } },
      category: true,
    },
    orderBy: { name: 'asc' },
  });
}

export async function createProduct(data: {
  name: string;
  unit?: string;
  code?: string;
  categoryId?: number | null;
}) {
  const name = data.name.trim();
  if (!name) throw new AppError(400, 'Product name is required');

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

    await tx.ledger.create({ data: { accountId: account.id, balance: 0 } });

    const product = await tx.product.create({
      data: {
        name,
        code,
        unit: data.unit?.trim() || null,
        accountId: account.id,
        categoryId,
      },
      include: {
        account: { include: { ledger: true } },
        category: true,
      },
    });

    return product;
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

  return prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id }, data: { isActive: false } });
    await tx.account.update({ where: { id: product.accountId }, data: { isActive: false } });
    return { ok: true };
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
