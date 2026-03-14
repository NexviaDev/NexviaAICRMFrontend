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
import LeadCapture from './lead-capture/lead-capture';

/** 로그인하지 않으면 /login으로 리다이렉트 */
function ProtectedRoute({ children }) {
  const token = localStorage.getItem('crm_token');
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Home />} />
        <Route path="company-overview" element={<CompanyOverview />} />
        <Route path="customer-companies" element={<CustomerCompanies />} />
        <Route path="customer-company-employees" element={<CustomerCompanyEmployees />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="sales-pipeline" element={<SalesPipeline />} />
        <Route path="product-list" element={<ProductList />} />
        <Route path="lead-capture" element={<LeadCapture />} />
        <Route path="meeting-minutes" element={<MeetingMinutes />} />
        <Route path="ai-voice" element={<AiVoice />} />
        <Route path="email" element={<Email />} />
        <Route path="map" element={<Map />} />
        <Route path="todo-list" element={<TodoList />} />
        <Route path="reports/sales" element={<SalesReport />} />
        <Route path="reports/performance" element={<EmployeePerformance />} />
        <Route path="reports/work-report/:employeeId?" element={<EmployeeWorkReport />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
