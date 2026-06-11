/**
 * 필드·셀 표시값 → 수식 계산용 숫자
 * ₩, $, 원, %, 쉼표 등 문자는 제거하고 숫자만 사용
 */

export function looksLikeFormulaInput(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  if (s.startsWith('=')) return true;
  return /\[[^\]]+\]/.test(s);
}

const NON_NUMERIC_FIELD_TYPES = new Set(['text', 'date', 'select', 'multiselect']);

/**
 * @param {*} value
 * @param {{ fieldType?: string|null, rejectFormula?: boolean }} [options]
 * @returns {number|null}
 */
export function parseNumericFieldValue(value, options = {}) {
  const { fieldType = null, rejectFormula = true } = options;

  if (fieldType && NON_NUMERIC_FIELD_TYPES.has(fieldType)) return null;

  if (fieldType === 'checkbox') {
    if (value === true || value === 'true' || value === 1 || value === '1') return 1;
    return 0;
  }

  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;

  const s = String(value).trim();
  if (!s) return null;
  if (rejectFormula && looksLikeFormulaInput(s)) return null;

  const cleaned = s.replace(/,/g, '').replace(/[^\d.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;

  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 수식 참조용 — 글자 필드라도 10, 10%, 6,790 처럼 숫자만 있으면 계산에 사용 (SAP 코드 등은 제외) */
export function looksLikeNumericTextForFormula(value) {
  const s = String(value ?? '').trim();
  if (!s) return false;
  if (looksLikeFormulaInput(s)) return false;
  if (/[a-zA-Z\uAC00-\uD7A3]/.test(s)) return false;
  return true;
}

/** @returns {number} */
export function parseNumericFieldValueOrZero(value, options = {}) {
  return parseNumericFieldValue(value, options) ?? 0;
}

/** customFields 객체 — 수식 계산용: number/checkbox만 숫자화, text/date/select 등은 문자열 유지 */
export function normalizeCustomFieldsForFormula(customFields = {}, definitions = [], opts = {}) {
  const { rejectFormula = true } = opts;
  const typeMap = {};
  for (const d of definitions || []) {
    if (d?.key) typeMap[d.key] = d.type;
  }
  const out = {};
  for (const [key, val] of Object.entries(customFields || {})) {
    const fieldType = typeMap[key] || null;
    if (fieldType === 'formula' && rejectFormula && looksLikeFormulaInput(val)) continue;

    if (fieldType === 'checkbox') {
      out[key] = parseNumericFieldValue(val, { fieldType: 'checkbox', rejectFormula: false });
      continue;
    }

    if (fieldType === 'number') {
      const n = parseNumericFieldValue(val, { fieldType: 'number', rejectFormula });
      if (n != null) out[key] = n;
      continue;
    }

    if (fieldType && NON_NUMERIC_FIELD_TYPES.has(fieldType)) {
      if (val === '' || val == null) continue;
      if (looksLikeNumericTextForFormula(val)) {
        const n = parseNumericFieldValue(val, { rejectFormula });
        if (n != null) {
          out[key] = n;
          continue;
        }
      }
      out[key] = Array.isArray(val) ? val : String(val).trim();
      continue;
    }

    // 정의 없음·기타 — 수식 참조 시 숫자 추출 가능, 저장용으로는 원문 우선
    const n = parseNumericFieldValue(val, { rejectFormula });
    if (n != null) out[key] = n;
    else if (val !== '' && val != null) out[key] = Array.isArray(val) ? val : String(val).trim();
  }
  return out;
}

/** API 저장용 — number는 ₩$쉼표 제거 후 숫자, text/date/select 등은 문자열 유지 */
export function normalizeCustomFieldsForApiSave(customFields = {}, definitions = []) {
  const typeMap = {};
  for (const d of definitions || []) {
    if (d?.key) typeMap[d.key] = d.type || 'text';
  }
  const out = {};
  for (const [key, val] of Object.entries(customFields || {})) {
    if (val === '' || val == null) continue;
    const fieldType = typeMap[key] || 'text';
    if (fieldType === 'formula') continue;
    if (fieldType === 'number') {
      if (typeof val === 'number' && Number.isFinite(val)) {
        out[key] = val;
        continue;
      }
      const n = parseNumericFieldValue(val, { fieldType: 'number', rejectFormula: true });
      if (n != null) out[key] = n;
      else out[key] = val;
      continue;
    }
    if (fieldType === 'checkbox') {
      out[key] = parseNumericFieldValue(val, { fieldType: 'checkbox', rejectFormula: false }) === 1;
      continue;
    }
    if (fieldType === 'multiselect') {
      out[key] = Array.isArray(val) ? val : [String(val).trim()];
      continue;
    }
    out[key] = Array.isArray(val) ? val : String(val).trim();
  }
  return out;
}

/** builtIn 수식 컨텍스트 — 문자열 금액·환율도 숫자로 */
export function normalizeFormulaBuiltInNumbers(builtIn = {}) {
  const out = {};
  for (const [key, val] of Object.entries(builtIn || {})) {
    if (val === '' || val == null) continue;
    const n = parseNumericFieldValue(val, { rejectFormula: true });
    out[key] = n != null ? n : val;
  }
  return out;
}
