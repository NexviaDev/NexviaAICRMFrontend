import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatNumberInput } from '@/lib/sales-opportunity-form-shared';
import { LIST_IDS, getSavedTemplate, patchListTemplate } from '@/lib/list-templates';
import {
  toExpenseDateTimeLocalValue,
  toExpenseDateTimeValue,
  normalizeExpenseDateTimeTypingValue
} from './approval-expense-utils';
import {
  expenseColumnToDisplayLabel,
  normalizeExpenseColumnTemplateColumns
} from './approval-expense-column-template';
import './approval-expense-lines.css';

const EXPENSE_COLUMN_LIST_ID = LIST_IDS.E_APPROVAL_EXPENSE_LINES;
const FILTER_MENU_VIEWPORT_MARGIN = 8;
const FILTER_MENU_CURSOR_GAP = 8;

const BUILTIN_META = {
  expenseDate: { label: '날짜', type: 'date', grid: 'minmax(5.4rem, 0.65fr)' },
  amount: { label: '금액', type: 'amount', grid: 'minmax(4.7rem, 0.58fr)' },
  category: { label: '분류', type: 'text', grid: 'minmax(4.6rem, 0.56fr)' },
  content: { label: '내용', type: 'text', grid: 'minmax(8.8rem, 1.56fr)' },
  user: { label: '사용자', type: 'text', grid: 'minmax(9rem, 1.25fr)' },
  note: { label: '비고', type: 'text', grid: 'minmax(6.5rem, 0.9fr)' }
};

function getColumnGrid(col) {
  if (BUILTIN_META[col.key]?.grid) return BUILTIN_META[col.key].grid;
  if (col.type === 'date') return 'minmax(5.2rem, 0.64fr)';
  if (col.type === 'amount') return 'minmax(4.7rem, 0.58fr)';
  return 'minmax(6rem, 1fr)';
}

function normalizeColumnOrder(orderRaw, enabledKeys) {
  const known = new Set(enabledKeys);
  const input = Array.isArray(orderRaw) ? orderRaw : [];
  const out = [];
  const seen = new Set();
  input.forEach((key) => {
    const k = String(key || '').trim();
    if (!known.has(k) || seen.has(k)) return;
    out.push(k);
    seen.add(k);
  });
  enabledKeys.forEach((k) => {
    if (!seen.has(k)) out.push(k);
  });
  return out;
}

function getRowValue(row, col) {
  if (!row || !col) return '';
  if (col.key === 'expenseDate') return row.expenseDate || '';
  if (col.key === 'amount') return row.amount || '';
  if (col.key === 'category') return row.category || '';
  if (col.key === 'content') return row.content || '';
  if (col.key === 'user') return row.user || '';
  if (col.key === 'note') return row.note || '';
  return row.customValues?.[col.key] || '';
}

function patchRowValue(row, col, nextValue) {
  if (!col) return row;
  if (col.key === 'expenseDate') return { ...row, expenseDate: nextValue };
  if (col.key === 'amount') return { ...row, amount: nextValue };
  if (col.key === 'category') return { ...row, category: nextValue };
  if (col.key === 'content') return { ...row, content: nextValue };
  if (col.key === 'user') return { ...row, user: nextValue };
  if (col.key === 'note') return { ...row, note: nextValue };
  return {
    ...row,
    customValues: {
      ...(row.customValues || {}),
      [col.key]: nextValue
    }
  };
}

function toFilterText(row, col) {
  const raw = String(getRowValue(row, col) || '').trim();
  if (col?.type === 'date') return String(toExpenseDateTimeValue(raw) || raw || '').trim();
  if (col?.type === 'amount') return String(raw || '').replace(/,/g, '').trim();
  return raw;
}

function getUniqueFilterOptions(rows, col) {
  const set = new Set();
  (rows || []).forEach((r) => {
    set.add(toFilterText(r, col));
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' }));
}

function sortIndexedRows(indexedRows, sortConfig, columnsByKey) {
  if (!sortConfig?.key || !sortConfig?.dir) return indexedRows;
  const col = columnsByKey.get(sortConfig.key);
  if (!col) return indexedRows;
  const dir = sortConfig.dir === 'desc' ? -1 : 1;
  const next = [...indexedRows];
  next.sort((a, b) => {
    const va = toFilterText(a.row, col);
    const vb = toFilterText(b.row, col);
    if (col.type === 'amount') return (Number(va || 0) - Number(vb || 0)) * dir;
    return va.localeCompare(vb, 'ko', { numeric: true, sensitivity: 'base' }) * dir;
  });
  return next;
}

function toAmountNumber(raw) {
  const n = Number(String(raw ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function formatAmountTotal(value) {
  return new Intl.NumberFormat('ko-KR').format(toAmountNumber(value));
}

function ReadonlyCell({ value, multiline, amount }) {
  const text = value == null || value === '' ? '—' : String(value);
  const cls = [
    'approval-expense-lines-readonly',
    multiline ? 'approval-expense-lines-readonly--multiline' : '',
    text === '—' ? 'approval-expense-lines-readonly--empty' : '',
    amount ? 'approval-expense-lines-readonly--amount' : ''
  ].filter(Boolean).join(' ');
  return <span className={cls}>{text}</span>;
}

function ExpenseDateInput({ value, onChange, disabled }) {
  const nativePickerRef = useRef(null);
  const openNativePicker = () => {
    if (disabled) return;
    const el = nativePickerRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      el.showPicker();
      return;
    }
    el.focus();
    el.click();
  };
  return (
    <div className="approval-expense-date-wrap">
      <input
        type="text"
        inputMode="numeric"
        className="approval-form-input"
        value={normalizeExpenseDateTimeTypingValue(value)}
        onChange={(e) => onChange(normalizeExpenseDateTimeTypingValue(e.target.value))}
        onBlur={(e) => onChange(toExpenseDateTimeValue(e.target.value) || normalizeExpenseDateTimeTypingValue(e.target.value))}
        placeholder="YYYY-MM-DD HH:mm"
        disabled={disabled}
      />
      <button type="button" className="approval-form-date-icon-btn" onClick={openNativePicker} disabled={disabled} aria-label="달력에서 날짜 선택">
        <span className="material-symbols-outlined" aria-hidden>calendar_today</span>
      </button>
      <input
        ref={nativePickerRef}
        type="datetime-local"
        className="approval-expense-native-picker"
        tabIndex={-1}
        aria-hidden="true"
        value={toExpenseDateTimeLocalValue(value)}
        onChange={(e) => onChange(String(e.target.value || '').replace('T', ' '))}
      />
    </div>
  );
}

function KeySelectInput({ value, onChange, options, disabled, placeholder = '선택' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const menuAnchorRef = useRef(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 220, maxHeight: 220 });
  const normalizedValue = String(value || '').trim();

  const sortedOptions = useMemo(
    () => [...(options || [])].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' })),
    [options]
  );
  const filteredOptions = useMemo(
    () => sortedOptions.filter((opt) => opt.toLowerCase().includes(normalizedValue.toLowerCase())),
    [normalizedValue, sortedOptions]
  );
  const isOutOfList = normalizedValue && sortedOptions.length > 0 && !sortedOptions.includes(normalizedValue);

  const placeMenu = useCallback(() => {
    const anchorEl = menuAnchorRef.current;
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const viewportMargin = 8;
    const desiredWidth = Math.max(220, rect.width);
    const maxWidth = Math.max(220, window.innerWidth - (viewportMargin * 2));
    const width = Math.min(desiredWidth, maxWidth);
    let left = rect.left;
    if (left + width > window.innerWidth - viewportMargin) {
      left = Math.max(viewportMargin, window.innerWidth - width - viewportMargin);
    }
    const spaceBelow = window.innerHeight - rect.bottom - viewportMargin;
    const spaceAbove = rect.top - viewportMargin;
    const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(260, openUp ? spaceAbove - 8 : spaceBelow - 8));
    const top = openUp ? Math.max(viewportMargin, rect.top - maxHeight - 4) : (rect.bottom + 4);
    setMenuPos({ top, left, width, maxHeight });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    placeMenu();
  }, [open, placeMenu, value]);

  useEffect(() => {
    if (!open) return undefined;
    const onViewportChange = () => placeMenu();
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open, placeMenu]);

  return (
    <div className={`approval-expense-key-select${isOutOfList ? ' is-out-of-list' : ''}`} ref={rootRef}>
      <div className="approval-expense-key-select-inline" ref={menuAnchorRef}>
        <input
          type="text"
          className="approval-form-input approval-expense-key-select-input"
          value={value || ''}
          onChange={(e) => {
            onChange(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
        />
        <button
          type="button"
          className="approval-expense-key-select-trigger"
          onClick={() => !disabled && setOpen((prev) => !prev)}
          disabled={disabled}
          title="목록 열기"
        >
          <span className="material-symbols-outlined" aria-hidden>arrow_drop_down</span>
        </button>
      </div>
      {open ? (
        <div
          className="approval-expense-key-select-menu"
          style={{
            top: `${menuPos.top}px`,
            left: `${menuPos.left}px`,
            width: `${menuPos.width}px`
          }}
        >
          <div className="approval-expense-key-select-options" style={{ maxHeight: `${menuPos.maxHeight}px` }}>
            <button
              type="button"
              className="approval-expense-key-select-option is-empty"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              선택 해제
            </button>
            {filteredOptions.map((opt) => (
              <button
                type="button"
                key={`opt-${opt}`}
                className={`approval-expense-key-select-option${value === opt ? ' is-active' : ''}`}
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
              >
                {opt}
              </button>
            ))}
            {filteredOptions.length === 0 ? (
              <div className="approval-expense-key-select-empty">검색 결과가 없습니다.</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ExpenseLinesEditor({
  items,
  onItemsChange,
  disabled = false,
  columnTemplateColumns
}) {
  const templateColumns = useMemo(
    () => normalizeExpenseColumnTemplateColumns(columnTemplateColumns).filter((c) => c.enabled !== false),
    [columnTemplateColumns]
  );
  const enabledKeys = useMemo(() => templateColumns.map((c) => c.key), [templateColumns]);
  const columnsByKey = useMemo(() => new Map(templateColumns.map((c) => [c.key, c])), [templateColumns]);
  const [columnOrder, setColumnOrder] = useState(() => {
    const saved = getSavedTemplate(EXPENSE_COLUMN_LIST_ID);
    return normalizeColumnOrder(saved?.columnOrder, enabledKeys);
  });
  const [draggingKey, setDraggingKey] = useState('');
  const [dragOverKey, setDragOverKey] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: '', dir: '' });
  const [activeFilters, setActiveFilters] = useState({});
  const [openFilterKey, setOpenFilterKey] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [draftSelected, setDraftSelected] = useState([]);
  const [filterMenuPosition, setFilterMenuPosition] = useState({ top: 0, left: 0 });
  const [filterAnchor, setFilterAnchor] = useState({ x: 0, y: 0 });
  const filterMenuRef = useRef(null);

  useEffect(() => {
    const saved = getSavedTemplate(EXPENSE_COLUMN_LIST_ID);
    setColumnOrder(normalizeColumnOrder(saved?.columnOrder, enabledKeys));
  }, [enabledKeys]);

  const persistedOrder = useMemo(
    () => normalizeColumnOrder(columnOrder, enabledKeys),
    [columnOrder, enabledKeys]
  );
  const visibleCols = useMemo(
    () => persistedOrder.map((key) => columnsByKey.get(key)).filter(Boolean),
    [columnsByKey, persistedOrder]
  );
  const gridTemplateColumns = useMemo(
    () => ['2.25rem', ...visibleCols.map((c) => getColumnGrid(c)), '2.15rem'].join(' '),
    [visibleCols]
  );
  const totalAmount = useMemo(
    () => (items || []).reduce((sum, row) => sum + toAmountNumber(row?.amount), 0),
    [items]
  );

  const patchLine = (index, col, nextValue) => {
    onItemsChange(items.map((row, i) => (i === index ? patchRowValue(row, col, nextValue) : row)));
  };
  const removeLine = (index) => {
    if (items.length <= 1) return;
    onItemsChange(items.filter((_, i) => i !== index));
  };

  const filterOptionsByKey = useMemo(() => {
    const map = {};
    visibleCols.forEach((col) => {
      map[col.key] = getUniqueFilterOptions(items, col);
    });
    return map;
  }, [items, visibleCols]);

  const filteredAndSortedRows = useMemo(() => {
    let indexed = items.map((row, originalIndex) => ({ row, originalIndex }));
    Object.entries(activeFilters || {}).forEach(([key, selectedValues]) => {
      const col = columnsByKey.get(key);
      if (!col) return;
      if (!Array.isArray(selectedValues) || selectedValues.length === 0) return;
      const allowed = new Set(selectedValues);
      indexed = indexed.filter(({ row }) => allowed.has(toFilterText(row, col)));
    });
    return sortIndexedRows(indexed, sortConfig, columnsByKey);
  }, [activeFilters, columnsByKey, items, sortConfig]);

  useEffect(() => {
    if (!openFilterKey) return undefined;
    const onDocDown = (e) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target)) setOpenFilterKey('');
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [openFilterKey]);

  useEffect(() => {
    if (!openFilterKey) return undefined;
    const closeMenu = () => setOpenFilterKey('');
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [openFilterKey]);

  const persistColumnOrder = useCallback(async (nextOrder) => {
    try {
      await patchListTemplate(EXPENSE_COLUMN_LIST_ID, { columnOrder: nextOrder });
    } catch (_) {
      // no-op
    }
  }, []);

  const handleHeaderDragOver = (e, key) => {
    if (!draggingKey || draggingKey === key || disabled) return;
    e.preventDefault();
    setDragOverKey(key);
  };
  const handleHeaderDrop = (targetKey) => {
    if (!draggingKey || draggingKey === targetKey || disabled) {
      setDragOverKey('');
      setDraggingKey('');
      return;
    }
    const next = [...persistedOrder];
    const from = next.indexOf(draggingKey);
    const to = next.indexOf(targetKey);
    if (from < 0 || to < 0) {
      setDragOverKey('');
      setDraggingKey('');
      return;
    }
    next.splice(from, 1);
    next.splice(to, 0, draggingKey);
    const normalized = normalizeColumnOrder(next, enabledKeys);
    setColumnOrder(normalized);
    setDragOverKey('');
    setDraggingKey('');
    persistColumnOrder(normalized);
  };

  const placeFilterMenu = useCallback((anchorX, anchorY) => {
    const menuEl = filterMenuRef.current;
    const menuW = menuEl?.offsetWidth || 220;
    const menuH = menuEl?.offsetHeight || 320;
    let left = anchorX + FILTER_MENU_CURSOR_GAP;
    let top = anchorY + FILTER_MENU_CURSOR_GAP;
    if (left + menuW > window.innerWidth - FILTER_MENU_VIEWPORT_MARGIN) left = anchorX - menuW - FILTER_MENU_CURSOR_GAP;
    if (top + menuH > window.innerHeight - FILTER_MENU_VIEWPORT_MARGIN) top = anchorY - menuH - FILTER_MENU_CURSOR_GAP;
    left = Math.min(Math.max(FILTER_MENU_VIEWPORT_MARGIN, left), Math.max(FILTER_MENU_VIEWPORT_MARGIN, window.innerWidth - menuW - FILTER_MENU_VIEWPORT_MARGIN));
    top = Math.min(Math.max(FILTER_MENU_VIEWPORT_MARGIN, top), Math.max(FILTER_MENU_VIEWPORT_MARGIN, window.innerHeight - menuH - FILTER_MENU_VIEWPORT_MARGIN));
    setFilterMenuPosition({ top, left });
  }, []);

  const openFilter = (key, mousePoint) => {
    const allOptions = filterOptionsByKey[key] || [];
    const selected = Array.isArray(activeFilters[key]) && activeFilters[key].length > 0 ? activeFilters[key] : allOptions;
    const anchorX = Number(mousePoint?.x) || 0;
    const anchorY = Number(mousePoint?.y) || 0;
    setFilterAnchor({ x: anchorX, y: anchorY });
    placeFilterMenu(anchorX, anchorY);
    setOpenFilterKey(key);
    setFilterSearch('');
    setDraftSelected(selected);
  };
  useLayoutEffect(() => {
    if (!openFilterKey) return;
    placeFilterMenu(filterAnchor.x, filterAnchor.y);
  }, [filterAnchor.x, filterAnchor.y, openFilterKey, placeFilterMenu]);

  const applyFilter = () => {
    if (!openFilterKey) return;
    const key = openFilterKey;
    const allOptions = filterOptionsByKey[key] || [];
    const normalized = [...new Set(draftSelected)];
    setActiveFilters((prev) => {
      const next = { ...prev };
      if (normalized.length === 0 || normalized.length === allOptions.length) delete next[key];
      else next[key] = normalized;
      return next;
    });
    setOpenFilterKey('');
  };
  const clearFilter = (key) => {
    setActiveFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (openFilterKey === key) setOpenFilterKey('');
  };

  const renderEditorValue = (row, col, originalIndex) => {
    const value = getRowValue(row, col);
    if (col.type === 'date') {
      return (
        <ExpenseDateInput
          value={value}
          onChange={(next) => patchLine(originalIndex, col, next)}
          disabled={disabled}
        />
      );
    }
    if (col.type === 'amount') {
      return (
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          className="approval-form-input"
          value={value ?? ''}
          onChange={(e) => patchLine(originalIndex, col, formatNumberInput(e.target.value))}
          placeholder="0"
          disabled={disabled}
        />
      );
    }
    const options = Array.isArray(col.allowedValues) ? col.allowedValues : [];
    if (options.length > 0) {
      return (
        <KeySelectInput
          value={value || ''}
          onChange={(next) => patchLine(originalIndex, col, next)}
          options={options}
          disabled={disabled}
          placeholder="선택"
        />
      );
    }
    return (
      <input
        type="text"
        className="approval-form-input"
        value={value || ''}
        onChange={(e) => patchLine(originalIndex, col, e.target.value)}
        placeholder={col.label}
        disabled={disabled}
      />
    );
  };

  return (
    <div className="approval-expense-lines-wrap">
      <div className="approval-expense-lines">
        <div className="approval-expense-lines-head" style={{ gridTemplateColumns }}>
          <span>No</span>
          {visibleCols.map((col) => {
            const key = col.key;
            const isDragOver = dragOverKey === key;
            const isDragging = draggingKey === key;
            return (
              <span
                key={`head-${key}`}
                onDragOver={(e) => handleHeaderDragOver(e, key)}
                onDrop={() => handleHeaderDrop(key)}
                onDragEnd={() => { setDraggingKey(''); setDragOverKey(''); }}
                className={[
                  'approval-expense-lines-head-draggable',
                  isDragOver ? 'approval-expense-lines-head-drag-over' : '',
                  isDragging ? 'approval-expense-lines-head-dragging' : ''
                ].filter(Boolean).join(' ')}
              >
                <button
                  type="button"
                  className="approval-expense-lines-head-filter-trigger"
                  onClick={(e) => openFilter(key, { x: e.clientX, y: e.clientY })}
                  title="정렬/필터"
                >
                  <span className="approval-expense-lines-head-label">{expenseColumnToDisplayLabel(col)}</span>
                  {Array.isArray(activeFilters[key]) && activeFilters[key].length > 0 ? (
                    <span className="material-symbols-outlined approval-expense-lines-head-filter-icon" aria-hidden>filter_alt</span>
                  ) : null}
                </button>
                <span
                  className="approval-expense-lines-drag-handle"
                  draggable={!disabled}
                  onDragStart={() => !disabled && setDraggingKey(key)}
                  title="드래그해서 열 순서 변경"
                  aria-label={`${col.label || '열'} 순서 변경`}
                >
                  <span className="material-symbols-outlined" aria-hidden>drag_indicator</span>
                </span>
                {openFilterKey === key ? (
                  <div
                    ref={filterMenuRef}
                    className="approval-expense-lines-filter-menu"
                    style={{ top: `${filterMenuPosition.top}px`, left: `${filterMenuPosition.left}px` }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="approval-expense-lines-filter-menu-actions">
                      <button type="button" onClick={() => setSortConfig({ key, dir: 'asc' })} className="approval-expense-lines-filter-btn">오름차순 정렬</button>
                      <button type="button" onClick={() => setSortConfig({ key, dir: 'desc' })} className="approval-expense-lines-filter-btn">내림차순 정렬</button>
                      <button
                        type="button"
                        onClick={() => setSortConfig((prev) => (prev.key === key ? { key: '', dir: '' } : prev))}
                        className="approval-expense-lines-filter-btn"
                      >
                        정렬 해제
                      </button>
                    </div>
                    <input
                      type="search"
                      className="approval-expense-lines-filter-search"
                      value={filterSearch}
                      onChange={(e) => setFilterSearch(e.target.value)}
                      placeholder="검색"
                    />
                    <div className="approval-expense-lines-filter-options">
                      {(filterOptionsByKey[key] || [])
                        .filter((v) => v.toLowerCase().includes(filterSearch.trim().toLowerCase()))
                        .map((option) => (
                          <label key={`f-${key}-${option || '__empty'}`} className="approval-expense-lines-filter-option">
                            <input
                              type="checkbox"
                              checked={draftSelected.includes(option)}
                              onChange={() => setDraftSelected((prev) => (prev.includes(option) ? prev.filter((v) => v !== option) : [...prev, option]))}
                            />
                            <span>{option || '(빈 값)'}</span>
                          </label>
                        ))}
                    </div>
                    <div className="approval-expense-lines-filter-footer">
                      <button type="button" onClick={applyFilter} className="approval-expense-lines-filter-ok">확인</button>
                      <button type="button" onClick={() => clearFilter(key)} className="approval-expense-lines-filter-cancel">전체</button>
                      <button type="button" onClick={() => setOpenFilterKey('')} className="approval-expense-lines-filter-cancel">취소</button>
                    </div>
                  </div>
                ) : null}
              </span>
            );
          })}
          <span aria-hidden />
        </div>

        {filteredAndSortedRows.map(({ row, originalIndex }, displayIdx) => (
          <div key={`expense-line-${originalIndex}`} className="approval-expense-lines-row" style={{ gridTemplateColumns }}>
            <span className="approval-expense-lines-no">{displayIdx + 1}</span>
            {visibleCols.map((col) => (
              <div key={`${col.key}-${originalIndex}`} className="approval-expense-lines-cell--left">
                {renderEditorValue(row, col, originalIndex)}
              </div>
            ))}
            <div>
              <button
                type="button"
                className="approval-expense-lines-remove"
                onClick={() => removeLine(originalIndex)}
                disabled={disabled || items.length <= 1}
                title="행 삭제"
                aria-label={`${displayIdx + 1}번 지출 내역 삭제`}
              >
                <span className="material-symbols-outlined" aria-hidden>remove</span>
              </button>
            </div>
          </div>
        ))}
        <div className="approval-expense-lines-row approval-expense-lines-row--total" style={{ gridTemplateColumns }}>
          <span className="approval-expense-lines-no">합계</span>
          {visibleCols.map((col) => (
            <div key={`total-${col.key}`} className="approval-expense-lines-cell--left">
              {col.key === 'amount' ? (
                <span className="approval-expense-lines-total-amount">{formatAmountTotal(totalAmount)}</span>
              ) : null}
            </div>
          ))}
          <div aria-hidden />
        </div>
      </div>
    </div>
  );
}

export function ExpenseLinesReadonly({
  items,
  formatDate,
  formatAmount,
  columnTemplateColumns
}) {
  const templateColumns = useMemo(
    () => normalizeExpenseColumnTemplateColumns(columnTemplateColumns).filter((c) => c.enabled !== false),
    [columnTemplateColumns]
  );
  const enabledKeys = useMemo(() => templateColumns.map((c) => c.key), [templateColumns]);
  const columnsByKey = useMemo(() => new Map(templateColumns.map((c) => [c.key, c])), [templateColumns]);
  const columnOrder = useMemo(() => {
    const saved = getSavedTemplate(EXPENSE_COLUMN_LIST_ID);
    return normalizeColumnOrder(saved?.columnOrder, enabledKeys);
  }, [enabledKeys]);
  const visibleCols = useMemo(
    () => columnOrder.map((key) => columnsByKey.get(key)).filter(Boolean),
    [columnOrder, columnsByKey]
  );
  const gridTemplateColumns = useMemo(
    () => ['2.25rem', ...visibleCols.map((c) => getColumnGrid(c)), '2.15rem'].join(' '),
    [visibleCols]
  );
  const totalAmount = useMemo(
    () => (items || []).reduce((sum, row) => sum + toAmountNumber(row?.amount), 0),
    [items]
  );

  return (
    <div className="approval-expense-lines-wrap">
      <div className="approval-expense-lines">
        <div className="approval-expense-lines-head" style={{ gridTemplateColumns }}>
          <span>No</span>
          {visibleCols.map((col) => (
            <span key={`head-ro-${col.key}`}>{expenseColumnToDisplayLabel(col)}</span>
          ))}
          <span aria-hidden />
        </div>
        {items.map((row, idx) => (
          <div key={`expense-read-${idx}`} className="approval-expense-lines-row" style={{ gridTemplateColumns }}>
            <span className="approval-expense-lines-no">{idx + 1}</span>
            {visibleCols.map((col) => {
              const value = getRowValue(row, col);
              const display = col.type === 'date'
                ? formatDate(value)
                : (col.type === 'amount' ? formatAmount(value) : value);
              return (
                <div key={`${col.key}-${idx}`} className="approval-expense-lines-cell--left">
                  <ReadonlyCell value={display} amount={col.type === 'amount'} multiline={col.type === 'text'} />
                </div>
              );
            })}
            <div aria-hidden />
          </div>
        ))}
        <div className="approval-expense-lines-row approval-expense-lines-row--total" style={{ gridTemplateColumns }}>
          <span className="approval-expense-lines-no">합계</span>
          {visibleCols.map((col) => (
            <div key={`total-ro-${col.key}`} className="approval-expense-lines-cell--left">
              {col.key === 'amount' ? (
                <span className="approval-expense-lines-total-amount">{formatAmountTotal(totalAmount)}</span>
              ) : null}
            </div>
          ))}
          <div aria-hidden />
        </div>
      </div>
    </div>
  );
}

export default ExpenseLinesEditor;
