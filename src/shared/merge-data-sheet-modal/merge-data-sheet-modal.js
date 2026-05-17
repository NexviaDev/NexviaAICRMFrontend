import { useCallback, useEffect, useRef, useState } from 'react';
import { parseTsvGrid, quoteTsvField } from '@/lib/tsv-grid';
import './merge-data-sheet-modal.css';

/** 안내 문구용(quotation-doc-merge.js 의 MERGE_SHEET_* 과 동일하게 유지) */
const MERGE_SHEET_HINT_INITIAL = 200;
const MERGE_SHEET_HINT_MAX = 1000;

/** 시트 앞쪽 고정 열: [0] 양식(id 쉼표), [1] 추가추출(same|pdfAddon|pdfOnly), [2] 메일 보내기(복사·붙여넣기 빈칸) */
export const MERGE_SHEET_PREFIX_COL_COUNT = 3;
/** 받는 사람·참조(CC)·제목·본문 — PREFIX 뒤 4열(시트 열 인덱스 3..6) */
export const MERGE_SHEET_MAIL_INPUT_COL_COUNT = 4;
/** 치환 필드 열 시작 인덱스 */
export const MERGE_SHEET_FIELD_START = MERGE_SHEET_PREFIX_COL_COUNT + MERGE_SHEET_MAIL_INPUT_COL_COUNT;

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
        } else if (c === 1) {
          v = normalizeRowExportAddonMode(row);
        } else if (c === 2) {
          v = '';
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

function normalizeRowExportAddonMode(row) {
  const s = String(row?._exportAddon || '').trim();
  if (s === 'pdfOnly') return 'pdfOnly';
  if (s === 'pdfAddon' || s === 'preferPdf') return 'pdfAddon';
  return 'same';
}

function exportAddonSummaryText(row) {
  const m = normalizeRowExportAddonMode(row);
  if (m === 'pdfOnly') return 'PDF 만 추출';
  if (m === 'pdfAddon') return 'PDF 추가 추출';
  return '양식에 맞게만';
}

/** 접힌 드롭다운에만 표시: 1개면 파일명만, 2개 이상이면 개수만 */
function templateDropdownSummaryText(row, selectedTemplateId, templates, templateListFileName) {
  if (!templates?.length) return '—';
  const ids = rowTemplateIdsForSelect(row, selectedTemplateId, templates);
  if (ids.length > 1) return `총 ${ids.length}개 선택`;
  const t = templates.find((x) => String(x._id) === String(ids[0]));
  return t ? templateListFileName(t) : '—';
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
  onMailtoHandoffRow,
  onMergeSheetGridPaste,
  onMailCellPaste,
  onMailCellKeyDown,
  renderMergeCell
}) {
  /** `{{rowIndex}}` 는 서버가 행마다 자동 채움 — 시트 입력·범위 선택 대상에서 제외 */
  const fields = (mergeFields || []).filter((f) => f && String(f.key || '') !== 'rowIndex');
  const [selAnchor, setSelAnchor] = useState(null);
  const [selEnd, setSelEnd] = useState(null);
  const mergeRowsRef = useRef(mergeRows);
  const fieldsRef = useRef(fields);
  const templatesRef = useRef(templates);
  const selectedTemplateIdRef = useRef(selectedTemplateId);
  const mergeSheetScrollRef = useRef(null);
  const mergeModalRootRef = useRef(null);
  const selectionDragActiveRef = useRef(false);

  useEffect(() => {
    mergeRowsRef.current = mergeRows;
  }, [mergeRows]);
  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);
  useEffect(() => {
    templatesRef.current = templates;
  }, [templates]);
  useEffect(() => {
    selectedTemplateIdRef.current = selectedTemplateId;
  }, [selectedTemplateId]);

  useEffect(() => {
    if (!open) {
      setSelAnchor(null);
      setSelEnd(null);
    }
  }, [open]);

  /** 펼친 사용 양식·추가 추출(details) — 모달 안 다른 곳을 누르면 닫음 */
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
          } else if (col === 1) {
            onUpdateRow(row, '_exportAddon', 'same');
          } else if (col === 2) {
            /* 메일 보내기 열 — 값 없음 */
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
          <div className="merge-data-sheet-modal-head-inner">
            <div className="merge-data-sheet-modal-head-row2">
              <h2 id="merge-data-sheet-modal-title" className="merge-data-sheet-modal-head-title">
                데이터 입력 후 파일 받기
              </h2>
              <div className="merge-data-sheet-modal-head-tools">
                <label className="merge-data-sheet-modal-template-label">
                  <span className="merge-data-sheet-modal-template-label-text">저장된 필드 구성</span>
                  <select
                    className="merge-data-sheet-modal-template-select qdm-select"
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
                    className="qdm-btn qdm-btn-ghost qdm-btn-small"
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
                    className="qdm-btn qdm-btn-ghost qdm-btn-small merge-data-sheet-modal-field-btn"
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
                <button type="button" className="qdm-btn qdm-btn-ghost" onClick={onOpenCompanyPick} disabled={mergeRunning}>
                  고객사에서 불러오기
                </button>
              </div>
            </div>
          </div>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void onRunMerge()}
                  disabled={mergeRunning || !templates.length || !fields.length}
                >
                  <span className="material-symbols-outlined">download</span>
                  다운로드
                </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="시트 닫기" title="닫기">
            <span className="material-symbols-outlined" aria-hidden>
              close
            </span>
          </button>
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
                <table className="qdm-grid qdm-grid--merge qdm-grid--sheet">
                  <thead>
                    <tr>
                      <th
                        className="qdm-sheet-th qdm-sheet-th--preset qdm-sheet-th--template"
                        title="Alt+드래그로 범위 선택·복사(Ctrl+C)·TSV 붙여넣기. 양식 열 값은 등록 양식의 MongoDB id를 쉼표로 구분합니다."
                      >
                        사용 양식
                      </th>
                      <th
                        className="qdm-sheet-th qdm-sheet-th--preset qdm-sheet-th--export-merge"
                        title="Alt+드래그로 범위 선택·복사·붙여넣기. 값: same | pdfAddon | pdfOnly (영문 키)"
                      >
                        추가 추출
                      </th>
                      <th
                        className="qdm-sheet-th qdm-sheet-th--preset qdm-sheet-th--mail-col qdm-sheet-th--mail-check"
                        title="이 행만 견적 파일을 만든 뒤 PC 메일(Outlook 등) 작성 창을 엽니다. 받는 사람·참조(CC)·제목·본문은 아래 칸을 사용합니다."
                      >
                        <span className="qdm-th-label">메일</span>
                      </th>
                      <th
                        className="qdm-sheet-th qdm-sheet-th--preset qdm-sheet-th--mail-col qdm-sheet-th--mail-to"
                        title="받는 사람 이메일 — 메일로 보내기 시 수신 주소"
                      >
                        <span className="qdm-th-label">받는 사람</span>
                        <code className="qdm-th-code">{`{{mailTo}}`}</code>
                      </th>
                      <th
                        className="qdm-sheet-th qdm-sheet-th--preset qdm-sheet-th--mail-col qdm-sheet-th--mail-cc"
                        title="참조(CC) — 메일 작성 시 참조란(여러 주소는 쉼표·세미콜론으로 구분)"
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
                        title="메일 본문(평문). mailto 한도로 일부만 넘어갈 수 있습니다."
                      >
                        <span className="qdm-th-label">메일 본문</span>
                        <code className="qdm-th-code">{`{{mailBody}}`}</code>
                      </th>
                      {fields.map((f, fi) => (
                        <th
                          key={f.key}
                          className={`qdm-sheet-th qdm-sheet-th--merge-field${fi === 0 ? ' qdm-sheet-th--merge-field-edge' : ''}`}
                          title={`${f.label} — ${f.key}`}
                        >
                          <span className="qdm-th-label">{f.label}</span>
                          <code className="qdm-th-code">{`{{${f.key}}}`}</code>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mergeRows.map((row, idx) => {
                      const selectedIds = rowTemplateIdsForSelect(row, selectedTemplateId, templates);
                      const selectedSet = new Set(selectedIds);
                      return (
                        <tr key={`row-${idx}`}>
                          <td
                            className={`qdm-sheet-td qdm-sheet-td--preset qdm-sheet-td--template qdm-sheet-td--template-dropdown qdm-sheet-td--merge-select${isCellSelected(idx, 0) ? ' qdm-sheet-td--selected' : ''
                              }`}
                            data-merge-sheet-row={idx}
                            data-merge-sheet-col={0}
                            onMouseEnter={() => onSheetCellMouseEnter(idx, 0)}
                            onClick={(e) => onSheetCellClick(e, idx, 0)}
                          >
                            {!templates.length ? (
                              <span className="qdm-sheet-template-checkboxes-empty">—</span>
                            ) : mergeRunning ? (
                              <div
                                className="qdm-sheet-template-dropdown-summary qdm-sheet-template-dropdown-summary--static"
                                title="생성 중에는 양식을 바꿀 수 없습니다."
                              >
                                <span className="qdm-sheet-template-dropdown-summary-text">
                                  {templateDropdownSummaryText(row, selectedTemplateId, templates, templateListFileName)}
                                </span>
                              </div>
                            ) : (
                              <details className="qdm-sheet-template-dropdown" title="펼쳐서 여러 양식을 체크할 수 있습니다.">
                                <summary
                                  className="qdm-sheet-template-dropdown-summary"
                                  aria-label={`${idx + 1}행 사용 양식, 펼치기`}
                                >
                                  <span className="qdm-sheet-template-dropdown-summary-text">
                                    {templateDropdownSummaryText(row, selectedTemplateId, templates, templateListFileName)}
                                  </span>
                                  <span className="material-symbols-outlined qdm-sheet-template-dropdown-chevron" aria-hidden>
                                    expand_more
                                  </span>
                                </summary>
                                <div
                                  className="qdm-sheet-template-dropdown-panel"
                                  role="group"
                                  aria-label={`${idx + 1}행 사용 양식(체크로 여러 개)`}
                                >
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
                                              const ordered = templates
                                                .map((x) => String(x._id))
                                                .filter((tid) => next.has(tid));
                                              onUpdateRowTemplates?.(idx, ordered);
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
                              </details>
                            )}
                          </td>
                          <td
                            className={`qdm-sheet-td qdm-sheet-td--preset qdm-sheet-td--export-merge qdm-sheet-td--template-dropdown qdm-sheet-td--merge-select${isCellSelected(idx, 1) ? ' qdm-sheet-td--selected' : ''
                              }`}
                            data-merge-sheet-row={idx}
                            data-merge-sheet-col={1}
                            onMouseEnter={() => onSheetCellMouseEnter(idx, 1)}
                            onClick={(e) => onSheetCellClick(e, idx, 1)}
                          >
                            {mergeRunning ? (
                              <div
                                className="qdm-sheet-template-dropdown-summary qdm-sheet-template-dropdown-summary--static"
                                title="생성 중에는 바꿀 수 없습니다."
                              >
                                <span className="qdm-sheet-template-dropdown-summary-text">
                                  {exportAddonSummaryText(row)}
                                </span>
                              </div>
                            ) : (
                              <details className="qdm-sheet-template-dropdown qdm-sheet-export-addon-dropdown" title="펼쳐서 PDF 추출 방식을 고릅니다.">
                                <summary
                                  className="qdm-sheet-template-dropdown-summary"
                                  aria-label={`${idx + 1}행 추가 추출, 펼치기`}
                                >
                                  <span className="qdm-sheet-template-dropdown-summary-text">
                                    {exportAddonSummaryText(row)}
                                  </span>
                                  <span className="material-symbols-outlined qdm-sheet-template-dropdown-chevron" aria-hidden>
                                    expand_more
                                  </span>
                                </summary>
                                <div
                                  className="qdm-sheet-template-dropdown-panel"
                                  role="group"
                                  aria-label={`${idx + 1}행 PDF 추출(둘 다 해제 시 양식에 맞게만)`}
                                >
                                  <div className="qdm-sheet-template-checkboxes-scroll qdm-sheet-export-addon-check-scroll">
                                    <label className="qdm-sheet-template-checkbox-row">
                                      <input
                                        type="checkbox"
                                        className="qdm-sheet-template-checkbox"
                                        checked={normalizeRowExportAddonMode(row) === 'pdfAddon'}
                                        onChange={(e) => {
                                          if (e.target.checked) onUpdateRow?.(idx, '_exportAddon', 'pdfAddon');
                                          else onUpdateRow?.(idx, '_exportAddon', 'same');
                                        }}
                                      />
                                      <span className="qdm-sheet-template-checkbox-text">PDF 추가 추출</span>
                                    </label>
                                    <label className="qdm-sheet-template-checkbox-row">
                                      <input
                                        type="checkbox"
                                        className="qdm-sheet-template-checkbox"
                                        checked={normalizeRowExportAddonMode(row) === 'pdfOnly'}
                                        onChange={(e) => {
                                          if (e.target.checked) onUpdateRow?.(idx, '_exportAddon', 'pdfOnly');
                                          else onUpdateRow?.(idx, '_exportAddon', 'same');
                                        }}
                                      />
                                      <span className="qdm-sheet-template-checkbox-text">PDF 만 추출</span>
                                    </label>
                                  </div>
                                </div>
                              </details>
                            )}
                          </td>
                          <td
                            className={`qdm-sheet-td qdm-sheet-td--preset qdm-sheet-td--mail-col qdm-sheet-td--mail-check qdm-sheet-td--merge-select${isCellSelected(idx, 2) ? ' qdm-sheet-td--selected' : ''
                              }`}
                            data-merge-sheet-row={idx}
                            data-merge-sheet-col={2}
                            onMouseEnter={() => onSheetCellMouseEnter(idx, 2)}
                            onClick={(e) => onSheetCellClick(e, idx, 2)}
                          >
                            <div className="qdm-sheet-mail-send-wrap">
                              <button
                                type="button"
                                className="qdm-btn qdm-btn-ghost qdm-btn-small qdm-sheet-mail-send-btn"
                                onClick={() => void onMailtoHandoffRow?.(idx)}
                                disabled={
                                  mergeRunning ||
                                  !templates.length ||
                                  !fields.length ||
                                  typeof onMailtoHandoffRow !== 'function'
                                }
                                title="이 행의「추가 추출」설정대로 파일을 받은 뒤, 받는 사람·참조(CC)·제목·본문으로 메일 작성 창을 엽니다."
                              >
                                <span className="material-symbols-outlined" aria-hidden>
                                  outgoing_mail
                                </span>
                                보내기
                              </button>
                            </div>
                          </td>
                          <td
                            className={`qdm-sheet-td qdm-sheet-td--preset qdm-sheet-td--mail-col qdm-sheet-td--mail-to qdm-sheet-td--mail-input qdm-sheet-td--merge-select${isCellSelected(idx, 3) ? ' qdm-sheet-td--selected' : ''
                              }`}
                            data-merge-sheet-row={idx}
                            data-merge-sheet-col={3}
                            onMouseEnter={() => onSheetCellMouseEnter(idx, 3)}
                            onClick={(e) => onSheetCellClick(e, idx, 3)}
                          >
                            <textarea
                              className="qdm-cell qdm-cell--sheet qdm-cell-sheet-single"
                              rows={1}
                              value={String(row._mailTo ?? '')}
                              onChange={(e) => onUpdateRow?.(idx, '_mailTo', e.target.value)}
                              onPaste={(e) => onMailCellPaste?.(e, idx, 3)}
                              onKeyDown={(e) => onMailCellKeyDown?.(e, idx, 3)}
                              disabled={mergeRunning}
                              placeholder=""
                              autoComplete="off"
                              spellCheck={false}
                              aria-label={`${idx + 1}행 받는 사람`}
                            />
                          </td>
                          <td
                            className={`qdm-sheet-td qdm-sheet-td--preset qdm-sheet-td--mail-col qdm-sheet-td--mail-cc qdm-sheet-td--mail-input qdm-sheet-td--merge-select${isCellSelected(idx, 4) ? ' qdm-sheet-td--selected' : ''
                              }`}
                            data-merge-sheet-row={idx}
                            data-merge-sheet-col={4}
                            onMouseEnter={() => onSheetCellMouseEnter(idx, 4)}
                            onClick={(e) => onSheetCellClick(e, idx, 4)}
                          >
                            <textarea
                              className="qdm-cell qdm-cell--sheet qdm-cell-sheet-single"
                              rows={1}
                              value={String(row._mailCc ?? '')}
                              onChange={(e) => onUpdateRow?.(idx, '_mailCc', e.target.value)}
                              onPaste={(e) => onMailCellPaste?.(e, idx, 4)}
                              onKeyDown={(e) => onMailCellKeyDown?.(e, idx, 4)}
                              disabled={mergeRunning}
                              placeholder=""
                              autoComplete="off"
                              spellCheck={false}
                              aria-label={`${idx + 1}행 참조 CC`}
                            />
                          </td>
                          <td
                            className={`qdm-sheet-td qdm-sheet-td--preset qdm-sheet-td--mail-col qdm-sheet-td--mail-subj qdm-sheet-td--mail-input qdm-sheet-td--merge-select${isCellSelected(idx, 5) ? ' qdm-sheet-td--selected' : ''
                              }`}
                            data-merge-sheet-row={idx}
                            data-merge-sheet-col={5}
                            onMouseEnter={() => onSheetCellMouseEnter(idx, 5)}
                            onClick={(e) => onSheetCellClick(e, idx, 5)}
                          >
                            <textarea
                              className="qdm-cell qdm-cell--sheet qdm-cell-sheet-single"
                              rows={1}
                              value={String(row._mailSubject ?? '')}
                              onChange={(e) => onUpdateRow?.(idx, '_mailSubject', e.target.value)}
                              onPaste={(e) => onMailCellPaste?.(e, idx, 5)}
                              onKeyDown={(e) => onMailCellKeyDown?.(e, idx, 5)}
                              disabled={mergeRunning}
                              placeholder=""
                              spellCheck={false}
                              aria-label={`${idx + 1}행 메일 제목`}
                            />
                          </td>
                          <td
                            className={`qdm-sheet-td qdm-sheet-td--preset qdm-sheet-td--preset-end qdm-sheet-td--mail-col qdm-sheet-td--mail-body qdm-sheet-td--mail-input qdm-sheet-td--merge-select${isCellSelected(idx, 6) ? ' qdm-sheet-td--selected' : ''
                              }`}
                            data-merge-sheet-row={idx}
                            data-merge-sheet-col={6}
                            onMouseEnter={() => onSheetCellMouseEnter(idx, 6)}
                            onClick={(e) => onSheetCellClick(e, idx, 6)}
                          >
                            <textarea
                              className="qdm-cell qdm-cell--sheet qdm-cell-tall"
                              rows={2}
                              value={String(row._mailBody ?? '')}
                              onChange={(e) => onUpdateRow?.(idx, '_mailBody', e.target.value)}
                              onPaste={(e) => onMailCellPaste?.(e, idx, 6)}
                              onKeyDown={(e) => onMailCellKeyDown?.(e, idx, 6)}
                              disabled={mergeRunning}
                              placeholder=""
                              spellCheck={false}
                              aria-label={`${idx + 1}행 메일 본문`}
                            />
                          </td>
                          {fields.map((f, fi) => {
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
            <strong>PDF 추가 추출</strong>·<strong>PDF 만 추출</strong>은 PC가 아니라 <strong>백엔드 서버</strong>에서
            LibreOffice로 변환합니다. Windows에서 백엔드를 돌릴 때는 설치 시 기본 위치를 유지해, 반드시 아래 파일이
            있어야 합니다.{' '}
            <code className="merge-data-sheet-modal-footer-path">C:\Program Files\LibreOffice\program\soffice.exe</code>
            {' '}
            <code className="merge-data-sheet-modal-footer-path">LIBREOFFICE_SOFFICE=전체경로</code> 지정) ·{' '}
            <a
              href="https://www.libreoffice.org/download/"
              target="_blank"
              rel="noopener noreferrer"
              className="merge-data-sheet-modal-footer-link"
            >
              LibreOffice 공식 다운로드
            </a>
            . 운영 사이트(Railway 등 Linux)는 서버에 LibreOffice 패키지 설치가 필요합니다.
          </p>
        </footer>
      </div>
    </div>
  );
}

function isMergeFieldPresetMongoId(v) {
  if (v == null || v === '') return false;
  return /^[a-f0-9]{24}$/i.test(String(v).trim());
}
