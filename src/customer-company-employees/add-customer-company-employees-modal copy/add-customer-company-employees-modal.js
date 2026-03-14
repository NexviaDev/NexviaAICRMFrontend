import { useState, useRef, useEffect } from 'react';
import './add-contact-modal.css';

import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatPhoneInput(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.startsWith('010') && digits.length <= 11) {
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
  }
  if (digits.startsWith('02') && digits.length <= 10) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

export default function AddContactModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', company: '', email: '', phone: '', customerCompanyId: '' });
  const [isIndividual, setIsIndividual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [companyList, setCompanyList] = useState([]);
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false);
  const [loadingCompanySearch, setLoadingCompanySearch] = useState(false);
  const [companySearchError, setCompanySearchError] = useState('');
  const companyWrapRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (companyWrapRef.current && !companyWrapRef.current.contains(e.target)) {
        setCompanyDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (companyDropdownOpen) setCompanyDropdownOpen(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, companyDropdownOpen]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'phone') setForm((prev) => ({ ...prev, phone: formatPhoneInput(value) }));
    else setForm((prev) => ({ ...prev, [name]: value }));
    if (name === 'company') setForm((prev) => ({ ...prev, customerCompanyId: '' }));
    setError('');
    setCompanySearchError('');
  };

  const handleCompanySearch = async () => {
    setCompanySearchError('');
    setLoadingCompanySearch(true);
    setCompanyDropdownOpen(false);
    try {
      const res = await fetch(`${API_BASE}/customer-companies`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCompanySearchError(data.error || '고객사 목록을 불러올 수 없습니다.');
        setCompanyList([]);
        return;
      }
      const items = data.items || [];
      const searchTrim = (form.company || '').trim().toLowerCase();
      const filtered = searchTrim
        ? items.filter((c) => (c.name || '').toLowerCase().includes(searchTrim))
        : items;
      setCompanyList(filtered);
      setCompanyDropdownOpen(true);
    } catch (_) {
      setCompanySearchError('서버에 연결할 수 없습니다.');
      setCompanyList([]);
    } finally {
      setLoadingCompanySearch(false);
    }
  };

  const handleCompanySelect = (customerCompany) => {
    setForm((prev) => ({
      ...prev,
      company: customerCompany.name || '',
      customerCompanyId: customerCompany._id
    }));
    setCompanyDropdownOpen(false);
    setCompanySearchError('');
  };

  const handleIndividualChange = (e) => {
    const checked = e.target.checked;
    setIsIndividual(checked);
    if (checked) {
      setForm((prev) => ({ ...prev, company: '', customerCompanyId: '' }));
      setCompanyDropdownOpen(false);
    }
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const hasCompany = !isIndividual && !!form.customerCompanyId;
    const hasName = !!(form.name && form.name.trim());
    const hasEmail = !!(form.email && form.email.trim());
    const hasPhone = !!(form.phone && form.phone.trim());
    if (!hasCompany && !hasName && !hasEmail && !hasPhone) {
      setError('이름, 고객사, 이메일, 전화번호 중 최소한 하나는 기입이 되어야 합니다.');
      return;
    }
    if (!isIndividual && !form.customerCompanyId && (form.company || '').trim()) {
      setError('고객사를 검색에서 선택해 주세요.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        status: 'Lead'
      };
      if (isIndividual) payload.isIndividual = true;
      else payload.customerCompanyId = form.customerCompanyId;
      const res = await fetch(`${API_BASE}/customer-company-employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '저장에 실패했습니다.');
        return;
      }
      onSaved?.();
      onClose?.();
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="add-contact-modal-overlay">
      <div className="add-contact-modal" onClick={(e) => e.stopPropagation()}>
        <div className="add-contact-modal-header">
          <h3>새 연락처 추가</h3>
          <button type="button" className="add-contact-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="add-contact-modal-body">
          {error && <p className="add-contact-modal-error">{error}</p>}
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-name">이름</label>
            <input id="add-contact-name" name="name" type="text" value={form.name} onChange={handleChange} placeholder="예: 홍길동" />
          </div>
          <div className="add-contact-modal-field add-contact-company-field" ref={companyWrapRef}>
            <label htmlFor="add-contact-company">고객사</label>
            <div className="add-contact-company-wrap">
              <input
                id="add-contact-company"
                name="company"
                type="text"
                value={form.company}
                onChange={handleChange}
                placeholder={isIndividual ? '개인 선택 시 미등록' : '고객사명 입력 후 검색'}
                disabled={isIndividual}
              />
              <button type="button" className="add-contact-company-search" title="고객사 검색" onClick={handleCompanySearch} disabled={loadingCompanySearch || isIndividual}>
                <span className="material-symbols-outlined">search</span>
                <span>{loadingCompanySearch ? '검색 중...' : '검색'}</span>
              </button>
            </div>
            <label className="add-contact-modal-checkbox">
              <input type="checkbox" checked={isIndividual} onChange={handleIndividualChange} />
              <span>개인 (고객사 없이 연락처만 등록)</span>
            </label>
            {companySearchError && <p className="add-contact-modal-field-error">{companySearchError}</p>}
            {companyDropdownOpen && !isIndividual && (
              <ul className="add-contact-company-dropdown">
                {companyList.length === 0 ? (
                  <li className="add-contact-company-dropdown-empty">검색 조건에 맞는 고객사가 없습니다.</li>
                ) : (
                  companyList.map((c) => (
                    <li key={c._id} className="add-contact-company-dropdown-item" onMouseDown={() => handleCompanySelect(c)}>
                      <span className="material-symbols-outlined">business</span>
                      <div className="add-contact-company-dropdown-item-content">
                        <span className="add-contact-company-dropdown-item-name">{c.name}</span>
                        {(c.representativeName || c.businessNumber) && (
                          <span className="add-contact-company-dropdown-item-sub">
                            {[c.representativeName, c.businessNumber].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </div>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          <div className="add-contact-modal-row">
            <div className="add-contact-modal-field">
              <label htmlFor="add-contact-email">이메일</label>
              <input id="add-contact-email" name="email" type="email" value={form.email} onChange={handleChange} placeholder="example@company.com" />
            </div>
            <div className="add-contact-modal-field">
              <label htmlFor="add-contact-phone">전화번호</label>
              <input id="add-contact-phone" name="phone" type="tel" inputMode="numeric" autoComplete="tel" value={form.phone} onChange={handleChange} placeholder="010-0000-0000" maxLength={13} />
            </div>
          </div>
          <div className="add-contact-modal-footer">
            <button type="button" className="add-contact-modal-cancel" onClick={onClose}>취소</button>
            <button type="submit" className="add-contact-modal-save" disabled={saving}>{saving ? '저장 중...' : '연락처 저장'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
