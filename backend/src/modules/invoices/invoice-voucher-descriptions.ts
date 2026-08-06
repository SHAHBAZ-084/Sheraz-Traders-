export type InvoiceVoucherHeader = {
  tafseel?: string | null;
  gariNo?: string | null;
};

export type InvoiceVoucherLine = {
  totalWeightKg: number;
  ratePerMaund: number;
};

export function voucherReferenceFromBillNo(billNo?: string | null): string {
  return billNo?.trim() ?? '';
}

function formatWeightKg(kg: number) {
  const n = Number(kg);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n)
    ? String(n)
    : n.toLocaleString('en-PK', { maximumFractionDigits: 2 });
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

export function rowLegDescription(line: InvoiceVoucherLine, header: InvoiceVoucherHeader): string {
  const core = `${formatWeightKg(line.totalWeightKg)} kg @ Rs ${formatRate(line.ratePerMaund)}/maund`;
  return core + invoiceVoucherHeaderSuffix(header);
}

export function blendedLegDescription(
  lines: InvoiceVoucherLine[],
  header: InvoiceVoucherHeader,
  product?: string | null,
): string {
  const totalWeightKg = lines.reduce((sum, line) => sum + Number(line.totalWeightKg), 0);
  if (totalWeightKg <= 0) {
    const suffix = invoiceVoucherHeaderSuffix(header);
    return suffix ? suffix.replace(/^ — /, '') : '—';
  }

  let weightedRateSum = 0;
  for (const line of lines) {
    weightedRateSum += Number(line.totalWeightKg) * Number(line.ratePerMaund);
  }
  const blendedRate = weightedRateSum / totalWeightKg;
  const core = `${formatWeightKg(totalWeightKg)} kg @ Rs ${formatRate(blendedRate)}/maund`;
  const withProduct = product?.trim() ? `${product.trim()} ${core}` : core;
  return withProduct + invoiceVoucherHeaderSuffix(header);
}

export function isBardanaLedgerNote(notes?: string | null): boolean {
  const n = notes?.trim().toLowerCase() ?? '';
  if (!n) return false;
  return n === 'bardana' || n.startsWith('bardana against') || n.startsWith('bardana ');
}
