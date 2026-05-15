import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import '../../calendar/calendar.css';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** calendar.js 의 eventPillClass 와 동일 규칙(제목·해시 기반 변주) */
function markPillClass(title, salt) {
  const t = String(title || '').toLowerCase();
  if (t.includes('urgent') || t.includes('긴급')) return 'calendar-event-pill--urgent';
  const h = String(salt || title || 'x')
    .split('')
    .reduce((a, c) => a + c.charCodeAt(0), 0);
  const n = h % 4;
  if (n === 0) return 'calendar-event-pill--primary';
  if (n === 1) return 'calendar-event-pill--tertiary';
  if (n === 2) return 'calendar-event-pill--secondary';
  return 'calendar-event-pill--mint';
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 기회 모달 일정 탭용 — calendar.js 월간 격자·스타일을 재사용(Google·CRM API 없음).
 * @param {{ ymd: string, title: string }[]} marks
 * @param {(ymd: string) => void} [onDayClick] 날짜 셀 클릭 시 YYYY-MM-DD
 * @param {string} [resetKey] 기회 전환 시 달력 월을 다시 맞출 때 사용(예: oppId)
 */
export function OpportunityModalScheduleCalendar({ marks = [], onDayClick, resetKey = '' }) {
  const anchorMonth = useMemo(() => {
    for (const m of marks) {
      const ymd = String(m?.ymd || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
        const y = Number(ymd.slice(0, 4));
        const mo = Number(ymd.slice(5, 7)) - 1;
        if (!Number.isNaN(y) && mo >= 0 && mo <= 11) return { year: y, month: mo };
      }
    }
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  }, [marks]);

  const [current, setCurrent] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const anchorKeyRef = useRef('');
  const prevResetKeyRef = useRef(resetKey);
  const anchorKey = `${anchorMonth.year}-${anchorMonth.month}`;
  useEffect(() => {
    if (prevResetKeyRef.current !== resetKey) {
      prevResetKeyRef.current = resetKey;
      anchorKeyRef.current = '';
    }
    if (anchorKeyRef.current === anchorKey) return;
    anchorKeyRef.current = anchorKey;
    setCurrent(anchorMonth);
  }, [resetKey, anchorKey, anchorMonth]);

  const firstDay = new Date(current.year, current.month, 1);
  const lastDay = new Date(current.year, current.month + 1, 0);
  const startPad = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const totalCells = Math.ceil((startPad + daysInMonth) / 7) * 7;
  const flatDays = Array.from({ length: totalCells }, (_, i) => {
    const dayNum = i - startPad + 1;
    return dayNum < 1 || dayNum > daysInMonth ? null : dayNum;
  });

  const weeks = useMemo(() => {
    const rows = [];
    for (let i = 0; i < flatDays.length; i += 7) rows.push(flatDays.slice(i, i + 7));
    return rows;
  }, [flatDays]);

  const marksByDay = useMemo(() => {
    const prefix = `${current.year}-${pad2(current.month + 1)}-`;
    const map = {};
    for (const m of marks) {
      const ymd = String(m?.ymd || '').trim();
      if (!ymd.startsWith(prefix)) continue;
      const d = parseInt(ymd.slice(prefix.length), 10);
      if (Number.isNaN(d) || d < 1 || d > 31) continue;
      if (!map[d]) map[d] = [];
      map[d].push({ title: String(m.title || '').trim() || '일정', ymd });
    }
    return map;
  }, [marks, current.year, current.month]);

  const prevMonth = useCallback(() => {
    setCurrent((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { ...c, month: c.month - 1 }));
  }, []);
  const nextMonth = useCallback(() => {
    setCurrent((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { ...c, month: c.month + 1 }));
  }, []);

  const monthTitle = `${current.year}년 ${current.month + 1}월`;
  const now = new Date();
  const isTodayCell = (d) =>
    d != null && d === now.getDate() && current.month === now.getMonth() && current.year === now.getFullYear();

  return (
    <div
      className="opp-embed-calendar-root calendar-page calendar-page--embedded"
      aria-label="기회 일정 월 달력"
      title={onDayClick ? '날짜를 누르면 구매 예정 날짜에 반영됩니다.' : undefined}
    >
      <div className="page-content calendar-page-content calendar-page-content--embedded">
        <div className="calendar-shell">
          <div className="calendar-hero">
            <div className="calendar-hero-main">
              <div className="calendar-title-block">
                <h2 className="calendar-month-headline">{monthTitle}</h2>
                <div className="calendar-round-nav">
                  <button type="button" className="calendar-round-nav-btn" onClick={prevMonth} aria-label="이전 달">
                    <span className="material-symbols-outlined">chevron_left</span>
                  </button>
                  <button type="button" className="calendar-round-nav-btn" onClick={nextMonth} aria-label="다음 달">
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="calendar-panel-card calendar-panel-card--embedded">
            <div className="calendar-grid">
              <div className="calendar-weekday-row">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="calendar-weekday">
                    {w}
                  </div>
                ))}
              </div>
              {weeks.map((weekDays, weekIndex) => (
                <div key={`opp-cal-week-${weekIndex}`} className="calendar-week-row">
                  <div className="calendar-week-days">
                    {weekDays.map((d, dayIndex) => {
                      const isToday = isTodayCell(d);
                      const isSunday = dayIndex === 0;
                      const isSaturday = dayIndex === 6;
                      const evs = d != null ? marksByDay[d] || [] : [];
                      const ymd =
                        d != null ? `${current.year}-${pad2(current.month + 1)}-${pad2(d)}` : '';
                      return (
                        <div
                          key={`opp-cal-${weekIndex}-${dayIndex}`}
                          className={`calendar-day ${d == null ? 'empty' : ''} ${isToday ? 'today' : ''} ${isSunday ? 'sun' : ''} ${isSaturday ? 'sat' : ''}`}
                          role={d != null && onDayClick ? 'button' : undefined}
                          tabIndex={d != null && onDayClick ? 0 : undefined}
                          onClick={() => {
                            if (d != null && onDayClick) onDayClick(ymd);
                          }}
                          onKeyDown={(e) => {
                            if (d != null && onDayClick && (e.key === 'Enter' || e.key === ' ')) {
                              e.preventDefault();
                              onDayClick(ymd);
                            }
                          }}
                        >
                          {d != null && (
                            <span className={`calendar-day-num ${isToday ? 'calendar-day-num--today' : ''}`}>{d}</span>
                          )}
                          {d != null && evs.length > 0 && (
                            <div className="calendar-day-body">
                              <ul className="calendar-events">
                                {evs.slice(0, 4).map((ev, evIdx) => (
                                  <li
                                    key={`${ev.ymd}-${ev.title}-${evIdx}`}
                                    className={`calendar-event ${markPillClass(ev.title, `${ev.ymd}-${evIdx}`)} all-day`}
                                    title={ev.title}
                                  >
                                    {ev.title}
                                  </li>
                                ))}
                                {evs.length > 4 && (
                                  <li className="calendar-more-item">
                                    <span className="calendar-more-btn" style={{ pointerEvents: 'none' }}>
                                      +{evs.length - 4}
                                    </span>
                                  </li>
                                )}
                              </ul>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
