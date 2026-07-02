/**
 * CRM 인증 — HttpOnly 쿠키 + credentials:include
 * localStorage crm_token 은 더 이상 사용하지 않습니다.
 */
import { API_BASE } from '@/config';
import { notifyCrmAuthChanged } from '@/lib/use-crm-token';

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
