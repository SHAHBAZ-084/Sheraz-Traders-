/** Letterhead shown on printable bills — adjust here only. */
export const BILL_LETTERHEAD = {
  companyName: 'Sheraz Traders',
  subtitle: 'Grain Market Chishtian',
  email: 'sheeraztaggar786@gmail.com',
  contacts: [
    { name: 'Ch Waqas Waseem Taggad', phone: '03004105433' },
    { name: 'Ch Sheraz Waseem Taggad', phone: '03008141733' },
  ],
} as const;

export const BILL_TITLES: Record<string, string> = {
  KACHI_MAAL: 'Kachi Maal Bill',
  SALE_INVOICE: 'Sale Invoice',
  PURCHASE_INVOICE: 'Purchase Invoice',
};
