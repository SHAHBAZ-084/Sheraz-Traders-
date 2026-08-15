import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { PaginatedResult, SELECTOR_MAX_PAGE_SIZE } from '../../utils/pagination';
import {
  ensureCustomerAccount,
  ensureSupplierAccount,
  KACHI_MAAL_CATEGORY_NAMES,
  postOpeningBalanceInTx,
} from '../accounting/accounting.service';
import { defaultOpeningSide } from '../accounting/ledger-utils';

const SALE_PARTY_CATEGORY_NAMES = [KACHI_MAAL_CATEGORY_NAMES.SALE_PARTY] as const;

const PURCHASE_PARTY_CATEGORY_NAMES = [
  KACHI_MAAL_CATEGORY_NAMES.PURCHASE_PARTY,
  'Int. Purchase Party',
  'Ext. Purchase Party',
] as const;

function customerAccountCode(id: number) {
  return `C${String(id).padStart(4, '0')}`;
}

function supplierAccountCode(id: number) {
  return `S${String(id).padStart(4, '0')}`;
}

function parseCustomerIdFromCode(code: string) {
  const match = /^C(\d+)$/.exec(code);
  return match ? parseInt(match[1], 10) : null;
}

function parseSupplierIdFromCode(code: string) {
  const match = /^S(\d+)$/.exec(code);
  return match ? parseInt(match[1], 10) : null;
}

export type PartyWithBalance = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  fatherName?: string | null;
  cnic?: string | null;
  contactPerson?: string | null;
  accountId: number | null;
  /** Signed ledger balance from linked Account → Ledger (positive = Dr, negative = Cr). */
  balance: number;
};

type LedgerAccountRow = {
  id: number;
  name: string;
  code: string;
  ledger: { balance: unknown } | null;
};

const customerSelect = {
  id: true,
  name: true,
  fatherName: true,
  cnic: true,
  phone: true,
  email: true,
  address: true,
} satisfies Prisma.CustomerSelect;

const supplierSelect = {
  id: true,
  name: true,
  contactPerson: true,
  phone: true,
  email: true,
  address: true,
} satisfies Prisma.SupplierSelect;

async function resolveCategoryIds(categoryNames: readonly string[]) {
  const categories = await prisma.accountCategory.findMany({
    where: { isActive: true, name: { in: [...categoryNames] } },
    select: { id: true },
  });
  return categories.map((c) => c.id);
}

async function mapLedgerAccountsToParties(accounts: LedgerAccountRow[]): Promise<PartyWithBalance[]> {
  if (accounts.length === 0) return [];

  const customerIds = accounts
    .map((a) => parseCustomerIdFromCode(a.code))
    .filter((id): id is number => id != null);
  const supplierIds = accounts
    .map((a) => parseSupplierIdFromCode(a.code))
    .filter((id): id is number => id != null);

  const [customers, suppliers] = await Promise.all([
    customerIds.length
      ? prisma.customer.findMany({ where: { id: { in: customerIds } }, select: customerSelect })
      : Promise.resolve([]),
    supplierIds.length
      ? prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: supplierSelect })
      : Promise.resolve([]),
  ]);

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

  return accounts.map((account) => {
    const customerId = parseCustomerIdFromCode(account.code);
    const supplierId = parseSupplierIdFromCode(account.code);
    const customer = customerId != null ? customerById.get(customerId) : undefined;
    const supplier = supplierId != null ? supplierById.get(supplierId) : undefined;

    return {
      id: account.id,
      name: account.name,
      phone: customer?.phone ?? supplier?.phone ?? null,
      email: customer?.email ?? supplier?.email ?? null,
      address: customer?.address ?? supplier?.address ?? null,
      fatherName: customer?.fatherName ?? null,
      cnic: customer?.cnic ?? null,
      contactPerson: supplier?.contactPerson ?? null,
      accountId: account.id,
      balance: account.ledger ? Number(account.ledger.balance) : 0,
    };
  });
}

async function listPartyLedgerAccounts(
  categoryNames: readonly string[],
  pagination?: { limit: number; offset: number },
): Promise<PaginatedResult<PartyWithBalance>> {
  const limit = pagination?.limit ?? SELECTOR_MAX_PAGE_SIZE;
  const offset = pagination?.offset ?? 0;
  const categoryIds = await resolveCategoryIds(categoryNames);

  if (categoryIds.length === 0) {
    return { items: [], total: 0, limit, offset };
  }

  const where = { isActive: true, categoryId: { in: categoryIds } };

  const [accounts, total] = await Promise.all([
    prisma.account.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        ledger: { select: { balance: true } },
      },
      orderBy: { name: 'asc' },
      take: limit,
      skip: offset,
    }),
    prisma.account.count({ where }),
  ]);

  const items = await mapLedgerAccountsToParties(accounts);
  return { items, total, limit, offset };
}

async function getSalePartyAccount(accountId: number) {
  const categoryIds = await resolveCategoryIds(SALE_PARTY_CATEGORY_NAMES);
  if (categoryIds.length === 0) throw new AppError(404, 'Sale party not found');

  const account = await prisma.account.findFirst({
    where: { id: accountId, isActive: true, categoryId: { in: categoryIds } },
    select: {
      id: true,
      name: true,
      code: true,
      ledger: { select: { balance: true } },
    },
  });
  if (!account) throw new AppError(404, 'Sale party not found');
  return account;
}

async function getPurchasePartyAccount(accountId: number) {
  const categoryIds = await resolveCategoryIds(PURCHASE_PARTY_CATEGORY_NAMES);
  if (categoryIds.length === 0) throw new AppError(404, 'Purchase party not found');

  const account = await prisma.account.findFirst({
    where: { id: accountId, isActive: true, categoryId: { in: categoryIds } },
    select: {
      id: true,
      name: true,
      code: true,
      ledger: { select: { balance: true } },
    },
  });
  if (!account) throw new AppError(404, 'Purchase party not found');
  return account;
}

async function mapAccountParty(account: LedgerAccountRow) {
  const [party] = await mapLedgerAccountsToParties([account]);
  return party;
}

export async function listSaleParties(
  pagination?: { limit: number; offset: number },
): Promise<PaginatedResult<PartyWithBalance>> {
  return listPartyLedgerAccounts(SALE_PARTY_CATEGORY_NAMES, pagination);
}

export async function createSaleParty(data: {
  name: string;
  fatherName?: string;
  cnic?: string;
  phone?: string;
  email?: string;
  address?: string;
  openingBalance?: number;
  openingBalanceSide?: 'DR' | 'CR';
}) {
  const name = data.name.trim();
  if (!name) throw new AppError(400, 'Name is required');

  const amount = Math.abs(data.openingBalance ?? 0);
  const side = data.openingBalanceSide ?? defaultOpeningSide('ASSET');

  const account = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.customer.create({
      data: {
        name,
        fatherName: data.fatherName?.trim() || null,
        cnic: data.cnic?.trim() || null,
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        address: data.address?.trim() || null,
      },
    });

    const ensured = await ensureCustomerAccount(tx, { id: created.id, name: created.name });
    if (amount > 0 && ensured.ledger) {
      await postOpeningBalanceInTx(tx, {
        ledgerId: ensured.ledger.id,
        accountName: ensured.name,
        amount,
        side,
        notes: 'Opening Balance',
      });
    }

    return tx.account.findUniqueOrThrow({
      where: { id: ensured.id },
      include: { ledger: true },
    });
  });

  return mapAccountParty({
    id: account.id,
    name: account.name,
    code: account.code,
    ledger: account.ledger,
  });
}

export async function updateSaleParty(
  id: number,
  data: Partial<{
    name: string;
    fatherName: string;
    cnic: string;
    phone: string;
    email: string;
    address: string;
  }>,
) {
  const account = await getSalePartyAccount(id);
  const customerId = parseCustomerIdFromCode(account.code);

  const updatedAccount = await prisma.$transaction(async (tx) => {
    if (customerId != null) {
      const party = await tx.customer.findFirst({ where: { id: customerId, isActive: true } });
      if (party) {
        const row = await tx.customer.update({
          where: { id: customerId },
          data: {
            name: data.name?.trim() ?? party.name,
            fatherName: data.fatherName?.trim() ?? party.fatherName,
            cnic: data.cnic?.trim() ?? party.cnic,
            phone: data.phone?.trim() ?? party.phone,
            email: data.email?.trim() ?? party.email,
            address: data.address?.trim() ?? party.address,
          },
        });
        return ensureCustomerAccount(tx, { id: row.id, name: row.name });
      }
    }

    if (data.name?.trim()) {
      await tx.account.update({ where: { id }, data: { name: data.name.trim() } });
    }
    return tx.account.findUniqueOrThrow({
      where: { id },
      include: { ledger: true },
    });
  });

  return mapAccountParty({
    id: updatedAccount.id,
    name: updatedAccount.name,
    code: updatedAccount.code,
    ledger: updatedAccount.ledger,
  });
}

export async function removeSaleParty(id: number) {
  const account = await getSalePartyAccount(id);
  const customerId = parseCustomerIdFromCode(account.code);

  await prisma.$transaction(async (tx) => {
    await tx.account.update({ where: { id: account.id }, data: { isActive: false } });
    if (customerId != null) {
      await tx.customer.updateMany({ where: { id: customerId, isActive: true }, data: { isActive: false } });
    }
  });

  return mapAccountParty(account);
}

export async function listPurchaseParties(
  pagination?: { limit: number; offset: number },
): Promise<PaginatedResult<PartyWithBalance>> {
  return listPartyLedgerAccounts(PURCHASE_PARTY_CATEGORY_NAMES, pagination);
}

export async function createPurchaseParty(data: {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  openingBalance?: number;
  openingBalanceSide?: 'DR' | 'CR';
}) {
  const name = data.name.trim();
  if (!name) throw new AppError(400, 'Name is required');

  const amount = Math.abs(data.openingBalance ?? 0);
  const side = data.openingBalanceSide ?? defaultOpeningSide('LIABILITY');

  const account = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.supplier.create({
      data: {
        name,
        contactPerson: data.contactPerson?.trim() || null,
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        address: data.address?.trim() || null,
      },
    });

    const ensured = await ensureSupplierAccount(tx, { id: created.id, name: created.name });
    if (amount > 0 && ensured.ledger) {
      await postOpeningBalanceInTx(tx, {
        ledgerId: ensured.ledger.id,
        accountName: ensured.name,
        amount,
        side,
        notes: 'Opening Balance',
      });
    }

    return tx.account.findUniqueOrThrow({
      where: { id: ensured.id },
      include: { ledger: true },
    });
  });

  return mapAccountParty({
    id: account.id,
    name: account.name,
    code: account.code,
    ledger: account.ledger,
  });
}

export async function updatePurchaseParty(
  id: number,
  data: Partial<{
    name: string;
    contactPerson: string;
    phone: string;
    email: string;
    address: string;
  }>,
) {
  const account = await getPurchasePartyAccount(id);
  const supplierId = parseSupplierIdFromCode(account.code);

  const updatedAccount = await prisma.$transaction(async (tx) => {
    if (supplierId != null) {
      const party = await tx.supplier.findFirst({ where: { id: supplierId, isActive: true } });
      if (party) {
        const row = await tx.supplier.update({
          where: { id: supplierId },
          data: {
            name: data.name?.trim() ?? party.name,
            contactPerson: data.contactPerson?.trim() ?? party.contactPerson,
            phone: data.phone?.trim() ?? party.phone,
            email: data.email?.trim() ?? party.email,
            address: data.address?.trim() ?? party.address,
          },
        });
        return ensureSupplierAccount(tx, { id: row.id, name: row.name });
      }
    }

    if (data.name?.trim()) {
      await tx.account.update({ where: { id }, data: { name: data.name.trim() } });
    }
    return tx.account.findUniqueOrThrow({
      where: { id },
      include: { ledger: true },
    });
  });

  return mapAccountParty({
    id: updatedAccount.id,
    name: updatedAccount.name,
    code: updatedAccount.code,
    ledger: updatedAccount.ledger,
  });
}

export async function removePurchaseParty(id: number) {
  const account = await getPurchasePartyAccount(id);
  const supplierId = parseSupplierIdFromCode(account.code);

  await prisma.$transaction(async (tx) => {
    await tx.account.update({ where: { id: account.id }, data: { isActive: false } });
    if (supplierId != null) {
      await tx.supplier.updateMany({ where: { id: supplierId, isActive: true }, data: { isActive: false } });
    }
  });

  return mapAccountParty(account);
}
