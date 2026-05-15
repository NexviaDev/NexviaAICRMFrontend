import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  fetchSalesOpportunityScheduleFieldContext,
  fetchSalesOpportunityScheduleLabelMap,
  SALES_OPPORTUNITY_SCHEDULE_DEFS_CHANGED,
  scheduleCustomDatesColumnTitle
} from '@/lib/sales-opportunity-schedule-labels';
import {
  fetchSalesOpportunityFinanceFieldContext,
  SALES_OPPORTUNITY_FINANCE_DEFS_CHANGED,
  financeCustomFieldsColumnTitle
} from '@/lib/sales-opportunity-finance-labels';
import { LIST_IDS } from '@/lib/list-templates';
import { SALES_PIPELINE_DEFAULT_VISIBLE_COLUMN_KEYS } from '@/sales-pipeline/drop-zone-list-modal/drop-zone-list-modal';
import { compactColumnCellStylesForSave } from '@/lib/list-column-cell-styles';
import './list-template-modal.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const LIST_TEMPLATE_DROP_ZONE = 'list-template-column';
const DND_MIME = 'application/x-list-template-column-key';

const LIST_TEMPLATE_FONT_SIZE_PRESETS = ['0.7rem', '0.75rem', '0.8125rem', '0.875rem', '0.9375rem', '1rem'];
const LIST_TEMPLATE_FONT_SIZE_PRESET_SET = new Set(LIST_TEMPLATE_FONT_SIZE_PRESETS);

/**
 * 같은 리스트 안에서 순서만 바꿈 (열 key 기준).
 * sidebar.js `reorderWithin` 과 동일한 splice 로직.
 */
function reorderWithin(list, draggedKey, dropTargetKey) {
  const next = [...list];
  const fromIdx = next.indexOf(draggedKey);
  if (fromIdx === -1) return list;
  const dropIdx = next.indexOf(dropTargetKey);
  if (dropIdx === -1) return list;
  if (fromIdx === dropIdx) return list;
  next.splice(fromIdx, 1);
  next.splice(dropIdx, 0, draggedKey);
  return next;
}

function isListTemplateReorderDrag(dataTransfer) {
  try {
    return Boolean(dataTransfer?.types && Array.from(dataTransfer.types).includes(DND_MIME));
  } catch {
    return false;
  }
}

/**
 * 리스트 컬럼 표시/숨김 및 순서 설정 모달.
 * @param {string} listId - customerCompanies | customerCompanyEmployees | productList | salesPipeline 등
 * @param {{ key: string, label: string }[]} columns - 현재 사용 중인 컬럼 정의 (순서 반영)
 * @param {{ [key: string]: boolean }} visible - 필드별 표시 여부
 * @param {string[]} columnOrder - 열 순서
 * @param {(payload: { visible: {}, columnOrder: string[], columnCellStyles?: Record<string, object> }) => void} onSave
 * @param {() => void} onClose
 * @param {string} [titleText]
 * @param {string} [hintText]
 * @param {Record<string, object>} [columnCellStyles] — 열별 셀 값 스타일 (listTemplates에 저장)
 * @param {boolean} [mergeSalesPipelineScheduleColumns=true] — false면 salesPipeline 일정 정의 열 병합·API 생략
 */
export default function ListTemplateModal({
  listId,
  columns,
  visible,
  columnOrder,
  columnCellStyles = {},
  onSave,
  onClose,
  titleText = '리스트 열 설정',
  hintText = '표시할 열을 선택하고, 왼쪽 핸들을 드래그해 순서를 바꿀 수 있습니다.',
  mergeSalesPipelineScheduleColumns = true
}) {
  const [localVisible, setLocalVisible] = useState(() => ({ ...visible }));
  const [localOrder, setLocalOrder] = useState(() => [...(columnOrder || [])]);
  const [localColumnCellStyles, setLocalColumnCellStyles] = useState(() => ({}));
  /** scheduleCustomDates.* → CustomFieldDefinition 라벨 (파이프라인 표·드롭존과 동일 API) */
  const [scheduleFieldLabelByKey, setScheduleFieldLabelByKey] = useState({});
  /** financeCustomFields.* → CustomFieldDefinition(salesOpportunityFinance) 라벨 */
  const [financeFieldLabelByKey, setFinanceFieldLabelByKey] = useState({});
  /** 세일즈 파이프라인 열 설정: 정의에만 있는 일정 키도 목록에 붙일 때 사용 */
  const [salesPipelineScheduleAllowedKeys, setSalesPipelineScheduleAllowedKeys] = useState(() => new Set());
  /** 세일즈 파이프라인: 계약·수금 추가 필드 정의 키 */
  const [salesPipelineFinanceAllowedKeys, setSalesPipelineFinanceAllowedKeys] = useState(() => new Set());

  const draggedKeyRef = useRef(null);
  const [draggingKey, setDraggingKey] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);

  const isSalesPipelineScheduleMerge =
    listId === LIST_IDS.SALES_PIPELINE && mergeSalesPipelineScheduleColumns !== false;

  useEffect(() => {
    if (!isSalesPipelineScheduleMerge) {
      setSalesPipelineScheduleAllowedKeys(new Set());
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      const ctx = await fetchSalesOpportunityScheduleFieldContext(getAuthHeader);
      if (!cancelled) {
        setScheduleFieldLabelByKey(ctx.labelByKey);
        setSalesPipelineScheduleAllowedKeys(ctx.allowedKeys);
      }
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
  }, [isSalesPipelineScheduleMerge]);

  const isSalesPipelineFinanceMerge = listId === LIST_IDS.SALES_PIPELINE;

  useEffect(() => {
    if (!isSalesPipelineFinanceMerge) {
      setFinanceFieldLabelByKey({});
      setSalesPipelineFinanceAllowedKeys(new Set());
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      const ctx = await fetchSalesOpportunityFinanceFieldContext(getAuthHeader);
      if (!cancelled) {
        setFinanceFieldLabelByKey(ctx.labelByKey);
        setSalesPipelineFinanceAllowedKeys(ctx.allowedKeys);
      }
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
  }, [isSalesPipelineFinanceMerge]);

  const needsScheduleFieldLabelsNonPipeline = useMemo(
    () =>
      !isSalesPipelineScheduleMerge &&
      (columnOrder || []).some((k) => typeof k === 'string' && k.startsWith('scheduleCustomDates.')),
    [isSalesPipelineScheduleMerge, columnOrder]
  );

  useEffect(() => {
    if (isSalesPipelineScheduleMerge || !needsScheduleFieldLabelsNonPipeline) {
      if (!isSalesPipelineScheduleMerge) setScheduleFieldLabelByKey({});
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      const map = await fetchSalesOpportunityScheduleLabelMap(getAuthHeader);
      if (!cancelled) setScheduleFieldLabelByKey(map);
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
  }, [isSalesPipelineScheduleMerge, needsScheduleFieldLabelsNonPipeline]);

  /** 파이프라인 표: 저장된 순서 + 일정·계약수금 정의에만 있고 순서에 없는 열 */
  const mergedColumnOrder = useMemo(() => {
    const base = [...(columnOrder || [])];
    const have = new Set(base);
    const trail = [];

    if (isSalesPipelineScheduleMerge && salesPipelineScheduleAllowedKeys.size) {
      for (const ik of salesPipelineScheduleAllowedKeys) {
        const ck = `scheduleCustomDates.${ik}`;
        if (!have.has(ck)) {
          have.add(ck);
          trail.push(ck);
        }
      }
    }
    if (isSalesPipelineFinanceMerge && salesPipelineFinanceAllowedKeys.size) {
      for (const ik of salesPipelineFinanceAllowedKeys) {
        const ck = `financeCustomFields.${ik}`;
        if (!have.has(ck)) {
          have.add(ck);
          trail.push(ck);
        }
      }
    }
    trail.sort((a, b) => a.localeCompare(b));
    return trail.length ? [...base, ...trail] : base;
  }, [
    isSalesPipelineScheduleMerge,
    isSalesPipelineFinanceMerge,
    columnOrder,
    salesPipelineScheduleAllowedKeys,
    salesPipelineFinanceAllowedKeys
  ]);

  const displayLabelForCol = useCallback(
    (col) => {
      if (String(col.key).startsWith('scheduleCustomDates.')) {
        return scheduleCustomDatesColumnTitle(col.key, scheduleFieldLabelByKey) || col.label;
      }
      if (String(col.key).startsWith('financeCustomFields.')) {
        return financeCustomFieldsColumnTitle(col.key, financeFieldLabelByKey) || col.label;
      }
      return col.label;
    },
    [scheduleFieldLabelByKey, financeFieldLabelByKey]
  );

  useEffect(() => {
    const order = mergedColumnOrder;
    const vis = { ...visible };
    for (const k of order) {
      if (!(k in vis)) {
        vis[k] =
          listId === LIST_IDS.SALES_PIPELINE ? SALES_PIPELINE_DEFAULT_VISIBLE_COLUMN_KEYS.has(k) : true;
      }
    }
    setLocalVisible(vis);
    setLocalOrder([...order]);
  }, [visible, mergedColumnOrder, listId]);

  useEffect(() => {
    const order = mergedColumnOrder;
    const next = {};
    for (const k of order) {
      const s = columnCellStyles?.[k];
      next[k] = s && typeof s === 'object' ? { ...s } : {};
    }
    setLocalColumnCellStyles(next);
  }, [mergedColumnOrder, columnCellStyles]);

  const patchCellStyle = useCallback((key, partial) => {
    setLocalColumnCellStyles((prev) => {
      const cur = { ...(prev[key] || {}) };
      for (const [k, v] of Object.entries(partial)) {
        if (v === undefined || v === '' || v === false) delete cur[k];
        else cur[k] = v;
      }
      return { ...prev, [key]: cur };
    });
  }, []);

  const handleToggle = (key) => {
    setLocalVisible((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleDragEnd = useCallback(() => {
    draggedKeyRef.current = null;
    setDraggingKey(null);
    setDragOverKey(null);
  }, []);

  const applyReorder = useCallback((dropTargetKey) => {
    const dragged = draggedKeyRef.current;
    if (!dragged) return;
    setLocalOrder((prev) => reorderWithin(prev, dragged, dropTargetKey));
  }, []);

  const handleDragStart = useCallback((e, key) => {
    e.stopPropagation();
    draggedKeyRef.current = key;
    setDraggingKey(key);
    e.dataTransfer.setData('text/plain', key);
    e.dataTransfer.setData(DND_MIME, key);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDrop = useCallback(
    (e, explicitDropKey) => {
      if (!draggedKeyRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const row = e.target.closest?.(`[data-list-template-drop-zone="${LIST_TEMPLATE_DROP_ZONE}"]`);
      const dropKey = explicitDropKey ?? row?.getAttribute?.('data-list-template-drop-key');
      if (dropKey == null) return;
      applyReorder(dropKey);
      handleDragEnd();
    },
    [applyReorder, handleDragEnd]
  );

  const handleRowDragOver = useCallback(
    (e, key) => {
      const reorderDrag = isListTemplateReorderDrag(e.dataTransfer) || Boolean(draggedKeyRef.current);
      if (!reorderDrag) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (key !== draggingKey) setDragOverKey(key);
    },
    [draggingKey]
  );

  const handleListDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOverKey(null);
  }, []);

  const handleSave = async () => {
    try {
      const cleanedStyles = compactColumnCellStylesForSave(localColumnCellStyles);
      await Promise.resolve(
        onSave({ visible: localVisible, columnOrder: localOrder, columnCellStyles: cleanedStyles })
      );
      onClose();
    } catch {
      /* 상위(alert 등) */
    }
  };

  return (
    <div
      className="list-template-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={titleText}
    >
      <div className="list-template-modal" data-list-template-id={listId || ''} onClick={(e) => e.stopPropagation()}>
        <div className="list-template-modal-header">
          <h3>{titleText}</h3>
          <button type="button" className="list-template-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="list-template-modal-body">
          <p className="list-template-modal-hint">{hintText}</p>
          <ul className="list-template-modal-list" onDragLeave={handleListDragLeave}>
            {localOrder.map((key) => {
              const col = columns.find((c) => c.key === key) || { key, label: key };
              const rowLabel = displayLabelForCol(col);
              const st = localColumnCellStyles[col.key] || {};
              const fs = st.fontSize && String(st.fontSize);
              const fsSelectValue = fs || '';
              const bold = st.fontWeight === '700' || st.fontWeight === '600' || st.fontWeight === 'bold';
              const italic = st.fontStyle === 'italic';
              const colorVal = typeof st.color === 'string' && st.color.trim() ? st.color.trim() : '#475569';
              return (
                <li
                  key={col.key}
                  data-list-template-drop-zone={LIST_TEMPLATE_DROP_ZONE}
                  data-list-template-drop-key={col.key}
                  className={`list-template-modal-item${draggingKey === col.key ? ' is-dragging' : ''}${
                    dragOverKey === col.key ? ' is-drag-over' : ''
                  }`}
                  onDragOver={(e) => handleRowDragOver(e, col.key)}
                  onDrop={(e) => handleDrop(e, col.key)}
                >
                  <div className="list-template-modal-item-main">
                    <span
                      className="list-template-modal-drag-handle"
                      draggable
                      onDragStart={(e) => handleDragStart(e, col.key)}
                      onDragEnd={handleDragEnd}
                      title="드래그하여 순서 변경"
                      aria-label={`${rowLabel} 순서 변경`}
                    >
                      <span className="material-symbols-outlined" aria-hidden>
                        drag_indicator
                      </span>
                    </span>
                    <label className="list-template-modal-item-label">
                      <input
                        type="checkbox"
                        checked={!!localVisible[col.key]}
                        onChange={() => handleToggle(col.key)}
                      />
                      <span>{rowLabel}</span>
                    </label>
                  </div>
                  <div className="list-template-modal-item-styles" onClick={(e) => e.stopPropagation()}>
                    <label className="list-template-modal-style-field">
                      <span className="list-template-modal-style-field-label">크기</span>
                      <select
                        className="list-template-modal-style-select"
                        value={fsSelectValue}
                        onChange={(e) =>
                          patchCellStyle(col.key, { fontSize: e.target.value ? e.target.value : undefined })
                        }
                        aria-label={`${rowLabel} 글자 크기`}
                      >
                        <option value="">기본</option>
                        {fs && !LIST_TEMPLATE_FONT_SIZE_PRESET_SET.has(fs) ? (
                          <option value={fs}>{fs} (저장됨)</option>
                        ) : null}
                        {LIST_TEMPLATE_FONT_SIZE_PRESETS.map((sz) => (
                          <option key={sz} value={sz}>
                            {sz === '0.7rem'
                              ? '작게'
                              : sz === '0.75rem'
                                ? '조금 작게'
                                : sz === '0.8125rem'
                                  ? '보통'
                                  : sz === '0.875rem'
                                    ? '조금 크게'
                                    : sz === '0.9375rem'
                                      ? '크게'
                                      : '아주 크게'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="list-template-modal-style-check">
                      <input
                        type="checkbox"
                        checked={bold}
                        onChange={(e) => patchCellStyle(col.key, { fontWeight: e.target.checked ? '700' : undefined })}
                      />
                      굵게
                    </label>
                    <label className="list-template-modal-style-check">
                      <input
                        type="checkbox"
                        checked={italic}
                        onChange={(e) => patchCellStyle(col.key, { fontStyle: e.target.checked ? 'italic' : undefined })}
                      />
                      기울임
                    </label>
                    <span className="list-template-modal-style-color-wrap">
                      <span className="list-template-modal-style-field-label">색</span>
                      <input
                        type="color"
                        className="list-template-modal-style-color"
                        value={/^#[0-9a-fA-F]{6}$/.test(colorVal) ? colorVal : '#475569'}
                        onChange={(e) => patchCellStyle(col.key, { color: e.target.value })}
                        aria-label={`${rowLabel} 글자 색`}
                      />
                      <button
                        type="button"
                        className="list-template-modal-style-color-clear"
                        onClick={() => patchCellStyle(col.key, { color: undefined })}
                      >
                        초기화
                      </button>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="list-template-modal-footer">
          <button type="button" className="btn-outline" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary" onClick={handleSave}>저장</button>
        </div>
      </div>
    </div>
  );
}
