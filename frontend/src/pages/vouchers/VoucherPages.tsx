import { FormEvent, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { formatDate, formatLedgerAmount, formatLedgerBalance, formatVoucherNumber, formatVoucherTypeLabel, voucherTypeColorClass } from '../../lib/format';
import { api, Account, AccountCategory, Voucher, VoucherAccount, VoucherUser } from '../../lib/api';
import { DangerButton, FieldLabel, PageShell, Panel, PrimaryButton, SecondaryButton, TextInput } from '../../components/ui/PageShell';

import { SearchSelect } from '../../components/ui/SearchSelect';
import { useAuth } from '../../contexts/AuthContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useMinimizableForm } from '../../hooks/useMinimizableForm';
import type { MinimizedFormKind } from '../../stores/minimizedFormsStore';

import { FormActionFooter } from '../../components/ui/FormActionFooter';

type VoucherDraft = {
  debitCategoryId: string;
  creditCategoryId: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: string;
  voucherDate: string;
  reference: string;
  description: string;
  predictedNumber?: number | null;
  queuedItems?: QueuedVoucherItem[];
};

const VOUCHER_TYPES: Record<string, string> = {
  payment: 'PAYMENT',
  journal: 'JOURNAL',
  receipt: 'RECEIPT',
};

const VOUCHER_PAGE_TITLES: Record<string, string> = {
  payment: 'Payment Voucher',
  journal: 'Journal Voucher',
  receipt: 'Receipt Voucher',
};

function todayInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function AccountSideFields({
  label,
  categoryId,
  accountId,
  categories,
  accounts,
  onCategoryChange,
  onAccountChange,
  categoryTabIndex,
  accountTabIndex,
  categoryInputRef,
  accountInputRef,
  accountNextFocusRef,
  panelClassName = '',
  labelClassName = 'text-textPrimary',
}: {
  label: string;
  categoryId: string;
  accountId: string;
  categories: AccountCategory[];
  accounts: Account[];
  onCategoryChange: (id: string) => void;
  onAccountChange: (id: string) => void;
  categoryTabIndex: number;
  accountTabIndex: number;
  categoryInputRef: RefObject<HTMLInputElement | null>;
  accountInputRef: RefObject<HTMLInputElement | null>;
  accountNextFocusRef?: RefObject<HTMLElement | null>;
  panelClassName?: string;
  labelClassName?: string;
}) {
  const safeAccs = Array.isArray(accounts) ? accounts : [];
  const filteredAccounts = safeAccs.filter((a) => categoryId && String(a.categoryId) === categoryId);
  const selected = safeAccs.find((a) => String(a.id) === accountId);

  return (
    <div className={`min-w-0 overflow-visible ${panelClassName}`.trim()}>
      <p className={`mb-3 text-xs font-bold uppercase tracking-wider ${labelClassName}`}>{label}</p>
      <div className="space-y-3">
        <div>
          <FieldLabel>Category</FieldLabel>
          <SearchSelect
            inputRef={categoryInputRef}
            tabIndex={categoryTabIndex}
            value={categoryId}
            onChange={onCategoryChange}
            options={(Array.isArray(categories) ? categories : []).map((c) => ({ value: String(c.id), label: c.name }))}
            placeholder="Search category…"
            nextFocusRef={accountInputRef}
            onSelected={() => {
              requestAnimationFrame(() => accountInputRef.current?.focus());
            }}
          />
        </div>
        <div>
          <FieldLabel>Account</FieldLabel>
          <SearchSelect
            inputRef={accountInputRef}
            tabIndex={accountTabIndex}
            value={accountId}
            onChange={onAccountChange}
            options={filteredAccounts.map((a) => ({ value: String(a.id), label: a.name }))}
            placeholder={categoryId ? 'Search account…' : 'Select a category first'}
            disabled={!categoryId}
            nextFocusRef={accountNextFocusRef}
          />
        </div>
        {selected?.ledger ? (
          <p className="text-xs text-textSecondary">
            Current balance: {formatLedgerBalance(selected.ledger.balance)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function isBankOrCashCategory(name: string) {
  const n = name.trim().toLowerCase();
  return n.includes('bank') || n.includes('cash');
}

function categoriesForSide(
  all: AccountCategory[],
  kind: keyof typeof VOUCHER_TYPES,
  side: 'credit' | 'debit',
): AccountCategory[] {
  const safeAll = Array.isArray(all) ? all : [];
  if (kind === 'journal') return safeAll;
  const restricted =
    (kind === 'receipt' && side === 'debit') ||
    (kind === 'payment' && side === 'credit');
  if (!restricted) return safeAll;
  const filtered = safeAll.filter((c) => isBankOrCashCategory(c.name));
  return filtered.length > 0 ? filtered : safeAll;
}

type QueuedVoucherItem = {
  id: string;
  voucherNumber: string;
  date: string;
  debitAccountId: string;
  debitAccountName: string;
  creditAccountId: string;
  creditAccountName: string;
  amount: string;
  reference: string;
  description: string;
};

export function VoucherFormPage({ kind }: { kind: keyof typeof VOUCHER_TYPES }) {
  const location = useLocation();
  // Captured ONCE at first render — see matching comment in
  // frontend/src/pages/invoices/InvoiceFormPage.tsx for why this can't be
  // derived from location.state on every render. useMinimizableForm clears
  // location.state right after consuming the restored draft; if formKey
  // reacted to that clear, React would remount VoucherFormContent after the
  // draft had already been discarded from the store, wiping the just
  // restored data.
  const [stableRestoreId] = useState(
    () => (location.state as { minimizedFormId?: string } | null)?.minimizedFormId,
  );
  const formKey = stableRestoreId ? `restore-${stableRestoreId}` : `${kind}-${location.key}`;
  return <VoucherFormContent key={formKey} kind={kind} />;
}

function VoucherFormContent({ kind }: { kind: keyof typeof VOUCHER_TYPES }) {
  const navigate = useNavigate();
  const formKind = kind as MinimizedFormKind;
  const { restoredState, minimize } = useMinimizableForm<VoucherDraft>(formKind);
  const keepRestoredPredictedNumber = useRef(restoredState?.predictedNumber != null);
  const trapRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const leftCategoryRef = useRef<HTMLInputElement>(null);
  const leftAccountRef = useRef<HTMLInputElement>(null);
  const rightCategoryRef = useRef<HTMLInputElement>(null);
  const rightAccountRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const referenceRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  useFocusTrap(trapRef, {
    initialFocusRef: dateRef,
    escapeFocusRef: titleRef,
  });

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<AccountCategory[]>([]);

  const [debitCategoryId, setDebitCategoryId] = useState(restoredState?.debitCategoryId ?? '');
  const [creditCategoryId, setCreditCategoryId] = useState(restoredState?.creditCategoryId ?? '');
  const [debitAccountId, setDebitAccountId] = useState(restoredState?.debitAccountId ?? '');
  const [creditAccountId, setCreditAccountId] = useState(restoredState?.creditAccountId ?? '');
  const [amount, setAmount] = useState(restoredState?.amount ?? '');
  const [voucherDate, setVoucherDate] = useState(restoredState?.voucherDate ?? todayInputValue);
  const [predictedNumber, setPredictedNumber] = useState<number | null>(restoredState?.predictedNumber ?? null);
  const [reference, setReference] = useState(restoredState?.reference ?? '');
  const [description, setDescription] = useState(restoredState?.description ?? '');

  const [queuedItems, setQueuedItems] = useState<QueuedVoucherItem[]>(
    () => restoredState?.queuedItems ?? [],
  );

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const [accountRows, categoryRows] = await Promise.all([
        api.listAccounts(),
        api.listCategories(),
      ]);
      setAccounts(accountRows);
      setCategories(categoryRows);
    } catch {
      setAccounts([]);
      setCategories([]);
    }
  }, []);

  const refreshPredictedNumber = useCallback(async () => {
    try {
      const { number } = await api.getNextVoucherNumber(VOUCHER_TYPES[kind] as 'PAYMENT' | 'RECEIPT' | 'JOURNAL');
      if (keepRestoredPredictedNumber.current) {
        keepRestoredPredictedNumber.current = false;
      } else {
        setPredictedNumber(number);
      }
    } catch {
      if (!keepRestoredPredictedNumber.current) setPredictedNumber(null);
      keepRestoredPredictedNumber.current = false;
    }
  }, [kind]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { refreshPredictedNumber(); }, [refreshPredictedNumber]);

  const debitCategories = categoriesForSide(categories, kind, 'debit');
  const creditCategories = categoriesForSide(categories, kind, 'credit');

  useEffect(() => {
    // Don't run this validation until categories have actually loaded —
    // on first render (including right after a minimize/restore), the
    // categories list is still empty because the API call hasn't
    // returned yet. Without this guard, an empty list looks identical to
    // "this category no longer exists," so a restored (or just-selected)
    // category/account pair gets cleared before the real data ever
    // arrives.
    if (categories.length === 0) return;
    if (debitCategoryId && !debitCategories.some((c) => String(c.id) === debitCategoryId)) {
      setDebitCategoryId('');
      setDebitAccountId('');
    }
    if (creditCategoryId && !creditCategories.some((c) => String(c.id) === creditCategoryId)) {
      setCreditCategoryId('');
      setCreditAccountId('');
    }
  }, [debitCategoryId, creditCategoryId, debitCategories, creditCategories, categories.length]);

  const variant = kind;
  const leftLabel = variant === 'journal' ? 'Debit' : 'From';
  const rightLabel = variant === 'journal' ? 'Credit' : 'To';

  const leftCategoryId = variant === 'journal' ? debitCategoryId : creditCategoryId;
  const rightCategoryId = variant === 'journal' ? creditCategoryId : debitCategoryId;
  const leftAccountId = variant === 'journal' ? debitAccountId : creditAccountId;
  const rightAccountId = variant === 'journal' ? creditAccountId : debitAccountId;

  function setLeftCategory(id: string) {
    if (variant === 'journal') { setDebitCategoryId(id); setDebitAccountId(''); }
    else { setCreditCategoryId(id); setCreditAccountId(''); }
  }
  function setRightCategory(id: string) {
    if (variant === 'journal') { setCreditCategoryId(id); setCreditAccountId(''); }
    else { setDebitCategoryId(id); setDebitAccountId(''); }
  }
  function setLeftAccount(id: string) {
    if (variant === 'journal') setDebitAccountId(id); else setCreditAccountId(id);
  }
  function setRightAccount(id: string) {
    if (variant === 'journal') setCreditAccountId(id); else setDebitAccountId(id);
  }

  function handleAddToGrid() {
    setError('');
    setMessage('');
    if (!debitAccountId || !creditAccountId) {
      setError('Select both accounts');
      return;
    }
    if (debitAccountId === creditAccountId) {
      setError('Debit and credit accounts must be different');
      return;
    }
    const parsedAmount = Number(amount);
    if (!(parsedAmount > 0)) {
      setError('Amount must be greater than zero');
      return;
    }
    if (!reference.trim()) {
      setError('Reference is required');
      referenceRef.current?.focus();
      return;
    }

    const debAcc = accounts.find((a) => String(a.id) === debitAccountId);
    const credAcc = accounts.find((a) => String(a.id) === creditAccountId);

    const assignedVoucherNumber = predictedNumber != null ? formatVoucherNumber(predictedNumber) : '—';

    const newItem: QueuedVoucherItem = {
      id: Math.random().toString(36).substring(2, 9),
      voucherNumber: assignedVoucherNumber,
      date: voucherDate,
      debitAccountId,
      debitAccountName: debAcc ? `${debAcc.name} (${debAcc.code})` : debitAccountId,
      creditAccountId,
      creditAccountName: credAcc ? `${credAcc.name} (${credAcc.code})` : creditAccountId,
      amount: String(parsedAmount),
      reference: reference.trim(),
      description: description.trim(),
    };

    setQueuedItems((prev) => [...prev, newItem]);
    if (predictedNumber != null) {
      setPredictedNumber((prev) => (prev != null ? prev + 1 : null));
    }
    setAmount('');
    setReference('');
    setDescription('');
    amountRef.current?.focus();
  }

  function handleRemoveFromGrid(id: string) {
    setQueuedItems((prev) => prev.filter((item) => item.id !== id));
  }

  const handleMinimize = () => {
    const title = VOUCHER_PAGE_TITLES[kind] ?? 'Voucher';
    const label = `${title} ${predictedNumber ? `#${predictedNumber}` : ''}`.trim();
    minimize(
      {
        debitCategoryId,
        creditCategoryId,
        debitAccountId,
        creditAccountId,
        amount,
        voucherDate,
        reference,
        description,
        predictedNumber,
        queuedItems,
      },
      label,
    );
  };

  async function handleSaveAll() {
    if (queuedItems.length === 0) {
      setError('Add at least one voucher to the grid before saving');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const payload = queuedItems.map((item) => ({
        type: VOUCHER_TYPES[kind],
        debitAccountId: Number(item.debitAccountId),
        creditAccountId: Number(item.creditAccountId),
        amount: Number(item.amount),
        date: item.date,
        description: item.description || undefined,
        reference: item.reference,
      }));

      const createdVouchers = await api.createVouchersBatch(payload);
      setMessage(`Successfully posted ${createdVouchers.length} voucher(s) to ledger.`);
      setQueuedItems([]);
      setAmount('');
      setReference('');
      setDescription('');
      await Promise.all([reload(), refreshPredictedNumber()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save batch vouchers');
    } finally {
      setSaving(false);
    }
  }

  const titleText = VOUCHER_PAGE_TITLES[kind] ?? 'Voucher';
  const titleColorClass =
    kind === 'payment' || kind === 'receipt'
      ? voucherTypeColorClass(VOUCHER_TYPES[kind])
      : undefined;

  const totalGridAmount = queuedItems.reduce((sum, item) => sum + Number(item.amount), 0);

  return (
    <PageShell
      centerTitle
      invoiceTitleBand
      titleRef={titleRef}
      title={titleColorClass ? <span className={titleColorClass}>{titleText}</span> : titleText}
    >
      <div className="mx-auto w-full max-w-[1400px] overflow-visible px-2">
        <div ref={trapRef} className="overflow-visible">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Form Panel */}
            <div className="lg:col-span-5 bg-surface rounded-xl border border-border p-5 space-y-5">
              <h3 className="text-sm font-semibold text-textPrimary uppercase tracking-wider border-b border-border pb-2">
                New Voucher Details
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabel>Date</FieldLabel>
                  <TextInput
                    ref={dateRef}
                    tabIndex={1}
                    type="date"
                    required
                    value={voucherDate}
                    onChange={(e) => setVoucherDate(e.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel>Next Voucher #</FieldLabel>
                  <TextInput
                    readOnly
                    tabIndex={-1}
                    value={predictedNumber != null ? formatVoucherNumber(predictedNumber) : '…'}
                    className="font-bold tabular-nums text-financial"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <AccountSideFields
                  label={leftLabel}
                  categoryId={leftCategoryId}
                  accountId={leftAccountId}
                  categories={variant === 'journal' ? debitCategories : creditCategories}
                  accounts={accounts}
                  onCategoryChange={setLeftCategory}
                  onAccountChange={setLeftAccount}
                  categoryTabIndex={2}
                  accountTabIndex={3}
                  categoryInputRef={leftCategoryRef}
                  accountInputRef={leftAccountRef}
                  accountNextFocusRef={rightCategoryRef}
                />
                <AccountSideFields
                  label={rightLabel}
                  categoryId={rightCategoryId}
                  accountId={rightAccountId}
                  categories={variant === 'journal' ? creditCategories : debitCategories}
                  accounts={accounts}
                  onCategoryChange={setRightCategory}
                  onAccountChange={setRightAccount}
                  categoryTabIndex={4}
                  accountTabIndex={5}
                  categoryInputRef={rightCategoryRef}
                  accountInputRef={rightAccountRef}
                  accountNextFocusRef={amountRef}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabel>Amount</FieldLabel>
                  <TextInput
                    ref={amountRef}
                    tabIndex={6}
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <FieldLabel>Reference</FieldLabel>
                  <TextInput
                    ref={referenceRef}
                    tabIndex={7}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Cheque / Ref"
                  />
                </div>
              </div>

              <div>
                <FieldLabel>Description</FieldLabel>
                <TextInput
                  ref={descriptionRef}
                  tabIndex={8}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Notes / description"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddToGrid();
                    }
                  }}
                />
              </div>

              {error ? <p className="text-xs text-danger font-medium">{error}</p> : null}

              <button
                type="button"
                tabIndex={9}
                onClick={handleAddToGrid}
                className="w-full py-2.5 px-4 bg-accent/10 hover:bg-accent/20 text-accent font-semibold text-sm rounded-lg border border-accent/30 transition-colors flex items-center justify-center gap-2"
              >
                + Add to Grid Queue
              </button>
            </div>

            {/* Right Preview Grid Panel */}
            <div className="lg:col-span-7 bg-surface rounded-xl border border-border p-5 space-y-4 flex flex-col min-h-[500px]">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h3 className="text-sm font-semibold text-textPrimary uppercase tracking-wider">
                  Queued Vouchers Batch ({queuedItems.length})
                </h3>
                <span className="text-xs font-semibold text-textSecondary">
                  Total: <span className="font-mono text-financial text-textPrimary">{formatLedgerAmount(totalGridAmount)}</span>
                </span>
              </div>

              {message ? <p className="text-xs text-success font-medium bg-success/10 p-2 rounded">{message}</p> : null}

              <div className="flex-1 overflow-x-auto">
                {queuedItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-textMuted border-2 border-dashed border-border/50 rounded-lg p-6 text-center">
                    <p className="text-sm font-medium">No vouchers in batch queue.</p>
                    <p className="text-xs mt-1">Fill the details on the left and click &quot;+ Add to Grid Queue&quot; to queue up multiple vouchers.</p>
                  </div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border text-textSecondary bg-surface2/50">
                        <th className="py-2 px-2">Voucher #</th>
                        <th className="py-2 px-2">Date</th>
                        <th className="py-2 px-2">{leftLabel} Account</th>
                        <th className="py-2 px-2">{rightLabel} Account</th>
                        <th className="py-2 px-2 text-right">Amount</th>
                        <th className="py-2 px-2">Reference</th>
                        <th className="py-2 px-2">Description</th>
                        <th className="py-2 px-2 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queuedItems.map((item) => (
                        <tr key={item.id} className="border-b border-border hover:bg-surface2/30">
                          <td className="py-2 px-2 font-mono font-semibold tabular-nums text-textPrimary">
                            {formatVoucherNumber(item.voucherNumber)}
                          </td>
                          <td className="py-2 px-2 whitespace-nowrap">{formatDate(item.date)}</td>
                          <td className="py-2 px-2 font-medium text-textPrimary">{variant === 'journal' ? item.debitAccountName : item.creditAccountName}</td>
                          <td className="py-2 px-2 font-medium text-textPrimary">{variant === 'journal' ? item.creditAccountName : item.debitAccountName}</td>
                          <td className="py-2 px-2 text-right font-mono font-semibold tabular-nums text-textPrimary">
                            {formatLedgerAmount(Number(item.amount))}
                          </td>
                          <td className="py-2 px-2 text-textSecondary font-mono">{item.reference}</td>
                          <td className="py-2 px-2 text-textSecondary truncate max-w-[120px]">{item.description || '—'}</td>
                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveFromGrid(item.id)}
                              className="text-danger hover:text-danger/80 font-bold px-2 py-0.5 rounded hover:bg-danger/10 text-xs"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <FormActionFooter
                error={error}
                message={message}
                primaryLabel={`Save & Post Batch (${queuedItems.length})`}
                savingLabel="Posting Batch…"
                saving={saving}
                disabled={queuedItems.length === 0}
                primaryType="button"
                primaryRef={saveRef}
                onPrimaryClick={() => void handleSaveAll()}
                onMinimize={handleMinimize}
                onClose={() => navigate('/')}
                className="pt-4 border-t border-border"
              />
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

const VOUCHER_TYPE_LABELS: Record<string, string> = {
  RECEIPT: 'Receipt',
  PAYMENT: 'Payment',
  JOURNAL: 'Journal',
};

function accountLabel(account?: VoucherAccount | null) {
  if (!account) return '—';
  return account.name;
}

function userLabel(user?: VoucherUser | null) {
  if (!user) return null;
  return user.displayName || user.username;
}

export function VoucherDetailCard({
  voucher,
  onCancel,
  onUpdateAmount,
  cancelling,
  updating,
}: {
  voucher: Voucher;
  onCancel: () => void;
  onUpdateAmount: (amount: number) => void | Promise<void>;
  cancelling: boolean;
  updating: boolean;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const isCancelled = voucher.status === 'CANCELLED';
  const isKachi = voucher.type === 'KACHI';
  const isMultiLeg = isKachi;
  const [editingAmount, setEditingAmount] = useState(false);
  const [amountDraft, setAmountDraft] = useState(String(voucher.amount ?? ''));

  useEffect(() => {
    setEditingAmount(false);
    setAmountDraft(String(voucher.amount ?? ''));
  }, [voucher.id, voucher.amount]);

  const rows = isMultiLeg
    ? []
    : voucher.type === 'JOURNAL'
      ? [
          { label: 'Debit', value: accountLabel(voucher.debitAccount) },
          { label: 'Credit', value: accountLabel(voucher.creditAccount) },
        ]
      : [
          { label: 'From', value: accountLabel(voucher.creditAccount) },
          { label: 'To', value: accountLabel(voucher.debitAccount) },
        ];

  const kachiLegs = voucher.ledgerEntries ?? [];
  const kachiDebitTotal = kachiLegs
    .filter((leg) => leg.type === 'DEBIT')
    .reduce((sum, leg) => sum + Number(leg.amount), 0);
  const kachiCreditTotal = kachiLegs
    .filter((leg) => leg.type === 'CREDIT')
    .reduce((sum, leg) => sum + Number(leg.amount), 0);

  const auditParts: string[] = [];
  const creator = userLabel(voucher.createdBy);
  if (creator) auditParts.push(`Created by ${creator}`);
  const modifier = userLabel(voucher.modifiedBy);
  if (modifier && voucher.updatedAt && voucher.updatedAt !== voucher.createdAt) {
    auditParts.push(`Updated by ${modifier} on ${new Date(voucher.updatedAt).toLocaleDateString()}`);
  }
  if (isCancelled && voucher.deletedBy && voucher.deletedAt) {
    const canceller = userLabel(voucher.deletedBy);
    if (canceller) auditParts.push(`Cancelled by ${canceller} on ${new Date(voucher.deletedAt).toLocaleDateString()}`);
  }

  async function submitAmount(e: FormEvent) {
    e.preventDefault();
    const amount = parseFloat(amountDraft);
    if (!Number.isFinite(amount) || amount <= 0) return;
    await onUpdateAmount(amount);
    setEditingAmount(false);
  }

  return (
    <Panel className="mt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tabular-nums text-textPrimary">
              #{formatVoucherNumber(voucher.number, voucher.type)}
            </h2>
            <span className={`text-sm font-semibold ${voucherTypeColorClass(voucher.type)}`}>
              {formatVoucherTypeLabel(voucher.type)}
            </span>
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                isCancelled ? 'bg-bgAccent text-textAccent' : 'bg-bgAccent text-success'
              }`}
            >
              {isCancelled ? 'Cancelled' : 'Active'}
            </span>
          </div>
          <p className="mt-1 text-sm text-textSecondary">{formatDate(voucher.date)}</p>
        </div>
        {!isCancelled && isAdmin ? (
          <div className="flex gap-2">
            {!isMultiLeg && !editingAmount && (
              <SecondaryButton onClick={() => setEditingAmount(true)}>Update Amount</SecondaryButton>
            )}
            <DangerButton
              disabled={cancelling || editingAmount}
              onClick={onCancel}
            >
              {cancelling ? 'Deleting…' : 'Delete'}
            </DangerButton>
          </div>
        ) : null}
      </div>

      <dl className="divide-y divide-border">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[120px_1fr] gap-4 py-3">
            <dt className="text-sm text-textSecondary">{row.label}</dt>
            <dd className="text-sm font-medium text-textPrimary">{row.value}</dd>
          </div>
        ))}
        {(isMultiLeg && (kachiLegs?.length ?? 0) > 0) ? (
          <div className="py-3">
            <dt className="mb-3 text-sm text-textSecondary">Ledger legs</dt>
            <dd>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-textSecondary">
                      <th className="py-2 pr-3">Account</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3 text-right">Amount</th>
                      <th className="py-2">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(kachiLegs ?? []).map((leg) => (
                      <tr key={leg.id} className="border-b border-border">
                        <td className="py-2 pr-3 font-medium text-textPrimary">
                          {leg.ledger?.account?.name ?? '—'}
                        </td>
                        <td className={`py-2 pr-3 font-medium ${leg.type === 'DEBIT' ? 'text-danger' : 'text-success'}`}>
                          {leg.type === 'DEBIT' ? 'Debit' : 'Credit'}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatLedgerAmount(leg.amount)}</td>
                        <td className="py-2 text-textSecondary">{leg.notes ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border font-semibold">
                      <td className="py-2" colSpan={2}>Totals</td>
                      <td className="py-2 text-right tabular-nums">
                        Dr {formatLedgerAmount(kachiDebitTotal)} / Cr {formatLedgerAmount(kachiCreditTotal)}
                      </td>
                      <td className="py-2" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </dd>
          </div>
        ) : null}
        <div className="grid grid-cols-[120px_1fr] gap-4 py-3">
          <dt className="text-sm text-textSecondary">Date</dt>
          <dd className="text-sm text-textPrimary">{formatDate(voucher.date)}</dd>
        </div>
        <div className="grid grid-cols-[120px_1fr] gap-4 py-3">
          <dt className="text-sm text-textSecondary">{isMultiLeg ? 'Grand total' : 'Amount'}</dt>
          <dd className="text-sm font-semibold text-textPrimary">
            {!isMultiLeg && editingAmount ? (
              <form onSubmit={submitAmount} className="flex flex-wrap items-center gap-2">
                <TextInput
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={amountDraft}
                  onChange={(e) => setAmountDraft(e.target.value)}
                  className="max-w-[180px]"
                />
                <PrimaryButton type="submit" disabled={updating}>
                  {updating ? 'Saving…' : 'Save'}
                </PrimaryButton>
                <SecondaryButton
                  type="button"
                  onClick={() => {
                    setEditingAmount(false);
                    setAmountDraft(String(voucher.amount ?? ''));
                  }}
                >
                  Discard
                </SecondaryButton>
              </form>
            ) : (
              Number(voucher.amount).toFixed(2)
            )}
          </dd>
        </div>
        {voucher.reference ? (
          <div className="grid grid-cols-[120px_1fr] gap-4 py-3">
            <dt className="text-sm text-textSecondary">Reference</dt>
            <dd className="text-sm text-textPrimary">{voucher.reference}</dd>
          </div>
        ) : null}
        {voucher.description ? (
          <div className="grid grid-cols-[120px_1fr] gap-4 py-3">
            <dt className="text-sm text-textSecondary">Description</dt>
            <dd className="text-sm text-textPrimary">{voucher.description}</dd>
          </div>
        ) : null}
      </dl>

      {(auditParts?.length ?? 0) > 0 && (
        <p className="mt-4 border-t border-border pt-3 text-xs text-textSecondary">
          {auditParts.join(' · ')}
        </p>
      )}
    </Panel>
  );
}

export function VoucherListPage() {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [searchType, setSearchType] = useState('');
  const [searchNo, setSearchNo] = useState('');
  const [searched, setSearched] = useState(false);
  const [result, setResult] = useState<Voucher | 'notfound' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [updating, setUpdating] = useState(false);

  const loadVouchers = useCallback(() => {
    setLoading(true);
    setLoadError('');
    api
      .listVouchers({ limit: 200, offset: 0 })
      .then((page) => {
        setVouchers(page?.items ?? []);
        setTotal(page?.total ?? 0);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load vouchers'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadVouchers();
  }, [loadVouchers]);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    const no = parseInt(searchNo.trim(), 10);
    if (!no) {
      setResult('notfound');
      setSearched(true);
      return;
    }
    const found = (vouchers ?? []).find((v) => v.number === no && (!searchType || v.type === searchType));
    setResult(found ?? 'notfound');
    setSearched(true);
  }

  async function handleCancel() {
    if (!result || result === 'notfound') return;
    if (!window.confirm('This will reverse the ledger entries — are you sure?')) return;
    setCancelling(true);
    try {
      const updated = await api.cancelVoucher(result.id);
      setResult(updated);
      loadVouchers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setCancelling(false);
    }
  }

  async function handleUpdateAmount(amount: number) {
    if (!result || result === 'notfound') return;
    setUpdating(true);
    try {
      const updated = await api.updateVoucherAmount(result.id, amount);
      setResult(updated);
      loadVouchers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setUpdating(false);
    }
  }

  const voucher = result && result !== 'notfound' ? result : null;

  return (
    <PageShell subtitle={total > (vouchers?.length ?? 0) ? `Loaded ${vouchers?.length ?? 0} of ${total} vouchers for lookup` : 'Search a voucher by type and number'}>
      <Panel>
        {loadError ? (
          <p className="text-sm text-danger">{loadError}</p>
        ) : (
          <form onSubmit={handleSearch} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <FieldLabel>Type</FieldLabel>
              <select
                value={searchType}
                onChange={(e) => setSearchType(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              >
                <option value="">All types</option>
                <option value="RECEIPT">Receipt</option>
                <option value="PAYMENT">Payment</option>
                <option value="JOURNAL">Journal</option>
              </select>
            </div>
            <div>
              <FieldLabel>Voucher #</FieldLabel>
              <TextInput
                type="number"
                min="1"
                required
                value={searchNo}
                onChange={(e) => setSearchNo(e.target.value)}
                placeholder="Enter voucher number"
              />
            </div>
            <PrimaryButton type="submit" disabled={loading}>
              {loading ? 'Loading…' : 'Search'}
            </PrimaryButton>
          </form>
        )}
      </Panel>

      {searched && result === 'notfound' && (
        <p className="mt-4 rounded-lg border border-border bg-surface1 px-4 py-3 text-sm text-textMuted">
          No voucher found for that number{searchType ? ` in ${VOUCHER_TYPE_LABELS[searchType]}` : ''}.
        </p>
      )}

      {voucher && (
        <VoucherDetailCard
          voucher={voucher}
          onCancel={handleCancel}
          onUpdateAmount={handleUpdateAmount}
          cancelling={cancelling}
          updating={updating}
        />
      )}
    </PageShell>
  );
}
