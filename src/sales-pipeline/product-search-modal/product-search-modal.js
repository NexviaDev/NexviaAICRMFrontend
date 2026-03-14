import { useState, useCallback, useEffect } from 'react';
import './product-search-modal.css';

import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 제품 검색 모달 (담당자 검색 모달과 동일한 UX)
 */
export default function ProductSearchModal({ onClose, onSelect }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');

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

  const handleSelect = (product) => {
    onSelect?.(product);
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
            <ul className="product-search-modal-list">
              {items.map((p) => (
                <li
                  key={p._id}
                  className="product-search-modal-item"
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelect(p)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(p); } }}
                  aria-label={`${p.name || ''} 선택`}
                >
                  <span className="material-symbols-outlined product-search-modal-item-icon">inventory_2</span>
                  <div className="product-search-modal-item-content">
                    <span className="product-search-modal-item-name">{p.name || '—'}</span>
                    <span className="product-search-modal-item-sub">
                      {[p.code && `UID: ${p.code}`, p.category, p.version].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </div>
                  <span className="material-symbols-outlined product-search-modal-item-arrow">arrow_forward</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
