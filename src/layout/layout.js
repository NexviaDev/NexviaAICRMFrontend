import { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { API_BASE } from '@/config';
import { getPendingExcelImportJobs, removePendingExcelImportJob } from '@/lib/cc-excel-import-jobs';
import { LAYOUT_EXCEL_IMPORT_POLL_MS } from '@/lib/polling-intervals';
import {
  bindPushForegroundNotifications,
  refreshPushTokenIfGranted,
  shouldShowPushForCurrentSession,
  showWebPushNotification,
  startPushPermissionWatcher,
  syncPushRegistrationForSession
} from '@/lib/push-notifications';
import Sidebar from './sidebar';
import { ensureUserSidebarDefaultTemplate } from '@/lib/list-templates';
import './layout.css';

/** 사이드바 상단과 동일 로고 (sidebar.js NEXVIA_LOGO_CDN_URL) */
const NEXVIA_LOGO_CDN_URL =
  'https://res.cloudinary.com/djcsvvhly/image/upload/v1774253552/NexviaLogo_pid8kz.png';

/** 예전 앱 내 분할(iframe)·세션 키 정리 — 브라우저 새 탭·분할 사용으로 전환됨 */
function clearLegacySplitSession() {
  try {
    sessionStorage.removeItem('nexvia_inapp_split_mode');
    sessionStorage.removeItem('nexvia_inapp_split_path');
    sessionStorage.removeItem('nexvia_layout_split_view');
    sessionStorage.removeItem('nexvia_split_secondary_path');
    sessionStorage.removeItem('nexvia_split_secondary_width_px');
  } catch {
    /* noop */
  }
}

export default function Layout({ embeddedContent = null }) {
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false);
  const [importBanner, setImportBanner] = useState(null);
  /** Google 주소록 등 OAuth 연동 콜백 후 ?google_link / ?google_link_error 표시 */
  const [googleLinkBanner, setGoogleLinkBanner] = useState(null);
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

  useEffect(() => {
    clearLegacySplitSession();
  }, []);

  /** 로그인 후 모든 화면에서 포그라운드 푸시 수신(공지 페이지만이 아님) */
  useEffect(() => {
    const crmToken = localStorage.getItem('crm_token');
    if (!crmToken) return undefined;
    let cleanup = null;
    bindPushForegroundNotifications((payload) => {
      const data = payload?.data || {};
      if (!shouldShowPushForCurrentSession(data)) return;
      const url =
        data.url ||
        (data.type === 'lead-capture'
          ? data.formId
            ? `/lead-capture?form=${encodeURIComponent(data.formId)}${data.leadId ? `&lead=${encodeURIComponent(data.leadId)}` : ''}`
            : '/lead-capture'
          : data.type === 'calendar-reminder'
          ? data.eventId
            ? `/calendar?modal=event&eventId=${encodeURIComponent(data.eventId)}`
            : '/calendar'
          : data.type === 'project-comment'
          ? data.linkProjectId
            ? `/project?projectModal=edit&projectId=${encodeURIComponent(data.linkProjectId)}`
            : '/project'
          : data.type === 'admin-user-signup'
          ? data.url || '/notification'
          : '/notification');
      showWebPushNotification(payload, { url });
    }).then((unsub) => {
      cleanup = unsub;
    });
    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, []);

  /** 허용된 기기·OS 설정에서 알림 재허용·앱 복귀 시 FCM 토큰 갱신 */
  useEffect(() => {
    const crmToken = localStorage.getItem('crm_token');
    if (!crmToken || typeof Notification === 'undefined') return undefined;
    const onResume = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshPushTokenIfGranted().catch(() => {});
    };
    void refreshPushTokenIfGranted().catch(() => {});
    const stopPermissionWatch = startPushPermissionWatcher();
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onResume);
    return () => {
      stopPermissionWatch();
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onResume);
    };
  }, []);

  const isSalesPipeline = location.pathname === '/sales-pipeline';
  const isMessenger = location.pathname === '/messenger';
  const isProductList = location.pathname === '/product-list';
  const isCustomerCompanies = location.pathname === '/customer-companies';
  const isCustomerCompanyEmployees = location.pathname === '/customer-company-employees';
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
        const { user: next } = ensureUserSidebarDefaultTemplate(data.user);
        localStorage.setItem('crm_user', JSON.stringify(next));
        setCurrentUser(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  useEffect(() => {
    if (currentUser?.role === 'pending' && location.pathname !== '/company-overview') {
      window.alert('현재 계정은 권한 대기 상태입니다. 사내 현황에서 회사의 허용을 받아야 다른 메뉴에 접근할 수 있습니다.');
      navigate('/company-overview', { replace: true });
    }
  }, [currentUser?.role, location.pathname, navigate]);

  /** 로그인·계정 전환 시 푸시 등록을 현재 사용자와 맞춤 */
  useEffect(() => {
    const crmToken = localStorage.getItem('crm_token');
    if (!crmToken || !currentUser?._id) return undefined;
    let cancelled = false;
    void syncPushRegistrationForSession(currentUser).catch(() => {
      if (!cancelled) {
        /* ignore */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentUser?._id, currentUser?.companyId]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const err = params.get('google_link_error');
    const ok = params.get('google_link');
    if (!err && !ok) return;

    if (err) {
      setGoogleLinkBanner({ kind: 'error', text: err });
    } else {
      setGoogleLinkBanner({
        kind: 'success',
        text: 'Google 연동이 완료되었습니다. 주소록 등 해당 기능을 다시 이용해 보세요.'
      });
    }

    const next = new URLSearchParams(location.search);
    next.delete('google_link_error');
    next.delete('google_link');
    const qs = next.toString();
    navigate({ pathname: location.pathname, search: qs ? `?${qs}` : '' }, { replace: true });
  }, [location.search, location.pathname, navigate]);

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

  const needsFullHeightMain =
    isSalesPipeline ||
    isMessenger ||
    isProductList ||
    isCustomerCompanies ||
    isCustomerCompanyEmployees ||
    isProjectGantt;
  const mainContentClassName = ['app-main-content', needsFullHeightMain ? 'app-main-content--fullheight' : '']
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
        {googleLinkBanner && (
          <div className={`app-import-banner app-import-banner--${googleLinkBanner.kind}`} role="status">
            <span>{googleLinkBanner.text}</span>
            <button
              type="button"
              className="app-import-banner-dismiss"
              onClick={() => setGoogleLinkBanner(null)}
              aria-label="알림 닫기"
            >
              ×
            </button>
          </div>
        )}
        <header className="app-main-header">
          <Link
            to="/dashboard"
            className="app-main-header-logo"
            aria-label="대시보드로 이동"
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
        <div className={mainContentClassName}>
          <div className="app-main-outlet">
            {embeddedContent ?? <Outlet />}
          </div>
        </div>
      </main>
    </div>
  );
}
