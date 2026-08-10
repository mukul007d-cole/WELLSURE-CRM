import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

/** Shared by the Topbar menu and the Settings page so they can't drift. */
export function useSignOut(): () => Promise<void> {
  const { logout } = useAuth();
  const navigate = useNavigate();

  return useCallback(async () => {
    await logout();
    void navigate('/login', { replace: true });
  }, [logout, navigate]);
}
