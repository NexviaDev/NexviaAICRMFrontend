/**
 * 일정 알림 — Google Calendar 규칙 + 사용자 **로컬(기기) 시간대**
 * - 종일: 시작일 달력 날짜 기준 오전 9시(로컬)
 * - 시간 일정: 시작 일시(로컬) 기준 N분/시간 전
 */

export const CALENDAR_ALL_DAY_ANCHOR_HOUR = 9;

/** 브라우저 IANA 시간대 (예: Asia/Seoul, America/Los_Angeles) */
export function getClientTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/** UI용 짧은 표기 */
export function getClientTimeZoneLabel() {
  const tz = getClientTimeZone();
  if (!tz) return '로컬 시간';
  try {
    const offset = new Intl.DateTimeFormat('ko-KR', {
      timeZone: tz,
      timeZoneName: 'shortOffset'
    })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    return offset ? `${tz} (${offset})` : tz;
  } catch {
    return tz;
  }
}

/** Google Calendar API — 종일 판별 */
export function isGoogleCalendarAllDayStart(start) {
  if (!start || typeof start !== 'object') return false;
  return Boolean(start.date) && !start.dateTime;
}

export function isEffectiveAllDay({ allDay, googleStart } = {}) {
  if (allDay === true) return true;
  if (allDay === false) return false;
  if (googleStart) return isGoogleCalendarAllDayStart(googleStart);
  return false;
}

export const REMINDER_OPTIONS_TIMED = [
  { value: 0, label: '정시 (시작 시각)' },
  { value: 5, label: '5분 전' },
  { value: 10, label: '10분 전' },
  { value: 30, label: '30분 전' },
  { value: 60, label: '1시간 전' },
  { value: 120, label: '2시간 전' },
  { value: 1440, label: '1일 전' }
];

export const REMINDER_OPTIONS_ALL_DAY = [
  { value: 0, label: '당일 오전 9시' },
  { value: 60, label: '당일 오전 8시' },
  { value: 1440, label: '1일 전 오전 9시' },
  { value: 2880, label: '2일 전 오전 9시' },
  { value: 10080, label: '1주일 전 오전 9시' }
];

export const DEFAULT_REMINDER_MINUTES_TIMED = 10;
export const DEFAULT_REMINDER_MINUTES_ALL_DAY = 1440;

export const REMINDER_ALLOWED_MINUTES = new Set([
  ...REMINDER_OPTIONS_TIMED.map((o) => o.value),
  ...REMINDER_OPTIONS_ALL_DAY.map((o) => o.value)
]);

export function getReminderOptions(allDay) {
  return allDay ? REMINDER_OPTIONS_ALL_DAY : REMINDER_OPTIONS_TIMED;
}

export function normalizeReminderMinutes(allDay, raw) {
  const n = Number(raw);
  if (Number.isFinite(n) && REMINDER_ALLOWED_MINUTES.has(n)) {
    return getReminderOptions(allDay).some((o) => o.value === n)
      ? n
      : allDay
        ? DEFAULT_REMINDER_MINUTES_ALL_DAY
        : DEFAULT_REMINDER_MINUTES_TIMED;
  }
  return allDay ? DEFAULT_REMINDER_MINUTES_ALL_DAY : DEFAULT_REMINDER_MINUTES_TIMED;
}

/** YYYY-MM-DD — 로컬 달력 날짜 */
export function formatYmdLocal(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 종일: 달력 날짜 YMD + 로컬 오전 anchorHour 시각 */
export function allDayAnchorLocal(ymd, anchorHour = CALENDAR_ALL_DAY_ANCHOR_HOUR) {
  const parts = String(ymd || '')
    .trim()
    .split('-')
    .map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d, anchorHour, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function reminderBaseDateFromForm(form) {
  if (!form) return null;
  if (form.allDay) {
    return allDayAnchorLocal(form.startDate, CALENDAR_ALL_DAY_ANCHOR_HOUR);
  }
  const datePart = String(form.startDate || '').trim();
  const timePart = String(form.startTime || '09:00').trim().slice(0, 5);
  if (!datePart) return null;
  const d = new Date(`${datePart}T${timePart}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function reminderBaseDateFromStored(start, allDay) {
  const startDate = start instanceof Date ? start : new Date(start);
  if (Number.isNaN(startDate.getTime())) return null;
  if (!allDay) return startDate;
  return allDayAnchorLocal(formatYmdLocal(startDate), CALENDAR_ALL_DAY_ANCHOR_HOUR);
}

export function computeReminderAt(allDay, startOrForm, minutesBefore) {
  const base =
    typeof startOrForm === 'object' &&
    startOrForm !== null &&
    !((startOrForm instanceof Date) || typeof startOrForm === 'string')
      ? reminderBaseDateFromForm(startOrForm)
      : reminderBaseDateFromStored(startOrForm, allDay);
  if (!base || Number.isNaN(base.getTime())) return null;
  const minutes = normalizeReminderMinutes(allDay, minutesBefore);
  return new Date(base.getTime() - minutes * 60 * 1000);
}

export function formatReminderOptionLabel(allDay, minutes) {
  const opts = getReminderOptions(allDay);
  const n = Number(minutes);
  return opts.find((o) => o.value === n)?.label || `${n}분 전`;
}

const LOCAL_DT_OPTS = {
  month: 'short',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit'
};

export function formatReminderFirePreview(form) {
  if (!form?.reminderEnabled) return '';
  const at = computeReminderAt(!!form.allDay, form, form.reminderMinutesBefore);
  if (!at || Number.isNaN(at.getTime())) return '';
  return at.toLocaleString('ko-KR', LOCAL_DT_OPTS);
}

/** 공개범위에 따른 푸시 수신 대상 안내 (event-modal 공개범위·알림 카드 공통) */
export function getReminderPushAudienceLabel(visibility, participantCount = 0) {
  const vis = String(visibility || 'company').trim();
  if (vis === 'company') return '회사 전체(사이드바 알림을 켠 직원)';
  if (vis === 'private') return '작성자 본인';
  if (vis === 'team') {
    const n = Number(participantCount) || 0;
    return n > 0 ? `작성자 + 참여자 ${n}명` : '작성자(참여자 선택 시 함께 수신)';
  }
  return '작성자';
}

export function formatReminderSummaryForEvent(ev) {
  if (!ev?.reminderEnabled) return '사용 안 함';
  const allDay = !!ev.allDay;
  const label = formatReminderOptionLabel(allDay, ev.reminderMinutesBefore);
  const audience = getReminderPushAudienceLabel(ev.visibility, ev.participants?.length ?? 0);
  const at =
    ev.reminderAt && !Number.isNaN(new Date(ev.reminderAt).getTime())
      ? new Date(ev.reminderAt)
      : computeReminderAt(allDay, ev.start, ev.reminderMinutesBefore);
  if (!at || Number.isNaN(at.getTime())) return `${label} · 수신: ${audience}`;
  const when = at.toLocaleString('ko-KR', LOCAL_DT_OPTS);
  return `${label} · ${when} · 수신: ${audience}`;
}

/** CRM 저장 시 서버에 전달 — forceEnable: 회사 CRM 일정은 푸시 알림 필수 */
export function buildReminderPayloadFromForm(form, options = {}) {
  const allDay = !!form?.allDay;
  const forceEnable = options?.forceEnable === true;
  const enabled = forceEnable ? true : !!form?.reminderEnabled;
  const minutes = normalizeReminderMinutes(allDay, form?.reminderMinutesBefore);
  const tz = getClientTimeZone();
  if (!enabled) {
    return {
      reminderEnabled: false,
      reminderMinutesBefore: minutes,
      reminderAt: null,
      reminderTimeZone: tz || undefined
    };
  }
  const at = computeReminderAt(allDay, form, minutes);
  return {
    reminderEnabled: true,
    reminderMinutesBefore: minutes,
    reminderAt: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null,
    reminderTimeZone: tz || undefined
  };
}
