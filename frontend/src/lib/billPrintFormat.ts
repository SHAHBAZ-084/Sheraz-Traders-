import type { InvoiceDetail, MaalLineDetail, SalePaunchLineDetail, SystemPreferences } from './api';

export type BillLineRow = {
  variety: string;
  bori: number;
  thela: number;
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
  const d = new Date(date);
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

export type CommissionBillRow = {
  variety: string;
  bori: number;
  thela: number;
  weight: number;
  rate: number;
  amount: number;
};

export function saleCommissionLineToBillRow(line: MaalLineDetail): CommissionBillRow {
  const count = Number(line.bagCount ?? 0);
  const isThela = line.boriOrThelaMode === 'THELA';
  return {
    variety: line.qism?.trim() || line.jins?.trim() || '',
    bori: isThela ? 0 : count,
    thela: isThela ? count : 0,
    weight: Number(line.totalWeightKg),
    rate: Number(line.ratePerMaund),
    amount: Number(line.amount),
  };
}

export function sumCommissionBillRows(rows: CommissionBillRow[]) {
  return {
    bori: rows.reduce((s, r) => s + r.bori, 0),
    thela: rows.reduce((s, r) => s + r.thela, 0),
    weight: round2(rows.reduce((s, r) => s + r.weight, 0)),
    amount: round2(rows.reduce((s, r) => s + r.amount, 0)),
  };
}

/** Compact bardana line as on legacy Sale Commission bills: `0 Bori@ 0, 552 Thela@ 45`. */
export function formatCommissionBardanaLine(
  boriQty: number,
  boriRate: number,
  thelaQty: number,
  thelaRate: number,
) {
  const fmt = (n: number) => {
    if (!Number.isFinite(n)) return '0';
    return Number.isInteger(n) ? String(n) : formatBillAmount(n);
  };
  return `${boriQty} Bori@ ${fmt(boriRate)}, ${thelaQty} Thela@ ${fmt(thelaRate)}`;
}

export function maalLineToBillRow(line: MaalLineDetail, kaatPercent: number): BillLineRow {
  const compWeight = Number(line.totalWeightKg);
  const kaat = kaatPercent > 0 ? round2(compWeight * (kaatPercent / 100)) : 0;
  const netWeight = round2(compWeight - kaat);
  const bori = line.boriOrThelaMode === 'BORI' ? Number(line.bagCount) : 0;
  const thela = line.boriOrThelaMode === 'THELA' ? Number(line.bagCount) : 0;

  return {
    variety: line.qism?.trim() || line.jins?.trim() || '',
    bori,
    thela,
    compWeight,
    kaat,
    netWeight,
    rate: Number(line.ratePerMaund),
    amount: Number(line.amount),
  };
}

export function formatBoriThelaLine(
  boriQty: number,
  boriRate: number,
  thelaQty: number,
  thelaRate: number,
) {
  return `${boriQty} Bori @ ${formatBillAmount(boriRate)}, ${thelaQty} Thela @ ${formatBillAmount(thelaRate)}`;
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
  const purchaseThela = tableRows.reduce((s, r) => s + r.thela, 0);
  const kantaDeduction = round2(purchaseThela * prefs.kantaRate);
  const purchaseGoods = sumLineAmounts(tableRows);

  const purchaseNet =
    invoiceType === 'PURCHASE_MAAL'
      ? round2(lines.reduce((s, line) => s + Number(line.netCreditToParty), 0))
      : Math.max(0, round2(purchaseGoods - kantaDeduction));

  return {
    purchaseThela,
    kantaDeduction,
    purchaseNet,
    totals: [
      { label: 'Less Kanta', value: formatBillAmount(kantaDeduction) },
      {
        label: `${purchaseThela} Thela @${formatBillAmount(prefs.kantaRate)}`,
        value: formatBillAmount(0),
      },
    ],
  };
}

export function computeKachiDeductions(
  lines: MaalLineDetail[],
  prefs: Pick<SystemPreferences, 'paleDariPercent' | 'brokeryPercent' | 'marketFeeRate' | 'kaatPercent'>,
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

/** Sale-party (Bill To) row — lower rate / lower kaat. */
export function salePaunchLowerToBillRow(line: SalePaunchLineDetail): BillLineRow {
  return {
    variety: line.qism?.trim() || line.jins?.trim() || '',
    bori: Number(line.bagCount ?? 0),
    thela: Number(line.thelaCount ?? 0),
    compWeight: Number(line.totalWeightKg),
    kaat: Number(line.lowerKaatKg),
    netWeight: Number(line.lowerNetWeightKg),
    rate: Number(line.lowerRatePerMaund),
    amount: Number(line.lowerAmount),
  };
}

/** Product ledger (Bill From) row — upper rate / upper kaat. */
export function salePaunchUpperToBillRow(line: SalePaunchLineDetail): BillLineRow {
  return {
    variety: line.qism?.trim() || line.jins?.trim() || '',
    bori: Number(line.bagCount ?? 0),
    thela: Number(line.thelaCount ?? 0),
    compWeight: Number(line.totalWeightKg),
    kaat: Number(line.kaatKg),
    netWeight: Number(line.netWeightKg),
    rate: Number(line.upperRatePerMaund),
    amount: Number(line.upperAmount),
  };
}

export function resolveSalePaunchBillFromLabel(
  lines: SalePaunchLineDetail[],
  product: string,
): string {
  const names = [
    ...new Set(
      lines
        .map((line) => line.maalKhataAccount?.name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const party = names.length > 0 ? names.join(', ') : 'Product';
  const jins = product.trim();
  return jins ? `${party} [${jins}]` : party;
}

export function computeSalePaunchBillFromTotals(
  lines: SalePaunchLineDetail[],
  prefs: Pick<SystemPreferences, 'kantaRate'>,
) {
  const kantaDeduction = round2(lines.reduce((s, line) => s + Number(line.kanta ?? 0), 0));
  const purchaseNet = round2(lines.reduce((s, line) => s + Number(line.netUpperAmount), 0));
  const purchaseThela = lines.reduce((s, line) => s + Number(line.thelaCount ?? 0), 0);

  return {
    purchaseThela,
    kantaDeduction,
    purchaseNet,
    totals: [
      { label: 'Less Kanta', value: formatBillAmount(kantaDeduction) },
      {
        label: `${purchaseThela} Thela @${formatBillAmount(prefs.kantaRate)}`,
        value: formatBillAmount(0),
      },
    ],
  };
}

export function computePurchaseDeductions(
  lines: MaalLineDetail[],
  prefs: Pick<SystemPreferences, 'marketFeeRate' | 'kantaRate' | 'kaatPercent'>,
  marketFeeEnabled: boolean,
  mazduriEnabled: boolean,
) {
  let goods = 0;
  let dammi = 0;
  let thela = 0;
  let bags = 0;

  for (const line of lines) {
    goods += Number(line.amount);
    if (line.dammiChecked) dammi += Number(line.dammiAmount ?? 0);
    if (line.boriOrThelaMode === 'THELA') thela += Number(line.bagCount);
    const bhartii = Number(line.bhartii);
    if (bhartii > 0) bags += Number(line.totalWeightKg) / bhartii;
  }

  const marketFee = marketFeeEnabled ? bags * prefs.marketFeeRate : 0;
  const kanta = thela * prefs.kantaRate;
  const mazduri = mazduriEnabled ? 0 : 0; // amount embedded in invoice.total

  return {
    goods: round2(goods),
    dammi: round2(dammi),
    kanta: round2(kanta),
    marketFee: round2(marketFee),
    thela,
    mazduri,
  };
}
