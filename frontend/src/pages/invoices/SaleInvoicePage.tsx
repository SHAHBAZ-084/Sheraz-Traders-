import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  FormPageShell,
  InvoiceAddRowAction,
  InvoiceField,
  InvoiceFieldGroup,
  InvoiceFieldRow,
  InvoiceFormFooter,
  InvoiceFormSection,
  InvoiceHeaderRow,
} from '../../components/invoices/InvoiceFormLayout';
import { FieldLabel, TextInput } from '../../components/ui/PageShell';
import { DecimalInput } from '../../components/ui/DecimalInput';
import { SearchSelect } from '../../components/ui/SearchSelect';
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
import {
  partyAccountOptionsForCategory,
  partyCategoryIdForAccount,
  partyCategorySelectOptions,
} from '../../lib/partyAccounts';
import { InvoicePreviewGridShell } from './InvoicePreviewGrid';
import { salePurchaseInvoiceLabel } from '../../lib/salePurchaseInvoiceLabels';
import { urduLabelClassName } from '../../lib/urduScript';
import { bankCashAccountOptions, bankCashCategoryOptions } from '../../lib/bankCashAccounts';

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
  partyCategoryId: string;
  customerAccountId: string;
  receiptCategoryId: string;
  receiptAccountId: string;
  receiptAmount: string;
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
            <th className={urduLabelClassName(salePurchaseInvoiceLabel('qty'), 'px-3 py-2.5 text-right')}>
              {salePurchaseInvoiceLabel('qty')}
            </th>
            <th className={urduLabelClassName(salePurchaseInvoiceLabel('rate'), 'px-3 py-2.5 text-right')}>
              {salePurchaseInvoiceLabel('rate')}
            </th>
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
  const [searchParams] = useSearchParams();
  const pendingIdParam = searchParams.get('pendingId');
  const pendingId = pendingIdParam ? Number(pendingIdParam) : null;
  const isEditingPending = pendingId != null && Number.isFinite(pendingId) && pendingId > 0;
  const { restoredState, minimize } = useMinimizableForm<SaleInvoiceDraft>('sale-invoice');
  const keepRestoredPredictedRef = useRef(Boolean(restoredState?.predictedRef));

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
  const [partyCategoryId, setPartyCategoryId] = useState(() => restoredState?.partyCategoryId ?? '');
  const [customerAccountId, setCustomerAccountId] = useState(() => restoredState?.customerAccountId ?? '');
  const [receiptCategoryId, setReceiptCategoryId] = useState(() => restoredState?.receiptCategoryId ?? '');
  const [receiptAccountId, setReceiptAccountId] = useState(() => restoredState?.receiptAccountId ?? '');
  const [receiptAmount, setReceiptAmount] = useState(() => restoredState?.receiptAmount ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [addingRow, setAddingRow] = useState(false);

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
      if (restoredState.partyCategoryId) setPartyCategoryId(restoredState.partyCategoryId);
      if (restoredState.customerAccountId) setCustomerAccountId(restoredState.customerAccountId);
      if (restoredState.receiptCategoryId) setReceiptCategoryId(restoredState.receiptCategoryId);
      if (restoredState.receiptAccountId) setReceiptAccountId(restoredState.receiptAccountId);
      if (restoredState.receiptAmount) setReceiptAmount(restoredState.receiptAmount);
    }
  }, [restoredState]);

  useEffect(() => {
    if (!customerAccountId || partyCategoryId || accounts.length === 0) return;
    const derived = partyCategoryIdForAccount(accounts, customerAccountId);
    if (derived) setPartyCategoryId(derived);
  }, [accounts, customerAccountId, partyCategoryId]);

  useEffect(() => {
    if (!partyCategoryId || categories.length === 0) return;
    const valid = partyCategorySelectOptions(categories).some((o) => o.value === partyCategoryId);
    if (!valid) {
      setPartyCategoryId('');
      setCustomerAccountId('');
    }
  }, [partyCategoryId, categories]);

  useEffect(() => {
    if (!partyCategoryId || !customerAccountId) return;
    const acct = accounts.find((a) => String(a.id) === customerAccountId);
    if (acct && String(acct.categoryId) !== partyCategoryId) {
      setCustomerAccountId('');
    }
  }, [partyCategoryId, customerAccountId, accounts]);

  useEffect(() => {
    Promise.all([
      api.listProducts(),
      api.listProductCategories(),
      api.listActiveStores(),
      api.listAccounts({ lite: true }),
      api.listCategories(),
      isEditingPending ? Promise.resolve(null) : api.getNextSaleInvoiceReference(),
    ])
      .then(([prods, productCats, activeStores, accts, cats, ref]) => {
        setProducts(prods);
        setProductCategories(productCats);
        setStores(activeStores);
        setAccounts(accts);
        setCategories(cats);
        if (ref && !isEditingPending) {
          if (keepRestoredPredictedRef.current) {
            keepRestoredPredictedRef.current = false;
          } else {
            setPredictedRef(ref.reference);
          }
        }
      })
      .catch(() => setError('Failed to load form data'));
  }, [isEditingPending]);

  useEffect(() => {
    if (!isEditingPending || pendingId == null) return;
    let cancelled = false;
    api
      .getPendingInvoice(pendingId)
      .then((inv) => {
        if (cancelled) return;
        setPredictedRef(inv.reference);
        if (inv.invoiceDate) {
          setInvoiceDate(String(inv.invoiceDate).slice(0, 10));
        }
        setBillNo(inv.billNo ?? '');
        if (inv.storeId != null) setStoreId(String(inv.storeId));
        if (inv.debitAccountId != null) setCustomerAccountId(String(inv.debitAccountId));
        const receiptAmt = (inv as { embeddedReceiptAmount?: number | null }).embeddedReceiptAmount;
        const receiptAcct = (inv as { embeddedReceiptAccountId?: number | null }).embeddedReceiptAccountId;
        if (receiptAmt != null && Number(receiptAmt) > 0) {
          setReceiptAmount(String(receiptAmt));
        }
        if (receiptAcct != null) {
          setReceiptAccountId(String(receiptAcct));
          const acct = accounts.find((a) => a.id === receiptAcct);
          if (acct) setReceiptCategoryId(String(acct.categoryId));
        }
        setGridRows(
          (inv.items ?? []).map((item, index) => ({
            clientId: `pending-${item.id ?? index}`,
            productId: item.productId ?? item.product?.id ?? 0,
            productName: item.product?.name ?? item.label,
            quantity: Number(item.quantity),
            rate: Number(item.unitPrice),
            lineTotal: Number(item.total),
          })),
        );
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load pending invoice');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isEditingPending, pendingId]);

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
  const partyCategoryOptions = useMemo(
    () => partyCategorySelectOptions(categories),
    [categories],
  );
  const customerOptions = useMemo(
    () => partyAccountOptionsForCategory(accounts, partyCategoryId),
    [accounts, partyCategoryId],
  );
  const receiptCategoryOptions = useMemo(() => bankCashCategoryOptions(categories), [categories]);
  const receiptAccountOptions = useMemo(
    () => bankCashAccountOptions(accounts, receiptCategoryId),
    [accounts, receiptCategoryId],
  );
  const invoiceTotal = useMemo(
    () => gridRows.reduce((sum, row) => sum + row.lineTotal, 0),
    [gridRows],
  );

  function onProductCategoryChange(value: string) {
    setProductCategoryId(value);
    setProductId('');
  }

  function onPartyCategoryChange(value: string) {
    setPartyCategoryId(value);
    setCustomerAccountId('');
  }

  function onReceiptCategoryChange(value: string) {
    setReceiptCategoryId(value);
    setReceiptAccountId('');
  }

  function parseReceiptPayload() {
    const amount = receiptAmount.trim() ? Number(receiptAmount) : 0;
    if (amount <= 0) return {};
    if (!receiptAccountId) {
      throw new Error('Select a Bank/Cash account for the receipt amount');
    }
    if (amount > invoiceTotal + 0.01) {
      throw new Error('Receipt amount cannot exceed invoice total');
    }
    return {
      receiptAmount: amount,
      receiptAccountId: Number(receiptAccountId),
    };
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

  async function submitInvoice(printAfterSave: boolean) {
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
      let receiptPayload = {};
      try {
        receiptPayload = parseReceiptPayload();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid receipt');
        setSaving(false);
        return;
      }
      if (isEditingPending && pendingId != null) {
        await api.updatePendingInvoice(pendingId, {
          invoiceDate,
          billNo: billNo || undefined,
          storeId: Number(storeId),
          customerAccountId: Number(customerAccountId),
          ...receiptPayload,
          lines: gridRows.map((row) => ({
            productId: row.productId,
            quantity: row.quantity,
            rate: row.rate,
          })),
        });
        navigate('/system/approvals');
        return;
      }
      const invoice = await api.createSaleInvoice({
        invoiceDate,
        billNo: billNo || undefined,
        storeId: Number(storeId),
        customerAccountId: Number(customerAccountId),
        ...receiptPayload,
        lines: gridRows.map((row) => ({
          productId: row.productId,
          quantity: row.quantity,
          rate: row.rate,
        })),
      });
      if (printAfterSave && invoice.reference) {
        navigate(`/invoices/print-bill?reference=${encodeURIComponent(invoice.reference)}`);
      } else {
        navigate('/invoices/view-invoice');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save sale invoice');
    } finally {
      setSaving(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await submitInvoice(false);
  }

  return (
    <FormPageShell
      title={isEditingPending ? 'Edit Pending Sale Invoice' : 'Sale Invoice'}
      panelClassName="inv-sp-invoice-panel"
    >
      <form onSubmit={onSubmit}>
        <div className="inv-sp-invoice-form">
              <InvoiceFormSection label={salePurchaseInvoiceLabel('header')}>
                <InvoiceHeaderRow>
                  <InvoiceField>
                    <FieldLabel>{salePurchaseInvoiceLabel('date')}</FieldLabel>
                    <TextInput type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                  </InvoiceField>
                  <InvoiceField>
                    <FieldLabel>{salePurchaseInvoiceLabel('invoiceNo')}</FieldLabel>
                    <TextInput value={predictedRef} readOnly />
                  </InvoiceField>
                  <InvoiceField>
                    <FieldLabel>{salePurchaseInvoiceLabel('billNo')}</FieldLabel>
                    <TextInput value={billNo} onChange={(e) => setBillNo(e.target.value)} />
                  </InvoiceField>
                  <InvoiceField wide>
                    <FieldLabel>{salePurchaseInvoiceLabel('store')}</FieldLabel>
                    <SearchSelect
                      options={storeOptions}
                      value={storeId}
                      onChange={setStoreId}
                      placeholder="Select store"
                    />
                  </InvoiceField>
                </InvoiceHeaderRow>
              </InvoiceFormSection>

              <InvoiceFormSection label={salePurchaseInvoiceLabel('addExistingProduct')}>
                <InvoiceFieldGroup>
                  <InvoiceFieldRow cols={4}>
                    <InvoiceField wide>
                      <FieldLabel>{salePurchaseInvoiceLabel('category')}</FieldLabel>
                      <SearchSelect
                        options={productCategoryOptions}
                        value={productCategoryId}
                        onChange={onProductCategoryChange}
                        placeholder="Filter by category"
                      />
                    </InvoiceField>
                    <InvoiceField wide>
                      <FieldLabel>{salePurchaseInvoiceLabel('product')}</FieldLabel>
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
                      <FieldLabel>{salePurchaseInvoiceLabel('qty')}</FieldLabel>
                      <DecimalInput value={quantity} onChange={setQuantity} />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>{salePurchaseInvoiceLabel('rate')}</FieldLabel>
                      <DecimalInput value={rate} onChange={setRate} />
                    </InvoiceField>
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>
              </InvoiceFormSection>

              <InvoiceFormSection label={salePurchaseInvoiceLabel('party')}>
                <InvoiceFieldRow cols={2}>
                  <InvoiceField>
                    <FieldLabel>{salePurchaseInvoiceLabel('salePartyCategory')}</FieldLabel>
                    <SearchSelect
                      options={partyCategoryOptions}
                      value={partyCategoryId}
                      onChange={onPartyCategoryChange}
                      placeholder="Select category…"
                    />
                  </InvoiceField>
                  <InvoiceField>
                    <FieldLabel>{salePurchaseInvoiceLabel('party')}</FieldLabel>
                    <SearchSelect
                      options={customerOptions}
                      value={customerAccountId}
                      onChange={setCustomerAccountId}
                      placeholder={partyCategoryId ? 'Select party' : 'Select a category first'}
                      disabled={!partyCategoryId}
                    />
                  </InvoiceField>
                </InvoiceFieldRow>
              </InvoiceFormSection>

              <InvoiceFormSection label="Receipt (optional)">
                <InvoiceFieldRow cols={3}>
                  <InvoiceField>
                    <FieldLabel>Bank / Cash category</FieldLabel>
                    <SearchSelect
                      options={[{ value: '', label: 'None' }, ...receiptCategoryOptions]}
                      value={receiptCategoryId}
                      onChange={onReceiptCategoryChange}
                      placeholder="None"
                    />
                  </InvoiceField>
                  <InvoiceField>
                    <FieldLabel>Receipt account</FieldLabel>
                    <SearchSelect
                      options={receiptAccountOptions}
                      value={receiptAccountId}
                      onChange={setReceiptAccountId}
                      placeholder={receiptCategoryId ? 'Select account' : 'Select category first'}
                      disabled={!receiptCategoryId}
                    />
                  </InvoiceField>
                  <InvoiceField>
                    <FieldLabel>Received amount</FieldLabel>
                    <DecimalInput value={receiptAmount} onChange={setReceiptAmount} />
                  </InvoiceField>
                </InvoiceFieldRow>
              </InvoiceFormSection>

              <InvoiceAddRowAction onClick={addRow} disabled={addingRow || saving}>
                {addingRow ? 'Checking stock…' : salePurchaseInvoiceLabel('addToGrid')}
              </InvoiceAddRowAction>

              <InvoiceFormSection label={salePurchaseInvoiceLabel('previewGrid')}>
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
                onClose={() => {
                  if (isEditingPending) navigate('/system/approvals');
                  else navigate(-1);
                }}
                onMinimize={
                  isEditingPending
                    ? undefined
                    : () =>
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
                            partyCategoryId,
                            customerAccountId,
                            receiptCategoryId,
                            receiptAccountId,
                            receiptAmount,
                          },
                          predictedRef || 'Sale Invoice',
                        )
                }
                primaryLabel={isEditingPending ? 'Update pending' : salePurchaseInvoiceLabel('save')}
                secondaryPrimaryLabel={
                  isEditingPending ? undefined : 'Save & Print'
                }
                onSecondaryPrimaryClick={
                  isEditingPending ? undefined : () => void submitInvoice(true)
                }
              />
          </div>
        </form>
    </FormPageShell>
  );
}
