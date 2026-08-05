import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
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
      setItems(await api.listPendingApprovals());
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

  if (user?.role !== 'ADMIN') {
    return <Navigate to="/" replace />;
  }

  async function onApprove(item: PendingItem) {
    const key = `${item.kind}-${item.id}`;
    setBusyId(key);
    setError('');
    setMessage('');
    try {
      if (item.kind === 'voucher') {
        await api.approvePendingVoucher(item.id);
      } else {
        await api.approvePendingInvoice(item.id);
      }
      setMessage(`Approved ${item.reference ?? item.type}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PageShell title="Pending Approvals" subtitle="Review USER submissions before they post to the ledger">
      <Panel>
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
                  <th className="py-2 pr-3">Creator</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {(items ?? []).map((item) => {
                  const key = `${item.kind}-${item.id}`;
                  return (
                    <tr key={key} className="border-b border-border">
                      <td className="py-2 pr-3 capitalize">{item.kind}</td>
                      <td className="py-2 pr-3">{item.type.replaceAll('_', ' ')}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{item.reference ?? '—'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {item.date ? formatDate(item.date) : '—'}
                      </td>
                      <td className="py-2 pr-3">{item.createdBy?.displayName ?? '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatLedgerAmount(item.amount)}
                      </td>
                      <td className="py-2 pr-3 text-textSecondary">{item.description ?? '—'}</td>
                      <td className="py-2 text-right">
                        <PrimaryButton
                          type="button"
                          disabled={busyId === key}
                          onClick={() => void onApprove(item)}
                        >
                          {busyId === key ? 'Approving…' : 'Approve'}
                        </PrimaryButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-xs text-textMuted">
          Reject is not available yet — confirm whether pending items should be deleted or flagged first.
        </p>
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}
