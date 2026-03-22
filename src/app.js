import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './layout/layout';
import Login from './login/login';
import Register from './register/register';
import Home from './home/home';
import CustomerCompanies from './customer-companies/customer-companies';
import CustomerCompanyEmployees from './customer-company-employees/customer-company-employees';
import Calendar from './calendar/calendar';
import SalesReport from './sales-report/sales-report';
import EmployeePerformance from './employee-performance/employee-performance';
import EmployeeWorkReport from './employee-work-report/employee-work-report';
import CompanyOverview from './company-overview/company-overview';
import SalesPipeline from './sales-pipeline/sales-pipeline';
import ProductList from './product-list/product-list';
import MeetingMinutes from './meeting-minutes/meeting-minutes';
import AiVoice from './ai-voice/ai-voice';
import Email from './email/email';
import Map from './map/map';
import TodoList from './todo-list/todo-list';
import GoogleChat from './chat/chat';
import LeadCapture from './lead-capture/lead-capture';
import LegalPublicPage from './legal/LegalPublicPage';
import Subscription from './subscription/subscription';

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

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/legal/:doc" element={<LegalPublicPage />} />
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
        <Route path="map" element={<PendingRestrictedRoute><Map /></PendingRestrictedRoute>} />
        <Route path="todo-list" element={<PendingRestrictedRoute><TodoList /></PendingRestrictedRoute>} />
        <Route path="chat" element={<PendingRestrictedRoute><GoogleChat /></PendingRestrictedRoute>} />
        <Route path="reports/sales" element={<PendingRestrictedRoute><SalesReport /></PendingRestrictedRoute>} />
        <Route path="reports/performance" element={<PendingRestrictedRoute><EmployeePerformance /></PendingRestrictedRoute>} />
        <Route path="reports/work-report/:employeeId?" element={<PendingRestrictedRoute><EmployeeWorkReport /></PendingRestrictedRoute>} />
        <Route path="subscription" element={<PendingRestrictedRoute><Subscription /></PendingRestrictedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
