import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { API_BASE } from '@/config';
import { hasUnreadNotifications } from '@/lib/notification-read-state';
import './page-header-notify-chat.css';

/**
 * 상단 우측: 공지(/notification) · 채팅(/chat) · 할 일(/todo-list) — 사이드바와 동일 이동.
 * 공지는 API 목록과 로컬 읽음 시각을 비교해 미읽음이면 빨간 점 표시.
 */
export default function PageHeaderNotifyChat({
  wrapperClassName = 'header-actions',
  buttonClassName = 'icon-btn',
  notificationTitle = '공지사항',
  chatTitle = '채팅',
  calendarTitle = '캘린더',
  todoTitle = '할 일',
  showTodo = true,
  noWrapper = false
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const calendarActive = pathname === '/calendar';
  const todoActive = pathname === '/todo-list';
  const [notifyUnread, setNotifyUnread] = useState(false);

  const checkUnread = useCallback(async () => {
    const token = localStorage.getItem('crm_token');
    if (!token) {
      setNotifyUnread(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/notifications`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotifyUnread(false);
        return;
      }
      const list = Array.isArray(data.notifications) ? data.notifications : [];
      setNotifyUnread(hasUnreadNotifications(list));
    } catch {
      setNotifyUnread(false);
    }
  }, []);

  useEffect(() => {
    void checkUnread();
    const intervalMs = 90000;
    const id = setInterval(() => void checkUnread(), intervalMs);
    const onFocus = () => void checkUnread();
    const onSeen = () => void checkUnread();
    window.addEventListener('focus', onFocus);
    window.addEventListener('crm-notifications-seen', onSeen);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('crm-notifications-seen', onSeen);
    };
  }, [checkUnread]);

  const buttons = (
    <>
      <button
        type="button"
        className={`${buttonClassName} page-header-notify-btn`.trim()}
        aria-label={notifyUnread ? `${notificationTitle} (새 공지)` : notificationTitle}
        title={notificationTitle}
        onClick={() => navigate('/notification')}
      >
        <span className="material-symbols-outlined">notifications</span>
        {notifyUnread ? <span className="page-header-notify-dot" aria-hidden /> : null}
      </button>
      <button
        type="button"
        className={buttonClassName}
        aria-label={chatTitle}
        title={chatTitle}
        onClick={() => navigate('/chat')}
      >
        <span className="material-symbols-outlined">chat_bubble</span>
      </button>
      <button
        type="button"
        className={`${buttonClassName} page-header-calendar-btn${calendarActive ? ' page-header-calendar-btn--active' : ''}`.trim()}
        aria-label={calendarTitle}
        title={calendarTitle}
        onClick={() => navigate('/calendar')}
      >
        <span className="material-symbols-outlined">calendar_month</span>
      </button>
      {showTodo ? (
        <button
          type="button"
          className={`${buttonClassName} page-header-todo-btn${todoActive ? ' page-header-todo-btn--active' : ''}`.trim()}
          aria-label={todoTitle}
          title={todoTitle}
          onClick={() => navigate('/todo-list')}
        >
          <span className="material-symbols-outlined">checklist</span>
        </button>
      ) : null}
    </>
  );
  if (noWrapper) return buttons;
  return <div className={wrapperClassName}>{buttons}</div>;
}
