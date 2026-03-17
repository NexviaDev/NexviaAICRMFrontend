import { useState, useEffect } from 'react';
import { API_BASE } from '@/config';
import './pipeline-stages-manage-modal.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const ENTITY_TYPE = 'salesPipelineStage';

/**
 * 세일즈 파이프라인 단계(컬럼) 관리 모달.
 * custom-field-definitions API (entityType: salesPipelineStage)로 추가/삭제.
 * key = 단계 코드(영문), label = 표시 이름.
 */
export default function PipelineStagesManageModal({ onClose, onSaved }) {
  const [definitions, setDefinitions] = useState([]);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [loading, setLoading] = useState(true);

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
    fetchDefinitions();
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleAdd = async (e) => {
    e.preventDefault();
    const key = String(newKey || '').trim();
    const label = String(newLabel || '').trim();
    if (!key || !label) return;
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
      alert('단계 코드는 영문으로 시작하고, 영문·숫자·언더스코어만 사용 가능합니다.');
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
      setNewKey('');
      setNewLabel('');
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
    if (!window.confirm('이 단계를 삭제하시겠습니까? 해당 단계에 있는 기회는 "신규 리드"로 보이지 않을 수 있습니다.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions/${id}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      if (res.ok) {
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
          <p className="psm-hint">단계를 추가·삭제할 수 있습니다. 수정하지 않으면 기본 3단계(신규 리드, 접촉 완료, 제안서 발송)만 표시됩니다.</p>
          <form onSubmit={handleAdd} className="psm-form">
            <div className="psm-row">
              <div className="psm-field">
                <label>단계 코드 (영문)</label>
                <input
                  type="text"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="예: NewLead, Negotiation"
                  required
                />
              </div>
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
              <h4>등록된 단계 (순서대로 컬럼에 표시)</h4>
              <ul className="psm-list">
                {definitions.length === 0 ? (
                  <li className="psm-list-empty">등록된 단계가 없습니다. 위에서 추가하면 기본 4단계 대신 사용됩니다.</li>
                ) : (
                  definitions.map((def) => (
                    <li key={def._id} className="psm-list-item">
                      <span className="psm-list-key">{def.key}</span>
                      <span className="psm-list-label">{def.label}</span>
                      <button
                        type="button"
                        className="psm-list-delete"
                        onClick={() => handleDelete(def._id)}
                        disabled={!!deletingId}
                        aria-label="삭제"
                      >
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
