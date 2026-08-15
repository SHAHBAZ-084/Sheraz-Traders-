import { InvoiceStatus, InvoiceType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';
import {
  computeKachiMaalInvoiceTotals,
  computeKachiMaalRow,
  roundMoney,
} from '../invoices/kachi-maal.calculations';
import { getSystemPreferences } from '../preferences/preferences.service';
import { endOfDay, startOfDay } from './ledger-utils';

export type ProfitLossRow = {
  date: string;
  sourceType: 'SALE_INVOICE' | 'KACHI_MAAL';
  reference: string;
  productName: string;
  purchasePrice: number | null;
  salePrice: number | null;
  profit: number;
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

type PurchaseSlice = { date: Date; quantity: number; unitPrice: number };

function averagePurchaseRate(items: PurchaseSlice[]): number | null {
  let totalQty = 0;
  let totalValue = 0;
  for (const item of items) {
    totalQty += item.quantity;
    totalValue += item.quantity * item.unitPrice;
  }
  return totalQty > 0 ? totalValue / totalQty : null;
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
}): Promise<ProfitLossReport> {
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
        include: { product: { select: { name: true } } },
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

  const purchaseItemsByProduct = new Map<number, PurchaseSlice[]>();
  if (productIds.length > 0) {
    const purchaseItems = await prisma.invoiceItem.findMany({
      where: {
        productId: { in: productIds },
        invoice: {
          type: InvoiceType.PURCHASE_INVOICE,
          status: InvoiceStatus.POSTED,
        },
      },
      select: {
        productId: true,
        quantity: true,
        unitPrice: true,
        invoice: { select: { invoiceDate: true } },
      },
    });

    for (const item of purchaseItems) {
      if (item.productId == null || item.invoice.invoiceDate == null) continue;
      const list = purchaseItemsByProduct.get(item.productId) ?? [];
      list.push({
        date: item.invoice.invoiceDate,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
      });
      purchaseItemsByProduct.set(item.productId, list);
    }
  }

  const rows: ProfitLossRow[] = [];
  let totalPurchase = 0;
  let totalSale = 0;

  for (const invoice of saleInvoices) {
    if (!invoice.invoiceDate) continue;
    const saleDate = invoice.invoiceDate;

    for (const item of invoice.items) {
      if (item.productId == null) continue;
      const quantity = Number(item.quantity);
      const salePrice = Number(item.unitPrice);
      const purchaseHistory = purchaseItemsByProduct.get(item.productId) ?? [];
      const purchasePrice = averagePurchaseRate(purchaseHistory);
      const purchaseAmount = roundMoney((purchasePrice ?? 0) * quantity);
      const saleAmount = roundMoney(salePrice * quantity);
      const profit = roundMoney(saleAmount - purchaseAmount);

      totalPurchase = roundMoney(totalPurchase + purchaseAmount);
      totalSale = roundMoney(totalSale + saleAmount);

      rows.push({
        date: saleDate.toISOString(),
        sourceType: 'SALE_INVOICE',
        reference: invoice.reference,
        productName: resolveProductName(item),
        purchasePrice,
        salePrice,
        profit,
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
        purchasePrice: null,
        salePrice: null,
        profit: totals.profitAmount,
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

  const netProfit = roundMoney(rows.reduce((sum, row) => sum + row.profit, 0));

  return {
    financialYearId: year.id,
    financialYearLabel: year.label,
    fromDate: params.fromDate ?? null,
    toDate: params.toDate ?? null,
    rows,
    totalPurchase,
    totalSale,
    netProfit,
  };
}

export { dateInputValue };
