import './drive-large-file-warning-modal.css';

export default function DriveLargeFileWarningModal({ open, files = [], onClose, onConfirm }) {
  if (!open) return null;

  const names = files
    .map((file) => file?.name)
    .filter(Boolean)
    .slice(0, 5);
  const extraCount = Math.max(0, files.length - names.length);

  return (
    <div className="drive-large-file-warning-overlay" role="dialog" aria-modal="true" aria-label="대용량 파일 업로드 안내">
      <div className="drive-large-file-warning-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drive-large-file-warning-icon">
          <span className="material-symbols-outlined">warning</span>
        </div>
        <h3>5MB 초과 파일 안내</h3>
        <p>
          5MB를 초과한 파일은 API로 바로 업로드할 수 없습니다.
          <br />
          확인을 누르면 해당 Google Drive 폴더를 열어 직접 넣을 수 있습니다.
        </p>
        {names.length > 0 && (
          <div className="drive-large-file-warning-files">
            {names.map((name) => (
              <div key={name} className="drive-large-file-warning-file">{name}</div>
            ))}
            {extraCount > 0 && (
              <div className="drive-large-file-warning-file">외 {extraCount}건</div>
            )}
          </div>
        )}
        <div className="drive-large-file-warning-actions">
          <button type="button" className="drive-large-file-warning-cancel" onClick={onClose}>
            취소
          </button>
          <button type="button" className="drive-large-file-warning-confirm" onClick={onConfirm}>
            Drive 열기
          </button>
        </div>
      </div>
    </div>
  );
}
