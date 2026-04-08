import { useEffect } from 'react';
import './all-history-modal.css';

import { API_BASE } from '@/config';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatHistoryDate(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) + ' • ' + date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

/** 고객사 세부 모달 내 "지원 및 업무 기록 전체 보기" 모달 */
export default function AllHistoryModal({ historyItems, companyId, onClose, onRefresh }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!historyItems || historyItems.length === 0) return null;

  const canDeleteHistory = isAdminOrAboveRole(getStoredCrmUser()?.role);

  const handleDelete = async (historyId) => {
    if (!historyId || !companyId) return;
    if (!isAdminOrAboveRole(getStoredCrmUser()?.role)) {
      window.alert('업무 기록 삭제는 대표(Owner) 또는 관리자(Admin)만 가능합니다.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/customer-companies/${companyId}/history/${historyId}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      if (res.ok && onRefresh) onRefresh();
    } catch (_) {}
  };

  return (
    <>
      <div className="all-history-modal-overlay" aria-hidden="true" />
      <div className="all-history-modal">
        <div className="all-history-modal-inner">
          <header className="all-history-modal-header">
            <h3>지원 및 업무 기록 전체</h3>
            <button type="button" className="all-history-modal-close" onClick={onClose} aria-label="닫기">
              <span className="material-symbols-outlined">close</span>
            </button>
          </header>
          <div className="all-history-list">
            {historyItems.map((entry) => (
              <div key={entry._id} className="all-history-item">
                <div className="all-history-dot" />
                <div className="all-history-card">
                  <div className="all-history-head">
                    <div>
                      {entry.employeeName && <span className="all-history-emp">{entry.employeeName}</span>}
                      <time>{formatHistoryDate(entry.createdAt)}</time>
                    </div>
                    {canDeleteHistory ? (
                      <button
                        type="button"
                        className="all-history-delete"
                        onClick={() => handleDelete(entry._id)}
                        aria-label="삭제"
                        title="Owner / Admin"
                      >
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    ) : null}
                  </div>
                  <p className="all-history-content">{entry.content}</p>
                  <div className="all-history-footer">
                    <span className="all-history-logged">
                      등록: {(entry.createdByCurrentName !== undefined ? entry.createdByCurrentName : entry.createdByName) || '—'}
                      {(entry.createdByCurrentContact !== undefined ? entry.createdByCurrentContact : entry.createdByContact) ? ' · ' + (entry.createdByCurrentContact !== undefined ? entry.createdByCurrentContact : entry.createdByContact) : ''}
                      {entry.createdByChanged && <span className="all-history-changed"> 변경됨</span>}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
