import { useState, useEffect } from 'react';
import CustomFieldsDisplay from '../../shared/custom-fields-display';
import CustomFieldsSection from '../../shared/custom-fields-section';
import './product-detail-modal.css';

import { API_BASE } from '@/config';
const STATUS_OPTIONS = ['Active', 'EndOfLife', 'Draft'];
const BILLING_OPTIONS = ['Monthly', 'Annual', 'Perpetual'];
const CURRENCY_OPTIONS = ['KRW', 'USD'];
const STATUS_LABELS = { Active: '활성', EndOfLife: 'End of Life', Draft: '초안' };
const BILLING_LABELS = { Monthly: '월간', Annual: '연간', Perpetual: '영구' };

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatPrice(price, currency) {
  if (price == null) return '—';
  const sym = currency === 'USD' ? '$' : '₩';
  return `${sym}${Number(price).toLocaleString()}`;
}

/** 제품 세부정보 모달 - 행 클릭 시 표시, 수정 시 같은 패널에서 폼 슬라이드 */
export default function ProductDetailModal({ product, onClose, onUpdated, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [customDefinitions, setCustomDefinitions] = useState([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=product`, { headers: getAuthHeader() });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(data.items)) setCustomDefinitions(data.items);
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showDeleteConfirm) setShowDeleteConfirm(false);
      else if (editing) cancelEdit();
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, editing, showDeleteConfirm]);

  if (!product) return null;

  const statusClass = product.status === 'Active' ? 'active' : product.status === 'EndOfLife' ? 'eol' : 'draft';

  const startEdit = () => {
    setEditForm({
      name: product.name ?? '',
      code: product.code ?? '',
      category: product.category ?? '',
      version: product.version ?? '',
      price: product.price ?? 0,
      currency: product.currency ?? 'KRW',
      billingType: product.billingType ?? 'Monthly',
      status: product.status ?? 'Active',
      customFields: product.customFields ? { ...product.customFields } : {}
    });
    setEditError('');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditError('');
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setEditForm((prev) => ({ ...prev, [name]: value }));
    setEditError('');
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setEditError('');
    if (!editForm.name?.trim()) {
      setEditError('제품명을 입력해 주세요.');
      return;
    }
    setEditSaving(true);
    try {
      const res = await fetch(`${API_BASE}/products/${product._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          name: editForm.name.trim(),
          code: editForm.code?.trim() || undefined,
          category: editForm.category?.trim() || undefined,
          version: editForm.version?.trim() || undefined,
          price: Number(editForm.price) || 0,
          currency: editForm.currency,
          billingType: editForm.billingType,
          status: editForm.status,
          customFields: editForm.customFields && Object.keys(editForm.customFields).length ? editForm.customFields : undefined
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEditError(data.error || '저장에 실패했습니다.');
        return;
      }
      const updated = await res.json();
      setEditing(false);
      onUpdated?.(updated);
    } catch (_) {
      setEditError('서버에 연결할 수 없습니다.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = () => {
    setDeleting(true);
    try {
      onDelete?.(product);
      onClose?.();
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <>
      <div className="product-detail-overlay" aria-hidden="true" />
      <div className="product-detail-panel">
        <div className="product-detail-inner">
          <header className="product-detail-header">
            <div className="product-detail-header-title">
              <h2>{editing ? '제품 수정' : '제품 세부정보'}</h2>
            </div>
            <div className="product-detail-header-actions">
              {!editing && onUpdated && (
                <button type="button" className="product-detail-icon-btn" onClick={startEdit} title="수정">
                  <span className="material-symbols-outlined">edit</span>
                </button>
              )}
              {!editing && onDelete && (
                <button type="button" className="product-detail-icon-btn product-detail-delete-btn" onClick={() => setShowDeleteConfirm(true)} title="삭제">
                  <span className="material-symbols-outlined">delete</span>
                </button>
              )}
              <button
                type="button"
                className="product-detail-icon-btn"
                onClick={editing ? cancelEdit : onClose}
                aria-label={editing ? '수정 취소' : '닫기'}
              >
                <span className="material-symbols-outlined">{editing ? 'undo' : 'close'}</span>
              </button>
            </div>
          </header>

          {/* 삭제 확인 - contact-detail-modal과 동일한 디자인 */}
          {showDeleteConfirm && (
            <div className="product-detail-delete-confirm">
              <span className="material-symbols-outlined">warning</span>
              <p>이 제품을 삭제하시겠습니까?<br />삭제된 제품은 복구할 수 없습니다.</p>
              <div className="product-detail-delete-confirm-btns">
                <button type="button" className="product-detail-confirm-cancel" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>취소</button>
                <button type="button" className="product-detail-confirm-delete" onClick={handleDelete} disabled={deleting}>
                  {deleting ? '삭제 중...' : '삭제'}
                </button>
              </div>
            </div>
          )}

          <div className="product-detail-body">
            {editing ? (
              <form onSubmit={handleEditSubmit} className="product-detail-edit-form product-detail-edit-form-slide">
                {editError && <p className="product-detail-edit-error">{editError}</p>}
                <div className="product-detail-edit-field">
                  <label htmlFor="product-edit-name">제품명 <span className="required">*</span></label>
                  <input id="product-edit-name" name="name" type="text" value={editForm.name} onChange={handleEditChange} placeholder="예: Shield Pro" required />
                </div>
                <div className="product-detail-edit-field">
                  <label htmlFor="product-edit-code">제품 코드 (UID)</label>
                  <input id="product-edit-code" name="code" type="text" value={editForm.code} onChange={handleEditChange} placeholder="예: SP-9920" />
                </div>
                <div className="product-detail-edit-field">
                  <label htmlFor="product-edit-category">카테고리</label>
                  <input id="product-edit-category" name="category" type="text" value={editForm.category} onChange={handleEditChange} placeholder="예: Security" />
                </div>
                <div className="product-detail-edit-field">
                  <label htmlFor="product-edit-version">버전</label>
                  <input id="product-edit-version" name="version" type="text" value={editForm.version} onChange={handleEditChange} placeholder="예: v4.2.0" />
                </div>
                <div className="product-detail-edit-row">
                  <div className="product-detail-edit-field">
                    <label htmlFor="product-edit-price">가격</label>
                    <input id="product-edit-price" name="price" type="number" min="0" step="0.01" value={editForm.price} onChange={handleEditChange} />
                  </div>
                  <div className="product-detail-edit-field">
                    <label htmlFor="product-edit-currency">통화</label>
                    <select id="product-edit-currency" name="currency" value={editForm.currency} onChange={handleEditChange}>
                      {CURRENCY_OPTIONS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="product-detail-edit-field">
                  <label htmlFor="product-edit-billingType">결제 주기</label>
                  <select id="product-edit-billingType" name="billingType" value={editForm.billingType} onChange={handleEditChange}>
                    {BILLING_OPTIONS.map((b) => (
                      <option key={b} value={b}>{BILLING_LABELS[b] ?? b}</option>
                    ))}
                  </select>
                </div>
                <div className="product-detail-edit-field">
                  <label htmlFor="product-edit-status">상태</label>
                  <select id="product-edit-status" name="status" value={editForm.status} onChange={handleEditChange}>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s === 'Active' ? '활성' : s === 'EndOfLife' ? 'End of Life' : '초안'}</option>
                    ))}
                  </select>
                </div>
                <CustomFieldsSection
                  definitions={customDefinitions}
                  values={editForm.customFields || {}}
                  onChangeValues={(key, value) => setEditForm((prev) => ({
                    ...prev,
                    customFields: { ...(prev.customFields || {}), [key]: value }
                  }))}
                  fieldClassName="product-detail-edit-field"
                />
                <div className="product-detail-edit-footer">
                  <button type="button" className="product-detail-edit-cancel" onClick={cancelEdit}>취소</button>
                  <button type="submit" className="product-detail-edit-save" disabled={editSaving}>
                    {editSaving ? '저장 중…' : '저장'}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <section className="product-detail-card">
                  <div className="product-detail-icon-wrap">
                    <span className="material-symbols-outlined">inventory_2</span>
                  </div>
                  <div className="product-detail-info">
                    <div className="product-detail-name-row">
                      <h1 className="product-detail-name">{product.name || '—'}</h1>
                      <span className={`product-detail-status-badge status-${statusClass}`}>
                        {STATUS_LABELS[product.status] || product.status}
                      </span>
                    </div>
                    {product.code && (
                      <p className="product-detail-uid">UID: {product.code}</p>
                    )}
                  </div>
                </section>

                <section className="product-detail-section">
                  <h3 className="product-detail-section-title">기본 정보</h3>
                  <dl className="product-detail-dl">
                    <div className="product-detail-dl-row">
                      <dt>카테고리</dt>
                      <dd>{product.category || '—'}</dd>
                    </div>
                    <div className="product-detail-dl-row">
                      <dt>버전</dt>
                      <dd>{product.version || '—'}</dd>
                    </div>
                    <div className="product-detail-dl-row">
                      <dt>가격</dt>
                      <dd>{formatPrice(product.price, product.currency)}</dd>
                    </div>
                    <div className="product-detail-dl-row">
                      <dt>결제 주기</dt>
                      <dd>{product.billingType ? BILLING_LABELS[product.billingType] : '—'}</dd>
                    </div>
                    <div className="product-detail-dl-row">
                      <dt>통화</dt>
                      <dd>{product.currency || '—'}</dd>
                    </div>
                  </dl>
                </section>
                <CustomFieldsDisplay
                  definitions={customDefinitions}
                  values={product.customFields || {}}
                  className="product-detail-custom-fields"
                />
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
