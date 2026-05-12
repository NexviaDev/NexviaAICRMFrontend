import { useEffect, useState } from 'react';
import CustomerCompanies from '../customer-companies';
import AddCompanyModal from '../add-company-modal/add-company-modal';
import './customer-company-search-modal.css';

/**
 * 고객사 검색 모달 (업체명, 사업자번호, 주소, 직원 이름/연락처로 검색)
 * opportunity-modal, add-contact-modal 등에서 공통 사용
 */
export default function CustomerCompanySearchModal({ onClose, onSelect }) {
  const [showAddCompany, setShowAddCompany] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showAddCompany) setShowAddCompany(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showAddCompany]);

  return (
    <>
      <div className="cc-search-modal-overlay" role="presentation" onClick={onClose}>
        <div
          className="cc-search-modal cc-search-modal--embed-list"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cc-search-modal-title"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="cc-search-modal-header">
            <h3 id="cc-search-modal-title">고객사 검색</h3>
            <div className="cc-search-modal-header-actions">
              <button
                type="button"
                className="cc-search-modal-add-header-btn"
                onClick={() => setShowAddCompany(true)}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  add_business
                </span>
                고객사 추가
              </button>
              <button type="button" className="cc-search-modal-close" onClick={onClose} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          </header>
          <div className="cc-search-modal-body">
            <CustomerCompanies
              listVariant="searchModal"
              onSearchModalConfirm={(company) => {
                onSelect?.(company);
                onClose?.();
              }}
            />
          </div>
        </div>
      </div>
      {showAddCompany && (
        <div className="cc-search-modal-add-layer">
          <AddCompanyModal
            onClose={() => setShowAddCompany(false)}
            onSaved={(company) => {
              setShowAddCompany(false);
              if (company?._id || company?.id) {
                onSelect?.(company);
                onClose?.();
              }
            }}
          />
        </div>
      )}
    </>
  );
}
