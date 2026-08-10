/** Letterhead shown on printable bills — adjust here only. */
export const BILL_LETTERHEAD = {
  companyName: 'SHEERAZ TRADERS',
  subtitle: 'GRAIN MARKET CHISHTIAN',
  email: 'sheeraztaggar786@gmail.com',
  contacts: [
    { name: 'Ch Waqas Waseem Taggar', phone: '03004105433' },
    { name: 'Ch Sheeraz Waseem Taggar', phone: '03008141733' },
  ],
} as const;

export const BILL_TITLES: Record<string, string> = {
  KACHI_MAAL: 'Kachi Maal Bill',
  SALE_INVOICE: 'Sale Invoice',
  PURCHASE_INVOICE: 'Purchase Invoice',
};
