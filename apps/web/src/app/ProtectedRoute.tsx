import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Spinner } from '../components/ui/Spinner';

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'checking') {
    return (
      <div className="flex h-dvh items-center justify-center bg-paper">
        <Spinner size={28} tone="gold" label="Checking your session" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
