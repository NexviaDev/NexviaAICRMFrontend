import { useState, useRef, useCallback, useEffect } from 'react';
import {
  buildTsvFromMatrix,
  isCellInGridSelection,
  normalizeGridSelection,
  parseTsvToMatrix
} from '@/lib/excel-grid-clipboard-utils';

function activeElementHasTextSelection(active) {
  if (!active) return false;
  if (active.tagName === 'TEXTAREA') {
    return (
      typeof active.selectionStart === 'number' &&
      active.selectionEnd != null &&
      active.selectionStart !== active.selectionEnd
    );
  }
  if (active.tagName === 'INPUT') {
    const typ = String(active.type || 'text').toLowerCase();
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
    if (
      textLike &&
      typeof active.selectionStart === 'number' &&
      active.selectionEnd != null &&
      active.selectionStart !== active.selectionEnd
    ) {
      return true;
    }
  }
  return false;
}

function expandPasteMatrixForSelection(matrix, box) {
  if (!matrix?.length || !box) return matrix;
  const selRows = box.endRow - box.startRow + 1;
  const selCols = box.endCol - box.startCol + 1;
  const multiClip = matrix.length > 1 || (matrix[0]?.length ?? 0) > 1;
  const multiSel = selRows > 1 || selCols > 1;
  if (multiClip || !multiSel) return matrix;
  const v = matrix[0]?.[0] ?? '';
  return Array.from({ length: selRows }, () => Array.from({ length: selCols }, () => v));
}

async function writeTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

async function readTextFromClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

/**
 * 엑셀 미리보기 표 — Alt+드래그 선택 + Ctrl+C/V·copy/paste(TSV) + Esc 선택 해제
 */
export function useExcelGridClipboard({
  rowCount = 0,
  colCount = 0,
  disabled = false,
  getCellValue,
  setCellValue,
  isCellEditable,
  sanitizePasteValue
}) {
  const [selection, setSelection] = useState(null);
  const [gridRootEl, setGridRootEl] = useState(null);
  const [isAltDragging, setIsAltDragging] = useState(false);
  const gridRootRef = useRef(null);
  const selectionRef = useRef(null);
  const selectionDragActiveRef = useRef(false);
  const altHeldRef = useRef(false);
  const getCellValueRef = useRef(getCellValue);
  const setCellValueRef = useRef(setCellValue);
  const isCellEditableRef = useRef(isCellEditable);
  const sanitizePasteValueRef = useRef(sanitizePasteValue);
  const rowCountRef = useRef(rowCount);
  const colCountRef = useRef(colCount);
  const disabledRef = useRef(disabled);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    getCellValueRef.current = getCellValue;
    setCellValueRef.current = setCellValue;
    isCellEditableRef.current = isCellEditable;
    sanitizePasteValueRef.current = sanitizePasteValue;
    rowCountRef.current = rowCount;
    colCountRef.current = colCount;
    disabledRef.current = disabled;
  }, [getCellValue, setCellValue, isCellEditable, sanitizePasteValue, rowCount, colCount, disabled]);

  const setGridRef = useCallback((node) => {
    gridRootRef.current = node;
    setGridRootEl(node);
  }, []);

  const isCellSelected = useCallback(
    (row, col) => isCellInGridSelection(row, col, selection),
    [selection]
  );

  const isCellActive = useCallback(
    (row, col) => selection?.start?.row === row && selection?.start?.col === col,
    [selection]
  );

  const clearSelection = useCallback(() => {
    selectionDragActiveRef.current = false;
    setIsAltDragging(false);
    setSelection(null);
  }, []);

  const buildCopyMatrix = useCallback(() => {
    const box = normalizeGridSelection(selectionRef.current?.start, selectionRef.current?.end);
    if (!box || typeof getCellValueRef.current !== 'function') return null;
    const matrix = [];
    for (let r = box.startRow; r <= box.endRow; r += 1) {
      const line = [];
      for (let c = box.startCol; c <= box.endCol; c += 1) {
        if (typeof isCellEditableRef.current === 'function' && !isCellEditableRef.current(r, c)) {
          line.push('');
        } else {
          line.push(getCellValueRef.current(r, c));
        }
      }
      matrix.push(line);
    }
    return matrix;
  }, []);

  const pasteMatrixAtSelection = useCallback((matrix) => {
    const box = normalizeGridSelection(selectionRef.current?.start, selectionRef.current?.end);
    if (!box || disabledRef.current || typeof setCellValueRef.current !== 'function') return false;
    if (!matrix?.length) return false;

    const pasteGrid = expandPasteMatrixForSelection(matrix, box);

    for (let ri = 0; ri < pasteGrid.length; ri += 1) {
      const parts = pasteGrid[ri];
      for (let ci = 0; ci < parts.length; ci += 1) {
        const r = box.startRow + ri;
        const c = box.startCol + ci;
        if (r >= rowCountRef.current || c >= colCountRef.current) continue;
        if (typeof isCellEditableRef.current === 'function' && !isCellEditableRef.current(r, c)) continue;
        const raw = parts[ci];
        const val =
          typeof sanitizePasteValueRef.current === 'function'
            ? sanitizePasteValueRef.current(r, c, raw)
            : raw;
        setCellValueRef.current(r, c, val);
      }
    }
    return true;
  }, []);

  const copySelection = useCallback(async () => {
    const matrix = buildCopyMatrix();
    if (!matrix) return false;
    return writeTextToClipboard(buildTsvFromMatrix(matrix));
  }, [buildCopyMatrix]);

  const pasteAtSelection = useCallback(
    async (textOverride) => {
      if (!selectionRef.current) return false;
      let text = textOverride;
      if (text == null) {
        text = await readTextFromClipboard();
        if (text == null) return false;
      }
      const matrix = parseTsvToMatrix(text);
      if (!matrix.length) return false;
      return pasteMatrixAtSelection(matrix);
    },
    [pasteMatrixAtSelection]
  );

  const isAltModifierActive = useCallback((e) => {
    if (e.altKey) return true;
    return altHeldRef.current;
  }, []);

  /** Alt 키 상태 추적 — Windows에서 mousedown.altKey가 빠지는 경우 보완 */
  useEffect(() => {
    const syncAlt = (e) => {
      altHeldRef.current = Boolean(e.altKey);
    };
    const onBlur = () => {
      altHeldRef.current = false;
    };
    window.addEventListener('keydown', syncAlt, true);
    window.addEventListener('keyup', syncAlt, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', syncAlt, true);
      window.removeEventListener('keyup', syncAlt, true);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  /** 표 안에서 Alt 키 — 이전 선택 해제(새 Alt+드래그만 보이게) */
  useEffect(() => {
    if (disabled || !gridRootEl) return undefined;
    const onAltKeyDown = (e) => {
      if (!e.altKey || e.repeat) return;
      if (e.code !== 'AltLeft' && e.code !== 'AltRight') return;
      const t = e.target;
      if (!t || typeof t.closest !== 'function' || !gridRootEl.contains(t)) return;
      clearSelection();
    };
    window.addEventListener('keydown', onAltKeyDown, true);
    return () => window.removeEventListener('keydown', onAltKeyDown, true);
  }, [disabled, gridRootEl, clearSelection]);

  /** Alt+드래그 — input/select 위에서도 캡처 단계에서 범위 선택 */
  useEffect(() => {
    if (disabled || !gridRootEl || colCount < 1) return undefined;

    const onDownCap = (e) => {
      if (e.button !== 0 || !isAltModifierActive(e)) return;
      const td = e.target.closest?.('td[data-grid-row][data-grid-col]');
      if (!td || !gridRootEl.contains(td)) return;

      const row = Number(td.getAttribute('data-grid-row'));
      const col = Number(td.getAttribute('data-grid-col'));
      if (Number.isNaN(row) || Number.isNaN(col)) return;

      if (e.target.closest?.('input, textarea, select, button')) {
        e.preventDefault();
      }
      e.preventDefault();
      e.stopPropagation();

      selectionDragActiveRef.current = true;
      setIsAltDragging(true);
      setSelection({ start: { row, col }, end: { row, col } });

      const onMove = (ev) => {
        if (!selectionDragActiveRef.current) return;
        ev.preventDefault();
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const t2 =
          hit && typeof hit.closest === 'function'
            ? hit.closest('td[data-grid-row][data-grid-col]')
            : null;
        if (!t2 || !gridRootEl.contains(t2)) return;
        const r = Number(t2.getAttribute('data-grid-row'));
        const c = Number(t2.getAttribute('data-grid-col'));
        if (Number.isNaN(r) || Number.isNaN(c)) return;
        setSelection((prev) => (prev ? { start: prev.start, end: { row: r, col: c } } : null));
      };

      const onUp = () => {
        selectionDragActiveRef.current = false;
        setIsAltDragging(false);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

    gridRootEl.addEventListener('mousedown', onDownCap, true);
    return () => gridRootEl.removeEventListener('mousedown', onDownCap, true);
  }, [disabled, gridRootEl, colCount, rowCount, isAltModifierActive]);

  const shouldHandleGridClipboard = useCallback((active) => {
    if (!selectionRef.current || !gridRootRef.current) return false;
    if (active && activeElementHasTextSelection(active)) return false;
    if (!active || active === document.body) return true;
    return gridRootRef.current.contains(active);
  }, []);

  /** copy / paste 이벤트(캡처) */
  useEffect(() => {
    if (disabled || !gridRootEl) return undefined;

    const onCopy = (e) => {
      const active = document.activeElement;
      if (!shouldHandleGridClipboard(active)) return;
      const matrix = buildCopyMatrix();
      if (!matrix) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', buildTsvFromMatrix(matrix));
    };

    const onPaste = (e) => {
      if (disabledRef.current) return;
      const active = document.activeElement;
      if (!shouldHandleGridClipboard(active)) return;
      const text = e.clipboardData?.getData('text/plain');
      if (text == null || text === '') return;
      const matrix = parseTsvToMatrix(text);
      if (!matrix.length) return;
      e.preventDefault();
      pasteMatrixAtSelection(matrix);
    };

    document.addEventListener('copy', onCopy, true);
    document.addEventListener('paste', onPaste, true);
    return () => {
      document.removeEventListener('copy', onCopy, true);
      document.removeEventListener('paste', onPaste, true);
    };
  }, [disabled, gridRootEl, buildCopyMatrix, pasteMatrixAtSelection, shouldHandleGridClipboard]);

  /** Esc · Ctrl+C/V (select 포커스 등 copy/paste 이벤트가 안 먹을 때) */
  useEffect(() => {
    const onKeyDown = (e) => {
      if (disabledRef.current) return;

      if (e.key === 'Escape') {
        if (!selectionRef.current) return;
        e.preventDefault();
        clearSelection();
        return;
      }

      if (!selectionRef.current) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      const active = document.activeElement;
      if (active && activeElementHasTextSelection(active)) return;
      if (active && gridRootRef.current && !gridRootRef.current.contains(active)) return;

      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        void copySelection();
      }
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        void pasteAtSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [clearSelection, copySelection, pasteAtSelection]);

  return {
    tableRef: setGridRef,
    gridRootRef: setGridRef,
    selection,
    isCellSelected,
    isCellActive,
    isAltDragging,
    clearSelection
  };
}
