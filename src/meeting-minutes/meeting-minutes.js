import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import AddMeetingModal from './add-meeting-modal/add-meeting-modal';
import MeetingDetailModal from './meeting-detail-modal/meeting-detail-modal';
import './meeting-minutes.css';

import { API_BASE } from '@/config';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import ListPaginationButtons from '@/components/list-pagination-buttons/list-pagination-buttons';
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

/** Sample Design / 카드 참석자 이니셜 */
function attendeeInitials(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const noSpace = s.replace(/\s/g, '');
  if (noSpace.length <= 2) return noSpace.toUpperCase();
  return (noSpace[0] + noSpace[noSpace.length - 1]).toUpperCase();
}

function isVideoLocation(loc) {
  const t = String(loc || '').toLowerCase();
  return /zoom|teams|meet\.google|http|:\/\/|비대면|화상|온라인/.test(t);
}

const MM_BADGE_FINAL = { className: 'meeting-minutes-m-badge meeting-minutes-m-badge--final', label: '확정' };
const MM_BADGE_DRAFT = { className: 'meeting-minutes-m-badge meeting-minutes-m-badge--draft', label: '초안' };

function meetingStatusBadge(status) {
  return String(status) === 'Finalized' ? MM_BADGE_FINAL : MM_BADGE_DRAFT;
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
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const fn = () => setIsMobile(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

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

  const openEditDraftModal = useCallback(
    (e, row) => {
      e?.stopPropagation();
      if (!row?._id) return;
      setEditMeeting(row);
      setSearchParams({ [MODAL_PARAM]: MODAL_ADD }, { replace: true });
    },
    [setSearchParams]
  );
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

  const rangeStart =
    items.length === 0 ? 0 : (pagination.page - 1) * (pagination.limit || 20) + 1;
  const rangeEnd = items.length === 0 ? 0 : (pagination.page - 1) * (pagination.limit || 20) + items.length;

  return (
    <div className="page meeting-minutes-page">
      {isMobile ? (
        <div className="meeting-minutes-m-top" aria-label="회의 일지">
          <div className="meeting-minutes-m-top-row">
            <h1 className="meeting-minutes-m-title">회의 일지</h1>
            <div className="meeting-minutes-m-notify-group">
              <PageHeaderNotifyChat noWrapper buttonClassName="meeting-minutes-m-icon-btn" />
            </div>
          </div>
          <form onSubmit={handleSearch} className="meeting-minutes-m-search">
            <span className="material-symbols-outlined meeting-minutes-m-search-icon" aria-hidden>
              search
            </span>
            <input
              type="search"
              placeholder="회의 일지 검색…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="회의 일지 검색"
            />
          </form>
          <p className="meeting-minutes-m-summary">
            전체 <strong>{pagination.total}</strong>건 중{' '}
            <strong>{rangeStart}</strong>–<strong>{rangeEnd}</strong>건 표시
          </p>
          <p className="meeting-minutes-m-hint">
            참석자로 지정되었거나 내가 작성한 회의만 목록에 표시됩니다.
          </p>
        </div>
      ) : (
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
      )}

      <div className={`page-content${isMobile ? ' meeting-minutes-page-content--mobile' : ''}`}>
        {!isMobile ? (
          <div className="meeting-minutes-top">
            <div>
              <h2 className="meeting-minutes-title">회의 일지</h2>
              <p className="page-desc">
                참석자로 지정되었거나 내가 작성한 회의만 목록에 표시됩니다. {pagination.total}건 (총{' '}
                {pagination.totalPages}페이지)
              </p>
            </div>
          </div>
        ) : null}

        {isMobile ? (
          <section className="meeting-minutes-m-list" aria-label="회의 목록">
            {loading ? (
              <p className="meeting-minutes-m-empty">불러오는 중…</p>
            ) : items.length === 0 ? (
              <p className="meeting-minutes-m-empty">등록된 회의 일지가 없습니다.</p>
            ) : (
              <ul className="meeting-minutes-m-cards">
                {items.map((row) => {
                  const badge = meetingStatusBadge(row.status);
                  const attendees = Array.isArray(row.attendees) ? row.attendees : [];
                  const showVideo = isVideoLocation(row.location);
                  const isDraft = String(row.status) !== 'Finalized';
                  return (
                    <li key={row._id}>
                      <article
                        className={`meeting-minutes-m-card${isDraft ? ' meeting-minutes-m-card--draft' : ''}`}
                      >
                        <div className="meeting-minutes-m-card-head">
                          <span className={badge.className}>{badge.label}</span>
                          <button
                            type="button"
                            className="meeting-minutes-m-more"
                            onClick={(e) => {
                              e.stopPropagation();
                              openDetailModal(row);
                            }}
                            aria-label="메뉴"
                          >
                            <span className="material-symbols-outlined">more_vert</span>
                          </button>
                        </div>
                        <button
                          type="button"
                          className="meeting-minutes-m-card-body-btn"
                          onClick={() => openDetailModal(row)}
                        >
                          <h3 className="meeting-minutes-m-card-title">{row.title || '—'}</h3>
                          <div className="meeting-minutes-m-meta">
                            <span className="meeting-minutes-m-meta-line">
                              <span className="material-symbols-outlined" aria-hidden>
                                calendar_today
                              </span>
                              {formatMeetingDate(row.meetingDate)}
                            </span>
                            <span className="meeting-minutes-m-meta-line">
                              <span className="material-symbols-outlined" aria-hidden>
                                {showVideo ? 'videocam' : 'location_on'}
                              </span>
                              {row.location?.trim() ? row.location : '—'}
                            </span>
                          </div>
                        </button>
                        <div className="meeting-minutes-m-card-foot">
                          <div
                            className="meeting-minutes-m-avatars"
                            aria-label={
                              attendees.length === 0
                                ? '참석자 없음'
                                : `참석자 ${attendees.length}명`
                            }
                          >
                            {attendees.slice(0, 3).map((a, i) => (
                              <span
                                key={`${row._id}-a-${i}`}
                                className="meeting-minutes-m-avatar"
                                title={a.name || ''}
                              >
                                {attendeeInitials(a.name)}
                              </span>
                            ))}
                            {attendees.length > 3 ? (
                              <span className="meeting-minutes-m-avatar meeting-minutes-m-avatar--more">
                                +{attendees.length - 3}
                              </span>
                            ) : null}
                            {attendees.length === 0 ? (
                              <span className="meeting-minutes-m-no-attendees">참석자 없음</span>
                            ) : null}
                          </div>
                          {isDraft ? (
                            <button
                              type="button"
                              className="meeting-minutes-m-action meeting-minutes-m-action--primary"
                              onClick={(e) => openEditDraftModal(e, row)}
                            >
                              초안 수정
                              <span className="material-symbols-outlined" aria-hidden>
                                edit
                              </span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="meeting-minutes-m-action meeting-minutes-m-action--primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                openDetailModal(row);
                              }}
                            >
                              상세 보기
                              <span className="material-symbols-outlined" aria-hidden>
                                arrow_forward
                              </span>
                            </button>
                          )}
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            )}
            {!loading && items.length > 0 ? (
              <div className="pagination-bar meeting-minutes-pagination-bar meeting-minutes-m-pagination">
                <p className="pagination-info meeting-minutes-pagination-info">
                  <strong>{pagination.total}</strong>건 중 <strong>{rangeStart}</strong>–<strong>{rangeEnd}</strong>건
                </p>
                <ListPaginationButtons
                  page={pagination.page}
                  totalPages={Math.max(1, pagination.totalPages || 1)}
                  onPageChange={handlePageChange}
                />
              </div>
            ) : null}
          </section>
        ) : null}

        {!isMobile ? (
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
          <div className="pagination-bar meeting-minutes-pagination-bar">
            <p className="pagination-info meeting-minutes-pagination-info">
              <strong>{pagination.total}</strong>건 중 <strong>{items.length ? (pagination.page - 1) * pagination.limit + 1 : 0}</strong>–<strong>{(pagination.page - 1) * pagination.limit + items.length}</strong>건 표시
            </p>
            <ListPaginationButtons
              page={pagination.page}
              totalPages={Math.max(1, pagination.totalPages || 1)}
              onPageChange={handlePageChange}
            />
          </div>
        </div>
        ) : null}
      </div>

      {isMobile ? (
        <button
          type="button"
          className="meeting-minutes-fab"
          onClick={openAddModal}
          aria-label="새 회의 일지"
          title="새 회의 일지"
        >
          <span className="material-symbols-outlined" aria-hidden>
            add
          </span>
        </button>
      ) : null}

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
