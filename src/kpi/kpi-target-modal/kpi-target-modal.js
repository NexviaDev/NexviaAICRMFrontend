import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './kpi-target-modal.css';
import {
  computeNeedSyncFlags,
  emptyCascadeBlock,
  normCascadeBlock,
  compareCompanyToRootDeptSums,
  emptyRootSumMismatch
} from '../kpi-target-cascade-utils';
import { digitsFromEvaluatedKpiAmount } from '../kpi-target-amount-expr';

/** 목표액: 숫자만 유지(부모 state는 숫자 문자열) */
function revenueDigitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function formatRevenueDisplay(digitsStr) {
  const d = revenueDigitsOnly(digitsStr);
  if (!d) return '';
  const n = Number(d);
  if (!Number.isFinite(n)) return d;
  return n.toLocaleString('ko-KR');
}

const MONTH_COLUMNS = Array.from({ length: 12 }, (_, idx) => ({ month: idx + 1, label: `${idx + 1}월` }));


const KpiTargetBulkContext = createContext(null);

/** 헤더 «전년도 비교하기» 누르고 있는 동안만 매트릭스 셀에 전년 대비(%) 표시 */
const KpiPriorYoyPeekContext = createContext(false);

function parseMoney(value) {
  const n = Number(revenueDigitsOnly(value));
  return Number.isFinite(n) ? n : 0;
}

/** 부서 DFS(조직도) 순 → 같은 팀 내 이름 순 */
function buildStaffTargetGroups(rows, departmentRowsInTreeOrder = []) {
  const orderMap = new Map();
  (departmentRowsInTreeOrder || []).forEach((row, i) => {
    const id = String(row?.id ?? '').trim();
    if (id) orderMap.set(id, i);
  });
  const treeLen = orderMap.size;
  const deptRank = (teamKey) => {
    const k = String(teamKey ?? '').trim();
    if (!k || k === '_') return treeLen + 2;
    if (orderMap.has(k)) return orderMap.get(k);
    return treeLen + 1;
  };
  const list = [...(rows || [])];
  list.sort((a, b) => {
    const ka = String(a.teamKey ?? a.department ?? '_');
    const kb = String(b.teamKey ?? b.department ?? '_');
    const ra = deptRank(ka);
    const rb = deptRank(kb);
    if (ra !== rb) return ra - rb;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  });
  const groups = [];
  for (const s of list) {
    const key = String(s.teamKey ?? s.department ?? '_');
    const label = String(s.teamLabel ?? s.department ?? '팀').trim() || '팀';
    const prev = groups[groups.length - 1];
    if (!prev || prev.teamKey !== key) {
      groups.push({ teamKey: key, teamLabel: label, members: [s] });
    } else {
      prev.members.push(s);
    }
  }
  return groups;
}

function sumRange(arr, startIdx, endIdx) {
  let sum = 0;
  for (let i = startIdx; i <= endIdx; i += 1) {
    sum += Number(arr?.[i] || 0);
  }
  return sum;
}

function quarterValues(monthly) {
  return [sumRange(monthly, 0, 2), sumRange(monthly, 3, 5), sumRange(monthly, 6, 8), sumRange(monthly, 9, 11)];
}

function halfValues(monthly) {
  return [sumRange(monthly, 0, 5), sumRange(monthly, 6, 11)];
}

function yearlyValue(monthly) {
  return sumRange(monthly, 0, 11);
}

function normalizeBulkKey(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function inferBulkRowKey(label) {
  const text = normalizeBulkKey(label);
  if (!text) return 'unknown-row';
  if (text.includes('회사')) return 'company-revenue';
  if (/^(연간|상반기|하반기|\d+분기|\d+월)$/.test(text)) return 'company-revenue';
  const periodIndex = text.search(/\s(연간?|상반기|하반기|Q\d+|\d+분기|\d+월)/);
  if (periodIndex > 0) return text.slice(0, periodIndex);
  return text;
}

function normalizeRoundPlace(value) {
  const n = Math.max(1, Math.round(Number(String(value ?? '').replace(/\D/g, '')) || 1));
  return n;
}

function roundKpiAmountByMode(value, place, mode) {
  const p = normalizeRoundPlace(place);
  const n = Math.max(0, Number(value) || 0);
  if (mode === 'ceil') return Math.ceil(n / p) * p;
  if (mode === 'floor') return Math.floor(n / p) * p;
  return Math.round(n / p) * p;
}

function formatKpiDraftWhileTyping(value, metric) {
  const raw = String(value ?? '');
  if (!raw) return '';
  // 수식 입력은 그대로 둬야 `*1.2`, `=10+20` 같은 엑셀식 입력이 깨지지 않습니다.
  if (/[+\-*/().=]/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return metric === 'revenue' ? formatRevenueDisplay(digits) : Number(digits).toLocaleString('ko-KR');
}

/** 전년 동일 셀 목표 대비 증감률(작은 보조 표시) */
function KpiTargetYoyHint({ current, prior }) {
  const c = Math.max(0, Math.round(Number(current) || 0));
  const p = Math.max(0, Math.round(Number(prior) || 0));
  if (p === 0 && c === 0) return null;
  if (p === 0) {
    return (
      <span className="kpi-target-yoy kpi-target-yoy--neutral" title="전년 동기간 목표가 없거나 0원입니다.">
        —
      </span>
    );
  }
  const pct = ((c - p) / p) * 100;
  const absPct = Math.abs(pct);
  const fmt =
    absPct >= 10 || absPct === 0 ? `${Math.round(pct)}` : String(Math.round(pct * 10) / 10);
  const sign = pct > 0 ? '+' : '';
  const tone = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return (
    <span className={`kpi-target-yoy kpi-target-yoy--${tone}`} title={`전년 대비 ${sign}${fmt}%`}>
      {sign}
      {fmt}%
    </span>
  );
}

/** 엑셀식: =10+20*2, *1.2, +1000, ( ) 사칙연산·콤마·Enter 확정 */
function isKpiExprEditingKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return true;
  const key = String(event.key || '');
  if (key.length === 1 && /[0-9+\-*/().,=]/.test(key)) return true;
  return [
    'Backspace',
    'Delete',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Tab',
    'Home',
    'End',
    'Enter',
    'NumpadEnter'
  ].includes(key);
}

/**
 * ①②③·팀/개인 카드 공통: 포커스 중에는 자유 입력, Enter/Blur 시 식 계산 후 숫자만 부모로 전달.
 */
function KpiTargetExprInput({
  numericValue,
  metric,
  onCommitDigits,
  disabled,
  warn,
  ariaLabel,
  className = '',
  placeholder = '',
  pattern,
  inputMode: inputModeProp,
  bulkCellKey,
  bulkRowKey
}) {
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const baseRef = useRef(0);
  const commitLock = useRef(false);
  const inputRef = useRef(null);
  const bulk = useContext(KpiTargetBulkContext);

  const rounded = Math.max(0, Math.round(Number(numericValue) || 0));
  const cellKey = normalizeBulkKey(bulkCellKey || ariaLabel || className);
  const rowKey = normalizeBulkKey(bulkRowKey || inferBulkRowKey(ariaLabel));

  const commit = () => {
    if (commitLock.current) return;
    commitLock.current = true;
    try {
      const digits = digitsFromEvaluatedKpiAmount(draft, baseRef.current);
      const nextValue = Math.max(0, Math.round(Number(digits) || 0));
      if (nextValue !== Math.max(0, Math.round(Number(baseRef.current) || 0))) {
        onCommitDigits(String(nextValue));
      }
    } finally {
      setFocused(false);
      setDraft('');
      queueMicrotask(() => {
        commitLock.current = false;
      });
    }
  };

  const displayWhenBlurred =
    metric === 'revenue' ? formatRevenueDisplay(String(rounded)) : formatIntDisplay(numericValue);
  const displayValue = focused ? draft : displayWhenBlurred;

  const inputMode =
    inputModeProp || (metric === 'revenue' ? 'text' : 'numeric');
  const selected = Boolean(bulk?.isSelected(cellKey));

  useEffect(() => {
    if (!bulk || !cellKey) return undefined;
    return bulk.registerCell(cellKey, {
      key: cellKey,
      rowKey,
      label: ariaLabel || cellKey,
      value: rounded,
      disabled: Boolean(disabled),
      element: inputRef.current,
      commitDigits: onCommitDigits
    });
  }, [ariaLabel, bulk, cellKey, disabled, onCommitDigits, rounded, rowKey]);

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode={inputMode}
      className={`${className}${warn ? ' is-warn' : ''}${selected ? ' is-bulk-selected' : ''}`}
      value={displayValue}
      placeholder={placeholder}
      pattern={pattern}
      title="예: *1.2, +1000, =10+20*2 (Enter 또는 다른 칸으로 이동 시 확정)"
      disabled={disabled}
      aria-label={ariaLabel}
      onFocus={() => {
        baseRef.current = rounded;
        setFocused(true);
        setDraft(displayWhenBlurred);
      }}
      onChange={(e) => setDraft(formatKpiDraftWhileTyping(e.target.value, metric))}
      onBlur={commit}
      onMouseDown={(e) => {
        if (e.button !== 2 || disabled || !bulk) return;
        e.preventDefault();
        bulk.beginRightDrag(cellKey, rowKey);
      }}
      onMouseEnter={(e) => {
        if (disabled || !bulk || !(e.buttons & 2)) return;
        bulk.extendRightDrag(cellKey, rowKey);
      }}
      onContextMenu={(e) => {
        if (disabled || !bulk) return;
        e.preventDefault();
        bulk.openMenu(e, cellKey, rowKey);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'NumpadEnter') {
          e.preventDefault();
          commit();
          e.currentTarget.blur();
        } else if (!isKpiExprEditingKey(e)) {
          e.preventDefault();
        }
      }}
    />
  );
}

function KpiTargetBulkProvider({ children }) {
  const registryRef = useRef(new Map());
  const dragRef = useRef(false);
  const dragStartKeyRef = useRef('');
  const selectedKeysRef = useRef(new Set());
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [activeRowKey, setActiveRowKey] = useState('');
  const [menu, setMenu] = useState(null);
  const [roundPlace, setRoundPlace] = useState('1000');

  const updateSelectedKeys = useCallback((nextKeys) => {
    const next = nextKeys instanceof Set ? nextKeys : new Set(nextKeys || []);
    selectedKeysRef.current = next;
    setSelectedKeys(next);
  }, []);

  const registerCell = useCallback((key, meta) => {
    if (!key) return () => {};
    registryRef.current.set(key, meta);
    return () => {
      registryRef.current.delete(key);
    };
  }, []);

  const isSelected = useCallback((key) => selectedKeys.has(key), [selectedKeys]);

  const selectRectBetween = useCallback((startKey, endKey) => {
    const start = registryRef.current.get(startKey);
    const end = registryRef.current.get(endKey);
    const startRect = start?.element?.getBoundingClientRect?.();
    const endRect = end?.element?.getBoundingClientRect?.();
    if (!startRect || !endRect) {
      return new Set([startKey, endKey].filter(Boolean));
    }

    const left = Math.min(startRect.left, endRect.left);
    const right = Math.max(startRect.right, endRect.right);
    const top = Math.min(startRect.top, endRect.top);
    const bottom = Math.max(startRect.bottom, endRect.bottom);
    const next = new Set();

    registryRef.current.forEach((meta, key) => {
      if (meta?.disabled) return;
      const r = meta?.element?.getBoundingClientRect?.();
      if (!r) return;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx >= left && cx <= right && cy >= top && cy <= bottom) {
        next.add(key);
      }
    });

    if (next.size === 0) next.add(endKey);
    return next;
  }, []);

  const beginRightDrag = useCallback((cellKey, rowKey) => {
    if (!cellKey) return;
    dragRef.current = true;
    dragStartKeyRef.current = cellKey;
    setActiveRowKey(rowKey || '');
    setMenu(null);
    updateSelectedKeys(new Set([cellKey]));
  }, [updateSelectedKeys]);

  const extendRightDrag = useCallback((cellKey, rowKey) => {
    if (!dragRef.current || !cellKey) return;
    setActiveRowKey((cur) => cur || rowKey || '');
    updateSelectedKeys(selectRectBetween(dragStartKeyRef.current || cellKey, cellKey));
  }, [selectRectBetween, updateSelectedKeys]);

  const openMenu = useCallback((event, cellKey, rowKey) => {
    dragRef.current = false;
    const dragStartKey = dragStartKeyRef.current || cellKey;
    dragStartKeyRef.current = '';
    const dragSelection = selectRectBetween(dragStartKey, cellKey);
    const selectedAlready = dragSelection.has(cellKey) || selectedKeysRef.current.has(cellKey);
    if (!selectedAlready) {
      updateSelectedKeys(new Set([cellKey]));
    } else {
      updateSelectedKeys(dragSelection);
    }
    setActiveRowKey(rowKey || '');
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 260),
      y: Math.min(event.clientY, window.innerHeight - 220),
      cellKey,
      rowKey: rowKey || ''
    });
  }, [selectRectBetween, updateSelectedKeys]);

  const selectRow = useCallback((rowKey) => {
    const rk = normalizeBulkKey(rowKey);
    if (!rk) return;
    const next = new Set();
    registryRef.current.forEach((meta, key) => {
      if (normalizeBulkKey(meta?.rowKey) === rk && !meta?.disabled) next.add(key);
    });
    if (next.size > 0) {
      updateSelectedKeys(next);
      setActiveRowKey(rk);
    }
  }, [updateSelectedKeys]);

  const clearSelection = useCallback(() => {
    selectedKeysRef.current = new Set();
    dragRef.current = false;
    dragStartKeyRef.current = '';
    setSelectedKeys(new Set());
    setActiveRowKey('');
    setMenu(null);
  }, []);

  const applyRoundMode = useCallback((mode) => {
    const keys = selectedKeys.size > 0 ? [...selectedKeys] : menu?.cellKey ? [menu.cellKey] : [];
    const place = normalizeRoundPlace(roundPlace);
    keys.forEach((key) => {
      const meta = registryRef.current.get(key);
      if (!meta || meta.disabled || typeof meta.commitDigits !== 'function') return;
      const next = roundKpiAmountByMode(meta.value, place, mode);
      meta.commitDigits(String(Math.max(0, Math.round(next))));
    });
    setMenu(null);
  }, [menu?.cellKey, roundPlace, selectedKeys]);

  useEffect(() => {
    const stopDrag = () => {
      dragRef.current = false;
    };
    window.addEventListener('mouseup', stopDrag);
    return () => window.removeEventListener('mouseup', stopDrag);
  }, []);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      if (!menu && selectedKeysRef.current.size === 0 && !dragRef.current) return;
      event.preventDefault();
      clearSelection();
    };
    window.addEventListener('keydown', closeOnEscape, true);
    return () => window.removeEventListener('keydown', closeOnEscape, true);
  }, [clearSelection, menu]);

  const contextValue = useMemo(
    () => ({
      registerCell,
      isSelected,
      beginRightDrag,
      extendRightDrag,
      openMenu
    }),
    [beginRightDrag, extendRightDrag, isSelected, openMenu, registerCell]
  );

  const selectedCount = selectedKeys.size;
  const rowCellCount = useMemo(() => {
    if (!activeRowKey) return 0;
    let count = 0;
    registryRef.current.forEach((meta) => {
      if (normalizeBulkKey(meta?.rowKey) === activeRowKey && !meta?.disabled) count += 1;
    });
    return count;
  }, [activeRowKey, menu]);

  return (
    <KpiTargetBulkContext.Provider value={contextValue}>
      {children}
      {menu ? (
        <div
          className="kpi-target-bulk-menu"
          style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="kpi-target-bulk-menu-title">선택 셀 반올림</div>
          <p className="kpi-target-bulk-menu-help">
            우클릭 드래그로 시작 셀과 현재 셀 사이의 사각 영역을 선택한 뒤 자리수와 방식을 적용합니다.
          </p>
          <label className="kpi-target-bulk-menu-field">
            <span>자리수</span>
            <input
              type="text"
              inputMode="numeric"
              list="kpi-round-place-options"
              value={Number(roundPlace || 1).toLocaleString('ko-KR')}
              onChange={(e) => setRoundPlace(e.target.value.replace(/\D/g, '') || '1')}
              aria-label="반올림 자리수"
            />

          </label>
          <div className="kpi-target-bulk-menu-grid" aria-label="반올림 방식">
            <button type="button" onClick={() => applyRoundMode('round')}>반올림</button>
            <button type="button" onClick={() => applyRoundMode('ceil')}>올림</button>
            <button type="button" onClick={() => applyRoundMode('floor')}>버림</button>
          </div>
          <div className="kpi-target-bulk-menu-actions">
            <button type="button" onClick={() => selectRow(menu.rowKey)} disabled={!menu.rowKey || rowCellCount === 0}>
              이 행 전체 선택
            </button>
            <button type="button" onClick={clearSelection}>취소</button>
          </div>
          <div className="kpi-target-bulk-menu-count">
            선택 {selectedCount || 1}칸{activeRowKey && rowCellCount ? ` · 행 ${rowCellCount}칸` : ''}
          </div>
        </div>
      ) : null}
    </KpiTargetBulkContext.Provider>
  );
}

const normCascade = normCascadeBlock;

function cascadeBlockFromMonthly(monthly) {
  const month = Array.from({ length: 12 }, (_, i) => Math.max(0, Math.round(Number(monthly?.[i]) || 0)));
  return {
    revenue: {
      annual: yearlyValue(month),
      semi: halfValues(month),
      quarter: quarterValues(month),
      month
    }
  };
}

/** 조직도 DFS 순서 + depth 기준 개요 번호 (1 / 1.1 / 1.1.1 …) */
function buildDeptOutlineLabels(treeRows) {
  const out = new Map();
  const stack = [];
  for (const row of treeRows || []) {
    const d = Math.max(0, Number(row.depth) || 0);
    while (stack.length > d + 1) stack.pop();
    while (stack.length < d + 1) stack.push(0);
    stack[d] = (stack[d] || 0) + 1;
    for (let i = d + 1; i < stack.length; i += 1) stack[i] = 0;
    while (stack.length > d + 1) stack.pop();
    out.set(String(row.id), stack.slice(0, d + 1).join('.'));
  }
  return out;
}

function formatIntDisplay(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return v ? v.toLocaleString('ko-KR') : '';
}

const Q_MONTH_IDX = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [9, 10, 11]
];

/**
 * Sample Design `kpi-target-modal.html`과 동일 계층: 연간 → 상반기(Q1·Q2·월) → 하반기(Q3·Q4·월)
 */
function CascadeSampleLayout({
  yearLabel,
  metric,
  m,
  disabled,
  achSubline,
  onAnnual,
  onSemi,
  onQuarter,
  onMonth,
  rootMismatch = null
}) {
  const isRev = metric === 'revenue';
  const flags = computeNeedSyncFlags({
    month: m.month,
    quarter: m.quarter,
    semi: m.semi,
    annual: m.annual
  });
  const rm = rootMismatch && typeof rootMismatch === 'object' ? rootMismatch : null;
  const qWarn = (qi) => Boolean(flags.quarter[qi] || rm?.quarter?.[qi]);
  const mWarn = (mi) => Boolean(flags.month[mi] || rm?.month?.[mi]);
  const semiWarn = (si) => Boolean(flags.semi[si] || rm?.semi?.[si]);
  const annualWarn = Boolean(flags.annual || rm?.annual);

  const renderQuarterCard = (qi, tone) => (
    <div
      key={qi}
      className={`kpi-target-sample-q-card kpi-target-sample-q-card--${tone}${
        qWarn(qi) ? ' kpi-target-sample-q-card--warn' : ''
      }`}
    >
      <div className="kpi-target-sample-q-head">
        <span className="kpi-target-sample-q-title">{`${qi + 1}분기 (Q${qi + 1})`}</span>
        <KpiTargetExprInput
          metric={metric}
          numericValue={m.quarter?.[qi]}
          onCommitDigits={(digits) => onQuarter(qi, digits)}
          disabled={disabled}
          warn={qWarn(qi)}
          className="kpi-target-sample-q-input"
          aria-label={`Q${qi + 1} ${isRev ? '매출' : '프로젝트'}`}
        />
      </div>
      <div className="kpi-target-sample-q-months">
        {Q_MONTH_IDX[qi].map((mi) => (
          <div
            key={mi}
            className={`kpi-target-sample-month-cell${mWarn(mi) ? ' kpi-target-sample-month-cell--warn' : ''}`}
          >
            <label className="kpi-target-sample-month-label">{`${mi + 1}월`}</label>
            <KpiTargetExprInput
              metric={metric}
              numericValue={m.month?.[mi]}
              onCommitDigits={(digits) => onMonth(mi, digits)}
              disabled={disabled}
              warn={mWarn(mi)}
              className="kpi-target-sample-month-input"
              aria-label={`${mi + 1}월 ${isRev ? '매출' : '프로젝트'}`}
            />
            {flags.month[mi] ? <span className="kpi-target-sample-month-warn">상위와 불일치</span> : null}
            {rm?.month?.[mi] ? (
              <span className="kpi-target-sample-month-warn kpi-target-sample-month-warn--root">
                회사·부서 전체 합 불일치
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="kpi-target-sample-metric">
      <section className="kpi-target-sample-annual">
        <div className="kpi-target-sample-section-head">
          <span className="kpi-target-sample-rail kpi-target-sample-rail--primary" aria-hidden />
          <h4 className="kpi-target-sample-h4">
            {yearLabel} 연간 {isRev ? '매출' : '프로젝트'} 목표
          </h4>
        </div>
        <div
          className={`kpi-target-sample-annual-card${annualWarn ? ' kpi-target-sample-annual-card--warn' : ''}${
            rm?.annual ? ' kpi-target-sample-annual-card--root-mismatch' : ''
          }`}
        >
          <label className="kpi-target-sample-field-label">{isRev ? '연간 목표액(원)' : '연간 목표(개)'}</label>
          <KpiTargetExprInput
            metric={metric}
            numericValue={m.annual}
            onCommitDigits={onAnnual}
            disabled={disabled}
            warn={annualWarn}
            className="kpi-target-sample-annual-input"
            placeholder={isRev ? '목표를 입력하세요' : '개수를 입력하세요'}
            aria-label={isRev ? '연간 매출' : '연간 프로젝트'}
          />
          {achSubline ? <p className="kpi-target-sample-ach">{achSubline}</p> : null}
        </div>
      </section>

      <section className="kpi-target-sample-half">
        <div className="kpi-target-sample-half-top">
          <div className="kpi-target-sample-section-head">
            <span className="kpi-target-sample-rail kpi-target-sample-rail--secondary" aria-hidden />
            <h4 className="kpi-target-sample-h4">상반기 (1H) 성과 목표</h4>
          </div>
          <div className="kpi-target-sample-half-sum">
            <span className="kpi-target-sample-sum-label">상반기 합계</span>
            <KpiTargetExprInput
              metric={metric}
              numericValue={m.semi?.[0]}
              onCommitDigits={(digits) => onSemi(0, digits)}
              disabled={disabled}
              warn={false}
              className={`kpi-target-sample-sum-input kpi-target-sample-sum-input--secondary${
                semiWarn(0) ? ' kpi-target-sample-sum-input--warn' : ''
              }`}
              aria-label="상반기 합계"
            />
          </div>
        </div>
        <div className="kpi-target-sample-q-stack">{renderQuarterCard(0, 'q1')}{renderQuarterCard(1, 'q2')}</div>
      </section>

      <section className="kpi-target-sample-half">
        <div className="kpi-target-sample-half-top">
          <div className="kpi-target-sample-section-head">
            <span className="kpi-target-sample-rail kpi-target-sample-rail--tertiary" aria-hidden />
            <h4 className="kpi-target-sample-h4">하반기 (2H) 성과 목표</h4>
          </div>
          <div className="kpi-target-sample-half-sum">
            <span className="kpi-target-sample-sum-label">하반기 합계</span>
            <KpiTargetExprInput
              metric={metric}
              numericValue={m.semi?.[1]}
              onCommitDigits={(digits) => onSemi(1, digits)}
              disabled={disabled}
              warn={false}
              className={`kpi-target-sample-sum-input kpi-target-sample-sum-input--tertiary${
                semiWarn(1) ? ' kpi-target-sample-sum-input--warn' : ''
              }`}
              aria-label="하반기 합계"
            />
          </div>
        </div>
        <div className="kpi-target-sample-q-stack">{renderQuarterCard(2, 'q3')}{renderQuarterCard(3, 'q4')}</div>
      </section>
    </div>
  );
}

/** 회사·부서 카드: 매출(revenue)만 */
function RevenueCascadeLayout({
  yearLabel,
  block,
  disabled,
  revenueAchSubline,
  onAnnualRevenue,
  onMetricSemi,
  onMetricQuarter,
  onMetricMonth,
  rootSumMismatch = null
}) {
  const safeBlock = normCascade(block);
  const rev = safeBlock.revenue;
  return (
    <CascadeSampleLayout
      yearLabel={yearLabel}
      metric="revenue"
      m={rev}
      disabled={disabled}
      achSubline={revenueAchSubline}
      onAnnual={onAnnualRevenue}
      onSemi={(si, v) => onMetricSemi('revenue', si, v)}
      onQuarter={(qi, v) => onMetricQuarter('revenue', qi, v)}
      onMonth={(mi, v) => onMetricMonth('revenue', mi, v)}
      rootMismatch={rootSumMismatch?.revenue || null}
    />
  );
}

/** ① 회사 매출 격자: ②와 동일 24열(월 span 2×12), 좌측 부서열 없음 */
function CompanyRevenueGridTable({
  yearLabel,
  rev,
  priorRev = null,
  disabled,
  flags,
  rm,
  onAnnualRevenue,
  onMetricSemi,
  onMetricQuarter,
  onMetricMonth
}) {
  const dataColSpan = 24;
  const annualWarn = Boolean(flags.annual || rm?.annual);
  const semiWarn = (si) => Boolean(flags.semi[si] || rm?.semi?.[si]);
  const qWarn = (qi) => Boolean(flags.quarter[qi] || rm?.quarter?.[qi]);
  const mWarn = (mi) => Boolean(flags.month[mi] || rm?.month?.[mi]);
  const pr = priorRev && typeof priorRev === 'object' ? priorRev : null;

  const sectionHeader = (key, labels) => (
    <tr key={`${key}-header`} className="kpi-target-dept-section-header-row">
      {labels.map((item) => (
        <th key={`${key}-${item.label}`} scope="colgroup" colSpan={item.span} className="kpi-unified-band">
          {item.label}
        </th>
      ))}
    </tr>
  );

  const periodCell = ({ key, value, warn, label, span, size, onChange, priorValue }) => (
    <td
      key={key}
      colSpan={span}
      className={`kpi-matrix-td kpi-target-dept-unified-td kpi-target-dept-section-period-cell kpi-target-dept-section-period-cell--${size}`}
    >
      {deptMatrixCellInput({
        value,
        metric: 'revenue',
        disabled,
        warn,
        ariaLabel: label,
        onChange,
        classExtra: `kpi-target-dept-section-num kpi-target-dept-section-num--${size}`,
        priorValue: pr ? priorValue : undefined
      })}
    </td>
  );

  return (
    <div className="kpi-target-dept-unified-wrap">
      <div className="kpi-target-all-dept-matrix-wrap kpi-target-dept-unified-scroll">
        <table
          className="kpi-target-all-dept-matrix kpi-target-dept-unified-matrix kpi-target-dept-sectioned-matrix kpi-company-revenue-sectioned"
          role="grid"
          aria-label={`${yearLabel} 회사 매출 목표`}
        >
          <tbody>
            {sectionHeader('annual', [{ label: '연간', span: dataColSpan }])}
            <tr key="company-annual" className="is-stripe-even is-metric-revenue">
              {periodCell({
                key: 'co-annual',
                span: dataColSpan,
                value: rev.annual,
                warn: annualWarn,
                label: `${yearLabel} 회사 연간 매출 목표`,
                disabled,
                onChange: onAnnualRevenue,
                size: 'annual',
                priorValue: pr?.annual
              })}
            </tr>
            {sectionHeader('semi', [
              { label: '상반기', span: 12 },
              { label: '하반기', span: 12 }
            ])}
            <tr key="company-semi" className="is-stripe-odd is-metric-revenue">
              {[0, 1].map((si) =>
                periodCell({
                  key: `co-semi-${si}`,
                  span: 12,
                  value: rev.semi?.[si],
                  warn: semiWarn(si),
                  label: si === 0 ? '회사 상반기 매출' : '회사 하반기 매출',
                  disabled,
                  onChange: (v) => onMetricSemi('revenue', si, v),
                  size: 'semi',
                  priorValue: pr?.semi?.[si]
                })
              )}
            </tr>
            {sectionHeader('quarter', [
              { label: '1분기', span: 6 },
              { label: '2분기', span: 6 },
              { label: '3분기', span: 6 },
              { label: '4분기', span: 6 }
            ])}
            <tr key="company-quarter" className="is-stripe-even is-metric-revenue">
              {[0, 1, 2, 3].map((qi) =>
                periodCell({
                  key: `co-q-${qi}`,
                  span: 6,
                  value: rev.quarter?.[qi],
                  warn: qWarn(qi),
                  label: `회사 ${qi + 1}분기 매출`,
                  disabled,
                  onChange: (v) => onMetricQuarter('revenue', qi, v),
                  size: 'quarter',
                  priorValue: pr?.quarter?.[qi]
                })
              )}
            </tr>
            {sectionHeader(
              'month',
              Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1}월`, span: 2 }))
            )}
            <tr key="company-month" className="is-stripe-odd is-metric-revenue">
              {MONTH_COLUMNS.map((item) => {
                const mi = item.month - 1;
                return periodCell({
                  key: `co-m-${mi}`,
                  span: 2,
                  value: rev.month?.[mi],
                  warn: mWarn(mi),
                  label: `회사 ${item.label} 매출`,
                  disabled,
                  onChange: (v) => onMetricMonth('revenue', mi, v),
                  size: 'month',
                  priorValue: pr?.month?.[mi]
                });
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 회사 매출 한 줄: 연간·상·하반기·분기×4·월×19열 */
function CompanyRevenueWideTable({
  yearLabel,
  rev,
  priorRev = null,
  disabled,
  flags,
  rm,
  onAnnualRevenue,
  onMetricSemi,
  onMetricQuarter,
  onMetricMonth
}) {
  const pr = priorRev && typeof priorRev === 'object' ? priorRev : null;
  return (
    <div className="kpi-target-dept-unified-wrap">
      <div className="kpi-target-all-dept-matrix-wrap kpi-target-dept-unified-scroll">
        <table
          className="kpi-target-all-dept-matrix kpi-target-dept-unified-matrix kpi-company-revenue-wide"
          aria-label={`${yearLabel} 회사 매출 목표(한 줄)`}
        >
          <thead>
            <tr>
              <th scope="col" className="kpi-unified-band kpi-unified-band--annual">
                연간
              </th>
              <th scope="col" className="kpi-unified-band kpi-unified-band--semi">
                상반기
              </th>
              <th scope="col" className="kpi-unified-band kpi-unified-band--semi kpi-company-revenue-band--2h">
                하반기
              </th>
              {[1, 2, 3, 4].map((q) => (
                <th key={`wh-q${q}`} scope="col" className="kpi-unified-band kpi-unified-band--quarter">
                  {q}분기
                </th>
              ))}
              {MONTH_COLUMNS.map((item) => (
                <th key={`wh-m${item.month}`} scope="col" className="kpi-unified-band kpi-unified-band--month">
                  {item.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="kpi-matrix-td kpi-target-dept-unified-td">
                {deptMatrixCellInput({
                  value: rev.annual,
                  metric: 'revenue',
                  disabled,
                  warn: Boolean(flags.annual || rm?.annual),
                  ariaLabel: `${yearLabel} 연간 매출`,
                  onChange: onAnnualRevenue,
                  narrow: false,
                  priorValue: pr?.annual
                })}
              </td>
              {[0, 1].map((si) => (
                <td key={`w-semi-${si}`} className="kpi-matrix-td kpi-target-dept-unified-td">
                  {deptMatrixCellInput({
                    value: rev.semi?.[si],
                    metric: 'revenue',
                    disabled,
                    warn: Boolean(flags.semi[si] || rm?.semi?.[si]),
                    ariaLabel: si === 0 ? '상반기' : '하반기',
                    onChange: (v) => onMetricSemi('revenue', si, v),
                    priorValue: pr?.semi?.[si]
                  })}
                </td>
              ))}
              {[0, 1, 2, 3].map((qi) => (
                <td key={`w-q-${qi}`} className="kpi-matrix-td kpi-target-dept-unified-td">
                  {deptMatrixCellInput({
                    value: rev.quarter?.[qi],
                    metric: 'revenue',
                    disabled,
                    warn: Boolean(flags.quarter[qi] || rm?.quarter?.[qi]),
                    ariaLabel: `${qi + 1}분기`,
                    onChange: (v) => onMetricQuarter('revenue', qi, v),
                    priorValue: pr?.quarter?.[qi]
                  })}
                </td>
              ))}
              {MONTH_COLUMNS.map((item) => {
                const mi = item.month - 1;
                return (
                  <td key={`w-m-${mi}`} className="kpi-matrix-td kpi-target-dept-unified-td">
                    {deptMatrixCellInput({
                      value: rev.month?.[mi],
                      metric: 'revenue',
                      disabled,
                      warn: Boolean(flags.month[mi] || rm?.month?.[mi]),
                      ariaLabel: item.label,
                      onChange: (v) => onMetricMonth('revenue', mi, v),
                      priorValue: pr?.month?.[mi]
                    })}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompanyRevenueTableBlock({
  yearLabel,
  block,
  priorBlock = null,
  disabled,
  revenueAchSubline,
  onAnnualRevenue,
  onMetricSemi,
  onMetricQuarter,
  onMetricMonth,
  rootSumMismatch = null
}) {
  const [wideLayout, setWideLayout] = useState(false);
  const safeBlock = normCascade(block);
  const rev = safeBlock.revenue;
  const priorRev = priorBlock ? normCascade(priorBlock).revenue : null;
  const rm = rootSumMismatch?.revenue || null;
  const flags = computeNeedSyncFlags({
    month: rev.month,
    quarter: rev.quarter,
    semi: rev.semi,
    annual: rev.annual
  });

  const common = {
    yearLabel,
    rev,
    priorRev,
    disabled,
    flags,
    rm,
    onAnnualRevenue,
    onMetricSemi,
    onMetricQuarter,
    onMetricMonth
  };

  return (
    <div className="kpi-target-dept-team-matrix-root">
      <div className="kpi-company-revenue-block">
        <AllScopeDeptTeamMatrixToolbar
          wideLayout={wideLayout}
          onToggle={() => setWideLayout((w) => !w)}
          narrowModeDescription="4행 격자(연간→반기→분기→월)"
          wideModeDescription="한 줄(연간~12월)"
          titleWhenNarrow="한 줄(가로 전체)로 보기"
          titleWhenWide="4행 격자(연간→반기→분기·월)로 보기"
          buttonGoWideLabel="한 줄로 보기"
          buttonGoNarrowLabel="4행 격자"
        />
        {wideLayout ? <CompanyRevenueWideTable {...common} /> : <CompanyRevenueGridTable {...common} />}
        {revenueAchSubline ? <p className="kpi-target-sample-ach kpi-company-revenue-ach">{revenueAchSubline}</p> : null}
      </div>
    </div>
  );
}

/** ② 표 공통: 입력·부서명·행 컨텍스트(엑셀식 연산) */
function deptMatrixCellInput(opts) {
  return <KpiTargetMatrixCellInput {...opts} />;
}

function KpiTargetMatrixCellInput({
  value,
  metric,
  onChange,
  disabled,
  warn,
  ariaLabel,
  narrow = true,
  classExtra = '',
  dashMode = false,
  priorValue
}) {
  const peekActive = useContext(KpiPriorYoyPeekContext);
  const hasPrior = priorValue !== undefined && priorValue !== null;
  const showYoy = peekActive && hasPrior;
  const yoyEl = showYoy ? (
    <span className="kpi-target-yoy-wrap">
      <KpiTargetYoyHint current={value} prior={priorValue} />
    </span>
  ) : null;
  if (dashMode) {
    if (!peekActive || !hasPrior) {
      return (
        <span className="kpi-target-matrix-dash" aria-hidden="true">
          -
        </span>
      );
    }
    return (
      <div className="kpi-target-matrix-cell-stack kpi-target-matrix-cell-stack--peek-yoy kpi-target-matrix-cell-stack--dash">
        <span className="kpi-target-matrix-dash" aria-hidden="true">
          -
        </span>
        {yoyEl}
      </div>
    );
  }
  const cls = `kpi-matrix-num${narrow ? ' kpi-matrix-num--narrow' : ''} kpi-target-dept-unified-num${classExtra ? ` ${classExtra}` : ''}`;
  if (!peekActive || !hasPrior) {
    return (
      <KpiTargetExprInput
        numericValue={value}
        metric={metric}
        onCommitDigits={onChange}
        disabled={disabled}
        warn={warn}
        ariaLabel={ariaLabel}
        className={cls}
      />
    );
  }
  return (
    <div className="kpi-target-matrix-cell-stack kpi-target-matrix-cell-stack--peek-yoy">
      <KpiTargetExprInput
        numericValue={value}
        metric={metric}
        onCommitDigits={onChange}
        disabled={disabled}
        warn={warn}
        ariaLabel={ariaLabel}
        className={cls}
      />
      {yoyEl}
    </div>
  );
}

function deptMatrixRenderNameCell(row, depth, ro, outlineById) {
  const oid = outlineById?.get(String(row.id)) || '';
  return (
    <th
      scope="row"
      className={`kpi-matrix-sticky-col kpi-matrix-dept-name ${depth > 0 ? 'is-child' : 'is-root'}`}
      style={{ paddingLeft: `${0.45 + depth * 0.45}rem` }}
    >
      <span className="kpi-matrix-outline" title="조직 개요 번호">
        {oid}
      </span>
      <span className="kpi-matrix-dept-label">{row.label}</span>
      {ro ? <span className="kpi-matrix-dept-ro">조회</span> : null}
    </th>
  );
}

function deptMatrixRowCtx(row, deptMap, loading, editable, rootSumMismatch, excludeDeptIdSet) {
  const ro = Boolean(row.readOnly);
  const depth = Math.max(0, Number(row.depth) || 0);
  const id = String(row.id || '').trim();
  const excluded = Boolean(excludeDeptIdSet?.has(id));
  const dis = !editable || loading || ro || excluded;
  const blk = normCascade(deptMap[row.id]);
  const rev = blk.revenue;
  const revFlags = computeNeedSyncFlags({
    month: rev.month,
    quarter: rev.quarter,
    semi: rev.semi,
    annual: rev.annual
  });
  const rm = rootSumMismatch && depth === 0 ? rootSumMismatch : null;
  return { row, depth, ro, dis, rev, revFlags, rm, excluded };
}

function deptMatrixSubRev(key, subClass) {
  const c = subClass || 'kpi-target-dept-unified-sub';
  return (
    <th key={`${key}-r`} scope="col" className={`kpi-matrix-th-sub ${c}`}>
      매출
    </th>
  );
}

/** 전체 탭 ② 옵션: 가로 한 줄(연간~12월 전부) */
function AllScopeDeptWideUnifiedTable({
  year,
  allDepartmentRows,
  deptMap,
  priorDeptMap = null,
  outlineById,
  loading,
  editable,
  onDeptAnnualRevenue,
  onDeptMetricSemi,
  onDeptMetricQuarter,
  onDeptMetricMonth,
  rootSumMismatch,
  excludeDeptIdSet = null
}) {
  const priorMap = priorDeptMap && typeof priorDeptMap === 'object' ? priorDeptMap : null;
  const priorRevFor = (deptId) => (priorMap ? normCascade(priorMap[deptId]).revenue : null);
  const thead = (
    <>
      <tr>
        <th scope="col" rowSpan={2} className="kpi-matrix-sticky-col kpi-matrix-corner kpi-target-dept-unified-corner">
          부서
        </th>
        <th scope="colgroup" colSpan={1} className="kpi-unified-band kpi-unified-band--annual">
          연간
        </th>
        <th scope="colgroup" colSpan={1} className="kpi-unified-band kpi-unified-band--semi">
          상반기
        </th>
        <th scope="colgroup" colSpan={1} className="kpi-unified-band kpi-unified-band--semi">
          하반기
        </th>
        {[1, 2, 3, 4].map((q) => (
          <th key={`band-q${q}`} scope="colgroup" colSpan={1} className="kpi-unified-band kpi-unified-band--quarter">
            {q}분기
          </th>
        ))}
        {Array.from({ length: 12 }, (_, i) => (
          <th key={`band-m${i}`} scope="colgroup" colSpan={1} className="kpi-unified-band kpi-unified-band--month">
            {i + 1}월
          </th>
        ))}
      </tr>
      <tr>
        {deptMatrixSubRev('ann')}
        {deptMatrixSubRev('s0')}
        {deptMatrixSubRev('s1')}
        {[0, 1, 2, 3].map((qi) => deptMatrixSubRev(`q${qi}`))}
        {Array.from({ length: 12 }, (_, mi) => deptMatrixSubRev(`m${mi}`))}
      </tr>
    </>
  );

  const colSpanEmpty = 1 + 1 + 2 + 4 + 12;

  const body =
    allDepartmentRows.length === 0 ? (
      <tr>
        <td colSpan={colSpanEmpty} className="kpi-target-all-depts-empty">
          표시할 부서가 없습니다.
        </td>
      </tr>
    ) : (
      allDepartmentRows.map((row) => {
        const ctx = deptMatrixRowCtx(row, deptMap, loading, editable, rootSumMismatch, excludeDeptIdSet);
        const { depth, ro, dis, rev, revFlags, rm, excluded } = ctx;
        const pr = priorRevFor(row.id);
        return (
          <tr key={`${row.id}-unified`} className={ro ? 'is-readonly' : ''}>
            {deptMatrixRenderNameCell(row, depth, ro, outlineById)}
            <td className="kpi-matrix-td kpi-target-dept-unified-td">
              {deptMatrixCellInput({
                value: rev.annual,
                metric: 'revenue',
                disabled: dis,
                warn: revFlags.annual || Boolean(rm?.revenue?.annual),
                ariaLabel: `${row.label} 연 매출`,
                onChange: (v) => onDeptAnnualRevenue(row.id, v),
                narrow: true,
                dashMode: excluded,
                priorValue: pr?.annual
              })}
            </td>
            <td className="kpi-matrix-td kpi-target-dept-unified-td">
              {deptMatrixCellInput({
                value: rev.semi?.[0],
                metric: 'revenue',
                disabled: dis,
                warn: revFlags.semi[0] || Boolean(rm?.revenue?.semi?.[0]),
                ariaLabel: `${row.label} 상반기 매출`,
                onChange: (v) => onDeptMetricSemi(row.id, 'revenue', 0, v),
                dashMode: excluded,
                priorValue: pr?.semi?.[0]
              })}
            </td>
            <td className="kpi-matrix-td kpi-target-dept-unified-td">
              {deptMatrixCellInput({
                value: rev.semi?.[1],
                metric: 'revenue',
                disabled: dis,
                warn: revFlags.semi[1] || Boolean(rm?.revenue?.semi?.[1]),
                ariaLabel: `${row.label} 하반기 매출`,
                onChange: (v) => onDeptMetricSemi(row.id, 'revenue', 1, v),
                dashMode: excluded,
                priorValue: pr?.semi?.[1]
              })}
            </td>
            {[0, 1, 2, 3].map((qi) => (
              <td key={`${row.id}-rq${qi}`} className="kpi-matrix-td kpi-target-dept-unified-td">
                {deptMatrixCellInput({
                  value: rev.quarter?.[qi],
                  metric: 'revenue',
                  disabled: dis,
                  warn: revFlags.quarter[qi] || Boolean(rm?.revenue?.quarter?.[qi]),
                  ariaLabel: `${row.label} Q${qi + 1} 매출`,
                  onChange: (v) => onDeptMetricQuarter(row.id, 'revenue', qi, v),
                  dashMode: excluded,
                  priorValue: pr?.quarter?.[qi]
                })}
              </td>
            ))}
            {Array.from({ length: 12 }, (_, mi) => (
              <td key={`${row.id}-rm${mi}`} className="kpi-matrix-td kpi-target-dept-unified-td">
                {deptMatrixCellInput({
                  value: rev.month?.[mi],
                  metric: 'revenue',
                  disabled: dis,
                  warn: revFlags.month[mi] || Boolean(rm?.revenue?.month?.[mi]),
                  ariaLabel: `${row.label} ${mi + 1}월 매출`,
                  onChange: (v) => onDeptMetricMonth(row.id, 'revenue', mi, v),
                  dashMode: excluded,
                  priorValue: pr?.month?.[mi]
                })}
              </td>
            ))}
          </tr>
        );
      })
    );

  return (
    <div className="kpi-target-dept-unified-wrap">
      <div className="kpi-target-all-dept-matrix-wrap kpi-target-dept-unified-scroll">
        <table
          className="kpi-target-all-dept-matrix kpi-target-dept-unified-matrix"
          aria-label={`${year}년 부서별 연·반기·분기·월 목표(가로 전체)`}
        >
          <thead>{thead}</thead>
          <tbody>{body}</tbody>
        </table>
      </div>
    </div>
  );
}

/** 전체 탭 ② 기본: KPI.xlsx처럼 한 테이블 안에서 연간 → 반기 → 분기 → 월 섹션이 아래로 이어짐 */
function AllScopeDeptCompactHalfSplit({
  year,
  allDepartmentRows,
  deptMap,
  priorDeptMap = null,
  outlineById,
  loading,
  editable,
  onDeptAnnualRevenue,
  onDeptMetricSemi,
  onDeptMetricQuarter,
  onDeptMetricMonth,
  rootSumMismatch,
  excludeDeptIdSet = null
}) {
  const dataColSpan = 24;
  const totalColSpan = dataColSpan + 1;
  const [hoveredDeptSectionKey, setHoveredDeptSectionKey] = useState('');
  const priorMap = priorDeptMap && typeof priorDeptMap === 'object' ? priorDeptMap : null;
  const priorRevFor = (deptId) => (priorMap ? normCascade(priorMap[deptId]).revenue : null);

  const sectionHeader = (key, labels) => (
    <tr key={`${key}-header`} className="kpi-target-dept-section-header-row">
      <th colSpan={1} className="kpi-matrix-sticky-col kpi-target-dept-section-side" aria-hidden />
      {labels.map((item) => (
        <th key={`${key}-${item.label}`} scope="colgroup" colSpan={item.span} className="kpi-unified-band">
          {item.label}
        </th>
      ))}
    </tr>
  );

  const renderDeptNameCell = (row, depth, ro, sectionKey) => {
    const oid = outlineById?.get(String(row.id)) || '';
    return (
      <th
        scope="rowgroup"
        rowSpan={1}
        className={`kpi-matrix-sticky-col kpi-matrix-dept-name kpi-target-dept-section-name ${depth > 0 ? 'is-child' : 'is-root'}`}
        style={{ paddingLeft: `${0.45 + depth * 0.45}rem` }}
      >
        <span className="kpi-matrix-outline" title="조직 개요 번호">
          {oid}
        </span>
        <span className="kpi-matrix-dept-label">{row.label}</span>
        {ro ? <span className="kpi-matrix-dept-ro">조회</span> : null}
        <span className="kpi-matrix-sr-only">{sectionKey}</span>
      </th>
    );
  };

  const periodCell = ({ key, metric, value, warn, label, disabled, onChange, span, size, dashMode, priorValue }) => (
    <td
      key={key}
      colSpan={span}
      className={`kpi-matrix-td kpi-target-dept-unified-td kpi-target-dept-section-period-cell kpi-target-dept-section-period-cell--${size}`}
    >
      {deptMatrixCellInput({
        value,
        metric,
        disabled,
        warn,
        ariaLabel: `${label} 매출`,
        onChange,
        classExtra: `kpi-target-dept-section-num kpi-target-dept-section-num--${size}`,
        dashMode,
        priorValue
      })}
    </td>
  );

  const deptRows = (sectionKey, renderCells) =>
    allDepartmentRows.length === 0 ? (
      <tr key={`${sectionKey}-empty`}>
        <td colSpan={totalColSpan} className="kpi-target-all-depts-empty">
          표시할 부서가 없습니다.
        </td>
      </tr>
    ) : (
      allDepartmentRows.map((row, rowIdx) => {
        const ctx = deptMatrixRowCtx(row, deptMap, loading, editable, rootSumMismatch, excludeDeptIdSet);
        const { depth, ro } = ctx;
        const cells = renderCells(row, ctx);
        const sid = String(row.id);
        const hoverKey = `${sectionKey}:${sid}`;
        const stripeClass = rowIdx % 2 === 0 ? 'is-stripe-even' : 'is-stripe-odd';
        const hoverClass = hoveredDeptSectionKey === hoverKey ? ' is-dept-hovered' : '';
        const rowClass = `${ro ? 'is-readonly ' : ''}${stripeClass}${hoverClass}`;
        const hoverProps = {
          onMouseEnter: () => setHoveredDeptSectionKey(hoverKey),
          onMouseLeave: () => setHoveredDeptSectionKey((cur) => (cur === hoverKey ? '' : cur))
        };
        return (
          <tr key={`${row.id}-${sectionKey}-revenue`} className={`${rowClass} is-metric-revenue`} {...hoverProps}>
            {renderDeptNameCell(row, depth, ro, sectionKey)}
            {cells.revenue}
          </tr>
        );
      })
    );

  const rowsAnnual = deptRows('annual', (row, { dis, rev, revFlags, rm, excluded }) => {
    const pr = priorRevFor(row.id);
    return {
      revenue: periodCell({
        key: `${row.id}-annual-revenue`,
        span: dataColSpan,
        metric: 'revenue',
        value: rev.annual,
        warn: revFlags.annual || Boolean(rm?.revenue?.annual),
        label: `${row.label} 연간`,
        disabled: dis,
        onChange: (v) => onDeptAnnualRevenue(row.id, v),
        size: 'annual',
        dashMode: excluded,
        priorValue: pr?.annual
      })
    };
  });

  const rowsSemi = deptRows('semi', (row, { dis, rev, revFlags, rm, excluded }) => {
    const pr = priorRevFor(row.id);
    return {
      revenue: [0, 1].map((si) =>
        periodCell({
          key: `${row.id}-semi-${si}-revenue`,
          span: 12,
          metric: 'revenue',
          value: rev.semi?.[si],
          warn: revFlags.semi[si] || Boolean(rm?.revenue?.semi?.[si]),
          label: `${row.label} ${si === 0 ? '상반기' : '하반기'}`,
          disabled: dis,
          onChange: (v) => onDeptMetricSemi(row.id, 'revenue', si, v),
          size: 'semi',
          dashMode: excluded,
          priorValue: pr?.semi?.[si]
        })
      )
    };
  });

  const rowsQuarter = deptRows('quarter', (row, { dis, rev, revFlags, rm, excluded }) => {
    const pr = priorRevFor(row.id);
    return {
      revenue: [0, 1, 2, 3].map((qi) =>
        periodCell({
          key: `${row.id}-quarter-${qi}-revenue`,
          span: 6,
          metric: 'revenue',
          value: rev.quarter?.[qi],
          warn: revFlags.quarter[qi] || Boolean(rm?.revenue?.quarter?.[qi]),
          label: `${row.label} ${qi + 1}분기`,
          disabled: dis,
          onChange: (v) => onDeptMetricQuarter(row.id, 'revenue', qi, v),
          size: 'quarter',
          dashMode: excluded,
          priorValue: pr?.quarter?.[qi]
        })
      )
    };
  });

  const rowsMonth = deptRows('month', (row, { dis, rev, revFlags, rm, excluded }) => {
    const pr = priorRevFor(row.id);
    return {
      revenue: Array.from({ length: 12 }, (_, mi) =>
        periodCell({
          key: `${row.id}-month-${mi}-revenue`,
          span: 2,
          metric: 'revenue',
          value: rev.month?.[mi],
          warn: revFlags.month[mi] || Boolean(rm?.revenue?.month?.[mi]),
          label: `${row.label} ${mi + 1}월`,
          disabled: dis,
          onChange: (v) => onDeptMetricMonth(row.id, 'revenue', mi, v),
          size: 'month',
          dashMode: excluded,
          priorValue: pr?.month?.[mi]
        })
      )
    };
  });

  return (
    <div className="kpi-target-dept-unified-wrap">
      <div className="kpi-target-all-dept-matrix-wrap kpi-target-dept-unified-scroll">
        <table
          className="kpi-target-all-dept-matrix kpi-target-dept-unified-matrix kpi-target-dept-sectioned-matrix"
          aria-label={`${year}년 부서별 연간·반기·분기·월 목표(세로 섹션)`}
        >
          <tbody>
            {sectionHeader('annual', [{ label: '연간', span: dataColSpan }])}
            {rowsAnnual}
            {sectionHeader('semi', [
              { label: '상반기', span: 12 },
              { label: '하반기', span: 12 }
            ])}
            {rowsSemi}
            {sectionHeader('quarter', [
              { label: '1분기', span: 6 },
              { label: '2분기', span: 6 },
              { label: '3분기', span: 6 },
              { label: '4분기', span: 6 }
            ])}
            {rowsQuarter}
            {sectionHeader(
              'month',
              Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1}월`, span: 2 }))
            )}
            {rowsMonth}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AllScopeDeptTeamMatrixToolbar({
  wideLayout,
  onToggle,
  narrowModeDescription = '엑셀식 세로 섹션(기본)',
  wideModeDescription = '가로 전체(한 줄)',
  titleWhenNarrow = '연간~12월을 한 가로줄로 전체 보기',
  titleWhenWide = '연간·반기·분기·월 세로 섹션 보기',
  buttonGoWideLabel = '한 줄로 보기',
  buttonGoNarrowLabel = '세로 섹션'
}) {
  return (
    <div className="kpi-target-dept-layout-toolbar">
      <span className="kpi-target-dept-layout-label">
        현재: {wideLayout ? wideModeDescription : narrowModeDescription}
      </span>
      <button
        type="button"
        className={`kpi-target-dept-layout-toggle${wideLayout ? ' is-wide' : ''}`}
        onClick={onToggle}
        aria-pressed={wideLayout}
        title={wideLayout ? titleWhenWide : titleWhenNarrow}
      >
        <span className="kpi-target-dept-layout-toggle-icon" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M4 6h7v4H4V6zm9 0h7v4h-7V6zM4 14h7v4H4v-4zm9 0h7v4h-7v-4z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M12 8v8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
        <span className="kpi-target-dept-layout-toggle-text">{wideLayout ? buttonGoNarrowLabel : buttonGoWideLabel}</span>
      </button>
    </div>
  );
}

/** 전체 탭 ②: 기본 세로 섹션 / 토글 시 가로 전체 표 */
function AllScopeDeptXlsStackTable(props) {
  const [wideLayout, setWideLayout] = useState(false);
  return (
    <div className="kpi-target-dept-team-matrix-root">
      <AllScopeDeptTeamMatrixToolbar wideLayout={wideLayout} onToggle={() => setWideLayout((w) => !w)} />
      {wideLayout ? <AllScopeDeptWideUnifiedTable {...props} /> : <AllScopeDeptCompactHalfSplit {...props} />}
    </div>
  );
}

/** 전체 탭 ③: 팀·성명 + 연간/반기/분기/월 — ②와 동일 Top-down / Bottom-up(apply*) */
function AllScopeStaffTargetMatrixTables({
  staffRows,
  departmentRows = [],
  loading,
  staffCascadeByUserId = {},
  priorStaffCascadeByUserId = null,
  excludeDeptIdSet = null,
  editable = false,
  onStaffAnnualRevenue = () => {},
  onStaffMetricMonth = () => {},
  onStaffMetricSemi = () => {},
  onStaffMetricQuarter = () => {}
}) {
  const groups = useMemo(
    () => buildStaffTargetGroups(staffRows, departmentRows),
    [staffRows, departmentRows]
  );
  const [wideLayout, setWideLayout] = useState(false);
  const [hoveredStaffKey, setHoveredStaffKey] = useState('');

  const priorStaffMap =
    priorStaffCascadeByUserId && typeof priorStaffCascadeByUserId === 'object' ? priorStaffCascadeByUserId : null;
  const priorRevForUser = (uid) => (priorStaffMap ? normCascade(priorStaffMap[uid]).revenue : null);

  const staffCtx = (userId, teamKeyForExclude) => {
    const id = String(userId || '').trim();
    const tk = String(teamKeyForExclude || '').trim();
    const blk = normCascade(staffCascadeByUserId[id]);
    const rev = blk.revenue;
    const revFlags = computeNeedSyncFlags({
      month: rev.month,
      quarter: rev.quarter,
      semi: rev.semi,
      annual: rev.annual
    });
    const deptExcluded = Boolean(excludeDeptIdSet?.has(tk));
    const dis = !editable || loading || deptExcluded;
    return { id, rev, revFlags, dis, deptExcluded };
  };

  if (!staffRows || staffRows.length === 0) {
    return (
      <p className="kpi-target-all-depts-empty">
        {loading ? '직원별 데이터를 불러오는 중…' : '직원 데이터가 없습니다.'}
      </p>
    );
  }

  const tierHead = (cells) => (
    <tr>
      <th scope="col" className="kpi-target-staff-th-corner">
        팀
      </th>
      <th scope="col" className="kpi-target-staff-th-corner">
        성명
      </th>
      {cells}
    </tr>
  );

  const bodyRows = (tierKey, renderCells) =>
    groups.flatMap((g) =>
      g.members.map((s, idx) => {
        const ctx = staffCtx(s.userId, g.teamKey);
        const hoverKey = `${tierKey}:${s.userId}`;
        const rowClass = `kpi-target-staff-data-tr is-metric-revenue${
          hoveredStaffKey === hoverKey ? ' is-staff-hovered' : ''
        }`;
        return (
          <tr
            key={`${tierKey}-${s.userId}`}
            className={rowClass}
            onMouseEnter={() => setHoveredStaffKey(hoverKey)}
            onMouseLeave={() => setHoveredStaffKey((cur) => (cur === hoverKey ? '' : cur))}
          >
            {idx === 0 ? (
              <th scope="rowgroup" rowSpan={g.members.length} className="kpi-target-staff-td-team">
                {g.teamLabel}
              </th>
            ) : null}
            <th scope="row" className="kpi-target-staff-td-name">
              {s.name}
            </th>
            {renderCells(s, ctx)}
          </tr>
        );
      })
    );

  const wideHeadRow = (
    <tr>
      <th scope="col" className="kpi-target-staff-th-corner">
        팀
      </th>
      <th scope="col" className="kpi-target-staff-th-corner">
        성명
      </th>
      <th scope="col" className="kpi-target-staff-th-band">
        연간
      </th>
      <th scope="col" className="kpi-target-staff-th-band">
        상반기
      </th>
      <th scope="col" className="kpi-target-staff-th-band">
        하반기
      </th>
      {[1, 2, 3, 4].map((q) => (
        <th key={`wq${q}`} scope="col" className="kpi-target-staff-th-band">
          {q}분기
        </th>
      ))}
      {MONTH_COLUMNS.map((item) => (
        <th key={`wm${item.month}`} scope="col" className="kpi-target-staff-th-band kpi-target-staff-th-band--month">
          {item.label}
        </th>
      ))}
    </tr>
  );

  const wideBodyRows = groups.flatMap((g) =>
    g.members.map((s, idx) => {
      const ctx = staffCtx(s.userId, g.teamKey);
      const { rev, revFlags, dis, deptExcluded } = ctx;
      const pr = priorRevForUser(s.userId);
      const hoverKey = `wide:${s.userId}`;
      const rowClass = `kpi-target-staff-data-tr is-metric-revenue${
        hoveredStaffKey === hoverKey ? ' is-staff-hovered' : ''
      }`;
      return (
        <tr
          key={`wide-${s.userId}`}
          className={rowClass}
          onMouseEnter={() => setHoveredStaffKey(hoverKey)}
          onMouseLeave={() => setHoveredStaffKey((cur) => (cur === hoverKey ? '' : cur))}
        >
          {idx === 0 ? (
            <th scope="rowgroup" rowSpan={g.members.length} className="kpi-target-staff-td-team">
              {g.teamLabel}
            </th>
          ) : null}
          <th scope="row" className="kpi-target-staff-td-name">
            {s.name}
          </th>
          <td className="kpi-target-staff-td-val">
            {deptMatrixCellInput({
              value: rev.annual,
              metric: 'revenue',
              disabled: dis,
              warn: revFlags.annual,
              ariaLabel: `${s.name} 연 매출`,
              onChange: (v) => onStaffAnnualRevenue(s.userId, v),
              narrow: true,
              classExtra: 'kpi-target-staff-matrix-num',
              dashMode: deptExcluded,
              priorValue: pr?.annual
            })}
          </td>
          <td className="kpi-target-staff-td-val">
            {deptMatrixCellInput({
              value: rev.semi?.[0],
              metric: 'revenue',
              disabled: dis,
              warn: revFlags.semi[0],
              ariaLabel: `${s.name} 상반기 매출`,
              onChange: (v) => onStaffMetricSemi(s.userId, 'revenue', 0, v),
              classExtra: 'kpi-target-staff-matrix-num',
              dashMode: deptExcluded,
              priorValue: pr?.semi?.[0]
            })}
          </td>
          <td className="kpi-target-staff-td-val">
            {deptMatrixCellInput({
              value: rev.semi?.[1],
              metric: 'revenue',
              disabled: dis,
              warn: revFlags.semi[1],
              ariaLabel: `${s.name} 하반기 매출`,
              onChange: (v) => onStaffMetricSemi(s.userId, 'revenue', 1, v),
              classExtra: 'kpi-target-staff-matrix-num',
              dashMode: deptExcluded,
              priorValue: pr?.semi?.[1]
            })}
          </td>
          {[0, 1, 2, 3].map((qi) => (
            <td key={`wq${qi}`} className="kpi-target-staff-td-val">
              {deptMatrixCellInput({
                value: rev.quarter?.[qi],
                metric: 'revenue',
                disabled: dis,
                warn: revFlags.quarter[qi],
                ariaLabel: `${s.name} ${qi + 1}분기 매출`,
                onChange: (v) => onStaffMetricQuarter(s.userId, 'revenue', qi, v),
                classExtra: 'kpi-target-staff-matrix-num',
                dashMode: deptExcluded,
                priorValue: pr?.quarter?.[qi]
              })}
            </td>
          ))}
          {MONTH_COLUMNS.map((item) => (
            <td key={`wm${item.month}`} className="kpi-target-staff-td-val kpi-target-staff-td-val--month">
              {deptMatrixCellInput({
                value: rev.month?.[item.month - 1],
                metric: 'revenue',
                disabled: dis,
                warn: revFlags.month[item.month - 1],
                ariaLabel: `${s.name} ${item.month}월 매출`,
                onChange: (v) => onStaffMetricMonth(s.userId, 'revenue', item.month - 1, v),
                classExtra: 'kpi-target-staff-matrix-num',
                dashMode: deptExcluded,
                priorValue: pr?.month?.[item.month - 1]
              })}
            </td>
          ))}
        </tr>
      );
    })
  );

  return (
    <div className="kpi-target-dept-team-matrix-root">
      <AllScopeDeptTeamMatrixToolbar
        wideLayout={wideLayout}
        onToggle={() => setWideLayout((w) => !w)}
        narrowModeDescription="4단 표(연간→반기→분기→월)"
        wideModeDescription="한 줄(연간~12월)"
        titleWhenNarrow="연간부터 12월까지 한 가로 표로 보기"
        titleWhenWide="연간→반기→분기→월 네 장 표로 보기"
        buttonGoWideLabel="한 줄로 보기"
        buttonGoNarrowLabel="4단 표"
      />
      {wideLayout ? (
        <div className="kpi-target-staff-tier-scroll kpi-target-staff-tier-scroll--wide">
          <table className="kpi-target-staff-tier-table kpi-target-staff-tier-table--wide" aria-label="직원별 매출 목표액(한 줄)">
            <thead>{wideHeadRow}</thead>
            <tbody>{wideBodyRows}</tbody>
          </table>
        </div>
      ) : (
        <div className="kpi-target-staff-matrix-stack">
          <div className="kpi-target-staff-tier-scroll">
            <table className="kpi-target-staff-tier-table" aria-label="직원별 연간 매출 목표액">
              <thead>
                {tierHead(
                  <th scope="col" colSpan={1} className="kpi-target-staff-th-band">
                    연간
                  </th>
                )}
              </thead>
              <tbody>
                {bodyRows('annual', (s, ctx) => {
                  const pr = priorRevForUser(s.userId);
                  return [
                    <td key="a" className="kpi-target-staff-td-val">
                      {deptMatrixCellInput({
                        value: ctx.rev.annual,
                        metric: 'revenue',
                        disabled: ctx.dis,
                        warn: ctx.revFlags.annual,
                        ariaLabel: `${s.name} 연 매출`,
                        onChange: (v) => onStaffAnnualRevenue(s.userId, v),
                        narrow: true,
                        classExtra: 'kpi-target-staff-matrix-num',
                        dashMode: ctx.deptExcluded,
                        priorValue: pr?.annual
                      })}
                    </td>
                  ];
                })}
              </tbody>
            </table>
          </div>
          <div className="kpi-target-staff-tier-scroll">
            <table className="kpi-target-staff-tier-table" aria-label="직원별 반기 매출 목표액">
              <thead>
                {tierHead([
                  <th key="h1" scope="col" className="kpi-target-staff-th-band">
                    상반기
                  </th>,
                  <th key="h2" scope="col" className="kpi-target-staff-th-band">
                    하반기
                  </th>
                ])}
              </thead>
              <tbody>
                {bodyRows('semi', (s, ctx) => {
                  const pr = priorRevForUser(s.userId);
                  return [
                    <td key="h1" className="kpi-target-staff-td-val">
                      {deptMatrixCellInput({
                        value: ctx.rev.semi?.[0],
                        metric: 'revenue',
                        disabled: ctx.dis,
                        warn: ctx.revFlags.semi[0],
                        ariaLabel: `${s.name} 상반기 매출`,
                        onChange: (v) => onStaffMetricSemi(s.userId, 'revenue', 0, v),
                        classExtra: 'kpi-target-staff-matrix-num',
                        dashMode: ctx.deptExcluded,
                        priorValue: pr?.semi?.[0]
                      })}
                    </td>,
                    <td key="h2" className="kpi-target-staff-td-val">
                      {deptMatrixCellInput({
                        value: ctx.rev.semi?.[1],
                        metric: 'revenue',
                        disabled: ctx.dis,
                        warn: ctx.revFlags.semi[1],
                        ariaLabel: `${s.name} 하반기 매출`,
                        onChange: (v) => onStaffMetricSemi(s.userId, 'revenue', 1, v),
                        classExtra: 'kpi-target-staff-matrix-num',
                        dashMode: ctx.deptExcluded,
                        priorValue: pr?.semi?.[1]
                      })}
                    </td>
                  ];
                })}
              </tbody>
            </table>
          </div>
          <div className="kpi-target-staff-tier-scroll">
            <table className="kpi-target-staff-tier-table" aria-label="직원별 분기 매출 목표액">
              <thead>
                {tierHead(
                  [1, 2, 3, 4].map((q) => (
                    <th key={`q${q}`} scope="col" className="kpi-target-staff-th-band">
                      {q}분기
                    </th>
                  ))
                )}
              </thead>
              <tbody>
                {bodyRows('quarter', (s, ctx) => {
                  const pr = priorRevForUser(s.userId);
                  return [0, 1, 2, 3].map((qi) => (
                    <td key={`q${qi}`} className="kpi-target-staff-td-val">
                      {deptMatrixCellInput({
                        value: ctx.rev.quarter?.[qi],
                        metric: 'revenue',
                        disabled: ctx.dis,
                        warn: ctx.revFlags.quarter[qi],
                        ariaLabel: `${s.name} ${qi + 1}분기 매출`,
                        onChange: (v) => onStaffMetricQuarter(s.userId, 'revenue', qi, v),
                        classExtra: 'kpi-target-staff-matrix-num',
                        dashMode: ctx.deptExcluded,
                        priorValue: pr?.quarter?.[qi]
                      })}
                    </td>
                  ));
                })}
              </tbody>
            </table>
          </div>
          <div className="kpi-target-staff-tier-scroll kpi-target-staff-tier-scroll--month">
            <table className="kpi-target-staff-tier-table kpi-target-staff-tier-table--month" aria-label="직원별 월 매출 목표액">
              <thead>
                {tierHead(
                  MONTH_COLUMNS.map((item) => (
                    <th key={`m${item.month}`} scope="col" className="kpi-target-staff-th-band kpi-target-staff-th-band--month">
                      {item.label}
                    </th>
                  ))
                )}
              </thead>
              <tbody>
                {bodyRows('month', (s, ctx) => {
                  const pr = priorRevForUser(s.userId);
                  return MONTH_COLUMNS.map((item) => (
                    <td key={`m${item.month}`} className="kpi-target-staff-td-val kpi-target-staff-td-val--month">
                      {deptMatrixCellInput({
                        value: ctx.rev.month?.[item.month - 1],
                        metric: 'revenue',
                        disabled: ctx.dis,
                        warn: ctx.revFlags.month[item.month - 1],
                        ariaLabel: `${s.name} ${item.month}월 매출`,
                        onChange: (v) => onStaffMetricMonth(s.userId, 'revenue', item.month - 1, v),
                        classExtra: 'kpi-target-staff-matrix-num',
                        dashMode: ctx.deptExcluded,
                        priorValue: pr?.month?.[item.month - 1]
                      })}
                    </td>
                  ));
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function KpiTargetModal({
  scopeType,
  onScopeTypeChange,
  showAllScopeTab = false,
  companyAnnual = { revenue: 0 },
  companyCascade = null,
  canEditCompany = false,
  autoDistributeExcludeDepartmentIds = [],
  onAutoDistributeExcludeDepartmentIdsChange = () => {},
  priorYearCompanyCascade = null,
  priorYearDeptCascade = null,
  priorYearStaffCascade = null,
  companyAchievement = null,
  onCompanyAnnualRevenue = () => {},
  onCompanyMetricMonth = () => {},
  onCompanyMetricSemi = () => {},
  onCompanyMetricQuarter = () => {},
  allDepartmentTotals = { revenue: 0 },
  allStaffRows = [],
  staffCascadeByUserId = {},
  allDepartmentRows = [],
  deptCascade = null,
  onDeptAnnualRevenue = () => {},
  onDeptMetricMonth = () => {},
  onDeptMetricSemi = () => {},
  onDeptMetricQuarter = () => {},
  onStaffAnnualRevenue = () => {},
  onStaffMetricMonth = () => {},
  onStaffMetricSemi = () => {},
  onStaffMetricQuarter = () => {},
  year,
  onYearChange,
  monthlyRevenue = [],
  teamMonthlyRevenue = [],
  departmentId,
  onDepartmentChange = () => {},
  userId,
  onUserChange = () => {},
  departmentOptions = [],
  userOptions = [],
  scopeNotice = '',
  loading = false,
  saving,
  message,
  canSubmit = true,
  /** 팀·개인 월간 입력란 편집 가능 여부(부서장·매니저 이상 등 부모에서 계산) */
  monthlyTableEditable = false,
  submitLabel = '목표 저장',
  monthlyTableHeading = '',
  onSubmit,
  onClose
}) {
  const editable = Boolean(monthlyTableEditable);
  const [yearDraft, setYearDraft] = useState(String(year || ''));
  const [yearDropdownOpen, setYearDropdownOpen] = useState(false);
  const [calcHelpOpen, setCalcHelpOpen] = useState(false);
  const [priorYoyPeekActive, setPriorYoyPeekActive] = useState(false);
  const handlePriorYoyPeekDown = useCallback(() => {
    setPriorYoyPeekActive(true);
    const end = () => {
      setPriorYoyPeekActive(false);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
    };
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
  }, []);
  const coBlock = useMemo(() => normCascade(companyCascade), [companyCascade]);
  const excludeDeptIdSet = useMemo(
    () =>
      new Set(
        (autoDistributeExcludeDepartmentIds || []).map((x) => String(x || '').trim()).filter(Boolean)
      ),
    [autoDistributeExcludeDepartmentIds]
  );
  const companyRootMismatch = useMemo(() => {
    if (scopeType !== 'all') {
      return { mismatch: emptyRootSumMismatch(), detailLines: [], hasMismatch: false };
    }
    /** MongoDB 연도 매트릭스 로드 전에는 이전 탭·연도의 cascade가 남아 거짓 불일치가 날 수 있음 */
    if (loading) {
      return { mismatch: emptyRootSumMismatch(), detailLines: [], hasMismatch: false };
    }
    return compareCompanyToRootDeptSums(companyCascade, deptCascade, allDepartmentRows);
  }, [scopeType, companyCascade, deptCascade, allDepartmentRows, loading]);
  const deptOutlineById = useMemo(() => buildDeptOutlineLabels(allDepartmentRows), [allDepartmentRows]);
  const deptMap = deptCascade && typeof deptCascade === 'object' ? deptCascade : {};
  const achCo = companyAchievement && typeof companyAchievement === 'object' ? companyAchievement : {};
  const revenueHeading =
    monthlyTableHeading ||
    (scopeType === 'team' ? '팀 월간 할당(매출)' : '개인 월간 목표');
  const monthlyRevenueNumbers = MONTH_COLUMNS.map((item) => parseMoney(monthlyRevenue[item.month - 1]));
  const monthlyTeamRevenueNumbers = MONTH_COLUMNS.map((item) => Number(teamMonthlyRevenue[item.month - 1] || 0));
  const revenueQuarter = quarterValues(monthlyRevenueNumbers);
  const revenueHalf = halfValues(monthlyRevenueNumbers);
  const teamRevenueQuarter = quarterValues(monthlyTeamRevenueNumbers);
  const teamRevenueHalf = halfValues(monthlyTeamRevenueNumbers);
  const revenueYear = yearlyValue(monthlyRevenueNumbers);
  const teamRevenueYear = yearlyValue(monthlyTeamRevenueNumbers);
  const selectedTeamDeptId = String(departmentId || '').trim();
  const selectedUserId = String(userId || '').trim();
  const visibleDepartmentRows = useMemo(() => {
    if (scopeType === 'team') {
      return allDepartmentRows.filter((row) => String(row.id || '').trim() === selectedTeamDeptId);
    }
    if (scopeType === 'user') {
      const hit = allStaffRows.find((row) => String(row.userId || '').trim() === selectedUserId);
      const deptId = String(hit?.teamKey || '').trim();
      return deptId ? allDepartmentRows.filter((row) => String(row.id || '').trim() === deptId) : [];
    }
    return allDepartmentRows;
  }, [allDepartmentRows, allStaffRows, scopeType, selectedTeamDeptId, selectedUserId]);
  const visibleStaffRows = useMemo(() => {
    if (scopeType === 'team') {
      return allStaffRows.filter((row) => String(row.teamKey || '').trim() === selectedTeamDeptId);
    }
    if (scopeType === 'user') {
      const hit = allStaffRows.find((row) => String(row.userId || '').trim() === selectedUserId);
      if (hit) return [hit];
      const option = userOptions.find((item) => String(item.id || '').trim() === selectedUserId);
      if (!option) return [];
      return [{
        userId: selectedUserId,
        name: option.name || option.label || selectedUserId,
        department: '선택 직원',
        teamKey: '_',
        teamLabel: '선택 직원'
      }];
    }
    return allStaffRows;
  }, [allStaffRows, scopeType, selectedTeamDeptId, selectedUserId, userOptions]);
  const visibleStaffCascade = useMemo(() => {
    if (scopeType !== 'user') return staffCascadeByUserId;
    if (!selectedUserId) return staffCascadeByUserId;
    const fallback = cascadeBlockFromMonthly(monthlyRevenueNumbers);
    return {
      ...staffCascadeByUserId,
      [selectedUserId]: normCascade(staffCascadeByUserId?.[selectedUserId] || fallback)
    };
  }, [monthlyRevenueNumbers, scopeType, selectedUserId, staffCascadeByUserId]);
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    const selected = Math.max(2000, Math.min(9999, Number(year) || current));
    const start = Math.max(2000, Math.min(selected - 6, current - 6));
    const end = Math.min(9999, Math.max(selected + 6, current + 6));
    const list = [];
    for (let y = end; y >= start; y -= 1) list.push(String(y));
    if (!list.includes(String(selected))) {
      list.push(String(selected));
      list.sort((a, b) => Number(b) - Number(a));
    }
    return list;
  }, [year]);

  const handleMonthlyRevenueInput = (month, value) => {
    onMonthlyRevenueChange(month, revenueDigitsOnly(value));
  };

  useEffect(() => {
    setYearDraft(String(year || ''));
  }, [year]);

  const commitYearDraft = (nextValue = yearDraft) => {
    const digits = String(nextValue ?? '').replace(/\D/g, '').slice(0, 4);
    const nextYear = Number(digits);
    if (digits.length === 4 && nextYear >= 2000 && nextYear <= 9999) {
      if (String(year) !== digits) onYearChange(digits);
      setYearDraft(digits);
      setYearDropdownOpen(false);
      return;
    }
    setYearDraft(String(year || ''));
    setYearDropdownOpen(false);
  };

  const selectYearOption = (nextYear) => {
    const digits = String(nextYear ?? '').replace(/\D/g, '').slice(0, 4);
    if (digits.length !== 4) return;
    setYearDraft(digits);
    commitYearDraft(digits);
  };

  const showScopeSelect =
    scopeType !== 'all' &&
    ((scopeType === 'team' && departmentOptions.length > 0) ||
      (scopeType === 'user' && userOptions.length > 0));
  return (
    <KpiTargetBulkProvider>
    <div className="kpi-target-modal-overlay" role="presentation">
      <div className="kpi-target-modal-backdrop-decor" aria-hidden />
      <div
        className="kpi-target-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kpi-target-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <KpiPriorYoyPeekContext.Provider value={priorYoyPeekActive}>
        <div className="kpi-target-modal-header">
          <div className="kpi-target-modal-header-copy">
            <div className="kpi-target-modal-header-title-row">
              <h2 id="kpi-target-modal-title" className="kpi-target-modal-title">
                {year}년 KPI 목표 설정
              </h2>
              <div className="kpi-target-modal-segment" role="tablist" aria-label="저장 범위">
                {showAllScopeTab ? (
                  <button
                    type="button"
                    className={scopeType === 'all' ? 'is-active' : ''}
                    onClick={() => onScopeTypeChange('all')}
                  >
                    전체
                  </button>
                ) : null}
                <button
                  type="button"
                  className={scopeType === 'team' ? 'is-active' : ''}
                  onClick={() => onScopeTypeChange('team')}
                >
                  팀별
                </button>
                <button
                  type="button"
                  className={scopeType === 'user' ? 'is-active' : ''}
                  onClick={() => onScopeTypeChange('user')}
                >
                  개인별
                </button>
              </div>
            </div>
          </div>
          <div className="kpi-target-modal-header-actions">
            <button
              type="button"
              className="kpi-target-modal-help-button"
              onClick={() => setCalcHelpOpen(true)}
              aria-haspopup="dialog"
            >
              <span className="material-symbols-outlined" aria-hidden>help</span>
              <span>계산 도움말</span>
            </button>
            <button
              type="button"
              className="kpi-target-modal-prior-yoy-peek"
              onPointerDown={handlePriorYoyPeekDown}
              aria-pressed={priorYoyPeekActive}
              title="누르고 있는 동안 표에 전년 동기 대비(%)가 표시됩니다"
            >
              전년도 비교하기
            </button>
            <div className="kpi-target-modal-year-select">
              <input
                id="kpi-target-year"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                min="2000"
                max="9999"
                className="kpi-target-modal-input"
                value={yearDraft}
                role="combobox"
                aria-expanded={yearDropdownOpen}
                aria-controls="kpi-target-year-options"
                onChange={(e) => {
                  const next = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setYearDraft(next);
                  if (next.length === 4) commitYearDraft(next);
                }}
                onFocus={() => setYearDropdownOpen(true)}
                onClick={() => setYearDropdownOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => commitYearDraft(), 120);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'NumpadEnter') {
                    e.preventDefault();
                    commitYearDraft();
                    e.currentTarget.blur();
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setYearDropdownOpen(true);
                  } else if (e.key === 'Escape') {
                    setYearDropdownOpen(false);
                  }
                }}
                disabled={saving}
                aria-label="기준 연도"
              />
              <span className="material-symbols-outlined kpi-target-modal-input-suffix-icon" aria-hidden>
                calendar_today
              </span>
              {yearDropdownOpen && !saving ? (
                <div
                  id="kpi-target-year-options"
                  className="kpi-target-year-dropdown"
                  role="listbox"
                  aria-label="기준 연도 선택"
                >
                  {yearOptions.map((y) => (
                    <button
                      key={y}
                      type="button"
                      className={String(yearDraft || year) === y ? 'is-active' : ''}
                      role="option"
                      aria-selected={String(yearDraft || year) === y}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectYearOption(y)}
                    >
                      <span>{y}년</span>
                      <small>{String(year) === y ? '현재 선택' : '불러오기'}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button type="button" className="kpi-target-modal-close" onClick={onClose} aria-label="목표 설정 모달 닫기">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        {calcHelpOpen ? (
          <div className="kpi-target-calc-help-layer" role="presentation">
            <div
              className="kpi-target-calc-help-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="kpi-target-calc-help-title"
            >
              <div className="kpi-target-calc-help-head">
                <div>
                  <span className="kpi-target-calc-help-kicker">KPI 목표 계산 방식</span>
                  <h3 id="kpi-target-calc-help-title">①②③ 목표가 서로 반영되는 순서</h3>
                </div>
                <button
                  type="button"
                  className="kpi-target-calc-help-close"
                  onClick={() => setCalcHelpOpen(false)}
                  aria-label="계산 도움말 닫기"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="kpi-target-calc-help-body">
                <section>
                  <h4>① 회사 목표를 입력할 때</h4>
                  <p>
                    연간 금액은 편집 가능한 부서 행 수로 균등 분배됩니다. 예를 들어 10억을 6개 부서 행에 나누면
                    166,666,667원과 166,666,666원처럼 1원 단위 차이가 생길 수 있습니다.
                  </p>
                </section>
                <section>
                  <h4>② 부서 목표를 입력할 때</h4>
                  <p>
                    해당 부서에 직접 소속된 직원에게만 월별 균등 분배됩니다. KPI 목표에서는 조직도 하위 부서를
                    부모 부서에 더하지 않습니다.
                  </p>
                </section>
                <section>
                  <h4>③ 직원 목표를 수정할 때</h4>
                  <p>
                    수정한 직원이 속한 현재 부서의 직원 합계가 ② 부서 행에 반영되고, ② 부서 전체 합계가 ① 회사
                    목표의 연간·반기·분기·월을 다시 계산합니다.
                  </p>
                </section>
                <section>
                  <h4>반기·분기·월의 1원 차이</h4>
                  <p>
                    금액은 원 단위 정수로 저장하므로 나누어떨어지지 않는 금액은 앞쪽 기간 또는 앞쪽 행에 1원씩
                    배분됩니다. 전체 연간 합계가 맞도록 하기 위한 처리입니다.
                  </p>
                </section>
              </div>
            </div>
          </div>
        ) : null}

        <form className="kpi-target-modal-form-wrap" onSubmit={onSubmit}>
          <div className={`kpi-target-modal-body custom-scrollbar ${loading ? 'is-loading' : ''}`}>
            {loading ? (
              <p className="kpi-target-modal-loading-banner" role="status">
                목표 정보를 불러오는 중…
              </p>
            ) : null}

            <div className="kpi-target-modal-section">
              <label className="kpi-target-modal-field-label">
                {scopeType === 'all' ? '전체 목표·부서·직원' : '대상 선택'}
              </label>
              {showScopeSelect ? (
                <div className="kpi-target-modal-scope-select-wrap">
                  {scopeType === 'team' ? (
                    <select
                      className="kpi-target-modal-input kpi-target-modal-input--select"
                      value={departmentId}
                      onChange={(e) => onDepartmentChange(e.target.value)}
                      aria-label="부서 선택"
                    >
                      {departmentOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.readOnly ? `${item.label} (조회 전용)` : item.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      className="kpi-target-modal-input kpi-target-modal-input--select"
                      value={userId}
                      onChange={(e) => onUserChange(e.target.value)}
                      aria-label="직원 선택"
                    >
                      {userOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label || item.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ) : null}
              {scopeNotice ? <p className="kpi-target-modal-message">{scopeNotice}</p> : null}
              {scopeType === 'all' ? (
                <div className="kpi-target-xls-stack kpi-target-sample-page">
                  <div className="kpi-target-xls-block kpi-target-sample-outer">
                    <div className="kpi-target-xls-caption">
                      ① 회사 목표 — 연·반기·분기·월 {!canEditCompany ? '(조회 전용: 매니저 이상만 전사 저장)' : ''}
                    </div>
                    <p className="kpi-target-sample-lead">
                      성과 지표에 대한 연간 및 분기별 목표를 수립합니다. ①·②·③ 매출 셀은 엑셀처럼 «*1.2» «+1000» «=10+20*2» 등을 입력한 뒤 Enter 또는 포커스를 옮기면 계산되어 반영됩니다.
                    </p>
                    {canEditCompany && !loading && allDepartmentRows.some((r) => !r.readOnly) ? (
                      <div className="kpi-target-auto-exclude-panel" role="group" aria-label="회사 연간 자동 분배 적용 부서">
                        <div className="kpi-target-auto-exclude-head">
                          <span className="kpi-target-auto-exclude-title">① 연간 자동 분배 적용 부서</span>
                          <span className="kpi-target-auto-exclude-note">
                            체크한 부서에만 회사 연간·반기·분기·월 목표가 자동 균등 분배됩니다. 체크 해제한 부서는 목표 0원·표시는 하이픈(-)입니다.
                          </span>
                        </div>
                        <div className="kpi-target-auto-exclude-chips">
                          {allDepartmentRows
                            .filter((r) => !r.readOnly)
                            .map((r) => {
                              const id = String(r.id || '').trim();
                              if (!id) return null;
                              const applied = !excludeDeptIdSet.has(id);
                              return (
                                <label key={id} className={`kpi-target-auto-exclude-chip${applied ? ' is-on' : ' is-off'}`}>
                                  <input
                                    type="checkbox"
                                    checked={applied}
                                    aria-label={`${r.label} 자동 분배 적용`}
                                    onChange={(e) => {
                                      const next = new Set(
                                        (autoDistributeExcludeDepartmentIds || []).map((x) => String(x || '').trim())
                                      );
                                      if (e.target.checked) next.delete(id);
                                      else next.add(id);
                                      onAutoDistributeExcludeDepartmentIdsChange([...next]);
                                    }}
                                  />
                                  <span>{r.label}</span>
                                </label>
                              );
                            })}
                        </div>
                      </div>
                    ) : null}
                    {companyRootMismatch.hasMismatch ? (
                      <div className="kpi-target-root-sum-mismatch-banner" role="status">
                        <strong>회사 목표와 부서 전체 합계가 다릅니다.</strong>
                        <ul className="kpi-target-root-sum-mismatch-list">
                          {companyRootMismatch.detailLines.map((line, idx) => (
                            <li key={`${idx}-${line.slice(0, 40)}`}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <div >
                      <CompanyRevenueTableBlock
                        yearLabel={`${year}년`}
                        block={coBlock}
                        priorBlock={priorYearCompanyCascade}
                        disabled={!editable || loading || !canEditCompany}
                        revenueAchSubline={`매출 실적 ${Number(achCo.revAct || 0).toLocaleString('ko-KR')}원 · 달성 ${Number(achCo.revPct || 0)}%`}
                        onAnnualRevenue={onCompanyAnnualRevenue}
                        onMetricSemi={onCompanyMetricSemi}
                        onMetricQuarter={onCompanyMetricQuarter}
                        onMetricMonth={onCompanyMetricMonth}
                        rootSumMismatch={companyRootMismatch.mismatch}
                      />
                    </div>
                    <div className="kpi-target-sample-footer-totals">
                      <strong>최상위 부서 연간 합계</strong>
                      <span>매출 {Number(allDepartmentTotals.revenue || 0).toLocaleString('ko-KR')}원</span>
                    </div>
            </div>

                  <div className="kpi-target-xls-block kpi-target-sample-outer">
                    <div className="kpi-target-xls-caption">② 팀별 할당 · 조직도 순서(직접 소속 직원 합산)</div>
                    <p className="kpi-target-sample-lead">
                      기본은 한 테이블 안에서 연간 → 반기 → 분기 → 월 섹션이 아래로 이어지는 엑셀식 구조입니다. 오른쪽 버튼으로 «한 줄로 보기»를 켜면 연간부터 12월까지 가로로 펼친 표(가로 스크롤)로 전환됩니다. ① 회사 목표를 바꾸면 표시된 부서 행에 균등 분배됩니다. 각 부서 행은 하위 부서를 더하지 않고 해당 부서에 직접 소속된 직원 목표만 합산해 표시되며, 값을 바꾸면 해당 부서 직원 표에 월별 균등 분배로 곧바로 반영됩니다.
                    </p>
                    <AllScopeDeptXlsStackTable
                      year={year}
                      allDepartmentRows={allDepartmentRows}
                      deptMap={deptMap}
                      priorDeptMap={priorYearDeptCascade}
                      outlineById={deptOutlineById}
                      loading={loading}
                      editable={editable}
                      onDeptAnnualRevenue={onDeptAnnualRevenue}
                      onDeptMetricSemi={onDeptMetricSemi}
                      onDeptMetricQuarter={onDeptMetricQuarter}
                      onDeptMetricMonth={onDeptMetricMonth}
                      rootSumMismatch={companyRootMismatch.mismatch}
                      excludeDeptIdSet={excludeDeptIdSet}
                    />
                  </div>

                  <div className="kpi-target-xls-block kpi-target-sample-outer">
                    <div className="kpi-target-xls-caption">③ 직원별 매출 목표액(②와 실시간 연동)</div>
                    <p className="kpi-target-sample-lead">
                      ②에서 부서 목표를 바꾸면 그 부서 직원에게 월별 균등 분배되어 ③이 갱신됩니다. ③에서 수기로 바꾼 값은 현재 소속 부서의 직접 소속 직원 합으로 ② 부서 행에 반영되고, ② 부서 전체 합으로 ① 회사 매출이 갱신됩니다. 처음 불러올 때만 저장된 개인 목표가 있으면 그대로 쓰고, 없으면 팀 목표를 인원수로 나눈 뒤 Top-down으로 채웁니다. ②가 조회 전용인 부서는 ③에서 수정해도 그 부서 행에는 합계가 올라가지 않습니다.
                    </p>
                    <div>
                      <AllScopeStaffTargetMatrixTables
                        staffRows={allStaffRows}
                        departmentRows={allDepartmentRows}
                        loading={loading}
                        staffCascadeByUserId={staffCascadeByUserId}
                        priorStaffCascadeByUserId={priorYearStaffCascade}
                        excludeDeptIdSet={excludeDeptIdSet}
                        editable={editable}
                        onStaffAnnualRevenue={onStaffAnnualRevenue}
                        onStaffMetricMonth={onStaffMetricMonth}
                        onStaffMetricSemi={onStaffMetricSemi}
                        onStaffMetricQuarter={onStaffMetricQuarter}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {scopeType === 'team' || scopeType === 'user' ? (
              <div className="kpi-target-xls-stack kpi-target-sample-page">
                <div className="kpi-target-xls-block kpi-target-sample-outer">
                  <div className="kpi-target-xls-caption">
                    ② {scopeType === 'team' ? '선택 부서 할당' : '선택 직원 소속 부서'} · 연·반기·분기·월
                  </div>
                  <p className="kpi-target-sample-lead">
                    선택한 대상만 표시합니다. «한 줄로 보기»와 «4행 격자»를 전환해 전체 탭과 같은 방식으로 확인할 수 있습니다.
                  </p>
                  <AllScopeDeptXlsStackTable
                    year={year}
                    allDepartmentRows={visibleDepartmentRows}
                    deptMap={deptMap}
                    outlineById={deptOutlineById}
                    loading={loading}
                    editable={editable}
                    onDeptAnnualRevenue={onDeptAnnualRevenue}
                    onDeptMetricSemi={onDeptMetricSemi}
                    onDeptMetricQuarter={onDeptMetricQuarter}
                    onDeptMetricMonth={onDeptMetricMonth}
                    rootSumMismatch={companyRootMismatch.mismatch}
                  />
                </div>

                <div className="kpi-target-xls-block kpi-target-sample-outer">
                  <div className="kpi-target-xls-caption">
                    ③ {scopeType === 'team' ? '선택 부서 직원별 매출 목표액' : '선택 직원 매출 목표액'}
                  </div>
                  <p className="kpi-target-sample-lead">
                    {scopeType === 'team'
                      ? '선택한 부서에 직접 소속된 직원만 표시합니다.'
                      : '선택한 직원 한 명만 표시합니다.'}
                    {' '}직원 값을 수정하면 ② 부서 행과 ① 회사 목표가 함께 갱신됩니다.
                  </p>
                  <AllScopeStaffTargetMatrixTables
                    staffRows={visibleStaffRows}
                    departmentRows={visibleDepartmentRows}
                    loading={loading}
                    staffCascadeByUserId={visibleStaffCascade}
                    editable={editable}
                    onStaffAnnualRevenue={onStaffAnnualRevenue}
                    onStaffMetricMonth={onStaffMetricMonth}
                    onStaffMetricSemi={onStaffMetricSemi}
                    onStaffMetricQuarter={onStaffMetricQuarter}
                  />
                </div>
              </div>
            ) : null}

            {message ? <p className="kpi-target-modal-message">{message}</p> : null}
          </div>

          <div className="kpi-target-modal-footer">
            <button type="button" className="kpi-target-modal-cancel" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="kpi-target-modal-submit" disabled={saving || loading || !editable || !canSubmit}>
              <span>{saving ? '저장 중...' : submitLabel}</span>
            </button>
          </div>
        </form>
        </KpiPriorYoyPeekContext.Provider>
      </div>
    </div>
    </KpiTargetBulkProvider>
  );
}
