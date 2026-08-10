import { BROWSE_PAGE_SIZE, browsePageCount, browsePageRange } from '../../lib/pagination';
import { SecondaryButton } from './PageShell';

export function ListPagination({
  total,
  offset,
  pageSize = BROWSE_PAGE_SIZE,
  onPageChange,
  className = '',
}: {
  total: number;
  offset: number;
  pageSize?: number;
  onPageChange: (offset: number) => void;
  className?: string;
}) {
  if (total <= pageSize) return null;

  const page = Math.floor(offset / pageSize) + 1;
  const totalPages = browsePageCount(total, pageSize);
  const { from, to } = browsePageRange(offset, total, pageSize);

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 print:hidden ${className}`.trim()} data-report-export-hide>
      <p className="text-sm text-textSecondary">
        Showing {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        <SecondaryButton
          type="button"
          disabled={offset <= 0}
          onClick={() => onPageChange(Math.max(0, offset - pageSize))}
        >
          Previous
        </SecondaryButton>
        <span className="text-sm tabular-nums text-textSecondary">
          Page {page} of {totalPages}
        </span>
        <SecondaryButton
          type="button"
          disabled={offset + pageSize >= total}
          onClick={() => onPageChange(offset + pageSize)}
        >
          Next
        </SecondaryButton>
      </div>
    </div>
  );
}
