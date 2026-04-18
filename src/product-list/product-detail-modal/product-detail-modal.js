import { useState, useEffect } from 'react';
import CustomFieldsDisplay from '../../shared/custom-fields-display';
import AddProductModal from '../add-product-modal/add-product-modal';
import './product-detail-modal.css';

import { API_BASE } from '@/config';
import { listPriceFromProduct } from '@/lib/product-price-utils';
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

/** 신규 등록용: _id 등 복제하면 안 되는 필드 제거, 커스텀 필드는 얕은 복사 */
function productToDuplicateDraft(source) {
  if (!source) return null;
  const { _id, __v, createdAt, updatedAt, companyId, ...rest } = source;
  return {
    ...rest,
    customFields: source.customFields && typeof source.customFields === 'object'
      ? { ...source.customFields }
      : {}
  };
}

/** 제품 세부정보 모달 - 행 클릭 시 표시, 수정 시 같은 패널에서 폼 슬라이드 */
export default function ProductDetailModal({ product, onClose, onUpdated, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
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
      else if (editing) setEditing(false);
      else if (duplicating) setDuplicating(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, editing, duplicating, showDeleteConfirm]);

  if (!product) return null;

  if (editing || duplicating) {
    const duplicateDraft = duplicating ? productToDuplicateDraft(product) : null;
    return (
      <AddProductModal
        key={duplicating ? `duplicate-${product._id}` : `edit-${product._id}`}
        product={duplicating ? duplicateDraft : product}
        variant={duplicating ? 'duplicate' : undefined}
        presentation="slide"
        onClose={() => {
          setEditing(false);
          setDuplicating(false);
        }}
        onSaved={() => {
          setEditing(false);
          setDuplicating(false);
          onUpdated?.();
        }}
      />
    );
  }

  const statusClass = product.status === 'Active' ? 'active' : product.status === 'EndOfLife' ? 'eol' : 'draft';

  const startEdit = () => {
    setDuplicating(false);
    setEditing(true);
  };

  const startDuplicate = () => {
    setEditing(false);
    setDuplicating(true);
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
              {!editing && onUpdated && (
                <button type="button" className="product-detail-icon-btn" onClick={startDuplicate} title="복제하여 새 제품 등록">
                  <span className="material-symbols-outlined">content_copy</span>
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
                onClick={onClose}
                aria-label="닫기"
              >
                <span className="material-symbols-outlined">close</span>
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
                      <dt>소비자가</dt>
                      <dd>{formatPrice(listPriceFromProduct(product), product.currency)}</dd>
                    </div>
                    <div className="product-detail-dl-row">
                      <dt>원가</dt>
                      <dd>{formatPrice(product.costPrice, product.currency)}</dd>
                    </div>
                    <div className="product-detail-dl-row">
                      <dt>유통가</dt>
                      <dd>{formatPrice(product.channelPrice, product.currency)}</dd>
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
          </div>
        </div>
      </div>
    </>
  );
}
