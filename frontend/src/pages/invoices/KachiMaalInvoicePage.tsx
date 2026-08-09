import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FormPageShell,
  InvoiceAddRowAction,
  InvoiceField,
  InvoiceFieldGroup,
  InvoiceFieldRow,
  InvoiceFieldStack,
  InvoiceFormFooter,
  InvoiceFormSection,
  InvoiceHeaderRow,
  InvoiceReadOnlyField,
} from '../../components/invoices/InvoiceFormLayout';
import { InvoicePreviewGridShell } from './InvoicePreviewGrid';
import { FieldLabel, TextInput } from '../../components/ui/PageShell';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { useMinimizableForm } from '../../hooks/useMinimizableForm';
import {
  Account,
  AccountCategory,
  api,
  Product,
  SystemPreferences,
} from '../../lib/api';
import { formatLedgerAmount } from '../../lib/format';
import {
  computeKachiMaalInvoiceTotals,
  computeKachiMaalRow,
  DEBIT_ACCOUNT_CATEGORIES,
  parseNum,
} from '../../lib/kachiMaalCalculations';
import { PARTY_ACCOUNT_CATEGORIES } from '../../lib/partyAccounts';
import { invoiceLoadErrorMessage, loadInvoiceFormBase } from '../../lib/invoiceFormLoad';

type GridRow = {
  clientId: string;
  partyAccountId: number;
  partyName: string;
  jins: string;
  qism: string;
  bagCount: number;
  bhartii: number;
  dharanCount: number;
  looseKg: number;
  totalWeightKg: number;
  ratePerMaund: number;
  amount: number;
  netCreditToParty: number;
  totalMazduriPreview: number;
};

type KachiMaalDraft = {
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
  bagCount: string;
  bhartii: string;
  dharanCount: string;
  looseKg: string;
  ratePerMaund: string;
  debitAccountId: string;
  miscAmount: string;
};

function todayInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function filterCategories(all: AccountCategory[], allowed: readonly string[]) {
  const safeAll = Array.isArray(all) ? all : [];
  const set = new Set(allowed);
  return safeAll.filter((c) => set.has(c.name));
}

function flatAccountOptions(
  categories: AccountCategory[],
  accounts: Account[],
  categoryNames: readonly string[],
) {
  const safeCats = Array.isArray(categories) ? categories : [];
  const safeAccs = Array.isArray(accounts) ? accounts : [];
  const allowedIds = new Set(filterCategories(safeCats, categoryNames).map((c) => c.id));
  return safeAccs
    .filter((a) => allowedIds.has(a.categoryId))
    .map((a) => ({ value: String(a.id), label: a.name }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

export function KachiMaalInvoicePage() {
  const navigate = useNavigate();
  const { restoredState, minimize } = useMinimizableForm<KachiMaalDraft>('kachi-maal');
  const keepRestoredPredictedRef = useRef(Boolean(restoredState?.predictedRef));

  const [predictedRef, setPredictedRef] = useState(() => restoredState?.predictedRef ?? '…');
  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [prefs, setPrefs] = useState<SystemPreferences | null>(null);
  const [products, setProducts] = useState<Product[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [gridRows, setGridRows] = useState<GridRow[]>(() => restoredState?.gridRows ?? []);

  const [invoiceDate, setInvoiceDate] = useState(() => restoredState?.invoiceDate ?? todayInputValue());
  const [productId, setProductId] = useState(() => restoredState?.productId ?? '');
  const [jins, setJins] = useState(() => restoredState?.jins ?? '');
  const [qism, setQism] = useState(() => restoredState?.qism ?? '');
  const [billNo, setBillNo] = useState(() => restoredState?.billNo ?? '');
  const [gariNo, setGariNo] = useState(() => restoredState?.gariNo ?? '');
  const [tafseel, setTafseel] = useState(() => restoredState?.tafseel ?? '');

  const [partyAccountId, setPartyAccountId] = useState(() => restoredState?.partyAccountId ?? '');
  const [bagCount, setBagCount] = useState(() => restoredState?.bagCount ?? '');
  const [bhartii, setBhartii] = useState(() => restoredState?.bhartii ?? '');
  const [dharanCount, setDharanCount] = useState(() => restoredState?.dharanCount ?? '');
  const [looseKg, setLooseKg] = useState(() => restoredState?.looseKg ?? '');
  const [ratePerMaund, setRatePerMaund] = useState(() => restoredState?.ratePerMaund ?? '');

  const [debitAccountId, setDebitAccountId] = useState(() => restoredState?.debitAccountId ?? '');
  const [miscAmount, setMiscAmount] = useState(() => restoredState?.miscAmount ?? '');

  const reload = useCallback(async () => {
    const base = await loadInvoiceFormBase({ includeProducts: true });
    setAccounts(base.accounts);
    setCategories(base.categories);
    setPrefs(base.prefs);
    setProducts(base.products ?? []);
    try {
      const refRow = await api.getNextKachiMaalReference();
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
    if (restoredState) {
      if (restoredState.invoiceDate) setInvoiceDate(restoredState.invoiceDate);
      if (restoredState.billNo !== undefined) setBillNo(restoredState.billNo);
      if (restoredState.gariNo !== undefined) setGariNo(restoredState.gariNo);
      if (restoredState.productId) setProductId(restoredState.productId);
      if (restoredState.jins) setJins(restoredState.jins);
      if (restoredState.qism) setQism(restoredState.qism);
      if (restoredState.tafseel) setTafseel(restoredState.tafseel);
      if (restoredState.debitAccountId) setDebitAccountId(restoredState.debitAccountId);
      if (restoredState.gridRows) setGridRows(restoredState.gridRows);
      if (restoredState.partyAccountId) setPartyAccountId(restoredState.partyAccountId);
      if (restoredState.bagCount) setBagCount(restoredState.bagCount);
      if (restoredState.dharanCount) setDharanCount(restoredState.dharanCount);
      if (restoredState.looseKg) setLooseKg(restoredState.looseKg);
      if (restoredState.bhartii) setBhartii(restoredState.bhartii);
      if (restoredState.ratePerMaund) setRatePerMaund(restoredState.ratePerMaund);
      if (restoredState.miscAmount) setMiscAmount(restoredState.miscAmount);
    }
  }, [restoredState]);

  useEffect(() => {
    reload().catch((err) => setError(invoiceLoadErrorMessage(err)));
  }, [reload]);

  const prefRates = useMemo(
    () => ({
      daamiPercent: prefs?.daamiPercent ?? 0,
      paleDariPercent: prefs?.paleDariPercent ?? 0,
      brokeryPercent: prefs?.brokeryPercent ?? 0,
      marketFeeRate: prefs?.marketFeeRate ?? 0,
      marketFeeEnabled: prefs?.marketFeeEnabled ?? true,
    }),
    [prefs],
  );

  function handleProductSelect(idStr: string) {
    setProductId(idStr);
    const p = products.find((x) => String(x.id) === idStr);
    if (p) {
      setJins(p.name);
    }
  }

  const entryPreview = useMemo(() => {
    return computeKachiMaalRow(
      {
        bagCount: parseNum(bagCount),
        bhartii: parseNum(bhartii),
        dharanCount: parseNum(dharanCount),
        looseKg: parseNum(looseKg),
        ratePerMaund: parseNum(ratePerMaund),
      },
      prefRates,
    );
  }, [bagCount, bhartii, dharanCount, looseKg, ratePerMaund, prefRates]);

  const invoiceTotals = useMemo(() => {
    return computeKachiMaalInvoiceTotals(
      gridRows,
      prefRates,
      parseNum(miscAmount),
    );
  }, [gridRows, prefRates, miscAmount]);

  const partyOptions = useMemo(
    () => flatAccountOptions(categories, accounts, PARTY_ACCOUNT_CATEGORIES),
    [categories, accounts],
  );
  const debitAccountOptions = useMemo(
    () => flatAccountOptions(categories, accounts, DEBIT_ACCOUNT_CATEGORIES),
    [categories, accounts],
  );
  const productOptions = useMemo(
    () => products.map((p) => ({ value: String(p.id), label: p.name })),
    [products],
  );

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
      bagCount: parseNum(bagCount),
      bhartii: bh,
      dharanCount: parseNum(dharanCount),
      looseKg: parseNum(looseKg),
      totalWeightKg: entryPreview.totalWeightKg,
      ratePerMaund: rate,
      amount: entryPreview.amount,
      netCreditToParty: entryPreview.netCreditToParty,
      totalMazduriPreview: entryPreview.totalMazduriPreview,
    };
    setGridRows((prev) => [...prev, row]);
    setBagCount('');
    setDharanCount('');
    setLooseKg('');
    setRatePerMaund('');
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

    setSaving(true);
    try {
      const result = await api.createKachiMaalInvoice({
        invoiceDate,
        billNo: billNo.trim() || undefined,
        gariNo: gariNo.trim() || undefined,
        jins: jins.trim() || undefined,
        qism: qism.trim() || undefined,
        tafseel: tafseel.trim() || undefined,
        debitAccountId: Number(debitAccountId),
        miscAmount: parseNum(miscAmount),
        lines: gridRows.map((row) => ({
          partyAccountId: row.partyAccountId,
          jins: row.jins || undefined,
          qism: row.qism || undefined,
          bagCount: row.bagCount,
          bhartii: row.bhartii,
          dharanCount: row.dharanCount,
          looseKg: row.looseKg,
          ratePerMaund: row.ratePerMaund,
        })),
      });
      setMessage(`Invoice ${result.reference} posted with ${result.vouchers?.length ?? 0} vouchers.`);
      setGridRows([]);
      setMiscAmount('');
      const refRow = await api.getNextKachiMaalReference();
      setPredictedRef(refRow.reference);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormPageShell title="Kachi Maal Invoice">
      <form onSubmit={onSave}>
        <div className="inv-split">
          <div className="inv-split-form">
            <InvoiceFormSection label="Header">
              <InvoiceHeaderRow>
                <InvoiceField>
                  <FieldLabel>Invoice #</FieldLabel>
                  <TextInput value={predictedRef} readOnly />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Date</FieldLabel>
                  <TextInput
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Bill #</FieldLabel>
                  <TextInput value={billNo} onChange={(e) => setBillNo(e.target.value)} />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Gari #</FieldLabel>
                  <TextInput value={gariNo} onChange={(e) => setGariNo(e.target.value)} />
                </InvoiceField>
              </InvoiceHeaderRow>

              <InvoiceHeaderRow>
                <InvoiceField wide>
                  <FieldLabel>Item (Jins)</FieldLabel>
                  <SearchSelect
                    options={productOptions}
                    value={productId}
                    onChange={handleProductSelect}
                    placeholder="Select product (optional)…"
                  />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Jins (free text)</FieldLabel>
                  <TextInput value={jins} onChange={(e) => setJins(e.target.value)} />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Qism / Variety</FieldLabel>
                  <TextInput value={qism} onChange={(e) => setQism(e.target.value)} />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>Tafseel</FieldLabel>
                  <TextInput value={tafseel} onChange={(e) => setTafseel(e.target.value)} />
                </InvoiceField>
              </InvoiceHeaderRow>
            </InvoiceFormSection>

            <InvoiceFormSection label="Add dheri row">
              <InvoiceFieldStack>
                <InvoiceFieldGroup label="Identity & bags">
                  <InvoiceFieldRow cols={5}>
                    <InvoiceField wide>
                      <FieldLabel>Party</FieldLabel>
                      <SearchSelect
                        options={partyOptions}
                        value={partyAccountId}
                        onChange={setPartyAccountId}
                        placeholder="Search party…"
                      />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>Bags count</FieldLabel>
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
                  <InvoiceFieldRow cols={3}>
                    <InvoiceField>
                      <FieldLabel>Rate / Maund</FieldLabel>
                      <TextInput value={ratePerMaund} onChange={(e) => setRatePerMaund(e.target.value)} inputMode="decimal" />
                    </InvoiceField>
                    <InvoiceReadOnlyField label="Amount" value={entryPreview.amount} />
                    <InvoiceReadOnlyField label="Net to party" value={entryPreview.netCreditToParty} />
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>
              </InvoiceFieldStack>
            </InvoiceFormSection>

            <InvoiceAddRowAction onClick={addRow} />
            {error ? <p className="text-sm text-danger">{error}</p> : null}
          </div>

          <div className="inv-split-preview">
            <InvoiceFormSection label="Preview grid">
              <InvoicePreviewGridShell isEmpty={gridRows.length === 0}>
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-surface2">
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-textMuted">
                      <th className="px-3 py-2.5">Party</th>
                      <th className="px-3 py-2.5">Dheri</th>
                      <th className="px-3 py-2.5">Variety</th>
                      <th className="px-3 py-2.5 text-right">Weight</th>
                      <th className="px-3 py-2.5 text-right">Rate</th>
                      <th className="px-3 py-2.5 text-right">Amount</th>
                      <th className="px-3 py-2.5 text-right">Net</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {gridRows.map((row) => (
                      <tr key={row.clientId} className="border-b border-border/50">
                        <td className="px-3 py-2">{row.partyName}</td>
                        <td className="px-3 py-2 tabular-nums">{row.bagCount}</td>
                        <td className="px-3 py-2">{row.qism || row.jins || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatLedgerAmount(row.totalWeightKg)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatLedgerAmount(row.ratePerMaund)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatLedgerAmount(row.amount)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatLedgerAmount(row.netCreditToParty)}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            className="text-xs text-danger hover:underline"
                            onClick={() => removeRow(row.clientId)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </InvoicePreviewGridShell>
            </InvoiceFormSection>

            <InvoiceFormSection label="Settlement (debit side)">
              <InvoiceFieldStack>
                <InvoiceFieldGroup label="Debit account & totals">
                  <InvoiceFieldRow cols={6}>
                    <InvoiceField wide>
                      <FieldLabel>Debit account</FieldLabel>
                      <SearchSelect
                        options={debitAccountOptions}
                        value={debitAccountId}
                        onChange={setDebitAccountId}
                        placeholder="Search account…"
                      />
                    </InvoiceField>
                    <InvoiceReadOnlyField label="Goods total" value={invoiceTotals.totalGoodsAmount} />
                    <InvoiceReadOnlyField label={`Pale Dari (${prefRates.paleDariPercent}%)`} value={invoiceTotals.totalPaleDari} />
                    <InvoiceReadOnlyField label={`Brokery (${prefRates.brokeryPercent}%)`} value={invoiceTotals.totalBrokery} />
                    <InvoiceField>
                      <div className="mb-1 flex items-center justify-between gap-1">
                        <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-semibold text-textPrimary">
                          <input
                            type="checkbox"
                            checked={prefs?.marketFeeEnabled ?? true}
                            onChange={async (e) => {
                              const checked = e.target.checked;
                              setPrefs((prev) => (prev ? { ...prev, marketFeeEnabled: checked } : prev));
                              try {
                                await api.updateSystemPreferences({ marketFeeEnabled: checked });
                              } catch (err) {
                                console.error('Failed to update market fee preference', err);
                              }
                            }}
                            className="h-3.5 w-3.5 cursor-pointer rounded border-border text-financial"
                          />
                          <span>Market fee</span>
                        </label>
                      </div>
                      <TextInput
                        value={formatLedgerAmount(invoiceTotals.marketFeeAmount)}
                        readOnly
                        disabled={!(prefs?.marketFeeEnabled ?? true)}
                      />
                    </InvoiceField>
                    <InvoiceReadOnlyField label={`Daami (${prefRates.daamiPercent}%)`} value={invoiceTotals.profitAmount} />
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>

                <InvoiceFieldGroup label="Misc">
                  <InvoiceFieldRow cols={2}>
                    <InvoiceField>
                      <FieldLabel>Misc (optional)</FieldLabel>
                      <TextInput value={miscAmount} onChange={(e) => setMiscAmount(e.target.value)} inputMode="decimal" />
                    </InvoiceField>
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>
              </InvoiceFieldStack>
            </InvoiceFormSection>

            <InvoiceFormFooter
              totalLabel="Total debit"
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
                    bagCount,
                    bhartii,
                    dharanCount,
                    looseKg,
                    ratePerMaund,
                    debitAccountId,
                    miscAmount,
                  },
                  `Ref ${predictedRef || 'Draft'} (${gridRows.length} rows)`,
                )
              }
            />
          </div>
        </div>
      </form>
    </FormPageShell>
  );
}
