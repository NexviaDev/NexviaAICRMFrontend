/** 문서 메일머지 양식 — 프론트 공통 (백엔드 quoteMergeFileTypes 와 동일 확장자) */

export const MERGE_TEMPLATE_EXTENSIONS = ['.docx', '.xlsx', '.pptx', '.hwp', '.hwpx'];

const EXT_ACCEPT =
  '.docx,.xlsx,.pptx,.hwp,.hwpx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation';

export function isAllowedMergeTemplateFilename(name) {
  const lower = String(name || '').toLowerCase();
  return MERGE_TEMPLATE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function mergeTemplateKindLabel(fileType) {
  const ft = String(fileType || '').toLowerCase();
  if (ft === 'xlsx') return 'Excel';
  if (ft === 'pptx') return 'PowerPoint';
  if (ft === 'hwp') return 'HWP';
  if (ft === 'hwpx') return 'HWPX';
  if (ft === 'docx') return 'Word';
  return ft || '—';
}

export function mergeTemplateDefaultExt(fileType) {
  const ft = String(fileType || '').toLowerCase();
  if (['docx', 'xlsx', 'pptx', 'hwp', 'hwpx'].includes(ft)) return ft;
  return 'docx';
}

export function stripKnownMergeTemplateExtensions(name) {
  return String(name || '')
    .trim()
    .replace(/\.(docx|xlsx|pptx|hwp|hwpx)$/i, '');
}

export function mergeTemplateAcceptAttribute() {
  return EXT_ACCEPT;
}

export function isXlsxMergeTemplate(t) {
  if (!t) return false;
  if (String(t.fileType || '').toLowerCase() === 'xlsx') return true;
  const n = String(t.fileName || t.name || '');
  return /\.xlsx$/i.test(n);
}

export const MERGE_TEMPLATE_UPLOAD_HINT =
  'Word(.docx), Excel(.xlsx), PowerPoint(.pptx), HWP(.hwp), HWPX(.hwpx)';

export function mergeTemplateMimeType(fileType) {
  const ft = String(fileType || '').toLowerCase();
  if (ft === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ft === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (ft === 'hwp') return 'application/x-hwp';
  if (ft === 'hwpx') return 'application/vnd.hancom.hwpx';
  return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}
