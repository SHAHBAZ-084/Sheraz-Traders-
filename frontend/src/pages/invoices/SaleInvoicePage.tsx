import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  InvoiceAddRowAction,
  InvoiceField,
  InvoiceFieldGroup,
  InvoiceFormFooter,
  InvoiceFormSection,
  InvoiceHeaderRow,
} from '../../components/invoices/InvoiceFormLayout';
import { FieldLabel, PageShell, Panel, PrimaryButton, SecondaryButton, TextInput } from '../../components/ui/PageShell';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { api, type Account, type AccountCategory, type Product } from '../../lib/api';
import { formatLedgerAmount } from '../../lib/format';
import { InvoicePreviewGridShell } from './InvoicePreviewGrid';

const SALE_PARTY_CATEGORIES = ['Sale Party'] as const;

type GridRow = {
  clientId: string;
  productId: number;
  productName: string;
  quantity: number;
  rate: number;
  lineTotal: number;
};

function todayInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function flatAccountOptions(categories: AccountCategory[], accounts: Account[], categoryNames: readonly string[]) {
  const allowed = new Set(categories.filter((c) => categoryNames.includes(c.name)).map((c) => c.id));
  return accounts
    .filter((a) => allowed.has(a.categoryId))
    .map((a) => ({ value: String(a.id), label: a.name }));
}

function LinesTable({
  rows,
  onRemove,
}: {
  rows: GridRow[];
  onRemove?: (clientId: string) => void;
}) {
  return (
    <InvoicePreviewGridShell isEmpty={rows.length === 0}>
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-surface2">
          <tr className="border-b border-border text-xs uppercase tracking-wide text-textMuted">
            <th className="px-3 py-2.5">Product</th>
            <th className="px-3 py-2.5 text-right">Qty</th>
            <th className="px-3 py-2.5 text-right">Rate</th>
            <th className="px-3 py-2.5 text-right">Total</th>
            {onRemove ? <th className="px-3 py-2.5" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.clientId} className="border-b border-border/50">
              <td className="px-3 py-2">{row.productName}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.quantity}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatLedgerAmount(row.rate)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatLedgerAmount(row.lineTotal)}</td>
              {onRemove ? (
                <td className="px-3 py-2 text-right">
                  <button type="button" className="text-xs text-danger" onClick={() => onRemove(row.clientId)}>
                    Remove
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </InvoicePreviewGridShell>
  );
}

export function SaleInvoicePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [predictedRef, setPredictedRef] = useState('SI-…');
  const [invoiceDate, setInvoiceDate] = useState(todayInputValue());
  const [billNo, setBillNo] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [gridRows, setGridRows] = useState<GridRow[]>([]);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [rate, setRate] = useState('');
  const [customerAccountId, setCustomerAccountId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.listProducts(),
      api.listAccounts(),
      api.listCategories(),
      api.getNextSaleInvoiceReference(),
    ])
      .then(([prods, accts, cats, ref]) => {
        setProducts(prods);
        setAccounts(accts);
        setCategories(cats);
        setPredictedRef(ref.reference);
      })
      .catch(() => setError('Failed to load form data'));
  }, []);

  const productOptions = useMemo(
    () => products.map((p) => ({ value: String(p.id), label: p.name })),
    [products],
  );
  const customerOptions = useMemo(
    () => flatAccountOptions(categories, accounts, SALE_PARTY_CATEGORIES),
    [categories, accounts],
  );
  const invoiceTotal = useMemo(
    () => gridRows.reduce((sum, row) => sum + row.lineTotal, 0),
    [gridRows],
  );

  function addRow() {
    setError('');
    const product = products.find((p) => String(p.id) === productId);
    const qty = Number(quantity);
    const unitRate = Number(rate);
    if (!product) {
      setError('Select a product');
      return;
    }
    if (!(qty > 0) || !(unitRate >= 0) || !Number.isFinite(unitRate)) {
      setError('Enter a valid quantity and rate');
      return;
    }
    setGridRows((rows) => [
      ...rows,
      {
        clientId: `${Date.now()}-${rows.length}`,
        productId: product.id,
        productName: product.name,
        quantity: qty,
        rate: unitRate,
        lineTotal: Math.round(qty * unitRate * 100) / 100,
      },
    ]);
    setProductId('');
    setQuantity('1');
    setRate('');
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!customerAccountId) {
      setError('Select a customer');
      return;
    }
    setSaving(true);
    try {
      await api.createSaleInvoice({
        invoiceDate,
        billNo: billNo || undefined,
        customerAccountId: Number(customerAccountId),
        lines: gridRows.map((row) => ({
          productId: row.productId,
          quantity: row.quantity,
          rate: row.rate,
        })),
      });
      navigate('/invoices/view-invoice');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save sale invoice');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell centerTitle invoiceTitleBand title="Sale Invoice">
      <Panel>
        <p className="mb-3 text-xs text-textMuted">
          Step {step} of 3 — {step === 1 ? 'Add products' : step === 2 ? 'Review' : 'Select customer & submit'}
        </p>

        {step === 1 ? (
          <>
            <InvoiceFormSection label="Header">
              <InvoiceHeaderRow>
                <InvoiceField>
                  <FieldLabel>Date</FieldLabel>
                  <TextInput type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Invoice #</FieldLabel>
                  <TextInput value={predictedRef} readOnly />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Bill No</FieldLabel>
                  <TextInput value={billNo} onChange={(e) => setBillNo(e.target.value)} />
                </InvoiceField>
              </InvoiceHeaderRow>
            </InvoiceFormSection>

            <InvoiceFormSection label="Add product line">
              <InvoiceFieldGroup>
                <InvoiceField wide>
                  <FieldLabel>Product</FieldLabel>
                  <SearchSelect
                    options={productOptions}
                    value={productId}
                    onChange={setProductId}
                    placeholder="Select product"
                  />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Qty</FieldLabel>
                  <TextInput value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Rate</FieldLabel>
                  <TextInput value={rate} onChange={(e) => setRate(e.target.value)} />
                </InvoiceField>
              </InvoiceFieldGroup>
              <InvoiceAddRowAction onClick={addRow} />
            </InvoiceFormSection>

            <LinesTable
              rows={gridRows}
              onRemove={(clientId) => setGridRows((rows) => rows.filter((r) => r.clientId !== clientId))}
            />

            {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <SecondaryButton type="button" onClick={() => navigate(-1)}>Close</SecondaryButton>
              <PrimaryButton
                type="button"
                onClick={() => {
                  setError('');
                  if (gridRows.length === 0) {
                    setError('Add at least one product line');
                    return;
                  }
                  setStep(2);
                }}
              >
                Next
              </PrimaryButton>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <InvoiceFormSection label="Review">
              <LinesTable rows={gridRows} />
              <p className="mt-3 text-sm font-semibold">Invoice total: {formatLedgerAmount(invoiceTotal)}</p>
            </InvoiceFormSection>
            <div className="mt-4 flex justify-end gap-2">
              <SecondaryButton type="button" onClick={() => setStep(1)}>Back</SecondaryButton>
              <PrimaryButton type="button" onClick={() => setStep(3)}>Next</PrimaryButton>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <form onSubmit={onSubmit}>
            <InvoiceFormSection label="Customer">
              <InvoiceField wide>
                <FieldLabel>Sale Party (customer)</FieldLabel>
                <SearchSelect
                  options={customerOptions}
                  value={customerAccountId}
                  onChange={setCustomerAccountId}
                  placeholder="Select customer"
                />
              </InvoiceField>
            </InvoiceFormSection>
            <InvoiceFormFooter
              totalLabel="Sale total"
              totalValue={invoiceTotal}
              error={error}
              saving={saving}
              onClose={() => navigate(-1)}
              primaryLabel={saving ? 'Saving…' : 'Save Sale Invoice'}
            />
            <div className="mt-2">
              <SecondaryButton type="button" onClick={() => setStep(2)}>Back</SecondaryButton>
            </div>
          </form>
        ) : null}
      </Panel>
    </PageShell>
  );
}
