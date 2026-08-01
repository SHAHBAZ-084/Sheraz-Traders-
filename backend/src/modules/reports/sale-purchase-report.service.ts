import { BoriThelaMode, InvoiceStatus, InvoiceType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import { endOfDay, startOfDay } from '../accounting/ledger-utils';

export type SalePurchaseMode = 'SALE' | 'PURCHASE';
export type SalePurchaseTypeFilter = 'ALL' | 'COMMISSION' | 'PAUNCH' | 'MAAL';

export type SalePurchaseReportRow = {
  invoiceId: number;
  invoiceReference: string;
  invoiceNumber: string;
  date: string;
  category: 'COMMISSION' | 'PAUNCH' | 'MAAL';
  partyAccountId: number;
  partyName: string;
  product: string;
  thela: number;
  bori: number;
  weight: number;
  totalPrice: number;
  netBill: number;
};

export type SalePurchasePartyGroup = {
  partyAccountId: number;
  partyName: string;
  rows: SalePurchaseReportRow[];
  subtotal: {
    thela: number;
    bori: number;
    weight: number;
    totalPrice: number;
    netBill: number;
  };
};

export type SalePurchaseCategoryGroup = {
  category: 'COMMISSION' | 'PAUNCH' | 'MAAL';
  label: string;
  parties: SalePurchasePartyGroup[];
  subtotal: {
    thela: number;
    bori: number;
    weight: number;
    totalPrice: number;
    netBill: number;
  };
};

function parseDay(dateStr: string, end: boolean): Date {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'Invalid date');
  return end ? endOfDay(d) : startOfDay(d);
}

function displayInvoiceNumber(reference: string): string {
  const m = reference.match(/(\d+)\s*$/);
  if (m) return String(Number(m[1]));
  return reference;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function bagsFromMode(mode: BoriThelaMode, bagCount: number): { bori: number; thela: number } {
  const bags = Math.max(0, num(bagCount));
  return mode === BoriThelaMode.THELA
    ? { bori: 0, thela: bags }
    : { bori: bags, thela: 0 };
}

function emptyTotals() {
  return { thela: 0, bori: 0, weight: 0, totalPrice: 0, netBill: 0 };
}

function addTotals(
  a: { thela: number; bori: number; weight: number; totalPrice: number; netBill: number },
  b: { thela: number; bori: number; weight: number; totalPrice: number; netBill: number },
) {
  a.thela += b.thela;
  a.bori += b.bori;
  a.weight += b.weight;
  a.totalPrice += b.totalPrice;
  a.netBill += b.netBill;
}

function categoryLabel(category: 'COMMISSION' | 'PAUNCH' | 'MAAL'): string {
  if (category === 'COMMISSION') return 'Commission';
  if (category === 'PAUNCH') return 'Paunch';
  return 'Maal';
}

function productMatches(label: string, productName: string): boolean {
  const a = label.trim().toLowerCase();
  const b = productName.trim().toLowerCase();
  if (!a || a === '—') return false;
  return a.includes(b) || b.includes(a);
}

function resolveTypes(mode: SalePurchaseMode, typeFilter: SalePurchaseTypeFilter): InvoiceType[] {
  if (mode === 'PURCHASE') {
    if (typeFilter === 'COMMISSION' || typeFilter === 'PAUNCH') {
      throw new AppError(400, 'Purchase report only supports Maal (Purchase to Maal)');
    }
    return [InvoiceType.PURCHASE_MAAL];
  }
  if (typeFilter === 'MAAL') {
    throw new AppError(400, 'Sale report does not include Purchase to Maal');
  }
  if (typeFilter === 'COMMISSION') return [InvoiceType.SALE_COMMISSION];
  if (typeFilter === 'PAUNCH') return [InvoiceType.SALE_PAUNCH];
  return [InvoiceType.SALE_COMMISSION, InvoiceType.SALE_PAUNCH];
}

function groupRows(rows: SalePurchaseReportRow[], groupByCategory: boolean) {
  const grandTotal = emptyTotals();
  for (const row of rows) addTotals(grandTotal, row);

  const categoryOrder: Array<'COMMISSION' | 'PAUNCH' | 'MAAL'> = ['COMMISSION', 'PAUNCH', 'MAAL'];
  const categories: SalePurchaseCategoryGroup[] = [];

  if (groupByCategory) {
    for (const key of categoryOrder) {
      const catRows = rows.filter((r) => r.category === key);
      if (catRows.length === 0) continue;
      categories.push(buildCategoryGroup(key, categoryLabel(key), catRows));
    }
  } else if (rows.length > 0) {
    categories.push(buildCategoryGroup(rows[0]!.category, '', rows));
  }

  return { categories, grandTotal };
}

function buildCategoryGroup(
  category: 'COMMISSION' | 'PAUNCH' | 'MAAL',
  label: string,
  catRows: SalePurchaseReportRow[],
): SalePurchaseCategoryGroup {
  const partyMap = new Map<number, SalePurchasePartyGroup>();
  for (const row of catRows) {
    let party = partyMap.get(row.partyAccountId);
    if (!party) {
      party = {
        partyAccountId: row.partyAccountId,
        partyName: row.partyName,
        rows: [],
        subtotal: emptyTotals(),
      };
      partyMap.set(row.partyAccountId, party);
    }
    party.rows.push(row);
    addTotals(party.subtotal, row);
  }

  const parties = [...partyMap.values()].sort((a, b) =>
    a.partyName.localeCompare(b.partyName, undefined, { sensitivity: 'base' }),
  );
  const subtotal = emptyTotals();
  for (const p of parties) addTotals(subtotal, p.subtotal);

  return { category, label, parties, subtotal };
}

export async function getSalePurchaseReport(params: {
  mode: SalePurchaseMode;
  typeFilter: SalePurchaseTypeFilter;
  fromDate: string;
  toDate: string;
  partyAccountId?: number | null;
  productId?: number | null;
}) {
  const types = resolveTypes(params.mode, params.typeFilter);
  const from = parseDay(params.fromDate, false);
  const to = parseDay(params.toDate, true);
  if (from > to) throw new AppError(400, 'From date must be on or before To date');

  let productName: string | null = null;
  let maalKhataAccountId: number | null = null;
  if (params.productId != null && params.productId > 0) {
    const product = await prisma.product.findFirst({
      where: { id: params.productId, isActive: true },
      select: { id: true, accountId: true, name: true },
    });
    if (!product) throw new AppError(404, 'Product not found');
    productName = product.name;
    maalKhataAccountId = product.accountId;
  }

  const where: Prisma.InvoiceWhereInput = {
    status: InvoiceStatus.POSTED,
    type: { in: types },
    invoiceDate: { gte: from, lte: to },
  };

  if (params.mode === 'PURCHASE' && params.partyAccountId) {
    where.purchaseMaalLines = { some: { partyAccountId: params.partyAccountId } };
  }
  if (params.mode === 'SALE' && params.partyAccountId) {
    where.debitAccountId = params.partyAccountId;
  }
  if (params.productId && types.length === 1 && types[0] === InvoiceType.PURCHASE_MAAL) {
    where.productId = params.productId;
  }
  if (params.productId && types.length === 1 && types[0] === InvoiceType.SALE_PAUNCH && maalKhataAccountId) {
    where.salePaunchLines = { some: { maalKhataAccountId } };
  }

  const invoices = await prisma.invoice.findMany({
    where,
    include: {
      product: { select: { id: true, name: true, code: true } },
      debitAccount: { select: { id: true, name: true, code: true } },
      purchaseMaalLines: {
        include: { partyAccount: { select: { id: true, name: true, code: true } } },
        orderBy: { sortOrder: 'asc' },
      },
      salePaunchLines: {
        include: { maalKhataAccount: { select: { id: true, name: true, code: true } } },
        orderBy: { sortOrder: 'asc' },
      },
      saleCommissionLines: {
        include: { partyAccount: { select: { id: true, name: true, code: true } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: [{ invoiceDate: 'asc' }, { id: 'asc' }],
  });

  const rows: SalePurchaseReportRow[] = [];

  for (const invoice of invoices) {
    const date = (invoice.invoiceDate ?? invoice.createdAt).toISOString();
    const invoiceNumber = displayInvoiceNumber(invoice.reference);

    if (invoice.type === InvoiceType.PURCHASE_MAAL) {
      for (const line of invoice.purchaseMaalLines) {
        if (params.partyAccountId && line.partyAccountId !== params.partyAccountId) continue;
        if (params.productId && invoice.productId !== params.productId) continue;
        const bags = bagsFromMode(line.boriOrThelaMode, num(line.bagCount));
        rows.push({
          invoiceId: invoice.id,
          invoiceReference: invoice.reference,
          invoiceNumber,
          date,
          category: 'MAAL',
          partyAccountId: line.partyAccountId,
          partyName: line.partyAccount.name,
          product: invoice.product?.name
            || invoice.jins?.trim()
            || line.jins?.trim()
            || '—',
          thela: bags.thela,
          bori: bags.bori,
          weight: num(line.totalWeightKg),
          totalPrice: num(line.amount),
          netBill: num(line.netCreditToParty),
        });
      }
    }

    if (invoice.type === InvoiceType.SALE_PAUNCH) {
      const salePartyId = invoice.debitAccountId;
      const salePartyName = invoice.debitAccount?.name;
      if (!salePartyId || !salePartyName) continue;
      if (params.partyAccountId && salePartyId !== params.partyAccountId) continue;

      for (const line of invoice.salePaunchLines) {
        if (maalKhataAccountId && line.maalKhataAccountId !== maalKhataAccountId) continue;
        const productLabel = line.maalKhataAccount.name.replace(/^Maal Khata\s+/i, '').trim()
          || line.jins?.trim()
          || invoice.jins?.trim()
          || '—';
        rows.push({
          invoiceId: invoice.id,
          invoiceReference: invoice.reference,
          invoiceNumber,
          date,
          category: 'PAUNCH',
          partyAccountId: salePartyId,
          partyName: salePartyName,
          product: productLabel,
          thela: Math.max(0, num(line.thelaCount)),
          bori: Math.max(0, num(line.bagCount)),
          weight: num(line.lowerNetWeightKg || line.netWeightKg || line.totalWeightKg),
          totalPrice: num(line.lowerAmount),
          netBill: num(line.lowerAmount),
        });
      }
    }

    if (invoice.type === InvoiceType.SALE_COMMISSION) {
      const salePartyId = invoice.debitAccountId;
      const salePartyName = invoice.debitAccount?.name;
      if (!salePartyId || !salePartyName) continue;
      if (params.partyAccountId && salePartyId !== params.partyAccountId) continue;

      for (const line of invoice.saleCommissionLines) {
        const productLabel = line.qism?.trim()
          || line.jins?.trim()
          || invoice.jins?.trim()
          || '—';
        if (productName && !productMatches(productLabel, productName)) continue;

        const bags = bagsFromMode(line.boriOrThelaMode, num(line.bagCount));
        rows.push({
          invoiceId: invoice.id,
          invoiceReference: invoice.reference,
          invoiceNumber,
          date,
          category: 'COMMISSION',
          partyAccountId: salePartyId,
          partyName: salePartyName,
          product: productLabel,
          thela: bags.thela,
          bori: bags.bori,
          weight: num(line.totalWeightKg),
          totalPrice: num(line.amount),
          netBill: num(line.netCreditToParty),
        });
      }
    }
  }

  const groupByCategory = params.typeFilter === 'ALL' && params.mode === 'SALE';
  const { categories, grandTotal } = groupRows(rows, groupByCategory);

  return {
    mode: params.mode,
    typeFilter: params.typeFilter,
    fromDate: params.fromDate,
    toDate: params.toDate,
    title: params.mode === 'SALE' ? 'Sale Report' : 'Purchase Report',
    categories,
    grandTotal,
    rowCount: rows.length,
  };
}
