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
    id: 'vouchers',
    label: 'Vouchers',
    icon: Receipt,
    items: [
      { kind: 'link', label: 'Payment Voucher', to: '/vouchers/payment' },
      { kind: 'link', label: 'Journal Voucher', to: '/vouchers/journal' },
      { kind: 'link', label: 'Receipt Voucher', to: '/vouchers/receipt' },
      { kind: 'link', label: 'View Voucher', to: '/vouchers/view' },
    ],
  },
  {
    id: 'invoices',
    label: 'Invoices',
    icon: FileText,
    items: [
      { kind: 'link', label: 'Sale on Commission', to: '/invoices/sale-commission' },
      { kind: 'link', label: 'Sale on Paunch', to: '/invoices/sale-paunch' },
      { kind: 'link', label: 'Sale Invoice', to: '/invoices/sale-invoice' },
      { kind: 'link', label: 'Purchase to Maal', to: '/invoices/purchase-maal' },
      { kind: 'link', label: 'Purchase Invoice', to: '/invoices/purchase-invoice' },
      { kind: 'link', label: 'Kachi Maal', to: '/invoices/kachi-maal' },
      { kind: 'link', label: 'View Invoice', to: '/invoices/view-invoice' },
    ],
  },
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
      { kind: 'link', label: 'Sale/Purchase Reports', to: '/reports/sale-purchase' },
      { kind: 'link', label: 'Stock Report', to: '/reports/stock' },
      { kind: 'link', label: 'Empty Bardana', to: '/inventory/bardana' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: Settings,
    items: [{ kind: 'link', label: 'System Preference', to: '/system/preferences' }],
  },
];

/** Flat links for dashboard invoice shortcuts. */
export const INVOICE_QUICK_LINKS: NavLink[] = (
  SIDEBAR_NAV.find((section) => section.id === 'invoices')?.items ?? []
).flatMap((item) => (item.kind === 'link' ? [item] : []));

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
  '/': 'Dashboard',
  '/user': 'User Information',
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
  return match?.[1] ?? 'Grain Market POS';
}

export const INVOICE_TYPE_LABELS: Record<string, string> = {
  SALE_COMMISSION: 'Sale on Commission',
  SALE_PAUNCH: 'Sale on Paunch',
  PURCHASE_MAAL: 'Purchase to Maal',
  KACHI_MAAL: 'Kachi Maal',
  SALE_INVOICE: 'Sale Invoice',
  PURCHASE_INVOICE: 'Purchase Invoice',
};

/** @deprecated Use SIDEBAR_NAV — kept for any legacy imports */
export type NavGroup = {
  label: string;
  children?: NavItem[];
  to?: string;
};

export const TOP_NAV: NavGroup[] = SIDEBAR_NAV.map((section) => ({
  label: section.label,
  children: section.items,
}));
