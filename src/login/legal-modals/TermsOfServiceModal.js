import TermsOfServiceBody from './legal-content/TermsOfServiceBody';
import './legal-modal.css';

export default function TermsOfServiceModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div
      className="legal-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-terms-title"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="legal-modal-panel">
        <header className="legal-modal-header">
          <h2 id="legal-modal-terms-title" className="legal-modal-title">
            이용약관
          </h2>
          <button type="button" className="legal-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined" aria-hidden>close</span>
          </button>
        </header>
        <div className="legal-modal-body">
          <TermsOfServiceBody />
        </div>
      </div>
    </div>
  );
}
