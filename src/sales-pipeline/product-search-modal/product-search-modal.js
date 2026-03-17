import { useState, useCallback, useEffect, useRef } from 'react';
import './product-search-modal.css';

import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const FIELD_LABELS = {
  name: '제품명',
  code: '코드',
  category: '카테고리',
  version: '버전',
  price: '가격',
  currency: '통화',
  billingType: '결제 유형',
  status: '상태'
};

/** 제품 객체에서 표시용 키 목록 (순서 유지, 내부 필드 제외) */
function getDisplayKeys(product) {
  const skip = new Set(['_id', 'companyId', 'createdAt', 'updatedAt', '__v']);
  const order = ['name', 'code', 'category', 'version', 'price', 'currency', 'billingType', 'status'];
  const ordered = order.filter((k) => product.hasOwnProperty(k));
  const rest = Object.keys(product).filter((k) => !skip.has(k) && !order.includes(k));
  return [...ordered, ...rest];
}

function formatDisplayValue(key, value) {
  if (value == null || value === '') return '—';
  if (key === 'price') return Number(value).toLocaleString();
  if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
    return Object.entries(value).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`).join(', ') || '—';
  }
  return String(value);
}

/**
 * 제품 검색 모달: 가격·전체 필드 표시, 체크박스, Shift+클릭 범위 선택, 선택 완료 시 onSelect(배열)
 */
export default function ProductSearchModal({ onClose, onSelect }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(new Set());
  const lastClickedIdx = useRef(null);

  const runSearch = useCallback(async () => {
    setError('');
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`${API_BASE}/products?${params}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '제품 목록을 불러올 수 없습니다.');
        setItems([]);
        return;
      }
      setItems(data.items || []);
      setSelected(new Set());
      lastClickedIdx.current = null;
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  const handleSubmit = (e) => {
    e.preventDefault();
    runSearch();
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

  const handleConfirm = () => {
    const selectedProducts = items.filter((p) => p._id && selected.has(p._id));
    if (selectedProducts.length === 0) return;
    onSelect?.(selectedProducts);
    onClose?.();
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
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
              placeholder="제품명, 코드, 카테고리, 버전으로 검색"
              autoFocus
            />
            <button type="submit" className="product-search-modal-btn" disabled={loading}>
              {loading ? '검색 중...' : '검색'}
            </button>
          </div>
          {error && <p className="product-search-modal-error">{error}</p>}
        </form>
        <div className="product-search-modal-list-wrap">
          {loading ? (
            <p className="product-search-modal-empty">검색 중...</p>
          ) : !searched ? (
            <p className="product-search-modal-empty">검색어를 입력한 뒤 검색 버튼을 눌러 주세요.</p>
          ) : items.length === 0 ? (
            <p className="product-search-modal-empty">검색 조건에 맞는 제품이 없습니다.</p>
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
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowClick(idx, e); } }}
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
                                : formatDisplayValue(key, p[key])}
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
                  <strong>{selected.size}</strong>개 선택 (Shift+클릭으로 범위 선택)
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
