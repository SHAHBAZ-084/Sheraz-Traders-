import { FormEvent, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { INVOICE_TYPE_LABELS } from '../../config/navigation';
import { api, type InvoiceDetail, type SystemPreferences } from '../../lib/api';
import { buildInvoiceReference, type InvoiceTypeKey } from '../../lib/invoiceReference';
import { FieldLabel, FinancialButton, PageShell, Panel, SecondaryButton, TextInput } from '../../components/ui/PageShell';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { InvoiceBillView } from './InvoiceBillView';

const INVOICE_TYPE_OPTIONS = (Object.keys(INVOICE_TYPE_LABELS) as InvoiceTypeKey[]).map((key) => ({
  value: key,
  label: INVOICE_TYPE_LABELS[key]!,
}));

export function ViewInvoicePage() {
  const printRef = useRef<HTMLDivElement>(null);
  const [invoiceType, setInvoiceType] = useState<InvoiceTypeKey>('KACHI_MAAL');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [prefs, setPrefs] = useState<SystemPreferences | null>(null);
  const [notFoundRef, setNotFoundRef] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function onFetch(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNotFoundRef(null);
    setInvoice(null);
    setPrefs(null);

    const num = parseInt(invoiceNumber.trim(), 10);
    if (!Number.isFinite(num) || num < 1) {
      setError('Enter a valid invoice number (1 or greater).');
      return;
    }

    const reference = buildInvoiceReference(invoiceType, num);
    setLoading(true);
    try {
      const [row, systemPrefs] = await Promise.all([
        api.getInvoiceByReference(reference),
        api.getSystemPreferences(),
      ]);
      setInvoice(row);
      setPrefs(systemPrefs);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lookup failed';
      if (message.toLowerCase().includes('no invoice found')) {
        setNotFoundRef(reference);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function onDownloadPdf() {
    if (!printRef.current || !invoice) return;
    setDownloading(true);
    try {
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const imgHeight = (canvas.height * pageWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, imgHeight);
      pdf.save(`${invoice.reference}.pdf`);
    } catch {
      setError('PDF export failed. Try again.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <PageShell title="View Invoice" subtitle="Look up a posted bill by type and number">
      <Panel className="mb-6">
        <form onSubmit={onFetch} className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px] flex-1">
            <FieldLabel>Invoice type</FieldLabel>
            <SearchSelect
              value={invoiceType}
              onChange={(v) => setInvoiceType(v as InvoiceTypeKey)}
              options={INVOICE_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              placeholder="Select type…"
            />
          </div>
          <div className="w-full min-w-[120px] max-w-[160px]">
            <FieldLabel>Invoice number</FieldLabel>
            <TextInput
              type="number"
              min={1}
              step={1}
              required
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="e.g. 3"
            />
          </div>
          <FinancialButton type="submit" disabled={loading} className="px-6">
            {loading ? 'Fetching…' : 'Fetch'}
          </FinancialButton>
        </form>
        {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
        {notFoundRef ? (
          <p className="mt-4 text-sm text-textSecondary">
            No invoice found for <strong className="text-textPrimary">{notFoundRef}</strong>.
          </p>
        ) : null}
      </Panel>

      {invoice ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            <SecondaryButton type="button" disabled={downloading} onClick={onDownloadPdf}>
              {downloading ? 'Generating PDF…' : 'Download PDF'}
            </SecondaryButton>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface2 p-4">
            <div ref={printRef} className="mx-auto w-[800px] max-w-full shadow-sm">
              <InvoiceBillView invoice={invoice} prefs={prefs} />
            </div>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
