import type { Account, AccountCategory } from './api';

/** Sale Party and Purchase Party ledger categories (includes legacy names for backward compatibility). */
export const PARTY_ACCOUNT_CATEGORIES = [
  'Sale Party',
  'Purchase Party',
  'Int. Purchase Party',
  'Ext. Purchase Party',
] as const;

export function flatPartyAccountOptions(categories: AccountCategory[], accounts: Account[]) {
  const safeCats = Array.isArray(categories) ? categories : [];
  const safeAccs = Array.isArray(accounts) ? accounts : [];
  const allowedNames = new Set<string>(PARTY_ACCOUNT_CATEGORIES);
  const allowedCategoryIds = new Set(
    safeCats.filter((c) => allowedNames.has(c.name)).map((c) => c.id),
  );
  return safeAccs
    .filter((a) => allowedCategoryIds.has(a.categoryId))
    .map((a) => ({ value: String(a.id), label: a.name }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}
