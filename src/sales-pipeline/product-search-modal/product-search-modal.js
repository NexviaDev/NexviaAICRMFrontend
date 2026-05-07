import { useEffect } from 'react';
import ProductList from '@/product-list/product-list';
import './product-search-modal.css';

/**
 * 제품 선택 모달 — 제품 목록 페이지와 동일한 표·열 설정(listTemplates.productList) 사용.
 */
export default function ProductSearchModal({ onClose, onSelect }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="product-search-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="product-search-modal product-search-modal--embed-list"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-search-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="product-search-modal-header">
          <h3 id="product-search-modal-title">제품 검색</h3>
          <button type="button" className="product-search-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <div className="product-search-modal-body">
          <ProductList
            listVariant="searchModal"
            onSearchModalClose={onClose}
            onSearchModalConfirm={(products) => {
              onSelect?.(products);
              onClose?.();
            }}
          />
        </div>
      </div>
    </div>
  );
}
