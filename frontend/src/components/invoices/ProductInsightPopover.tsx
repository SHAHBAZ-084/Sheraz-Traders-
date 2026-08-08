import { Info } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
  | { status: 'error'; message: string }
  | { status: 'ready'; averageRate: number | null; storeStock: number; storeName: string };

/**
 * Small (i) info icon + popover shown next to a "Product" field on Sale/Purchase Invoice.
 * Read-only lookup only — never touches quantity/rate/total or ledger posting logic.
 */
export function ProductInsightPopover({ productId, storeId }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<InsightState>({ status: 'idle' });
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Nothing to look up yet — hide the icon entirely.
  if (!productId) return null;

  async function handleToggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;

    if (!storeId) {
      setState({ status: 'error', message: 'Select a store to see stock' });
      return;
    }

    setState({ status: 'loading' });
    try {
      const insight = await api.getProductInsight(Number(productId), Number(storeId));
      setState({
        status: 'ready',
        averageRate: insight.averageRate,
        storeStock: insight.storeStock,
        storeName: insight.storeName,
      });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to load product info',
      });
    }
  }

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={handleToggle}
        className="inline-flex items-center justify-center rounded-full text-textSecondary hover:text-financial hover:bg-financial/10 transition-colors p-0.5"
        aria-label="Product info"
      >
        <Info size={14} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-border bg-surface p-3 shadow-lg text-sm">
          {state.status === 'loading' && <p className="text-textSecondary">Loading…</p>}

          {state.status === 'error' && <p className="text-textSecondary">{state.message}</p>}

          {state.status === 'ready' && (
            <div className="space-y-1.5">
              <p>
                {state.averageRate == null ? (
                  <span className="text-textSecondary">No purchase history for this product</span>
                ) : (
                  <>
                    <span className="text-textSecondary">Avg. purchase rate: </span>
                    <span className="font-semibold">Rs {formatAmount(state.averageRate)}</span>
                  </>
                )}
              </p>
              <p>
                <span className="text-textSecondary">In stock ({state.storeName}): </span>
                <span className="font-semibold">{formatAmount(state.storeStock)}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
