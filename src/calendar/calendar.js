import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import EventModal from './event-modal/event-modal';
import DayEventsModal from './day-events-modal/day-events-modal';
import './calendar.css';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
import { API_BASE } from '@/config';
const MODAL_PARAM = 'modal';
const EVENT_ID_PARAM = 'eventId';
const EDIT_PARAM = 'edit';
const DATE_PARAM = 'date';
const MODAL_EVENT = 'event';
const MODAL_DAY_LIST = 'day-list';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getMonthRange(year, month) {
  const timeMin = new Date(year, month, 1, 0, 0, 0, 0);
  const timeMax = new Date(year, month + 1, 0, 23, 59, 59, 999);
  return { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() };
}

/** Google Calendar 이벤트 → 통합 형식으로 변환 */
function normalizeGoogleEvent(gev, currentUserId) {
  const start = gev.start || {};
  const end = gev.end || {};
  const allDay = !!start.date && !start.dateTime;
  return {
    _id: `g:${gev.id}`,
    _source: 'google',
    title: gev.summary || '(제목 없음)',
    start: start.dateTime || (start.date ? start.date + 'T00:00:00' : null),
    end: end.dateTime || (end.date ? end.date + 'T00:00:00' : null),
    allDay,
    description: gev.description || '',
    color: '',
    visibility: 'private',
    creatorName: '',
    userId: currentUserId || '',
    participants: [],
    googleEventId: gev.id
  };
}

function getEventDaysInMonth(event, year, month) {
  if (!event.start) return [];
  const startDate = new Date(event.start);
  let endDate = event.end ? new Date(event.end) : new Date(startDate);

  if (event.allDay && endDate > startDate) {
    endDate = new Date(endDate);
    endDate.setDate(endDate.getDate() - 1);
  }

  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  if (endDate < monthStart || startDate > monthEnd) return [];

  const from = startDate < monthStart ? new Date(monthStart) : new Date(startDate);
  const to = endDate > monthEnd ? new Date(monthEnd) : new Date(endDate);
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

const FILTER_OPTIONS = [
  { key: 'all', label: '회사 일정' },
  { key: 'mine', label: '개인 일정' }
];

export default function Calendar() {
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
  const [currentUser, setCurrentUser] = useState(null);

  const isEventModalOpen = searchParams.get(MODAL_PARAM) === MODAL_EVENT;
  const isDayListModalOpen = searchParams.get(MODAL_PARAM) === MODAL_DAY_LIST;
  const modalEventId = searchParams.get(EVENT_ID_PARAM) || null;
  const modalEdit = searchParams.get(EDIT_PARAM) === '1';
  const modalDate = searchParams.get(DATE_PARAM) || null;

  const openAddEvent = () => {
    setSearchParams({ [MODAL_PARAM]: MODAL_EVENT }, { replace: true });
  };
  const openAddEventOnDate = (year, month, day) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setSearchParams({ [MODAL_PARAM]: MODAL_EVENT, [DATE_PARAM]: dateStr }, { replace: true });
  };
  const openEventDetail = (eventId) => {
    if (!eventId) return;
    setSearchParams({ [MODAL_PARAM]: MODAL_EVENT, [EVENT_ID_PARAM]: eventId });
  };
  const openDayList = (year, month, day) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setSearchParams({ [MODAL_PARAM]: MODAL_DAY_LIST, [DATE_PARAM]: dateStr }, { replace: true });
  };
  const closeEventModal = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    next.delete(EVENT_ID_PARAM);
    next.delete(EDIT_PARAM);
    next.delete(DATE_PARAM);
    setSearchParams(next, { replace: true });
  };
  const refreshEvents = () => setRefreshKey((k) => k + 1);

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

  /**
   * 회사 일정 탭: CRM(MongoDB)만 조회 (공개범위 적용)
   * 개인 일정 탭: Google Calendar만 조회
   */
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);

    if (activeFilter === 'all') {
      const crmParams = new URLSearchParams({ start: timeMin, end: timeMax });
      fetch(`${API_BASE}/calendar-events?${crmParams}`, { headers: getAuthHeader() })
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          if (data.error && !data.items) {
            setError(data.error);
            setCrmEvents([]);
          } else {
            setCrmEvents(data.items || []);
          }
          setGoogleEvents([]);
        })
        .catch(() => { if (!cancelled) { setError('일정을 불러올 수 없습니다.'); setCrmEvents([]); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else {
      const gParams = new URLSearchParams({ timeMin, timeMax, calendarId: 'primary' });
      fetch(`${API_BASE}/google-calendar/events?${gParams}`, { headers: getAuthHeader() })
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          if (data.error && !data.items) {
            setError(data.needsReauth ? 'Google 계정 연동이 필요합니다.' : data.error);
            setGoogleEvents([]);
          } else {
            setGoogleEvents(data.items || []);
          }
          setCrmEvents([]);
        })
        .catch(() => { if (!cancelled) { setError('Google 캘린더를 불러올 수 없습니다.'); setGoogleEvents([]); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }

    return () => { cancelled = true; };
  }, [timeMin, timeMax, refreshKey, activeFilter]);

  /** 회사 일정=CRM 이벤트, 개인 일정=Google 이벤트 (정규화) */
  const events = useMemo(() => {
    if (activeFilter === 'all') {
      return crmEvents.map((ev) => ({ ...ev, _source: 'crm' }));
    }
    const userId = currentUser?._id || '';
    return googleEvents
      .filter((gev) => gev.id)
      .map((gev) => normalizeGoogleEvent(gev, userId));
  }, [crmEvents, googleEvents, currentUser, activeFilter]);

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
    if (ev._source === 'google' && !ev.color) {
      return { background: 'rgba(66,133,244,0.15)', color: '#4285f4' };
    }
    if (!ev.color) return undefined;
    return { background: ev.color, color: '#fff' };
  }, []);

  const isMyEvent = useCallback((ev) => {
    if (ev._source === 'google') return true;
    return currentUser && ev.userId === currentUser._id;
  }, [currentUser]);

  const prevMonth = () => {
    setCurrent((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { ...c, month: c.month - 1 }));
  };
  const nextMonth = () => {
    setCurrent((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { ...c, month: c.month + 1 }));
  };
  const title = `${current.year}년 ${current.month + 1}월`;

  return (
    <div className="page calendar-page">
      <header className="page-header">
        <div className="header-search">
          <span className="material-symbols-outlined">search</span>
          <input type="text" placeholder="일정 검색..." />
        </div>
        <div className="header-actions">
          <button type="button" className="icon-btn"><span className="material-symbols-outlined">notifications</span></button>
          <button type="button" className="icon-btn"><span className="material-symbols-outlined">chat_bubble</span></button>
          <button type="button" className="btn-primary" onClick={openAddEvent}><span className="material-symbols-outlined">add</span> 일정 추가</button>
        </div>
      </header>

      <div className="page-content">
        <div className="calendar-top">
          <h2>캘린더</h2>
          <p className="page-desc">팀 일정을 확인하고 관리합니다.</p>
        </div>

        <div className="panel calendar-panel">
          <div className="calendar-toolbar">
            <div className="calendar-filter-tabs">
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`calendar-filter-tab ${activeFilter === opt.key ? 'active' : ''}`}
                  onClick={() => setActiveFilter(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="calendar-nav">
            <button type="button" className="calendar-nav-btn" onClick={prevMonth} aria-label="이전 달">
              <span className="material-symbols-outlined">chevron_left</span>
            </button>
            <h3 className="calendar-title">{title}</h3>
            <button type="button" className="calendar-nav-btn" onClick={nextMonth} aria-label="다음 달">
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
          {error && <p className="calendar-google-hint" role="status">{error}</p>}
          {loading && <p className="calendar-google-loading" aria-hidden="true">일정 불러오는 중…</p>}
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
                      const evs = (d != null && eventsByDay[d]) || [];
                      const totalDayEvents = (d != null && allEventsByDay[d]) || [];
                      return (
                        <div
                          key={cellIndex}
                          className={`calendar-day ${d == null ? 'empty' : ''} ${isToday ? 'today' : ''}`}
                          onDoubleClick={() => d != null && openAddEventOnDate(current.year, current.month, d)}
                          title={d != null ? '더블클릭: 이 날짜에 일정 추가' : undefined}
                        >
                          {d != null && <span className="calendar-day-num">{d}</span>}
                          {d != null && (
                            <div className="calendar-day-body" style={weekSegmentRows > 0 ? { paddingTop: `${weekSegmentPaddingRem}rem` } : undefined}>
                              <ul className={`calendar-events ${weekSegmentRows > 0 ? 'has-segments' : ''}`}>
                                {evs.slice(0, 5).map((entry) => {
                                  const ev = entry.event;
                                  const style = getEventStyle(ev);
                                  const isGoogle = ev._source === 'google';
                                  return (
                                    <li
                                      key={ev._id}
                                      className={`calendar-event ${isAllDayEvent(ev) ? 'all-day' : 'timed'} ${!isMyEvent(ev) ? 'other-user' : ''} ${isGoogle ? 'google-event' : ''}`}
                                      style={style}
                                      title={`${ev.title || '(제목 없음)'}${ev.creatorName ? ` — ${ev.creatorName}` : ''}${isGoogle ? ' (Google)' : ''}`}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => openEventDetail(ev._id)}
                                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEventDetail(ev._id); } }}
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
                        const colStart = ((startPad + seg.firstDay - 1) % 7) + 1;
                        const isGoogle = seg.event._source === 'google';
                        return (
                          <div
                            key={`${seg.event._id}-${seg.firstDay}-${seg.rowIndex}`}
                            className={`calendar-segment-bar ${!isMyEvent(seg.event) ? 'other-user' : ''} ${isGoogle ? 'google-event' : ''}`}
                            style={{ gridColumn: `${colStart} / span ${seg.span}`, gridRow: (seg.rowIndex ?? 0) + 1, ...(style || {}) }}
                            title={`${seg.event.title || '(제목 없음)'}${seg.event.creatorName ? ` — ${seg.event.creatorName}` : ''}${isGoogle ? ' (Google)' : ''}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => openEventDetail(seg.event._id)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEventDetail(seg.event._id); } }}
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
        </div>
      </div>

      {isEventModalOpen && (
        <EventModal
          eventId={modalEventId}
          isEdit={modalEdit}
          initialDate={modalDate}
          calendarType={activeFilter === 'mine' ? 'personal' : 'company'}
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
