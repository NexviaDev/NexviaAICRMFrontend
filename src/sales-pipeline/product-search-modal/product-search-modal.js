import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import './product-search-modal.css';

import { API_BASE } from '@/config';
import { listPriceFromProduct } from '@/lib/product-price-utils';
import {
  LIST_IDS,
  getSavedTemplate,
  sortProductsByPickerUsage,
  patchProductSearchModalUsage
} from '@/lib/list-templates';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const FIELD_LABELS = {
  name: '제품명',
  code: '코드',
  category: '카테고리',
  version: '버전',
  price: '소비자가',
  listPrice: '소비자가',
  costPrice: '원가',
  channelPrice: '유통가',
  currency: '통화',
  billingType: '결제 유형',
  status: '상태'
};

const BILLING_LABELS = { Monthly: '월간', Annual: '연간', Perpetual: '영구' };

/** 제품 객체에서 표시용 키 목록 (순서 유지, 내부 필드 제외) */
function getDisplayKeys(product) {
  const skip = new Set(['_id', 'companyId', 'createdAt', 'updatedAt', '__v', 'price']);
  const order = ['name', 'code', 'category', 'version', 'listPrice', 'costPrice', 'channelPrice', 'currency', 'billingType', 'status'];
  const ordered = order.filter((k) => {
    if (k === 'listPrice') return product.listPrice != null || product.price != null;
    if (k === 'costPrice' || k === 'channelPrice') return true;
    return product.hasOwnProperty(k);
  });
  const rest = Object.keys(product).filter((k) => !skip.has(k) && !order.includes(k));
  return [...ordered, ...rest];
}

function formatDisplayValue(key, value, product) {
  if (key === 'listPrice') {
    const n = listPriceFromProduct(product);
    return Number.isFinite(n) ? n.toLocaleString() : '—';
  }
  if (key === 'costPrice' || key === 'channelPrice') {
    const n = value == null || value === '' ? 0 : Number(value);
    return Number.isFinite(n) ? n.toLocaleString() : '—';
  }
  if (value == null || value === '') return '—';
  if (key === 'price') return Number(value).toLocaleString();
  if (key === 'billingType') return BILLING_LABELS[value] ?? String(value);
  if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
    return Object.entries(value).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`).join(', ') || '—';
  }
  return String(value);
}

async function fetchAllProductsForPicker() {
  const all = [];
  let page = 1;
  const limit = 500;
  while (true) {
    const params = new URLSearchParams({
      productPicker: '1',
      limit: String(limit),
      page: String(page)
    });
    const res = await fetch(`${API_BASE}/products?${params}`, { headers: getAuthHeader() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || '제품 목록을 불러올 수 없습니다.');
    }
    const batch = data.items || [];
    all.push(...batch);
    const total = data.pagination?.total ?? all.length;
    if (batch.length === 0 || all.length >= total) break;
    page += 1;
    if (page > 40) break;
  }
  return all;
}

function productMatchesSearch(p, q) {
  if (!q) return true;
  const lower = q.toLowerCase();
  const parts = [
    p.name,
    p.code,
    p.category,
    p.version,
    p.status,
    p.billingType,
    p.currency,
    listPriceFromProduct(p)
  ]
    .filter((x) => x != null && x !== '')
    .map((x) => String(x).toLowerCase());
  if (parts.some((s) => s.includes(lower))) return true;
  if (p.customFields && typeof p.customFields === 'object') {
    for (const v of Object.values(p.customFields)) {
      if (v != null && String(v).toLowerCase().includes(lower)) return true;
    }
  }
  return false;
}

/**
 * 제품 검색 모달: 오픈 시 전체 목록, 자주 선택한 순( user.listTemplates.productSearchModal )
 */
export default function ProductSearchModal({ onClose, onSelect }) {
  const [search, setSearch] = useState('');
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(new Set());
  const lastClickedIdx = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError('');
      setLoading(true);
      try {
        const raw = await fetchAllProductsForPicker();
        if (cancelled) return;
        const tmpl = getSavedTemplate(LIST_IDS.PRODUCT_SEARCH_MODAL);
        const order = Array.isArray(tmpl?.order) ? tmpl.order : [];
        const sorted = sortProductsByPickerUsage(raw, order);
        setAllItems(sorted);
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || '제품 목록을 불러올 수 없습니다.');
          setAllItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo(() => {
    const q = search.trim();
    if (!q) return allItems;
    return allItems.filter((p) => productMatchesSearch(p, q));
  }, [allItems, search]);

  const handleSubmit = (e) => {
    e.preventDefault();
  };

  const handleRowClick = (idx, e) => {
    if (e.target.closest('input[type="checkbox"]')) return;
    const id = items[idx]?._id;
    if (!id) return;
    if (e.shiftKey && lastClickedIdx.current !== null) {
      const start = Math.min(lastClickedIdx.current, idx);
      const end = Math.max(lastClickedIdx.current, idx);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          if (items[i]?._id) next.add(items[i]._id);
        }
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
    lastClickedIdx.current = idx;
  };

  const handleCheckboxClick = (idx, e) => {
    e.stopPropagation();
    const id = items[idx]?._id;
    if (!id) return;
    if (e.shiftKey && lastClickedIdx.current !== null) {
      const start = Math.min(lastClickedIdx.current, idx);
      const end = Math.max(lastClickedIdx.current, idx);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          if (items[i]?._id) next.add(items[i]._id);
        }
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
    lastClickedIdx.current = idx;
  };

  const handleConfirm = useCallback(async () => {
    const selectedProducts = items.filter((p) => p._id && selected.has(p._id));
    if (selectedProducts.length === 0) return;
    try {
      await patchProductSearchModalUsage(selectedProducts.map((p) => String(p._id)));
    } catch {
      /* 저장 실패해도 선택은 진행 */
    }
    onSelect?.(selectedProducts);
    onClose?.();
  }, [items, selected, onSelect, onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="product-search-modal-overlay">
      <div className="product-search-modal" onClick={(e) => e.stopPropagation()}>
        <header className="product-search-modal-header">
          <h3>제품 검색</h3>
          <button type="button" className="product-search-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <form onSubmit={handleSubmit} className="product-search-modal-form">
          <div className="product-search-modal-field">
            <span className="material-symbols-outlined product-search-modal-icon">search</span>
            <input
              type="text"
              className="product-search-modal-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="목록에서 필터 (제품명·코드·카테고리 등)"
              autoFocus
            />
            <button type="submit" className="product-search-modal-btn" disabled={loading}>
              필터
            </button>
          </div>
          <p className="product-search-modal-hint">
            목록은 열 때 전부 불러오며, <strong>자주 선택한 제품</strong>이 위쪽에 옵니다. 선택 시 사용 순서가 계정에 저장됩니다.
          </p>
          {error && <p className="product-search-modal-error">{error}</p>}
        </form>
        <div className="product-search-modal-list-wrap">
          {loading ? (
            <p className="product-search-modal-empty">목록 불러오는 중...</p>
          ) : items.length === 0 ? (
            <p className="product-search-modal-empty">
              {allItems.length === 0 ? '등록된 제품이 없습니다.' : '검색 조건에 맞는 제품이 없습니다.'}
            </p>
          ) : (
            <>
              <ul className="product-search-modal-list">
                {items.map((p, idx) => {
                  const isChecked = selected.has(p._id);
                  const displayKeys = getDisplayKeys(p);
                  return (
                    <li
                      key={p._id}
                      className={`product-search-modal-item ${isChecked ? 'is-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={(e) => handleRowClick(idx, e)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleRowClick(idx, e);
                        }
                      }}
                      aria-label={`${p.name || ''} 선택`}
                    >
                      <div className="product-search-modal-item-check" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="product-search-modal-item-checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          onClick={(e) => handleCheckboxClick(idx, e)}
                          aria-label={`${p.name || '제품'} 선택`}
                        />
                      </div>
                      <span className="material-symbols-outlined product-search-modal-item-icon">inventory_2</span>
                      <div className="product-search-modal-item-content">
                        {displayKeys.map((key) => (
                          <div key={key} className={`product-search-modal-item-row ${key === 'name' ? 'product-search-modal-item-row-primary' : ''}`}>
                            {key !== 'customFields' && (
                              <span className="product-search-modal-item-label">
                                {FIELD_LABELS[key] || key}:
                              </span>
                            )}
                            <span className="product-search-modal-item-value">
                              {key === 'customFields' && typeof p[key] === 'object'
                                ? Object.entries(p[key] || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`).join(', ') || '—'
                                : formatDisplayValue(key, p[key], p)}
                            </span>
                          </div>
                        ))}
                        {displayKeys.length === 0 && (
                          <div className="product-search-modal-item-row">
                            <span className="product-search-modal-item-value">{p.name || '—'}</span>
                          </div>
                        )}
                      </div>
                      <span className="material-symbols-outlined product-search-modal-item-arrow">arrow_forward</span>
                    </li>
                  );
                })}
              </ul>
              <div className="product-search-modal-footer">
                <p className="product-search-modal-selected-count">
                  <strong>{selected.size}</strong>개 선택 (Shift+클릭으로 범위 선택) · 전체 <strong>{allItems.length}</strong>건
                </p>
                <button
                  type="button"
                  className="product-search-modal-confirm-btn"
                  disabled={selected.size === 0}
                  onClick={handleConfirm}
                >
                  선택 완료
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
