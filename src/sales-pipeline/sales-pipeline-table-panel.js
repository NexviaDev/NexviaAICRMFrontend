import { useState, useMemo, useCallback, useRef, useLayoutEffect, useEffect } from 'react';
import {
  fetchSalesOpportunityScheduleFieldContext,
  SALES_OPPORTUNITY_SCHEDULE_DEFS_CHANGED
} from '@/lib/sales-opportunity-schedule-labels';
import {
  fetchSalesOpportunityFinanceFieldContext,
  SALES_OPPORTUNITY_FINANCE_DEFS_CHANGED
} from '@/lib/sales-opportunity-finance-labels';
import { listColumnValueInlineStyle } from '@/lib/list-column-cell-styles';
import { usePipelineStageLabelMap, resolvePipelineStageLabel } from './pipeline-stage-labels';
import {
  formatSummaryRowCell,
  formatChildRowCell,
  formatCellValue,
  columnHeaderLabel,
  buildFlatDisplayRows,
  applyColumnFiltersPipeline,
  applyColumnFiltersExceptPipeline,
  compareOppsForSortPipeline,
  formatTotalsAggregateForColumnPipeline,
  collectColumnFilterCandidates,
  FILTER_VALUE_EMPTY,
  filterValueDisplay,
  reorderColumnKeysAt,
  DZ_COL_DRAG_MIME,
  DZ_COL_MIN_WIDTH_DATA_PX,
  DZ_COL_MIN_WIDTH_ROWNUM_PX
} from './drop-zone-list-modal/drop-zone-list-modal';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const PIPELINE_TABLE_ADMIN_ONLY_KEYS = new Set([
  'value',
  'contractAmount',
  'invoiceAmount',
  '__dz_net_margin',
  '__dz_forecast_expected',
  'unitPrice',
  'discountValue',
  'discountAmount',
  'productListPriceSnapshot',
  'productCostPriceSnapshot',
  'productChannelPriceSnapshot',
  'collectionEntries'
]);

function pipelineFlatRowCellText(colKey, flatRow, fpMap, stageLabels, canViewAdmin) {
  const opp = flatRow.opp;
  const fp = fpMap[opp.stage];
  if (!canViewAdmin && PIPELINE_TABLE_ADMIN_ONLY_KEYS.has(colKey)) return '—';
  if (colKey === 'stage') {
    if (flatRow.kind === 'line') return '';
    return resolvePipelineStageLabel(opp.stage, stageLabels);
  }
  if (flatRow.kind === 'summary') return formatSummaryRowCell(colKey, opp, fp);
  if (flatRow.kind === 'line') return formatChildRowCell(colKey, flatRow.line);
  return formatCellValue(colKey, opp, fp);
}

/**
 * 파이프라인 표 보기 — 드롭존 목록과 동일: 행 번호(1·1.1·1.2), 열 필터·정렬, 합계, colgroup 너비.
 */
export default function SalesPipelineTablePanel({
  allOpportunities,
  pipelineListTemplate,
  displayColumnKeys,
  stageForecastPercent,
  stageLabels: stageLabelsProp,
  canViewAdminContent,
  onOpenEdit,
  onDragStart,
  onDragEnd,
  onSaveColumnOrder
}) {
  const { stageLabelMap: stageLabelsFromApi } = usePipelineStageLabelMap(getAuthHeader);
  const stageLabels = useMemo(
    () => ({ ...stageLabelsFromApi, ...(stageLabelsProp && typeof stageLabelsProp === 'object' ? stageLabelsProp : {}) }),
    [stageLabelsFromApi, stageLabelsProp]
  );
  const [sortState, setSortState] = useState({ key: null, dir: null });
  const [columnFilters, setColumnFilters] = useState({});
  const [openFilterCol, setOpenFilterCol] = useState(null);
  const [colFilterSearch, setColFilterSearch] = useState('');
  const filterPopoverRef = useRef(null);
  const columnReorderBusyRef = useRef(false);
  const dataTableRef = useRef(null);
  const [measuredColWidths, setMeasuredColWidths] = useState(null);
  const [scheduleFieldLabelByKey, setScheduleFieldLabelByKey] = useState({});
  const [financeFieldLabelByKey, setFinanceFieldLabelByKey] = useState({});
  const columnCellStyles = pipelineListTemplate?.columnCellStyles || {};

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const ctx = await fetchSalesOpportunityScheduleFieldContext(getAuthHeader);
      if (!cancelled) setScheduleFieldLabelByKey(ctx.labelByKey);
    };
    void load();
    const onDefs = () => {
      void load();
    };
    window.addEventListener(SALES_OPPORTUNITY_SCHEDULE_DEFS_CHANGED, onDefs);
    return () => {
      cancelled = true;
      window.removeEventListener(SALES_OPPORTUNITY_SCHEDULE_DEFS_CHANGED, onDefs);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const ctx = await fetchSalesOpportunityFinanceFieldContext(getAuthHeader);
      if (!cancelled) setFinanceFieldLabelByKey(ctx.labelByKey);
    };
    void load();
    const onDefs = () => {
      void load();
    };
    window.addEventListener(SALES_OPPORTUNITY_FINANCE_DEFS_CHANGED, onDefs);
    return () => {
      cancelled = true;
      window.removeEventListener(SALES_OPPORTUNITY_FINANCE_DEFS_CHANGED, onDefs);
    };
  }, []);

  useEffect(() => {
    if (!openFilterCol) return;
    const onDown = (e) => {
      const el = filterPopoverRef.current;
      if (el && !el.contains(e.target)) {
        setOpenFilterCol(null);
        setColFilterSearch('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openFilterCol]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && openFilterCol) {
        setOpenFilterCol(null);
        setColFilterSearch('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openFilterCol]);

  const filteredByColumns = useMemo(
    () => applyColumnFiltersPipeline(allOpportunities, columnFilters, stageForecastPercent),
    [allOpportunities, columnFilters, stageForecastPercent]
  );

  const sortedFiltered = useMemo(() => {
    const { key, dir } = sortState;
    if (!key || !dir) return filteredByColumns;
    const arr = [...filteredByColumns];
    arr.sort((a, b) => compareOppsForSortPipeline(a, b, key, dir, stageForecastPercent));
    return arr;
  }, [filteredByColumns, sortState, stageForecastPercent]);

  const displayRows = useMemo(() => buildFlatDisplayRows(sortedFiltered), [sortedFiltered]);

  const rowsForFilterOptions = useMemo(
    () =>
      openFilterCol
        ? applyColumnFiltersExceptPipeline(allOpportunities, columnFilters, stageForecastPercent, openFilterCol)
        : [],
    [openFilterCol, allOpportunities, columnFilters, stageForecastPercent]
  );

  const filterUniqueOptions = useMemo(() => {
    if (!openFilterCol) return [];
    const uniq = new Set();
    for (const opp of rowsForFilterOptions) {
      const fp = stageForecastPercent[opp.stage];
      for (const c of collectColumnFilterCandidates(openFilterCol, opp, fp)) {
        uniq.add(c);
      }
    }
    return Array.from(uniq).sort((a, b) => {
      if (a === FILTER_VALUE_EMPTY) return -1;
      if (b === FILTER_VALUE_EMPTY) return 1;
      return String(a).localeCompare(String(b), 'ko', { numeric: true });
    });
  }, [openFilterCol, rowsForFilterOptions, stageForecastPercent]);

  const filterUniqueForUi = useMemo(() => {
    const q = colFilterSearch.trim().toLowerCase();
    if (!q) return filterUniqueOptions;
    return filterUniqueOptions.filter((k) => {
      const label = filterValueDisplay(k, openFilterCol, stageLabels);
      return label.toLowerCase().includes(q) || String(k).toLowerCase().includes(q);
    });
  }, [filterUniqueOptions, colFilterSearch, openFilterCol, stageLabels]);

  const totalsByColumn = useMemo(() => {
    const out = {};
    for (const colKey of displayColumnKeys) {
      out[colKey] = formatTotalsAggregateForColumnPipeline(
        colKey,
        sortedFiltered,
        stageForecastPercent,
        canViewAdminContent
      );
    }
    return out;
  }, [displayColumnKeys, sortedFiltered, stageForecastPercent, canViewAdminContent]);

  const labelForCol = useCallback(
    (k) => columnHeaderLabel(k, scheduleFieldLabelByKey, financeFieldLabelByKey),
    [scheduleFieldLabelByKey, financeFieldLabelByKey]
  );

  const measureTableColWidths = useCallback(() => {
    const table = dataTableRef.current;
    if (!table) return;
    const tr = table.querySelector('thead tr');
    if (!tr) return;
    const cells = tr.querySelectorAll('th');
    if (cells.length === 0) return;
    const widths = Array.from(cells).map((th, i) => {
      const raw = Math.round(th.getBoundingClientRect().width);
      if (i === 0) return Math.max(DZ_COL_MIN_WIDTH_ROWNUM_PX, raw);
      return Math.max(DZ_COL_MIN_WIDTH_DATA_PX, raw);
    });
    const bodyRows = table.querySelectorAll('tbody tr:not(.sp-pl-table__row--filter-empty)');
    for (const row of bodyRows) {
      const tds = row.querySelectorAll('td');
      const n = Math.min(widths.length, tds.length);
      for (let i = 0; i < n; i += 1) {
        const td = tds[i];
        const contentNeed = Math.ceil(td.scrollWidth);
        widths[i] = Math.max(widths[i], contentNeed);
      }
    }
    setMeasuredColWidths((prev) => {
      if (prev && prev.length === widths.length && prev.every((w, i) => w === widths[i])) return prev;
      return widths;
    });
  }, []);

  const displayKeysSig = useMemo(() => displayColumnKeys.join('\0'), [displayColumnKeys]);

  useLayoutEffect(() => {
    setMeasuredColWidths(null);
  }, [displayKeysSig]);

  useLayoutEffect(() => {
    measureTableColWidths();
    const t = window.setTimeout(measureTableColWidths, 0);
    const table = dataTableRef.current;
    let ro;
    if (table && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measureTableColWidths());
      ro.observe(table);
    }
    window.addEventListener('resize', measureTableColWidths);
    return () => {
      clearTimeout(t);
      ro?.disconnect();
      window.removeEventListener('resize', measureTableColWidths);
    };
  }, [measureTableColWidths, displayKeysSig, allOpportunities.length, displayRows.length, sortedFiltered.length]);

  const dataTableFixedStyle = useMemo(() => {
    if (!measuredColWidths?.length) return undefined;
    const w = measuredColWidths.reduce((a, b) => a + b, 0);
    return { tableLayout: 'fixed', width: w };
  }, [measuredColWidths]);

  const setSortForColumn = useCallback((colKey, dir) => {
    if (dir == null) setSortState({ key: null, dir: null });
    else setSortState({ key: colKey, dir });
  }, []);

  const handleColumnFilterMasterToggle = useCallback((colKey, allOptions) => {
    const full = allOptions || [];
    if (full.length === 0) return;
    setColumnFilters((prev) => {
      const cur = prev[colKey];
      const allOn =
        cur == null || (Array.isArray(cur) && cur.length === full.length && full.length > 0);
      if (allOn) {
        return { ...prev, [colKey]: [] };
      }
      const next = { ...prev };
      delete next[colKey];
      return next;
    });
  }, []);

  const toggleColumnFilterValue = useCallback((colKey, valueKey, allOptions) => {
    setColumnFilters((prev) => {
      const cur = prev[colKey];
      const full = [...allOptions];
      let nextArr;
      if (cur == null) {
        nextArr = full.filter((x) => x !== valueKey);
      } else {
        const set = new Set(cur);
        if (set.has(valueKey)) set.delete(valueKey);
        else set.add(valueKey);
        nextArr = Array.from(set);
      }
      if (nextArr.length === full.length) {
        const next = { ...prev };
        delete next[colKey];
        return next;
      }
      return { ...prev, [colKey]: nextArr };
    });
  }, []);

  const clearAllColumnFilters = useCallback(() => {
    setColumnFilters({});
    setOpenFilterCol(null);
    setColFilterSearch('');
  }, []);

  const openColumnFilter = useCallback((colKey) => {
    setOpenFilterCol((c) => (c === colKey ? null : colKey));
    setColFilterSearch('');
  }, []);

  const handleColumnHeaderDragStart = useCallback((e, colIdx) => {
    if (e.target.closest('button')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(DZ_COL_DRAG_MIME, String(colIdx));
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleColumnHeaderDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleColumnHeaderDrop = useCallback(
    async (e, dropIdx) => {
      e.preventDefault();
      if (columnReorderBusyRef.current) return;
      const raw = e.dataTransfer.getData(DZ_COL_DRAG_MIME);
      const fromIdx = Number(raw);
      if (!Number.isFinite(fromIdx)) return;
      if (fromIdx === dropIdx) return;
      const visibleKeys = displayColumnKeys;
      const nextVisible = reorderColumnKeysAt(visibleKeys, fromIdx, dropIdx);
      const hiddenKeys = pipelineListTemplate.columnOrder.filter((k) => pipelineListTemplate.visible[k] === false);
      const nextFull = [...nextVisible, ...hiddenKeys.filter((k) => !nextVisible.includes(k))];
      columnReorderBusyRef.current = true;
      try {
        await onSaveColumnOrder(nextFull);
      } finally {
        columnReorderBusyRef.current = false;
      }
    },
    [displayColumnKeys, pipelineListTemplate.columnOrder, pipelineListTemplate.visible, onSaveColumnOrder]
  );

  const hasActiveColumnFilters = Object.keys(columnFilters).length > 0;

  return (
    <section className="sp-pipeline-table-section" aria-label="파이프라인 표">
      <div className="sp-pipeline-table-toolbar">
        <p className="sp-pipeline-table-toolbar-hint">
          열 이름을 누르면 정렬·필터가 열립니다. 복수 품목은 1·1.1·1.2처럼 표시됩니다.
        </p>
        {hasActiveColumnFilters ? (
          <button type="button" className="sp-pipeline-table-clear-filters" onClick={clearAllColumnFilters}>
            열 필터 모두 해제
          </button>
        ) : null}
      </div>
      <div className="sp-dz-table-panel sp-pipeline-table-dz-panel">
        <div className="sp-dz-table-h-scroll">
          <div className="sp-dz-table-inner">
            <div className="sp-dz-table-scroll">
              <table
              ref={dataTableRef}
              className="sp-pl-data-table sp-dz-data-table sp-dz-data-table--no-actions"
              style={dataTableFixedStyle}
            >
              {measuredColWidths && measuredColWidths.length > 0 ? (
                <colgroup>
                  {measuredColWidths.map((w, i) => (
                    <col key={i} style={{ width: `${w}px`, minWidth: `${w}px` }} />
                  ))}
                </colgroup>
              ) : null}
              <thead>
                <tr>
                  <th
                    className="sp-pl-data-table__th sp-dz-data-table__th sp-dz-data-table__th--sticky-id"
                    scope="col"
                  >
                    행
                  </th>
                  {displayColumnKeys.map((colKey, colIdx) => {
                    const hasColFilter = Array.isArray(columnFilters[colKey]);
                    const activeSortKey = sortState.key;
                    const activeSortDir = sortState.dir;
                    return (
                      <th
                        key={colKey}
                        className={`sp-pl-data-table__th sp-dz-data-table__th sp-dz-data-table__th--col-tools sp-dz-data-table__th--dz-col-reorder${
                          openFilterCol === colKey ? ' sp-dz-data-table__th--filter-open' : ''
                        }`}
                        scope="col"
                        title={labelForCol(colKey)}
                        draggable
                        onDragStart={(e) => handleColumnHeaderDragStart(e, colIdx)}
                        onDragOver={handleColumnHeaderDragOver}
                        onDrop={(e) => handleColumnHeaderDrop(e, colIdx)}
                      >
                        <div
                          className="sp-dz-th-wrap"
                          ref={openFilterCol === colKey ? filterPopoverRef : null}
                        >
                          <button
                            type="button"
                            className={`sp-dz-th-col-trigger${hasColFilter ? ' sp-dz-th-col-trigger--filtered' : ''}`}
                            aria-expanded={openFilterCol === colKey}
                            aria-haspopup="dialog"
                            aria-label={`${labelForCol(colKey)} 정렬·필터`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openColumnFilter(colKey);
                            }}
                          >
                            <span className="sp-dz-th-col-trigger__label">{labelForCol(colKey)}</span>
                            {activeSortKey === colKey && activeSortDir === 'asc' ? (
                              <span className="material-symbols-outlined sp-dz-th-col-trigger__sort-icon" aria-hidden>
                                arrow_upward
                              </span>
                            ) : null}
                            {activeSortKey === colKey && activeSortDir === 'desc' ? (
                              <span className="material-symbols-outlined sp-dz-th-col-trigger__sort-icon" aria-hidden>
                                arrow_downward
                              </span>
                            ) : null}
                          </button>
                          {openFilterCol === colKey ? (
                            <div
                              className="sp-dz-col-filter-pop"
                              role="dialog"
                              aria-label={`${labelForCol(colKey)} 정렬·필터`}
                              onMouseDown={(e) => e.stopPropagation()}
                            >
                              <div className="sp-dz-col-filter-pop__sort">
                                <span className="sp-dz-col-filter-pop__sort-caption">정렬</span>
                                <div className="sp-dz-col-filter-pop__sort-row">
                                  <button
                                    type="button"
                                    className={
                                      activeSortKey === colKey && activeSortDir === 'asc'
                                        ? 'sp-dz-col-filter-pop__sort-btn sp-dz-col-filter-pop__sort-btn--active'
                                        : 'sp-dz-col-filter-pop__sort-btn'
                                    }
                                    onClick={() => setSortForColumn(colKey, 'asc')}
                                  >
                                    오름차순
                                  </button>
                                  <button
                                    type="button"
                                    className={
                                      activeSortKey === colKey && activeSortDir === 'desc'
                                        ? 'sp-dz-col-filter-pop__sort-btn sp-dz-col-filter-pop__sort-btn--active'
                                        : 'sp-dz-col-filter-pop__sort-btn'
                                    }
                                    onClick={() => setSortForColumn(colKey, 'desc')}
                                  >
                                    내림차순
                                  </button>
                                  <button
                                    type="button"
                                    className="sp-dz-col-filter-pop__sort-btn sp-dz-col-filter-pop__sort-btn--ghost"
                                    onClick={() => setSortForColumn(colKey, null)}
                                  >
                                    정렬 해제
                                  </button>
                                </div>
                              </div>
                              <input
                                type="text"
                                className="sp-dz-col-filter-pop__input"
                                placeholder="목록에서 검색…"
                                value={colFilterSearch}
                                onChange={(e) => setColFilterSearch(e.target.value)}
                              />
                              <ul className="sp-dz-col-filter-pop__list">
                                {(() => {
                                  const cur = columnFilters[colKey];
                                  const full = filterUniqueOptions;
                                  const allOn =
                                    full.length > 0 &&
                                    (cur == null || (Array.isArray(cur) && cur.length === full.length));
                                  const partial =
                                    Array.isArray(cur) && cur.length > 0 && cur.length < full.length;
                                  const masterId = `sp-pl-colf-master-${colKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
                                  return (
                                    <li className="sp-dz-col-filter-pop__item sp-dz-col-filter-pop__item--master">
                                      <label
                                        className="sp-dz-col-filter-pop__label sp-dz-col-filter-pop__label--master"
                                        htmlFor={masterId}
                                      >
                                        <input
                                          id={masterId}
                                          type="checkbox"
                                          checked={Boolean(allOn)}
                                          ref={(el) => {
                                            if (el) el.indeterminate = Boolean(partial);
                                          }}
                                          disabled={full.length === 0}
                                          aria-label="이 열 값 전체 선택·전체 해제"
                                          onChange={() =>
                                            handleColumnFilterMasterToggle(colKey, filterUniqueOptions)
                                          }
                                        />
                                      </label>
                                    </li>
                                  );
                                })()}
                                {filterUniqueForUi.length === 0 ? (
                                  <li className="sp-dz-col-filter-pop__empty">일치하는 값 없음</li>
                                ) : (
                                  filterUniqueForUi.map((valueKey, idx) => {
                                    const cur = columnFilters[colKey];
                                    const checked = cur == null || cur.includes(valueKey);
                                    const optId = `sp-pl-colf-${colKey.replace(/[^a-zA-Z0-9_-]/g, '_')}-${idx}`;
                                    return (
                                      <li key={`${colKey}-${valueKey}-${idx}`} className="sp-dz-col-filter-pop__item">
                                        <label className="sp-dz-col-filter-pop__label" htmlFor={optId}>
                                          <input
                                            id={optId}
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() =>
                                              toggleColumnFilterValue(colKey, valueKey, filterUniqueOptions)
                                            }
                                          />
                                          <span className="sp-dz-col-filter-pop__val">
                                            {filterValueDisplay(valueKey, colKey, stageLabels)}
                                          </span>
                                        </label>
                                      </li>
                                    );
                                  })
                                )}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {displayRows.length === 0 ? (
                  <tr className="sp-pl-table__row--filter-empty sp-dz-data-table__row sp-dz-data-table__row--filter-empty">
                    <td
                      className="sp-dz-data-table__td sp-dz-data-table__td--filter-empty-msg"
                      colSpan={Math.max(1, 1 + displayColumnKeys.length)}
                    >
                      <div className="sp-dz-filter-empty-inner">
                        <p className="sp-dz-filter-empty-text">
                          {allOpportunities.length === 0
                            ? '표시할 기회가 없습니다.'
                            : '열 필터 조건 때문에 표시할 행이 없습니다. 열 이름을 눌러 값을 다시 선택하거나 필터를 해제해 주세요.'}
                        </p>
                        {hasActiveColumnFilters ? (
                          <button
                            type="button"
                            className="sp-dz-filter-empty-reset-all"
                            onClick={clearAllColumnFilters}
                          >
                            모든 열 필터 한 번에 해제
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : (
                  displayRows.map((flatRow) => {
                    const opp = flatRow.opp;
                    const trClass =
                      flatRow.kind === 'summary'
                        ? 'sp-dz-data-table__row sp-dz-data-table__row--tree-summary'
                        : flatRow.kind === 'line'
                          ? 'sp-dz-data-table__row sp-dz-data-table__row--tree-line'
                          : 'sp-dz-data-table__row';
                    return (
                      <tr
                        key={flatRow.key}
                        className={trClass}
                        draggable
                        onDragStart={(e) => onDragStart(e, opp._id)}
                        onDragEnd={onDragEnd}
                        onClick={() => onOpenEdit(opp._id)}
                      >
                        <td
                          className={`sp-dz-data-table__td sp-dz-data-table__td--rownum${
                            flatRow.kind === 'line' ? ' sp-dz-data-table__td--tree-indent' : ''
                          }`}
                        >
                          {flatRow.rowLabel}
                        </td>
                        {displayColumnKeys.map((colKey) => {
                          const text = pipelineFlatRowCellText(
                            colKey,
                            flatRow,
                            stageForecastPercent,
                            stageLabels,
                            canViewAdminContent
                          );
                          const node = text || '\u00A0';
                          const kStyle = listColumnValueInlineStyle(columnCellStyles, colKey);
                          return (
                            <td
                              key={colKey}
                              className={`sp-dz-data-table__td sp-pl-data-table__td${
                                flatRow.kind === 'line' ? ' sp-dz-data-table__td--tree-line-indent' : ''
                              }${colKey === 'productName' ? ' sp-dz-data-table__td--product-name' : ''}`}
                              title={text}
                            >
                              <span className="list-col-value-style" style={kStyle || undefined}>
                                {node}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            </div>
            <div className="sp-dz-table-totals-strip sp-pipeline-table-totals" aria-label="열 합계">
            <table
              className="sp-pl-data-table sp-dz-data-table sp-dz-data-table--no-actions sp-dz-data-table--totals-only"
              style={dataTableFixedStyle}
            >
              {measuredColWidths && measuredColWidths.length > 0 ? (
                <colgroup>
                  {measuredColWidths.map((w, i) => (
                    <col key={`tot-col-${i}`} style={{ width: `${w}px`, minWidth: `${w}px` }} />
                  ))}
                </colgroup>
              ) : null}
              <tbody>
                <tr className="sp-dz-data-table__row sp-dz-data-table__row--totals">
                  <td className="sp-dz-data-table__td sp-dz-data-table__td--rownum sp-dz-data-table__td--totals-label">
                    합계
                  </td>
                  {displayColumnKeys.map((colKey) => {
                    const t = totalsByColumn[colKey];
                    const kStyle = listColumnValueInlineStyle(columnCellStyles, colKey);
                    return (
                      <td
                        key={`tot-${colKey}`}
                        className="sp-dz-data-table__td sp-dz-data-table__td--totals"
                        title={t}
                      >
                        <span className="list-col-value-style" style={kStyle || undefined}>
                          {t || '\u00A0'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        </div>
      </div>
      <div className="sp-pipeline-table-footer" role="status">
        표시 행 <strong>{displayRows.length}</strong> · 기회 <strong>{sortedFiltered.length}</strong>건 · 열{' '}
        <strong>{displayColumnKeys.length}</strong>
      </div>
    </section>
  );
}
