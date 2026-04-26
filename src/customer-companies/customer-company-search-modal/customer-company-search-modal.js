import { useState, useCallback, useEffect } from 'react';
import './customer-company-search-modal.css';

import { API_BASE } from '@/config';

const RECENT_LIST_LIMIT = 10;

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatBusinessNumber(num) {
  if (!num) return '';
  const s = String(num).replace(/\D/g, '');
  if (s.length <= 3) return s;
  if (s.length <= 5) return `${s.slice(0, 3)}-${s.slice(3)}`;
  return `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5, 10)}`;
}

/**
 * 고객사 검색 모달 (업체명, 사업자번호, 주소, 직원 이름/연락처로 검색)
 * opportunity-modal, add-contact-modal 등에서 공통 사용
 */
export default function CustomerCompanySearchModal({ onClose, onSelect }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [recentItems, setRecentItems] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');

  const loadRecent = useCallback(async () => {
    setError('');
    setInitialLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(RECENT_LIST_LIMIT) });
      const res = await fetch(`${API_BASE}/customer-companies?${params}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRecentItems([]);
        setError(data.error || '최근 고객사 목록을 불러올 수 없습니다.');
        return;
      }
      const raw = Array.isArray(data.items) ? data.items : [];
      setRecentItems(raw.slice(0, RECENT_LIST_LIMIT));
    } catch (_) {
      setRecentItems([]);
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const runSearch = useCallback(async () => {
    setError('');
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`${API_BASE}/customer-companies?${params}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '고객사 목록을 불러올 수 없습니다.');
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

  const handleSelect = (company) => {
    onSelect?.(company);
    onClose?.();
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const displayItems = searched ? items : recentItems;

  const renderList = () => (
    <ul className="cc-search-modal-list">
      {displayItems.map((c) => (
        <li
          key={c._id}
          className="cc-search-modal-item"
          role="button"
          tabIndex={0}
          onClick={() => handleSelect(c)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(c); } }}
          aria-label={`${c.name || ''} 선택`}
        >
          <span className="material-symbols-outlined cc-search-modal-item-icon">business</span>
          <div className="cc-search-modal-item-content">
            <span className="cc-search-modal-item-name">{c.name || '—'}</span>
            <span className="cc-search-modal-item-sub">
              {[c.representativeName, formatBusinessNumber(c.businessNumber), c.address].filter(Boolean).join(' · ') || '—'}
            </span>
          </div>
          <span className="material-symbols-outlined cc-search-modal-item-arrow">arrow_forward</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="cc-search-modal-overlay">
      <div className="cc-search-modal" onClick={(e) => e.stopPropagation()}>
        <header className="cc-search-modal-header">
          <h3>고객사 검색</h3>
          <button type="button" className="cc-search-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <form onSubmit={handleSubmit} className="cc-search-modal-form">
          <div className="cc-search-modal-field">
            <span className="material-symbols-outlined cc-search-modal-icon">search</span>
            <input
              type="text"
              className="cc-search-modal-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="업체명, 사업자번호, 주소, 직원 이름·연락처로 검색"
              autoFocus
            />
            <button type="submit" className="cc-search-modal-btn" disabled={loading}>
              {loading ? '검색 중...' : '검색'}
            </button>
          </div>
          {error && <p className="cc-search-modal-error">{error}</p>}
        </form>
        <div className="cc-search-modal-list-wrap">
          {loading ? (
            <p className="cc-search-modal-empty">검색 중...</p>
          ) : initialLoading ? (
            <p className="cc-search-modal-empty">목록 불러오는 중...</p>
          ) : searched && items.length === 0 ? (
            <p className="cc-search-modal-empty">검색 조건에 맞는 고객사가 없습니다.</p>
          ) : displayItems.length === 0 ? (
            <p className="cc-search-modal-empty">등록된 고객사가 없습니다.</p>
          ) : (
            <>
              {!searched ? (
                <p className="cc-search-modal-recent-hint">
                  등록일 기준 최근 {Math.min(RECENT_LIST_LIMIT, displayItems.length)}건입니다. 아래에서 선택하거나 검색하세요.
                </p>
              ) : null}
              {renderList()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
