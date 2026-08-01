import { useEffect, useMemo, useState } from 'react';
import { api, type Account, type AccountCategory, type Voucher } from '../../lib/api';
import { formatDate, formatLedgerAmount, formatLedgerBalance, formatVoucherNumber, formatVoucherTypeLabel, voucherTypeColorClass } from '../../lib/format';
import { downloadExcel, downloadPdf } from '../../lib/reportExport';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { FieldLabel, FinancialButton, PageShell, Panel, PrimaryButton, SecondaryButton, TextInput } from '../../components/ui/PageShell';
import { PageCloseBar } from '../../components/ui/PageCloseBar';
import { VoucherDetailCard } from '../vouchers/VoucherPages';

type LedgerResult = Awaited<ReturnType<typeof api.getLedger>>;
type AccountBalanceResult = Awaited<ReturnType<typeof api.getAccountBalanceReport>>;

function todayInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthStartInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function monthEndInputValue() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
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

export function AccountReportsPage() {
  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [ledger, setLedger] = useState<LedgerResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    setError('');
  }

  function onAccountChange(nextAccountId: string) {
    setAccountId(nextAccountId);
    setLoaded(false);
    setLedger(null);
    setError('');
  }

  async function loadLedger() {
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
      });
      setLedger(result);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ledger');
      setLedger(null);
    } finally {
      setLoading(false);
    }
  }

  function exportLedger(format: 'pdf' | 'excel') {
    if (!ledger) return;
    const accountName = ledger.account.name;
    const period = [fromDate, toDate].filter(Boolean).join(' to ') || 'All dates';
    const title = `Account Ledger — ${accountName} (${period})`;
    const headers = ['Date', 'Voucher#', 'Ref#', 'Type', 'Description', 'Debit', 'Credit', 'Balance'];
    const rows = ledger.rows.map((r) => [
      formatDate(r.date),
      r.voucherNo,
      r.ref ?? '',
      r.type,
      r.description,
      r.debit > 0 ? formatLedgerAmount(r.debit) : '',
      r.credit > 0 ? formatLedgerAmount(r.credit) : '',
      formatLedgerBalance(r.balance),
    ]);
    rows.push([
      'Total / Closing',
      '',
      '',
      '',
      '',
      formatLedgerAmount(ledger.summary.totalDebit),
      formatLedgerAmount(ledger.summary.totalCredit),
      formatLedgerBalance(ledger.summary.closingBalance),
    ]);
    const safeName = accountName.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
    const base = `ledger-${safeName || 'account'}`;
    if (format === 'excel') {
      downloadExcel(`${base}.xlsx`, 'Ledger', headers, rows);
    } else {
      downloadPdf(`${base}.pdf`, title, headers, rows);
    }
  }

  return (
    <PageShell title="Account Ledger" subtitle="View ledger entries for any account">
      <Panel className="overflow-visible">
        <h2 className="mb-4 text-lg font-semibold text-textPrimary">Account Ledger</h2>
        <div className="mb-4 grid gap-4 overflow-visible sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto] xl:items-end">
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
          <PrimaryButton type="button" onClick={loadLedger} disabled={loading}>
            {loading ? 'Loading…' : 'Load Ledger'}
          </PrimaryButton>
        </div>

        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

        {!loaded ? (
          <p className="text-sm text-textSecondary">Select a category and account, then click Load Ledger</p>
        ) : ledger && ledger.rows.length === 0 ? (
          <p className="text-sm text-textSecondary">No entries in this period</p>
        ) : ledger ? (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <SecondaryButton type="button" onClick={() => exportLedger('pdf')}>Download PDF</SecondaryButton>
              <SecondaryButton type="button" onClick={() => exportLedger('excel')}>Download Excel</SecondaryButton>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[7.5rem]" />
                  <col className="w-[5.75rem]" />
                  <col className="w-[6.5rem]" />
                  <col className="w-[5.5rem]" />
                  <col />
                  <col className="w-[5.5rem]" />
                  <col className="w-[5.5rem]" />
                  <col className="w-[6.5rem]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-border text-textSecondary">
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-4 text-right">Voucher#</th>
                    <th className="py-2 pl-3 pr-2">Ref#</th>
                    <th className="py-2 pr-2">Type</th>
                    <th className="py-2 pr-2">Description</th>
                    <th className="py-2 pr-2 text-right">Debit</th>
                    <th className="py-2 pr-2 text-right">Credit</th>
                    <th className="py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.rows.map((r, i) => (
                    <tr key={i} className={`border-b border-border ${r.isOpeningRow ? 'bg-surface1 font-medium' : ''}`}>
                      <td className="py-2 pr-2 align-top whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="py-2 pr-4 align-top text-right font-mono text-xs font-semibold text-financial">{r.voucherNo}</td>
                      <td className="py-2 pl-3 pr-2 align-top truncate text-textSecondary" title={r.ref ?? ''}>{r.ref ?? ''}</td>
                      <td className={`py-2 pr-2 align-top font-medium ${voucherTypeColorClass(r.type)}`}>{formatVoucherTypeLabel(r.type)}</td>
                      <td className="py-2 pr-2 align-top whitespace-normal break-words text-textSecondary">{r.description}</td>
                      <td className="py-2 pr-2 align-top text-right tabular-nums">{r.debit > 0 ? formatLedgerAmount(r.debit) : ''}</td>
                      <td className="py-2 pr-2 align-top text-right tabular-nums">{r.credit > 0 ? formatLedgerAmount(r.credit) : ''}</td>
                      <td className="py-2 align-top text-right font-medium tabular-nums text-accent">{formatLedgerBalance(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="py-2" colSpan={5}>Total / Closing</td>
                    <td className="py-2 text-right">{formatLedgerAmount(ledger.summary.totalDebit)}</td>
                    <td className="py-2 text-right">{formatLedgerAmount(ledger.summary.totalCredit)}</td>
                    <td className="py-2 text-right text-accent">{formatLedgerBalance(ledger.summary.closingBalance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : null}
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}

export function TrialBalancePage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getTrialBalance>> | null>(null);

  useEffect(() => {
    api.getTrialBalance().then(setData).catch(() => setData(null));
  }, []);

  function exportTrialBalance(format: 'pdf' | 'excel') {
    if (!data) return;
    const headers = ['Account', 'Debit', 'Credit'];
    const rows = data.accounts.map((row) => [
      row.accountName,
      row.debit.toFixed(2),
      row.credit.toFixed(2),
    ]);
    rows.push(['Total', data.totalDebit.toFixed(2), data.totalCredit.toFixed(2)]);
    const title = `Detail Trial Balance${data.isBalanced ? '' : ' (Out of balance)'}`;
    if (format === 'excel') {
      downloadExcel('trial-balance.xlsx', 'Trial Balance', headers, rows);
    } else {
      downloadPdf('trial-balance.pdf', title, headers, rows);
    }
  }

  return (
    <PageShell title="Detail Trial Balance" subtitle="Debit and credit totals by account">
      <Panel>
        {data ? (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <SecondaryButton type="button" onClick={() => exportTrialBalance('pdf')}>Download PDF</SecondaryButton>
              <SecondaryButton type="button" onClick={() => exportTrialBalance('excel')}>Download Excel</SecondaryButton>
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-textSecondary">
                  <th className="py-2">Account</th>
                  <th className="py-2 text-right">Debit</th>
                  <th className="py-2 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.map((row, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="py-2">{row.accountName}</td>
                    <td className="py-2 text-right">{row.debit.toFixed(2)}</td>
                    <td className="py-2 text-right">{row.credit.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-4 text-sm text-textSecondary">
              Total debit {data.totalDebit.toFixed(2)} · Total credit {data.totalCredit.toFixed(2)} ·{' '}
              {data.isBalanced ? 'Balanced' : 'Out of balance'}
            </p>
          </>
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
  const [bagType, setBagType] = useState<'BORI' | 'THELA'>('BORI');
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
          bagType,
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
    <PageShell title="Stock Report" subtitle="Bag stock by product — Sale Invoice / Purchase Invoice breakdown when filtered by store">
      <Panel>
        <div className="grid gap-3 md:grid-cols-5 md:items-end">
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
          <div>
            <FieldLabel>Bag type</FieldLabel>
            <SegmentedControl
              value={bagType}
              onChange={(v) => setBagType(v as 'BORI' | 'THELA')}
              options={[
                { value: 'BORI', label: 'Bori' },
                { value: 'THELA', label: 'Thela' },
              ]}
            />
          </div>
          <FinancialButton type="button" onClick={onLoad} disabled={loading}>
            {loading ? 'Loading…' : 'Show report'}
          </FinancialButton>
        </div>

        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

        {report ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-textSecondary">
              Tracking from {formatDate(report.trackingStartedAt)} onward.
              {!report.historicalBackfill
                ? ' Invoices saved before stock tracking started are not included.'
                : null}
              {' '}Carried loose remainder: {report.carriedRemainderKg} kg
              ({report.bagType === 'BORI' ? 'Bori' : 'Thela'}).
              {report.storeId
                ? ` Filtered to store: ${stores.find((s) => s.id === report.storeId)?.name ?? `#${report.storeId}`}.`
                : null}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-textSecondary">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Description</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3 text-right">Bags</th>
                    <th className="py-2 text-right">Running Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-textSecondary">
                        No stock movements for this product / bag type yet.
                      </td>
                    </tr>
                  ) : (
                    report.rows.map((row) => (
                      <tr key={row.id} className="border-b border-border">
                        <td className="py-2 pr-3 whitespace-nowrap">{formatDate(row.date)}</td>
                        <td className="py-2 pr-3">{row.description}</td>
                        <td className={`py-2 pr-3 font-medium ${row.status === 'IN' ? 'text-success' : 'text-danger'}`}>
                          {row.status}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{row.bags}</td>
                        <td className="py-2 text-right font-medium tabular-nums">{row.runningBalance}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="py-2 pr-3" colSpan={3}>
                      Total In {report.totals.totalIn} · Total Out {report.totals.totalOut}
                      {' · '}Sold (Sale Invoice) {report.totals.saleInvoiceQty}
                      {' · '}Purchased (Purchase Invoice) {report.totals.purchaseInvoiceQty}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums" />
                    <td className="py-2 text-right tabular-nums">
                      Net {report.totals.netBalance}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
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
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-border text-textSecondary">
          <th className="py-2 pr-3">Account Code</th>
          <th className="py-2 pr-3">Account Name</th>
          <th className="py-2 pr-3 text-right">Debit</th>
          <th className="py-2 pr-3 text-right">Credit</th>
          <th className="py-2 text-right">Balance</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.accountId} className="border-b border-border">
            <td className="py-2 pr-3 font-mono text-xs text-textSecondary">{row.accountCode}</td>
            <td className="py-2 pr-3">{row.accountName}</td>
            <td className="py-2 pr-3 text-right tabular-nums">
              {row.debit > 0 ? formatLedgerAmount(row.debit) : ''}
            </td>
            <td className="py-2 pr-3 text-right tabular-nums">
              {row.credit > 0 ? formatLedgerAmount(row.credit) : ''}
            </td>
            <td className="py-2 text-right font-medium tabular-nums text-accent">
              {formatLedgerBalance(row.balance)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-border font-semibold">
          <td className="py-2" colSpan={2}>Total</td>
          <td className="py-2 text-right tabular-nums">{formatLedgerAmount(totalDebit)}</td>
          <td className="py-2 text-right tabular-nums">{formatLedgerAmount(totalCredit)}</td>
          <td className="py-2" />
        </tr>
      </tfoot>
    </table>
  );
}

export function AccountBalancePage() {
  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [datedOn, setDatedOn] = useState(todayInputValue);
  const [categoryId, setCategoryId] = useState('');
  const [side, setSide] = useState<BalanceSideFilter>('both');
  const [report, setReport] = useState<AccountBalanceResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listCategories()
      .then((rows) => setCategories(rows.filter((c) => c.isActive)))
      .catch(() => setCategories([]));
  }, []);

  async function loadReport() {
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
      });
      setReport(result);
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
    const headers = ['Account Code', 'Account Name', 'Debit', 'Credit', 'Balance'];
    const rows = report.accounts.map((row) => [
      row.accountCode,
      row.accountName,
      row.debit > 0 ? formatLedgerAmount(row.debit) : '',
      row.credit > 0 ? formatLedgerAmount(row.credit) : '',
      formatLedgerBalance(row.balance),
    ]);
    rows.push([
      'Total',
      '',
      formatLedgerAmount(report.totalDebit),
      formatLedgerAmount(report.totalCredit),
      '',
    ]);
    const title = `Account Balance as of ${formatDate(datedOn)}`;
    const safeDate = datedOn.replace(/[^\d-]/g, '');
    const base = `account-balance-${safeDate}`;
    if (format === 'excel') {
      downloadExcel(`${base}.xlsx`, 'Account Balance', headers, rows);
    } else {
      downloadPdf(`${base}.pdf`, title, headers, rows);
    }
  }

  const showGrouped = !categoryId && (report?.groups.length ?? 0) > 0;

  return (
    <PageShell title="Account Balance" subtitle="Balances as of a selected date">
      <Panel className="overflow-visible">
        <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto] xl:items-end">
          <div>
            <FieldLabel>Dated On</FieldLabel>
            <TextInput type="date" value={datedOn} onChange={(e) => setDatedOn(e.target.value)} />
          </div>
          <div>
            <FieldLabel>Account Type</FieldLabel>
            <select
              className="w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-textPrimary"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">All Groups</option>
              {categories.map((c) => (
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
          <FinancialButton type="button" onClick={loadReport} disabled={loading}>
            {loading ? 'Loading…' : 'View'}
          </FinancialButton>
        </div>

        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

        {!loaded ? (
          <p className="text-sm text-textSecondary">Set filters and click View</p>
        ) : report && report.accounts.length === 0 ? (
          <p className="text-sm text-textSecondary">No accounts match these filters</p>
        ) : report ? (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <SecondaryButton type="button" onClick={() => exportReport('pdf')}>Download PDF</SecondaryButton>
              <SecondaryButton type="button" onClick={() => exportReport('excel')}>Download Excel</SecondaryButton>
            </div>
            <div className="overflow-x-auto">
              {showGrouped ? (
                <div className="space-y-6">
                  {report.groups.map((group) => (
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
                  <table className="w-full text-left text-sm">
                    <tfoot>
                      <tr className="border-t-2 border-border font-semibold">
                        <td className="py-2" colSpan={2}>Grand Total</td>
                        <td className="py-2 text-right tabular-nums">{formatLedgerAmount(report.totalDebit)}</td>
                        <td className="py-2 text-right tabular-nums">{formatLedgerAmount(report.totalCredit)}</td>
                        <td className="py-2" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <BalanceTable
                  rows={report.accounts}
                  totalDebit={report.totalDebit}
                  totalCredit={report.totalCredit}
                />
              )}
            </div>
          </>
        ) : null}
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}

export function VouchersReportPage() {
  const [fromDate, setFromDate] = useState(monthStartInputValue);
  const [toDate, setToDate] = useState(monthEndInputValue);
  const [voucherType, setVoucherType] = useState<VoucherTypeFilter>('all');
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Voucher | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [updating, setUpdating] = useState(false);

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

  async function loadReport() {
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
        limit: 500,
        offset: 0,
      });
      setVouchers(page.items);
      setListTotal(page.total);
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
    const headers = ['Voucher #', 'Date', 'Type', 'From/Debit', 'To/Credit', 'Amount', 'Ref#', 'Status'];
    const rows = vouchers.map((v) => [
      formatVoucherNumber(v.number, v.type),
      formatDate(v.date),
      formatVoucherTypeLabel(v.type),
      voucherFromAccount(v),
      voucherToAccount(v),
      formatLedgerAmount(v.amount),
      v.reference ?? '',
      v.status === 'CANCELLED' ? 'Cancelled' : 'Active',
    ]);
    rows.push(['Total', '', '', '', '', formatLedgerAmount(totals.totalAmount), '', '']);
    const title = `Vouchers ${fromDate} to ${toDate}`;
    const base = `vouchers-${fromDate}-to-${toDate}`;
    if (format === 'excel') {
      downloadExcel(`${base}.xlsx`, 'Vouchers', headers, rows);
    } else {
      downloadPdf(`${base}.pdf`, title, headers, rows);
    }
  }

  return (
    <PageShell title="Vouchers Report" subtitle="Filter and review posted vouchers">
      <Panel>
        <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
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
                { value: 'PAYMENT', label: 'Payment' },
                { value: 'RECEIPT', label: 'Receipt' },
                { value: 'JOURNAL', label: 'Journal' },
                { value: 'KACHI', label: 'Kachi' },
              ]}
            />
          </div>
          <FinancialButton type="button" onClick={loadReport} disabled={loading}>
            {loading ? 'Loading…' : 'View'}
          </FinancialButton>
        </div>

        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}
        {loaded && listTotal > vouchers.length ? (
          <p className="mb-4 text-sm text-amber-700">
            Showing first {vouchers.length} of {listTotal} vouchers in this period. Narrow the date
            range for complete totals.
          </p>
        ) : null}

        {!loaded ? (
          <p className="text-sm text-textSecondary">Set filters and click View</p>
        ) : vouchers.length === 0 ? (
          <p className="text-sm text-textSecondary">No vouchers in this period</p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <SecondaryButton type="button" onClick={() => exportReport('pdf')}>Download PDF</SecondaryButton>
              <SecondaryButton type="button" onClick={() => exportReport('excel')}>Download Excel</SecondaryButton>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-textSecondary">
                    <th className="py-2 pr-2 text-right">Voucher #</th>
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-2">Type</th>
                    <th className="py-2 pr-2">From/Debit Account</th>
                    <th className="py-2 pr-2">To/Credit Account</th>
                    <th className="py-2 pr-2 text-right">Amount</th>
                    <th className="py-2 pr-2">Ref#</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {vouchers.map((v) => (
                    <tr
                      key={v.id}
                      onClick={() => setSelected(v)}
                      className={`cursor-pointer border-b border-border transition hover:bg-surface1 ${
                        selected?.id === v.id ? 'bg-surface1' : ''
                      }`}
                    >
                      <td className="py-2 pr-2 text-right font-mono text-xs font-semibold text-financial">
                        {formatVoucherNumber(v.number, v.type)}
                      </td>
                      <td className="py-2 pr-2 whitespace-nowrap">{formatDate(v.date)}</td>
                      <td className={`py-2 pr-2 font-medium ${voucherTypeColorClass(v.type)}`}>
                        {formatVoucherTypeLabel(v.type)}
                      </td>
                      <td className="py-2 pr-2 text-textSecondary">{voucherFromAccount(v)}</td>
                      <td className="py-2 pr-2 text-textSecondary">{voucherToAccount(v)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{formatLedgerAmount(v.amount)}</td>
                      <td className="py-2 pr-2 text-textSecondary">{v.reference ?? ''}</td>
                      <td className="py-2">
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
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="py-2" colSpan={5}>Total</td>
                    <td className="py-2 text-right tabular-nums">{formatLedgerAmount(totals.totalAmount)}</td>
                    <td className="py-2" colSpan={2} />
                  </tr>
                  {voucherType === 'all' ? (
                    <tr className="border-t border-border text-sm text-textSecondary">
                      <td className="py-2" colSpan={8}>
                        Payments: {formatLedgerAmount(totals.byType.PAYMENT)} · Receipts:{' '}
                        {formatLedgerAmount(totals.byType.RECEIPT)} · Journal:{' '}
                        {formatLedgerAmount(totals.byType.JOURNAL)} · Kachi:{' '}
                        {formatLedgerAmount(totals.byType.KACHI)}
                      </td>
                    </tr>
                  ) : null}
                </tfoot>
              </table>
            </div>
          </>
        )}
      </Panel>

      {selected ? (
        <VoucherDetailCard
          voucher={selected}
          onCancel={handleCancel}
          onUpdateAmount={handleUpdateAmount}
          cancelling={cancelling}
          updating={updating}
        />
      ) : null}
      <PageCloseBar />
    </PageShell>
  );
}
