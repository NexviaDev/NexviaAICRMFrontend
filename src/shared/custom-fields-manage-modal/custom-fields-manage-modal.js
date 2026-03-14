import { useState, useEffect } from 'react';
import { API_BASE } from '@/config';
import './custom-fields-manage-modal.css';

const FIELD_TYPES = [
  { value: 'text', label: '글자' },
  { value: 'number', label: '숫자' },
  { value: 'date', label: '날짜' },
  { value: 'checkbox', label: '체크박스' }
];

/**
 * 추가 필드 관리 전용 모달.
 * 필드 추가 시 onFieldAdded() 후 onClose() 호출 → 부모 모달로 복귀, 하단에 추가된 필드 표시.
 */
export default function CustomFieldsManageModal({
  entityType,
  leadCaptureFormId = null,
  onClose,
  onFieldAdded,
  apiBase = API_BASE,
  getAuthHeader = () => ({})
}) {
  const [definitions, setDefinitions] = useState([]);
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState('text');
  const [newRequired, setNewRequired] = useState(false);
  const [useSelectList, setUseSelectList] = useState(false);
  const [useMultiSelect, setUseMultiSelect] = useState(false);
  const [selectListInput, setSelectListInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const listUrl = entityType === 'leadCapture' && leadCaptureFormId
    ? `${apiBase}/custom-field-definitions?entityType=leadCapture&leadCaptureFormId=${encodeURIComponent(leadCaptureFormId)}`
    : `${apiBase}/custom-field-definitions?entityType=${entityType}`;

  const fetchDefinitions = async () => {
    try {
      const res = await fetch(listUrl, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) setDefinitions(data.items);
    } catch (_) {}
  };

  useEffect(() => {
    fetchDefinitions();
  }, [entityType, leadCaptureFormId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleAddField = async (e) => {
    e.preventDefault();
    const label = (newLabel || '').trim();
    if (!label) return;
    setAdding(true);
    try {
      const key = 'field_' + Date.now();
      const type = useSelectList ? (useMultiSelect ? 'multiselect' : 'select') : newType;
      const options = useSelectList && selectListInput.trim()
        ? { choices: selectListInput.split(',').map((s) => s.trim()).filter(Boolean) }
        : null;
      const body = {
        entityType,
        key,
        label,
        type,
        required: newRequired,
        order: definitions.length,
        ...(options ? { options } : {})
      };
      if (entityType === 'leadCapture' && leadCaptureFormId) body.leadCaptureFormId = leadCaptureFormId;
      const res = await fetch(`${apiBase}/custom-field-definitions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || '필드 추가에 실패했습니다.');
        return;
      }
      setNewLabel('');
      setNewType('text');
      setNewRequired(false);
      setUseSelectList(false);
      setUseMultiSelect(false);
      setSelectListInput('');
      onFieldAdded?.();
      onClose();
    } catch (_) {
      alert('서버에 연결할 수 없습니다.');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id) => {
    if (!id) return;
    setDeletingId(id);
    try {
      const res = await fetch(`${apiBase}/custom-field-definitions/${id}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      if (res.ok) fetchDefinitions();
      else {
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
      <div className="custom-fields-manage-overlay" aria-hidden="true" />
      <div className="custom-fields-manage-modal">
        <div className="custom-fields-manage-inner">
          <header className="custom-fields-manage-header">
            <h3>추가 필드 관리</h3>
            <button type="button" className="custom-fields-manage-close" onClick={onClose} aria-label="닫기">
              <span className="material-symbols-outlined">close</span>
            </button>
          </header>
          <div className="custom-fields-manage-body">
            <form onSubmit={handleAddField} className="custom-fields-manage-form">
              <div className="custom-fields-manage-field">
                <label>표시 이름</label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="예: 로트번호"
                  required
                />
              </div>
              <div className="custom-fields-manage-field">
                <label>타입</label>
                <select value={newType} onChange={(e) => setNewType(e.target.value)} disabled={useSelectList}>
                  {FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
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
              <div className="custom-fields-manage-field">
                <label className="custom-fields-manage-checkbox-label">
                  <input type="checkbox" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} />
                  <span>필수</span>
                </label>
              </div>
              <button type="submit" className="custom-fields-manage-add-btn" disabled={adding}>
                {adding ? '추가 중…' : '필드 추가'}
              </button>
            </form>
            {definitions.length > 0 && (
              <div className="custom-fields-manage-list">
                <h4>추가된 필드</h4>
                <ul>
                  {definitions.map((def) => (
                    <li key={def._id} className="custom-fields-manage-list-item">
                      <span className="custom-fields-manage-list-label">{def.label}</span>
                      <span className="custom-fields-manage-list-type">{def.type}</span>
                      <button
                        type="button"
                        className="custom-fields-manage-list-delete"
                        onClick={() => handleDelete(def._id)}
                        disabled={!!deletingId}
                        aria-label="삭제"
                      >
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
