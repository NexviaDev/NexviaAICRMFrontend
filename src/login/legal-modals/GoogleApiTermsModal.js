import GoogleApiTermsBody from './legal-content/GoogleApiTermsBody';
import './legal-modal.css';

export default function GoogleApiTermsModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div
      className="legal-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-google-title"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="legal-modal-panel">
        <header className="legal-modal-header">
          <h2 id="legal-modal-google-title" className="legal-modal-title">
            Google API 및 연동 약관·고지
          </h2>
          <button type="button" className="legal-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined" aria-hidden>close</span>
          </button>
        </header>
        <div className="legal-modal-body">
          <GoogleApiTermsBody />
        </div>
      </div>
    </div>
  );
}
