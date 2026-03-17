import { useState, useEffect, useRef } from 'react';
import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const MAX_DROPDOWN = 10;

function normalize(s) {
  return (s || '').toLowerCase().trim();
}

function matchesQuery(item, q) {
  if (!q) return true;
  const n = normalize(q);
  const phoneNorm = (item.phone || '').replace(/\s|-/g, '');
  const qNorm = n.replace(/\s|-/g, '');
  return (
    normalize(item.email).includes(n) ||
    normalize(item.name).includes(n) ||
    (phoneNorm && qNorm && phoneNorm.includes(qNorm))
  );
}

/** 이름 또는 이메일에서 첫 글자(아바타용) */
function initial(name, email) {
  if (name && name.trim()) return name.trim().charAt(0).toUpperCase();
  if (email && email.trim()) return email.trim().charAt(0).toUpperCase();
  return '?';
}

export default function NewChatModal({ open, onClose, onStartChat, creating, onError }) {
  const [selectedList, setSelectedList] = useState([]);
  const [searchInput, setSearchInput] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownResults, setDropdownResults] = useState([]);
  const [dropdownLoading, setDropdownLoading] = useState(false);
  const [directEmail, setDirectEmail] = useState('');
  const [directName, setDirectName] = useState('');
  const [directPhone, setDirectPhone] = useState('');
  const [directCompany, setDirectCompany] = useState('');
  const inputRef = useRef(null);
  const suggestedListRef = useRef(null);
  const lastClickedIndexRef = useRef(null);
  const mouseDownInListRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setSearchInput('');
      setDropdownOpen(false);
      setSelectedList([]);
      setDirectEmail('');
      setDirectName('');
      setDirectPhone('');
      setDirectCompany('');
      lastClickedIndexRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!dropdownOpen) {
      setDropdownResults([]);
      return;
    }
    const q = searchInput.trim();
    const run = async () => {
      setDropdownLoading(true);
      if (onError) onError('');
      try {
        const [googleRes, companyRes, cceRes] = await Promise.all([
          fetch(`${API_BASE}/google-contacts/contacts?query=${encodeURIComponent(q)}&pageSize=25`, {
            headers: getAuthHeader(),
            credentials: 'include'
          }),
          fetch(`${API_BASE}/auth/company-members?search=${encodeURIComponent(q)}&pageSize=25`, {
            headers: getAuthHeader(),
            credentials: 'include'
          }),
          fetch(`${API_BASE}/customer-company-employees?search=${encodeURIComponent(q)}&limit=25`, {
            headers: getAuthHeader(),
            credentials: 'include'
          })
        ]);
        const googleData = await googleRes.json().catch(() => ({}));
        const companyData = await companyRes.json().catch(() => ({}));
        const cceData = await cceRes.json().catch(() => ({}));
        const googleList = (googleData.contacts || []).map((c) => ({
          email: c.email || '',
          name: c.name || '',
          phone: c.phone || '',
          company: c.company || ''
        }));
        const companyList = (companyData.members || []).map((m) => ({
          email: m.email || '',
          name: m.name || '',
          phone: m.phone || '',
          company: m.companyName || ''
        }));
        const cceList = (cceData.items || []).map((emp) => ({
          email: emp.email || '',
          name: emp.name || '',
          phone: emp.phone || '',
          company: emp.company || emp.companyName || ''
        }));
        const byEmail = new Map();
        [...googleList, ...companyList, ...cceList].forEach((item) => {
          if (!item.email) return;
          const key = item.email.toLowerCase();
          if (!byEmail.has(key)) byEmail.set(key, item);
        });
        let merged = Array.from(byEmail.values()).filter((item) => matchesQuery(item, searchInput));
        setDropdownResults(merged.slice(0, MAX_DROPDOWN));
      } catch (e) {
        if (onError) onError(e.message || '검색 실패');
        setDropdownResults([]);
      } finally {
        setDropdownLoading(false);
      }
    };
    const t = setTimeout(run, 200);
    return () => clearTimeout(t);
  }, [open, dropdownOpen, searchInput]);

  /** 단일 토글 또는 Shift+클릭 시 from~to 범위 선택 */
  const toggleSelected = (item, index, e) => {
    if (!item.email) return;
    const key = item.email.toLowerCase();

    if (e && e.shiftKey && lastClickedIndexRef.current !== null) {
      const from = Math.min(lastClickedIndexRef.current, index);
      const to = Math.max(lastClickedIndexRef.current, index);
      const rangeItems = dropdownResults.slice(from, to + 1).filter((x) => x && x.email);
      setSelectedList((prev) => {
        const prevKeys = new Set(prev.map((s) => s.email.toLowerCase()));
        const toAdd = rangeItems.filter((r) => !prevKeys.has((r.email || '').toLowerCase()));
        if (toAdd.length === 0) return prev;
        return [
          ...prev,
          ...toAdd.map((r) => ({
            email: r.email,
            name: r.name || '',
            phone: r.phone || '',
            company: r.company || ''
          }))
        ];
      });
      lastClickedIndexRef.current = index;
      return;
    }

    lastClickedIndexRef.current = index;
    const has = selectedList.some((s) => s.email.toLowerCase() === key);
    if (has) {
      setSelectedList((prev) => prev.filter((s) => s.email.toLowerCase() !== key));
    } else {
      setSelectedList((prev) => [
        ...prev,
        { email: item.email, name: item.name || '', phone: item.phone || '', company: item.company || '' }
      ]);
    }
  };

  const addDirect = (e) => {
    e.preventDefault();
    const em = directEmail.trim();
    if (!em) return;
    const key = em.toLowerCase();
    if (selectedList.some((s) => s.email.toLowerCase() === key)) {
      setDirectEmail('');
      setDirectName('');
      setDirectPhone('');
      setDirectCompany('');
      return;
    }
    setSelectedList((prev) => [
      ...prev,
      { email: em, name: directName.trim(), phone: directPhone.trim(), company: directCompany.trim() }
    ]);
    setDirectEmail('');
    setDirectName('');
    setDirectPhone('');
    setDirectCompany('');
  };

  const removeSelected = (email) => {
    setSelectedList((prev) => prev.filter((s) => s.email.toLowerCase() !== email.toLowerCase()));
  };

  const handleStart = (e) => {
    e.preventDefault();
    if (selectedList.length === 0 || creating) return;
    onStartChat?.(selectedList);
  };

  if (!open) return null;

  return (
    <div className="new-chat-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="new-chat-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header - New Chat.html 구조 */}
        <div className="new-chat-header">
          <div className="new-chat-header-inner">
            <div>
              <h1 className="new-chat-title">새 채팅</h1>
              <p className="new-chat-subtitle">
                연락처를 검색하거나 새로 추가하여 대화를 시작하세요.
              </p>
            </div>
            <button type="button" className="new-chat-close" onClick={onClose} aria-label="닫기">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          {/* Search Bar - 아이콘 왼쪽 */}
          <div className="new-chat-search-bar-wrap">
            <span className="new-chat-search-icon material-symbols-outlined">search</span>
            <input
              ref={inputRef}
              id="new-chat-search"
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onFocus={() => setDropdownOpen(true)}
              onBlur={(e) => {
                if (mouseDownInListRef.current) {
                  mouseDownInListRef.current = false;
                  return;
                }
                const next = e.relatedTarget;
                if (next && suggestedListRef.current && suggestedListRef.current.contains(next)) return;
                setTimeout(() => setDropdownOpen(false), 120);
              }}
              placeholder="이름, 이메일 또는 연락처로 검색..."
              className="new-chat-search-input"
              autoComplete="off"
            />
          </div>
        </div>

        {/* Content Scroll Area */}
        <div className="new-chat-content">
          {/* 선택된 목록 (칩) */}
          {selectedList.length > 0 && (
            <div className="new-chat-selected-wrap">
              {selectedList.map((p) => (
                <span key={p.email} className="new-chat-selected-chip">
                  <span className="new-chat-selected-chip-label">{p.name || p.email}</span>
                  <button type="button" className="new-chat-selected-remove" onClick={() => removeSelected(p.email)} aria-label="제거">
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Suggested Contacts - mousedown 시 blur에서 닫지 않아 체크 시 리스트 유지 */}
          <section
            className="new-chat-section"
            ref={suggestedListRef}
            onMouseDown={() => { mouseDownInListRef.current = true; }}
            onMouseUp={() => { requestAnimationFrame(() => { mouseDownInListRef.current = false; }); }}
            onMouseLeave={() => { requestAnimationFrame(() => { mouseDownInListRef.current = false; }); }}
          >
            <h3 className="new-chat-section-title">추천 연락처</h3>
            {dropdownOpen && (
              <div className="new-chat-suggested-list">
                {dropdownLoading ? (
                  <p className="new-chat-suggested-loading">검색 중...</p>
                ) : dropdownResults.length === 0 ? (
                  <p className="new-chat-suggested-empty">검색 결과가 없습니다. 검색어를 입력하거나 아래에서 새 연락처를 추가하세요.</p>
                ) : (
                  <ul className="new-chat-suggested-ul">
                    {dropdownResults.map((item, i) => {
                      const checked = selectedList.some(
                        (s) => s.email.toLowerCase() === (item.email || '').toLowerCase()
                      );
                      return (
                        <li key={(item.email || '') + i} className="new-chat-suggested-li">
                          <label className="new-chat-suggested-row">
                            <input
                              type="checkbox"
                              checked={checked}
                              onClick={(ev) => {
                                ev.preventDefault();
                                toggleSelected(item, i, ev);
                              }}
                              className="new-chat-suggested-checkbox"
                            />
                            <span className="new-chat-suggested-avatar" aria-hidden="true">
                              {initial(item.name, item.email)}
                            </span>
                            <div className="new-chat-suggested-info">
                              <p className="new-chat-suggested-name">{item.name || item.email || '-'}</p>
                              <p className="new-chat-suggested-email">{item.email}</p>
                            </div>
                            <span className="new-chat-suggested-chat-icon material-symbols-outlined">chat_bubble</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </section>

          {/* Divider - Or Add New Contact */}
          <div className="new-chat-divider">
            <span className="new-chat-divider-text">또는 새 연락처 추가</span>
          </div>

          {/* Manual Entry Form - 2x2 grid */}
          <form onSubmit={addDirect} className="new-chat-form">
            <div className="new-chat-form-grid">
              <div className="new-chat-form-field">
                <label htmlFor="nc-name">이름</label>
                <input
                  id="nc-name"
                  type="text"
                  value={directName}
                  onChange={(e) => setDirectName(e.target.value)}
                  placeholder="이름"
                />
              </div>
              <div className="new-chat-form-field">
                <label htmlFor="nc-email">이메일</label>
                <input
                  id="nc-email"
                  type="email"
                  value={directEmail}
                  onChange={(e) => setDirectEmail(e.target.value)}
                  placeholder="example@company.com"
                  required
                />
              </div>
              <div className="new-chat-form-field">
                <label htmlFor="nc-phone">연락처</label>
                <input
                  id="nc-phone"
                  type="text"
                  value={directPhone}
                  onChange={(e) => setDirectPhone(e.target.value)}
                  placeholder="010-0000-0000"
                />
              </div>
              <div className="new-chat-form-field">
                <label htmlFor="nc-company">회사</label>
                <input
                  id="nc-company"
                  type="text"
                  value={directCompany}
                  onChange={(e) => setDirectCompany(e.target.value)}
                  placeholder="회사명"
                />
              </div>
            </div>
            <button type="submit" className="new-chat-add-btn">
              목록에 추가
            </button>
          </form>
        </div>

        {/* Footer Actions - New Chat.html */}
        <div className="new-chat-footer">
          <button type="button" className="new-chat-btn-cancel" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="new-chat-btn-start"
            disabled={selectedList.length === 0 || creating}
            onClick={handleStart}
          >
            {creating ? '열기 중…' : '채팅 시작'}
          </button>
        </div>
      </div>
    </div>
  );
}
