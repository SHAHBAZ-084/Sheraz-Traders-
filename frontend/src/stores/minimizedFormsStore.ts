import { create } from 'zustand';

export type MinimizedFormKind =
  | 'kachi-maal'
  | 'purchase-maal'
  | 'sale-paunch'
  | 'sale-commission'
  | 'payment'
  | 'receipt'
  | 'journal';

export type MinimizedForm = {
  id: string;
  kind: MinimizedFormKind;
  label: string;
  minimizedAt: number;
  formState: unknown;
};

type MinimizedFormsState = {
  forms: MinimizedForm[];
  minimize: (input: { kind: MinimizedFormKind; label: string; formState: unknown }) => string;
  discard: (id: string) => void;
  claim: (id: string) => MinimizedForm | null;
  getById: (id: string) => MinimizedForm | undefined;
};

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const MINIMIZED_FORM_ROUTES: Record<MinimizedFormKind, string> = {
  'kachi-maal': '/invoices/kachi-maal',
  'purchase-maal': '/invoices/purchase-maal',
  'sale-paunch': '/invoices/sale-paunch',
  'sale-commission': '/invoices/sale-commission',
  payment: '/vouchers/payment',
  receipt: '/vouchers/receipt',
  journal: '/vouchers/journal',
};

export const MINIMIZED_FORM_TITLES: Record<MinimizedFormKind, string> = {
  'kachi-maal': 'Kachi Maal',
  'purchase-maal': 'Purchase Maal',
  'sale-paunch': 'Sale on Paunch',
  'sale-commission': 'Sale on Commission',
  payment: 'Payment',
  receipt: 'Receipt',
  journal: 'Journal',
};

/** Session-scoped only — lost on refresh/restart. */
export const useMinimizedFormsStore = create<MinimizedFormsState>((set, get) => ({
  forms: [],
  minimize: ({ kind, label, formState }) => {
    const id = newId();
    const entry: MinimizedForm = {
      id,
      kind,
      label: label.trim() || MINIMIZED_FORM_TITLES[kind],
      minimizedAt: Date.now(),
      formState,
    };
    set((state) => ({ forms: [...state.forms, entry] }));
    return id;
  },
  discard: (id) => {
    set((state) => ({ forms: state.forms.filter((f) => f.id !== id) }));
  },
  claim: (id) => {
    const entry = get().forms.find((f) => f.id === id) ?? null;
    if (entry) {
      set((state) => ({ forms: state.forms.filter((f) => f.id !== id) }));
    }
    return entry;
  },
  getById: (id) => get().forms.find((f) => f.id === id),
}));
