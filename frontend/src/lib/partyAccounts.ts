import type { Account, AccountCategory } from './api';

/** Sale Party and Purchase Party ledger categories (includes legacy names for backward compatibility). */
export const PARTY_ACCOUNT_CATEGORIES = [
  'Sale Party',
  'Purchase Party',
  'Int. Purchase Party',
  'Ext. Purchase Party',
] as const;

/** Primary party categories shown in category pickers (Sale + Purchase). */
export const PRIMARY_PARTY_CATEGORY_NAMES = ['Sale Party', 'Purchase Party'] as const;

const LEGACY_PURCHASE_PARTY_NAMES = new Set([
  'Purchase Party',
  'Int. Purchase Party',
  'Ext. Purchase Party',
]);

export function primaryPartyCategorySelectOptions(categories: AccountCategory[]) {
  const safeCats = Array.isArray(categories) ? categories : [];
  const primary = new Set<string>(PRIMARY_PARTY_CATEGORY_NAMES);
  return safeCats
    .filter((c) => primary.has(c.name))
    .map((c) => ({ value: String(c.id), label: c.name }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

/** Accounts for a Sale Party or Purchase Party category (includes legacy purchase categories). */
export function partyAccountOptionsForPrimaryCategory(
  categories: AccountCategory[],
  accounts: Account[],
  categoryId: string,
) {
  if (!categoryId) return [];
  const safeCats = Array.isArray(categories) ? categories : [];
  const safeAccs = Array.isArray(accounts) ? accounts : [];
  const selected = safeCats.find((c) => String(c.id) === categoryId);
  if (!selected) return [];

  const allowedCategoryIds = new Set<number>();
  if (selected.name === 'Sale Party') {
    for (const cat of safeCats) {
      if (cat.name === 'Sale Party') allowedCategoryIds.add(cat.id);
    }
  } else if (LEGACY_PURCHASE_PARTY_NAMES.has(selected.name)) {
    for (const cat of safeCats) {
      if (LEGACY_PURCHASE_PARTY_NAMES.has(cat.name)) allowedCategoryIds.add(cat.id);
    }
  } else {
    allowedCategoryIds.add(selected.id);
  }

  return safeAccs
    .filter((a) => allowedCategoryIds.has(a.categoryId))
    .map((a) => ({ value: String(a.id), label: a.name }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

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

/** Party category dropdown options (all four party ledger categories). */
export function partyCategorySelectOptions(categories: AccountCategory[]) {
  const safeCats = Array.isArray(categories) ? categories : [];
  const allowedNames = new Set<string>(PARTY_ACCOUNT_CATEGORIES);
  return safeCats
    .filter((c) => allowedNames.has(c.name))
    .map((c) => ({ value: String(c.id), label: c.name }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

/** Accounts within a selected party category (for category → party two-step pickers). */
export function partyAccountOptionsForCategory(accounts: Account[], categoryId: string) {
  if (!categoryId) return [];
  const safeAccs = Array.isArray(accounts) ? accounts : [];
  return safeAccs
    .filter((a) => String(a.categoryId) === categoryId)
    .map((a) => ({ value: String(a.id), label: a.name }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

export function partyCategoryIdForAccount(accounts: Account[], accountId: string) {
  const acct = accounts.find((a) => String(a.id) === accountId);
  return acct ? String(acct.categoryId) : '';
}

/**
 * Map an account to Sale Party or Purchase Party category id for primary pickers
 * (legacy Int./Ext. Purchase Party accounts resolve to Purchase Party).
 */
export function primaryPartyCategoryIdForAccount(
  categories: AccountCategory[],
  accounts: Account[],
  accountId: string,
) {
  const acct = accounts.find((a) => String(a.id) === accountId);
  if (!acct) return '';
  const cat = categories.find((c) => c.id === acct.categoryId);
  if (!cat) return '';
  if (cat.name === 'Sale Party') return String(cat.id);
  if (LEGACY_PURCHASE_PARTY_NAMES.has(cat.name)) {
    const purchase = categories.find((c) => c.name === 'Purchase Party');
    return purchase ? String(purchase.id) : String(cat.id);
  }
  return String(cat.id);
}
