import { useAuth } from '../../contexts/AuthContext';
import { PageShell, Panel, SecondaryButton } from '../../components/ui/PageShell';

export function UserInfoPage() {
  const { user, logout } = useAuth();

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
        <SecondaryButton onClick={() => logout()}>Sign out</SecondaryButton>
      </Panel>
    </PageShell>
  );
}
