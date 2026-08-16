import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';

/** Dedicated inventory category — one ledger per product. */
export const MAAL_KHATA_CATEGORY_NAME = 'Products';

const maalKhataProductInclude = {
  account: {
    include: { category: true, ledger: true },
  },
} as const;

export type MaalKhataProduct = Prisma.ProductGetPayload<{
  include: typeof maalKhataProductInclude;
}>;

export type ResolvedMaalKhataAccount = {
  product: MaalKhataProduct;
  maalKhataAccountId: number;
};

/** Account name equals the product name (no prefix). */
export function maalKhataAccountName(productName: string) {
  return productName.trim();
}

export function isMaalKhataCategoryName(name: string) {
  return name === MAAL_KHATA_CATEGORY_NAME;
}

export async function ensureMaalKhataCategoryInTx(tx: Prisma.TransactionClient) {
  const existing = await tx.accountCategory.findFirst({
    where: { isActive: true, name: MAAL_KHATA_CATEGORY_NAME },
  });
  if (existing) return existing;

  return tx.accountCategory.create({ data: { name: MAAL_KHATA_CATEGORY_NAME } });
}

export async function generateNextMaalKhataCodeInTx(tx: Prisma.TransactionClient): Promise<string> {
  const accounts = await tx.account.findMany({
    where: { code: { startsWith: 'MK' } },
    select: { code: true },
  });
  let max = 0;
  for (const { code } of accounts) {
    const num = parseInt(code.slice(2), 10);
    if (!Number.isNaN(num) && num > max) max = num;
  }
  return `MK${String(max + 1).padStart(4, '0')}`;
}

function assertMaalKhataProduct(product: MaalKhataProduct | undefined): MaalKhataProduct {
  if (!product) throw new AppError(400, 'Product is required for purchase posting');

  if (!isMaalKhataCategoryName(product.account.category.name)) {
    throw new AppError(
      400,
      `Product "${product.name}" is not linked to a Products ledger — recreate or migrate the product`,
    );
  }

  if (!product.account.isActive) {
    throw new AppError(400, `Product "${product.name}" ledger is inactive`);
  }

  return product;
}

/**
 * Batch-resolve Products-ledger accounts for invoice lines.
 * Validates in line order (same errors as per-line resolveMaalKhataAccountForProduct).
 */
export async function resolveMaalKhataAccountsForProductIds(
  tx: Prisma.TransactionClient,
  orderedProductIds: number[],
): Promise<Map<number, ResolvedMaalKhataAccount>> {
  if (orderedProductIds.length === 0) {
    return new Map();
  }

  const uniqueIds = [...new Set(orderedProductIds)];
  const products = await tx.product.findMany({
    where: { id: { in: uniqueIds }, isActive: true },
    include: maalKhataProductInclude,
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  for (const productId of orderedProductIds) {
    assertMaalKhataProduct(byId.get(productId));
  }

  for (const productId of uniqueIds) {
    const product = byId.get(productId)!;
    if (!product.account.ledger) {
      await tx.ledger.create({ data: { accountId: product.accountId, balance: 0 } });
    }
  }

  const resolved = new Map<number, ResolvedMaalKhataAccount>();
  for (const productId of uniqueIds) {
    const product = byId.get(productId)!;
    resolved.set(productId, {
      product,
      maalKhataAccountId: product.accountId,
    });
  }
  return resolved;
}

export async function resolveMaalKhataAccountForProduct(
  tx: Prisma.TransactionClient,
  productId: number,
) {
  const resolved = await resolveMaalKhataAccountsForProductIds(tx, [productId]);
  return resolved.get(productId)!;
}

export async function assertMaalKhataAccount(tx: Prisma.TransactionClient, accountId: number) {
  const account = await tx.account.findFirst({
    where: { id: accountId, isActive: true },
    include: { category: true, ledger: true },
  });
  if (!account) throw new AppError(400, 'Invalid product ledger account');
  if (!isMaalKhataCategoryName(account.category.name)) {
    throw new AppError(400, 'Row account must be a Products ledger');
  }
  if (!account.ledger) {
    await tx.ledger.create({ data: { accountId: account.id, balance: 0 } });
  }
  return account;
}

export async function assertNotMaalKhataLinkedAccount(accountId: number) {
  const product = await prisma.product.findFirst({
    where: { accountId, isActive: true },
    select: { name: true },
  });
  if (product) {
    throw new AppError(
      400,
      `This ledger belongs to product "${product.name}" — remove or deactivate the product instead`,
    );
  }
}
