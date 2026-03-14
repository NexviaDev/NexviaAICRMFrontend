import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import AddCompanyModal from './add-company-modal/add-company-modal';
import CustomerCompanyDetailModal from './customer-company-detail-modal/customer-company-detail-modal';
import ListTemplateModal from '../components/list-template-modal/list-template-modal';
import {
  LIST_IDS,
  getSavedTemplate,
  getEffectiveTemplate,
  patchListTemplate
} from '../lib/list-templates';
import './customer-companies.css';
import './customer-companies-responsive.css';

import { API_BASE } from '@/config';
const MODAL_PARAM = 'modal';
const MODAL_ADD_COMPANY = 'add-company';
const MODAL_DETAIL = 'detail';
const DETAIL_ID_PARAM = 'id';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatBusinessNumber(num) {
  if (!num) return '—';
  const s = String(num).replace(/\D/g, '');
  if (s.length <= 3) return s;
  if (s.length <= 5) return `${s.slice(0, 3)}-${s.slice(3)}`;
  return `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5, 10)}`;
}

const LIST_ID = LIST_IDS.CUSTOMER_COMPANIES;

function cellValue(row, key) {
  if (key === 'name') return row.name || '—';
  if (key === 'representativeName') return row.representativeName || '—';
  if (key === 'businessNumber') return formatBusinessNumber(row.businessNumber);
  if (key === 'address') return row.address || '—';
  return '—';
}

export default function CustomerCompanies() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [loading, setLoading] = useState(true);
  const [template, setTemplate] = useState(() => getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID)));
  const [dragOverKey, setDragOverKey] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const sortKey = sort.key;
  const sortDir = sort.dir;
  /** URL로 연 상세 모달용: 목록에 없을 때 id로 따로 조회한 회사 (새로고침 시 items 비어 있을 수 있음) */
  const [detailCompanyById, setDetailCompanyById] = useState(null);
  const [loadingDetailCompany, setLoadingDetailCompany] = useState(false);

  const isAddModalOpen = searchParams.get(MODAL_PARAM) === MODAL_ADD_COMPANY;
  const detailId = searchParams.get(DETAIL_ID_PARAM);
  const isDetailOpen = searchParams.get(MODAL_PARAM) === MODAL_DETAIL && detailId;
  const selectedCompanyFromList = isDetailOpen
    ? items.find((c) => c._id === detailId) || null
    : null;
  const selectedCompany = selectedCompanyFromList || detailCompanyById;

  /** URL에 id가 있는데 목록에서 못 찾았을 때(로딩 중·직접 링크) id로 회사 한 건 조회 */
  useEffect(() => {
    if (!isDetailOpen || !detailId || selectedCompanyFromList) {
      if (!isDetailOpen) setDetailCompanyById(null);
      return;
    }
    setLoadingDetailCompany(true);
    let cancelled = false;
    fetch(`${API_BASE}/customer-companies/${detailId}`, { headers: getAuthHeader() })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        if (data._id) setDetailCompanyById(data);
        else setDetailCompanyById(null);
      })
      .catch(() => { if (!cancelled) setDetailCompanyById(null); })
      .finally(() => { if (!cancelled) setLoadingDetailCompany(false); });
    return () => { cancelled = true; };
  }, [isDetailOpen, detailId, selectedCompanyFromList]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const url = searchApplied
        ? `${API_BASE}/customer-companies?search=${encodeURIComponent(searchApplied)}&limit=500`
        : `${API_BASE}/customer-companies?limit=500`;
      const res = await fetch(url, { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      } else {
        setItems([]);
      }
    } catch (_) {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [searchApplied]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const openAddModal = () => setSearchParams({ [MODAL_PARAM]: MODAL_ADD_COMPANY });
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
    setDetailCompanyById(null);
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    next.delete(DETAIL_ID_PARAM);
    setSearchParams(next, { replace: true });
  };

  const runSearch = (e) => {
    e?.preventDefault();
    setSearchApplied(searchInput.trim());
  };

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
    if (key === 'name') return (row.name || '').toLowerCase();
    if (key === 'representativeName') return (row.representativeName || '').toLowerCase();
    if (key === 'businessNumber') return String(row.businessNumber || '').replace(/\D/g, '');
    if (key === 'address') return (row.address || '').toLowerCase();
    return '';
  }, []);

  const sortedItems = useMemo(() => {
    if (!sortKey) return items;
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
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { key, dir: 'asc' };
    });
  }, []);

  return (
    <div className="page customer-companies-page">
      <header className="page-header">
        <div className="header-search">
          <button type="submit" form="customer-companies-search-form" className="header-search-icon-btn" aria-label="검색">
            <span className="material-symbols-outlined">search</span>
          </button>
          <form id="customer-companies-search-form" onSubmit={runSearch} className="header-search-form">
            <input
              type="text"
              placeholder="고객사명, 대표자, 사업자번호, 주소 검색..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="고객사 검색"
            />
          </form>
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
        <div className="customer-companies-top">
          <div>
            <h2>고객사 리스트</h2>
            <p className="page-desc">총 {items.length}개 고객사를 관리 중입니다</p>
          </div>
          <div className="customer-companies-actions">
            <button type="button" className="btn-outline"><span className="material-symbols-outlined">file_download</span> 내보내기</button>
            <button type="button" className="btn-primary" onClick={openAddModal}><span className="material-symbols-outlined">add</span> 고객사 추가</button>
          </div>
        </div>
        <div className="panel table-panel">
          {/* 모바일 전용 카드 목록 (customerForMobile.html 구조) */}
          <div className="customer-companies-mobile-cards-wrap">
            {loading ? (
              <p className="customer-companies-mobile-cards-message">불러오는 중...</p>
            ) : sortedItems.length === 0 ? (
              <p className="customer-companies-mobile-cards-message">등록된 고객사가 없습니다.</p>
            ) : (
              <div className="customer-companies-mobile-cards-list">
                {sortedItems.map((row) => (
                  <div
                    key={row._id}
                    className="customer-companies-mobile-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => openDetailModal(row)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetailModal(row); } }}
                  >
                    <div className="customer-companies-mobile-card-avatar">
                      <div className="avatar-img company-avatar"><span className="material-symbols-outlined" aria-hidden>business</span></div>
                    </div>
                    <div className="customer-companies-mobile-card-body">
                      <h3 className="customer-companies-mobile-card-name">{row.name || '—'}</h3>
                      <p className="customer-companies-mobile-card-sub">{row.representativeName || '—'}</p>
                      <div className="customer-companies-mobile-card-details">
                        <p className="customer-companies-mobile-card-meta">사업자번호 {formatBusinessNumber(row.businessNumber)}</p>
                        <p className="customer-companies-mobile-card-address">{row.address || '—'}</p>
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
                      className={`${dragOverKey === col.key ? 'list-template-drag-over' : ''} list-template-th-sortable`}
                      draggable
                      onDragStart={(e) => handleHeaderDragStart(e, col.key)}
                      onDragOver={(e) => handleHeaderDragOver(e, col.key)}
                      onDragLeave={handleHeaderDragLeave}
                      onDrop={(e) => handleHeaderDrop(e, col.key)}
                      onClick={() => handleSortColumn(col.key)}
                    >
                      <span className="list-template-th-content">
                        <span className="material-symbols-outlined list-template-drag-handle" aria-hidden>drag_indicator</span>
                        {col.label}
                        {sortKey === col.key && (
                          <span className="list-template-sort-icon material-symbols-outlined" aria-hidden>
                            {sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                          </span>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={colSpan} className="text-center">불러오는 중...</td></tr>
                ) : sortedItems.length === 0 ? (
                  <tr><td colSpan={colSpan} className="text-center">등록된 고객사가 없습니다.</td></tr>
                ) : (
                  sortedItems.map((row) => (
                    <tr key={row._id} className="customer-companies-row-clickable" onClick={() => openDetailModal(row)}>
                      {displayColumns.map((col) => (
                        <td key={col.key} data-label={col.label} className={col.key === 'name' ? '' : 'text-muted'}>
                          {col.key === 'name' ? (
                            <div className="cell-user">
                              <div className="avatar-img company-avatar"><span className="material-symbols-outlined">business</span></div>
                              <span className="font-semibold">{cellValue(row, col.key)}</span>
                            </div>
                          ) : (
                            cellValue(row, col.key)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
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
      {isAddModalOpen && (
        <AddCompanyModal
          onClose={closeAddModal}
          onSaved={() => { fetchList(); closeAddModal(); }}
        />
      )}
      {isDetailOpen && !selectedCompany && loadingDetailCompany && (
        <div className="customer-companies-detail-loading-overlay" role="dialog" aria-busy="true">
          <p>고객사 정보를 불러오는 중...</p>
          <button type="button" className="btn-outline" onClick={closeDetailModal}>취소</button>
        </div>
      )}
      {isDetailOpen && !selectedCompany && !loadingDetailCompany && (
        <div className="customer-companies-detail-loading-overlay" role="dialog">
          <p>해당 고객사를 찾을 수 없습니다.</p>
          <button type="button" className="btn-outline" onClick={closeDetailModal}>닫기</button>
        </div>
      )}
      {isDetailOpen && selectedCompany && (
        <CustomerCompanyDetailModal
          company={selectedCompany}
          onClose={closeDetailModal}
          onUpdated={(updatedCompany) => {
            if (updatedCompany?._id) {
              setItems((prev) => prev.map((c) => (c._id === updatedCompany._id ? updatedCompany : c)));
              setDetailCompanyById((prev) => (prev?._id === updatedCompany._id ? updatedCompany : prev));
            }
          }}
          onDeleted={() => {
            fetchList();
            closeDetailModal();
          }}
        />
      )}
    </div>
  );
}
