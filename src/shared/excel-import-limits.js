/**
 * 엑셀 가져오기 행 수 상한 (프런트엔드 사전 검증용).
 *
 * 고객사 → 서버 상수와 짝을 맞춘 사본입니다. 바꿀 때는 함께 바꾸세요:
 *   backend/controllers/customerCompanies.js  EXCEL_IMPORT_MAX_ROWS (한 요청으로 받아 백그라운드 job 처리)
 *
 * 연락처 → 서버의 요청당 상한은 200건 그대로입니다
 *   (backend/lib/bulkContactImportFromPreview.js BULK_IMPORT_MAX_ITEMS, save-preflight 도 200).
 *   화면에서는 200건씩 나눠 보내므로(bulk-contact-import-api.js *InChunks) 파일은 500건까지 받습니다.
 *   요청 하나의 크기는 그대로라 서버 처리 시간·타임아웃 위험은 늘지 않고, 요청 수만 늘어납니다.
 */
export const COMPANY_EXCEL_IMPORT_MAX_ROWS = 500;
export const CONTACT_EXCEL_IMPORT_MAX_ROWS = 500;

/**
 * 업로드 직후 행 수 검증.
 * 초과하면 ExcelRowLimitModal 에 그대로 넘길 notice 객체를, 아니면 null 을 돌려줍니다.
 */
export function getRowCountOverflow(rowCount, maxRows, { fileName = '', unitLabel = '행' } = {}) {
  const count = Number(rowCount) || 0;
  if (count <= maxRows) return null;
  return { rowCount: count, maxRows, fileName, unitLabel };
}
