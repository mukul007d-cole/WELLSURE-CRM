import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function PermissionRoute({ module, action = 'view' }: { module: string; action?: string }) {
  const { can } = useAuth();
  const location = useLocation();
  return can(module, action) ? <Outlet /> : <Navigate to="/sellers" replace state={{ forbiddenFrom: location.pathname }} />;
}
