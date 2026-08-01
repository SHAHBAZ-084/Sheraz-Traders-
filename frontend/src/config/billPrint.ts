/** Letterhead shown on printable bills — adjust here only. */
export const BILL_LETTERHEAD = {
  companyName: 'Sheraz Traders',
  subtitle: 'Grain Market Chishtian',
  phone: '0632501213',
  mobile: '03006982486',
  // TODO(client): replace with real Sheraz Traders email
  email: 'client@example.com',
  // TODO(client): replace with real proprietor name
  proprietor: 'Sheraz Traders Proprietor',
} as const;

export const BILL_TITLES: Record<string, string> = {
  SALE_COMMISSION: 'Sale Bill',
  SALE_PAUNCH: 'Sale Bill',
  PURCHASE_MAAL: 'Purchase Bill',
  KACHI_MAAL: 'Kachi Maal Bill',
};
