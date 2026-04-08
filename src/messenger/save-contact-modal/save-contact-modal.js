import { useEffect } from 'react';
import './save-contact-modal.css';

/**
 * CRM 메신저 주소록(UserChatContact) 등록·수정 모달
 */
export default function SaveContactModal({
  open,
  onClose,
  isEdit,
  prefillLoading,
  saveLoading,
  form,
  setForm,
  error,
  onSubmit
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (saveLoading || prefillLoading) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saveLoading, prefillLoading, onClose]);

  if (!open) return null;

  const title = isEdit ? '메신저 주소록 수정' : '메신저 주소록에 등록';
  const titleId = 'messenger-save-contact-title';
  const busy = saveLoading || prefillLoading;

  return (
    <div
      className="messenger-save-contact-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="messenger-save-contact-panel">
        <div className="messenger-save-contact-head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="messenger-save-contact-close"
            aria-label="닫기"
            disabled={busy}
            onClick={onClose}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <p className="messenger-save-contact-desc">
          Google 연락처가 아니라 <strong>이 CRM 계정의 메신저 주소록</strong>에 저장됩니다. 이름은 대화 목록·말풍선
          표시에 사용됩니다. 이메일·전화는 같은 회사 동료 계정 또는 Google 프로필에서 가능한 경우 자동으로
          채워집니다.
          {isEdit ? ' 아래에서 언제든지 수정할 수 있습니다.' : null}
        </p>
        {prefillLoading ? (
          <p className="messenger-save-contact-loading">불러오는 중…</p>
        ) : (
          <div className="messenger-save-contact-fields">
            <label className="messenger-save-contact-label" htmlFor="messenger-save-contact-name">
              이름 <span className="messenger-save-contact-req">*</span>
            </label>
            <input
              id="messenger-save-contact-name"
              type="text"
              className="messenger-save-contact-input"
              value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              placeholder="표시할 이름"
              disabled={saveLoading}
            />
            <label className="messenger-save-contact-label" htmlFor="messenger-save-contact-email">
              이메일
            </label>
            <input
              id="messenger-save-contact-email"
              type="email"
              className="messenger-save-contact-input"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="선택"
              disabled={saveLoading}
            />
            <label className="messenger-save-contact-label" htmlFor="messenger-save-contact-phone">
              전화
            </label>
            <input
              id="messenger-save-contact-phone"
              type="text"
              className="messenger-save-contact-input"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="선택"
              disabled={saveLoading}
            />
            <label className="messenger-save-contact-label" htmlFor="messenger-save-contact-memo">
              메모
            </label>
            <textarea
              id="messenger-save-contact-memo"
              className="messenger-save-contact-textarea"
              rows={2}
              value={form.memo}
              onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
              placeholder="선택"
              disabled={saveLoading}
            />
          </div>
        )}
        {error ? (
          <p className="messenger-save-contact-err" role="alert">
            {error}
          </p>
        ) : null}
        <div className="messenger-save-contact-actions">
          <button
            type="button"
            className="messenger-save-contact-btn-cancel"
            disabled={busy}
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            className="messenger-save-contact-btn-save"
            disabled={busy}
            onClick={() => void onSubmit()}
          >
            {saveLoading ? '저장 중…' : isEdit ? '변경 저장' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
