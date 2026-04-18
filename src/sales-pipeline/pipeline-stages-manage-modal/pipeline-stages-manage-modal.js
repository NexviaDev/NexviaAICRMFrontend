import { useState, useEffect, useMemo, useCallback } from 'react';
import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';
import './pipeline-stages-manage-modal.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const ENTITY_TYPE = 'salesPipelineStage';
const SYSTEM_FIXED_STAGE_KEY = 'Won';

/** DB에 단계가 없을 때 한 번에 올릴 기본 진행 단계 + Won (Forecast %) */
const DEFAULT_STAGE_SEED = [
  { key: 'NewLead', label: '신규 리드', forecastPercent: 20 },
  { key: 'Contacted', label: '연락 완료', forecastPercent: 30 },
  { key: 'ProposalSent', label: '제안서 전달 완료', forecastPercent: 50 },
  { key: 'TechDemo', label: '기술 시연', forecastPercent: 60 },
  { key: 'Quotation', label: '견적', forecastPercent: 70 },
  { key: 'Negotiation', label: '최종 협상', forecastPercent: 90 },
  { key: 'Won', label: '수주 성공', forecastPercent: 100 }
];

function parseForecastPercent(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  const n = parseFloat(s.replace(/%/g, '').replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}

function forecastInputFromDef(def) {
  const opt = def?.options && typeof def.options === 'object' ? def.options : {};
  if (opt.forecastPercent != null && String(opt.forecastPercent).trim() !== '') {
    const n = Number(opt.forecastPercent);
    if (Number.isFinite(n)) return String(n);
  }
  return '';
}

function notifyStagesUpdated() {
  try {
    window.dispatchEvent(new CustomEvent('nexvia-pipeline-stages-updated'));
  } catch {
    /* ignore */
  }
}

/**
 * 세일즈 파이프라인 단계(컬럼) 관리 모달.
 * custom-field-definitions API (entityType: salesPipelineStage)로 추가/삭제.
 * key = 단계 코드(영문), label = 표시 이름.
 */
export default function PipelineStagesManageModal({ onClose, onSaved }) {
  const [definitions, setDefinitions] = useState([]);
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [orderedIds, setOrderedIds] = useState([]);
  const [savingOrder, setSavingOrder] = useState(false);
  const [forecastDraftById, setForecastDraftById] = useState({});
  const [forecastSavingId, setForecastSavingId] = useState(null);
  const [seeding, setSeeding] = useState(false);

  const wonDefinition = useMemo(
    () => definitions.find((def) => String(def?.key || '').trim() === SYSTEM_FIXED_STAGE_KEY),
    [definitions]
  );

  const visibleDefinitions = definitions.filter((def) => String(def?.key || '').trim() !== SYSTEM_FIXED_STAGE_KEY);

  /** 서버 definitions가 바뀔 때만 로컬 순서 초기화(저장 후·추가·삭제) */
  useEffect(() => {
    const sorted = definitions
      .filter((def) => String(def?.key || '').trim() !== SYSTEM_FIXED_STAGE_KEY)
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    setOrderedIds(sorted.map((d) => String(d._id)));
  }, [definitions]);

  const orderedVisible = useMemo(() => {
    const byId = new Map(visibleDefinitions.map((d) => [String(d._id), d]));
    const out = [];
    for (const id of orderedIds) {
      const def = byId.get(id);
      if (def) out.push(def);
    }
    for (const def of visibleDefinitions) {
      if (!orderedIds.includes(String(def._id))) out.push(def);
    }
    return out;
  }, [orderedIds, visibleDefinitions]);

  const moveUp = useCallback((id) => {
    const sid = String(id);
    setOrderedIds((prev) => {
      const i = prev.indexOf(sid);
      if (i <= 0) return prev;
      const next = [...prev];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });
  }, []);

  const moveDown = useCallback((id) => {
    const sid = String(id);
    setOrderedIds((prev) => {
      const i = prev.indexOf(sid);
      if (i < 0 || i >= prev.length - 1) return prev;
      const next = [...prev];
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
      return next;
    });
  }, []);

  const handleSaveOrder = async () => {
    if (orderedIds.length === 0) return;
    setSavingOrder(true);
    try {
      await pingBackendHealth(getAuthHeader);
      let idx = 0;
      for (const id of orderedIds) {
        if (idx > 0 && idx % 12 === 0) await pingBackendHealth(getAuthHeader);
        const res = await fetch(`${API_BASE}/custom-field-definitions/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify({ order: idx })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.error || `순서 저장 실패 (${idx + 1}번째)`);
          return;
        }
        idx += 1;
      }
      if (wonDefinition?._id) {
        const wRes = await fetch(`${API_BASE}/custom-field-definitions/${wonDefinition._id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify({ order: orderedIds.length })
        });
        const wData = await wRes.json().catch(() => ({}));
        if (!wRes.ok) {
          alert(wData.error || 'Won 단계 순서 저장에 실패했습니다.');
          return;
        }
      }
      notifyStagesUpdated();
      onSaved?.();
      await fetchDefinitions();
    } catch (_) {
      alert('순서 저장 중 오류가 났습니다.');
    } finally {
      setSavingOrder(false);
    }
  };

  const fetchDefinitions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=${ENTITY_TYPE}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) setDefinitions(data.items);
      else setDefinitions([]);
    } catch (_) {
      setDefinitions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const next = {};
    for (const d of definitions) {
      if (d?._id) next[String(d._id)] = forecastInputFromDef(d);
    }
    setForecastDraftById(next);
  }, [definitions]);

  const saveForecastForDef = async (def) => {
    if (!def?._id) return;
    const id = String(def._id);
    const raw = forecastDraftById[id];
    const parsed = parseForecastPercent(raw);
    const prevOpt = def.options && typeof def.options === 'object' ? { ...def.options } : {};
    if (parsed == null && (raw == null || String(raw).trim() === '')) {
      delete prevOpt.forecastPercent;
    } else if (parsed != null) {
      prevOpt.forecastPercent = parsed;
    } else {
      window.alert('Forecast는 0~100 사이 숫자로 입력해 주세요.');
      return;
    }
    setForecastSavingId(id);
    try {
      await pingBackendHealth(getAuthHeader);
      const res = await fetch(`${API_BASE}/custom-field-definitions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ options: Object.keys(prevOpt).length ? prevOpt : null })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(data.error || 'Forecast 저장에 실패했습니다.');
        return;
      }
      notifyStagesUpdated();
      onSaved?.();
      await fetchDefinitions();
    } catch {
      window.alert('서버에 연결할 수 없습니다.');
    } finally {
      setForecastSavingId(null);
    }
  };

  const handleSeedDefaults = async () => {
    if (
      !window.confirm(
        '기본 6단계(진행) + 수주(Won) 단계를 등록하고 Forecast 비율을 채웁니다. 이미 같은 키가 있으면 라벨·Forecast만 갱신합니다. 계속할까요?'
      )
    ) {
      return;
    }
    setSeeding(true);
    try {
      await pingBackendHealth(getAuthHeader);
      let i = 0;
      for (const row of DEFAULT_STAGE_SEED) {
        if (i > 0 && i % 10 === 0) await pingBackendHealth(getAuthHeader);
        const existing = definitions.find((d) => String(d?.key || '').trim() === row.key);
        const options = { forecastPercent: row.forecastPercent };
        if (existing?._id) {
          const prevOpt = existing.options && typeof existing.options === 'object' ? { ...existing.options } : {};
          const res = await fetch(`${API_BASE}/custom-field-definitions/${existing._id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({
              label: row.label,
              options: { ...prevOpt, ...options }
            })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            window.alert(data.error || `단계 ${row.key} 갱신 실패`);
            return;
          }
        } else {
          const res = await fetch(`${API_BASE}/custom-field-definitions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({
              entityType: ENTITY_TYPE,
              key: row.key,
              label: row.label,
              type: 'text',
              required: false,
              order: i,
              options
            })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            window.alert(data.error || `단계 ${row.key} 추가 실패`);
            return;
          }
        }
        i += 1;
      }
      notifyStagesUpdated();
      onSaved?.();
      await fetchDefinitions();
    } catch {
      window.alert('기본 단계 등록 중 오류가 났습니다.');
    } finally {
      setSeeding(false);
    }
  };

  useEffect(() => {
    fetchDefinitions();
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleAdd = async (e) => {
    e.preventDefault();
    const label = String(newLabel || '').trim();
    if (!label) return;
    const key = `stage_${Date.now()}`;
    if (key === SYSTEM_FIXED_STAGE_KEY) {
      alert('Won 단계는 시스템 고정 단계로 추가할 수 없습니다.');
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          entityType: ENTITY_TYPE,
          key,
          label,
          type: 'text',
          required: false,
          order: definitions.length
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || '단계 추가에 실패했습니다.');
        return;
      }
      setNewLabel('');
      notifyStagesUpdated();
      onSaved?.();
      fetchDefinitions();
    } catch (_) {
      alert('서버에 연결할 수 없습니다.');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id) => {
    if (!id) return;
    const target = definitions.find((def) => String(def?._id || '') === String(id));
    if (String(target?.key || '').trim() === SYSTEM_FIXED_STAGE_KEY) {
      alert('Won 단계는 시스템 고정 단계로 삭제할 수 없습니다.');
      return;
    }
    if (!window.confirm('이 단계를 삭제하시겠습니까? 해당 단계에 있는 기회는 "신규 리드"로 보이지 않을 수 있습니다.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions/${id}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      if (res.ok) {
        notifyStagesUpdated();
        onSaved?.();
        fetchDefinitions();
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

  return (
    <>
      <div className="psm-overlay" onClick={onClose} aria-hidden="true" />
      <div className="psm-modal" onClick={(e) => e.stopPropagation()}>
        <header className="psm-header">
          <h3>파이프라인 단계 관리</h3>
          <button type="button" className="psm-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <div className="psm-body">
          <p className="psm-hint">
            단계를 추가·삭제할 수 있고, 각 단계마다 <strong>Forecast (%)</strong>를 입력할 수 있습니다(입력 후 칸 밖을 누르면 저장).
            <strong>↑ ↓</strong>으로 순서를 바꾼 뒤 <strong>순서 저장</strong>을 누르면 세일즈 현황 칸반에 반영됩니다. DB에 단계가 없으면 화면{' '}
            <strong>하단</strong>의 「기본 6단계 + Forecast 불러오기」로 기본 6단계(진행) + 수주 열을 한 번에 올릴 수 있습니다.
          </p>
          <form onSubmit={handleAdd} className="psm-form">
            <div className="psm-row">
              <div className="psm-field">
                <label>표시 이름</label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="예: 신규 리드"
                  required
                />
              </div>
              <button type="submit" className="psm-add-btn" disabled={adding}>
                {adding ? '추가 중…' : '추가'}
              </button>
            </div>
          </form>
          {loading ? (
            <p className="psm-loading">불러오는 중...</p>
          ) : (
            <div className="psm-list-wrap">
              <div className="psm-list-head">
                <h4>등록된 단계 (위에서 아래 = 칸반 왼쪽→오른쪽)</h4>
                {orderedVisible.length > 0 ? (
                  <button
                    type="button"
                    className="psm-save-order-btn"
                    onClick={handleSaveOrder}
                    disabled={savingOrder || loading || seeding}
                  >
                    {savingOrder ? '저장 중…' : '순서 저장'}
                  </button>
                ) : null}
              </div>
              <ul className="psm-list">
                {orderedVisible.length === 0 ? (
                  <li className="psm-list-empty">등록된 단계가 없습니다. 위에서 추가하면 기본 5단계 대신 사용됩니다.</li>
                ) : (
                  orderedVisible.map((def, idx) => (
                    <li key={def._id} className="psm-list-item">
                      <div className="psm-list-order-btns">
                        <button
                          type="button"
                          className="psm-order-btn"
                          onClick={() => moveUp(def._id)}
                          disabled={savingOrder || seeding || idx === 0}
                          title="위로"
                          aria-label="위로"
                        >
                          <span className="material-symbols-outlined">arrow_upward</span>
                        </button>
                        <button
                          type="button"
                          className="psm-order-btn"
                          onClick={() => moveDown(def._id)}
                          disabled={savingOrder || seeding || idx === orderedVisible.length - 1}
                          title="아래로"
                          aria-label="아래로"
                        >
                          <span className="material-symbols-outlined">arrow_downward</span>
                        </button>
                      </div>
                      <span className="psm-list-key">{def.key}</span>
                      <span className="psm-list-label">{def.label}</span>
                      <div className="psm-forecast-field">
                        <label htmlFor={`psm-fc-${def._id}`}>Forecast %</label>
                        <input
                          id={`psm-fc-${def._id}`}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0~100"
                          value={forecastDraftById[String(def._id)] ?? ''}
                          onChange={(e) =>
                            setForecastDraftById((prev) => ({
                              ...prev,
                              [String(def._id)]: e.target.value
                            }))
                          }
                          onBlur={() => saveForecastForDef(def)}
                          disabled={!!forecastSavingId || savingOrder || seeding}
                          aria-label={`${def.label} Forecast`}
                        />
                      </div>
                      <button
                        type="button"
                        className="psm-list-delete"
                        onClick={() => handleDelete(def._id)}
                        disabled={!!deletingId || savingOrder || seeding}
                        aria-label="삭제"
                      >
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
              {wonDefinition ? (
                <div className="psm-won-note">
                  <span className="material-symbols-outlined" aria-hidden>lock</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0 }}>
                      <strong>{SYSTEM_FIXED_STAGE_KEY}</strong> ({wonDefinition.label}) 은 수주 완료 열로 고정이며, 순서 저장 시 항상 맨 뒤로 맞춥니다.
                    </p>
                    <div className="psm-won-forecast">
                      <label htmlFor="psm-fc-won">Forecast %</label>
                      <input
                        id="psm-fc-won"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="예: 100"
                        value={forecastDraftById[String(wonDefinition._id)] ?? ''}
                        onChange={(e) =>
                          setForecastDraftById((prev) => ({
                            ...prev,
                            [String(wonDefinition._id)]: e.target.value
                          }))
                        }
                        onBlur={() => saveForecastForDef(wonDefinition)}
                        disabled={!!forecastSavingId || savingOrder || seeding}
                        aria-label="Won Forecast"
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}
          <button
            type="button"
            className="psm-seed-btn psm-seed-btn--footer"
            onClick={handleSeedDefaults}
            disabled={loading || seeding || adding || savingOrder}
          >
            {seeding ? '등록 중…' : '기본 6단계 + Forecast 불러오기'}
          </button>
        </div>
      </div>
    </>
  );
}
