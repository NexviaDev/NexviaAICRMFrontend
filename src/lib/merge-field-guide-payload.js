/**
 * 견적/발주 문서 메일머지 — 치환 필드 구성 API 페이로드·편집기 draft 변환.
 * quotation-doc-merge · opportunity-merge-from-opportunity 에서 공통 사용.
 */

import { MERGE_EXCEL_FORMATS } from '@/lib/merge-field-editor-constants';

/** 백엔드 `MERGE_FIELD_PRESET_NAME_MAX` 와 동일 */
export const MERGE_FIELD_PRESET_NAME_MAX = 60;

const FIELD_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

/** `{{rowIndex}}` 는 서버가 행마다 자동 채움 — 시트·편집기에서는 필드로 두지 않음 */
export function mergeFieldsWithoutRowIndex(fields) {
  return (fields || []).filter((f) => f && String(f.key || '') !== 'rowIndex');
}

/** @returns {{ ok: true, fields: object[] } | { error: string }} */
export function buildMergeFieldsPayload(fieldDraft) {
  if (!fieldDraft || fieldDraft.length === 0) {
    return { error: '필드를 1개 이상 두어 주세요.' };
  }
  for (const f of fieldDraft) {
    if (!FIELD_KEY_RE.test(String(f.key || '').trim())) {
      return { error: `필드 키는 영문으로 시작하고 영문·숫자·밑줄(_)만 사용합니다: ${f.key || '(비어 있음)'}` };
    }
  }
  const fields = fieldDraft.map((f) => {
    const multiline = Boolean(f.multiline);
    const valueKind = f.valueKind === 'number' ? 'number' : 'text';
    let excelFormat = MERGE_EXCEL_FORMATS.some((x) => x.id === f.excelFormat) ? f.excelFormat : 'general';
    if (valueKind === 'text') excelFormat = 'general';
    return {
      key: String(f.key || '').trim(),
      label: String(f.label || '').trim(),
      example: String(f.example || '').trim(),
      multiline,
      excelSpreadLines: multiline && Boolean(f.excelSpreadLines),
      valueKind,
      excelFormat
    };
  });
  return { ok: true, fields };
}

export function mapApiFieldsToEditorDraft(fields) {
  if (!Array.isArray(fields)) return [];
  return mergeFieldsWithoutRowIndex(fields).map((f) => ({
    ...f,
    multiline: Boolean(f.multiline),
    excelSpreadLines: Boolean(f.excelSpreadLines),
    valueKind: f.valueKind === 'number' ? 'number' : 'text',
    excelFormat: MERGE_EXCEL_FORMATS.some((x) => x.id === f.excelFormat) ? f.excelFormat : 'general'
  }));
}
