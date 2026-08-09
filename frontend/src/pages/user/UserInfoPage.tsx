import { FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { FieldLabel, PageShell, Panel, PrimaryButton, SecondaryButton, TextInput } from '../../components/ui/PageShell';
import { PageCloseBar } from '../../components/ui/PageCloseBar';
import { api, type User } from '../../lib/api';

const FY_GATE_PASSWORD = 'CUIVHR';
const FY_GATE_KEY = 'fyAdminGate';

function isAdminShortcutActive(event: KeyboardEvent, keys: Set<string>) {
  return (
    event.ctrlKey &&
    event.altKey &&
    event.shiftKey &&
    keys.has('a') &&
    keys.has('s')
  );
}

function trackShortcutKey(keys: Set<string>, event: KeyboardEvent) {
  const code = event.code.toLowerCase();
  if (code === 'keya') keys.add('a');
  if (code === 'keys') keys.add('s');
  if (event.key.length === 1) keys.add(event.key.toLowerCase());
  if (event.ctrlKey) keys.add('Control');
  if (event.altKey) keys.add('Alt');
  if (event.shiftKey) keys.add('Shift');
}

function untrackShortcutKey(keys: Set<string>, event: KeyboardEvent) {
  const code = event.code.toLowerCase();
  if (code === 'keya' || event.key.toLowerCase() === 'a') keys.delete('a');
  if (code === 'keys' || event.key.toLowerCase() === 's') keys.delete('s');
  if (!event.ctrlKey) keys.delete('Control');
  if (!event.altKey) keys.delete('Alt');
  if (!event.shiftKey) keys.delete('Shift');
}

export function UserInfoPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'ADMIN';
  const pressedKeysRef = useRef(new Set<string>());

  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [gatePassword, setGatePassword] = useState('');

  useEffect(() => {
    if (!isAdmin) return;

    function onKeyDown(event: KeyboardEvent) {
      trackShortcutKey(pressedKeysRef.current, event);
      if (isAdminShortcutActive(event, pressedKeysRef.current)) {
        event.preventDefault();
        setGateOpen(true);
        setGatePassword('');
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      untrackShortcutKey(pressedKeysRef.current, event);
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [isAdmin]);

  function submitGate(event: FormEvent) {
    event.preventDefault();
    if (gatePassword !== FY_GATE_PASSWORD) {
      setGateOpen(false);
      setGatePassword('');
      return;
    }
    sessionStorage.setItem(FY_GATE_KEY, '1');
    setGateOpen(false);
    setGatePassword('');
    navigate('/user/fy-management');
  }

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

  async function onDeleteUser(u: User) {
    if (u.id === user?.id) {
      alert('Cannot delete your own account.');
      return;
    }
    if (!window.confirm(`Are you sure you want to delete user "${u.username}"?`)) {
      return;
    }
    setError('');
    setMessage('');
    try {
      await api.deleteUser(u.id);
      setMessage(`User "${u.username}" deleted.`);
      setUsers(await api.listUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
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
            {(users?.length ?? 0) === 0 ? (
              <p className="text-sm text-textMuted">No users found.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-textMuted">
                    <th className="py-2 pr-3">Username</th>
                    <th className="py-2 pr-3">Display name</th>
                    <th className="py-2 pr-3">Role</th>
                    <th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(users ?? []).map((row) => (
                    <tr key={row.id} className="border-b border-border/50">
                      <td className="py-2 pr-3 text-textPrimary">{row.username}</td>
                      <td className="py-2 pr-3 text-textPrimary">{row.displayName}</td>
                      <td className="py-2 pr-3 text-textSecondary">{row.role}</td>
                      <td className="py-2 text-right">
                        {row.id !== user?.id && (
                          <button
                            type="button"
                            onClick={() => void onDeleteUser(row)}
                            className="px-2.5 py-1 text-xs font-semibold rounded bg-danger/10 text-danger hover:bg-danger/20 transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      ) : null}

      <PageCloseBar />

      {gateOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <Panel className="w-full max-w-sm space-y-3">
            <form onSubmit={submitGate}>
              <FieldLabel>Password</FieldLabel>
              <TextInput
                type="password"
                value={gatePassword}
                onChange={(e) => setGatePassword(e.target.value)}
                autoFocus
                autoComplete="off"
              />
              <div className="mt-4 flex justify-end gap-2">
                <SecondaryButton type="button" onClick={() => setGateOpen(false)}>
                  Cancel
                </SecondaryButton>
                <PrimaryButton type="submit">Continue</PrimaryButton>
              </div>
            </form>
          </Panel>
        </div>
      ) : null}
    </PageShell>
  );
}
