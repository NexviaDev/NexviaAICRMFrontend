import { API_BASE } from '@/config';
import { getCrmToken, crmFetchInit } from '@/lib/crm-auth';

/**
 * @param {() => Record<string, string>} [getAuthHeaderFn]
 * @returns {Promise<{ tasks?: boolean, contacts?: boolean, calendar?: boolean, drive?: boolean, needsGoogleLogin?: boolean, needsReauth?: boolean } | null>}
 */
export async function fetchGoogleLinkStatus(getAuthHeaderFn) {
  const res = await fetch(
    `${API_BASE}/auth/google/link-status`,
    crmFetchInit(typeof getAuthHeaderFn === 'function' ? { headers: getAuthHeaderFn() } : {})
  );
  if (!res.ok) return null;
  return res.json();
}

/**
 * @param {'tasks' | 'contacts' | 'calendar' | 'drive' | 'loginRefresh'} feature
 * @param {string} [returnPath] — 기본값: 현재 pathname+search
 */
export function startGoogleFeatureLink(feature, returnPath) {
  if (!getCrmToken()) return;
  const ret = returnPath != null ? returnPath : `${window.location.pathname}${window.location.search}`;
  const params = new URLSearchParams();
  params.set('return', ret);
  window.location.href = `${API_BASE}/auth/google/link/${feature}?${params.toString()}`;
}

/**
 * 이메일 OTP 로그인 후 — googleId가 있으면 매번 Google OAuth로 refresh_token 갱신.
 * @param {{ googleId?: string } | null | undefined} user
 * @param {string} [returnPath]
 * @returns {boolean}
 */
export function ensureGoogleOAuthRefreshAfterLogin(user, returnPath = '/dashboard') {
  if (!user?.googleId || !getCrmToken()) return false;
  startGoogleFeatureLink('loginRefresh', returnPath);
  return true;
}
