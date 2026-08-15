import { FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { FieldLabel, PageShell, Panel, PrimaryButton, SecondaryButton, TextInput } from '../../components/ui/PageShell';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { PageCloseBar } from '../../components/ui/PageCloseBar';
import { api, type User } from '../../lib/api';
import {
  clearFyAdminShortcutKeys,
  isFyAdminShortcutActive,
  trackFyAdminShortcutKey,
  untrackFyAdminShortcutKey,
} from '../../lib/fyAdminShortcut';

const FY_GATE_PASSWORD = 'CUIVHR';
const FY_GATE_KEY = 'fyAdminGate';

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(target.closest('[role="combobox"]'));
}

export function UserInfoPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'ADMIN';
  const pressedKeysRef = useRef(new Set<string>());
  const gateModalRef = useRef<HTMLDivElement>(null);
  const gatePasswordRef = useRef<HTMLInputElement>(null);

  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [gatePassword, setGatePassword] = useState('');

  useFocusTrap(gateModalRef, {
    disabled: !gateOpen,
    initialFocusRef: gatePasswordRef,
  });

  useEffect(() => {
    if (!isAdmin || gateOpen) return;

    function resetShortcutKeys() {
      clearFyAdminShortcutKeys(pressedKeysRef.current);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (isEditableShortcutTarget(event.target)) {
        clearFyAdminShortcutKeys(pressedKeysRef.current);
        return;
      }

      trackFyAdminShortcutKey(pressedKeysRef.current, event);
      if (isFyAdminShortcutActive(event, pressedKeysRef.current)) {
        event.preventDefault();
        clearFyAdminShortcutKeys(pressedKeysRef.current);
        setGateOpen(true);
        setGatePassword('');
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      untrackFyAdminShortcutKey(pressedKeysRef.current, event);
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', resetShortcutKeys);
    document.addEventListener('visibilitychange', resetShortcutKeys);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', resetShortcutKeys);
      document.removeEventListener('visibilitychange', resetShortcutKeys);
      resetShortcutKeys();
    };
  }, [isAdmin, gateOpen]);

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

  async function onChangePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError('');
    setPasswordMessage('');

    if (!currentPassword) {
      setPasswordError('Current password is required');
      return;
    }
    if (!newPassword) {
      setPasswordError('New password is required');
      return;
    }
    if (newPassword.length < 4) {
      setPasswordError('Password must be at least 4 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match');
      return;
    }

    setPasswordBusy(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('Password updated successfully.');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setPasswordBusy(false);
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

      <Panel className="mt-4 max-w-xl space-y-4">
        <h2 className="text-lg font-semibold text-textPrimary">Change password</h2>
        <p className="text-sm text-textMuted">Update your login password for this account.</p>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={onChangePassword}>
          <div className="sm:col-span-2">
            <FieldLabel>Current password</FieldLabel>
            <PasswordInput
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div>
            <FieldLabel>New password</FieldLabel>
            <PasswordInput
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div>
            <FieldLabel>Confirm new password</FieldLabel>
            <PasswordInput
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div className="sm:col-span-2">
            <PrimaryButton type="submit" disabled={passwordBusy}>
              {passwordBusy ? 'Updating…' : 'Update password'}
            </PrimaryButton>
          </div>
        </form>
        {passwordError ? <p className="text-sm text-danger">{passwordError}</p> : null}
        {passwordMessage ? <p className="text-sm text-success">{passwordMessage}</p> : null}
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
                <PasswordInput
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
        <div
          ref={gateModalRef}
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setGateOpen(false);
              setGatePassword('');
            }
          }}
        >
          <Panel className="w-full max-w-sm space-y-3">
            <form
              onSubmit={submitGate}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setGateOpen(false);
                  setGatePassword('');
                }
              }}
            >
              <FieldLabel>Password</FieldLabel>
              <PasswordInput
                ref={gatePasswordRef}
                value={gatePassword}
                onChange={(e) => setGatePassword(e.target.value)}
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
