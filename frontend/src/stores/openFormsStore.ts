import { create } from 'zustand';
import { useMinimizedFormsStore } from './minimizedFormsStore';

type OpenFormsState = {
  openCount: number;
  registerOpenForm: () => () => void;
};

/** Tracks voucher/invoice form pages currently mounted (not minimized). */
export const useOpenFormsStore = create<OpenFormsState>((set, get) => ({
  openCount: 0,
  registerOpenForm: () => {
    set({ openCount: get().openCount + 1 });
    return () => set({ openCount: Math.max(0, get().openCount - 1) });
  },
}));

export function hasBlockingOpenForms(): boolean {
  const { forms } = useMinimizedFormsStore.getState();
  const { openCount } = useOpenFormsStore.getState();
  return forms.length > 0 || openCount > 0;
}
