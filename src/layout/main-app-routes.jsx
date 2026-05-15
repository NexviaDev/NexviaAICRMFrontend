import { lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

const Home = lazy(() => import('../home/home'));
const CustomerCompanies = lazy(() => import('../customer-companies/customer-companies'));
const CustomerCompanyEmployees = lazy(() => import('../customer-company-employees/customer-company-employees'));
const Calendar = lazy(() => import('../calendar/calendar'));
const Project = lazy(() => import('../project/project'));
const SalesReport = lazy(() => import('../sales-report/sales-report'));
const EmployeePerformance = lazy(() => import('../employee-performance/employee-performance'));
const EmployeeWorkReport = lazy(() => import('../employee-work-report/employee-work-report'));
const CompanyOverview = lazy(() => import('../company-overview/company-overview'));
const SalesPipeline = lazy(() => import('../sales-pipeline/sales-pipeline'));
const ProductList = lazy(() => import('../product-list/product-list'));
const MeetingMinutes = lazy(() => import('../meeting-minutes/meeting-minutes'));
const Kpi = lazy(() => import('../kpi/kpi'));
const AiVoice = lazy(() => import('../ai-voice/ai-voice'));
const Email = lazy(() => import('../email/email'));
const Map = lazy(() => import('../map/map'));
const TodoList = lazy(() => import('../todo-list/todo-list'));
const LeadCapture = lazy(() => import('../lead-capture/lead-capture'));
const Subscription = lazy(() => import('../subscription/subscription'));
const QuotationDocMerge = lazy(() => import('../quotation-doc-merge/quotation-doc-merge'));
const NotificationPage = lazy(() => import('../notification/notification'));
const Messenger = lazy(() => import('../messenger/messenger'));
const BusinessRegistryPage = lazy(() => import('../business-registry/business-registry'));

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

export function PendingRestrictedRoute({ children }) {
  if (isPendingUser()) return <Navigate to="/company-overview" replace />;
  return children;
}

/**
 * 메인 앱(로그인 후) 화면 라우트 — 브라우저 라우터의 Outlet과 분할 패널용 MemoryRouter에서 동일하게 사용합니다.
 * @param {{ includeHomeIndex?: boolean }} props — app.js에서 Layout 자식으로 `index`를 쓸 때는 false(홈 중복·매칭 충돌 방지)
 */
export default function MainAppRoutes({ includeHomeIndex = true } = {}) {
  return (
    <Routes>
      {includeHomeIndex ? (
        <Route index element={<PendingRestrictedRoute><Home /></PendingRestrictedRoute>} />
      ) : null}
      <Route path="company-overview" element={<CompanyOverview />} />
      <Route path="customer-companies" element={<PendingRestrictedRoute><CustomerCompanies /></PendingRestrictedRoute>} />
      <Route path="customer-company-employees" element={<PendingRestrictedRoute><CustomerCompanyEmployees /></PendingRestrictedRoute>} />
      <Route path="kpi" element={<PendingRestrictedRoute><Kpi /></PendingRestrictedRoute>} />
      <Route path="calendar" element={<PendingRestrictedRoute><Calendar /></PendingRestrictedRoute>} />
      <Route path="project" element={<PendingRestrictedRoute><Project /></PendingRestrictedRoute>} />
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
      <Route
        path="quotation-doc-merge"
        element={
          <PendingRestrictedRoute>
            <QuotationDocMerge />
          </PendingRestrictedRoute>
        }
      />
    </Routes>
  );
}
