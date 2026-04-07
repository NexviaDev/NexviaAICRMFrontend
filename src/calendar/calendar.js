import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import EventModal from './event-modal/event-modal';
import DayEventsModal from './day-events-modal/day-events-modal';
import { googleEventDisplayTitle } from './google-event-display-title';
import './calendar.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import { API_BASE } from '@/config';
import {
  formatDateInSeoulYmd,
  ymdAddOneDay,
  crmAllDayInclusiveEndYmd
} from './calendar-date-utils';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MODAL_PARAM = 'modal';
const EVENT_ID_PARAM = 'eventId';
const EDIT_PARAM = 'edit';
const DATE_PARAM = 'date';
const MODAL_EVENT = 'event';
const MODAL_DAY_LIST = 'day-list';
/** Google 일정 상세 API에 calendarId 전달 (primary 외 캘린더) */
const GC_PARAM = 'gc';
const GOOGLE_CALENDAR_IDS_STORAGE_KEY = 'nexvia_google_calendar_visible_ids';

function pickTextOnCalendarColor(hex) {
  if (!hex || typeof hex !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return '#1e293b';
  const h = hex.slice(1);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.62 ? '#1e293b' : '#fff';
}

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getMonthRange(year, month) {
  const timeMin = new Date(year, month, 1, 0, 0, 0, 0);
  const timeMax = new Date(year, month + 1, 0, 23, 59, 59, 999);
  return { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() };
}

/** Google Calendar 이벤트 → 통합 형식으로 변환 (@param meta.calendarId, meta.accessRole — calendarList) */
function normalizeGoogleEvent(gev, currentUserId, meta = {}) {
  const start = gev.start || {};
  const end = gev.end || {};
  const allDay = !!start.date && !start.dateTime;
  const calendarId = meta.calendarId || 'primary';
  const calendarName = meta.calendarSummary || calendarId;
  const bg = (meta.backgroundColor || '').trim();
  const titleMeta = { accessRole: meta.accessRole || '' };
  return {
    _id: `g:${gev.id}`,
    _source: 'google',
    title: googleEventDisplayTitle(gev, titleMeta) || '(제목 없음)',
    start: start.dateTime || (start.date ? start.date + 'T00:00:00' : null),
    end: end.dateTime || (end.date ? end.date + 'T00:00:00' : null),
    allDay,
    description: gev.description || '',
    color: bg,
    visibility: 'private',
    creatorName: '',
    userId: currentUserId || '',
    participants: [],
    googleEventId: gev.id,
    googleCalendarId: calendarId,
    calendarName
  };
}

function getEventDaysInMonth(event, year, month) {
  if (!event.start) return [];

  /** CRM 종일: 브라우저 로컬 날짜로 빼면 시작·끝 순서가 뒤집혀 칸이 비는 경우가 있어 서울 달력으로 집계 */
  if (event.allDay && event._source === 'crm') {
    const startYmd = formatDateInSeoulYmd(new Date(event.start));
    const endExclusiveYmd = formatDateInSeoulYmd(new Date(event.end || event.start));
    const endInclusiveYmd = crmAllDayInclusiveEndYmd(startYmd, endExclusiveYmd);
    return getCrmAllDayDaysInMonthRange(startYmd, endInclusiveYmd, year, month);
  }

  /**
   * CRM 시간 지정(회사 일정): 백엔드가 Asia/Seoul 슬롯으로 저장하므로 격자도 서울 날짜 기준.
   * 브라우저 로컬만 쓰면 해외/UTC 환경에서 해당 월 그리드에서 사라지거나 날짜가 하루 어긋남.
   */
  if (event._source === 'crm' && !event.allDay) {
    const s = new Date(event.start);
    if (Number.isNaN(s.getTime())) return [];
    const startYmd = formatDateInSeoulYmd(s);
    const endYmd = formatDateInSeoulYmd(new Date(event.end || event.start));
    if (!startYmd) return [];
    const endInclusive = endYmd < startYmd ? startYmd : endYmd;
    return getCrmAllDayDaysInMonthRange(startYmd, endInclusive, year, month);
  }

  const startDate = new Date(event.start);
  let endDate = event.end ? new Date(event.end) : new Date(startDate);

  if (event.allDay && endDate > startDate) {
    endDate = new Date(endDate);
    endDate.setDate(endDate.getDate() - 1);
  }

  /** monthEnd = 마지막 날 00:00만 쓰면 같은 날 오전 일정이 start > monthEnd로 잘못 걸러짐 → 다음 달 1일 0시로 상한 비교 */
  const monthStart = new Date(year, month, 1, 0, 0, 0, 0);
  const nextMonthStart = new Date(year, month + 1, 1, 0, 0, 0, 0);
  if (endDate < monthStart || startDate >= nextMonthStart) return [];

  const monthLastDayEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const from = startDate < monthStart ? new Date(monthStart) : new Date(startDate);
  const to = endDate > monthLastDayEnd ? new Date(monthLastDayEnd) : new Date(endDate);
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);

  const days = [];
  const d = new Date(from);
  while (d <= to) {
    if (d.getFullYear() === year && d.getMonth() === month) days.push(d.getDate());
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function getCrmAllDayDaysInMonthRange(startYmd, endInclusiveYmd, year, month) {
  if (!startYmd || !endInclusiveYmd) return [];
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const days = [];
  let cur = startYmd;
  const end = endInclusiveYmd < startYmd ? startYmd : endInclusiveYmd;
  if (cur > end) return [];
  while (cur <= end) {
    if (cur.startsWith(monthPrefix)) {
      days.push(parseInt(cur.slice(monthPrefix.length), 10));
    }
    if (cur >= end) break;
    cur = ymdAddOneDay(cur);
  }
  return days;
}

function getEventSegmentsByWeek(days, startPad) {
  if (days.length === 0) return [];
  const sorted = [...days].sort((a, b) => a - b);
  const getRow = (day) => Math.floor((startPad + day - 1) / 7);
  const segments = [];
  let seg = { firstDay: sorted[0], span: 1, row: getRow(sorted[0]) };
  for (let i = 1; i < sorted.length; i++) {
    const day = sorted[i];
    const row = getRow(day);
    if (row === seg.row && day === seg.firstDay + seg.span) {
      seg.span++;
    } else {
      segments.push({ firstDay: seg.firstDay, span: seg.span });
      seg = { firstDay: day, span: 1, row };
    }
  }
  segments.push({ firstDay: seg.firstDay, span: seg.span });
  return segments;
}

function isAllDayEvent(event) { return !!event?.allDay; }

function getEventStartTimeValue(event) {
  if (!event?.start) return Number.MAX_SAFE_INTEGER;
  const value = new Date(event.start).getTime();
  return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
}

function compareCalendarEvents(a, b) {
  const aAllDay = isAllDayEvent(a);
  const bAllDay = isAllDayEvent(b);
  if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;
  const startDiff = getEventStartTimeValue(a) - getEventStartTimeValue(b);
  if (startDiff !== 0) return startDiff;
  return (a.title || '').localeCompare(b.title || '', 'ko');
}

function compareEventsForDayList(a, b) {
  if (a.isMultiDay !== b.isMultiDay) return a.isMultiDay ? -1 : 1;
  return compareCalendarEvents(a.event, b.event);
}

/** API(JSON) → 그리드용 필드 정규화 */
function normalizeCrmEventFromApi(ev) {
  if (!ev || typeof ev !== 'object') return ev;
  const out = { ...ev };
  if (out.start != null && typeof out.start === 'object' && out.start.$date != null) {
    out.start = out.start.$date;
  }
  if (out.end != null && typeof out.end === 'object' && out.end.$date != null) {
    out.end = out.end.$date;
  }
  if (out._id != null) out._id = String(out._id);
  if (out.userId != null) out.userId = String(out.userId);
  return out;
}

const FILTER_OPTIONS = [
  { key: 'all', label: '회사 일정' },
  { key: 'mine', label: '개인 일정' }
];

const VIEW_OPTIONS = [
  { key: 'month', label: '월' },
  { key: 'day', label: '일' }
];

/** 해당 월의 day에 걸치는지 (getEventDaysInMonth 재사용) */
function eventTouchesCalendarDay(ev, year, month, day) {
  const days = getEventDaysInMonth(ev, year, month);
  return days.includes(day);
}

function formatDayViewTitle(year, month, day) {
  const d = new Date(year, month, day);
  if (Number.isNaN(d.getTime())) return '';
  const w = WEEKDAYS[d.getDay()];
  return `${year}년 ${month + 1}월 ${day}일 (${w})`;
}

function formatTimeRangeKo(ev) {
  if (!ev?.start) return '—';
  try {
    const s = new Date(ev.start);
    if (Number.isNaN(s.getTime())) return '—';
    if (ev.allDay) return '종일';
    const timeOpts = { hour: 'numeric', minute: '2-digit', hour12: true };
    const e = ev.end ? new Date(ev.end) : null;
    const st = s.toLocaleTimeString('ko-KR', timeOpts);
    if (e && !Number.isNaN(e.getTime())) {
      return `${st} – ${e.toLocaleTimeString('ko-KR', timeOpts)}`;
    }
    return st;
  } catch {
    return '—';
  }
}

/** Sample Design 톤 — 일정 칩 변주 (제목 해시) */
function eventPillClass(ev, index) {
  const t = (ev.title || '').toLowerCase();
  if (t.includes('urgent') || t.includes('긴급')) return 'calendar-event-pill--urgent';
  const h = String(ev._id || index).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const n = h % 4;
  if (n === 0) return 'calendar-event-pill--primary';
  if (n === 1) return 'calendar-event-pill--tertiary';
  if (n === 2) return 'calendar-event-pill--secondary';
  return 'calendar-event-pill--mint';
}

function formatEventListWhen(ev) {
  if (!ev?.start) return '—';
  try {
    const s = new Date(ev.start);
    const e = ev.end ? new Date(ev.end) : null;
    if (Number.isNaN(s.getTime())) return '—';
    const dOpts = { month: 'long', day: 'numeric', weekday: 'short' };
    if (ev.allDay) {
      return `${s.toLocaleDateString('ko-KR', dOpts)} (종일)`;
    }
    const timeOpts = { hour: 'numeric', minute: '2-digit', hour12: true };
    if (e && !Number.isNaN(e.getTime())) {
      return `${s.toLocaleDateString('ko-KR', dOpts)} ${s.toLocaleTimeString('ko-KR', timeOpts)} – ${e.toLocaleTimeString('ko-KR', timeOpts)}`;
    }
    return `${s.toLocaleDateString('ko-KR', dOpts)} ${s.toLocaleTimeString('ko-KR', timeOpts)}`;
  } catch {
    return '—';
  }
}

export default function Calendar({ embedded = false, hideBottomSection = false } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [current, setCurrent] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [crmEvents, setCrmEvents] = useState([]);
  const [googleEvents, setGoogleEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeFilter, setActiveFilter] = useState('all');
  const [viewMode, setViewMode] = useState('month');
  const [selectedDay, setSelectedDay] = useState(() => new Date().getDate());
  const [currentUser, setCurrentUser] = useState(null);
  const [googleCalendarList, setGoogleCalendarList] = useState([]);
  const [googleCalDropdownOpen, setGoogleCalDropdownOpen] = useState(false);
  const googleCalDropdownRef = useRef(null);
  const [selectedGoogleCalendarIds, setSelectedGoogleCalendarIds] = useState(() => {
    try {
      const raw = localStorage.getItem(GOOGLE_CALENDAR_IDS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch {
      /* ignore */
    }
    return ['primary'];
  });

  const isEventModalOpen = searchParams.get(MODAL_PARAM) === MODAL_EVENT;
  const isDayListModalOpen = searchParams.get(MODAL_PARAM) === MODAL_DAY_LIST;
  const modalEventId = searchParams.get(EVENT_ID_PARAM) || null;
  const modalEdit = searchParams.get(EDIT_PARAM) === '1';
  const modalDate = searchParams.get(DATE_PARAM) || null;
  const modalGoogleCalendarId = searchParams.get(GC_PARAM) || undefined;
  const googleCalendarAccessRole = useMemo(() => {
    if (!modalGoogleCalendarId || !googleCalendarList.length) return undefined;
    const cal = googleCalendarList.find((c) => c.id === modalGoogleCalendarId);
    return cal?.accessRole;
  }, [modalGoogleCalendarId, googleCalendarList]);

  const openAddEvent = () => {
    const next = new URLSearchParams(searchParams);
    next.set(MODAL_PARAM, MODAL_EVENT);
    next.delete(EVENT_ID_PARAM);
    next.delete(GC_PARAM);
    next.delete(EDIT_PARAM);
    setSearchParams(next, { replace: true });
  };
  const openAddEventOnDate = (year, month, day) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const next = new URLSearchParams(searchParams);
    next.set(MODAL_PARAM, MODAL_EVENT);
    next.set(DATE_PARAM, dateStr);
    next.delete(EVENT_ID_PARAM);
    next.delete(GC_PARAM);
    next.delete(EDIT_PARAM);
    setSearchParams(next, { replace: true });
  };
  const openEventDetail = (eventId, googleCalendarId) => {
    if (!eventId) return;
    const next = new URLSearchParams(searchParams);
    next.set(MODAL_PARAM, MODAL_EVENT);
    next.set(EVENT_ID_PARAM, eventId);
    next.delete(EDIT_PARAM);
    if (googleCalendarId && String(eventId).startsWith('g:')) {
      next.set(GC_PARAM, googleCalendarId);
    } else {
      next.delete(GC_PARAM);
    }
    setSearchParams(next, { replace: true });
  };
  const openDayList = (year, month, day) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const next = new URLSearchParams(searchParams);
    next.set(MODAL_PARAM, MODAL_DAY_LIST);
    next.set(DATE_PARAM, dateStr);
    next.delete(GC_PARAM);
    setSearchParams(next, { replace: true });
  };
  const closeEventModal = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    next.delete(EVENT_ID_PARAM);
    next.delete(EDIT_PARAM);
    next.delete(DATE_PARAM);
    next.delete(GC_PARAM);
    setSearchParams(next, { replace: true });
  };
  const refreshEvents = () => setRefreshKey((k) => k + 1);

  /** 세일즈 파이프라인 등 다른 화면에서 수주 후 캘린더 목록 갱신 */
  useEffect(() => {
    const onExternalRefresh = () => setRefreshKey((k) => k + 1);
    window.addEventListener('nexvia-crm-calendar-refresh', onExternalRefresh);
    return () => window.removeEventListener('nexvia-crm-calendar-refresh', onExternalRefresh);
  }, []);

  const firstDay = new Date(current.year, current.month, 1);
  const lastDay = new Date(current.year, current.month + 1, 0);
  const startPad = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const totalCells = Math.ceil((startPad + daysInMonth) / 7) * 7;
  const days = Array.from({ length: totalCells }, (_, i) => {
    const dayNum = i - startPad + 1;
    return dayNum < 1 || dayNum > daysInMonth ? null : dayNum;
  });
  const weeks = useMemo(() => {
    const rows = [];
    for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
    return rows;
  }, [days]);

  const { timeMin, timeMax } = useMemo(
    () => getMonthRange(current.year, current.month),
    [current.year, current.month]
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/auth/me`, { headers: getAuthHeader() })
      .then((r) => r.json())
      .then((data) => {
        const u = data.user || data;
        if (!cancelled && u?._id) setCurrentUser(u);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(GOOGLE_CALENDAR_IDS_STORAGE_KEY, JSON.stringify(selectedGoogleCalendarIds));
    } catch {
      /* 사생활 모드 등 */
    }
  }, [selectedGoogleCalendarIds]);

  useEffect(() => {
    if (activeFilter !== 'mine') setGoogleCalDropdownOpen(false);
  }, [activeFilter]);

  useEffect(() => {
    if (!googleCalDropdownOpen) return;
    const onDown = (e) => {
      if (googleCalDropdownRef.current && !googleCalDropdownRef.current.contains(e.target)) {
        setGoogleCalDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [googleCalDropdownOpen]);

  /** 개인 일정 탭: Google에 연결된 캘린더 목록(분류) — CalendarList API */
  useEffect(() => {
    if (activeFilter !== 'mine') return;
    let cancelled = false;
    fetch(`${API_BASE}/google-calendar/calendar-list`, { headers: getAuthHeader() })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error && !data.items) {
          return;
        }
        const items = Array.isArray(data.items) ? data.items : [];
        setGoogleCalendarList(items);
        setSelectedGoogleCalendarIds((prev) => {
          const knownIds = new Set(items.map((it) => it.id));
          const kept = prev.filter((id) => knownIds.has(id));
          if (kept.length > 0) return kept;
          const selectedByGoogle = items.filter((it) => it.selected !== false).map((it) => it.id);
          if (selectedByGoogle.length > 0) return selectedByGoogle;
          return ['primary'];
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeFilter]);

  /**
   * 회사 일정 탭: CRM(MongoDB)만 조회 (공개범위 적용)
   * 개인 일정 탭: 선택한 Google 캘린더별로 이벤트 조회 후 병합
   */
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);

    if (activeFilter === 'all') {
      const crmParams = new URLSearchParams({ start: timeMin, end: timeMax });
      fetch(`${API_BASE}/calendar-events?${crmParams}`, { headers: getAuthHeader() })
        .then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (cancelled) return;
          if (!r.ok) {
            setError(data.error || `회사 일정을 불러올 수 없습니다. (${r.status})`);
            setCrmEvents([]);
            return;
          }
          if (data.error && !data.items) {
            setError(data.error);
            setCrmEvents([]);
          } else {
            const raw = Array.isArray(data.items) ? data.items : [];
            setCrmEvents(raw.map(normalizeCrmEventFromApi));
          }
          setGoogleEvents([]);
        })
        .catch(() => { if (!cancelled) { setError('일정을 불러올 수 없습니다.'); setCrmEvents([]); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else {
      const ids = selectedGoogleCalendarIds.length > 0 ? selectedGoogleCalendarIds : ['primary'];
      const metaById = {};
      googleCalendarList.forEach((it) => {
        metaById[it.id] = {
          calendarSummary: it.summary || it.id,
          backgroundColor: (it.backgroundColor || '').trim(),
          accessRole: it.accessRole || ''
        };
      });

      Promise.all(
        ids.map((calId) => {
          const gParams = new URLSearchParams({ timeMin, timeMax, calendarId: calId });
          return fetch(`${API_BASE}/google-calendar/events?${gParams}`, { headers: getAuthHeader() }).then((r) => r.json());
        })
      )
        .then((results) => {
          if (cancelled) return;
          const userId = currentUser?._id || '';
          const merged = [];
          let authErr = null;
          let anyOk = false;
          results.forEach((data, idx) => {
            const calId = ids[idx];
            if (data.error && !data.items) {
              if (data.needsReauth) authErr = data;
              return;
            }
            anyOk = true;
            const meta = metaById[calId] || { calendarSummary: calId, backgroundColor: '', accessRole: '' };
            (data.items || [])
              .filter((gev) => gev && gev.id)
              .forEach((gev) => {
                merged.push(
                  normalizeGoogleEvent(gev, userId, {
                    calendarId: calId,
                    calendarSummary: meta.calendarSummary,
                    backgroundColor: meta.backgroundColor,
                    accessRole: meta.accessRole
                  })
                );
              });
          });
          if (!anyOk) {
            setError(authErr?.needsReauth ? 'Google 계정 연동이 필요합니다.' : (authErr?.error || 'Google 캘린더를 불러올 수 없습니다.'));
            setGoogleEvents([]);
            return;
          }
          merged.sort((a, b) => compareCalendarEvents(a, b));
          setGoogleEvents(merged);
          setCrmEvents([]);
        })
        .catch(() => {
          if (!cancelled) {
            setError('Google 캘린더를 불러올 수 없습니다.');
            setGoogleEvents([]);
          }
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    }

    return () => { cancelled = true; };
  }, [timeMin, timeMax, refreshKey, activeFilter, selectedGoogleCalendarIds, googleCalendarList, currentUser]);

  /** 회사 일정=CRM 이벤트, 개인 일정=이미 정규화된 Google 이벤트 배열 */
  const events = useMemo(() => {
    if (activeFilter === 'all') {
      return crmEvents.map((ev) => ({ ...ev, _source: 'crm' }));
    }
    return googleEvents;
  }, [crmEvents, googleEvents, activeFilter]);

  useEffect(() => {
    const dim = new Date(current.year, current.month + 1, 0).getDate();
    setSelectedDay((d) => Math.min(Math.max(1, d), dim));
  }, [current.year, current.month]);

  const eventsForSelectedDay = useMemo(
    () =>
      events
        .filter((ev) => eventTouchesCalendarDay(ev, current.year, current.month, selectedDay))
        .sort(compareCalendarEvents),
    [events, current.year, current.month, selectedDay]
  );

  const dayViewAllDay = useMemo(
    () => eventsForSelectedDay.filter((ev) => isAllDayEvent(ev)),
    [eventsForSelectedDay]
  );
  const dayViewTimed = useMemo(
    () => eventsForSelectedDay.filter((ev) => !isAllDayEvent(ev)),
    [eventsForSelectedDay]
  );

  const segmentsWithRow = useMemo(() => {
    const segments = [];
    events.forEach((ev) => {
      const evDays = getEventDaysInMonth(ev, current.year, current.month);
      if (evDays.length <= 1) return;
      getEventSegmentsByWeek(evDays, startPad).forEach(({ firstDay: fd, span }) => {
        const weekIndex = Math.floor((startPad + fd - 1) / 7);
        segments.push({ firstDay: fd, span, event: ev, weekIndex });
      });
    });
    const byWeek = {};
    segments.forEach((s) => {
      const w = s.weekIndex;
      if (!byWeek[w]) byWeek[w] = [];
      byWeek[w].push(s);
    });
    const rowEndByWeek = {};
    Object.keys(byWeek).forEach((w) => {
      const list = byWeek[w].sort((a, b) => {
        const fd = a.firstDay - b.firstDay;
        if (fd !== 0) return fd;
        const ed = compareCalendarEvents(a.event, b.event);
        if (ed !== 0) return ed;
        return b.span - a.span;
      });
      list.forEach((seg) => {
        const s = seg.firstDay;
        const e = seg.firstDay + seg.span - 1;
        let row = 0;
        while (true) {
          const lastEnd = rowEndByWeek[`${w}-${row}`] ?? -1;
          if (s > lastEnd) break;
          row++;
        }
        rowEndByWeek[`${w}-${row}`] = e;
        seg.rowIndex = row;
      });
    });
    return segments;
  }, [events, current.year, current.month, startPad]);

  const segmentsByWeek = useMemo(() => {
    const byWeek = {};
    segmentsWithRow.forEach((segment) => {
      if (!byWeek[segment.weekIndex]) byWeek[segment.weekIndex] = [];
      byWeek[segment.weekIndex].push(segment);
    });
    Object.keys(byWeek).forEach((week) => {
      byWeek[week].sort((a, b) => {
        const rowDiff = (a.rowIndex ?? 0) - (b.rowIndex ?? 0);
        if (rowDiff !== 0) return rowDiff;
        const firstDayDiff = a.firstDay - b.firstDay;
        if (firstDayDiff !== 0) return firstDayDiff;
        return compareCalendarEvents(a.event, b.event);
      });
    });
    return byWeek;
  }, [segmentsWithRow]);

  const eventsByDay = useMemo(() => {
    const map = {};
    events.forEach((ev) => {
      const evDays = getEventDaysInMonth(ev, current.year, current.month);
      if (evDays.length === 0) return;
      if (evDays.length === 1) {
        const d = evDays[0];
        if (!map[d]) map[d] = [];
        map[d].push({ event: ev });
      }
    });
    Object.keys(map).forEach((day) => {
      map[day].sort((a, b) => compareCalendarEvents(a.event, b.event));
    });
    return map;
  }, [events, current.year, current.month]);

  const allEventsByDay = useMemo(() => {
    const map = {};
    events.forEach((ev) => {
      const evDays = getEventDaysInMonth(ev, current.year, current.month);
      if (evDays.length === 0) return;
      const isMultiDay = evDays.length > 1;
      evDays.forEach((day) => {
        if (!map[day]) map[day] = [];
        map[day].push({ event: ev, isMultiDay });
      });
    });
    Object.keys(map).forEach((day) => {
      map[day].sort(compareEventsForDayList);
    });
    return map;
  }, [events, current.year, current.month]);

  const selectedDayEvents = useMemo(() => {
    if (!isDayListModalOpen || !modalDate) return [];
    const [, monthStr, dayStr] = modalDate.split('-');
    const modalMonth = Number(monthStr) - 1;
    const modalDay = Number(dayStr);
    if (Number.isNaN(modalMonth) || Number.isNaN(modalDay)) return [];
    if (modalMonth !== current.month) return [];
    return (allEventsByDay[modalDay] || []).map((entry) => entry.event);
  }, [isDayListModalOpen, modalDate, current.month, allEventsByDay]);

  const getEventStyle = useCallback((ev) => {
    if (ev.color) {
      return { background: ev.color, color: pickTextOnCalendarColor(ev.color) };
    }
    return undefined;
  }, []);

  const upcomingThisMonth = useMemo(() => {
    const monthStart = new Date(current.year, current.month, 1, 0, 0, 0, 0);
    const monthEnd = new Date(current.year, current.month + 1, 0, 23, 59, 59, 999);
    return events
      .filter((ev) => {
        if (!ev.start) return false;
        const t = new Date(ev.start).getTime();
        if (Number.isNaN(t)) return false;
        return t >= monthStart.getTime() && t <= monthEnd.getTime();
      })
      .sort((a, b) => getEventStartTimeValue(a) - getEventStartTimeValue(b))
      .slice(0, 5);
  }, [events, current.year, current.month]);

  const isMyEvent = useCallback((ev) => {
    if (ev._source === 'google') return true;
    if (!currentUser?._id) return false;
    return String(ev.userId || '') === String(currentUser._id);
  }, [currentUser]);

  const prevMonth = useCallback(() => {
    setCurrent((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { ...c, month: c.month - 1 }));
  }, []);
  const nextMonth = useCallback(() => {
    setCurrent((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { ...c, month: c.month + 1 }));
  }, []);

  const goPrevDay = useCallback(() => {
    const d = new Date(current.year, current.month, selectedDay);
    d.setDate(d.getDate() - 1);
    setCurrent({ year: d.getFullYear(), month: d.getMonth() });
    setSelectedDay(d.getDate());
  }, [current.year, current.month, selectedDay]);

  const goNextDay = useCallback(() => {
    const d = new Date(current.year, current.month, selectedDay);
    d.setDate(d.getDate() + 1);
    setCurrent({ year: d.getFullYear(), month: d.getMonth() });
    setSelectedDay(d.getDate());
  }, [current.year, current.month, selectedDay]);

  const monthTitle = `${current.year}년 ${current.month + 1}월`;
  const dayTitle = formatDayViewTitle(current.year, current.month, selectedDay);

  return (
    <div className={`page calendar-page${embedded ? ' calendar-page--embedded' : ''}`}>
      {!embedded && (
      <header className="page-header">
        <div className="header-search">
          <span className="material-symbols-outlined">search</span>
          <input type="text" placeholder="일정 검색..." />
        </div>
        <div className="header-actions">
          <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" />
        </div>
      </header>
      )}

      <div className={`page-content calendar-page-content${embedded ? ' calendar-page-content--embedded' : ''}`}>
        <div className="calendar-shell">
          <div className="calendar-hero">
            <div className="calendar-hero-main">
              <div className="calendar-title-block">
                <h1 className="calendar-month-headline">
                  {viewMode === 'day' ? dayTitle : monthTitle}
                </h1>
                <div className="calendar-round-nav">
                  <button
                    type="button"
                    className="calendar-round-nav-btn"
                    onClick={viewMode === 'day' ? goPrevDay : prevMonth}
                    aria-label={viewMode === 'day' ? '이전 날' : '이전 달'}
                  >
                    <span className="material-symbols-outlined">chevron_left</span>
                  </button>
                  <button
                    type="button"
                    className="calendar-round-nav-btn"
                    onClick={viewMode === 'day' ? goNextDay : nextMonth}
                    aria-label={viewMode === 'day' ? '다음 날' : '다음 달'}
                  >
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                </div>
              </div>
            </div>
            <div className="calendar-hero-aside">
              <div className="calendar-view-tabs" role="tablist" aria-label="보기 방식">
                {VIEW_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    role="tab"
                    aria-selected={viewMode === opt.key}
                    className={`calendar-view-tab ${viewMode === opt.key ? 'active' : ''}`}
                    onClick={() => setViewMode(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="calendar-filter-tabs" role="tablist" aria-label="일정 범위">
                {FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    role="tab"
                    aria-selected={activeFilter === opt.key}
                    className={`calendar-filter-tab ${activeFilter === opt.key ? 'active' : ''}`}
                    onClick={() => setActiveFilter(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {activeFilter === 'mine' && googleCalendarList.length > 0 && (
                <div
                  ref={googleCalDropdownRef}
                  className="calendar-google-cal-dropdown"
                >
                  <button
                    type="button"
                    className="calendar-google-cal-dropdown-trigger"
                    aria-expanded={googleCalDropdownOpen}
                    aria-haspopup="listbox"
                    aria-label="표시할 Google 캘린더 열기"
                    onClick={() => setGoogleCalDropdownOpen((o) => !o)}
                  >
                    <span className="calendar-google-cal-dropdown-trigger-text">Google 캘린더</span>
                    <span className="calendar-google-cal-dropdown-count">({selectedGoogleCalendarIds.length})</span>
                    <span
                      className={`material-symbols-outlined calendar-google-cal-dropdown-chevron ${googleCalDropdownOpen ? 'open' : ''}`}
                      aria-hidden
                    >
                      expand_more
                    </span>
                  </button>
                  {googleCalDropdownOpen && (
                    <div
                      className="calendar-google-cal-dropdown-panel"
                      role="listbox"
                      aria-label="표시할 Google 캘린더"
                    >
                      {googleCalendarList.map((cal) => (
                        <label key={cal.id} className="calendar-google-cal-pick-item">
                          <input
                            type="checkbox"
                            checked={selectedGoogleCalendarIds.includes(cal.id)}
                            onChange={() => {
                              setSelectedGoogleCalendarIds((prev) => {
                                const on = prev.includes(cal.id);
                                if (on) {
                                  if (prev.length <= 1) return prev;
                                  return prev.filter((x) => x !== cal.id);
                                }
                                return [...prev, cal.id];
                              });
                            }}
                          />
                          <span
                            className="calendar-google-cal-swatch"
                            style={{ background: cal.backgroundColor || '#cbd5e1' }}
                            aria-hidden
                          />
                          <span className="calendar-google-cal-name">{cal.summary || cal.id}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {error && <p className="calendar-google-hint" role="status">{error}</p>}

          <div className={`calendar-panel-card${embedded ? ' calendar-panel-card--embedded' : ''}`}>
            {viewMode === 'month' ? (
            <div className="calendar-grid">
            <div className="calendar-weekday-row">
              {WEEKDAYS.map((w) => (
                <div key={w} className="calendar-weekday">{w}</div>
              ))}
            </div>
            {weeks.map((weekDays, weekIndex) => {
              const weekSegments = segmentsByWeek[weekIndex] || [];
              const weekSegmentRows = weekSegments.reduce((max, seg) => Math.max(max, (seg.rowIndex ?? 0) + 1), 0);
              const weekSegmentPaddingRem = weekSegmentRows > 0 ? weekSegmentRows * 1.5 : 0;
              return (
                <div key={`week-${weekIndex}`} className="calendar-week-row">
                  <div className="calendar-week-days">
                    {weekDays.map((d, dayIndex) => {
                      const cellIndex = weekIndex * 7 + dayIndex;
                      const isToday = d != null && d === new Date().getDate() && current.month === new Date().getMonth() && current.year === new Date().getFullYear();
                      const isSunday = dayIndex === 0;
                      const isSaturday = dayIndex === 6;
                      const evs = (d != null && eventsByDay[d]) || [];
                      const totalDayEvents = (d != null && allEventsByDay[d]) || [];
                      return (
                        <div
                          key={cellIndex}
                          className={`calendar-day ${d == null ? 'empty' : ''} ${isToday ? 'today' : ''} ${isSunday ? 'sun' : ''} ${isSaturday ? 'sat' : ''}`}
                          onDoubleClick={() => d != null && openAddEventOnDate(current.year, current.month, d)}
                          title={d != null ? '날짜 클릭: 일별 보기 · 더블클릭: 일정 추가' : undefined}
                        >
                          {d != null && (
                            <span
                              className={`calendar-day-num ${isToday ? 'calendar-day-num--today' : ''}`}
                              role="button"
                              tabIndex={0}
                              title="일별 보기"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedDay(d);
                                setViewMode('day');
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setSelectedDay(d);
                                  setViewMode('day');
                                }
                              }}
                            >
                              {d}
                            </span>
                          )}
                          {d != null && (
                            <div className="calendar-day-body" style={weekSegmentRows > 0 ? { paddingTop: `${weekSegmentPaddingRem}rem` } : undefined}>
                              <ul className={`calendar-events ${weekSegmentRows > 0 ? 'has-segments' : ''}`}>
                                {evs.slice(0, 5).map((entry, evIdx) => {
                                  const ev = entry.event;
                                  const style = getEventStyle(ev);
                                  const isGoogle = ev._source === 'google';
                                  const pillClass = style ? '' : eventPillClass(ev, evIdx);
                                  return (
                                    <li
                                      key={`${ev.googleCalendarId || ''}-${ev._id}`}
                                      className={`calendar-event ${pillClass} ${isAllDayEvent(ev) ? 'all-day' : 'timed'} ${!isMyEvent(ev) ? 'other-user' : ''} ${isGoogle ? 'google-event' : ''}`}
                                      style={style}
                                      title={`${ev.title || '(제목 없음)'}${ev.calendarName ? ` — ${ev.calendarName}` : ''}${ev.creatorName ? ` — ${ev.creatorName}` : ''}${isGoogle ? '' : ''}`}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => openEventDetail(ev._id, ev.googleCalendarId)}
                                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEventDetail(ev._id, ev.googleCalendarId); } }}
                                    >
                                      {isGoogle && <span className="calendar-event-google-dot" />}
                                      {!isMyEvent(ev) && ev.creatorName && <span className="calendar-event-author">{ev.creatorName.charAt(0)}</span>}
                                      {ev.title || '(제목 없음)'}
                                    </li>
                                  );
                                })}
                                {evs.length > 5 && (
                                  <li className="calendar-more-item">
                                    <button type="button" className="calendar-more-btn" onClick={(e) => { e.stopPropagation(); openDayList(current.year, current.month, d); }}>
                                      +{evs.length - 5} 더 보기
                                    </button>
                                  </li>
                                )}
                                {evs.length <= 5 && totalDayEvents.length > evs.length && (
                                  <li className="calendar-more-item">
                                    <button type="button" className="calendar-more-btn" onClick={(e) => { e.stopPropagation(); openDayList(current.year, current.month, d); }}>
                                      전체 {totalDayEvents.length}개 보기
                                    </button>
                                  </li>
                                )}
                              </ul>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {weekSegmentRows > 0 && (
                    <div className="calendar-week-segments-overlay" style={{ gridTemplateRows: `repeat(${weekSegmentRows}, 1.5rem)` }} aria-hidden="true">
                      {weekSegments.map((seg) => {
                        const style = getEventStyle(seg.event);
                        const segPill = style ? '' : eventPillClass(seg.event, seg.rowIndex ?? 0);
                        const colStart = ((startPad + seg.firstDay - 1) % 7) + 1;
                        const isGoogle = seg.event._source === 'google';
                        return (
                          <div
                            key={`${seg.event.googleCalendarId || ''}-${seg.event._id}-${seg.firstDay}-${seg.rowIndex}`}
                            className={`calendar-segment-bar ${segPill} ${!isMyEvent(seg.event) ? 'other-user' : ''} ${isGoogle ? 'google-event' : ''}`}
                            style={{ gridColumn: `${colStart} / span ${seg.span}`, gridRow: (seg.rowIndex ?? 0) + 1, ...(style || {}) }}
                            title={`${seg.event.title || '(제목 없음)'}${seg.event.calendarName ? ` — ${seg.event.calendarName}` : ''}${seg.event.creatorName ? ` — ${seg.event.creatorName}` : ''}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => openEventDetail(seg.event._id, seg.event.googleCalendarId)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEventDetail(seg.event._id, seg.event.googleCalendarId); } }}
                          >
                            {seg.event.title || '(제목 없음)'}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
            ) : (
            <div className="calendar-day-view">
              <div className="calendar-day-view-toolbar">
                <button
                  type="button"
                  className="calendar-day-view-add-btn"
                  onClick={() => openAddEventOnDate(current.year, current.month, selectedDay)}
                >
                  <span className="material-symbols-outlined">add</span>
                  이 날짜에 일정 추가
                </button>
                <button
                  type="button"
                  className="calendar-day-view-secondary-btn"
                  onClick={() => openDayList(current.year, current.month, selectedDay)}
                >
                  하루 일정 목록
                </button>
              </div>
              {eventsForSelectedDay.length === 0 ? (
                <p className="calendar-day-view-empty">이 날짜에 표시할 일정이 없습니다.</p>
              ) : (
                <div className="calendar-day-view-body">
                  {dayViewAllDay.length > 0 && (
                    <section className="calendar-day-view-section" aria-labelledby="calendar-day-allday">
                      <h3 id="calendar-day-allday" className="calendar-day-view-section-title">
                        종일
                      </h3>
                      <ul className="calendar-day-view-list">
                        {dayViewAllDay.map((ev, evIdx) => {
                          const style = getEventStyle(ev);
                          const pillClass = style ? '' : eventPillClass(ev, evIdx);
                          const isGoogle = ev._source === 'google';
                          return (
                            <li key={`${ev.googleCalendarId || ''}-${ev._id}`}>
                              <button
                                type="button"
                                className={`calendar-day-view-card ${pillClass} ${isGoogle ? 'google-event' : ''}`}
                                style={style}
                                onClick={() => openEventDetail(ev._id, ev.googleCalendarId)}
                              >
                                {isGoogle && <span className="calendar-event-google-dot" aria-hidden />}
                                <span className="calendar-day-view-card-title">{ev.title || '(제목 없음)'}</span>
                                {ev.calendarName && (
                                  <span className="calendar-day-view-card-meta">{ev.calendarName}</span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  )}
                  {dayViewTimed.length > 0 && (
                    <section className="calendar-day-view-section" aria-labelledby="calendar-day-timed">
                      <h3 id="calendar-day-timed" className="calendar-day-view-section-title">
                        시간
                      </h3>
                      <ul className="calendar-day-view-list">
                        {dayViewTimed.map((ev, evIdx) => {
                          const style = getEventStyle(ev);
                          const pillClass = style ? '' : eventPillClass(ev, evIdx);
                          const isGoogle = ev._source === 'google';
                          return (
                            <li key={`${ev.googleCalendarId || ''}-${ev._id}`}>
                              <button
                                type="button"
                                className={`calendar-day-view-card calendar-day-view-card--timed ${pillClass} ${isGoogle ? 'google-event' : ''}`}
                                style={style}
                                onClick={() => openEventDetail(ev._id, ev.googleCalendarId)}
                              >
                                <span className="calendar-day-view-card-time">{formatTimeRangeKo(ev)}</span>
                                <span className="calendar-day-view-card-main">
                                  <span className="calendar-day-view-card-title">{ev.title || '(제목 없음)'}</span>
                                  {ev.calendarName && (
                                    <span className="calendar-day-view-card-meta">{ev.calendarName}</span>
                                  )}
                                </span>
                                {isGoogle && <span className="calendar-event-google-dot" aria-hidden />}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  )}
                </div>
              )}
            </div>
            )}
          </div>

          {!hideBottomSection && (
          <div className="calendar-bottom-grid">
            <section className="calendar-upcoming-panel" aria-labelledby="calendar-upcoming-title">
              <h2 id="calendar-upcoming-title" className="calendar-upcoming-title">
                이번 달 예정된 주요 일정
              </h2>
              {upcomingThisMonth.length === 0 ? (
                <p className="calendar-upcoming-empty">이번 달에 표시할 일정이 없습니다.</p>
              ) : (
                <ul className="calendar-upcoming-list">
                  {upcomingThisMonth.map((ev, i) => {
                    const icon = ev._source === 'google' ? 'event' : i % 2 === 0 ? 'event' : 'group';
                    const iconTone = i % 2 === 0 ? 'calendar-upcoming-icon--primary' : 'calendar-upcoming-icon--tertiary';
                    return (
                      <li key={`${ev.googleCalendarId || ''}-${ev._id}`} className="calendar-upcoming-row">
                        <div className={`calendar-upcoming-icon ${iconTone}`}>
                          <span className="material-symbols-outlined">{icon}</span>
                        </div>
                        <div className="calendar-upcoming-text">
                          <p className="calendar-upcoming-name">{ev.title || '(제목 없음)'}</p>
                          <p className="calendar-upcoming-meta">{formatEventListWhen(ev)}</p>
                        </div>
                        <button
                          type="button"
                          className="calendar-upcoming-link"
                          onClick={() => openEventDetail(ev._id, ev.googleCalendarId)}
                        >
                          상세보기
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <aside className="calendar-ai-panel" aria-label="안내">
              <span className="material-symbols-outlined calendar-ai-icon" aria-hidden>
                auto_awesome
              </span>
              <h3 className="calendar-ai-title">효율적인 일정 관리를 시작하세요.</h3>
              <p className="calendar-ai-desc">
                팀 캘린더에서 회사 일정과 개인 일정을 전환해 보세요. 일정은 더블클릭으로 빠르게 추가할 수 있습니다.
              </p>
              <button type="button" className="calendar-ai-cta" onClick={openAddEvent}>
                일정 추가하기
              </button>
            </aside>
          </div>
          )}
        </div>
      </div>

      {isEventModalOpen && (
        <EventModal
          eventId={modalEventId}
          isEdit={modalEdit}
          initialDate={modalDate}
          calendarType={activeFilter === 'mine' ? 'personal' : 'company'}
          googleCalendarId={modalGoogleCalendarId}
          googleCalendarAccessRole={googleCalendarAccessRole}
          onClose={closeEventModal}
          onSaved={refreshEvents}
          onDeleted={refreshEvents}
          currentUser={currentUser}
        />
      )}
      {isDayListModalOpen && (
        <DayEventsModal
          date={modalDate}
          events={selectedDayEvents}
          onClose={closeEventModal}
          onEventClick={openEventDetail}
          currentUser={currentUser}
        />
      )}
    </div>
  );
}
