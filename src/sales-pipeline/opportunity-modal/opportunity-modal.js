import { useState, useEffect, useCallback } from 'react';
import CustomerCompanySearchModal from '../../customer-companies/customer-company-search-modal/customer-company-search-modal';
import CustomerCompanyEmployeesSearchModal from '../../customer-company-employees/customer-company-employees-search-modal/customer-company-employees-search-modal';
import ProductSearchModal from '../product-search-modal/product-search-modal';
import './opportunity-modal.css';

import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const STAGE_OPTIONS = [
  { value: 'NewLead', label: '신규 리드' },
  { value: 'Contacted', label: '접촉 완료' },
  { value: 'ProposalSent', label: '제안서 발송' },
  { value: 'Closed', label: '종료' },
  { value: 'Lost', label: '기회 상실' },
  { value: 'Abandoned', label: '보류' },
  { value: 'Won', label: '수주 성공' }
];

const CURRENCY_OPTIONS = [
  { value: 'KRW', label: '₩ KRW' },
  { value: 'USD', label: '$ USD' }
];

function formatNumberInput(val) {
  const num = String(val).replace(/[^0-9]/g, '');
  if (!num) return '';
  return Number(num).toLocaleString();
}

function parseNumber(val) {
  return Number(String(val).replace(/[^0-9]/g, '')) || 0;
}

export default function OpportunityModal({ mode, oppId, defaultStage, stageOptions, onClose, onSaved }) {
  const isEdit = mode === 'edit';
  const stageSelectOptions = Array.isArray(stageOptions) && stageOptions.length > 0 ? stageOptions : STAGE_OPTIONS;
  const [form, setForm] = useState({
    title: '',
    customerCompanyId: '',
    customerCompanyName: '',
    contactName: '',
    productId: '',
    productName: '',
    value: '',
    currency: 'KRW',
    stage: defaultStage || 'NewLead',
    description: ''
  });
  const [showCompanySearchModal, setShowCompanySearchModal] = useState(false);
  const [showContactSearchModal, setShowContactSearchModal] = useState(false);
  const [showProductSearchModal, setShowProductSearchModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingOpp, setLoadingOpp] = useState(false);
  const [error, setError] = useState('');

  const fetchOpp = useCallback(async () => {
    if (!isEdit || !oppId) return;
    setLoadingOpp(true);
    try {
      const res = await fetch(`${API_BASE}/sales-opportunities/${oppId}`, { headers: getAuthHeader() });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const cc = data.customerCompanyId;
      const product = data.productId;
      setForm({
        title: data.title || '',
        customerCompanyId: cc?._id || cc || '',
        customerCompanyName: cc?.name || '',
        contactName: data.contactName || '',
        productId: product?._id || product || '',
        productName: product?.name || '',
        value: data.value ? data.value.toLocaleString() : '',
        currency: data.currency || 'KRW',
        stage: data.stage || 'NewLead',
        description: data.description || ''
      });
    } catch {
      setError('기회 정보를 불러올 수 없습니다.');
    } finally {
      setLoadingOpp(false);
    }
  }, [isEdit, oppId]);

  useEffect(() => {
    fetchOpp();
  }, [fetchOpp]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showProductSearchModal) setShowProductSearchModal(false);
      else if (showContactSearchModal) setShowContactSearchModal(false);
      else if (showCompanySearchModal) setShowCompanySearchModal(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showCompanySearchModal, showContactSearchModal, showProductSearchModal]);

  const handleChange = (key, val) => {
    setForm((f) => ({ ...f, [key]: val }));
    setError('');
  };

  const handleValueChange = (e) => {
    handleChange('value', formatNumberInput(e.target.value));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError('제목을 입력해 주세요.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        title: form.title.trim(),
        customerCompanyId: form.customerCompanyId || null,
        contactName: form.contactName.trim(),
        productId: form.productId || null,
        value: parseNumber(form.value),
        currency: form.currency,
        stage: form.stage,
        description: form.description.trim()
      };
      const url = isEdit
        ? `${API_BASE}/sales-opportunities/${oppId}`
        : `${API_BASE}/sales-opportunities`;
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || '저장 실패');
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit || !oppId) return;
    if (!window.confirm('이 기회를 삭제하시겠습니까?')) return;
    try {
      await fetch(`${API_BASE}/sales-opportunities/${oppId}`, { method: 'DELETE', headers: getAuthHeader() });
      onSaved();
      onClose();
    } catch { /* ignore */ }
  };

  return (
    <div className="opp-modal-overlay">
      <div className="opp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="opp-modal-header">
          <h3 className="opp-modal-title">{isEdit ? '기회 수정' : '기회 추가'}</h3>
          <button className="opp-modal-close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {loadingOpp ? (
          <div className="opp-modal-loading">로딩 중...</div>
        ) : (
          <form className="opp-modal-form" onSubmit={handleSubmit}>
            {/* Title */}
            <label className="opp-label">
              <span>제목 <em>*</em></span>
              <input
                type="text"
                className="opp-input"
                value={form.title}
                onChange={(e) => handleChange('title', e.target.value)}
                placeholder="거래 또는 기회 이름"
                autoFocus
              />
            </label>

            {/* Customer Company */}
            <div className="opp-label">
              <span>고객사</span>
              <div className="opp-company-wrap">
                <span className="opp-company-display">{form.customerCompanyName || '선택 안함'}</span>
                <button type="button" className="opp-company-search-btn" onClick={() => setShowCompanySearchModal(true)}>
                  <span className="material-symbols-outlined">search</span>
                  검색
                </button>
              </div>
            </div>

            {/* Contact Name (담당자) - 회사 소속/미소속 모두 검색 */}
            <div className="opp-label">
              <span>담당자</span>
              <div className="opp-company-wrap">
                <span className="opp-company-display">{form.contactName || '선택 안함'}</span>
                <button type="button" className="opp-company-search-btn" onClick={() => setShowContactSearchModal(true)}>
                  <span className="material-symbols-outlined">search</span>
                  검색
                </button>
              </div>
            </div>

            {/* 제품 - 검색 모달 */}
            <div className="opp-label">
              <span>제품</span>
              <div className="opp-company-wrap">
                <span className="opp-company-display">{form.productName || '선택 안함'}</span>
                <button type="button" className="opp-company-search-btn" onClick={() => setShowProductSearchModal(true)}>
                  <span className="material-symbols-outlined">search</span>
                  검색
                </button>
              </div>
            </div>

            {/* Stage */}
            <label className="opp-label">
              <span>단계</span>
              <select
                className="opp-select"
                value={form.stage}
                onChange={(e) => handleChange('stage', e.target.value)}
              >
                {stageSelectOptions.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>

            {/* Value + Currency */}
            <div className="opp-row">
              <label className="opp-label opp-half">
                <span>금액</span>
                <input
                  type="text"
                  className="opp-input"
                  value={form.value}
                  onChange={handleValueChange}
                  placeholder="0"
                  inputMode="numeric"
                />
              </label>
              <label className="opp-label opp-currency">
                <span>통화</span>
                <select
                  className="opp-select"
                  value={form.currency}
                  onChange={(e) => handleChange('currency', e.target.value)}
                >
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {/* Description */}
            <label className="opp-label">
              <span>설명</span>
              <textarea
                className="opp-textarea"
                value={form.description}
                onChange={(e) => handleChange('description', e.target.value)}
                placeholder="추가 메모나 설명..."
                rows={3}
              />
            </label>

            {error && <p className="opp-error">{error}</p>}

            <div className="opp-modal-actions">
              {isEdit && (
                <button type="button" className="opp-delete-btn" onClick={handleDelete}>
                  <span className="material-symbols-outlined">delete</span>
                  삭제
                </button>
              )}
              <div className="opp-modal-actions-right">
                <button type="button" className="opp-cancel-btn" onClick={onClose}>취소</button>
                <button type="submit" className="opp-save-btn" disabled={saving}>
                  {saving ? '저장 중...' : isEdit ? '수정' : '추가'}
                </button>
              </div>
            </div>
          </form>
        )}
        {showCompanySearchModal && (
          <CustomerCompanySearchModal
            onClose={() => setShowCompanySearchModal(false)}
            onSelect={(company) => {
              setForm((f) => ({ ...f, customerCompanyId: company._id, customerCompanyName: company.name || '' }));
              setShowCompanySearchModal(false);
            }}
          />
        )}
        {showContactSearchModal && (
          <CustomerCompanyEmployeesSearchModal
            customerCompanyId={form.customerCompanyId || null}
            onClose={() => setShowContactSearchModal(false)}
            onSelect={(contact) => {
              setForm((f) => ({
                ...f,
                contactName: contact.name || '',
                ...(contact.customerCompanyId && {
                  customerCompanyId: contact.customerCompanyId._id || contact.customerCompanyId,
                  customerCompanyName: contact.customerCompanyId?.name || contact.company || ''
                })
              }));
              setShowContactSearchModal(false);
            }}
          />
        )}
        {showProductSearchModal && (
          <ProductSearchModal
            onClose={() => setShowProductSearchModal(false)}
            onSelect={(product) => {
              setForm((f) => ({
                ...f,
                productId: product._id,
                productName: product.name || ''
              }));
              setShowProductSearchModal(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
