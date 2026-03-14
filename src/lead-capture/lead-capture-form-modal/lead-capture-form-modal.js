import { useState, useEffect } from 'react';
import { API_BASE } from '@/config';
import './lead-capture-form-modal.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const STATUS_OPTIONS = [
  { value: 'active', label: '활성' },
  { value: 'inactive', label: '비활성' }
];

export default function LeadCaptureFormModal({ form, onClose, onSaved }) {
  const isEdit = Boolean(form?._id);
  const [name, setName] = useState(form?.name ?? '');
  const [source, setSource] = useState(form?.source ?? '');
  const [status, setStatus] = useState(form?.status ?? 'active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (form) {
      setName(form.name ?? '');
      setSource(form.source ?? '');
      setStatus(form.status ?? 'active');
    } else {
      setName('');
      setSource('');
      setStatus('active');
    }
  }, [form]);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('폼 이름을 입력해 주세요.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const headers = { ...getAuthHeader(), 'Content-Type': 'application/json' };
      if (isEdit) {
        const res = await fetch(`${API_BASE}/lead-capture-forms/${form._id}`, {
          method: 'PATCH',
          headers,
          credentials: 'include',
          body: JSON.stringify({ name: trimmedName, source: source.trim(), status })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '수정에 실패했습니다.');
        onSaved(data);
      } else {
        const res = await fetch(`${API_BASE}/lead-capture-forms`, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ name: trimmedName, source: source.trim(), status })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '생성에 실패했습니다.');
        onSaved(data);
      }
      onClose();
    } catch (err) {
      setError(err.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="lead-capture-form-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="lead-capture-form-modal-title">
      <div className="lead-capture-form-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="lead-capture-form-modal-header">
          <h2 id="lead-capture-form-modal-title" className="lead-capture-form-modal-title">
            {isEdit ? '캡처 폼 수정' : '새 캡처 폼 만들기'}
          </h2>
          <button type="button" className="lead-capture-form-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form className="lead-capture-form-modal-body" onSubmit={handleSubmit}>
          <div className="lead-capture-form-modal-field">
            <label className="lead-capture-form-modal-label" htmlFor="lc-form-name">폼 이름</label>
            <input
              id="lc-form-name"
              type="text"
              className="lead-capture-form-modal-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 웹사이트 홈 - 문의하기"
              autoFocus
            />
          </div>
          <div className="lead-capture-form-modal-field">
            <label className="lead-capture-form-modal-label" htmlFor="lc-form-source">소스</label>
            <input
              id="lc-form-source"
              type="text"
              className="lead-capture-form-modal-input"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="예: Organic Search, LinkedIn, Direct Traffic"
            />
          </div>
          <div className="lead-capture-form-modal-field">
            <label className="lead-capture-form-modal-label" htmlFor="lc-form-status">상태</label>
            <select
              id="lc-form-status"
              className="lead-capture-form-modal-select"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {error && <p className="lead-capture-form-modal-error">{error}</p>}
          <div className="lead-capture-form-modal-actions">
            <button type="button" className="lead-capture-form-modal-btn lead-capture-form-modal-btn-cancel" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="lead-capture-form-modal-btn lead-capture-form-modal-btn-save" disabled={saving}>
              {saving ? '저장 중…' : (isEdit ? '수정' : '만들기')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
