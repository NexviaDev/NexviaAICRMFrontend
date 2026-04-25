import { memo } from 'react';

function formatBusinessNumberDisplay(raw) {
  const s = String(raw || '').replace(/\D/g, '');
  if (s.length === 10) return `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5)}`;
  if (String(raw || '').trim()) return String(raw).trim();
  return '—';
}

function truncateAddress(addr, max = 56) {
  const t = String(addr || '').replace(/\s+/g, ' ').trim();
  if (!t) return '주소 없음';
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * 연락처 저장 직전: 이름/전화 중복 후보, 유사 고객사 상호 — 확인·강제 저장
 * 스타일: 상위가 로드한 add-customer-company-employees-modal.css 의 add-contact-pregate-* 사용
 */
function ContactSavePregateModal({
  review,
  saving,
  isEditMode,
  onClose,
  onConfirmForce,
  onOpenCompanyDetail,
  onLinkExistingCompany
}) {
  if (!review) return null;
  const cands = review.contactCandidates || [];
  const sims = review.similarCustomerCompanies || [];
  if (cands.length === 0 && sims.length === 0) return null;

  const cCount = cands.length;
  const sCount = sims.length;
  const confirmLabel =
    isEditMode && cCount > 0 && sCount === 0
      ? '알겠습니다, 저장'
      : sCount > 0
        ? '별도 신규 고객사로 등록'
        : '그래도 등록';

  return (
    <div
      className="add-contact-pregate-overlay"
      onClick={() => !saving && onClose?.()}
      role="dialog"
      aria-modal="true"
      aria-label="저장 전 중복·유사 확인"
    >
      <div className="add-contact-pregate-panel" onClick={(e) => e.stopPropagation()}>
        <h3 className="add-contact-pregate-title">저장 전 확인</h3>
        {cCount > 0 && (
          <>
            <p className="add-contact-pregate-sub">이름 또는 전화가 같은 기존 연락처가 있습니다.</p>
            <ul className="add-contact-pregate-list">
              {cands.map((c) => {
                const mr =
                  c.matchReason === 'phone' ? '전화' : c.matchReason === 'both' ? '이름+전화' : '이름';
                const co =
                  c.customerCompanyId && typeof c.customerCompanyId === 'object' ? c.customerCompanyId.name : '';
                return (
                  <li key={String(c._id)} className="add-contact-pregate-li">
                    <span className="add-contact-pregate-name">{c.name || '—'}</span>
                    <span className="add-contact-pregate-meta">
                      {c.phone || '—'} · {mr} 일치{co ? ` · ${co}` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {sCount > 0 && (
          <>
            <p className="add-contact-pregate-sub">
              입력하신 상호와 비슷한 고객사가 이미 있습니다. 같은 법인이면 아래에서 해당 고객사 소속으로 저장하세요. 별도
              법인이면 &quot;{confirmLabel}&quot;을 선택하세요.
            </p>
            <ul className="add-contact-pregate-list add-contact-pregate-list--co">
              {sims.map((c) => (
                <li key={String(c._id)} className="add-contact-pregate-li add-contact-pregate-li--co-block">
                  <span className="add-contact-pregate-name">{c.name || '—'}</span>
                  <button
                    type="button"
                    className="add-contact-pregate-co-peek"
                    disabled={saving || !onOpenCompanyDetail}
                    onClick={() => {
                      if (!c?._id || !onOpenCompanyDetail) return;
                      onOpenCompanyDetail(c);
                    }}
                  >
                    <span className="add-contact-pregate-co-peek-line">
                      {truncateAddress(c.address)}
                    </span>
                    <span className="add-contact-pregate-co-peek-line add-contact-pregate-co-peek-bn">
                      사업자 {formatBusinessNumberDisplay(c.businessNumber)}
                    </span>
                    {onOpenCompanyDetail ? (
                      <span className="add-contact-pregate-co-peek-hint">탭하여 고객사 상세 보기</span>
                    ) : null}
                  </button>
                  {onLinkExistingCompany ? (
                    <button
                      type="button"
                      className="add-contact-pregate-co-link"
                      disabled={saving}
                      onClick={() => onLinkExistingCompany(c)}
                    >
                      이 고객사 소속으로 저장
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="add-contact-pregate-actions">
          <button type="button" className="add-contact-modal-cancel" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button
            type="button"
            className="add-contact-modal-save"
            disabled={saving}
            onClick={() => {
              onConfirmForce({
                forceCreateDespiteContactDuplicate: !isEditMode && cCount > 0,
                forceCreateNewCustomerCompany: sCount > 0
              });
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(ContactSavePregateModal);
