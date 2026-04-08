import { API_BASE } from '@/config';

/**
 * @param {() => Record<string, string>} getAuthHeader
 * @returns {Promise<{ gmail?: boolean, tasks?: boolean, contacts?: boolean, calendar?: boolean, chat?: boolean, drive?: boolean, needsGoogleLogin?: boolean, needsReauth?: boolean } | null>}
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
 * @param {'gmail' | 'tasks' | 'contacts' | 'calendar' | 'chat' | 'drive'} feature
 * @param {string} [returnPath] — 기본값: 현재 pathname+search
 */
export function startGoogleFeatureLink(feature, returnPath) {
  const token = localStorage.getItem('crm_token');
  if (!token) return;
  const ret = returnPath != null ? returnPath : `${window.location.pathname}${window.location.search}`;
  const params = new URLSearchParams({ token });
  params.set('return', ret);
  window.location.href = `${API_BASE}/auth/google/link/${feature}?${params.toString()}`;
}
