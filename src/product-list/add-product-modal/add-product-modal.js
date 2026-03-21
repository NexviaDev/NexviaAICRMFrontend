import { useState, useEffect } from 'react';
import CustomFieldsSection from '../../shared/custom-fields-section';
import CustomFieldsManageModal from '../../shared/custom-fields-manage-modal/custom-fields-manage-modal';
import { listPriceFromProduct } from '@/lib/product-price-utils';
import './add-product-modal.css';

import { API_BASE } from '@/config';
const STATUS_OPTIONS = [
  { value: 'Active', label: '활성' },
  { value: 'EndOfLife', label: 'End of Life' },
  { value: 'Draft', label: '초안' }
];
const BILLING_OPTIONS = ['Monthly', 'Annual', 'Perpetual'];
const BILLING_LABELS = { Monthly: '월간', Annual: '연간', Perpetual: '영구' };
const CURRENCY_OPTIONS = [
  { value: 'KRW', label: 'KRW (₩)' },
  { value: 'USD', label: 'USD ($)' }
];

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 표시용: 천 단위 쉼표 (소수점 유지, 최대 소수 자릿수 제한) */
function formatPriceDisplay(num, maxFractionDigits = 4) {
  const n = Number(num);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: 0
  });
}

/** 입력 문자열 → 숫자 */
function parsePriceInput(str) {
  const v = String(str ?? '').replace(/,/g, '').trim();
  if (v === '' || v === '.') return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 입력 중 천 단위 쉼표 삽입 (정수부만). 소수점 이하 원문 유지.
 */
function formatPriceWhileTyping(raw) {
  const s = String(raw).replace(/,/g, '');
  if (s === '') return '';
  if (s === '.') return '.';
  const dot = s.indexOf('.');
  const intRaw = dot === -1 ? s : s.slice(0, dot);
  const decRaw = dot === -1 ? '' : s.slice(dot + 1).replace(/\./g, '');
  if (!/^\d*$/.test(intRaw) || !/^\d*$/.test(decRaw)) return raw;
  const intFmt = intRaw === '' ? '' : intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (dot === -1) return intFmt;
  return `${intFmt}.${decRaw}`;
}

export default function AddProductModal({ product, onClose, onSaved }) {
  const isEdit = !!product?._id;
  const [form, setForm] = useState({
    name: product?.name ?? '',
    code: product?.code ?? '',
    category: product?.category ?? '',
    version: product?.version ?? '',
    currency: product?.currency ?? 'KRW',
    billingType: product?.billingType ?? 'Monthly',
    status: product?.status ?? 'Active',
    customFields: product?.customFields ? { ...product.customFields } : {}
  });
  const [customDefinitions, setCustomDefinitions] = useState([]);
  const [showCustomFieldsModal, setShowCustomFieldsModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [listPriceInput, setListPriceInput] = useState(() => formatPriceDisplay(listPriceFromProduct(product)));
  const [costPriceInput, setCostPriceInput] = useState(() => formatPriceDisplay(Number(product?.costPrice) || 0));
  const [channelPriceInput, setChannelPriceInput] = useState(() => formatPriceDisplay(Number(product?.channelPrice) || 0));

  const fetchCustomDefinitions = async () => {
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=product`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) setCustomDefinitions(data.items);
    } catch (_) {}
  };

  useEffect(() => {
    fetchCustomDefinitions();
  }, []);

  useEffect(() => {
    setListPriceInput(formatPriceDisplay(listPriceFromProduct(product)));
    setCostPriceInput(formatPriceDisplay(Number(product?.costPrice) || 0));
    setChannelPriceInput(formatPriceDisplay(Number(product?.channelPrice) || 0));
  }, [product?._id, product?.price, product?.listPrice, product?.costPrice, product?.channelPrice]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showCustomFieldsModal) setShowCustomFieldsModal(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showCustomFieldsModal]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const setBillingType = (value) => {
    setForm((prev) => ({ ...prev, billingType: value }));
    setError('');
  };

  const setStatus = (value) => {
    setForm((prev) => ({ ...prev, status: value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name?.trim()) {
      setError('제품명을 입력해 주세요.');
      return;
    }
    const listP = parsePriceInput(listPriceInput);
    const costP = parsePriceInput(costPriceInput);
    const channelP = parsePriceInput(channelPriceInput);
    setSaving(true);
    try {
      const url = isEdit ? `${API_BASE}/products/${product._id}` : `${API_BASE}/products`;
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          name: form.name.trim(),
          code: form.code.trim() || undefined,
          category: form.category.trim() || undefined,
          version: form.version.trim() || undefined,
          listPrice: listP,
          costPrice: costP,
          channelPrice: channelP,
          price: listP,
          currency: form.currency,
          billingType: form.billingType,
          status: form.status,
          customFields: form.customFields && Object.keys(form.customFields).length ? form.customFields : undefined
        })
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
    <div className="add-product-modal-overlay">
      <div className="add-product-modal">
        <div className="add-product-modal-header">
          <div className="add-product-modal-header-text">
            <h2 className="add-product-modal-title">{isEdit ? '제품 수정' : '신규 제품 등록'}</h2>
            <p className="add-product-modal-subtitle">
              {isEdit ? '제품 정보를 수정합니다.' : '시스템에 새로운 제품 정보를 입력합니다.'}
            </p>
          </div>
          <button type="button" className="add-product-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="add-product-modal-form">
          <div className="add-product-modal-body">
            {error && <p className="add-product-modal-error">{error}</p>}

            <section className="add-product-modal-section">
              <div className="add-product-modal-section-head add-product-modal-section-head--basic">
                <span className="add-product-modal-section-accent" aria-hidden />
                <h3 className="add-product-modal-section-title">기본 정보</h3>
              </div>
              <div className="add-product-modal-grid add-product-modal-grid--basic">
                <div className="add-product-modal-field">
                  <label htmlFor="add-product-name">제품명 <span className="required">*</span></label>
                  <input
                    id="add-product-name"
                    name="name"
                    type="text"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="제품 이름을 입력하세요"
                    required
                  />
                </div>
                <div className="add-product-modal-field">
                  <label htmlFor="add-product-code">제품 코드 (UID)</label>
                  <div className="add-product-modal-input-icon-wrap">
                    <input
                      id="add-product-code"
                      name="code"
                      type="text"
                      value={form.code}
                      onChange={handleChange}
                      placeholder="예: SP-9920"
                      className="add-product-modal-input-mono"
                      autoComplete="off"
                    />
                    <span className="material-symbols-outlined add-product-modal-input-suffix" aria-hidden>fingerprint</span>
                  </div>
                </div>
                <div className="add-product-modal-field">
                  <label htmlFor="add-product-category">카테고리</label>
                  <input
                    id="add-product-category"
                    name="category"
                    type="text"
                    value={form.category}
                    onChange={handleChange}
                    placeholder="예: Security"
                  />
                </div>
                <div className="add-product-modal-field">
                  <label htmlFor="add-product-version">버전</label>
                  <input id="add-product-version" name="version" type="text" value={form.version} onChange={handleChange} placeholder="v1.0.0" />
                </div>
              </div>
            </section>

            <section className="add-product-modal-section">
              <div className="add-product-modal-section-head add-product-modal-section-head--pricing">
                <span className="add-product-modal-section-accent add-product-modal-section-accent--tertiary" aria-hidden />
                <h3 className="add-product-modal-section-title add-product-modal-section-title--tertiary">가격 및 금융 설정</h3>
              </div>
              <div className="add-product-modal-grid add-product-modal-grid--pricing">
                <div className="add-product-modal-field add-product-modal-field--span2">
                  <label htmlFor="add-product-list-price">소비자 가격</label>
                  <div className="add-product-modal-price-currency-row">
                    <input
                      id="add-product-list-price"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0"
                      value={listPriceInput}
                      onChange={(e) => {
                        setListPriceInput(formatPriceWhileTyping(e.target.value));
                        setError('');
                      }}
                      onBlur={() => {
                        const n = parsePriceInput(listPriceInput);
                        setListPriceInput(formatPriceDisplay(n));
                      }}
                    />
                    <select
                      id="add-product-currency"
                      name="currency"
                      value={form.currency}
                      onChange={handleChange}
                      className="add-product-modal-currency-select"
                      aria-label="통화"
                    >
                      {CURRENCY_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="add-product-modal-field add-product-modal-field--pricing-status">
                  <span id="add-product-status-label" className="add-product-modal-label">상태</span>
                  <div className="add-product-modal-segmented" role="group" aria-labelledby="add-product-status-label">
                    {STATUS_OPTIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        className={`add-product-modal-segment ${form.status === value ? 'is-active' : ''}`}
                        onClick={() => setStatus(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="add-product-modal-field add-product-modal-field--pricing-half">
                  <label htmlFor="add-product-cost-price">원가 (Cost)</label>
                  <input
                    id="add-product-cost-price"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    value={costPriceInput}
                    onChange={(e) => {
                      setCostPriceInput(formatPriceWhileTyping(e.target.value));
                      setError('');
                    }}
                    onBlur={() => {
                      const n = parsePriceInput(costPriceInput);
                      setCostPriceInput(formatPriceDisplay(n));
                    }}
                  />
                </div>
                <div className="add-product-modal-field add-product-modal-field--pricing-half">
                  <label htmlFor="add-product-channel-price">유통가</label>
                  <input
                    id="add-product-channel-price"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    value={channelPriceInput}
                    onChange={(e) => {
                      setChannelPriceInput(formatPriceWhileTyping(e.target.value));
                      setError('');
                    }}
                    onBlur={() => {
                      const n = parsePriceInput(channelPriceInput);
                      setChannelPriceInput(formatPriceDisplay(n));
                    }}
                  />
                </div>
                <div className="add-product-modal-field add-product-modal-field--billing-full">
                  <span id="add-product-billing-label" className="add-product-modal-label">결제 주기</span>
                  <div className="add-product-modal-radio-row" role="radiogroup" aria-labelledby="add-product-billing-label">
                    {BILLING_OPTIONS.map((b) => (
                      <label key={b} className={`add-product-modal-radio ${form.billingType === b ? 'is-checked' : ''}`}>
                        <input
                          type="radio"
                          name="billingType"
                          value={b}
                          checked={form.billingType === b}
                          onChange={() => setBillingType(b)}
                        />
                        <span>{BILLING_LABELS[b]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <CustomFieldsSection
              definitions={customDefinitions}
              values={form.customFields || {}}
              onChangeValues={(key, value) => setForm((prev) => ({
                ...prev,
                customFields: { ...(prev.customFields || {}), [key]: value }
              }))}
              fieldClassName="add-product-modal-field"
            />
          </div>
          <div className="add-product-modal-footer">
            <button type="button" className="add-product-modal-extra" onClick={() => setShowCustomFieldsModal(true)}>
              <span className="material-symbols-outlined">add_circle</span>
              추가 필드
            </button>
            <div className="add-product-modal-footer-actions">
              <button type="button" className="add-product-modal-cancel" onClick={onClose}>취소</button>
              <button type="submit" className="add-product-modal-save" disabled={saving}>
                <span className="material-symbols-outlined add-product-modal-save-icon">save</span>
                {saving ? '저장 중…' : '제품 저장'}
              </button>
            </div>
          </div>
        </form>
      </div>
      {showCustomFieldsModal && (
        <CustomFieldsManageModal
          entityType="product"
          onClose={() => setShowCustomFieldsModal(false)}
          onFieldAdded={() => { fetchCustomDefinitions(); setShowCustomFieldsModal(false); }}
          apiBase={API_BASE}
          getAuthHeader={getAuthHeader}
        />
      )}
    </div>
  );
}
