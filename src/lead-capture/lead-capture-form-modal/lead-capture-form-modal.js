import { useState, useEffect, useMemo, useCallback } from 'react';
import { API_BASE } from '@/config';
import { resolveDepartmentDisplayFromChart } from '@/lib/org-chart-tree-utils';
import ParticipantModal from '@/shared/participant-modal/participant-modal';
import './lead-capture-form-modal.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const STATUS_OPTIONS = [
  { value: 'active', label: '활성' },
  { value: 'inactive', label: '비활성' }
];

function readCrmUserId() {
  try {
    const u = JSON.parse(localStorage.getItem('crm_user') || '{}');
    return String(u._id || u.id || '').trim() || null;
  } catch {
    return null;
  }
}

function normalizeFormAssigneeIds(form) {
  const raw = form?.assigneeUserIds;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw
    .map((x) => {
      if (x == null) return '';
      if (typeof x === 'object' && x._id != null) return String(x._id);
      return String(x);
    })
    .filter(Boolean);
}

export default function LeadCaptureFormModal({ form, onClose, onSaved }) {
  const isEdit = Boolean(form?._id);
  const [name, setName] = useState(form?.name ?? '');
  const [source, setSource] = useState(form?.source ?? '');
  const [status, setStatus] = useState(form?.status ?? 'active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [employees, setEmployees] = useState([]);
  const [organizationChart, setOrganizationChart] = useState(null);
  const [assigneeUserIds, setAssigneeUserIds] = useState([]);
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [overviewError, setOverviewError] = useState('');

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/companies/overview`, {
        headers: getAuthHeader(),
        credentials: 'include'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '직원 목록을 불러올 수 없습니다.');
      setEmployees(Array.isArray(json.employees) ? json.employees : []);
      setOrganizationChart(json.company?.organizationChart ?? null);
      setOverviewError('');
    } catch (e) {
      setOverviewError(e.message || '직원 목록 조회 실패');
      setEmployees([]);
      setOrganizationChart(null);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  useEffect(() => {
    const myId = readCrmUserId();
    if (form?._id) {
      const fromForm = normalizeFormAssigneeIds(form);
      setAssigneeUserIds(fromForm.length > 0 ? fromForm : myId ? [myId] : []);
      setName(form.name ?? '');
      setSource(form.source ?? '');
      setStatus(form.status ?? 'active');
    } else {
      setName('');
      setSource('');
      setStatus('active');
      setAssigneeUserIds(myId ? [myId] : []);
    }
  }, [form]);

  const assigneeLabelById = useMemo(() => {
    const m = new Map();
    employees.forEach((e) => {
      m.set(String(e.id), e.name || e.email || String(e.id));
    });
    return m;
  }, [employees]);

  /** ParticipantModal용: overview 직원(id) → 팀원 API와 동일 필드 */
  const teamMembersForPicker = useMemo(() => {
    return employees.map((e) => {
      const dept = String(e.companyDepartment || e.department || '').trim();
      const display = resolveDepartmentDisplayFromChart(organizationChart, dept);
      return {
        _id: e.id,
        name: e.name,
        email: e.email,
        phone: e.phone || '',
        companyDepartment: dept,
        department: dept,
        departmentDisplay: display || undefined
      };
    });
  }, [employees, organizationChart]);

  const assigneePickerSelected = useMemo(
    () =>
      assigneeUserIds.map((id) => ({
        userId: id,
        name: assigneeLabelById.get(String(id)) || `사용자 ${String(id).slice(-6)}`
      })),
    [assigneeUserIds, assigneeLabelById]
  );

  const currentUserForPicker = useMemo(() => {
    const id = readCrmUserId();
    return id ? { _id: id } : null;
  }, []);

  const removeAssignee = useCallback((id) => {
    setAssigneeUserIds((prev) => prev.filter((x) => String(x) !== String(id)));
  }, []);

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
      const payload = {
        name: trimmedName,
        source: source.trim(),
        status,
        assigneeUserIds
      };
      if (isEdit) {
        const res = await fetch(`${API_BASE}/lead-capture-forms/${form._id}`, {
          method: 'PATCH',
          headers,
          credentials: 'include',
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '수정에 실패했습니다.');
        onSaved(data);
      } else {
        const res = await fetch(`${API_BASE}/lead-capture-forms`, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify(payload)
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
            <span className="lead-capture-form-modal-label">담당자</span>
            <p className="lead-capture-form-modal-assignee-hint">
              사내 현황과 동일한 직원 목록입니다. 지정하지 않으면 저장 시 본인이 기본 담당자로 들어갑니다.
            </p>
            {overviewError ? (
              <p className="lead-capture-form-modal-assignee-warn">{overviewError}</p>
            ) : null}
            <div className="lead-capture-form-modal-assignee-chips">
              {assigneeUserIds.length === 0 ? (
                <span className="lead-capture-form-modal-assignee-empty">담당자 없음 (저장 시 본인)</span>
              ) : (
                assigneeUserIds.map((id) => (
                  <span key={String(id)} className="lead-capture-form-modal-assignee-chip">
                    <span className="lead-capture-form-modal-assignee-chip-label">
                      {assigneeLabelById.get(String(id)) || `사용자 ${String(id).slice(-6)}`}
                    </span>
                    <button
                      type="button"
                      className="lead-capture-form-modal-assignee-chip-remove"
                      onClick={() => removeAssignee(id)}
                      aria-label="담당자 제거"
                    >
                      <span className="material-symbols-outlined" aria-hidden>close</span>
                    </button>
                  </span>
                ))
              )}
            </div>
            <button
              type="button"
              className="lead-capture-form-modal-btn-assignee-add"
              onClick={() => setShowAssigneePicker(true)}
              disabled={employees.length === 0}
            >
              <span className="material-symbols-outlined" aria-hidden>group_add</span>
              담당자 추가
            </button>
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
      {showAssigneePicker ? (
        <ParticipantModal
          title="담당자 선택"
          bulkAddLabel="표시된 인원 모두 담당자에 추가"
          teamMembers={teamMembersForPicker}
          selected={assigneePickerSelected}
          currentUser={currentUserForPicker}
          onClose={() => setShowAssigneePicker(false)}
          onConfirm={(picked) => setAssigneeUserIds(picked.map((p) => String(p.userId)))}
        />
      ) : null}
    </div>
  );
}
