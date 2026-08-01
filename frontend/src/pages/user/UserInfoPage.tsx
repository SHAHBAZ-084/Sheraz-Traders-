import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { FieldLabel, PageShell, Panel, PrimaryButton, SecondaryButton, TextInput } from '../../components/ui/PageShell';
import { PageCloseBar } from '../../components/ui/PageCloseBar';
import { api, type User } from '../../lib/api';

export function UserInfoPage() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    api
      .listUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [isAdmin]);

  async function onCreateUser(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!username.trim() || !password) {
      setError('Username and password are required');
      return;
    }
    setBusy(true);
    try {
      await api.createUser({
        username: username.trim(),
        password,
        displayName: displayName.trim() || undefined,
      });
      setUsername('');
      setPassword('');
      setDisplayName('');
      setMessage('User account created.');
      setUsers(await api.listUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title="User Information" subtitle="Signed-in clerk profile">
      <Panel className="max-w-md space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-textSecondary">Display name</p>
          <p className="text-lg font-medium text-textPrimary">{user?.displayName}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-textSecondary">Username</p>
          <p className="text-textPrimary">{user?.username}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-textSecondary">Role</p>
          <p className="text-textPrimary">{user?.role}</p>
        </div>
        <SecondaryButton onClick={() => logout()}>Sign out</SecondaryButton>
      </Panel>

      {isAdmin ? (
        <>
          <Panel className="mt-4 max-w-xl space-y-4">
            <h2 className="text-lg font-semibold text-textPrimary">Create user account</h2>
            <p className="text-sm text-textMuted">New accounts are created with the USER role.</p>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={onCreateUser}>
              <div>
                <FieldLabel>Username</FieldLabel>
                <TextInput value={username} onChange={(e) => setUsername(e.target.value)} required />
              </div>
              <div>
                <FieldLabel>Password</FieldLabel>
                <TextInput
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel>Display name</FieldLabel>
                <TextInput
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="sm:col-span-2">
                <PrimaryButton type="submit" disabled={busy}>
                  {busy ? 'Creating…' : 'Create USER'}
                </PrimaryButton>
              </div>
            </form>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            {message ? <p className="text-sm text-success">{message}</p> : null}
          </Panel>

          <Panel className="mt-4 max-w-xl">
            <h2 className="mb-3 text-lg font-semibold text-textPrimary">Existing users</h2>
            {users.length === 0 ? (
              <p className="text-sm text-textMuted">No users found.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-textMuted">
                    <th className="py-2 pr-3">Username</th>
                    <th className="py-2 pr-3">Display name</th>
                    <th className="py-2">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((row) => (
                    <tr key={row.id} className="border-b border-border/50">
                      <td className="py-2 pr-3 text-textPrimary">{row.username}</td>
                      <td className="py-2 pr-3 text-textPrimary">{row.displayName}</td>
                      <td className="py-2 text-textSecondary">{row.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      ) : null}

      <PageCloseBar />
    </PageShell>
  );
}
