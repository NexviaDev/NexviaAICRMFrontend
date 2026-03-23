import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '@/config';
import { markNotificationsAsSeen } from '@/lib/notification-read-state';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import './notification.css';

function formatDt(iso) {
  if (!iso) return '등록 시각 없음';
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '등록 시각 없음';
  }
}

export default function NotificationPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadNotifications = useCallback(async () => {
    const token = localStorage.getItem('crm_token');
    if (!token) {
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/notifications`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '공지사항을 불러오지 못했습니다.');
      const list = Array.isArray(data.notifications) ? data.notifications : [];
      setRows(list);
      markNotificationsAsSeen(list);
    } catch (err) {
      setError(err.message || '공지사항을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  return (
    <div className="page notification-page">
      <header className="page-header notification-header">
        <div>
          <h1 className="notification-title">공지사항</h1>
          <p className="notification-subtitle">일반 사용자 화면에서는 공지 열람만 가능합니다.</p>
        </div>
        <PageHeaderNotifyChat buttonClassName="notification-header-icon-btn" wrapperClassName="notification-header-actions" />
      </header>

      <div className="page-content">
        {error && <div className="notification-feedback notification-feedback--error">{error}</div>}

        <section className="notification-list">
          {loading ? (
            <div className="notification-empty">공지사항을 불러오는 중입니다…</div>
          ) : rows.length === 0 ? (
            <div className="notification-empty">현재 등록된 공지사항이 없습니다.</div>
          ) : (
            rows.map((item) => (
              <article key={item._id} className="notification-card">
                <div className="notification-card-meta">
                  <span className="notification-card-badge">공지</span>
                  <span>{formatDt(item.publishedAt || item.createdAt)}</span>
                </div>
                <h2 className="notification-card-title">{item.title}</h2>
                <p className="notification-card-content">{item.content}</p>
              </article>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
