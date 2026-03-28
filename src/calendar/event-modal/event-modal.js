import { useState, useEffect, useCallback, useMemo } from 'react';
import ParticipantModal from '@/shared/participant-modal/participant-modal';
import './event-modal.css';

import { API_BASE } from '@/config';
import { googleEventDisplayTitle } from '../google-event-display-title';
import {
  stripRelatedCompanyDescriptionBlock,
  stripRelatedContactDescriptionBlock,
  ensureAllRelatedVisitDescriptions
} from '../event-modal-related-company';
import {
  formatDateInSeoulYmd,
  ymdMinusOneDay,
  crmAllDayInclusiveEndYmd
} from '../calendar-date-utils';

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

/** 설명 보기: http(s) URL을 하이퍼링크로 표시 (회의 일지 링크 등) */
function linkifyLine(line, lineKey) {
  const urlRe = /(https?:\/\/[^\s]+)/g;
  const parts = [];
  let last = 0;
  let m;
  let i = 0;
  while ((m = urlRe.exec(line)) !== null) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    const href = m[1].trim();
    parts.push(
      <a key={`l${lineKey}-${i++}`} href={href} target="_blank" rel="noopener noreferrer" className="event-modal-desc-link">
        {href}
      </a>
    );
    last = m.index + m[1].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts.length ? parts : line;
}

function renderDescriptionWithLinks(text) {
  if (text == null || text === '') return null;
  const lines = String(text).split('\n');
  return lines.map((line, lineIdx) => (
    <span key={lineIdx}>
      {lineIdx > 0 ? <br /> : null}
      {linkifyLine(line, lineIdx)}
    </span>
  ));
}

/** eventId가 `g:xxxxx` 형태면 Google 이벤트 */
function isGoogleEventId(id) { return typeof id === 'string' && id.startsWith('g:'); }
function extractGoogleId(id) { return id.slice(2); }

/** Google Calendar 이벤트 → 폼 값 */
function googleEventToForm(ev, titleMeta = {}) {
  const start = ev.start || {};
  const end = ev.end || {};
  const allDay = !!start.date && !start.dateTime;
  const displayTitle = googleEventDisplayTitle(ev, titleMeta) || '';

  if (allDay) {
    const startDate = start.date || todayStr();
    let endDate = end.date || startDate;
    if (endDate > startDate) {
      endDate = ymdMinusOneDay(endDate);
    } else {
      endDate = startDate;
    }
    return { title: displayTitle, description: ev.description || '', color: '', allDay: true, startDate, startTime: defaultTime(), endDate, endTime: '10:00', visibility: 'private', participants: [], relatedCustomerCompany: null, relatedContactPerson: null };
  }

  const startDt = start.dateTime ? new Date(start.dateTime) : new Date();
  const endDt = end.dateTime ? new Date(end.dateTime) : new Date(startDt.getTime() + 3600000);
  return { title: displayTitle, description: ev.description || '', color: '', allDay: false, startDate: startDt.toISOString().slice(0, 10), startTime: startDt.toTimeString().slice(0, 5), endDate: endDt.toISOString().slice(0, 10), endTime: endDt.toTimeString().slice(0, 5), visibility: 'private', participants: [], relatedCustomerCompany: null, relatedContactPerson: null };
}

/** CRM 이벤트 → 폼 값 */
function crmEventToForm(ev) {
  const startDate = ev.start ? new Date(ev.start) : new Date();
  const endDate = ev.end ? new Date(ev.end) : new Date(startDate.getTime() + 3600000);

  const relatedCustomerCompany = ev.relatedCustomerCompanyId
    ? {
        _id: String(ev.relatedCustomerCompanyId),
        name: ev.relatedCustomerCompanyName || '',
        address: ev.relatedCustomerCompanyAddress || ''
      }
    : null;

  const relatedContactPerson = ev.relatedCustomerCompanyEmployeeId
    ? {
        _id: String(ev.relatedCustomerCompanyEmployeeId),
        name: ev.relatedContactName || '',
        phone: ev.relatedContactPhone || '',
        email: ev.relatedContactEmail || '',
        companyName: ev.relatedContactCompanyName || '',
        companyAddress: ev.relatedContactCompanyAddress || ''
      }
    : null;

  if (ev.allDay) {
    const startYmd = formatDateInSeoulYmd(startDate);
    const endExclusiveYmd = formatDateInSeoulYmd(endDate);
    const endInclusiveYmd = crmAllDayInclusiveEndYmd(startYmd, endExclusiveYmd);
    return {
      title: ev.title || '',
      description: ev.description || '',
      color: ev.color || '',
      allDay: true,
      startDate: startYmd,
      startTime: defaultTime(),
      endDate: endInclusiveYmd,
      endTime: '10:00',
      visibility: ev.visibility || 'company',
      participants: ev.participants || [],
      relatedCustomerCompany,
      relatedContactPerson
    };
  }

  return {
    title: ev.title || '',
    description: ev.description || '',
    color: ev.color || '',
    allDay: false,
    startDate: startDate.toISOString().slice(0, 10),
    startTime: startDate.toTimeString().slice(0, 5),
    endDate: endDate.toISOString().slice(0, 10),
    endTime: endDate.toTimeString().slice(0, 5),
    visibility: ev.visibility || 'company',
    participants: ev.participants || [],
    relatedCustomerCompany,
    relatedContactPerson
  };
}

/** 폼 → CRM API body */
function formToCrmBody(form) {
  const title = (form.title || '').trim() || '(제목 없음)';
  const descriptionRaw = ensureAllRelatedVisitDescriptions(
    form.description || '',
    form.relatedCustomerCompany || null,
    form.relatedContactPerson || null
  );
  const description = descriptionRaw.trim() || undefined;
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
  return {
    title,
    description,
    color,
    start,
    end,
    allDay: !!form.allDay,
    visibility: form.visibility || 'company',
    participants: form.participants || [],
    relatedCustomerCompanyId: form.relatedCustomerCompany?._id || null,
    relatedCustomerCompanyEmployeeId: form.relatedContactPerson?._id || null
  };
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
    const ey = endExclusive.getFullYear();
    const em = String(endExclusive.getMonth() + 1).padStart(2, '0');
    const ed = String(endExclusive.getDate()).padStart(2, '0');
    return { summary, description, start: { date: startDate }, end: { date: `${ey}-${em}-${ed}` } };
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
    const sStr = formatDateInSeoulYmd(s);
    if (!e || Number.isNaN(e.getTime())) return sStr;
    const lastIncl = crmAllDayInclusiveEndYmd(sStr, formatDateInSeoulYmd(e));
    if (lastIncl <= sStr) return sStr;
    return `${sStr} ~ ${lastIncl}`;
  }
  const opts = { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return s.toLocaleString('ko-KR', opts) + (e ? ' ~ ' + e.toLocaleString('ko-KR', opts) : '');
}

function googleCalendarQuery(calendarId) {
  if (!calendarId) return '';
  return `?calendarId=${encodeURIComponent(calendarId)}`;
}

export default function EventModal({ eventId, isEdit, initialDate, calendarType, onClose, onSaved, onDeleted, currentUser, googleCalendarId, googleCalendarAccessRole }) {
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
    visibility: 'company', participants: [],
    relatedCustomerCompany: null,
    relatedContactPerson: null
  }));
  const [loading, setLoading] = useState(!isAdd);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [teamMembers, setTeamMembers] = useState([]);
  const [showParticipantModal, setShowParticipantModal] = useState(false);
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);
  const [companySearch, setCompanySearch] = useState('');
  const [companySearchResults, setCompanySearchResults] = useState([]);
  const [companySearchLoading, setCompanySearchLoading] = useState(false);
  const [showEmployeePicker, setShowEmployeePicker] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeeSearchResults, setEmployeeSearchResults] = useState([]);
  const [employeeSearchLoading, setEmployeeSearchLoading] = useState(false);

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
      .then((data) => {
        if (cancelled || !data.members) return;
        setTeamMembers(data.members);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isAdd, isGoogle]);

  const teamMemberById = useMemo(() => {
    const map = new Map();
    teamMembers.forEach((m) => map.set(String(m._id), m));
    return map;
  }, [teamMembers]);

  const participantDeptLabel = useCallback(
    (userId) => {
      const m = teamMemberById.get(String(userId));
      return m?.departmentDisplay || '';
    },
    [teamMemberById]
  );

  const fetchEvent = useCallback(async () => {
    if (isAdd) return;
    setLoading(true);
    setError('');
    try {
      const url = isGoogle
        ? `${API_BASE}/google-calendar/events/${encodeURIComponent(realId)}${googleCalendarQuery(googleCalendarId)}`
        : `${API_BASE}/calendar-events/${encodeURIComponent(realId)}`;
      const res = await fetch(url, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '일정을 불러올 수 없습니다.');
        setEvent(null);
        return;
      }
      setEvent(data);
      const gTitleMeta = { accessRole: googleCalendarAccessRole || '' };
      setForm(isGoogle ? googleEventToForm(data, gTitleMeta) : crmEventToForm(data));
    } catch (_) {
      setError('일정을 불러올 수 없습니다.');
      setEvent(null);
    } finally {
      setLoading(false);
    }
  }, [isAdd, isGoogle, realId, googleCalendarId, googleCalendarAccessRole]);

  useEffect(() => { fetchEvent(); }, [fetchEvent]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showEmployeePicker) setShowEmployeePicker(false);
      else if (showCompanyPicker) setShowCompanyPicker(false);
      else if (showParticipantModal) setShowParticipantModal(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showParticipantModal, showCompanyPicker, showEmployeePicker]);

  useEffect(() => {
    if (!showCompanyPicker) return undefined;
    const q = companySearch.trim();
    if (q.length < 1) {
      setCompanySearchResults([]);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      setCompanySearchLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/customer-companies?search=${encodeURIComponent(q)}&limit=40`,
          { headers: getAuthHeader() }
        );
        const data = await res.json().catch(() => ({}));
        setCompanySearchResults(res.ok && Array.isArray(data.items) ? data.items : []);
      } catch {
        setCompanySearchResults([]);
      } finally {
        setCompanySearchLoading(false);
      }
    }, 320);
    return () => window.clearTimeout(timer);
  }, [showCompanyPicker, companySearch]);

  useEffect(() => {
    if (!showEmployeePicker) return undefined;
    const q = employeeSearch.trim();
    if (q.length < 1) {
      setEmployeeSearchResults([]);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      setEmployeeSearchLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/customer-company-employees?search=${encodeURIComponent(q)}&limit=40`,
          { headers: getAuthHeader() }
        );
        const data = await res.json().catch(() => ({}));
        setEmployeeSearchResults(res.ok && Array.isArray(data.items) ? data.items : []);
      } catch {
        setEmployeeSearchResults([]);
      } finally {
        setEmployeeSearchLoading(false);
      }
    }, 320);
    return () => window.clearTimeout(timer);
  }, [showEmployeePicker, employeeSearch]);

  const pickRelatedCompany = useCallback((row) => {
    if (!row?._id) return;
    const rel = { _id: String(row._id), name: row.name || '', address: row.address || '' };
    setForm((prev) => ({
      ...prev,
      relatedCustomerCompany: rel,
      description: ensureAllRelatedVisitDescriptions(prev.description, rel, prev.relatedContactPerson || null)
    }));
    setShowCompanyPicker(false);
    setError('');
  }, []);

  const removeRelatedCompany = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      relatedCustomerCompany: null,
      description: ensureAllRelatedVisitDescriptions(
        stripRelatedCompanyDescriptionBlock(prev.description),
        null,
        prev.relatedContactPerson || null
      )
    }));
  }, []);

  const openCompanyPicker = useCallback(() => {
    setCompanySearch('');
    setCompanySearchResults([]);
    setShowCompanyPicker(true);
  }, []);

  const buildRelatedContactFromEmployeeRow = useCallback((row) => {
    if (!row?._id) return null;
    const cc = row.customerCompanyId && typeof row.customerCompanyId === 'object' ? row.customerCompanyId : null;
    const hasRegisteredCc = !!(cc && cc._id);
    return {
      _id: String(row._id),
      name: row.name || '',
      phone: row.phone || '',
      email: row.email || '',
      companyName: hasRegisteredCc ? (cc.name || '').trim() : '',
      companyAddress: hasRegisteredCc ? (cc.address || '').trim() : ''
    };
  }, []);

  const pickRelatedContact = useCallback((row) => {
    const rel = buildRelatedContactFromEmployeeRow(row);
    if (!rel) return;
    /** 직원의 customerCompanyId → CRM 고객사(CustomerCompany) 문서. companyId는 테넌트(소속 회사)용이라 매칭에 쓰지 않음. */
    const ccPopulated = row.customerCompanyId && typeof row.customerCompanyId === 'object' && row.customerCompanyId._id != null
      ? row.customerCompanyId
      : null;
    const relatedCompanyFromEmployee = ccPopulated
      ? {
          _id: String(ccPopulated._id),
          name: (ccPopulated.name || '').trim(),
          address: (ccPopulated.address || '').trim()
        }
      : null;

    setForm((prev) => {
      const nextRelatedCompany = relatedCompanyFromEmployee || prev.relatedCustomerCompany || null;
      return {
        ...prev,
        relatedContactPerson: rel,
        relatedCustomerCompany: nextRelatedCompany,
        description: ensureAllRelatedVisitDescriptions(prev.description, nextRelatedCompany, rel)
      };
    });
    setShowEmployeePicker(false);
    setError('');
  }, [buildRelatedContactFromEmployeeRow]);

  const removeRelatedContact = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      relatedContactPerson: null,
      description: ensureAllRelatedVisitDescriptions(
        stripRelatedContactDescriptionBlock(prev.description),
        prev.relatedCustomerCompany || null,
        null
      )
    }));
  }, []);

  const openEmployeePicker = useCallback(() => {
    setEmployeeSearch('');
    setEmployeeSearchResults([]);
    setShowEmployeePicker(true);
  }, []);

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
        const res = await fetch(
          `${API_BASE}/google-calendar/events/${encodeURIComponent(realId)}${googleCalendarQuery(googleCalendarId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify(body)
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError(data.error || '일정 수정에 실패했습니다.'); return; }
        setEvent(data);
        setMode('view');
        setForm(googleEventToForm(data, { accessRole: googleCalendarAccessRole || '' }));
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
        ? `${API_BASE}/google-calendar/events/${encodeURIComponent(realId)}${googleCalendarQuery(googleCalendarId)}`
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
  const gCalTitleMeta = { accessRole: googleCalendarAccessRole || '' };
  const eventTitle = isGoogle
    ? (googleEventDisplayTitle(event, gCalTitleMeta) || '(제목 없음)')
    : (event?.title || '(제목 없음)');
  const eventDesc = event?.description || '';

  return (
    <div className="event-modal-overlay">
      <div className="event-modal" onClick={(e) => e.stopPropagation()}>
        <div className="event-modal-header">
          <h3>
            {modalTitle}
            {!isAdd && (
              <>
                {(modalTitle || '').trim() ? ' _ ' : null}
                {isGoogle ? (
                  <span className="event-modal-source-badge google">Google</span>
                ) : (
                  <span className="event-modal-source-badge crm">회사</span>
                )}
              </>
            )}
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
                    {event.participants.map((p) => {
                      const dept = participantDeptLabel(p.userId);
                      return (
                        <span key={p.userId} className="event-modal-participant-chip">
                          {p.name || '(이름 없음)'}
                          {dept ? <span className="event-modal-participant-dept"> · {dept}</span> : null}
                        </span>
                      );
                    })}
                  </dd>
                </>
              )}
              {!isGoogle && event.relatedCustomerCompanyId && (
                <>
                  <dt>관련 고객사</dt>
                  <dd>
                    <span className="event-modal-related-company-view-name">{event.relatedCustomerCompanyName || '고객사'}</span>
                    {event.relatedCustomerCompanyAddress ? (
                      <span className="event-modal-related-company-view-addr"> · {event.relatedCustomerCompanyAddress}</span>
                    ) : null}
                  </dd>
                </>
              )}
              {!isGoogle && event.relatedCustomerCompanyEmployeeId && (
                <>
                  <dt>관련 연락처</dt>
                  <dd className="event-modal-related-contact-view">
                    <div><strong>{event.relatedContactName || '—'}</strong></div>
                    <div className="event-modal-related-contact-view-line">연락처: {event.relatedContactPhone || '—'}</div>
                    <div className="event-modal-related-contact-view-line">이메일: {event.relatedContactEmail || '—'}</div>
                    {(event.relatedContactCompanyName || '').trim() ? (
                      <>
                        <div className="event-modal-related-contact-view-line">고객사: {event.relatedContactCompanyName}</div>
                        <div className="event-modal-related-contact-view-line">주소: {(event.relatedContactCompanyAddress || '').trim() || '주소 미등록'}</div>
                      </>
                    ) : null}
                  </dd>
                </>
              )}
              {eventDesc && (
                <>
                  <dt>설명</dt>
                  <dd className="event-modal-desc">{renderDescriptionWithLinks(eventDesc)}</dd>
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
          <form onSubmit={handleSubmit} className="event-modal-body event-modal-form-modern">
            {error && <p className="event-modal-error">{error}</p>}
            <div className="event-modal-modern-hero">
              <h1>{isAdd ? '새로운 일정 만들기' : '일정 수정하기'}</h1>
              <p>비즈니스 성공을 위한 다음 단계를 계획하세요. 세부 사항을 입력하고 팀원들과 공유할 수 있습니다.</p>
            </div>

            <div className="event-modal-modern-grid">
              <div className="event-modal-modern-left">
                <section className="event-modal-modern-card">
                  <div className="event-modal-field">
                    <label htmlFor="event-title">일정 제목 <span className="required">*</span></label>
                    {!isGoogle ? (
                      <div className="event-modal-title-wrap">
                        <span className="event-modal-title-prefix">[{currentUser?.name || '이름'}]_</span>
                        <input id="event-title" name="title" type="text" value={form.title} onChange={handleChange} placeholder="예: 전략 기획 회의" required />
                      </div>
                    ) : (
                      <input id="event-title" name="title" type="text" value={form.title} onChange={handleChange} placeholder="예: 전략 기획 회의" required />
                    )}
                  </div>

                  {!isGoogle && (
                    <div className="event-modal-field">
                      <label>색상 라벨</label>
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
                </section>

                <section className="event-modal-modern-card">
                  <div className="event-modal-modern-card-head">
                    <h3>시간 및 일정</h3>
                    <label className="event-modal-checkbox">
                      <span>종일 여부</span>
                      <input type="checkbox" name="allDay" checked={form.allDay} onChange={handleChange} />
                    </label>
                  </div>
                  {form.allDay ? (
                    <div className="event-modal-row">
                      <div className="event-modal-field"><label>시작일</label><input type="date" name="startDate" value={form.startDate} onChange={handleChange} /></div>
                      <div className="event-modal-field"><label>종료일</label><input type="date" name="endDate" value={form.endDate} onChange={handleChange} min={form.startDate} /></div>
                    </div>
                  ) : (
                    <>
                      <div className="event-modal-field"><label>시작 일시</label><div className="event-modal-row"><input type="date" name="startDate" value={form.startDate} onChange={handleChange} /><input type="time" name="startTime" value={form.startTime} onChange={handleChange} /></div></div>
                      <div className="event-modal-field"><label>종료 일시</label><div className="event-modal-row"><input type="date" name="endDate" value={form.endDate || form.startDate} onChange={handleChange} min={form.startDate} /><input type="time" name="endTime" value={form.endTime} onChange={handleChange} /></div></div>
                    </>
                  )}
                </section>

                <section className="event-modal-modern-card">
                  <div className="event-modal-field">
                    <label htmlFor="event-description">상세 설명</label>
                    <textarea id="event-description" name="description" value={form.description} onChange={handleChange} placeholder="회의 아젠다 또는 필요한 준비물을 입력하세요..." rows={5} />
                  </div>
                </section>
              </div>

              <div className="event-modal-modern-right">
                {!isGoogle && (
                  <section className="event-modal-modern-card">
                    <h3 className="event-modal-modern-side-title"><span className="material-symbols-outlined">visibility</span>공개범위 설정</h3>
                    <div className="event-modal-vis-options event-modal-vis-options-vertical">
                      {VISIBILITY_OPTIONS.map((opt) => (
                        <button key={opt.value} type="button" className={`event-modal-vis-option ${form.visibility === opt.value ? 'active' : ''}`} onClick={() => setForm((p) => ({ ...p, visibility: opt.value }))}>
                          <span className="event-modal-vis-option-main">
                            <span className="event-modal-vis-label">{opt.label}</span>
                            <span className="event-modal-vis-sub">{opt.desc}</span>
                          </span>
                          <span className="material-symbols-outlined">{opt.icon}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {!isGoogle && (
                  <section className="event-modal-modern-card">
                    <h3 className="event-modal-modern-side-title"><span className="material-symbols-outlined">hub</span>고객사 및 연락처</h3>

                    {form.visibility === 'team' && (
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
                            {form.participants.map((p) => {
                              const dept = participantDeptLabel(p.userId);
                              return (
                                <span key={p.userId} className="event-modal-participant-chip removable">
                                  <span className="event-modal-participant-chip-label">
                                    {p.name || '(이름 없음)'}
                                    {dept ? <span className="event-modal-participant-dept"> · {dept}</span> : null}
                                  </span>
                                  <button
                                    type="button"
                                    className="event-modal-participant-chip-remove"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setForm((prev) => ({ ...prev, participants: prev.participants.filter((x) => x.userId !== p.userId) }));
                                    }}
                                    aria-label={`${p.name || '참여자'} 제거`}
                                  >
                                    ✕
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="event-modal-field">
                      <label>관련 고객사</label>
                      <button type="button" className="event-modal-btn event-modal-company-trigger" onClick={openCompanyPicker}>
                        <span className="material-symbols-outlined">storefront</span>
                        {form.relatedCustomerCompany ? '고객사 변경' : '고객사 선택'}
                      </button>
                      {form.relatedCustomerCompany ? (
                        <div className="event-modal-related-company-chip">
                          <span className="event-modal-related-company-chip-main">
                            {form.relatedCustomerCompany.name || '고객사'}
                            {(form.relatedCustomerCompany.address || '').trim() ? (
                              <span className="event-modal-related-company-chip-addr"> · {form.relatedCustomerCompany.address}</span>
                            ) : null}
                          </span>
                          <button type="button" className="event-modal-related-company-remove" onClick={removeRelatedCompany} aria-label="고객사 연결 제거">
                            ✕
                          </button>
                        </div>
                      ) : null}
                      <p className="event-modal-related-company-hint">선택하면 설명 맨 아래에 방문 안내(고객사명·장소)가 자동으로 붙고, 제거 시 해당 구간만 삭제됩니다.</p>
                    </div>

                    <div className="event-modal-field">
                      <label>관련 연락처 (고객사 회원)</label>
                      <button type="button" className="event-modal-btn event-modal-company-trigger" onClick={openEmployeePicker}>
                        <span className="material-symbols-outlined">person_search</span>
                        {form.relatedContactPerson ? '연락처 변경' : '연락처 선택'}
                      </button>
                      {form.relatedContactPerson ? (
                        <div className="event-modal-related-company-chip event-modal-related-contact-chip">
                          <span className="event-modal-related-company-chip-main">
                            <span className="event-modal-related-contact-chip-name">{form.relatedContactPerson.name || '연락처'}</span>
                            <span className="event-modal-related-company-chip-addr"> · {form.relatedContactPerson.phone || '—'} · {form.relatedContactPerson.email || '—'}</span>
                            {(form.relatedContactPerson.companyName || '').trim() ? (
                              <span className="event-modal-related-contact-chip-company">
                                {' '}· {form.relatedContactPerson.companyName}
                                {(form.relatedContactPerson.companyAddress || '').trim() ? ` (${form.relatedContactPerson.companyAddress})` : ''}
                              </span>
                            ) : null}
                          </span>
                          <button type="button" className="event-modal-related-company-remove" onClick={removeRelatedContact} aria-label="연락처 연결 제거">
                            ✕
                          </button>
                        </div>
                      ) : null}
                      <p className="event-modal-related-company-hint">
                        등록 고객사 소속이면 고객사명·주소까지 설명에 포함되고, 미등록(개인)이면 이름·연락처·이메일만 붙습니다.
                      </p>
                    </div>
                  </section>
                )}

                <div className="event-modal-modern-actions">
                  <button type="submit" className="event-modal-btn event-modal-save" disabled={saving}>
                    {saving ? '저장 중…' : (isAdd ? '일정 저장하기' : '변경사항 저장')}
                  </button>
                  <button type="button" className="event-modal-btn event-modal-cancel" onClick={() => (eventId ? setMode('view') : onClose?.())}>취소</button>
                </div>
              </div>
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

      {showCompanyPicker ? (
        <div
          className="event-modal-company-picker-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="event-modal-company-picker-title"
          onClick={() => setShowCompanyPicker(false)}
        >
          <div className="event-modal-company-picker" onClick={(e) => e.stopPropagation()}>
            <div className="event-modal-company-picker-head">
              <h4 id="event-modal-company-picker-title">관련 고객사 선택</h4>
              <button type="button" className="event-modal-company-picker-close" onClick={() => setShowCompanyPicker(false)} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <input
              type="search"
              className="event-modal-company-picker-search"
              placeholder="고객사명·주소 검색…"
              value={companySearch}
              onChange={(e) => setCompanySearch(e.target.value)}
              autoFocus
              aria-label="고객사 검색"
            />
            <div className="event-modal-company-picker-list" role="listbox">
              {companySearchLoading ? <p className="event-modal-company-picker-msg">검색 중…</p> : null}
              {!companySearchLoading && companySearch.trim().length < 1 ? (
                <p className="event-modal-company-picker-msg">검색어를 입력하세요.</p>
              ) : null}
              {!companySearchLoading && companySearch.trim().length >= 1 && companySearchResults.length === 0 ? (
                <p className="event-modal-company-picker-msg">검색 결과가 없습니다.</p>
              ) : null}
              {companySearchResults.map((row) => (
                <button
                  key={String(row._id)}
                  type="button"
                  role="option"
                  className="event-modal-company-picker-item"
                  onClick={() => pickRelatedCompany(row)}
                >
                  <span className="event-modal-company-picker-item-name">{row.name || '—'}</span>
                  {row.address ? <span className="event-modal-company-picker-item-addr">{row.address}</span> : null}
                </button>
              ))}
            </div>
            <div className="event-modal-company-picker-footer">
              <button type="button" className="event-modal-btn event-modal-cancel" onClick={() => setShowCompanyPicker(false)}>
                취소
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showEmployeePicker ? (
        <div
          className="event-modal-company-picker-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="event-modal-employee-picker-title"
          onClick={() => setShowEmployeePicker(false)}
        >
          <div className="event-modal-company-picker" onClick={(e) => e.stopPropagation()}>
            <div className="event-modal-company-picker-head">
              <h4 id="event-modal-employee-picker-title">관련 연락처 선택</h4>
              <button type="button" className="event-modal-company-picker-close" onClick={() => setShowEmployeePicker(false)} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <input
              type="search"
              className="event-modal-company-picker-search"
              placeholder="이름·회사·이메일·전화 검색…"
              value={employeeSearch}
              onChange={(e) => setEmployeeSearch(e.target.value)}
              autoFocus
              aria-label="연락처 검색"
            />
            <div className="event-modal-company-picker-list" role="listbox">
              {employeeSearchLoading ? <p className="event-modal-company-picker-msg">검색 중…</p> : null}
              {!employeeSearchLoading && employeeSearch.trim().length < 1 ? (
                <p className="event-modal-company-picker-msg">검색어를 입력하세요.</p>
              ) : null}
              {!employeeSearchLoading && employeeSearch.trim().length >= 1 && employeeSearchResults.length === 0 ? (
                <p className="event-modal-company-picker-msg">검색 결과가 없습니다.</p>
              ) : null}
              {employeeSearchResults.map((row) => (
                <button
                  key={String(row._id)}
                  type="button"
                  role="option"
                  className="event-modal-company-picker-item"
                  onClick={() => pickRelatedContact(row)}
                >
                  <span className="event-modal-company-picker-item-name">{row.name || '—'}</span>
                  <span className="event-modal-company-picker-item-addr">
                    {[row.phone, row.email].filter(Boolean).join(' · ') || '—'}
                    {row.company ? ` · ${row.company}` : ''}
                  </span>
                </button>
              ))}
            </div>
            <div className="event-modal-company-picker-footer">
              <button type="button" className="event-modal-btn event-modal-cancel" onClick={() => setShowEmployeePicker(false)}>
                취소
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
