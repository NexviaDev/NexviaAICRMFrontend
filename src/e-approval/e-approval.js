import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import ListPaginationButtons from '@/components/list-pagination-buttons/list-pagination-buttons';
import ApprovalFormModal from './approval-form-modal/approval-form-modal';
import ApprovalDetailModal from './approval-detail-modal/approval-detail-modal';
import { API_BASE } from '@/config';
import '@/shared/crm-list-sheet-table.css';
import './e-approval.css';
import './e-approval-responsive.css';

const BOX_TABS = [
  { key: 'pending', label: '결재함' },
  { key: 'my-requests', label: '기안함' },
  { key: 'draft', label: '임시저장' },
  { key: 'completed', label: '완료함' },
  { key: 'all', label: '전체' }
];

const TYPE_FILTERS = [
  { key: '', label: '전체' },
  { key: 'vacation', label: '휴가' },
  { key: 'expense', label: '지출' },
  { key: 'quotation', label: '견적' },
  { key: 'proposal', label: '품의' }
];

const BOX_EMPTY_HINT = {
  pending: '현재 내 결재 차례인 문서만 표시됩니다. 내가 올린 기안은 「기안함」에서 확인하세요.',
  'my-requests': '내가 작성·상신한 문서가 여기에 표시됩니다.',
  draft: '임시저장한 문서가 여기에 표시됩니다.',
  completed: '완료된 문서가 여기에 표시됩니다.',
  all: '내가 관련된 문서가 여기에 표시됩니다.'
};

const STATUS_LABEL = {
  draft: '임시저장',
  pending: '결재중',
  approved: '승인',
  rejected: '반려',
  cancelled: '회수'
};

const STATUS_CLASS = {
  draft: 'e-approval-status--draft',
  pending: 'e-approval-status--pending',
  approved: 'e-approval-status--approved',
  rejected: 'e-approval-status--rejected',
  cancelled: 'e-approval-status--cancelled'
};

const DOC_TYPE_LABEL = {
  vacation: '휴가',
  expense: '지출',
  quotation: '견적',
  proposal: '품의'
};

const MODAL_PARAM = 'modal';
const MODAL_ADD = 'add';
const MODAL_DETAIL = 'detail';
const DETAIL_ID_PARAM = 'id';
const COL_SPAN = 6;

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getStoredUser() {
  try {
    const raw = localStorage.getItem('crm_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function formatListDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function EApproval() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = useMemo(() => getStoredUser(), []);
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [pendingBadge, setPendingBadge] = useState(0);
  const [searchDraft, setSearchDraft] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [editDoc, setEditDoc] = useState(null);
  const [detailOverride, setDetailOverride] = useState(null);
  const [listError, setListError] = useState('');

  const box = searchParams.get('box') || 'pending';
  const docType = searchParams.get('type') || '';
  const page = Math.max(1, parseInt(searchParams.get('page'), 10) || 1);

  const modalMode = searchParams.get(MODAL_PARAM);
  const isAddOpen = modalMode === MODAL_ADD;
  const detailId = searchParams.get(DETAIL_ID_PARAM);
  const isDetailOpen = modalMode === MODAL_DETAIL && detailId;

  const selectedDoc = useMemo(() => {
    if (!isDetailOpen || !detailId) return null;
    const fromList = items.find((d) => String(d._id) === String(detailId));
    if (fromList) return fromList;
    return detailOverride && String(detailOverride._id) === String(detailId) ? detailOverride : null;
  }, [detailId, detailOverride, isDetailOpen, items]);

  const fetchBadge = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/approvals/badge`, { headers: getAuthHeader() });
      if (!res.ok) return;
      const data = await res.json();
      setPendingBadge(Number(data.pending) || 0);
    } catch (_) {
      setPendingBadge(0);
    }
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const q = new URLSearchParams();
      q.set('box', box);
      q.set('page', String(page));
      q.set('limit', '20');
      if (docType) q.set('docType', docType);
      if (appliedSearch.trim()) q.set('search', appliedSearch.trim());
      const res = await fetch(`${API_BASE}/approvals?${q}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setItems(data.items || []);
        setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 });
      } else {
        setItems([]);
        setListError(data.error || '목록을 불러오지 못했습니다.');
      }
    } catch (_) {
      setItems([]);
      setListError('목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, box, docType, page]);

  useEffect(() => {
    fetchList();
    fetchBadge();
  }, [fetchBadge, fetchList]);

  useEffect(() => {
    if (!detailId || modalMode !== MODAL_DETAIL) {
      setDetailOverride(null);
      return;
    }
    if (items.some((d) => String(d._id) === String(detailId))) {
      setDetailOverride(null);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/approvals/${encodeURIComponent(detailId)}`, { headers: getAuthHeader() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?._id) setDetailOverride(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [detailId, items, modalMode]);

  const setParams = useCallback(
    (patch, replace = false) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          Object.entries(patch).forEach(([k, v]) => {
            if (v == null || v === '') next.delete(k);
            else next.set(k, String(v));
          });
          return next;
        },
        { replace }
      );
    },
    [setSearchParams]
  );

  const onSearch = (e) => {
    e?.preventDefault();
    setAppliedSearch(searchDraft.trim());
    setParams({ page: '1' }, true);
  };

  const openAdd = () => {
    setEditDoc(null);
    setParams({ [MODAL_PARAM]: MODAL_ADD, [DETAIL_ID_PARAM]: null, page: null });
  };

  const openDetail = (doc) => {
    setParams({ [MODAL_PARAM]: MODAL_DETAIL, [DETAIL_ID_PARAM]: doc._id });
  };

  const closeModal = () => {
    setEditDoc(null);
    setParams({ [MODAL_PARAM]: null, [DETAIL_ID_PARAM]: null });
  };

  const handleSaved = () => {
    fetchList();
    fetchBadge();
  };

  const handleRemoved = useCallback((docId) => {
    if (docId) {
      setItems((prev) => prev.filter((d) => String(d._id) !== String(docId)));
    }
    closeModal();
    fetchList();
    fetchBadge();
  }, [fetchBadge, fetchList]);

  const handleEditDraft = (doc) => {
    setEditDoc(doc);
    setParams({ [MODAL_PARAM]: MODAL_ADD, [DETAIL_ID_PARAM]: null });
  };

  const changeBox = (nextBox) => {
    setParams({ box: nextBox, page: '1' }, true);
  };

  const changeType = (nextType) => {
    setParams({ type: nextType || null, page: '1' }, true);
  };

  const renderEmptyContent = () => (
    <div className="e-approval-empty-inner">
      <p>{BOX_EMPTY_HINT[box] || '표시할 결재 문서가 없습니다.'}</p>
      {listError ? <p className="e-approval-list-error">{listError}</p> : null}
      {box === 'pending' ? (
        <button type="button" className="e-approval-empty-link" onClick={() => changeBox('my-requests')}>
          기안함으로 이동
        </button>
      ) : null}
      <button type="button" className="btn-primary e-approval-empty-add" onClick={openAdd}>
        <span className="material-symbols-outlined">add</span>
        새 기안 작성
      </button>
    </div>
  );

  const renderMobileCard = (doc) => (
    <button key={doc._id} type="button" className="e-approval-mobile-card" onClick={() => openDetail(doc)}>
      <div className="e-approval-mobile-card-top">
        <span className={`e-approval-type-badge e-approval-type-badge--${doc.docType}`}>
          {doc.docTypeLabel || DOC_TYPE_LABEL[doc.docType] || doc.docType}
        </span>
        <span className={`status-badge ${STATUS_CLASS[doc.status] || ''}`}>
          {STATUS_LABEL[doc.status] || doc.status}
        </span>
      </div>
      <p className="e-approval-mobile-card-title">{doc.title}</p>
      <p className="e-approval-mobile-card-meta">
        {doc.docNumber} · {doc.drafterName || '기안자'} · {formatListDate(doc.updatedAt || doc.createdAt)}
      </p>
      <span className="e-approval-mobile-card-chevron material-symbols-outlined" aria-hidden>chevron_right</span>
    </button>
  );

  return (
    <div className="page e-approval-page">
      <header className="page-header e-approval-header">
        <div className="e-approval-header-main">
          <h1 className="page-title">전자결재</h1>
        </div>
        <div className="header-search">
          <form id="e-approval-search-form" onSubmit={onSearch} className="header-search-form">
            <button type="submit" className="header-search-icon-btn" aria-label="검색">
              <span className="material-symbols-outlined">search</span>
            </button>
            <input
              type="text"
              placeholder="제목·문서번호·기안자 검색..."
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              aria-label="전자결재 검색"
            />
          </form>
        </div>
        <div className="e-approval-header-tools">
          <button type="button" className="btn-primary e-approval-header-add-btn" onClick={openAdd}>
            <span className="material-symbols-outlined">add</span>
            <span className="e-approval-header-btn-label">새 기안</span>
          </button>
          <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" />
        </div>
      </header>

      <div className="page-content">
        <div className="e-approval-filter-bar">
          <div className="e-approval-tabs" role="tablist" aria-label="결재함 구분">
            {BOX_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={box === tab.key}
                className={`e-approval-tab${box === tab.key ? ' is-active' : ''}`}
                onClick={() => changeBox(tab.key)}
              >
                {tab.label}
                {tab.key === 'pending' && pendingBadge > 0 ? (
                  <span className="e-approval-tab-badge">{pendingBadge > 99 ? '99+' : pendingBadge}</span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="e-approval-type-filters" aria-label="문서 유형">
            {TYPE_FILTERS.map((t) => (
              <button
                key={t.key || 'all'}
                type="button"
                className={`e-approval-type-chip${docType === t.key ? ' is-active' : ''}`}
                onClick={() => changeType(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="panel table-panel">
          <div className="e-approval-mobile-cards-wrap">
            {loading ? (
              <p className="e-approval-mobile-cards-message">불러오는 중…</p>
            ) : items.length === 0 ? (
              <div className="e-approval-mobile-empty">{renderEmptyContent()}</div>
            ) : (
              <div className="e-approval-mobile-cards-list">
                {items.map((doc) => renderMobileCard(doc))}
              </div>
            )}
          </div>

          <div className="table-wrap">
            <div className="crm-list-sheet-scroll">
              <div className="crm-list-sheet-table-wrap">
                <table className="data-table crm-list-sheet">
                  <colgroup>
                    <col style={{ width: '5.5rem' }} />
                    <col />
                    <col style={{ width: '9.5rem' }} />
                    <col style={{ width: '7rem' }} />
                    <col style={{ width: '11rem' }} />
                    <col style={{ width: '6.5rem' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>유형</th>
                      <th>제목</th>
                      <th>문서번호</th>
                      <th>기안자</th>
                      <th>일시</th>
                      <th>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={COL_SPAN} className="text-center">불러오는 중…</td></tr>
                    ) : items.length === 0 ? (
                      <tr>
                        <td colSpan={COL_SPAN} className="e-approval-empty-cell">
                          {renderEmptyContent()}
                        </td>
                      </tr>
                    ) : (
                      items.map((doc, idx) => (
                        <tr
                          key={doc._id}
                          className={`e-approval-row-clickable ${idx % 2 === 0 ? 'crm-list-sheet-row--stripe-a' : 'crm-list-sheet-row--stripe-b'}`}
                          onClick={() => openDetail(doc)}
                        >
                          <td>
                            <span className={`e-approval-type-badge e-approval-type-badge--${doc.docType}`}>
                              {doc.docTypeLabel || DOC_TYPE_LABEL[doc.docType] || doc.docType}
                            </span>
                          </td>
                          <td>
                            <span className="e-approval-cell-title">{doc.title || '—'}</span>
                          </td>
                          <td className="text-muted">{doc.docNumber || '—'}</td>
                          <td>{doc.drafterName || '—'}</td>
                          <td className="text-muted">{formatListDate(doc.updatedAt || doc.createdAt)}</td>
                          <td>
                            <span className={`status-badge ${STATUS_CLASS[doc.status] || ''}`}>
                              {STATUS_LABEL[doc.status] || doc.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="pagination-bar">
            <p className="pagination-info">
              <strong>{pagination.total}</strong>건 중{' '}
              <strong>{items.length ? (pagination.page - 1) * pagination.limit + 1 : 0}</strong>–
              <strong>{(pagination.page - 1) * pagination.limit + items.length}</strong>건 표시
            </p>
            <ListPaginationButtons
              page={pagination.page}
              totalPages={pagination.totalPages || 1}
              onPageChange={(p) => setParams({ page: String(p) })}
            />
          </div>
        </div>
      </div>

      <button type="button" className="e-approval-mobile-fab" onClick={openAdd} aria-label="새 기안 작성">
        <span className="material-symbols-outlined">add</span>
      </button>

      {(isAddOpen || editDoc) ? (
        <ApprovalFormModal
          currentUser={currentUser}
          editDoc={editDoc}
          onClose={closeModal}
          onSaved={handleSaved}
        />
      ) : null}

      {isDetailOpen && detailId ? (
        <ApprovalDetailModal
          doc={selectedDoc || { _id: detailId }}
          currentUser={currentUser}
          onClose={closeModal}
          onUpdated={handleSaved}
          onRemoved={handleRemoved}
          onEditDraft={handleEditDraft}
        />
      ) : null}
    </div>
  );
}
