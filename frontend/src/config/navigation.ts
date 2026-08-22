import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  FileText,
  Package,
  Receipt,
  Settings,
  Wallet,
} from 'lucide-react';

export type NavLink = {
  label: string;
  to: string;
  description?: string;
};

export type NavItem =
  | ({ kind: 'link' } & NavLink)
  | { kind: 'submenu'; label: string; children: NavLink[] };

export type SidebarSection = {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
};

export const SIDEBAR_NAV: SidebarSection[] = [
  {
    id: 'accounts',
    label: 'Accounts',
    icon: Wallet,
    items: [
      {
        kind: 'submenu',
        label: 'Category',
        children: [
          { label: 'Add Category', to: '/accounts/categories/add' },
          { label: 'Edit Category', to: '/accounts/categories/edit' },
          { label: 'Remove Category', to: '/accounts/categories/remove' },
        ],
      },
      {
        kind: 'submenu',
        label: 'Account',
        children: [
          { label: 'Add Account', to: '/accounts/manage/add' },
          { label: 'Edit Account', to: '/accounts/manage/edit' },
          { label: 'Remove Account', to: '/accounts/manage/remove' },
        ],
      },
      { kind: 'link', label: 'Sale Party', to: '/accounts/sale-parties' },
      { kind: 'link', label: 'Purchase Party', to: '/accounts/purchase-parties' },
    ],
  },
  {
    id: 'products',
    label: 'Products',
    icon: Package,
    items: [
      { kind: 'link', label: 'Add Product', to: '/products/add' },
      { kind: 'link', label: 'Remove Product', to: '/products/remove' },
    ],
  },
  {
    id: 'vouchers',
    label: 'Vouchers',
    icon: Receipt,
    items: [
      { kind: 'link', label: 'Receipt Voucher', to: '/vouchers/receipt' },
      { kind: 'link', label: 'Payment Voucher', to: '/vouchers/payment' },
      { kind: 'link', label: 'Journal Voucher', to: '/vouchers/journal' },
      { kind: 'link', label: 'View Voucher', to: '/vouchers/view' },
    ],
  },
  {
    id: 'invoices',
    label: 'Invoices',
    icon: FileText,
    items: [
      { kind: 'link', label: 'Sale Invoice', to: '/invoices/sale-invoice' },
      { kind: 'link', label: 'Purchase Invoice', to: '/invoices/purchase-invoice' },
      { kind: 'link', label: 'Kachi Maal', to: '/invoices/kachi-maal' },
      { kind: 'link', label: 'View Invoice', to: '/invoices/view-invoice' },
      { kind: 'link', label: 'Jama Naam Register', to: '/jama-naam' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: BarChart3,
    items: [
      {
        kind: 'submenu',
        label: 'Account Reports',
        children: [
          { label: 'Account Ledger', to: '/reports/accounts' },
          { label: 'Account Balance', to: '/reports/account-balance' },
          { label: 'Vouchers', to: '/reports/vouchers' },
        ],
      },
      { kind: 'link', label: 'Detail Trial Balance', to: '/reports/trial-balance' },
      { kind: 'link', label: 'Profit & Loss Statement', to: '/reports/profit-loss' },
      { kind: 'link', label: 'Financial Year Reports', to: '/reports/financial-year' },
      { kind: 'link', label: 'Stock Report', to: '/reports/stock' },
      { kind: 'link', label: 'Stock Value Report', to: '/reports/stock-value' },
      { kind: 'link', label: 'Stock Quantity Report', to: '/reports/stock-quantity' },
      { kind: 'link', label: 'Sale Bill Summary', to: '/reports/sale-bill' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: Settings,
    items: [
      { kind: 'link', label: 'Database Maintenance', to: '/system/database' },
      { kind: 'link', label: 'Stores', to: '/system/stores' },
      { kind: 'link', label: 'Transfer Stock', to: '/inventory/stock-transfer' },
      { kind: 'link', label: 'Stock Adjustment', to: '/inventory/stock-adjustment' },
      { kind: 'link', label: 'System Preference', to: '/system/preferences' },
    ],
  },
];

/** Flat links for dashboard invoice shortcuts (subset of Invoices nav, ordered). */
const DASHBOARD_INVOICE_ROUTES = [
  '/invoices/kachi-maal',
  '/invoices/sale-invoice',
  '/invoices/purchase-invoice',
  '/invoices/view-invoice',
  '/jama-naam',
] as const;

export const INVOICE_QUICK_LINKS: NavLink[] = (() => {
  const byTo = new Map(
    (SIDEBAR_NAV.find((section) => section.id === 'invoices')?.items ?? [])
      .flatMap((item) => (item.kind === 'link' ? [item] : []))
      .map((item) => [item.to, item]),
  );
  return DASHBOARD_INVOICE_ROUTES.flatMap((to) => {
    const item = byTo.get(to);
    return item ? [item] : [];
  });
})();

export const VOUCHER_QUICK_LINKS: NavLink[] = (
  SIDEBAR_NAV.find((section) => section.id === 'vouchers')?.items ?? []
).flatMap((item) => (item.kind === 'link' && item.to !== '/vouchers/view' ? [item] : []));

/** Flat links for dashboard report shortcuts (includes nested account reports). */
export const REPORT_QUICK_LINKS: NavLink[] = (
  SIDEBAR_NAV.find((section) => section.id === 'reports')?.items ?? []
).flatMap((item) =>
  item.kind === 'link' ? [item] : item.children.map((child) => ({ ...child })),
);

const ROUTE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/user': 'User Information',
  '/reports/accounts': 'Ledger',
  '/system/approvals': 'Pending Approvals',
};

function collectRouteTitles(items: NavItem[], titles: Record<string, string>) {
  for (const item of items) {
    if (item.kind === 'link') {
      titles[item.to] = item.label;
    } else {
      for (const child of item.children) {
        titles[child.to] = child.label;
      }
    }
  }
}

for (const section of SIDEBAR_NAV) {
  collectRouteTitles(section.items, ROUTE_TITLES);
}

export function getPageTitle(pathname: string): string {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  const match = Object.entries(ROUTE_TITLES)
    .filter(([path]) => path !== '/')
    .sort(([a], [b]) => b.length - a.length)
    .find(([path]) => pathname.startsWith(path));
  return match?.[1] ?? 'Sheeraz Traders';
}

export const INVOICE_TYPE_LABELS: Record<string, string> = {
  KACHI_MAAL: 'Kachi Maal',
  SALE_INVOICE: 'Sale Invoice',
  PURCHASE_INVOICE: 'Purchase Invoice',
};

/** Nav targets that perform delete/remove actions — admin only. */
export const ADMIN_ONLY_NAV_PATHS = new Set([
  '/accounts/categories/remove',
  '/accounts/manage/remove',
  '/products/remove',
]);

export function filterNavItemsForRole(items: NavItem[], isAdmin: boolean): NavItem[] {
  if (isAdmin) return items;
  return items.flatMap((item): NavItem[] => {
    if (item.kind === 'link') {
      return ADMIN_ONLY_NAV_PATHS.has(item.to) ? [] : [item];
    }
    const children = item.children.filter((child) => !ADMIN_ONLY_NAV_PATHS.has(child.to));
    if (children.length === 0) return [];
    return [{ ...item, children }];
  });
}

export function filterSidebarSectionsForRole(sections: SidebarSection[], isAdmin: boolean): SidebarSection[] {
  if (isAdmin) return sections;
  return sections
    .map((section) => ({
      ...section,
      items: filterNavItemsForRole(section.items, isAdmin),
    }))
    .filter((section) => section.items.length > 0);
}

/** @deprecated Use SIDEBAR_NAV — kept for any legacy imports */
export type NavGroup = {
  label: string;
  children?: NavItem[];
  to?: string;
};

/** Top-bar quick links (Sale / Purchase icons) rendered inline with dropdowns. */
export type TopNavQuickLink = {
  kind: 'quick';
  label: string;
  to: string;
  icon: 'sale' | 'purchase';
};

/** Top-bar direct link (no dropdown), e.g. Ledger. */
export type TopNavDirectLink = {
  kind: 'link';
  id: string;
  label: string;
  to: string;
};

export type TopNavEntry =
  | ({ kind: 'dropdown' } & Required<Pick<NavGroup, 'label' | 'children'>>)
  | TopNavQuickLink
  | TopNavDirectLink;

const TOP_NAV_SECTION_ORDER = [
  'accounts',
  'products',
  'vouchers',
  'invoices',
  'reports',
  'system',
] as const;

/** Left-to-right: Accounts → Ledger → Products → Vouchers → Sale → Purchase → Invoices → Reports → System → Pending Approvals */
export const TOP_NAV: TopNavEntry[] = (() => {
  const byId = new Map(SIDEBAR_NAV.map((section) => [section.id, section]));
  const entries: TopNavEntry[] = [];
  for (const id of TOP_NAV_SECTION_ORDER) {
    const section = byId.get(id);
    if (!section) continue;
    entries.push({ kind: 'dropdown', label: section.label, children: section.items });
    if (id === 'accounts') {
      entries.push({
        kind: 'link',
        id: 'ledger',
        label: 'Ledger',
        to: '/reports/accounts',
      });
    }
    if (id === 'vouchers') {
      entries.push({
        kind: 'quick',
        label: 'Sale',
        to: '/invoices/sale-invoice',
        icon: 'sale',
      });
      entries.push({
        kind: 'quick',
        label: 'Purchase',
        to: '/invoices/purchase-invoice',
        icon: 'purchase',
      });
    }
  }
  entries.push({
    kind: 'link',
    id: 'pending-approvals',
    label: 'Pending Approvals',
    to: '/system/approvals',
  });
  return entries;
})();
