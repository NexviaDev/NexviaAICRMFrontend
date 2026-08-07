import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession, getAuthHeader } from '@/lib/crm-auth';
import { API_BASE } from '@/config';
import {
  buildPricingStepRows,
  computeExchangeRatePricingChain,
  formatPricingResult,
  normalizeExchangeRatePricingProfile
} from '@/lib/exchange-rate-pricing-profile';
import {
  buildReferenceUsdToken,
  validateExchangeRateStepFormula,
  buildRateFieldValuesFromRows,
  mergeStepResultsIntoFieldValues,
  resolvePricingStepDefs,
  createCustomPricingStepId,
  sanitizePricingStepLabel,
  MAX_CUSTOM_PRICING_STEPS,
  DEFAULT_CUSTOM_STEP_FORMULA,
  buildFormulaRefColorMaps,
  buildStepResultToken,
  normalizeExchangeRateStepFormula
} from '@/lib/exchange-rate-formula-fields';
import './exchange-rate-pricing-panel.css';

function captureInputSelection(stepId, el, selectionStore) {
  if (!el || typeof el.selectionStart !== 'number') return;
  selectionStore.current[stepId] = {
    start: el.selectionStart,
    end: el.selectionEnd ?? el.selectionStart
  };
}

function FormulaInput({ value, onChange, onFocus, onTrackSelection, inputRef, ariaLabel }) {
  return (
    <input
      ref={inputRef}
      type="text"
      className="er-pricing-formula-input"
      value={value}
      onChange={onChange}
      onFocus={onFocus}
      onClick={onTrackSelection}
      onSelect={onTrackSelection}
      onKeyUp={onTrackSelection}
      onBlur={onTrackSelection}
      spellCheck={false}
      aria-label={ariaLabel}
    />
  );
}

export default function ExchangeRatePricingPanel({
  rateRows = [],
  initialProfile,
  canEdit = false,
  onSaved,
  onEditSessionChange
}) {
  const [profile, setProfile] = useState(() => normalizeExchangeRatePricingProfile(initialProfile));
  const [editing, setEditing] = useState(false);
  const [activeStepId, setActiveStepId] = useState('orderRate');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveOk, setSaveOk] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addLabel, setAddLabel] = useState('');
  const [addKind, setAddKind] = useState('rate');
  const [addError, setAddError] = useState('');
  const formulaRefs = useRef({});
  const formulaSelectionRef = useRef({});
  const pendingCaretRef = useRef(null);

  useEffect(() => {
    setProfile(normalizeExchangeRatePricingProfile(initialProfile));
  }, [initialProfile]);

  const chain = useMemo(
    () => computeExchangeRatePricingChain(rateRows, profile),
    [rateRows, profile]
  );

  const insertToken = useCallback(
    (token) => {
      if (!editing || !token) return;
      const stepId = activeStepId;
      const el = formulaRefs.current[stepId];
      let start = 0;
      let end = 0;

      if (el && typeof el.selectionStart === 'number' && document.activeElement === el) {
        start = el.selectionStart;
        end = el.selectionEnd ?? start;
      } else {
        const saved = formulaSelectionRef.current[stepId];
        if (saved && typeof saved.start === 'number') {
          start = saved.start;
          end = saved.end ?? start;
        } else {
          const cur = String(el?.value ?? formulaRefs.current[stepId]?.value ?? '');
          start = cur.length;
          end = start;
        }
      }

      let mergedCurrent = '';
      setProfile((prev) => {
        const next = normalizeExchangeRatePricingProfile(prev);
        mergedCurrent = String(next.stepFormulas[stepId] || '');
        const before = mergedCurrent.slice(0, start);
        const after = mergedCurrent.slice(end);
        const rawMerged = `${before}${token}${after}`;
        next.stepFormulas = {
          ...next.stepFormulas,
          [stepId]: normalizeExchangeRateStepFormula(rawMerged)
        };
        return next;
      });

      const rawMerged = `${mergedCurrent.slice(0, start)}${token}${mergedCurrent.slice(end)}`;
      const normalizedMerged = normalizeExchangeRateStepFormula(rawMerged);
      const equalsAdded =
        normalizedMerged.startsWith('=') && !rawMerged.trimStart().startsWith('=') ? 1 : 0;
      const newPos = start + token.length + equalsAdded;
      formulaSelectionRef.current[stepId] = { start: newPos, end: newPos };
      pendingCaretRef.current = { stepId, pos: newPos };
      setSaveOk('');
    },
    [editing, activeStepId]
  );

  useLayoutEffect(() => {
    const pending = pendingCaretRef.current;
    if (!pending) return;
    const { stepId, pos } = pending;
    pendingCaretRef.current = null;
    const input = formulaRefs.current[stepId];
    if (!input) return;
    input.focus({ preventScroll: true });
    try {
      input.setSelectionRange(pos, pos);
    } catch (_) {
      /* ignore */
    }
  }, [profile.stepFormulas, activeStepId]);

  const activeFormula = profile.stepFormulas[activeStepId] || '';
  const activeRefColorMaps = useMemo(
    () => buildFormulaRefColorMaps(activeFormula),
    [activeFormula]
  );

  useEffect(() => {
    onEditSessionChange?.(
      editing && canEdit
        ? { editing: true, activeStepId, activeFormula, insertToken }
        : null
    );
    return () => onEditSessionChange?.(null);
  }, [editing, canEdit, activeStepId, activeFormula, insertToken, onEditSessionChange]);

  const handleFormulaChange = useCallback((stepId, e) => {
    captureInputSelection(stepId, e.target, formulaSelectionRef);
    const raw = e.target.value;
    const value = raw.trim() === '' ? '' : normalizeExchangeRateStepFormula(raw);
    setProfile((prev) => {
      const next = normalizeExchangeRatePricingProfile(prev);
      next.stepFormulas = { ...next.stepFormulas, [stepId]: value };
      return next;
    });
    setSaveOk('');
  }, []);

  const handleFormulaTrackSelection = useCallback((stepId, e) => {
    captureInputSelection(stepId, e.target, formulaSelectionRef);
  }, []);

  const handleReferenceUsdChange = useCallback((raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    setProfile((prev) => normalizeExchangeRatePricingProfile({ ...prev, referenceUsdAmount: n }));
    setSaveOk('');
  }, []);

  const steps = useMemo(() => buildPricingStepRows(chain, profile), [chain, profile]);

  const handleSave = useCallback(async () => {
    if (!canEdit) return;
    const normalized = normalizeExchangeRatePricingProfile(profile);
    let partial = {};
    let fieldValues = buildRateFieldValuesFromRows(rateRows, normalized.referenceUsdAmount);
    const stepsDefs = resolvePricingStepDefs(normalized);

    for (const step of stepsDefs) {
      const check = validateExchangeRateStepFormula(normalized.stepFormulas[step.id], fieldValues);
      if (!check.ok) {
        setSaveError(`${step.label} 수식: ${check.error}`);
        return;
      }
      partial = { ...partial, [step.resultKey]: check.value };
      fieldValues = mergeStepResultsIntoFieldValues(fieldValues, partial, normalized);
    }

    setSaving(true);
    setSaveError('');
    setSaveOk('');
    try {
      const res = await fetch(`${API_BASE}/companies/exchange-rate-pricing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
        body: JSON.stringify({ profile: normalized })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || '산정 방식을 저장하지 못했습니다.');
        return;
      }
      setProfile(normalizeExchangeRatePricingProfile(data.profile));
      setEditing(false);
      setSaveOk('회사 산정 방식이 저장되었습니다.');
      onSaved?.(data.profile);
    } catch {
      setSaveError('서버에 연결할 수 없습니다.');
    } finally {
      setSaving(false);
    }
  }, [canEdit, profile, rateRows, onSaved]);

  const handleCancelEdit = useCallback(() => {
    setProfile(normalizeExchangeRatePricingProfile(initialProfile));
    setEditing(false);
    setAddOpen(false);
    setAddLabel('');
    setAddError('');
    setSaveError('');
  }, [initialProfile]);

  const handleAddStep = useCallback(() => {
    const label = sanitizePricingStepLabel(addLabel);
    if (!label) {
      setAddError('항목 이름을 입력해 주세요.');
      return;
    }
    const next = normalizeExchangeRatePricingProfile(profile);
    if ((next.customSteps || []).length >= MAX_CUSTOM_PRICING_STEPS) {
      setAddError(`추가 항목은 최대 ${MAX_CUSTOM_PRICING_STEPS}개까지입니다.`);
      return;
    }
    const known = resolvePricingStepDefs(next);
    if (known.some((s) => String(s.label).toLowerCase() === label.toLowerCase())) {
      setAddError('같은 이름의 항목이 이미 있습니다.');
      return;
    }
    const id = createCustomPricingStepId();
    next.customSteps = [
      ...(next.customSteps || []),
      { id, label, resultKind: addKind === 'money' ? 'money' : 'rate' }
    ];
    next.stepFormulas = {
      ...next.stepFormulas,
      [id]: DEFAULT_CUSTOM_STEP_FORMULA
    };
    setProfile(normalizeExchangeRatePricingProfile(next));
    setActiveStepId(id);
    setAddOpen(false);
    setAddLabel('');
    setAddKind('rate');
    setAddError('');
    setSaveOk('');
  }, [addLabel, addKind, profile]);

  const handleRemoveCustomStep = useCallback((stepId) => {
    setProfile((prev) => {
      const next = normalizeExchangeRatePricingProfile(prev);
      next.customSteps = (next.customSteps || []).filter((s) => s.id !== stepId);
      if (next.stepFormulas && next.stepFormulas[stepId] != null) {
        const { [stepId]: _removed, ...rest } = next.stepFormulas;
        next.stepFormulas = rest;
      }
      return normalizeExchangeRatePricingProfile(next);
    });
    setActiveStepId((cur) => (cur === stepId ? 'orderRate' : cur));
    setSaveOk('');
  }, []);

  const handleInsertStepField = useCallback(
    (stepId) => {
      const token = buildStepResultToken(stepId, profile);
      if (token) insertToken(token);
    },
    [insertToken, profile]
  );

  const formulaHints = useMemo(() => {
    return `필드 예: [USD-매매기준율], [발주환율], ${buildReferenceUsdToken()} · 「추가」항목·아래 환율 표 셀 클릭으로 삽입`;
  }, []);

  return (
    <div className="er-pricing-panel" aria-label="USD 가격·환율 산정">
      <div className="er-pricing-panel-head">
        <div>
          <h3 className="er-pricing-panel-title">USD 산정 방식</h3>
          <p className="er-pricing-panel-sub">
            송금(TTS){' '}
            <strong>{formatPricingResult(chain.remittanceRate, 'rate')}</strong>
            {editing && canEdit ? (
              <>
                {' '}
                · {buildReferenceUsdToken()}{' '}
                <input
                  type="number"
                  className="er-pricing-param-input er-pricing-param-input--usd"
                  min="0"
                  step="1"
                  value={profile.referenceUsdAmount}
                  onChange={(e) => handleReferenceUsdChange(e.target.value)}
                  aria-label="기준 USD"
                />
              </>
            ) : (
              <>
                {' '}
                · {buildReferenceUsdToken()}{' '}
                {formatPricingResult(profile.referenceUsdAmount, 'money')}
              </>
            )}
          </p>
        </div>
        {canEdit ? (
          <div className="er-pricing-panel-actions">
            {editing ? (
              <>
                <button
                  type="button"
                  className="er-pricing-btn er-pricing-btn--add"
                  onClick={() => {
                    setAddOpen((v) => !v);
                    setAddError('');
                  }}
                  disabled={saving}
                >
                  <span className="material-symbols-outlined">add</span>
                  추가
                </button>
                <button
                  type="button"
                  className="er-pricing-btn er-pricing-btn--cancel"
                  onClick={handleCancelEdit}
                  disabled={saving}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="er-pricing-btn er-pricing-btn--save"
                  onClick={() => void handleSave()}
                  disabled={saving}
                >
                  {saving ? '저장 중…' : '저장'}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="er-pricing-btn er-pricing-btn--edit"
                onClick={() => {
                  setEditing(true);
                  setSaveOk('');
                  setSaveError('');
                }}
              >
                <span className="material-symbols-outlined">edit</span>
                수식 수정
              </button>
            )}
          </div>
        ) : null}
      </div>

      {editing && canEdit ? (
        <p className="er-pricing-formula-hint">{formulaHints}</p>
      ) : null}

      {editing && canEdit && addOpen ? (
        <div className="er-pricing-add-row" role="group" aria-label="산정 항목 추가">
          <input
            type="text"
            className="er-pricing-add-input"
            value={addLabel}
            onChange={(e) => {
              setAddLabel(e.target.value);
              setAddError('');
            }}
            placeholder="항목 이름 (예: 인센환율)"
            maxLength={24}
            aria-label="추가 항목 이름"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddStep();
              }
            }}
          />
          <select
            className="er-pricing-add-kind"
            value={addKind}
            onChange={(e) => setAddKind(e.target.value)}
            aria-label="결과 형식"
          >
            <option value="rate">환율</option>
            <option value="money">금액</option>
          </select>
          <button type="button" className="er-pricing-btn er-pricing-btn--save" onClick={handleAddStep}>
            확인
          </button>
          {addError ? (
            <span className="er-pricing-add-error" role="alert">
              {addError}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="er-pricing-table-wrap">
        <table className="er-pricing-table er-pricing-table--grid">
          <tbody>
            <tr className="er-pricing-grid-row er-pricing-grid-row--head">
              <th scope="row" className="er-pricing-grid-corner">
                목록
              </th>
              {steps.map((step) => {
                const stepToken = buildStepResultToken(step.id, profile);
                const headerPickable = editing && canEdit && stepToken;
                return (
                  <th
                    key={step.id}
                    scope="col"
                    className={`er-pricing-grid-col-head${
                      headerPickable ? ' er-pricing-grid-col-head--pickable' : ''
                    }${step.custom ? ' er-pricing-grid-col-head--custom' : ''}`}
                    title={headerPickable ? `${stepToken} 수식에 삽입` : step.label}
                    onMouseDown={
                      headerPickable
                        ? (e) => {
                            e.preventDefault();
                          }
                        : undefined
                    }
                    onClick={
                      headerPickable
                        ? () => handleInsertStepField(step.id)
                        : undefined
                    }
                    onKeyDown={
                      headerPickable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleInsertStepField(step.id);
                            }
                          }
                        : undefined
                    }
                    tabIndex={headerPickable ? 0 : undefined}
                    role={headerPickable ? 'button' : undefined}
                  >
                    <span className="er-pricing-grid-col-head-label">{step.label}</span>
                    {editing && canEdit && step.custom ? (
                      <button
                        type="button"
                        className="er-pricing-col-remove"
                        title={`${step.label} 삭제`}
                        aria-label={`${step.label} 삭제`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveCustomStep(step.id);
                        }}
                      >
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    ) : null}
                  </th>
                );
              })}
            </tr>
            <tr className="er-pricing-grid-row er-pricing-grid-row--formula">
              <th scope="row" className="er-pricing-grid-row-head">
                공식
              </th>
              {steps.map((step) => (
                <td
                  key={step.id}
                  className={`er-pricing-grid-cell er-pricing-grid-cell--formula${
                    editing && activeStepId === step.id ? ' er-pricing-col--active' : ''
                  }`}
                >
                  {editing && canEdit ? (
                    <FormulaInput
                      value={profile.stepFormulas[step.id] || ''}
                      onChange={(e) => handleFormulaChange(step.id, e)}
                      onFocus={() => {
                        setActiveStepId(step.id);
                        captureInputSelection(step.id, formulaRefs.current[step.id], formulaSelectionRef);
                      }}
                      onTrackSelection={(e) => handleFormulaTrackSelection(step.id, e)}
                      inputRef={(el) => {
                        formulaRefs.current[step.id] = el;
                      }}
                      ariaLabel={`${step.label} 수식`}
                    />
                  ) : (
                    <code className="er-pricing-formula-code">{step.formula}</code>
                  )}
                </td>
              ))}
            </tr>
            <tr className="er-pricing-grid-row er-pricing-grid-row--result">
              <th scope="row" className="er-pricing-grid-row-head">
                결과
              </th>
              {steps.map((step) => (
                <td
                  key={step.id}
                  className={`er-pricing-grid-cell er-pricing-grid-cell--result${
                    editing && activeStepId === step.id ? ' er-pricing-col--active' : ''
                  }`}
                >
                  {formatPricingResult(step.result, step.resultKind)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <p className="er-pricing-panel-note">
          {editing
            ? '항목 「추가」로 산정 열을 더할 수 있습니다. 수식 입력란 커서에 [필드]가 삽입됩니다. 위 목록·아래 환율 표 셀을 클릭해 넣으세요. 저장 후 제품 수식에서도 같은 이름으로 사용됩니다.'
            : '회사 공통 산정 수식입니다. 관리자는 「수식 수정」에서 변경·추가할 수 있습니다.'}
        </p>
      ) : (
        <p className="er-pricing-panel-note">회사에 저장된 산정 수식으로 자동 계산됩니다.</p>
      )}

      {saveError ? (
        <p className="er-pricing-panel-msg er-pricing-panel-msg--error" role="alert">
          {saveError}
        </p>
      ) : null}
      {saveOk ? (
        <p className="er-pricing-panel-msg er-pricing-panel-msg--ok" role="status">
          {saveOk}
        </p>
      ) : null}
    </div>
  );
}
