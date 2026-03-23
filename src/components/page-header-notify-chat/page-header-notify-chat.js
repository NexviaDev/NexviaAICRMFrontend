import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '@/config';
import { hasUnreadNotifications } from '@/lib/notification-read-state';
import './page-header-notify-chat.css';

/**
 * 공지(/notification) · 채팅(/chat) — 사이드바 메뉴와 동일 동작.
 * 공지는 API 목록과 로컬 읽음 시각을 비교해 미읽음이면 빨간 점 표시.
 */
export default function PageHeaderNotifyChat({
  wrapperClassName = 'header-actions',
  buttonClassName = 'icon-btn',
  notificationTitle = '공지사항',
  chatTitle = '채팅',
  noWrapper = false
}) {
  const navigate = useNavigate();
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
    </>
  );
  if (noWrapper) return buttons;
  return <div className={wrapperClassName}>{buttons}</div>;
}
