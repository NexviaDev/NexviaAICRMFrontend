import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import AddProductModal from './add-product-modal/add-product-modal';
import ProductDetailModal from './product-detail-modal/product-detail-modal';
import ListTemplateModal from '../components/list-template-modal/list-template-modal';
import {
  LIST_IDS,
  getSavedTemplate,
  getEffectiveTemplate,
  patchListTemplate
} from '../lib/list-templates';
import './product-list.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';

import * as XLSX from 'xlsx';

import { API_BASE } from '@/config';
import { getStoredCrmUser, isSeniorOrAboveRole } from '@/lib/crm-role-utils';
import { listPriceFromProduct } from '@/lib/product-price-utils';
const LIST_ID = LIST_IDS.PRODUCT_LIST;
const LIMIT = 10;
const EXPORT_PAGE_LIMIT = 100;

/** 페이지네이션에 표시할 번호 목록 (현재 페이지 주변 + 첫/끝, 생략은 '...') — customer-companies와 동일 */
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

const MODAL_PARAM = 'modal';
const MODAL_DETAIL = 'detail';
const DETAIL_ID_PARAM = 'id';
const STATUS_LABELS = { Active: '활성', EndOfLife: 'End of Life', Draft: '초안' };
const BILLING_LABELS = { Monthly: '월간', Annual: '연간', Perpetual: '영구' };
const CUSTOM_FIELDS_PREFIX = 'customFields.';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatPrice(price, currency) {
  if (price == null) return '—';
  const sym = currency === 'USD' ? '$' : '₩';
  return `${sym}${Number(price).toLocaleString()}`;
}

/** 유통 마진 = 유통가 − 원가 — 영업 기회「유통 마진 기준」가격(channelPrice)과 동일 축 */
function getChannelMargin(row) {
  return (Number(row.channelPrice) || 0) - (Number(row.costPrice) || 0);
}

/** 소비자 마진 = 소비자가 − 원가 — 영업 기회「소비자 마진 기준」가격(listPrice/price)과 동일 축 */
function getConsumerMargin(row) {
  return (Number(listPriceFromProduct(row)) || 0) - (Number(row.costPrice) || 0);
}

export default function ProductList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: LIMIT, total: 0, totalPages: 0 });
  const [searchInput, setSearchInput] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterBilling, setFilterBilling] = useState('');
  const [loading, setLoading] = useState(true);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [customFieldColumns, setCustomFieldColumns] = useState([]);
  const [template, setTemplate] = useState(() => getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID)));
  const [dragOverKey, setDragOverKey] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [exportExcelLoading, setExportExcelLoading] = useState(false);
  const sortKey = sort.key;
  const sortDir = sort.dir;

  const customFieldLabelByKey = useMemo(() => {
    const m = {};
    customFieldColumns.forEach((c) => {
      if (!c?.key?.startsWith(CUSTOM_FIELDS_PREFIX)) return;
      const fk = c.key.slice(CUSTOM_FIELDS_PREFIX.length);
      m[fk] = (c.label || fk).trim() || fk;
    });
    return m;
  }, [customFieldColumns]);

  const me = useMemo(() => getStoredCrmUser(), []);
  const canExportExcel = isSeniorOrAboveRole(me?.role);

  const detailId = searchParams.get(DETAIL_ID_PARAM);
  const isDetailOpen = searchParams.get(MODAL_PARAM) === MODAL_DETAIL && detailId;
  const detailProduct = isDetailOpen ? items.find((p) => p._id === detailId) || null : null;

  const fetchList = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (searchApplied) params.set('search', searchApplied);
      if (filterStatus) params.set('status', filterStatus);
      if (filterBilling) params.set('billingType', filterBilling);
      const res = await fetch(`${API_BASE}/products?${params}`, { headers: getAuthHeader() });
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
  }, [searchApplied, filterStatus, filterBilling]);

  useEffect(() => { fetchList(pagination.page); }, [pagination.page, fetchList]);
  useEffect(() => { setPagination((p) => ({ ...p, page: 1 })); }, [searchApplied, filterStatus, filterBilling]);

  /** 제품 커스텀 필드 정의 → 리스트 템플릿 열에 반영 (열 설정 모달·표시 순서) */
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/custom-field-definitions?entityType=product`, { headers: getAuthHeader() })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        const defs = Array.isArray(data?.items) ? data.items : [];
        const extra = defs.map((d) => ({ key: `${CUSTOM_FIELDS_PREFIX}${d.key}`, label: d.label || d.key || '' }));
        setCustomFieldColumns(extra);
        setTemplate((prev) => getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), extra));
      })
      .catch(() => { if (!cancelled) setCustomFieldColumns([]); });
    return () => { cancelled = true; };
  }, []);

  const runSearch = (e) => {
    e?.preventDefault();
    setSearchApplied(searchInput.trim());
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const openAdd = () => setAddModalOpen(true);
  const closeAddModal = () => setAddModalOpen(false);
  const openDetail = (row) => {
    if (!row?._id) return;
    setSearchParams({ [MODAL_PARAM]: MODAL_DETAIL, [DETAIL_ID_PARAM]: row._id });
  };
  const closeDetail = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    next.delete(DETAIL_ID_PARAM);
    setSearchParams(next, { replace: true });
  };

  const handleDelete = async (row) => {
    try {
      const res = await fetch(`${API_BASE}/products/${row._id}`, { method: 'DELETE', headers: getAuthHeader() });
      if (res.ok) {
        closeDetail();
        fetchList(pagination.page);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || '삭제에 실패했습니다.');
      }
    } catch (_) {
      alert('서버에 연결할 수 없습니다.');
    }
  };

  const saveTemplate = useCallback(async (payload) => {
    try {
      const data = await patchListTemplate(LIST_ID, payload);
      const next = getEffectiveTemplate(LIST_ID, data.listTemplates?.[LIST_ID] || payload, customFieldColumns);
      setTemplate(next);
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
    if (key === 'code') return (row.code || '').toLowerCase();
    if (key === 'category') return (row.category || '').toLowerCase();
    if (key === 'version') return (row.version || '').toLowerCase();
    if (key === 'price') return listPriceFromProduct(row);
    if (key === 'costPrice') return Number(row.costPrice) || 0;
    if (key === 'channelPrice') return Number(row.channelPrice) || 0;
    if (key === 'consumerMargin') return getConsumerMargin(row);
    if (key === 'channelMargin') return getChannelMargin(row);
    if (key === 'currency') return (row.currency || '').toLowerCase();
    if (key === 'billingType') return (row.billingType || '').toLowerCase();
    if (key === 'status') return (row.status || '').toLowerCase();
    if (key.startsWith(CUSTOM_FIELDS_PREFIX)) {
      const fk = key.slice(CUSTOM_FIELDS_PREFIX.length);
      const v = row.customFields?.[fk];
      return (v !== undefined && v !== null ? String(v) : '').toLowerCase();
    }
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

  const fetchAllProductsForExport = useCallback(async () => {
    let page = 1;
    let totalPages = 1;
    const all = [];
    do {
      const params = new URLSearchParams({ page: String(page), limit: String(EXPORT_PAGE_LIMIT) });
      if (searchApplied) params.set('search', searchApplied);
      if (filterStatus) params.set('status', filterStatus);
      if (filterBilling) params.set('billingType', filterBilling);
      const res = await fetch(`${API_BASE}/products?${params}`, { headers: getAuthHeader() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || '목록을 가져오지 못했습니다.');
      }
      const data = await res.json();
      const batch = data.items || [];
      all.push(...batch);
      totalPages = Math.max(1, Number(data.pagination?.totalPages) || 1);
      page += 1;
    } while (page <= totalPages);
    return all;
  }, [searchApplied, filterStatus, filterBilling]);

  const handleDownloadExcel = useCallback(async () => {
    const viewer = getStoredCrmUser();
    if (!isSeniorOrAboveRole(viewer?.role)) {
      alert('엑셀 내려받기는 대표(Owner) 또는 책임(Senior)만 사용할 수 있습니다.');
      return;
    }
    setExportExcelLoading(true);
    try {
      const rows = await fetchAllProductsForExport();
      if (rows.length === 0) {
        alert('보낼 제품이 없습니다.');
        return;
      }
      const customKeys = new Set();
      rows.forEach((r) => {
        if (r.customFields && typeof r.customFields === 'object') {
          Object.keys(r.customFields).forEach((k) => customKeys.add(k));
        }
      });
      const sortedCustomKeys = [...customKeys].sort();
      const exportRows = rows.map((row) => {
        const o = {
          제품명: row.name || '',
          코드: row.code || '',
          카테고리: row.category || '',
          버전: row.version || '',
          소비자가: listPriceFromProduct(row) ?? '',
          원가: row.costPrice ?? '',
          유통가: row.channelPrice ?? '',
          소비자마진: getConsumerMargin(row),
          유통마진: getChannelMargin(row),
          통화: row.currency || '',
          결제주기: row.billingType ? BILLING_LABELS[row.billingType] || row.billingType : '',
          상태: row.status ? STATUS_LABELS[row.status] || row.status : '',
          수정일: row.updatedAt ? new Date(row.updatedAt).toLocaleString('ko-KR') : ''
        };
        sortedCustomKeys.forEach((fk) => {
          const colName = customFieldLabelByKey[fk] || `커스텀_${fk}`;
          const v = row.customFields?.[fk];
          o[colName] = v !== undefined && v !== null && v !== '' ? String(v) : '';
        });
        return o;
      });
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportRows);
      XLSX.utils.book_append_sheet(wb, ws, '제품');
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `제품목록_${stamp}.xlsx`);
    } catch (e) {
      alert(e?.message || '엑셀 저장에 실패했습니다.');
    } finally {
      setExportExcelLoading(false);
    }
  }, [fetchAllProductsForExport, customFieldLabelByKey]);

  return (
    <div className="page product-list-page">
      <header className="page-header">
        <div className="header-search">
          <button type="submit" form="product-list-search-form" className="header-search-icon-btn" aria-label="검색">
            <span className="material-symbols-outlined">search</span>
          </button>
          <form id="product-list-search-form" onSubmit={runSearch} className="header-search-form">
            <input
              type="text"
              placeholder="모든 필드 검색 (제품명, 코드, 카테고리, 버전, 가격, 통화, 결제·상태, 커스텀 필드 등)…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="제품 검색"
            />
          </form>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label="리스트 열 설정"
            onClick={() => {
              setTemplate(getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), customFieldColumns));
              setSettingsOpen(true);
            }}
            title="리스트 열 설정"
          >
            <span className="material-symbols-outlined">settings</span>
          </button>
          <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" />
        </div>
      </header>
      <div className="page-content">
        <div className="product-list-top">
          <div>
            <h2>제품 리스트</h2>
            <p className="page-desc">총 {pagination.total}개 제품</p>
          </div>
          <div className="product-list-top-actions">
            {canExportExcel ? (
              <button
                type="button"
                className="btn-secondary product-list-excel-btn"
                onClick={handleDownloadExcel}
                disabled={exportExcelLoading}
                title="현재 검색·필터 조건에 맞는 제품 전체를 엑셀(.xlsx)로 받습니다. (Owner / Senior 전용)"
              >
                <span className="material-symbols-outlined">download</span>
                {exportExcelLoading ? '준비 중…' : '엑셀 내려받기'}
              </button>
            ) : null}
            <button type="button" className="btn-primary" onClick={openAdd}>
              <span className="material-symbols-outlined">add</span> 제품 추가
            </button>
          </div>
        </div>
        <div className="product-list-toolbar">
          <div className="product-list-filters">
            <select
              className="product-list-filter-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              aria-label="상태 필터"
            >
              <option value="">상태: 전체</option>
              <option value="Active">활성</option>
              <option value="EndOfLife">End of Life</option>
              <option value="Draft">초안</option>
            </select>
            <select
              className="product-list-filter-select"
              value={filterBilling}
              onChange={(e) => setFilterBilling(e.target.value)}
              aria-label="결제 주기 필터"
            >
              <option value="">결제: 전체</option>
              <option value="Monthly">월간</option>
              <option value="Annual">연간</option>
              <option value="Perpetual">영구</option>
            </select>
          </div>
        </div>
        <div className="panel table-panel">
          <div className="table-wrap">
            <table className="data-table product-list-table">
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
                  <tr><td colSpan={colSpan} className="text-center">등록된 제품이 없습니다.</td></tr>
                ) : (
                  sortedItems.map((row) => (
                    <tr
                      key={row._id}
                      className={`product-list-row-clickable ${row.status === 'EndOfLife' ? 'product-list-row-eol' : ''}`}
                      onClick={() => openDetail(row)}
                    >
                      {displayColumns.map((col) => (
                        <td key={col.key}>
                          {col.key === 'name' && (
                            <div className="product-list-cell-name">
                              <div className="product-list-icon-wrap">
                                <span className="material-symbols-outlined">inventory_2</span>
                              </div>
                              <div>
                                <span className="product-list-name">{row.name || '—'}</span>
                                {row.code && !template.visible?.code && (
                                  <span className="product-list-uid">UID: {row.code}</span>
                                )}
                              </div>
                            </div>
                          )}
                          {col.key === 'category' && (
                            row.category ? (
                              <span className="product-list-category-badge">{row.category}</span>
                            ) : '—'
                          )}
                          {col.key === 'version' && <span className="product-list-version">{row.version || '—'}</span>}
                          {col.key === 'code' && <span className="text-muted">{row.code || '—'}</span>}
                          {col.key === 'currency' && <span>{row.currency || '—'}</span>}
                          {col.key === 'billingType' && (
                            <span className="product-list-billing">{row.billingType ? BILLING_LABELS[row.billingType] || row.billingType : '—'}</span>
                          )}
                          {col.key === 'price' && (
                            <div className="product-list-pricing">
                              <span className="product-list-price">{formatPrice(listPriceFromProduct(row), row.currency)}</span>
                              {row.billingType && !template.visible?.billingType && (
                                <span className="product-list-billing">{BILLING_LABELS[row.billingType] || row.billingType}</span>
                              )}
                            </div>
                          )}
                          {col.key === 'costPrice' && (
                            <span className="product-list-price">{formatPrice(row.costPrice, row.currency)}</span>
                          )}
                          {col.key === 'channelPrice' && (
                            <span className="product-list-price">{formatPrice(row.channelPrice, row.currency)}</span>
                          )}
                          {col.key === 'consumerMargin' && (
                            <span className="product-list-price">{formatPrice(getConsumerMargin(row), row.currency)}</span>
                          )}
                          {col.key === 'channelMargin' && (
                            <span className="product-list-price">{formatPrice(getChannelMargin(row), row.currency)}</span>
                          )}
                          {col.key === 'status' && (
                            <span className={`status-badge status-${row.status === 'Active' ? 'active' : row.status === 'EndOfLife' ? 'eol' : 'draft'}`}>
                              {STATUS_LABELS[row.status] || row.status}
                            </span>
                          )}
                          {col.key.startsWith(CUSTOM_FIELDS_PREFIX) && (() => {
                            const fk = col.key.slice(CUSTOM_FIELDS_PREFIX.length);
                            const v = row.customFields?.[fk];
                            return <span className="text-muted">{v !== undefined && v !== null && v !== '' ? String(v) : '—'}</span>;
                          })()}
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
      {addModalOpen && (
        <AddProductModal
          product={null}
          onClose={closeAddModal}
          onSaved={() => { fetchList(pagination.page); closeAddModal(); }}
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
      {isDetailOpen && detailProduct && (
        <ProductDetailModal
          product={detailProduct}
          onClose={closeDetail}
          onUpdated={() => { fetchList(pagination.page); }}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
