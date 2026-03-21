import { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { API_BASE } from '@/config';
import { getPendingExcelImportJobs, removePendingExcelImportJob } from '@/lib/cc-excel-import-jobs';
import Sidebar from './sidebar';
import './layout.css';

export default function Layout() {
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false);
  const [importBanner, setImportBanner] = useState(null);
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const raw = localStorage.getItem('crm_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const location = useLocation();
  const navigate = useNavigate();
  const isSalesPipeline = location.pathname === '/sales-pipeline';

  useEffect(() => {
    const token = localStorage.getItem('crm_token');
    if (!token) return;
    let cancelled = false;
    fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (cancelled || !data?.user) return;
        localStorage.setItem('crm_user', JSON.stringify(data.user));
        setCurrentUser(data.user);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [location.pathname]);

  useEffect(() => {
    if (currentUser?.role === 'pending' && location.pathname !== '/company-overview') {
      window.alert('현재 계정은 권한 대기 상태입니다. 사내 현황에서 회사의 허용을 받아야 다른 메뉴에 접근할 수 있습니다.');
      navigate('/company-overview', { replace: true });
    }
  }, [currentUser?.role, location.pathname, navigate]);

  useEffect(() => {
    const token = localStorage.getItem('crm_token');
    if (!token) return undefined;

    let cancelled = false;
    const poll = async () => {
      const pending = getPendingExcelImportJobs();
      for (const { jobId } of pending) {
        try {
          const res = await fetch(`${API_BASE}/customer-companies/import-excel/jobs/${jobId}`, {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include'
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) continue;
          if (data.status === 'completed') {
            removePendingExcelImportJob(jobId);
            if (!cancelled) {
              const s = data.summary || {};
              setImportBanner({
                kind: 'success',
                text: `고객사 엑셀 가져오기 완료 · 신규 ${s.created ?? 0}건 · 스킵 ${(s.skippedDuplicateCompany ?? 0) + (s.emptySkipped ?? 0)}건 · 실패 ${s.failed ?? 0}건`
              });
              window.dispatchEvent(new CustomEvent('cc-excel-import-completed', { detail: { summary: s } }));
            }
          } else if (data.status === 'failed') {
            removePendingExcelImportJob(jobId);
            if (!cancelled) {
              setImportBanner({
                kind: 'error',
                text: `엑셀 가져오기 실패: ${data.error || '오류'}`
              });
            }
          }
        } catch {
          /* 네트워크 일시 오류 — 다음 주기에 재시도 */
        }
      }
    };

    const id = setInterval(poll, 12000);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

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
        currentUser={currentUser}
        drawerOpen={sidebarDrawerOpen}
        onCloseDrawer={() => setSidebarDrawerOpen(false)}
      />
      <main className="app-main">
        {importBanner && (
          <div className={`app-import-banner app-import-banner--${importBanner.kind}`} role="status">
            <span>{importBanner.text}</span>
            <button type="button" className="app-import-banner-dismiss" onClick={() => setImportBanner(null)} aria-label="알림 닫기">
              ×
            </button>
          </div>
        )}
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
        <div className={`app-main-content ${isSalesPipeline ? 'app-main-content--fullheight' : ''}`}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
