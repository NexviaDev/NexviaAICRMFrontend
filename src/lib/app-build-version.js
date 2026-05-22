/**
 * 배포 빌드 ID(VITE_APP_BUILD_ID)가 바뀌면 PWA·Workbox 캐시와 SW를 정리한 뒤 1회 새로고침.
 * crm_token·crm_user 등 로그인 데이터는 건드리지 않습니다.
 */

const BUILD_ID_KEY = 'nexvia_app_build_id';
const RELOAD_GUARD_KEY = 'nexvia_app_build_reload_guard';
const CRM_IN_APP_ROUTE_PREFIXES = [
  '/dashboard',
  '/company-overview',
  '/meeting-minutes',
  '/reports/work-report',
  '/product-list',
  '/kpi',
  '/customer-company-employees',
  '/customer-companies',
  '/sales-pipeline',
  '/map',
  '/lead-capture',
  '/calendar',
  '/project',
  '/todo-list',
  '/ai-voice',
  '/quotation-doc-merge',
  '/subscription'
];

export function getAppBuildId() {
  return String(import.meta.env.VITE_APP_BUILD_ID || '').trim();
}

function shouldLeaveStaleLoginPage() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/login') return false;
  if (localStorage.getItem('crm_token')) return false;

  const params = new URLSearchParams(window.location.search);
  /** OAuth 콜백·약관·오류 표시 등 의미 있는 로그인 URL은 유지 */
  return !params.has('token') && !params.has('needsRegister') && !params.has('legal') && !params.has('error');
}

function shouldRefreshCrmRouteInPlace() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return CRM_IN_APP_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

async function purgeStaticCaches() {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((reg) => reg.unregister()));
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
}

/**
 * @returns {Promise<boolean>} true면 곧 location.reload() 되므로 호출 측에서 렌더 중단
 */
export async function ensureAppBuildVersion() {
  if (import.meta.env.DEV) return false;

  const current = getAppBuildId();
  if (!current) return false;

  const stored = localStorage.getItem(BUILD_ID_KEY);
  if (stored === current) return false;

  /** reload 직후 루프 방지: 같은 빌드로 두 번 purge 하지 않음 */
  if (sessionStorage.getItem(RELOAD_GUARD_KEY) === current) {
    localStorage.setItem(BUILD_ID_KEY, current);
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
    return false;
  }

  try {
    await purgeStaticCaches();
  } catch (err) {
    console.warn('[nexvia] build cache purge failed', err);
  }

  localStorage.setItem(BUILD_ID_KEY, current);
  sessionStorage.setItem(RELOAD_GUARD_KEY, current);
  if (shouldLeaveStaleLoginPage()) {
    window.location.replace('/');
    await new Promise(() => {});
    return true;
  }
  if (shouldRefreshCrmRouteInPlace()) {
    window.location.replace(window.location.href);
    await new Promise(() => {});
    return true;
  }
  window.location.reload();
  await new Promise(() => {});
  return true;
}
