import { useState, useEffect, useCallback, useRef } from 'react';
import './new-chat-modal.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmailList(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const e = String(raw || '').trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(String(raw).trim());
  }
  return out;
}

export default function NewChatModal({
  open,
  loading,
  inviteEmails,
  onInviteEmailsChange,
  onRequestParticipantPicker,
  onClose,
  onSubmit,
  /** 열릴 때 방 이름 초기값 (관리자 리드 채널 연동 등) */
  initialDisplayName,
  /** 열릴 때 초대 목록 초기값 — onInviteEmailsChange로 반영 */
  initialInviteEmails,
  /** 상단 설명 문단 (기본: 메신저용 안내) */
  description,
  /** 모달 제목 */
  title,
  /** 확인 버튼 라벨 */
  submitLabel,
  /** 방 이름 없이 초대만 — 기존 대화에 멤버 추가용 */
  inviteOnly
}) {
  const [name, setName] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const initialInviteRef = useRef(initialInviteEmails);
  initialInviteRef.current = initialInviteEmails;

  useEffect(() => {
    if (!open) return undefined;
    if (!inviteOnly) setName(String(initialDisplayName || '').trim());
    setEmailInput('');
    const next = normalizeEmailList(initialInviteRef.current || []);
    if (next.length) onInviteEmailsChange?.(next);
    return undefined;
  }, [open, initialDisplayName, onInviteEmailsChange, inviteOnly]);

  const addEmailFromInput = useCallback(() => {
    const raw = emailInput.trim();
    if (!raw) return;
    const parts = raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    const valid = parts.filter((e) => EMAIL_RE.test(e));
    if (valid.length === 0) return;
    const next = normalizeEmailList([...(inviteEmails || []), ...valid]);
    onInviteEmailsChange?.(next);
    setEmailInput('');
  }, [emailInput, inviteEmails, onInviteEmailsChange]);

  const removeEmail = useCallback((email) => {
    const target = String(email).trim().toLowerCase();
    onInviteEmailsChange?.((prev) =>
      (prev || []).filter((e) => String(e).trim().toLowerCase() !== target)
    );
  }, [onInviteEmailsChange]);

  const onKeyDownEmail = useCallback(
    (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addEmailFromInput();
      }
    },
    [addEmailFromInput]
  );

  if (!open) return null;

  const list = inviteEmails || [];
  const isInviteOnly = inviteOnly === true;
  const titleId = isInviteOnly ? 'messenger-add-members-title' : 'messenger-new-chat-title';

  return (
    <div className="messenger-modal-root" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="messenger-modal-backdrop" aria-hidden />
      <div className="messenger-modal-panel messenger-modal-panel--wide">
        <h3 id={titleId}>{title || (isInviteOnly ? '대화상대 추가' : '새 채팅방')}</h3>
        <p className="new-chat-modal-meta">
          {description ||
            (isInviteOnly
              ? '이 대화방에 Google Chat 멤버로 초대합니다. Workspace·Gmail 계정 이메일이어야 하며, Google이 초대 알림을 보냅니다.'
              : 'Google Chat API로 스페이스를 만듭니다. 멤버 초대가 되면 Google이 Gmail·Workspace 계정으로 알림을 보냅니다. 외부 초대는 서버에서 외부 사용자 허용을 시도합니다.')}
        </p>
        {!isInviteOnly ? (
          <div className="messenger-modal-field">
            <label htmlFor="messenger-new-name">방 이름</label>
            <input
              id="messenger-new-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 영업 전략"
              autoComplete="off"
            />
          </div>
        ) : null}
        <div className="messenger-modal-field">
          <span className="messenger-modal-field-label-row">
            <label htmlFor="messenger-new-email-input">{isInviteOnly ? '초대 이메일 (필수)' : '초대 이메일 (선택)'}</label>
            {onRequestParticipantPicker ? (
              <button
                type="button"
                className="new-chat-modal-pick-team"
                onClick={() => onRequestParticipantPicker()}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  group_add
                </span>
                팀원에서 선택
              </button>
            ) : null}
          </span>
          {list.length > 0 ? (
            <div className="new-chat-modal-chips" aria-label="초대 목록">
              {list.map((em) => (
                <button
                  key={em}
                  type="button"
                  className="new-chat-modal-chip"
                  onClick={() => removeEmail(em)}
                  title="클릭하여 제거"
                >
                  {em}
                  <span className="new-chat-modal-chip-x" aria-hidden>
                    ×
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <input
            id="messenger-new-email-input"
            type="text"
            className="new-chat-modal-email-input"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            onKeyDown={onKeyDownEmail}
            placeholder="이메일 입력 후 Enter · 여러 개는 쉼표로 구분"
            autoComplete="email"
          />
          <button type="button" className="new-chat-modal-add-email" onClick={addEmailFromInput}>
            이메일 추가
          </button>
        </div>
        <div className="messenger-modal-actions">
          <button type="button" className="messenger-modal-cancel" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="messenger-modal-submit"
            disabled={
              loading ||
              (isInviteOnly
                ? normalizeEmailList(inviteEmails || []).length === 0
                : !name.trim())
            }
            onClick={() => {
              const emails = normalizeEmailList(inviteEmails || []);
              if (isInviteOnly) {
                onSubmit?.({ inviteEmails: emails });
              } else {
                onSubmit?.({
                  displayName: name.trim(),
                  inviteEmails: emails
                });
              }
            }}
          >
            {loading ? '처리 중…' : submitLabel || (isInviteOnly ? '초대하기' : '만들기')}
          </button>
        </div>
      </div>
    </div>
  );
}
