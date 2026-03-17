import { useEffect } from 'react';
import './won-all-modal.css';

function formatCurrency(value, currency) {
  if (!value) return currency === 'KRW' ? '₩0' : '$0';
  if (currency === 'USD') return '$' + value.toLocaleString();
  return '₩' + value.toLocaleString();
}

/**
 * 수주 성공(Won) 전체 목록을 보여주는 읽기 전용 모달.
 * items: 수주 성공 기회 배열
 * onClose: 모달 닫기 콜백
 */
export default function WonAllModal({ items = [], onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="wonall-overlay" onClick={onClose} role="presentation">
      <div className="wonall-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wonall-header">
          <h3 className="wonall-title">수주 성공 전체</h3>
          <button type="button" className="wonall-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="wonall-list">
          {!items || items.length === 0 ? (
            <p className="wonall-empty">수주 성공 건이 없습니다.</p>
          ) : (
            items.map((opp) => (
              <div key={opp._id} className="wonall-card">
                <h4 className="wonall-card-title">{opp.customerCompanyName || '\u00A0'} – {opp.title || '\u00A0'}</h4>
                <p className="wonall-card-contact">{opp.contactName || '\u00A0'}</p>
                <div className="wonall-card-meta">
                  <span className="wonall-card-value">{formatCurrency(opp.value, opp.currency)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
