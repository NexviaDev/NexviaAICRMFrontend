import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ParticipantModal from '../../calendar/participant-modal/participant-modal';
import CategoryManageModal from './category-manage-modal';
import '../../calendar/event-modal/event-modal.css';
import './add-meeting-modal.css';

import { API_BASE } from '@/config';
const DEFAULT_MEETING_CATEGORIES = ['주간회의', '월간 회의', '프로젝트 회의'];

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

export default function AddMeetingModal({ meeting, onClose, onSaved }) {
  const isEdit = !!meeting?._id;
  const [categoryOptions, setCategoryOptions] = useState(DEFAULT_MEETING_CATEGORIES);
  const [showCategoryManageModal, setShowCategoryManageModal] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [categoryInput, setCategoryInput] = useState('');
  const [form, setForm] = useState({
    title: '',
    categories: Array.isArray(meeting?.categories) && meeting.categories.length > 0
      ? meeting.categories
      : (meeting?.category ? [meeting.category] : [DEFAULT_MEETING_CATEGORIES[0]]),
    meetingDate: toDatetimeLocal(meeting?.meetingDate || new Date()),
    location: '',
    agenda: '',
    discussionPoints: '',
    attendees: []
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showParticipantModal, setShowParticipantModal] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);
  const discussionAudioInputRef = useRef(null);
  const [discussionAudioDropActive, setDiscussionAudioDropActive] = useState(false);
  const [discussionAudioUploading, setDiscussionAudioUploading] = useState(false);
  const [discussionAudioError, setDiscussionAudioError] = useState('');
  const [discussionAudioNotice, setDiscussionAudioNotice] = useState('');

  useEffect(() => {
    if (!meeting) return;
    setForm({
      title: meeting.title ?? '',
      categories: Array.isArray(meeting.categories) && meeting.categories.length > 0
        ? meeting.categories
        : (meeting.category ? [meeting.category] : [DEFAULT_MEETING_CATEGORIES[0]]),
      meetingDate: toDatetimeLocal(meeting.meetingDate),
      location: meeting.location ?? '',
      agenda: meeting.agenda ?? '',
      discussionPoints: meeting.discussionPoints ?? '',
      attendees: Array.isArray(meeting.attendees)
        ? meeting.attendees.map((a) => ({
            userId: a.userId,
            name: a.name ?? '',
            role: a.role ?? ''
          }))
        : []
    });
  }, [meeting]);

  const fetchMeetingCategories = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/companies/meeting-categories`, { headers: getAuthHeader() });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const list = Array.isArray(data.categories) ? data.categories.map((v) => String(v || '').trim()).filter(Boolean) : [];
      if (list.length === 0) return;
      setCategoryOptions(list);
      setForm((prev) => {
        const nextSelected = Array.isArray(prev.categories)
          ? prev.categories.filter((c) => list.includes(c))
          : [];
        if (nextSelected.length > 0) return { ...prev, categories: nextSelected };
        return { ...prev, categories: [list[0]] };
      });
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchMeetingCategories();
  }, [fetchMeetingCategories]);

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

  const persistMeetingCategories = async (next) => {
    const res = await fetch(`${API_BASE}/companies/meeting-categories`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ categories: next })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '카테고리 저장에 실패했습니다.');
    return Array.isArray(data.categories) ? data.categories : next;
  };

  const handleAddCategory = async () => {
    const nextItem = categoryInput.trim();
    if (!nextItem) return;
    if (categoryOptions.includes(nextItem)) {
      setCategoryInput('');
      return;
    }
    const next = [...categoryOptions, nextItem];
    try {
      const saved = await persistMeetingCategories(next);
      setCategoryOptions(saved);
      setCategoryInput('');
      setForm((prev) => ({ ...prev, categories: [...new Set([...(prev.categories || []), nextItem])] }));
    } catch (err) {
      setError(err.message || '카테고리 저장 실패');
    }
  };

  const handleRemoveCategory = async (target) => {
    if (DEFAULT_MEETING_CATEGORIES.includes(target)) {
      setError('기본 카테고리(주간회의/월간 회의/프로젝트 회의)는 삭제할 수 없습니다.');
      return;
    }
    const next = categoryOptions.filter((v) => v !== target);
    if (next.length === 0) {
      setError('카테고리는 최소 1개 이상 필요합니다.');
      return;
    }
    try {
      const saved = await persistMeetingCategories(next);
      setCategoryOptions(saved);
      setForm((prev) => {
        const filtered = (prev.categories || []).filter((c) => c !== target);
        return { ...prev, categories: filtered.length > 0 ? filtered : [saved[0] || DEFAULT_MEETING_CATEGORIES[0]] };
      });
    } catch (err) {
      setError(err.message || '카테고리 저장 실패');
    }
  };

  const toggleCategorySelection = (category) => {
    setForm((prev) => {
      const has = (prev.categories || []).includes(category);
      if (has) {
        const next = (prev.categories || []).filter((c) => c !== category);
        if (next.length === 0) return prev;
        return { ...prev, categories: next };
      }
      return { ...prev, categories: [...(prev.categories || []), category] };
    });
  };

  const openCategoryManageModal = () => {
    setCategoryInput('');
    setShowCategoryDropdown(false);
    setShowCategoryManageModal(true);
  };

  const fetchTeamMembers = useCallback(() => {
    const headers = getAuthHeader();
    Promise.all([
      fetch(`${API_BASE}/calendar-events/team-members`, { headers }).then((r) => r.json().catch(() => ({}))).catch(() => ({})),
      fetch(`${API_BASE}/companies/overview`, { headers }).then((r) => r.json().catch(() => ({}))).catch(() => ({}))
    ])
      .then(([teamData, overviewData]) => {
        const fromTeam = Array.isArray(teamData?.members) ? teamData.members : [];
        const fromOverview = Array.isArray(overviewData?.employees) ? overviewData.employees : [];
        const overviewMap = new Map(fromOverview.map((e) => [String(e.id), e]));
        const merged = fromTeam.map((m) => {
          const o = overviewMap.get(String(m._id));
          return {
            ...m,
            phone: m.phone || o?.phone || '',
            department: m.department || m.companyDepartment || o?.department || ''
          };
        });
        setTeamMembers(merged);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchTeamMembers();
  }, [fetchTeamMembers]);

  const removeAttendeeEntry = useCallback((p, idx) => {
    setForm((prev) => ({
      ...prev,
      attendees: (prev.attendees || []).filter((a, i) => {
        if (p.userId && a.userId) return String(a.userId) !== String(p.userId);
        return i !== idx;
      })
    }));
  }, []);

  const openParticipantModal = () => {
    if (teamMembers.length === 0) fetchTeamMembers();
    setShowParticipantModal(true);
  };

  const uploadAudioForDiscussion = useCallback(async (filesLike) => {
    const files = Array.from(filesLike || []).filter((f) => f && f instanceof File);
    if (!files.length || saving || discussionAudioUploading) return;
    const accept = /\.(mp3|wav|m4a|webm)$/i;
    const audioTypes = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm'];
    const file = files.find((f) => accept.test(f.name) || audioTypes.includes(f.type));
    if (!file) {
      setDiscussionAudioError('MP3, WAV, M4A, WebM 파일만 업로드할 수 있습니다.');
      return;
    }
    setDiscussionAudioError('');
    setDiscussionAudioNotice('음성 파일을 처리 중입니다. AssemblyAI 전사 후 Gemini가 분류/요약합니다.');
    setDiscussionAudioUploading(true);
    try {
      const formData = new FormData();
      formData.append('audio', file);
      const res = await fetch(`${API_BASE}/meeting-minutes/discussion/from-audio`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: formData
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '음성 업로드 처리에 실패했습니다.');
      const piece = String(data.content || '').trim();
      if (!piece) throw new Error('요약 결과가 비어 있습니다.');
      setForm((prev) => {
        const prevText = String(prev.discussionPoints || '').trim();
        const combined = prevText ? `${prevText}\n\n${piece}` : piece;
        return { ...prev, discussionPoints: combined };
      });
      setDiscussionAudioNotice(
        '요약이 논의 내용에 반영되었습니다. 개인정보 보호를 위해 AssemblyAI 전사 데이터는 삭제 요청되었습니다.'
      );
    } catch (e) {
      setDiscussionAudioError(e.message || '음성 업로드 처리에 실패했습니다.');
      setDiscussionAudioNotice('');
    } finally {
      setDiscussionAudioUploading(false);
    }
  }, [discussionAudioUploading, saving]);

  const handleParticipantConfirm = useCallback((selected) => {
    setForm((prev) => ({
      ...prev,
      attendees: selected.map((s) => {
        const m = teamMembers.find((t) => String(t._id) === String(s.userId));
        return {
          userId: s.userId,
          name: s.name || (m && m.name) || '',
          role: m && m.role ? String(m.role) : ''
        };
      })
    }));
    setShowParticipantModal(false);
  }, [teamMembers]);

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
        category: (form.categories || [])[0] || '',
        categories: form.categories || [],
        meetingDate: form.meetingDate ? new Date(form.meetingDate).toISOString() : new Date().toISOString(),
        location: form.location.trim(),
        agenda: form.agenda,
        discussionPoints: form.discussionPoints,
        attendees: (form.attendees || []).map((a) => {
          const row = { name: a.name, role: a.role };
          if (a.userId) row.userId = a.userId;
          return row;
        })
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
                        <label className="add-meeting-label">카테고리</label>
                        <div className="add-meeting-category-inline">
                          <div className="add-meeting-category-dropdown-wrap">
                            <button
                              type="button"
                              className="add-meeting-category-dropdown-trigger"
                              onClick={() => setShowCategoryDropdown((v) => !v)}
                            >
                              <span className="add-meeting-category-dropdown-trigger-text">
                                {(form.categories || []).length > 0 ? (form.categories || []).join(', ') : '카테고리 선택'}
                              </span>
                              <span className="material-symbols-outlined">
                                {showCategoryDropdown ? 'expand_less' : 'expand_more'}
                              </span>
                            </button>
                            {showCategoryDropdown && (
                              <div className="add-meeting-category-dropdown">
                                {categoryOptions.map((c) => (
                                  <label key={c} className="add-meeting-category-option">
                                    <input
                                      type="checkbox"
                                      checked={(form.categories || []).includes(c)}
                                      onChange={() => toggleCategorySelection(c)}
                                    />
                                    <span>{c}</span>
                                  </label>
                                ))}
                                <button type="button" className="add-meeting-category-dropdown-plus" onClick={openCategoryManageModal}>
                                  <span className="material-symbols-outlined">add</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
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
              </div>

              {/* 안건·논의: 데스크톱에서 그리드 전체 너비(참석자 열 포함) */}
              <div className="add-meeting-card add-meeting-card-content add-meeting-card-content-fullrow">
                {/* Meeting Agenda */}
                <div className="add-meeting-content-block">
                  <h4 className="add-meeting-card-title">회의 안건</h4>
                  <div className="add-meeting-textarea-wrap add-meeting-textarea-agenda">
                    <textarea name="agenda" value={form.agenda} onChange={handleChange} placeholder="논의된 주요 안건을 적어 주세요." className="add-meeting-textarea-inner" rows={3} />
                  </div>
                </div>

                {/* Discussion Points */}
                <div className="add-meeting-content-block">
                  <h4 className="add-meeting-card-title">논의 내용</h4>
                  <div className="add-meeting-textarea-wrap add-meeting-textarea-discussion">
                    <textarea name="discussionPoints" value={form.discussionPoints} onChange={handleChange} placeholder="핵심 결론과 논의 내용을 요약해 주세요." className="add-meeting-textarea-inner" rows={6} />
                  </div>
                  {discussionAudioError && (
                    <p className="add-meeting-discussion-audio-error">{discussionAudioError}</p>
                  )}
                  {discussionAudioNotice && !discussionAudioError && (
                    <p className="add-meeting-discussion-audio-notice">{discussionAudioNotice}</p>
                  )}
                  <input
                    ref={discussionAudioInputRef}
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a,.webm"
                    className="add-meeting-discussion-audio-input-hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) uploadAudioForDiscussion(e.target.files);
                      e.target.value = '';
                    }}
                    aria-hidden="true"
                  />
                  <div
                    className={`add-meeting-discussion-audio-drop ${discussionAudioDropActive ? 'is-dragover' : ''} ${discussionAudioUploading ? 'is-uploading' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!discussionAudioUploading && !saving) setDiscussionAudioDropActive(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!e.currentTarget.contains(e.relatedTarget)) setDiscussionAudioDropActive(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDiscussionAudioDropActive(false);
                      if (!discussionAudioUploading && !saving && e.dataTransfer?.files?.length) {
                        uploadAudioForDiscussion(e.dataTransfer.files);
                      }
                    }}
                  >
                    <span className="material-symbols-outlined">audio_file</span>
                    <span>
                      {discussionAudioUploading
                        ? '음성 처리 중... (AssemblyAI 전사 → Gemini 분류/요약)'
                        : '음성 파일 드래그앤드롭 또는 선택 (MP3/WAV/M4A/WebM) — 기존 글 뒤에 이어 붙입니다.'}
                    </span>
                    <button
                      type="button"
                      className="add-meeting-discussion-audio-btn"
                      onClick={() => discussionAudioInputRef.current?.click()}
                      disabled={discussionAudioUploading || saving}
                    >
                      파일 선택
                    </button>
                  </div>
                </div>
              </div>

              {/* 오른쪽 열: 참여자 (event-modal.js와 동일 패턴) */}
              <div className="add-meeting-modal-side">
                <div className="add-meeting-card add-meeting-card-participants">
                  <div className="event-modal-field">
                    <label>참여자</label>
                    <button
                      type="button"
                      className="event-modal-btn event-modal-participant-trigger"
                      onClick={openParticipantModal}
                    >
                      <span className="material-symbols-outlined">group_add</span>
                      참여자 선택 ({(form.attendees || []).length}명)
                    </button>
                    {(form.attendees || []).length > 0 && (
                      <div className="event-modal-selected-chips">
                        {(form.attendees || []).map((p, idx) => (
                          <span
                            key={p.userId ? String(p.userId) : `legacy-${idx}-${p.name || ''}`}
                            className="event-modal-participant-chip removable"
                          >
                            <span className="event-modal-participant-chip-label">{p.name || '(이름 없음)'}</span>
                            <button
                              type="button"
                              className="event-modal-participant-chip-remove"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                removeAttendeeEntry(p, idx);
                              }}
                              aria-label={`${p.name || '참여자'} 제거`}
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 하단 버튼: 수정 시 product-detail 스타일(취소/저장), 추가 시 기존 스타일 */}
            {isEdit && (
              <div className="add-meeting-edit-footer">
                <button type="button" className="add-meeting-edit-cancel" onClick={onClose}>
                  취소
                </button>
                <button type="submit" className="add-meeting-edit-save" disabled={saving}>
                  {saving ? '저장 중…' : '저장'}
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

      {showParticipantModal && (
        <ParticipantModal
          teamMembers={teamMembers}
          selected={(form.attendees || [])
            .filter((a) => a.userId)
            .map((a) => ({ userId: a.userId, name: a.name || '' }))}
          currentUser={currentUser}
          onConfirm={handleParticipantConfirm}
          onClose={() => setShowParticipantModal(false)}
        />
      )}

      <CategoryManageModal
        show={showCategoryManageModal}
        categoryInput={categoryInput}
        setCategoryInput={setCategoryInput}
        handleAddCategory={handleAddCategory}
        categoryOptions={categoryOptions}
        defaultMeetingCategories={DEFAULT_MEETING_CATEGORIES}
        handleRemoveCategory={handleRemoveCategory}
        onClose={() => setShowCategoryManageModal(false)}
      />
    </>
  );
}
