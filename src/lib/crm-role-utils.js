/**
 * 로컬에 캐시된 로그인 사용자 (layout /auth/me 가 갱신)
 */
export function getStoredCrmUser() {
  try {
    const raw = localStorage.getItem('crm_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function norm(role) {
  return String(role || '').trim().toLowerCase();
}

/** 백엔드 requireAdminOrAbove: Owner · Admin (구 Senior) */
export function isAdminOrAboveRole(role) {
  const r = norm(role);
  return r === 'owner' || r === 'admin' || r === 'senior';
}

/** MongoDB User.adminSiteAccess — 관리자 사이트(/admin) 부여 계정 */
export function hasAdminSiteAccess(user) {
  return !!user?.adminSiteAccess;
}

/** 백엔드 requireManagerOrAbove: Owner · Admin · Manager (구 practitioner) */
export function isManagerOrAboveRole(role) {
  const r = norm(role);
  return (
    r === 'owner' ||
    r === 'admin' ||
    r === 'manager' ||
    r === 'senior' ||
    r === 'practitioner' ||
    r === 'contributor'
  );
}
