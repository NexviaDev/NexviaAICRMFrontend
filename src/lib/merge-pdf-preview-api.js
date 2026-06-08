import { pingBackendHealth } from '@/lib/backend-wake';
import { getUserVisibleApiError } from '@/lib/api-error';
import { normalizeMergePdfExportOptions } from '@/lib/merge-pdf-export-options';

async function readPdfPreviewBlobFromResponse(res, emptyMessage) {
  const raw = await res.blob();
  if (!raw || raw.size < 80) {
    throw new Error(emptyMessage);
  }
  const ct = String(res.headers.get('Content-Type') || raw.type || '').toLowerCase();
  if (ct.includes('json')) {
    const text = await raw.text();
    try {
      const data = JSON.parse(text);
      throw new Error(getUserVisibleApiError(data, 'PDF 미리보기 생성에 실패했습니다.'));
    } catch (parseErr) {
      if (parseErr?.message && !String(parseErr.message).includes('JSON')) throw parseErr;
      throw new Error('PDF 미리보기 응답이 올바르지 않습니다.');
    }
  }
  if (raw.type === 'application/pdf') return raw;
  return new Blob([raw], { type: 'application/pdf' });
}

/**
 * PDF 미리보기용 — plan 후 PDF 항목 인덱스로 run 1회, Blob 반환.
 * @param {{ apiBase: string, getAuthHeader: () => object, rowJobs: object[], fieldPresetId?: string, pdfExportOptions?: object }} params
 */
export async function fetchMergePdfPreviewBlob({
  apiBase,
  getAuthHeader,
  rowJobs,
  fieldPresetId,
  pdfExportOptions,
  apiPrefix = '/quotation-merge'
}) {
  if (!Array.isArray(rowJobs) || !rowJobs.length) {
    throw new Error('미리볼 PDF가 없습니다. PDF 추출이 켜진 행·양식을 확인해 주세요.');
  }
  const planBody = { rowJobs };
  if (fieldPresetId) planBody.fieldPresetId = String(fieldPresetId).trim();
  await pingBackendHealth();
  const planRes = await fetch(`${apiBase}${apiPrefix}/plan`, {
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
  const res = await fetch(`${apiBase}${apiPrefix}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(getUserVisibleApiError(data, 'PDF 미리보기 생성에 실패했습니다.'));
  }
  return readPdfPreviewBlobFromResponse(res, 'PDF 미리보기 파일이 비어 있습니다.');
}

/**
 * 양식 등록 전 등 — 업로드 파일 + PDF 설정만으로 서버 PDF 미리보기 Blob.
 * @param {{ apiBase: string, getAuthHeader: () => object, file: File, pdfExportOptions?: object }} params
 */
export async function fetchTemplatePdfPreviewBlob({
  apiBase,
  getAuthHeader,
  file,
  pdfExportOptions,
  apiPrefix = '/quotation-merge'
}) {
  if (!file) {
    throw new Error('미리볼 양식 파일이 없습니다. 파일을 먼저 선택해 주세요.');
  }
  if (!/\.(docx|xlsx|pptx|hwp|hwpx)$/i.test(String(file.name || ''))) {
    throw new Error('.docx, .xlsx, .pptx, .hwp, .hwpx 양식만 PDF 미리보기가 가능합니다.');
  }
  const fd = new FormData();
  fd.append('file', file, file.name || 'template.xlsx');
  fd.append('pdfExportOptions', JSON.stringify(normalizeMergePdfExportOptions(pdfExportOptions)));
  await pingBackendHealth();
  const res = await fetch(`${apiBase}${apiPrefix}/templates/preview-pdf`, {
    method: 'POST',
    headers: { ...getAuthHeader({ formData: true }) },
    credentials: 'include',
    body: fd
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(getUserVisibleApiError(data, 'PDF 미리보기 생성에 실패했습니다.'));
  }
  return readPdfPreviewBlobFromResponse(res, 'PDF 미리보기 파일이 비어 있습니다.');
}
