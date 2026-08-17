import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { DecimalInput } from '../../components/ui/DecimalInput';
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
  formatWeightMaundKg,
  parseNum,
} from '../../lib/kachiMaalCalculations';
import {
  flatPartyAccountOptions,
  partyAccountOptionsForPrimaryCategory,
  primaryPartyCategoryIdForAccount,
  primaryPartyCategorySelectOptions,
} from '../../lib/partyAccounts';
import { invoiceLoadErrorMessage, loadInvoiceFormBase } from '../../lib/invoiceFormLoad';
import { useAuth } from '../../contexts/AuthContext';
import { kachiPercentUrduLabel, kachiUrduLabel } from '../../lib/kachiUrduLabels';

type GridRow = {
  clientId: string;
  partyAccountId: number;
  partyName: string;
  jins: string;
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
  billNo: string;
  gariNo: string;
  tafseel: string;
  partyAccountId: string;
  bagCount: string;
  bhartii: string;
  dharanCount: string;
  looseKg: string;
  ratePerMaund: string;
  debitCategoryId: string;
  debitAccountId: string;
  miscAmount: string;
};

function todayInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function KachiMaalInvoicePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pendingIdParam = searchParams.get('pendingId');
  const pendingId = pendingIdParam ? Number(pendingIdParam) : null;
  const isEditingPending = pendingId != null && Number.isFinite(pendingId) && pendingId > 0;
  const { restoredState, minimize } = useMinimizableForm<KachiMaalDraft>('kachi-maal');
  const keepRestoredPredictedRef = useRef(Boolean(restoredState?.predictedRef));

  const [predictedRef, setPredictedRef] = useState(() => restoredState?.predictedRef ?? '…');
  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [prefs, setPrefs] = useState<SystemPreferences | null>(null);
  const [products, setProducts] = useState<Product[]>([]);

  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [gridRows, setGridRows] = useState<GridRow[]>(() => restoredState?.gridRows ?? []);

  const [invoiceDate, setInvoiceDate] = useState(() => restoredState?.invoiceDate ?? todayInputValue());
  const [productId, setProductId] = useState(() => restoredState?.productId ?? '');
  const [jins, setJins] = useState(() => restoredState?.jins ?? '');
  const [billNo, setBillNo] = useState(() => restoredState?.billNo ?? '');
  const [gariNo, setGariNo] = useState(() => restoredState?.gariNo ?? '');
  const [tafseel, setTafseel] = useState(() => restoredState?.tafseel ?? '');

  const [partyAccountId, setPartyAccountId] = useState(() => restoredState?.partyAccountId ?? '');
  const [bagCount, setBagCount] = useState(() => restoredState?.bagCount ?? '');
  const [bhartii, setBhartii] = useState(() => restoredState?.bhartii ?? '');
  const [dharanCount, setDharanCount] = useState(() => restoredState?.dharanCount ?? '');
  const [looseKg, setLooseKg] = useState(() => restoredState?.looseKg ?? '');
  const [ratePerMaund, setRatePerMaund] = useState(() => restoredState?.ratePerMaund ?? '');

  const [debitCategoryId, setDebitCategoryId] = useState(() => restoredState?.debitCategoryId ?? '');
  const [debitAccountId, setDebitAccountId] = useState(() => restoredState?.debitAccountId ?? '');
  const [miscAmount, setMiscAmount] = useState(() => restoredState?.miscAmount ?? '');

  const reload = useCallback(async () => {
    const base = await loadInvoiceFormBase({ includeProducts: true });
    setAccounts(base.accounts);
    setCategories(base.categories);
    setPrefs(base.prefs);
    setProducts(base.products ?? []);
    setError('');
    if (isEditingPending) return;
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
  }, [isEditingPending]);

  useEffect(() => {
    if (restoredState) {
      if (restoredState.invoiceDate) setInvoiceDate(restoredState.invoiceDate);
      if (restoredState.billNo !== undefined) setBillNo(restoredState.billNo);
      if (restoredState.gariNo !== undefined) setGariNo(restoredState.gariNo);
      if (restoredState.productId) setProductId(restoredState.productId);
      if (restoredState.jins) setJins(restoredState.jins);
      if (restoredState.tafseel) setTafseel(restoredState.tafseel);
      if (restoredState.debitCategoryId) setDebitCategoryId(restoredState.debitCategoryId);
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
    if (!user) return;
    let cancelled = false;
    reload()
      .catch((err) => {
        if (cancelled) return;
        const msg = invoiceLoadErrorMessage(err);
        if (msg === 'Not authenticated') return;
        setError(msg);
      });
    return () => {
      cancelled = true;
    };
  }, [reload, user]);

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
        setGariNo(inv.gariNo ?? '');
        setJins(inv.jins ?? '');
        setTafseel(inv.tafseel ?? '');
        if (inv.debitAccountId != null) setDebitAccountId(String(inv.debitAccountId));
        if (inv.miscAmount != null) setMiscAmount(String(inv.miscAmount));
        setGridRows(
          (inv.kachiMaalLines ?? []).map((line, index) => {
            const bagCount = Number(line.bagCount);
            const bhartii = Number(line.bhartii);
            const dharanCount = Number(line.dharanCount);
            const looseKg = Number(line.looseKg);
            const ratePerMaund = Number(line.ratePerMaund);
            const amount = Number(line.amount);
            const totalWeightKg = Number(line.totalWeightKg);
            const netCreditToParty = Number(line.netCreditToParty);
            return {
              clientId: `pending-${line.id ?? index}`,
              partyAccountId: line.partyAccountId ?? line.partyAccount?.id ?? 0,
              partyName: line.partyAccount?.name ?? '',
              jins: line.jins ?? '',
              bagCount,
              bhartii,
              dharanCount,
              looseKg,
              totalWeightKg,
              ratePerMaund,
              amount,
              netCreditToParty,
              totalMazduriPreview: 0,
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
    setJins(p?.name ?? '');
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
    () => flatPartyAccountOptions(categories, accounts),
    [categories, accounts],
  );
  const debitCategoryOptions = useMemo(
    () => primaryPartyCategorySelectOptions(categories),
    [categories],
  );
  const debitAccountOptions = useMemo(
    () => partyAccountOptionsForPrimaryCategory(categories, accounts, debitCategoryId),
    [categories, accounts, debitCategoryId],
  );
  const productOptions = useMemo(
    () => products.map((p) => ({ value: String(p.id), label: p.name })),
    [products],
  );

  useEffect(() => {
    if (!debitAccountId || debitCategoryId || accounts.length === 0 || categories.length === 0) return;
    const derived = primaryPartyCategoryIdForAccount(categories, accounts, debitAccountId);
    if (derived) setDebitCategoryId(derived);
  }, [accounts, categories, debitAccountId, debitCategoryId]);

  useEffect(() => {
    if (!debitCategoryId || categories.length === 0) return;
    const valid = debitCategoryOptions.some((o) => o.value === debitCategoryId);
    if (!valid) {
      setDebitCategoryId('');
      setDebitAccountId('');
    }
  }, [debitCategoryId, categories, debitCategoryOptions]);

  useEffect(() => {
    if (!debitCategoryId || !debitAccountId) return;
    const allowed = debitAccountOptions.some((o) => o.value === debitAccountId);
    if (!allowed) setDebitAccountId('');
  }, [debitCategoryId, debitAccountId, debitAccountOptions]);

  function onDebitCategoryChange(nextCategoryId: string) {
    setDebitCategoryId(nextCategoryId);
    setDebitAccountId('');
  }

  function addRow() {
    setError('');
    if (!productId || !jins.trim()) {
      setError('Select a product before adding a row');
      return;
    }
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
    if (!debitCategoryId || !debitAccountId) {
      setError('Select a Sale Party or Purchase Party debit account');
      return;
    }

    setSaving(true);
    try {
      if (isEditingPending && pendingId != null) {
        await api.updatePendingInvoice(pendingId, {
          invoiceDate,
          billNo: billNo.trim() || undefined,
          gariNo: gariNo.trim() || undefined,
          jins: jins.trim() || undefined,
          tafseel: tafseel.trim() || undefined,
          debitAccountId: Number(debitAccountId),
          miscAmount: parseNum(miscAmount),
          lines: gridRows.map((row) => ({
            partyAccountId: row.partyAccountId,
            jins: row.jins || undefined,
            bagCount: row.bagCount,
            bhartii: row.bhartii,
            dharanCount: row.dharanCount,
            looseKg: row.looseKg,
            ratePerMaund: row.ratePerMaund,
          })),
        });
        setMessage('Pending kachi maal invoice updated.');
        navigate('/system/approvals');
        return;
      }
      const result = await api.createKachiMaalInvoice({
        invoiceDate,
        billNo: billNo.trim() || undefined,
        gariNo: gariNo.trim() || undefined,
        jins: jins.trim() || undefined,
        tafseel: tafseel.trim() || undefined,
        debitAccountId: Number(debitAccountId),
        miscAmount: parseNum(miscAmount),
        lines: gridRows.map((row) => ({
          partyAccountId: row.partyAccountId,
          jins: row.jins || undefined,
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
    <FormPageShell
      title={isEditingPending ? 'Edit Pending Kachi Maal Invoice' : 'Kachi Maal Invoice'}
      panelClassName="inv-km-invoice-panel"
    >
      <form onSubmit={onSave}>
        <div className="inv-km-invoice-form">
            <InvoiceFormSection label="Header">
              <InvoiceHeaderRow>
                <InvoiceField>
                  <FieldLabel>{kachiUrduLabel('invoiceNo')}</FieldLabel>
                  <TextInput value={predictedRef} readOnly />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>{kachiUrduLabel('date')}</FieldLabel>
                  <TextInput
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>{kachiUrduLabel('billNo')}</FieldLabel>
                  <TextInput value={billNo} onChange={(e) => setBillNo(e.target.value)} />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>{kachiUrduLabel('gariNo')}</FieldLabel>
                  <TextInput value={gariNo} onChange={(e) => setGariNo(e.target.value)} />
                </InvoiceField>
              </InvoiceHeaderRow>

              <InvoiceFieldRow cols={2}>
                <InvoiceField wide>
                  <FieldLabel>Product</FieldLabel>
                  <SearchSelect
                    options={productOptions}
                    value={productId}
                    onChange={handleProductSelect}
                    placeholder="Select product…"
                  />
                </InvoiceField>
                <InvoiceField>
                  <FieldLabel>{kachiUrduLabel('tafseel')}</FieldLabel>
                  <TextInput value={tafseel} onChange={(e) => setTafseel(e.target.value)} />
                </InvoiceField>
              </InvoiceFieldRow>
            </InvoiceFormSection>

            <InvoiceFormSection label={kachiUrduLabel('addDheriRow')}>
              <InvoiceFieldStack>
                <InvoiceFieldGroup label={kachiUrduLabel('identity')}>
                  <InvoiceFieldRow cols={5}>
                    <InvoiceField wide>
                      <FieldLabel>{kachiUrduLabel('party')}</FieldLabel>
                      <SearchSelect
                        options={partyOptions}
                        value={partyAccountId}
                        onChange={setPartyAccountId}
                        placeholder="Search party…"
                      />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>{kachiUrduLabel('boriCount')}</FieldLabel>
                      <DecimalInput value={bagCount} onChange={setBagCount} inputMode="decimal" />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>{kachiUrduLabel('dharan')}</FieldLabel>
                      <DecimalInput value={dharanCount} onChange={setDharanCount} inputMode="decimal" />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>{kachiUrduLabel('kilo')}</FieldLabel>
                      <DecimalInput value={looseKg} onChange={setLooseKg} inputMode="decimal" />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>{kachiUrduLabel('bhartii')}</FieldLabel>
                      <DecimalInput value={bhartii} onChange={setBhartii} inputMode="decimal" />
                    </InvoiceField>
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>

                <InvoiceFieldGroup label={kachiUrduLabel('pricing')}>
                  <InvoiceFieldRow cols={4}>
                    <InvoiceField>
                      <FieldLabel>{kachiUrduLabel('ratePerMaund')}</FieldLabel>
                      <DecimalInput value={ratePerMaund} onChange={setRatePerMaund} />
                    </InvoiceField>
                    <InvoiceReadOnlyField
                      label={kachiUrduLabel('totalWeight')}
                      value={entryPreview.totalWeightKg}
                      displayText={formatWeightMaundKg(entryPreview.totalWeightKg)}
                    />
                    <InvoiceReadOnlyField label={kachiUrduLabel('amount')} value={entryPreview.amount} />
                    <InvoiceReadOnlyField label={kachiUrduLabel('netToParty')} value={entryPreview.netCreditToParty} />
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>
              </InvoiceFieldStack>
            </InvoiceFormSection>

            <InvoiceAddRowAction onClick={addRow}>{kachiUrduLabel('addToGrid')}</InvoiceAddRowAction>

            <InvoiceFormSection label={kachiUrduLabel('previewGrid')}>
              <InvoicePreviewGridShell isEmpty={gridRows.length === 0}>
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-surface2">
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-textMuted">
                      <th className="px-3 py-2.5">Party</th>
                      <th className="px-3 py-2.5">Dheri</th>
                      <th className="px-3 py-2.5">Product</th>
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
                        <td className="px-3 py-2">{row.jins || '—'}</td>
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

            <InvoiceFormSection label={kachiUrduLabel('settlementDebitSide')}>
              <InvoiceFieldStack>
                <InvoiceFieldGroup label={kachiUrduLabel('debitAccountTotals')}>
                  <InvoiceFieldRow cols={2}>
                    <InvoiceField>
                      <FieldLabel>Party category</FieldLabel>
                      <SearchSelect
                        options={debitCategoryOptions}
                        value={debitCategoryId}
                        onChange={onDebitCategoryChange}
                        placeholder="Sale Party or Purchase Party…"
                      />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>{kachiUrduLabel('debitAccount')}</FieldLabel>
                      <SearchSelect
                        options={debitAccountOptions}
                        value={debitAccountId}
                        onChange={setDebitAccountId}
                        placeholder={debitCategoryId ? 'Search party…' : 'Select a category first'}
                        disabled={!debitCategoryId}
                      />
                    </InvoiceField>
                  </InvoiceFieldRow>
                  <InvoiceFieldRow cols={3}>
                    <InvoiceReadOnlyField label={kachiUrduLabel('goodsTotal')} value={invoiceTotals.totalGoodsAmount} />
                    <InvoiceReadOnlyField label={kachiPercentUrduLabel('paleDari', prefRates.paleDariPercent)} value={invoiceTotals.totalPaleDari} />
                    <InvoiceReadOnlyField label={kachiPercentUrduLabel('brokery', prefRates.brokeryPercent)} value={invoiceTotals.totalBrokery} />
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>

                <InvoiceFieldGroup label={kachiUrduLabel('miscAndLowerBardana')}>
                  <InvoiceFieldRow cols={3}>
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
                          <span className="field-label-urdu">{kachiUrduLabel('marketFee')}</span>
                        </label>
                      </div>
                      <TextInput
                        value={formatLedgerAmount(invoiceTotals.marketFeeAmount)}
                        readOnly
                        disabled={!(prefs?.marketFeeEnabled ?? true)}
                      />
                    </InvoiceField>
                    <InvoiceReadOnlyField label={kachiPercentUrduLabel('daami', prefRates.daamiPercent)} value={invoiceTotals.profitAmount} />
                    <InvoiceField>
                      <FieldLabel>{kachiUrduLabel('miscOptional')}</FieldLabel>
                      <DecimalInput value={miscAmount} onChange={setMiscAmount} />
                    </InvoiceField>
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>
              </InvoiceFieldStack>
            </InvoiceFormSection>

            <InvoiceFormFooter
              totalLabel={kachiUrduLabel('totalDebit')}
              totalValue={invoiceTotals.totalDebitAmount}
              error={error}
              message={message}
              saving={saving}
              onClose={() => navigate(isEditingPending ? '/system/approvals' : '/')}
              onMinimize={
                isEditingPending
                  ? undefined
                  : () =>
                      minimize(
                        {
                          predictedRef,
                          gridRows,
                          invoiceDate,
                          productId,
                          jins,
                          billNo,
                          gariNo,
                          tafseel,
                          partyAccountId,
                          bagCount,
                          bhartii,
                          dharanCount,
                          looseKg,
                          ratePerMaund,
                          debitCategoryId,
                          debitAccountId,
                          miscAmount,
                        },
                        `Ref ${predictedRef || 'Draft'} (${gridRows.length} rows)`,
                      )
              }
              primaryLabel={isEditingPending ? 'Update pending' : kachiUrduLabel('saveInvoice')}
            />
        </div>
      </form>
    </FormPageShell>
  );
}
