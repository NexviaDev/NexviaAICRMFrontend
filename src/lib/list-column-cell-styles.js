/**
 * listTemplates.*.columnCellStyles — 열별 셀 값(본문) 표시 스타일.
 * 서버 sanitize와 동일한 키만 사용합니다.
 */

const FONT_SIZE_RE = /^(\d{1,2}(\.\d{1,3})?)(px|rem|em|%)$/;

/**
 * @param {Record<string, object>|null|undefined} columnCellStyles
 * @param {string} columnKey
 * @returns {Record<string, string|number>|undefined}
 */
export function listColumnValueInlineStyle(columnCellStyles, columnKey) {
  if (!columnKey || !columnCellStyles || typeof columnCellStyles !== 'object') return undefined;
  const s = columnCellStyles[columnKey];
  if (!s || typeof s !== 'object') return undefined;
  const style = {};
  if (typeof s.fontSize === 'string' && FONT_SIZE_RE.test(s.fontSize.trim())) {
    style.fontSize = s.fontSize.trim();
  }
  if (s.fontWeight != null) {
    const fw = String(s.fontWeight).trim();
    if (fw === 'bold') style.fontWeight = '700';
    else if (fw === 'normal') style.fontWeight = '400';
    else if (/^[1-9]00$/.test(fw)) style.fontWeight = fw;
  }
  if (typeof s.color === 'string' && s.color.trim()) {
    const c = s.color.trim().slice(0, 32);
    if (/^#[0-9a-fA-F]{3,8}$/.test(c) || /^rgba?\([^)]{0,48}\)$/.test(c)) style.color = c;
  }
  if (s.fontStyle === 'italic' || s.fontStyle === 'normal') style.fontStyle = s.fontStyle;
  return Object.keys(style).length ? style : undefined;
}

/**
 * 모달 저장용: 빈 항목·기본값 제거
 * @param {Record<string, object>} raw
 */
export function compactColumnCellStylesForSave(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object') continue;
    const entry = {};
    if (typeof v.fontSize === 'string' && v.fontSize.trim() && FONT_SIZE_RE.test(v.fontSize.trim())) {
      entry.fontSize = v.fontSize.trim().slice(0, 14);
    }
    if (v.fontWeight != null) {
      const fw = String(v.fontWeight).trim();
      if (fw === 'bold' || fw === '700') entry.fontWeight = '700';
      else if (fw === '600') entry.fontWeight = '600';
      else if (fw === '500') entry.fontWeight = '500';
      else if (fw === 'normal' || fw === '400') entry.fontWeight = '400';
    }
    if (typeof v.color === 'string' && v.color.trim()) {
      const c = v.color.trim().slice(0, 32);
      if (/^#[0-9a-fA-F]{3,8}$/.test(c) || /^rgba?\([^)]{0,48}\)$/.test(c)) entry.color = c;
    }
    if (v.fontStyle === 'italic') entry.fontStyle = 'italic';
    if (Object.keys(entry).length) out[String(k).trim().slice(0, 120)] = entry;
  }
  return out;
}
