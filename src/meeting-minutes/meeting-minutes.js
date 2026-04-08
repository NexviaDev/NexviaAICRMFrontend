import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import AddMeetingModal from './add-meeting-modal/add-meeting-modal';
import MeetingDetailModal from './meeting-detail-modal/meeting-detail-modal';
import './meeting-minutes.css';

import { API_BASE } from '@/config';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
const MODAL_PARAM = 'modal';
const MODAL_ADD = 'add';
const MODAL_DETAIL = 'detail';
const DETAIL_ID_PARAM = 'id';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatMeetingDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

export default function MeetingMinutes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [editMeeting, setEditMeeting] = useState(null);
  const [detailMeetingOverride, setDetailMeetingOverride] = useState(null);
  const [detailFetchLoading, setDetailFetchLoading] = useState(false);

  const modalMode = searchParams.get(MODAL_PARAM);
  const isAddOpen = modalMode === MODAL_ADD;
  const detailId = searchParams.get(DETAIL_ID_PARAM);
  const isDetailOpen = modalMode === MODAL_DETAIL && detailId;

  const selectedMeeting = useMemo(() => {
    if (!isDetailOpen || !detailId) return null;
    const fromList = items.find((m) => m._id === detailId);
    if (fromList) return fromList;
    return detailMeetingOverride && detailMeetingOverride._id === detailId ? detailMeetingOverride : null;
  }, [isDetailOpen, detailId, items, detailMeetingOverride]);

  useEffect(() => {
    if (!detailId || modalMode !== MODAL_DETAIL) {
      setDetailMeetingOverride(null);
      setDetailFetchLoading(false);
      return;
    }
    if (items.some((m) => m._id === detailId)) {
      setDetailMeetingOverride(null);
      setDetailFetchLoading(false);
      return;
    }
    let cancelled = false;
    setDetailFetchLoading(true);
    fetch(`${API_BASE}/meeting-minutes/${encodeURIComponent(detailId)}`, { headers: getAuthHeader() })
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data && data._id && !data.error) setDetailMeetingOverride(data);
        else setDetailMeetingOverride(null);
      })
      .catch(() => {
        if (!cancelled) setDetailMeetingOverride(null);
      })
      .finally(() => {
        if (!cancelled) setDetailFetchLoading(false);
      });
    return () => { cancelled = true; };
  }, [detailId, items, modalMode]);

  const initialFromAiVoice = location.state?.fromAiVoice
    ? {
        title: location.state.title ?? '',
        discussionPoints: location.state.discussionPoints ?? '',
        meetingDate: new Date(),
        location: '',
        agenda: '',
        status: 'Draft',
        actionItems: [],
        attendees: []
      }
    : null;

  const fetchList = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set('page', page);
      q.set('limit', 20);
      if (searchInput.trim()) q.set('search', searchInput.trim());
      const res = await fetch(`${API_BASE}/meeting-minutes?${q}`, { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 });
      } else {
        setItems([]);
      }
    } catch (_) {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [searchInput]);

  useEffect(() => {
    const page = Math.max(1, parseInt(searchParams.get('page'), 10) || 1);
    fetchList(page);
  }, [fetchList, searchParams.get('page')]);

  const openAddModal = () => {
    setEditMeeting(null);
    setSearchParams({ [MODAL_PARAM]: MODAL_ADD }, { replace: true });
  };
  const closeAddModal = () => {
    setEditMeeting(null);
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    setSearchParams(next, { replace: true });
    if (location.state?.fromAiVoice) navigate(location.pathname, { replace: true, state: {} });
  };

  const openDetailModal = (row) => {
    if (!row?._id) return;
    setSearchParams({ [MODAL_PARAM]: MODAL_DETAIL, [DETAIL_ID_PARAM]: row._id });
  };
  const closeDetailModal = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    next.delete(DETAIL_ID_PARAM);
    setSearchParams(next, { replace: true });
  };

  const handleSearch = (e) => {
    e?.preventDefault();
    fetchList(1);
  };

  const handlePageChange = (page) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(page));
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="page meeting-minutes-page">
      <header className="page-header">
        <div className="header-search">
          <form onSubmit={handleSearch} className="header-search-form">
            <button type="submit" className="header-search-icon-btn" aria-label="검색">
              <span className="material-symbols-outlined">search</span>
            </button>
            <input
              type="text"
              placeholder="회의 일지 검색..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="회의 일지 검색"
            />
          </form>
        </div>
        <div className="header-actions">
          <button type="button" className="btn-primary" onClick={openAddModal}>
            <span className="material-symbols-outlined">add</span>
            새 회의 일지
          </button>
          <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" />
        </div>
      </header>

      <div className="page-content">
        <div className="meeting-minutes-top">
          <div>
            <h2 className="meeting-minutes-title">회의 일지</h2>
            <p className="page-desc">
              참석자로 지정되었거나 내가 작성한 회의만 목록에 표시됩니다. {pagination.total}건 (총 {pagination.totalPages}페이지)
            </p>
          </div>
        </div>

        <div className="panel table-panel">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>회의 제목</th>
                  <th>일시</th>
                  <th>장소</th>
                  <th>참석자</th>
                  <th className="th-actions"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="text-center">불러오는 중...</td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center">등록된 회의 일지가 없습니다.</td>
                  </tr>
                ) : (
                  items.map((row) => (
                    <tr key={row._id} className="meeting-minutes-row-clickable" onClick={() => openDetailModal(row)}>
                      <td>
                        <p className="meeting-minutes-cell-title">{row.title || '—'}</p>
                      </td>
                      <td className="text-muted">{formatMeetingDate(row.meetingDate)}</td>
                      <td>
                        <div className="meeting-minutes-cell-location">
                          <span className="material-symbols-outlined">room</span>
                          {row.location || '—'}
                        </div>
                      </td>
                      <td>
                        <div className="meeting-minutes-attendees">
                          {(row.attendees || []).slice(0, 3).map((a, i) => (
                            <span key={i} className="meeting-minutes-attendee-chip">{a.name || '—'}</span>
                          ))}
                          {(row.attendees || []).length > 3 && (
                            <span className="meeting-minutes-attendee-more">+{(row.attendees || []).length - 3}</span>
                          )}
                          {(row.attendees || []).length === 0 && <span className="text-muted">—</span>}
                        </div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="icon-btn small" onClick={() => openDetailModal(row)} aria-label="세부정보">
                          <span className="material-symbols-outlined">more_horiz</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {pagination.totalPages > 1 && (
            <div className="meeting-minutes-pagination">
              <p className="meeting-minutes-pagination-info">
                {((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} / {pagination.total}건
              </p>
              <div className="meeting-minutes-pagination-btns">
                <button
                  type="button"
                  className="btn-outline small"
                  disabled={pagination.page <= 1}
                  onClick={() => handlePageChange(pagination.page - 1)}
                >
                  <span className="material-symbols-outlined">chevron_left</span>
                </button>
                <span className="meeting-minutes-page-num">{pagination.page} / {pagination.totalPages}</span>
                <button
                  type="button"
                  className="btn-outline small"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => handlePageChange(pagination.page + 1)}
                >
                  <span className="material-symbols-outlined">chevron_right</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {isAddOpen && (
        <AddMeetingModal
          meeting={editMeeting ?? initialFromAiVoice}
          onClose={closeAddModal}
          onSaved={() => { fetchList(1); closeAddModal(); }}
        />
      )}

      {isDetailOpen && selectedMeeting && (
        <MeetingDetailModal
          meeting={selectedMeeting}
          onClose={closeDetailModal}
          onEdit={(m) => {
            setEditMeeting(m);
            setSearchParams({ [MODAL_PARAM]: MODAL_ADD }, { replace: true });
          }}
          onUpdated={(updated) => {
            setItems((prev) => prev.map((m) => (m._id === updated._id ? updated : m)));
            setDetailMeetingOverride((prev) => (prev && prev._id === updated._id ? updated : prev));
          }}
          onDeleted={() => { fetchList(1); closeDetailModal(); }}
        />
      )}
      {isDetailOpen && !selectedMeeting && (loading || detailFetchLoading) && (
        <div className="meeting-minutes-detail-loading-overlay" role="status" aria-live="polite">
          <p>회의 일지를 불러오는 중…</p>
        </div>
      )}
      {isDetailOpen && !selectedMeeting && !loading && !detailFetchLoading && (
        <div className="meeting-minutes-detail-error-overlay">
          <p>이 회의 일지를 열람할 수 없거나 참석자·작성자가 아닙니다.</p>
          <button type="button" className="btn-primary" onClick={closeDetailModal}>닫기</button>
        </div>
      )}
    </div>
  );
}
