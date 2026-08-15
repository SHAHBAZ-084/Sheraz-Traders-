import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Account, type AccountCategory, type Voucher } from '../../lib/api';
import { formatDate, formatLedgerAmount, formatLedgerBalance, formatVoucherNumber, formatVoucherTypeLabel, ledgerCreditAmountClass, ledgerDebitAmountClass, voucherTypeColorClass } from '../../lib/format';
import { BROWSE_PAGE_SIZE } from '../../lib/pagination';
import { downloadExcel, downloadPdf } from '../../lib/reportExport';
import { ListPagination } from '../../components/ui/ListPagination';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { FieldLabel, FinancialButton, PageShell, Panel, PrimaryButton, SecondaryButton, TextInput } from '../../components/ui/PageShell';
import { ReportLetterhead } from '../../components/reports/ReportLetterhead';
import { LedgerVoucherDescription, voucherSideLabelClass } from '../../components/vouchers/LedgerVoucherDescription';
import { ReportTable } from '../../components/reports/ReportTable';
import { useFinancialYear, useReportFinancialYearId } from '../../contexts/FinancialYearContext';
import { PageCloseBar } from '../../components/ui/PageCloseBar';
import { VoucherDetailCard } from '../vouchers/VoucherPages';

export type HistoricalReportScope = {
  financialYearId: number;
  financialYearLabel: string;
  readOnly?: boolean;
};

type ReportPageOptions = {
  historicalScope?: HistoricalReportScope;
  embedded?: boolean;
};

function ReportPanel({
  embedded,
  title,
  children,
}: {
  embedded?: boolean;
  title?: string;
  children: ReactNode;
}) {
  if (embedded) {
    return <div className="fy-report-embedded">{children}</div>;
  }

  return (
    <Panel className="overflow-visible">
      {title ? <h2 className="mb-4 text-lg font-semibold text-textPrimary print:hidden">{title}</h2> : null}
      {children}
    </Panel>
  );
}

function reportFilterClass(embedded?: boolean, variant: 'ledger' | 'balance' | 'vouchers' | 'profitLoss' = 'ledger') {
  if (embedded) return 'fy-report-filters print:hidden';

  const standalone = {
    ledger:
      'mb-4 grid gap-4 overflow-visible print:hidden sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto] xl:items-end',
    balance: 'mb-4 grid gap-4 print:hidden sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto] xl:items-end',
    vouchers: 'mb-4 grid gap-4 print:hidden lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end',
    profitLoss:
      'grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto_auto] lg:items-end',
  };

  return standalone[variant];
}

function reportEmptyClass(embedded?: boolean) {
  return embedded ? 'fy-report-empty' : 'text-sm text-textSecondary';
}

type LedgerResult = Awaited<ReturnType<typeof api.getLedger>>;
type AccountBalanceResult = Awaited<ReturnType<typeof api.getAccountBalanceReport>>;

function todayInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function periodRangeLabel(fromDate: string, toDate: string, emptyFallback: string) {
  if (!fromDate && !toDate) return emptyFallback;
  if (fromDate && toDate && fromDate === toDate) return formatDate(fromDate);
  if (fromDate && toDate) return `${formatDate(fromDate)} to ${formatDate(toDate)}`;
  if (fromDate) return `From ${formatDate(fromDate)}`;
  return `To ${formatDate(toDate)}`;
}

function isoToDateInput(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function clampDateInput(value: string, min?: string, max?: string) {
  if (!value) return value;
  let next = value;
  if (min && next < min) next = min;
  if (max && next > max) next = max;
  return next;
}

function formatProfitLossPrice(value: number | null) {
  return value == null ? '—' : formatLedgerAmount(value);
}

function voucherFromAccount(voucher: Voucher) {
  if (voucher.type === 'KACHI') return 'Multi-leg';
  if (voucher.type === 'JOURNAL') return voucher.debitAccount?.name ?? '—';
  return voucher.creditAccount?.name ?? '—';
}

function voucherToAccount(voucher: Voucher) {
  if (voucher.type === 'KACHI') return `${voucher.ledgerEntries?.length ?? 0} legs`;
  if (voucher.type === 'JOURNAL') return voucher.creditAccount?.name ?? '—';
  return voucher.debitAccount?.name ?? '—';
}

export function AccountReportsPage({ historicalScope, embedded }: ReportPageOptions = {}) {
  const financialYearId = useReportFinancialYearId(historicalScope);
  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [fromDate, setFromDate] = useState(todayInputValue);
  const [toDate, setToDate] = useState(todayInputValue);
  const [ledger, setLedger] = useState<LedgerResult | null>(null);
  const [ledgerOffset, setLedgerOffset] = useState(0);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const letterheadRef = useRef<HTMLElement>(null);

  const filteredAccounts = useMemo(
    () => accounts.filter((a) => categoryId && String(a.categoryId) === categoryId),
    [accounts, categoryId],
  );

  useEffect(() => {
    Promise.all([api.listCategories(), api.listAccounts()])
      .then(([categoryRows, accountRows]) => {
        setCategories(categoryRows.filter((c) => c.isActive));
        setAccounts(accountRows.filter((a) => a.isActive));
      })
      .catch(() => {
        setCategories([]);
        setAccounts([]);
      });
  }, []);

  function onCategoryChange(nextCategoryId: string) {
    setCategoryId(nextCategoryId);
    setAccountId('');
    setLoaded(false);
    setLedger(null);
    setLedgerOffset(0);
    setLedgerTotal(0);
    setError('');
  }

  function onAccountChange(nextAccountId: string) {
    setAccountId(nextAccountId);
    setLoaded(false);
    setLedger(null);
    setLedgerOffset(0);
    setLedgerTotal(0);
    setError('');
  }

  async function loadLedger(pageOffset = ledgerOffset) {
    if (!categoryId) {
      setError('Select a category');
      return;
    }
    if (!accountId) {
      setError('Select an account');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await api.getLedger(Number(accountId), {
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        limit: BROWSE_PAGE_SIZE,
        offset: pageOffset,
        ...(financialYearId != null ? { financialYearId } : {}),
      });
      setLedger(result);
      setLedgerTotal(result.totalCount ?? result.pagination?.total ?? result.rows.length);
      setLedgerOffset(pageOffset);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ledger');
      setLedger(null);
    } finally {
      setLoading(false);
    }
  }

  async function exportLedger(format: 'pdf' | 'excel') {
    if (!ledger || !accountId) return;
    const exportData =
      ledgerTotal > ledger.rows.length
        ? await api.getLedger(Number(accountId), {
            fromDate: fromDate || undefined,
            toDate: toDate || undefined,
            limit: ledgerTotal,
            offset: 0,
            ...(financialYearId != null ? { financialYearId } : {}),
          })
        : ledger;
    const accountName = exportData.account.name;
    const showMazduri = Boolean(exportData.showMazduriColumn);
    const headers = showMazduri
      ? ['Date', 'Voucher#', 'Ref#', 'Type', 'Description', 'Debit', 'Credit', 'Mazduri', 'Balance']
      : ['Date', 'Voucher#', 'Ref#', 'Type', 'Description', 'Debit', 'Credit', 'Balance'];
    const rows = exportData.rows.map((r) => {
      const base = [
        formatDate(r.date),
        r.voucherNo,
        r.ref ?? '',
        r.type,
        r.description,
        r.debit > 0 ? formatLedgerAmount(r.debit) : '',
        r.credit > 0 ? formatLedgerAmount(r.credit) : '',
      ];
      if (showMazduri) {
        base.push(r.mazduri != null && r.mazduri > 0 ? formatLedgerAmount(r.mazduri) : '');
      }
      base.push(formatLedgerBalance(r.balance));
      return base;
    });
    const totalRow = showMazduri
      ? [
          'Total / Closing',
          '',
          '',
          '',
          '',
          formatLedgerAmount(exportData.summary.totalDebit),
          formatLedgerAmount(exportData.summary.totalCredit),
          formatLedgerAmount(exportData.summary.totalMazduri ?? 0),
          formatLedgerBalance(exportData.summary.closingBalance),
        ]
      : [
          'Total / Closing',
          '',
          '',
          '',
          '',
          formatLedgerAmount(exportData.summary.totalDebit),
          formatLedgerAmount(exportData.summary.totalCredit),
          formatLedgerBalance(exportData.summary.closingBalance),
        ];
    rows.push(totalRow);
    const safeName = accountName.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
    const base = `ledger-${safeName || 'account'}`;
    if (format === 'excel') {
      downloadExcel(`${base}.xlsx`, 'Ledger', headers, rows);
    } else {
      await downloadPdf(`${base}.pdf`, 'Account Ledger', headers, rows, {
        letterheadElement: letterheadRef.current,
        orientation: 'landscape',
      });
    }
  }

  const periodSubtitle = periodRangeLabel(fromDate, toDate, 'All dates');
  const fySubtitle = historicalScope?.financialYearLabel
    ? `${historicalScope.financialYearLabel} · ${periodSubtitle}`
    : periodSubtitle;

  const panel = (
    <ReportPanel embedded={embedded} title="Account Ledger">
      <div className={reportFilterClass(embedded, 'ledger')}>
          <div>
            <FieldLabel>Category</FieldLabel>
            <SearchSelect
              value={categoryId}
              onChange={onCategoryChange}
              options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
              placeholder="Search category…"
            />
          </div>
          <div>
            <FieldLabel>Account</FieldLabel>
            <SearchSelect
              value={accountId}
              onChange={onAccountChange}
              options={filteredAccounts.map((a) => ({ value: String(a.id), label: a.name }))}
              placeholder={categoryId ? 'Search account…' : 'Select a category first'}
              disabled={!categoryId}
            />
          </div>
          <div>
            <FieldLabel>From date</FieldLabel>
            <TextInput type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <FieldLabel>To date</FieldLabel>
            <TextInput type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <PrimaryButton type="button" onClick={() => loadLedger(0)} disabled={loading}>
            {loading ? 'Loading…' : 'Load Ledger'}
          </PrimaryButton>
      </div>

      <div className={embedded ? 'fy-report-body' : undefined}>
        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

        {!loaded ? (
          <p className={reportEmptyClass(embedded)}>Select a category and account, then click Load Ledger</p>
        ) : ledger && (ledger.rows?.length ?? 0) === 0 ? (
          <p className={reportEmptyClass(embedded)}>No entries in this period</p>
        ) : ledger ? (
          <div className="report-print-area">
            <ReportLetterhead
              ref={letterheadRef}
              title="Account Ledger"
              subtitle={`${ledger.account.name} · ${fySubtitle}`}
            />
            <div className="mb-4 flex flex-wrap gap-2 print:hidden">
              <SecondaryButton type="button" onClick={() => exportLedger('pdf')}>Download PDF</SecondaryButton>
              <SecondaryButton type="button" onClick={() => exportLedger('excel')}>Download Excel</SecondaryButton>
            </div>
            <ReportTable tableClassName="table-fixed">
              <colgroup>
                <col className="w-[7.5rem]" />
                <col className="w-[5.75rem]" />
                <col className="w-[6.5rem]" />
                <col className="w-[5.5rem]" />
                <col />
                <col className="w-[5.5rem]" />
                <col className="w-[5.5rem]" />
                {ledger.showMazduriColumn ? <col className="w-[5.5rem]" /> : null}
                <col className="w-[6.5rem]" />
              </colgroup>
              <thead>
                <tr>
                  <th className="pr-2">Date</th>
                  <th className="pr-4 text-right">Voucher#</th>
                  <th className="pl-3 pr-2">Ref#</th>
                  <th className="pr-2">Type</th>
                  <th className="pr-2">Description</th>
                  <th className="pr-2 text-right">Debit</th>
                  <th className="pr-2 text-right">Credit</th>
                  {ledger.showMazduriColumn ? <th className="pr-2 text-right">Mazduri</th> : null}
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {(ledger.rows ?? []).map((r, i) => (
                  <tr key={i} className={r.isOpeningRow ? 'report-table-row--emphasis' : ''}>
                    <td className="pr-2 whitespace-nowrap">{formatDate(r.date)}</td>
                    <td className="pr-4 text-right font-mono text-xs font-semibold text-financial">{r.voucherNo}</td>
                    <td className="pl-3 pr-2 truncate text-textSecondary" title={r.ref ?? ''}>{r.ref ?? ''}</td>
                    <td className={`pr-2 font-medium ${voucherTypeColorClass(r.type)}`}>{formatVoucherTypeLabel(r.type)}</td>
                    <td className="pr-2 whitespace-normal break-words text-textSecondary">
                      {r.description ? <LedgerVoucherDescription text={r.description} /> : ''}
                    </td>
                    <td className={`pr-2 text-right tabular-nums ${ledgerDebitAmountClass(r.debit > 0)}`}>{r.debit > 0 ? formatLedgerAmount(r.debit) : ''}</td>
                    <td className={`pr-2 text-right tabular-nums ${ledgerCreditAmountClass(r.credit > 0)}`}>{r.credit > 0 ? formatLedgerAmount(r.credit) : ''}</td>
                    {ledger.showMazduriColumn ? (
                      <td className={`pr-2 text-right tabular-nums ${ledgerDebitAmountClass((r.mazduri ?? 0) > 0)}`}>
                        {r.mazduri != null && r.mazduri > 0 ? formatLedgerAmount(r.mazduri) : '—'}
                      </td>
                    ) : null}
                    <td className="text-right font-medium tabular-nums text-accent">{formatLedgerBalance(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Total / Closing</td>
                  <td className={`text-right tabular-nums ${ledgerDebitAmountClass(ledger.summary.totalDebit > 0)}`}>{formatLedgerAmount(ledger.summary.totalDebit)}</td>
                  <td className={`text-right tabular-nums ${ledgerCreditAmountClass(ledger.summary.totalCredit > 0)}`}>{formatLedgerAmount(ledger.summary.totalCredit)}</td>
                  {ledger.showMazduriColumn ? (
                    <td className={`text-right tabular-nums ${ledgerDebitAmountClass((ledger.summary.totalMazduri ?? 0) > 0)}`}>
                      {formatLedgerAmount(ledger.summary.totalMazduri ?? 0)}
                    </td>
                  ) : null}
                  <td className="text-right text-accent">{formatLedgerBalance(ledger.summary.closingBalance)}</td>
                </tr>
              </tfoot>
            </ReportTable>
            <ListPagination
              total={ledgerTotal}
              offset={ledgerOffset}
              onPageChange={(nextOffset) => void loadLedger(nextOffset)}
              className="mt-4"
            />
          </div>
        ) : null}
      </div>
    </ReportPanel>
  );

  if (embedded) return panel;

  return (
    <PageShell title="Account Ledger" subtitle="View ledger entries for any account">
      {panel}
      <PageCloseBar />
    </PageShell>
  );
}

export function TrialBalancePage() {
  const financialYearId = useReportFinancialYearId();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getTrialBalance>> | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const letterheadRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setOffset(0);
  }, [financialYearId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getTrialBalance({
        ...(financialYearId != null ? { financialYearId } : {}),
        limit: BROWSE_PAGE_SIZE,
        offset,
      })
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setTotal(result.pagination?.total ?? result.totalCount ?? result.accounts.length);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [financialYearId, offset]);

  const scopeLabel =
    data?.scope === 'closing_snapshot' && data.financialYearLabel
      ? `Closing snapshot — ${data.financialYearLabel}`
      : 'Live cumulative balances';

  function exportTrialBalance(format: 'pdf' | 'excel') {
    if (!data) return;
    void (async () => {
      const exportData =
        total > data.accounts.length
          ? await api.getTrialBalance({
              ...(financialYearId != null ? { financialYearId } : {}),
              limit: total,
              offset: 0,
            })
          : data;
      const headers = ['Account', 'Debit', 'Credit'];
      const rows = exportData.accounts.map((row) => [
        row.accountName,
        formatLedgerAmount(row.debit, 2),
        formatLedgerAmount(row.credit, 2),
      ]);
      rows.push(['Total', formatLedgerAmount(exportData.totalDebit, 2), formatLedgerAmount(exportData.totalCredit, 2)]);
      if (format === 'excel') {
        downloadExcel('trial-balance.xlsx', 'Trial Balance', headers, rows);
      } else {
        await downloadPdf('trial-balance.pdf', 'Detail Trial Balance', headers, rows, {
          letterheadElement: letterheadRef.current,
        });
      }
    })();
  }

  return (
    <PageShell title="Detail Trial Balance" subtitle="Debit and credit totals by account">
      <Panel>
        {loading ? (
          <p className="text-sm text-textSecondary">Loading…</p>
        ) : data ? (
          <div className="report-print-area">
            <ReportLetterhead
              ref={letterheadRef}
              title="Detail Trial Balance"
              subtitle={`${scopeLabel} · ${data.isBalanced ? 'Balanced' : 'Out of balance'}`}
            />
            <div className="mb-4 flex flex-wrap gap-2 print:hidden">
              <SecondaryButton type="button" onClick={() => exportTrialBalance('pdf')}>Download PDF</SecondaryButton>
              <SecondaryButton type="button" onClick={() => exportTrialBalance('excel')}>Download Excel</SecondaryButton>
            </div>
            <ReportTable>
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="text-right">Debit</th>
                  <th className="text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.map((row, i) => (
                  <tr key={i}>
                    <td>{row.accountName}</td>
                    <td className={`text-right tabular-nums ${ledgerDebitAmountClass(row.debit > 0)}`}>{formatLedgerAmount(row.debit, 2)}</td>
                    <td className={`text-right tabular-nums ${ledgerCreditAmountClass(row.credit > 0)}`}>{formatLedgerAmount(row.credit, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
            <ListPagination total={total} offset={offset} onPageChange={setOffset} className="mt-4" />
            <p className="mt-4 text-sm text-textSecondary">
              Total debit{' '}
              <span className={ledgerDebitAmountClass(data.totalDebit > 0)}>{formatLedgerAmount(data.totalDebit, 2)}</span>
              {' · '}Total credit{' '}
              <span className={ledgerCreditAmountClass(data.totalCredit > 0)}>{formatLedgerAmount(data.totalCredit, 2)}</span>
              {' · '}
              {data.isBalanced ? 'Balanced' : 'Out of balance'}
            </p>
          </div>
        ) : (
          <p className="text-sm text-textSecondary">Loading…</p>
        )}
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}


export function StockReportPage() {
  const [stores, setStores] = useState<Array<{ id: number; name: string }>>([]);
  const [storeId, setStoreId] = useState('');
  const [products, setProducts] = useState<Array<{ id: number; name: string; code: string }>>([]);
  const [productId, setProductId] = useState('');
  const [report, setReport] = useState<Awaited<ReturnType<typeof api.getStockReport>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listActiveStores()
      .then((rows) => setStores(rows.map((s) => ({ id: s.id, name: s.name }))))
      .catch(() => setStores([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    const loadProducts = async () => {
      try {
        if (storeId) {
          const rows = await api.getProductsByStore(Number(storeId));
          if (!cancelled) setProducts(rows.map((p) => ({ id: p.id, name: p.name, code: p.code })));
        } else {
          const rows = await api.listProducts();
          if (!cancelled) setProducts(rows.map((p) => ({ id: p.id, name: p.name, code: p.code })));
        }
      } catch {
        if (!cancelled) setProducts([]);
      }
    };
    void loadProducts();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  function onStoreChange(value: string) {
    setStoreId(value);
    setProductId('');
    setReport(null);
  }

  async function onLoad() {
    setError('');
    setReport(null);
    const id = Number(productId);
    if (!Number.isFinite(id) || id < 1) {
      setError('Select a product');
      return;
    }
    setLoading(true);
    try {
      const selectedStoreId = Number(storeId);
      setReport(
        await api.getStockReport({
          productId: id,
          storeId: Number.isFinite(selectedStoreId) && selectedStoreId > 0 ? selectedStoreId : undefined,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stock report');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell title="Stock Report" subtitle="Stock movements by product name and date — Sale Invoice / Purchase Invoice breakdown">
      <Panel>
        <div className="grid gap-3 print:hidden md:grid-cols-4 md:items-end">
          <div>
            <FieldLabel>Store</FieldLabel>
            <SearchSelect
              value={storeId}
              onChange={onStoreChange}
              options={[
                { value: '', label: 'All stores' },
                ...stores.map((s) => ({ value: String(s.id), label: s.name })),
              ]}
              placeholder="All stores"
            />
          </div>
          <div className="md:col-span-2">
            <FieldLabel>Product</FieldLabel>
            <SearchSelect
              value={productId}
              onChange={setProductId}
              options={products.map((p) => ({ value: String(p.id), label: `${p.code} — ${p.name}` }))}
              placeholder={storeId ? 'Products with store stock…' : 'Search product…'}
            />
          </div>
          <FinancialButton type="button" onClick={onLoad} disabled={loading}>
            {loading ? 'Loading…' : 'Show report'}
          </FinancialButton>
        </div>

        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

        {report ? (
          <div className="report-print-area mt-6 space-y-4">
            <ReportLetterhead
              title="Stock Report"
              subtitle={(() => {
                const product = products.find((p) => String(p.id) === productId);
                return product ? `${product.code} — ${product.name}` : undefined;
              })()}
            />
            <p className="text-sm text-textSecondary">
              Tracking from {formatDate(report.trackingStartedAt)} onward.
              {!report.historicalBackfill
                ? ' Invoices saved before stock tracking started are not included.'
                : null}
              {' '}Carried loose remainder: {report.carriedRemainderKg} kg.
              {report.storeId
                ? ` Filtered to store: ${stores.find((s) => s.id === report.storeId)?.name ?? `#${report.storeId}`}.`
                : null}
            </p>

            <ReportTable>
              <thead>
                <tr>
                  <th className="pr-3">Date</th>
                  <th className="pr-3">Description</th>
                  <th className="pr-3">Status</th>
                  <th className="pr-3 text-right">Quantity</th>
                  <th className="text-right">Running Balance</th>
                </tr>
              </thead>
              <tbody>
                {(report.rows?.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-textSecondary">
                      No stock movements for this product yet.
                    </td>
                  </tr>
                ) : (
                  (report.rows ?? []).map((row) => (
                    <tr key={row.id}>
                      <td className="pr-3 whitespace-nowrap">{formatDate(row.date)}</td>
                      <td className="pr-3">{row.description}</td>
                      <td className={`pr-3 font-medium ${row.status === 'IN' ? 'text-success' : 'text-danger'}`}>
                        {row.status}
                      </td>
                      <td className="pr-3 text-right tabular-nums">{row.bags}</td>
                      <td className="text-right font-medium tabular-nums">{row.runningBalance}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pr-3" colSpan={3}>
                    Total In {report.totals.totalIn} · Total Out {report.totals.totalOut}
                    {' · '}Sold (Sale Invoice) {report.totals.saleInvoiceQty}
                    {' · '}Purchased (Purchase Invoice) {report.totals.purchaseInvoiceQty}
                  </td>
                  <td className="pr-3 text-right tabular-nums" />
                  <td className="text-right tabular-nums">
                    Net {report.totals.netBalance}
                  </td>
                </tr>
              </tfoot>
            </ReportTable>
          </div>
        ) : null}
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}

type BalanceSideFilter = 'both' | 'debit' | 'credit';
type VoucherTypeFilter = 'all' | 'PAYMENT' | 'RECEIPT' | 'JOURNAL' | 'KACHI';

function BalanceTable({
  rows,
  totalDebit,
  totalCredit,
}: {
  rows: AccountBalanceResult['accounts'];
  totalDebit: number;
  totalCredit: number;
}) {
  return (
    <ReportTable>
      <thead>
        <tr>
          <th className="pr-3">Account Code</th>
          <th className="pr-3">Account Name</th>
          <th className="pr-3 text-right">Debit</th>
          <th className="pr-3 text-right">Credit</th>
          <th className="text-right">Balance</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.accountId}>
            <td className="pr-3 font-mono text-xs text-textSecondary">{row.accountCode}</td>
            <td className="pr-3">{row.accountName}</td>
            <td className={`pr-3 text-right tabular-nums ${ledgerDebitAmountClass(row.debit > 0)}`}>
              {row.debit > 0 ? formatLedgerAmount(row.debit) : ''}
            </td>
            <td className={`pr-3 text-right tabular-nums ${ledgerCreditAmountClass(row.credit > 0)}`}>
              {row.credit > 0 ? formatLedgerAmount(row.credit) : ''}
            </td>
            <td className="text-right font-medium tabular-nums text-accent">
              {formatLedgerBalance(row.balance)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={2}>Total</td>
          <td className={`text-right tabular-nums ${ledgerDebitAmountClass(totalDebit > 0)}`}>{formatLedgerAmount(totalDebit)}</td>
          <td className={`text-right tabular-nums ${ledgerCreditAmountClass(totalCredit > 0)}`}>{formatLedgerAmount(totalCredit)}</td>
          <td />
        </tr>
      </tfoot>
    </ReportTable>
  );
}

export function AccountBalancePage({ historicalScope, embedded }: ReportPageOptions = {}) {
  const financialYearId = useReportFinancialYearId(historicalScope);
  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [datedOn, setDatedOn] = useState(todayInputValue);
  const [categoryId, setCategoryId] = useState('');
  const [side, setSide] = useState<BalanceSideFilter>('both');
  const [report, setReport] = useState<AccountBalanceResult | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const letterheadRef = useRef<HTMLElement>(null);

  useEffect(() => {
    api.listCategories()
      .then((rows) => setCategories(rows.filter((c) => c.isActive)))
      .catch(() => setCategories([]));
  }, []);

  async function loadReport(pageOffset = offset) {
    if (!datedOn) {
      setError('Select a date');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await api.getAccountBalanceReport({
        date: datedOn,
        categoryId: categoryId ? Number(categoryId) : undefined,
        side,
        limit: BROWSE_PAGE_SIZE,
        offset: pageOffset,
        ...(financialYearId != null ? { financialYearId } : {}),
      });
      setReport(result);
      setTotal(result.pagination?.total ?? result.totalCount ?? result.accounts.length);
      setOffset(pageOffset);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  function exportReport(format: 'pdf' | 'excel') {
    if (!report) return;
    void (async () => {
      const exportData =
        total > report.accounts.length
          ? await api.getAccountBalanceReport({
              date: datedOn,
              categoryId: categoryId ? Number(categoryId) : undefined,
              side,
              limit: total,
              offset: 0,
              ...(financialYearId != null ? { financialYearId } : {}),
            })
          : report;
      const headers = ['Account Code', 'Account Name', 'Debit', 'Credit', 'Balance'];
      const rows = exportData.accounts.map((row) => [
      row.accountCode,
      row.accountName,
      row.debit > 0 ? formatLedgerAmount(row.debit) : '',
      row.credit > 0 ? formatLedgerAmount(row.credit) : '',
      formatLedgerBalance(row.balance),
    ]);
    rows.push([
      'Total',
      '',
      formatLedgerAmount(exportData.totalDebit),
      formatLedgerAmount(exportData.totalCredit),
      '',
    ]);
    const safeDate = datedOn.replace(/[^\d-]/g, '');
    const base = `account-balance-${safeDate}`;
    if (format === 'excel') {
      downloadExcel(`${base}.xlsx`, 'Account Balance', headers, rows);
    } else {
      await downloadPdf(`${base}.pdf`, 'Account Balance', headers, rows, {
        letterheadElement: letterheadRef.current,
        orientation: 'landscape',
      });
    }
    })();
  }

  const showGrouped = !categoryId && (report?.groups?.length ?? 0) > 0;

  const balanceSubtitle = historicalScope?.financialYearLabel
    ? `${historicalScope.financialYearLabel} · As of ${formatDate(datedOn)}`
    : `As of ${formatDate(datedOn)}`;

  const panel = (
    <ReportPanel embedded={embedded} title="Account Balance">
      <div className={reportFilterClass(embedded, 'balance')}>
          <div>
            <FieldLabel>Dated On</FieldLabel>
            <TextInput type="date" value={datedOn} onChange={(e) => setDatedOn(e.target.value)} />
          </div>
          <div>
            <FieldLabel>Account Type</FieldLabel>
            <select
              className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-textPrimary"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All Groups</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Amount Type</FieldLabel>
            <SegmentedControl
              ariaLabel="Amount type"
              value={side}
              onChange={setSide}
              options={[
                { value: 'both', label: 'Both' },
                { value: 'debit', label: 'Debit' },
                { value: 'credit', label: 'Credit' },
              ]}
            />
          </div>
          <FinancialButton type="button" onClick={() => loadReport(0)} disabled={loading}>
            {loading ? 'Loading…' : 'View'}
          </FinancialButton>
      </div>

      <div className={embedded ? 'fy-report-body' : undefined}>
        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

        {!loaded ? (
          <p className={reportEmptyClass(embedded)}>Set filters and click View</p>
        ) : report && (report.accounts?.length ?? 0) === 0 ? (
          <p className={reportEmptyClass(embedded)}>No accounts match these filters</p>
        ) : report ? (
          <div className="report-print-area">
            <ReportLetterhead ref={letterheadRef} title="Account Balance" subtitle={balanceSubtitle} />
            <div className="mb-4 flex flex-wrap gap-2 print:hidden">
              <SecondaryButton type="button" onClick={() => exportReport('pdf')}>Download PDF</SecondaryButton>
              <SecondaryButton type="button" onClick={() => exportReport('excel')}>Download Excel</SecondaryButton>
            </div>
            {showGrouped ? (
              <div className="space-y-6">
                {(report.groups ?? []).map((group) => (
                  <div key={group.categoryId}>
                    <div className="mb-2 border-b border-border pb-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-textMuted">
                        {group.categoryName}
                      </p>
                    </div>
                    <BalanceTable
                      rows={group.accounts}
                      totalDebit={group.accounts.reduce((s, r) => s + r.debit, 0)}
                      totalCredit={group.accounts.reduce((s, r) => s + r.credit, 0)}
                    />
                  </div>
                ))}
                <ReportTable>
                  <thead>
                    <tr>
                      <th className="pr-3">Account Code</th>
                      <th className="pr-3">Account Name</th>
                      <th className="pr-3 text-right">Debit</th>
                      <th className="pr-3 text-right">Credit</th>
                      <th className="text-right">Balance</th>
                    </tr>
                  </thead>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>Grand Total</td>
                      <td className={`text-right tabular-nums ${ledgerDebitAmountClass(report.totalDebit > 0)}`}>{formatLedgerAmount(report.totalDebit)}</td>
                      <td className={`text-right tabular-nums ${ledgerCreditAmountClass(report.totalCredit > 0)}`}>{formatLedgerAmount(report.totalCredit)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </ReportTable>
              </div>
            ) : (
              <BalanceTable
                rows={report.accounts}
                totalDebit={report.totalDebit}
                totalCredit={report.totalCredit}
              />
            )}
            <ListPagination
              total={total}
              offset={offset}
              onPageChange={(nextOffset) => void loadReport(nextOffset)}
              className="mt-4"
            />
          </div>
        ) : null}
      </div>
    </ReportPanel>
  );

  if (embedded) return panel;

  return (
    <PageShell title="Account Balance" subtitle="Balances as of a selected date">
      {panel}
      <PageCloseBar />
    </PageShell>
  );
}

function voucherFromColumnClass(voucher: Voucher) {
  if (voucher.type === 'JOURNAL') return ledgerDebitAmountClass(true);
  return ledgerCreditAmountClass(true);
}

function voucherToColumnClass(voucher: Voucher) {
  if (voucher.type === 'JOURNAL') return ledgerCreditAmountClass(true);
  return ledgerDebitAmountClass(true);
}

export function VouchersReportPage({ historicalScope, embedded }: ReportPageOptions = {}) {
  const financialYearId = useReportFinancialYearId(historicalScope);
  const readOnly = historicalScope?.readOnly ?? false;
  const [fromDate, setFromDate] = useState(todayInputValue);
  const [toDate, setToDate] = useState(todayInputValue);
  const [voucherType, setVoucherType] = useState<VoucherTypeFilter>('all');
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [listOffset, setListOffset] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Voucher | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [updating, setUpdating] = useState(false);
  const letterheadRef = useRef<HTMLElement>(null);

  const totals = useMemo(() => {
    const totalAmount = vouchers.reduce((sum, v) => sum + Number(v.amount), 0);
    const byType = {
      PAYMENT: 0,
      RECEIPT: 0,
      JOURNAL: 0,
      KACHI: 0,
    };
    for (const v of vouchers) {
      if (v.type in byType) {
        byType[v.type as keyof typeof byType] += Number(v.amount);
      }
    }
    return { totalAmount, byType };
  }, [vouchers]);

  async function loadReport(pageOffset = listOffset) {
    if (!fromDate || !toDate) {
      setError('Select from and to dates');
      return;
    }
    setError('');
    setLoading(true);
    setSelected(null);
    try {
      const page = await api.listVouchers({
        fromDate,
        toDate,
        type: voucherType === 'all' ? undefined : voucherType,
        ...(financialYearId != null ? { financialYearId } : {}),
        limit: BROWSE_PAGE_SIZE,
        offset: pageOffset,
      });
      setVouchers(page.items);
      setListTotal(page.total);
      setListOffset(pageOffset);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load vouchers');
      setVouchers([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    if (!selected) return;
    if (!window.confirm('This will reverse the ledger entries — are you sure?')) return;
    setCancelling(true);
    try {
      const updated = await api.cancelVoucher(selected.id);
      setSelected(updated);
      await loadReport();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setCancelling(false);
    }
  }

  async function handleUpdateAmount(amount: number) {
    if (!selected) return;
    setUpdating(true);
    try {
      const updated = await api.updateVoucherAmount(selected.id, amount);
      setSelected(updated);
      await loadReport();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setUpdating(false);
    }
  }

  function exportReport(format: 'pdf' | 'excel') {
    if (!loaded) return;
    void (async () => {
      const exportItems =
        listTotal > vouchers.length
          ? (
              await api.listVouchers({
                fromDate,
                toDate,
                type: voucherType === 'all' ? undefined : voucherType,
                ...(financialYearId != null ? { financialYearId } : {}),
                limit: listTotal,
                offset: 0,
              })
            ).items
          : vouchers;
      const headers = ['Voucher #', 'Date', 'Type', 'From/Debit', 'To/Credit', 'Amount', 'Ref#', 'Status'];
      const rows = exportItems.map((v) => [
      formatVoucherNumber(v.number, v.type),
      formatDate(v.date),
      formatVoucherTypeLabel(v.type),
      voucherFromAccount(v),
      voucherToAccount(v),
      formatLedgerAmount(v.amount),
      v.reference ?? '',
      v.status === 'CANCELLED' ? 'Cancelled' : 'Active',
    ]);
    rows.push(['Total', '', '', '', '', formatLedgerAmount(exportItems.reduce((sum, v) => sum + Number(v.amount), 0)), '', '']);
    const base = `vouchers-${fromDate}-to-${toDate}`;
    if (format === 'excel') {
      downloadExcel(`${base}.xlsx`, 'Vouchers', headers, rows);
    } else {
      await downloadPdf(`${base}.pdf`, 'Vouchers Report', headers, rows, {
        letterheadElement: letterheadRef.current,
        orientation: 'landscape',
      });
    }
    })();
  }

  const vouchersSubtitle = historicalScope?.financialYearLabel
    ? `${historicalScope.financialYearLabel} · ${periodRangeLabel(fromDate, toDate, 'All dates')}`
    : periodRangeLabel(fromDate, toDate, 'All dates');

  const detailCard = selected ? (
    <VoucherDetailCard
      voucher={selected}
      onCancel={readOnly ? () => {} : handleCancel}
      onUpdateAmount={readOnly ? () => {} : handleUpdateAmount}
      cancelling={cancelling}
      updating={updating}
      readOnly={readOnly}
    />
  ) : null;

  const panel = (
    <ReportPanel embedded={embedded} title="Vouchers Report">
      <div className={reportFilterClass(embedded, 'vouchers')}>
          <div>
            <FieldLabel>From Date</FieldLabel>
            <TextInput type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <FieldLabel>To Date</FieldLabel>
            <TextInput type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div>
            <FieldLabel>Voucher Type</FieldLabel>
            <SegmentedControl
              ariaLabel="Voucher type"
              value={voucherType}
              onChange={setVoucherType}
              options={[
                { value: 'all', label: 'All' },
                { value: 'RECEIPT', label: 'Receipt' },
                { value: 'PAYMENT', label: 'Payment' },
                { value: 'JOURNAL', label: 'Journal' },
                { value: 'KACHI', label: 'Kachi' },
              ]}
            />
          </div>
          <FinancialButton type="button" onClick={() => loadReport(0)} disabled={loading}>
            {loading ? 'Loading…' : 'View'}
          </FinancialButton>
      </div>

      <div className={embedded ? 'fy-report-body' : undefined}>
        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

        {!loaded ? (
          <p className={reportEmptyClass(embedded)}>Set filters and click View</p>
        ) : (vouchers?.length ?? 0) === 0 ? (
          <p className={reportEmptyClass(embedded)}>No vouchers in this period</p>
        ) : (
          <div className="report-print-area">
            <ReportLetterhead ref={letterheadRef} title="Vouchers Report" subtitle={vouchersSubtitle} />
            <div className="mb-4 flex flex-wrap gap-2 print:hidden">
              <SecondaryButton type="button" onClick={() => exportReport('pdf')}>Download PDF</SecondaryButton>
              <SecondaryButton type="button" onClick={() => exportReport('excel')}>Download Excel</SecondaryButton>
            </div>
            <ReportTable minWidth="960px">
              <thead>
                <tr>
                  <th className="pr-2 text-right">Voucher #</th>
                  <th className="pr-2">Date</th>
                  <th className="pr-2">Type</th>
                  <th className={`pr-2 ${voucherSideLabelClass('From')}`}>From/Debit Account</th>
                  <th className={`pr-2 ${voucherSideLabelClass('To')}`}>To/Credit Account</th>
                  <th className="pr-2 text-right">Amount</th>
                  <th className="pr-2">Ref#</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(vouchers ?? []).map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => setSelected(v)}
                    className={`report-table-row--interactive ${
                      selected?.id === v.id ? 'report-table-row--selected' : ''
                    }`}
                  >
                    <td className="pr-2 text-right font-mono text-xs font-semibold text-financial">
                      {formatVoucherNumber(v.number, v.type)}
                    </td>
                    <td className="pr-2 whitespace-nowrap">{formatDate(v.date)}</td>
                    <td className={`pr-2 font-medium ${voucherTypeColorClass(v.type)}`}>
                      {formatVoucherTypeLabel(v.type)}
                    </td>
                    <td className={`pr-2 font-medium ${voucherFromColumnClass(v)}`}>{voucherFromAccount(v)}</td>
                    <td className={`pr-2 font-medium ${voucherToColumnClass(v)}`}>{voucherToAccount(v)}</td>
                    <td className="pr-2 text-right tabular-nums">{formatLedgerAmount(v.amount)}</td>
                    <td className="pr-2 text-textSecondary">{v.reference ?? ''}</td>
                    <td>
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                          v.status === 'CANCELLED'
                            ? 'bg-bgDanger text-danger'
                            : 'bg-bgSuccess text-success'
                        }`}
                      >
                        {v.status === 'CANCELLED' ? 'Cancelled' : 'Active'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Page total</td>
                  <td className="text-right tabular-nums">{formatLedgerAmount(totals.totalAmount)}</td>
                  <td colSpan={2} />
                </tr>
                {voucherType === 'all' ? (
                  <tr className="text-sm text-textSecondary">
                    <td colSpan={8}>
                      Page — Payments: {formatLedgerAmount(totals.byType.PAYMENT)} · Receipts:{' '}
                      {formatLedgerAmount(totals.byType.RECEIPT)} · Journal:{' '}
                      {formatLedgerAmount(totals.byType.JOURNAL)} · Kachi:{' '}
                      {formatLedgerAmount(totals.byType.KACHI)}
                    </td>
                  </tr>
                ) : null}
              </tfoot>
            </ReportTable>
            <ListPagination
              total={listTotal}
              offset={listOffset}
              onPageChange={(nextOffset) => void loadReport(nextOffset)}
              className="mt-4"
            />
          </div>
        )}
      </div>
      {embedded && detailCard ? <div className="fy-report-detail print:hidden">{detailCard}</div> : null}
    </ReportPanel>
  );

  if (embedded) {
    return panel;
  }

  return (
    <PageShell title="Vouchers Report" subtitle="Filter and review posted vouchers">
      {panel}
      {detailCard ? <div className="print:hidden">{detailCard}</div> : null}
      <PageCloseBar />
    </PageShell>
  );
}

type ProfitLossResult = Awaited<ReturnType<typeof api.getProfitLossReport>>;

export function ProfitLossStatementPage() {
  const { years } = useFinancialYear();
  const financialYearId = useReportFinancialYearId();
  const selectedYear = useMemo(
    () => years.find((y) => y.id === financialYearId) ?? null,
    [years, financialYearId],
  );
  const fyMinDate = selectedYear ? isoToDateInput(selectedYear.startDate) : undefined;
  const fyMaxDate = selectedYear
    ? isoToDateInput(selectedYear.endDate ?? new Date().toISOString())
    : undefined;

  const [fromDate, setFromDate] = useState(todayInputValue);
  const [toDate, setToDate] = useState(todayInputValue);
  const [productId, setProductId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [products, setProducts] = useState<Array<{ id: number; name: string; code: string; categoryId: number | null }>>([]);
  const [productCategories, setProductCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [report, setReport] = useState<ProfitLossResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const letterheadRef = useRef<HTMLElement>(null);

  useEffect(() => {
    Promise.all([api.listProducts({ lite: true }), api.listProductCategories()])
      .then(([productRows, categoryRows]) => {
        setProducts(productRows.map((p) => ({ id: p.id, name: p.name, code: p.code, categoryId: p.categoryId ?? null })));
        setProductCategories(categoryRows.map((c) => ({ id: c.id, name: c.name })));
      })
      .catch(() => {
        setProducts([]);
        setProductCategories([]);
      });
  }, []);

  async function loadReport(nextFrom = fromDate, nextTo = toDate, nextProductId = productId, nextCategoryId = categoryId) {
    if (financialYearId == null) {
      setError('Select a financial year under Reports > Financial Year');
      return;
    }
    if ((nextFrom && !nextTo) || (!nextFrom && nextTo)) {
      setError('Select both from and to dates, or clear the filter for the full financial year');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await api.getProfitLossReport({
        financialYearId,
        fromDate: nextFrom || undefined,
        toDate: nextTo || undefined,
        productId: nextProductId ? Number(nextProductId) : undefined,
        categoryId: nextCategoryId ? Number(nextCategoryId) : undefined,
      });
      setReport(result);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
      setReport(null);
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const today = todayInputValue();
    const clamped = clampDateInput(today, fyMinDate, fyMaxDate) || today;
    setFromDate(clamped);
    setToDate(clamped);
    setProductId('');
    setCategoryId('');
    setError('');
    if (financialYearId == null) {
      setLoaded(false);
      setReport(null);
      return;
    }
    void loadReport(clamped, clamped, '', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed today's range once per FY
  }, [financialYearId, fyMinDate, fyMaxDate]);

  function clearFilters() {
    setFromDate('');
    setToDate('');
    setProductId('');
    setCategoryId('');
    void loadReport('', '', '', '');
  }

  function onProductCategoryChange(value: string) {
    setCategoryId(value);
    setProductId('');
  }

  const productSelectOptions = useMemo(() => {
    const rows = categoryId
      ? products.filter((p) => String(p.categoryId ?? '') === categoryId)
      : products;
    return rows.map((p) => ({ value: String(p.id), label: `${p.code} — ${p.name}` }));
  }, [products, categoryId]);

  function exportReport(format: 'pdf' | 'excel') {
    if (!report) return;
    void (async () => {
    const headers = ['Date', 'Product Name', 'Reference', 'Purchase Price', 'Sale Price', 'Profit'];
    const rows = report.rows.map((row) => [
      formatDate(row.date),
      row.productName,
      row.reference,
      formatProfitLossPrice(row.purchasePrice),
      formatProfitLossPrice(row.salePrice),
      formatLedgerAmount(row.profit),
    ]);
    rows.push(['Total', '', '', formatLedgerAmount(report.totalPurchase), formatLedgerAmount(report.totalSale), formatLedgerAmount(report.netProfit)]);
    const base = `profit-loss-${report.financialYearLabel.replace(/\s+/g, '-')}`;
    if (format === 'excel') {
      downloadExcel(`${base}.xlsx`, 'Profit & Loss', headers, rows);
    } else {
      await downloadPdf(`${base}.pdf`, 'Profit & Loss Statement', headers, rows, {
        letterheadElement: letterheadRef.current,
        orientation: 'landscape',
      });
    }
    })();
  }

  const periodSubtitle = periodRangeLabel(fromDate, toDate, 'Full financial year');
  const filterSubtitle = [
    periodSubtitle,
    categoryId ? productCategories.find((c) => String(c.id) === categoryId)?.name : null,
    productId ? products.find((p) => String(p.id) === productId)?.name : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <PageShell title="Profit & Loss Statement" subtitle="Sale invoice profit/loss and Kachi Maal daami">
      <Panel className="overflow-visible">
        <div className="mb-4 print:hidden">
          <div className={reportFilterClass(false, 'profitLoss')}>
            <div>
              <FieldLabel>From Date</FieldLabel>
              <TextInput
                type="date"
                value={fromDate}
                min={fyMinDate}
                max={fyMaxDate}
                onChange={(e) => setFromDate(clampDateInput(e.target.value, fyMinDate, fyMaxDate))}
              />
            </div>
            <div>
              <FieldLabel>To Date</FieldLabel>
              <TextInput
                type="date"
                value={toDate}
                min={fromDate || fyMinDate}
                max={fyMaxDate}
                onChange={(e) => setToDate(clampDateInput(e.target.value, fromDate || fyMinDate, fyMaxDate))}
              />
            </div>
            <div>
              <FieldLabel>Product Category</FieldLabel>
              <SearchSelect
                value={categoryId}
                onChange={onProductCategoryChange}
                options={[
                  { value: '', label: 'All categories' },
                  ...productCategories.map((c) => ({ value: String(c.id), label: c.name })),
                ]}
                placeholder="All categories"
              />
            </div>
            <div>
              <FieldLabel>Product</FieldLabel>
              <SearchSelect
                value={productId}
                onChange={setProductId}
                options={[{ value: '', label: 'All products' }, ...productSelectOptions]}
                placeholder={categoryId ? 'Products in category…' : 'All products'}
              />
            </div>
            <SecondaryButton
              type="button"
              onClick={clearFilters}
              disabled={!fromDate && !toDate && !productId && !categoryId}
            >
              Clear filters
            </SecondaryButton>
            <PrimaryButton type="button" onClick={() => void loadReport()} disabled={loading}>
              {loading ? 'Loading…' : 'Load Report'}
            </PrimaryButton>
          </div>
        </div>

        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

        {!loaded ? (
          <p className="text-sm text-textSecondary">
            {financialYearId == null ? 'Loading financial year…' : 'Loading profit & loss…'}
          </p>
        ) : report && report.rows.length === 0 ? (
          <p className="text-sm text-textSecondary">No records found for selected range</p>
        ) : report ? (
          <div className="report-print-area">
            <ReportLetterhead
              ref={letterheadRef}
              title="Profit & Loss Statement"
              subtitle={`${report.financialYearLabel} · ${filterSubtitle}`}
            />
            <div className="mb-4 flex flex-wrap gap-2 print:hidden">
              <SecondaryButton type="button" onClick={() => exportReport('pdf')}>Download PDF</SecondaryButton>
              <SecondaryButton type="button" onClick={() => exportReport('excel')}>Download Excel</SecondaryButton>
            </div>
            <ReportTable>
              <thead>
                <tr>
                  <th className="pr-3">Date</th>
                  <th className="pr-3">Product Name</th>
                  <th className="pr-3">Reference</th>
                  <th className="pr-3 text-right">Purchase Price</th>
                  <th className="pr-3 text-right">Sale Price</th>
                  <th className="text-right">Profit</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, index) => (
                  <tr key={`${row.sourceType}-${row.reference}-${row.productName}-${index}`}>
                    <td className="pr-3 whitespace-nowrap">{formatDate(row.date)}</td>
                    <td className="pr-3">{row.productName}</td>
                    <td className="pr-3 font-mono text-xs">{row.reference}</td>
                    <td className="pr-3 text-right tabular-nums">{formatProfitLossPrice(row.purchasePrice)}</td>
                    <td className="pr-3 text-right tabular-nums">{formatProfitLossPrice(row.salePrice)}</td>
                    <td
                      className={`text-right tabular-nums font-medium ${
                        row.profit >= 0 ? ledgerCreditAmountClass(true) : ledgerDebitAmountClass(true)
                      }`}
                    >
                      {formatLedgerAmount(row.profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="report-table-row--emphasis">
                  <td colSpan={3}>Total</td>
                  <td className="pr-3 text-right tabular-nums font-semibold">
                    {formatLedgerAmount(report.totalPurchase)}
                  </td>
                  <td className="pr-3 text-right tabular-nums font-semibold">
                    {formatLedgerAmount(report.totalSale)}
                  </td>
                  <td
                    className={`text-right tabular-nums font-semibold ${
                      report.netProfit >= 0 ? ledgerCreditAmountClass(true) : ledgerDebitAmountClass(true)
                    }`}
                  >
                    {formatLedgerAmount(report.netProfit)}
                  </td>
                </tr>
              </tfoot>
            </ReportTable>
          </div>
        ) : null}
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}
