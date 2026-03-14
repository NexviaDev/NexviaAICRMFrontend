import { useState, useEffect, useCallback, useRef } from 'react';
import './bring-contacts-modal.css';

/**
 * 연락처 가지고 오기 모달
 * - 03. 좌측 체크박스, 1번 클릭 후 Shift+11번 클릭 시 1~11번까지 범위 선택
 * - 04. 검색: 연락처 번호, 이름, 이메일, 주소 (백엔드 search 파라미터)
 */
import { API_BASE } from '@/config';
const LIMIT = 300;

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function BringContactsModal({ companyId, companyName, companyAddress = '', onClose, onAssigned }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState('');
  const lastClickedIdx = useRef(null);

  const fetchAllContacts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: String(LIMIT) });
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`${API_BASE}/customer-company-employees?${params}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setItems(data.items || []);
      else {
        setItems([]);
        setError(data.error || '연락처 목록을 불러올 수 없습니다.');
      }
    } catch (_) {
      setItems([]);
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchAllContacts();
  }, [fetchAllContacts]);

  useEffect(() => {
    setSelected(new Set());
    lastClickedIdx.current = null;
  }, [items]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onSearchSubmit = (e) => {
    e?.preventDefault();
    setSearch(searchInput.trim());
  };

  const handleRowSelect = (idx, e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    const id = items[idx]?._id;
    if (!id) return;
    if (e && e.shiftKey && lastClickedIdx.current !== null) {
      const start = Math.min(lastClickedIdx.current, idx);
      const end = Math.max(lastClickedIdx.current, idx);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          if (items[i]) next.add(items[i]._id);
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

  const handleConfirm = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      setError('소속으로 변경할 연락처를 선택해 주세요.');
      return;
    }
    setError('');
    setAssigning(true);
    try {
      for (const id of ids) {
        const res = await fetch(`${API_BASE}/customer-company-employees/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify({
            customerCompanyId: companyId,
            isIndividual: false,
            address: companyAddress != null ? String(companyAddress).trim() : ''
          })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || '일부 연락처 소속 변경에 실패했습니다.');
          setAssigning(false);
          return;
        }
      }
      onAssigned?.();
      onClose?.();
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="bring-contacts-modal-overlay">
      <div className="bring-contacts-modal" onClick={(e) => e.stopPropagation()}>
        <header className="bring-contacts-modal-header">
          <h3>연락처 가지고 오기</h3>
          <button type="button" className="bring-contacts-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <p className="bring-contacts-modal-desc">
          아래 목록에서 연락처를 선택한 뒤 확인을 누르면 <strong>{companyName || '이 고객사'}</strong> 소속으로 변경됩니다.
        </p>
        <form onSubmit={onSearchSubmit} className="bring-contacts-modal-search">
          <span className="material-symbols-outlined bring-contacts-search-icon">search</span>
          <input
            type="text"
            className="bring-contacts-modal-search-input"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="이름, 연락처(전화번호), 이메일, 주소로 검색"
            aria-label="이름, 연락처 번호, 이메일, 주소 검색"
          />
          <button type="submit" className="bring-contacts-modal-search-btn">검색</button>
        </form>

        {error && <p className="bring-contacts-modal-error">{error}</p>}
        <div className="bring-contacts-modal-list-wrap">
          {loading ? (
            <p className="bring-contacts-modal-empty">불러오는 중...</p>
          ) : items.length === 0 ? (
            <p className="bring-contacts-modal-empty">
              {search ? '검색 조건에 맞는 연락처가 없습니다.' : '연락처 목록을 불러올 수 없습니다.'}
            </p>
          ) : (
            <>
              <ul className="bring-contacts-modal-list">
                {items.map((c, idx) => (
                  <li
                    key={c._id}
                    role="button"
                    tabIndex={0}
                    className={`bring-contacts-modal-item ${selected.has(c._id) ? 'bring-contacts-modal-item-selected' : ''}`}
                    onClick={(e) => {
                      if (e.target.closest('input[type="checkbox"]')) return;
                      handleRowSelect(idx, e);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleRowSelect(idx, e);
                      }
                    }}
                    aria-label={`${c.name || '—'} 선택`}
                    aria-pressed={selected.has(c._id)}
                  >
                    <label className="bring-contacts-check-wrap" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(c._id)}
                        readOnly
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRowSelect(idx, e);
                        }}
                        aria-label={`${c.name || ''} 선택 (Shift+클릭으로 범위 선택)`}
                      />
                    </label>
                    <div className="bring-contacts-item-body">
                      <span className="bring-contacts-item-name">{c.name || '—'}</span>
                      <span className="bring-contacts-item-meta">
                        {[c.company, c.phone, c.email, c.address].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="bring-contacts-modal-footer">
          <span className="bring-contacts-modal-selected">{selected.size}명 선택</span>
          <button
            type="button"
            className="bring-contacts-modal-confirm"
            onClick={handleConfirm}
            disabled={assigning || selected.size === 0}
          >
            {assigning ? '변경 중...' : '확인 (이 회사 소속으로 변경)'}
          </button>
        </div>
      </div>
    </div>
  );
}
