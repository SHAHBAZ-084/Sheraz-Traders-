import { api, Account, AccountCategory, Product, SystemPreferences } from './api';

export type InvoiceFormBaseData = {
  accounts: Account[];
  categories: AccountCategory[];
  prefs: SystemPreferences;
  products?: Product[];
};

/** Shared bootstrap for invoice forms — accounts/categories/prefs (and optional products). */
export async function loadInvoiceFormBase(options?: {
  includeProducts?: boolean;
}): Promise<InvoiceFormBaseData> {
  if (options?.includeProducts) {
    const [accounts, categories, prefs, products] = await Promise.all([
      api.listAccounts(),
      api.listCategories(),
      api.getSystemPreferences(),
      api.listProducts(),
    ]);
    return { accounts, categories, prefs, products };
  }

  const [accounts, categories, prefs] = await Promise.all([
    api.listAccounts(),
    api.listCategories(),
    api.getSystemPreferences(),
  ]);
  return { accounts, categories, prefs };
}

export function invoiceLoadErrorMessage(err: unknown, fallback = 'Failed to load accounts or preferences') {
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}
