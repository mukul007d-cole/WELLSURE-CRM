import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { authApi } from '../lib/api-client';
import { ORGANIZATION_ID } from '../lib/constants';
import type { CapabilitySet, SessionUser } from '../types/domain';

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  capabilities: CapabilitySet | null;
  can: (module: string, action: string) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitySet | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([authApi.me(), authApi.capabilities()])
      .then(([profile, grants]) => {
        if (!cancelled) {
          setUser(profile);
          setCapabilities(grants);
          setStatus('authenticated');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setCapabilities(null);
          setStatus('unauthenticated');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await authApi.login(ORGANIZATION_ID, email, password);
    const [profile, grants] = await Promise.all([authApi.me(), authApi.capabilities()]);
    setUser(profile);
    setCapabilities(grants);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    setCapabilities(null);
    setStatus('unauthenticated');
  }, []);

  const can = useCallback((module: string, action: string) => capabilities?.permissions.some((grant) => grant.module === module && grant.action === action) ?? false, [capabilities]);
  const value = useMemo(() => ({ status, user, capabilities, can, login, logout }), [status, user, capabilities, can, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
