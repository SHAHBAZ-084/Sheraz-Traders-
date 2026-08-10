import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  FormPageShell,
  InvoiceAddRowAction,
  InvoiceField,
  InvoiceFieldRow,
  InvoiceFormSection,
} from '../../components/invoices/InvoiceFormLayout';
import { InvoicePreviewGridShell } from '../../pages/invoices/InvoicePreviewGrid';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { DecimalInput } from '../../components/ui/DecimalInput';
import { AmountInput } from '../../components/ui/AmountInput';
import { FieldLabel, SecondaryButton, TextInput } from '../../components/ui/PageShell';
import { PageCloseBar } from '../../components/ui/PageCloseBar';
import { useAuth } from '../../contexts/AuthContext';
import { api, type Account, type AccountCategory, type JamaNaamEntry, type Product, type ProductCategory } from '../../lib/api';
import { formatDate, formatLedgerAmount, ledgerCreditAmountClass, ledgerDebitAmountClass } from '../../lib/format';
import { flatPartyAccountOptions } from '../../lib/partyAccounts';

function todayInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function directionLabel(direction: JamaNaamEntry['direction']) {
  return direction === 'JAMA' ? 'Jama' : 'Naam';
}

function directionClass(direction: JamaNaamEntry['direction']) {
  return direction === 'JAMA' ? ledgerCreditAmountClass(true) : ledgerDebitAmountClass(true);
}

function gridCell(value: string | number | null | undefined) {
  if (value == null || value === '') return '—';
  return value;
}

export function JamaNaamRegisterPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [entries, setEntries] = useState<JamaNaamEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [partyId, setPartyId] = useState('');
  const [productCategoryId, setProductCategoryId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'JAMA' | 'NAAM'>('JAMA');
  const [entryDate, setEntryDate] = useState(todayInputValue);
  const [notes, setNotes] = useState('');

  const partyOptions = useMemo(
    () => flatPartyAccountOptions(categories, accounts),
    [categories, accounts],
  );

  const productCategoryOptions = useMemo(
    () =>
      productCategories.map((c) => ({ value: String(c.id), label: c.name })).sort((a, b) => a.label.localeCompare(b.label)),
    [productCategories],
  );

  const productOptions = useMemo(() => {
    if (!productCategoryId) return [];
    return products
      .filter((p) => p.categoryId != null && String(p.categoryId) === productCategoryId)
      .map((p) => ({ value: String(p.id), label: p.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [products, productCategoryId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.listCategories(),
      api.listAccounts({ lite: true }),
      api.listProductCategories(),
      api.listProducts(),
      api.listJamaNaamEntries(),
    ])
      .then(([catRows, accRows, prodCatRows, prodRows, entryRows]) => {
        if (cancelled) return;
        setCategories(catRows);
        setAccounts(accRows);
        setProductCategories(prodCatRows);
        setProducts(prodRows);
        setEntries(entryRows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load register');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function resetForm() {
    setPartyId('');
    setProductCategoryId('');
    setProductId('');
    setQuantity('');
    setAmount('');
    setDirection('JAMA');
    setEntryDate(todayInputValue());
    setNotes('');
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setError('');

    const qty = quantity.trim() ? Number(quantity) : null;
    const parsedAmount = amount.trim() ? Number(amount) : null;
    const hasProductId = Boolean(productId);
    const hasQuantity = qty != null && Number.isFinite(qty) && qty > 0;
    const hasAmount = parsedAmount != null && Number.isFinite(parsedAmount) && parsedAmount > 0;

    if (!partyId) {
      setError('Select a party');
      return;
    }
    if (!entryDate) {
      setError('Select a date');
      return;
    }
    if (hasProductId !== hasQuantity) {
      setError('Product and quantity must both be filled together');
      return;
    }
    const hasProductLine = hasProductId && hasQuantity;
    if (!hasProductLine && !hasAmount) {
      setError('Enter product with quantity, or an amount');
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.createJamaNaamEntry({
        partyId: Number(partyId),
        productId: hasProductLine ? Number(productId) : null,
        quantity: hasProductLine ? qty : null,
        amount: hasAmount ? parsedAmount : null,
        direction,
        date: entryDate,
        notes: notes.trim() || null,
      });
      setEntries((prev) => [created, ...prev]);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add entry');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSettle(entry: JamaNaamEntry) {
    const confirmed = window.confirm('Settle and remove this entry? This cannot be undone.');
    if (!confirmed) return;

    setError('');
    try {
      await api.settleJamaNaamEntry(entry.id);
      setEntries((prev) => prev.filter((row) => row.id !== entry.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to settle entry');
    }
  }

  return (
    <FormPageShell title="Jama Naam Register" panelClassName="voucher-batch-panel">
      {loading ? (
        <p className="text-sm text-textSecondary">Loading…</p>
      ) : (
        <div className="voucher-batch-form voucher-batch-split">
          <form className="voucher-batch-split-form" onSubmit={handleAdd}>
            <InvoiceFormSection label="Add entry">
              <InvoiceFieldRow cols={2}>
                <InvoiceField wide>
                  <FieldLabel>Party</FieldLabel>
                  <SearchSelect
                    value={partyId}
                    onChange={setPartyId}
                    options={partyOptions}
                    placeholder="Search sale or purchase party…"
                  />
                </InvoiceField>
              </InvoiceFieldRow>

              <InvoiceFieldRow cols={2}>
                <InvoiceField>
                  <FieldLabel>Product category</FieldLabel>
                  <SearchSelect
                    value={productCategoryId}
                    onChange={(value) => {
                      setProductCategoryId(value);
                      setProductId('');
                    }}
                    options={productCategoryOptions}
                    placeholder="Search category…"
                  />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Product</FieldLabel>
                  <SearchSelect
                    value={productId}
                    onChange={setProductId}
                    options={productOptions}
                    placeholder={productCategoryId ? 'Search product…' : 'Select category first'}
                    disabled={!productCategoryId}
                  />
                </InvoiceField>
              </InvoiceFieldRow>

              <InvoiceFieldRow cols={2}>
                <InvoiceField>
                  <FieldLabel>Quantity</FieldLabel>
                  <DecimalInput value={quantity} onChange={setQuantity} placeholder="Bags / qty" />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Amount</FieldLabel>
                  <AmountInput value={amount} onChange={setAmount} placeholder="0.00" />
                </InvoiceField>
              </InvoiceFieldRow>

              <InvoiceFieldRow cols={2}>
                <InvoiceField>
                  <FieldLabel>Jama / Naam</FieldLabel>
                  <SegmentedControl
                    ariaLabel="Jama or Naam"
                    value={direction}
                    onChange={setDirection}
                    options={[
                      { value: 'JAMA', label: 'Jama' },
                      { value: 'NAAM', label: 'Naam' },
                    ]}
                  />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Date</FieldLabel>
                  <TextInput type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
                </InvoiceField>
              </InvoiceFieldRow>

              <InvoiceFieldRow cols={2}>
                <InvoiceField wide>
                  <FieldLabel>Notes</FieldLabel>
                  <TextInput
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional notes"
                  />
                </InvoiceField>
              </InvoiceFieldRow>

              {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
            </InvoiceFormSection>

            <InvoiceAddRowAction type="submit" disabled={submitting}>
              {submitting ? 'Adding…' : 'Add'}
            </InvoiceAddRowAction>
          </form>

          <div className="voucher-batch-split-queue">
            <InvoiceFormSection label={`Current entries (${entries.length})`}>
              <InvoicePreviewGridShell
                isEmpty={entries.length === 0}
                empty={<p className="inv-preview-empty-msg">No entries yet — add one on the left</p>}
              >
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-surface2">
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-textMuted">
                      <th className="px-3 py-2.5">Date</th>
                      <th className="px-3 py-2.5">Party</th>
                      <th className="px-3 py-2.5">Product</th>
                      <th className="px-3 py-2.5 text-right">Quantity</th>
                      <th className="px-3 py-2.5 text-right">Amount</th>
                      <th className="px-3 py-2.5">Jama/Naam</th>
                      <th className="px-3 py-2.5">Notes</th>
                      {isAdmin ? <th className="px-3 py-2.5" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id} className="border-b border-border/70">
                        <td className="px-3 py-2 whitespace-nowrap">{formatDate(entry.date)}</td>
                        <td className="px-3 py-2">{entry.partyName}</td>
                        <td className="px-3 py-2">{gridCell(entry.productName)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{gridCell(entry.quantity)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-textPrimary">
                          {entry.amount != null ? formatLedgerAmount(entry.amount) : '—'}
                        </td>
                        <td className={`px-3 py-2 ${directionClass(entry.direction)}`}>{directionLabel(entry.direction)}</td>
                        <td className="px-3 py-2 text-textSecondary">{entry.notes ?? ''}</td>
                        {isAdmin ? (
                          <td className="px-3 py-2 text-right">
                            <SecondaryButton type="button" onClick={() => void handleSettle(entry)}>
                              Settle
                            </SecondaryButton>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </InvoicePreviewGridShell>
            </InvoiceFormSection>
          </div>
        </div>
      )}
      <PageCloseBar />
    </FormPageShell>
  );
}
