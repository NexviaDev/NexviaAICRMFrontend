import { API_BASE } from '@/config';
import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession, getAuthHeader } from '@/lib/crm-auth';

/**
 * @param {() => Record<string, string>} getAuthHeader
 * @returns {Promise<{ tasks?: boolean, contacts?: boolean, calendar?: boolean, drive?: boolean, needsGoogleLogin?: boolean, needsReauth?: boolean } | null>}
 */
export async function fetchGoogleLinkStatus(getAuthHeader) {
  const res = await fetch(`${API_BASE}/auth/google/link-status`, {
    headers: typeof getAuthHeader === 'function' ? getAuthHeader() : {},
    credentials: 'include'
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * @param {'tasks' | 'contacts' | 'calendar' | 'drive'} feature
 * @param {string} [returnPath] — 기본값: 현재 pathname+search
 */
export function startGoogleFeatureLink(feature, returnPath) {
  const token = getCrmToken();
  if (!token) return;
  const ret = returnPath != null ? returnPath : `${window.location.pathname}${window.location.search}`;
  const params = new URLSearchParams({ token });
  params.set('return', ret);
  window.location.href = `${API_BASE}/auth/google/link/${feature}?${params.toString()}`;
}
