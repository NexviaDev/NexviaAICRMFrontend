import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatMergePdfExportOptionsSummary } from '@/lib/merge-pdf-export-options';
import {
  resolvePdfPrintAreaXlsxTemplate,
  resolvePdfPrintAreaXlsxTemplateForRow
} from '@/lib/merge-pdf-print-area-template';
import { parseTsvGrid, quoteTsvField } from '@/lib/tsv-grid';
import {
  applyMailDefaultsToMergeRow,
  refreshMailTokensFromProfile
} from '@/lib/merge-template-mail-defaults';
import { normalizeMergePdfExportOptions } from '@/lib/merge-pdf-export-options';
import {
  fetchXlsxSheetNamesFromMergeTemplate,
  pdfExportOptionsWithSheetNames
} from '@/lib/merge-pdf-sync-from-template';
import { mergeRowsIncludePdfExport, resolveMergeExportAddonForRow } from '@/lib/merge-export-addon';
import MergePdfPreviewModal from './merge-pdf-preview-modal';
import { isXlsxMergeTemplate } from '@/lib/merge-template-file-types';
import {
  autoFitAllMergeSheetTextareas,
  autoFitMergeSheetRowTextareas,
  autoFitMergeSheetTextarea
} from './merge-sheet-textarea-auto-fit';
import { partitionMergeSheetFields } from '@/lib/merge-our-forced-fields';
import './merge-data-sheet-modal.css';

/** 안내 문구용(quotation-doc-merge.js 의 MERGE_SHEET_* 과 동일하게 유지) */
const MERGE_SHEET_HINT_INITIAL = 200;
const MERGE_SHEET_HINT_MAX = 1000;

/** 시트 앞쪽 고정 열: [0] 양식(id 쉼표), [1] 받기·메일(추가 추출은 quotation-doc-merge·양식 PDF 설정) */
export const MERGE_SHEET_PREFIX_COL_COUNT = 2;
/** 받는 사람·참조(CC)·제목·본문 — PREFIX 뒤 4열(시트 열 인덱스 2..5) */
export const MERGE_SHEET_MAIL_INPUT_COL_COUNT = 4;
/** 치환 필드 열 시작 인덱스 */
export const MERGE_SHEET_FIELD_START = MERGE_SHEET_PREFIX_COL_COUNT + MERGE_SHEET_MAIL_INPUT_COL_COUNT;

/** 시트 열기 시 첫 페인트용 행 수 — 나머지는 프레임 단위로 점진 마운트 */
const SHEET_ROW_RENDER_INITIAL = 24;
const SHEET_ROW_RENDER_CHUNK = 48;

const MAIL_SERIAL_KEYS = ['_mailTo', '_mailCc', '_mailSubject', '_mailBody'];

function normalizeSelection(a, b) {
  if (!a || !b) return null;
  const r1 = Math.min(a.r, b.r);
  const r2 = Math.max(a.r, b.r);
  const c1 = Math.min(a.c, b.c);
  const c2 = Math.max(a.c, b.c);
  return { r1, r2, c1, c2 };
}

function serializeRange(mergeRows, fields, rect, templates, selectedTemplateId) {
  if (!rect) return '';
  const fieldStart = MERGE_SHEET_FIELD_START;
  const nCols = fieldStart + (fields?.length || 0);
  if (nCols <= 0) return '';
  const { r1, r2, c1, c2 } = rect;
  const lines = [];
  for (let r = r1; r <= r2; r += 1) {
    const row = mergeRows[r];
    const cols = [];
    for (let c = c1; c <= c2; c += 1) {
      let v = '';
      if (row && c >= 0 && c < nCols) {
        if (c === 0) {
          v = rowTemplateIdsForSelect(row, selectedTemplateId, templates || []).join(',');
        } else if (c < fieldStart) {
          const mk = MAIL_SERIAL_KEYS[c - MERGE_SHEET_PREFIX_COL_COUNT];
          v = mk && row[mk] != null ? String(row[mk]) : '';
        } else {
          const fk = fields[c - fieldStart]?.key;
          if (fk) v = row[fk] != null ? String(row[fk]) : '';
        }
      }
      cols.push(quoteTsvField(v.replace(/\r/g, '')));
    }
    lines.push(cols.join('\t'));
  }
  return lines.join('\n');
}

function rowTemplateIdsForSelect(row, selectedTemplateId, templates) {
  const def = selectedTemplateId || templates[0]?._id || '';
  const raw =
    Array.isArray(row?._templateIds) && row._templateIds.length
      ? row._templateIds
      : row?._templateId
        ? [String(row._templateId)]
        : def
          ? [String(def)]
          : [];
  return raw.filter((id) => templates.some((t) => String(t._id) === String(id)));
}

/** 접힌 드롭다운에만 표시: 1개면 파일명만, 2개 이상이면 개수만 */
function templateDropdownSummaryText(row, selectedTemplateId, templates, templateListFileName) {
  if (!templates?.length) return '—';
  const ids = rowTemplateIdsForSelect(row, selectedTemplateId, templates);
  if (ids.length > 1) return `총 ${ids.length}개 선택`;
  const t = templates.find((x) => String(x._id) === String(ids[0]));
  return t ? templateListFileName(t) : '—';
}

/** 양식 체크박스 패널은 펼칠 때만 마운트(200행×N양식 DOM 폭증 방지) */
function SheetTemplateDropdown({
  idx,
  row,
  templates,
  mergeRunning,
  selectedTemplateId,
  templateListFileName,
  templateDropdownSummaryText,
  rowTemplateIdsForSelect,
  onUpdateRowTemplates,
  applyTemplateProfileForRow
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const selectedIds = rowTemplateIdsForSelect(row, selectedTemplateId, templates);
  const selectedSet = new Set(selectedIds);

  if (!templates.length) {
    return <span className="qdm-sheet-template-checkboxes-empty">—</span>;
  }
  if (mergeRunning) {
    return (
      <div
        className="qdm-sheet-template-dropdown-summary qdm-sheet-template-dropdown-summary--static"
        title="생성 중에는 양식을 바꿀 수 없습니다."
      >
        <span className="qdm-sheet-template-dropdown-summary-text">
          {templateDropdownSummaryText(row, selectedTemplateId, templates, templateListFileName)}
        </span>
      </div>
    );
  }

  return (
    <details
      className="qdm-sheet-template-dropdown"
      title="펼쳐서 여러 양식을 체크할 수 있습니다."
      onToggle={(e) => setPanelOpen(e.currentTarget.open)}
    >
      <summary className="qdm-sheet-template-dropdown-summary" aria-label={`${idx + 1}행 사용 양식, 펼치기`}>
        <span className="qdm-sheet-template-dropdown-summary-text">
          {templateDropdownSummaryText(row, selectedTemplateId, templates, templateListFileName)}
        </span>
        <span className="material-symbols-outlined qdm-sheet-template-dropdown-chevron" aria-hidden>
          expand_more
        </span>
      </summary>
      {panelOpen ? (
        <div className="qdm-sheet-template-dropdown-panel" role="group" aria-label={`${idx + 1}행 사용 양식(체크로 여러 개)`}>
          <div className="qdm-sheet-template-checkboxes-scroll">
            {templates.map((t) => {
              const id = String(t._id);
              const checked = selectedSet.has(id);
              return (
                <label key={t._id} className="qdm-sheet-template-checkbox-row">
                  <input
                    type="checkbox"
                    className="qdm-sheet-template-checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const cur = rowTemplateIdsForSelect(row, selectedTemplateId, templates);
                      const next = new Set(cur.map(String));
                      if (e.target.checked) next.add(id);
                      else next.delete(id);
                      const ordered = templates.map((x) => String(x._id)).filter((tid) => next.has(tid));
                      onUpdateRowTemplates?.(idx, ordered);
                      applyTemplateProfileForRow?.(idx, ordered);
                    }}
                  />
                  <span className="qdm-sheet-template-checkbox-text">
                    {templateListFileName(t)}{' '}
                    <span className="qdm-sheet-template-checkbox-type">({t.fileType})</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </details>
  );
}

/**
 * 문서 메일머지 — 데이터 입력 시트 전체 화면 모달.
 * 오버레이 클릭으로는 닫지 않습니다(닫기 버튼으로만 닫습니다).
 */
export default function MergeDataSheetModal({
  open,
  onClose,
  mergeRows,
  mergeFields,
  templates,
  selectedTemplateId,
  templateListFileName,
  mergeRunning,
  mergeMessage,
  fieldEditorOpen,
  canManageMergeFields,
  fieldPresets,
  fieldPresetsLoading,
  selectedFieldPresetId,
  fieldGuide,
  onSelectFieldPresetId,
  onCreateFieldPreset,
  onOpenFieldEditor,
  onOpenCompanyPick,
  onUpdateRow,
  onUpdateRowTemplates,
  onRunMerge,
  pdfExportOptions,
  templateProfilesById = {},
  mergeMailFallback = null,
  onRequestPdfPreview,
  pdfPreviewOpen,
  pdfPreviewObjectUrl,
  pdfPreviewLoading,
  pdfPreviewError,
  pdfPreviewCaption,
  onClosePdfPreview,
  apiBase,
  mergeApiPrefix = '/quotation-merge',
  getAuthHeader,
  onDownloadRow,
  onMailtoHandoffRow,
  onMergeSheetGridPaste,
  onMailCellPaste,
  onMailCellKeyDown,
  renderMergeCell,
  ourForcedValues = {}
}) {
  /** `{{rowIndex}}` 는 서버가 행마다 자동 채움 — 시트 입력·범위 선택 대상에서 제외 */
  const fields = (mergeFields || []).filter((f) => f && String(f.key || '') !== 'rowIndex');
  const { regularFields, ourForcedFields, allFields } = useMemo(
    () => partitionMergeSheetFields(fields),
    [fields]
  );
  const [selAnchor, setSelAnchor] = useState(null);
  const [selEnd, setSelEnd] = useState(null);
  const [renderedRowCount, setRenderedRowCount] = useState(0);
  const mergeRowsRef = useRef(mergeRows);
  const fieldsRef = useRef(fields);
  const templatesRef = useRef(templates);
  const selectedTemplateIdRef = useRef(selectedTemplateId);
  const mergeSheetScrollRef = useRef(null);
  const mergeModalRootRef = useRef(null);
  const prevMergeRowsRef = useRef(null);
  const selectionDragActiveRef = useRef(false);
  const [pdfFocusRowIndex, setPdfFocusRowIndex] = useState(null);
  const pdfExportOptionsRef = useRef(pdfExportOptions);
  const sheetUsesPdf = useMemo(
    () =>
      mergeRowsIncludePdfExport(
        mergeRows,
        templateProfilesById,
        pdfExportOptions,
        templates,
        selectedTemplateId
      ),
    [mergeRows, templateProfilesById, pdfExportOptions, templates, selectedTemplateId]
  );
  const printAreaXlsxTemplate = useMemo(() => {
    if (
      pdfFocusRowIndex != null &&
      pdfFocusRowIndex >= 0 &&
      mergeRows[pdfFocusRowIndex]
    ) {
      const rowHit = resolvePdfPrintAreaXlsxTemplateForRow(
        mergeRows[pdfFocusRowIndex],
        templates,
        selectedTemplateId,
        templateListFileName
      );
      if (rowHit) return rowHit;
    }
    return resolvePdfPrintAreaXlsxTemplate(mergeRows, templates, selectedTemplateId, templateListFileName);
  }, [pdfFocusRowIndex, mergeRows, templates, selectedTemplateId, templateListFileName]);

  useEffect(() => {
    mergeRowsRef.current = mergeRows;
  }, [mergeRows]);
  useEffect(() => {
    fieldsRef.current = allFields;
  }, [allFields]);
  useEffect(() => {
    templatesRef.current = templates;
  }, [templates]);
  useEffect(() => {
    selectedTemplateIdRef.current = selectedTemplateId;
  }, [selectedTemplateId]);
  useEffect(() => {
    pdfExportOptionsRef.current = pdfExportOptions;
  }, [pdfExportOptions]);

  useEffect(() => {
    if (!open) {
      setSelAnchor(null);
      setSelEnd(null);
      setPdfFocusRowIndex(null);
      setRenderedRowCount(0);
      prevMergeRowsRef.current = null;
    }
  }, [open]);

  /** 200행 전체를 한 번에 그리지 않고 점진 마운트 — 시트 열기 체감 속도 개선 */
  useEffect(() => {
    if (!open || !fields.length) return;
    setRenderedRowCount(Math.min(SHEET_ROW_RENDER_INITIAL, mergeRows.length));
  }, [open, fields.length, mergeRows.length]);

  useEffect(() => {
    if (!open || renderedRowCount >= mergeRows.length) return;
    const id = requestAnimationFrame(() => {
      setRenderedRowCount((n) => Math.min(n + SHEET_ROW_RENDER_CHUNK, mergeRows.length));
    });
    return () => cancelAnimationFrame(id);
  }, [open, mergeRows.length, renderedRowCount]);

  useEffect(() => {
    if (!open || renderedRowCount >= mergeRows.length) return;
    const el = mergeSheetScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 360) {
        setRenderedRowCount(mergeRows.length);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [open, mergeRows.length, renderedRowCount]);

  const visibleMergeRows = useMemo(
    () => mergeRows.slice(0, Math.min(renderedRowCount, mergeRows.length)),
    [mergeRows, renderedRowCount]
  );

  const applyTemplateProfileForRow = useCallback(
    (rowIdx, templateIds) => {
      if (typeof onUpdateRow !== 'function' && typeof onUpdateRowTemplates !== 'function') return;
      const primaryId = (templateIds || [])[0];
      const prof = primaryId ? templateProfilesById[String(primaryId)] : null;
      const row = mergeRowsRef.current[rowIdx];
      if (!row) return;
      if (prof?.pdfExportOptions && typeof onUpdateRow === 'function') {
        onUpdateRow(rowIdx, '_pdfExportOptions', normalizeMergePdfExportOptions(prof.pdfExportOptions));
      }
      const mailResolveCtx = { templateProfilesById, pageMailFallback: mergeMailFallback };
      let withMail = applyMailDefaultsToMergeRow(
        row,
        prof?.mailDefaults,
        mergeMailFallback,
        fieldsRef.current,
        mailResolveCtx
      );
      withMail = refreshMailTokensFromProfile(withMail, prof?.mailDefaults, fieldsRef.current, mailResolveCtx);
      if (typeof onUpdateRow === 'function') {
        for (const key of ['_mailTo', '_mailCc', '_mailSubject', '_mailBody']) {
          if (withMail[key] !== row[key]) onUpdateRow(rowIdx, key, withMail[key]);
        }
        const addon = resolveMergeExportAddonForRow(
          { ...row, ...withMail, _pdfExportOptions: prof?.pdfExportOptions ? normalizeMergePdfExportOptions(prof.pdfExportOptions) : row._pdfExportOptions },
          templateProfilesById,
          pdfExportOptionsRef.current,
          templateIds || []
        );
        onUpdateRow(rowIdx, '_exportAddon', addon);
      }
      setPdfFocusRowIndex(rowIdx);
    },
    [templateProfilesById, mergeMailFallback, onUpdateRow]
  );

  const syncPdfOptionsFromTemplateIds = useCallback(
    async (rowIdx, templateIds) => {
      const ids = (templateIds || []).map(String).filter(Boolean);
      applyTemplateProfileForRow(rowIdx, ids);
      if (!apiBase || !getAuthHeader || typeof onUpdateRow !== 'function' || !ids.length) return;
      const xlsxId = ids.find((id) => {
        const t = templatesRef.current.find((x) => String(x._id) === id);
        return t?.fileType === 'xlsx';
      });
      if (!xlsxId) return;
      try {
        const names = await fetchXlsxSheetNamesFromMergeTemplate(apiBase, getAuthHeader, xlsxId, mergeApiPrefix);
        if (!names.length) return;
        const row = mergeRowsRef.current[rowIdx];
        const base = row?._pdfExportOptions || pdfExportOptionsRef.current;
        onUpdateRow(rowIdx, '_pdfExportOptions', pdfExportOptionsWithSheetNames(base, names));
      } catch (_) {
        /* 프로필 PDF 설정은 이미 적용됨 — 시트명 자동 맞춤만 생략 */
      }
    },
    [applyTemplateProfileForRow, apiBase, mergeApiPrefix, getAuthHeader, onUpdateRow]
  );

  /** 펼친 사용 양식(details) — 모달 안 다른 곳을 누르면 닫음 */
  useEffect(() => {
    if (!open || mergeRunning) return;
    const onPointerDown = (e) => {
      const root = mergeModalRootRef.current;
      const sheet = mergeSheetScrollRef.current;
      if (!root || !sheet) return;
      const target = e.target;
      if (!target || typeof target.closest !== 'function') return;
      if (!root.contains(target)) return;
      const openDetails = sheet.querySelectorAll('details.qdm-sheet-template-dropdown[open]');
      if (!openDetails.length) return;
      openDetails.forEach((node) => {
        if (!node.contains(target)) node.removeAttribute('open');
      });
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, mergeRunning]);

  /** 시트 textarea — 값이 있는 칸만 높이 맞춤(빈 200행 일괄 측정 방지), 페인트 후 비동기 */
  useEffect(() => {
    if (!open || !fields.length) return;

    const prev = prevMergeRowsRef.current;
    const rows = mergeRows;
    prevMergeRowsRef.current = rows;

    const id = requestAnimationFrame(() => {
      const root = mergeSheetScrollRef.current;
      if (!root) return;

      if (!prev || prev.length !== rows.length) {
        autoFitAllMergeSheetTextareas(root, { onlyNonEmpty: true });
        return;
      }
      if (prev === rows) return;

      const changed = new Set();
      for (let i = 0; i < rows.length; i += 1) {
        if (prev[i] !== rows[i]) changed.add(i);
      }
      if (changed.size === 0) return;
      if (changed.size > 8) {
        autoFitAllMergeSheetTextareas(root, { onlyNonEmpty: true });
        return;
      }
      changed.forEach((rowIdx) => autoFitMergeSheetRowTextareas(root, rowIdx));
    });

    return () => cancelAnimationFrame(id);
  }, [open, fields.length, mergeRows, renderedRowCount]);

  useEffect(() => {
    if (!open || !fields.length) return;
    const root = mergeSheetScrollRef.current;
    if (!root) return;

    const onInput = (e) => {
      const el = e.target;
      if (el?.matches?.('textarea.qdm-cell--sheet')) {
        autoFitMergeSheetTextarea(el);
      }
    };
    root.addEventListener('input', onInput);
    return () => root.removeEventListener('input', onInput);
  }, [open, fields.length, mergeRows.length]);

  const rect = normalizeSelection(selAnchor, selEnd);

  const isCellSelected = useCallback(
    (rowIdx, colIdx) => {
      if (!rect) return false;
      return rowIdx >= rect.r1 && rowIdx <= rect.r2 && colIdx >= rect.c1 && colIdx <= rect.c2;
    },
    [rect]
  );

  useEffect(() => {
    if (!open) return;
    const onCopy = (e) => {
      const ae = document.activeElement;
      if (ae && ae.closest && ae.closest('.qdm-grid--sheet')) {
        if (
          typeof ae.selectionStart === 'number' &&
          typeof ae.selectionEnd === 'number' &&
          ae.selectionEnd !== ae.selectionStart
        ) {
          return;
        }
      }
      const r = normalizeSelection(selAnchor, selEnd);
      if (!r) return;
      const text = serializeRange(
        mergeRowsRef.current,
        fieldsRef.current,
        r,
        templatesRef.current,
        selectedTemplateIdRef.current
      );
      if (!text) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', text);
    };
    document.addEventListener('copy', onCopy, true);
    return () => document.removeEventListener('copy', onCopy, true);
  }, [open, selAnchor, selEnd]);

  /** 범위가 잡혀 있을 때 TSV 붙여넣기(양식·추가추출·메일·치환 필드) */
  useEffect(() => {
    if (!open || typeof onMergeSheetGridPaste !== 'function') return;
    const onPaste = (e) => {
      if (fieldEditorOpen) return;
      const ae = document.activeElement;
      if (ae && ae.closest && ae.closest('.qdm-grid--sheet')) {
        if (
          ae.tagName === 'TEXTAREA' &&
          typeof ae.selectionStart === 'number' &&
          typeof ae.selectionEnd === 'number' &&
          ae.selectionEnd !== ae.selectionStart
        ) {
          return;
        }
      }
      const r = normalizeSelection(selAnchor, selEnd);
      if (!r) return;
      const t = e.clipboardData?.getData('text/plain');
      if (t == null || t === '') return;
      const grid = parseTsvGrid(t);
      if (!grid.length) return;
      const multi = grid.length > 1 || (grid[0] && grid[0].length > 1);
      const selRows = r.r2 - r.r1 + 1;
      const selCols = r.c2 - r.c1 + 1;
      const multiCellSel = selRows > 1 || selCols > 1;
      let pasteGrid = grid;
      if (!multi) {
        // 단일 셀만 복사한 뒤 여러 셀을 선택한 경우: 엑셀처럼 선택 전체에 같은 값
        if (!multiCellSel) return;
        const v = grid[0]?.[0] ?? '';
        pasteGrid = Array.from({ length: selRows }, () => Array.from({ length: selCols }, () => v));
      }
      e.preventDefault();
      e.stopPropagation();
      onMergeSheetGridPaste({ r: r.r1, c: r.c1 }, pasteGrid);
    };
    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, [open, fieldEditorOpen, selAnchor, selEnd, onMergeSheetGridPaste]);

  /** Esc: 치환 필드 범위 선택만 해제(시트 모달은 닫지 않음). 치환 필드 편집 모달이 열려 있으면 Esc는 그쪽으로 둠 */
  useEffect(() => {
    if (!open || fieldEditorOpen) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (!selAnchor || !selEnd) return;
      e.preventDefault();
      e.stopPropagation();
      setSelAnchor(null);
      setSelEnd(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, fieldEditorOpen, selAnchor, selEnd]);

  /**
   * 텍스트 입력 포커스가 아닐 때 Backspace → history.back()
   * (시트를 URL 푸시로 연 경우 뒤로가기·모바일 제스처와 동일하게 닫힘)
   */
  useEffect(() => {
    if (!open || fieldEditorOpen) return;
    const onKey = (e) => {
      if (e.key !== 'Backspace') return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const ae = document.activeElement;
      if (ae?.isContentEditable) return;
      const tag = (ae?.tagName || '').toLowerCase();
      if (tag === 'textarea') return;
      if (tag === 'select') return;
      if (tag === 'input') {
        const typ = String(ae?.type || 'text').toLowerCase();
        const textLike =
          typ === 'text' ||
          typ === 'search' ||
          typ === 'tel' ||
          typ === 'url' ||
          typ === 'email' ||
          typ === 'number' ||
          typ === 'password' ||
          typ === 'date' ||
          typ === 'time' ||
          typ === 'datetime-local' ||
          typ === '';
        if (textLike) return;
      }
      e.preventDefault();
      window.history.back();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, fieldEditorOpen]);

  /** 화살표: 선택이 있을 때 인접 셀로 이동(Shift면 앵커 고정·끝점만 확장). 시트 내 텍스트 입력 중이면 기본 동작 유지 */
  useEffect(() => {
    if (!open || fieldEditorOpen || mergeRunning || !fields.length) return;
    const onKey = (e) => {
      if (e.isComposing) return;
      const deltas = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1]
      };
      const d = deltas[e.key];
      if (!d) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (!selAnchor || !selEnd) return;
      const ae = document.activeElement;
      /* 체크박스·라디오 등은 포커스가 남아도 셀 이동 허용 — 텍스트 편집 중일 때만 스킵 */
      if (ae && ae.closest && ae.closest('.qdm-grid--sheet')) {
        if (ae.tagName === 'TEXTAREA') return;
        if (ae.tagName === 'INPUT') {
          const typ = String(ae.type || 'text').toLowerCase();
          const textLike =
            typ === 'text' ||
            typ === 'search' ||
            typ === 'tel' ||
            typ === 'url' ||
            typ === 'email' ||
            typ === 'number' ||
            typ === 'password' ||
            typ === 'date' ||
            typ === 'time' ||
            typ === 'datetime-local' ||
            typ === '';
          if (textLike) return;
        }
      }
      const nRows = mergeRowsRef.current?.length ?? 0;
      const fLen = fieldsRef.current?.length ?? 0;
      const maxCol = MERGE_SHEET_FIELD_START + fLen - 1;
      if (nRows <= 0 || maxCol < 0) return;

      const [dr, dc] = d;
      const fromR = selEnd.r;
      const fromC = selEnd.c;
      const nr = Math.min(nRows - 1, Math.max(0, fromR + dr));
      const nc = Math.min(maxCol, Math.max(0, fromC + dc));

      e.preventDefault();
      e.stopPropagation();

      if (nr === fromR && nc === fromC) {
        return;
      }

      if (e.shiftKey && selAnchor) {
        setSelEnd({ r: nr, c: nc });
      } else {
        setSelAnchor({ r: nr, c: nc });
        setSelEnd({ r: nr, c: nc });
      }

      requestAnimationFrame(() => {
        const root = mergeSheetScrollRef.current;
        if (!root) return;
        const el = root.querySelector(`[data-merge-sheet-row="${nr}"][data-merge-sheet-col="${nc}"]`);
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, fieldEditorOpen, mergeRunning, fields.length, selAnchor, selEnd]);

  /** Delete: 치환 필드 범위 선택 시 선택 칸 값 비우기(셀 안에서 텍스트만 드래그한 경우는 기본 동작 유지) */
  useEffect(() => {
    if (!open || fieldEditorOpen || mergeRunning) return;
    const onKey = (e) => {
      if (e.key !== 'Delete' || e.isComposing) return;
      const r = normalizeSelection(selAnchor, selEnd);
      if (!r) return;
      const ae = document.activeElement;
      if (ae && ae.closest && ae.closest('.qdm-grid--sheet')) {
        if (
          (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT') &&
          typeof ae.selectionStart === 'number' &&
          typeof ae.selectionEnd === 'number' &&
          ae.selectionEnd !== ae.selectionStart
        ) {
          return;
        }
      }
      if (typeof onUpdateRow !== 'function') return;
      e.preventDefault();
      e.stopPropagation();
      const fList = fieldsRef.current || [];
      const tmplList = templatesRef.current || [];
      const defTid = String(selectedTemplateIdRef.current || tmplList[0]?._id || '').trim();
      const fieldStart = MERGE_SHEET_FIELD_START;
      const mailKeys = MAIL_SERIAL_KEYS;
      for (let row = r.r1; row <= r.r2; row += 1) {
        for (let col = r.c1; col <= r.c2; col += 1) {
          if (col === 0) {
            if (typeof onUpdateRowTemplates === 'function') {
              onUpdateRowTemplates(row, defTid ? [defTid] : []);
            }
          } else if (col < fieldStart) {
            const mk = mailKeys[col - MERGE_SHEET_PREFIX_COL_COUNT];
            if (mk) onUpdateRow(row, mk, '');
          } else {
            const fk = fList[col - fieldStart]?.key;
            if (!fk) continue;
            onUpdateRow(row, fk, '');
          }
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, fieldEditorOpen, mergeRunning, selAnchor, selEnd, onUpdateRow, onUpdateRowTemplates]);

  /** 시트 안에서 Alt 키를 누르는 순간 이전 셀 범위 선택을 해제(새 Alt 선택만 보이게) */
  useEffect(() => {
    if (!open || mergeRunning || !fields.length || fieldEditorOpen) return;
    const onKey = (e) => {
      if (!e.altKey || e.repeat) return;
      if (e.code !== 'AltLeft' && e.code !== 'AltRight') return;
      const root = mergeSheetScrollRef.current;
      const t = e.target;
      if (!root || !t || typeof t.closest !== 'function' || !root.contains(t)) return;
      selectionDragActiveRef.current = false;
      setSelAnchor(null);
      setSelEnd(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, mergeRunning, fields.length, fieldEditorOpen]);

  /** Alt+드래그: input 위에서도 캡처 단계에서 잡아 범위 선택이 되도록 함 */
  useEffect(() => {
    if (!open || mergeRunning || !fields.length) return;
    const el = mergeSheetScrollRef.current;
    if (!el) return;

    const onDownCap = (e) => {
      if (e.button !== 0) return;
      const td = e.target.closest?.('[data-merge-sheet-row]');
      if (
        !td ||
        !el.contains(td) ||
        !td.classList.contains('qdm-sheet-td--merge-select')
      )
        return;
      const rowIdx = Number(td.getAttribute('data-merge-sheet-row'));
      const colIdx = Number(td.getAttribute('data-merge-sheet-col'));
      if (Number.isNaN(rowIdx) || Number.isNaN(colIdx)) return;
      if (!e.altKey) return;
      if (e.target.closest('input,textarea')) e.preventDefault();
      e.preventDefault();

      selectionDragActiveRef.current = false;
      setSelAnchor({ r: rowIdx, c: colIdx });
      setSelEnd({ r: rowIdx, c: colIdx });
      selectionDragActiveRef.current = true;

      const onMove = (ev) => {
        if (!selectionDragActiveRef.current) return;
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const t2 = hit && typeof hit.closest === 'function' ? hit.closest('[data-merge-sheet-row]') : null;
        if (
          !t2 ||
          !el.contains(t2) ||
          !t2.classList.contains('qdm-sheet-td--merge-select')
        )
          return;
        const r = Number(t2.getAttribute('data-merge-sheet-row'));
        const c = Number(t2.getAttribute('data-merge-sheet-col'));
        if (Number.isNaN(r) || Number.isNaN(c)) return;
        setSelEnd({ r, c });
      };
      const onUp = () => {
        selectionDragActiveRef.current = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

    el.addEventListener('mousedown', onDownCap, true);
    return () => el.removeEventListener('mousedown', onDownCap, true);
  }, [open, mergeRunning, fields.length]);

  const onSheetCellMouseEnter = useCallback((rowIdx, sheetCol) => {
    if (!selectionDragActiveRef.current) return;
    setSelEnd({ r: rowIdx, c: sheetCol });
  }, []);

  const onSheetCellClick = useCallback(
    (e, rowIdx, sheetCol) => {
      if (mergeRunning) return;
      if (e.target.closest && e.target.closest('button')) return;
      if (e.target.closest && e.target.closest('input,textarea')) return;
      if (e.altKey) return;
      selectionDragActiveRef.current = false;
      if (e.shiftKey && selAnchor) {
        setSelEnd({ r: rowIdx, c: sheetCol });
        return;
      }
      setSelAnchor({ r: rowIdx, c: sheetCol });
      setSelEnd({ r: rowIdx, c: sheetCol });
    },
    [mergeRunning, selAnchor]
  );

  const onTemplatePresetCellClick = useCallback(
    (e, rowIdx) => {
      if (!e.target.closest('input')) {
        setPdfFocusRowIndex(rowIdx);
        const row = mergeRowsRef.current[rowIdx];
        const ids = rowTemplateIdsForSelect(row, selectedTemplateIdRef.current, templatesRef.current);
        void syncPdfOptionsFromTemplateIds(rowIdx, ids);
      }
      onSheetCellClick(e, rowIdx, 0);
    },
    [onSheetCellClick, syncPdfOptionsFromTemplateIds]
  );

  if (!open) return null;

  return (
    <div
      ref={mergeModalRootRef}
      className="merge-data-sheet-modal-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-data-sheet-modal-title"
    >
      <div className="merge-data-sheet-modal-backdrop" aria-hidden />
      <div className="merge-data-sheet-modal-panel">
        <header className="merge-data-sheet-modal-head">
          <div className="merge-data-sheet-modal-head-main">
            <h2 id="merge-data-sheet-modal-title" className="merge-data-sheet-modal-head-title">
              데이터 입력 후 파일 받기
            </h2>
            <div className="merge-data-sheet-modal-head-tools">
              <label className="merge-data-sheet-modal-template-label">
                <span className="merge-data-sheet-modal-template-label-text">저장된 필드 구성</span>
                <select
                  className="merge-data-sheet-modal-template-select"
                  value={String(selectedFieldPresetId || '')}
                  onChange={(e) => onSelectFieldPresetId?.(e.target.value)}
                  disabled={mergeRunning || fieldPresetsLoading}
                  aria-label="이름 붙여 저장한 치환 필드 목록에서 선택"
                  title="여러 번 저장해 둔 ‘필드 구성’을 이름으로 골라 씁니다. 맨 위 ‘회사 기본’은 이름 없이 회사에 한 벌만 두는 방식입니다. Word/Excel 양식 파일은 표의「사용 양식」열에서 고릅니다."
                >
                  <option value=""> 기본 </option>
                  {(fieldPresets || []).map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name} ({p.fieldCount}필드)
                    </option>
                  ))}
                </select>
              </label>
              {canManageMergeFields && typeof onCreateFieldPreset === 'function' ? (
                <button
                  type="button"
                  className="mdm-toolbar-btn mdm-toolbar-btn--ghost mdm-toolbar-btn--small"
                  onClick={onCreateFieldPreset}
                  disabled={mergeRunning || !fields.length}
                  title="지금 시트에 보이는 항목 그대로, 이름을 붙여 새 구성으로 DB에 저장합니다."
                >
                  새 구성 추가
                </button>
              ) : null}
              {canManageMergeFields && typeof onOpenFieldEditor === 'function' ? (
                <button
                  type="button"
                  className="mdm-toolbar-btn mdm-toolbar-btn--ghost mdm-toolbar-btn--small merge-data-sheet-modal-field-btn"
                  onClick={onOpenFieldEditor}
                  disabled={mergeRunning || !fields.length}
                  title={!fields.length ? '문서 치환 항목을 불러온 뒤 사용할 수 있습니다.' : '문서에 넣을 {{항목}} 이름·표시 이름 등을 바꿉니다.'}
                >
                  <span className="material-symbols-outlined" aria-hidden>
                    tune
                  </span>
                  문서 치환 항목 편집
                </button>
              ) : null}
              <button
                type="button"
                className="mdm-toolbar-btn mdm-toolbar-btn--ghost"
                onClick={onOpenCompanyPick}
                disabled={mergeRunning}
              >
                고객사에서 불러오기
              </button>
            </div>
          </div>
          <div className="merge-data-sheet-modal-head-actions">
            <button
              type="button"
              className="mdm-toolbar-btn mdm-toolbar-btn--primary"
              onClick={() => void onRunMerge()}
              disabled={mergeRunning || !templates.length || !fields.length}
            >
              <span className="material-symbols-outlined" aria-hidden>
                download
              </span>
              다운로드
            </button>
            <button
              type="button"
              className="mdm-toolbar-btn mdm-toolbar-btn--icon"
              onClick={onClose}
              aria-label="시트 닫기"
              title="닫기"
              disabled={mergeRunning}
            >
              <span className="material-symbols-outlined" aria-hidden>
                close
              </span>
            </button>
          </div>
        </header>

        {mergeMessage ? (
          <p className="qdm-banner qdm-banner-ok merge-data-sheet-modal-message" role="status">
            {mergeMessage}
          </p>
        ) : null}



        {!fields.length ? (
          <p className="quotation-doc-merge-desc merge-data-sheet-modal-message">문서 치환 항목을 불러오는 중이거나, 아직 등록된 목록이 없습니다.</p>
        ) : (
            <div className="qdm-merge-sheet-outer merge-data-sheet-modal-body">
              <div
                className="qdm-merge-sheet-scroll"
                ref={mergeSheetScrollRef}
                style={{ width: '100%', minHeight: 0, boxSizing: 'border-box' }}
                role="region"
                aria-label="문서 메일머지 데이터 표, 가로·세로 스크롤 가능"
              >
                <div className="merge-data-sheet-modal-table-wrap">
                <table className="qdm-grid qdm-grid--merge qdm-grid--sheet mdm-sheet">
                  <thead>
                    <tr>
                      <th
                        className="qdm-sheet-th qdm-sheet-th--preset qdm-sheet-th--template"
                        title="양식을 선택하면 등록 시 저장한 PDF·메일 기본값이 행에 적용됩니다. Alt+드래그로 범위 선택·복사·붙여넣기."
                      >
                        사용 양식
                      </th>
                      <th
                        className="qdm-sheet-th qdm-sheet-th--preset qdm-sheet-th--mail-col qdm-sheet-th--mail-check"
                        title="왼쪽: 이 행만 Word/Excel·PDF 파일 받기. 오른쪽: 파일 없이 메일 작성 창만 엽니다. 추가 추출은 양식·PDF 설정에서 결정됩니다."
                      >
                        <span className="qdm-th-label">받기·메일</span>
                      </th>
                      <th
                        className="qdm-sheet-th qdm-sheet-th--preset qdm-sheet-th--mail-col qdm-sheet-th--mail-to"
                        title="최우선: 이 칸 입력값. 비어 있으면 사용 양식·문서 메일머지에 등록한 받는 사람 기본값이 적용됩니다."
                      >
                        <span className="qdm-th-label">받는 사람</span>
                        <code className="qdm-th-code">{`{{mailTo}}`}</code>
                      </th>
                      <th
                        className="qdm-sheet-th qdm-sheet-th--preset qdm-sheet-th--mail-col qdm-sheet-th--mail-cc"
                        title="최우선: 이 칸 입력값. 비어 있으면 사용 양식·문서 메일머지에 등록한 참조(CC) 기본값이 적용됩니다."
                      >
                        <span className="qdm-th-label">참조(CC)</span>
                        <code className="qdm-th-code">{`{{mailCc}}`}</code>
                      </th>
                      <th
                        className="qdm-sheet-th qdm-sheet-th--preset qdm-sheet-th--mail-col qdm-sheet-th--mail-subj"
                        title="메일 제목 — 메일로 보내기 시 제목란"
                      >
                        <span className="qdm-th-label">메일 제목</span>
                        <code className="qdm-th-code">{`{{mailSubject}}`}</code>
                      </th>
                      <th
                        className="qdm-sheet-th qdm-sheet-th--preset qdm-sheet-th--preset-end qdm-sheet-th--mail-col qdm-sheet-th--mail-body"
                        title="메일 본문. {{치환자}}에 들어가는 동적 값의 줄바꿈만 쉼표(,)로 바뀝니다. Excel/PDF 치환 열의 줄바꿈은 그대로 반영됩니다. mailto 한도로 일부만 넘어갈 수 있습니다."
                      >
                        <span className="qdm-th-label">메일 본문</span>
                        <code className="qdm-th-code">{`{{mailBody}}`}</code>
                      </th>
                      {regularFields.map((f, fi) => (
                        <th
                          key={f.key}
                          className={`qdm-sheet-th qdm-sheet-th--merge-field${fi === 0 ? ' qdm-sheet-th--merge-field-edge' : ''}`}
                          title={`${f.label} — ${f.key}`}
                        >
                          <span className="qdm-th-label">{f.label}</span>
                          <code className="qdm-th-code">{`{{${f.key}}}`}</code>
                        </th>
                      ))}
                      {ourForcedFields.map((f, oi) => (
                        <th
                          key={f.key}
                          className={`qdm-sheet-th qdm-sheet-th--merge-field qdm-sheet-th--our-forced${oi === 0 ? ' qdm-sheet-th--merge-field-edge' : ''}${oi === ourForcedFields.length - 1 ? ' qdm-sheet-th--our-forced-end' : ''}`}
                          title={`${f.label} — ${f.key} (자사 강제값, 병합 시 자동 적용)`}
                        >
                          <span className="qdm-th-label">{f.label}</span>
                          <code className="qdm-th-code">{`{{${f.key}}}`}</code>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleMergeRows.map((row, idx) => {
                      return (
                        <tr
                          key={`row-${idx}`}
                          className={idx % 2 === 0 ? 'mdm-sheet-row--stripe-a' : 'mdm-sheet-row--stripe-b'}
                        >
                          <td
                            className={`qdm-sheet-td qdm-sheet-td--preset qdm-sheet-td--template qdm-sheet-td--template-dropdown qdm-sheet-td--merge-select${isCellSelected(idx, 0) ? ' qdm-sheet-td--selected' : ''
                              }`}
                            data-merge-sheet-row={idx}
                            data-merge-sheet-col={0}
                            onMouseEnter={() => onSheetCellMouseEnter(idx, 0)}
                            onClick={(e) => onTemplatePresetCellClick(e, idx)}
                          >
                            <SheetTemplateDropdown
                              idx={idx}
                              row={row}
                              templates={templates}
                              mergeRunning={mergeRunning}
                              selectedTemplateId={selectedTemplateId}
                              templateListFileName={templateListFileName}
                              templateDropdownSummaryText={templateDropdownSummaryText}
                              rowTemplateIdsForSelect={rowTemplateIdsForSelect}
                              onUpdateRowTemplates={onUpdateRowTemplates}
                              applyTemplateProfileForRow={applyTemplateProfileForRow}
                            />
                          </td>
                          <td
                            className={`qdm-sheet-td qdm-sheet-td--preset qdm-sheet-td--mail-col qdm-sheet-td--mail-check qdm-sheet-td--merge-select${isCellSelected(idx, 1) ? ' qdm-sheet-td--selected' : ''
                              }`}
                            data-merge-sheet-row={idx}
                            data-merge-sheet-col={1}
                            onMouseEnter={() => onSheetCellMouseEnter(idx, 1)}
                            onClick={(e) => onSheetCellClick(e, idx, 1)}
                          >
                            <div className="qdm-sheet-mail-actions-wrap">
                              <button
                                type="button"
                                className="mdm-sheet-action-btn mdm-sheet-action-btn--download mdm-sheet-mail-download-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void onDownloadRow?.(idx);
                                }}
                                disabled={
                                  mergeRunning ||
                                  !templates.length ||
                                  !fields.length ||
                                  typeof onDownloadRow !== 'function'
                                }
                                title="이 행의「사용 양식」과 양식에 저장된 PDF·추가 추출 설정대로 Word/Excel·PDF 파일만 받습니다."
                                aria-label={`${idx + 1}행 파일 받기`}
                              >
                                <span className="material-symbols-outlined" aria-hidden>
                                  download
                                </span>
                                받기
                              </button>
                              <button
                                type="button"
                                className="mdm-sheet-action-btn mdm-sheet-action-btn--send mdm-sheet-mail-send-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void onMailtoHandoffRow?.(idx);
                                }}
                                disabled={
                                  mergeRunning ||
                                  !templates.length ||
                                  !fields.length ||
                                  typeof onMailtoHandoffRow !== 'function'
                                }
                                title="파일은 보내지 않고, 받는 사람·참조(CC)·제목·본문으로 PC 메일 작성 창만 엽니다."
                                aria-label={`${idx + 1}행 메일 보내기`}
                              >
                                <span className="material-symbols-outlined" aria-hidden>
                                  outgoing_mail
                                </span>
                                보내기
                              </button>
                            </div>
                          </td>
                          <td
                            className={`qdm-sheet-td qdm-sheet-td--preset qdm-sheet-td--mail-col qdm-sheet-td--mail-to qdm-sheet-td--mail-input qdm-sheet-td--merge-select${isCellSelected(idx, 2) ? ' qdm-sheet-td--selected' : ''
                              }`}
                            data-merge-sheet-row={idx}
                            data-merge-sheet-col={2}
                            onMouseEnter={() => onSheetCellMouseEnter(idx, 2)}
                            onClick={(e) => onSheetCellClick(e, idx, 2)}
                          >
                            <textarea
                              className="qdm-cell qdm-cell--sheet qdm-cell-sheet-single qdm-cell--auto-fit"
                              rows={1}
                              value={String(row._mailTo ?? '')}
                              onChange={(e) => onUpdateRow?.(idx, '_mailTo', e.target.value)}
                              onPaste={(e) => onMailCellPaste?.(e, idx, 2)}
                              onKeyDown={(e) => onMailCellKeyDown?.(e, idx, 2)}
                              disabled={mergeRunning}
                              placeholder=""
                              autoComplete="off"
                              spellCheck={false}
                              aria-label={`${idx + 1}행 받는 사람`}
                            />
                          </td>
                          <td
                            className={`qdm-sheet-td qdm-sheet-td--preset qdm-sheet-td--mail-col qdm-sheet-td--mail-cc qdm-sheet-td--mail-input qdm-sheet-td--merge-select${isCellSelected(idx, 3) ? ' qdm-sheet-td--selected' : ''
                              }`}
                            data-merge-sheet-row={idx}
                            data-merge-sheet-col={3}
                            onMouseEnter={() => onSheetCellMouseEnter(idx, 3)}
                            onClick={(e) => onSheetCellClick(e, idx, 3)}
                          >
                            <textarea
                              className="qdm-cell qdm-cell--sheet qdm-cell-sheet-single qdm-cell--auto-fit"
                              rows={1}
                              value={String(row._mailCc ?? '')}
                              onChange={(e) => onUpdateRow?.(idx, '_mailCc', e.target.value)}
                              onPaste={(e) => onMailCellPaste?.(e, idx, 3)}
                              onKeyDown={(e) => onMailCellKeyDown?.(e, idx, 3)}
                              disabled={mergeRunning}
                              placeholder=""
                              autoComplete="off"
                              spellCheck={false}
                              aria-label={`${idx + 1}행 참조 CC`}
                            />
                          </td>
                          <td
                            className={`qdm-sheet-td qdm-sheet-td--preset qdm-sheet-td--mail-col qdm-sheet-td--mail-subj qdm-sheet-td--mail-input qdm-sheet-td--merge-select${isCellSelected(idx, 4) ? ' qdm-sheet-td--selected' : ''
                              }`}
                            data-merge-sheet-row={idx}
                            data-merge-sheet-col={4}
                            onMouseEnter={() => onSheetCellMouseEnter(idx, 4)}
                            onClick={(e) => onSheetCellClick(e, idx, 4)}
                          >
                            <textarea
                              className="qdm-cell qdm-cell--sheet qdm-cell-sheet-single qdm-cell--auto-fit"
                              rows={1}
                              value={String(row._mailSubject ?? '')}
                              onChange={(e) => onUpdateRow?.(idx, '_mailSubject', e.target.value)}
                              onPaste={(e) => onMailCellPaste?.(e, idx, 4)}
                              onKeyDown={(e) => onMailCellKeyDown?.(e, idx, 4)}
                              disabled={mergeRunning}
                              placeholder=""
                              spellCheck={false}
                              aria-label={`${idx + 1}행 메일 제목`}
                            />
                          </td>
                          <td
                            className={`qdm-sheet-td qdm-sheet-td--preset qdm-sheet-td--preset-end qdm-sheet-td--mail-col qdm-sheet-td--mail-body qdm-sheet-td--mail-input qdm-sheet-td--merge-select${isCellSelected(idx, 5) ? ' qdm-sheet-td--selected' : ''
                              }`}
                            data-merge-sheet-row={idx}
                            data-merge-sheet-col={5}
                            onMouseEnter={() => onSheetCellMouseEnter(idx, 5)}
                            onClick={(e) => onSheetCellClick(e, idx, 5)}
                          >
                            <textarea
                              className="qdm-cell qdm-cell--sheet qdm-cell-tall qdm-cell--auto-fit"
                              rows={1}
                              value={String(row._mailBody ?? '')}
                              onChange={(e) => onUpdateRow?.(idx, '_mailBody', e.target.value)}
                              onPaste={(e) => onMailCellPaste?.(e, idx, 5)}
                              onKeyDown={(e) => onMailCellKeyDown?.(e, idx, 5)}
                              disabled={mergeRunning}
                              placeholder=""
                              spellCheck={false}
                              aria-label={`${idx + 1}행 메일 본문`}
                            />
                          </td>
                          {regularFields.map((f, fi) => {
                            const sheetCol = MERGE_SHEET_FIELD_START + fi;
                            return (
                              <td
                                key={f.key}
                                className={`qdm-sheet-td qdm-sheet-td--field qdm-sheet-td--merge-field${fi === 0 ? ' qdm-sheet-td--merge-field-edge' : ''} qdm-sheet-td--merge-select${isCellSelected(idx, sheetCol) ? ' qdm-sheet-td--selected' : ''
                                  }`}
                                data-merge-sheet-row={idx}
                                data-merge-sheet-col={sheetCol}
                                onMouseEnter={() => onSheetCellMouseEnter(idx, sheetCol)}
                                onClick={(e) => onSheetCellClick(e, idx, sheetCol)}
                              >
                                {renderMergeCell(row, idx, f)}
                              </td>
                            );
                          })}
                          {ourForcedFields.map((f, oi) => {
                            const sheetCol = MERGE_SHEET_FIELD_START + regularFields.length + oi;
                            const showVal = idx === 0 ? String(ourForcedValues?.[f.key] ?? '') : '';
                            return (
                              <td
                                key={f.key}
                                className={`qdm-sheet-td qdm-sheet-td--field qdm-sheet-td--merge-field qdm-sheet-td--our-forced${oi === 0 ? ' qdm-sheet-td--merge-field-edge' : ''} qdm-sheet-td--merge-select${isCellSelected(idx, sheetCol) ? ' qdm-sheet-td--selected' : ''
                                  }`}
                                data-merge-sheet-row={idx}
                                data-merge-sheet-col={sheetCol}
                                onMouseEnter={() => onSheetCellMouseEnter(idx, sheetCol)}
                                onClick={(e) => onSheetCellClick(e, idx, sheetCol)}
                                title={
                                  idx === 0
                                    ? '자사 강제값 — 문서 병합 시 모든 행에 자동 적용'
                                    : '병합 시 자동 적용(표시는 첫 행만)'
                                }
                              >
                                <textarea
                                  className="qdm-cell qdm-cell--sheet qdm-cell-sheet-single qdm-cell--auto-fit qdm-cell--our-forced"
                                  readOnly
                                  tabIndex={-1}
                                  rows={1}
                                  value={showVal}
                                  spellCheck={false}
                                  aria-label={`${f.label} 자사 강제 (${f.key})`}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
        )}
        <footer className="merge-data-sheet-modal-footer" role="note">
          <p className="merge-data-sheet-modal-footer-text">
            <strong>PDF 추가 추출</strong>·<strong>PDF 만 추출</strong>은 <strong>백엔드</strong>에서 LibreOffice로
            변환합니다.
            {sheetUsesPdf && pdfExportOptions ? (
              <>
                {' '}
                현재 PDF 설정: <strong>{formatMergePdfExportOptionsSummary(pdfExportOptions)}</strong>
                {' '}
              </>
            ) : (
              <>
                {' '}
                PDF 추가·만 추출은 <strong>양식 등록 시 PDF 설정</strong>·문서 메일머지 페이지 PDF 설정에서 정합니다. PDF·메일은{' '}
                <strong>사용 양식</strong>에 등록된 설정이 적용됩니다.
              </>
            )}
          </p>
        </footer>
        <MergePdfPreviewModal
          open={!!pdfPreviewOpen}
          onClose={onClosePdfPreview}
          pdfObjectUrl={pdfPreviewObjectUrl}
          loading={pdfPreviewLoading}
          error={pdfPreviewError}
          caption={pdfPreviewCaption}
        />
        {mergeRunning ? (
          <div
            className="merge-data-sheet-modal-busy"
            role="status"
            aria-live="polite"
            aria-label="Word Excel PDF 문서 생성 중"
          >
            <div className="merge-data-sheet-modal-busy-card">
              <span className="merge-data-sheet-modal-spinner" aria-hidden />
              <span className="merge-data-sheet-modal-busy-text">Word/Excel·PDF 생성 중…</span>
              <span className="merge-data-sheet-modal-busy-hint">서버에서 변환합니다. 잠시만 기다려 주세요.</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function isMergeFieldPresetMongoId(v) {
  if (v == null || v === '') return false;
  return /^[a-f0-9]{24}$/i.test(String(v).trim());
}
