/** 시트 표 textarea — 내용 길이에 맞춰 행 높이 자동 맞춤 */

const MIN_SINGLE_PX = 38;
const MIN_TALL_PX = 54;
const MIN_COL_WIDTH_PX = 72;

function readMinHeightPx(textarea) {
  return textarea.classList.contains('qdm-cell-tall') ? MIN_TALL_PX : MIN_SINGLE_PX;
}

function measureTextWidth(text, font) {
  if (!measureTextWidth._canvas) {
    measureTextWidth._canvas = document.createElement('canvas');
  }
  const ctx = measureTextWidth._canvas.getContext('2d');
  if (!ctx) return MIN_COL_WIDTH_PX;
  ctx.font = font;
  return ctx.measureText(text).width;
}

function clearMergeSheetTextareaWidth(textarea) {
  textarea.style.width = '';
  textarea.style.minWidth = '';
}

/** 내용 길이에 맞춰 열 가로 너비 확장 */
function autoFitMergeSheetTextareaWidth(textarea) {
  const val = String(textarea.value || '');
  if (!val.trim()) {
    clearMergeSheetTextareaWidth(textarea);
    return;
  }

  const tall = textarea.classList.contains('qdm-cell-tall');
  const cs = window.getComputedStyle(textarea);
  const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const pad = 16;
  let w = MIN_COL_WIDTH_PX;

  if (tall) {
    for (const line of val.split('\n')) {
      w = Math.max(w, measureTextWidth(line || ' ', font) + pad);
    }
  } else {
    w = Math.max(w, measureTextWidth(val.replace(/\n/g, ' '), font) + pad);
  }

  const px = `${Math.ceil(w)}px`;
  textarea.style.width = px;
  textarea.style.minWidth = px;
}

function resetMergeSheetTextareaMin(textarea) {
  if (!textarea) return;
  const minPx = readMinHeightPx(textarea);
  textarea.style.overflow = 'hidden';
  textarea.style.resize = 'none';
  textarea.style.height = `${minPx}px`;
  clearMergeSheetTextareaWidth(textarea);
  const td = textarea.closest('td');
  if (td) {
    td.style.height = 'auto';
    td.style.minHeight = `${minPx}px`;
    td.style.maxHeight = 'none';
  }
}

/** @param {HTMLTextAreaElement | null | undefined} textarea */
export function autoFitMergeSheetTextarea(textarea) {
  if (!textarea || textarea.nodeName !== 'TEXTAREA') return;
  if (!String(textarea.value || '').trim()) {
    resetMergeSheetTextareaMin(textarea);
    return;
  }
  const td = textarea.closest('td');
  const minPx = readMinHeightPx(textarea);

  textarea.style.overflow = 'hidden';
  textarea.style.resize = 'none';
  textarea.style.height = '0px';
  const next = Math.max(minPx, textarea.scrollHeight);

  textarea.style.height = `${next}px`;

  if (td) {
    td.style.height = 'auto';
    td.style.minHeight = `${next}px`;
    td.style.maxHeight = 'none';
  }

  autoFitMergeSheetTextareaWidth(textarea);
}

/** @param {ParentNode | null | undefined} root @param {{ onlyNonEmpty?: boolean }} [opts] */
export function autoFitAllMergeSheetTextareas(root, opts = {}) {
  if (!root) return;
  const onlyNonEmpty = opts.onlyNonEmpty !== false;
  root.querySelectorAll('textarea.qdm-cell--sheet').forEach((el) => {
    if (onlyNonEmpty && !String(el.value || '').trim()) {
      resetMergeSheetTextareaMin(el);
      return;
    }
    autoFitMergeSheetTextarea(el);
  });
}

/** @param {ParentNode | null | undefined} root @param {number} rowIndex */
export function autoFitMergeSheetRowTextareas(root, rowIndex) {
  if (!root || !Number.isFinite(rowIndex)) return;
  root
    .querySelectorAll(`[data-merge-sheet-row="${rowIndex}"] textarea.qdm-cell--sheet`)
    .forEach((el) => autoFitMergeSheetTextarea(el));
}
