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

/** 백엔드 requireSeniorOrAbove 와 동일: 대표(Owner) · 책임(Senior) */
export function isSeniorOrAboveRole(role) {
  const r = String(role || '').trim().toLowerCase();
  return r === 'owner' || r === 'senior';
}
