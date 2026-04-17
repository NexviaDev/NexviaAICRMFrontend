import { useState, useEffect, useCallback, useMemo } from 'react';
import { Outlet, useLocation, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { API_BASE } from '@/config';
import { getPendingExcelImportJobs, removePendingExcelImportJob } from '@/lib/cc-excel-import-jobs';
import { LAYOUT_EXCEL_IMPORT_POLL_MS } from '@/lib/polling-intervals';
import Sidebar from './sidebar';
import './layout.css';

/** 사이드바 상단과 동일 로고 (sidebar.js NEXVIA_LOGO_CDN_URL) */
const NEXVIA_LOGO_CDN_URL =
  'https://res.cloudinary.com/djcsvvhly/image/upload/v1774253552/NexviaLogo_pid8kz.png';

const SPLIT_SESSION_MODE = 'nexvia_inapp_split_mode';
const SPLIT_SESSION_PATH = 'nexvia_inapp_split_path';

/** @param {'off'|'horizontal'|'vertical'} mode */
function isSplitMode(mode) {
  return mode === 'horizontal' || mode === 'vertical';
}

function acceptSplitPath(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const line = raw.trim().split(/\r?\n/)[0].trim();
  if (!line) return '';
  try {
    const u = new URL(line, window.location.origin);
    if (u.origin !== window.location.origin) return '';
    if (u.pathname === '/login' || u.pathname === '/register') return '';
    u.searchParams.delete('pane');
    return u.pathname + u.search || '/';
  } catch {
    return '';
  }
}

function toEmbedSrc(pathnameAndQuery) {
  const p = pathnameAndQuery.startsWith('/') ? pathnameAndQuery : `/${pathnameAndQuery}`;
  const u = new URL(p, window.location.origin);
  u.searchParams.set('pane', 'embed');
  return u.pathname + u.search + u.hash;
}

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
  const [searchParams] = useSearchParams();
  const isEmbedPane = searchParams.get('pane') === 'embed';

  const [splitMode, setSplitMode] = useState(() => {
    try {
      const m = sessionStorage.getItem(SPLIT_SESSION_MODE);
      return m === 'horizontal' || m === 'vertical' ? m : 'off';
    } catch {
      return 'off';
    }
  });
  const [splitSecondaryPath, setSplitSecondaryPath] = useState(() => {
    try {
      return sessionStorage.getItem(SPLIT_SESSION_PATH) || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(SPLIT_SESSION_MODE, splitMode);
      if (splitMode === 'off') {
        sessionStorage.removeItem(SPLIT_SESSION_PATH);
      } else if (splitSecondaryPath) {
        sessionStorage.setItem(SPLIT_SESSION_PATH, splitSecondaryPath);
      } else {
        sessionStorage.removeItem(SPLIT_SESSION_PATH);
      }
    } catch {
      /* noop */
    }
  }, [splitMode, splitSecondaryPath]);

  const handleSplitDragOver = useCallback(
    (e) => {
      if (!isSplitMode(splitMode)) return;
      const types = e.dataTransfer?.types ? Array.from(e.dataTransfer.types) : [];
      if (types.includes('text/uri-list') || types.includes('text/plain') || types.includes('Url')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    },
    [splitMode]
  );

  const handleSplitDrop = useCallback((e) => {
    e.preventDefault();
    if (!isSplitMode(splitMode)) return;
    const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '';
    const next = acceptSplitPath(uri);
    if (next) setSplitSecondaryPath(next);
  }, [splitMode]);

  const clearSplit = useCallback(() => {
    setSplitMode('off');
    setSplitSecondaryPath('');
  }, []);

  const chooseSplitOrientation = useCallback((orientation) => {
    if (orientation === 'horizontal' || orientation === 'vertical') {
      setSplitMode((prev) => (prev === orientation ? 'off' : orientation));
    }
  }, []);

  const splitIframeSrc = useMemo(() => {
    if (!splitSecondaryPath) return '';
    return `${window.location.origin}${toEmbedSrc(splitSecondaryPath)}`;
  }, [splitSecondaryPath]);

  const isSalesPipeline = location.pathname === '/sales-pipeline';
  const isMessenger = location.pathname === '/messenger';
  const isProjectGantt = location.pathname === '/project' && searchParams.get('view') === 'gantt';

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

    const id = setInterval(poll, LAYOUT_EXCEL_IMPORT_POLL_MS);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (isEmbedPane) {
    return (
      <div className="app-layout app-layout--embed-only">
        <Outlet />
      </div>
    );
  }

  const needsFullHeightMain = isSalesPipeline || isMessenger || isProjectGantt;
  const mainContentClassName = [
    'app-main-content',
    isSplitMode(splitMode) ? 'app-main-content--has-split' : '',
    !isSplitMode(splitMode) && needsFullHeightMain ? 'app-main-content--fullheight' : ''
  ]
    .filter(Boolean)
    .join(' ');

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
        splitMode={splitMode}
        onSplitOrientation={chooseSplitOrientation}
        onSplitClear={clearSplit}
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
          <Link
            to="/"
            className="app-main-header-logo"
            aria-label="대시보드(홈)으로 이동"
            onClick={() => setSidebarDrawerOpen(false)}
          >
            <img src={NEXVIA_LOGO_CDN_URL} alt="" decoding="async" />
          </Link>
          <button
            type="button"
            className="app-hamburger"
            onClick={() => setSidebarDrawerOpen(true)}
            aria-label="메뉴 열기"
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
        </header>
        <div
          className={mainContentClassName}
          onDragOver={handleSplitDragOver}
          onDrop={handleSplitDrop}
        >
          {isSplitMode(splitMode) ? (
            <>
              <div className="app-split-bar">
                <span className="app-split-bar-text">
                  화면 분할 · {splitMode === 'horizontal' ? '좌우' : '상하'}
                  {splitSecondaryPath ? ` · ${splitSecondaryPath}` : ''}
                </span>
                <button type="button" className="app-split-bar-close" onClick={clearSplit}>
                  분할 끄기
                </button>
              </div>
              <div className={`app-split-wrap app-split-wrap--${splitMode}`}>
                <div
                  className={[
                    'app-split-primary',
                    needsFullHeightMain ? 'app-main-content--fullheight app-split-primary--fullheight' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <Outlet />
                </div>
                {splitSecondaryPath ? (
                  <iframe className="app-split-iframe" title="분할 화면" src={splitIframeSrc} />
                ) : (
                  <div
                    className="app-split-placeholder"
                    onDragOver={handleSplitDragOver}
                    onDrop={handleSplitDrop}
                  >
                    <span className="material-symbols-outlined" aria-hidden>
                      add_link
                    </span>
                    <p>보조 화면: 사이드바 메뉴를 이 영역으로 끌어 놓으세요.</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <Outlet />
          )}
        </div>
      </main>
    </div>
  );
}
