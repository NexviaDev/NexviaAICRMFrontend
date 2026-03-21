import React, { useState, useEffect, useCallback } from 'react';
import CustomerCompanySearchModal from '../../customer-companies/customer-company-search-modal/customer-company-search-modal';
import CustomerCompanyEmployeesSearchModal from '../../customer-company-employees/customer-company-employees-search-modal/customer-company-employees-search-modal';
import ProductSearchModal from '../product-search-modal/product-search-modal';
import './opportunity-modal.css';

import { API_BASE } from '@/config';
import { listPriceFromProduct } from '@/lib/product-price-utils';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const STAGE_OPTIONS = [
  { value: 'NewLead', label: '신규 리드' },
  { value: 'Contacted', label: '접촉 완료' },
  { value: 'ProposalSent', label: '제안서 발송' },
  { value: 'Lost', label: '기회 상실' },
  { value: 'Abandoned', label: '보류' },
  { value: 'Won', label: '수주 성공' }
];

const CURRENCY_OPTIONS = [
  { value: 'KRW', label: 'KRW' },
  { value: 'USD', label: 'USD' },
  { value: 'JPY', label: 'JPY' }
];

const PRODUCT_BILLING_LABELS = { Monthly: '월간', Annual: '연간', Perpetual: '영구' };


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
    unitPrice: '',
    quantity: '1',
    discountRate: '',
    discountAmount: '',
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
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showProductFields, setShowProductFields] = useState(false);

  const fetchOpp = useCallback(async () => {
    if (!isEdit || !oppId) return;
    setLoadingOpp(true);
    try {
      const res = await fetch(`${API_BASE}/sales-opportunities/${oppId}`, { headers: getAuthHeader() });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const cc = data.customerCompanyId;
      const product = data.productId;
      const qty = data.quantity ?? 1;
      const unit = data.unitPrice ?? 0;
      const unitForDisplay = unit > 0 ? unit : (data.value && qty >= 1 ? Math.round(data.value / qty) : 0);
      const rate = data.discountRate ?? (data.discountType === 'rate' ? data.discountValue : 0);
      const amt = data.discountAmount ?? (data.discountType === 'amount' ? data.discountValue : 0);
      setForm({
        title: data.title || '',
        customerCompanyId: cc?._id || cc || '',
        customerCompanyName: cc?.name || '',
        contactName: data.contactName || '',
        productId: product?._id || product || '',
        productName: product?.name || '',
        unitPrice: unitForDisplay > 0 ? unitForDisplay.toLocaleString() : '',
        quantity: String(qty),
        discountRate: rate > 0 ? String(rate) : '',
        discountAmount: amt > 0 ? amt.toLocaleString() : '',
        currency: data.currency || 'KRW',
        stage: data.stage || 'NewLead',
        description: data.description || ''
      });
      setSelectedProduct(null);
      setShowProductFields(false);
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

  const handleUnitPriceChange = (e) => {
    handleChange('unitPrice', formatNumberInput(e.target.value));
  };
  const handleDiscountRateChange = (e) => {
    const v = e.target.value.replace(/[^0-9.]/g, '');
    handleChange('discountRate', v);
  };
  const handleDiscountAmountChange = (e) => {
    handleChange('discountAmount', formatNumberInput(e.target.value));
  };

  const computeFinalAmount = () => {
    const qty = Math.max(0, Number(form.quantity) || 1);
    const unit = parseNumber(form.unitPrice) || 0;
    let subtotal = qty * unit;
    const dRate = Math.max(0, Math.min(100, Number(form.discountRate) || 0));
    const dAmount = parseNumber(form.discountAmount) || 0;
    if (dRate > 0) subtotal = subtotal * (1 - dRate / 100);
    subtotal = Math.max(0, subtotal - dAmount);
    return Math.round(subtotal);
  };

  const formatCurrencyDisplay = (num, currency) => {
    if (currency === 'USD') return '$' + num.toLocaleString();
    if (currency === 'JPY') return '¥' + num.toLocaleString();
    return num.toLocaleString() + ' KRW';
  };

  const computeDeduction = () => {
    const qty = Math.max(0, Number(form.quantity) || 1);
    const unit = parseNumber(form.unitPrice) || 0;
    const subtotal = qty * unit;
    const finalAmt = computeFinalAmount();
    return Math.max(0, subtotal - finalAmt);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const titleToUse = form.title.trim() || form.productName?.trim() || '';
    if (!titleToUse) {
      setError('제목을 입력하거나 제품을 선택해 주세요.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        title: titleToUse,
        customerCompanyId: form.customerCompanyId || null,
        contactName: form.contactName.trim(),
        productId: form.productId || null,
        productName: form.productName?.trim() || '',
        unitPrice: parseNumber(form.unitPrice),
        quantity: Math.max(0, Number(form.quantity) || 1),
        discountRate: Math.max(0, Math.min(100, Number(form.discountRate) || 0)),
        discountAmount: parseNumber(form.discountAmount) || 0,
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
          <h3 className="opp-modal-title">{isEdit ? '기회 수정' : '새 영업 기회 추가'}</h3>
          <button className="opp-modal-close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {loadingOpp ? (
          <div className="opp-modal-loading">로딩 중...</div>
        ) : (
          <>
            <form className="opp-modal-form" onSubmit={handleSubmit} id="opp-form">
              {/* 제목 */}
              <div>
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
              </div>

              {/* 고객사 / 담당자 2열 */}
              <div className="opp-form-grid-2">
                <div className="opp-label">
                  <span>고객사</span>
                  <div className="opp-company-wrap">
                    <span className="opp-company-display">{form.customerCompanyName || '고객사 선택'}</span>
                    <button type="button" className="opp-company-search-btn" onClick={() => setShowCompanySearchModal(true)}>
                      <span className="material-symbols-outlined">search</span>
                      검색
                    </button>
                  </div>
                </div>
                <div className="opp-label">
                  <span>담당자</span>
                  <div className="opp-company-wrap">
                    <span className="opp-company-display">{form.contactName || '담당자 선택'}</span>
                    <button type="button" className="opp-company-search-btn" onClick={() => setShowContactSearchModal(true)}>
                      <span className="material-symbols-outlined">search</span>
                      검색
                    </button>
                  </div>
                </div>
              </div>

              {/* 제품 - pills + 제품 추가 */}
              <div className="opp-label">
                <span>제품</span>
                <div className="opp-product-pills">
                  {form.productName ? (
                    <span className="opp-product-pill">
                      {form.productName}
                      <button type="button" onClick={() => { setForm((f) => ({ ...f, productId: '', productName: '', unitPrice: '', currency: 'KRW' })); setSelectedProduct(null); setShowProductFields(false); }} aria-label="제거">
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </span>
                  ) : null}
                  <button type="button" className="opp-product-add-btn" onClick={() => setShowProductSearchModal(true)}>
                    <span className="material-symbols-outlined">add</span>
                    제품 추가
                  </button>
                </div>
              </div>

              {/* 제품 관련 필드 표시 (제품 선택 시) */}
              {selectedProduct && (
                <>
                  <label className="opp-label opp-checkbox-wrap">
                    <input type="checkbox" checked={showProductFields} onChange={(e) => setShowProductFields(e.target.checked)} />
                    <span>제품 관련 필드 표시</span>
                  </label>
                  {showProductFields && (
                    <div className="opp-product-fields">
                      <div className="opp-product-fields-title">선택 제품 정보</div>
                      <dl className="opp-product-fields-list">
                        {selectedProduct.code != null && selectedProduct.code !== '' && <><dt>코드</dt><dd>{selectedProduct.code}</dd></>}
                        {selectedProduct.category != null && selectedProduct.category !== '' && <><dt>카테고리</dt><dd>{selectedProduct.category}</dd></>}
                        {selectedProduct.version != null && selectedProduct.version !== '' && <><dt>버전</dt><dd>{selectedProduct.version}</dd></>}
                        {selectedProduct.billingType != null && selectedProduct.billingType !== '' && <><dt>결제 유형</dt><dd>{PRODUCT_BILLING_LABELS[selectedProduct.billingType] ?? selectedProduct.billingType}</dd></>}
                        {selectedProduct.status != null && selectedProduct.status !== '' && <><dt>상태</dt><dd>{selectedProduct.status}</dd></>}
                        {selectedProduct.customFields && typeof selectedProduct.customFields === 'object' && Object.entries(selectedProduct.customFields).filter(([, v]) => v != null && v !== '').map(([k, v]) => (
                          <React.Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></React.Fragment>
                        ))}
                      </dl>
                    </div>
                  )}
                </>
              )}

              {/* 단계 - 버튼 그룹 */}
              <div className="opp-label">
                <span>단계</span>
                <div className="opp-stage-group">
                  {stageSelectOptions.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      className={'opp-stage-btn' + (form.stage === s.value ? ' opp-stage-btn--selected' : '')}
                      onClick={() => handleChange('stage', s.value)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 단가 및 통화 / 수량 / 할인율 / 차감금액 */}
              <div className="opp-financial-grid">
                <div className="opp-label">
                  <span>단가 및 통화</span>
                  <div className="opp-unit-currency-wrap">
                    <input
                      type="text"
                      className="opp-input"
                      value={form.unitPrice}
                      onChange={handleUnitPriceChange}
                      placeholder="0"
                      inputMode="numeric"
                    />
                    <select className="opp-select" value={form.currency} onChange={(e) => handleChange('currency', e.target.value)}>
                      {CURRENCY_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <label className="opp-label">
                  <span>수량</span>
                  <input type="number" className="opp-input" min={1} value={form.quantity} onChange={(e) => handleChange('quantity', e.target.value)} placeholder="1" />
                </label>
                <label className="opp-label">
                  <span>할인율 (%)</span>
                  <input type="text" className="opp-input" value={form.discountRate} onChange={handleDiscountRateChange} placeholder="0" inputMode="decimal" />
                </label>
                <label className="opp-label opp-label--span2">
                  <span>차감금액</span>
                  <input type="text" className="opp-input" value={form.discountAmount} onChange={handleDiscountAmountChange} placeholder="0" inputMode="numeric" />
                </label>
              </div>

              {/* 계산 요약: 차감 금액 / 최종 금액 */}
              <div className="opp-summary-box">
                <div className="opp-summary-item">
                  <span className="opp-summary-label">차감 금액</span>
                  <span className="opp-summary-value">- {formatCurrencyDisplay(computeDeduction(), form.currency)}</span>
                </div>
                <div className="opp-summary-item opp-summary-item--end">
                  <span className="opp-summary-label">최종 금액</span>
                  <span className="opp-summary-value">{formatCurrencyDisplay(computeFinalAmount(), form.currency)}</span>
                </div>
              </div>

              {/* 설명 */}
              <label className="opp-label">
                <span>설명</span>
                <textarea
                  className="opp-textarea"
                  value={form.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  placeholder="거래에 대한 추가 상세 내용을 입력하세요."
                  rows={3}
                />
              </label>

              {error && <p className="opp-error">{error}</p>}
            </form>

            <div className="opp-modal-footer">
              {isEdit && (
                <button type="button" className="opp-delete-btn" onClick={handleDelete}>
                  <span className="material-symbols-outlined">delete</span>
                  삭제
                </button>
              )}
              <button type="button" className="opp-cancel-btn" onClick={onClose}>취소</button>
              <button type="submit" form="opp-form" className="opp-save-btn" disabled={saving}>
                {saving ? '저장 중...' : isEdit ? '수정' : '추가'}
              </button>
            </div>
          </>
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
            onSelect={(products) => {
              const product = Array.isArray(products) ? products[0] : products;
              if (!product) return;
              const price = listPriceFromProduct(product);
              setSelectedProduct(product);
              setShowProductFields(false);
              setForm((f) => ({
                ...f,
                productId: product._id,
                productName: product.name || '',
                unitPrice: price > 0 ? price.toLocaleString() : '',
                currency: product.currency || f.currency || 'KRW'
              }));
              setShowProductSearchModal(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
