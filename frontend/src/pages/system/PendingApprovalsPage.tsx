import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageCloseBar } from '../../components/ui/PageCloseBar';
import { PageShell, Panel, PrimaryButton } from '../../components/ui/PageShell';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { formatDate, formatLedgerAmount } from '../../lib/format';

type PendingKind = 'voucher' | 'invoice' | 'account' | 'product' | 'account_adjustment' | 'stock_adjustment';

type PendingItem = {
  kind: PendingKind;
  id: number;
  type: string;
  reference: string | null;
  date: string | null;
  debitAccountName?: string | null;
  creditAccountName?: string | null;
  amount: number;
  description: string | null;
  createdBy: { id: number; displayName: string; username: string } | null;
};

function editPathForPending(item: PendingItem): string | null {
  const q = `pendingId=${item.id}`;
  if (item.kind === 'voucher') {
    if (item.type === 'PAYMENT') return `/vouchers/payment?${q}`;
    if (item.type === 'RECEIPT') return `/vouchers/receipt?${q}`;
    if (item.type === 'JOURNAL') return `/vouchers/journal?${q}`;
    return null;
  }
  if (item.kind !== 'invoice') return null;
  if (item.type === 'SALE_INVOICE') return `/invoices/sale-invoice?${q}`;
  if (item.type === 'PURCHASE_INVOICE') return `/invoices/purchase-invoice?${q}`;
  if (item.type === 'KACHI_MAAL') return `/invoices/kachi-maal?${q}`;
  return null;
}

async function approvePendingItem(item: PendingItem) {
  if (item.kind === 'voucher') return api.approvePendingVoucher(item.id);
  if (item.kind === 'invoice') return api.approvePendingInvoice(item.id);
  if (item.kind === 'account') return api.approvePendingAccount(item.id);
  if (item.kind === 'product') return api.approvePendingProduct(item.id);
  if (item.kind === 'account_adjustment') return api.approvePendingAccountAdjustment(item.id);
  return api.approvePendingStockAdjustment(item.id);
}

async function rejectPendingItem(item: PendingItem) {
  if (item.kind === 'voucher') return api.rejectPendingVoucher(item.id);
  if (item.kind === 'invoice') return api.rejectPendingInvoice(item.id);
  if (item.kind === 'account') return api.rejectPendingAccount(item.id);
  if (item.kind === 'product') return api.rejectPendingProduct(item.id);
  if (item.kind === 'account_adjustment') return api.rejectPendingAccountAdjustment(item.id);
  return api.rejectPendingStockAdjustment(item.id);
}

export function PendingApprovalsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listPendingApprovals();
      setItems(Array.isArray(res) ? res : (res as any)?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pending approvals');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isAdmin = user?.role === 'ADMIN';

  /** Voucher Edit/Approve/Cancel are Admin-only. Invoice Edit allowed for creator or Admin. */
  function canEdit(item: PendingItem) {
    if (item.kind === 'voucher') return isAdmin;
    if (isAdmin) return true;
    return item.createdBy != null && user != null && item.createdBy.id === user.id;
  }

  function onEdit(item: PendingItem) {
    if (!canEdit(item)) return;
    const path = editPathForPending(item);
    if (!path) {
      setError(`Edit is not available for ${item.type}`);
      return;
    }
    navigate(path);
  }

  async function onApprove(item: PendingItem) {
    if (!isAdmin) return;
    const key = `approve-${item.kind}-${item.id}`;
    setBusyId(key);
    setError('');
    setMessage('');
    try {
      await approvePendingItem(item);
      setMessage(`Approved ${item.reference ?? item.type ?? 'item'}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusyId(null);
    }
  }

  async function onReject(item: PendingItem) {
    if (!isAdmin) return;
    const key = `reject-${item.kind}-${item.id}`;
    setBusyId(key);
    setError('');
    setMessage('');
    try {
      await rejectPendingItem(item);
      setMessage(`Cancelled/Rejected ${item.reference ?? item.type ?? 'item'}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PageShell title="Pending Approvals" subtitle="Review pending vouchers, invoices, accounts, products, and adjustments before they post">
      <Panel>
        {!isAdmin ? (
          <p className="mb-3 rounded bg-surface2 px-3 py-2 text-xs text-textSecondary font-medium">
            Viewing pending submissions. Voucher Edit / Approve / Cancel are Admin only. You can edit your own pending invoices.
          </p>
        ) : null}
        {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
        {message ? <p className="mb-3 text-sm text-success">{message}</p> : null}
        {loading ? (
          <p className="text-sm text-textMuted">Loading…</p>
        ) : (items?.length ?? 0) === 0 ? (
          <p className="text-sm text-textMuted">No pending items.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-textSecondary">
                  <th className="py-2 pr-3">Kind</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Reference</th>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Debit Account</th>
                  <th className="py-2 pr-3">Credit Account</th>
                  <th className="py-2 pr-3">Creator</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {(items ?? []).map((item) => {
                  const keyApprove = `approve-${item.kind}-${item.id}`;
                  const keyReject = `reject-${item.kind}-${item.id}`;
                  const isBusy = busyId === keyApprove || busyId === keyReject;
                  const showEdit = canEdit(item) && editPathForPending(item) != null;
                  const showAdminActions = isAdmin;
                  return (
                    <tr key={`${item.kind}-${item.id}`} className="border-b border-border">
                      <td className="py-2 pr-3 capitalize">{item.kind}</td>
                      <td className="py-2 pr-3">{item.type ? String(item.type).replaceAll('_', ' ') : '—'}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{item.reference ?? '—'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {item.date ? formatDate(item.date) : '—'}
                      </td>
                      <td className="py-2 pr-3 font-medium text-textPrimary">{item.debitAccountName ?? '—'}</td>
                      <td className="py-2 pr-3 font-medium text-textPrimary">{item.creditAccountName ?? '—'}</td>
                      <td className="py-2 pr-3">{item.createdBy?.displayName ?? '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatLedgerAmount(item.amount)}
                      </td>
                      <td className="py-2 pr-3 text-textSecondary">{item.description ?? '—'}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {showAdminActions ? (
                            <PrimaryButton
                              type="button"
                              disabled={isBusy}
                              onClick={() => void onApprove(item)}
                            >
                              {busyId === keyApprove ? 'Approving…' : 'Approve'}
                            </PrimaryButton>
                          ) : null}
                          {showEdit ? (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => onEdit(item)}
                              className="px-3 py-1.5 text-xs font-semibold rounded bg-surface2 text-textPrimary hover:bg-border/60 disabled:opacity-50 transition-colors"
                            >
                              Edit
                            </button>
                          ) : null}
                          {showAdminActions ? (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void onReject(item)}
                              className="px-3 py-1.5 text-xs font-semibold rounded bg-danger/10 text-danger hover:bg-danger/20 disabled:opacity-50 transition-colors"
                            >
                              {busyId === keyReject ? 'Cancelling…' : 'Cancel'}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}
