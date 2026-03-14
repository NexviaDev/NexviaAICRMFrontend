import { useState, useEffect } from 'react';
import './meeting-detail-modal.css';

import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatMeetingDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) + ' ' + date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateOnly(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ko-KR');
}

const STATUS_LABELS = { Draft: '초안', Finalized: '완료' };

export default function MeetingDetailModal({ meeting, onClose, onEdit, onUpdated, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showDeleteConfirm) setShowDeleteConfirm(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showDeleteConfirm]);

  if (!meeting) return null;

  const status = meeting.status || 'Draft';

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/meeting-minutes/${meeting._id}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      if (res.ok) {
        onDeleted?.();
        onClose?.();
      } else {
        const data = await res.json().catch(() => ({}));
        setShowDeleteConfirm(false);
        window.alert(data.error || '삭제에 실패했습니다.');
      }
    } catch (_) {
      setShowDeleteConfirm(false);
      window.alert('서버에 연결할 수 없습니다.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="meeting-detail-overlay" aria-hidden="true" />
      <div className="meeting-detail-panel">
        <div className="meeting-detail-inner">
          <header className="meeting-detail-header">
            <div className="meeting-detail-header-title">
              <span className="material-symbols-outlined">description</span>
              <h2>회의 일지</h2>
            </div>
            <div className="meeting-detail-header-actions">
              <button type="button" className="meeting-detail-icon-btn" onClick={() => onEdit?.(meeting)} title="수정">
                <span className="material-symbols-outlined">edit</span>
              </button>
              <button type="button" className="meeting-detail-icon-btn meeting-detail-delete-btn" onClick={() => setShowDeleteConfirm(true)} title="삭제">
                <span className="material-symbols-outlined">delete</span>
              </button>
              <button type="button" className="meeting-detail-icon-btn" onClick={onClose} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          </header>

          {showDeleteConfirm && (
            <div className="meeting-detail-delete-confirm">
              <span className="material-symbols-outlined">warning</span>
              <p>이 회의 일지를 삭제하시겠습니까?</p>
              <div className="meeting-detail-delete-confirm-btns">
                <button type="button" className="meeting-detail-confirm-cancel" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>취소</button>
                <button type="button" className="meeting-detail-confirm-delete" onClick={handleDelete} disabled={deleting}>
                  {deleting ? '삭제 중...' : '삭제'}
                </button>
              </div>
            </div>
          )}

          <div className="meeting-detail-body">
            <section className="meeting-detail-card">
              <h1 className="meeting-detail-name">{meeting.title || '—'}</h1>
              <span className={`meeting-detail-status-badge status-${status.toLowerCase()}`}>
                {STATUS_LABELS[status]}
              </span>
              <div className="meeting-detail-meta">
                <div className="meeting-detail-meta-item">
                  <span className="material-symbols-outlined">calendar_month</span>
                  {formatMeetingDate(meeting.meetingDate)}
                </div>
                {meeting.location && (
                  <div className="meeting-detail-meta-item">
                    <span className="material-symbols-outlined">room</span>
                    {meeting.location}
                  </div>
                )}
              </div>
            </section>

            {meeting.agenda && (
              <section className="meeting-detail-section">
                <h3 className="meeting-detail-section-title">안건</h3>
                <p className="meeting-detail-text">{meeting.agenda}</p>
              </section>
            )}

            {meeting.discussionPoints && (
              <section className="meeting-detail-section">
                <h3 className="meeting-detail-section-title">논의 내용</h3>
                <p className="meeting-detail-text meeting-detail-text-block">{meeting.discussionPoints}</p>
              </section>
            )}

            {(meeting.actionItems || []).length > 0 && (
              <section className="meeting-detail-section">
                <h3 className="meeting-detail-section-title">액션 아이템</h3>
                <ul className="meeting-detail-action-list">
                  {meeting.actionItems.map((a, i) => (
                    <li key={i} className={a.completed ? 'meeting-detail-action-done' : ''}>
                      <span className="material-symbols-outlined">{a.completed ? 'check_circle' : 'radio_button_unchecked'}</span>
                      <span>{a.description || '—'}</span>
                      {a.dueDate && <span className="meeting-detail-action-due">마감: {formatDateOnly(a.dueDate)}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(meeting.attendees || []).length > 0 && (
              <section className="meeting-detail-section">
                <h3 className="meeting-detail-section-title">참석자</h3>
                <ul className="meeting-detail-attendee-list">
                  {meeting.attendees.map((a, i) => (
                    <li key={i}>
                      <span className="meeting-detail-attendee-name">{a.name || '—'}</span>
                      {a.role && <span className="meeting-detail-attendee-role">{a.role}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
