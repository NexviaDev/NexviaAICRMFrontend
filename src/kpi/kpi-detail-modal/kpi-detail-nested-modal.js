import './kpi-detail-modal.css';

const SAVE_LABEL = '저장 중…';
const CONFIRM_LABEL = '확인';

/**
 * KPI 상세 안의 항목(프로젝트·기타 성과 등) 전용 중첩 모달.
 * 부모와 동일한 `saving` / `onSave`를 쓰므로 저장 시 부모 푸터와 문구·비활성화가 함께 맞춰집니다.
 */
export default function KpiDetailNestedModal({
  title,
  isOtherType,
  onClose,
  onSave,
  saving = false,
  loading = false,
  children
}) {
  return (
    <div
      className={`kpi-detail-nested-overlay${saving ? ' kpi-detail-nested-overlay--saving' : ''}`}
      role="presentation"
      onClick={(e) => {
        if (saving) return;
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className="kpi-detail-nested-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kpi-detail-nested-title"
        aria-busy={saving}
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="kpi-detail-nested-header">
          <h2 id="kpi-detail-nested-title" className="kpi-detail-nested-title">
            {title}
          </h2>
          <button
            type="button"
            className="kpi-detail-nested-close"
            onClick={() => !saving && onClose?.()}
            disabled={saving}
            aria-label="항목 상세 닫기"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <div className="kpi-detail-nested-scroll">{children}</div>
        <footer className="kpi-detail-nested-footer">
          <p className="kpi-detail-nested-footer-hint">
            {isOtherType
              ? '입력한 내용은 «확인»으로 서버에 반영됩니다.'
              : '참여자별 점수는 «확인»으로 저장되어 동료 평가 누적에 반영됩니다.'}
          </p>
          <div className="kpi-detail-nested-footer-actions">
            <button type="button" className="kpi-detail-btn-ghost" onClick={() => onClose?.()} disabled={saving}>
              닫기
            </button>
            <button
              type="button"
              className="kpi-detail-btn-primary"
              onClick={() => Promise.resolve(onSave?.()).catch(() => {})}
              disabled={saving || loading}
            >
              {saving ? SAVE_LABEL : CONFIRM_LABEL}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
