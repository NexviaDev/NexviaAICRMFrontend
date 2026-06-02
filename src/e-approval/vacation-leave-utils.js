/** 휴가(전자결재) 공통 — 유형·시간대·일수 자동 계산 */

export const LEAVE_TYPES = [
  { value: 'annual', label: '연차' },
  { value: 'half', label: '반차' },
  { value: 'quarter', label: '반반차' },
  { value: 'sick', label: '병가' },
  { value: 'other', label: '기타' }
];

export const LEAVE_LABEL = {
  annual: '연차',
  half: '반차',
  quarter: '반반차',
  sick: '병가',
  other: '기타'
};

export const HALF_PERIOD_OPTIONS = [
  { value: 'am', label: '오전 반차', timeLabel: '09:00 – 13:00' },
  { value: 'pm', label: '오후 반차', timeLabel: '14:00 – 18:00' }
];

export const QUARTER_PERIOD_OPTIONS = [
  { value: 'am1', label: '오전 1부 (09:00–11:00)', timeLabel: '09:00 – 11:00' },
  { value: 'am2', label: '오전 2부 (11:00–13:00)', timeLabel: '11:00 – 13:00' },
  { value: 'pm1', label: '오후 1부 (14:00–16:00)', timeLabel: '14:00 – 16:00' },
  { value: 'pm2', label: '오후 2부 (16:00–18:00)', timeLabel: '16:00 – 18:00' }
];

export function todayDateInputValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function toDateInputValue(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}[T\s].*$/.test(s)) return s.slice(0, 10);
    if (/^\d{8}$/.test(s)) {
      const y = Number(s.slice(0, 4));
      const m = Number(s.slice(4, 6));
      const d = Number(s.slice(6, 8));
      const dt = new Date(y, m - 1, d);
      if (
        Number.isInteger(y) &&
        y >= 1000 &&
        y <= 9999 &&
        dt.getFullYear() === y &&
        dt.getMonth() + 1 === m &&
        dt.getDate() === d
      ) {
        return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
      return '';
    }
    // 임의 문자열(예: "2", "2025-0")은 Date 생성자로 해석하지 않는다.
    return '';
  }
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return '';
  const year = dt.getFullYear();
  if (year < 1000 || year > 9999) return '';
  return todayDateInputValue(dt);
}

/**
 * 날짜 텍스트 입력 보정:
 * - 숫자만 기준으로 YYYY-MM-DD 형태를 만든다.
 * - 연도는 4자리까지만 허용한다.
 * - 8자리 완성 시 월/일 범위를 보정한다.
 */
export function normalizeDateTypingValue(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 8);
  const y = digits.slice(0, 4);
  let m = digits.slice(4, 6);
  let d = digits.slice(6, 8);

  if (m.length === 2) {
    const monthNum = Number(m);
    if (!Number.isNaN(monthNum)) {
      m = String(Math.min(12, Math.max(1, monthNum))).padStart(2, '0');
    }
  }

  if (y.length === 4 && m.length === 2 && d.length === 2) {
    const yearNum = Number(y);
    const monthNum = Number(m);
    const dayNum = Number(d);
    if (!Number.isNaN(yearNum) && !Number.isNaN(monthNum) && !Number.isNaN(dayNum)) {
      const lastDay = new Date(yearNum, monthNum, 0).getDate();
      d = String(Math.min(lastDay, Math.max(1, dayNum))).padStart(2, '0');
    }
  }

  if (!y) return '';
  if (!m) return y;
  if (!d) return `${y}-${m}`;
  return `${y}-${m}-${d}`;
}

function parseDateInput(s) {
  const v = toDateInputValue(s);
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isPartialDayLeave(leaveType) {
  return leaveType === 'half' || leaveType === 'quarter';
}

function diffInclusiveCalendarDays(startDate, endDate) {
  const s = parseDateInput(startDate);
  const e = parseDateInput(endDate);
  if (!s || !e) return null;
  const diff = Math.floor((e.getTime() - s.getTime()) / 86400000);
  if (diff < 0) return null;
  return diff + 1;
}

function resolvePeriodOption(leaveType, halfPeriod, quarterPeriod) {
  if (leaveType === 'half') {
    return HALF_PERIOD_OPTIONS.find((o) => o.value === halfPeriod) || HALF_PERIOD_OPTIONS[0];
  }
  if (leaveType === 'quarter') {
    return QUARTER_PERIOD_OPTIONS.find((o) => o.value === quarterPeriod) || QUARTER_PERIOD_OPTIONS[0];
  }
  return null;
}

/** 휴가 formData — 날짜·일수·시간대 자동 정규화 */
export function normalizeVacationFormData(raw = {}) {
  const today = todayDateInputValue();
  const leaveType = LEAVE_TYPES.some((t) => t.value === raw.leaveType) ? raw.leaveType : 'annual';
  let startDate = toDateInputValue(raw.startDate) || today;
  let endDate = toDateInputValue(raw.endDate) || startDate;
  const halfPeriod = raw.halfPeriod === 'pm' ? 'pm' : 'am';
  const quarterPeriod = ['am1', 'am2', 'pm1', 'pm2'].includes(raw.quarterPeriod) ? raw.quarterPeriod : 'am1';

  if (isPartialDayLeave(leaveType)) {
    endDate = startDate;
    const opt = resolvePeriodOption(leaveType, halfPeriod, quarterPeriod);
    const parts = String(opt.timeLabel).split('–').map((s) => s.trim());
    return {
      leaveType,
      startDate,
      endDate,
      days: leaveType === 'half' ? 0.5 : 0.25,
      halfPeriod: leaveType === 'half' ? opt.value : halfPeriod,
      quarterPeriod: leaveType === 'quarter' ? opt.value : quarterPeriod,
      timeFrom: parts[0] || '',
      timeTo: parts[1] || '',
      timeLabel: opt.timeLabel,
      reason: String(raw.reason || '').trim()
    };
  }

  if (parseDateInput(endDate) < parseDateInput(startDate)) {
    endDate = startDate;
  }
  const days = diffInclusiveCalendarDays(startDate, endDate);

  return {
    leaveType,
    startDate,
    endDate,
    days: days != null ? days : 1,
    halfPeriod,
    quarterPeriod,
    timeFrom: '',
    timeTo: '',
    timeLabel: '',
    reason: String(raw.reason || '').trim()
  };
}

export function formatVacationTimeDisplay(formData) {
  if (!formData || !isPartialDayLeave(formData.leaveType)) return '';
  if (formData.timeLabel) return formData.timeLabel;
  if (formData.timeFrom && formData.timeTo) return `${formData.timeFrom} – ${formData.timeTo}`;
  return '';
}

/** 신청 일수 — "총 N일" (0.5·0.25 포함) */
export function formatVacationDaysLabel(days) {
  if (days == null || days === '') return '—';
  const n = Number(days);
  if (Number.isNaN(n)) return '—';
  return `총 ${n}일`;
}

/** 시작·종료일 한 칸 표시 (반차·반반차는 휴가일만) */
export function formatVacationDateRangeLabel(startDate, endDate, leaveType) {
  const start = toDateInputValue(startDate);
  if (!start) return '—';
  if (isPartialDayLeave(leaveType)) return start;
  const end = toDateInputValue(endDate) || start;
  return end === start ? start : `${start} ~ ${end}`;
}
