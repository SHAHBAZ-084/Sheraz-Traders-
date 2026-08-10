import { ReactNode } from 'react';
import { formatDate } from '../../lib/format';
import { SecondaryButton } from '../ui/PageShell';
import { SegmentedControl } from '../ui/SegmentedControl';

export type FyReportTab = 'ledger' | 'vouchers' | 'balance';

type FyReportsShellProps = {
  yearLabel: string;
  startDate: string;
  endDate: string | null;
  tab: FyReportTab;
  onTabChange: (tab: FyReportTab) => void;
  onChangeYear: () => void;
  children: ReactNode;
};

export function FyReportsShell({
  yearLabel,
  startDate,
  endDate,
  tab,
  onTabChange,
  onChangeYear,
  children,
}: FyReportsShellProps) {
  const dateRange = endDate
    ? `${formatDate(startDate)} — ${formatDate(endDate)}`
    : formatDate(startDate);

  return (
    <div className="fy-reports-shell print:hidden">
      <div className="fy-reports-shell__header">
        <div className="fy-reports-shell__context">
          <p className="fy-reports-shell__eyebrow">Financial year</p>
          <p className="fy-reports-shell__year">{yearLabel}</p>
          <p className="fy-reports-shell__meta">
            <span>{dateRange}</span>
            <span className="fy-reports-shell__sep" aria-hidden="true">
              ·
            </span>
            <span className="fy-reports-shell__badge">Closed</span>
            <span className="fy-reports-shell__sep" aria-hidden="true">
              ·
            </span>
            <span>Read-only</span>
          </p>
        </div>
        <SecondaryButton type="button" className="fy-reports-shell__change-btn" onClick={onChangeYear}>
          Change year
        </SecondaryButton>
      </div>

      <div className="fy-reports-shell__tabs">
        <SegmentedControl
          ariaLabel="Financial year report type"
          value={tab}
          onChange={onTabChange}
          options={[
            { value: 'ledger', label: 'Ledger' },
            { value: 'vouchers', label: 'Vouchers' },
            { value: 'balance', label: 'Account Balance' },
          ]}
        />
      </div>

      <div className="fy-reports-shell__body">{children}</div>
    </div>
  );
}
