import { useAuth } from '../contexts/AuthContext';

export function useIsAdmin(): boolean {
  const { user } = useAuth();
  return user?.role === 'ADMIN';
}
