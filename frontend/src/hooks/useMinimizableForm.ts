import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  peekMinimizedRestorePayload,
  resolveMinimizedRestoreId,
  stashMinimizedRestorePayload,
} from './minimizedFormRestoreCache';
import {
  type MinimizedFormKind,
  useMinimizedFormsStore,
} from '../stores/minimizedFormsStore';

export type RestoreLocationState = {
  minimizedFormId?: string;
};

/**
 * Restore minimized draft on mount (via ?minimizedFormId= or location.state) and expose minimize().
 * Removes the tray entry when restored. Session-memory only.
 */
export function useMinimizableForm<T>(kind: MinimizedFormKind) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const minimizeIntoStore = useMinimizedFormsStore((s) => s.minimize);
  const claim = useMinimizedFormsStore((s) => s.claim);

  const [stableRestoreId] = useState(() =>
    resolveMinimizedRestoreId(searchParams, location.state as RestoreLocationState | null),
  );

  const [restoredState] = useState<T | null>(() => {
    if (!stableRestoreId) return null;

    const cached = peekMinimizedRestorePayload<T>(stableRestoreId);
    if (cached != null) return cached;

    const entry = claim(stableRestoreId);
    if (!entry || entry.kind !== kind) return null;

    stashMinimizedRestorePayload(stableRestoreId, entry.formState);
    return entry.formState as T;
  });

  useEffect(() => {
    if (!stableRestoreId) return;

    const params = new URLSearchParams(searchParams);
    if (params.has('minimizedFormId')) {
      params.delete('minimizedFormId');
      const qs = params.toString();
      navigate(
        { pathname: location.pathname, search: qs ? `?${qs}` : '' },
        { replace: true, state: {} },
      );
      return;
    }

    if ((location.state as RestoreLocationState | null)?.minimizedFormId) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [stableRestoreId, location.pathname, location.state, navigate, searchParams]);

  const minimize = useCallback(
    (formState: T, label: string) => {
      minimizeIntoStore({ kind, label, formState });
      navigate('/');
    },
    [kind, minimizeIntoStore, navigate],
  );

  return { restoredState, minimize };
}
