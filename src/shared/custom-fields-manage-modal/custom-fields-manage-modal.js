import { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback } from 'react';
import { API_BASE } from '@/config';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import { dispatchSalesOpportunityScheduleDefsChanged } from '@/lib/sales-opportunity-schedule-labels';
import { dispatchSalesOpportunityFinanceDefsChanged } from '@/lib/sales-opportunity-finance-labels';
import { buildFormulaFieldPickerOptions, getFormulaFieldTypeHint } from '@/lib/custom-field-formula-catalog';
import {
  appendFormulaOperatorAtCursor,
  formatFormulaExpressionForLabel,
  insertFormulaFunctionAtCursor,
  insertFormulaInputFieldAtCursor,
  parseFormulaInput,
  validateFormulaExpression,
  FORMULA_FUNCTION_CATALOG,
  FORMULA_FUNCTION_GROUP_LABELS
} from '@/lib/custom-field-formula';
import './custom-fields-manage-modal.css';

const FORMULA_FN_GROUP_ORDER = ['accounting', 'general', 'advanced'];

const FIELD_TYPES = [
  { value: 'text', label: '글자' },
  { value: 'number', label: '숫자' },
  { value: 'date', label: '날짜' },
  { value: 'checkbox', label: '체크박스' }
];

const FORMULA_ENTITY_TYPES = new Set(['product', 'customerCompany', 'contact']);

const FORMULA_OPERATORS = ['+', '-', '*', '/'];

function defToEditDraft(def) {
  if (!def) return null;
  const isSelect = def.type === 'select' || def.type === 'multiselect';
  return {
    label: def.label || '',
    required: !!def.required,
    type: def.type || 'text',
    expression:
      def.type === 'formula' && def.options?.expression
        ? formatFormulaExpressionForLabel(def.options.expression)
        : '',
    selectListInput: Array.isArray(def.options?.choices) ? def.options.choices.join(', ') : '',
    useSelectList: isSelect,
    useMultiSelect: def.type === 'multiselect',
    scheduleEditableBeforeWon: !!def.options?.editableBeforeWon
  };
}

function buildRowDraftsFromDefinitions(defs = []) {
  return Object.fromEntries(defs.map((d) => [String(d._id), defToEditDraft(d)]));
}

function isRowDraftDirty(def, draft, entityType) {
  if (!def || !draft) return false;
  if (String(def.label || '').trim() !== String(draft.label || '').trim()) return true;
  if (!!def.required !== !!draft.required) return true;
  if (draft.type === 'formula') {
    if (def.type !== 'formula') return true;
    const orig = formatFormulaExpressionForLabel(def.options?.expression || '');
    return orig !== String(draft.expression || '').trim();
  }
  if (def.type === 'formula' && draft.type !== 'formula') return true;
  if (def.type === 'select' || def.type === 'multiselect') {
    const origChoices = (def.options?.choices || []).join(', ');
    return origChoices !== String(draft.selectListInput || '').trim();
  }
  if (entityType === 'salesOpportunitySchedule') {
    return !!def.options?.editableBeforeWon !== !!draft.scheduleEditableBeforeWon;
  }
  if (def.type !== 'formula' && def.type !== 'select' && def.type !== 'multiselect') {
    return (def.type || 'text') !== (draft.type || 'text');
  }
  return false;
}

function getDefTypeLabel(def) {
  if (def.type === 'formula') return '함수';
  if (def.type === 'multiselect') return '다중선택';
  if (def.type === 'select') return '선택';
  if (def.type === 'checkbox') return '체크';
  if (def.type === 'number') return '숫자';
  if (def.type === 'date') return '날짜';
  return def.type || '글자';
}

function buildUpdateBody(def, draft, entityType, definitions) {
  const label = String(draft.label || '').trim();
  if (!label) return { error: '표시 이름을 입력해 주세요.' };

  const body = { label, required: !!draft.required };

  if (draft.type === 'formula') {
    const parsed = parseFormulaInput(draft.expression);
    if (!parsed.isFormula || !parsed.expression) {
      return { error: '함수 수식을 입력해 주세요.' };
    }
    const check = validateFormulaExpression(
      parsed.expression,
      entityType,
      definitions.filter((d) => String(d._id) !== String(def._id))
    );
    if (!check.ok) return { error: check.error || '수식이 올바르지 않습니다.' };
    body.type = 'formula';
    body.options = { expression: parsed.expression };
    return { body };
  }

  if (def.type === 'formula') {
    body.type = draft.type || 'text';
    body.options = null;
    return { body };
  }

  if (entityType === 'salesOpportunitySchedule') {
    body.options = draft.scheduleEditableBeforeWon ? { editableBeforeWon: true } : null;
    return { body };
  }

  if (def.type === 'select' || def.type === 'multiselect') {
    const choices = String(draft.selectListInput || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!choices.length) return { error: '선택 목록을 하나 이상 입력해 주세요.' };
    body.options = { choices };
    return { body };
  }

  if (def.type !== 'formula' && def.type !== 'select' && def.type !== 'multiselect') {
    body.type = draft.type;
  }

  return { body };
}

function buildNewFieldPayload({
  entityType,
  leadCaptureFormId,
  fixedType,
  label,
  isFormulaMode,
  parsedFormula,
  newType,
  useSelectList,
  useMultiSelect,
  selectListInput,
  newRequired,
  scheduleEditableBeforeWon,
  order
}) {
  const type = isFormulaMode
    ? 'formula'
    : fixedType
      ? fixedType
      : useSelectList
        ? (useMultiSelect ? 'multiselect' : 'select')
        : newType;
  let optionsPayload = null;
  if (isFormulaMode) {
    optionsPayload = { expression: parsedFormula.expression };
  } else if (entityType === 'salesOpportunitySchedule') {
    optionsPayload = scheduleEditableBeforeWon ? { editableBeforeWon: true } : null;
  } else if (useSelectList && selectListInput.trim()) {
    optionsPayload = {
      choices: selectListInput.split(',').map((s) => s.trim()).filter(Boolean)
    };
  }
  const body = {
    entityType,
    key: 'field_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    label,
    type,
    required: newRequired,
    order,
    ...(optionsPayload ? { options: optionsPayload } : {})
  };
  if (entityType === 'leadCapture' && leadCaptureFormId) body.leadCaptureFormId = leadCaptureFormId;
  return body;
}

function validateNewFieldForm({
  label,
  isFormulaMode,
  parsedFormula,
  entityType,
  definitions,
  useSelectList,
  selectListInput
}) {
  if (!label) return { error: '표시 이름을 입력해 주세요.' };
  const duplicate = (definitions || []).some(
    (d) => String(d.label || '').trim().toLowerCase() === label.toLowerCase()
  );
  if (duplicate) return { error: '같은 표시 이름의 필드가 이미 있습니다.' };
  if (isFormulaMode) {
    const check = validateFormulaExpression(parsedFormula.expression, entityType, definitions);
    if (!check.ok) return { error: check.error || '수식이 올바르지 않습니다.' };
  }
  if (useSelectList && !selectListInput.trim()) {
    return { error: '선택 목록을 하나 이상 입력해 주세요.' };
  }
  return { ok: true };
}

/**
 * 추가 필드 관리 전용 모달.
 * 필드 추가 → 서버 즉시 저장 · 하단 확인 → 모달 닫기.
 */
export default function CustomFieldsManageModal({
  entityType,
  leadCaptureFormId = null,
  onClose,
  onFieldAdded,
  onDefinitionsUpdated,
  apiBase = API_BASE,
  getAuthHeader = () => ({}),
  fixedType = null,
  title = '추가 필드 관리',
  description = null,
  deleteConfirmMessage = null
}) {
  const allowed = isAdminOrAboveRole(getStoredCrmUser()?.role);
  const canUseFormula = FORMULA_ENTITY_TYPES.has(entityType) && !fixedType;
  const [definitions, setDefinitions] = useState([]);
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState(() => (fixedType || 'text'));
  const [newRequired, setNewRequired] = useState(false);
  const [useSelectList, setUseSelectList] = useState(false);
  const [useMultiSelect, setUseMultiSelect] = useState(false);
  const [selectListInput, setSelectListInput] = useState('');
  const [formulaInput, setFormulaInput] = useState('');
  const [formulaError, setFormulaError] = useState('');
  const [addingField, setAddingField] = useState(false);
  const formulaInputRef = useRef(null);
  const formulaSelectionRef = useRef({ start: 0, end: 0 });
  const pendingCaretRef = useRef(null);
  const [deletingId, setDeletingId] = useState(null);
  const [rowDrafts, setRowDrafts] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [savingEditId, setSavingEditId] = useState(null);
  const [scheduleEditableBeforeWon, setScheduleEditableBeforeWon] = useState(false);

  const formulaFieldOptions = useMemo(
    () => buildFormulaFieldPickerOptions(entityType, definitions),
    [entityType, definitions]
  );

  const formulaCatalogGroups = useMemo(() => {
    const grouped = new Map();
    for (const fn of FORMULA_FUNCTION_CATALOG) {
      const groupId = fn.group || 'general';
      if (!grouped.has(groupId)) grouped.set(groupId, []);
      grouped.get(groupId).push(fn);
    }
    return FORMULA_FN_GROUP_ORDER
      .filter((id) => grouped.has(id))
      .map((id) => ({
        id,
        label: FORMULA_FUNCTION_GROUP_LABELS[id] || id,
        items: grouped.get(id)
      }));
  }, []);

  const parsedFormula = useMemo(() => parseFormulaInput(formulaInput), [formulaInput]);
  const isFormulaMode = parsedFormula.isFormula;

  const inlineFieldTypes = useMemo(
    () => (canUseFormula ? [...FIELD_TYPES, { value: 'formula', label: '함수' }] : FIELD_TYPES),
    [canUseFormula]
  );

  const updateRowDraft = (id, patch) => {
    const sid = String(id);
    setRowDrafts((prev) => ({ ...prev, [sid]: { ...prev[sid], ...patch } }));
    setRowErrors((prev) => ({ ...prev, [sid]: '' }));
  };

  const handleInlineTypeChange = (defId, nextType) => {
    const sid = String(defId);
    setRowDrafts((prev) => {
      const cur = prev[sid];
      const patch = { type: nextType };
      if (nextType === 'formula' && !String(cur?.expression || '').trim()) {
        patch.expression = '=';
      }
      return { ...prev, [sid]: { ...cur, ...patch } };
    });
    setRowErrors((prev) => ({ ...prev, [sid]: '' }));
  };

  const listUrl = entityType === 'leadCapture' && leadCaptureFormId
    ? `${apiBase}/custom-field-definitions?entityType=leadCapture&leadCaptureFormId=${encodeURIComponent(leadCaptureFormId)}`
    : `${apiBase}/custom-field-definitions?entityType=${entityType}`;

  const fetchDefinitions = async () => {
    try {
      const res = await fetch(listUrl, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) {
        setDefinitions(data.items);
        setRowDrafts(buildRowDraftsFromDefinitions(data.items));
        setRowErrors({});
      }
    } catch (_) {}
  };

  useEffect(() => {
    fetchDefinitions();
  }, [entityType, leadCaptureFormId]);

  useEffect(() => {
    if (fixedType) setNewType(fixedType);
  }, [fixedType]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const resetFormulaState = () => {
    setFormulaInput('');
    setFormulaError('');
    formulaSelectionRef.current = { start: 0, end: 0 };
  };

  const captureFormulaSelection = useCallback(() => {
    const el = formulaInputRef.current;
    const len = String(formulaInput || '').length;
    if (!el) {
      formulaSelectionRef.current = { start: len, end: len };
      return;
    }
    formulaSelectionRef.current = {
      start: typeof el.selectionStart === 'number' ? el.selectionStart : len,
      end: typeof el.selectionEnd === 'number' ? el.selectionEnd : len
    };
  }, [formulaInput]);

  const applyFormulaEdit = useCallback((transformFn) => {
    const { start, end } = formulaSelectionRef.current;
    const { value, caret } = transformFn(formulaInput, start, end);
    setFormulaInput(value);
    formulaSelectionRef.current = { start: caret, end: caret };
    pendingCaretRef.current = { el: formulaInputRef.current, caret };
    setFormulaError('');
  }, [formulaInput]);

  const handleInsertFormulaFieldLabel = (label) => {
    applyFormulaEdit((cur, s, e) => insertFormulaInputFieldAtCursor(cur, label, s, e));
  };

  const handleAppendOperator = (op) => {
    applyFormulaEdit((cur, s, e) => appendFormulaOperatorAtCursor(cur, op, s, e));
  };

  const handleInsertFormulaFunctionName = (fnName) => {
    applyFormulaEdit((cur, s, e) => insertFormulaFunctionAtCursor(cur, fnName, s, e));
  };

  useLayoutEffect(() => {
    const pending = pendingCaretRef.current;
    if (!pending?.el) return;
    pendingCaretRef.current = null;
    pending.el.focus?.({ preventScroll: true });
    if (typeof pending.caret === 'number') {
      pending.el.setSelectionRange?.(pending.caret, pending.caret);
    }
  });

  const onFormulaPanelMouseDown = (e) => {
    e.preventDefault();
    captureFormulaSelection();
  };

  const resetNewFieldForm = () => {
    setNewLabel('');
    setNewType(fixedType || 'text');
    setNewRequired(false);
    setUseSelectList(false);
    setUseMultiSelect(false);
    setSelectListInput('');
    setScheduleEditableBeforeWon(false);
    resetFormulaState();
  };

  const handleAddField = async (e) => {
    e?.preventDefault();
    const label = (newLabel || '').trim();
    const validation = validateNewFieldForm({
      label,
      isFormulaMode,
      parsedFormula,
      entityType,
      definitions,
      useSelectList,
      selectListInput
    });
    if (validation.error) {
      if (isFormulaMode || validation.error.includes('수식')) {
        setFormulaError(validation.error);
      } else {
        alert(validation.error);
      }
      return;
    }
    setFormulaError('');
    const payload = buildNewFieldPayload({
      entityType,
      leadCaptureFormId,
      fixedType,
      label,
      isFormulaMode,
      parsedFormula,
      newType,
      useSelectList,
      useMultiSelect,
      selectListInput,
      newRequired,
      scheduleEditableBeforeWon,
      order: definitions.length
    });
    setAddingField(true);
    try {
      const res = await fetch(`${apiBase}/custom-field-definitions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || `"${label}" 필드 추가에 실패했습니다.`);
        return;
      }
      await fetchDefinitions();
      onFieldAdded?.();
      onDefinitionsUpdated?.();
      if (entityType === 'salesOpportunitySchedule') dispatchSalesOpportunityScheduleDefsChanged();
      if (entityType === 'salesOpportunityFinance') dispatchSalesOpportunityFinanceDefsChanged();
      resetNewFieldForm();
    } catch (_) {
      alert('서버에 연결할 수 없습니다.');
    } finally {
      setAddingField(false);
    }
  };

  const handleConfirm = () => {
    onClose();
  };

  const handleDelete = async (id) => {
    if (!id) return;
    if (deleteConfirmMessage && !window.confirm(deleteConfirmMessage)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`${apiBase}/custom-field-definitions/${id}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      if (res.ok) {
        setRowDrafts((prev) => {
          const next = { ...prev };
          delete next[String(id)];
          return next;
        });
        setRowErrors((prev) => {
          const next = { ...prev };
          delete next[String(id)];
          return next;
        });
        fetchDefinitions();
        onDefinitionsUpdated?.();
        if (entityType === 'salesOpportunitySchedule') dispatchSalesOpportunityScheduleDefsChanged();
        if (entityType === 'salesOpportunityFinance') dispatchSalesOpportunityFinanceDefsChanged();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || '삭제에 실패했습니다.');
      }
    } catch (_) {
      alert('서버에 연결할 수 없습니다.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSaveRow = async (def) => {
    if (!def?._id) return;
    const sid = String(def._id);
    const draft = rowDrafts[sid];
    if (!draft) return;

    const built = buildUpdateBody(def, draft, entityType, definitions);
    if (built.error) {
      setRowErrors((prev) => ({ ...prev, [sid]: built.error }));
      return;
    }

    setSavingEditId(def._id);
    setRowErrors((prev) => ({ ...prev, [sid]: '' }));
    try {
      const res = await fetch(`${apiBase}/custom-field-definitions/${def._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(built.body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowErrors((prev) => ({ ...prev, [sid]: data.error || '수정에 실패했습니다.' }));
        return;
      }
      fetchDefinitions();
      onDefinitionsUpdated?.();
      if (entityType === 'salesOpportunitySchedule') dispatchSalesOpportunityScheduleDefsChanged();
      if (entityType === 'salesOpportunityFinance') dispatchSalesOpportunityFinanceDefsChanged();
    } catch (_) {
      setRowErrors((prev) => ({ ...prev, [sid]: '서버에 연결할 수 없습니다.' }));
    } finally {
      setSavingEditId(null);
    }
  };

  if (!allowed) {
    return (
      <>
        <div className="custom-fields-manage-overlay" onClick={onClose} aria-hidden="true" />
        <div className="custom-fields-manage-modal" role="alertdialog" aria-labelledby="custom-fields-denied-title">
          <div className="custom-fields-manage-inner">
            <header className="custom-fields-manage-header">
              <h3 id="custom-fields-denied-title">권한 필요</h3>
              <button type="button" className="custom-fields-manage-close" onClick={onClose} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </header>
            <div className="custom-fields-manage-body">
              <p className="custom-fields-manage-denied-msg">
                추가 필드 정의는 대표(Owner) 또는 관리자(Admin)만 사용할 수 있습니다.
              </p>
              <button type="button" className="custom-fields-manage-add-btn" onClick={onClose}>닫기</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="custom-fields-manage-overlay" aria-hidden="true" />
      <div className={`custom-fields-manage-modal ${canUseFormula ? 'custom-fields-manage-modal--formula' : ''}`}>
        <div className="custom-fields-manage-inner">
          <header className="custom-fields-manage-header">
            <h3>{title}</h3>
            <button type="button" className="custom-fields-manage-close" onClick={onClose} aria-label="닫기">
              <span className="material-symbols-outlined">close</span>
            </button>
          </header>
          <div className="custom-fields-manage-body">
            {description ? (
              <p className="custom-fields-manage-modal-desc">{description}</p>
            ) : null}
            <form
              id="custom-fields-manage-add-form"
              onSubmit={handleAddField}
              className={`custom-fields-manage-form${canUseFormula ? ' custom-fields-manage-form--with-formula' : ''}`}
            >
              <div className={canUseFormula ? 'custom-fields-manage-form-layout' : ''}>
                <div className="custom-fields-manage-form-main">
                  <div className="custom-fields-manage-field custom-fields-manage-field--label-row">
                    <label htmlFor="custom-field-new-label">표시 이름</label>
                    <div className="custom-fields-manage-label-row">
                      <input
                        id="custom-field-new-label"
                        type="text"
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder={isFormulaMode ? '예: 순마진' : '예: 로트번호'}
                        required
                      />
                      <button
                        type="submit"
                        className="custom-fields-manage-apply-btn"
                        disabled={!(newLabel || '').trim() || addingField}
                        title="서버에 등록하고 오른쪽 필드 목록에 바로 반영"
                        aria-label="필드 추가"
                      >
                        <span className="material-symbols-outlined">add</span>
                        <span className="custom-fields-manage-apply-btn-text">필드 추가</span>
                      </button>
                    </div>
                  </div>

                  {canUseFormula ? (
                    <div className="custom-fields-manage-formula-panel">
                      <div className="custom-fields-manage-field">
                        <label htmlFor="custom-field-formula-expr">함수 표현</label>
                        <input
                          id="custom-field-formula-expr"
                          ref={formulaInputRef}
                          type="text"
                          className="custom-fields-manage-formula-input"
                          value={formulaInput}
                          onChange={(e) => {
                            setFormulaInput(e.target.value);
                            setFormulaError('');
                          }}
                          onFocus={captureFormulaSelection}
                          onClick={captureFormulaSelection}
                          onSelect={captureFormulaSelection}
                          onKeyUp={captureFormulaSelection}
                          placeholder="=[제품 소비자가]-[제품 원가]"
                          autoComplete="off"
                          spellCheck={false}
                        />
                        <p className="custom-fields-manage-hint">
                          <strong>=</strong> 로 시작 · <strong>[필드]</strong> · <strong>+ - * / ( )</strong> ·
                          엑셀 함수(if, iferror, round, dec, max 등) · [필드] · [환율][발주환율][통화환율] 등 · + - * / · 비교(&gt; &lt; = &gt;= &lt;= &lt;&gt;)
                        </p>
                      </div>
                      <div className="custom-fields-manage-formula-ops" role="group" aria-label="연산자">
                        {FORMULA_OPERATORS.map((op) => (
                          <button
                            key={op}
                            type="button"
                            className="custom-fields-manage-formula-op-btn"
                            onMouseDown={onFormulaPanelMouseDown}
                            onClick={() => handleAppendOperator(op)}
                          >
                            {op}
                          </button>
                        ))}
                      </div>
                      {isFormulaMode ? (
                        <p className="custom-fields-manage-formula-mode-badge">함수 필드로 등록됩니다</p>
                      ) : null}
                      {formulaError ? (
                        <p className="custom-fields-manage-formula-error" role="alert">{formulaError}</p>
                      ) : null}
                    </div>
                  ) : null}

              {entityType === 'salesOpportunitySchedule' ? (
                <div className="custom-fields-manage-field custom-fields-manage-field--schedule-timing">
                  <span className="custom-fields-manage-subfield-label" id="schedule-timing-label">
                    입력 가능 시점
                  </span>
                  <div
                    className="custom-fields-manage-radio-group"
                    role="radiogroup"
                    aria-labelledby="schedule-timing-label"
                  >
                    <label className="custom-fields-manage-radio-label">
                      <input
                        type="radio"
                        name="scheduleTiming"
                        checked={!scheduleEditableBeforeWon}
                        onChange={() => setScheduleEditableBeforeWon(false)}
                      />
                      <span>수주 성공(Won) 이후에만</span>
                    </label>
                    <label className="custom-fields-manage-radio-label">
                      <input
                        type="radio"
                        name="scheduleTiming"
                        checked={scheduleEditableBeforeWon}
                        onChange={() => setScheduleEditableBeforeWon(true)}
                      />
                      <span>수주 전 단계에서도 입력 가능</span>
                    </label>
                  </div>
                </div>
              ) : null}

              {!fixedType && !isFormulaMode ? (
              <div className="custom-fields-manage-field">
                <label>타입</label>
                <select value={newType} onChange={(e) => setNewType(e.target.value)} disabled={useSelectList}>
                  {FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              ) : null}

              {!fixedType && !isFormulaMode ? (
              <div className="custom-fields-manage-field">
                <label className="custom-fields-manage-checkbox-label">
                  <input
                    type="checkbox"
                    checked={useSelectList}
                    onChange={(e) => setUseSelectList(e.target.checked)}
                  />
                  <span>선택할 수 있는 목록 사용</span>
                </label>
                {useSelectList && (
                  <>
                    <label className="custom-fields-manage-checkbox-label custom-fields-manage-multiselect-opt">
                      <input
                        type="checkbox"
                        checked={useMultiSelect}
                        onChange={(e) => setUseMultiSelect(e.target.checked)}
                      />
                      <span>다중 선택</span>
                    </label>
                    <input
                      type="text"
                      value={selectListInput}
                      onChange={(e) => setSelectListInput(e.target.value)}
                      placeholder="타입, 모듈 (쉼표로 구분)"
                      className="custom-fields-manage-choices-input"
                    />
                    <p className="custom-fields-manage-hint">쉼표(,)로 구분하면 여러 항목으로 등록됩니다. 예: 타입, 모듈</p>
                  </>
                )}
              </div>
              ) : null}

              <div className="custom-fields-manage-field custom-fields-manage-field--required">
                <label className="custom-fields-manage-checkbox-label">
                  <input type="checkbox" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} />
                  <span>필수</span>
                </label>
              </div>
                </div>

                {canUseFormula ? (
                  <aside className="custom-fields-manage-formula-fields-panel" aria-label="수식 필드·함수">
                    <div className="custom-fields-manage-formula-panel-col custom-fields-manage-formula-panel-col--fields">
                      <h4 className="custom-fields-manage-formula-fields-title">필드</h4>
                      <p className="custom-fields-manage-formula-fields-hint">클릭하여 삽입</p>
                      <div className="custom-fields-manage-formula-panel-scroll">
                        <ul className="custom-fields-manage-formula-fields-list">
                          {formulaFieldOptions.map((opt) => (
                            <li key={opt.key}>
                              <button
                                type="button"
                                className="custom-fields-manage-formula-field-btn"
                                onMouseDown={onFormulaPanelMouseDown}
                                onClick={() => handleInsertFormulaFieldLabel(opt.label)}
                              >
                                <span className="custom-fields-manage-formula-field-btn-label">{opt.label}</span>
                                {opt.subtitle ? (
                                  <span className="custom-fields-manage-formula-field-btn-desc">{opt.subtitle}</span>
                                ) : null}
                                <span className="custom-fields-manage-formula-field-btn-type">
                                  {getFormulaFieldTypeHint(opt.fieldType)}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="custom-fields-manage-formula-panel-col custom-fields-manage-formula-panel-col--fn">
                      <h4 className="custom-fields-manage-formula-fields-title">함수</h4>
                      <p className="custom-fields-manage-formula-fields-hint">회계·금액 함수가 먼저 표시됩니다</p>
                      <div className="custom-fields-manage-formula-panel-scroll">
                        {formulaCatalogGroups.map((group) => (
                          <section key={group.id} className="custom-fields-manage-formula-fn-group">
                            <p className="custom-fields-manage-formula-fn-group-label">{group.label}</p>
                            <ul className="custom-fields-manage-formula-fn-list">
                              {group.items.map((fn) => (
                                <li key={fn.name}>
                                  <button
                                    type="button"
                                    className="custom-fields-manage-formula-fn-btn"
                                    title={fn.example}
                                    onMouseDown={onFormulaPanelMouseDown}
                                    onClick={() => handleInsertFormulaFunctionName(fn.name)}
                                  >
                                    <span className="custom-fields-manage-formula-fn-name">{fn.name}</span>
                                    <span className="custom-fields-manage-formula-fn-desc">{fn.desc}</span>
                                    <span className="custom-fields-manage-formula-fn-example">{fn.example}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </section>
                        ))}
                      </div>
                    </div>
                  </aside>
                ) : null}
              </div>
            </form>
            {definitions.length > 0 && (
              <div className="custom-fields-manage-list">
                <h4>추가된 필드</h4>
                <p className="custom-fields-manage-list-hint">
                  필드 추가 시 즉시 저장되며 오른쪽 수식 패널에 반영됩니다. 타입에서 「함수」로 전환·해제(글자/숫자 등)가 가능합니다. 값을 수정한 뒤 ✓ 를 눌러 저장하세요.
                </p>
                <ul>
                  {definitions.map((def) => {
                    const sid = String(def._id);
                    const draft = rowDrafts[sid] || defToEditDraft(def);
                    const draftType = draft.type || def.type || 'text';
                    const isFormulaDraft = draftType === 'formula';
                    const dirty = isRowDraftDirty(def, draft, entityType);
                    const rowError = rowErrors[sid];
                    const saving = String(savingEditId) === sid;
                    return (
                      <li key={def._id} className={`custom-fields-manage-list-item${dirty ? ' custom-fields-manage-list-item--dirty' : ''}`}>
                        <div className="custom-fields-manage-list-row">
                          <span className={`custom-fields-manage-list-type-badge${isFormulaDraft ? ' custom-fields-manage-list-type-badge--formula' : ''}`}>
                            {getDefTypeLabel({ ...def, type: draftType })}
                          </span>
                          <input
                            type="text"
                            className="custom-fields-manage-list-name-input"
                            value={draft.label}
                            onChange={(e) => updateRowDraft(def._id, { label: e.target.value })}
                            placeholder="표시 이름"
                            aria-label={`${def.label} 표시 이름`}
                          />
                          {isFormulaDraft ? (
                            <input
                              type="text"
                              className="custom-fields-manage-list-expr-input"
                              value={draft.expression}
                              onChange={(e) => updateRowDraft(def._id, { expression: e.target.value })}
                              placeholder="=[제품 소비자가]-[제품 원가]"
                              autoComplete="off"
                              spellCheck={false}
                              aria-label={`${def.label} 함수 수식`}
                            />
                          ) : null}
                          {def.type === 'select' || def.type === 'multiselect' ? (
                            <input
                              type="text"
                              className="custom-fields-manage-list-expr-input"
                              value={draft.selectListInput}
                              onChange={(e) => updateRowDraft(def._id, { selectListInput: e.target.value })}
                              placeholder="선택 목록 (쉼표 구분)"
                              aria-label={`${def.label} 선택 목록`}
                            />
                          ) : null}
                          {!fixedType
                          && def.type !== 'select'
                          && def.type !== 'multiselect'
                          && entityType !== 'salesOpportunitySchedule' ? (
                            <select
                              className="custom-fields-manage-list-type-select"
                              value={draftType}
                              onChange={(e) => handleInlineTypeChange(def._id, e.target.value)}
                              aria-label={`${def.label} 타입`}
                            >
                              {inlineFieldTypes.map((t) => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))}
                            </select>
                          ) : null}
                          <label className="custom-fields-manage-list-required" title="필수">
                            <input
                              type="checkbox"
                              checked={draft.required}
                              onChange={(e) => updateRowDraft(def._id, { required: e.target.checked })}
                            />
                            <span>필수</span>
                          </label>
                          <div className="custom-fields-manage-list-actions">
                            <button
                              type="button"
                              className={`custom-fields-manage-list-save-btn${dirty ? ' is-active' : ''}`}
                              onClick={() => handleSaveRow(def)}
                              disabled={!dirty || saving || !!deletingId}
                              aria-label={`${def.label} 저장`}
                              title={dirty ? '변경 저장' : '변경 없음'}
                            >
                              <span className="material-symbols-outlined">{saving ? 'hourglass_empty' : 'check'}</span>
                            </button>
                            <button
                              type="button"
                              className="custom-fields-manage-list-delete"
                              onClick={() => handleDelete(def._id)}
                              disabled={!!deletingId || saving}
                              aria-label={`${def.label} 삭제`}
                            >
                              <span className="material-symbols-outlined">delete</span>
                            </button>
                          </div>
                        </div>
                        {entityType === 'salesOpportunitySchedule' ? (
                          <div className="custom-fields-manage-list-subrow">
                            <span className="custom-fields-manage-list-subrow-label">입력 시점</span>
                            <label className="custom-fields-manage-list-subrow-radio">
                              <input
                                type="radio"
                                name={`inline-schedule-${def._id}`}
                                checked={!draft.scheduleEditableBeforeWon}
                                onChange={() => updateRowDraft(def._id, { scheduleEditableBeforeWon: false })}
                              />
                              <span>Won 후</span>
                            </label>
                            <label className="custom-fields-manage-list-subrow-radio">
                              <input
                                type="radio"
                                name={`inline-schedule-${def._id}`}
                                checked={draft.scheduleEditableBeforeWon}
                                onChange={() => updateRowDraft(def._id, { scheduleEditableBeforeWon: true })}
                              />
                              <span>수주 전</span>
                            </label>
                          </div>
                        ) : null}
                        {rowError ? (
                          <p className="custom-fields-manage-list-row-error" role="alert">{rowError}</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
          <footer className="custom-fields-manage-footer">
            <button
              type="button"
              className="custom-fields-manage-add-btn"
              onClick={handleConfirm}
              disabled={addingField}
            >
              {addingField ? '등록 중…' : '확인'}
            </button>
          </footer>
        </div>
      </div>
    </>
  );
}
