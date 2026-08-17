/**
 * Urdu display labels for shared Kachi forms (Kachi Maal invoice, Add Product, Stock Adjustment).
 * English keys listed in the product spec stay in English; all others use Urdu.
 */
export const KACHI_URDU_LABELS = {
  date: 'تاریخ',
  invoiceNo: 'انوائس نمبر',
  jins: 'جنس',
  billNo: 'بل نمبر',
  gariNo: 'گاڑی نمبر',
  tafseel: 'تفصیل',
  addDheriRow: 'Add Dheri Row',
  identity: 'Identity',
  party: 'Party',
  boriThela: 'بوری / تھیلا',
  boriCount: 'بوری کی تعداد',
  dharan: 'دھارَن',
  kilo: 'کلو',
  bhartii: 'بھرتی',
  pricing: 'قیمت',
  ratePerMaund: 'ریٹ فی من',
  totalWeight: 'کل وزن',
  amount: 'رقم',
  netToParty: 'Net to Party',
  bardanaQty: 'بردانہ تعداد',
  bardanaRate: 'بردانہ ریٹ',
  previewGrid: 'Preview Grid',
  settlementDebitSide: 'تصفیہ (ڈیبٹ سائیڈ)',
  debitAccountTotals: 'ڈیبٹ اکاؤنٹ اور مجموعہ',
  debitAccount: 'ڈیبٹ اکاؤنٹ',
  goodsTotal: 'مال کی کل مالیت',
  paleDari: 'پلے داری',
  brokery: 'بروکری',
  marketFee: 'مارکیٹ فیس',
  daami: 'دامی',
  miscAndLowerBardana: 'متفرق اور بردانہ',
  miscOptional: 'متفرق (اختیاری)',
  lowerBardana: 'بردانہ',
  lowerBardanaQty: 'بردانہ تعداد',
  lowerBardanaRate: 'بردانہ ریٹ',
  totalDebit: 'Total Debit',
  addToGrid: 'گرڈ میں شامل کریں',
  saveInvoice: 'Save invoice',
  minimize: 'Minimize',
  close: 'Close',
  bori: 'بوری',
  thela: 'تھیلا',
} as const;

export type KachiUrduLabelKey = keyof typeof KACHI_URDU_LABELS;

export function kachiUrduLabel(key: KachiUrduLabelKey): string {
  return KACHI_URDU_LABELS[key];
}

export function kachiPercentUrduLabel(
  baseKey: 'paleDari' | 'brokery' | 'daami',
  percent: number,
): string {
  return `${KACHI_URDU_LABELS[baseKey]} (${percent}%)`;
}
