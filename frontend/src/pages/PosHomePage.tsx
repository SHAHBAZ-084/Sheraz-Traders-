import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  BarChart3,
  BookOpen,
  Eye,
  Package,
  Receipt,
  ScrollText,
  Wallet,
  Wheat,
} from 'lucide-react';
import { INVOICE_QUICK_LINKS, REPORT_QUICK_LINKS, VOUCHER_QUICK_LINKS } from '../config/navigation';
import { LegacyTable, PageShell, Tile } from '../components/ui/PageShell';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { formatLedgerAmount, formatVoucherNumber, formatVoucherTypeLabel, voucherTypeColorClass } from '../lib/format';

type DashboardSummary = Awaited<ReturnType<typeof api.getDashboardSummary>>;

type QuickLinkVariant =
  | 'payment'
  | 'receipt'
  | 'journal'
  | 'kachi-maal'
  | 'view'
  | 'report';

const QUICK_LINK_META: Record<string, { variant: QuickLinkVariant; icon: LucideIcon }> = {
  '/vouchers/payment': { variant: 'payment', icon: ArrowUpCircle },
  '/vouchers/receipt': { variant: 'receipt', icon: ArrowDownCircle },
  '/vouchers/journal': { variant: 'journal', icon: BookOpen },
  '/invoices/kachi-maal': { variant: 'kachi-maal', icon: Wheat },
  '/invoices/view-invoice': { variant: 'view', icon: Eye },
  '/jama-naam': { variant: 'view', icon: ArrowLeftRight },
  '/reports/accounts': { variant: 'report', icon: ScrollText },
  '/reports/account-balance': { variant: 'report', icon: Wallet },
  '/reports/vouchers': { variant: 'report', icon: Receipt },
  '/reports/trial-balance': { variant: 'report', icon: BarChart3 },
  '/reports/stock': { variant: 'report', icon: Package },
};

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <Tile className="flex min-h-[4.5rem] min-w-0 flex-col justify-center">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-textMuted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-financial">{value}</p>
    </Tile>
  );
}

function QuickLink({
  to,
  title,
  description,
}: {
  to: string;
  title: string;
  description: string;
}) {
  const meta = QUICK_LINK_META[to] ?? { variant: 'view' as const, icon: Package };
  const Icon = meta.icon;

  return (
    <Link to={to} className={`quick-link-card quick-link-card--${meta.variant}`}>
      <div className="quick-link-card-inner">
        <Icon className="quick-link-icon h-4 w-4" strokeWidth={2} aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-financial">{title}</h3>
          <p className="mt-0.5 text-xs text-textSecondary">{description}</p>
        </div>
      </div>
    </Link>
  );
}

export function PosHomePage() {
  const { user } = useAuth();
  const isUserRole = user?.role === 'USER';
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (isUserRole) {
      setSummary(null);
      setLoadError('');
      return;
    }
    api
      .getDashboardSummary()
      .then(setSummary)
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load dashboard'));
  }, [isUserRole]);

  return (
    <PageShell subtitle="Today at a glance">
      {loadError ? <p className="text-sm text-danger">{loadError}</p> : null}

      {!isUserRole ? (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatBox
          label="Cash Balance"
          value={summary ? formatLedgerAmount(summary.cashBalance) : '—'}
        />
        <Tile className="flex min-h-[4.5rem] min-w-0 flex-col sm:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-textMuted">
              Stock bags
            </p>
            <Link to="/reports/stock" className="shrink-0 text-xs font-medium text-financial hover:underline">
              Stock Report
            </Link>
          </div>
          {!summary ? (
            <p className="mt-2 text-sm text-textMuted">Loading…</p>
          ) : (summary.productStock?.length ?? 0) === 0 ? (
            <p className="mt-2 text-sm text-textMuted">No bag stock yet.</p>
          ) : (
            <div className="mt-2 max-h-36 min-w-0 overflow-y-auto pr-1">
              <div
                className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-x-2 pb-1 text-xs font-medium text-textSecondary"
              >
                <span>Product</span>
                <span className="min-w-[2.5rem] text-center" title="Total bags on hand">
                  Bags
                </span>
                <span aria-hidden="true" />
              </div>
              <ul className="divide-y divide-border text-sm">
                {(summary.productStock ?? []).map((row) => {
                  const bags = row.totalQty ?? 0;
                  return (
                    <li
                      key={row.productId}
                      className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-x-2 py-1.5"
                    >
                      <span className="min-w-0 truncate text-left text-textPrimary" title={row.name}>
                        {row.name}
                      </span>
                      <span
                        className={`min-w-[2.5rem] text-center tabular-nums font-semibold ${
                          bags < 0 ? 'text-danger' : bags > 0 ? 'text-financial' : 'text-textSecondary'
                        }`}
                      >
                        {bags}
                      </span>
                      <span aria-hidden="true" />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Tile>
        <StatBox
          label="Vouchers Today"
          value={summary ? String(summary.vouchersToday) : '—'}
        />
      </div>
      ) : null}

      <div>
        <h2 className="legacy-section-title">New Voucher</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {VOUCHER_QUICK_LINKS.map((link) => (
            <QuickLink key={link.to} to={link.to} title={link.label} description="Open voucher form" />
          ))}
        </div>
      </div>

      <div>
        <h2 className="legacy-section-title">Invoices</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {INVOICE_QUICK_LINKS.map((link) => (
            <QuickLink
              key={link.to}
              to={link.to}
              title={link.label}
              description={
                link.to === '/invoices/view-invoice'
                  ? 'Look up a posted invoice by type and number'
                  : link.to === '/jama-naam'
                    ? 'Track informal borrow/lend bags (no stock or ledger impact)'
                    : 'Open invoice form'
              }
            />
          ))}
        </div>
      </div>

      {!isUserRole ? (
      <div>
        <h2 className="legacy-section-title">Reports</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {REPORT_QUICK_LINKS.map((link) => (
            <QuickLink key={link.to} to={link.to} title={link.label} description="Open report" />
          ))}
        </div>
      </div>
      ) : null}

      {!isUserRole ? <PanelSection summary={summary} /> : null}
    </PageShell>
  );
}

function PanelSection({ summary }: { summary: DashboardSummary | null }) {
  return (
    <div>
      <h2 className="legacy-section-title">Recent Vouchers</h2>
      {!summary ? (
        <p className="text-sm text-textMuted">Loading…</p>
      ) : (summary.recentVouchers?.length ?? 0) === 0 ? (
        <p className="text-sm text-textMuted">No vouchers posted yet this year.</p>
      ) : (
        <LegacyTable>
          <thead>
            <tr>
              <th>#</th>
              <th>Account</th>
              <th>Type</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(summary.recentVouchers ?? []).map((v) => (
              <tr key={v.id}>
                <td className="font-mono text-xs font-semibold text-financial">
                  {formatVoucherNumber(v.number, v.type)}
                </td>
                <td>{v.accountLabel}</td>
                <td className={`font-medium ${voucherTypeColorClass(v.type)}`}>
                  {formatVoucherTypeLabel(v.type)}
                </td>
                <td className="text-right font-medium tabular-nums">{formatLedgerAmount(v.amount)}</td>
              </tr>
            ))}
          </tbody>
        </LegacyTable>
      )}
    </div>
  );
}
