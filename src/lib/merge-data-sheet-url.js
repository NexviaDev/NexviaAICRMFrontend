/**
 * MergeDataSheetModal 과 브라우저 히스토리(뒤로가기·모바일 뒤로) 동기화용 쿼리 키.
 * 견적 문서 머지 페이지: `/quotation-doc-merge?mergeDataSheet=1`
 * 영업 파이프라인 기회 문서 머지: `?oppModal=…&oppDocMergeSheet=1` 등과 병행
 */
export const MERGE_DATA_SHEET_URL_PARAM = 'mergeDataSheet';
export const OPPORTUNITY_MERGE_SHEET_URL_PARAM = 'oppDocMergeSheet';

export const MERGE_DATA_SHEET_URL_VALUE = '1';

/** @param {import('react-router-dom').URLSearchParams} searchParams */
export function isMergeDataSheetUrlOpen(searchParams, paramName) {
  return String(searchParams.get(paramName) || '').trim() === MERGE_DATA_SHEET_URL_VALUE;
}
