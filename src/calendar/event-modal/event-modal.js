import { useState, useEffect, useCallback } from 'react';
import ParticipantModal from '../participant-modal/participant-modal';
import './event-modal.css';

import { API_BASE } from '@/config';

const PRESET_COLORS = [
  { hex: '#7986cb', label: '라벤더' },
  { hex: '#81c784', label: '민트' },
  { hex: '#e57373', label: '코랄' },
  { hex: '#ffb74d', label: '피치' },
  { hex: '#ba68c8', label: '퍼플' },
  { hex: '#4dd0e1', label: '스카이' },
  { hex: '#f06292', label: '로즈' },
  { hex: '#fff176', label: '레몬' },
  { hex: '#a1887f', label: '모카' },
  { hex: '#90a4ae', label: '그레이' }
];

const VISIBILITY_OPTIONS = [
  { value: 'company', label: '회사 전체', icon: 'groups', desc: '같은 회사 모든 직원이 볼 수 있습니다' },
  { value: 'team', label: '참여자만', icon: 'group', desc: '선택한 참여자만 볼 수 있습니다' },
  { value: 'private', label: '나만 보기', icon: 'lock', desc: '본인만 볼 수 있습니다' }
];

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function defaultTime() { return '09:00'; }

/** eventId가 `g:xxxxx` 형태면 Google 이벤트 */
function isGoogleEventId(id) { return typeof id === 'string' && id.startsWith('g:'); }
function extractGoogleId(id) { return id.slice(2); }

/** Google Calendar 이벤트 → 폼 값 */
function googleEventToForm(ev) {
  const start = ev.start || {};
  const end = ev.end || {};
  const allDay = !!start.date && !start.dateTime;

  if (allDay) {
    const startDate = start.date || todayStr();
    let endDate = end.date || startDate;
    if (endDate > startDate) {
      const last = new Date(endDate);
      last.setDate(last.getDate() - 1);
      endDate = last.toISOString().slice(0, 10);
    } else {
      endDate = startDate;
    }
    return { title: ev.summary || '', description: ev.description || '', color: '', allDay: true, startDate, startTime: defaultTime(), endDate, endTime: '10:00', visibility: 'private', participants: [] };
  }

  const startDt = start.dateTime ? new Date(start.dateTime) : new Date();
  const endDt = end.dateTime ? new Date(end.dateTime) : new Date(startDt.getTime() + 3600000);
  return { title: ev.summary || '', description: ev.description || '', color: '', allDay: false, startDate: startDt.toISOString().slice(0, 10), startTime: startDt.toTimeString().slice(0, 5), endDate: endDt.toISOString().slice(0, 10), endTime: endDt.toTimeString().slice(0, 5), visibility: 'private', participants: [] };
}

/** CRM 이벤트 → 폼 값 */
function crmEventToForm(ev) {
  const startDate = ev.start ? new Date(ev.start) : new Date();
  const endDate = ev.end ? new Date(ev.end) : new Date(startDate.getTime() + 3600000);

  if (ev.allDay) {
    const endForForm = new Date(endDate);
    if (endForForm > startDate) endForForm.setDate(endForForm.getDate() - 1);
    return { title: ev.title || '', description: ev.description || '', color: ev.color || '', allDay: true, startDate: startDate.toISOString().slice(0, 10), startTime: defaultTime(), endDate: endForForm.toISOString().slice(0, 10), endTime: '10:00', visibility: ev.visibility || 'company', participants: ev.participants || [] };
  }

  return { title: ev.title || '', description: ev.description || '', color: ev.color || '', allDay: false, startDate: startDate.toISOString().slice(0, 10), startTime: startDate.toTimeString().slice(0, 5), endDate: endDate.toISOString().slice(0, 10), endTime: endDate.toTimeString().slice(0, 5), visibility: ev.visibility || 'company', participants: ev.participants || [] };
}

/** 폼 → CRM API body */
function formToCrmBody(form) {
  const title = (form.title || '').trim() || '(제목 없음)';
  const description = (form.description || '').trim() || undefined;
  const color = form.color || undefined;
  let start, end;
  if (form.allDay) {
    const startDate = form.startDate || todayStr();
    const lastDay = form.endDate || startDate;
    const endExclusive = new Date(lastDay + 'T00:00:00');
    endExclusive.setDate(endExclusive.getDate() + 1);
    start = new Date(startDate + 'T00:00:00').toISOString();
    end = endExclusive.toISOString();
  } else {
    const startDt = new Date(form.startDate + 'T' + (form.startTime || '09:00') + ':00');
    const endDt = new Date((form.endDate || form.startDate) + 'T' + (form.endTime || '10:00') + ':00');
    if (endDt <= startDt) endDt.setHours(startDt.getHours() + 1);
    start = startDt.toISOString();
    end = endDt.toISOString();
  }
  return { title, description, color, start, end, allDay: !!form.allDay, visibility: form.visibility || 'company', participants: form.participants || [] };
}

/** 폼 → Google Calendar API body */
function formToGoogleBody(form) {
  const summary = (form.title || '').trim() || '(제목 없음)';
  const description = (form.description || '').trim() || undefined;
  if (form.allDay) {
    const startDate = form.startDate || todayStr();
    const lastDay = form.endDate || startDate;
    const endExclusive = new Date(lastDay + 'T00:00:00');
    endExclusive.setDate(endExclusive.getDate() + 1);
    return { summary, description, start: { date: startDate }, end: { date: endExclusive.toISOString().slice(0, 10) } };
  }
  const startDt = new Date(form.startDate + 'T' + (form.startTime || '09:00') + ':00');
  const endDt = new Date((form.endDate || form.startDate) + 'T' + (form.endTime || '10:00') + ':00');
  if (endDt <= startDt) endDt.setHours(startDt.getHours() + 1);
  return { summary, description, start: { dateTime: startDt.toISOString() }, end: { dateTime: endDt.toISOString() } };
}

function formatEventWhen(ev, source) {
  if (source === 'google') {
    const start = ev.start || {};
    const end = ev.end || {};
    if (start.date) {
      const s = start.date;
      const e = end.date;
      if (e && e !== s) return `${s} ~ ${e}`;
      return s;
    }
    const s = start.dateTime ? new Date(start.dateTime) : null;
    const e = end.dateTime ? new Date(end.dateTime) : null;
    if (!s) return '—';
    const opts = { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return s.toLocaleString('ko-KR', opts) + (e ? ' ~ ' + e.toLocaleString('ko-KR', opts) : '');
  }
  if (!ev.start) return '—';
  const s = new Date(ev.start);
  const e = ev.end ? new Date(ev.end) : null;
  if (ev.allDay) {
    const sStr = s.toISOString().slice(0, 10);
    if (!e || e.getTime() - s.getTime() <= 86400000) return sStr;
    const eLast = new Date(e);
    eLast.setDate(eLast.getDate() - 1);
    return `${sStr} ~ ${eLast.toISOString().slice(0, 10)}`;
  }
  const opts = { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return s.toLocaleString('ko-KR', opts) + (e ? ' ~ ' + e.toLocaleString('ko-KR', opts) : '');
}

export default function EventModal({ eventId, isEdit, initialDate, calendarType, onClose, onSaved, onDeleted, currentUser }) {
  const isAdd = !eventId;
  const isPersonal = calendarType === 'personal';
  const isGoogle = !isAdd && isGoogleEventId(eventId);
  const realId = isGoogle ? extractGoogleId(eventId) : eventId;

  const [mode, setMode] = useState(isAdd ? 'add' : (isEdit ? 'edit' : 'view'));
  const [event, setEvent] = useState(null);
  const [form, setForm] = useState(() => ({
    title: '', description: '', color: '', allDay: false,
    startDate: todayStr(), startTime: defaultTime(),
    endDate: todayStr(), endTime: '10:00',
    visibility: 'company', participants: []
  }));
  const [loading, setLoading] = useState(!isAdd);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [teamMembers, setTeamMembers] = useState([]);
  const [showParticipantModal, setShowParticipantModal] = useState(false);

  const isOwner = isGoogle
    ? true
    : event ? (currentUser && String(event.userId) === String(currentUser._id)) : true;

  useEffect(() => {
    if (isAdd && initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) {
      setForm((prev) => ({ ...prev, startDate: initialDate, endDate: initialDate }));
    }
  }, [isAdd, initialDate]);

  useEffect(() => {
    if (!isAdd && isGoogle) return;
    let cancelled = false;
    fetch(`${API_BASE}/calendar-events/team-members`, { headers: getAuthHeader() })
      .then((r) => r.json())
      .then((data) => { if (!cancelled && data.members) setTeamMembers(data.members); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isAdd, isGoogle]);

  const fetchEvent = useCallback(async () => {
    if (isAdd) return;
    setLoading(true);
    setError('');
    try {
      const url = isGoogle
        ? `${API_BASE}/google-calendar/events/${encodeURIComponent(realId)}`
        : `${API_BASE}/calendar-events/${encodeURIComponent(realId)}`;
      const res = await fetch(url, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '일정을 불러올 수 없습니다.');
        setEvent(null);
        return;
      }
      setEvent(data);
      setForm(isGoogle ? googleEventToForm(data) : crmEventToForm(data));
    } catch (_) {
      setError('일정을 불러올 수 없습니다.');
      setEvent(null);
    } finally {
      setLoading(false);
    }
  }, [isAdd, isGoogle, realId]);

  useEffect(() => { fetchEvent(); }, [fetchEvent]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showParticipantModal) setShowParticipantModal(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showParticipantModal]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    setError('');
  };

  const handleParticipantConfirm = useCallback((selected) => {
    setForm((prev) => ({ ...prev, participants: selected }));
    setShowParticipantModal(false);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (isAdd) {
        if (isPersonal) {
          const body = { ...formToGoogleBody(form), allDay: !!form.allDay };
          const res = await fetch(`${API_BASE}/google-calendar/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify(body)
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) { setError(data.error || '개인 일정 추가에 실패했습니다.'); return; }
          onSaved?.();
          onClose?.();
        } else {
          const body = formToCrmBody(form);
          const res = await fetch(`${API_BASE}/calendar-events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify(body)
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) { setError(data.error || '일정 추가에 실패했습니다.'); return; }
          onSaved?.();
          onClose?.();
        }
      } else if (isGoogle) {
        const body = formToGoogleBody(form);
        const res = await fetch(`${API_BASE}/google-calendar/events/${encodeURIComponent(realId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError(data.error || '일정 수정에 실패했습니다.'); return; }
        setEvent(data);
        setMode('view');
        setForm(googleEventToForm(data));
        onSaved?.();
      } else {
        const body = formToCrmBody(form);
        const res = await fetch(`${API_BASE}/calendar-events/${encodeURIComponent(realId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError(data.error || '일정 수정에 실패했습니다.'); return; }
        setEvent(data);
        setMode('view');
        setForm(crmEventToForm(data));
        onSaved?.();
      }
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('이 일정을 삭제할까요?')) return;
    setDeleting(true);
    setError('');
    try {
      const url = isGoogle
        ? `${API_BASE}/google-calendar/events/${encodeURIComponent(realId)}`
        : `${API_BASE}/calendar-events/${encodeURIComponent(realId)}`;
      const res = await fetch(url, { method: 'DELETE', headers: getAuthHeader() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '일정 삭제에 실패했습니다.');
        return;
      }
      onDeleted?.();
      onClose?.();
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setDeleting(false);
    }
  };

  const modalTitle = isAdd ? '일정 추가' : mode === 'view' ? '일정 보기' : '일정 수정';
  const visLabel = VISIBILITY_OPTIONS.find((v) => v.value === (isGoogle ? 'private' : (event?.visibility || 'company')));
  const eventTitle = isGoogle ? (event?.summary || '(제목 없음)') : (event?.title || '(제목 없음)');
  const eventDesc = event?.description || '';

  return (
    <div className="event-modal-overlay">
      <div className="event-modal" onClick={(e) => e.stopPropagation()}>
        <div className="event-modal-header">
          <h3>
            {modalTitle}_
            {isGoogle && !isAdd && <span className="event-modal-source-badge google">Google</span>}
            {!isGoogle && !isAdd && <span className="event-modal-source-badge crm">회사</span>}
          </h3>
          <button type="button" className="event-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {loading && (
          <div className="event-modal-body"><p className="event-modal-loading">불러오는 중…</p></div>
        )}

        {!loading && mode === 'view' && event && (
          <div className="event-modal-body">
            {error && <p className="event-modal-error">{error}</p>}
            <dl className="event-modal-dl">
              <dt>제목</dt>
              <dd>{eventTitle}</dd>
              <dt>일시</dt>
              <dd>{formatEventWhen(event, isGoogle ? 'google' : 'crm')}</dd>
              {!isGoogle && (
                <>
                  <dt>작성자</dt>
                  <dd>{event.creatorName || '—'}</dd>
                  <dt>공개범위</dt>
                  <dd>
                    <span className="event-modal-vis-badge">
                      <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>{visLabel?.icon || 'groups'}</span>
                      {visLabel?.label || '회사 전체'}
                    </span>
                  </dd>
                </>
              )}
              {!isGoogle && event.participants?.length > 0 && (
                <>
                  <dt>참여자</dt>
                  <dd className="event-modal-participants-view">
                    {event.participants.map((p) => (
                      <span key={p.userId} className="event-modal-participant-chip">{p.name || '(이름 없음)'}</span>
                    ))}
                  </dd>
                </>
              )}
              {eventDesc && (
                <>
                  <dt>설명</dt>
                  <dd className="event-modal-desc">{eventDesc}</dd>
                </>
              )}
            </dl>
            <div className="event-modal-footer">
              {isOwner && (
                <>
                  <button type="button" className="event-modal-btn event-modal-edit" onClick={() => setMode('edit')}>수정</button>
                  <button type="button" className="event-modal-btn event-modal-delete" onClick={handleDelete} disabled={deleting}>
                    {deleting ? '삭제 중…' : '삭제'}
                  </button>
                </>
              )}
              <button type="button" className="event-modal-btn event-modal-cancel" onClick={onClose}>닫기</button>
            </div>
          </div>
        )}

        {!loading && (mode === 'add' || mode === 'edit') && (
          <form onSubmit={handleSubmit} className="event-modal-body">
            {error && <p className="event-modal-error">{error}</p>}

            <div className="event-modal-field">
              <label htmlFor="event-title">제목 <span className="required">*</span></label>
              {!isGoogle ? (
                <div className="event-modal-title-wrap">
                  <span className="event-modal-title-prefix">[{currentUser?.name || '이름'}]_</span>
                  <input id="event-title" name="title" type="text" value={form.title} onChange={handleChange} placeholder="일정 제목" required />
                </div>
              ) : (
                <input id="event-title" name="title" type="text" value={form.title} onChange={handleChange} placeholder="일정 제목" required />
              )}
            </div>

            {!isGoogle && (
              <div className="event-modal-field">
                <label>색상</label>
                <div className="event-modal-colors">
                  <button type="button" className={`event-modal-color-swatch ${!form.color ? 'selected' : ''}`} onClick={() => setForm((p) => ({ ...p, color: '' }))} title="기본" aria-label="기본 색상">
                    <span className="event-modal-color-default" />
                  </button>
                  {PRESET_COLORS.map((c) => (
                    <button key={c.hex} type="button" className={`event-modal-color-swatch ${form.color === c.hex ? 'selected' : ''}`} onClick={() => setForm((p) => ({ ...p, color: c.hex }))} title={c.label} style={{ background: c.hex }} aria-label={c.label} />
                  ))}
                </div>
              </div>
            )}

            <div className="event-modal-field event-modal-checkbox-wrap">
              <label className="event-modal-checkbox">
                <input type="checkbox" name="allDay" checked={form.allDay} onChange={handleChange} />
                <span>종일</span>
              </label>
            </div>

            {form.allDay ? (
              <div className="event-modal-row">
                <div className="event-modal-field"><label>시작일</label><input type="date" name="startDate" value={form.startDate} onChange={handleChange} /></div>
                <div className="event-modal-field"><label>종료일</label><input type="date" name="endDate" value={form.endDate} onChange={handleChange} min={form.startDate} /></div>
              </div>
            ) : (
              <>
                <div className="event-modal-field"><label>시작일시</label><div className="event-modal-row"><input type="date" name="startDate" value={form.startDate} onChange={handleChange} /><input type="time" name="startTime" value={form.startTime} onChange={handleChange} /></div></div>
                <div className="event-modal-field"><label>종료일시</label><div className="event-modal-row"><input type="date" name="endDate" value={form.endDate || form.startDate} onChange={handleChange} min={form.startDate} /><input type="time" name="endTime" value={form.endTime} onChange={handleChange} /></div></div>
              </>
            )}

            {!isGoogle && (
              <div className="event-modal-field">
                <label>공개범위</label>
                <div className="event-modal-vis-options">
                  {VISIBILITY_OPTIONS.map((opt) => (
                    <button key={opt.value} type="button" className={`event-modal-vis-option ${form.visibility === opt.value ? 'active' : ''}`} onClick={() => setForm((p) => ({ ...p, visibility: opt.value }))}>
                      <span className="material-symbols-outlined">{opt.icon}</span>
                      <span className="event-modal-vis-label">{opt.label}</span>
                    </button>
                  ))}
                </div>
                <p className="event-modal-vis-desc">{VISIBILITY_OPTIONS.find((v) => v.value === form.visibility)?.desc}</p>
              </div>
            )}

            {!isGoogle && form.visibility === 'team' && (
              <div className="event-modal-field">
                <label>참여자</label>
                <button
                  type="button"
                  className="event-modal-btn event-modal-participant-trigger"
                  onClick={() => setShowParticipantModal(true)}
                >
                  <span className="material-symbols-outlined">group_add</span>
                  참여자 선택 ({form.participants.length}명)
                </button>
                {form.participants.length > 0 && (
                  <div className="event-modal-selected-chips">
                    {form.participants.map((p) => (
                      <span key={p.userId} className="event-modal-participant-chip removable" onClick={() => setForm((prev) => ({ ...prev, participants: prev.participants.filter((x) => x.userId !== p.userId) }))}>
                        {p.name || '(이름 없음)'} ✕
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="event-modal-field">
              <label htmlFor="event-description">설명</label>
              <textarea id="event-description" name="description" value={form.description} onChange={handleChange} placeholder="설명 (선택)" rows={3} />
            </div>

            <div className="event-modal-footer">
              <button type="button" className="event-modal-btn event-modal-cancel" onClick={() => (eventId ? setMode('view') : onClose?.())}>취소</button>
              <button type="submit" className="event-modal-btn event-modal-save" disabled={saving}>
                {saving ? '저장 중…' : (isAdd ? '일정 추가' : '저장')}
              </button>
            </div>
          </form>
        )}

        {!loading && eventId && !event && (
          <div className="event-modal-body">
            <p className="event-modal-error">{error || '일정을 찾을 수 없습니다.'}</p>
            <button type="button" className="event-modal-btn event-modal-cancel" onClick={onClose}>닫기</button>
          </div>
        )}
      </div>

      {showParticipantModal && (
        <ParticipantModal
          teamMembers={teamMembers}
          selected={form.participants}
          currentUser={currentUser}
          onConfirm={handleParticipantConfirm}
          onClose={() => setShowParticipantModal(false)}
        />
      )}
    </div>
  );
}
