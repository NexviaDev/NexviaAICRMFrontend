/**
 * 백엔드 `lib/jsonErrors.js` 의 ApiErrorCodes 와 동기화.
 * 신규 code 추가 시 백엔드·이 파일 양쪽에 같은 문자열을 넣을 것.
 */
export const ApiErrorCodes = Object.freeze({
  CUSTOMER_COMPANY_NAME_CHANGE_ADMIN_ONLY: 'CUSTOMER_COMPANY_NAME_CHANGE_ADMIN_ONLY',
  REQUIRE_ADMIN_OR_ABOVE: 'REQUIRE_ADMIN_OR_ABOVE',
  MUTATION_ROLE_NOT_ALLOWED: 'MUTATION_ROLE_NOT_ALLOWED'
});

/** API JSON { error?, code? } 에서 사용자에게 보여줄 문구 */
export function getUserVisibleApiError(data, fallbackMessage = '') {
  if (data && typeof data.error === 'string') {
    const t = data.error.trim();
    if (t) return t;
  }
  const fb = String(fallbackMessage || '').trim();
  return fb || '요청에 실패했습니다.';
}

export function alertApiError(data, fallbackMessage = '') {
  window.alert(getUserVisibleApiError(data, fallbackMessage));
}
