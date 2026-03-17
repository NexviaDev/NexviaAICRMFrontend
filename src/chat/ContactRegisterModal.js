import { useState, useEffect } from 'react';

/** 연락처 숫자만 추출 후 한국 번호 양식으로 하이픈 삽입 (최대 11자리) */
function formatPhone(digits) {
  const d = String(digits).replace(/\D/g, '').slice(0, 11);
  if (!d.length) return '';
  if (d.startsWith('02')) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `02-${d.slice(2)}`;
    if (d.length <= 9) return `02-${d.slice(2, 5)}-${d.slice(5)}`;
    return `02-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }
  if (d.startsWith('01') && d.length >= 3) {
    if (d.length <= 3) return d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
  }
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
}

/**
 * 이름·연락처 등록/수정 모달
 * @param {{ data: { chatResourceName: string, displayName: string, email: string, phone: string, memo: string } | null, onClose: () => void, onSave: (e: React.FormEvent) => void, saving: boolean }} props
 */
export default function ContactRegisterModal({ data, onClose, onSave, saving }) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [memo, setMemo] = useState('');

  useEffect(() => {
    if (!data) return;
    setDisplayName(data.displayName ?? '');
    setEmail(data.email ?? '');
    setPhone(formatPhone(data.phone ?? ''));
    setMemo(data.memo ?? '');
  }, [data]);

  const handlePhoneChange = (e) => {
    const next = formatPhone(e.target.value);
    setPhone(next);
  };

  if (!data) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      ...data,
      displayName: displayName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      memo: memo.trim()
    };
    onSave(e, payload);
  };

  return (
    <div className="google-chat-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="google-chat-modal" onClick={(e) => e.stopPropagation()}>
        <div className="google-chat-modal-header">
          <h3>이름·연락처 등록</h3>
          <button type="button" className="google-chat-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="google-chat-modal-form">
          <div className="google-chat-modal-field">
            <label htmlFor="gc-contact-name">이름 *</label>
            <input
              id="gc-contact-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="표시할 이름"
              required
            />
          </div>
          <div className="google-chat-modal-field">
            <label htmlFor="gc-contact-email">이메일</label>
            <input
              id="gc-contact-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
            />
          </div>
          <div className="google-chat-modal-field">
            <label htmlFor="gc-contact-phone">연락처</label>
            <input
              id="gc-contact-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              onChange={handlePhoneChange}
              placeholder="010-0000-0000"
              maxLength={13}
            />
          </div>
          <div className="google-chat-modal-field">
            <label htmlFor="gc-contact-memo">메모</label>
            <textarea
              id="gc-contact-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="비고 (선택)"
              rows={2}
            />
          </div>
          <div className="google-chat-modal-actions">
            <button type="button" className="google-chat-btn-cancel" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="google-chat-send-btn" disabled={saving || !displayName.trim()}>
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
