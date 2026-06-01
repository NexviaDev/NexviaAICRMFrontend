import './merge-pdf-preview-modal.css';

export default function MergePdfPreviewModal({
  open,
  onClose,
  pdfObjectUrl,
  loading,
  error,
  caption
}) {
  if (!open) return null;

  return (
    <div className="merge-pdf-preview-root" role="dialog" aria-modal="true" aria-labelledby="merge-pdf-preview-title">
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
        {error ? (
          <p className="merge-pdf-preview-error" role="alert">
            {error}
          </p>
        ) : null}
        {!loading && !error && pdfObjectUrl ? (
          <div className="merge-pdf-preview-frame-wrap">
            <iframe className="merge-pdf-preview-frame" src={pdfObjectUrl} title="PDF 미리보기" />
          </div>
        ) : null}
        <footer className="merge-pdf-preview-foot">
          <button type="button" className="btn-primary" onClick={onClose}>
            닫기
          </button>
        </footer>
      </div>
    </div>
  );
}
