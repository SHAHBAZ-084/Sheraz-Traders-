import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { formatAmount } from '../../lib/format';

type Props = {
  /** Currently selected product id on the invoice form (string, may be empty). */
  productId: string;
  /** Currently selected store id on the invoice form (string, may be empty). */
  storeId: string;
};

type InsightState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; averageRate: number | null; storeStock: number; storeName: string };

/**
 * Small ⓘ info icon + popover for Sale Invoice product lookup.
 * Prefetches when product/store selection changes; refreshes live when opened.
 */
export function ProductInsightPopover({ productId, storeId }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<InsightState>({ status: 'idle' });
  const containerRef = useRef<HTMLDivElement>(null);
  const fetchGenRef = useRef(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadInsight = useCallback(async (opts?: { silent?: boolean }) => {
    if (!productId) {
      setState({ status: 'idle' });
      return;
    }
    if (!storeId) {
      setState({ status: 'error' });
      return;
    }

    const gen = ++fetchGenRef.current;
    if (!opts?.silent) {
      setState({ status: 'loading' });
    }

    try {
      const insight = await api.getProductInsight(Number(productId), Number(storeId));
      if (gen !== fetchGenRef.current) return;
      setState({
        status: 'ready',
        averageRate: insight.averageRate,
        storeStock: insight.storeStock,
        storeName: insight.storeName,
      });
    } catch {
      if (gen !== fetchGenRef.current) return;
      setState({ status: 'error' });
    }
  }, [productId, storeId]);

  // Prefetch when product or store changes — avoids stale data from prior selection.
  useEffect(() => {
    setOpen(false);
    fetchGenRef.current += 1;
    if (!productId) {
      setState({ status: 'idle' });
      return;
    }
    void loadInsight();
  }, [productId, storeId, loadInsight]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  if (!productId) return null;

  function clearCloseTimer() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setOpen(false), 150);
  }

  function handleOpen() {
    clearCloseTimer();
    setOpen(true);
    void loadInsight();
  }

  function handleToggleClick() {
    if (open) {
      setOpen(false);
    } else {
      handleOpen();
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative inline-flex shrink-0 items-center"
      onMouseEnter={handleOpen}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        onClick={handleToggleClick}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[13px] leading-none text-textSecondary hover:bg-financial/10 hover:text-financial transition-colors"
        aria-label="Product stock and average cost"
        title="Stock & average cost"
      >
        ⓘ
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-border bg-surface p-3 shadow-lg text-sm"
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
        >
          {state.status === 'loading' && (
            <p className="text-textSecondary text-xs">Loading…</p>
          )}

          {state.status === 'error' && (
            <div className="space-y-1 text-xs">
              <p>
                <span className="text-textSecondary">Current stock: </span>
                <span className="text-textMuted">—</span>
              </p>
              <p>
                <span className="text-textSecondary">Average price: </span>
                <span className="text-textMuted">Unable to load</span>
              </p>
            </div>
          )}

          {state.status === 'ready' && (
            <div className="space-y-1.5 text-xs">
              <p>
                <span className="text-textSecondary">Current stock</span>
                <span className="text-textMuted"> ({state.storeName}): </span>
                <span className="font-semibold tabular-nums">{formatAmount(state.storeStock)}</span>
              </p>
              <p>
                <span className="text-textSecondary">Average price: </span>
                {state.averageRate == null ? (
                  <span className="text-textMuted">—</span>
                ) : (
                  <span className="font-semibold tabular-nums">Rs {formatAmount(state.averageRate)}</span>
                )}
              </p>
            </div>
          )}

          {state.status === 'idle' && !storeId && (
            <p className="text-xs text-textSecondary">Select a store to see stock.</p>
          )}
        </div>
      )}
    </div>
  );
}
