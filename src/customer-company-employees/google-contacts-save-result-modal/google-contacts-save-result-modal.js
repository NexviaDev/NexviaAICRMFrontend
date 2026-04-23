import { useEffect } from 'react';
import './google-contacts-save-result-modal.css';

/**
 * @param {{ success?: number, fail?: number, total?: number, errors?: { detail?: string }[], error?: string, needsReauth?: boolean } | null} result
 * @param {() => void} onClose
 */
export default function GoogleContactsSaveResultModal({ result, onClose }) {
  useEffect(() => {
    if (!result) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, onClose]);

  if (!result) return null;

  const isError = Boolean(result.error);
  const successCount = Number(result.success) || 0;
  const failCount = Number(result.fail) || 0;
  const totalCount = Number(result.total) || successCount + failCount || 0;
  const allFailed = !isError && successCount === 0 && failCount > 0;
  const partialOk = !isError && successCount > 0 && failCount > 0;
  const tone = isError || allFailed ? 'error' : partialOk ? 'warn' : 'ok';

  const headerIcon = isError || allFailed ? 'error' : partialOk ? 'info' : 'check_circle';
  const headerTitle = (() => {
    if (isError) return '구글 주소록 저장 실패';
    if (allFailed) return '구글 주소록에 저장되지 않았습니다';
    if (partialOk) return '구글 주소록 저장 (일부 완료)';
    return '구글 주소록 저장 완료';
  })();

  return (
    <div
      className="gc-save-result-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gc-save-result-modal-title"
    >
      <div className={`gc-save-result-modal gc-save-result-modal--${tone}`}>
        <div className="gc-save-result-modal-header">
          <span className="material-symbols-outlined gc-save-result-modal-icon" aria-hidden>
            {headerIcon}
          </span>
          <h2 id="gc-save-result-modal-title" className="gc-save-result-modal-title">
            {headerTitle}
          </h2>
        </div>
        <div className="gc-save-result-modal-body">
          {isError ? (
            <p className="gc-save-result-modal-message">
              {result.error}
              {result.needsReauth ? ' (Google 계정으로 재로그인이 필요할 수 있습니다.)' : ''}
            </p>
          ) : (
            <>
              <p className="gc-save-result-modal-lead">
                {allFailed
                  ? '선택한 연락처가 구글 주소록에 추가되지 않았습니다. 오류 내용을 확인해 주세요.'
                  : partialOk
                    ? '일부 연락처만 구글 주소록에 저장되었습니다.'
                    : '선택한 연락처가 구글 주소록에 반영되었습니다.'}
              </p>
              <p className="gc-save-result-modal-stats">
                총 <strong>{totalCount}</strong>명 중 <strong>{successCount}</strong>명 저장 완료
                {failCount > 0 && (
                  <>
                    , <strong>{failCount}</strong>명 실패
                  </>
                )}
              </p>
              {result.errors?.length > 0 && result.errors[0]?.detail && (
                <p className="gc-save-result-modal-detail" title={result.errors[0].detail}>
                  {result.errors[0].detail.slice(0, 200)}
                  {result.errors[0].detail.length > 200 ? '…' : ''}
                </p>
              )}
            </>
          )}
        </div>
        <div className="gc-save-result-modal-footer">
          <button type="button" className="gc-save-result-modal-btn" onClick={onClose}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
