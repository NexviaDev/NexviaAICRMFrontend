import { useEffect } from 'react';
import './day-events-modal.css';

function formatDateTitle(dateStr) {
  if (!dateStr) return '날짜별 일정';
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '날짜별 일정';
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${weekday})`;
}

function formatEventWhen(event) {
  if (!event?.start) return '시간 정보 없음';
  if (event.allDay) return '종일';
  const startDate = new Date(event.start);
  const endDate = event.end ? new Date(event.end) : null;
  const timeOptions = { hour: '2-digit', minute: '2-digit' };
  if (!endDate) return startDate.toLocaleTimeString('ko-KR', timeOptions);
  return `${startDate.toLocaleTimeString('ko-KR', timeOptions)} ~ ${endDate.toLocaleTimeString('ko-KR', timeOptions)}`;
}

export default function DayEventsModal({ date, events, onClose, onEventClick, currentUser }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="day-events-modal-overlay" role="presentation">
      <div className="day-events-modal" role="dialog" aria-modal="true" aria-label={`${formatDateTitle(date)} 일정 목록`} onClick={(e) => e.stopPropagation()}>
        <div className="day-events-modal-header">
          <div>
            <p className="day-events-modal-eyebrow">해당 날짜 일정</p>
            <h3>{formatDateTitle(date)}</h3>
          </div>
          <button type="button" className="day-events-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="day-events-modal-body">
          {events.length === 0 ? (
            <p className="day-events-modal-empty">표시할 일정이 없습니다.</p>
          ) : (
            <ul className="day-events-modal-list">
              {events.map((event) => {
                const isGoogle = event._source === 'google';
                const isOther = !isGoogle && currentUser && event.userId !== currentUser._id;
                return (
                  <li key={event._id}>
                    <button
                      type="button"
                      className="day-events-modal-item"
                      style={event.color ? { borderLeft: `4px solid ${event.color}` } : (isGoogle ? { borderLeft: '4px solid #4285f4' } : undefined)}
                      onClick={() => onEventClick?.(event._id, event.googleCalendarId)}
                    >
                      <span className="day-events-modal-item-title">
                        {event.title || '(제목 없음)'}
                        {isGoogle && <span className="day-events-modal-google-badge">G</span>}
                      </span>
                      <span className="day-events-modal-item-meta">
                        {event.allDay ? '하루종일' : formatEventWhen(event)}
                        {isOther && event.creatorName && ` · ${event.creatorName}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
