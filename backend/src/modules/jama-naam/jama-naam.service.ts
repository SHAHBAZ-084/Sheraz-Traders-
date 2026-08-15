import { JamaNaamDirection, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { PARTY_ACCOUNT_CATEGORY_NAMES } from '../accounting/accounting.service';

const PARTY_CATEGORY_SET = new Set<string>(PARTY_ACCOUNT_CATEGORY_NAMES);

export type JamaNaamEntryDto = {
  id: number;
  partyId: number;
  partyName: string;
  productId: number | null;
  productName: string | null;
  quantity: number | null;
  amount: number | null;
  direction: JamaNaamDirection;
  date: string;
  notes: string | null;
  createdAt: string;
};

function mapEntry(row: {
  id: number;
  partyId: number;
  productId: number | null;
  quantity: Prisma.Decimal | null;
  amount: Prisma.Decimal | null;
  direction: JamaNaamDirection;
  date: Date;
  notes: string | null;
  createdAt: Date;
  party: { name: string };
  product: { name: string } | null;
}): JamaNaamEntryDto {
  return {
    id: row.id,
    partyId: row.partyId,
    partyName: row.party.name,
    productId: row.productId,
    productName: row.product?.name ?? null,
    quantity: row.quantity != null ? Number(row.quantity) : null,
    amount: row.amount != null ? Number(row.amount) : null,
    direction: row.direction,
    date: row.date.toISOString(),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

const entryInclude = {
  party: { select: { name: true } },
  product: { select: { name: true } },
} as const;

async function assertLabelParty(partyId: number) {
  const account = await prisma.account.findFirst({
    where: { id: partyId, isActive: true },
    include: { category: true },
  });
  if (!account) throw new AppError(400, 'Party account not found');
  if (!PARTY_CATEGORY_SET.has(account.category.name)) {
    throw new AppError(400, 'Party must be a Sale Party or Purchase Party account');
  }
  return account;
}

async function assertLabelProduct(productId: number) {
  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true },
  });
  if (!product) throw new AppError(400, 'Product not found');
  return product;
}

function normalizeEntryLines(input: {
  productId?: number | null;
  quantity?: number | null;
  amount?: number | null;
}) {
  const hasProductId = input.productId != null && input.productId > 0;
  const hasQuantity = input.quantity != null && Number.isFinite(input.quantity) && input.quantity > 0;
  const hasAmount = input.amount != null && Number.isFinite(input.amount) && input.amount > 0;

  if (hasProductId !== hasQuantity) {
    throw new AppError(400, 'Product and quantity must both be provided together');
  }

  const hasProductLine = hasProductId && hasQuantity;
  if (!hasProductLine && !hasAmount) {
    throw new AppError(400, 'Enter product with quantity, or an amount');
  }

  return {
    productId: hasProductLine ? input.productId! : null,
    quantity: hasProductLine ? input.quantity! : null,
    amount: hasAmount ? input.amount! : null,
  };
}

export async function listJamaNaamEntries(): Promise<JamaNaamEntryDto[]> {
  const rows = await prisma.jamaNaamEntry.findMany({
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    include: entryInclude,
  });
  return rows.map(mapEntry);
}

export async function createJamaNaamEntry(input: {
  partyId: number;
  productId?: number | null;
  quantity?: number | null;
  amount?: number | null;
  direction: JamaNaamDirection;
  date: string;
  notes?: string | null;
}): Promise<JamaNaamEntryDto> {
  const lines = normalizeEntryLines(input);

  await assertLabelParty(input.partyId);
  if (lines.productId != null) {
    await assertLabelProduct(lines.productId);
  }

  const entry = await prisma.jamaNaamEntry.create({
    data: {
      partyId: input.partyId,
      productId: lines.productId,
      quantity: lines.quantity,
      amount: lines.amount,
      direction: input.direction,
      date: new Date(input.date),
      notes: input.notes?.trim() || null,
    },
    include: entryInclude,
  });

  return mapEntry(entry);
}

export async function settleJamaNaamEntry(id: number): Promise<void> {
  const existing = await prisma.jamaNaamEntry.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Entry not found');
  await prisma.jamaNaamEntry.delete({ where: { id } });
}
