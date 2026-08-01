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
import { FieldLabel, PageShell, Panel, TextInput } from '../../components/ui/PageShell';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useMinimizableForm } from '../../hooks/useMinimizableForm';
import { api, Account, AccountCategory, SystemPreferences } from '../../lib/api';
import { formatLedgerAmount } from '../../lib/format';
import { invoiceLoadErrorMessage, loadInvoiceFormBase } from '../../lib/invoiceFormLoad';
import {
  computeSaleCommissionInvoiceTotals,
  computeSaleCommissionRow,
  parseNum,
  PURCHASE_PARTY_CATEGORIES,
  SALE_PARTY_CATEGORIES,
} from '../../lib/saleCommissionCalculations';
import { InvoicePreviewGridShell } from './InvoicePreviewGrid';

type BoriThelaMode = 'BORI' | 'THELA';

type GridRow = {
  clientId: string;
  partyAccountId: number;
  partyName: string;
  jins: string;
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

type SaleCommissionDraft = {
  predictedRef: string;
  gridRows: GridRow[];
  invoiceDate: string;
  jins: string;
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
  salePartyAccountId: string;
  munshianaAmount: string;
  miscAmount: string;
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

export function SaleCommissionInvoicePage() {
  const navigate = useNavigate();
  const { restoredState, minimize } = useMinimizableForm<SaleCommissionDraft>('sale-commission');
  const keepRestoredPredictedRef = useRef(Boolean(restoredState?.predictedRef));
  const trapRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  useFocusTrap(trapRef, { initialFocusRef: dateRef });

  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [prefs, setPrefs] = useState<SystemPreferences | null>(null);
  const [predictedRef, setPredictedRef] = useState(() => restoredState?.predictedRef ?? '');
  const [gridRows, setGridRows] = useState<GridRow[]>(() => restoredState?.gridRows ?? []);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [invoiceDate, setInvoiceDate] = useState(() => restoredState?.invoiceDate ?? todayInputValue());
  const [jins, setJins] = useState(() => restoredState?.jins ?? '');
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

  const [salePartyAccountId, setSalePartyAccountId] = useState(() => restoredState?.salePartyAccountId ?? '');
  const [munshianaAmount, setMunshianaAmount] = useState(() => restoredState?.munshianaAmount ?? '');
  const [miscAmount, setMiscAmount] = useState(() => restoredState?.miscAmount ?? '');
  const [lowerBoriThela, setLowerBoriThela] = useState<BoriThelaMode>(() => restoredState?.lowerBoriThela ?? 'THELA');
  const [lowerBardanaQty, setLowerBardanaQty] = useState(() => restoredState?.lowerBardanaQty ?? '');
  const [lowerBardanaRate, setLowerBardanaRate] = useState(() => restoredState?.lowerBardanaRate ?? '');

  const reload = useCallback(async () => {
    const base = await loadInvoiceFormBase();
    setAccounts(base.accounts);
    setCategories(base.categories);
    setPrefs(base.prefs);
    try {
      const refRow = await api.getNextSaleCommissionReference();
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
      commissionPercent: prefs?.commissionPercent ?? 0,
      dalaliPercent: prefs?.dalaliPercent ?? 0,
      sutliRate: prefs?.sutliRate ?? 0,
      mazduriPerBagRate: prefs?.mazduriPerBagRate ?? 0,
      marketFeeRate: prefs?.marketFeeRate ?? 0,
    }),
    [prefs],
  );

  const entryPreview = useMemo(
    () =>
      computeSaleCommissionRow(
        {
          bagCount: parseNum(bagCount),
          bhartii: parseNum(bhartii),
          dharanCount: parseNum(dharanCount),
          looseKg: parseNum(looseKg),
          ratePerMaund: parseNum(ratePerMaund),
          bardanaQty: rowBardanaQty.trim() ? parseNum(rowBardanaQty) : null,
          bardanaRate: rowBardanaRate.trim() ? parseNum(rowBardanaRate) : null,
          dammiChecked,
        },
        prefRates,
      ),
    [bagCount, bhartii, dharanCount, looseKg, ratePerMaund, rowBardanaQty, rowBardanaRate, dammiChecked, prefRates],
  );

  const invoiceTotals = useMemo(
    () =>
      computeSaleCommissionInvoiceTotals(gridRows, prefRates, {
        munshianaAmount: munshianaAmount.trim() ? parseNum(munshianaAmount) : 0,
        miscAmount: miscAmount.trim() ? parseNum(miscAmount) : 0,
        lowerBardanaQty: lowerBardanaQty.trim() ? parseNum(lowerBardanaQty) : null,
        lowerBardanaRate: lowerBardanaRate.trim() ? parseNum(lowerBardanaRate) : null,
      }),
    [gridRows, prefRates, munshianaAmount, miscAmount, lowerBardanaQty, lowerBardanaRate],
  );

  function addRow() {
    setError('');
    if (!partyAccountId) {
      setError('Select a purchase party before adding a row');
      return;
    }
    const rate = parseNum(ratePerMaund);
    if (!(rate > 0)) {
      setError('Rate must be greater than zero');
      return;
    }
    if (!(entryPreview.amount > 0)) {
      setError('Row amount must be greater than zero');
      return;
    }

    const party = accounts.find((a) => String(a.id) === partyAccountId);
    setGridRows((prev) => [
      ...prev,
      {
        clientId: `${Date.now()}-${Math.random()}`,
        partyAccountId: Number(partyAccountId),
        partyName: party?.name ?? '',
        jins: jins.trim(),
        boriOrThelaMode: boriThelaMode,
        bagCount: parseNum(bagCount),
        bhartii: parseNum(bhartii),
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
      },
    ]);
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
    if (!salePartyAccountId) {
      setError('Select the Sale Party for settlement');
      return;
    }
    if (
      invoiceTotals.settlementBardanaAmount != null
      && invoiceTotals.settlementBardanaAmount > 0
      && !lowerBoriThela
    ) {
      setError('Select Bori or Thela for settlement bardana');
      return;
    }

    setSaving(true);
    try {
      const result = await api.createSaleCommissionInvoice({
        invoiceDate,
        salePartyAccountId: Number(salePartyAccountId),
        billNo: billNo.trim() || undefined,
        gariNo: gariNo.trim() || undefined,
        jins: jins.trim() || undefined,
        tafseel: tafseel.trim() || undefined,
        munshianaAmount: munshianaAmount.trim() ? parseNum(munshianaAmount) : undefined,
        miscAmount: miscAmount.trim() ? parseNum(miscAmount) : undefined,
        lowerBardanaMode:
          invoiceTotals.settlementBardanaAmount != null && invoiceTotals.settlementBardanaAmount > 0
            ? lowerBoriThela
            : null,
        lowerBardanaQty: lowerBardanaQty.trim() ? parseNum(lowerBardanaQty) : null,
        lowerBardanaRate: lowerBardanaRate.trim() ? parseNum(lowerBardanaRate) : null,
        lines: gridRows.map((row) => ({
          partyAccountId: row.partyAccountId,
          jins: row.jins || undefined,
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
      setMunshianaAmount('');
      setMiscAmount('');
      setLowerBardanaQty('');
      setLowerBardanaRate('');
      const refRow = await api.getNextSaleCommissionReference();
      setPredictedRef(refRow.reference);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell centerTitle invoiceTitleBand title="Sale on Commission" className="app-page--sale-commission">
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
                  <TextInput value={jins} onChange={(e) => setJins(e.target.value)} />
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
                        label="Purchase Party"
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
                  <InvoiceFieldRow cols={5}>
                    <InvoiceField>
                      <FieldLabel>Rate / Maund</FieldLabel>
                      <TextInput value={ratePerMaund} onChange={(e) => setRatePerMaund(e.target.value)} inputMode="decimal" />
                    </InvoiceField>
                    <InvoiceToggleField
                      label={`Dammi (${prefRates.daamiPercent}%)`}
                      checked={dammiChecked}
                      onChange={setDammiChecked}
                    />
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
                    {entryPreview.bardanaAmount != null ? (
                      <InvoiceReadOnlyField label="Bardana amount" value={entryPreview.bardanaAmount} />
                    ) : null}
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>

                <InvoiceAddRowAction onClick={addRow} />
              </InvoiceFieldStack>
            </InvoiceFormSection>

            <InvoiceFormSection label="Preview grid">
              <InvoicePreviewGridShell isEmpty={gridRows.length === 0}>
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-surface2">
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-textMuted">
                      <th className="px-3 py-2.5">Party</th>
                      <th className="px-3 py-2.5 text-right">Bags</th>
                      <th className="px-3 py-2.5 text-right">Weight</th>
                      <th className="px-3 py-2.5 text-right">Rate</th>
                      <th className="px-3 py-2.5 text-right">Amount</th>
                      <th className="px-3 py-2.5 text-right">Dammi</th>
                      <th className="px-3 py-2.5 text-right">Net</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {gridRows.map((row) => (
                      <tr key={row.clientId} className="border-b border-border/40">
                        <td className="px-3 py-2">{row.partyName}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.bagCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.totalWeightKg.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatLedgerAmount(row.ratePerMaund)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatLedgerAmount(row.amount)}</td>
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

            <InvoiceFormSection label="Settlement (Sale Party debit)">
              <InvoiceFieldStack>
                <InvoiceFieldGroup label="Sale Party & goods">
                  <InvoiceFieldRow cols={4}>
                    <InvoiceField wide>
                      <FlatAccountSelect
                        label="Sale Party"
                        categoryNames={SALE_PARTY_CATEGORIES}
                        categories={categories}
                        accounts={accounts}
                        value={salePartyAccountId}
                        onChange={setSalePartyAccountId}
                        placeholder="Search sale party…"
                      />
                    </InvoiceField>
                    <InvoiceReadOnlyField label="Goods total" value={invoiceTotals.totalGoodsAmount} />
                    <InvoiceReadOnlyField label="Dammi total" value={invoiceTotals.totalDammiAmount} />
                    <InvoiceReadOnlyField label="Post-dammi total" value={invoiceTotals.postDammiTotal} />
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>

                <InvoiceFieldGroup label="Fees (auto)">
                  <InvoiceFieldRow cols={4}>
                    <InvoiceReadOnlyField label={`Commission (${prefRates.commissionPercent}%)`} value={invoiceTotals.commissionAmount} />
                    <InvoiceReadOnlyField label={`Dalali (${prefRates.dalaliPercent}%)`} value={invoiceTotals.dalaliAmount} />
                    <InvoiceReadOnlyField label="Sutli" value={invoiceTotals.sutliAmount} />
                    <InvoiceReadOnlyField label="Labour (Mazduri)" value={invoiceTotals.mazduriAmount} />
                    <InvoiceReadOnlyField label="Market fee" value={invoiceTotals.marketFeeAmount} />
                    <InvoiceReadOnlyField label="Bags" value={invoiceTotals.totalBagCount} format="number" />
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>

                <InvoiceFieldGroup label="Manual & bardana">
                  <InvoiceFieldRow cols={4}>
                    <InvoiceField>
                      <FieldLabel>Munshiana</FieldLabel>
                      <TextInput value={munshianaAmount} onChange={(e) => setMunshianaAmount(e.target.value)} inputMode="decimal" />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>Misc</FieldLabel>
                      <TextInput value={miscAmount} onChange={(e) => setMiscAmount(e.target.value)} inputMode="decimal" />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>Bardana type</FieldLabel>
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
                      <FieldLabel>Bardana qty</FieldLabel>
                      <TextInput value={lowerBardanaQty} onChange={(e) => setLowerBardanaQty(e.target.value)} inputMode="decimal" placeholder="defaults to bag count" />
                    </InvoiceField>
                    <InvoiceField>
                      <FieldLabel>Bardana rate</FieldLabel>
                      <TextInput value={lowerBardanaRate} onChange={(e) => setLowerBardanaRate(e.target.value)} inputMode="decimal" />
                    </InvoiceField>
                    {invoiceTotals.settlementBardanaAmount != null ? (
                      <InvoiceReadOnlyField label="Bardana amount" value={invoiceTotals.settlementBardanaAmount} />
                    ) : null}
                  </InvoiceFieldRow>
                </InvoiceFieldGroup>
              </InvoiceFieldStack>
              <InvoiceFormFooter
                totalLabel="Sale Party net debit"
                totalValue={invoiceTotals.netSalePartyDebit}
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
                      jins,
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
                      salePartyAccountId,
                      munshianaAmount,
                      miscAmount,
                      lowerBoriThela,
                      lowerBardanaQty,
                      lowerBardanaRate,
                    },
                    `Sale on Commission — ${predictedRef || 'draft'}`,
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
