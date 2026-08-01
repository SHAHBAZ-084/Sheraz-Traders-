import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  InvoiceAddRowAction,
  InvoiceField,
  InvoiceFieldGroup,
  InvoiceFieldRow,
  InvoiceFieldStack,
  InvoiceFormFooter,
  InvoiceFormSection,
  InvoiceHeaderRow,
  InvoiceReadOnlyField,
  InvoiceToggleField,
} from '../../components/invoices/InvoiceFormLayout';
import {
  FieldLabel,
  PageShell,
  Panel,
  TextInput,
} from '../../components/ui/PageShell';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useMinimizableForm } from '../../hooks/useMinimizableForm';
import { api, Account, AccountCategory, Product, SystemPreferences } from '../../lib/api';
import { formatLedgerAmount } from '../../lib/format';
import { invoiceLoadErrorMessage, loadInvoiceFormBase } from '../../lib/invoiceFormLoad';
import { InvoicePreviewGridShell } from './InvoicePreviewGrid';
import {
  computePurchaseMaalInvoiceTotals,
  computePurchaseMaalRow,
  parseNum,
  PURCHASE_PARTY_CATEGORIES,
} from '../../lib/purchaseMaalCalculations';

type BoriThelaMode = 'BORI' | 'THELA';

type GridRow = {
  clientId: string;
  partyAccountId: number;
  partyName: string;
  jins: string;
  qism: string;
  boriOrThelaMode: BoriThelaMode;
  bagCount: number;
  bhartii: number;
  dharanCount: number;
  looseKg: number;
  totalWeightKg: number;
  ratePerMaund: number;
  amount: number;
  bardanaQty: number | null;
  bardanaRate: number | null;
  bardanaAmount: number | null;
  dammiChecked: boolean;
  dammiAmount: number;
  netCreditToParty: number;
};

type PurchaseMaalDraft = {
  predictedRef: string;
  gridRows: GridRow[];
  invoiceDate: string;
  productId: string;
  jins: string;
  qism: string;
  billNo: string;
  gariNo: string;
  tafseel: string;
  partyAccountId: string;
  boriThelaMode: BoriThelaMode;
  bagCount: string;
  bhartii: string;
  dharanCount: string;
  looseKg: string;
  ratePerMaund: string;
  rowBardanaQty: string;
  rowBardanaRate: string;
  dammiChecked: boolean;
  marketFeeEnabled: boolean;
  mazduriEnabled: boolean;
  lowerBoriThela: BoriThelaMode;
  lowerBardanaQty: string;
  lowerBardanaRate: string;
};

function todayInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function filterCategories(all: AccountCategory[], allowed: readonly string[]) {
  const set = new Set(allowed);
  return all.filter((c) => set.has(c.name));
}

function flatAccountOptions(
  categories: AccountCategory[],
  accounts: Account[],
  categoryNames: readonly string[],
) {
  const allowedIds = new Set(filterCategories(categories, categoryNames).map((c) => c.id));
  return accounts
    .filter((a) => allowedIds.has(a.categoryId))
    .map((a) => ({ value: String(a.id), label: a.name }));
}

function FlatAccountSelect({
  label,
  categoryNames,
  categories,
  accounts,
  value,
  onChange,
  placeholder = 'Search account…',
}: {
  label: string;
  categoryNames: readonly string[];
  categories: AccountCategory[];
  accounts: Account[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const options = flatAccountOptions(categories, accounts, categoryNames);
  return (
    <>
      <FieldLabel>{label}</FieldLabel>
      <SearchSelect value={value} onChange={onChange} options={options} placeholder={placeholder} />
    </>
  );
}

export function PurchaseMaalInvoicePage() {
  const navigate = useNavigate();
  const { restoredState, minimize } = useMinimizableForm<PurchaseMaalDraft>('purchase-maal');
  const keepRestoredPredictedRef = useRef(Boolean(restoredState?.predictedRef));
  const trapRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  useFocusTrap(trapRef, { initialFocusRef: dateRef });

  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [prefs, setPrefs] = useState<SystemPreferences | null>(null);
  const [predictedRef, setPredictedRef] = useState(() => restoredState?.predictedRef ?? '');
  const [gridRows, setGridRows] = useState<GridRow[]>(() => restoredState?.gridRows ?? []);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [invoiceDate, setInvoiceDate] = useState(() => restoredState?.invoiceDate ?? todayInputValue());
  const [productId, setProductId] = useState(() => restoredState?.productId ?? '');
  const [jins, setJins] = useState(() => restoredState?.jins ?? '');
  const [qism] = useState(() => restoredState?.qism ?? '');
  const [billNo, setBillNo] = useState(() => restoredState?.billNo ?? '');
  const [gariNo, setGariNo] = useState(() => restoredState?.gariNo ?? '');
  const [tafseel, setTafseel] = useState(() => restoredState?.tafseel ?? '');

  const [partyAccountId, setPartyAccountId] = useState(() => restoredState?.partyAccountId ?? '');
  const [boriThelaMode, setBoriThelaMode] = useState<BoriThelaMode>(() => restoredState?.boriThelaMode ?? 'BORI');
  const [bagCount, setBagCount] = useState(() => restoredState?.bagCount ?? '');
  const [bhartii, setBhartii] = useState(() => restoredState?.bhartii ?? '');
  const [dharanCount, setDharanCount] = useState(() => restoredState?.dharanCount ?? '');
  const [looseKg, setLooseKg] = useState(() => restoredState?.looseKg ?? '');
  const [ratePerMaund, setRatePerMaund] = useState(() => restoredState?.ratePerMaund ?? '');
  const [rowBardanaQty, setRowBardanaQty] = useState(() => restoredState?.rowBardanaQty ?? '');
  const [rowBardanaRate, setRowBardanaRate] = useState(() => restoredState?.rowBardanaRate ?? '');
  const [dammiChecked, setDammiChecked] = useState(() => restoredState?.dammiChecked ?? false);

  const [marketFeeEnabled, setMarketFeeEnabled] = useState(() => restoredState?.marketFeeEnabled ?? false);
  const [mazduriEnabled, setMazduriEnabled] = useState(() => restoredState?.mazduriEnabled ?? false);
  const [lowerBoriThela, setLowerBoriThela] = useState<BoriThelaMode>(() => restoredState?.lowerBoriThela ?? 'BORI');
  const [lowerBardanaQty, setLowerBardanaQty] = useState(() => restoredState?.lowerBardanaQty ?? '');
  const [lowerBardanaRate, setLowerBardanaRate] = useState(() => restoredState?.lowerBardanaRate ?? '');

  const productOptions = useMemo(
    () => products.map((p) => ({ value: String(p.id), label: p.name })),
    [products],
  );

  const selectedProduct = useMemo(
    () => products.find((p) => String(p.id) === productId) ?? null,
    [products, productId],
  );

  const maalKhataAccount = selectedProduct?.account ?? null;
  const maalKhataMissing = Boolean(productId && !maalKhataAccount?.id);

  const reload = useCallback(async () => {
    const base = await loadInvoiceFormBase({ includeProducts: true });
    setAccounts(base.accounts);
    setCategories(base.categories);
    setPrefs(base.prefs);
    setProducts(base.products ?? []);
    try {
      const refRow = await api.getNextPurchaseMaalReference();
      if (keepRestoredPredictedRef.current) {
        keepRestoredPredictedRef.current = false;
      } else {
        setPredictedRef(refRow.reference);
      }
    } catch {
      if (!keepRestoredPredictedRef.current) setPredictedRef('');
      keepRestoredPredictedRef.current = false;
    }
  }, []);

  useEffect(() => {
    reload().catch((err) => setError(invoiceLoadErrorMessage(err)));
  }, [reload]);

  const prefRates = useMemo(
    () => ({
      daamiPercent: prefs?.daamiPercent ?? 0,
      mazduriPercent: prefs?.mazduriPercent ?? 0,
      marketFeeRate: prefs?.marketFeeRate ?? 0,
    }),
    [prefs],
  );

  const entryPreview = useMemo(() => {
    const input = {
      bagCount: parseNum(bagCount),
      bhartii: parseNum(bhartii),
      dharanCount: parseNum(dharanCount),
      looseKg: parseNum(looseKg),
      ratePerMaund: parseNum(ratePerMaund),
      bardanaQty: rowBardanaQty.trim() ? parseNum(rowBardanaQty) : null,
      bardanaRate: rowBardanaRate.trim() ? parseNum(rowBardanaRate) : null,
      dammiChecked,
    };
    return computePurchaseMaalRow(input, prefRates);
  }, [bagCount, bhartii, dharanCount, looseKg, ratePerMaund, rowBardanaQty, rowBardanaRate, dammiChecked, prefRates]);

  const invoiceTotals = useMemo(
    () =>
      computePurchaseMaalInvoiceTotals(
        gridRows,
        prefRates,
        {
          marketFeeEnabled,
          mazduriEnabled,
          lowerBardanaQty: lowerBardanaQty.trim() ? parseNum(lowerBardanaQty) : null,
          lowerBardanaRate: lowerBardanaRate.trim() ? parseNum(lowerBardanaRate) : null,
        },
      ),
    [gridRows, prefRates, marketFeeEnabled, mazduriEnabled, lowerBardanaQty, lowerBardanaRate],
  );

  function onProductChange(id: string) {
    setProductId(id);
    const product = products.find((p) => String(p.id) === id);
    setJins(product?.name ?? '');
  }

  function addRow() {
    setError('');
    if (!partyAccountId) {
      setError('Select a purchase party before adding a row');
      return;
    }
    const bh = parseNum(bhartii);
    const rate = parseNum(ratePerMaund);
    if (!(bh > 0)) {
      setError('Bhartii must be greater than zero');
      return;
    }
    if (!(rate > 0)) {
      setError('Rate must be greater than zero');
      return;
    }
    if (!(entryPreview.amount > 0)) {
      setError('Row amount must be greater than zero');
      return;
    }

    const party = accounts.find((a) => String(a.id) === partyAccountId);
    const row: GridRow = {
      clientId: `${Date.now()}-${Math.random()}`,
      partyAccountId: Number(partyAccountId),
      partyName: party?.name ?? '',
      jins: jins.trim(),
      qism: qism.trim(),
      boriOrThelaMode: boriThelaMode,
      bagCount: parseNum(bagCount),
      bhartii: bh,
      dharanCount: parseNum(dharanCount),
      looseKg: parseNum(looseKg),
      totalWeightKg: entryPreview.totalWeightKg,
      ratePerMaund: rate,
      amount: entryPreview.amount,
      bardanaQty: rowBardanaQty.trim() ? parseNum(rowBardanaQty) : null,
      bardanaRate: rowBardanaRate.trim() ? parseNum(rowBardanaRate) : null,
      bardanaAmount: entryPreview.bardanaAmount,
      dammiChecked,
      dammiAmount: entryPreview.dammiAmount,
      netCreditToParty: entryPreview.netCreditToParty,
    };
    setGridRows((prev) => [...prev, row]);
    setBagCount('');
    setDharanCount('');
    setLooseKg('');
    setRatePerMaund('');
    setRowBardanaQty('');
    setRowBardanaRate('');
    setDammiChecked(false);
  }

  function removeRow(clientId: string) {
    setGridRows((prev) => prev.filter((r) => r.clientId !== clientId));
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (gridRows.length === 0) {
      setError('Add at least one row to the grid');
      return;
    }
    if (!productId) {
      setError('Select Jins (product) first');
      return;
    }
    if (maalKhataMissing) {
      setError('This product has no Maal Khata ledger — re-add the product or migrate it before posting');
      return;
    }
    if (invoiceTotals.lowerBardanaAmount != null && invoiceTotals.lowerBardanaAmount > 0 && !lowerBoriThela) {
      setError('Select Bori or Thela for lower-section bardana');
      return;
    }

    setSaving(true);
    try {
      const result = await api.createPurchaseMaalInvoice({
        invoiceDate,
        productId: Number(productId),
        billNo: billNo.trim() || undefined,
        gariNo: gariNo.trim() || undefined,
        jins: jins.trim() || undefined,
        qism: qism.trim() || undefined,
        tafseel: tafseel.trim() || undefined,
        marketFeeEnabled,
        mazduriEnabled,
        lowerBardanaMode:
          invoiceTotals.lowerBardanaAmount != null && invoiceTotals.lowerBardanaAmount > 0
            ? lowerBoriThela
            : null,
        lowerBardanaQty: lowerBardanaQty.trim() ? parseNum(lowerBardanaQty) : null,
        lowerBardanaRate: lowerBardanaRate.trim() ? parseNum(lowerBardanaRate) : null,
        lines: gridRows.map((row) => ({
          partyAccountId: row.partyAccountId,
          jins: row.jins || undefined,
          qism: row.qism || undefined,
          boriOrThelaMode: row.boriOrThelaMode,
          bagCount: row.bagCount,
          bhartii: row.bhartii,
          dharanCount: row.dharanCount,
          looseKg: row.looseKg,
          ratePerMaund: row.ratePerMaund,
          bardanaQty: row.bardanaQty,
          bardanaRate: row.bardanaRate,
          dammiChecked: row.dammiChecked,
        })),
      });
      setMessage(`Invoice ${result.reference} posted.`);
      setGridRows([]);
      setLowerBardanaQty('');
      setLowerBardanaRate('');
      setMarketFeeEnabled(false);
      setMazduriEnabled(false);
      const refRow = await api.getNextPurchaseMaalReference();
      setPredictedRef(refRow.reference);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell centerTitle invoiceTitleBand title="Purchase to Maal" className="app-page--purchase-maal">
      <Panel className="inv-form-panel mx-auto w-full overflow-visible bg-white">
        <div ref={trapRef} className="overflow-visible">
          <form onSubmit={onSave} className="space-y-0">
            <InvoiceFormSection>
              <InvoiceHeaderRow>
                <InvoiceField>
                  <FieldLabel>Date</FieldLabel>
                  <TextInput ref={dateRef} type="date" required value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Invoice #</FieldLabel>
                  <div className="app-input-static app-input-static--emphasis tabular-nums">{predictedRef || '…'}</div>
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Jins</FieldLabel>
                  <SearchSelect value={productId} onChange={onProductChange} options={productOptions} placeholder="Select product…" />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Bill #</FieldLabel>
                  <TextInput value={billNo} onChange={(e) => setBillNo(e.target.value)} />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Gari #</FieldLabel>
                  <TextInput value={gariNo} onChange={(e) => setGariNo(e.target.value)} />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Tafseel</FieldLabel>
                  <TextInput value={tafseel} onChange={(e) => setTafseel(e.target.value)} />
                </InvoiceField>
              </InvoiceHeaderRow>
            </InvoiceFormSection>

            <InvoiceFormSection label="Add dheri row">
              <InvoiceFieldStack>
                <InvoiceFieldGroup label="Identity">
                  <InvoiceFieldRow cols={6}>
                    <InvoiceField wide>
                      <FlatAccountSelect
                        label="Party"
                        categoryNames={PURCHASE_PARTY_CATEGORIES}
                        categories={categories}
                        accounts={accounts}
                        value={partyAccountId}
                        onChange={setPartyAccountId}
                        placeholder="Search party…"
                      />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>Bori / Thela</FieldLabel>
                      <SegmentedControl
                        value={boriThelaMode}
                        onChange={(v) => setBoriThelaMode(v as BoriThelaMode)}
                        options={[
                          { value: 'BORI', label: 'Bori' },
                          { value: 'THELA', label: 'Thela' },
                        ]}
                      />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>{boriThelaMode === 'BORI' ? 'Bori count' : 'Thela count'}</FieldLabel>
                      <TextInput value={bagCount} onChange={(e) => setBagCount(e.target.value)} inputMode="decimal" />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>Dharan</FieldLabel>
                      <TextInput value={dharanCount} onChange={(e) => setDharanCount(e.target.value)} inputMode="decimal" />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>Kilo</FieldLabel>
                      <TextInput value={looseKg} onChange={(e) => setLooseKg(e.target.value)} inputMode="decimal" />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>Bhartii</FieldLabel>
                      <TextInput value={bhartii} onChange={(e) => setBhartii(e.target.value)} inputMode="decimal" />
                    </InvoiceField>
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>

                <InvoiceFieldGroup label="Pricing">
                  <InvoiceFieldRow cols={6}>
                    <InvoiceField>
                      <FieldLabel>Rate / Maund</FieldLabel>
                      <TextInput value={ratePerMaund} onChange={(e) => setRatePerMaund(e.target.value)} inputMode="decimal" />
                    </InvoiceField>
                    <InvoiceReadOnlyField label="Amount" value={entryPreview.amount} />
                    <InvoiceReadOnlyField label="Net to party" value={entryPreview.netCreditToParty} />
                    <InvoiceField>
                      <FieldLabel>Bardana qty</FieldLabel>
                      <TextInput value={rowBardanaQty} onChange={(e) => setRowBardanaQty(e.target.value)} inputMode="decimal" />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>Bardana rate</FieldLabel>
                      <TextInput value={rowBardanaRate} onChange={(e) => setRowBardanaRate(e.target.value)} inputMode="decimal" />
                    </InvoiceField>
                    <InvoiceToggleField
                      label={`Dammi (${prefRates.daamiPercent}%)`}
                      checked={dammiChecked}
                      onChange={setDammiChecked}
                    />
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>

                <InvoiceAddRowAction onClick={addRow} />
              </InvoiceFieldStack>
            </InvoiceFormSection>

            <InvoiceFormSection label="Preview grid">
              <InvoicePreviewGridShell isEmpty={gridRows.length === 0}>
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-surface2">
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-textMuted">
                      <th className="px-3 py-2.5">Party</th>
                      <th className="px-3 py-2.5">Dheri</th>
                      <th className="px-3 py-2.5 text-right">Amount</th>
                      <th className="px-3 py-2.5 text-right">Bardana</th>
                      <th className="px-3 py-2.5 text-right">Dammi</th>
                      <th className="px-3 py-2.5 text-right">Net</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {gridRows.map((row) => (
                      <tr key={row.clientId} className="border-b border-border/40">
                        <td className="px-3 py-2">{row.partyName}</td>
                        <td className="px-3 py-2 tabular-nums">{row.bagCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatLedgerAmount(row.amount)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.bardanaAmount != null ? formatLedgerAmount(row.bardanaAmount) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.dammiChecked ? formatLedgerAmount(row.dammiAmount) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatLedgerAmount(row.netCreditToParty)}</td>
                        <td className="px-3 py-2 text-right">
                          <button type="button" className="text-xs text-danger hover:underline" onClick={() => removeRow(row.clientId)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </InvoicePreviewGridShell>
            </InvoiceFormSection>

            <InvoiceFormSection label="Settlement (Maal Khata debit)">
              <InvoiceFieldStack>
                <InvoiceFieldGroup>
                  <InvoiceFieldRow cols={5}>
                    <InvoiceField wide>
                      <FieldLabel>Debit account</FieldLabel>
                      {!productId ? (
                        <div className="app-input-static text-textMuted">Select Jins first</div>
                      ) : maalKhataMissing ? (
                        <div className="app-input-static border-danger text-danger">
                          No Maal Khata ledger linked to this product
                        </div>
                      ) : (
                        <div className="app-input-static font-medium text-textPrimary">
                          {maalKhataAccount?.name ?? '—'}
                          {maalKhataAccount?.code ? (
                            <span className="ml-2 font-normal text-textMuted">({maalKhataAccount.code})</span>
                          ) : null}
                        </div>
                      )}
                    </InvoiceField>
                    <InvoiceReadOnlyField label="Goods total" value={invoiceTotals.totalGoodsAmount} />
                    <InvoiceReadOnlyField label="Dammi total" value={invoiceTotals.totalDammiAmount} />
                    <InvoiceToggleField
                      label="Apply Market Fee"
                      checked={marketFeeEnabled}
                      onChange={setMarketFeeEnabled}
                    />
                    <InvoiceToggleField
                      label="Apply Mazduri"
                      checked={mazduriEnabled}
                      onChange={setMazduriEnabled}
                    />
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>

                <InvoiceFieldGroup>
                  <InvoiceFieldRow cols={5}>
                    <InvoiceReadOnlyField
                      label={`Market fee (${invoiceTotals.totalCalculatedBags.toFixed(2)} bags)`}
                      value={invoiceTotals.marketFeeAmount}
                    />
                    <InvoiceReadOnlyField
                      label={`Mazduri (${prefRates.mazduriPercent}%)`}
                      value={invoiceTotals.mazduriAmount}
                    />
                    <InvoiceField>
                      <FieldLabel>Lower bardana</FieldLabel>
                      <SegmentedControl
                        value={lowerBoriThela}
                        onChange={(v) => setLowerBoriThela(v as BoriThelaMode)}
                        options={[
                          { value: 'BORI', label: 'Bori' },
                          { value: 'THELA', label: 'Thela' },
                        ]}
                      />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>Lower bardana qty</FieldLabel>
                      <TextInput value={lowerBardanaQty} onChange={(e) => setLowerBardanaQty(e.target.value)} inputMode="decimal" />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>Lower bardana rate</FieldLabel>
                      <TextInput value={lowerBardanaRate} onChange={(e) => setLowerBardanaRate(e.target.value)} inputMode="decimal" />
                    </InvoiceField>
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>
              </InvoiceFieldStack>
              <InvoiceFormFooter
                totalLabel="Maal Khata total debit"
                totalValue={invoiceTotals.totalDebitAmount}
                error={error}
                message={message}
                saving={saving}
                onClose={() => navigate('/')}
                onMinimize={() =>
                  minimize(
                    {
                      predictedRef,
                      gridRows,
                      invoiceDate,
                      productId,
                      jins,
                      qism,
                      billNo,
                      gariNo,
                      tafseel,
                      partyAccountId,
                      boriThelaMode,
                      bagCount,
                      bhartii,
                      dharanCount,
                      looseKg,
                      ratePerMaund,
                      rowBardanaQty,
                      rowBardanaRate,
                      dammiChecked,
                      marketFeeEnabled,
                      mazduriEnabled,
                      lowerBoriThela,
                      lowerBardanaQty,
                      lowerBardanaRate,
                    },
                    `Purchase Maal — ${predictedRef || 'draft'}`,
                  )
                }
              />
            </InvoiceFormSection>
          </form>
        </div>
      </Panel>
    </PageShell>
  );
}
