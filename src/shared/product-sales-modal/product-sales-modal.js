import { useEffect } from 'react';
import './product-sales-modal.css';

const STAGE_LABELS = {
  NewLead: '신규 리드',
  Contacted: '접촉 완료',
  ProposalSent: '제안서 발송',
  Closed: '종료',
  Lost: '기회 상실',
  Abandoned: '보류',
  Won: '수주 성공'
};

function formatValue(value, currency) {
  if (value == null) return '—';
  const sym = currency === 'USD' ? '$' : '₩';
  return `${sym}${Number(value).toLocaleString()}`;
}

/**
 * 제품 판매 현황 전체 보기 모달 (고객사 세부 / 연락처 세부 공용)
 * - items: 세일즈 기회 목록
 * - driveFolderLink: 고객사 Drive 폴더 링크 (있으면 헤더에 폴더 보기 아이콘 표시)
 * - onAddSale: 추가하기(판매 등록) 클릭 시 콜백 (RegisterSaleModal 열기 등)
 * - onSelectItem: 행 클릭 시 해당 판매 기회 수정용 콜백 (RegisterSaleModal 수정 모드 열기 등)
 */
export default function ProductSalesModal({ companyName, companyId, items, driveFolderLink, onClose, onAddSale, onSelectItem }) {
  const list = items || [];

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="product-sales-modal-overlay" aria-hidden="true" />
      <div className="product-sales-modal">
        <div className="product-sales-modal-inner">
          <header className="product-sales-modal-header">
            <div className="product-sales-modal-header-title-wrap">
              <h3>제품 판매 현황</h3>
              {companyName && <p className="product-sales-modal-subtitle">{companyName}</p>}
            </div>
            <div className="product-sales-modal-header-actions">
              {driveFolderLink && (
                <a
                  href={driveFolderLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="product-sales-modal-header-icon-btn"
                  title="폴더 보기"
                  aria-label="폴더 보기"
                >
                  <span className="material-symbols-outlined">folder_open</span>
                </a>
              )}
              {onAddSale && (
                <button type="button" className="product-sales-modal-header-icon-btn" onClick={onAddSale} title="추가하기" aria-label="추가하기">
                  <span className="material-symbols-outlined">add_circle</span>
                </button>
              )}
              <button type="button" className="product-sales-modal-header-icon-btn" onClick={onClose} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          </header>
          <div className="product-sales-modal-body">
            {list.length === 0 ? (
              <p className="product-sales-modal-empty">
                이 고객사에 대한 제품 판매 기회가 없습니다.
                {onAddSale && (
                  <button type="button" className="product-sales-modal-empty-btn" onClick={onAddSale}>
                    추가하기
                  </button>
                )}
              </p>
            ) : (
              <div className="product-sales-modal-table-wrap">
                <table className="product-sales-modal-table">
                  <thead>
                    <tr>
                      <th>제품</th>
                      <th>제목</th>
                      <th>단계</th>
                      <th>금액</th>
                      <th>담당자</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((row) => (
                      <tr
                        key={row._id}
                        className={onSelectItem ? 'product-sales-modal-row-clickable' : ''}
                        onClick={onSelectItem ? () => onSelectItem(row) : undefined}
                        role={onSelectItem ? 'button' : undefined}
                        tabIndex={onSelectItem ? 0 : undefined}
                        onKeyDown={onSelectItem ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectItem(row); } } : undefined}
                      >
                        <td className="product-sales-modal-cell-product">
                          {row.productName ? (
                            <span className="product-sales-modal-product-badge">{row.productName}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="product-sales-modal-cell-title">{row.title || '—'}</td>
                        <td>
                          <span className="product-sales-modal-stage-badge">
                            {STAGE_LABELS[row.stage] || row.stage}
                          </span>
                        </td>
                        <td className="product-sales-modal-cell-value">
                          {formatValue(row.value, row.currency)}
                        </td>
                        <td className="product-sales-modal-cell-contact">{row.contactName || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
