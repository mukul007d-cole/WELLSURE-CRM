import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './app/AuthContext';
import { ProtectedRoute } from './app/ProtectedRoute';
import { PermissionRoute } from './app/PermissionRoute';
import { queryClient } from './app/queryClient';
import { AppShell } from './components/layout/AppShell';
import { LeadFormPage } from './pages/lead-form/LeadFormPage';
import { LoginPage } from './pages/login/LoginPage';
import { Seller360Page } from './pages/seller-detail/Seller360Page';
import { SellerListPage } from './pages/sellers/SellerListPage';
import { AdminListPage } from './pages/admin/AdminListPage';
import { JourneyDetailPage } from './pages/admin/JourneyDetailPage';
import { RoleDetailPage } from './pages/admin/RoleDetailPage';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell title="Wellsure CRM" />}>
                <Route path="/sellers" element={<SellerListPage />} />
                <Route path="/sellers/new" element={<LeadFormPage />} />
                <Route path="/sellers/:sellerId" element={<Seller360Page />} />
                <Route path="/sellers/:sellerId/edit" element={<LeadFormPage />} />
                <Route element={<PermissionRoute module="journeys_statuses" />}><Route path="/admin/journeys" element={<AdminListPage kind="journeys" />} /><Route path="/admin/journeys/:journeyId" element={<JourneyDetailPage />} /></Route>
                <Route element={<PermissionRoute module="fields" />}><Route path="/admin/fields" element={<AdminListPage kind="fields" />} /></Route>
                <Route element={<PermissionRoute module="users" />}><Route path="/admin/users" element={<AdminListPage kind="users" />} /><Route path="/admin/departments" element={<AdminListPage kind="departments" />} /></Route>
                <Route element={<PermissionRoute module="roles_permissions" />}><Route path="/admin/roles" element={<AdminListPage kind="roles" />} /><Route path="/admin/roles/:roleId" element={<RoleDetailPage />} /></Route>
              </Route>
            </Route>
            <Route path="/" element={<Navigate to="/sellers" replace />} />
            <Route path="*" element={<Navigate to="/sellers" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
