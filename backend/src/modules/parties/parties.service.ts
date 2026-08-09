import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { PaginatedResult, SELECTOR_MAX_PAGE_SIZE } from '../../utils/pagination';
import { ensureCustomerAccount, ensureSupplierAccount } from '../accounting/accounting.service';

function customerAccountCode(id: number) {
  return `C${String(id).padStart(4, '0')}`;
}

function supplierAccountCode(id: number) {
  return `S${String(id).padStart(4, '0')}`;
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

async function enrichWithLedgerBalance<T extends { id: number; name: string; phone: string | null; email: string | null; address: string | null }>(
  parties: T[],
  codeForId: (id: number) => string,
  extraFields: (party: T) => Record<string, unknown> = () => ({}),
): Promise<PartyWithBalance[]> {
  if (parties.length === 0) return [];

  const codes = parties.map((p) => codeForId(p.id));
  const accounts = await prisma.account.findMany({
    where: { code: { in: codes }, isActive: true },
    select: {
      id: true,
      code: true,
      ledger: { select: { balance: true } },
    },
  });
  const accountByCode = new Map(accounts.map((a) => [a.code, a]));

  return parties.map((party) => {
    const account = accountByCode.get(codeForId(party.id));
    return {
      id: party.id,
      name: party.name,
      phone: party.phone,
      email: party.email,
      address: party.address,
      ...extraFields(party),
      accountId: account?.id ?? null,
      balance: account?.ledger ? Number(account.ledger.balance) : 0,
    };
  });
}

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

async function mapCustomer(party: Prisma.CustomerGetPayload<{ select: typeof customerSelect }>) {
  const [mapped] = await enrichWithLedgerBalance(
    [party],
    customerAccountCode,
    (p) => ({ fatherName: p.fatherName, cnic: p.cnic }),
  );
  return mapped;
}

async function mapSupplier(party: Prisma.SupplierGetPayload<{ select: typeof supplierSelect }>) {
  const [mapped] = await enrichWithLedgerBalance(
    [party],
    supplierAccountCode,
    (p) => ({ contactPerson: p.contactPerson }),
  );
  return mapped;
}

export async function listSaleParties(
  pagination?: { limit: number; offset: number },
): Promise<PaginatedResult<PartyWithBalance>> {
  const limit = pagination?.limit ?? SELECTOR_MAX_PAGE_SIZE;
  const offset = pagination?.offset ?? 0;
  const where = { isActive: true };

  const [parties, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      select: customerSelect,
      orderBy: { name: 'asc' },
      take: limit,
      skip: offset,
    }),
    prisma.customer.count({ where }),
  ]);

  const items = await enrichWithLedgerBalance(parties, customerAccountCode, (p) => ({
    fatherName: p.fatherName,
    cnic: p.cnic,
  }));

  return { items, total, limit, offset };
}

export async function createSaleParty(data: {
  name: string;
  fatherName?: string;
  cnic?: string;
  phone?: string;
  email?: string;
  address?: string;
}) {
  const name = data.name.trim();
  if (!name) throw new AppError(400, 'Name is required');

  const party = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

    await ensureCustomerAccount(tx, { id: created.id, name: created.name });
    return created;
  });

  return mapCustomer(party);
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
  const party = await prisma.customer.findFirst({ where: { id, isActive: true } });
  if (!party) throw new AppError(404, 'Sale party not found');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.customer.update({
      where: { id },
      data: {
        name: data.name?.trim() ?? party.name,
        fatherName: data.fatherName?.trim() ?? party.fatherName,
        cnic: data.cnic?.trim() ?? party.cnic,
        phone: data.phone?.trim() ?? party.phone,
        email: data.email?.trim() ?? party.email,
        address: data.address?.trim() ?? party.address,
      },
    });
    await ensureCustomerAccount(tx, { id: row.id, name: row.name });
    return row;
  });

  return mapCustomer(updated);
}

export async function removeSaleParty(id: number) {
  const party = await prisma.customer.findFirst({ where: { id, isActive: true } });
  if (!party) throw new AppError(404, 'Sale party not found');
  await prisma.customer.update({ where: { id }, data: { isActive: false } });
  return mapCustomer(party);
}

export async function listPurchaseParties(
  pagination?: { limit: number; offset: number },
): Promise<PaginatedResult<PartyWithBalance>> {
  const limit = pagination?.limit ?? SELECTOR_MAX_PAGE_SIZE;
  const offset = pagination?.offset ?? 0;
  const where = { isActive: true };

  const [parties, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      select: supplierSelect,
      orderBy: { name: 'asc' },
      take: limit,
      skip: offset,
    }),
    prisma.supplier.count({ where }),
  ]);

  const items = await enrichWithLedgerBalance(parties, supplierAccountCode, (p) => ({
    contactPerson: p.contactPerson,
  }));

  return { items, total, limit, offset };
}

export async function createPurchaseParty(data: {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
}) {
  const name = data.name.trim();
  if (!name) throw new AppError(400, 'Name is required');

  const party = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.supplier.create({
      data: {
        name,
        contactPerson: data.contactPerson?.trim() || null,
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        address: data.address?.trim() || null,
      },
    });

    await ensureSupplierAccount(tx, { id: created.id, name: created.name });
    return created;
  });

  return mapSupplier(party);
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
  const party = await prisma.supplier.findFirst({ where: { id, isActive: true } });
  if (!party) throw new AppError(404, 'Purchase party not found');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.supplier.update({
      where: { id },
      data: {
        name: data.name?.trim() ?? party.name,
        contactPerson: data.contactPerson?.trim() ?? party.contactPerson,
        phone: data.phone?.trim() ?? party.phone,
        email: data.email?.trim() ?? party.email,
        address: data.address?.trim() ?? party.address,
      },
    });
    await ensureSupplierAccount(tx, { id: row.id, name: row.name });
    return row;
  });

  return mapSupplier(updated);
}

export async function removePurchaseParty(id: number) {
  const party = await prisma.supplier.findFirst({ where: { id, isActive: true } });
  if (!party) throw new AppError(404, 'Purchase party not found');
  await prisma.supplier.update({ where: { id }, data: { isActive: false } });
  return mapSupplier(party);
}
