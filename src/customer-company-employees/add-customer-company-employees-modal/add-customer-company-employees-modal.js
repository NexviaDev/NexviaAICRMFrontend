import { useState, useEffect } from 'react';
import GoogleContactsModal from '../google-contacts-modal/google-contacts-modal';
import CustomerCompanySearchModal from '../../customer-companies/customer-company-search-modal/customer-company-search-modal';
import CustomFieldsSection from '../../shared/custom-fields-section';
import CustomFieldsManageModal from '../../shared/custom-fields-manage-modal/custom-fields-manage-modal';
import './add-customer-company-employees-company-employees-modal.css';

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

const getInitialForm = (initialCustomerCompany) => {
    const base = { name: '', company: '', email: '', phone: '', position: '', address: '', birthDate: '', memo: '', customerCompanyId: '', customFields: {} };
    if (initialCustomerCompany && (initialCustomerCompany._id || initialCustomerCompany.name)) {
      return {
        ...base,
        company: initialCustomerCompany.name || '',
        customerCompanyId: initialCustomerCompany._id || '',
        address: initialCustomerCompany.address != null ? String(initialCustomerCompany.address).trim() : ''
      };
    }
    return base;
  };

export default function AddContactModal({ onClose, onSaved, initialCustomerCompany }) {
  const [form, setForm] = useState(() => getInitialForm(initialCustomerCompany));
  const [customDefinitions, setCustomDefinitions] = useState([]);
  const [showCustomFieldsModal, setShowCustomFieldsModal] = useState(false);
  const [isIndividual, setIsIndividual] = useState(!(initialCustomerCompany && initialCustomerCompany._id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showCompanySearchModal, setShowCompanySearchModal] = useState(false);
  const [showBulkGoogle, setShowBulkGoogle] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const fixedCompany = !!(initialCustomerCompany && initialCustomerCompany._id);

  const fetchCustomDefinitions = async () => {
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=contact`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) setCustomDefinitions(data.items);
    } catch (_) {}
  };

  useEffect(() => {
    fetchCustomDefinitions();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showBulkGoogle) setShowBulkGoogle(false);
      else if (showCompanySearchModal) setShowCompanySearchModal(false);
      else if (showCustomFieldsModal) setShowCustomFieldsModal(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showBulkGoogle, showCompanySearchModal, showCustomFieldsModal]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'phone') setForm((prev) => ({ ...prev, phone: formatPhoneInput(value) }));
    else setForm((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleBulkImport = async (contacts) => {
    if (!contacts || contacts.length === 0) return;
    setBulkSaving(true);
    setBulkResult(null);
    setError('');
    const useFixedCompany = !!(initialCustomerCompany && initialCustomerCompany._id);
    let success = 0;
    let fail = 0;
    for (const c of contacts) {
      try {
        const payload = {
          name: (c.name || '').trim(),
          email: (c.email || '').trim(),
          phone: c.phone ? formatPhoneInput(c.phone).trim() : '',
          position: (c.title || '').trim(),
          companyName: (c.company || '').trim(),
          address: (useFixedCompany && initialCustomerCompany?.address)
            ? String(initialCustomerCompany.address).trim()
            : (c.address || '').trim(),
          birthDate: (c.birthday || '').trim(),
          memo: (c.biography || '').trim() || undefined,
          status: 'Lead',
          isIndividual: !useFixedCompany
        };
        if (useFixedCompany) payload.customerCompanyId = initialCustomerCompany._id;
        if (!payload.name && !payload.email && !payload.phone) { fail++; continue; }
        const res = await fetch(`${API_BASE}/customer-company-employees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify(payload)
        });
        if (res.ok) success++;
        else fail++;
      } catch (_) {
        fail++;
      }
    }
    setBulkSaving(false);
    setBulkResult({ success, fail, total: contacts.length });
    if (success > 0) onSaved?.();
  };

  const handleIndividualChange = (e) => {
    const checked = e.target.checked;
    setIsIndividual(checked);
    if (checked) setForm((prev) => ({ ...prev, company: '', customerCompanyId: '' }));
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
        position: (form.position || '').trim() || undefined,
        address: (form.address || '').trim() || undefined,
        birthDate: (form.birthDate || '').trim() || undefined,
        memo: (form.memo || '').trim() || undefined,
        status: 'Lead'
      };
      if (isIndividual) payload.isIndividual = true;
      else payload.customerCompanyId = form.customerCompanyId;
      if (form.customFields && Object.keys(form.customFields).length) payload.customFields = form.customFields;
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
        {showBulkGoogle && (
          <GoogleContactsModal
            mode="bulk"
            onBulkSelect={(contacts) => { setShowBulkGoogle(false); handleBulkImport(contacts); }}
            onClose={() => setShowBulkGoogle(false)}
          />
        )}
        <div className="add-contact-modal-header">
          <h3>새 연락처 추가</h3>
          <button type="button" className="add-contact-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="add-contact-modal-form">
          <div className="add-contact-modal-body">
          <button
            type="button"
            className="add-contact-google-import"
            onClick={() => setShowBulkGoogle(true)}
          >
            <img src="https://www.gstatic.com/images/branding/product/1x/contacts_2022_48dp.png" alt="" className="add-contact-google-icon" />
            Google 주소록에서 가져오기
          </button>
          {bulkSaving && (
            <div className="add-contact-bulk-progress">
              <span className="material-symbols-outlined add-contact-bulk-spinner">sync</span>
              대량 등록 중… 잠시 기다려 주세요.
            </div>
          )}
          {bulkResult && (
            <div className={`add-contact-bulk-result ${bulkResult.fail > 0 ? 'has-fail' : ''}`}>
              <span className="material-symbols-outlined">{bulkResult.fail > 0 ? 'info' : 'check_circle'}</span>
              총 {bulkResult.total}명 중 <strong>{bulkResult.success}명</strong> 등록 완료
              {bulkResult.fail > 0 && <>, {bulkResult.fail}명 실패</>}
              <button type="button" className="add-contact-bulk-dismiss" onClick={() => setBulkResult(null)}>×</button>
            </div>
          )}
          {error && <p className="add-contact-modal-error">{error}</p>}
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-name">이름</label>
            <input id="add-contact-name" name="name" type="text" value={form.name} onChange={handleChange} placeholder="예: 홍길동" />
          </div>
          <div className="add-contact-modal-field add-contact-company-field">
            <label htmlFor="add-contact-company">고객사</label>
            <div className="add-contact-company-wrap">
              <span className="add-contact-company-display">
                {fixedCompany ? form.company : (isIndividual ? '개인 (미등록)' : (form.company || '검색으로 고객사 선택'))}
              </span>
              {!fixedCompany && (
                <button
                  type="button"
                  className="add-contact-company-search"
                  title="고객사 검색"
                  onClick={() => setShowCompanySearchModal(true)}
                  disabled={isIndividual}
                >
                  <span className="material-symbols-outlined">search</span>
                  검색
                </button>
              )}
            </div>
            {!fixedCompany && (
              <label className="add-contact-modal-checkbox">
                <input type="checkbox" checked={isIndividual} onChange={handleIndividualChange} />
                <span>개인 (고객사 없이 연락처만 등록)</span>
              </label>
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
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-position">직책</label>
            <input id="add-contact-position" name="position" type="text" value={form.position} onChange={handleChange} placeholder="예: 과장, 팀장" />
          </div>
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-address">주소</label>
            <input id="add-contact-address" name="address" type="text" value={form.address} onChange={handleChange} placeholder="주소" />
          </div>
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-birthDate">생일</label>
            <input id="add-contact-birthDate" name="birthDate" type="text" value={form.birthDate} onChange={handleChange} placeholder="예: 1990-01-15 또는 01-15" />
          </div>
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-memo">메모</label>
            <textarea id="add-contact-memo" name="memo" value={form.memo} onChange={handleChange} placeholder="메모 (Google 연락처 소개 등)" rows={2} className="add-contact-memo-input" />
          </div>
            <CustomFieldsSection
              definitions={customDefinitions}
              values={form.customFields || {}}
              onChangeValues={(key, value) => setForm((prev) => ({
                ...prev,
                customFields: { ...(prev.customFields || {}), [key]: value }
              }))}
              fieldClassName="add-contact-modal-field"
            />
          </div>
          <div className="add-contact-modal-footer">
            <button type="button" className="add-contact-modal-extra" onClick={() => setShowCustomFieldsModal(true)}>
              <span className="material-symbols-outlined">add_circle</span>
              추가 필드
            </button>
            <div className="add-contact-modal-footer-actions">
              <button type="button" className="add-contact-modal-cancel" onClick={onClose}>취소</button>
              <button type="submit" className="add-contact-modal-save" disabled={saving}>{saving ? '저장 중...' : '연락처 저장'}</button>
            </div>
          </div>
        </form>
        {showCustomFieldsModal && (
          <CustomFieldsManageModal
            entityType="contact"
            onClose={() => setShowCustomFieldsModal(false)}
            onFieldAdded={() => fetchCustomDefinitions()}
            apiBase={API_BASE}
            getAuthHeader={getAuthHeader}
          />
        )}
        {showCompanySearchModal && (
          <CustomerCompanySearchModal
            onClose={() => setShowCompanySearchModal(false)}
            onSelect={(company) => {
              setForm((prev) => ({ ...prev, company: company.name || '', customerCompanyId: company._id }));
              setShowCompanySearchModal(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
