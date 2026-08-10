import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function LoginPage() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface3 px-4">
      <div className="w-full max-w-md border border-border bg-surface2">
        <div className="border-b border-border bg-[var(--fill-accent)] px-6 py-5 text-center text-white">
          <img src="/sheeraz-traders-logo.png" alt="Sheeraz Traders" className="login-brand-logo mx-auto" />
          <p className="mt-2 text-xs uppercase tracking-widest opacity-90">Grain Market POS</p>
        </div>

        <form className="space-y-4 p-6" onSubmit={handleSubmit}>
          <p className="text-sm text-textSecondary">Sign in to continue</p>

          <div>
            <label htmlFor="username" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-textSecondary">
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-sm border border-border px-2.5 py-2 text-sm outline-none focus:border-borderStrong"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-textSecondary">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-sm border border-border px-2.5 py-2 text-sm outline-none focus:border-borderStrong"
              required
            />
          </div>

          {error ? <p className="border border-danger bg-bgDanger px-3 py-2 text-sm text-danger">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full btn-primary py-2.5 font-semibold disabled:cursor-not-allowed"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
