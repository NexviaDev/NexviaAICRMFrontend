import { API_BASE } from '@/config';

/**
 * @param {() => object} getAuthHeader
 * @returns {Promise<{ id: string, title: string, to: string, cc: string, createdAt?: string }[]>}
 */
export async function fetchCompanyDocMailAddressBook(getAuthHeader) {
  const res = await fetch(`${API_BASE}/companies/opportunity-doc-mail-address-book`, {
    headers: { ...getAuthHeader() },
    credentials: 'include'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '회사 주소록을 불러오지 못했습니다.');
  return Array.isArray(data.items) ? data.items : [];
}

/**
 * @param {() => object} getAuthHeader
 * @param {object[]} items
 */
export async function putCompanyDocMailAddressBook(getAuthHeader, items) {
  const res = await fetch(`${API_BASE}/companies/opportunity-doc-mail-address-book`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify({ items: Array.isArray(items) ? items : [] })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '회사 주소록을 저장하지 못했습니다.');
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchUserDocMailAddressBook(getAuthHeader) {
  const res = await fetch(`${API_BASE}/auth/opportunity-doc-mail-address-book`, {
    headers: { ...getAuthHeader() },
    credentials: 'include'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '개인 주소록을 불러오지 못했습니다.');
  return Array.isArray(data.items) ? data.items : [];
}

export async function putUserDocMailAddressBook(getAuthHeader, items) {
  const res = await fetch(`${API_BASE}/auth/opportunity-doc-mail-address-book`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify({ items: Array.isArray(items) ? items : [] })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '개인 주소록을 저장하지 못했습니다.');
  if (data.listTemplates && typeof data.listTemplates === 'object') {
    try {
      const raw = localStorage.getItem('crm_user');
      const user = raw ? JSON.parse(raw) : {};
      user.listTemplates = data.listTemplates;
      localStorage.setItem('crm_user', JSON.stringify(user));
    } catch (_) {
      /* ignore */
    }
  }
  return Array.isArray(data.items) ? data.items : [];
}
