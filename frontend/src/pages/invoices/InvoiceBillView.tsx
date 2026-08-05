import { BILL_LETTERHEAD, BILL_TITLES } from '../../config/billPrint';
import type { InvoiceDetail, SystemPreferences } from '../../lib/api';
import {
  computeKachiDeductions,
  computeMaalBillFromTotals,
  formatBillAmount,
  formatBillDate,
  formatBoriThelaLine,
  invoiceBillDate,
  maalLineToBillRow,
  parseInvoiceDisplayNumber,
  resolveMaalBillFromPartyName,
  sumLineAmounts,
  type BillLineRow,
} from '../../lib/billPrintFormat';

const DEFAULT_PREFS: SystemPreferences = {
  daamiPercent: 0,
  paleDariPercent: 0,
  brokeryPercent: 0,
  marketFeeRate: 0,
  marketFeeEnabled: true,
  bardanaRate: 0,
  taxPercent: 0,
  markeetFeeRate: 0,
  kantaRate: 0,
  closingDate: null,
  updatedAt: '',
};

const billFont =
  'font-[Arial,Helvetica,sans-serif] text-[13px] leading-snug text-black lining-nums';

function BillHeader({ title }: { title: string }) {
  const h = BILL_LETTERHEAD;
  return (
    <header className="text-center">
      <h1 className="text-[22px] font-normal underline decoration-1 underline-offset-[3px]">
        {h.companyName}
      </h1>
      <p className="mt-0.5 text-[13px]">{h.subtitle}</p>
      <p className="mt-1 text-[11px]">
        Phone: {h.phone}&nbsp;&nbsp;Mobile: {h.mobile}&nbsp;&nbsp;Email: {h.email}
      </p>
      <p className="mt-0.5 text-[11px]">Proprietor: {h.proprietor}</p>
      <div className="my-3 border-b border-dashed border-black" />
      <h2 className="text-[15px] font-bold tracking-wide">{title}</h2>
    </header>
  );
}

function MetaRow({
  invoiceNo,
  date,
  billNo,
  gariNo,
}: {
  invoiceNo: string;
  date: string;
  billNo: string;
  gariNo: string;
}) {
  return (
    <div className="mt-4 flex justify-between gap-2 border-b border-black pb-2 text-[12px]">
      <span>
        <span className="underline decoration-1 underline-offset-2">Invoice#</span>
        &nbsp;{invoiceNo}
      </span>
      <span>
        <strong>Date:</strong>&nbsp;{date}
      </span>
      <span>
        <strong>Bill#</strong>&nbsp;{billNo || '—'}
      </span>
      <span>
        <strong>Gari#</strong>&nbsp;{gariNo || '\u00A0'}
      </span>
    </div>
  );
}

function PartyBlock({
  billToLabel,
  partyCode,
  partyName,
  address,
  phone,
  product,
  productInsideBox = false,
}: {
  billToLabel: string;
  partyCode?: string;
  partyName: string;
  address?: string | null;
  phone?: string | null;
  product: string;
  /** When true, Product sits inside the Bill To box (Sale Commission style). */
  productInsideBox?: boolean;
}) {
  const codePrefix = partyCode ? `[${partyCode}] ` : '';
  const partyContent = (
    <>
      <div>
        {codePrefix}
        {partyName}
      </div>
      {address ? <div className="mt-0.5 whitespace-pre-wrap">{address}</div> : null}
      {phone ? <div className="mt-0.5">{phone}</div> : null}
    </>
  );

  if (productInsideBox) {
    return (
      <div className="mt-3 border border-black px-3 py-2 text-[12px]">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <span className="font-semibold">{billToLabel}</span>
            <div className="mt-1">{partyContent}</div>
          </div>
          <div className="shrink-0">
            <strong>Product:</strong>&nbsp;{product || '—'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 flex items-start justify-between gap-6 text-[12px]">
      <div className="min-w-0 flex-1">
        <span className="font-semibold">{billToLabel}</span>
        <div className="mt-1">{partyContent}</div>
      </div>
      <div className="shrink-0 pt-1">
        <strong>Product:</strong>&nbsp;{product || '—'}
      </div>
    </div>
  );
}

function LineTable({ rows }: { rows: BillLineRow[] }) {
  return (
    <table className="mt-3 w-full border-collapse text-[12px]">
      <thead>
        <tr className="border-b border-black">
          <th className="py-1.5 pr-2 text-left font-semibold">Variety</th>
          <th className="px-1 py-1.5 text-right font-semibold">Bori</th>
          <th className="px-1 py-1.5 text-right font-semibold">Thela</th>
          <th className="px-1 py-1.5 text-right font-semibold">CompWeight</th>
          <th className="px-1 py-1.5 text-right font-semibold">Kaat</th>
          <th className="px-1 py-1.5 text-right font-semibold">Net Weight</th>
          <th className="px-1 py-1.5 text-right font-semibold">Rate</th>
          <th className="py-1.5 pl-1 text-right font-semibold">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td className="py-1.5 pr-2">{row.variety || '\u00A0'}</td>
            <td className="px-1 py-1.5 text-right tabular-nums">{row.bori || '0'}</td>
            <td className="px-1 py-1.5 text-right tabular-nums">{row.thela || '0'}</td>
            <td className="px-1 py-1.5 text-right tabular-nums">{formatBillAmount(row.compWeight)}</td>
            <td className="px-1 py-1.5 text-right tabular-nums">{formatBillAmount(row.kaat)}</td>
            <td className="px-1 py-1.5 text-right tabular-nums">{formatBillAmount(row.netWeight)}</td>
            <td className="px-1 py-1.5 text-right tabular-nums">{formatBillAmount(row.rate)}</td>
            <td className="py-1.5 pl-1 text-right tabular-nums">{formatBillAmount(row.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TotalsStack({
  lines,
  netAmount,
}: {
  lines: Array<{ label: string; value: string; bold?: boolean; boxed?: boolean }>;
  netAmount: string;
}) {
  return (
    <div className="mt-4 flex justify-end">
      <div className="min-w-[280px] space-y-1 text-[12px]">
        {lines.map((line) => (
          <div key={line.label} className="flex justify-between gap-8">
            <span>{line.label}</span>
            <span className={`tabular-nums ${line.bold ? 'font-bold' : ''}`}>{line.value}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 pt-2">
          <span className="font-bold">Net Amount:</span>
          <span className="border-2 border-black px-3 py-0.5 text-[13px] font-bold tabular-nums">
            {netAmount}
          </span>
        </div>
      </div>
    </div>
  );
}

function BillFromSection({
  supplierName,
  rows,
  totals,
  netAmount,
}: {
  supplierName: string;
  rows: BillLineRow[];
  totals: Array<{ label: string; value: string }>;
  netAmount: string;
}) {
  return (
    <section className="mt-8">
      <p className="text-[12px] font-semibold">
        Bill From:&nbsp;{supplierName}
      </p>
      <LineTable rows={rows} />
      <div className="mt-4 flex justify-end">
        <div className="min-w-[280px] space-y-1 text-[12px]">
          {totals.map((line) => (
            <div key={line.label} className="flex justify-between gap-8">
              <span>{line.label}</span>
              <span className="tabular-nums">{line.value}</span>
            </div>
          ))}
          <div className="flex justify-between gap-8 pt-1 font-bold underline decoration-1 underline-offset-2">
            <span>Net Amount</span>
            <span className="tabular-nums">{netAmount}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function MaalBillBody({
  invoice,
  prefs,
  title,
}: {
  invoice: InvoiceDetail;
  prefs: SystemPreferences;
  title: string;
}) {
  const lines = invoice.kachiMaalLines ?? [];

  const tableRows = lines.map((l) => maalLineToBillRow(l, 0));
  const goodsTotal = sumLineAmounts(tableRows);
  const misc = Number(invoice.miscAmount ?? 0);

  const lowerQty = Number(invoice.lowerBardanaQty ?? 0);
  const lowerRate = Number(invoice.lowerBardanaRate ?? 0);
  const lowerAmount = Number(invoice.lowerBardanaAmount ?? 0);
  const lowerMode = invoice.lowerBardanaMode;
  const lowerBori = lowerMode === 'BORI' ? lowerQty : 0;
  const lowerThela = lowerMode === 'THELA' ? lowerQty : 0;

  let deduction = 0;
  const deductionLabel = 'Deduction Of Bilty';
  deduction = computeKachiDeductions(lines, prefs).deduction;

  const debit = invoice.debitAccount;
  const extraLine =
    lowerQty > 0 && lowerRate > 0
      ? formatBoriThelaLine(lowerBori, lowerRate, lowerThela, lowerRate)
      : formatBoriThelaLine(0, 0, 0, 0);

  const billFromParty = resolveMaalBillFromPartyName(invoice, lines);
  const billFrom =
    billFromParty != null
      ? computeMaalBillFromTotals(lines, tableRows, prefs, invoice.type)
      : null;

  return (
    <>
      <BillHeader title={title} />
      <MetaRow
        invoiceNo={parseInvoiceDisplayNumber(invoice.reference)}
        date={formatBillDate(invoiceBillDate(invoice))}
        billNo={invoice.billNo ?? ''}
        gariNo={invoice.gariNo ?? ''}
      />
      <PartyBlock
        billToLabel="Bill To:"
        partyCode={debit?.code}
        partyName={debit?.name ?? '—'}
        product={invoice.jins ?? ''}
      />
      <LineTable rows={tableRows} />
      <TotalsStack
        lines={[
          { label: 'Misc. Expanse:', value: formatBillAmount(misc) },
          { label: 'Total Amount:', value: formatBillAmount(goodsTotal), bold: true },
          { label: extraLine, value: formatBillAmount(lowerAmount) },
          { label: deductionLabel, value: formatBillAmount(deduction) },
        ]}
        netAmount={formatBillAmount(invoice.total)}
      />
      {billFromParty && billFrom ? (
        <BillFromSection
          supplierName={billFromParty}
          rows={tableRows}
          totals={billFrom.totals}
          netAmount={formatBillAmount(billFrom.purchaseNet)}
        />
      ) : null}
    </>
  );
}


function BillSignature() {
  return (
    <div className="mt-16 flex justify-end text-[12px]">
      <div className="w-[160px]">
        <div>Signature</div>
        <div className="mt-1 border-b border-black" />
      </div>
    </div>
  );
}

/** Print-safe header for Sale Invoice / Purchase Invoice bills. */
function InvoiceBillHeader({
  title,
  invoice,
  partyLabel,
  partyName,
  partyCode,
}: {
  title: string;
  invoice: InvoiceDetail;
  partyLabel: string;
  partyName: string;
  partyCode?: string;
}) {
  const h = BILL_LETTERHEAD;
  return (
    <header className="text-black">
      <div className="flex items-center gap-4 border-b-2 border-[var(--fill-primary,#1B4332)] pb-3">
        <img
          src="/sheraz-traders-logo.png"
          alt=""
          className="h-14 w-14 shrink-0 object-contain"
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-bold leading-tight tracking-wide text-[var(--fill-primary,#1B4332)]">
            {h.companyName}
          </h1>
          <p className="mt-0.5 text-[12px] text-black/80">{h.subtitle}</p>
          <p className="mt-0.5 text-[10px] text-black/70">
            Phone: {h.phone}&nbsp;&nbsp;Mobile: {h.mobile}&nbsp;&nbsp;Email: {h.email}
          </p>
        </div>
      </div>

      <div className="mt-4 text-center">
        <h2 className="inline-block text-[18px] font-bold tracking-[0.08em] text-black">
          {title}
        </h2>
        <div className="mx-auto mt-1 h-[3px] w-40 bg-[var(--fill-financial,#C08A2E)]" />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 border border-black px-3 py-2 text-[12px]">
        <div>
          <span className="font-semibold">Invoice #</span>
          <div className="mt-0.5 tabular-nums">{invoice.reference}</div>
        </div>
        <div className="text-center">
          <span className="font-semibold">Date</span>
          <div className="mt-0.5">{formatBillDate(invoiceBillDate(invoice))}</div>
        </div>
        <div className="text-right">
          <span className="font-semibold">Bill No</span>
          <div className="mt-0.5">{invoice.billNo?.trim() || '—'}</div>
        </div>
      </div>

      <div className="mt-3 border border-black px-3 py-2 text-[12px]">
        <span className="font-semibold text-[var(--fill-primary,#1B4332)]">{partyLabel}</span>
        <div className="mt-1 font-medium">
          {partyCode ? `[${partyCode}] ` : ''}
          {partyName || '—'}
        </div>
      </div>
    </header>
  );
}

function SimpleInvoiceLineTable({
  rows,
}: {
  rows: Array<{ product: string; quantity: number; rate: number; lineTotal: number }>;
}) {
  const safeRows = rows ?? [];
  const empty = safeRows.length === 0;
  const display = empty
    ? [{ product: '\u00A0', quantity: 0, rate: 0, lineTotal: 0 }]
    : safeRows;

  return (
    <table className="mt-4 w-full border-collapse text-[12px]">
      <thead>
        <tr className="border-b border-black">
          <th className="py-1.5 pr-2 text-left font-semibold">Product</th>
          <th className="px-1 py-1.5 text-right font-semibold">Qty</th>
          <th className="px-1 py-1.5 text-right font-semibold">Rate</th>
          <th className="py-1.5 pl-1 text-right font-semibold">Amount</th>
        </tr>
      </thead>
      <tbody>
        {display.map((row, i) => (
          <tr key={i} className="border-b border-black/20">
            <td className="py-1.5 pr-2">{row.product}</td>
            <td className="px-1 py-1.5 text-right tabular-nums">{empty ? '\u00A0' : row.quantity}</td>
            <td className="px-1 py-1.5 text-right tabular-nums">
              {empty ? '\u00A0' : formatBillAmount(row.rate)}
            </td>
            <td className="py-1.5 pl-1 text-right tabular-nums">
              {empty ? '\u00A0' : formatBillAmount(row.lineTotal)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function salePurchaseInvoiceRows(invoice: InvoiceDetail) {
  return (invoice.items ?? []).map((item) => ({
    product: item.product?.name?.trim() || item.label?.trim() || '—',
    quantity: Number(item.quantity),
    rate: Number(item.unitPrice),
    lineTotal: Number(item.total),
  }));
}

function SaleInvoiceBillBody({
  invoice,
  title,
}: {
  invoice: InvoiceDetail;
  prefs: SystemPreferences;
  title: string;
}) {
  const rows = salePurchaseInvoiceRows(invoice);
  const party = invoice.debitAccount;
  const goodsTotal = rows.reduce((sum, row) => sum + row.lineTotal, 0);

  return (
    <>
      <InvoiceBillHeader
        title={title}
        invoice={invoice}
        partyLabel="Customer"
        partyName={party?.name ?? '—'}
        partyCode={party?.code}
      />
      <SimpleInvoiceLineTable rows={rows} />
      <TotalsStack
        lines={[{ label: 'Total Amount:', value: formatBillAmount(goodsTotal), bold: true }]}
        netAmount={formatBillAmount(invoice.total)}
      />
      <BillSignature />
    </>
  );
}

function PurchaseInvoiceBillBody({
  invoice,
  title,
}: {
  invoice: InvoiceDetail;
  prefs: SystemPreferences;
  title: string;
}) {
  const rows = salePurchaseInvoiceRows(invoice);
  const party = invoice.debitAccount;
  const goodsTotal = rows.reduce((sum, row) => sum + row.lineTotal, 0);

  return (
    <>
      <InvoiceBillHeader
        title={title}
        invoice={invoice}
        partyLabel="Supplier"
        partyName={party?.name ?? '—'}
        partyCode={party?.code}
      />
      <SimpleInvoiceLineTable rows={rows} />
      <TotalsStack
        lines={[{ label: 'Total Amount:', value: formatBillAmount(goodsTotal), bold: true }]}
        netAmount={formatBillAmount(invoice.total)}
      />
      <BillSignature />
    </>
  );
}


export function InvoiceBillView({
  invoice,
  prefs,
}: {
  invoice: InvoiceDetail;
  prefs?: SystemPreferences | null;
}) {
  const p = prefs ?? DEFAULT_PREFS;
  const title = BILL_TITLES[invoice.type] ?? 'Bill';

  return (
    <div className={`${billFont} bg-white px-6 py-8`}>
      {invoice.type === 'KACHI_MAAL' ? (
        <MaalBillBody invoice={invoice} prefs={p} title={title} />
      ) : null}
      {invoice.type === 'SALE_INVOICE' ? (
        <SaleInvoiceBillBody invoice={invoice} prefs={p} title={title} />
      ) : null}
      {invoice.type === 'PURCHASE_INVOICE' ? (
        <PurchaseInvoiceBillBody invoice={invoice} prefs={p} title={title} />
      ) : null}
    </div>
  );
}
