import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './merge-pdf-preview-modal.css';

export default function MergePdfPreviewModal({
  open,
  onClose,
  pdfObjectUrl,
  loading,
  error,
  caption
}) {
  const [frameError, setFrameError] = useState('');

  useEffect(() => {
    if (!open) setFrameError('');
  }, [open, pdfObjectUrl]);

  if (!open || typeof document === 'undefined') return null;

  const displayError = error || frameError;
  const pdfSrc = pdfObjectUrl && !loading && !displayError ? pdfObjectUrl : '';

  return createPortal(
    <div
      className="merge-pdf-preview-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-pdf-preview-title"
    >
      <button type="button" className="merge-pdf-preview-backdrop" aria-label="닫기" onClick={onClose} />
      <div className="merge-pdf-preview-panel">
        <header className="merge-pdf-preview-head">
          <h2 id="merge-pdf-preview-title" className="merge-pdf-preview-title">
            PDF 미리보기
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined" aria-hidden>
              close
            </span>
          </button>
        </header>
        {caption ? (
          <p className="merge-pdf-preview-caption" role="status">
            {caption}
          </p>
        ) : null}
        {loading ? (
          <div className="merge-pdf-preview-status" role="status" aria-live="polite">
            <span className="merge-pdf-preview-spinner" aria-hidden />
            <span>PDF를 만드는 중입니다… (서버 변환)</span>
          </div>
        ) : null}
        {displayError ? (
          <p className="merge-pdf-preview-error" role="alert">
            {displayError}
          </p>
        ) : null}
        {pdfSrc ? (
          <div className="merge-pdf-preview-frame-wrap">
            <object
              className="merge-pdf-preview-object"
              data={pdfSrc}
              type="application/pdf"
              aria-label="PDF 미리보기"
            >
              <iframe
                className="merge-pdf-preview-frame"
                src={pdfSrc}
                title="PDF 미리보기"
                onError={() => setFrameError('브라우저에서 PDF를 표시하지 못했습니다. 새 탭에서 열어 보세요.')}
              />
            </object>
            <a className="merge-pdf-preview-open-tab" href={pdfSrc} target="_blank" rel="noopener noreferrer">
              새 탭에서 열기
            </a>
          </div>
        ) : null}
        <footer className="merge-pdf-preview-foot">
          <button type="button" className="btn-primary" onClick={onClose}>
            닫기
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
