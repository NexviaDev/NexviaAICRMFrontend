import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './sidebar';
import './layout.css';

export default function Layout() {
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false);

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
      <Sidebar
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
          <Outlet />
        </div>
      </main>
    </div>
  );
}
