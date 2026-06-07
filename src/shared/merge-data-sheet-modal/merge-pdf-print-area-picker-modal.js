import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pingBackendHealth } from '@/lib/backend-wake';
import { getUserVisibleApiError } from '@/lib/api-error';
import {
  formatPrintAreaSelectionsSummary,
  legacyPrintAreaToSelections,
  newPrintAreaSelectionId,
  normalizePrintAreaSelections,
  printSheetNamesFromSelections,
  renumberPrintAreaSelectionPages
} from '@/lib/merge-pdf-print-area-selections';
import {
  gridSelectionToPrintArea,
  listXlsxSheetNames,
  parseXlsxSheetToDisplayGrid,
  columnIndexToLetters,
  printAreaToGridSelection
} from '@/lib/merge-template-xlsx-grid';
import './merge-pdf-print-area-picker-modal.css';

const SEL_PALETTE = ['#dbeafe', '#dcfce7', '#fce7f3', '#fef3c7', '#e0e7ff', '#ccfbf1'];

function normalizeDragSel(anchor, end) {
  if (anchor == null || end == null) return null;
  return {
    r1: Math.min(anchor.r, end.r),
    r2: Math.max(anchor.r, end.r),
    c1: Math.min(anchor.c, end.c),
    c2: Math.max(anchor.c, end.c)
  };
}

function isXlsxFile(file) {
  return file && /\.xlsx$/i.test(String(file.name || ''));
}

function reorderSelectionsById(list, draggedId, dropTargetId) {
  const fromIdx = list.findIndex((s) => s.id === draggedId);
  const toIdx = list.findIndex((s) => s.id === dropTargetId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return list;
  const next = [...list];
  const [item] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, item);
  return renumberPrintAreaSelectionPages(next);
}

export default function MergePdfPrintAreaPickerModal({
  open,
  onClose,
  apiBase,
  mergeApiPrefix = '/quotation-merge',
  getAuthHeader,
  templateId,
  templateName,
  /** 등록 전: 서버 templateId 없이 로컬 xlsx File 로 그리드 표시 */
  localXlsxFile = null,
  initialPrintArea,
  initialSheetName,
  initialPrintAreaSelections,
  onApply
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sheetNames, setSheetNames] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [gridMeta, setGridMeta] = useState(null);
  const [cells, setCells] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const [end, setEnd] = useState(null);
  const [dragging, setDragging] = useState(false);
  const anchorRef = useRef(null);
  const [selections, setSelections] = useState([]);
  const [pageOrderDraft, setPageOrderDraft] = useState(1);
  const gridRef = useRef(null);
  const workbookBufRef = useRef(null);
  const [listDraggingId, setListDraggingId] = useState(null);
  const [listDragOverId, setListDragOverId] = useState(null);
  const listDraggedIdRef = useRef(null);

  const loadSheetGrid = useCallback((buf, sheetName) => {
    const parsed = parseXlsxSheetToDisplayGrid(buf, sheetName);
    setCells(parsed.cells);
    setGridMeta(parsed);
    setTruncated(parsed.truncated);
    setSelectedSheet(parsed.sheetName);
    setAnchor(null);
    setEnd(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const useLocal = !templateId && isXlsxFile(localXlsxFile);
    if (!templateId && !useLocal) return;

    let cancelled = false;
    workbookBufRef.current = null;
    const fromList = normalizePrintAreaSelections(initialPrintAreaSelections);
    const seed =
      fromList.length > 0
        ? fromList
        : legacyPrintAreaToSelections(initialPrintArea, initialSheetName);
    setSelections(renumberPrintAreaSelectionPages(seed));
    setPageOrderDraft(Math.max(1, seed.length + 1));

    const applyWorkbookBuffer = (buf) => {
      if (cancelled) return;
      workbookBufRef.current = buf;
      const names = listXlsxSheetNames(buf);
      setSheetNames(names);
      const prefer =
        initialSheetName && names.includes(initialSheetName)
          ? initialSheetName
          : seed[0]?.sheetName && names.includes(seed[0].sheetName)
            ? seed[0].sheetName
            : names[0] || '';
      loadSheetGrid(buf, prefer);
    };

    (async () => {
      setLoading(true);
      setError('');
      setSheetNames([]);
      setAnchor(null);
      setEnd(null);
      try {
        let buf;
        if (useLocal) {
          buf = await localXlsxFile.arrayBuffer();
        } else {
          await pingBackendHealth();
          const res = await fetch(`${apiBase}${mergeApiPrefix}/templates/${templateId}/download`, {
            headers: { ...getAuthHeader() },
            credentials: 'include'
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(getUserVisibleApiError(data, '양식을 불러오지 못했습니다.'));
          }
          buf = await res.arrayBuffer();
        }
        applyWorkbookBuffer(buf);
      } catch (e) {
        if (!cancelled) setError(e?.message || '양식을 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    templateId,
    localXlsxFile,
    apiBase,
    mergeApiPrefix,
    getAuthHeader,
    initialSheetName,
    initialPrintArea,
    initialPrintAreaSelections,
    loadSheetGrid
  ]);

  const onSheetChange = (name) => {
    if (!workbookBufRef.current || !name) return;
    loadSheetGrid(workbookBufRef.current, name);
  };

  const pendingSelection = useMemo(() => normalizeDragSel(anchor, end), [anchor, end]);

  const pendingPrintArea =
    pendingSelection && gridMeta ? gridSelectionToPrintArea(pendingSelection, gridMeta) : '';

  const currentSheetSelections = useMemo(
    () => selections.filter((s) => s.sheetName === selectedSheet),
    [selections, selectedSheet]
  );

  const highlightLayers = useMemo(() => {
    if (!gridMeta || !selectedSheet) return [];
    const layers = [];
    currentSheetSelections.forEach((item, idx) => {
      const sel = printAreaToGridSelection(item.printArea, gridMeta);
      if (sel) layers.push({ sel, tone: idx % SEL_PALETTE.length });
    });
    if (pendingSelection) {
      layers.push({ sel: pendingSelection, tone: 'pending' });
    }
    return layers;
  }, [currentSheetSelections, pendingSelection, gridMeta, selectedSheet]);

  const cellHighlightStyle = useCallback(
    (ri, ci) => {
      for (const layer of highlightLayers) {
        const { sel, tone } = layer;
        if (ri >= sel.r1 && ri <= sel.r2 && ci >= sel.c1 && ci <= sel.c2) {
          if (tone === 'pending') {
            return { background: '#bfdbfe', boxShadow: 'inset 0 0 0 1px #3b82f6' };
          }
          return {
            background: SEL_PALETTE[tone] || SEL_PALETTE[0],
            boxShadow: 'inset 0 0 0 1px #93c5fd'
          };
        }
      }
      return null;
    },
    [highlightLayers]
  );

  const cellFromEvent = (e) => {
    const td = e.target.closest('[data-grid-r][data-grid-c]');
    if (!td || !gridRef.current?.contains(td)) return null;
    return { r: Number(td.dataset.gridR), c: Number(td.dataset.gridC) };
  };

  useEffect(() => {
    anchorRef.current = anchor;
  }, [anchor]);

  const applyCellSelection = (cell, extendWithShift) => {
    if (!cell) return;
    if (extendWithShift && anchorRef.current) {
      setEnd(cell);
    } else {
      setAnchor(cell);
      setEnd(cell);
      anchorRef.current = cell;
    }
  };

  const onCellMouseDown = (e, cell) => {
    if (loading || e.button !== 0) return;
    e.preventDefault();
    applyCellSelection(cell, e.shiftKey);
    if (!e.shiftKey) setDragging(true);
  };

  const onGridMouseDown = (e) => {
    const cell = cellFromEvent(e);
    if (!cell) return;
    onCellMouseDown(e, cell);
  };

  const onMouseMove = (e) => {
    if (!dragging) return;
    const cell = cellFromEvent(e);
    if (cell) setEnd(cell);
  };

  const onMouseUp = () => setDragging(false);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [dragging]);

  const addPendingToList = () => {
    if (!pendingPrintArea || !selectedSheet) {
      window.alert('인쇄할 범위를 선택해 주세요. (셀 클릭 → Shift+셀 클릭 또는 드래그)');
      return;
    }
    setSelections((prev) => {
      const next = renumberPrintAreaSelectionPages([
        ...prev,
        {
          id: newPrintAreaSelectionId(),
          sheetName: selectedSheet,
          printArea: pendingPrintArea,
          printPageMode: 'custom',
          printPageFrom: prev.length + 1,
          printPageTo: prev.length + 1
        }
      ]);
      setPageOrderDraft(next.length + 1);
      return next;
    });
    setAnchor(null);
    setEnd(null);
  };

  const removeSelection = (id) => {
    setSelections((prev) => {
      const next = renumberPrintAreaSelectionPages(prev.filter((s) => s.id !== id));
      setPageOrderDraft(Math.max(1, next.length + 1));
      return next;
    });
  };

  const handleListDragEnd = useCallback(() => {
    listDraggedIdRef.current = null;
    setListDraggingId(null);
    setListDragOverId(null);
  }, []);

  const handleListDragStart = useCallback((e, id) => {
    e.stopPropagation();
    listDraggedIdRef.current = id;
    setListDraggingId(id);
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleListRowDragOver = useCallback(
    (e, id) => {
      if (!listDraggedIdRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (id !== listDraggingId) setListDragOverId(id);
    },
    [listDraggingId]
  );

  const handleListRowDrop = useCallback(
    (e, dropTargetId) => {
      const dragged = listDraggedIdRef.current;
      if (!dragged) return;
      e.preventDefault();
      e.stopPropagation();
      if (dragged && dropTargetId && dragged !== dropTargetId) {
        setSelections((prev) => reorderSelectionsById(prev, dragged, dropTargetId));
      }
      handleListDragEnd();
    },
    [handleListDragEnd]
  );

  const handleListDragLeave = useCallback((ev) => {
    if (!ev.currentTarget.contains(ev.relatedTarget)) setListDragOverId(null);
  }, []);

  const focusSelectionOnGrid = (item) => {
    if (!workbookBufRef.current || !item?.sheetName) return;
    if (item.sheetName !== selectedSheet) {
      loadSheetGrid(workbookBufRef.current, item.sheetName);
    }
    const meta = gridMeta;
    if (!meta || meta.sheetName !== item.sheetName) return;
    const sel = printAreaToGridSelection(item.printArea, meta);
    if (sel) {
      setAnchor({ r: sel.r1, c: sel.c1 });
      setEnd({ r: sel.r2, c: sel.c2 });
    }
  };

  const handleApply = () => {
    const list = renumberPrintAreaSelectionPages(selections);
    if (!list.length) {
      window.alert('인쇄 영역을 하나 이상 추가해 주세요. (범위 선택 후 「목록에 추가」)');
      return;
    }
    const names = printSheetNamesFromSelections(list);
    const printArea = list.map((s) => s.printArea).join(',');
    onApply?.({
      printArea,
      printSheetNames: names,
      printSheetName: names[0] || '',
      printAreaSelections: list
    });
    onClose?.();
  };

  if (!open) return null;

  return (
    <div
      className="merge-pdf-area-picker-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-pdf-area-picker-title"
    >
      <button type="button" className="merge-pdf-area-picker-backdrop" aria-label="닫기" onClick={onClose} />
      <div className="merge-pdf-area-picker-panel">
        <header className="merge-pdf-area-picker-head">
          <h2 id="merge-pdf-area-picker-title" className="merge-pdf-area-picker-title">
            양식에서 인쇄 영역 선택
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined" aria-hidden>
              close
            </span>
          </button>
        </header>
        <div className="merge-pdf-area-picker-body">
        <p className="merge-pdf-area-picker-desc">
          Excel처럼 <strong>첫 셀 클릭</strong> 후 <strong>Shift+마지막 셀 클릭</strong>으로 범위를 잡을 수 있습니다.
          드래그도 가능합니다. 영역을 추가한 뒤 목록에서 <strong>드래그</strong>로 PDF 페이지 순서를 정합니다.
          목록에 추가한 영역마다 <strong>PDF 페이지가 1장씩</strong> 나뉩니다(한 페이지에 좌우로 붙지 않음).
          {templateName ? (
            <>
              {' '}
              양식: <strong>{templateName}</strong>
            </>
          ) : null}
        </p>
        {sheetNames.length > 1 ? (
          <label className="merge-pdf-area-picker-sheet-row">
            <span className="merge-pdf-area-picker-sheet-label">시트</span>
            <select
              className="qdm-select merge-pdf-area-picker-sheet-select"
              value={selectedSheet}
              onChange={(e) => onSheetChange(e.target.value)}
              disabled={loading}
            >
              {sheetNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                  {selections.some((s) => s.sheetName === n)
                    ? ` (${selections.filter((s) => s.sheetName === n).length}개 영역)`
                    : ''}
                </option>
              ))}
            </select>
          </label>
        ) : selectedSheet ? (
          <p className="merge-pdf-area-picker-sheet-single" role="note">
            시트: <strong>{selectedSheet}</strong>
          </p>
        ) : null}
        {loading ? (
          <div className="merge-pdf-area-picker-loading" role="status" aria-live="polite">
            <span className="merge-pdf-spinner" aria-hidden />
            <span>양식을 불러오는 중…</span>
          </div>
        ) : null}
        {error ? (
          <p className="merge-pdf-area-picker-error" role="alert">
            {error}
          </p>
        ) : null}
        {!loading && !error && cells.length ? (
          <>
            {truncated ? (
              <p className="merge-pdf-area-picker-trunc" role="note">
                앞쪽 {cells[0]?.length || 0}열 × {cells.length}행만 미리보기합니다. 적용 주소는 Excel과 동일합니다.
              </p>
            ) : null}
            <div
              className="merge-pdf-area-picker-scroll"
              ref={gridRef}
              onMouseDown={onGridMouseDown}
              onMouseMove={onMouseMove}
            >
              <table className="merge-pdf-area-picker-grid">
                <thead>
                  <tr>
                    <th className="merge-pdf-area-picker-corner" />
                    {cells[0].map((_, ci) => (
                      <th key={ci} className="merge-pdf-area-picker-col-head">
                        {columnIndexToLetters((gridMeta?.sheetCol0 || 0) + ci)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cells.map((row, ri) => (
                    <tr key={ri}>
                      <th className="merge-pdf-area-picker-row-head">{(gridMeta?.sheetRow0 || 0) + ri + 1}</th>
                      {row.map((text, ci) => {
                        const hi = cellHighlightStyle(ri, ci);
                        return (
                          <td
                            key={ci}
                            data-grid-r={ri}
                            data-grid-c={ci}
                            className={hi ? 'merge-pdf-area-picker-cell--sel' : ''}
                            style={hi || undefined}
                            title={text}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              onCellMouseDown(e, { r: ri, c: ci });
                            }}
                          >
                            <span className="merge-pdf-area-picker-cell-text">{text}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="merge-pdf-area-picker-pending" role="region" aria-label="현재 드래그 선택">
              <p className="merge-pdf-area-picker-sel" role="status">
                선택 범위: <strong>{pendingPrintArea || '—'}</strong>
                {selectedSheet ? (
                  <>
                    {' '}
                    · 시트 <strong>{selectedSheet}</strong>
                  </>
                ) : null}
              </p>
              <label className="merge-pdf-area-picker-page-field merge-pdf-area-picker-page-order">
                <span>PDF 페이지 순서</span>
                <input
                  type="number"
                  className="qdm-cell merge-pdf-area-picker-page-input"
                  min={1}
                  value={pageOrderDraft}
                  onChange={(e) => setPageOrderDraft(e.target.value)}
                  title="목록에 넣은 뒤 드래그로 순서를 바꿀 수 있습니다"
                />
              </label>
              <button
                type="button"
                className="qdm-btn qdm-btn-ghost merge-pdf-area-picker-add-btn"
                onClick={addPendingToList}
                disabled={!pendingPrintArea}
              >
                목록에 추가
              </button>
            </div>
            {selections.length ? (
              <div className="merge-pdf-area-picker-list-wrap" role="region" aria-label="추가된 인쇄 영역">
                <p className="merge-pdf-area-picker-list-title">
                  PDF 페이지 순서 (위→아래, 드래그로 변경) · 영역 <strong>{selections.length}</strong>개
                  {formatPrintAreaSelectionsSummary(selections)
                    ? ` · ${formatPrintAreaSelectionsSummary(selections)}`
                    : ''}
                </p>
                <ul className="merge-pdf-area-picker-list" onDragLeave={handleListDragLeave}>
                  {selections.map((item, i) => {
                    const isDragging = listDraggingId === item.id;
                    const isOver = listDragOverId === item.id;
                    return (
                    <li
                      key={item.id}
                      className={`merge-pdf-area-picker-list-item${isDragging ? ' merge-pdf-area-picker-list-item--dragging' : ''}${isOver ? ' merge-pdf-area-picker-list-item--drag-over' : ''}`}
                      onDragOver={(e) => handleListRowDragOver(e, item.id)}
                      onDrop={(e) => handleListRowDrop(e, item.id)}
                    >
                      <span
                        className="merge-pdf-area-picker-list-drag"
                        draggable
                        onDragStart={(e) => handleListDragStart(e, item.id)}
                        onDragEnd={handleListDragEnd}
                        title="드래그하여 PDF 페이지 순서 변경"
                        aria-label={`${i + 1}번 영역 순서 변경`}
                      >
                        <span className="material-symbols-outlined" aria-hidden>
                          drag_indicator
                        </span>
                      </span>
                      <button
                        type="button"
                        className="merge-pdf-area-picker-list-main"
                        onClick={() => focusSelectionOnGrid(item)}
                        title="클릭하면 해당 시트·범위로 이동"
                      >
                        <span className="merge-pdf-area-picker-list-idx">{i + 1}</span>
                        <span className="merge-pdf-area-picker-list-sheet">{item.sheetName}</span>
                        <span className="merge-pdf-area-picker-list-area">{item.printArea}</span>
                        <span className="merge-pdf-area-picker-list-page">
                          PDF {item.printPageFrom || i + 1}페이지
                        </span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn merge-pdf-area-picker-list-del"
                        onClick={() => removeSelection(item.id)}
                        aria-label={`${i + 1}번 영역 삭제`}
                      >
                        <span className="material-symbols-outlined" aria-hidden>
                          delete
                        </span>
                      </button>
                    </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <p className="merge-pdf-area-picker-list-empty" role="note">
                셀을 클릭한 뒤 Shift+클릭(또는 드래그)으로 범위를 고르고 「목록에 추가」를 누르세요.
              </p>
            )}
          </>
        ) : null}
        </div>
        <footer className="merge-pdf-area-picker-foot">
          <button type="button" className="qdm-btn qdm-btn-ghost" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleApply}
            disabled={loading || !selections.length}
          >
            {selections.length ? `${selections.length}개 영역 적용` : '영역 적용'}
          </button>
        </footer>
      </div>
    </div>
  );
}