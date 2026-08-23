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
import {
  embeddedLinesFromInvoiceVouchers,
  embeddedLinesFromLegacyScalar,
  newEmbeddedPaymentLineDraft,
  parseEmbeddedPaymentLinesPayload,
  sumEmbeddedLineAmounts,
  type EmbeddedPaymentLineDraft,
} from '../../lib/embeddedInvoicePaymentLines';

import { ProductInsightPopover } from '../../components/invoices/ProductInsightPopover';

type GridRow = {
  clientId: string;
  productId: number;
  productName: string;
  quantity: number;
  rate: number;
  taxAmount: number;
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
  taxEnabled: boolean;
  taxAmount: string;
  partyCategoryId: string;
  customerAccountId: string;
  receiptLines: EmbeddedPaymentLineDraft[];
};

function todayInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function LinesTable({
  rows,
  onRemove,
  partyName,
  invoiceTotal,
  receivedTotal,
}: {
  rows: GridRow[];
  onRemove?: (clientId: string) => void;
  partyName: string;
  invoiceTotal: number;
  receivedTotal: number;
}) {
  const hasAnyTax = rows.some((r) => r.taxAmount > 0);
  const remaining = Math.max(0, invoiceTotal - receivedTotal);
  const baseCols = hasAnyTax ? 5 : 4;
  const colSpan = onRemove ? baseCols + 1 : baseCols;
  const labelColSpan = hasAnyTax ? 4 : 3;

  return (
    <InvoicePreviewGridShell isEmpty={rows.length === 0 && !partyName}>
      <table className="w-full min-w-[420px] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-surface2">
          <tr className="border-b border-border">
            <th colSpan={colSpan} className="px-3 py-2.5 text-left">
              <span className="inv-bill-party-name">{partyName.trim() || '—'}</span>
            </th>
          </tr>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-textMuted">
            <th className="px-3 py-2.5">Product</th>
            <th className={urduLabelClassName(salePurchaseInvoiceLabel('rate'), 'px-3 py-2.5 text-right')}>
              {salePurchaseInvoiceLabel('rate')}
            </th>
            <th className={urduLabelClassName(salePurchaseInvoiceLabel('qty'), 'px-3 py-2.5 text-right')}>
              {salePurchaseInvoiceLabel('qty')}
            </th>
            {hasAnyTax ? (
              <th className={urduLabelClassName(salePurchaseInvoiceLabel('tax'), 'px-3 py-2.5 text-right')}>
                {salePurchaseInvoiceLabel('tax')}
              </th>
            ) : null}
            <th className="px-3 py-2.5 text-right">Amount</th>
            {onRemove ? <th className="px-3 py-2.5" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.clientId} className="border-b border-border/50">
              <td className="px-3 py-2 inv-bill-product-name">{row.productName}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatLedgerAmount(row.rate)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.quantity}</td>
              {hasAnyTax ? (
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.taxAmount > 0 ? formatLedgerAmount(row.taxAmount) : '—'}
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
          {rows.length > 0 ? (
            <>
              <tr className="border-t border-border bg-surface2/60">
                <td colSpan={labelColSpan} className="px-3 py-2 text-right text-xs font-medium text-textMuted">
                  Total
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {formatLedgerAmount(invoiceTotal)}
                </td>
                {onRemove ? <td /> : null}
              </tr>
              <tr className="border-b border-border/50 bg-surface2/40">
                <td colSpan={labelColSpan} className="px-3 py-2 text-right text-xs font-medium text-textMuted">
                  Received
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {receivedTotal > 0 ? formatLedgerAmount(receivedTotal) : '0'}
                </td>
                {onRemove ? <td /> : null}
              </tr>
              <tr className="bg-surface2/40">
                <td colSpan={labelColSpan} className="px-3 py-2 text-right text-xs font-medium text-textMuted">
                  Remaining
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {formatLedgerAmount(remaining)}
                </td>
                {onRemove ? <td /> : null}
              </tr>
            </>
          ) : null}
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
  const [taxEnabled, setTaxEnabled] = useState(() => restoredState?.taxEnabled ?? false);
  const [taxAmount, setTaxAmount] = useState(() => restoredState?.taxAmount ?? '');
  const [partyCategoryId, setPartyCategoryId] = useState(() => restoredState?.partyCategoryId ?? '');
  const [customerAccountId, setCustomerAccountId] = useState(() => restoredState?.customerAccountId ?? '');
  const [receiptLines, setReceiptLines] = useState<EmbeddedPaymentLineDraft[]>(
    () => restoredState?.receiptLines ?? [],
  );
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
      if (restoredState.taxEnabled != null) setTaxEnabled(restoredState.taxEnabled);
      if (restoredState.taxAmount !== undefined) setTaxAmount(restoredState.taxAmount);
      if (restoredState.partyCategoryId) setPartyCategoryId(restoredState.partyCategoryId);
      if (restoredState.customerAccountId) setCustomerAccountId(restoredState.customerAccountId);
      if (restoredState.receiptLines) setReceiptLines(restoredState.receiptLines);
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
        const fromVouchers = embeddedLinesFromInvoiceVouchers(
          accounts,
          (inv as { vouchers?: Array<{ voucher?: { id: number; type: string; status: string; amount: number | string; debitAccountId?: number | null; creditAccountId?: number | null } | null }> }).vouchers ?? [],
          'SALE_RECEIPT',
        );
        if (fromVouchers.length > 0) {
          setReceiptLines(fromVouchers);
        } else {
          const receiptAmt = (inv as { embeddedReceiptAmount?: number | null }).embeddedReceiptAmount;
          const receiptAcct = (inv as { embeddedReceiptAccountId?: number | null }).embeddedReceiptAccountId;
          setReceiptLines(embeddedLinesFromLegacyScalar(accounts, receiptAcct, receiptAmt));
        }
        setGridRows(
          (inv.items ?? []).map((item, index) => {
            const tax = Number((item as { taxAmount?: number | string | null }).taxAmount ?? 0);
            return {
              clientId: `pending-${item.id ?? index}`,
              productId: item.productId ?? item.product?.id ?? 0,
              productName: item.product?.name ?? item.label,
              quantity: Number(item.quantity),
              rate: Number(item.unitPrice),
              taxAmount: tax,
              lineTotal: Number(item.total),
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
  const customerOptions = useMemo(
    () => partyAccountOptionsForCategory(accounts, partyCategoryId),
    [accounts, partyCategoryId],
  );
  const receiptCategoryOptions = useMemo(() => bankCashCategoryOptions(categories), [categories]);
  const invoiceTotal = useMemo(
    () => gridRows.reduce((sum, row) => sum + row.lineTotal, 0),
    [gridRows],
  );
  const receiptTotal = useMemo(() => sumEmbeddedLineAmounts(receiptLines), [receiptLines]);

  function onProductCategoryChange(value: string) {
    setProductCategoryId(value);
    setProductId('');
  }

  function onPartyCategoryChange(value: string) {
    setPartyCategoryId(value);
    setCustomerAccountId('');
  }

  function addReceiptLine() {
    setReceiptLines((lines) => [...lines, newEmbeddedPaymentLineDraft()]);
  }

  function removeReceiptLine(clientId: string) {
    setReceiptLines((lines) => lines.filter((line) => line.clientId !== clientId));
  }

  function updateReceiptLine(clientId: string, patch: Partial<EmbeddedPaymentLineDraft>) {
    setReceiptLines((lines) =>
      lines.map((line) => (line.clientId === clientId ? { ...line, ...patch } : line)),
    );
  }

  function parseReceiptPayload() {
    return parseEmbeddedPaymentLinesPayload(receiptLines, invoiceTotal, 'Receipt');
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
    const tax = taxEnabled ? Number(taxAmount || 0) : 0;
    if (!product) {
      setError('Select a product');
      return;
    }
    if (!(qty > 0) || !(unitRate >= 0) || !Number.isFinite(unitRate)) {
      setError('Enter a valid quantity and rate');
      return;
    }
    if (taxEnabled && (!(tax >= 0) || !Number.isFinite(tax))) {
      setError('Enter a valid tax amount');
      return;
    }
    const goodsTotal = Math.round(qty * unitRate * 100) / 100;
    const taxRounded = Math.round(tax * 100) / 100;
    if (taxRounded > goodsTotal) {
      setError('Tax cannot exceed the line amount');
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
          taxAmount: taxRounded,
          lineTotal: goodsTotal,
        },
      ]);
      setProductId('');
      setQuantity('1');
      setRate('');
      setTaxAmount('');
      setTaxEnabled(false);
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
            ...(row.taxAmount > 0 ? { taxAmount: row.taxAmount } : {}),
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
          ...(row.taxAmount > 0 ? { taxAmount: row.taxAmount } : {}),
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
                  <InvoiceFieldRow cols={taxEnabled ? 6 : 5}>
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
                    <InvoiceField>
                      <FieldLabel>{salePurchaseInvoiceLabel('applyTax')}</FieldLabel>
                      <label className="flex h-[2.375rem] cursor-pointer items-center gap-2 text-sm text-textPrimary">
                        <input
                          type="checkbox"
                          checked={taxEnabled}
                          onChange={(e) => {
                            setTaxEnabled(e.target.checked);
                            if (!e.target.checked) setTaxAmount('');
                          }}
                          className="h-4 w-4 rounded border-border text-financial"
                        />
                        <span className="text-xs font-medium">Enable</span>
                      </label>
                    </InvoiceField>
                    {taxEnabled ? (
                      <InvoiceField>
                        <FieldLabel>{salePurchaseInvoiceLabel('tax')}</FieldLabel>
                        <DecimalInput value={taxAmount} onChange={setTaxAmount} />
                      </InvoiceField>
                    ) : null}
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
                {receiptLines.length === 0 ? (
                  <p className="text-xs text-textMuted">No receipt lines yet. Add one if payment was received.</p>
                ) : (
                  <div className="space-y-3">
                    {receiptLines.map((line) => (
                      <InvoiceFieldRow key={line.clientId} cols={3} className="inv-sp-embedded-pay-row">
                        <InvoiceField>
                          <FieldLabel>Bank / Cash category</FieldLabel>
                          <SearchSelect
                            options={[{ value: '', label: 'None' }, ...receiptCategoryOptions]}
                            value={line.categoryId}
                            onChange={(value) =>
                              updateReceiptLine(line.clientId, { categoryId: value, accountId: '' })
                            }
                            placeholder="Select category"
                          />
                        </InvoiceField>
                        <InvoiceField>
                          <FieldLabel>Receipt account</FieldLabel>
                          <SearchSelect
                            options={bankCashAccountOptions(accounts, line.categoryId)}
                            value={line.accountId}
                            onChange={(value) => updateReceiptLine(line.clientId, { accountId: value })}
                            placeholder={line.categoryId ? 'Select account' : 'Select category first'}
                            disabled={!line.categoryId}
                          />
                        </InvoiceField>
                        <InvoiceField>
                          <div className="flex items-end gap-2">
                            <div className="min-w-0 flex-1">
                              <FieldLabel>Received amount</FieldLabel>
                              <DecimalInput
                                value={line.amount}
                                onChange={(value) => updateReceiptLine(line.clientId, { amount: value })}
                              />
                            </div>
                            <button
                              type="button"
                              className="mb-0.5 shrink-0 text-xs text-danger"
                              onClick={() => removeReceiptLine(line.clientId)}
                              aria-label="Remove receipt line"
                            >
                              Remove
                            </button>
                          </div>
                        </InvoiceField>
                      </InvoiceFieldRow>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <InvoiceAddRowAction type="button" onClick={addReceiptLine} disabled={saving}>
                    + Add line
                  </InvoiceAddRowAction>
                  {receiptLines.length > 0 ? (
                    <p className="text-xs text-textSecondary">
                      Total received:{' '}
                      <span className="font-medium tabular-nums">{formatLedgerAmount(receiptTotal)}</span>
                      {' of '}
                      <span className="font-medium tabular-nums">{formatLedgerAmount(invoiceTotal)}</span>
                    </p>
                  ) : null}
                </div>
              </InvoiceFormSection>

              <InvoiceAddRowAction onClick={addRow} disabled={addingRow || saving}>
                {addingRow ? 'Checking stock…' : salePurchaseInvoiceLabel('addToGrid')}
              </InvoiceAddRowAction>

              <InvoiceFormSection label={salePurchaseInvoiceLabel('previewGrid')}>
                <LinesTable
                  rows={gridRows}
                  partyName={
                    accounts.find((a) => String(a.id) === customerAccountId)?.name ?? ''
                  }
                  invoiceTotal={invoiceTotal}
                  receivedTotal={receiptTotal}
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
                            taxEnabled,
                            taxAmount,
                            partyCategoryId,
                            customerAccountId,
                            receiptLines,
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
