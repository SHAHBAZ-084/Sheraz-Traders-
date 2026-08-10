import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { FyReportsShell, type FyReportTab } from '../../components/reports/FyReportsShell';
import { useFinancialYear } from '../../contexts/FinancialYearContext';
import { formatDate } from '../../lib/format';
import { PageShell, Panel } from '../../components/ui/PageShell';
import { PageCloseBar } from '../../components/ui/PageCloseBar';
import {
  AccountBalancePage,
  AccountReportsPage,
  VouchersReportPage,
  type HistoricalReportScope,
} from './ReportPages';

export function FinancialYearReportsPickerPage() {
  const navigate = useNavigate();
  const { years, activeYear, loading } = useFinancialYear();

  const closedYears = useMemo(
    () =>
      years
        .filter((y) => !y.isActive && y.status === 'CLOSED')
        .sort((a, b) => b.label.localeCompare(a.label, undefined, { sensitivity: 'base' })),
    [years],
  );

  return (
    <PageShell subtitle="Browse read-only ledger, vouchers, and account balance for a closed financial year">
      <Panel className="fy-reports-picker">
        {loading ? (
          <p className="fy-report-empty">Loading financial years…</p>
        ) : closedYears.length === 0 ? (
          <div className="fy-reports-picker-empty">
            <p className="text-sm text-textPrimary">
              No closed financial years yet. When a year is rolled over, its reports will appear here.
            </p>
            {activeYear ? (
              <p className="mt-2 text-sm text-textSecondary">
                Current year ({activeYear.label}) reports are available under Account Reports.
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <p className="fy-reports-picker-intro">
              Select a closed financial year to view its historical reports.
            </p>
            <ul className="fy-reports-year-list">
              {closedYears.map((year) => (
                <li key={year.id}>
                  <button
                    type="button"
                    className="fy-reports-year-list__item"
                    onClick={() => navigate(`/reports/financial-year/${year.id}`)}
                  >
                    <span className="fy-reports-year-list__main">
                      <span className="fy-reports-year-list__label">{year.label}</span>
                      <span className="fy-reports-year-list__dates">
                        {formatDate(year.startDate)}
                        {year.endDate ? ` — ${formatDate(year.endDate)}` : ''}
                      </span>
                    </span>
                    <span className="fy-reports-year-list__meta">
                      <span className="fy-reports-shell__badge">Closed</span>
                      <ChevronRight className="fy-reports-year-list__chevron" aria-hidden="true" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}

function FyReportTabContent({
  tab,
  historicalScope,
}: {
  tab: FyReportTab;
  historicalScope: HistoricalReportScope;
}) {
  if (tab === 'ledger') {
    return <AccountReportsPage historicalScope={historicalScope} embedded />;
  }
  if (tab === 'vouchers') {
    return <VouchersReportPage historicalScope={historicalScope} embedded />;
  }
  return <AccountBalancePage historicalScope={historicalScope} embedded />;
}

export function FinancialYearReportsHubPage() {
  const { yearId: yearIdParam } = useParams();
  const navigate = useNavigate();
  const { years, loading } = useFinancialYear();
  const [tab, setTab] = useState<FyReportTab>('ledger');

  const yearId = yearIdParam ? Number(yearIdParam) : NaN;
  const year = Number.isFinite(yearId) ? years.find((y) => y.id === yearId) : undefined;

  const historicalScope: HistoricalReportScope | undefined = useMemo(() => {
    if (!year) return undefined;
    return {
      financialYearId: year.id,
      financialYearLabel: year.label,
      readOnly: true,
    };
  }, [year]);

  if (!loading && (!year || year.isActive || year.status !== 'CLOSED')) {
    return <Navigate to="/reports/financial-year" replace />;
  }

  if (loading || !historicalScope || !year) {
    return (
      <PageShell subtitle="Loading financial year…">
        <Panel>
          <p className="fy-report-empty">Loading financial year…</p>
        </Panel>
        <PageCloseBar />
      </PageShell>
    );
  }

  return (
    <PageShell subtitle="Read-only historical reports for this closed financial year">
      <FyReportsShell
        yearLabel={year.label}
        startDate={year.startDate}
        endDate={year.endDate}
        tab={tab}
        onTabChange={setTab}
        onChangeYear={() => navigate('/reports/financial-year')}
      >
        <FyReportTabContent tab={tab} historicalScope={historicalScope} />
      </FyReportsShell>

      <p className="fy-reports-footnote print:hidden">
        To manage financial years (rollover, edit, delete), use{' '}
        <Link to="/user/fy-management" className="text-financial hover:underline">
          Financial Year Management
        </Link>{' '}
        (admin only).
      </p>
      <PageCloseBar />
    </PageShell>
  );
}
