import PrivacyPolicyBody from './legal-content/PrivacyPolicyBody';
import './legal-modal.css';

export default function PrivacyPolicyModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div
      className="legal-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-privacy-title"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="legal-modal-panel">
        <header className="legal-modal-header">
          <h2 id="legal-modal-privacy-title" className="legal-modal-title">
            개인정보 보호정책
          </h2>
          <button type="button" className="legal-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined" aria-hidden>close</span>
          </button>
        </header>
        <div className="legal-modal-body">
          <PrivacyPolicyBody />
        </div>
      </div>
    </div>
  );
}
