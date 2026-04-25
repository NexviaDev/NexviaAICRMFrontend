/**
 * 대량 등록 배치 내 동일 법인 상호(대소문·띄어쓰기·표기만 다른 경우) 묶기
 * 백엔드 `crmDuplicateLookups.normalizeCompanyNameKey`와 규칙을 맞춤
 */
export function normalizeBulkImportCompanyGroupKey(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .replace(/[\u3000]/g, '')
    .replace(/[\(（].*?[\)）]/g, '')
    .replace(/(주식회사|유한회사|유한|합자|합동|일반|주\)|\(주\)|주식|㈜)/gi, '')
    .toLowerCase();
}
