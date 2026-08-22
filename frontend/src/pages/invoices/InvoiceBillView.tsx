import { BILL_TITLES } from '../../config/billPrint';
import { BusinessLetterhead } from '../../components/reports/BusinessLetterhead';
import type { InvoiceDetail, SystemPreferences } from '../../lib/api';
import {
  computeKachiDeductions,
  computeMaalBillFromTotals,
  formatBillAmount,
  formatBillDate,
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
  taxPercent: 0,
  markeetFeeRate: 0,
  kantaRate: 0,
  closingDate: null,
  updatedAt: '',
};

function BillHeader({ title }: { title: string }) {
  return (
    <header className="text-center text-black">
      <BusinessLetterhead />
      <h2 className="invoice-bill__title">{title}</h2>
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
    <div className="invoice-bill__meta">
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
}: {
  billToLabel: string;
  partyCode?: string;
  partyName: string;
  address?: string | null;
  phone?: string | null;
  product: string;
}) {
  const codePrefix = partyCode ? `[${partyCode}] ` : '';

  return (
    <div className="invoice-bill__party-row">
      <div className="min-w-0 flex-1">
        <span className="invoice-bill__party-label">{billToLabel}</span>
        <div className="invoice-bill__party-name">
          {codePrefix}
          {partyName}
        </div>
        {address ? <div className="mt-0.5 whitespace-pre-wrap text-[11px]">{address}</div> : null}
        {phone ? <div className="mt-0.5 text-[11px]">{phone}</div> : null}
      </div>
      <div className="invoice-bill__product shrink-0">
        <span className="invoice-bill__product-label">Product:</span>&nbsp;{product || '—'}
      </div>
    </div>
  );
}

function LineTable({ rows }: { rows: BillLineRow[] }) {
  return (
    <table className="invoice-bill__table">
      <thead>
        <tr>
          <th>Variety</th>
          <th className="invoice-bill__num">Bags</th>
          <th className="invoice-bill__num">CompWeight</th>
          <th className="invoice-bill__num">Kaat</th>
          <th className="invoice-bill__num">Net Weight</th>
          <th className="invoice-bill__num">Rate</th>
          <th className="invoice-bill__num">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td className="invoice-bill__product-cell">{row.variety || '\u00A0'}</td>
            <td className="invoice-bill__num">{row.bags || '0'}</td>
            <td className="invoice-bill__num">{formatBillAmount(row.compWeight)}</td>
            <td className="invoice-bill__num">{formatBillAmount(row.kaat)}</td>
            <td className="invoice-bill__num">{formatBillAmount(row.netWeight)}</td>
            <td className="invoice-bill__num">{formatBillAmount(row.rate)}</td>
            <td className="invoice-bill__num">{formatBillAmount(row.amount)}</td>
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
  lines: Array<{ label: string; value: string; bold?: boolean }>;
  netAmount: string;
}) {
  return (
    <div className="invoice-bill__totals">
      <div className="invoice-bill__totals-inner">
        {lines.map((line) => (
          <div
            key={line.label}
            className={`invoice-bill__totals-line${line.bold ? ' invoice-bill__totals-line--bold' : ''}`}
          >
            <span>{line.label}</span>
            <span>{line.value}</span>
          </div>
        ))}
        <div className="invoice-bill__net">
          <span>Net Amount:</span>
          <span className="invoice-bill__net-value">{netAmount}</span>
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
    <section className="invoice-bill__from">
      <p className="invoice-bill__from-title">
        Bill From:&nbsp;{supplierName}
      </p>
      <LineTable rows={rows} />
      <div className="invoice-bill__totals">
        <div className="invoice-bill__totals-inner">
          {totals.map((line) => (
            <div key={line.label} className="invoice-bill__totals-line">
              <span>{line.label}</span>
              <span>{line.value}</span>
            </div>
          ))}
          <div className="invoice-bill__net">
            <span>Net Amount</span>
            <span className="invoice-bill__net-value">{netAmount}</span>
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

  let deduction = 0;
  const deductionLabel = 'Deduction Of Bilty';
  deduction = computeKachiDeductions(lines, prefs).deduction;

  const debit = invoice.debitAccount;

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
    <div className="invoice-bill__signature">
      <div>
        <div>Signature</div>
        <div className="invoice-bill__signature-line" />
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
  return (
    <header className="text-black">
      <BusinessLetterhead />

      <div className="text-center">
        <h2 className="invoice-bill__title invoice-bill__title--sp">{title}</h2>
        <div className="invoice-bill__title-underline" />
      </div>

      <div className="invoice-bill__meta-grid">
        <div>
          <span className="invoice-bill__meta-label">Invoice #</span>
          <div className="mt-0.5 tabular-nums">{invoice.reference}</div>
        </div>
        <div className="text-center">
          <span className="invoice-bill__meta-label">Date</span>
          <div className="mt-0.5">{formatBillDate(invoiceBillDate(invoice))}</div>
        </div>
        <div className="text-right">
          <span className="invoice-bill__meta-label">Bill No</span>
          <div className="mt-0.5">{invoice.billNo?.trim() || '—'}</div>
        </div>
      </div>

      <div className="invoice-bill__party">
        <span className="invoice-bill__party-label">{partyLabel}</span>
        <div className="invoice-bill__party-name">
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
    <table className="invoice-bill__table">
      <thead>
        <tr>
          <th>Product</th>
          <th className="invoice-bill__num">Qty</th>
          <th className="invoice-bill__num">Rate</th>
          <th className="invoice-bill__num">Amount</th>
        </tr>
      </thead>
      <tbody>
        {display.map((row, i) => (
          <tr key={i}>
            <td className="invoice-bill__product-cell">{row.product}</td>
            <td className="invoice-bill__num">{empty ? '\u00A0' : row.quantity}</td>
            <td className="invoice-bill__num">
              {empty ? '\u00A0' : formatBillAmount(row.rate)}
            </td>
            <td className="invoice-bill__num">
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
    <div className="invoice-bill bg-white px-6 py-8">
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
