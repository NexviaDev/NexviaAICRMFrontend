import { useState, useEffect } from 'react';
import CustomFieldsSection from '../../shared/custom-fields-section';
import CustomFieldsManageModal from '../../shared/custom-fields-manage-modal/custom-fields-manage-modal';
import './add-product-modal.css';

import { API_BASE } from '@/config';
const STATUS_OPTIONS = ['Active', 'EndOfLife', 'Draft'];
const BILLING_OPTIONS = ['Monthly', 'Annual'];
const CURRENCY_OPTIONS = ['KRW', 'USD'];

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function AddProductModal({ product, onClose, onSaved }) {
  const isEdit = !!product?._id;
  const [form, setForm] = useState({
    name: product?.name ?? '',
    code: product?.code ?? '',
    category: product?.category ?? '',
    version: product?.version ?? '',
    price: product?.price ?? 0,
    currency: product?.currency ?? 'KRW',
    billingType: product?.billingType ?? 'Monthly',
    status: product?.status ?? 'Active',
    customFields: product?.customFields ? { ...product.customFields } : {}
  });
  const [customDefinitions, setCustomDefinitions] = useState([]);
  const [showCustomFieldsModal, setShowCustomFieldsModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name?.trim()) {
      setError('제품명을 입력해 주세요.');
      return;
    }
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
          price: Number(form.price) || 0,
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
          <h3>{isEdit ? '제품 수정' : '새 제품 추가'}</h3>
          <button type="button" className="add-product-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="add-product-modal-form">
          <div className="add-product-modal-body">
            {error && <p className="add-product-modal-error">{error}</p>}
            <div className="add-product-modal-field">
            <label htmlFor="add-product-name">제품명 <span className="required">*</span></label>
            <input id="add-product-name" name="name" type="text" value={form.name} onChange={handleChange} placeholder="예: Shield Pro" required />
          </div>
          <div className="add-product-modal-field">
            <label htmlFor="add-product-code">제품 코드 (UID)</label>
            <input id="add-product-code" name="code" type="text" value={form.code} onChange={handleChange} placeholder="예: SP-9920" />
          </div>
          <div className="add-product-modal-field">
            <label htmlFor="add-product-category">카테고리</label>
            <input id="add-product-category" name="category" type="text" value={form.category} onChange={handleChange} placeholder="예: Security" />
          </div>
          <div className="add-product-modal-field">
            <label htmlFor="add-product-version">버전</label>
            <input id="add-product-version" name="version" type="text" value={form.version} onChange={handleChange} placeholder="예: v4.2.0" />
          </div>
          <div className="add-product-modal-field add-product-modal-row">
            <div className="add-product-modal-field">
              <label htmlFor="add-product-price">가격</label>
              <input id="add-product-price" name="price" type="number" min="0" step="0.01" value={form.price} onChange={handleChange} />
            </div>
            <div className="add-product-modal-field">
              <label htmlFor="add-product-currency">통화</label>
              <select id="add-product-currency" name="currency" value={form.currency} onChange={handleChange}>
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="add-product-modal-field">
            <label htmlFor="add-product-billingType">결제 주기</label>
            <select id="add-product-billingType" name="billingType" value={form.billingType} onChange={handleChange}>
              {BILLING_OPTIONS.map((b) => (
                <option key={b} value={b}>{b === 'Monthly' ? '월간' : '연간'}</option>
              ))}
            </select>
          </div>
          <div className="add-product-modal-field">
            <label htmlFor="add-product-status">상태</label>
            <select id="add-product-status" name="status" value={form.status} onChange={handleChange}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s === 'Active' ? '활성' : s === 'EndOfLife' ? 'End of Life' : '초안'}</option>
              ))}
            </select>
          </div>
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
              <button type="submit" className="add-product-modal-save" disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
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
