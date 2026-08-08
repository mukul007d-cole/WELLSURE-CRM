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
import { JourneysPage } from './pages/admin/JourneysPage';
import { FieldsPage } from './pages/admin/FieldsPage';
import { UsersPage } from './pages/admin/UsersPage';
import { DepartmentsPage } from './pages/admin/DepartmentsPage';
import { RolesPage } from './pages/admin/RolesPage';
import { JourneyDetailPage } from './pages/admin/JourneyDetailPage';
import { RoleDetailPage } from './pages/admin/RoleDetailPage';
import { NotificationRulesPage } from './pages/admin/NotificationRulesPage';
import { OrgChartPage } from './pages/admin/OrgChartPage';
import { UserManagementPage } from './pages/admin/UserManagementPage';
import { BoardPage } from './pages/board/BoardPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { PreferencesProvider } from './app/preferences';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <PreferencesProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<ProtectedRoute />}>
                <Route element={<AppShell title="Wellsure CRM" />}>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/sellers/board" element={<BoardPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/sellers" element={<SellerListPage />} />
                  <Route path="/sellers/new" element={<LeadFormPage />} />
                  <Route path="/sellers/:sellerId" element={<Seller360Page />} />
                  <Route path="/sellers/:sellerId/edit" element={<LeadFormPage />} />
                  <Route element={<PermissionRoute module="journeys_statuses" />}>
                    <Route path="/admin/journeys" element={<JourneysPage />} />
                    <Route path="/admin/journeys/:journeyId" element={<JourneyDetailPage />} />
                  </Route>
                  <Route element={<PermissionRoute module="fields" />}>
                    <Route path="/admin/fields" element={<FieldsPage />} />
                  </Route>
                  <Route element={<PermissionRoute module="users" />}>
                    {/* Directory and org chart are two views of one area. */}
                    <Route path="/admin/users" element={<UserManagementPage />}>
                      <Route index element={<UsersPage />} />
                      <Route path="org-chart" element={<OrgChartPage />} />
                    </Route>
                    <Route path="/admin/departments" element={<DepartmentsPage />} />
                  </Route>
                  <Route element={<PermissionRoute module="roles_permissions" />}>
                    <Route path="/admin/roles" element={<RolesPage />} />
                    <Route path="/admin/roles/:roleId" element={<RoleDetailPage />} />
                    <Route path="/admin/notification-rules" element={<NotificationRulesPage />} />
                  </Route>
                </Route>
              </Route>
              <Route path="/" element={<Navigate to="/sellers" replace />} />
              <Route path="*" element={<Navigate to="/sellers" replace />} />
            </Routes>
          </PreferencesProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
