import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import AddContactModal from './add-customer-company-employees-modal/add-customer-company-employees-modal';
import ContactDetailModal from './customer-company-employees-detail-modal/customer-company-employees-detail-modal';
import ListTemplateModal from '../components/list-template-modal/list-template-modal';
import {
  LIST_IDS,
  getSavedTemplate,
  getEffectiveTemplate,
  patchListTemplate
} from '../lib/list-templates';
import './customer-company-employees.css';
import './customer-company-employees-responsive.css';

import { API_BASE } from '@/config';
const LIST_ID = LIST_IDS.CUSTOMER_COMPANY_EMPLOYEES;
const MODAL_PARAM = 'modal';
const MODAL_ADD_CONTACT = 'add-contact';
const MODAL_DETAIL = 'detail';
const DETAIL_ID_PARAM = 'id';
const LIMIT = 10;

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const statusClass = { Active: 'status-active', Pending: 'status-pending', Lead: 'status-lead', Inactive: 'status-inactive' };
const statusLabel = { Active: '활성', Pending: '대기', Lead: '리드', Inactive: '비활성' };
const statusHint = { Lead: '잠재 고객', Active: '거래 진행 중', Pending: '회신 대기', Inactive: '관리 종료' };
const STATUS_OPTIONS = ['', 'Lead', 'Active', 'Pending', 'Inactive'];

export default function CustomerCompanyEmployees() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: LIMIT, total: 0, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState(new Set());
  const lastClickedIdx = useRef(null);
  const [googleSaving, setGoogleSaving] = useState(false);
  const [googleResult, setGoogleResult] = useState(null);
  const [template, setTemplate] = useState(() => getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID)));
  const [dragOverKey, setDragOverKey] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const sortKey = sort.key;
  const sortDir = sort.dir;
  /** URL로 연 상세 모달용: 목록에 없을 때 id로 따로 조회한 연락처 (새로고침·다른 페이지일 수 있음) */
  const [detailContactById, setDetailContactById] = useState(null);
  const [loadingDetailContact, setLoadingDetailContact] = useState(false);

  const isAddModalOpen = searchParams.get(MODAL_PARAM) === MODAL_ADD_CONTACT;
  const detailId = searchParams.get(DETAIL_ID_PARAM);
  const isDetailOpen = searchParams.get(MODAL_PARAM) === MODAL_DETAIL && detailId;
  const selectedContactFromList = isDetailOpen ? items.find((c) => c._id === detailId) || null : null;
  const selectedContact = selectedContactFromList || detailContactById;

  /** URL에 id가 있는데 목록에서 못 찾았을 때(로딩 중·다른 페이지·직접 링크) id로 연락처 한 건 조회 */
  useEffect(() => {
    if (!isDetailOpen || !detailId || selectedContactFromList) {
      if (!isDetailOpen) setDetailContactById(null);
      return;
    }
    setLoadingDetailContact(true);
    let cancelled = false;
    fetch(`${API_BASE}/customer-company-employees/${detailId}`, { headers: getAuthHeader() })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        if (data._id) setDetailContactById(data);
        else setDetailContactById(null);
      })
      .catch(() => { if (!cancelled) setDetailContactById(null); })
      .finally(() => { if (!cancelled) setLoadingDetailContact(false); });
    return () => { cancelled = true; };
  }, [isDetailOpen, detailId, selectedContactFromList]);

  const openAddModal = () => setSearchParams({ [MODAL_PARAM]: MODAL_ADD_CONTACT });
  const closeAddModal = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    setSearchParams(next, { replace: true });
  };

  const openDetailModal = (row) => {
    if (!row?._id) return;
    setSearchParams({ [MODAL_PARAM]: MODAL_DETAIL, [DETAIL_ID_PARAM]: row._id });
  };
  const closeDetailModal = () => {
    setDetailContactById(null);
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    next.delete(DETAIL_ID_PARAM);
    setSearchParams(next, { replace: true });
  };

  const fetchContacts = useCallback(async (page = 1, overrideStatus) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: LIMIT });
      if (search.trim()) params.set('search', search.trim());
      const st = overrideStatus !== undefined ? overrideStatus : statusFilter;
      if (st) params.set('status', st);
      const res = await fetch(`${API_BASE}/customer-company-employees?${params}`, { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setPagination(data.pagination || { page: 1, limit: LIMIT, total: 0, totalPages: 0 });
      } else {
        setItems([]);
        setPagination((p) => ({ ...p, total: 0, totalPages: 0 }));
      }
    } catch (_) {
      setItems([]);
      setPagination((p) => ({ ...p, total: 0, totalPages: 0 }));
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => { fetchContacts(pagination.page); }, [pagination.page]);

  useEffect(() => {
    setSelected(new Set());
    lastClickedIdx.current = null;
  }, [items]);

  const onSearch = (e) => {
    e?.preventDefault();
    setPagination((p) => ({ ...p, page: 1 }));
    fetchContacts(1);
  };

  const onStatusFilterChange = (val) => {
    setStatusFilter(val);
    setPagination((p) => ({ ...p, page: 1 }));
    fetchContacts(1, val);
  };

  const handleCheckboxClick = (idx, e) => {
    e.stopPropagation();
    setGoogleResult(null);

    if (e.shiftKey && lastClickedIdx.current !== null) {
      const start = Math.min(lastClickedIdx.current, idx);
      const end = Math.max(lastClickedIdx.current, idx);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          if (items[i]) next.add(items[i]._id);
        }
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        const id = items[idx]._id;
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
    lastClickedIdx.current = idx;
  };

  const handleSelectAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((r) => r._id)));
    }
    setGoogleResult(null);
  };

  const handleSaveToGoogle = async () => {
    const contacts = items.filter((r) => selected.has(r._id)).map((r) => ({
      name: r.name || '',
      email: r.email || '',
      phone: r.phone || '',
      company: r.company || ''
    }));
    if (contacts.length === 0) return;
    setGoogleSaving(true);
    setGoogleResult(null);
    try {
      const res = await fetch(`${API_BASE}/google-contacts/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ contacts })
      });
      const data = await res.json();
      if (res.ok) {
        setGoogleResult({ success: data.success, fail: data.fail, total: data.total, errors: data.errors });
        if (data.success > 0) setSelected(new Set());
      } else {
        setGoogleResult({ error: data.error || 'Google 주소록 저장에 실패했습니다.', needsReauth: data.needsReauth });
      }
    } catch (_) {
      setGoogleResult({ error: '서버에 연결할 수 없습니다.' });
    } finally {
      setGoogleSaving(false);
    }
  };

  const formatDate = (d) => {
    if (!d) return '—';
    const date = new Date(d);
    const now = new Date();
    const diffMs = now - date;
    if (diffMs < 0) return date.toLocaleDateString('ko-KR');
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return '방금 전';
    if (diffMin < 60) return `${diffMin}분 전`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}시간 전`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay}일 전`;
    return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const allChecked = items.length > 0 && selected.size === items.length;

  const saveTemplate = useCallback(async (payload) => {
    try {
      const data = await patchListTemplate(LIST_ID, payload);
      const next = getEffectiveTemplate(LIST_ID, data.listTemplates?.[LIST_ID] || payload);
      setTemplate(next);
    } catch (err) {
      alert(err.message || '저장에 실패했습니다.');
    }
  }, []);

  const handleHeaderDragStart = (e, key) => {
    e.dataTransfer.setData('text/plain', key);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleHeaderDragOver = (e, key) => {
    e.preventDefault();
    setDragOverKey(key);
  };
  const handleHeaderDragLeave = () => setDragOverKey(null);
  const handleHeaderDrop = (e, targetKey) => {
    e.preventDefault();
    setDragOverKey(null);
    const fromKey = e.dataTransfer.getData('text/plain');
    if (!fromKey || fromKey === targetKey) return;
    const order = [...template.columnOrder];
    const fromIdx = order.indexOf(fromKey);
    const toIdx = order.indexOf(targetKey);
    if (fromIdx === -1 || toIdx === -1) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, fromKey);
    saveTemplate({ columnOrder: order, visible: template.visible });
  };

  const displayColumns = template.columns.filter((c) => template.visible[c.key]);
  const colSpan = Math.max(1, displayColumns.length);

  const getSortValue = useCallback((row, key) => {
    if (key === 'company') return (row.company || '').toLowerCase();
    if (key === 'name') return (row.name || '').toLowerCase();
    if (key === 'email') return (row.email || '').toLowerCase();
    if (key === 'phone') return (row.phone || '').toLowerCase();
    if (key === 'status') return (row.status || '').toLowerCase();
    if (key === 'lastSupportedAt') return new Date(row.lastSupportedAt || 0).getTime();
    return '';
  }, []);

  const sortedItems = useMemo(() => {
    if (!sortKey || sortKey === '_check') return items;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [items, sortKey, sortDir, getSortValue]);

  const handleSortColumn = useCallback((key) => {
    if (key === '_check') return;
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { key, dir: 'asc' };
    });
  }, []);

  return (
    <div className="page customer-company-employees-page">
      <header className="page-header">
        <div className="header-search">
          <button type="submit" form="customer-company-employees-search-form" className="header-search-icon-btn" aria-label="검색">
            <span className="material-symbols-outlined">search</span>
          </button>
          <form id="customer-company-employees-search-form" onSubmit={onSearch}>
            <input type="text" placeholder="이름, 회사, 이메일, 전화, 주소 검색..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
          <select
            className="cce-status-filter"
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s ? statusLabel[s] : '전체 상태'}</option>
            ))}
          </select>
          {statusFilter && <span className="cce-status-hint">{statusHint[statusFilter]}</span>}
        </div>
        <div className="header-actions">
          <button type="button" className="icon-btn" aria-label="알림"><span className="material-symbols-outlined">notifications</span></button>
          <button type="button" className="icon-btn" aria-label="채팅"><span className="material-symbols-outlined">chat_bubble</span></button>
          <button type="button" className="icon-btn" aria-label="리스트 열 설정" onClick={() => setSettingsOpen(true)} title="리스트 열 설정">
            <span className="material-symbols-outlined">settings</span>
          </button>
        </div>
      </header>
      <div className="page-content">
        <div className="customer-company-employees-top">
          <div>
            <h2>연락처</h2>
            <p className="page-desc">총 {pagination.total || 0}건의 연락처를 관리 중입니다</p>
          </div>
          <div className="customer-company-employees-actions">
            <button type="button" className="btn-outline"><span className="material-symbols-outlined">file_download</span> 내보내기</button>
            <button type="button" className="btn-primary" onClick={openAddModal}><span className="material-symbols-outlined">add</span> 새 연락처 추가</button>
          </div>
        </div>

        {/* 선택 액션 바 */}
        {selected.size > 0 && (
          <div className="cce-action-bar">
            <span className="cce-action-bar-count">
              <strong>{selected.size}</strong>명 선택됨
              <span className="cce-action-bar-hint">Shift+클릭으로 범위 선택</span>
            </span>
            <div className="cce-action-bar-btns">
              <button
                type="button"
                className="cce-action-bar-google"
                onClick={handleSaveToGoogle}
                disabled={googleSaving}
              >
                <img src="https://www.gstatic.com/images/branding/product/1x/contacts_2022_48dp.png" alt="" className="cce-action-google-icon" />
                {googleSaving ? '저장 중...' : `구글 주소록에 저장 (${selected.size}명)`}
              </button>
              <button type="button" className="cce-action-bar-cancel" onClick={() => setSelected(new Set())}>선택 해제</button>
            </div>
          </div>
        )}

        {/* Google 저장 결과 */}
        {googleResult && (
          <div className={`cce-google-result ${googleResult.error ? 'error' : googleResult.fail > 0 ? 'warn' : 'ok'}`}>
            <span className="material-symbols-outlined">
              {googleResult.error ? 'error' : googleResult.fail > 0 ? 'info' : 'check_circle'}
            </span>
            {googleResult.error
              ? <>{googleResult.error}{googleResult.needsReauth && <> (Google 계정으로 재로그인 필요)</>}</>
              : <>
                  총 {googleResult.total}명 중 <strong>{googleResult.success}명</strong> 저장 완료
                  {googleResult.fail > 0 && <>, {googleResult.fail}명 실패</>}
                  {googleResult.errors?.length > 0 && (
                    <span className="cce-google-result-detail"> — {googleResult.errors[0].detail?.slice(0, 80)}</span>
                  )}
                </>
            }
            <button type="button" className="cce-google-result-dismiss" onClick={() => setGoogleResult(null)}>×</button>
          </div>
        )}

        <div className="panel table-panel">
          {/* 모바일 전용 카드 목록 (customerForMobile.html 구조) */}
          <div className="cce-mobile-cards-wrap">
            {loading ? (
              <p className="cce-mobile-cards-message">불러오는 중...</p>
            ) : sortedItems.length === 0 ? (
              <p className="cce-mobile-cards-message">등록된 연락처가 없습니다.</p>
            ) : (
              <div className="cce-mobile-cards-list">
                {sortedItems.map((row) => (
                  <div
                    key={row._id}
                    className="cce-mobile-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => openDetailModal(row)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetailModal(row); } }}
                  >
                    <div className="cce-mobile-card-avatar">
                      <div className="avatar-img" aria-hidden />
                    </div>
                    <div className="cce-mobile-card-body">
                      <div className="cce-mobile-card-head">
                        <h3 className="cce-mobile-card-name">{row.name || '—'}</h3>
                        <span className={`cce-mobile-card-status status-badge ${statusClass[row.status] || ''}`}>
                          {statusLabel[row.status] || row.status || '—'}
                        </span>
                      </div>
                      <p className="cce-mobile-card-company">{row.company || '—'}</p>
                      <div className="cce-mobile-card-details">
                        <div className="cce-mobile-card-email">
                          <span className="material-symbols-outlined" aria-hidden>mail</span>
                          <span>{row.email || '—'}</span>
                        </div>
                        <p className="cce-mobile-card-meta">
                          최근 지원: {row.lastSupportedAt ? formatDate(row.lastSupportedAt) : '—'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {displayColumns.map((col) => (
                    <th
                      key={col.key}
                      className={`${col.key === '_check' ? 'cce-th-check' : ''} ${col.key === 'status' ? 'cce-td-status' : ''} ${dragOverKey === col.key ? 'list-template-drag-over' : ''} ${col.key !== '_check' ? 'list-template-th-sortable' : ''}`}
                      draggable
                      onDragStart={(e) => handleHeaderDragStart(e, col.key)}
                      onDragOver={(e) => handleHeaderDragOver(e, col.key)}
                      onDragLeave={handleHeaderDragLeave}
                      onDrop={(e) => handleHeaderDrop(e, col.key)}
                      onClick={col.key !== '_check' ? () => handleSortColumn(col.key) : undefined}
                    >
                      {col.key === '_check' ? (
                        <input
                          type="checkbox"
                          className="cce-row-checkbox"
                          checked={allChecked}
                          onChange={handleSelectAll}
                        />
                      ) : (
                        <span className="list-template-th-content">
                          <span className="material-symbols-outlined list-template-drag-handle" aria-hidden>drag_indicator</span>
                          {col.label}
                          {sortKey === col.key && (
                            <span className="list-template-sort-icon material-symbols-outlined" aria-hidden>
                              {sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                            </span>
                          )}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={colSpan} className="text-center">불러오는 중...</td></tr>
                ) : sortedItems.length === 0 ? (
                  <tr><td colSpan={colSpan} className="text-center">등록된 연락처가 없습니다.</td></tr>
                ) : (
                  sortedItems.map((row, idx) => {
                    const isChecked = selected.has(row._id);
                    return (
                      <tr
                        key={row._id}
                        className={`customer-company-employees-row-clickable ${isChecked ? 'cce-row-selected' : ''}`}
                        onClick={() => openDetailModal(row)}
                      >
                        {displayColumns.map((col) => (
                          <td
                            key={col.key}
                            data-label={col.key === '_check' ? '' : col.label}
                            className={col.key === '_check' ? 'cce-td-check' : col.key === 'status' ? 'cce-td-status' : col.key !== 'name' ? 'text-muted' : ''}
                            onClick={col.key === '_check' ? (e) => e.stopPropagation() : undefined}
                          >
                            {col.key === '_check' && (
                              <input
                                type="checkbox"
                                className="cce-row-checkbox"
                                checked={isChecked}
                                onChange={() => {}}
                                onClick={(e) => handleCheckboxClick(idx, e)}
                              />
                            )}
                            {col.key === 'company' && (() => {
                              const hasConfirmedCompany = row.customerCompanyId && String(row.customerCompanyId.businessNumber || '').trim();
                              const unconfirmed = row.company && !hasConfirmedCompany;
                              return (
                                <span className={unconfirmed ? 'cce-company-unconfirmed' : undefined}>
                                  {row.company || '—'}
                                </span>
                              );
                            })()}
                            {col.key === 'name' && (
                              <div className="cell-user">
                                <div className="avatar-img" />
                                <span className="font-semibold">{row.name || '—'}</span>
                              </div>
                            )}
                            {col.key === 'email' && (row.email || '—')}
                            {col.key === 'phone' && (row.phone || '—')}
                            {col.key === 'status' && (
                              <span className={`status-badge ${statusClass[row.status] || ''}`}>{statusLabel[row.status] || row.status || '—'}</span>
                            )}
                            {col.key === 'lastSupportedAt' && (row.lastSupportedAt ? formatDate(row.lastSupportedAt) : '—')}
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="pagination-bar">
            <p className="pagination-info">
              <strong>{pagination.total}</strong>건 중 <strong>{items.length ? (pagination.page - 1) * pagination.limit + 1 : 0}</strong>–<strong>{(pagination.page - 1) * pagination.limit + items.length}</strong>건 표시
            </p>
            <div className="pagination-btns">
              <button type="button" className="pagination-btn" disabled={pagination.page <= 1} onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}><span className="material-symbols-outlined">chevron_left</span></button>
              <span className="pagination-current">{pagination.page} / {pagination.totalPages || 1}</span>
              <button type="button" className="pagination-btn" disabled={pagination.page >= (pagination.totalPages || 1)} onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}><span className="material-symbols-outlined">chevron_right</span></button>
            </div>
          </div>
        </div>
      </div>
      {isAddModalOpen && (
        <AddContactModal
          onClose={closeAddModal}
          onSaved={() => { fetchContacts(pagination.page); closeAddModal(); }}
        />
      )}
      {settingsOpen && (
        <ListTemplateModal
          listId={LIST_ID}
          columns={template.columns}
          visible={template.visible}
          columnOrder={template.columnOrder}
          onSave={saveTemplate}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {isDetailOpen && !selectedContact && loadingDetailContact && (
        <div className="customer-company-employees-detail-loading-overlay" role="dialog" aria-busy="true">
          <p>연락처 정보를 불러오는 중...</p>
          <button type="button" className="btn-outline" onClick={closeDetailModal}>취소</button>
        </div>
      )}
      {isDetailOpen && !selectedContact && !loadingDetailContact && (
        <div className="customer-company-employees-detail-loading-overlay" role="dialog">
          <p>해당 연락처를 찾을 수 없습니다.</p>
          <button type="button" className="btn-outline" onClick={closeDetailModal}>닫기</button>
        </div>
      )}
      {isDetailOpen && selectedContact && (
        <ContactDetailModal
          contact={selectedContact}
          onClose={closeDetailModal}
          onUpdated={(updatedContact) => {
            if (updatedContact?._id) {
              setItems((prev) => prev.map((c) => (c._id === updatedContact._id ? updatedContact : c)));
              setDetailContactById((prev) => (prev?._id === updatedContact._id ? updatedContact : prev));
            }
            fetchContacts(pagination.page);
          }}
        />
      )}
    </div>
  );
}
