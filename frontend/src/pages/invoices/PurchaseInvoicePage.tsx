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

type GridRow = {
  clientId: string;
  productId: number;
  productName: string;
  quantity: number;
  rate: number;
  mazduriAmount: number;
  /** Goods only (qty × rate). */
  goodsTotal: number;
  /** Goods + Mazduri (product debit). */
  lineTotal: number;
};

type PurchaseInvoiceDraft = {
  predictedRef: string;
  invoiceDate: string;
  billNo: string;
  storeId: string;
  productCategoryId: string;
  gridRows: GridRow[];
  productId: string;
  quantity: string;
  rate: string;
  mazduriEnabled: boolean;
  mazduriAmount: string;
  partyCategoryId: string;
  supplierAccountId: string;
  paymentCategoryId: string;
  paymentAccountId: string;
  paymentAmount: string;
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
  const hasAnyMazduri = rows.some((r) => r.mazduriAmount > 0);
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
            {hasAnyMazduri ? (
              <th className={urduLabelClassName(salePurchaseInvoiceLabel('mazduri'), 'px-3 py-2.5 text-right')}>
                {salePurchaseInvoiceLabel('mazduri')}
              </th>
            ) : null}
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
              {hasAnyMazduri ? (
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.mazduriAmount > 0 ? formatLedgerAmount(row.mazduriAmount) : '—'}
                </td>
              ) : null}
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

export function PurchaseInvoicePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pendingIdParam = searchParams.get('pendingId');
  const pendingId = pendingIdParam ? Number(pendingIdParam) : null;
  const isEditingPending = pendingId != null && Number.isFinite(pendingId) && pendingId > 0;
  const { restoredState, minimize } = useMinimizableForm<PurchaseInvoiceDraft>('purchase-invoice');
  const keepRestoredPredictedRef = useRef(Boolean(restoredState?.predictedRef));

  const [predictedRef, setPredictedRef] = useState(() => restoredState?.predictedRef ?? 'PI-…');
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
  const [mazduriEnabled, setMazduriEnabled] = useState(() => restoredState?.mazduriEnabled ?? false);
  const [mazduriAmount, setMazduriAmount] = useState(() => restoredState?.mazduriAmount ?? '');
  const [partyCategoryId, setPartyCategoryId] = useState(() => restoredState?.partyCategoryId ?? '');
  const [supplierAccountId, setSupplierAccountId] = useState(() => restoredState?.supplierAccountId ?? '');
  const [paymentCategoryId, setPaymentCategoryId] = useState(() => restoredState?.paymentCategoryId ?? '');
  const [paymentAccountId, setPaymentAccountId] = useState(() => restoredState?.paymentAccountId ?? '');
  const [paymentAmount, setPaymentAmount] = useState(() => restoredState?.paymentAmount ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
      if (restoredState.mazduriEnabled != null) setMazduriEnabled(restoredState.mazduriEnabled);
      if (restoredState.mazduriAmount !== undefined) setMazduriAmount(restoredState.mazduriAmount);
      if (restoredState.partyCategoryId) setPartyCategoryId(restoredState.partyCategoryId);
      if (restoredState.supplierAccountId) setSupplierAccountId(restoredState.supplierAccountId);
      if (restoredState.paymentCategoryId) setPaymentCategoryId(restoredState.paymentCategoryId);
      if (restoredState.paymentAccountId) setPaymentAccountId(restoredState.paymentAccountId);
      if (restoredState.paymentAmount) setPaymentAmount(restoredState.paymentAmount);
    }
  }, [restoredState]);

  useEffect(() => {
    if (!supplierAccountId || partyCategoryId || accounts.length === 0) return;
    const derived = partyCategoryIdForAccount(accounts, supplierAccountId);
    if (derived) setPartyCategoryId(derived);
  }, [accounts, supplierAccountId, partyCategoryId]);

  useEffect(() => {
    if (!partyCategoryId || categories.length === 0) return;
    const valid = partyCategorySelectOptions(categories).some((o) => o.value === partyCategoryId);
    if (!valid) {
      setPartyCategoryId('');
      setSupplierAccountId('');
    }
  }, [partyCategoryId, categories]);

  useEffect(() => {
    if (!partyCategoryId || !supplierAccountId) return;
    const acct = accounts.find((a) => String(a.id) === supplierAccountId);
    if (acct && String(acct.categoryId) !== partyCategoryId) {
      setSupplierAccountId('');
    }
  }, [partyCategoryId, supplierAccountId, accounts]);

  useEffect(() => {
    Promise.all([
      api.listProducts(),
      api.listProductCategories(),
      api.listActiveStores(),
      api.listAccounts({ lite: true }),
      api.listCategories(),
      isEditingPending ? Promise.resolve(null) : api.getNextPurchaseInvoiceReference(),
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
        if (inv.debitAccountId != null) setSupplierAccountId(String(inv.debitAccountId));
        const paymentAmt = (inv as { embeddedPaymentAmount?: number | null }).embeddedPaymentAmount;
        const paymentAcct = (inv as { embeddedPaymentAccountId?: number | null }).embeddedPaymentAccountId;
        if (paymentAmt != null && Number(paymentAmt) > 0) {
          setPaymentAmount(String(paymentAmt));
        }
        if (paymentAcct != null) {
          setPaymentAccountId(String(paymentAcct));
          const acct = accounts.find((a) => a.id === paymentAcct);
          if (acct) setPaymentCategoryId(String(acct.categoryId));
        }
        setGridRows(
          (inv.items ?? []).map((item, index) => {
            const quantity = Number(item.quantity);
            const rate = Number(item.unitPrice);
            const goodsTotal = Number(item.total);
            const mazduri = Number(item.mazduriAmount ?? 0);
            return {
              clientId: `pending-${item.id ?? index}`,
              productId: item.productId ?? item.product?.id ?? 0,
              productName: item.product?.name ?? item.label,
              quantity,
              rate,
              mazduriAmount: mazduri,
              goodsTotal,
              lineTotal: Math.round((goodsTotal + mazduri) * 100) / 100,
            };
          }),
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
  const supplierOptions = useMemo(
    () => partyAccountOptionsForCategory(accounts, partyCategoryId),
    [accounts, partyCategoryId],
  );
  const paymentCategoryOptions = useMemo(() => bankCashCategoryOptions(categories), [categories]);
  const paymentAccountOptions = useMemo(
    () => bankCashAccountOptions(accounts, paymentCategoryId),
    [accounts, paymentCategoryId],
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
    setSupplierAccountId('');
  }

  function onPaymentCategoryChange(value: string) {
    setPaymentCategoryId(value);
    setPaymentAccountId('');
  }

  function parsePaymentPayload() {
    const amount = paymentAmount.trim() ? Number(paymentAmount) : 0;
    if (amount <= 0) return {};
    if (!paymentAccountId) {
      throw new Error('Select a Bank/Cash account for the payment amount');
    }
    if (amount > invoiceTotal + 0.01) {
      throw new Error('Payment amount cannot exceed invoice total');
    }
    return {
      paymentAmount: amount,
      paymentAccountId: Number(paymentAccountId),
    };
  }

  function addRow() {
    setError('');
    if (!storeId) {
      setError('Select a store before adding products');
      return;
    }
    const product = products.find((p) => String(p.id) === productId);
    const qty = Number(quantity);
    const unitRate = Number(rate);
    const mazduri = mazduriEnabled ? Number(mazduriAmount || 0) : 0;
    if (!product) {
      setError('Select an existing product (create products under Products first)');
      return;
    }
    if (!(qty > 0) || !(unitRate >= 0) || !Number.isFinite(unitRate)) {
      setError('Enter a valid quantity and rate');
      return;
    }
    if (mazduriEnabled && (!(mazduri >= 0) || !Number.isFinite(mazduri))) {
      setError('Enter a valid Mazduri amount');
      return;
    }
    const goodsTotal = Math.round(qty * unitRate * 100) / 100;
    const mazduriRounded = Math.round(mazduri * 100) / 100;
    setGridRows((rows) => [
      ...rows,
      {
        clientId: `${Date.now()}-${rows.length}`,
        productId: product.id,
        productName: product.name,
        quantity: qty,
        rate: unitRate,
        mazduriAmount: mazduriRounded,
        goodsTotal,
        lineTotal: Math.round((goodsTotal + mazduriRounded) * 100) / 100,
      },
    ]);
    setProductId('');
    setQuantity('1');
    setRate('');
    setMazduriAmount('');
    setMazduriEnabled(false);
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
    if (!supplierAccountId) {
      setError('Select a party');
      return;
    }
    setSaving(true);
    try {
      let paymentPayload = {};
      try {
        paymentPayload = parsePaymentPayload();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid payment');
        setSaving(false);
        return;
      }
      const lines = gridRows.map((row) => ({
        productId: row.productId,
        quantity: row.quantity,
        rate: row.rate,
        ...(row.mazduriAmount > 0 ? { mazduriAmount: row.mazduriAmount } : {}),
      }));
      if (isEditingPending && pendingId != null) {
        await api.updatePendingInvoice(pendingId, {
          invoiceDate,
          billNo: billNo || undefined,
          storeId: Number(storeId),
          supplierAccountId: Number(supplierAccountId),
          ...paymentPayload,
          lines,
        });
        navigate('/system/approvals');
        return;
      }
      const invoice = await api.createPurchaseInvoice({
        invoiceDate,
        billNo: billNo || undefined,
        storeId: Number(storeId),
        supplierAccountId: Number(supplierAccountId),
        ...paymentPayload,
        lines,
      });
      if (printAfterSave && invoice.reference) {
        navigate(`/invoices/print-bill?reference=${encodeURIComponent(invoice.reference)}`);
      } else {
        navigate('/invoices/view-invoice');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save purchase invoice');
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
      title={isEditingPending ? 'Edit Pending Purchase Invoice' : 'Purchase Invoice'}
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
                  <InvoiceFieldRow cols={mazduriEnabled ? 6 : 5}>
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
                      <SearchSelect
                        options={productOptions}
                        value={productId}
                        onChange={setProductId}
                        placeholder={productCategoryId ? 'Select product' : 'Select category first (or pick any)'}
                      />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>{salePurchaseInvoiceLabel('qty')}</FieldLabel>
                      <DecimalInput value={quantity} onChange={setQuantity} />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>{salePurchaseInvoiceLabel('rate')}</FieldLabel>
                      <DecimalInput value={rate} onChange={setRate} />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>{salePurchaseInvoiceLabel('addMazduri')}</FieldLabel>
                      <label className="flex h-[2.375rem] cursor-pointer items-center gap-2 text-sm text-textPrimary">
                        <input
                          type="checkbox"
                          checked={mazduriEnabled}
                          onChange={(e) => {
                            setMazduriEnabled(e.target.checked);
                            if (!e.target.checked) setMazduriAmount('');
                          }}
                          className="h-4 w-4 rounded border-border text-financial"
                        />
                        <span className="text-xs font-medium">Enable</span>
                      </label>
                    </InvoiceField>
                    {mazduriEnabled ? (
                      <InvoiceField>
                        <FieldLabel>{salePurchaseInvoiceLabel('mazduri')}</FieldLabel>
                        <DecimalInput value={mazduriAmount} onChange={setMazduriAmount} />
                      </InvoiceField>
                    ) : null}
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>
              </InvoiceFormSection>

              <InvoiceFormSection label={salePurchaseInvoiceLabel('party')}>
                <InvoiceFieldRow cols={2} className="inv-sp-party-row">
                  <InvoiceField>
                    <FieldLabel>{salePurchaseInvoiceLabel('purchasePartyCategory')}</FieldLabel>
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
                      options={supplierOptions}
                      value={supplierAccountId}
                      onChange={setSupplierAccountId}
                      placeholder={partyCategoryId ? 'Select party' : 'Select a category first'}
                      disabled={!partyCategoryId}
                    />
                  </InvoiceField>
                </InvoiceFieldRow>
              </InvoiceFormSection>

              <InvoiceFormSection label="Payment (optional)">
                <InvoiceFieldRow cols={3}>
                  <InvoiceField>
                    <FieldLabel>Bank / Cash category</FieldLabel>
                    <SearchSelect
                      options={[{ value: '', label: 'None' }, ...paymentCategoryOptions]}
                      value={paymentCategoryId}
                      onChange={onPaymentCategoryChange}
                      placeholder="None"
                    />
                  </InvoiceField>
                  <InvoiceField>
                    <FieldLabel>Payment account</FieldLabel>
                    <SearchSelect
                      options={paymentAccountOptions}
                      value={paymentAccountId}
                      onChange={setPaymentAccountId}
                      placeholder={paymentCategoryId ? 'Select account' : 'Select category first'}
                      disabled={!paymentCategoryId}
                    />
                  </InvoiceField>
                  <InvoiceField>
                    <FieldLabel>Paid amount</FieldLabel>
                    <DecimalInput value={paymentAmount} onChange={setPaymentAmount} />
                  </InvoiceField>
                </InvoiceFieldRow>
              </InvoiceFormSection>

              <InvoiceAddRowAction onClick={addRow}>{salePurchaseInvoiceLabel('addToGrid')}</InvoiceAddRowAction>

              <InvoiceFormSection label={salePurchaseInvoiceLabel('previewGrid')}>
                <LinesTable
                  rows={gridRows}
                  onRemove={(clientId) => setGridRows((rows) => rows.filter((r) => r.clientId !== clientId))}
                />
              </InvoiceFormSection>

              <InvoiceFormFooter
                totalLabel="Purchase total"
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
                            mazduriEnabled,
                            mazduriAmount,
                            partyCategoryId,
                            supplierAccountId,
                            paymentCategoryId,
                            paymentAccountId,
                            paymentAmount,
                          },
                          predictedRef || 'Purchase Invoice',
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
