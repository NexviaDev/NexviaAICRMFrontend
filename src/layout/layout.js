import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { API_BASE } from '@/config';
import { getPendingExcelImportJobs, removePendingExcelImportJob } from '@/lib/cc-excel-import-jobs';
import Sidebar from './sidebar';
import './layout.css';

export default function Layout() {
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false);
  const [importBanner, setImportBanner] = useState(null);
  const location = useLocation();
  const isSalesPipeline = location.pathname === '/sales-pipeline';

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
