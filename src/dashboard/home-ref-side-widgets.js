import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '@/config';
import { crmFetchInit } from '@/lib/crm-auth';

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

function startOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** 이번 주 월~금 (로컬) */
function getWorkWeekDays(now = new Date()) {
  const today = startOfLocalDay(now);
  const day = today.getDay(); // 0 Sun
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = addDays(today, mondayOffset);
  return Array.from({ length: 5 }, (_, i) => addDays(monday, i));
}

function formatWeekLabel(days) {
  if (!days?.length) return '';
  const first = days[0];
  const y = first.getFullYear();
  const m = String(first.getMonth() + 1).padStart(2, '0');
  const weekNo = Math.ceil(first.getDate() / 7);
  return `${y}.${m} (${weekNo}주차)`;
}

function eventStartDate(ev) {
  const raw = ev?.start || ev?.startAt || ev?.date || ev?.beginAt;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatMeetingWhen(ev) {
  const d = eventStartDate(ev);
  if (!d) return '일정';
  const today = startOfLocalDay(new Date());
  const tomorrow = addDays(today, 1);
  const day = startOfLocalDay(d);
  let dayLabel = `${d.getMonth() + 1}/${d.getDate()}`;
  if (day.getTime() === today.getTime()) dayLabel = '오늘';
  else if (day.getTime() === tomorrow.getTime()) dayLabel = '내일';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const loc = String(ev?.location || ev?.place || '').trim();
  return loc ? `${dayLabel} ${hh}:${mm} · ${loc}` : `${dayLabel} ${hh}:${mm}`;
}

function normalizeHomeEvent(raw) {
  return {
    id: String(raw?._id || raw?.id || Math.random()),
    title: String(raw?.title || raw?.summary || '일정').trim() || '일정',
    detail: String(raw?.description || raw?.memo || raw?.notes || '').trim(),
    start: raw?.start || raw?.startAt || raw?.date,
    location: raw?.location || raw?.place || ''
  };
}

/**
 * ref_home — 주간(월~금) 스트립 + 미팅 카드
 */
export function HomeRefActionCalendarWidget() {
  const weekDays = useMemo(() => getWorkWeekDays(new Date()), []);
  const [selectedKey, setSelectedKey] = useState(() => startOfLocalDay(new Date()).toDateString());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const start = weekDays[0];
    const end = addDays(weekDays[4], 1);
    const params = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString()
    });
    setLoading(true);
    fetch(`${API_BASE}/calendar-events?${params}`, crmFetchInit())
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || '일정 조회 실패');
        return Array.isArray(data.items) ? data.items : [];
      })
      .then((items) => {
        if (cancelled) return;
        setEvents(items.map(normalizeHomeEvent));
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weekDays]);

  const selectedDay = useMemo(() => {
    const hit = weekDays.find((d) => d.toDateString() === selectedKey);
    return hit || weekDays[0];
  }, [weekDays, selectedKey]);

  const dayEvents = useMemo(() => {
    const key = startOfLocalDay(selectedDay).getTime();
    return events
      .filter((ev) => {
        const d = eventStartDate(ev);
        return d && startOfLocalDay(d).getTime() === key;
      })
      .sort((a, b) => (eventStartDate(a)?.getTime() || 0) - (eventStartDate(b)?.getTime() || 0))
      .slice(0, 4);
  }, [events, selectedDay]);

  const upcomingFallback = useMemo(() => {
    if (dayEvents.length > 0) return dayEvents;
    const now = Date.now();
    return events
      .filter((ev) => (eventStartDate(ev)?.getTime() || 0) >= now - 60 * 60 * 1000)
      .sort((a, b) => (eventStartDate(a)?.getTime() || 0) - (eventStartDate(b)?.getTime() || 0))
      .slice(0, 2);
  }, [dayEvents, events]);

  const tones = ['brand', 'emerald', 'amber', 'indigo'];

  return (
    <section className="home-ref-action-cal" data-purpose="action-calendar-widget">
      <div className="home-ref-action-cal-head">
        <div className="home-ref-action-cal-title">
          <span className="home-ref-action-cal-icon" aria-hidden>
            <span className="material-symbols-outlined">calendar_month</span>
          </span>
          <h3>영업 일정 &amp; 클라이언트 미팅</h3>
        </div>
        <span className="home-ref-action-cal-week">{formatWeekLabel(weekDays)}</span>
      </div>

      <div className="home-ref-action-cal-days" role="tablist" aria-label="이번 주 영업일">
        {weekDays.map((d) => {
          const key = d.toDateString();
          const active = key === selectedDay.toDateString();
          const isToday = key === startOfLocalDay(new Date()).toDateString();
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              className={`home-ref-action-cal-day${active ? ' is-active' : ''}${isToday && !active ? ' is-today' : ''}`}
              onClick={() => setSelectedKey(key)}
            >
              <span className="home-ref-action-cal-day-wd">{WEEKDAY_KO[d.getDay()]}</span>
              <span className="home-ref-action-cal-day-num">{d.getDate()}</span>
            </button>
          );
        })}
      </div>

      <div className="home-ref-action-cal-list">
        {loading ? (
          <p className="home-ref-action-cal-empty">일정 불러오는 중…</p>
        ) : upcomingFallback.length === 0 ? (
          <p className="home-ref-action-cal-empty">
            이번 주 등록된 미팅이 없습니다.{' '}
            <Link to="/calendar" className="home-ref-action-cal-link">
              캘린더에서 추가
            </Link>
          </p>
        ) : (
          upcomingFallback.map((ev, idx) => (
            <div
              key={ev.id}
              className={`home-ref-action-cal-item tone-${tones[idx % tones.length]}`}
            >
              <div className="home-ref-action-cal-item-main">
                <div className="home-ref-action-cal-item-title">{ev.title}</div>
                {ev.detail ? (
                  <div className="home-ref-action-cal-item-detail">{ev.detail}</div>
                ) : null}
                <span className="home-ref-action-cal-item-when">{formatMeetingWhen(ev)}</span>
              </div>
              <span className="home-ref-action-cal-item-dot" aria-hidden />
            </div>
          ))
        )}
      </div>

    </section>
  );
}

/**
 * ref_home — 우수 영업 담당자 리스트형 랭킹
 */
export function HomeRefRankingWidget({
  rows = [],
  periodLabel = '당월 누적',
  loading = false,
  goalRemainText = ''
}) {
  const top = (Array.isArray(rows) ? rows : []).slice(0, 5);

  return (
    <section className="home-ref-rank-widget" data-purpose="top-performers-widget">
      <div className="home-ref-rank-head">
        <div className="home-ref-rank-title">
          <span className="home-ref-rank-icon" aria-hidden>
            <span className="material-symbols-outlined">emoji_events</span>
          </span>
          <h3>우수 영업 담당자 랭킹</h3>
        </div>
        <span className="home-ref-rank-period">{periodLabel}</span>
      </div>

      <div className="home-ref-rank-list">
        {loading ? (
          <p className="home-ref-rank-empty">불러오는 중…</p>
        ) : top.length === 0 ? (
          <p className="home-ref-rank-empty">해당 조건에 수주 성공 건이 없습니다.</p>
        ) : (
          top.map((row, idx) => (
            <div key={row.name} className={`home-ref-rank-row${idx === 0 ? ' is-top' : ''}`}>
              <div className="home-ref-rank-user">
                <div className="home-ref-rank-avatar-wrap">
                  <span className={`home-ref-rank-avatar${idx === 0 ? ' is-gold' : ''}`}>
                    {row.initials || '?'}
                  </span>
                  <span className="home-ref-rank-badge">{idx + 1}</span>
                </div>
                <div className="home-ref-rank-user-text">
                  <strong>{row.name}</strong>
                  <span>
                    {row.deals != null ? `총 ${row.deals}건 수주 완료` : '수주 실적'}
                  </span>
                </div>
              </div>
              <div className="home-ref-rank-metrics">
                <strong>{row.revenueDisplay || '—'}</strong>
                {Number.isFinite(row.netProfit) ? (
                  <span className="is-profit">
                    순이익 {Math.round(row.netProfit).toLocaleString('ko-KR')}원
                  </span>
                ) : (
                  <span> </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {goalRemainText ? (
        <div className="home-ref-rank-banner">
          <span>{goalRemainText}</span>
        </div>
      ) : null}
    </section>
  );
}
