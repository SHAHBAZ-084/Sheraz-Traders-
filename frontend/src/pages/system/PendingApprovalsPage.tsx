import { useCallback, useEffect, useState } from 'react';
import { PageCloseBar } from '../../components/ui/PageCloseBar';
import { PageShell, Panel, PrimaryButton } from '../../components/ui/PageShell';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { formatDate, formatLedgerAmount } from '../../lib/format';

type PendingItem = {
  kind: 'voucher' | 'invoice';
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

export function PendingApprovalsPage() {
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

  async function onApprove(item: PendingItem) {
    if (!isAdmin) return;
    const key = `approve-${item.kind}-${item.id}`;
    setBusyId(key);
    setError('');
    setMessage('');
    try {
      if (item.kind === 'voucher') {
        await api.approvePendingVoucher(item.id);
      } else {
        await api.approvePendingInvoice(item.id);
      }
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
      if (item.kind === 'voucher') {
        await api.rejectPendingVoucher(item.id);
      } else {
        await api.rejectPendingInvoice(item.id);
      }
      setMessage(`Cancelled/Rejected ${item.reference ?? item.type ?? 'item'}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PageShell title="Pending Approvals" subtitle="Review USER submissions before they post to the ledger">
      <Panel>
        {!isAdmin ? (
          <p className="mb-3 rounded bg-surface2 px-3 py-2 text-xs text-textSecondary font-medium">
            Viewing pending submissions. Approval actions require an ADMIN account.
          </p>
        ) : null}
        {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
        {message ? <p className="mb-3 text-sm text-success">{message}</p> : null}
        {loading ? (
          <p className="text-sm text-textMuted">Loading…</p>
        ) : (items?.length ?? 0) === 0 ? (
          <p className="text-sm text-textMuted">No pending vouchers or invoices.</p>
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
                          <PrimaryButton
                            type="button"
                            disabled={!isAdmin || isBusy}
                            onClick={() => void onApprove(item)}
                          >
                            {!isAdmin ? 'Admin only' : busyId === keyApprove ? 'Approving…' : 'Approve'}
                          </PrimaryButton>
                          {isAdmin && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void onReject(item)}
                              className="px-3 py-1.5 text-xs font-semibold rounded bg-danger/10 text-danger hover:bg-danger/20 disabled:opacity-50 transition-colors"
                            >
                              {busyId === keyReject ? 'Cancelling…' : 'Cancel'}
                            </button>
                          )}
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
