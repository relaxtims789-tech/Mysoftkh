import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { Me, onSession, refreshSession } from './api';

interface AuthState {
  user: Me | null;
  ready: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, ready: false });

/** Restores the session from the refresh cookie on start-up and follows sign-in / sign-out. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, ready: false });
  useEffect(() => {
    const off = onSession((s) => setState({ user: s?.user ?? null, ready: true }));
    refreshSession().then((s) => setState({ user: s?.user ?? null, ready: true }));
    return () => {
      off();
    };
  }, []);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export const isStaff = (u: Me | null) => !!u && u.role !== 'employee';
export const isAdmin = (u: Me | null) => !!u && ['super_admin', 'company_admin', 'hr'].includes(u.role);
export const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin', company_admin: 'Company admin', hr: 'HR', manager: 'Manager', employee: 'Employee',
};
