import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession, getAuthHeader } from '@/lib/crm-auth';
import { useSearchParams } from 'react-router-dom';
import EventModal from './event-modal/event-modal';
import DayEventsModal from './day-events-modal/day-events-modal';
import { googleEventDisplayTitle } from './google-event-display-title';
import './calendar.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import { API_BASE } from '@/config';
import { getSavedCalendarViewMode, patchCalendarViewTemplate } from '@/lib/list-templates';
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

/** 헤더 아바타 플레이스홀더 (todo-list와 동일 톤) */
const HEADER_AVATAR_PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2394a3b8"%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/%3E%3C/svg%3E';

function pickTextOnCalendarColor(hex) {
  if (!hex || typeof hex !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return '#1e293b';
  const h = hex.slice(1);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.62 ? '#1e293b' : '#fff';
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

function dayEventSelectionKey(ev) {
  return `${ev._source || 'crm'}::${ev._id}::${ev.googleCalendarId || ''}`;
}

function googleCalendarDeleteQuery(calendarId) {
  if (!calendarId) return '';
  return `?calendarId=${encodeURIComponent(calendarId)}`;
}

function resolveCalendarEventDeleteTarget(ev) {
  const isGoogle = ev._source === 'google';
  const rawId = String(ev._id || '');
  const realId = isGoogle && rawId.startsWith('g:') ? rawId.slice(2) : rawId;
  return { isGoogle, realId };
}

const CALENDAR_BULK_DELETE_CHUNK = 300;

function chunkCalendarDeleteList(items, chunkSize) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const size = Math.max(1, chunkSize);
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function compareEventsForDayList(a, b) {
  if (a.isMultiDay !== b.isMultiDay) return a.isMultiDay ? -1 : 1;
  return compareCalendarEvents(a.event, b.event);
}

/**
 * CRM→Google 동기화된 일정은 Mongo + Google API 양쪽에서 잡혀 2개로 보이는 문제 방지.
 * googleSyncedMembers 매칭 우선, 동기화 직후엔 제목·시작 시각으로 보조 매칭.
 */
function buildCrmGoogleDedupIndex(crmEvents) {
  const syncedKeys = new Set();
  const titleTimeKeys = new Set();
  for (const ev of crmEvents || []) {
    const title = String(ev.title || '').trim();
    const startMs = ev.start ? new Date(ev.start).getTime() : NaN;
    if (title && Number.isFinite(startMs)) {
      titleTimeKeys.add(`${title}::${startMs}`);
    }
    const members = ev.googleSyncedMembers;
    if (!Array.isArray(members)) continue;
    for (const m of members) {
      const gId = String(m?.googleEventId || '').trim();
      const calId = String(m?.googleCalendarId || 'primary').trim() || 'primary';
      if (gId) syncedKeys.add(`${calId}::${gId}`);
    }
  }
  return { syncedKeys, titleTimeKeys };
}

function isGoogleEventDuplicateOfCrm(gev, dedupIndex) {
  if (!gev || !dedupIndex) return false;
  const calId = String(gev.googleCalendarId || 'primary').trim() || 'primary';
  const gId = String(gev.googleEventId || '').trim();
  if (gId && dedupIndex.syncedKeys.has(`${calId}::${gId}`)) return true;
  const title = String(gev.title || '').trim();
  const startMs = gev.start ? new Date(gev.start).getTime() : NaN;
  if (title && Number.isFinite(startMs) && dedupIndex.titleTimeKeys.has(`${title}::${startMs}`)) {
    return true;
  }
  return false;
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

const VIEW_OPTIONS = [
  { key: 'month', label: '월' },
  { key: 'week', label: '주' },
  { key: 'day', label: '일' }
];

/** 일정 추가 모달 URL — 기간·시간(캘린더 드래그) */
const DATE_END_PARAM = 'dateEnd';
const ADD_ALLDAY_PARAM = 'ad';
const ADD_TS_PARAM = 'ts';
const ADD_TE_PARAM = 'te';

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

function padCal2(n) {
  return String(n).padStart(2, '0');
}

/** 월간 그리드와 동일: 주는 일요일 시작 */
function sundayPartsOfLocalDate(year, month, day) {
  const dt = new Date(year, month, day);
  const dow = dt.getDay();
  dt.setDate(dt.getDate() - dow);
  return { y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() };
}

function formatWeekRangeTitle(sunParts) {
  const sat = new Date(sunParts.y, sunParts.m, sunParts.d + 6);
  const s1 = `${sunParts.y}년 ${sunParts.m + 1}월 ${sunParts.d}일`;
  if (sat.getFullYear() !== sunParts.y) {
    return `${s1} – ${sat.getFullYear()}년 ${sat.getMonth() + 1}월 ${sat.getDate()}일`;
  }
  if (sat.getMonth() !== sunParts.m) {
    return `${s1} – ${sat.getMonth() + 1}월 ${sat.getDate()}일`;
  }
  return `${s1} – ${sat.getDate()}일`;
}

function getWeekTimeBounds(sunParts) {
  const s = new Date(sunParts.y, sunParts.m, sunParts.d, 0, 0, 0, 0);
  const e = new Date(sunParts.y, sunParts.m, sunParts.d + 6, 23, 59, 59, 999);
  return { timeMin: s.toISOString(), timeMax: e.toISOString() };
}

function localDateFromWeekMinute(sunParts, weekMinute) {
  const totalDays = Math.floor(weekMinute / 1440);
  const rem = weekMinute % 1440;
  const h = Math.floor(rem / 60);
  const min = rem % 60;
  return new Date(sunParts.y, sunParts.m, sunParts.d + totalDays, h, min, 0, 0);
}

function getTimedSegmentForDay(ev, y, m, d) {
  if (!ev?.start || ev.allDay) return null;
  const s = new Date(ev.start);
  const e = ev.end ? new Date(ev.end) : new Date(s.getTime() + 3600000);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  const dayStart = new Date(y, m, d, 0, 0, 0, 0);
  const dayEnd = new Date(y, m, d, 23, 59, 59, 999);
  const segStart = Math.max(s.getTime(), dayStart.getTime());
  const segEnd = Math.min(e.getTime(), dayEnd.getTime());
  if (segEnd < segStart) return null;
  const startMins = (segStart - dayStart.getTime()) / 60000;
  const endMins = (segEnd - dayStart.getTime()) / 60000;
  return { startMins, endMins };
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
  const [viewMode, setViewMode] = useState(() => getSavedCalendarViewMode());
  const [selectedDay, setSelectedDay] = useState(() => new Date().getDate());
  /** 주간 보기: 해당 주 일요일 (로컬) */
  const [weekViewStart, setWeekViewStart] = useState(() =>
    sundayPartsOfLocalDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
  );
  /** 월간 그리드 드래그 선택 { startDay, endDay } — 날짜 번호만, 현재 달 */
  const [monthDragRange, setMonthDragRange] = useState(null);
  const monthDragActiveRef = useRef(false);
  /** 주간 시간 격자 드래그 — 주 시작 분 단위 */
  const [weekDragRange, setWeekDragRange] = useState(null);
  const weekDragActiveRef = useRef(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [googleCalendarList, setGoogleCalendarList] = useState([]);
  const [googleCalDropdownOpen, setGoogleCalDropdownOpen] = useState(false);
  const googleCalDropdownRef = useRef(null);
  const [isCompactMonth, setIsCompactMonth] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  );
  const [headerSearch, setHeaderSearch] = useState('');
  const [googleLinkStatus, setGoogleLinkStatus] = useState(null);
  const [naverLinkStatus, setNaverLinkStatus] = useState(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncBusy, setSyncBusy] = useState('');
  const [googleLoadHint, setGoogleLoadHint] = useState('');
  /** 일 보기: 체크박스 선택(Shift+클릭 범위 선택) */
  const [daySelectedKeys, setDaySelectedKeys] = useState(() => new Set());
  const dayLastSelectIndexRef = useRef(null);
  const [dayDeleteBusy, setDayDeleteBusy] = useState(false);
  /** 헤드라인 클릭 → 연·월·일 직접 이동 */
  const [headlineDateEdit, setHeadlineDateEdit] = useState(false);
  const [headlineEditYear, setHeadlineEditYear] = useState('');
  const [headlineEditMonth, setHeadlineEditMonth] = useState('');
  const [headlineEditDay, setHeadlineEditDay] = useState('');
  const headlineYearInputRef = useRef(null);
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
  const modalDateEnd = searchParams.get(DATE_END_PARAM) || null;
  const modalAddAllDay = searchParams.get(ADD_ALLDAY_PARAM) === '1';
  const modalAddTs = searchParams.get(ADD_TS_PARAM) || null;
  const modalAddTe = searchParams.get(ADD_TE_PARAM) || null;
  const modalGoogleCalendarId = searchParams.get(GC_PARAM) || undefined;
  const googleCalendarAccessRole = useMemo(() => {
    if (!modalGoogleCalendarId || !googleCalendarList.length) return undefined;
    const cal = googleCalendarList.find((c) => c.id === modalGoogleCalendarId);
    return cal?.accessRole;
  }, [modalGoogleCalendarId, googleCalendarList]);

  const openAddEvent = () => {
    const next = new URLSearchParams(searchParams);
    next.set(MODAL_PARAM, MODAL_EVENT);
    next.delete(DATE_PARAM);
    next.delete(DATE_END_PARAM);
    next.delete(ADD_ALLDAY_PARAM);
    next.delete(ADD_TS_PARAM);
    next.delete(ADD_TE_PARAM);
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
    next.delete(DATE_END_PARAM);
    next.delete(ADD_ALLDAY_PARAM);
    next.delete(ADD_TS_PARAM);
    next.delete(ADD_TE_PARAM);
    next.delete(EVENT_ID_PARAM);
    next.delete(GC_PARAM);
    next.delete(EDIT_PARAM);
    setSearchParams(next, { replace: true });
  };

  /** 드래그로 잡은 기간·시간 → 일정 추가 모달 */
  const openAddEventFromSelection = useCallback(
    ({
      startYmd,
      endYmd,
      allDay,
      startTime,
      endTime
    }) => {
      const next = new URLSearchParams(searchParams);
      next.set(MODAL_PARAM, MODAL_EVENT);
      next.set(DATE_PARAM, startYmd);
      if (endYmd && endYmd !== startYmd) next.set(DATE_END_PARAM, endYmd);
      else next.delete(DATE_END_PARAM);
      if (allDay) {
        next.set(ADD_ALLDAY_PARAM, '1');
        next.delete(ADD_TS_PARAM);
        next.delete(ADD_TE_PARAM);
      } else {
        next.delete(ADD_ALLDAY_PARAM);
        if (startTime) next.set(ADD_TS_PARAM, startTime);
        else next.delete(ADD_TS_PARAM);
        if (endTime) next.set(ADD_TE_PARAM, endTime);
        else next.delete(ADD_TE_PARAM);
      }
      next.delete(EVENT_ID_PARAM);
      next.delete(GC_PARAM);
      next.delete(EDIT_PARAM);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );
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
    next.delete(DATE_END_PARAM);
    next.delete(ADD_ALLDAY_PARAM);
    next.delete(ADD_TS_PARAM);
    next.delete(ADD_TE_PARAM);
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

  const { timeMin, timeMax } = useMemo(() => {
    if (viewMode === 'week' && weekViewStart) {
      return getWeekTimeBounds(weekViewStart);
    }
    return getMonthRange(current.year, current.month);
  }, [viewMode, weekViewStart, current.year, current.month]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/auth/me`, crmFetchInit())
      .then((r) => r.json())
      .then((data) => {
        const u = data.user || data;
        if (!cancelled && u?._id) setCurrentUser(u);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const applyCalendarViewMode = useCallback(
    (mode) => {
      if (mode === 'week') {
        setWeekViewStart(sundayPartsOfLocalDate(current.year, current.month, selectedDay));
      }
      setViewMode(mode);
      patchCalendarViewTemplate({ viewMode: mode }).catch(() => {});
    },
    [current.year, current.month, selectedDay]
  );

  useEffect(() => {
    if (!currentUser?._id) return;
    const v = currentUser.listTemplates?.calendar?.viewMode;
    if (v === 'month' || v === 'week' || v === 'day') {
      setViewMode(v);
      if (v === 'week') {
        setWeekViewStart(sundayPartsOfLocalDate(current.year, current.month, selectedDay));
      }
    }
  }, [currentUser?._id]);

  useEffect(() => {
    try {
      localStorage.setItem(GOOGLE_CALENDAR_IDS_STORAGE_KEY, JSON.stringify(selectedGoogleCalendarIds));
    } catch {
      /* 사생활 모드 등 */
    }
  }, [selectedGoogleCalendarIds]);

  useEffect(() => {
    if (!currentUser?._id) return;
    let cancelled = false;
    Promise.all([
      fetch(`${API_BASE}/auth/google/link-status`, crmFetchInit()).then((r) => r.json()),
      fetch(`${API_BASE}/auth/naver/link-status`, crmFetchInit()).then((r) => r.json())
    ])
      .then(([g, n]) => {
        if (cancelled) return;
        setGoogleLinkStatus(g);
        setNaverLinkStatus(n);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentUser?._id, refreshKey]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const naverOk = params.get('naver_link');
    const naverErr = params.get('naver_link_error');
    const googleErr = params.get('google_link_error');
    if (naverOk === 'calendar_ok') {
      setSyncMessage('네이버 캘린더 연동이 완료되었습니다.');
      params.delete('naver_link');
      const qs = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    } else if (naverErr) {
      setSyncMessage(decodeURIComponent(naverErr));
      params.delete('naver_link_error');
      const qs = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    } else if (googleErr) {
      setSyncMessage(decodeURIComponent(googleErr));
      params.delete('google_link_error');
      const qs = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    }
  }, []);

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

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = () => setIsCompactMonth(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /** Google에 연결된 캘린더 목록 — CRM 일정과 함께 표시 */
  useEffect(() => {
    if (!currentUser?._id || googleLinkStatus?.calendar !== true) {
      if (googleLinkStatus && !googleLinkStatus.calendar) {
        setGoogleCalendarList([]);
        setGoogleEvents([]);
      }
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/google-calendar/calendar-list`, crmFetchInit())
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
  }, [currentUser?._id, refreshKey, googleLinkStatus?.calendar]);

  /** CRM + Google 캘린더 일정 병합 조회 */
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setGoogleLoadHint('');
    setLoading(true);

    const crmParams = new URLSearchParams({ start: timeMin, end: timeMax });
    const crmFetch = fetch(`${API_BASE}/calendar-events?${crmParams}`, crmFetchInit()).then(
      async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) })
    );

    const googleLinked = googleLinkStatus?.calendar === true;
    const ids = googleLinked
      ? (selectedGoogleCalendarIds.length > 0 ? selectedGoogleCalendarIds : ['primary'])
      : [];
    const metaById = {};
    googleCalendarList.forEach((it) => {
      metaById[it.id] = {
        calendarSummary: it.summary || it.id,
        backgroundColor: (it.backgroundColor || '').trim(),
        accessRole: it.accessRole || ''
      };
    });

    const googleFetches = ids.map((calId) => {
      const gParams = new URLSearchParams({ timeMin, timeMax, calendarId: calId });
      return fetch(`${API_BASE}/google-calendar/events?${gParams}`, crmFetchInit()).then(
        async (r) => ({ calId, data: await r.json().catch(() => ({})) })
      );
    });

    Promise.all([crmFetch, googleLinked ? Promise.all(googleFetches) : Promise.resolve([])])
      .then(([crmResult, googleResults]) => {
        if (cancelled) return;

        if (!crmResult.ok) {
          setError(crmResult.data.error || `회사 일정을 불러올 수 없습니다. (${crmResult.status})`);
          setCrmEvents([]);
        } else if (crmResult.data.error && !crmResult.data.items) {
          setError(crmResult.data.error);
          setCrmEvents([]);
        } else {
          const raw = Array.isArray(crmResult.data.items) ? crmResult.data.items : [];
          setCrmEvents(raw.map(normalizeCrmEventFromApi));
        }

        if (!googleLinked) {
          setGoogleEvents([]);
          if (googleLinkStatus != null) {
            setGoogleLoadHint(
              googleLinkStatus.needsReauth
                ? '구글 연동이 만료되었습니다. 동기화 아이콘을 눌러 다시 연동해 주세요.'
                : '구글 캘린더를 함께 보려면 동기화 아이콘으로 연동해 주세요.'
            );
          }
          return;
        }

        const userId = currentUser?._id || '';
        const merged = [];
        let authErr = null;
        let anyOk = false;
        googleResults.forEach(({ calId, data }) => {
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

        if (googleResults.length > 0 && !anyOk) {
          setGoogleLoadHint(
            authErr?.needsReauth
              ? '구글 캘린더 연동이 필요합니다. 동기화 아이콘을 눌러 연동해 주세요.'
              : authErr?.error || '구글 캘린더를 불러올 수 없습니다.'
          );
          setGoogleEvents([]);
        } else {
          merged.sort((a, b) => compareCalendarEvents(a, b));
          setGoogleEvents(merged);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('일정을 불러올 수 없습니다.');
          setCrmEvents([]);
          setGoogleEvents([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [timeMin, timeMax, refreshKey, selectedGoogleCalendarIds, googleCalendarList, currentUser, googleLinkStatus]);

  const rawEvents = useMemo(() => {
    const crm = crmEvents.map((ev) => ({ ...ev, _source: 'crm' }));
    const dedupIndex = buildCrmGoogleDedupIndex(crmEvents);
    const googleFiltered = googleEvents.filter((gev) => !isGoogleEventDuplicateOfCrm(gev, dedupIndex));
    return [...crm, ...googleFiltered].sort(compareCalendarEvents);
  }, [crmEvents, googleEvents]);

  /** 로그인 계정 유형 — 네이버 우선, 없으면 Google */
  const calendarSyncProvider = useMemo(() => {
    if (!currentUser?._id) return null;
    if (currentUser.naverId) return 'naver';
    if (currentUser.googleId) return 'google';
    const email = String(currentUser.email || '').toLowerCase();
    if (email.endsWith('@naver.com')) return 'naver';
    return 'google';
  }, [currentUser]);

  const calendarSyncLinked = useMemo(() => {
    if (calendarSyncProvider === 'naver') return naverLinkStatus?.calendar === true;
    if (calendarSyncProvider === 'google') return googleLinkStatus?.calendar === true;
    return false;
  }, [calendarSyncProvider, naverLinkStatus?.calendar, googleLinkStatus?.calendar]);

  const startGoogleCalendarLink = useCallback(() => {
    const token = getCrmToken();
    if (!token) return;
    window.location.href = `${API_BASE}/auth/google/link/calendar?token=${encodeURIComponent(token)}&return=${encodeURIComponent('/calendar')}`;
  }, []);

  const startNaverCalendarLink = useCallback(() => {
    const token = getCrmToken();
    if (!token) return;
    window.location.href = `${API_BASE}/auth/naver/link/calendar?token=${encodeURIComponent(token)}&return=${encodeURIComponent('/calendar')}`;
  }, []);

  const pushCrmToGoogle = useCallback(async () => {
    setSyncBusy('google');
    setSyncMessage('');
    try {
      const res = await fetch(`${API_BASE}/calendar-events/push-to-google`, {
        method: 'POST',
        headers: { ...getCrmAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: timeMin, end: timeMax })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncMessage(data.error || '구글 반영에 실패했습니다.');
        if (data.needsReauth) startGoogleCalendarLink();
        return;
      }
      setSyncMessage(`구글: 생성 ${data.created || 0}건, 수정 ${data.updated || 0}건${data.failed ? `, 실패 ${data.failed}건` : ''}`);
      setRefreshKey((k) => k + 1);
    } catch {
      setSyncMessage('구글 반영 중 오류가 발생했습니다.');
    } finally {
      setSyncBusy('');
    }
  }, [timeMin, timeMax, startGoogleCalendarLink]);

  const pushCrmToNaver = useCallback(async () => {
    setSyncBusy('naver');
    setSyncMessage('');
    try {
      const res = await fetch(`${API_BASE}/calendar-events/push-to-naver`, {
        method: 'POST',
        headers: { ...getCrmAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: timeMin, end: timeMax })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncMessage(data.error || data.details || '네이버 반영에 실패했습니다.');
        if (data.needsReauth) startNaverCalendarLink();
        return;
      }
      const firstErr = data.errors?.[0];
      const detailText = firstErr?.details || data.details || '';
      const errDetail = detailText ? ` — ${detailText}` : '';
      if (data.needsReauth) {
        setSyncMessage(detailText || '네이버 캘린더 연동이 필요합니다.');
        startNaverCalendarLink();
        return;
      }
      setSyncMessage(
        data.message ||
          `네이버: 등록 ${data.created || 0}건, 건너뜀 ${data.skipped || 0}건${data.failed ? `, 실패 ${data.failed}건${errDetail}` : ''}`
      );
    } catch {
      setSyncMessage('네이버 반영 중 오류가 발생했습니다.');
    } finally {
      setSyncBusy('');
    }
  }, [timeMin, timeMax, startNaverCalendarLink]);

  const handleCalendarSyncClick = useCallback(async () => {
    if (!calendarSyncProvider || syncBusy) return;
    if (calendarSyncProvider === 'naver') {
      if (!naverLinkStatus?.calendar) {
        startNaverCalendarLink();
        return;
      }
      await pushCrmToNaver();
      return;
    }
    if (!googleLinkStatus?.calendar) {
      startGoogleCalendarLink();
      return;
    }
    await pushCrmToGoogle();
  }, [
    calendarSyncProvider,
    syncBusy,
    naverLinkStatus?.calendar,
    googleLinkStatus?.calendar,
    startNaverCalendarLink,
    startGoogleCalendarLink,
    pushCrmToNaver,
    pushCrmToGoogle
  ]);

  const calendarSyncAriaLabel = useMemo(() => {
    if (syncBusy) return '캘린더 반영 중';
    if (calendarSyncProvider === 'naver') {
      return calendarSyncLinked ? '네이버 캘린더에 반영' : '네이버 캘린더 연동';
    }
    if (calendarSyncProvider === 'google') {
      return calendarSyncLinked ? '구글 캘린더에 반영' : '구글 캘린더 연동';
    }
    return '캘린더 연동';
  }, [calendarSyncProvider, calendarSyncLinked, syncBusy]);

  const events = useMemo(() => {
    const q = headerSearch.trim().toLowerCase();
    if (!q) return rawEvents;
    return rawEvents.filter((ev) => {
      const title = String(ev.title || '').toLowerCase();
      const desc = String(ev.description || '').toLowerCase();
      const calName = String(ev.calendarName || '').toLowerCase();
      return title.includes(q) || desc.includes(q) || calName.includes(q);
    });
  }, [rawEvents, headerSearch]);

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
  /** 일간 목록 번호·Shift 범위 선택과 동일한 순서 (종일 → 시간) */
  const dayViewOrderedEvents = useMemo(
    () => [...dayViewAllDay, ...dayViewTimed],
    [dayViewAllDay, dayViewTimed]
  );

  const daySelectedCount = daySelectedKeys.size;

  useEffect(() => {
    setDaySelectedKeys(new Set());
    dayLastSelectIndexRef.current = null;
  }, [current.year, current.month, selectedDay, viewMode]);

  useEffect(() => {
    if (!headlineDateEdit) return;
    const t = window.setTimeout(() => {
      headlineYearInputRef.current?.focus();
      headlineYearInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [headlineDateEdit]);

  const openHeadlineDateEdit = useCallback(() => {
    setHeadlineEditYear(String(current.year));
    setHeadlineEditMonth(String(current.month + 1));
    setHeadlineEditDay(String(selectedDay));
    setHeadlineDateEdit(true);
  }, [current.year, current.month, selectedDay]);

  const applyHeadlineDateEdit = useCallback(() => {
    const y = parseInt(headlineEditYear, 10);
    const m = parseInt(headlineEditMonth, 10);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return;
    const monthIdx = m - 1;
    const dim = new Date(y, monthIdx + 1, 0).getDate();
    const dRaw = parseInt(headlineEditDay, 10);

    if (viewMode === 'month') {
      setCurrent({ year: y, month: monthIdx });
      setSelectedDay((d) => Math.min(Math.max(1, d), dim));
    } else if (viewMode === 'week') {
      const safeDay = Number.isFinite(dRaw) ? Math.min(Math.max(1, dRaw), dim) : Math.min(selectedDay, dim);
      setCurrent({ year: y, month: monthIdx });
      setSelectedDay(safeDay);
      setWeekViewStart(sundayPartsOfLocalDate(y, monthIdx, safeDay));
    } else {
      const safeDay = Number.isFinite(dRaw) ? Math.min(Math.max(1, dRaw), dim) : 1;
      setCurrent({ year: y, month: monthIdx });
      setSelectedDay(safeDay);
    }
    setHeadlineDateEdit(false);
  }, [headlineEditYear, headlineEditMonth, headlineEditDay, viewMode, selectedDay]);

  const onHeadlineDateEditKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyHeadlineDateEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setHeadlineDateEdit(false);
      }
    },
    [applyHeadlineDateEdit]
  );

  const handleDayEventCheckbox = useCallback(
    (index, ev, shiftKey) => {
      const key = dayEventSelectionKey(ev);
      const list = dayViewOrderedEvents;
      const anchor = dayLastSelectIndexRef.current;

      setDaySelectedKeys((prev) => {
        const next = new Set(prev);
        if (shiftKey && anchor != null && list.length > 0) {
          const from = Math.min(anchor, index);
          const to = Math.max(anchor, index);
          for (let i = from; i <= to; i += 1) {
            const row = list[i];
            if (row) next.add(dayEventSelectionKey(row));
          }
        } else if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
      dayLastSelectIndexRef.current = index;
    },
    [dayViewOrderedEvents]
  );

  const onDayEventSelectPointerDown = useCallback(
    (e, index, ev) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      handleDayEventCheckbox(index, ev, e.shiftKey);
    },
    [handleDayEventCheckbox]
  );

  const deleteSelectedDayEvents = useCallback(async () => {
    const selected = eventsForSelectedDay.filter((ev) => daySelectedKeys.has(dayEventSelectionKey(ev)));
    if (!selected.length) return;
    if (!window.confirm(`선택한 ${selected.length}개 일정을 삭제할까요?`)) return;

    const crmIds = [];
    const googleItems = [];
    selected.forEach((ev) => {
      const { isGoogle, realId } = resolveCalendarEventDeleteTarget(ev);
      if (isGoogle) {
        googleItems.push({
          eventId: realId,
          calendarId: ev.googleCalendarId || 'primary'
        });
      } else if (realId) {
        crmIds.push(realId);
      }
    });

    setDayDeleteBusy(true);
    let failed = 0;
    const headers = { ...getAuthHeader(), 'Content-Type': 'application/json' };

    try {
      const tasks = [];
      chunkCalendarDeleteList(crmIds, CALENDAR_BULK_DELETE_CHUNK).forEach((ids) => {
        tasks.push(
          fetch(`${API_BASE}/calendar-events/bulk-delete`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ ids })
          }).then(async (res) => {
            if (!res.ok) {
              failed += ids.length;
              return;
            }
            const data = await res.json().catch(() => ({}));
            const deleted = Number(data.deletedCount);
            if (!Number.isFinite(deleted)) failed += ids.length;
            else failed += Math.max(0, ids.length - deleted);
          })
        );
      });
      chunkCalendarDeleteList(googleItems, CALENDAR_BULK_DELETE_CHUNK).forEach((items) => {
        tasks.push(
          fetch(`${API_BASE}/google-calendar/events/bulk-delete`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ items })
          }).then(async (res) => {
            if (!res.ok) {
              failed += items.length;
              return;
            }
            const data = await res.json().catch(() => ({}));
            failed += Number(data.failedCount) || 0;
          })
        );
      });

      await Promise.all(tasks);

      if (failed > 0) {
        window.alert(`${failed}개 일정 삭제에 실패했습니다.`);
      }
      setDaySelectedKeys(new Set());
      dayLastSelectIndexRef.current = null;
      setRefreshKey((k) => k + 1);
    } catch {
      window.alert('일정 삭제 중 오류가 발생했습니다.');
    } finally {
      setDayDeleteBusy(false);
    }
  }, [eventsForSelectedDay, daySelectedKeys]);

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

  const weekColumnMeta = useMemo(() => {
    if (!weekViewStart) return [];
    return Array.from({ length: 7 }, (_, i) => {
      const dt = new Date(weekViewStart.y, weekViewStart.m, weekViewStart.d + i);
      return {
        y: dt.getFullYear(),
        m: dt.getMonth(),
        d: dt.getDate(),
        weekday: WEEKDAYS[dt.getDay()]
      };
    });
  }, [weekViewStart]);

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

  const goPrevWeek = useCallback(() => {
    setWeekViewStart((ws) => {
      const d = new Date(ws.y, ws.m, ws.d - 7);
      return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
    });
  }, []);

  const goNextWeek = useCallback(() => {
    setWeekViewStart((ws) => {
      const d = new Date(ws.y, ws.m, ws.d + 7);
      return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
    });
  }, []);

  const endMonthDayDrag = useCallback(() => {
    if (!monthDragActiveRef.current) return;
    monthDragActiveRef.current = false;
    setMonthDragRange((prev) => {
      if (!prev) return null;
      const a = Math.min(prev.startDay, prev.endDay);
      const b = Math.max(prev.startDay, prev.endDay);
      if (a !== b) {
        const sy = `${current.year}-${String(current.month + 1).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
        const ey = `${current.year}-${String(current.month + 1).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
        window.setTimeout(() => {
          openAddEventFromSelection({ startYmd: sy, endYmd: ey, allDay: true });
        }, 0);
      }
      return null;
    });
  }, [current.year, current.month, openAddEventFromSelection]);

  const endWeekTimeDrag = useCallback(() => {
    if (!weekDragActiveRef.current) return;
    weekDragActiveRef.current = false;
    const ws = weekViewStart;
    setWeekDragRange((prev) => {
      if (!prev || !ws) return null;
      let lo = Math.min(prev.start, prev.end);
      let hi = Math.max(prev.start, prev.end);
      if (lo === hi) hi = lo + 60;
      const startDt = localDateFromWeekMinute(ws, lo);
      const endDt = localDateFromWeekMinute(ws, hi);
      const sy = `${startDt.getFullYear()}-${padCal2(startDt.getMonth() + 1)}-${padCal2(startDt.getDate())}`;
      const ey = `${endDt.getFullYear()}-${padCal2(endDt.getMonth() + 1)}-${padCal2(endDt.getDate())}`;
      const st = `${padCal2(startDt.getHours())}:${padCal2(startDt.getMinutes())}`;
      const et = `${padCal2(endDt.getHours())}:${padCal2(endDt.getMinutes())}`;
      window.setTimeout(() => {
        openAddEventFromSelection({
          startYmd: sy,
          endYmd: ey,
          allDay: false,
          startTime: st,
          endTime: et
        });
      }, 0);
      return null;
    });
  }, [weekViewStart, openAddEventFromSelection]);

  useEffect(() => {
    const finish = () => {
      if (monthDragActiveRef.current) endMonthDayDrag();
      if (weekDragActiveRef.current) endWeekTimeDrag();
    };
    window.addEventListener('mouseup', finish);
    window.addEventListener('touchend', finish);
    window.addEventListener('blur', finish);
    return () => {
      window.removeEventListener('mouseup', finish);
      window.removeEventListener('touchend', finish);
      window.removeEventListener('blur', finish);
    };
  }, [endMonthDayDrag, endWeekTimeDrag]);

  const beginMonthDayDrag = useCallback((day, e) => {
    if (e.target.closest('.calendar-day-num')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    monthDragActiveRef.current = true;
    setMonthDragRange({ startDay: day, endDay: day });
  }, []);

  const enterMonthDayWhileDrag = useCallback((day) => {
    if (!monthDragActiveRef.current || day == null) return;
    setMonthDragRange((prev) => (prev ? { ...prev, endDay: day } : prev));
  }, []);

  const beginWeekSlotDrag = useCallback((weekMinute, e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    weekDragActiveRef.current = true;
    setWeekDragRange({ start: weekMinute, end: weekMinute });
  }, []);

  const enterWeekSlotWhileDrag = useCallback((weekMinute) => {
    if (!weekDragActiveRef.current) return;
    setWeekDragRange((prev) => (prev ? { ...prev, end: weekMinute } : prev));
  }, []);

  const monthTitle = `${current.year}년 ${current.month + 1}월`;
  const dayTitle = formatDayViewTitle(current.year, current.month, selectedDay);
  const weekTitle = formatWeekRangeTitle(weekViewStart);
  const maxEventsInDayCell = isCompactMonth ? 2 : 5;
  return (
    <div className={`page calendar-page${embedded ? ' calendar-page--embedded' : ''}`}>
      {!embedded && (
      <header className="calendar-page-header">
        <div className="calendar-page-header-left">
          <div className="calendar-page-header-title-wrap">
            <span className="material-symbols-outlined calendar-page-header-icon" aria-hidden>
              calendar_month
            </span>
            <h2 className="calendar-page-header-title">캘린더</h2>
          </div>
          <div className="calendar-page-search-wrap">
            <span className="material-symbols-outlined calendar-page-search-icon" aria-hidden>
              search
            </span>
            <input
              type="search"
              className="calendar-page-search-input"
              placeholder="일정 검색…"
              value={headerSearch}
              onChange={(e) => setHeaderSearch(e.target.value)}
              aria-label="일정 검색"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="calendar-page-header-right">
          <div className="calendar-page-header-trailing">
            <PageHeaderNotifyChat
              buttonClassName="calendar-page-icon-btn"
              wrapperClassName="calendar-page-header-notify-chat"
            />
          </div>
        </div>
      </header>
      )}

      <div className={`page-content calendar-page-content${embedded ? ' calendar-page-content--embedded' : ''}`}>
        <div className="calendar-shell">
          <div className="calendar-hero">
            <div className="calendar-hero-main">
              <div className="calendar-title-block">
                {headlineDateEdit ? (
                  <div
                    className="calendar-headline-date-edit"
                    role="group"
                    aria-label="날짜 직접 입력"
                    onKeyDown={onHeadlineDateEditKeyDown}
                  >
                    <input
                      ref={headlineYearInputRef}
                      type="number"
                      className="calendar-headline-date-input calendar-headline-date-input--year"
                      value={headlineEditYear}
                      onChange={(e) => setHeadlineEditYear(e.target.value)}
                      aria-label="연도"
                      min={1970}
                      max={2100}
                    />
                    <span className="calendar-headline-date-unit">년</span>
                    <input
                      type="number"
                      className="calendar-headline-date-input calendar-headline-date-input--month"
                      value={headlineEditMonth}
                      onChange={(e) => setHeadlineEditMonth(e.target.value)}
                      aria-label="월"
                      min={1}
                      max={12}
                    />
                    <span className="calendar-headline-date-unit">월</span>
                    {viewMode !== 'month' ? (
                      <>
                        <input
                          type="number"
                          className="calendar-headline-date-input calendar-headline-date-input--day"
                          value={headlineEditDay}
                          onChange={(e) => setHeadlineEditDay(e.target.value)}
                          aria-label="일"
                          min={1}
                          max={31}
                        />
                        <span className="calendar-headline-date-unit">일</span>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="calendar-headline-date-apply"
                      onClick={applyHeadlineDateEdit}
                    >
                      이동
                    </button>
                    <button
                      type="button"
                      className="calendar-headline-date-cancel"
                      onClick={() => setHeadlineDateEdit(false)}
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <h1
                    className="calendar-month-headline calendar-month-headline--clickable"
                    role="button"
                    tabIndex={0}
                    title="클릭하여 날짜로 이동 (Enter)"
                    onClick={openHeadlineDateEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openHeadlineDateEdit();
                      }
                    }}
                  >
                    {viewMode === 'day' ? dayTitle : viewMode === 'week' ? weekTitle : monthTitle}
                  </h1>
                )}
                <div className="calendar-round-nav">
                  <button
                    type="button"
                    className="calendar-round-nav-btn"
                    onClick={viewMode === 'day' ? goPrevDay : viewMode === 'week' ? goPrevWeek : prevMonth}
                    aria-label={viewMode === 'day' ? '이전 날' : viewMode === 'week' ? '이전 주' : '이전 달'}
                  >
                    <span className="material-symbols-outlined">chevron_left</span>
                  </button>
                  <button
                    type="button"
                    className="calendar-round-nav-btn"
                    onClick={viewMode === 'day' ? goNextDay : viewMode === 'week' ? goNextWeek : nextMonth}
                    aria-label={viewMode === 'day' ? '다음 날' : viewMode === 'week' ? '다음 주' : '다음 달'}
                  >
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                </div>
              </div>
            </div>
            <div className="calendar-hero-aside">
              <div className="calendar-hero-tabs-row">
                <div className="calendar-view-tabs" role="tablist" aria-label="보기 방식">
                  {VIEW_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      role="tab"
                      aria-selected={viewMode === opt.key}
                      className={`calendar-view-tab ${viewMode === opt.key ? 'active' : ''}`}
                      onClick={() => applyCalendarViewMode(opt.key)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="calendar-integration-row">
                {googleCalendarList.length > 0 && (
                <div
                  ref={googleCalDropdownRef}
                  className="calendar-google-cal-dropdown"
                >
                  <button
                    type="button"
                    className="calendar-google-cal-dropdown-trigger"
                    aria-expanded={googleCalDropdownOpen}
                    aria-haspopup="listbox"
                    aria-label="표시할 구글 캘린더 열기"
                    onClick={() => setGoogleCalDropdownOpen((o) => !o)}
                  >
                    <span className="calendar-google-cal-dropdown-trigger-text">구글 캘린더</span>
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
                      aria-label="표시할 구글 캘린더"
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
                {calendarSyncProvider && (googleLinkStatus != null || naverLinkStatus != null) && (
                  <button
                    type="button"
                    className={`calendar-sync-icon-btn calendar-sync-icon-btn--${calendarSyncProvider}${syncBusy ? ' calendar-sync-icon-btn--busy' : ''}${calendarSyncLinked ? '' : ' calendar-sync-icon-btn--needs-link'}`}
                    disabled={!!syncBusy}
                    onClick={handleCalendarSyncClick}
                    title={calendarSyncAriaLabel}
                    aria-label={calendarSyncAriaLabel}
                  >
                    <span
                      className={`material-symbols-outlined${syncBusy ? ' calendar-sync-icon-spin' : ''}`}
                      aria-hidden
                    >
                      {syncBusy ? 'progress_activity' : 'cloud_sync'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {googleLoadHint && !error && calendarSyncProvider === 'google' && (
            <p className="calendar-google-hint" role="status">{googleLoadHint}</p>
          )}
          {naverLinkStatus?.hint && !naverLinkStatus.calendar && calendarSyncProvider === 'naver' && (
            <p className="calendar-google-hint" role="status">{naverLinkStatus.hint}</p>
          )}
          {syncMessage && <p className="calendar-sync-message" role="status">{syncMessage}</p>}
          {error && <p className="calendar-google-hint calendar-google-hint--error" role="alert">{error}</p>}

          <div className={`calendar-panel-card${embedded ? ' calendar-panel-card--embedded' : ''}`}>
            {viewMode === 'month' ? (
            <div className={`calendar-grid${isCompactMonth ? ' calendar-grid--fit' : ''}`}>
            <div className="calendar-weekday-row">
              {WEEKDAYS.map((w) => (
                <div key={w} className="calendar-weekday">{w}</div>
              ))}
            </div>
            {weeks.map((weekDays, weekIndex) => {
              const weekSegments = segmentsByWeek[weekIndex] || [];
              const weekSegmentRows = weekSegments.reduce((max, seg) => Math.max(max, (seg.rowIndex ?? 0) + 1), 0);
              const weekSegmentPaddingRem = weekSegmentRows > 0 ? weekSegmentRows * (isCompactMonth ? 1.05 : 1.5) : 0;
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
                      const inMonthDragSel =
                        monthDragRange &&
                        d != null &&
                        d >= Math.min(monthDragRange.startDay, monthDragRange.endDay) &&
                        d <= Math.max(monthDragRange.startDay, monthDragRange.endDay);
                      return (
                        <div
                          key={cellIndex}
                          className={`calendar-day ${d == null ? 'empty' : ''} ${isToday ? 'today' : ''} ${isSunday ? 'sun' : ''} ${isSaturday ? 'sat' : ''} ${inMonthDragSel ? 'calendar-day--drag-select' : ''}`}
                          onMouseDown={(e) => d != null && beginMonthDayDrag(d, e)}
                          onMouseEnter={() => enterMonthDayWhileDrag(d)}
                          onDoubleClick={() => d != null && openAddEventOnDate(current.year, current.month, d)}
                          title={d != null ? '드래그: 기간(종일) 일정 · 날짜 클릭: 일별 보기 · 더블클릭: 일정 추가' : undefined}
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
                                applyCalendarViewMode('day');
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setSelectedDay(d);
                                  applyCalendarViewMode('day');
                                }
                              }}
                            >
                              {d}
                            </span>
                          )}
                          {d != null && (
                            <div className="calendar-day-body" style={weekSegmentRows > 0 ? { paddingTop: `${weekSegmentPaddingRem}rem` } : undefined}>
                              <ul className={`calendar-events ${weekSegmentRows > 0 ? 'has-segments' : ''}`}>
                                {evs.slice(0, maxEventsInDayCell).map((entry, evIdx) => {
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
                                {evs.length > maxEventsInDayCell && (
                                  <li className="calendar-more-item">
                                    <button type="button" className="calendar-more-btn" onClick={(e) => { e.stopPropagation(); openDayList(current.year, current.month, d); }}>
                                      +{evs.length - maxEventsInDayCell} 더 보기
                                    </button>
                                  </li>
                                )}
                                {evs.length <= maxEventsInDayCell &&
                                  totalDayEvents.length > evs.length &&
                                  totalDayEvents.length > (isCompactMonth ? 1 : 2) && (
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
            ) : viewMode === 'week' ? (
            <div className="calendar-week-view">
              <p className="calendar-week-drag-hint" role="note">
                빈 시간 칸을 드래그하면 새 일정의 시작·종료(날짜·시간)이 입력됩니다. 하루 종일은 월간 보기에서 날짜를 드래그하세요.
              </p>
              <div className="calendar-week-view-scroll">
                <div className="calendar-week-view-header-row">
                  <div className="calendar-week-view-corner" aria-hidden>
                    <span className="calendar-week-view-corner-inner">시간</span>
                  </div>
                  {weekColumnMeta.map((col) => {
                    const colEvs = events.filter((ev) => eventTouchesCalendarDay(ev, col.y, col.m, col.d));
                    const allDayCol = colEvs.filter((ev) => isAllDayEvent(ev));
                    return (
                      <div key={`wh-${col.y}-${col.m}-${col.d}`} className="calendar-week-col-head">
                        <div className="calendar-week-col-head-main">
                          <span className="calendar-week-col-wd">{col.weekday}</span>
                          <span className="calendar-week-col-num">{col.d}</span>
                        </div>
                        {allDayCol.length > 0 && (
                          <div className="calendar-week-allday-chips" aria-label="종일 일정">
                            {allDayCol.slice(0, 3).map((ev, evIdx) => {
                              const style = getEventStyle(ev);
                              const pillClass = style ? '' : eventPillClass(ev, evIdx);
                              return (
                                <button
                                  key={`${ev.googleCalendarId || ''}-${ev._id}-allday`}
                                  type="button"
                                  className={`calendar-week-allday-chip ${pillClass}`}
                                  style={style}
                                  onClick={() => openEventDetail(ev._id, ev.googleCalendarId)}
                                >
                                  {ev.title || '(제목 없음)'}
                                </button>
                              );
                            })}
                            {allDayCol.length > 3 && (
                              <span className="calendar-week-allday-more">+{allDayCol.length - 3}</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="calendar-week-body">
                  <div className="calendar-week-time-rail" aria-hidden>
                    {Array.from({ length: 24 }, (_, hour) => (
                      <div key={hour} className="calendar-week-time-label">
                        {hour}
                      </div>
                    ))}
                  </div>
                  <div className="calendar-week-cols">
                    {weekColumnMeta.map((col, colIdx) => {
                      const colEvs = events.filter((ev) => eventTouchesCalendarDay(ev, col.y, col.m, col.d));
                      const timedCol = colEvs.filter((ev) => !isAllDayEvent(ev));
                      return (
                        <div key={`wc-${col.y}-${col.m}-${col.d}`} className="calendar-week-day-column">
                          <div className="calendar-week-hour-grid">
                            {Array.from({ length: 24 }, (_, hour) => {
                              const wm = colIdx * 1440 + hour * 60;
                              let inDrag = false;
                              if (weekDragRange) {
                                const lo = Math.min(weekDragRange.start, weekDragRange.end);
                                const hi = Math.max(weekDragRange.start, weekDragRange.end);
                                inDrag = wm >= lo && wm <= hi;
                              }
                              return (
                                <div
                                  key={hour}
                                  className={`calendar-week-slot ${inDrag ? 'calendar-week-slot--drag' : ''}`}
                                  data-day-index={colIdx}
                                  data-hour={hour}
                                  onMouseDown={(e) => beginWeekSlotDrag(wm, e)}
                                  onMouseEnter={(e) => {
                                    if (e.buttons === 1) enterWeekSlotWhileDrag(wm);
                                  }}
                                />
                              );
                            })}
                            {timedCol.map((ev, evIdx) => {
                              const seg = getTimedSegmentForDay(ev, col.y, col.m, col.d);
                              if (!seg) return null;
                              const top = (seg.startMins / 1440) * 100;
                              const height = ((seg.endMins - seg.startMins) / 1440) * 100;
                              const style = getEventStyle(ev);
                              const pillClass = style ? '' : eventPillClass(ev, evIdx);
                              const isGoogle = ev._source === 'google';
                              return (
                                <button
                                  key={`${ev.googleCalendarId || ''}-${ev._id}-timed`}
                                  type="button"
                                  className={`calendar-week-ev-block ${pillClass} ${isGoogle ? 'google-event' : ''}`}
                                  style={{ ...style, top: `${top}%`, height: `${Math.max(height, 3)}%` }}
                                  onClick={() => openEventDetail(ev._id, ev.googleCalendarId)}
                                >
                                  {isGoogle && <span className="calendar-event-google-dot" aria-hidden />}
                                  <span className="calendar-week-ev-title">{ev.title || '(제목 없음)'}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
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
                <button
                  type="button"
                  className="calendar-day-view-delete-btn"
                  disabled={dayDeleteBusy || daySelectedCount === 0}
                  onClick={() => void deleteSelectedDayEvents()}
                  title={daySelectedCount === 0 ? '삭제할 일정을 선택하세요' : undefined}
                >
                  <span className="material-symbols-outlined" aria-hidden>
                    {dayDeleteBusy ? 'progress_activity' : 'delete'}
                  </span>
                  {dayDeleteBusy ? '삭제 중…' : `선택 삭제${daySelectedCount > 0 ? ` (${daySelectedCount})` : ''}`}
                </button>
              </div>
              {eventsForSelectedDay.length > 0 ? (
                <p className="calendar-day-view-select-hint">
                  체크 후 삭제 · 1번 클릭 후 <kbd>Shift</kbd> 누른 채 11번 클릭하면 1~11번 전체 선택
                </p>
              ) : null}
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
                          const globalIndex = evIdx;
                          const style = getEventStyle(ev);
                          const pillClass = style ? '' : eventPillClass(ev, evIdx);
                          const isGoogle = ev._source === 'google';
                          const selKey = dayEventSelectionKey(ev);
                          const isSelected = daySelectedKeys.has(selKey);
                          return (
                            <li
                              key={`${ev.googleCalendarId || ''}-${ev._id}`}
                              className={`calendar-day-view-row${isSelected ? ' is-selected' : ''}`}
                            >
                              <label
                                className="calendar-day-view-check"
                                title={`${globalIndex + 1}번 일정`}
                                onMouseDown={(e) => onDayEventSelectPointerDown(e, globalIndex, ev)}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  readOnly
                                  tabIndex={-1}
                                  aria-label={`${globalIndex + 1}번 일정 선택`}
                                />
                                <span className="calendar-day-view-check-num">{globalIndex + 1}</span>
                              </label>
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
                          const globalIndex = dayViewAllDay.length + evIdx;
                          const style = getEventStyle(ev);
                          const pillClass = style ? '' : eventPillClass(ev, evIdx);
                          const isGoogle = ev._source === 'google';
                          const selKey = dayEventSelectionKey(ev);
                          const isSelected = daySelectedKeys.has(selKey);
                          return (
                            <li
                              key={`${ev.googleCalendarId || ''}-${ev._id}`}
                              className={`calendar-day-view-row${isSelected ? ' is-selected' : ''}`}
                            >
                              <label
                                className="calendar-day-view-check"
                                title={`${globalIndex + 1}번 일정`}
                                onMouseDown={(e) => onDayEventSelectPointerDown(e, globalIndex, ev)}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  readOnly
                                  tabIndex={-1}
                                  aria-label={`${globalIndex + 1}번 일정 선택`}
                                />
                                <span className="calendar-day-view-check-num">{globalIndex + 1}</span>
                              </label>
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
                회사 일정과 구글·네이버 캘린더를 한 화면에서 확인할 수 있습니다. 일정은 더블클릭으로 빠르게 추가할 수 있습니다.
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
          key={`${modalEventId || 'add'}-${modalDate || ''}-${modalDateEnd || ''}-${modalAddTs || ''}-${modalAddTe || ''}`}
          eventId={modalEventId}
          isEdit={modalEdit}
          initialDate={modalDate}
          initialDateEnd={modalDateEnd}
          initialAllDay={modalAddAllDay ? true : modalAddTs || modalAddTe ? false : undefined}
          initialStartTime={modalAddTs || undefined}
          initialEndTime={modalAddTe || undefined}
          calendarType="company"
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
