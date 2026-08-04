import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  type MinimizedFormKind,
  useMinimizedFormsStore,
} from '../stores/minimizedFormsStore';

export type RestoreLocationState = {
  minimizedFormId?: string;
};

/**
 * Restore minimized draft on mount (via location.state) and expose minimize().
 * Removes the tray entry when restored. Session-memory only.
 */
export function useMinimizableForm<T>(kind: MinimizedFormKind) {
  const navigate = useNavigate();
  const location = useLocation();
  const minimizeIntoStore = useMinimizedFormsStore((s) => s.minimize);
  const claim = useMinimizedFormsStore((s) => s.claim);

  const [restoredState, setRestoredState] = useState<T | null>(() => {
    const restoreId = (location.state as RestoreLocationState | null)?.minimizedFormId;
    if (!restoreId) return null;
    const entry = claim(restoreId);
    if (!entry || entry.kind !== kind) return null;
    return entry.formState as T;
  });

  useEffect(() => {
    const restoreId = (location.state as RestoreLocationState | null)?.minimizedFormId;
    if (!restoreId) return;
    const entry = claim(restoreId);
    if (entry && entry.kind === kind) {
      setRestoredState(entry.formState as T);
    }
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate, claim, kind]);

  const minimize = useCallback(
    (formState: T, label: string) => {
      minimizeIntoStore({ kind, label, formState });
      navigate('/');
    },
    [kind, minimizeIntoStore, navigate],
  );

  return { restoredState, minimize };
}
