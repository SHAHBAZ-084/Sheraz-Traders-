import type { ReactNode } from 'react';

/** Minimum height for grids that already have data rows. */
export const INVOICE_GRID_MIN_VISIBLE_ROWS = 3;

export function InvoicePreviewGridShell({
  children,
  empty,
  isEmpty = false,
}: {
  children?: ReactNode;
  /** Shown when isEmpty — replaces blank placeholder rows. */
  empty?: ReactNode;
  isEmpty?: boolean;
}) {
  if (isEmpty) {
    return (
      <div className="inv-preview-grid inv-preview-grid--empty" role="status">
        {empty ?? <p className="inv-preview-empty-msg">No rows added yet</p>}
      </div>
    );
  }

  return <div className="inv-preview-grid">{children}</div>;
}

/** @deprecated Prefer empty-state via InvoicePreviewGridShell isEmpty — kept for partial fills. */
export function InvoiceGridPlaceholderRows({
  columnCount,
  dataRowCount,
  minRows = INVOICE_GRID_MIN_VISIBLE_ROWS,
}: {
  columnCount: number;
  dataRowCount: number;
  minRows?: number;
}) {
  if (dataRowCount === 0) return null;
  const placeholderCount = Math.max(0, minRows - dataRowCount);
  return (
    <>
      {Array.from({ length: placeholderCount }, (_, rowIndex) => (
        <tr
          key={`grid-placeholder-${rowIndex}`}
          className="border-b border-border/40"
          aria-hidden="true"
        >
          {Array.from({ length: columnCount }, (_, colIndex) => (
            <td key={colIndex} className="px-3 py-2">
              {'\u00A0'}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
