import { useState, useEffect, useMemo, useCallback } from 'react';
import { API_BASE } from '@/config';
import {
  buildTargetOptionsForTarget,
  buildSourceOptions,
  previewMappedValue,
  rowStatus,
  toApiMappings,
  rowsFromSavedMappings,
  inferRegisterTargetFromMappings,
  ensureContactMappingRowsComplete,
  ensureCompanyMappingRowsComplete,
  appendMissingContactCustomFieldRows,
  appendMissingCompanyCustomFieldRows,
  BUSINESS_CARD_AUTO_TARGET
} from './lead-capture-crm-mapping-utils';
import './lead-capture-crm-mapping-modal.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function newRowId() {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function LeadCaptureCrmMappingModal({
  open,
  onClose,
  formId,
  formName,
  sampleLead,
  initialCrmFieldMapping,
  customFieldDefinitions,
  onSaved,
  selectedLeadIds = [],
  onPushComplete
}) {
  const [contactCustomDefs, setContactCustomDefs] = useState([]);
  const [companyCustomDefs, setCompanyCustomDefs] = useState([]);
  const [contactSchemaFields, setContactSchemaFields] = useState([]);
  const [companySchemaFields, setCompanySchemaFields] = useState([]);
  const [registerTarget, setRegisterTarget] = useState('contact');
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  const targetOptions = useMemo(() => {
    const schemaFields = registerTarget === 'contact' ? contactSchemaFields : companySchemaFields;
    const customDefs = registerTarget === 'contact' ? contactCustomDefs : companyCustomDefs;
    return buildTargetOptionsForTarget(registerTarget, schemaFields, customDefs);
  }, [registerTarget, contactSchemaFields, companySchemaFields, contactCustomDefs, companyCustomDefs]);
  const sourceOptions = useMemo(
    () => buildSourceOptions(customFieldDefinitions),
    [customFieldDefinitions]
  );

  useEffect(() => {
    if (!open || !formId) return;
    let cancelled = false;
    (async () => {
      try {
        const [c1, c2, sf] = await Promise.all([
          fetch(`${API_BASE}/custom-field-definitions?entityType=contact`, {
            headers: getAuthHeader(),
            credentials: 'include'
          }).then((r) => r.json()),
          fetch(`${API_BASE}/custom-field-definitions?entityType=customerCompany`, {
            headers: getAuthHeader(),
            credentials: 'include'
          }).then((r) => r.json()),
          fetch(`${API_BASE}/lead-capture-forms/crm-mappable-fields`, {
            headers: getAuthHeader(),
            credentials: 'include'
          }).then((r) => r.json())
        ]);
        if (cancelled) return;
        setContactCustomDefs(Array.isArray(c1.items) ? c1.items : []);
        setCompanyCustomDefs(Array.isArray(c2.items) ? c2.items : []);
        setContactSchemaFields(Array.isArray(sf.contact) ? sf.contact : []);
        setCompanySchemaFields(Array.isArray(sf.company) ? sf.company : []);
      } catch (_) {
        if (!cancelled) {
          setContactCustomDefs([]);
          setCompanyCustomDefs([]);
          setContactSchemaFields([]);
          setCompanySchemaFields([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [open, formId]);

  useEffect(() => {
    if (!open) return;
    const m = initialCrmFieldMapping;
    let rt = 'contact';
    if (m?.registerTarget === 'company') rt = 'company';
    else if (m?.registerTarget === 'contact') rt = 'contact';
    else if (Array.isArray(m?.mappings) && m.mappings.length > 0) {
      rt = inferRegisterTargetFromMappings(m.mappings);
    }
    setRegisterTarget(rt);
    let next = rowsFromSavedMappings(m?.mappings, rt);
    next = rt === 'contact' ? ensureContactMappingRowsComplete(next) : ensureCompanyMappingRowsComplete(next);
    setRows(next);
    setSaveMsg(null);
  }, [open, formId, initialCrmFieldMapping]);

  /** CRM 추가 필드 정의가 늦게 오면 빠진 대상 행만 붙임 (저장 매핑·편집 유지) */
  useEffect(() => {
    if (!open) return;
    setRows((prev) => {
      if (!prev || prev.length === 0) return prev;
      if (registerTarget === 'contact') {
        return appendMissingContactCustomFieldRows(
          ensureContactMappingRowsComplete(prev),
          contactCustomDefs,
          customFieldDefinitions
        );
      }
      return appendMissingCompanyCustomFieldRows(
        ensureCompanyMappingRowsComplete(prev),
        companyCustomDefs,
        customFieldDefinitions
      );
    });
  }, [open, registerTarget, contactCustomDefs, companyCustomDefs, customFieldDefinitions]);

  const lead = sampleLead || { name: '', email: '', customFields: {} };

  const setRegisterTargetAndReset = useCallback(
    (rt) => {
      if (rt === registerTarget) return;
      setRegisterTarget(rt);
      const m = initialCrmFieldMapping;
      let next = rowsFromSavedMappings(m?.mappings, rt);
      next = rt === 'contact' ? ensureContactMappingRowsComplete(next) : ensureCompanyMappingRowsComplete(next);
      next =
        rt === 'contact'
          ? appendMissingContactCustomFieldRows(next, contactCustomDefs, customFieldDefinitions)
          : appendMissingCompanyCustomFieldRows(next, companyCustomDefs, customFieldDefinitions);
      setRows(next);
      setSaveMsg(null);
    },
    [registerTarget, initialCrmFieldMapping, contactCustomDefs, companyCustomDefs, customFieldDefinitions]
  );

  const updateRow = useCallback((id, patch) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const addConstantRow = useCallback(() => {
    const tk = registerTarget === 'company' ? 'company.memo' : 'contact.memo';
    setRows((prev) => [
      ...prev,
      {
        id: newRowId(),
        sourceType: 'constant',
        sourceKey: '',
        constantValue: '',
        targetKey: tk
      }
    ]);
  }, [registerTarget]);

  const removeRow = useCallback((id) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleMappingStart = async () => {
    if (!formId) return;
    const invalid = rows.some((r) => {
      if (!r.targetKey) return true;
      if (registerTarget === 'contact' && !r.targetKey.startsWith('contact.')) return true;
      if (registerTarget === 'company' && !r.targetKey.startsWith('company.')) return true;
      return false;
    });
    if (invalid) {
      setSaveMsg('대상 필드가 등록 종류와 맞지 않습니다. 행을 확인해 주세요.');
      return;
    }
    const ids = (selectedLeadIds || []).map(String).filter(Boolean);
    setSaving(true);
    setSaveMsg(null);
    try {
      const mappings = toApiMappings(rows);
      const res = await fetch(`${API_BASE}/lead-capture-forms/${formId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
        body: JSON.stringify({
          crmFieldMapping: { registerTarget, mappings }
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '매핑 저장 실패');
      onSaved?.(data);

      if (!ids.length) {
        setSaveMsg(
          '매핑은 저장되었습니다. CRM에 반영하려면 채널 표에서 리드를 체크한 뒤 다시 「매핑 시작」을 누르거나, 표 상단의 「매핑 등록」을 사용하세요.'
        );
        return;
      }

      const pushRes = await fetch(`${API_BASE}/lead-capture-forms/${formId}/push-to-crm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
        body: JSON.stringify({ leadIds: ids })
      });
      const pushData = await pushRes.json().catch(() => ({}));
      if (!pushRes.ok) throw new Error(pushData.error || 'CRM 등록 실패');

      const s = pushData.summary || {};
      const text =
        s.registerTarget === 'company'
          ? `고객사 신규 ${s.createdCompany ?? 0}건 · 동일 고객사 스킵 ${s.skippedDuplicateCompany ?? 0}건 · 실패 ${s.failed ?? 0}건`
          : `연락처 신규 ${s.createdContact ?? 0}건 · 동일 연락처 스킵 ${s.skippedDuplicateContact ?? 0}건 · 실패 ${s.failed ?? 0}건`;
      onPushComplete?.(pushData);
      setSaveMsg(`등록 완료 — ${text}`);
      setTimeout(() => setSaveMsg(null), 8000);
    } catch (e) {
      setSaveMsg(e.message || '실패');
    } finally {
      setSaving(false);
    }
  };

  const summary = useMemo(() => {
    const targets = new Set(rows.map((r) => r.targetKey).filter(Boolean));
    let err = 0;
    rows.forEach((row) => {
      const prev = previewMappedValue(lead, row);
      const st = rowStatus(row, prev, registerTarget);
      if (st.type === 'err') err += 1;
    });
    return { mapped: targets.size, err, totalOpt: targetOptions.length };
  }, [rows, lead, registerTarget, targetOptions.length]);

  if (!open) return null;

  return (
    <div className="lc-crm-map-overlay" role="dialog" aria-modal="true" aria-labelledby="lc-crm-map-title">
      <div className="lc-crm-map-panel" onClick={(e) => e.stopPropagation()}>
        <header className="lc-crm-map-head">
          <div className="lc-crm-map-head-left">
            <button type="button" className="lc-crm-map-btn-discard" onClick={onClose} aria-label="뒤로">
              <span className="material-symbols-outlined" style={{ fontSize: '1.25rem', verticalAlign: 'middle' }}>
                arrow_back
              </span>
            </button>
            <h2 id="lc-crm-map-title">필드 매핑 (CRM)</h2>
            <span className="lc-crm-map-draft">Draft</span>
            {(selectedLeadIds || []).length > 0 && (
              <span className="lc-crm-map-lead-count" title="매핑 시작 시 등록될 리드 수">
                등록 대상 {(selectedLeadIds || []).length}건
              </span>
            )}
          </div>
          <div className="lc-crm-map-head-actions">
            <button type="button" className="lc-crm-map-btn-discard" onClick={onClose}>
              닫기
            </button>
            <button type="button" className="lc-crm-map-btn-save" onClick={handleMappingStart} disabled={saving}>
              <span className="material-symbols-outlined" style={{ fontSize: '1.1rem' }}>play_arrow</span>
              {saving ? '처리 중…' : '매핑 시작'}
            </button>
          </div>
        </header>

        <div className="lc-crm-map-body">
          <div className="lc-crm-map-title-block">
            <h1>{formName || '리드 캡처 채널'}</h1>
            <p className="lc-crm-map-lead-hint">
              아래 <strong>등록 대상</strong>을 고른 뒤 <strong>매핑 시작</strong>을 누르면 매핑이 저장되고, 표에서 <strong>체크한 리드</strong>가
              CRM에 등록됩니다. 리드를 체크하지 않았다면 매핑만 저장됩니다. (표는 최근 5건만 미리보기)
            </p>
          </div>

          <div className="lc-crm-map-target-bar" role="tablist" aria-label="CRM 등록 대상">
            <button
              type="button"
              role="tab"
              aria-selected={registerTarget === 'contact'}
              className={`lc-crm-map-target-btn ${registerTarget === 'contact' ? 'active' : ''}`}
              onClick={() => setRegisterTargetAndReset('contact')}
            >
              <span className="material-symbols-outlined">contacts</span>
              연락처 리스트
              <span className="lc-crm-map-target-sub">customer-company-employees</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={registerTarget === 'company'}
              className={`lc-crm-map-target-btn ${registerTarget === 'company' ? 'active' : ''}`}
              onClick={() => setRegisterTargetAndReset('company')}
            >
              <span className="material-symbols-outlined">domain</span>
              고객사 리스트
              <span className="lc-crm-map-target-sub">customer-companies</span>
            </button>
          </div>
          <p className="lc-crm-map-target-desc">
            {registerTarget === 'contact'
              ? '연락처(고객명·전화·이메일 등) 필드만 매핑합니다. 등록 시 연락처 리스트에만 반영됩니다. 명함 이미지는 매핑 등록 후 자동 업로드됩니다.'
              : '고객사(상호·사업자번호·주소 등) 필드만 매핑합니다. 등록 시 고객사 리스트에만 반영됩니다.'}
          </p>

          <div className="lc-crm-map-table-head">
            <div>소스 필드 (리드)</div>
            <div />
            <div>대상 필드 ({registerTarget === 'contact' ? '연락처' : '고객사'})</div>
            <div>미리보기</div>
            <div style={{ textAlign: 'right' }}>상태</div>
          </div>

          <div className="lc-crm-map-rows">
            {rows.map((row) => {
              const preview = previewMappedValue(lead, row);
              const st = rowStatus(row, preview, registerTarget);
              const isConst = row.sourceType === 'constant';
              return (
                <div key={row.id} className={`lc-crm-map-row ${isConst ? 'is-constant' : ''}`}>
                  <div className="lc-crm-map-source-cell">
                    <div className="lc-crm-map-icon-box">
                      <span className="material-symbols-outlined" style={{ fontSize: '1.15rem' }}>
                        {isConst ? 'add_circle' : 'input'}
                      </span>
                    </div>
                    <p>고정값</p>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {isConst ? (
                        <>
                          <input
                            className="lc-crm-map-input"
                            style={{ marginTop: '0.35rem' }}
                            placeholder="값 입력…"
                            value={row.constantValue}
                            onChange={(e) => updateRow(row.id, { constantValue: e.target.value })}
                          />
                        </>
                      ) : (
                        <>
                          <select
                            className="lc-crm-map-select"
                            value={row.sourceKey}
                            onChange={(e) => updateRow(row.id, { sourceKey: e.target.value })}
                          >
                            <option value="">소스 선택…</option>
                            {sourceOptions.map((s) => (
                              <option key={s.key} value={s.key}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                          <p className="lc-crm-map-source-meta">{sourceOptions.find((x) => x.key === row.sourceKey)?.meta || ''}</p>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="lc-crm-map-connector-wrap" style={{ display: 'flex', alignItems: 'center' }}>
                    <div className="lc-crm-map-connector" />
                  </div>
                  <div>
                    <select
                      className="lc-crm-map-select"
                      value={row.targetKey}
                      onChange={(e) => updateRow(row.id, { targetKey: e.target.value })}
                    >
                      <option value="">대상 선택…</option>
                      {targetOptions.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="lc-crm-map-preview">
                    <span className="material-symbols-outlined">visibility</span>
                    <span>{preview || '—'}</span>
                  </div>
                  <div className="lc-crm-map-status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {!isConst && (
                      <span
                        className={`lc-crm-map-badge ${st.type === 'ok' ? 'ok' : st.type === 'warn' ? 'warn' : st.type === 'err' ? 'err' : 'muted'}`}
                      >
                        {st.type === 'ok' && <span className="material-symbols-outlined">check_circle</span>}
                        {st.type === 'warn' && <span className="material-symbols-outlined">priority_high</span>}
                        {st.type === 'err' && <span className="material-symbols-outlined">error</span>}
                        {st.label}
                      </span>
                    )}
                    {rows.length > 1 && row.targetKey !== BUSINESS_CARD_AUTO_TARGET && (
                      <button type="button" className="lc-crm-map-row-delete" onClick={() => removeRow(row.id)} aria-label="행 삭제">
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="lc-crm-map-footer-card">
            <div className="lc-crm-map-footer-hint">
              <div className="lc-crm-map-footer-icon">
                <span className="material-symbols-outlined">lightbulb</span>
              </div>
              <div>
                <p>등록 대상 전환</p>
                <span>
                  연락처/고객사 각각 저장된 매핑을 불러오며, 명함 행·CRM 추가 필드는 자동으로 행이 보강됩니다. 채널(폼)마다 설정은 따로 저장됩니다.
                </span>
              </div>
            </div>
            <button type="button" className="lc-crm-map-btn-add-const" onClick={addConstantRow}>
              <span className="material-symbols-outlined" style={{ fontSize: '1.15rem' }}>add</span>
              고정값 추가
            </button>
          </div>

          <div className="lc-crm-map-summary">
            <div className="lc-crm-map-summary-card">
              <p>매핑된 대상</p>
              <p className="num">
                {summary.mapped} / {rows.length}
              </p>
              <div className="lc-crm-map-bar">
                <div style={{ width: `${rows.length ? Math.min(100, (summary.mapped / rows.length) * 100) : 0}%` }} />
              </div>
            </div>
            <div className="lc-crm-map-summary-card">
              <p>주의</p>
              <p className="num rose">{summary.err || rows.filter((r) => rowStatus(r, previewMappedValue(lead, r), registerTarget).type === 'warn').length}</p>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.65rem', color: '#64748b' }}>미리보기 = 최근 리드 1건</p>
            </div>
            <div className="lc-crm-map-summary-card">
              <p>등록</p>
              <p className="num" style={{ fontSize: '1rem' }}>
                {registerTarget === 'contact' ? '연락처만' : '고객사만'}
              </p>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.65rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399' }} />
                매핑 시작 (또는 표에서 매핑 등록)
              </p>
            </div>
          </div>

          {saveMsg && (
            <p className={`lc-crm-map-save-msg ${saveMsg.includes('실패') || saveMsg.includes('맞지') ? 'err' : ''}`}>{saveMsg}</p>
          )}
        </div>
      </div>
    </div>
  );
}
