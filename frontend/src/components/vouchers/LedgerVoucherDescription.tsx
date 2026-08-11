import { ledgerCreditAmountClass, ledgerDebitAmountClass } from '../../lib/format';

const FROM_TO_PATTERN = /^From (.+?) to (.+?)( — .+)?$/;

/** Color "From {party}" green and "to {party}" red in auto-generated ledger descriptions. */
export function LedgerVoucherDescription({ text }: { text: string }) {
  const match = text.match(FROM_TO_PATTERN);
  if (!match) return <>{text}</>;
  const [, fromParty, toParty, suffix = ''] = match;
  return (
    <>
      From <span className={ledgerCreditAmountClass(true)}>{fromParty}</span> to{' '}
      <span className={ledgerDebitAmountClass(true)}>{toParty}</span>
      {suffix}
    </>
  );
}

export function voucherSideLabelClass(label: string) {
  const key = label.trim().toLowerCase();
  if (key === 'from' || key === 'credit') return ledgerCreditAmountClass(true);
  if (key === 'to' || key === 'debit') return ledgerDebitAmountClass(true);
  return '';
}
