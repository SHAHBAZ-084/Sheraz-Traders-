import { InvoiceStatus, InvoiceType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import {
  computeKachiMaalInvoiceTotals,
  computeKachiMaalRow,
  roundMoney,
} from '../invoices/kachi-maal.calculations';
import { resolveProductAverageCost } from '../products/backfill-product-average-cost';
import { getSystemPreferences } from '../preferences/preferences.service';
import { endOfDay, startOfDay } from './ledger-utils';

export type ProfitLossRow = {
  date: string;
  sourceType: 'SALE_INVOICE' | 'KACHI_MAAL';
  reference: string;
  productName: string;
  /** Sale/purchase line quantity. Null for Daami summary rows. */
  quantity: number | null;
  /** Unit cost (WAC / averageCost). Null when cost is unavailable or for Daami rows. */
  purchasePrice: number | null;
  salePrice: number | null;
  /** Zero when costUnavailable — excluded from netProfit / totals. */
  profit: number;
  /** True when no cost basis exists; profit was not calculated (never treated as cost=0). */
  costUnavailable: boolean;
  note: string | null;
};

export type ProfitLossReport = {
  financialYearId: number;
  financialYearLabel: string;
  fromDate: string | null;
  toDate: string | null;
  rows: ProfitLossRow[];
  totalPurchase: number;
  totalSale: number;
  netProfit: number;
  /** Count of sale lines excluded from profit because cost could not be determined. */
  costUnavailableCount: number;
};

function parseDateStart(value: string) {
  return startOfDay(new Date(value));
}

function parseDateEnd(value: string) {
  return endOfDay(new Date(value));
}

function dateInputValue(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function resolveProductName(item: {
  label: string;
  product: { name: string } | null;
}): string {
  const fromProduct = item.product?.name?.trim();
  if (fromProduct) return fromProduct;
  const fromLabel = item.label?.trim();
  return fromLabel || 'Product';
}

export async function getProfitLossReport(params: {
  financialYearId: number;
  fromDate?: string;
  toDate?: string;
  productId?: number;
  categoryId?: number;
  limit?: number;
  offset?: number;
}): Promise<ProfitLossReport & { totalCount: number; pagination?: { total: number; limit: number; offset: number } }> {
  const year = await prisma.financialYear.findFirst({
    where: { id: params.financialYearId },
    select: { id: true, label: true, startDate: true, endDate: true },
  });
  if (!year) throw new AppError(404, 'Financial year not found');

  const yearStart = startOfDay(year.startDate);
  const yearEnd = year.endDate ? endOfDay(year.endDate) : endOfDay(new Date());

  if (params.fromDate && !params.toDate) {
    throw new AppError(400, 'Select both from and to dates, or clear the filter for the full financial year');
  }
  if (!params.fromDate && params.toDate) {
    throw new AppError(400, 'Select both from and to dates, or clear the filter for the full financial year');
  }

  let rangeStart = yearStart;
  let rangeEnd = yearEnd;

  if (params.fromDate && params.toDate) {
    rangeStart = parseDateStart(params.fromDate);
    rangeEnd = parseDateEnd(params.toDate);
    if (rangeStart.getTime() < yearStart.getTime()) {
      throw new AppError(400, 'From date must be within the selected financial year');
    }
    if (rangeEnd.getTime() > yearEnd.getTime()) {
      throw new AppError(400, 'To date must be within the selected financial year');
    }
    if (rangeStart.getTime() > rangeEnd.getTime()) {
      throw new AppError(400, 'From date must be on or before to date');
    }
  }

  const saleItemFilter: {
    productId?: number | { not: null };
    product?: { categoryId: number };
  } = { productId: { not: null } };
  if (params.productId != null) {
    saleItemFilter.productId = params.productId;
  }
  if (params.categoryId != null) {
    saleItemFilter.product = { categoryId: params.categoryId };
  }

  const saleInvoices = await prisma.invoice.findMany({
    where: {
      type: InvoiceType.SALE_INVOICE,
      status: InvoiceStatus.POSTED,
      financialYearId: params.financialYearId,
      invoiceDate: { gte: rangeStart, lte: rangeEnd },
      ...(params.productId != null || params.categoryId != null
        ? { items: { some: saleItemFilter } }
        : {}),
    },
    include: {
      items: {
        where: saleItemFilter,
        include: {
          product: {
            select: {
              id: true,
              name: true,
              kind: true,
              accountId: true,
              averageCost: true,
            },
          },
        },
      },
    },
    orderBy: [{ invoiceDate: 'asc' }, { reference: 'asc' }],
  });

  const productIds = [
    ...new Set(
      saleInvoices.flatMap((inv) =>
        inv.items.map((item) => item.productId).filter((id): id is number => id != null),
      ),
    ),
  ];

  /** Cache resolved unit cost per product for this report run. */
  const unitCostByProductId = new Map<number, number | null>();
  if (productIds.length > 0) {
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, kind: true, accountId: true, averageCost: true, name: true },
    });
    for (const product of products) {
      const resolved = await resolveProductAverageCost(prisma, product);
      unitCostByProductId.set(product.id, resolved?.averageCost ?? null);
    }
  }

  const rows: ProfitLossRow[] = [];
  let totalPurchase = 0;
  let totalSale = 0;
  let costUnavailableCount = 0;

  for (const invoice of saleInvoices) {
    if (!invoice.invoiceDate) continue;
    const saleDate = invoice.invoiceDate;

    for (const item of invoice.items) {
      if (item.productId == null) continue;
      const quantity = Number(item.quantity);
      const salePrice = Number(item.unitPrice);
      const saleAmount = roundMoney(salePrice * quantity);
      const productName = resolveProductName(item);

      const unitCost = unitCostByProductId.has(item.productId)
        ? unitCostByProductId.get(item.productId)!
        : null;

      // Critical: never treat missing/zero cost as a valid basis (that showed full sale as "profit").
      if (unitCost == null || !Number.isFinite(unitCost) || unitCost <= 0) {
        costUnavailableCount += 1;
        rows.push({
          date: saleDate.toISOString(),
          sourceType: 'SALE_INVOICE',
          reference: invoice.reference,
          productName,
          quantity,
          purchasePrice: null,
          salePrice,
          profit: 0,
          costUnavailable: true,
          note: `Cost unavailable for ${productName} — profit not calculated`,
        });
        continue;
      }

      const purchaseAmount = roundMoney(unitCost * quantity);
      const profit = roundMoney(saleAmount - purchaseAmount);

      totalPurchase = roundMoney(totalPurchase + purchaseAmount);
      totalSale = roundMoney(totalSale + saleAmount);

      rows.push({
        date: saleDate.toISOString(),
        sourceType: 'SALE_INVOICE',
        reference: invoice.reference,
        productName,
        quantity,
        purchasePrice: unitCost,
        salePrice,
        profit,
        costUnavailable: false,
        note: null,
      });
    }
  }

  // Daami (Kachi Maal profit) always stays visible regardless of product/category filters.
  {
    const kachiInvoices = await prisma.invoice.findMany({
      where: {
        type: InvoiceType.KACHI_MAAL,
        status: InvoiceStatus.POSTED,
        financialYearId: params.financialYearId,
        invoiceDate: { gte: rangeStart, lte: rangeEnd },
      },
      include: { kachiMaalLines: { orderBy: { sortOrder: 'asc' } } },
      orderBy: [{ invoiceDate: 'asc' }, { reference: 'asc' }],
    });

    const prefs = await getSystemPreferences();
    for (const invoice of kachiInvoices) {
      if (!invoice.invoiceDate) continue;
      const computedRows = invoice.kachiMaalLines.map((line) => {
        const bhartii = Number(line.bhartii);
        return {
          ...computeKachiMaalRow(
            {
              bagCount: Number(line.bagCount),
              bhartii,
              dharanCount: Number(line.dharanCount),
              looseKg: Number(line.looseKg),
              ratePerMaund: Number(line.ratePerMaund),
            },
            prefs,
          ),
          bhartii,
        };
      });
      const totals = computeKachiMaalInvoiceTotals(computedRows, prefs, Number(invoice.miscAmount));
      if (totals.profitAmount <= 0) continue;

      rows.push({
        date: invoice.invoiceDate.toISOString(),
        sourceType: 'KACHI_MAAL',
        reference: invoice.reference,
        productName: 'Daami',
        quantity: null,
        purchasePrice: null,
        salePrice: null,
        profit: totals.profitAmount,
        costUnavailable: false,
        note: null,
      });
    }
  }

  rows.sort((a, b) => {
    const dateCmp = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (dateCmp !== 0) return dateCmp;
    const typeCmp = a.sourceType.localeCompare(b.sourceType);
    if (typeCmp !== 0) return typeCmp;
    const refCmp = a.reference.localeCompare(b.reference, undefined, { numeric: true });
    if (refCmp !== 0) return refCmp;
    return a.productName.localeCompare(b.productName, undefined, { sensitivity: 'base' });
  });

  // netProfit = sale-line profits with known cost + Daami; cost-unavailable rows contribute 0.
  const netProfit = roundMoney(rows.reduce((sum, row) => sum + row.profit, 0));
  const totalCount = rows.length;
  const offset = params.offset ?? 0;
  const limit = params.limit;
  const pageRows = limit != null ? rows.slice(offset, offset + limit) : rows;

  return {
    financialYearId: year.id,
    financialYearLabel: year.label,
    fromDate: params.fromDate ?? null,
    toDate: params.toDate ?? null,
    rows: pageRows,
    totalPurchase,
    totalSale,
    netProfit,
    costUnavailableCount,
    totalCount,
    ...(limit != null
      ? { pagination: { total: totalCount, limit, offset } }
      : {}),
  };
}

export { dateInputValue };
