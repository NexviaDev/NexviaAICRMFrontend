import { useState, useEffect, useRef } from 'react';
import './search-company.css';

import { API_BASE } from '@/config';

export default function SearchCompany({ isOpen, onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setResults([]);
      return;
    }
    setLoading(true);
    fetch(`${API_BASE}/companies/search?q=&limit=30`)
      .then((res) => res.json())
      .then((data) => setResults(data.items || []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`${API_BASE}/companies/search?q=${encodeURIComponent(query)}&limit=30`)
        .then((res) => res.json())
        .then((data) => setResults(data.items || []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="search-company-overlay">
      <div className="search-company-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-company-header">
          <h3>회사 검색</h3>
          <button type="button" className="search-company-close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="search-company-search-wrap">
          <span className="material-symbols-outlined">search</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="회사명을 입력하세요..."
          />
        </div>
        <div className="search-company-results">
          {loading && <p className="search-company-msg">검색 중...</p>}
          {!loading && results.length === 0 && (
            <p className="search-company-msg">검색 결과가 없습니다.</p>
          )}
          {!loading && results.map((c) => (
            <div
              key={c._id || c.id || c.name}
              className="search-company-item"
              onClick={() => { onSelect(c); onClose(); }}
            >
              <div className="search-company-item-name">{c.name}</div>
              {c.businessNumber && (
                <div className="search-company-item-sub">사업자번호: {c.businessNumber}</div>
              )}
              {c.address && (
                <div className="search-company-item-sub">{c.address} {c.addressDetail || ''}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
