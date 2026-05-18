import { pingBackendHealth } from '@/lib/backend-wake';
import { getUserVisibleApiError } from '@/lib/api-error';
import { listXlsxSheetNames } from '@/lib/merge-template-xlsx-grid';
import { normalizeMergePdfExportOptions } from '@/lib/merge-pdf-export-options';

/**
 * 등록·선택한 Excel(.xlsx) 양식에서 시트 이름 목록을 읽습니다.
 * @param {string} apiBase
 * @param {() => object} getAuthHeader
 * @param {string} templateId
 * @returns {Promise<string[]>}
 */
export async function fetchXlsxSheetNamesFromMergeTemplate(apiBase, getAuthHeader, templateId) {
  const tid = String(templateId || '').trim();
  if (!tid || !apiBase) return [];
  await pingBackendHealth();
  const res = await fetch(`${apiBase}/quotation-merge/templates/${tid}/download`, {
    headers: { ...getAuthHeader() },
    credentials: 'include'
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(getUserVisibleApiError(data, '양식 시트 목록을 불러오지 못했습니다.'));
  }
  const buf = await res.arrayBuffer();
  return listXlsxSheetNames(buf);
}

/**
 * xlsx 양식의 시트 목록을 PDF 설정(인쇄 시트)에 반영합니다.
 * @param {object} prevOpts
 * @param {string[]} sheetNames
 */
export function pdfExportOptionsWithSheetNames(prevOpts, sheetNames) {
  const names = (sheetNames || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!names.length) return normalizeMergePdfExportOptions(prevOpts);
  return normalizeMergePdfExportOptions({
    ...(prevOpts && typeof prevOpts === 'object' ? prevOpts : {}),
    printSheetMode: 'named',
    printSheetNames: names
  });
}
