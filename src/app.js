import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

const Layout = lazy(() => import('./layout/layout'));
const Login = lazy(() => import('./login/login'));
const Register = lazy(() => import('./register/register'));
const Home = lazy(() => import('./home/home'));
const CustomerCompanies = lazy(() => import('./customer-companies/customer-companies'));
const CustomerCompanyEmployees = lazy(() => import('./customer-company-employees/customer-company-employees'));
const Calendar = lazy(() => import('./calendar/calendar'));
const SalesReport = lazy(() => import('./sales-report/sales-report'));
const EmployeePerformance = lazy(() => import('./employee-performance/employee-performance'));
const EmployeeWorkReport = lazy(() => import('./employee-work-report/employee-work-report'));
const CompanyOverview = lazy(() => import('./company-overview/company-overview'));
const SalesPipeline = lazy(() => import('./sales-pipeline/sales-pipeline'));
const ProductList = lazy(() => import('./product-list/product-list'));
const MeetingMinutes = lazy(() => import('./meeting-minutes/meeting-minutes'));
const AiVoice = lazy(() => import('./ai-voice/ai-voice'));
const Email = lazy(() => import('./email/email'));
const Map = lazy(() => import('./map/map'));
const TodoList = lazy(() => import('./todo-list/todo-list'));
const LeadCapture = lazy(() => import('./lead-capture/lead-capture'));
const LeadCapturePublic = lazy(() => import('./lead-capture-public/lead-capture-public'));
const LegalPublicPage = lazy(() => import('./legal/LegalPublicPage'));
const Subscription = lazy(() => import('./subscription/subscription'));
const AdminSubscription = lazy(() => import('./admin/adminsubscription'));
const AdminLayout = lazy(() => import('./admin/adminlayout'));
const AdminNotices = lazy(() => import('./admin/adminnotices'));
const AdminUsers = lazy(() => import('./admin/adminusers'));
const AdminCompanies = lazy(() => import('./admin/admincompanies'));
const NotificationPage = lazy(() => import('./notification/notification'));
const Messenger = lazy(() => import('./messenger/messenger'));
const BusinessRegistryPage = lazy(() => import('./business-registry/business-registry'));

function getStoredUser() {
  try {
    const raw = localStorage.getItem('crm_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isPendingUser() {
  return getStoredUser()?.role === 'pending';
}

/** 로그인하지 않으면 /login으로 리다이렉트 */
function ProtectedRoute({ children }) {
  const token = localStorage.getItem('crm_token');
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

function PendingRestrictedRoute({ children }) {
  if (isPendingUser()) return <Navigate to="/company-overview" replace />;
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
          <Route index element={<PendingRestrictedRoute><Home /></PendingRestrictedRoute>} />
          <Route path="company-overview" element={<CompanyOverview />} />
          <Route path="customer-companies" element={<PendingRestrictedRoute><CustomerCompanies /></PendingRestrictedRoute>} />
          <Route path="customer-company-employees" element={<PendingRestrictedRoute><CustomerCompanyEmployees /></PendingRestrictedRoute>} />
          <Route path="calendar" element={<PendingRestrictedRoute><Calendar /></PendingRestrictedRoute>} />
          <Route path="sales-pipeline" element={<PendingRestrictedRoute><SalesPipeline /></PendingRestrictedRoute>} />
          <Route path="product-list" element={<PendingRestrictedRoute><ProductList /></PendingRestrictedRoute>} />
          <Route path="lead-capture" element={<PendingRestrictedRoute><LeadCapture /></PendingRestrictedRoute>} />
          <Route path="meeting-minutes" element={<PendingRestrictedRoute><MeetingMinutes /></PendingRestrictedRoute>} />
          <Route path="ai-voice" element={<PendingRestrictedRoute><AiVoice /></PendingRestrictedRoute>} />
          <Route path="email" element={<PendingRestrictedRoute><Email /></PendingRestrictedRoute>} />
          <Route path="messenger" element={<PendingRestrictedRoute><Messenger /></PendingRestrictedRoute>} />
          <Route path="business-registry" element={<PendingRestrictedRoute><BusinessRegistryPage /></PendingRestrictedRoute>} />
          <Route path="map" element={<PendingRestrictedRoute><Map /></PendingRestrictedRoute>} />
          <Route path="todo-list" element={<PendingRestrictedRoute><TodoList /></PendingRestrictedRoute>} />
          <Route path="notification" element={<PendingRestrictedRoute><NotificationPage /></PendingRestrictedRoute>} />
          <Route path="reports/sales" element={<PendingRestrictedRoute><SalesReport /></PendingRestrictedRoute>} />
          <Route path="reports/performance" element={<PendingRestrictedRoute><EmployeePerformance /></PendingRestrictedRoute>} />
          <Route path="reports/work-report/:employeeId?" element={<PendingRestrictedRoute><EmployeeWorkReport /></PendingRestrictedRoute>} />
          <Route path="subscription" element={<PendingRestrictedRoute><Subscription /></PendingRestrictedRoute>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
