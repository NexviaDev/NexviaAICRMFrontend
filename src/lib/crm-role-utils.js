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

/** CRM 액세스 JWT payload (서명 검증 없음 — 로그인 직후 화면 전환용) */
export function parseCrmAccessTokenClaims(token) {
  try {
    const raw = String(token || '').trim();
    const part = raw.split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
    const claims = JSON.parse(json);
    if (!claims || typeof claims !== 'object') return null;
    return claims;
  } catch {
    return null;
  }
}

/** JWT v2 클레임 → crm_user 최소 객체 (OAuth 콜백 직후 즉시 이동용) */
export function crmUserStubFromAccessTokenClaims(claims) {
  if (!claims || typeof claims !== 'object') return null;
  const userId = String(claims.userId || '').trim();
  if (!userId) return null;
  return {
    _id: userId,
    id: userId,
    role: claims.role || 'pending',
    email: claims.email || null,
    name: claims.name || null,
    phone: claims.phone || null,
    avatar: claims.avatar || null,
    companyId: claims.companyId || null,
    companyName: claims.companyName || null,
    consentAt: claims.consentAt || null,
    listTemplates: {}
  };
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
