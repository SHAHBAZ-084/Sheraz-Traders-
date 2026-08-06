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
  const getById = useMinimizedFormsStore((s) => s.getById);
  const discard = useMinimizedFormsStore((s) => s.discard);

  const restoreId = (location.state as RestoreLocationState | null)?.minimizedFormId;

  const [restoredState, setRestoredState] = useState<T | null>(() => {
    if (!restoreId) return null;
    const entry = getById(restoreId);
    if (!entry || entry.kind !== kind) return null;
    return entry.formState as T;
  });

  useEffect(() => {
    if (!restoreId) return;
    const entry = getById(restoreId);
    if (entry && entry.kind === kind) {
      setRestoredState(entry.formState as T);
      discard(restoreId);
    }
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, restoreId, navigate, getById, discard, kind]);

  const minimize = useCallback(
    (formState: T, label: string) => {
      minimizeIntoStore({ kind, label, formState });
      navigate('/');
    },
    [kind, minimizeIntoStore, navigate],
  );

  return { restoredState, minimize };
}
