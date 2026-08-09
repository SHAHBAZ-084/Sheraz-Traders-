import type { ReactNode } from 'react';

type ReportTableProps = {
  children: ReactNode;
  className?: string;
  tableClassName?: string;
  minWidth?: string;
};

/** Shared report table wrapper — white rows, bordered separators, distinct header row. */
export function ReportTable({
  children,
  className = '',
  tableClassName = '',
  minWidth,
}: ReportTableProps) {
  return (
    <div className={`report-table-wrap overflow-x-auto ${className}`.trim()}>
      <table
        className={`report-table ${tableClassName}`.trim()}
        style={minWidth ? { minWidth } : undefined}
      >
        {children}
      </table>
    </div>
  );
}
