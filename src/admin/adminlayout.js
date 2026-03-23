import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import AdminSidebar from './adminsidebar';
import '../layout/layout.css';

const ADMIN_TOKEN_KEY = 'admin_site_token';
const ADMIN_BOUND_USER_KEY = 'admin_site_bound_user_id';

function getCrmUserId() {
  try {
    const raw = localStorage.getItem('crm_user');
    if (!raw) return '';
    const u = JSON.parse(raw);
    return u?._id ? String(u._id) : '';
  } catch {
    return '';
  }
}

export default function AdminLayout() {
  const location = useLocation();
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false);
  const crmUserId = getCrmUserId();

  useEffect(() => {
    const id = getCrmUserId();
    const bound = localStorage.getItem(ADMIN_BOUND_USER_KEY);
    if (bound && id && bound !== id) {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      localStorage.removeItem(ADMIN_BOUND_USER_KEY);
    }
  }, [location.pathname]);

  return (
    <div className={`app-layout ${sidebarDrawerOpen ? 'sidebar-drawer-open' : ''}`}>
      <div
        className="sidebar-backdrop"
        role="button"
        tabIndex={-1}
        onClick={() => setSidebarDrawerOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setSidebarDrawerOpen(false)}
        aria-hidden="true"
      />
      <AdminSidebar
        drawerOpen={sidebarDrawerOpen}
        onCloseDrawer={() => setSidebarDrawerOpen(false)}
      />
      <main className="app-main">
        <header className="app-main-header">
          <button
            type="button"
            className="app-hamburger"
            onClick={() => setSidebarDrawerOpen(true)}
            aria-label="메뉴 열기"
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
        </header>
        <div className="app-main-content">
          <Outlet key={crmUserId || 'none'} />
        </div>
      </main>
    </div>
  );
}
