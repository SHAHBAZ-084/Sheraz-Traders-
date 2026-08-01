import { useState } from 'react';
import { PageShell, Panel, SecondaryButton, Tile } from '../../components/ui/PageShell';
import { PageCloseBar } from '../../components/ui/PageCloseBar';
import { api } from '../../lib/api';

export function DatabaseMaintenancePage() {
  const [dbChecking, setDbChecking] = useState(false);
  const [dbResult, setDbResult] = useState<{ ok: boolean; results: string[] } | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function onVerifyDatabase() {
    setDbChecking(true);
    setDbResult(null);
    setError('');
    try {
      const result = await api.verifyDatabaseIntegrity();
      setDbResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Integrity check failed');
    } finally {
      setDbChecking(false);
    }
  }

  async function onBackupDatabase() {
    setBackingUp(true);
    setError('');
    setMessage('');
    try {
      const result = await api.backupDatabase();
      setMessage(result.path ? `Backup saved to ${result.path}` : 'Backup skipped — no database file yet.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup failed');
    } finally {
      setBackingUp(false);
    }
  }

  return (
    <PageShell title="Database Maintenance" subtitle="Integrity checks and backups">
      <Panel className="max-w-2xl">
        <Tile>
          <p className="text-sm font-medium text-textPrimary">Database maintenance</p>
          <p className="mt-1 text-xs text-textMuted">
            Verify local SQLite integrity or create an on-demand backup. Automatic backups run on
            app startup in production.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <SecondaryButton type="button" onClick={onVerifyDatabase} disabled={dbChecking}>
              {dbChecking ? 'Checking…' : 'Verify database integrity'}
            </SecondaryButton>
            <SecondaryButton type="button" onClick={onBackupDatabase} disabled={backingUp}>
              {backingUp ? 'Backing up…' : 'Backup database now'}
            </SecondaryButton>
          </div>
          {dbResult ? (
            <p className={`mt-3 text-sm ${dbResult.ok ? 'text-success' : 'text-danger'}`}>
              {dbResult.ok
                ? 'Integrity check passed (ok).'
                : `Integrity issues: ${dbResult.results.join('; ')}`}
            </p>
          ) : null}
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
          {message ? <p className="mt-3 text-sm text-success">{message}</p> : null}
        </Tile>
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}
