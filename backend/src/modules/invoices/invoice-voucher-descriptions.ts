import { formatWeightMaundKg } from './kachi-maal.calculations';

export type InvoiceVoucherHeader = {
  tafseel?: string | null;
  gariNo?: string | null;
};

export type InvoiceVoucherLine = {
  totalWeightKg: number;
  ratePerMaund: number;
  jins?: string | null;
};

export type InvoiceProductLineDescription = {
  productName: string;
  quantity: number;
  rate: number;
};

function formatInvoiceLineNumber(value: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  return String(rounded);
}

/** Sale/Purchase Invoice ledger description — e.g. `Urea 5@4550+Dap 6@12500`. */
export function formatInvoiceProductLinesDescription(lines: InvoiceProductLineDescription[]): string {
  return lines
    .map((line) => {
      const name = line.productName.trim() || 'Item';
      return `${name} ${formatInvoiceLineNumber(line.quantity)}@${formatInvoiceLineNumber(line.rate)}`;
    })
    .join('+');
}

export function voucherReferenceFromBillNo(billNo?: string | null): string {
  return billNo?.trim() ?? '';
}

function formatRate(rate: number) {
  return Number(rate).toLocaleString('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function invoiceVoucherHeaderSuffix(header: InvoiceVoucherHeader): string {
  const parts: string[] = [];
  if (header.tafseel?.trim()) parts.push(`Tafseel: ${header.tafseel.trim()}`);
  if (header.gariNo?.trim()) parts.push(`Gari#: ${header.gariNo.trim()}`);
  if (parts.length === 0) return '';
  return ` — ${parts.join(', ')}`;
}

function resolveLineJins(line: InvoiceVoucherLine, invoiceJins?: string | null): string | null {
  const fromLine = line.jins?.trim();
  if (fromLine) return fromLine;
  const fromInvoice = invoiceJins?.trim();
  return fromInvoice || null;
}

function formatLineWeightWithJins(line: InvoiceVoucherLine, invoiceJins?: string | null): string {
  const weight = formatWeightMaundKg(line.totalWeightKg);
  const jins = resolveLineJins(line, invoiceJins);
  return jins ? `${jins} ${weight}` : weight;
}

export function rowLegDescription(
  line: InvoiceVoucherLine,
  header: InvoiceVoucherHeader,
  invoiceJins?: string | null,
): string {
  const core = `${formatLineWeightWithJins(line, invoiceJins)} @ Rs ${formatRate(line.ratePerMaund)}/maund`;
  return core + invoiceVoucherHeaderSuffix(header);
}

export function blendedLegDescription(
  lines: InvoiceVoucherLine[],
  header: InvoiceVoucherHeader,
  invoiceJins?: string | null,
): string {
  const totalWeightKg = lines.reduce((sum, line) => sum + Number(line.totalWeightKg), 0);
  if (totalWeightKg <= 0) {
    const suffix = invoiceVoucherHeaderSuffix(header);
    return suffix ? suffix.replace(/^ — /, '') : '—';
  }

  const resolvedJins = lines.map((line) => resolveLineJins(line, invoiceJins));
  const uniqueJins = [...new Set(resolvedJins.filter((j): j is string => Boolean(j)))];

  let weightPart: string;
  if (uniqueJins.length <= 1) {
    const weight = formatWeightMaundKg(totalWeightKg);
    weightPart = uniqueJins[0] ? `${uniqueJins[0]} ${weight}` : weight;
  } else {
    weightPart = lines.map((line) => formatLineWeightWithJins(line, invoiceJins)).join(' + ');
  }

  let weightedRateSum = 0;
  for (const line of lines) {
    weightedRateSum += Number(line.totalWeightKg) * Number(line.ratePerMaund);
  }
  const blendedRate = weightedRateSum / totalWeightKg;
  const core = `${weightPart} @ Rs ${formatRate(blendedRate)}/maund`;
  return core + invoiceVoucherHeaderSuffix(header);
}

export function isBardanaLedgerNote(notes?: string | null): boolean {
  const n = notes?.trim().toLowerCase() ?? '';
  if (!n) return false;
  return n === 'bardana' || n.startsWith('bardana against') || n.startsWith('bardana ');
}
