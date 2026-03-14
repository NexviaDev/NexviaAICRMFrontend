import { useState, useEffect, useRef, useCallback } from 'react';
import './contact-picker.css';

import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 연락처(직원) 검색/선택 피커.
 * - customerCompanyId가 있으면 해당 고객사 직원만, 없으면 전체 연락처에서 검색
 * - onSelect(employee) 호출 시 선택 완료
 * - value: 현재 선택된 이름 (텍스트)
 */
export default function ContactPicker({ customerCompanyId, value, onSelect, placeholder }) {
  const [query, setQuery] = useState(value || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    setQuery(value || '');
  }, [value]);

  const search = useCallback(async (text) => {
    if (!text || text.trim().length < 1) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ search: text.trim(), limit: '20' });
      if (customerCompanyId) params.set('customerCompanyId', customerCompanyId);
      const res = await fetch(`${API_BASE}/customer-company-employees?${params}`, { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setResults(data.items || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [customerCompanyId]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    setOpen(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 300);
  };

  const handleFocus = () => {
    setOpen(true);
    if (query.trim()) search(query);
  };

  const handleSelect = (emp) => {
    setQuery(emp.name || '');
    setOpen(false);
    onSelect(emp);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    onSelect({ name: '', _id: null });
  };

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // customerCompanyId 변경 시 결과 초기화
  useEffect(() => {
    setResults([]);
  }, [customerCompanyId]);

  return (
    <div className="cp-wrapper" ref={wrapRef}>
      <div className="cp-input-row">
        <span className="material-symbols-outlined cp-search-icon">search</span>
        <input
          type="text"
          className="cp-input"
          value={query}
          onChange={handleInputChange}
          onFocus={handleFocus}
          placeholder={placeholder || '담당자 검색...'}
        />
        {query && (
          <button type="button" className="cp-clear" onClick={handleClear}>
            <span className="material-symbols-outlined">close</span>
          </button>
        )}
      </div>
      {open && (
        <div className="cp-dropdown">
          {loading && <div className="cp-dropdown-msg">검색 중...</div>}
          {!loading && query.trim() && results.length === 0 && (
            <div className="cp-dropdown-msg">검색 결과가 없습니다</div>
          )}
          {!loading && !query.trim() && (
            <div className="cp-dropdown-msg">이름을 입력하여 검색하세요</div>
          )}
          {results.map((emp) => (
            <div
              key={emp._id}
              className="cp-item"
              onClick={() => handleSelect(emp)}
            >
              <div className="cp-item-avatar">
                {(emp.name || '?').charAt(0)}
              </div>
              <div className="cp-item-info">
                <span className="cp-item-name">{emp.name || '—'}</span>
                <span className="cp-item-detail">
                  {emp.company && <span>{emp.company}</span>}
                  {emp.phone && <span>{emp.phone}</span>}
                  {emp.email && <span>{emp.email}</span>}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
