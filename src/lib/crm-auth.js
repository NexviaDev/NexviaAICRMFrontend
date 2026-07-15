/**
 * CRM 인증 — HttpOnly 쿠키 + credentials:include
 * localStorage crm_token 은 더 이상 사용하지 않습니다.
 */
import { API_BASE } from '@/config';

const SESSION_EXPIRED_MESSAGE = '로그인 시간이 만료되었습니다. 다시 로그인해 주세요.';
let fetchInterceptorInstalled = false;
let refreshPromise = null;
let sessionExpiredRedirectStarted = false;
let preparePromise = null;
let lastPrepareAt = 0;
const PREPARE_MIN_INTERVAL_MS = 5 * 60 * 1000;

export function notifyCrmAuthChanged() {
  try {
    window.dispatchEvent(new Event('nexvia-auth-changed'));
  } catch {
    /* noop */
  }
}

export function hasCrmSession() {
  try {
    return Boolean(localStorage.getItem('crm_user'));
  } catch {
    return false;
  }
}

/** 라우트 가드·조건문용 (truthy when logged in) */
export function getCrmToken() {
  return hasCrmSession() ? 'session' : '';
}

export function getCrmAuthHeaders() {
  return {};
}

/** @deprecated use crmFetchInit — headers only, no credentials */
export function getAuthHeader() {
  return hasCrmSession() ? { ...getCrmAuthHeaders() } : {};
}

export function crmFetchInit(extra = {}) {
  return {
    credentials: 'include',
    ...extra,
    headers: {
      ...getCrmAuthHeaders(),
      ...(extra.headers || {})
    }
  };
}

function apiRequestInfo(input) {
  if (typeof window === 'undefined') return null;
  const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
  if (!raw) return null;
  try {
    const requestUrl = new URL(raw, window.location.href);
    const apiUrl = new URL(API_BASE, window.location.href);
    const apiPath = apiUrl.pathname.replace(/\/$/, '');
    if (requestUrl.origin !== apiUrl.origin) return null;
    if (requestUrl.pathname !== apiPath && !requestUrl.pathname.startsWith(`${apiPath}/`)) return null;
    return {
      pathname: requestUrl.pathname,
      apiPath
    };
  } catch {
    return null;
  }
}

function isRefreshExcludedPath(pathname, apiPath) {
  const relative = pathname.slice(apiPath.length);
  return [
    '/auth/login',
    '/auth/logout',
    '/auth/refresh',
    '/auth/register',
    '/auth/send-login-code',
    '/auth/find-id',
    '/auth/check-email',
    '/auth/send-verification'
  ].includes(relative);
}

function redirectToExpiredSessionLogin() {
  if (sessionExpiredRedirectStarted || typeof window === 'undefined') return;
  sessionExpiredRedirectStarted = true;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  clearCrmSessionLocal();
  const params = new URLSearchParams({
    error: SESSION_EXPIRED_MESSAGE,
    return: returnTo
  });
  window.location.assign(`/login?${params.toString()}`);
}

async function requestSessionRefresh(nativeFetch) {
  if (!refreshPromise) {
    refreshPromise = nativeFetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' }
    })
      .then((res) => ({ ok: res.ok, status: res.status }))
      .catch(() => ({ ok: false, status: 0 }))
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/**
 * 모든 CRM API fetch에 쿠키를 포함하고, 401이면 한 번만 자동 재발급 후 원 요청을 재시도합니다.
 * 재발급 세션 자체가 만료된 경우에만 로컬 세션을 정리하고 로그인 화면으로 이동합니다.
 */
export function installCrmFetchInterceptor() {
  if (fetchInterceptorInstalled || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  fetchInterceptorInstalled = true;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const info = apiRequestInfo(input);
    if (!info) return nativeFetch(input, init);

    const requestInit = { ...(init || {}), credentials: 'include' };
    const retryInput = typeof Request !== 'undefined' && input instanceof Request ? input.clone() : input;
    const response = await nativeFetch(input, requestInit);
    if (response.status !== 401 || isRefreshExcludedPath(info.pathname, info.apiPath)) {
      return response;
    }

    const isAuthMe = info.pathname === `${info.apiPath}/auth/me`;
    if (!hasCrmSession() && !isAuthMe) return response;

    const refreshed = await requestSessionRefresh(nativeFetch);
    if (refreshed.ok) {
      return nativeFetch(retryInput, { ...requestInit, credentials: 'include' });
    }
    if (refreshed.status === 401) redirectToExpiredSessionLogin();
    return response;
  };
}

/**
 * 앱 시작 시 기존 7일 액세스 쿠키를 새 재발급 세션으로 조용히 마이그레이션합니다.
 * Railway 슬립·일시 장애는 로그아웃으로 처리하지 않습니다.
 */
export async function prepareCrmRefreshSession() {
  if (!hasCrmSession()) return;
  if (preparePromise) return preparePromise;
  const now = Date.now();
  if (now - lastPrepareAt < PREPARE_MIN_INTERVAL_MS) return;
  lastPrepareAt = now;
  preparePromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (res.status === 401) redirectToExpiredSessionLogin();
    } catch {
      /* 일시적인 네트워크·Railway 슬립은 다음 API 요청에서 다시 시도 */
    }
  })().finally(() => {
    preparePromise = null;
  });
  return preparePromise;
}

export function markCrmSessionActive() {
  try {
    localStorage.removeItem('crm_token');
  } catch {
    /* noop */
  }
  notifyCrmAuthChanged();
}

export function clearCrmSessionLocal() {
  try {
    localStorage.removeItem('crm_token');
    localStorage.removeItem('crm_user');
  } catch {
    /* noop */
  }
  notifyCrmAuthChanged();
}

export async function logoutCrmSession() {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
  } catch {
    /* noop */
  }
  clearCrmSessionLocal();
}

export async function fetchCrmMe() {
  const res = await fetch(`${API_BASE}/auth/me`, crmFetchInit());
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '인증이 필요합니다.');
  return data;
}
