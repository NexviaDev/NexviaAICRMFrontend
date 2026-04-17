import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import MainAppRoutes, { PendingRestrictedRoute } from './layout/main-app-routes';

const Layout = lazy(() => import('./layout/layout'));
const Home = lazy(() => import('./home/home'));
const Login = lazy(() => import('./login/login'));
const Register = lazy(() => import('./register/register'));
const LeadCapturePublic = lazy(() => import('./lead-capture-public/lead-capture-public'));
const LegalPublicPage = lazy(() => import('./legal/LegalPublicPage'));
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
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/legal/:doc" element={<LegalPublicPage />} />
        <Route path="/lead-form/:secret" element={<LeadCapturePublic />} />
        <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
          <Route index element={<Navigate to="subscription" replace />} />
          <Route path="subscription" element={<AdminSubscription />} />
          <Route path="notices" element={<AdminNotices />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="companies" element={<AdminCompanies />} />
        </Route>
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          {/* `/`는 index로 매칭 — 부모만 path="*"일 때 내부 Routes의 index가 비는 문제 방지 */}
          <Route index element={<PendingRestrictedRoute><Home /></PendingRestrictedRoute>} />
          <Route path="*" element={<MainAppRoutes includeHomeIndex={false} />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
