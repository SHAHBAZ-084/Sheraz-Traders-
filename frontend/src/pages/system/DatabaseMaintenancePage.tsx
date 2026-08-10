import { useCallback, useEffect, useState } from 'react';
import { PageShell, Panel, PrimaryButton, SecondaryButton, Tile } from '../../components/ui/PageShell';
import { PageCloseBar } from '../../components/ui/PageCloseBar';
import { api, BackupStatus } from '../../lib/api';
import { formatDate } from '../../lib/format';

function formatBackupTimestamp(iso: string): string {
  const date = new Date(iso);
  return `${formatDate(iso)} ${date.toLocaleTimeString()}`;
}

export function DatabaseMaintenancePage() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [dbChecking, setDbChecking] = useState(false);
  const [dbResult, setDbResult] = useState<{ ok: boolean; results: string[] } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      setLoadingStatus(true);
      const res = await api.getBackupStatus();
      setStatus(res);
    } catch (err) {
      console.error('Failed to load backup status', err);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

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

  async function onConnectGoogleDrive() {
    setActionLoading(true);
    setError('');
    setMessage('');
    try {
      setMessage('Opening browser for Google Drive consent… Please approve access in your browser.');
      await api.connectGoogleDrive();
      setMessage('Google Drive connected successfully!');
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Google Drive');
    } finally {
      setActionLoading(false);
    }
  }

  async function onDisconnectGoogleDrive() {
    if (!window.confirm('Are you sure you want to disconnect Google Drive backup?')) return;
    setActionLoading(true);
    setError('');
    setMessage('');
    try {
      await api.disconnectGoogleDrive();
      setMessage('Google Drive disconnected.');
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect Google Drive');
    } finally {
      setActionLoading(false);
    }
  }

  async function onTriggerBackupNow() {
    setActionLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await api.triggerGoogleDriveBackup();
      const uploadedAt = res.uploadedAt ?? new Date().toISOString();
      setMessage(`Backup completed — uploaded to Google Drive (${formatBackupTimestamp(uploadedAt)})`);
      await loadStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Backup failed';
      setError(message);
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <PageShell title="Database Maintenance" subtitle="Integrity checks and manual Google Drive backup">
      <Panel className="max-w-3xl space-y-4">
        {status?.needsReconnect ? (
          <div className="rounded-md bg-danger/10 p-4 border border-danger/30 text-danger">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-sm">Google Drive Reconnection Required</p>
                <p className="mt-1 text-xs text-danger/90">
                  Your Google Drive access token has expired or was revoked. Click Reconnect Google Drive below to
                  re-authorize before running a backup.
                </p>
              </div>
              <PrimaryButton
                type="button"
                onClick={onConnectGoogleDrive}
                disabled={actionLoading}
                className="shrink-0 bg-danger text-white hover:bg-danger/90"
              >
                Reconnect Google Drive
              </PrimaryButton>
            </div>
          </div>
        ) : null}

        <Tile>
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <p className="text-sm font-semibold text-textPrimary">Google Drive Backup</p>
              <p className="mt-0.5 text-xs text-textMuted">
                Click Backup to upload a database snapshot to your Google Drive folder (&quot;Sheeraz Traders Backups&quot;).
                Backups run only when you click the button.
              </p>
            </div>
            {loadingStatus ? (
              <span className="text-xs text-textMuted">Loading status…</span>
            ) : status?.connected && !status.needsReconnect ? (
              <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
                Connected
              </span>
            ) : status?.needsReconnect ? (
              <span className="rounded-full bg-danger/15 px-2.5 py-1 text-xs font-semibold text-danger">
                Needs Reconnect
              </span>
            ) : (
              <span className="rounded-full bg-surface2 px-2.5 py-1 text-xs font-medium text-textMuted">
                Not Connected
              </span>
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="rounded border border-border p-3 bg-surface2/50">
              <span className="text-textMuted font-medium block">Last Successful Backup</span>
              <span className="mt-1 text-sm font-semibold text-textPrimary block">
                {status?.lastSuccessAt ? formatBackupTimestamp(status.lastSuccessAt) : 'Never'}
              </span>
            </div>

            <div className="rounded border border-border p-3 bg-surface2/50">
              <span className="text-textMuted font-medium block">Last Backup Attempt</span>
              <span className="mt-1 text-sm font-semibold text-textPrimary block">
                {status?.lastAttemptAt ? formatBackupTimestamp(status.lastAttemptAt) : 'None'}
              </span>
            </div>
          </div>

          {status?.lastError ? (
            <div className="mt-3 rounded bg-danger/5 p-2.5 text-xs text-danger border border-danger/20">
              <span className="font-semibold">Last Error:</span> {status.lastError}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2">
            {!status?.connected ? (
              <PrimaryButton type="button" onClick={onConnectGoogleDrive} disabled={actionLoading}>
                {actionLoading ? 'Connecting…' : 'Connect Google Drive'}
              </PrimaryButton>
            ) : (
              <>
                <PrimaryButton type="button" onClick={onTriggerBackupNow} disabled={actionLoading || status.needsReconnect}>
                  {actionLoading ? 'Backing up…' : 'Backup'}
                </PrimaryButton>
                <SecondaryButton type="button" onClick={onDisconnectGoogleDrive} disabled={actionLoading}>
                  Disconnect Google Drive
                </SecondaryButton>
              </>
            )}
          </div>
        </Tile>

        <Tile>
          <p className="text-sm font-medium text-textPrimary">Local Database Integrity</p>
          <p className="mt-1 text-xs text-textMuted">
            Run SQLite internal PRAGMA integrity check on the active database file.
          </p>
          <div className="mt-3">
            <SecondaryButton type="button" onClick={onVerifyDatabase} disabled={dbChecking}>
              {dbChecking ? 'Checking…' : 'Verify database integrity'}
            </SecondaryButton>
          </div>
          {dbResult ? (
            <p className={`mt-3 text-sm ${dbResult.ok ? 'text-success' : 'text-danger'}`}>
              {dbResult.ok
                ? 'Integrity check passed (ok).'
                : `Integrity issues: ${dbResult.results.join('; ')}`}
            </p>
          ) : null}
        </Tile>

        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {message ? <p className="text-sm text-success">{message}</p> : null}
      </Panel>
      <PageCloseBar />
    </PageShell>
  );
}
