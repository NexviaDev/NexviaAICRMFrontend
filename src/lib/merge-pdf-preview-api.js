import { pingBackendHealth } from '@/lib/backend-wake';
import { getUserVisibleApiError } from '@/lib/api-error';
import { normalizeMergePdfExportOptions } from '@/lib/merge-pdf-export-options';

/**
 * PDF 미리보기용 — plan 후 PDF 항목 인덱스로 run 1회, Blob 반환.
 * @param {{ apiBase: string, getAuthHeader: () => object, rowJobs: object[], fieldPresetId?: string, pdfExportOptions?: object }} params
 */
export async function fetchMergePdfPreviewBlob({
  apiBase,
  getAuthHeader,
  rowJobs,
  fieldPresetId,
  pdfExportOptions
}) {
  if (!Array.isArray(rowJobs) || !rowJobs.length) {
    throw new Error('미리볼 PDF가 없습니다. PDF 추출이 켜진 행·양식을 확인해 주세요.');
  }
  const planBody = { rowJobs };
  if (fieldPresetId) planBody.fieldPresetId = String(fieldPresetId).trim();
  await pingBackendHealth();
  const planRes = await fetch(`${apiBase}/quotation-merge/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify(planBody)
  });
  const plan = await planRes.json().catch(() => ({}));
  if (!planRes.ok) {
    throw new Error(getUserVisibleApiError(plan, '파일명 검사에 실패했습니다.'));
  }
  const entries = Array.isArray(plan.entries) ? plan.entries : [];
  const pdfIdx = entries.findIndex((e) => /\.pdf$/i.test(String(e?.fileName || '')));
  if (pdfIdx < 0) {
    throw new Error(
      'PDF 출력 항목이 없습니다. 양식 등록 PDF 설정 또는 문서 메일머지 PDF 설정에서「PDF 추가 추출」또는「PDF 만 추출」을 선택해 주세요.'
    );
  }
  const body = {
    rowJobs,
    zipCollisionPolicy: 'rename',
    asZip: false,
    singleOutputIndex: pdfIdx,
    pdfExportOptions: normalizeMergePdfExportOptions(pdfExportOptions)
  };
  if (planBody.fieldPresetId) body.fieldPresetId = planBody.fieldPresetId;
  await pingBackendHealth();
  const res = await fetch(`${apiBase}/quotation-merge/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(getUserVisibleApiError(data, 'PDF 미리보기 생성에 실패했습니다.'));
  }
  const blob = await res.blob();
  if (!blob || blob.size < 80) {
    throw new Error('PDF 미리보기 파일이 비어 있습니다.');
  }
  return blob;
}

/**
 * 양식 등록 전 등 — 업로드 파일 + PDF 설정만으로 서버 PDF 미리보기 Blob.
 * @param {{ apiBase: string, getAuthHeader: () => object, file: File, pdfExportOptions?: object }} params
 */
export async function fetchTemplatePdfPreviewBlob({ apiBase, getAuthHeader, file, pdfExportOptions }) {
  if (!file) {
    throw new Error('미리볼 양식 파일이 없습니다. 파일을 먼저 선택해 주세요.');
  }
  if (!/\.(docx|xlsx)$/i.test(String(file.name || ''))) {
    throw new Error('.docx 또는 .xlsx 양식만 PDF 미리보기가 가능합니다.');
  }
  const fd = new FormData();
  fd.append('file', file, file.name || 'template.xlsx');
  fd.append('pdfExportOptions', JSON.stringify(normalizeMergePdfExportOptions(pdfExportOptions)));
  await pingBackendHealth();
  const res = await fetch(`${apiBase}/quotation-merge/templates/preview-pdf`, {
    method: 'POST',
    headers: { ...getAuthHeader() },
    credentials: 'include',
    body: fd
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(getUserVisibleApiError(data, 'PDF 미리보기 생성에 실패했습니다.'));
  }
  const blob = await res.blob();
  if (!blob || blob.size < 80) {
    throw new Error('PDF 미리보기 파일이 비어 있습니다.');
  }
  return blob;
}
