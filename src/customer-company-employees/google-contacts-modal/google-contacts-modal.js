import { useState, useEffect, useCallback, useRef } from 'react';
import './google-contacts-modal.css';

import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * @param {Object} props
 * @param {'single'|'bulk'} props.mode - 단일 선택 또는 대량 선택
 * @param {Function} props.onSelect - 단일: (contact) => void
 * @param {Function} props.onBulkSelect - 대량: (contacts[]) => void
 * @param {Function} props.onClose
 */
export default function GoogleContactsModal({ mode = 'single', onSelect, onBulkSelect, onClose }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [nextPageToken, setNextPageToken] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selected, setSelected] = useState(new Set());
  const lastClickedIdx = useRef(null);

  const isBulk = mode === 'bulk';

  useEffect(() => {
    const url = new URL(window.location);
    url.searchParams.set('googleContactsModal', '1');
    window.history.pushState({}, '', url);
    const onPop = () => onClose?.();
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      const u = new URL(window.location);
      if (u.searchParams.has('googleContactsModal')) {
        u.searchParams.delete('googleContactsModal');
        window.history.replaceState({}, '', u);
      }
    };
  }, [onClose]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fetchContacts = useCallback(async (query, pageToken) => {
    const isMore = !!pageToken;
    if (isMore) setLoadingMore(true);
    else { setLoading(true); setContacts([]); }
    setError('');
    try {
      const params = new URLSearchParams({ pageSize: '100' });
      if (query) params.set('query', query);
      if (pageToken) params.set('pageToken', pageToken);
      const res = await fetch(`${API_BASE}/google-contacts/contacts?${params}`, { headers: getAuthHeader() });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '연락처를 불러올 수 없습니다.');
        return;
      }
      if (isMore) setContacts((prev) => [...prev, ...(data.contacts || [])]);
      else setContacts(data.contacts || []);
      setNextPageToken(data.nextPageToken || null);
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts(search, null);
    setSelected(new Set());
    lastClickedIdx.current = null;
  }, [fetchContacts, search]);

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  const getKey = (c, idx) => c.resourceName || `idx-${idx}`;

  const handleItemClick = (contact, idx, e) => {
    if (!isBulk) {
      onSelect?.(contact);
      if (new URL(window.location).searchParams.has('googleContactsModal')) {
        window.history.back();
      } else {
        onClose?.();
      }
      return;
    }

    const key = getKey(contact, idx);

    if (e.shiftKey && lastClickedIdx.current !== null) {
      const start = Math.min(lastClickedIdx.current, idx);
      const end = Math.max(lastClickedIdx.current, idx);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          next.add(getKey(contacts[i], i));
        }
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }
    lastClickedIdx.current = idx;
  };

  const handleSelectAll = () => {
    if (selected.size === contacts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(contacts.map((c, i) => getKey(c, i))));
    }
  };

  const handleConfirm = () => {
    const selectedContacts = contacts.filter((c, i) => selected.has(getKey(c, i)));
    onBulkSelect?.(selectedContacts);
    if (new URL(window.location).searchParams.has('googleContactsModal')) {
      window.history.back();
    } else {
      onClose?.();
    }
  };

  const handleCancel = () => {
    if (new URL(window.location).searchParams.has('googleContactsModal')) {
      window.history.back();
    } else {
      onClose?.();
    }
  };

  const allChecked = contacts.length > 0 && selected.size === contacts.length;

  return (
    <div className="gcontacts-modal-overlay">
      <div className={`gcontacts-modal ${isBulk ? 'bulk' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="gcontacts-modal-header">
          <h3>
            <span className="material-symbols-outlined">contacts</span>
            {isBulk ? 'Google 주소록 대량 가져오기' : 'Google 주소록에서 가져오기'}
          </h3>
          <button type="button" className="gcontacts-modal-close" onClick={handleCancel} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form className="gcontacts-modal-search" onSubmit={handleSearch}>
          <span className="material-symbols-outlined gcontacts-search-icon">search</span>
          <input
            type="text"
            placeholder="이름, 이메일, 전화번호 검색…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            autoFocus
          />
          <button type="submit" className="gcontacts-search-btn">검색</button>
        </form>

        {isBulk && contacts.length > 0 && !loading && (
          <div className="gcontacts-bulk-bar">
            <label className="gcontacts-select-all" onClick={handleSelectAll}>
              <input type="checkbox" checked={allChecked} readOnly />
              <span>전체 선택 ({contacts.length}명)</span>
            </label>
            <span className="gcontacts-bulk-info">
              {selected.size > 0 && <><strong>{selected.size}</strong>명 선택됨</>}
              {selected.size > 0 && <span className="gcontacts-shift-hint"> · Shift+클릭으로 범위 선택</span>}
            </span>
          </div>
        )}

        <div className="gcontacts-modal-body">
          {loading && <p className="gcontacts-modal-status">불러오는 중…</p>}
          {error && <p className="gcontacts-modal-error">{error}</p>}
          {!loading && !error && contacts.length === 0 && (
            <p className="gcontacts-modal-status">연락처가 없습니다.</p>
          )}
          {contacts.map((c, idx) => {
            const key = getKey(c, idx);
            const checked = selected.has(key);
            return (
              <div
                key={key}
                className={`gcontacts-item ${checked ? 'checked' : ''}`}
                onClick={(e) => handleItemClick(c, idx, e)}
              >
                {isBulk && (
                  <input
                    type="checkbox"
                    className="gcontacts-item-checkbox"
                    checked={checked}
                    readOnly
                    tabIndex={-1}
                  />
                )}
                <div className="gcontacts-item-avatar">
                  {c.photoUrl
                    ? <img src={c.photoUrl} alt="" referrerPolicy="no-referrer" />
                    : <span>{(c.name || c.email || '?').charAt(0)}</span>
                  }
                </div>
                <div className="gcontacts-item-info">
                  <span className="gcontacts-item-name">{c.name || '(이름 없음)'}</span>
                  <span className="gcontacts-item-detail">
                    {[c.email, c.phone, c.company, c.address].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {!isBulk && <span className="material-symbols-outlined gcontacts-item-arrow">chevron_right</span>}
              </div>
            );
          })}
          {nextPageToken && !loadingMore && (
            <button type="button" className="gcontacts-load-more" onClick={() => fetchContacts(search, nextPageToken)}>
              더 보기
            </button>
          )}
          {loadingMore && <p className="gcontacts-modal-status">불러오는 중…</p>}
        </div>

        {isBulk && (
          <div className="gcontacts-modal-footer">
            <span className="gcontacts-footer-count">{selected.size}명 선택됨</span>
            <div className="gcontacts-footer-actions">
              <button type="button" className="gcontacts-footer-btn cancel" onClick={handleCancel}>취소</button>
              <button
                type="button"
                className="gcontacts-footer-btn confirm"
                disabled={selected.size === 0}
                onClick={handleConfirm}
              >
                {selected.size}명 가져오기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
