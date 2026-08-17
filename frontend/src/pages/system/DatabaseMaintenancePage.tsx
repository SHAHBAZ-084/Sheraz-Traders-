import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PageShell, Panel, PrimaryButton, SecondaryButton, Tile, FieldLabel, TextInput } from '../../components/ui/PageShell';
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
  const [localBackupPath, setLocalBackupPath] = useState('');
  const [localPathSaving, setLocalPathSaving] = useState(false);
  const [localBackupLoading, setLocalBackupLoading] = useState(false);
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthClientSecret, setOauthClientSecret] = useState('');
  const [oauthSaving, setOauthSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      setLoadingStatus(true);
      setError('');
      const res = await api.getBackupStatus();
      setStatus(res);
      setLocalBackupPath(res.local?.path ?? '');
    } catch (err) {
      console.error('Failed to load backup status', err);
      setError(err instanceof Error ? err.message : 'Failed to load backup status');
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

  async function onSaveGoogleOAuthConfig(event: FormEvent) {
    event.preventDefault();
    setOauthSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await api.saveGoogleOAuthConfig({
        clientId: oauthClientId.trim(),
        clientSecret: oauthClientSecret.trim(),
      });
      setOauthClientSecret('');
      setMessage(
        `Google OAuth credentials saved securely (${res.clientIdHint ?? 'configured'}). You can now connect Google Drive.`,
      );
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Google OAuth credentials');
    } finally {
      setOauthSaving(false);
    }
  }

  async function onConnectGoogleDrive() {
    if (!status?.oauthConfigured) {
      setError('Save your Google Cloud OAuth Client ID and Client Secret before connecting Google Drive.');
      return;
    }
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

  async function onBrowseLocalBackupFolder() {
    if (!window.grainPos?.selectDirectory) {
      setError('Folder picker is available in the desktop app only. Type the backup folder path manually.');
      return;
    }
    setError('');
    try {
      const selected = await window.grainPos.selectDirectory();
      if (selected) setLocalBackupPath(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open folder picker');
    }
  }

  async function onSaveLocalBackupPath(event: FormEvent) {
    event.preventDefault();
    setLocalPathSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await api.saveLocalBackupPath(localBackupPath.trim());
      setLocalBackupPath(res.path);
      setMessage(`Local backup folder saved: ${res.path}`);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save local backup folder');
    } finally {
      setLocalPathSaving(false);
    }
  }

  async function onTriggerLocalBackupNow() {
    setLocalBackupLoading(true);
    setError('');
    setMessage('');
    try {
      const trimmedPath = localBackupPath.trim();
      const res = await api.triggerLocalBackup(trimmedPath || undefined);
      const backedUpAt = res.backedUpAt ?? new Date().toISOString();
      setMessage(
        `Local backup completed${res.path ? ` — saved to ${res.path}` : ''} (${formatBackupTimestamp(backedUpAt)})`,
      );
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Local backup failed');
    } finally {
      setLocalBackupLoading(false);
    }
  }

  const localStatus = status?.local;

  return (
    <PageShell title="Database Maintenance" subtitle="Integrity checks and manual backups">
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
          <div className="border-b border-border pb-3">
            <p className="text-sm font-semibold text-textPrimary">Google Cloud OAuth Setup</p>
            <p className="mt-0.5 text-xs text-textMuted">
              Enter your Google Cloud OAuth Client ID and Client Secret once. They are encrypted on this computer
              (Electron safeStorage) and are never stored in the app source code.
            </p>
          </div>

          {status?.oauthConfigured ? (
            <p className="mt-3 text-xs text-success">
              OAuth configured{status.oauthClientIdHint ? `: ${status.oauthClientIdHint}` : ''}. Enter new values below
              only if you rotated the secret in Google Cloud Console.
            </p>
          ) : (
            <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-textPrimary">
              <span className="font-semibold">Action required before first Google Drive backup:</span> create a Desktop
              OAuth client in Google Cloud Console, then paste the Client ID and Client Secret here. Because the old
              secret was previously embedded in source code, regenerate/rotate the OAuth client secret in Google Cloud
              before saving the new values.
            </p>
          )}

          <form className="mt-4 space-y-3" onSubmit={onSaveGoogleOAuthConfig}>
            <div>
              <FieldLabel>OAuth Client ID</FieldLabel>
              <TextInput
                value={oauthClientId}
                onChange={(e) => setOauthClientId(e.target.value)}
                placeholder="xxxx.apps.googleusercontent.com"
                autoComplete="off"
                required
              />
            </div>
            <div>
              <FieldLabel>OAuth Client Secret</FieldLabel>
              <TextInput
                type="password"
                value={oauthClientSecret}
                onChange={(e) => setOauthClientSecret(e.target.value)}
                placeholder="Enter client secret"
                autoComplete="new-password"
                required
              />
            </div>
            <PrimaryButton type="submit" disabled={oauthSaving || !oauthClientId.trim() || !oauthClientSecret.trim()}>
              {oauthSaving ? 'Saving…' : status?.oauthConfigured ? 'Update OAuth credentials' : 'Save OAuth credentials'}
            </PrimaryButton>
          </form>
        </Tile>

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
              <PrimaryButton
                type="button"
                onClick={onConnectGoogleDrive}
                disabled={actionLoading || !status?.oauthConfigured}
              >
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
          <div className="border-b border-border pb-3">
            <p className="text-sm font-semibold text-textPrimary">Local Backup</p>
            <p className="mt-0.5 text-xs text-textMuted">
              Save a database snapshot to a folder on this computer.
            </p>
          </div>

          <form className="mt-4 space-y-3" onSubmit={onSaveLocalBackupPath}>
            <div>
              <FieldLabel>Backup folder</FieldLabel>
              <div className="flex flex-wrap gap-2">
                <TextInput
                  value={localBackupPath}
                  onChange={(e) => setLocalBackupPath(e.target.value)}
                  placeholder="D:\Backups"
                  className="min-w-[16rem] flex-1"
                />
                <SecondaryButton type="button" onClick={() => void onBrowseLocalBackupFolder()}>
                  Browse…
                </SecondaryButton>
              </div>
            </div>
            <SecondaryButton
              type="submit"
              disabled={localPathSaving || !localBackupPath.trim()}
            >
              {localPathSaving ? 'Saving…' : 'Save folder'}
            </SecondaryButton>
          </form>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="rounded border border-border p-3 bg-surface2/50">
              <span className="text-textMuted font-medium block">Last Successful Backup</span>
              <span className="mt-1 text-sm font-semibold text-textPrimary block">
                {localStatus?.lastSuccessAt ? formatBackupTimestamp(localStatus.lastSuccessAt) : 'Never'}
              </span>
            </div>

            <div className="rounded border border-border p-3 bg-surface2/50">
              <span className="text-textMuted font-medium block">Last Backup Attempt</span>
              <span className="mt-1 text-sm font-semibold text-textPrimary block">
                {localStatus?.lastAttemptAt ? formatBackupTimestamp(localStatus.lastAttemptAt) : 'None'}
              </span>
            </div>
          </div>

          {localStatus?.lastError ? (
            <div className="mt-3 rounded bg-danger/5 p-2.5 text-xs text-danger border border-danger/20">
              <span className="font-semibold">Last Error:</span> {localStatus.lastError}
            </div>
          ) : null}

          <div className="mt-5">
            <PrimaryButton
              type="button"
              onClick={() => void onTriggerLocalBackupNow()}
              disabled={localBackupLoading || !localBackupPath.trim()}
            >
              {localBackupLoading ? 'Backing up…' : 'Backup Now'}
            </PrimaryButton>
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
