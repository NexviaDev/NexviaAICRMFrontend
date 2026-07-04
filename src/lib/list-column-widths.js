/**
 * listTemplates.*.columnWidths — 열 키별 픽셀 너비 (드래그 리사이즈 저장)
 */

export const LIST_COLUMN_WIDTH_MIN = 56;
export const LIST_COLUMN_WIDTH_MAX = 1200;
export const LIST_COLUMN_WIDTH_DEFAULT = 160;

/** 리사이즈 불가 고정 열 */
export const LIST_COLUMN_FIXED_WIDTH_PX = {
  _favorite: 52,
  _check: 44,
  __rowCheckbox__: 48
};

const NON_RESIZABLE_KEYS = new Set(['_favorite', '_check', '__rowCheckbox__']);

export function isListColumnResizable(columnKey) {
  return columnKey && !NON_RESIZABLE_KEYS.has(columnKey);
}

/**
 * @param {Record<string, number>|null|undefined} columnWidths
 * @param {string} columnKey
 */
export function getListColumnWidthPx(columnKey, columnWidths) {
  if (!columnKey) return LIST_COLUMN_WIDTH_DEFAULT;
  if (LIST_COLUMN_FIXED_WIDTH_PX[columnKey] != null) return LIST_COLUMN_FIXED_WIDTH_PX[columnKey];
  const raw = columnWidths?.[columnKey];
  const n = Math.round(Number(raw));
  if (Number.isFinite(n) && n >= LIST_COLUMN_WIDTH_MIN) {
    return Math.min(LIST_COLUMN_WIDTH_MAX, n);
  }
  return LIST_COLUMN_WIDTH_DEFAULT;
}

/**
 * @param {Record<string, unknown>|null|undefined} raw
 */
export function sanitizeColumnWidthsForSave(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (n >= 120) break;
    const key = String(k).trim().slice(0, 120);
    if (!key || NON_RESIZABLE_KEYS.has(key)) continue;
    const px = Math.round(Number(v));
    if (!Number.isFinite(px)) continue;
    out[key] = Math.min(LIST_COLUMN_WIDTH_MAX, Math.max(LIST_COLUMN_WIDTH_MIN, px));
    n += 1;
  }
  return out;
}

/**
 * @param {string[]} columnKeys
 * @param {Record<string, number>|null|undefined} columnWidths
 * @param {{ leadingPx?: number[] }} [options]
 */
export function sumListTableWidthPx(columnKeys, columnWidths, options = {}) {
  const leading = Array.isArray(options.leadingPx) ? options.leadingPx : [];
  const leadingSum = leading.reduce((a, b) => a + (Number(b) || 0), 0);
  const colsSum = (columnKeys || []).reduce(
    (sum, key) => sum + getListColumnWidthPx(key, columnWidths),
    0
  );
  return leadingSum + colsSum;
}
