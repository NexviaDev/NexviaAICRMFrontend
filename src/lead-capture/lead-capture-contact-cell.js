/** 리스트에서 `tel:` 로 모바일 전화·데스크톱 기본 전화 앱 연결 */
export function phoneToTelHref(phone) {
  if (phone == null) return '';
  const s = String(phone).trim();
  if (!s) return '';
  const cleaned = s.replace(/[^\d+]/g, '');
  if (!cleaned || !cleaned.replace(/\+/g, '')) return '';
  return `tel:${cleaned}`;
}

export function LeadCapturePhoneCell({ phone, recipientName, companyName, onSms }) {
  const displayPhone = phone?.trim() ? String(phone).trim() : '—';
  const telHref = phoneToTelHref(phone);
  if (!phone?.trim()) {
    return <span className="lc-contact-text text-muted">{displayPhone}</span>;
  }
  return (
    <span className="lc-contact-cell">
      <span className="lc-contact-text text-muted">{displayPhone}</span>
      {telHref ? (
        <span className="lc-phone-action-btns">
          <a
            href={telHref}
            className="lc-phone-call-btn"
            title="전화 걸기"
            aria-label={`전화 걸기 ${displayPhone}`}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="material-symbols-outlined" aria-hidden>call</span>
          </a>
          <button
            type="button"
            className="lc-phone-sms-btn"
            title="문자 (AI 초안 후 전송)"
            aria-label={`문자 보내기 ${displayPhone}`}
            onClick={(e) => {
              e.stopPropagation();
              onSms?.({
                phone: String(phone).trim(),
                recipientName: recipientName || '',
                companyName: companyName || ''
              });
            }}
          >
            <span className="material-symbols-outlined" aria-hidden>sms</span>
          </button>
        </span>
      ) : null}
    </span>
  );
}

export function LeadCaptureEmailCell({ email, onCompose }) {
  const em = email?.trim() ? String(email).trim() : '';
  if (!em) return <span className="lc-contact-text text-muted">—</span>;
  return (
    <span className="lc-contact-cell lc-email-cell">
      <span className="lc-contact-text" title={em}>
        {em}
      </span>
      <button
        type="button"
        className="lc-email-compose-btn"
        title="메일 작성 — 보내기 시 PC 기본 메일로 넘기기"
        aria-label={`${em}에게 메일 작성`}
        onClick={(e) => {
          e.stopPropagation();
          onCompose?.({ initialTo: em });
        }}
      >
        <span className="material-symbols-outlined" aria-hidden>mail</span>
      </button>
    </span>
  );
}
