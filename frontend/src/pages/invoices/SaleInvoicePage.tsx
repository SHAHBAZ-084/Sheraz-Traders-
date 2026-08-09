import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  InvoiceAddRowAction,
  InvoiceField,
  InvoiceFieldGroup,
  InvoiceFieldRow,
  InvoiceFormFooter,
  InvoiceFormSection,
  InvoiceHeaderRow,
} from '../../components/invoices/InvoiceFormLayout';
import { FieldLabel, PageShell, Panel, TextInput } from '../../components/ui/PageShell';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useMinimizableForm } from '../../hooks/useMinimizableForm';
import {
  api,
  type Account,
  type AccountCategory,
  type Product,
  type ProductCategory,
  type Store,
} from '../../lib/api';
import { formatLedgerAmount } from '../../lib/format';
import { flatPartyAccountOptions } from '../../lib/partyAccounts';
import { InvoicePreviewGridShell } from './InvoicePreviewGrid';

import { QuickAddPartyModal } from '../../components/invoices/QuickAddPartyModal';
import { ProductInsightPopover } from '../../components/invoices/ProductInsightPopover';

type GridRow = {
  clientId: string;
  productId: number;
  productName: string;
  quantity: number;
  rate: number;
  lineTotal: number;
};

type SaleInvoiceDraft = {
  predictedRef: string;
  invoiceDate: string;
  billNo: string;
  storeId: string;
  productCategoryId: string;
  gridRows: GridRow[];
  productId: string;
  quantity: string;
  rate: string;
  customerAccountId: string;
};

function todayInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
      <table className="w-full min-w-[420px] text-left text-sm">
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
  const { restoredState, minimize } = useMinimizableForm<SaleInvoiceDraft>('sale-invoice');
  const keepRestoredPredictedRef = useRef(Boolean(restoredState?.predictedRef));
  const trapRef = useRef<HTMLFormElement>(null);
  useFocusTrap(trapRef);

  const [predictedRef, setPredictedRef] = useState(() => restoredState?.predictedRef ?? 'SI-…');
  const [invoiceDate, setInvoiceDate] = useState(() => restoredState?.invoiceDate ?? todayInputValue());
  const [billNo, setBillNo] = useState(() => restoredState?.billNo ?? '');
  const [storeId, setStoreId] = useState(() => restoredState?.storeId ?? '');
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
  const [productCategoryId, setProductCategoryId] = useState(() => restoredState?.productCategoryId ?? '');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [gridRows, setGridRows] = useState<GridRow[]>(() => restoredState?.gridRows ?? []);
  const [productId, setProductId] = useState(() => restoredState?.productId ?? '');
  const [quantity, setQuantity] = useState(() => restoredState?.quantity ?? '1');
  const [rate, setRate] = useState(() => restoredState?.rate ?? '');
  const [customerAccountId, setCustomerAccountId] = useState(() => restoredState?.customerAccountId ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [addingRow, setAddingRow] = useState(false);
  const [showQuickAddParty, setShowQuickAddParty] = useState(false);

  useEffect(() => {
    if (restoredState) {
      if (restoredState.predictedRef) setPredictedRef(restoredState.predictedRef);
      if (restoredState.invoiceDate) setInvoiceDate(restoredState.invoiceDate);
      if (restoredState.billNo !== undefined) setBillNo(restoredState.billNo);
      if (restoredState.storeId) setStoreId(restoredState.storeId);
      if (restoredState.productCategoryId) setProductCategoryId(restoredState.productCategoryId);
      if (restoredState.gridRows) setGridRows(restoredState.gridRows);
      if (restoredState.productId) setProductId(restoredState.productId);
      if (restoredState.quantity) setQuantity(restoredState.quantity);
      if (restoredState.rate) setRate(restoredState.rate);
      if (restoredState.customerAccountId) setCustomerAccountId(restoredState.customerAccountId);
    }
  }, [restoredState]);

  useEffect(() => {
    Promise.all([
      api.listProducts(),
      api.listProductCategories(),
      api.listActiveStores(),
      api.listAccounts({ lite: true }),
      api.listCategories(),
      api.getNextSaleInvoiceReference(),
    ])
      .then(([prods, productCats, activeStores, accts, cats, ref]) => {
        setProducts(prods);
        setProductCategories(productCats);
        setStores(activeStores);
        setAccounts(accts);
        setCategories(cats);
        if (keepRestoredPredictedRef.current) {
          keepRestoredPredictedRef.current = false;
        } else {
          setPredictedRef(ref.reference);
        }
      })
      .catch(() => setError('Failed to load form data'));
  }, []);

  const productCategoryOptions = useMemo(
    () => (Array.isArray(productCategories) ? productCategories : []).map((c) => ({ value: String(c.id), label: c.name })),
    [productCategories],
  );
  const productOptions = useMemo(() => {
    const safeProducts = Array.isArray(products) ? products : [];
    const filtered = productCategoryId
      ? safeProducts.filter((p) => String(p.categoryId ?? '') === productCategoryId)
      : safeProducts;
    return filtered.map((p) => ({ value: String(p.id), label: p.name }));
  }, [products, productCategoryId]);
  const storeOptions = useMemo(
    () => (Array.isArray(stores) ? stores : []).map((s) => ({ value: String(s.id), label: s.name })),
    [stores],
  );
  const customerOptions = useMemo(
    () => flatPartyAccountOptions(categories, accounts),
    [categories, accounts],
  );
  const invoiceTotal = useMemo(
    () => gridRows.reduce((sum, row) => sum + row.lineTotal, 0),
    [gridRows],
  );

  function onProductCategoryChange(value: string) {
    setProductCategoryId(value);
    setProductId('');
  }

  async function addRow() {
    setError('');
    if (!storeId) {
      setError('Select a store before adding products');
      return;
    }
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

    const store = stores.find((s) => String(s.id) === storeId);
    const storeLabel = store?.name ?? 'selected store';
    const alreadyQueued = gridRows
      .filter((row) => row.productId === product.id)
      .reduce((sum, row) => sum + row.quantity, 0);

    setAddingRow(true);
    try {
      const { balance } = await api.getStockBalance({
        productId: product.id,
        storeId: Number(storeId),
      });
      const available = balance - alreadyQueued;
      if (qty > available) {
        setError(
          available <= 0
            ? `No stock for ${product.name} at ${storeLabel}`
            : `Only ${available} in stock at ${storeLabel}`,
        );
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check stock');
    } finally {
      setAddingRow(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!storeId) {
      setError('Select a store');
      return;
    }
    if (gridRows.length === 0) {
      setError('Add at least one product line');
      return;
    }
    if (!customerAccountId) {
      setError('Select a party');
      return;
    }
    setSaving(true);
    try {
      await api.createSaleInvoice({
        invoiceDate,
        billNo: billNo || undefined,
        storeId: Number(storeId),
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
      <Panel className="inv-form-panel mx-auto w-full overflow-visible bg-white">
        <form ref={trapRef} onSubmit={onSubmit}>
          <div className="inv-split">
            <div className="inv-split-form">
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
                  <InvoiceField wide>
                    <FieldLabel>Store</FieldLabel>
                    <SearchSelect
                      options={storeOptions}
                      value={storeId}
                      onChange={setStoreId}
                      placeholder="Select store"
                    />
                  </InvoiceField>
                </InvoiceHeaderRow>
              </InvoiceFormSection>

              <InvoiceFormSection label="Add existing product">
                <InvoiceFieldGroup>
                  <InvoiceFieldRow cols={4}>
                    <InvoiceField wide>
                      <FieldLabel>Category</FieldLabel>
                      <SearchSelect
                        options={productCategoryOptions}
                        value={productCategoryId}
                        onChange={onProductCategoryChange}
                        placeholder="Filter by category"
                      />
                    </InvoiceField>
                    <InvoiceField wide>
                      <FieldLabel>Product</FieldLabel>
                      <div className="flex items-center gap-1.5">
                        <div className="min-w-0 flex-1">
                          <SearchSelect
                            options={productOptions}
                            value={productId}
                            onChange={setProductId}
                            placeholder={productCategoryId ? 'Select product' : 'Select category first (or pick any)'}
                          />
                        </div>
                        <ProductInsightPopover productId={productId} storeId={storeId} />
                      </div>
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>Qty</FieldLabel>
                      <TextInput value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>Rate</FieldLabel>
                      <TextInput value={rate} onChange={(e) => setRate(e.target.value)} />
                    </InvoiceField>
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>
              </InvoiceFormSection>

              <InvoiceFormSection label="Customer">
                <InvoiceField wide>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <FieldLabel>Party</FieldLabel>
                    <button
                      type="button"
                      className="text-xs font-semibold text-financial hover:underline px-2 py-0.5 rounded hover:bg-financial/10 transition-colors"
                      onClick={() => setShowQuickAddParty(true)}
                    >
                      + New Customer
                    </button>
                  </div>
                  <SearchSelect
                    options={customerOptions}
                    value={customerAccountId}
                    onChange={setCustomerAccountId}
                    placeholder="Select party"
                  />
                </InvoiceField>
              </InvoiceFormSection>

              <QuickAddPartyModal
                kind="customer"
                isOpen={showQuickAddParty}
                onClose={() => setShowQuickAddParty(false)}
                onCreated={async (party) => {
                  const updatedAccounts = await api.listAccounts({ lite: true });
                  setAccounts(updatedAccounts);
                  if (party.accountId) {
                    setCustomerAccountId(String(party.accountId));
                  }
                }}
              />

              <InvoiceAddRowAction onClick={addRow} disabled={addingRow || saving}>
                {addingRow ? 'Checking stock…' : 'Add to grid'}
              </InvoiceAddRowAction>
            </div>

            <div className="inv-split-preview">
              <InvoiceFormSection label="Preview grid">
                <LinesTable
                  rows={gridRows}
                  onRemove={(clientId) => setGridRows((rows) => rows.filter((r) => r.clientId !== clientId))}
                />
              </InvoiceFormSection>

              <InvoiceFormFooter
                totalLabel="Sale total"
                totalValue={invoiceTotal}
                error={error}
                saving={saving}
                onClose={() => navigate(-1)}
                onMinimize={() =>
                  minimize(
                    {
                      predictedRef,
                      invoiceDate,
                      billNo,
                      storeId,
                      productCategoryId,
                      gridRows,
                      productId,
                      quantity,
                      rate,
                      customerAccountId,
                    },
                    predictedRef || 'Sale Invoice',
                  )
                }
                primaryLabel="Save"
              />
            </div>
          </div>
        </form>
      </Panel>
    </PageShell>
  );
}
