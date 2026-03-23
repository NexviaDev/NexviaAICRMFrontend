/**
 * 관리자 API는 항상 일반 CRM 로그인(crm_token)과 같은 사용자여야 합니다.
 * Authorization: 관리자 JWT, X-Crm-Authorization: CRM JWT
 */
export function getAdminSiteFetchHeaders() {
  const admin = localStorage.getItem('admin_site_token');
  const crm = localStorage.getItem('crm_token');
  const headers = { 'Content-Type': 'application/json' };
  if (admin) headers.Authorization = `Bearer ${admin}`;
  if (crm) headers['X-Crm-Authorization'] = `Bearer ${crm}`;
  return headers;
}
