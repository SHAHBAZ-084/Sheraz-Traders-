import type { InvoiceDetail, MaalLineDetail, SystemPreferences } from './api';
import { parseDateValue } from './format';

export type BillLineRow = {
  variety: string;
  bags: number;
  compWeight: number;
  kaat: number;
  netWeight: number;
  rate: number;
  amount: number;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function parseInvoiceDisplayNumber(reference: string) {
  const seq = reference.split('-')[1];
  if (!seq) return reference;
  const n = parseInt(seq, 10);
  return Number.isFinite(n) ? String(n) : reference;
}

export function formatBillDate(date: string | Date) {
  const d = parseDateValue(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  const year = String(d.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

export function formatBillAmount(amount: number | string) {
  return Number(amount).toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatBillWeight(amount: number | string) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '0';
  const hasFraction = Math.abs(n % 1) > 1e-9;
  return n.toLocaleString('en-PK', {
    minimumFractionDigits: hasFraction ? 1 : 0,
    maximumFractionDigits: 1,
  });
}

export function maalLineToBillRow(line: MaalLineDetail, kaatPercent: number): BillLineRow {
  const compWeight = Number(line.totalWeightKg);
  const kaat = kaatPercent > 0 ? round2(compWeight * (kaatPercent / 100)) : 0;
  const netWeight = round2(compWeight - kaat);
  const bags = Number(line.bagCount);

  return {
    variety: line.qism?.trim() || line.jins?.trim() || '',
    bags,
    compWeight,
    kaat,
    netWeight,
    rate: Number(line.ratePerMaund),
    amount: Number(line.amount),
  };
}

export function invoiceBillDate(invoice: InvoiceDetail) {
  return invoice.invoiceDate ?? invoice.createdAt;
}

export function sumLineAmounts(rows: BillLineRow[]) {
  return round2(rows.reduce((s, r) => s + r.amount, 0));
}

/** Bill From party for Purchase/Kachi Maal — supplier record or maal line party accounts. */
export function resolveMaalBillFromPartyName(
  invoice: Pick<InvoiceDetail, 'supplier'>,
  lines: MaalLineDetail[],
): string | null {
  if (invoice.supplier?.name?.trim()) {
    return invoice.supplier.name.trim();
  }

  const names = [
    ...new Set(
      lines
        .map((line) => line.partyAccount?.name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];

  if (names.length === 0) return null;
  return names.join(', ');
}

export function computeMaalBillFromTotals(
  lines: MaalLineDetail[],
  tableRows: BillLineRow[],
  prefs: Pick<SystemPreferences, 'kantaRate'>,
  invoiceType: InvoiceDetail['type'],
) {
  const totalBags = tableRows.reduce((s, r) => s + r.bags, 0);
  const kantaDeduction = round2(totalBags * prefs.kantaRate);
  const purchaseGoods = sumLineAmounts(tableRows);

  const purchaseNet = Math.max(0, round2(purchaseGoods - kantaDeduction));
  void invoiceType;
  void lines;

  return {
    totalBags,
    kantaDeduction,
    purchaseNet,
    totals: [
      { label: 'Less Kanta', value: formatBillAmount(kantaDeduction) },
      {
        label: `${totalBags} Bags @${formatBillAmount(prefs.kantaRate)}`,
        value: formatBillAmount(0),
      },
    ],
  };
}

export function computeKachiDeductions(
  lines: MaalLineDetail[],
  prefs: Pick<SystemPreferences, 'paleDariPercent' | 'brokeryPercent' | 'marketFeeRate'>,
) {
  let goods = 0;
  let paleDari = 0;
  let brokery = 0;
  let bags = 0;

  for (const line of lines) {
    const amount = Number(line.amount);
    goods += amount;
    paleDari += amount * (prefs.paleDariPercent / 100);
    brokery += amount * (prefs.brokeryPercent / 100);
    const bhartii = Number(line.bhartii);
    if (bhartii > 0) bags += Number(line.totalWeightKg) / bhartii;
  }

  const marketFee = bags * prefs.marketFeeRate;
  return {
    goods: round2(goods),
    deduction: round2(paleDari + brokery + marketFee),
  };
}
