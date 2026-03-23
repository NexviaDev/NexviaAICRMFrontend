import { NavLink, useNavigate } from 'react-router-dom';
import '../layout/sidebar.css';

const ADMIN_MENU_ITEMS = [
  { to: '/admin/subscription', icon: 'subscriptions', label: '구독 결제 현황' },
  { to: '/admin/notices', icon: 'campaign', label: '공지 사항' },
  { to: '/admin/users', icon: 'groups', label: '유저 현황' }
];

function getStoredUser() {
  try {
    const raw = localStorage.getItem('crm_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function formatAdminRole(user) {
  if (user?.email) return user.email;
  return '관리자';
}

export default function AdminSidebar({ drawerOpen, onCloseDrawer }) {
  const navigate = useNavigate();
  const user = getStoredUser();

  return (
    <aside className={`sidebar ${drawerOpen ? 'sidebar-drawer-open' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <span className="material-symbols-outlined">admin_panel_settings</span>
        </div>
        <div className="sidebar-brand">
          <h1 className="sidebar-title">Nexvia Admin</h1>
          <p className="sidebar-subtitle">관리자 콘솔</p>
        </div>
        {drawerOpen && (
          <button
            type="button"
            className="sidebar-drawer-close"
            onClick={onCloseDrawer}
            aria-label="메뉴 닫기"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        )}
      </div>

      <nav className="sidebar-nav">
        {ADMIN_MENU_ITEMS.map((item) => (
          <div key={item.to} data-to={item.to} className="sidebar-nav-item">
            <NavLink
              to={item.to}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              onClick={() => onCloseDrawer?.()}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-avatar" />
          <div className="sidebar-user-info">
            <p className="sidebar-user-name">{user?.name || '관리자'}</p>
            <p className="sidebar-user-role">{formatAdminRole(user)}</p>
          </div>
        </div>
        <button
          type="button"
          className="sidebar-logout"
          onClick={() => {
            onCloseDrawer?.();
            navigate('/', { replace: true });
          }}
        >
          <span className="material-symbols-outlined">switch_account</span>
          <span>일반 모드로 전환</span>
        </button>
      </div>
    </aside>
  );
}
