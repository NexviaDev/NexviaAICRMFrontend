import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import { API_BASE } from '@/config';
import { buildParticipantDirectoryFromOverview } from '@/lib/participant-directory-merge';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import ProjectFormModal from './project-form-modal';
import './project.css';

const TABS = [
  { key: 'dashboard', label: '대시보드' },
  { key: 'kanban', label: '칸반' },
  { key: 'gantt', label: '간트차트' }
];

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const DEFAULT_PROJECT_KANBAN_COLUMNS = [
  { key: 'todo', title: '해야 할 일', dot: 'dot-muted' },
  { key: 'progress', title: '진행 중', dot: 'dot-primary' },
  { key: 'review', title: '검토', dot: 'dot-tertiary' },
  { key: 'done', title: '완료', dot: 'dot-done' }
];

function moveItemBetweenColumns(columns, itemId, targetStage) {
  const id = String(itemId);
  let moved = null;
  const next = columns.map((col) => ({
    ...col,
    items: (col.items || []).filter((item) => {
      if (String(item._id) === id) {
        moved = { ...item, stage: targetStage };
        return false;
      }
      return true;
    })
  }));
  if (!moved) return columns;
  const targetCol = next.find((c) => c.key === targetStage);
  if (!targetCol) return columns;
  targetCol.items = [moved, ...(targetCol.items || [])];
  return next.map((col) => ({ ...col, count: (col.items || []).length }));
}

function emptyBoard() {
  return {
    project: {
      _id: '',
      name: '프로젝트',
      kanbanColumns: DEFAULT_PROJECT_KANBAN_COLUMNS
    },
    dashboard: {
      stats: { overallProgress: 0, remainingTasks: 0, delayedTasks: 0, teamWorkload: 0 },
      distribution: { totalTasks: 0, byStage: { todo: 0, progress: 0, review: 0, done: 0 } },
      milestones: []
    },
    kanban: {
      columns: [
        { key: 'todo', title: '해야 할 일', dot: 'dot-muted', count: 0, items: [] },
        { key: 'progress', title: '진행 중', dot: 'dot-primary', count: 0, items: [] },
        { key: 'review', title: '검토', dot: 'dot-tertiary', count: 0, items: [] },
        { key: 'done', title: '완료', dot: 'dot-done', count: 0, items: [] }
      ]
    },
    gantt: { tasks: [] }
  };
}

function normalizeView(raw) {
  if (raw === 'dashboard' || raw === 'kanban' || raw === 'gantt') return raw;
  return 'dashboard';
}

function StatCard({ label, value, note, tone = 'primary' }) {
  return (
    <article className={`project-stat-card tone-${tone}`}>
      <p className="project-stat-label">{label}</p>
      <p className="project-stat-value">{value}</p>
      <p className="project-stat-note">{note}</p>
    </article>
  );
}

function getInitials(name = '') {
  return String(name).trim().slice(-2);
}

const GANTT_DAY_WIDTH = 24;
const GANTT_EDGE_LOAD_MONTHS = 2;
const GANTT_SCROLL_EDGE_THRESHOLD = 96;
const DASHBOARD_CALENDAR_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function normalizeProjectCalendarItem(task) {
  if (!task || !task._id) return null;
  const start = task.startDate || task.dueDate || null;
  const end = task.dueDate || task.startDate || null;
  if (!start && !end) return null;
  return {
    _id: String(task._id),
    _source: 'project',
    title: String(task.title || '(제목 없음)'),
    start,
    end,
    allDay: true,
    stage: String(task.stage || 'todo')
  };
}

function compareDashboardEvents(a, b) {
  const aAllDay = !!a?.allDay;
  const bAllDay = !!b?.allDay;
  if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;
  const aStart = a?.start ? new Date(a.start).getTime() : Number.MAX_SAFE_INTEGER;
  const bStart = b?.start ? new Date(b.start).getTime() : Number.MAX_SAFE_INTEGER;
  if (aStart !== bStart) return aStart - bStart;
  return String(a?.title || '').localeCompare(String(b?.title || ''), 'ko');
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
      seg.span += 1;
    } else {
      segments.push({ firstDay: seg.firstDay, span: seg.span });
      seg = { firstDay: day, span: 1, row };
    }
  }
  segments.push({ firstDay: seg.firstDay, span: seg.span });
  return segments;
}

function getDashboardEventDaysInMonth(event, year, month) {
  if (!event?.start) return [];
  const startDate = new Date(event.start);
  let endDate = event.end ? new Date(event.end) : new Date(startDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return [];
  if (event.allDay && endDate > startDate) {
    endDate = new Date(endDate);
    endDate.setDate(endDate.getDate() - 1);
  }
  const monthStart = new Date(year, month, 1, 0, 0, 0, 0);
  const nextMonthStart = new Date(year, month + 1, 1, 0, 0, 0, 0);
  if (endDate < monthStart || startDate >= nextMonthStart) return [];
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const from = startDate < monthStart ? new Date(monthStart) : new Date(startDate);
  const to = endDate > monthEnd ? new Date(monthEnd) : new Date(endDate);
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  const days = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    if (cursor.getFullYear() === year && cursor.getMonth() === month) days.push(cursor.getDate());
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function buildDashboardCalendarWeeks(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const totalCells = Math.ceil((startPad + daysInMonth) / 7) * 7;
  const cells = Array.from({ length: totalCells }, (_, i) => {
    const dayNum = i - startPad + 1;
    return dayNum < 1 || dayNum > daysInMonth ? null : dayNum;
  });
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

function formatDashboardCalendarTitle(year, month) {
  return `${year}년 ${month + 1}월`;
}

function getDashboardCalendarEventTone(event, index) {
  if (event?.stage === 'done') return 'mint';
  if (event?.stage === 'review') return 'tertiary';
  if (event?.stage === 'progress') return 'secondary';
  const title = String(event?.title || '').toLowerCase();
  if (title.includes('urgent') || title.includes('긴급')) return 'danger';
  return index % 2 === 0 ? 'primary' : 'secondary';
}

function startOfDay(input) {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(input) {
  const date = new Date(input);
  date.setHours(23, 59, 59, 999);
  return date;
}

function addMonthsSafe(input, amount) {
  const date = new Date(input);
  date.setMonth(date.getMonth() + amount);
  return date;
}

function diffDaysInclusive(start, end) {
  const startTime = startOfDay(start).getTime();
  const endTime = startOfDay(end).getTime();
  return Math.max(1, Math.floor((endTime - startTime) / (24 * 60 * 60 * 1000)) + 1);
}

function diffDaysFrom(start, end) {
  const startTime = startOfDay(start).getTime();
  const endTime = startOfDay(end).getTime();
  return Math.floor((endTime - startTime) / (24 * 60 * 60 * 1000));
}

function createInitialGanttRange() {
  const today = new Date();
  return {
    start: startOfDay(addMonthsSafe(today, -GANTT_EDGE_LOAD_MONTHS)),
    end: endOfDay(addMonthsSafe(today, GANTT_EDGE_LOAD_MONTHS))
  };
}

function formatGanttWeekLabel(input) {
  const date = new Date(input);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function DashboardCalendar({
  current,
  events,
  onPrevMonth,
  onNextMonth,
  onEventClick
}) {
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === current.year && today.getMonth() === current.month;
  const weeks = useMemo(() => buildDashboardCalendarWeeks(current.year, current.month), [current.year, current.month]);
  const firstDay = useMemo(() => new Date(current.year, current.month, 1), [current.year, current.month]);
  const startPad = firstDay.getDay();
  const eventsByDay = useMemo(() => {
    const map = new Map();
    for (const event of Array.isArray(events) ? events : []) {
      const days = getDashboardEventDaysInMonth(event, current.year, current.month);
      if (days.length !== 1) continue;
      for (const day of days) {
        if (!map.has(day)) map.set(day, []);
        map.get(day).push(event);
      }
    }
    for (const [day, rows] of map.entries()) {
      map.set(day, [...rows].sort(compareDashboardEvents));
    }
    return map;
  }, [current.month, current.year, events]);
  const segmentsWithRow = useMemo(() => {
    const segments = [];
    events.forEach((event) => {
      const eventDays = getDashboardEventDaysInMonth(event, current.year, current.month);
      if (eventDays.length <= 1) return;
      getEventSegmentsByWeek(eventDays, startPad).forEach(({ firstDay: fd, span }) => {
        const weekIndex = Math.floor((startPad + fd - 1) / 7);
        segments.push({ firstDay: fd, span, event, weekIndex });
      });
    });
    const byWeek = {};
    segments.forEach((segment) => {
      const weekKey = segment.weekIndex;
      if (!byWeek[weekKey]) byWeek[weekKey] = [];
      byWeek[weekKey].push(segment);
    });
    const rowEndByWeek = {};
    Object.keys(byWeek).forEach((week) => {
      const list = byWeek[week].sort((a, b) => {
        const firstDayDiff = a.firstDay - b.firstDay;
        if (firstDayDiff !== 0) return firstDayDiff;
        const eventDiff = compareDashboardEvents(a.event, b.event);
        if (eventDiff !== 0) return eventDiff;
        return b.span - a.span;
      });
      list.forEach((segment) => {
        const start = segment.firstDay;
        const end = segment.firstDay + segment.span - 1;
        let row = 0;
        while (true) {
          const lastEnd = rowEndByWeek[`${week}-${row}`] ?? -1;
          if (start > lastEnd) break;
          row += 1;
        }
        rowEndByWeek[`${week}-${row}`] = end;
        segment.rowIndex = row;
      });
    });
    return segments;
  }, [current.month, current.year, events, startPad]);
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
        return compareDashboardEvents(a.event, b.event);
      });
    });
    return byWeek;
  }, [segmentsWithRow]);
  const segmentRowCountByWeek = useMemo(() => {
    const map = {};
    Object.keys(segmentsByWeek).forEach((week) => {
      map[week] = segmentsByWeek[week].reduce((max, segment) => Math.max(max, Number(segment.rowIndex) || 0), -1) + 1;
    });
    return map;
  }, [segmentsByWeek]);

  return (
    <section className="project-dashboard-calendar">
      <div className="project-dashboard-calendar-head">
        <div className="project-dashboard-calendar-title-wrap">
          <div className="project-dashboard-calendar-breadcrumb">
            <span>Workspace</span>
            <span className="material-symbols-outlined project-dashboard-calendar-breadcrumb-chevron">chevron_right</span>
            <span className="project-dashboard-calendar-breadcrumb-current">Calendar</span>
          </div>
          <div className="project-dashboard-calendar-title-row">
            <h3>{formatDashboardCalendarTitle(current.year, current.month)}</h3>
            <div className="project-dashboard-calendar-nav">
              <button type="button" className="project-dashboard-calendar-nav-btn" onClick={onPrevMonth} aria-label="이전 달">
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <button type="button" className="project-dashboard-calendar-nav-btn" onClick={onNextMonth} aria-label="다음 달">
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>
          </div>
          <p className="project-dashboard-calendar-caption">프로젝트 시작일과 만료일 기준으로 표시됩니다.</p>
        </div>
      </div>

      <div className="project-dashboard-calendar-shell">
        <div className="project-dashboard-calendar-weekdays">
          {DASHBOARD_CALENDAR_WEEKDAYS.map((weekday) => (
            <div key={weekday}>{weekday}</div>
          ))}
        </div>

        {events.length === 0 ? <p className="project-dashboard-calendar-status">표시할 프로젝트 일정이 없습니다.</p> : null}

        <div className="project-dashboard-calendar-grid">
          {weeks.map((week, weekIndex) => {
            const segments = segmentsByWeek[weekIndex] || [];
            const segmentRows = segmentRowCountByWeek[weekIndex] || 0;
            const segmentBandHeight = segmentRows > 0 ? segmentRows * 24 + 8 : 0;
            return (
              <div key={`${current.year}-${current.month}-week-${weekIndex}`} className="project-dashboard-calendar-week-row">
                {segments.length ? (
                  <div className="project-dashboard-calendar-segments-overlay" style={{ height: `${segmentBandHeight}px` }}>
                    {segments.map((segment, segmentIndex) => (
                      <button
                        key={`${segment.event._id}-${segment.firstDay}-${segmentIndex}`}
                        type="button"
                        className={`project-dashboard-calendar-segment tone-${getDashboardCalendarEventTone(segment.event, segmentIndex)}`}
                        style={{
                          left: `${((segment.firstDay + startPad - 1) % 7) * (100 / 7)}%`,
                          width: `calc(${segment.span * (100 / 7)}% - 8px)`,
                          top: `${(segment.rowIndex || 0) * 24 + 4}px`
                        }}
                        title={segment.event.title}
                        onClick={() => onEventClick?.(segment.event)}
                      >
                        {segment.event.title}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="project-dashboard-calendar-week-cells" style={{ paddingTop: segmentBandHeight ? `${segmentBandHeight}px` : undefined }}>
                  {week.map((day, dayIndex) => {
                    const dayEvents = day ? (eventsByDay.get(day) || []) : [];
                    const isToday = day && isCurrentMonth && today.getDate() === day;
                    const isSunday = dayIndex === 0;
                    return (
                      <div
                        key={`${current.year}-${current.month}-${weekIndex}-${dayIndex}`}
                        className={`project-dashboard-calendar-cell ${day ? '' : 'is-empty'} ${isToday ? 'is-today' : ''}`}
                      >
                        {day ? (
                          <>
                            <span className={`project-dashboard-calendar-day ${isSunday ? 'is-sunday' : ''} ${isToday ? 'is-today' : ''}`}>{day}</span>
                            {isToday ? <span className="project-dashboard-calendar-today-dot" /> : null}
                            <div className={`project-dashboard-calendar-events ${segments.length ? 'has-segments' : ''}`}>
                              {dayEvents.slice(0, 3).map((event, eventIndex) => (
                                <button
                                  key={`${event._id}-${day}-${eventIndex}`}
                                  type="button"
                                  className={`project-dashboard-calendar-pill tone-${getDashboardCalendarEventTone(event, eventIndex)}`}
                                  title={event.title}
                                  onClick={() => onEventClick?.(event)}
                                >
                                  {event.title}
                                </button>
                              ))}
                              {dayEvents.length > 3 ? (
                                <div className="project-dashboard-calendar-more">+{dayEvents.length - 3} more</div>
                              ) : null}
                            </div>
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function DashboardView({
  dashboard,
  calendar,
  onCalendarPrevMonth,
  onCalendarNextMonth,
  onOpenProject
}) {
  const byStage = dashboard?.distribution?.byStage || {};
  const totalProjects = Number(dashboard?.distribution?.totalTasks) || 0;
  const milestones = Array.isArray(dashboard?.milestones) ? dashboard.milestones : [];
  const progressPct = totalProjects > 0 ? Math.round(((Number(byStage.progress) || 0) / totalProjects) * 100) : 0;
  const donePct = totalProjects > 0 ? Math.round(((Number(byStage.done) || 0) / totalProjects) * 100) : 0;
  const waitPct = totalProjects > 0 ? Math.round(((Number(byStage.todo) || 0) / totalProjects) * 100) : 0;
  const delayPct = totalProjects > 0 ? Math.round((Math.max(0, Number(dashboard?.stats?.delayedTasks) || 0) / totalProjects) * 100) : 0;

  return (
    <section className="project-view-stack">
      <section className="project-stats-grid">
        <StatCard label="전체 진행률" value={`${dashboard?.stats?.overallProgress || 0}%`} note="완료 기준 진행률" tone="primary" />
        <StatCard label="남은 프로젝트" value={String(dashboard?.stats?.remainingTasks || 0)} note="완료 전 프로젝트 수" tone="secondary" />
        <StatCard label="지연 프로젝트" value={String(dashboard?.stats?.delayedTasks || 0).padStart(2, '0')} note="예정일이 지난 진행 프로젝트" tone="danger" />
        <StatCard label="팀 업무량" value={`${dashboard?.stats?.teamWorkload || 0}%`} note="활성 프로젝트 비중 기반" tone="tertiary" />
      </section>

      <section className="project-split-grid">
        <article className="project-card">
          <header className="project-card-head">
            <h3>프로젝트 분포</h3>
            <span>이번 달</span>
          </header>
          <div className="project-distribution">
            <div className="project-donut">
              <strong>{totalProjects}</strong>
              <span>전체 프로젝트</span>
            </div>
            <ul className="project-legend">
              <li><i className="dot progress" /> 진행 중 {progressPct}%</li>
              <li><i className="dot done" /> 완료됨 {donePct}%</li>
              <li><i className="dot wait" /> 대기 중 {waitPct}%</li>
              <li><i className="dot delay" /> 지연 {delayPct}%</li>
            </ul>
          </div>
        </article>

        <article className="project-card">
          <header className="project-card-head">
            <h3>다가오는 주요 일정</h3>
          </header>
          <ul className="project-milestones">
            {milestones.length === 0 ? (
              <li><strong>표시할 주요 일정이 없습니다.</strong><span>프로젝트 만료일을 설정하면 자동 표시됩니다.</span></li>
            ) : milestones.map((m) => (
              <li key={`${m._id || m.title}-${m.date}`}>
                <button
                  type="button"
                  className="project-milestone-open"
                  onClick={() => onOpenProject?.(m)}
                >
                  <strong>{m.title}</strong>
                  <span>{new Date(m.date).toLocaleDateString('ko-KR')}</span>
                </button>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <DashboardCalendar
        current={calendar.current}
        events={calendar.events}
        onPrevMonth={onCalendarPrevMonth}
        onNextMonth={onCalendarNextMonth}
        onEventClick={onOpenProject}
      />
    </section>
  );
}

function KanbanView({
  columns,
  onTaskClick,
  onTaskDragStart,
  onTaskDragEnd,
  onColumnDragOver,
  onColumnDragLeave,
  onColumnDrop
}) {
  return (
    <div className="project-kanban-wrap">
      {columns.map((column) => (
        <section
          key={column.key}
          className={`project-kanban-column ${column.key === 'done' ? 'is-done' : ''}`}
          onDragOver={onColumnDragOver}
          onDragLeave={onColumnDragLeave}
          onDrop={(e) => onColumnDrop(e, column.key)}
        >
          <header className="project-kanban-head">
            <div className="project-kanban-head-title">
              <i className={`project-kanban-dot ${column.dot}`} />
              <h3>{column.title}</h3>
            </div>
            <span>{column.count}</span>
          </header>
          <div className="project-kanban-list">
            {column.items.map((item) => (
              <article
                key={String(item._id)}
                draggable
                onDragStart={(e) => onTaskDragStart(e, item)}
                onDragEnd={onTaskDragEnd}
                onClick={() => onTaskClick(item)}
                className={`project-kanban-card project-kanban-card--${column.key} project-kanban-card--priority-${item.priority === '높음' ? 'high' : item.priority === '낮음' ? 'low' : 'medium'}`}
              >
                <p className="project-kanban-tag">{item.tag}</p>
                <h4>{item.title}</h4>
                {item.description ? <p className="project-kanban-desc">{item.description}</p> : null}
                <div className="project-kanban-meta-grid">
                  <p className="project-kanban-meta">
                    <span className="material-symbols-outlined">event</span>
                    <span>완료일 {item.dueDate}</span>
                  </p>
                  <p className={`project-kanban-meta project-kanban-meta-priority project-kanban-meta-priority--${item.priority === '높음' ? 'high' : item.priority === '낮음' ? 'low' : 'medium'}`}>
                    <span className="material-symbols-outlined">priority_high</span>
                    <span>중요도 {item.priority}</span>
                  </p>
                  <p className="project-kanban-meta">
                    <span className="material-symbols-outlined">chat</span>
                    <span>댓글 {item.commentsCount}</span>
                  </p>
                  <p className="project-kanban-meta">
                    <span className="material-symbols-outlined">attachment</span>
                    <span>첨부 {item.attachments}</span>
                  </p>
                </div>
                <div className="project-kanban-participants" aria-label="참여자">
                  {(item.participants || []).slice(0, 3).map((p) => (
                    <span key={`${item._id}-${p.userId || p.name}`} className="project-avatar" title={p.name || ''}>
                      {getInitials(p.name)}
                    </span>
                  ))}
                  {(item.participants || []).length > 3 ? (
                    <span className="project-avatar project-avatar-more" title={`외 ${(item.participants || []).length - 3}명`}>
                      ...
                    </span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function GanttView({ tasks, onTaskClick }) {
  const scrollRef = useRef(null);
  const initialScrollDoneRef = useRef(false);
  const pendingLeftShiftPxRef = useRef(0);
  const [timelineRange, setTimelineRange] = useState(() => createInitialGanttRange());
  const [timelineLoadingSide, setTimelineLoadingSide] = useState('');
  const taskSignature = useMemo(
    () => (Array.isArray(tasks) ? tasks.map((task) => `${task._id}:${task.startDate || ''}:${task.dueDate || ''}`).join('|') : ''),
    [tasks]
  );

  useEffect(() => {
    setTimelineRange(createInitialGanttRange());
    setTimelineLoadingSide('');
    pendingLeftShiftPxRef.current = 0;
    initialScrollDoneRef.current = false;
  }, [taskSignature]);

  const timelineStart = timelineRange.start;
  const timelineEnd = timelineRange.end;
  const totalDays = diffDaysInclusive(timelineStart, timelineEnd);
  const timelineWidth = totalDays * GANTT_DAY_WIDTH;
  const today = startOfDay(new Date());

  const labels = useMemo(() => {
    const weeks = [];
    let cursor = startOfDay(timelineStart);
    let guard = 0;
    while (cursor <= timelineEnd && guard < 500) {
      const remainingDays = diffDaysInclusive(cursor, timelineEnd);
      const spanDays = Math.min(7, remainingDays);
      weeks.push({
        key: cursor.toISOString(),
        label: formatGanttWeekLabel(cursor),
        widthPx: spanDays * GANTT_DAY_WIDTH,
        isCurrentWeek: today >= cursor && today < new Date(cursor.getTime() + spanDays * 24 * 60 * 60 * 1000)
      });
      cursor = new Date(cursor.getTime() + 7 * 24 * 60 * 60 * 1000);
      guard += 1;
    }
    return weeks;
  }, [timelineEnd, timelineStart, today]);

  const todayOffsetPx = Math.min(
    Math.max(0, diffDaysFrom(timelineStart, today) * GANTT_DAY_WIDTH),
    Math.max(0, timelineWidth - GANTT_DAY_WIDTH)
  );

  const bars = useMemo(() => {
    return (Array.isArray(tasks) ? tasks : []).map((task, idx) => {
      const rawStart = task.startDate ? new Date(task.startDate) : (task.dueDate ? new Date(task.dueDate) : today);
      const rawEnd = task.dueDate ? new Date(task.dueDate) : rawStart;
      const taskStart = startOfDay(rawStart <= rawEnd ? rawStart : rawEnd);
      const taskEnd = endOfDay(rawEnd >= rawStart ? rawEnd : rawStart);
      if (taskEnd < timelineStart || taskStart > timelineEnd) return null;
      const visibleStart = taskStart < timelineStart ? timelineStart : taskStart;
      const visibleEnd = taskEnd > timelineEnd ? timelineEnd : taskEnd;
      return {
        ...task,
        leftPx: Math.max(0, diffDaysFrom(timelineStart, visibleStart) * GANTT_DAY_WIDTH),
        widthPx: Math.max(GANTT_DAY_WIDTH, diffDaysInclusive(visibleStart, visibleEnd) * GANTT_DAY_WIDTH),
        top: 24 + idx * 44
      };
    }).filter(Boolean);
  }, [tasks, timelineEnd, timelineStart, today]);

  const barsTrackMinPx = Math.max(280, 40 + Math.max(tasks.length, 1) * 44 + 32);

  useEffect(() => {
    if (!timelineLoadingSide) return;
    const frame = window.requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (!node) return;
      if (timelineLoadingSide === 'left' && pendingLeftShiftPxRef.current > 0) {
        node.scrollLeft += pendingLeftShiftPxRef.current;
      }
      pendingLeftShiftPxRef.current = 0;
      setTimelineLoadingSide('');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [timelineLoadingSide, timelineWidth]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || initialScrollDoneRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const targetLeft = Math.max(0, todayOffsetPx - node.clientWidth / 2);
      node.scrollLeft = targetLeft;
      initialScrollDoneRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [todayOffsetPx, timelineWidth]);

  const handleTimelineScroll = useCallback((e) => {
    if (timelineLoadingSide) return;
    const node = e.currentTarget;
    if (node.scrollLeft <= GANTT_SCROLL_EDGE_THRESHOLD) {
      const nextStart = startOfDay(addMonthsSafe(timelineStart, -GANTT_EDGE_LOAD_MONTHS));
      pendingLeftShiftPxRef.current = diffDaysFrom(nextStart, timelineStart) * GANTT_DAY_WIDTH;
      setTimelineLoadingSide('left');
      setTimelineRange((prev) => ({ ...prev, start: nextStart }));
      return;
    }
    const remainRight = node.scrollWidth - (node.scrollLeft + node.clientWidth);
    if (remainRight <= GANTT_SCROLL_EDGE_THRESHOLD) {
      const nextEnd = endOfDay(addMonthsSafe(timelineEnd, GANTT_EDGE_LOAD_MONTHS));
      setTimelineLoadingSide('right');
      setTimelineRange((prev) => ({ ...prev, end: nextEnd }));
    }
  }, [timelineEnd, timelineLoadingSide, timelineStart]);

  const handleTimelineWheel = useCallback((e) => {
    const node = scrollRef.current;
    if (!node || timelineLoadingSide) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    if (node.scrollWidth <= node.clientWidth + 1) return;

    e.preventDefault();

    if (e.deltaY < 0 && node.scrollLeft <= GANTT_SCROLL_EDGE_THRESHOLD) {
      const nextStart = startOfDay(addMonthsSafe(timelineStart, -GANTT_EDGE_LOAD_MONTHS));
      pendingLeftShiftPxRef.current = diffDaysFrom(nextStart, timelineStart) * GANTT_DAY_WIDTH;
      setTimelineLoadingSide('left');
      setTimelineRange((prev) => ({ ...prev, start: nextStart }));
      return;
    }

    const remainRight = node.scrollWidth - (node.scrollLeft + node.clientWidth);
    if (e.deltaY > 0 && remainRight <= GANTT_SCROLL_EDGE_THRESHOLD) {
      const nextEnd = endOfDay(addMonthsSafe(timelineEnd, GANTT_EDGE_LOAD_MONTHS));
      setTimelineLoadingSide('right');
      setTimelineRange((prev) => ({ ...prev, end: nextEnd }));
      return;
    }

    node.scrollLeft += e.deltaY;
  }, [timelineEnd, timelineLoadingSide, timelineStart]);

  return (
    <div className="project-gantt-shell">
      <aside className="project-gantt-tasks">
        <h3>프로젝트 목록</h3>
        {tasks.length === 0 ? <div className="project-gantt-task-group"><span>표시할 프로젝트가 없습니다.</span></div> : null}
        {tasks.map((task) => (
          <button
            key={task._id}
            type="button"
            className="project-gantt-task-group project-gantt-task-group--open"
            onClick={() => onTaskClick?.(task)}
          >
            <span className="project-gantt-task-title">{task.title}</span>
          </button>
        ))}
      </aside>
      <section className="project-gantt-grid">
        <div className="project-gantt-range-note">
          <span>Today 기준 과거·미래 2개월</span>
          {timelineLoadingSide ? <em>{timelineLoadingSide === 'left' ? '이전 기간 불러오는 중…' : '다음 기간 불러오는 중…'}</em> : null}
        </div>
        <div ref={scrollRef} className="project-gantt-scroll" onScroll={handleTimelineScroll} onWheel={handleTimelineWheel}>
          <div className="project-gantt-weeks" style={{ width: `${timelineWidth}px` }}>
            {labels.map((week) => (
              <span
                key={week.key}
                className={week.isCurrentWeek ? 'is-current' : ''}
                style={{ width: `${week.widthPx}px` }}
              >
                {week.label}
              </span>
            ))}
          </div>
          <div
            className="project-gantt-bars"
            style={{ width: `${timelineWidth}px`, minHeight: tasks.length ? `max(100%, ${barsTrackMinPx}px)` : '100%' }}
          >
            <div className="project-gantt-today-line" style={{ left: `${todayOffsetPx}px` }}>
              <span className="project-gantt-today-badge">Today</span>
            </div>
            {bars.map((bar) => (
              <button
                key={bar._id}
                type="button"
                className={`bar bar-${bar.stage || 'todo'} bar--interactive`}
                style={{ top: `${bar.top}px`, left: `${bar.leftPx}px`, width: `${bar.widthPx}px` }}
                onClick={() => onTaskClick?.(bar)}
                aria-label={`${bar.title || '프로젝트'} 일정 열기`}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default function Project() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = normalizeView(searchParams.get('view'));
  const today = useMemo(() => new Date(), []);
  const [board, setBoard] = useState(emptyBoard);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [teamMembers, setTeamMembers] = useState([]);
  const [companyContext, setCompanyContext] = useState({ name: '', businessNumber: '', driveRootUrl: '' });
  const [dashboardCalendarCurrent, setDashboardCalendarCurrent] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }));
  const [showProjectFormModal, setShowProjectFormModal] = useState(false);
  const [projectFormMode, setProjectFormMode] = useState('create');
  const [editingProject, setEditingProject] = useState(null);
  const [savingProject, setSavingProject] = useState(false);
  const kanbanDragIdRef = useRef('');
  const kanbanDraggedItemRef = useRef(null);
  const dragClickSuppressRef = useRef(false);
  const dragClickSuppressTimerRef = useRef(null);

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/projects/board`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '프로젝트 데이터를 불러오지 못했습니다.');
      setBoard({
        ...emptyBoard(),
        ...data,
        project: { ...emptyBoard().project, ...(data.project || {}) },
        dashboard: { ...emptyBoard().dashboard, ...(data.dashboard || {}) },
        kanban: { ...emptyBoard().kanban, ...(data.kanban || {}) },
        gantt: { ...emptyBoard().gantt, ...(data.gantt || {}) }
      });
    } catch (e) {
      setError(e.message || '프로젝트 데이터를 불러오지 못했습니다.');
      setBoard(emptyBoard());
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTeamMembers = useCallback(async () => {
    try {
      const headers = getAuthHeader();
      const [teamRes, overviewRes] = await Promise.all([
        fetch(`${API_BASE}/calendar-events/team-members`, { headers }),
        fetch(`${API_BASE}/companies/overview`, { headers })
      ]);
      const teamData = await teamRes.json().catch(() => ({}));
      const overviewData = await overviewRes.json().catch(() => ({}));
      const merged = buildParticipantDirectoryFromOverview(
        Array.isArray(teamData?.members) ? teamData.members : [],
        overviewData && typeof overviewData === 'object' ? overviewData : null
      );
      setTeamMembers(merged);
      setCompanyContext({
        name: String(overviewData?.company?.name || '').trim(),
        businessNumber: String(overviewData?.company?.businessNumber || '').trim(),
        driveRootUrl: String(overviewData?.company?.driveRootUrl || '').trim()
      });
    } catch {
      setTeamMembers([]);
      setCompanyContext({ name: '', businessNumber: '', driveRootUrl: '' });
    }
  }, []);

  useEffect(() => {
    fetchTeamMembers();
  }, [fetchTeamMembers]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchBoard();
    })();
    return () => { cancelled = true; };
  }, [fetchBoard]);

  const setView = (next) => {
    const params = new URLSearchParams(searchParams);
    params.set('view', next);
    setSearchParams(params, { replace: true });
  };

  const handleOpenCreateProject = () => {
    setProjectFormMode('create');
    setEditingProject(null);
    setShowProjectFormModal(true);
  };

  const currentUser = useMemo(() => {
    try {
      const raw = localStorage.getItem('crm_user');
      const user = raw ? JSON.parse(raw) : null;
      if (!user) return null;
      return { _id: user.id || user._id, name: user.name, email: user.email, avatar: user.avatar || '' };
    } catch {
      return null;
    }
  }, []);

  const handleDashboardCalendarPrevMonth = useCallback(() => {
    setDashboardCalendarCurrent((prev) => {
      const nextDate = new Date(prev.year, prev.month - 1, 1);
      return { year: nextDate.getFullYear(), month: nextDate.getMonth() };
    });
  }, []);

  const handleDashboardCalendarNextMonth = useCallback(() => {
    setDashboardCalendarCurrent((prev) => {
      const nextDate = new Date(prev.year, prev.month + 1, 1);
      return { year: nextDate.getFullYear(), month: nextDate.getMonth() };
    });
  }, []);

  const dashboardCalendarEvents = useMemo(
    () => (Array.isArray(board?.gantt?.tasks) ? board.gantt.tasks.map(normalizeProjectCalendarItem).filter(Boolean).sort(compareDashboardEvents) : []),
    [board?.gantt?.tasks]
  );

  const resolveBoardItemById = useCallback(
    (rawId) => {
      const sid = String(rawId || '').trim();
      if (!sid) return null;
      for (const col of board.kanban?.columns || []) {
        const hit = (col.items || []).find((item) => String(item._id) === sid);
        if (hit) return hit;
      }
      return null;
    },
    [board.kanban?.columns]
  );

  const handleOpenEditProject = useCallback(
    (projectItem) => {
      if (dragClickSuppressRef.current) return;
      const id = String(projectItem?._id || '').trim();
      const resolved = id ? resolveBoardItemById(id) : null;
      const item = resolved || projectItem;
      if (!item?._id) return;
      setProjectFormMode('edit');
      setEditingProject(item);
      setShowProjectFormModal(true);
    },
    [resolveBoardItemById]
  );

  const handleDashboardOpenProjectRef = useCallback(
    (ref) => {
      handleOpenEditProject(ref || {});
    },
    [handleOpenEditProject]
  );

  const handleSaveProject = async (payload) => {
    setSavingProject(true);
    try {
      const isEdit = projectFormMode === 'edit' && editingProject?._id;
      const isLegacyTask = editingProject?.entityType === 'legacyTask' && editingProject?.sourceProjectId;
      let path = `${API_BASE}/projects`;
      let method = 'POST';
      if (isEdit && isLegacyTask) {
        path = `${API_BASE}/projects/${encodeURIComponent(editingProject.sourceProjectId)}/tasks/${encodeURIComponent(editingProject._id)}`;
        method = 'PATCH';
      } else if (isEdit) {
        path = `${API_BASE}/projects/${encodeURIComponent(editingProject._id)}`;
        method = 'PATCH';
      }
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '프로젝트 저장에 실패했습니다.');
      setShowProjectFormModal(false);
      setEditingProject(null);
      await fetchBoard();
    } catch (err) {
      window.alert(err.message || '프로젝트 저장에 실패했습니다.');
    } finally {
      setSavingProject(false);
    }
  };

  const tabSearchString = useMemo(() => {
    return (tabKey) => {
      const p = new URLSearchParams();
      p.set('view', tabKey);
      return `?${p.toString()}`;
    };
  }, []);

  const handleKanbanTaskDragStart = useCallback((e, item) => {
    const id = String(item?._id || '').trim();
    if (!id) return;
    if (dragClickSuppressTimerRef.current) {
      clearTimeout(dragClickSuppressTimerRef.current);
      dragClickSuppressTimerRef.current = null;
    }
    dragClickSuppressRef.current = false;
    kanbanDragIdRef.current = id;
    kanbanDraggedItemRef.current = item || null;
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', id);
    } catch (_) {}
    e.currentTarget.classList.add('project-kanban-card-dragging');
  }, []);

  const handleKanbanTaskDragEnd = useCallback((e) => {
    e.currentTarget.classList.remove('project-kanban-card-dragging');
    dragClickSuppressRef.current = true;
    if (dragClickSuppressTimerRef.current) clearTimeout(dragClickSuppressTimerRef.current);
    dragClickSuppressTimerRef.current = setTimeout(() => {
      dragClickSuppressRef.current = false;
      dragClickSuppressTimerRef.current = null;
    }, 180);
  }, []);

  useEffect(() => () => {
    if (dragClickSuppressTimerRef.current) clearTimeout(dragClickSuppressTimerRef.current);
  }, []);

  const handleKanbanColumnDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('project-kanban-drop-hover');
  }, []);

  const handleKanbanColumnDragLeave = useCallback((e) => {
    e.currentTarget.classList.remove('project-kanban-drop-hover');
  }, []);

  const handleKanbanColumnDrop = useCallback(
    async (e, targetStage) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.classList.remove('project-kanban-drop-hover');
      let droppedTaskId = '';
      try {
        droppedTaskId = String(e.dataTransfer.getData('text/plain') || '').trim();
      } catch (_) {}
      const itemId = String(droppedTaskId || kanbanDragIdRef.current || '').trim();
      if (!itemId) return;

      let snapshot = null;
      let draggedItem = kanbanDraggedItemRef.current;
      let shouldPatch = false;
      setBoard((prev) => {
        const cols = prev.kanban?.columns || [];
        let fromStage = null;
        for (const c of cols) {
          const matched = (c.items || []).find((item) => String(item._id) === itemId);
          if (matched) {
            fromStage = c.key;
            draggedItem = matched;
            break;
          }
        }
        if (!fromStage || fromStage === targetStage) return prev;
        shouldPatch = true;
        snapshot = prev;
        const nextCols = moveItemBetweenColumns(cols, itemId, targetStage);
        return { ...prev, kanban: { ...prev.kanban, columns: nextCols } };
      });

      if (!shouldPatch) return;

      try {
        const isLegacyTask = draggedItem?.entityType === 'legacyTask' && draggedItem?.sourceProjectId;
        const path = isLegacyTask
          ? `${API_BASE}/projects/${encodeURIComponent(draggedItem.sourceProjectId)}/tasks/${encodeURIComponent(itemId)}/stage`
          : `${API_BASE}/projects/${encodeURIComponent(itemId)}/stage`;
        const res = await fetch(path, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify({ stage: targetStage })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '단계 변경에 실패했습니다.');
        fetchBoard().catch(() => {});
      } catch (err) {
        if (snapshot) setBoard(snapshot);
        window.alert(err.message || '단계 변경에 실패했습니다.');
      } finally {
        kanbanDragIdRef.current = '';
        kanbanDraggedItemRef.current = null;
      }
    },
    [fetchBoard]
  );

  const projectStageOptions = useMemo(
    () => (board.kanban?.columns || []).map((c) => ({ value: c.key, label: c.title })),
    [board.kanban?.columns]
  );

  return (
    <div className={`page project-page ${view === 'gantt' ? 'project-page--gantt' : ''} ${view === 'kanban' ? 'project-page--kanban' : ''}`}>
      <header className="page-header">
        <div className="header-search">
          <button type="submit" form="project-search-form" className="header-search-icon-btn" aria-label="검색">
            <span className="material-symbols-outlined">search</span>
          </button>
          <form id="project-search-form" className="header-search-form" onSubmit={(e) => e.preventDefault()}>
            <input type="text" placeholder="프로젝트 검색…" aria-label="프로젝트 검색" />
          </form>
        </div>
        <div className="header-actions">
          <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" />
        </div>
      </header>

      <div className="page-content">
        <div className="project-topbar">
          <div>
            <p className="project-breadcrumb">일정 / 프로젝트</p>
            <h1>프로젝트</h1>
            <p className="project-subtitle">프로젝트 진행 상황을 한눈에 확인하고 일정 관리를 쉽게 할 수 있습니다.</p>
          </div>
          <div className="project-topbar-aside">
            <div className="project-toolbar">
              <button type="button" className="btn-primary" onClick={handleOpenCreateProject} disabled={loading}>
                <span className="material-symbols-outlined">add</span>
                프로젝트 추가
              </button>
            </div>
            <nav className="project-tabs" aria-label="프로젝트 뷰 선택">
              {TABS.map((tab) => (
                <NavLink
                  key={tab.key}
                  to={tabSearchString(tab.key)}
                  onClick={(e) => {
                    e.preventDefault();
                    setView(tab.key);
                  }}
                  className={`project-tab ${view === tab.key ? 'active' : ''}`}
                >
                  {tab.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>

        {loading ? <p className="project-loading-msg">프로젝트 데이터를 불러오는 중입니다…</p> : null}
        {!loading && error ? <p className="project-error-msg">{error}</p> : null}
        {!loading && !error && view === 'dashboard' ? (
          <DashboardView
            dashboard={board.dashboard}
            calendar={{
              current: dashboardCalendarCurrent,
              events: dashboardCalendarEvents
            }}
            onCalendarPrevMonth={handleDashboardCalendarPrevMonth}
            onCalendarNextMonth={handleDashboardCalendarNextMonth}
            onOpenProject={handleDashboardOpenProjectRef}
          />
        ) : null}
        {!loading && !error && view === 'kanban' ? (
          <KanbanView
            columns={board.kanban?.columns || []}
            onTaskClick={handleOpenEditProject}
            onTaskDragStart={handleKanbanTaskDragStart}
            onTaskDragEnd={handleKanbanTaskDragEnd}
            onColumnDragOver={handleKanbanColumnDragOver}
            onColumnDragLeave={handleKanbanColumnDragLeave}
            onColumnDrop={handleKanbanColumnDrop}
          />
        ) : null}
        {!loading && !error && view === 'gantt' ? (
          <div className="project-gantt-viewport">
            <GanttView tasks={board.gantt?.tasks || []} onTaskClick={handleDashboardOpenProjectRef} />
          </div>
        ) : null}
      </div>

      {showProjectFormModal ? (
        <ProjectFormModal
          mode={projectFormMode}
          companyContext={companyContext}
          teamMembers={teamMembers}
          currentUser={currentUser}
          stageOptions={projectStageOptions}
          initialProject={projectFormMode === 'edit' ? editingProject : null}
          saving={savingProject}
          onSubmit={handleSaveProject}
          onClose={() => {
            if (savingProject) return;
            setShowProjectFormModal(false);
            setEditingProject(null);
          }}
        />
      ) : null}
    </div>
  );
}
