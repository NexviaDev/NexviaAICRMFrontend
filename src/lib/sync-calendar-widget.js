/**
 * Capacitor Android 홈 화면 캘린더 위젯에 오늘 일정을 동기화합니다.
 * 브라우저·PWA 에서는 no-op 입니다.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

const CalendarWidget = registerPlugin('CalendarWidget');

const MAX_EVENTS = 5;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toDate(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'object' && value.$date != null) {
    const d = new Date(value.$date);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfLocalDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfLocalDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function formatHeaderDate(d = new Date()) {
  const w = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${w})`;
}

function formatEventTime(ev) {
  if (ev?.allDay) return '종일';
  const start = toDate(ev?.start);
  if (!start) return '종일';
  const end = toDate(ev?.end);
  if (end && end.getTime() - start.getTime() >= 23 * 60 * 60 * 1000) return '종일';
  return `${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
}

function eventId(ev) {
  return String(ev?._id || ev?.id || '');
}

/**
 * @param {Array<object>} events 캘린더 raw/표시용 이벤트 배열
 */
export async function syncCalendarWidget(events) {
  if (!Capacitor.isNativePlatform()) return;
  if (Capacitor.getPlatform() !== 'android') return;

  const dayStart = startOfLocalDay();
  const dayEnd = endOfLocalDay();
  const list = Array.isArray(events) ? events : [];

  const todays = list
    .map((ev) => {
      const start = toDate(ev?.start);
      const end = toDate(ev?.end) || start;
      if (!start) return null;
      const touchesToday = start.getTime() <= dayEnd.getTime() && (end?.getTime?.() ?? start.getTime()) >= dayStart.getTime();
      if (!touchesToday) return null;
      return {
        id: eventId(ev),
        time: formatEventTime(ev),
        title: String(ev?.title || '').trim() || '(제목 없음)',
        startMs: start.getTime()
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, MAX_EVENTS)
    .map(({ id, time, title }) => ({ id, time, title }));

  const payload = JSON.stringify({
    header: 'Nexvia 캘린더',
    subtitle: formatHeaderDate(dayStart),
    events: todays,
    updatedAt: Date.now()
  });

  try {
    await CalendarWidget.updateEvents({ payload });
  } catch {
    /* 위젯 미설치·구버전 앱 등은 무시 */
  }
}

export async function clearCalendarWidget() {
  if (!Capacitor.isNativePlatform()) return;
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    await CalendarWidget.clearEvents();
  } catch {
    /* ignore */
  }
}
