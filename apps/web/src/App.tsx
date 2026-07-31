import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './app/AuthContext';
import { ProtectedRoute } from './app/ProtectedRoute';
import { queryClient } from './app/queryClient';
import { AppShell } from './components/layout/AppShell';
import { LeadFormPage } from './pages/lead-form/LeadFormPage';
import { LoginPage } from './pages/login/LoginPage';
import { Seller360Page } from './pages/seller-detail/Seller360Page';
import { SellerListPage } from './pages/sellers/SellerListPage';

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
