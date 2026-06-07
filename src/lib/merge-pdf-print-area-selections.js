import { normalizeExcelPrintArea } from '@/lib/merge-pdf-export-options';

let selectionIdSeq = 0;

export function newPrintAreaSelectionId() {
  selectionIdSeq += 1;
  return `pa-${Date.now()}-${selectionIdSeq}`;
}

/**
 * @typedef {{ id: string, sheetName: string, printArea: string, printPageMode: 'all'|'custom', printPageFrom: number, printPageTo: number }} PrintAreaSelection
 */

/** @returns {PrintAreaSelection[]} */
export function normalizePrintAreaSelections(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const sheetName = String(item.sheetName || '').trim();
    const printArea = normalizeExcelPrintArea(item.printArea);
    if (!sheetName || !printArea) continue;
    const printPageMode = item.printPageMode === 'custom' ? 'custom' : 'all';
    let printPageFrom = Math.max(1, parseInt(String(item.printPageFrom ?? 1), 10) || 1);
    let printPageTo = Math.max(1, parseInt(String(item.printPageTo ?? printPageFrom), 10) || printPageFrom);
    if (printPageTo < printPageFrom) printPageTo = printPageFrom;
    out.push({
      id: String(item.id || newPrintAreaSelectionId()),
      sheetName,
      printArea,
      printPageMode,
      printPageFrom,
      printPageTo
    });
    if (out.length >= 64) break;
  }
  return out;
}

/** @returns {PrintAreaSelection[]} */
export function legacyPrintAreaToSelections(printArea, sheetName) {
  const sheet = String(sheetName || '').trim();
  const raw = String(printArea || '').trim();
  if (!raw) return [];
  const parts = raw
    .split(',')
    .map((p) => normalizeExcelPrintArea(p))
    .filter(Boolean);
  if (!parts.length) return [];
  return parts.map((printAreaPart, i) => ({
    id: `legacy-${i}`,
    sheetName: sheet || 'Sheet1',
    printArea: printAreaPart,
    printPageMode: 'custom',
    printPageFrom: i + 1,
    printPageTo: i + 1
  }));
}

/** @param {PrintAreaSelection[]} selections */
export function printSheetNamesFromSelections(selections) {
  return [...new Set((selections || []).map((s) => s.sheetName).filter(Boolean))].slice(0, 32);
}

/** @param {PrintAreaSelection[]} selections */
export function buildLegacyPrintAreaString(selections) {
  const list = normalizePrintAreaSelections(selections);
  if (!list.length) return '';
  return list.map((s) => s.printArea).join(',');
}

/** @param {PrintAreaSelection[]} selections */
export function formatPrintAreaSelectionsSummary(selections) {
  const list = normalizePrintAreaSelections(selections);
  if (!list.length) return '';
  const sheets = printSheetNamesFromSelections(list);
  return `영역 ${list.length}개 · PDF ${list.length}페이지 · 시트 ${sheets.length}개`;
}

/**
 * @param {PrintAreaSelection[]} selections
 * @param {{ printPageMode?: string, printPageFrom?: number, printPageTo?: number }} globalPage
 */
/** 드래그로 추가한 인쇄 영역이 1개 이상인지 */
export function isCustomPrintAreaValid(o) {
  return normalizePrintAreaSelections(o?.printAreaSelections).length > 0;
}

/** 목록 순서 = PDF 페이지 순서 (1부터) */
export function renumberPrintAreaSelectionPages(selections) {
  return normalizePrintAreaSelections(selections).map((s, i) => ({
    ...s,
    printPageMode: 'custom',
    printPageFrom: i + 1,
    printPageTo: i + 1
  }));
}

/** 설정 화면·읽기 전용 요약 (시트별 구분) */
export function formatPrintAreaSelectionsLines(selections) {
  return normalizePrintAreaSelections(selections)
    .map((s, i) => {
      const pageNum = s.printPageFrom || i + 1;
      const page =
        s.printPageMode === 'custom'
          ? ` · PDF ${pageNum}페이지${s.printPageTo !== s.printPageFrom ? `–${s.printPageTo}` : ''}`
          : ` · PDF ${i + 1}페이지`;
      return `${i + 1}. [${s.sheetName}] ${s.printArea}${page}`;
    })
    .join('\n');
}

export function mergePrintPageRangeFromSelections(selections, globalPage = {}) {
  const custom = normalizePrintAreaSelections(selections).filter((s) => s.printPageMode === 'custom');
  if (!custom.length) {
    const mode = globalPage.printPageMode === 'custom' ? 'custom' : 'all';
    let from = Math.max(1, parseInt(String(globalPage.printPageFrom ?? 1), 10) || 1);
    let to = Math.max(1, parseInt(String(globalPage.printPageTo ?? from), 10) || from);
    if (to < from) to = from;
    return { printPageMode: mode, printPageFrom: from, printPageTo: to };
  }
  const from = Math.min(...custom.map((s) => s.printPageFrom));
  const to = Math.max(...custom.map((s) => s.printPageTo));
  return { printPageMode: 'custom', printPageFrom: from, printPageTo: to };
}
