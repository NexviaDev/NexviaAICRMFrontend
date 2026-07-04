/**
 * 관리자 API — CRM 인증은 HttpOnly 쿠키(credentials:include), 관리자 JWT는 Authorization
 */
export function getAdminSiteFetchHeaders({ json = true } = {}) {
  const admin = localStorage.getItem('admin_site_token');
  const headers = {};
  if (json) headers['Content-Type'] = 'application/json';
  if (admin) headers.Authorization = `Bearer ${admin}`;
  return headers;
}

export function adminSiteFetchInit(extra = {}) {
  return {
    credentials: 'include',
    ...extra,
    headers: {
      ...getAdminSiteFetchHeaders(),
      ...(extra.headers || {})
    }
  };
}