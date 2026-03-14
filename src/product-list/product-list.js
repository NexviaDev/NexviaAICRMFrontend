import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import AddProductModal from './add-product-modal/add-product-modal';
import ProductDetailModal from './product-detail-modal/product-detail-modal';
import RegisterSaleModal from './register-sale-modal/register-sale-modal';
import ListTemplateModal from '../components/list-template-modal/list-template-modal';
import {
  LIST_IDS,
  getSavedTemplate,
  getEffectiveTemplate,
  patchListTemplate
} from '../lib/list-templates';
import './product-list.css';

import { API_BASE } from '@/config';
const LIST_ID = LIST_IDS.PRODUCT_LIST;
const LIMIT = 20;
const MODAL_PARAM = 'modal';
const MODAL_DETAIL = 'detail';
const DETAIL_ID_PARAM = 'id';
const STATUS_LABELS = { Active: '활성', EndOfLife: 'End of Life', Draft: '초안' };
const BILLING_LABELS = { Monthly: '월간', Annual: '연간' };

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatPrice(price, currency) {
  if (price == null) return '—';
  const sym = currency === 'USD' ? '$' : '₩';
  return `${sym}${Number(price).toLocaleString()}`;
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
  const [registerSaleOpen, setRegisterSaleOpen] = useState(false);
  const [registerSaleInitialProduct, setRegisterSaleInitialProduct] = useState(null);
  const [template, setTemplate] = useState(() => getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID)));
  const [dragOverKey, setDragOverKey] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const sortKey = sort.key;
  const sortDir = sort.dir;

  const detailId = searchParams.get(DETAIL_ID_PARAM);
  const isDetailOpen = searchParams.get(MODAL_PARAM) === MODAL_DETAIL && detailId;
  const detailProduct = isDetailOpen ? items.find((p) => p._id === detailId) || null : null;

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(pagination.page));
      params.set('limit', String(pagination.limit));
      if (searchApplied) params.set('search', searchApplied);
      if (filterStatus) params.set('status', filterStatus);
      if (filterBilling) params.set('billingType', filterBilling);
      const res = await fetch(`${API_BASE}/products?${params}`, { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setPagination((prev) => ({
          ...prev,
          total: data.pagination?.total ?? 0,
          totalPages: data.pagination?.totalPages ?? 0
        }));
      } else {
        setItems([]);
      }
    } catch (_) {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, searchApplied, filterStatus, filterBilling]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const runSearch = (e) => {
    e?.preventDefault();
    setSearchApplied(searchInput.trim());
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const setPage = (page) => {
    if (page < 1 || page > pagination.totalPages) return;
    setPagination((p) => ({ ...p, page }));
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
        fetchList();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || '삭제에 실패했습니다.');
      }
    } catch (_) {
      alert('서버에 연결할 수 없습니다.');
    }
  };

  const start = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const end = Math.min(pagination.page * pagination.limit, pagination.total);

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
    if (key === 'category') return (row.category || '').toLowerCase();
    if (key === 'version') return (row.version || '').toLowerCase();
    if (key === 'price') return Number(row.price) || 0;
    if (key === 'status') return (row.status || '').toLowerCase();
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
    <div className="page product-list-page">
      <header className="page-header">
        <div className="header-search">
          <button type="submit" form="product-list-search-form" className="header-search-icon-btn" aria-label="검색">
            <span className="material-symbols-outlined">search</span>
          </button>
          <form id="product-list-search-form" onSubmit={runSearch} className="header-search-form">
            <input
              type="text"
              placeholder="제품명, 카테고리, 버전, 코드 검색..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="제품 검색"
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
        <div className="product-list-top">
          <div>
            <h2>제품 리스트</h2>
            <p className="page-desc">총 {pagination.total}개 제품</p>
          </div>
          <div className="product-list-top-actions">
            <button type="button" className="btn-secondary product-list-btn-register-sale" onClick={() => { setRegisterSaleInitialProduct(null); setRegisterSaleOpen(true); }}>
              <span className="material-symbols-outlined">point_of_sale</span> 판매 등록
            </button>
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
              onChange={(e) => { setFilterStatus(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }}
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
              onChange={(e) => { setFilterBilling(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }}
              aria-label="결제 주기 필터"
            >
              <option value="">결제: 전체</option>
              <option value="Monthly">월간</option>
              <option value="Annual">연간</option>
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
                            <div className="product-list-cell-name-wrap" onClick={(e) => e.stopPropagation()}>
                              <div className="product-list-cell-name">
                                <div className="product-list-icon-wrap">
                                  <span className="material-symbols-outlined">inventory_2</span>
                                </div>
                                <div>
                                  <span className="product-list-name">{row.name || '—'}</span>
                                  {row.code && <span className="product-list-uid">UID: {row.code}</span>}
                                </div>
                              </div>
                              <button
                                type="button"
                                className="product-list-row-sale-btn"
                                onClick={() => { setRegisterSaleInitialProduct(row); setRegisterSaleOpen(true); }}
                                title="이 제품으로 판매 등록"
                                aria-label="판매 등록"
                              >
                                <span className="material-symbols-outlined">point_of_sale</span>
                              </button>
                            </div>
                          )}
                          {col.key === 'category' && (
                            row.category ? (
                              <span className="product-list-category-badge">{row.category}</span>
                            ) : '—'
                          )}
                          {col.key === 'version' && <span className="product-list-version">{row.version || '—'}</span>}
                          {col.key === 'price' && (
                            <div className="product-list-pricing">
                              <span className="product-list-price">{formatPrice(row.price, row.currency)}</span>
                              <span className="product-list-billing">{row.billingType ? BILLING_LABELS[row.billingType] || row.billingType : ''}</span>
                            </div>
                          )}
                          {col.key === 'status' && (
                            <span className={`status-badge status-${row.status === 'Active' ? 'active' : row.status === 'EndOfLife' ? 'eol' : 'draft'}`}>
                              {STATUS_LABELS[row.status] || row.status}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {pagination.totalPages > 0 && (
            <div className="product-list-pagination">
              <span className="product-list-pagination-info">
                {start}–{end} / 총 {pagination.total}건
              </span>
              <div className="product-list-pagination-btns">
                <button
                  type="button"
                  className="product-list-page-btn"
                  onClick={() => setPage(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  aria-label="이전 페이지"
                >
                  <span className="material-symbols-outlined">chevron_left</span>
                </button>
                {(() => {
                  const total = pagination.totalPages;
                  if (total <= 0) return null;
                  const len = Math.min(5, total);
                  let start = Math.max(1, pagination.page - Math.floor(len / 2));
                  if (start + len > total + 1) start = total - len + 1;
                  if (start < 1) start = 1;
                  return Array.from({ length: len }, (_, i) => {
                    const p = start + i;
                    if (p > total) return null;
                    return (
                      <button
                        key={p}
                        type="button"
                        className={`product-list-page-btn ${p === pagination.page ? 'active' : ''}`}
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </button>
                    );
                  });
                })()}
                <button
                  type="button"
                  className="product-list-page-btn"
                  onClick={() => setPage(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages}
                  aria-label="다음 페이지"
                >
                  <span className="material-symbols-outlined">chevron_right</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {addModalOpen && (
        <AddProductModal
          product={null}
          onClose={closeAddModal}
          onSaved={() => { fetchList(); closeAddModal(); }}
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
          onUpdated={(updated) => { fetchList(); }}
          onDelete={handleDelete}
        />
      )}
      {registerSaleOpen && (
        <RegisterSaleModal
          initialProduct={registerSaleInitialProduct}
          onClose={() => { setRegisterSaleOpen(false); setRegisterSaleInitialProduct(null); }}
          onSaved={() => setRegisterSaleOpen(false)}
        />
      )}
    </div>
  );
}
