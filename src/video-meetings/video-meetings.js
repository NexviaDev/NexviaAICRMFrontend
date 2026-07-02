import { useState, useEffect, useCallback, useMemo } from 'react';
import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession } from '@/lib/crm-auth';
import { useSearchParams } from 'react-router-dom';
import CreateMeetingModal from './create-meeting-modal/create-meeting-modal';
import VideoMeetingRoom from './video-meeting-room/video-meeting-room';
import './video-meetings.css';

import { API_BASE } from '@/config';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import ListPaginationButtons from '@/components/list-pagination-buttons/list-pagination-buttons';

const MODAL_PARAM = 'modal';
const MODAL_CREATE = 'create';
const MODAL_ROOM = 'room';
const ID_PARAM = 'id';

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return (
    date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' +
    date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  );
}

function VideoMeetingsBetaBadge() {
  return (
    <span className="vm-beta-badge" aria-label="베타 기능">
      베타
    </span>
  );
}

function getDateParts(d) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return { month: '—', day: '—' };
  return {
    month: date.toLocaleDateString('ko-KR', { month: 'short' }),
    day: date.getDate()
  };
}

function MeetingCard({ row, onJoin, onCopyLink }) {
  const { month, day } = getDateParts(row.startedAt || row.createdAt);
  const isActive = row.status === 'active';

  return (
    <article className="vm-schedule-card">
      <div className="vm-schedule-card-main">
        <div className={`vm-schedule-date${isActive ? ' vm-schedule-date--active' : ''}`}>
          <span className="vm-schedule-date-month">{month}</span>
          <span className="vm-schedule-date-day">{day}</span>
        </div>
        <div className="vm-schedule-card-body">
          <h3 className="vm-schedule-card-title">{row.title || '—'}</h3>
          <div className="vm-schedule-card-meta">
            <span>
              <span className="material-symbols-outlined" aria-hidden>
                schedule
              </span>
              {formatDate(row.startedAt || row.createdAt)}
            </span>
            <span>
              <span className="material-symbols-outlined" aria-hidden>
                videocam
              </span>
              화상 회의
            </span>
            {row.creatorName ? (
              <span>
                <span className="material-symbols-outlined" aria-hidden>
                  person
                </span>
                {row.creatorName}
              </span>
            ) : null}
          </div>
          {row.description ? <p className="vm-schedule-card-desc">{row.description}</p> : null}
        </div>
      </div>
      <div className="vm-schedule-card-actions">
        <button type="button" className="vm-schedule-btn-outline" onClick={() => onCopyLink(row)}>
          링크 복사
        </button>
        {isActive ? (
          <button type="button" className="vm-schedule-btn-join" onClick={() => onJoin(row)}>
            입장
          </button>
        ) : (
          <span className="vm-schedule-ended-label">종료됨</span>
        )}
      </div>
    </article>
  );
}

export default function VideoMeetings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [livekitConfigured, setLivekitConfigured] = useState(null);
  const [roomMeetingOverride, setRoomMeetingOverride] = useState(null);
  const [roomFetchLoading, setRoomFetchLoading] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  );

  const modalMode = searchParams.get(MODAL_PARAM);
  const isCreateOpen = modalMode === MODAL_CREATE;
  const roomId = searchParams.get(ID_PARAM);
  const isRoomOpen = modalMode === MODAL_ROOM && roomId;

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const fn = () => setIsMobile(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  const selectedMeeting = useMemo(() => {
    if (!isRoomOpen || !roomId) return null;
    const fromList = items.find((m) => m._id === roomId);
    if (fromList) return fromList;
    return roomMeetingOverride && roomMeetingOverride._id === roomId ? roomMeetingOverride : null;
  }, [isRoomOpen, roomId, items, roomMeetingOverride]);

  useEffect(() => {
    if (!roomId || modalMode !== MODAL_ROOM) {
      setRoomMeetingOverride(null);
      setRoomFetchLoading(false);
      return;
    }
    if (items.some((m) => m._id === roomId)) {
      setRoomMeetingOverride(null);
      setRoomFetchLoading(false);
      return;
    }
    let cancelled = false;
    setRoomFetchLoading(true);
    fetch(`${API_BASE}/video-meetings/${encodeURIComponent(roomId)}`, crmFetchInit())
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data && data._id && !data.error) setRoomMeetingOverride(data);
        else setRoomMeetingOverride(null);
      })
      .catch(() => {
        if (!cancelled) setRoomMeetingOverride(null);
      })
      .finally(() => {
        if (!cancelled) setRoomFetchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, items, modalMode]);

  const fetchList = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const q = new URLSearchParams();
        q.set('page', String(page));
        q.set('limit', '20');
        if (searchInput.trim()) q.set('q', searchInput.trim());
        const res = await fetch(`${API_BASE}/video-meetings?${q}`, crmFetchInit());
        if (res.ok) {
          const data = await res.json();
          setItems(data.items || []);
          setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 });
          setLivekitConfigured(Boolean(data.livekit?.configured));
        } else {
          setItems([]);
        }
      } catch (_) {
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [searchInput]
  );

  useEffect(() => {
    const page = Math.max(1, parseInt(searchParams.get('page'), 10) || 1);
    fetchList(page);
  }, [fetchList, searchParams.get('page')]);

  const openCreateModal = () => {
    setSearchParams({ [MODAL_PARAM]: MODAL_CREATE }, { replace: true });
  };

  const closeCreateModal = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    setSearchParams(next, { replace: true });
  };

  const openRoom = (row) => {
    if (!row?._id) return;
    if (row.status === 'ended') {
      window.alert('이미 종료된 회의입니다.');
      return;
    }
    setSearchParams({ [MODAL_PARAM]: MODAL_ROOM, [ID_PARAM]: row._id });
  };

  const closeRoom = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    next.delete(ID_PARAM);
    setSearchParams(next, { replace: true });
  };

  const handleCreateMeeting = async (payload) => {
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/video-meetings`, {
        method: 'POST',
        headers: { ...getCrmAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(data.error || '회의를 만들지 못했습니다.');
        return;
      }
      const meeting = data.meeting;
      closeCreateModal();
      await fetchList(1);
      if (meeting?._id) {
        setSearchParams({ [MODAL_PARAM]: MODAL_ROOM, [ID_PARAM]: meeting._id });
      }
    } catch (_) {
      window.alert('네트워크 오류로 회의를 만들지 못했습니다.');
    } finally {
      setCreating(false);
    }
  };

  const copyInviteLink = async (row) => {
    const url = row?.joinUrl || `${window.location.origin}/video-meetings?modal=room&id=${row?._id || ''}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyNotice('초대 링크를 복사했습니다.');
      window.setTimeout(() => setCopyNotice(''), 2500);
    } catch (_) {
      window.prompt('아래 링크를 복사해 주세요.', url);
    }
  };

  const handleSearch = (e) => {
    e?.preventDefault();
    const next = new URLSearchParams(searchParams);
    next.set('page', '1');
    setSearchParams(next, { replace: true });
    fetchList(1);
  };

  const handlePageChange = (page) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(page));
    setSearchParams(next, { replace: true });
  };

  const rangeStart =
    items.length === 0 ? 0 : (pagination.page - 1) * (pagination.limit || 20) + 1;
  const rangeEnd =
    items.length === 0 ? 0 : (pagination.page - 1) * (pagination.limit || 20) + items.length;

  const activeItems = useMemo(() => items.filter((m) => m.status === 'active'), [items]);
  const endedItems = useMemo(() => items.filter((m) => m.status !== 'active'), [items]);

  return (
    <div className="page video-meetings-page">
      {isMobile ? (
        <div className="vm-m-top" aria-label="화상 회의">
          <div className="vm-m-top-row">
            <h1 className="vm-m-title">
              화상 회의 <VideoMeetingsBetaBadge />
            </h1>
            <PageHeaderNotifyChat noWrapper buttonClassName="vm-m-icon-btn" />
          </div>
          <form onSubmit={handleSearch} className="vm-m-search">
            <span className="material-symbols-outlined vm-m-search-icon" aria-hidden>
              search
            </span>
            <input
              type="search"
              placeholder="회의 검색…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="화상 회의 검색"
            />
          </form>
          <p className="vm-m-summary">
            전체 <strong>{pagination.total}</strong>건 중{' '}
            <strong>{rangeStart}</strong>–<strong>{rangeEnd}</strong>건 표시
          </p>
        </div>
      ) : (
        <header className="page-header customer-companies-header">
          <div className="customer-companies-header-main">
            <h1 className="page-title">
              화상 회의 <VideoMeetingsBetaBadge />
            </h1>
          </div>
          <div className="header-search">
            <form onSubmit={handleSearch} className="header-search-form">
              <button type="submit" className="header-search-icon-btn" aria-label="검색">
                <span className="material-symbols-outlined">search</span>
              </button>
              <input
                type="text"
                placeholder="회의 제목·설명 검색..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="화상 회의 검색"
              />
            </form>
          </div>
          <div className="customer-companies-header-tools">
            <button
              type="button"
              className="btn-primary vm-header-add-btn"
              onClick={openCreateModal}
              disabled={livekitConfigured === false}
            >
              <span className="material-symbols-outlined">add</span>
              <span className="vm-header-btn-label">새 화상 회의</span>
            </button>
            <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" />
          </div>
        </header>
      )}

      <div className={`page-content${isMobile ? ' vm-page-content--mobile' : ''}`}>
        <div className="vm-page-inner">
          {livekitConfigured === false ? (
            <div className="vm-config-banner" role="status">
              <span className="material-symbols-outlined" aria-hidden>
                info
              </span>
              LiveKit이 아직 설정되지 않았습니다. 서버에 LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL
              환경 변수를 등록해 주세요.
            </div>
          ) : null}

          {copyNotice ? <p className="vm-copy-notice">{copyNotice}</p> : null}

          {loading ? (
            <p className="vm-empty">불러오는 중…</p>
          ) : items.length === 0 ? (
            <div className="vm-empty-card">
              <span className="material-symbols-outlined vm-empty-icon" aria-hidden>
                videocam_off
              </span>
              <p>등록된 화상 회의가 없습니다.</p>
              {livekitConfigured !== false ? (
                <button type="button" className="btn-primary vm-empty-btn" onClick={openCreateModal}>
                  <span className="material-symbols-outlined">videocam</span>
                  첫 회의 시작하기
                </button>
              ) : null}
            </div>
          ) : (
            <div className="vm-schedule-content">
            {activeItems.length > 0 ? (
              <section className="vm-schedule-section">
                <div className="vm-schedule-section-head">
                  <span className="vm-schedule-dot vm-schedule-dot--live" aria-hidden />
                  <h2>진행 중인 회의</h2>
                  <span className="vm-schedule-count">{activeItems.length}건</span>
                </div>
                <div className="vm-schedule-card-list">
                  {activeItems.map((row) => (
                    <MeetingCard
                      key={row._id}
                      row={row}
                      onJoin={openRoom}
                      onCopyLink={copyInviteLink}
                    />
                  ))}
                </div>
              </section>
            ) : (
              <section className="vm-schedule-section">
                <div className="vm-schedule-section-head">
                  <span className="vm-schedule-dot vm-schedule-dot--live" aria-hidden />
                  <h2>진행 중인 회의</h2>
                </div>
                <div className="vm-schedule-empty-inline">
                  <p>현재 진행 중인 회의가 없습니다.</p>
                  {livekitConfigured !== false ? (
                    <button type="button" className="btn-primary" onClick={openCreateModal}>
                      새 회의 시작
                    </button>
                  ) : null}
                </div>
              </section>
            )}

            {endedItems.length > 0 ? (
              <section className="vm-schedule-section vm-schedule-section--history">
                <div className="vm-schedule-section-head">
                  <span className="vm-schedule-dot" aria-hidden />
                  <h2>종료된 회의</h2>
                  <span className="vm-schedule-count">{endedItems.length}건</span>
                </div>
                <div className="vm-history-table-wrap">
                  <table className="vm-history-table">
                    <thead>
                      <tr>
                        <th>회의명</th>
                        <th>생성자</th>
                        <th>일시</th>
                        <th>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {endedItems.map((row) => (
                        <tr key={row._id}>
                          <td>
                            <div className="vm-history-title">{row.title || '—'}</div>
                            {row.description ? (
                              <div className="vm-history-desc">{row.description}</div>
                            ) : null}
                          </td>
                          <td>{row.creatorName || '—'}</td>
                          <td>{formatDate(row.startedAt || row.createdAt)}</td>
                          <td>
                            <span className="vm-status-badge vm-status-badge--ended">종료</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            <div className="pagination-bar vm-pagination-bar">
              <ListPaginationButtons
                page={pagination.page}
                totalPages={pagination.totalPages}
                onPageChange={handlePageChange}
              />
            </div>
            </div>
          )}
        </div>
      </div>

      {isMobile && livekitConfigured !== false ? (
        <button type="button" className="vm-fab" onClick={openCreateModal} aria-label="새 화상 회의">
          <span className="material-symbols-outlined">videocam</span>
        </button>
      ) : null}

      {isCreateOpen ? (
        <CreateMeetingModal
          onClose={closeCreateModal}
          onCreated={handleCreateMeeting}
          creating={creating}
        />
      ) : null}

      {isRoomOpen && !roomFetchLoading && selectedMeeting ? (
        <VideoMeetingRoom
          meetingId={selectedMeeting._id}
          meetingTitle={selectedMeeting.title}
          onClose={closeRoom}
          onEnded={() => fetchList(pagination.page)}
        />
      ) : null}

      {isRoomOpen && roomFetchLoading ? (
        <div className="vm-room-loading-overlay">
          <span className="vm-room-loading-spinner" aria-hidden />
          회의 정보를 불러오는 중…
        </div>
      ) : null}
    </div>
  );
}
