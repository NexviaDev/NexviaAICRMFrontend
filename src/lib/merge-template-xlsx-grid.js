import * as XLSX from 'xlsx';

const MAX_PREVIEW_ROWS = 120;
const MAX_PREVIEW_COLS = 52;

/** 0-based column index → Excel column letters */
export function columnIndexToLetters(colIndex) {
  let n = colIndex + 1;
  let s = '';
  while (n > 0) {
    const mod = (n - 1) % 26;
    s = String.fromCharCode(65 + mod) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || 'A';
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {string[]}
 */
export function listXlsxSheetNames(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', bookSheets: true });
  return wb.SheetNames.slice();
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @param {string} [sheetName]
 */
export function parseXlsxSheetToDisplayGrid(arrayBuffer, sheetName) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const name =
    sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0] || '';
  const ws = name ? wb.Sheets[name] : null;
  if (!ws || !ws['!ref']) {
    return {
      cells: [['']],
      sheetName: name,
      sheetRow0: 0,
      sheetCol0: 0,
      rowCount: 1,
      colCount: 1,
      truncated: false
    };
  }
  const range = XLSX.utils.decode_range(ws['!ref']);
  const totalRows = range.e.r - range.s.r + 1;
  const totalCols = range.e.c - range.s.c + 1;
  const rowCount = Math.min(totalRows, MAX_PREVIEW_ROWS);
  const colCount = Math.min(totalCols, MAX_PREVIEW_COLS);
  const cells = [];
  for (let ri = 0; ri < rowCount; ri += 1) {
    const row = [];
    const sheetR = range.s.r + ri;
    for (let ci = 0; ci < colCount; ci += 1) {
      const sheetC = range.s.c + ci;
      const addr = XLSX.utils.encode_cell({ r: sheetR, c: sheetC });
      const cell = ws[addr];
      let text = '';
      if (cell != null) {
        if (cell.w != null && String(cell.w) !== '') text = String(cell.w);
        else if (cell.v != null) text = String(cell.v);
      }
      row.push(text);
    }
    cells.push(row);
  }
  return {
    cells,
    sheetName: name,
    sheetRow0: range.s.r,
    sheetCol0: range.s.c,
    rowCount,
    colCount,
    truncated: totalRows > rowCount || totalCols > colCount
  };
}

/** @deprecated use parseXlsxSheetToDisplayGrid */
export function parseXlsxToDisplayGrid(arrayBuffer) {
  return parseXlsxSheetToDisplayGrid(arrayBuffer);
}

/**
 * @param {{ r1: number, c1: number, r2: number, c2: number }} sel grid-local 0-based inclusive
 * @param {{ sheetRow0: number, sheetCol0: number }} meta
 */
export function gridSelectionToPrintArea(sel, meta) {
  const r1 = Math.min(sel.r1, sel.r2);
  const r2 = Math.max(sel.r1, sel.r2);
  const c1 = Math.min(sel.c1, sel.c2);
  const c2 = Math.max(sel.c1, sel.c2);
  const sheetR1 = meta.sheetRow0 + r1;
  const sheetR2 = meta.sheetRow0 + r2;
  const sheetC1 = meta.sheetCol0 + c1;
  const sheetC2 = meta.sheetCol0 + c2;
  const a1 = `${columnIndexToLetters(sheetC1)}${sheetR1 + 1}`;
  const a2 = `${columnIndexToLetters(sheetC2)}${sheetR2 + 1}`;
  return `${a1}:${a2}`;
}

/** Excel column letters → 0-based column index */
export function columnLettersToIndex(letters) {
  const s = String(letters || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (!s) return 0;
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return Math.max(0, n - 1);
}

/**
 * Excel 인쇄 영역 → 그리드 미리보기용 0-based inclusive 선택
 * @param {string} printArea
 * @param {{ sheetRow0: number, sheetCol0: number }} meta
 * @returns {{ r1: number, c1: number, r2: number, c2: number } | null}
 */
export function printAreaToGridSelection(printArea, meta) {
  const t = String(printArea || '')
    .trim()
    .toUpperCase()
    .replace(/\s/g, '');
  if (!t || !meta) return null;
  const m = t.match(/^([A-Z]{1,3})(\d{1,7})(?::([A-Z]{1,3})(\d{1,7}))?$/);
  if (!m) return null;
  const sheetC1 = columnLettersToIndex(m[1]);
  const sheetR1 = parseInt(m[2], 10) - 1;
  const sheetC2 = columnLettersToIndex(m[3] || m[1]);
  const sheetR2 = parseInt(m[4] || m[2], 10) - 1;
  if (!Number.isFinite(sheetR1) || !Number.isFinite(sheetR2)) return null;
  return {
    r1: sheetR1 - meta.sheetRow0,
    c1: sheetC1 - meta.sheetCol0,
    r2: sheetR2 - meta.sheetRow0,
    c2: sheetC2 - meta.sheetCol0
  };
}
