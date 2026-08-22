import type { Account, AccountCategory } from './api';

export function isBankOrCashCategory(name: string) {
  const n = name.trim().toLowerCase();
  return n.includes('bank') || n.includes('cash');
}

export function bankCashCategoryOptions(categories: AccountCategory[]) {
  const filtered = categories.filter((c) => isBankOrCashCategory(c.name));
  return (filtered.length > 0 ? filtered : categories).map((c) => ({
    value: String(c.id),
    label: c.name,
  }));
}

export function bankCashAccountOptions(accounts: Account[], categoryId: string) {
  if (!categoryId) return [];
  return accounts
    .filter((a) => String(a.categoryId) === categoryId)
    .map((a) => ({ value: String(a.id), label: a.name }));
}
