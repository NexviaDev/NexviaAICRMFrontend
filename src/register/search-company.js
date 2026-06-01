import { useState, useEffect, useRef } from 'react';
import './search-company.css';

import { API_BASE } from '@/config';
import AddCompany from './add-company';

export default function SearchCompany({ isOpen, onClose, onSelect, setError }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [addCompanyOpen, setAddCompanyOpen] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setResults([]);
      setAddCompanyOpen(false);
      return;
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`${API_BASE}/companies/search?q=${encodeURIComponent(q)}&limit=20`)
        .then((res) => res.json())
        .then((data) => setResults(data.items || []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query, isOpen]);

  if (!isOpen) return null;

  const handleAddSuccess = (company) => {
    onSelect(company);
    setAddCompanyOpen(false);
    onClose();
  };

  return (
    <>
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
            {!loading && !query.trim() && (
              <p className="search-company-msg">회사명을 입력하여 검색해 주세요.</p>
            )}
            {!loading && query.trim() && results.length === 0 && (
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
          <div className="search-company-footer">
            <button
              type="button"
              className="search-company-add-btn"
              onClick={() => setAddCompanyOpen(true)}
            >
              <span className="material-symbols-outlined">add_business</span>
              찾는 회사가 없나요? 새 회사 등록
            </button>
          </div>
        </div>
      </div>
      <AddCompany
        isOpen={addCompanyOpen}
        onClose={() => setAddCompanyOpen(false)}
        onSuccess={handleAddSuccess}
        setError={setError}
      />
    </>
  );
}
