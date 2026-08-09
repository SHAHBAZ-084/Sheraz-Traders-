import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useFinancialYear } from '../../contexts/FinancialYearContext';
import { api } from '../../lib/api';
import { hasBlockingOpenForms } from '../../stores/openFormsStore';
import { FieldLabel, PageShell, Panel, PrimaryButton, TextInput } from '../../components/ui/PageShell';
import { PageCloseBar } from '../../components/ui/PageCloseBar';

const FY_CHANGE_PASSWORD = 'CUIVHR';

const FY_GATE_KEY = 'fyAdminGate';

export function FinancialYearManagementPage() {
  const { user } = useAuth();
  const { activeYear, years, refreshYears } = useFinancialYear();
  const [gateOk] = useState(() => sessionStorage.getItem(FY_GATE_KEY) === '1');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [blockMessage, setBlockMessage] = useState('');

  useEffect(() => {
    return () => {
      sessionStorage.removeItem(FY_GATE_KEY);
    };
  }, []);

  const nextLabel = useMemo(() => {
    if (!activeYear) return '';
    const parts = activeYear.label.split('-').map((p) => parseInt(p, 10));
    if (parts.length === 2 && parts.every(Number.isFinite)) {
      return `${parts[0] + 1}-${parts[1] + 1}`;
    }
    return '';
  }, [activeYear]);

  if (user?.role !== 'ADMIN' || !gateOk) {
    return <Navigate to="/user" replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    setBlockMessage('');

    if (hasBlockingOpenForms()) {
      setBlockMessage('Close or save all open voucher and invoice forms before changing the financial year.');
      return;
    }

    if (password !== FY_CHANGE_PASSWORD) {
      return;
    }

    setBusy(true);
    try {
      const result = await api.changeFinancialYear(password);
      if (!result.ok) {
        return;
      }
      await refreshYears();
      setMessage(`Financial year updated. Closed ${result.closedYear.label}; active year is now ${result.newYear.label}.`);
      setPassword('');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title="Financial Year Management" subtitle="Internal administration">
      <Panel className="max-w-lg space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-textSecondary">Active financial year</p>
          <p className="text-lg font-medium text-textPrimary">{activeYear?.label ?? '—'}</p>
        </div>
        {nextLabel ? (
          <div>
            <p className="text-xs uppercase tracking-wide text-textSecondary">Next financial year</p>
            <p className="text-textPrimary">{nextLabel}</p>
          </div>
        ) : null}
        <div>
          <p className="text-xs uppercase tracking-wide text-textSecondary">All years</p>
          <ul className="mt-1 text-sm text-textPrimary">
            {years.map((y) => (
              <li key={y.id}>
                {y.label}
                {y.isActive ? ' (active)' : ''}
              </li>
            ))}
          </ul>
        </div>

        <form className="space-y-3 border-t border-border pt-4" onSubmit={onSubmit}>
          <div>
            <FieldLabel>Password</FieldLabel>
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
            />
          </div>
          {blockMessage ? <p className="text-sm text-danger">{blockMessage}</p> : null}
          {message ? <p className="text-sm text-success">{message}</p> : null}
          <PrimaryButton type="submit" disabled={busy || !password}>
            {busy ? 'Updating…' : 'Change Financial Year'}
          </PrimaryButton>
        </form>
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}
