import { useState, useCallback, useEffect } from 'react';
import './customer-company-employees-search-modal.css';

import { API_BASE } from '@/config';

const RECENT_LIST_LIMIT = 10;

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 담당자(연락처) 검색 모달
 * - customerCompanyId가 있으면 해당 고객사 직원만 검색
 * - 없으면 회사 소속/미소속 전체 검색
 */
export default function CustomerCompanyEmployeesSearchModal({ onClose, onSelect, customerCompanyId }) {
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
      if (customerCompanyId) params.set('customerCompanyId', customerCompanyId);
      const res = await fetch(`${API_BASE}/customer-company-employees?${params}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRecentItems([]);
        setError(data.error || '최근 연락처 목록을 불러올 수 없습니다.');
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
  }, [customerCompanyId]);

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
      if (customerCompanyId) params.set('customerCompanyId', customerCompanyId);
      const res = await fetch(`${API_BASE}/customer-company-employees?${params}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '연락처 목록을 불러올 수 없습니다.');
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
  }, [search, customerCompanyId]);

  const handleSubmit = (e) => {
    e.preventDefault();
    runSearch();
  };

  const handleSelect = (contact) => {
    onSelect?.(contact);
    onClose?.();
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const displayItems = searched ? items : recentItems;

  const renderList = () => (
    <ul className="customer-company-employees-search-modal-list">
      {displayItems.map((c) => (
        <li
          key={c._id}
          className="customer-company-employees-search-modal-item"
          role="button"
          tabIndex={0}
          onClick={() => handleSelect(c)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(c); } }}
          aria-label={`${c.name || ''} 선택`}
        >
          <span className="material-symbols-outlined customer-company-employees-search-modal-item-icon">person</span>
          <div className="customer-company-employees-search-modal-item-content">
            <span className="customer-company-employees-search-modal-item-name">{c.name || '—'}</span>
            <span className="customer-company-employees-search-modal-item-sub">
              {[c.company, c.email, c.phone].filter(Boolean).join(' · ') || '회사 미소속'}
            </span>
          </div>
          <span className="material-symbols-outlined customer-company-employees-search-modal-item-arrow">arrow_forward</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="customer-company-employees-search-modal-overlay">
      <div className="customer-company-employees-search-modal" onClick={(e) => e.stopPropagation()}>
        <header className="customer-company-employees-search-modal-header">
          <h3>{customerCompanyId ? '해당 고객사 담당자 검색' : '담당자 검색'}</h3>
          <button type="button" className="customer-company-employees-search-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <form onSubmit={handleSubmit} className="customer-company-employees-search-modal-form">
          <div className="customer-company-employees-search-modal-field">
            <span className="material-symbols-outlined customer-company-employees-search-modal-icon">search</span>
            <input
              type="text"
              className="customer-company-employees-search-modal-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={customerCompanyId ? '이름, 이메일, 전화번호로 검색 (해당 고객사 직원만)' : '이름, 이메일, 전화번호로 검색 (회사 미소속 포함)'}
              autoFocus
            />
            <button type="submit" className="customer-company-employees-search-modal-btn" disabled={loading}>
              {loading ? '검색 중...' : '검색'}
            </button>
          </div>
          {error && <p className="customer-company-employees-search-modal-error">{error}</p>}
        </form>
        <div className="customer-company-employees-search-modal-list-wrap">
          {loading || initialLoading ? (
            <div className="customer-company-employees-search-modal-spinner-wrap" role="status" aria-live="polite">
              <span className="material-symbols-outlined customer-company-employees-search-modal-spinner-icon" aria-hidden>
                progress_activity
              </span>
              <span className="customer-company-employees-search-modal-spinner-text">
                {initialLoading ? '목록을 불러오는 중…' : '검색 중…'}
              </span>
            </div>
          ) : searched && items.length === 0 ? (
            <p className="customer-company-employees-search-modal-empty">
              {customerCompanyId ? '해당 고객사에 등록된 직원이 없거나 검색 조건에 맞는 직원이 없습니다.' : '검색 조건에 맞는 연락처가 없습니다.'}
            </p>
          ) : displayItems.length === 0 ? (
            <p className="customer-company-employees-search-modal-empty">
              {customerCompanyId ? '해당 고객사에 등록된 직원이 없습니다.' : '등록된 연락처가 없습니다.'}
            </p>
          ) : (
            <>
              {!searched ? (
                <p className="customer-company-employees-search-modal-recent-hint">
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
