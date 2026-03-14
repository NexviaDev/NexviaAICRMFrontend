import { useState, useEffect, useCallback } from 'react';
import ParticipantModal from '../../calendar/participant-modal/participant-modal';
import './add-meeting-modal.css';

import { API_BASE } from '@/config';
const STATUS_OPTIONS = [{ value: 'Draft', label: '초안' }, { value: 'Finalized', label: '완료' }];

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function toDatetimeLocal(d) {
  if (!d) return '';
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

function getInitials(name) {
  if (!name || !name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

export default function AddMeetingModal({ meeting, onClose, onSaved }) {
  const isEdit = !!meeting?._id;
  const [form, setForm] = useState({
    title: '',
    meetingDate: toDatetimeLocal(meeting?.meetingDate || new Date()),
    location: '',
    agenda: '',
    discussionPoints: '',
    status: meeting?.status || 'Draft',
    actionItems: [],
    attendees: []
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAttendeeModal, setShowAttendeeModal] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);

  useEffect(() => {
    if (!meeting) return;
    setForm({
      title: meeting.title ?? '',
      meetingDate: toDatetimeLocal(meeting.meetingDate),
      location: meeting.location ?? '',
      agenda: meeting.agenda ?? '',
      discussionPoints: meeting.discussionPoints ?? '',
      status: meeting.status ?? 'Draft',
      actionItems: Array.isArray(meeting.actionItems) ? meeting.actionItems.map((a) => ({
        description: a.description ?? '',
        dueDate: a.dueDate ? toDatetimeLocal(a.dueDate).slice(0, 10) : '',
        completed: !!a.completed
      })) : [],
      attendees: Array.isArray(meeting.attendees) ? meeting.attendees.map((a) => ({ name: a.name ?? '', role: a.role ?? '' })) : []
    });
  }, [meeting]);

  useEffect(() => {
    if (!isEdit) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isEdit, onClose]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const addActionItem = () => {
    setForm((prev) => ({ ...prev, actionItems: [...(prev.actionItems || []), { description: '', dueDate: '', completed: false }] }));
  };
  const updateActionItem = (index, field, value) => {
    setForm((prev) => {
      const next = [...(prev.actionItems || [])];
      if (!next[index]) return prev;
      next[index] = { ...next[index], [field]: value };
      return { ...prev, actionItems: next };
    });
  };
  const removeActionItem = (index) => {
    setForm((prev) => ({ ...prev, actionItems: (prev.actionItems || []).filter((_, i) => i !== index) }));
  };

  const addAttendee = () => {
    setForm((prev) => ({ ...prev, attendees: [...(prev.attendees || []), { name: '', role: '' }] }));
  };
  const updateAttendee = (index, field, value) => {
    setForm((prev) => {
      const next = [...(prev.attendees || [])];
      if (!next[index]) return prev;
      next[index] = { ...next[index], [field]: value };
      return { ...prev, attendees: next };
    });
  };
  const removeAttendee = (index) => {
    setForm((prev) => ({ ...prev, attendees: (prev.attendees || []).filter((_, i) => i !== index) }));
  };

  const fetchTeamMembers = useCallback(() => {
    fetch(`${API_BASE}/calendar-events/team-members`, { headers: getAuthHeader() })
      .then((r) => r.json())
      .then((data) => { if (data.members) setTeamMembers(data.members); })
      .catch(() => {});
  }, []);

  const openAttendeeModal = () => {
    if (teamMembers.length === 0) fetchTeamMembers();
    setShowAttendeeModal(true);
  };

  const handleAttendeeConfirm = (selected) => {
    setForm((prev) => ({
      ...prev,
      attendees: selected.map((s) => {
        const m = teamMembers.find((t) => String(t._id) === String(s.userId));
        return { name: s.name || (m && m.name) || '', role: (m && m.role) ? String(m.role) : '' };
      })
    }));
    setShowAttendeeModal(false);
  };

  const currentUser = (() => {
    try {
      const raw = localStorage.getItem('crm_user');
      const u = raw ? JSON.parse(raw) : null;
      if (!u) return null;
      return { _id: u.id || u._id, name: u.name, email: u.email };
    } catch { return null; }
  })();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.title?.trim()) {
      setError('회의 제목을 입력해 주세요.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        meetingDate: form.meetingDate ? new Date(form.meetingDate).toISOString() : new Date().toISOString(),
        location: form.location.trim(),
        agenda: form.agenda,
        discussionPoints: form.discussionPoints,
        status: form.status,
        actionItems: (form.actionItems || []).map((a) => ({
          description: a.description,
          dueDate: a.dueDate ? new Date(a.dueDate).toISOString() : undefined,
          completed: !!a.completed
        })),
        attendees: (form.attendees || []).map((a) => ({ name: a.name, role: a.role }))
      };

      const url = isEdit ? `${API_BASE}/meeting-minutes/${meeting._id}` : `${API_BASE}/meeting-minutes`;
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '저장에 실패했습니다.');
        return;
      }
      onSaved?.();
      onClose?.();
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setSaving(false);
    }
  };

  const headerBlock = isEdit ? (
    <header className="add-meeting-edit-header">
      <div className="add-meeting-edit-header-title">
        <h2>회의 일지 수정</h2>
      </div>
      <div className="add-meeting-edit-header-actions">
        <button
          type="button"
          className="add-meeting-edit-icon-btn"
          onClick={onClose}
          aria-label="수정 취소"
        >
          <span className="material-symbols-outlined">undo</span>
        </button>
      </div>
    </header>
  ) : (
    <header className="add-meeting-modal-topbar">
      <div className="add-meeting-modal-topbar-left">
        <span className="material-symbols-outlined add-meeting-modal-topbar-icon">description</span>
        <h2 className="add-meeting-modal-topbar-title">회의 일지 작성</h2>
      </div>
      <div className="add-meeting-modal-topbar-actions">
        <button type="button" className="add-meeting-modal-btn-cancel" onClick={onClose}>
          취소
        </button>
        <button type="submit" form="add-meeting-form" className="add-meeting-modal-btn-save" disabled={saving}>
          <span className="material-symbols-outlined">save</span>
          {saving ? '저장 중...' : '회의 저장'}
        </button>
      </div>
    </header>
  );

  const formBlock = (
    <form id="add-meeting-form" onSubmit={handleSubmit} className="add-meeting-modal-form">
          <div className="add-meeting-modal-body">
            {error && <p className="add-meeting-modal-error">{error}</p>}

            {/* 상단 타이틀 + 설명 (Meeting Add.html) */}
            <div className="add-meeting-modal-hero">
              <h3 className="add-meeting-modal-hero-title">회의 일지</h3>
              <p className="add-meeting-modal-hero-desc">회의의 핵심 논의, 결정 사항, 결과를 기록하세요.</p>
            </div>

            {/* 2열 그리드: 왼쪽 2/3, 오른쪽 1/3 */}
            <div className="add-meeting-modal-grid">
              {/* 왼쪽 열 */}
              <div className="add-meeting-modal-main">
                {/* Meeting Details 카드 */}
                <div className="add-meeting-card">
                  <h4 className="add-meeting-card-title">회의 정보</h4>
                  <div className="add-meeting-card-body">
                    <div className="add-meeting-field">
                      <label className="add-meeting-label">회의 제목</label>
                      <input name="title" type="text" value={form.title} onChange={handleChange} placeholder="예: 4분기 전략 회의" className="add-meeting-input" required />
                    </div>
                    <div className="add-meeting-field-row">
                      <div className="add-meeting-field">
                        <label className="add-meeting-label">일시</label>
                        <div className="add-meeting-input-wrap-icon">
                          <span className="material-symbols-outlined add-meeting-input-icon">calendar_month</span>
                          <input name="meetingDate" type="datetime-local" value={form.meetingDate} onChange={handleChange} className="add-meeting-input" />
                        </div>
                      </div>
                      <div className="add-meeting-field">
                        <label className="add-meeting-label">장소</label>
                        <div className="add-meeting-input-wrap-icon">
                          <span className="material-symbols-outlined add-meeting-input-icon">location_on</span>
                          <input name="location" type="text" value={form.location} onChange={handleChange} placeholder="회의실 A / 줌" className="add-meeting-input" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Agenda + Discussion + Action Items 한 카드 */}
                <div className="add-meeting-card add-meeting-card-content">
                  {/* Meeting Agenda */}
                  <div className="add-meeting-content-block">
                    <div className="add-meeting-content-head">
                      <h4 className="add-meeting-card-title">회의 안건</h4>
                      <button type="button" className="add-meeting-link-btn">
                        <span className="material-symbols-outlined">add</span> 항목 추가
                      </button>
                    </div>
                    <div className="add-meeting-textarea-wrap add-meeting-textarea-agenda">
                      <textarea name="agenda" value={form.agenda} onChange={handleChange} placeholder="논의된 주요 안건을 적어 주세요." className="add-meeting-textarea-inner" rows={3} />
                    </div>
                  </div>

                  {/* Discussion Points */}
                  <div className="add-meeting-content-block">
                    <div className="add-meeting-content-head">
                      <h4 className="add-meeting-card-title">논의 내용</h4>
                      <div className="add-meeting-format-btns">
                        <button type="button" className="add-meeting-format-btn" aria-label="목록"><span className="material-symbols-outlined">format_list_bulleted</span></button>
                        <button type="button" className="add-meeting-format-btn" aria-label="굵게"><span className="material-symbols-outlined">format_bold</span></button>
                        <button type="button" className="add-meeting-format-btn" aria-label="기울임"><span className="material-symbols-outlined">format_italic</span></button>
                      </div>
                    </div>
                    <div className="add-meeting-textarea-wrap add-meeting-textarea-discussion">
                      <textarea name="discussionPoints" value={form.discussionPoints} onChange={handleChange} placeholder="핵심 결론과 논의 내용을 요약해 주세요." className="add-meeting-textarea-inner" rows={6} />
                    </div>
                  </div>

                  {/* Action Items */}
                  <div className="add-meeting-content-block">
                    <h4 className="add-meeting-card-title">액션 아이템</h4>
                    <div className="add-meeting-action-list">
                      {(form.actionItems || []).map((item, i) => (
                        <div key={i} className="add-meeting-action-card">
                          <input type="checkbox" checked={!!item.completed} onChange={(e) => updateActionItem(i, 'completed', e.target.checked)} className="add-meeting-action-check" />
                          <input type="text" placeholder="할 일 내용..." value={item.description} onChange={(e) => updateActionItem(i, 'description', e.target.value)} className="add-meeting-action-input" />
                          <div className="add-meeting-action-due-wrap">
                            <span className="material-symbols-outlined add-meeting-action-due-icon">calendar_today</span>
                            <span className="add-meeting-action-due-label">마감일</span>
                          </div>
                          <input type="date" value={item.dueDate || ''} onChange={(e) => updateActionItem(i, 'dueDate', e.target.value)} className="add-meeting-action-date" />
                          <button type="button" className="add-meeting-remove-btn" onClick={() => removeActionItem(i)} aria-label="삭제">
                            <span className="material-symbols-outlined">close</span>
                          </button>
                        </div>
                      ))}
                      <button type="button" className="add-meeting-add-action-btn" onClick={addActionItem}>
                        <span className="material-symbols-outlined">add_circle</span> 액션 아이템 추가
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 오른쪽 열: Attendees */}
              <div className="add-meeting-modal-side">
                <div className="add-meeting-card">
                  <h4 className="add-meeting-card-title">참석자</h4>
                  <div className="add-meeting-attendee-list">
                    {(form.attendees || []).map((a, i) => (
                      <div key={i} className="add-meeting-attendee-item">
                        <div className="add-meeting-attendee-avatar">{getInitials(a.name)}</div>
                        <div className="add-meeting-attendee-info">
                          <input type="text" placeholder="이름" value={a.name} onChange={(e) => updateAttendee(i, 'name', e.target.value)} className="add-meeting-attendee-name-input" />
                          <input type="text" placeholder="역할" value={a.role} onChange={(e) => updateAttendee(i, 'role', e.target.value)} className="add-meeting-attendee-role-input" />
                        </div>
                        <button type="button" className="add-meeting-remove-btn" onClick={() => removeAttendee(i)} aria-label="삭제">
                          <span className="material-symbols-outlined">cancel</span>
                        </button>
                      </div>
                    ))}
                    <button type="button" className="add-meeting-manage-attendees-btn" onClick={openAttendeeModal}>
                      <span className="material-symbols-outlined">person_add</span> 참석자 관리
                    </button>
                  </div>
                </div>

                {/* 상태 (모바일에서 보이도록) */}
                <div className="add-meeting-card add-meeting-status-card">
                  <h4 className="add-meeting-card-title">상태</h4>
                  <select name="status" value={form.status} onChange={handleChange} className="add-meeting-input">
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* 하단 버튼: 수정 시 product-detail 스타일(취소/저장), 추가 시 기존 스타일 */}
            {isEdit ? (
              <div className="add-meeting-edit-footer">
                <button type="button" className="add-meeting-edit-cancel" onClick={onClose}>
                  취소
                </button>
                <button type="submit" className="add-meeting-edit-save" disabled={saving}>
                  {saving ? '저장 중…' : '저장'}
                </button>
              </div>
            ) : (
              <div className="add-meeting-modal-bottom-bar">
                <button type="button" className="add-meeting-modal-btn-discard" onClick={onClose}>
                  취소
                </button>
                <button type="submit" className="add-meeting-modal-btn-finish" disabled={saving}>
                  {saving ? '저장 중...' : '작성 완료 및 요약 보내기'}
                </button>
              </div>
            )}
          </div>
        </form>
  );

  return (
    <>
      {isEdit ? (
        <>
          <div className="add-meeting-edit-overlay" aria-hidden="true" onClick={onClose} />
          <div className="add-meeting-edit-panel" onClick={(e) => e.stopPropagation()}>
            <div className="add-meeting-edit-inner">
              {headerBlock}
              {formBlock}
            </div>
          </div>
        </>
      ) : (
        <div className="add-meeting-modal-overlay">
          <div className="add-meeting-modal" onClick={(e) => e.stopPropagation()}>
            {headerBlock}
            {formBlock}
          </div>
        </div>
      )}

      {showAttendeeModal && (
        <ParticipantModal
          teamMembers={teamMembers}
          selected={[]}
          currentUser={currentUser}
          onConfirm={handleAttendeeConfirm}
          onClose={() => setShowAttendeeModal(false)}
        />
      )}
    </>
  );
}
