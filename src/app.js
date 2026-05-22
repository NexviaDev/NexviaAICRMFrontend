import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import MainAppRoutes, { PendingRestrictedRoute } from './layout/main-app-routes';
import { useGuestOnlyRedirect } from './lib/use-crm-token';

const Layout = lazy(() => import('./layout/layout'));
const Dashboard = lazy(() => import('./dashboard/dashboard'));
/** 마케팅 홈 — 비로그인 공개 / 만 */
const Home = lazy(() => import('./home/home'));
const Login = lazy(() => import('./login/login'));
const Register = lazy(() => import('./register/register'));
const LeadCapturePublic = lazy(() => import('./lead-capture-public/lead-capture-public'));
const LegalPublicPage = lazy(() => import('./legal/LegalPublicPage'));
const PwaInstallRedirect = lazy(() => import('./pwa-install-redirect/pwa-install-redirect'));
const AdminSubscription = lazy(() => import('./admin/adminsubscription'));
const AdminLayout = lazy(() => import('./admin/adminlayout'));
const AdminNotices = lazy(() => import('./admin/adminnotices'));
const AdminUsers = lazy(() => import('./admin/adminusers'));
const AdminCompanies = lazy(() => import('./admin/admincompanies'));

/** 로그인하지 않으면 /login으로 리다이렉트 */
function ProtectedRoute({ children }) {
  const token = localStorage.getItem('crm_token');
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

/** 로그인 시 / · /login 등 → /dashboard */
function GuestOnlyRoute({ children }) {
  const redirectTo = useGuestOnlyRedirect();
  if (redirectTo) return <Navigate to={redirectTo} replace />;
  return children;
}

/** 알 수 없는 경로 — 비로그인은 /, 로그인은 /dashboard */
function AppFallbackRedirect() {
  const token = localStorage.getItem('crm_token');
  return <Navigate to={token ? '/dashboard' : '/'} replace />;
}

/** 라우트 청크 로딩 중 (FCP 이후 짧은 표시) */
function RouteChunkFallback() {
  return (
    <div
      className="app-route-chunk-fallback"
      role="status"
      aria-live="polite"
      style={{
        minHeight: '45vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#7c8aa0',
        fontSize: '14px',
        letterSpacing: '0.02em'
      }}
    >
      불러오는 중…
    </div>
  );
}

function App() {
  return (
    <Suspense fallback={<RouteChunkFallback />}>
      <Routes>
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="/landing" element={<Navigate to="/" replace />} />
        <Route path="/" element={<GuestOnlyRoute><Home /></GuestOnlyRoute>} />
        <Route path="/login" element={<GuestOnlyRoute><Login /></GuestOnlyRoute>} />
        <Route path="/register" element={<Register />} />
        <Route path="/legal/:doc" element={<LegalPublicPage />} />
        <Route path="/install" element={<PwaInstallRedirect />} />
        <Route path="/lead-form/:secret" element={<LeadCapturePublic />} />
        <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
          <Route index element={<Navigate to="subscription" replace />} />
          <Route path="subscription" element={<AdminSubscription />} />
          <Route path="notices" element={<AdminNotices />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="companies" element={<AdminCompanies />} />
        </Route>
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="dashboard" element={<PendingRestrictedRoute><Dashboard /></PendingRestrictedRoute>} />
          <Route path="*" element={<MainAppRoutes />} />
        </Route>
        <Route path="*" element={<AppFallbackRedirect />} />
      </Routes>
    </Suspense>
  );
}

export default App;
