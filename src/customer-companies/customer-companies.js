import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import AddCompanyModal from './add-company-modal/add-company-modal';
import CustomerCompanyDetailModal from './customer-company-detail-modal/customer-company-detail-modal';
import CustomerCompaniesExcelImportModal from './customer-companies-excel-import-modal/customer-companies-excel-import-modal';
import ListTemplateModal from '../components/list-template-modal/list-template-modal';
import {
  LIST_IDS,
  getSavedTemplate,
  getEffectiveTemplate,
  patchListTemplate
} from '../lib/list-templates';
import './customer-companies.css';
import './customer-companies-responsive.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';

import { API_BASE } from '@/config';
const MODAL_PARAM = 'modal';
const MODAL_ADD_COMPANY = 'add-company';
const MODAL_EXCEL_IMPORT = 'excel-import';
const MODAL_DETAIL = 'detail';
const DETAIL_ID_PARAM = 'id';
const LIMIT = 10;

/** 페이지네이션에 표시할 번호 목록 (현재 페이지 주변 + 첫/끝, 생략은 '...') */
function getPageNumbers(current, total) {
  if (total <= 0) return [];
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('...');
    result.push(sorted[i]);
  }
  return result;
}

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

const CUSTOM_FIELDS_PREFIX = 'customFields.';
/** @param {Record<string, string>} [assigneeIdToName] - userId → 이름 (목록 담당자 셀 표시용) */
function cellValue(row, key, assigneeIdToName = {}, assigneeNamesReady = false) {
  if (key === 'name') return row.name || '—';
  if (key === 'representativeName') return row.representativeName || '—';
  if (key === 'businessNumber') return formatBusinessNumber(row.businessNumber);
  if (key === 'address') return row.address || '—';
  if (key === 'assigneeUserIds') {
    const ids = Array.isArray(row.assigneeUserIds) ? row.assigneeUserIds : [];
    const names = ids.map((id) => assigneeIdToName[String(id)] || '').filter(Boolean);
    if (names.length) return names.join(', ');
    if (ids.length === 0) return '—';
    return assigneeNamesReady ? '—' : '담당자 불러오는 중...';
  }
  if (key.startsWith(CUSTOM_FIELDS_PREFIX)) {
    const fieldKey = key.slice(CUSTOM_FIELDS_PREFIX.length);
    const v = row.customFields?.[fieldKey];
    return v !== undefined && v !== null && v !== '' ? String(v) : '—';
  }
  return '—';
}

export default function CustomerCompanies() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [assigneeMeOnly, setAssigneeMeOnly] = useState(() => getSavedTemplate(LIST_ID)?.assigneeMeOnly === true);
  const [loading, setLoading] = useState(true);
  const [customFieldColumns, setCustomFieldColumns] = useState([]);
  const [template, setTemplate] = useState(() => getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID)));
  const [dragOverKey, setDragOverKey] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [companyEmployees, setCompanyEmployees] = useState([]); // 사내 직원 (담당자 이름 표시용)
  const [companyEmployeesLoaded, setCompanyEmployeesLoaded] = useState(false);
  const [searchField, setSearchField] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: LIMIT, total: 0, totalPages: 0 });
  const SEARCH_FIELD_OPTIONS = [
    { key: 'name', label: '고객사명' },
    { key: 'representativeName', label: '대표자' },
    { key: 'businessNumber', label: '사업자 번호' },
    { key: 'address', label: '주소' },
    { key: 'status', label: '상태' },
    { key: 'assigneeUserIds', label: '담당자' },
    { key: 'memo', label: '메모' }
  ];
  const sortKey = sort.key;
  const assigneeIdToName = useMemo(() => {
    const map = {};
    (companyEmployees || []).forEach((e) => {
      const id = e.id != null ? String(e.id) : (e._id ? String(e._id) : null);
      if (id) map[id] = e.name || e.email || id;
    });
    return map;
  }, [companyEmployees]);
  const sortDir = sort.dir;
  /** URL로 연 상세 모달용: 목록에 없을 때 id로 따로 조회한 회사 (새로고침 시 items 비어 있을 수 있음) */
  const [detailCompanyById, setDetailCompanyById] = useState(null);
  const [loadingDetailCompany, setLoadingDetailCompany] = useState(false);
  const isAddModalOpen = searchParams.get(MODAL_PARAM) === MODAL_ADD_COMPANY;
  const isExcelImportOpen = searchParams.get(MODAL_PARAM) === MODAL_EXCEL_IMPORT;
  const detailId = searchParams.get(DETAIL_ID_PARAM);
  const isDetailOpen = searchParams.get(MODAL_PARAM) === MODAL_DETAIL && detailId;
  const selectedCompanyFromList = isDetailOpen
    ? items.find((c) => c._id === detailId) || null
    : null;
  const selectedCompany = selectedCompanyFromList || detailCompanyById;

  /** 사내 직원 목록 (담당자 열 이름 표시용) */
  useEffect(() => {
    let cancelled = false;
    setCompanyEmployeesLoaded(false);
    fetch(`${API_BASE}/companies/overview`, { headers: getAuthHeader() })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.employees)) setCompanyEmployees(data.employees);
      })
      .catch(() => {
        if (!cancelled) setCompanyEmployees([]);
      })
      .finally(() => {
        if (!cancelled) setCompanyEmployeesLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

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

  const fetchList = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (searchApplied) {
        params.set('search', searchApplied);
        if (searchField) params.set('searchField', searchField);
      }
      if (assigneeMeOnly) params.set('assigneeMe', '1');
      const url = `${API_BASE}/customer-companies?${params.toString()}`;
      const res = await fetch(url, { headers: getAuthHeader() });
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
  }, [searchApplied, searchField, assigneeMeOnly]);

  useEffect(() => { fetchList(pagination.page); }, [pagination.page, fetchList]);
  useEffect(() => {
    const onExcelImportDone = () => { fetchList(pagination.page); };
    window.addEventListener('cc-excel-import-completed', onExcelImportDone);
    return () => window.removeEventListener('cc-excel-import-completed', onExcelImportDone);
  }, [fetchList, pagination.page]);
  useEffect(() => { setPagination((p) => ({ ...p, page: 1 })); }, [searchApplied, searchField, assigneeMeOnly]);

  /** 새 고객사 추가 시 정의된 커스텀 필드를 리스트 템플릿에 반영 */
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/custom-field-definitions?entityType=customerCompany`, { headers: getAuthHeader() })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        const extra = items.map((d) => ({ key: `${CUSTOM_FIELDS_PREFIX}${d.key}`, label: d.label || d.key || '' }));
        setCustomFieldColumns(extra);
        setTemplate((prev) => getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), extra));
      })
      .catch(() => { if (!cancelled) setCustomFieldColumns([]); });
    return () => { cancelled = true; };
  }, []);

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

  const openExcelImportModal = () => setSearchParams({ [MODAL_PARAM]: MODAL_EXCEL_IMPORT });
  const closeExcelImportModal = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    setSearchParams(next, { replace: true });
  };

  const runSearch = (e) => {
    e?.preventDefault();
    setSearchApplied(searchInput.trim());
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const handleToggleFavorite = async (rowId, nextValue) => {
    if (!rowId) return;
    try {
      const res = await fetch(`${API_BASE}/customer-companies/${rowId}/favorite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ isFavorite: nextValue })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setItems((prev) => prev.map((row) => (row._id === rowId ? { ...row, isFavorite: !!data.isFavorite } : row)));
      setDetailCompanyById((prev) => (prev?._id === rowId ? { ...prev, isFavorite: !!data.isFavorite } : prev));
      fetchList(pagination.page);
    } catch (_) {}
  };

  const saveTemplate = useCallback(async (payload) => {
    try {
      const data = await patchListTemplate(LIST_ID, payload);
      setTemplate(getEffectiveTemplate(LIST_ID, data.listTemplates?.[LIST_ID] || payload, customFieldColumns));
    } catch (err) {
      alert(err.message || '저장에 실패했습니다.');
    }
  }, [customFieldColumns]);

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
    if (key === 'assigneeUserIds') {
      const ids = Array.isArray(row.assigneeUserIds) ? row.assigneeUserIds : [];
      const names = ids.map((id) => assigneeIdToName[String(id)] || '').filter(Boolean);
      return names.join(' ').toLowerCase();
    }
    if (key.startsWith(CUSTOM_FIELDS_PREFIX)) {
      const fieldKey = key.slice(CUSTOM_FIELDS_PREFIX.length);
      const v = row.customFields?.[fieldKey];
      return (v !== undefined && v !== null ? String(v) : '').toLowerCase();
    }
    return '';
  }, [assigneeIdToName]);

  const sortedItems = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      const favDiff = Number(!!b.isFavorite) - Number(!!a.isFavorite);
      if (favDiff !== 0) return favDiff;
      if (!sortKey || sortKey === '_favorite') return 0;
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [items, sortKey, sortDir, getSortValue]);

  const handleSortColumn = useCallback((key) => {
    if (key === '_favorite') return;
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
              placeholder={searchField ? `${SEARCH_FIELD_OPTIONS.find((o) => o.key === searchField)?.label || searchField} 검색...` : '모든 필드 검색 (고객사명, 대표자, 주소, 메모, 커스텀 필드 등)...'}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="고객사 검색"
            />
          </form>
          <select
            className="cc-sort-column-select"
            value={searchField}
            onChange={(e) => setSearchField(e.target.value)}
            aria-label="검색 필드"
          >
            <option value="">전체 필드</option>
            {SEARCH_FIELD_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="header-actions">
          <button type="button" className="icon-btn" aria-label="리스트 열 설정" onClick={() => { setTemplate(getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), customFieldColumns)); setSettingsOpen(true); }} title="리스트 열 설정">
            <span className="material-symbols-outlined">settings</span>
          </button>
          <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" />
        </div>
      </header>
      <div className="page-content">
        <div className="customer-companies-top">
          <div>
            <h2>고객사 리스트</h2>
            <p className="page-desc">
              총 {pagination.total || 0}개 고객사를 관리 중입니다
            </p>
          </div>
          <div className="customer-companies-actions">
            <button
              type="button"
              className={`icon-btn cc-assignee-filter-btn ${assigneeMeOnly ? 'active' : ''}`}
              onClick={() => {
                const next = !assigneeMeOnly;
                setAssigneeMeOnly(next);
                patchListTemplate(LIST_ID, { assigneeMeOnly: next }).catch((err) => {
                  alert(err?.message || '저장에 실패했습니다.');
                  setAssigneeMeOnly(assigneeMeOnly);
                });
              }}
              title={assigneeMeOnly ? '전체 고객사 보기' : '내 담당 업체 보기'}
              aria-label={assigneeMeOnly ? '전체 고객사 보기' : '내 담당 업체 보기'}
            >
              <span className="material-symbols-outlined">person_pin_circle</span>
              <span className="cc-filter-label">내 담당 업체 보기</span>
            </button>
            <button
              type="button"
              className="icon-btn cc-assignee-filter-btn"
              onClick={openExcelImportModal}
              title="엑셀 파일을 매핑하여 고객사 일괄 등록"
              aria-label="엑셀 매핑 가져오기"
            >
              <span className="material-symbols-outlined">upload_file</span>
              <span className="cc-filter-label">엑셀 매핑 가져오기</span>
            </button>
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
                      <div className="customer-companies-mobile-card-head">
                        <h3 className="customer-companies-mobile-card-name">{row.name || '—'}</h3>
                        <button
                          type="button"
                          className={`cc-favorite-btn cc-mobile-favorite-btn ${row.isFavorite ? 'is-active' : ''}`}
                          aria-label={row.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 등록'}
                          title={row.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 등록'}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleFavorite(row._id, !row.isFavorite);
                          }}
                        >
                          <span className="material-symbols-outlined" aria-hidden>star</span>
                        </button>
                      </div>
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
              <colgroup>
                {displayColumns.map((col) => (
                  <col key={col.key} style={col.key === '_favorite' ? { width: '3.25rem' } : undefined} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {displayColumns.map((col) => (
                    <th
                      key={col.key}
                      className={`${col.key === '_favorite' ? 'cc-th-favorite' : ''} ${dragOverKey === col.key ? 'list-template-drag-over' : ''} ${col.key !== '_favorite' ? 'list-template-th-sortable' : ''}`}
                      draggable
                      onDragStart={(e) => handleHeaderDragStart(e, col.key)}
                      onDragOver={(e) => handleHeaderDragOver(e, col.key)}
                      onDragLeave={handleHeaderDragLeave}
                      onDrop={(e) => handleHeaderDrop(e, col.key)}
                      onClick={col.key !== '_favorite' ? () => handleSortColumn(col.key) : undefined}
                    >
                      {col.key === '_favorite' ? (
                        <span className="cc-th-favorite-icon material-symbols-outlined" aria-hidden>star</span>
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
                  <tr><td colSpan={colSpan} className="text-center">등록된 고객사가 없습니다.</td></tr>
                ) : (
                  sortedItems.map((row) => (
                    <tr key={row._id} className="customer-companies-row-clickable" onClick={() => openDetailModal(row)}>
                      {displayColumns.map((col) => (
                        <td
                          key={col.key}
                          data-label={col.key === '_favorite' ? '' : col.label}
                          className={col.key === '_favorite' ? 'cc-td-favorite' : col.key === 'name' ? '' : 'text-muted'}
                          onClick={col.key === '_favorite' ? (e) => e.stopPropagation() : undefined}
                        >
                          {col.key === '_favorite' ? (
                            <button
                              type="button"
                              className={`cc-favorite-btn ${row.isFavorite ? 'is-active' : ''}`}
                              aria-label={row.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 등록'}
                              title={row.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 등록'}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleFavorite(row._id, !row.isFavorite);
                              }}
                            >
                              <span className="material-symbols-outlined" aria-hidden>star</span>
                            </button>
                          ) : col.key === 'name' ? (
                            <div className="cell-user">
                              <div className="avatar-img company-avatar"><span className="material-symbols-outlined">business</span></div>
                              <span className="font-semibold">{cellValue(row, col.key, assigneeIdToName, companyEmployeesLoaded)}</span>
                            </div>
                          ) : (
                            cellValue(row, col.key, assigneeIdToName, companyEmployeesLoaded)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="pagination-bar">
            <p className="pagination-info">
              <strong>{pagination.total}</strong>개 중 <strong>{items.length ? (pagination.page - 1) * pagination.limit + 1 : 0}</strong>–<strong>{(pagination.page - 1) * pagination.limit + items.length}</strong>건 표시
            </p>
            <div className="pagination-btns">
              <button type="button" className="pagination-btn" aria-label="첫 페이지" disabled={pagination.page <= 1} onClick={() => setPagination((p) => ({ ...p, page: 1 }))}><span className="material-symbols-outlined">first_page</span></button>
              <button type="button" className="pagination-btn" aria-label="이전 페이지" disabled={pagination.page <= 1} onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}><span className="material-symbols-outlined">chevron_left</span></button>
              {getPageNumbers(pagination.page, pagination.totalPages || 1).map((n, i) =>
                n === '...' ? (
                  <span key={`ellipsis-${i}`} className="pagination-ellipsis" aria-hidden>…</span>
                ) : (
                  <button
                    key={n}
                    type="button"
                    className={`pagination-btn pagination-btn-num ${pagination.page === n ? 'active' : ''}`}
                    aria-label={`${n}페이지`}
                    aria-current={pagination.page === n ? 'page' : undefined}
                    onClick={() => setPagination((p) => ({ ...p, page: n }))}
                  >
                    {n}
                  </button>
                )
              )}
              <button type="button" className="pagination-btn" aria-label="다음 페이지" disabled={pagination.page >= (pagination.totalPages || 1)} onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}><span className="material-symbols-outlined">chevron_right</span></button>
              <button type="button" className="pagination-btn" aria-label="마지막 페이지" disabled={pagination.page >= (pagination.totalPages || 1)} onClick={() => setPagination((p) => ({ ...p, page: pagination.totalPages || 1 }))}><span className="material-symbols-outlined">last_page</span></button>
            </div>
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
          onSaved={() => { fetchList(pagination.page); closeAddModal(); }}
        />
      )}
      <CustomerCompaniesExcelImportModal
        open={isExcelImportOpen}
        onClose={closeExcelImportModal}
        onImported={() => { fetchList(pagination.page); }}
      />
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
            const id = updatedCompany?._id != null ? String(updatedCompany._id) : null;
            if (id) {
              setItems((prev) => prev.map((c) =>
                String(c._id) === id ? { ...c, ...updatedCompany } : c
              ));
              setDetailCompanyById((prev) => (prev && String(prev._id) === id ? { ...prev, ...updatedCompany } : prev));
            }
            fetchList(pagination.page);
          }}
          onDeleted={() => {
            fetchList(pagination.page);
            closeDetailModal();
          }}
        />
      )}
    </div>
  );
}
