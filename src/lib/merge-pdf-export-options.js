import {
  buildLegacyPrintAreaString,
  legacyPrintAreaToSelections,
  normalizePrintAreaSelections
} from '@/lib/merge-pdf-print-area-selections';
import { mergeExportAddonSummaryLabel } from '@/lib/merge-export-addon';
import { normalizeMergePdfPaperSize, formatMergePdfPaperSizeLabel } from '@/lib/merge-pdf-paper-sizes';

/** @deprecated use paperSize id */
export const MERGE_PDF_PAPER_A4 = 'a4';
export const MERGE_PDF_EXPORT_OPTIONS_STORAGE_KEY = 'nexvia.mergePdfExportOptions.v5';

export const MERGE_PDF_SCALE_MIN = 25;
export const MERGE_PDF_SCALE_MAX = 200;
export const MERGE_PDF_SCALE_DEFAULT = 100;

export const DEFAULT_MERGE_PDF_EXPORT_OPTIONS = Object.freeze({
  paperSize: 'a4',
  orientation: 'portrait',
  /** A4 여백 안에 인쇄 영역 전체가 보이도록 가로·세로 맞춤 (기본 켜짐) */
  pdfAutoFitToA4: true,
  fitToWidth: true,
  fitToHeight: true,
  /** 용지 가로·세로 가운데 기준 확대/축소 (%) — 자동 맞춤 시 추가 배율, 수동 시 Excel scale */
  pdfScalePercent: MERGE_PDF_SCALE_DEFAULT,
  centerOnPage: true,
  printAreaMode: 'custom',
  printArea: '',
  printAreaSelections: [],
  printSheetMode: 'auto',
  printSheetNames: [],
  printPageMode: 'all',
  printPageFrom: 1,
  printPageTo: 1,
  /** `same` | `pdfAddon` | `pdfOnly` — 데이터 시트가 아니라 PDF·양식 등록 설정에서 결정 */
  mergeExportAddon: 'same'
});

/** Excel 인쇄 영역 표기 (양식 xlsx 셀 주소). 예: A1:N45, B2:M50 */
export function normalizeExcelPrintArea(raw) {
  const t = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s/g, '');
  if (!t) return null;
  const m = t.match(/^([A-Z]{1,3})(\d{1,7})(?::([A-Z]{1,3})(\d{1,7}))?$/);
  if (!m) return null;
  if (m[3] && m[4]) return `${m[1]}${m[2]}:${m[3]}${m[4]}`;
  return `${m[1]}${m[2]}`;
}

function normalizePrintPageRange(o) {
  const mode = o.printPageMode === 'custom' ? 'custom' : 'all';
  let from = Math.max(1, parseInt(String(o.printPageFrom ?? 1), 10) || 1);
  let to = Math.max(1, parseInt(String(o.printPageTo ?? from), 10) || from);
  if (to < from) to = from;
  return { printPageMode: mode, printPageFrom: from, printPageTo: to };
}

export function normalizePdfScalePercent(raw) {
  const n = parseInt(String(raw ?? MERGE_PDF_SCALE_DEFAULT), 10);
  if (!Number.isFinite(n)) return MERGE_PDF_SCALE_DEFAULT;
  return Math.max(MERGE_PDF_SCALE_MIN, Math.min(MERGE_PDF_SCALE_MAX, n));
}

function normalizePrintSheetNames(o) {
  const raw = o.printSheetNames;
  if (Array.isArray(raw)) {
    const names = raw.map((s) => String(s || '').trim()).filter(Boolean);
    return [...new Set(names)].slice(0, 32);
  }
  const legacy = String(o.printSheetName || '').trim();
  if (legacy) return [legacy];
  return [];
}

export function buildMergePdfPageRangeString(opts) {
  const o = normalizeMergePdfExportOptions(opts);
  if (o.printPageMode !== 'custom') return '';
  if (o.printPageFrom === o.printPageTo) return String(o.printPageFrom);
  return `${o.printPageFrom}-${o.printPageTo}`;
}

export function normalizeMergePdfExportOptions(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  let printAreaSelections = normalizePrintAreaSelections(o.printAreaSelections);
  let page = normalizePrintPageRange(o);
  let printSheetNames = normalizePrintSheetNames(o);
  let parsedArea = normalizeExcelPrintArea(o.printArea);

  if (printAreaSelections.length) {
    parsedArea = buildLegacyPrintAreaString(printAreaSelections) || parsedArea;
    const sheetFromSel = [...new Set(printAreaSelections.map((s) => s.sheetName).filter(Boolean))];
    if (sheetFromSel.length) printSheetNames = sheetFromSel;
  } else if (o.printAreaMode === 'custom' || String(o.printArea || '').trim()) {
    const legacySheet =
      String(o.printSheetName || '').trim() ||
      (Array.isArray(o.printSheetNames) ? String(o.printSheetNames[0] || '').trim() : '');
    const rawArea = String(o.printArea || '').trim();
    if (legacySheet && rawArea.includes(',')) {
      printAreaSelections = legacyPrintAreaToSelections(rawArea, legacySheet);
      parsedArea = buildLegacyPrintAreaString(printAreaSelections) || parsedArea;
      printSheetNames = [legacySheet];
    } else if (legacySheet && parsedArea) {
      printAreaSelections = normalizePrintAreaSelections([
        { sheetName: legacySheet, printArea: parsedArea, printPageMode: 'all' }
      ]);
      parsedArea = buildLegacyPrintAreaString(printAreaSelections) || parsedArea;
      printSheetNames = [legacySheet];
    }
  }
  if (printAreaSelections.length === 1 && String(printAreaSelections[0].printArea || '').includes(',')) {
    printAreaSelections = legacyPrintAreaToSelections(
      printAreaSelections[0].printArea,
      printAreaSelections[0].sheetName
    );
    parsedArea = buildLegacyPrintAreaString(printAreaSelections) || parsedArea;
  }
  if (printAreaSelections.length) {
    const customPages = printAreaSelections.filter((s) => s.printPageMode === 'custom');
    if (customPages.length) {
      page = {
        printPageMode: 'custom',
        printPageFrom: Math.min(...customPages.map((s) => s.printPageFrom)),
        printPageTo: Math.max(...customPages.map((s) => s.printPageTo))
      };
    }
  }

  const printSheetMode =
    o.printSheetMode === 'named' || (printSheetNames.length > 0 && o.printSheetMode !== 'auto')
      ? 'named'
      : 'auto';
  if (printSheetMode !== 'named') printSheetNames = [];

  const paper = normalizeMergePdfPaperSize(o.paperSize);
  const hasSelections = printAreaSelections.length > 0;

  let mergeExportAddon = 'same';
  const eaRaw = String(o.mergeExportAddon || '').trim();
  if (eaRaw === 'pdfOnly') mergeExportAddon = 'pdfOnly';
  else if (eaRaw === 'pdfAddon' || eaRaw === 'preferPdf') mergeExportAddon = 'pdfAddon';
  else if (!eaRaw && hasSelections) mergeExportAddon = 'pdfAddon';

  const pdfAutoFitToA4 = o.pdfAutoFitToA4 !== false;
  const pdfScalePercent = normalizePdfScalePercent(o.pdfScalePercent);
  const fitToWidth = pdfAutoFitToA4 || o.fitToWidth === true;
  const fitToHeight = pdfAutoFitToA4 || o.fitToHeight === true;
  const userOrientation =
    String(o.orientation || 'portrait').toLowerCase() === 'landscape' ? 'landscape' : 'portrait';
  let inferredOrientation = userOrientation;
  let maxColSpan = 0;
  let maxRowSpan = 0;
  for (const sel of printAreaSelections) {
    const area = String(sel?.printArea || '').trim().toUpperCase();
    const m = area.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
    if (!m) continue;
    const colToNum = (c) => {
      let n = 0;
      for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64);
      return n;
    };
    const c1 = colToNum(m[1]);
    const c2 = colToNum(m[3] || m[1]);
    const r1 = parseInt(m[2], 10);
    const r2 = parseInt(m[4] || m[2], 10);
    maxColSpan = Math.max(maxColSpan, Math.abs(c2 - c1) + 1);
    maxRowSpan = Math.max(maxRowSpan, Math.abs(r2 - r1) + 1);
  }
  if (maxColSpan >= 18 || maxColSpan / Math.max(maxRowSpan, 1) >= 1.15) inferredOrientation = 'landscape';
  else if (maxRowSpan / Math.max(maxColSpan, 1) >= 1.35) inferredOrientation = 'portrait';
  return {
    paperSize: paper.id,
    paperSizeId: paper.excelPaperSizeId,
    orientation: inferredOrientation,
    pdfAutoFitToA4,
    pdfScalePercent,
    fitToWidth,
    fitToHeight,
    centerOnPage: o.centerOnPage !== false,
    singlePageSheet: o.singlePageSheet === true,
    printAreaMode: hasSelections ? 'custom' : 'auto',
    printArea: hasSelections && parsedArea ? parsedArea : '',
    printAreaSelections,
    printSheetMode: hasSelections ? 'named' : printSheetMode,
    printSheetNames: hasSelections ? printSheetNames : printSheetMode === 'named' ? printSheetNames : [],
    printPageMode: page.printPageMode,
    printPageFrom: page.printPageFrom,
    printPageTo: page.printPageTo,
    mergeExportAddon
  };
}

export function loadMergePdfExportOptions() {
  try {
    const raw = localStorage.getItem(MERGE_PDF_EXPORT_OPTIONS_STORAGE_KEY);
    if (!raw) {
      for (const legacyKey of [
        'nexvia.mergePdfExportOptions.v4',
        'nexvia.mergePdfExportOptions.v3',
        'nexvia.mergePdfExportOptions.v2',
        'nexvia.mergePdfExportOptions.v1'
      ]) {
        const legacy = localStorage.getItem(legacyKey);
        if (legacy) return normalizeMergePdfExportOptions(JSON.parse(legacy));
      }
      return { ...DEFAULT_MERGE_PDF_EXPORT_OPTIONS };
    }
    return normalizeMergePdfExportOptions(JSON.parse(raw));
  } catch (_) {
    return { ...DEFAULT_MERGE_PDF_EXPORT_OPTIONS };
  }
}

export function saveMergePdfExportOptions(opts) {
  const norm = normalizeMergePdfExportOptions(opts);
  try {
    localStorage.setItem(MERGE_PDF_EXPORT_OPTIONS_STORAGE_KEY, JSON.stringify(norm));
  } catch (_) {
    /* ignore quota */
  }
  return norm;
}

export function formatMergePdfExportOptionsSummary(opts) {
  const o = normalizeMergePdfExportOptions(opts);
  const orient = o.orientation === 'portrait' ? '세로' : '가로';
  const fit = o.pdfAutoFitToA4
    ? '· A4 한 페이지 맞춤'
    : o.fitToWidth
      ? '· 가로 1페이지'
      : '';
  const center = o.centerOnPage ? '· 가운데 맞춤' : '';
  const scale =
    o.pdfScalePercent !== MERGE_PDF_SCALE_DEFAULT ? `· ${o.pdfScalePercent}%` : '';
  const selCount = o.printAreaSelections?.length || 0;
  const area =
    selCount > 1
      ? `· 영역 ${selCount}개 (순서 지정)`
      : selCount === 1
        ? `· 영역 1개`
        : '· 영역 미지정';
  const sheet =
    o.printSheetNames?.length > 1 ? `· 시트 ${o.printSheetNames.length}개` : '';
  const paperLabel = formatMergePdfPaperSizeLabel(o.paperSize);
  const exportMode = mergeExportAddonSummaryLabel(o.mergeExportAddon);
  return `${exportMode} · ${paperLabel} ${orient}${fit}${scale}${center} ${area}${sheet}`;
}

