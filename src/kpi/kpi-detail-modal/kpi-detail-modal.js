import './kpi-detail-modal.css';

/** 액수 입력: 숫자만 추출 */
function amountDigitsOnly(raw) {
  return String(raw ?? '').replace(/\D/g, '');
}

/** 숫자 문자열 → 천 단위 콤마 표시(입력란 표시용) */
function formatAmountInputDisplay(digitStr) {
  const d = amountDigitsOnly(digitStr);
  if (!d) return '';
  try {
    return BigInt(d).toLocaleString('ko-KR');
  } catch {
    return d.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
}

function isDealLikeItem(item) {
  const k = String(item?.key || '');
  return k.startsWith('opportunity:') || k.startsWith('deal:') || k.startsWith('work:');
}

function isOpportunityOrDeal(item) {
  const k = String(item?.key || '');
  return k.startsWith('opportunity:') || k.startsWith('deal:');
}

function filterLegacyDetailLines(lines) {
  return (Array.isArray(lines) ? lines : []).filter((line) => {
    const s = String(line || '');
    if (/^customerCompanyId\s/i.test(s)) return false;
    if (/^customerCompanyEmployeeId\s/i.test(s)) return false;
    if (/^드라이브\s/i.test(s)) return false;
    if (/^https:\/\/drive\.google\.com/i.test(s)) return false;
    return true;
  });
}

function companyHeadline(display) {
  const d = String(display || '').trim();
  if (!d || d === '고객사 미연결') return '미연결';
  return d;
}

/** 수주 건: 총액 — deal 키는 summaryText, opportunity 키는 currentDisplay(금액) */
function totalAmountDisplay(item) {
  const k = String(item?.key || '');
  if (k.startsWith('deal:')) return String(item?.summaryText || '').trim() || '—';
  if (k.startsWith('opportunity:')) return String(item?.currentDisplay || '').trim() || '—';
  return String(item?.currentDisplay || '').trim() || '—';
}

function showWonStyleBadge(title) {
  return /수주\s*(매출|성공)|수주\s*매출·성공/.test(String(title || ''));
}

function isOtherPerformanceItem(item) {
  return item?.kind === 'otherPerformance' || String(item?.key || '').startsWith('other:');
}

export default function KpiDetailModal({
  periodLabel,
  title = 'KPI 상세',
  description = '차트에 보이는 핵심 지표를 표 형식으로 더 자세히 확인합니다.',
  items = [],
  loading = false,
  saving = false,
  message = '',
  onScoreChange,
  onSave,
  onClose,
  variant = 'default',
  otherForm = null,
  onOtherFormChange,
  onOpenParticipantPicker,
  onSubmitOtherPerformance,
  onDeleteOtherEntry,
  otherSubmitting = false
}) {
  const mgmtRef = String(periodLabel || 'KPI')
    .replace(/\s+/g, '-')
    .replace(/[^0-9a-zA-Z가-힣·.-]/g, '')
    .slice(0, 32);
  const showBadge = showWonStyleBadge(title);
  const isOtherVariant = variant === 'otherPerformance';
  const of = otherForm || { title: '', amount: '', startDate: '', endDate: '', participants: [] };
  const setOf = (patch) => {
    if (typeof onOtherFormChange !== 'function') return;
    onOtherFormChange((prev) => ({ ...(prev || {}), ...patch }));
  };

  return (
    <div className="kpi-detail-modal-overlay" role="presentation">
      <div
        className="kpi-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kpi-detail-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="kpi-detail-modal-header">
          <div className="kpi-detail-modal-header-title">
            <span className="kpi-detail-modal-title-bar" aria-hidden />
            <h1 id="kpi-detail-modal-title" className="kpi-detail-modal-title-text">{title}</h1>
          </div>
          <button type="button" className="kpi-detail-modal-close" onClick={onClose} aria-label="상세 모달 닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="kpi-detail-modal-scroll">
          <div className="kpi-detail-summary-band">
            <div className="kpi-detail-summary-band-main">
              <p className="kpi-detail-summary-eyebrow">Contract overview</p>
              <h2 className="kpi-detail-summary-headline">{periodLabel}</h2>
              <p className="kpi-detail-summary-desc">{description}</p>
            </div>
            <div className="kpi-detail-summary-band-aside">
              {showBadge ? (
                <span className="kpi-detail-badge-won">
                  <span className="material-symbols-outlined kpi-detail-badge-won-icon">check_circle</span>
                  수주 완료
                </span>
              ) : (
                <span className="kpi-detail-badge-neutral">KPI 리스트</span>
              )}
              <p className="kpi-detail-mgmt-line">관리번호: #{mgmtRef || 'NEXVIA-KPI'}</p>
            </div>
          </div>

          <div className="kpi-detail-card-list">
            {items.map((item) => {
              if (isOtherVariant && isOtherPerformanceItem(item)) {
                const names = (item.otherParticipants || []).map((p) => p.name).filter(Boolean).join(', ') || item.assigneeDisplay || '—';
                const periodTxt = item.contactDisplay || item.completedDateDisplay || '—';
                return (
                  <article key={item.key} className="kpi-detail-other-card">
                    <div className="kpi-detail-other-card-head">
                      <h3 className="kpi-detail-other-title">{item.label}</h3>
                      <button
                        type="button"
                        className="kpi-detail-other-delete"
                        onClick={() => onDeleteOtherEntry?.(item.key)}
                        aria-label="항목 삭제"
                      >
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    </div>
                    <p className="kpi-detail-other-amount">{item.currentDisplay}</p>
                    <dl className="kpi-detail-other-dl">
                      <div><dt>참여자</dt><dd>{names}</dd></div>
                      <div><dt>기간</dt><dd>{periodTxt}</dd></div>
                    </dl>
                    {item.detailLines?.length ? (
                      <div className="kpi-detail-other-note">
                        {item.detailLines.map((line, idx) => (
                          <p key={`${item.key}-ln-${idx}`}>{line}</p>
                        ))}
                      </div>
                    ) : null}
                    <label className="kpi-detail-lucid-score kpi-detail-other-score">
                      <span>체크리스트 점수</span>
                      <input
                        type="number"
                        min="0"
                        value={item.score}
                        onChange={(e) => onScoreChange?.(item.key, e.target.value)}
                      />
                    </label>
                  </article>
                );
              }
              const dealLike = isDealLikeItem(item);
              const plainLines = filterLegacyDetailLines(item.detailLines || []);
              const oppOrDeal = isOpportunityOrDeal(item);
              const showProductGrid = oppOrDeal && (item.productName || item.quantity > 0 || item.unitPriceLabel);
              const companyName = companyHeadline(item.customerCompanyDisplay);
              const subLine = item.businessNumberDisplay
                ? { icon: 'numbers', text: `사업자등록번호 ${item.businessNumberDisplay}` }
                : (item.label && companyName !== item.label ? { icon: 'sell', text: item.label } : null);

              return (
                <article key={item.key} className="kpi-detail-lucid-card">
                  <div className="kpi-detail-lucid-card-pad">
                    {dealLike ? (
                      <>
                        <div className="kpi-detail-lucid-card-top">
                          <div className="kpi-detail-lucid-card-entity">
                            <h3 className="kpi-detail-lucid-company">{companyName}</h3>
                            {subLine ? (
                              <p className="kpi-detail-lucid-meta-line">
                                <span className="material-symbols-outlined kpi-detail-lucid-meta-ic" aria-hidden>
                                  {subLine.icon}
                                </span>
                                {subLine.text}
                              </p>
                            ) : null}
                          </div>
                          <div className="kpi-detail-lucid-card-date">
                            <p className="kpi-detail-lucid-date-label">{item.dateLabelTitle || '거래 일자'}</p>
                            <p className="kpi-detail-lucid-date-value">{item.completedDateDisplay || '—'}</p>
                          </div>
                        </div>

                        {dealLike && !showProductGrid && String(item.key || '').startsWith('work:') ? (
                          <p className="kpi-detail-lucid-work-body">{item.label}</p>
                        ) : null}

                        {showProductGrid ? (
                          <div className="kpi-detail-lucid-grid">
                            <div className="kpi-detail-lucid-cell">
                              <span className="kpi-detail-lucid-cell-label">제품명</span>
                              <span className="kpi-detail-lucid-cell-value">{item.productName || '—'}</span>
                            </div>
                            <div className="kpi-detail-lucid-cell">
                              <span className="kpi-detail-lucid-cell-label">수량</span>
                              <span className="kpi-detail-lucid-cell-value">
                                {item.quantity > 0 ? `${item.quantity}개` : '—'}
                              </span>
                            </div>
                            <div className="kpi-detail-lucid-cell">
                              <span className="kpi-detail-lucid-cell-label">단가</span>
                              <span className="kpi-detail-lucid-cell-value">{item.unitPriceLabel || '—'}</span>
                            </div>
                            <div className="kpi-detail-lucid-cell kpi-detail-lucid-cell--total">
                              <span className="kpi-detail-lucid-cell-label">총 합계</span>
                              <span className="kpi-detail-lucid-cell-total">{totalAmountDisplay(item)}</span>
                            </div>
                          </div>
                        ) : null}

                        {(item.assigneeDisplay && item.assigneeDisplay !== '-') ||
                        (item.contactDisplay && item.contactDisplay !== '-') ||
                        item.contactPhone ||
                        item.contactEmail ? (
                          <div className="kpi-detail-lucid-extra">
                            {item.assigneeDisplay && item.assigneeDisplay !== '-' ? (
                              <span>담당 {item.assigneeDisplay}</span>
                            ) : null}
                            {item.contactDisplay && item.contactDisplay !== '-' ? (
                              <span>연락처·대상 {item.contactDisplay}</span>
                            ) : null}
                            {item.contactPhone ? <span>{item.contactPhone}</span> : null}
                            {item.contactEmail ? <span>{item.contactEmail}</span> : null}
                          </div>
                        ) : null}

                        <div className="kpi-detail-lucid-card-foot">
                          <small className="kpi-detail-lucid-gap">{item.gapDisplay}</small>
                          <div className="kpi-detail-lucid-controls">
                            <label className="kpi-detail-lucid-score">
                              <span>점수</span>
                              <input
                                type="number"
                                min="0"
                                value={item.score}
                                onChange={(e) => onScoreChange?.(item.key, e.target.value)}
                              />
                            </label>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="kpi-detail-lucid-card-top kpi-detail-lucid-card-top--simple">
                          <div>
                            <h3 className="kpi-detail-lucid-company">{item.label}</h3>
                            <p className="kpi-detail-lucid-meta-line">이전 {item.previousDisplay}</p>
                          </div>
                          <div className="kpi-detail-lucid-card-date">
                            <p className="kpi-detail-lucid-date-label">현재</p>
                            <p className="kpi-detail-lucid-date-value">{item.currentDisplay}</p>
                          </div>
                        </div>
                        {plainLines.length > 0 ? (
                          <div className="kpi-detail-lucid-plain">
                            {plainLines.map((line, idx) => (
                              <p key={`${item.key}-pl-${idx}`}>{line}</p>
                            ))}
                          </div>
                        ) : (
                          <div className="kpi-detail-lucid-plain">
                            <p>고객사 {companyHeadline(item.customerCompanyDisplay)}</p>
                            {item.assigneeDisplay ? <p>담당 {item.assigneeDisplay}</p> : null}
                            {item.contactDisplay ? <p>연락처/대상 {item.contactDisplay}</p> : null}
                          </div>
                        )}
                        <div className="kpi-detail-lucid-card-foot">
                          <small className="kpi-detail-lucid-gap">{item.gapDisplay}</small>
                          <div className="kpi-detail-lucid-controls">
                            <label className="kpi-detail-lucid-score">
                              <span>점수</span>
                              <input
                                type="number"
                                min="0"
                                value={item.score}
                                onChange={(e) => onScoreChange?.(item.key, e.target.value)}
                              />
                            </label>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
            {loading ? <p className="kpi-detail-empty-cell">체크리스트를 불러오는 중입니다.</p> : null}
            {!loading && items.length === 0 && !isOtherVariant ? (
              <p className="kpi-detail-empty-cell">표시할 KPI 리스트가 없습니다.</p>
            ) : null}
            {!loading && items.length === 0 && isOtherVariant ? (
              <p className="kpi-detail-empty-cell kpi-detail-empty-cell--muted">등록된 기타 성과가 없습니다. 아래에서 추가할 수 있습니다.</p>
            ) : null}

            {isOtherVariant ? (
              <div className="kpi-detail-other-compose">
                <h4 className="kpi-detail-other-compose-title">기타 성과 추가</h4>
                <label className="kpi-detail-other-field">
                  <span>내용</span>
                  <input
                    type="text"
                    value={of.title}
                    onChange={(e) => setOf({ title: e.target.value })}
                    placeholder="성과 내용을 입력하세요"
                    maxLength={200}
                  />
                </label>
                <div className="kpi-detail-other-row2">
                  <label className="kpi-detail-other-field">
                    <span>시작일</span>
                    <input
                      type="date"
                      value={of.startDate}
                      onChange={(e) => setOf({ startDate: e.target.value })}
                    />
                  </label>
                  <label className="kpi-detail-other-field">
                    <span>종료일</span>
                    <input
                      type="date"
                      value={of.endDate}
                      onChange={(e) => setOf({ endDate: e.target.value })}
                    />
                  </label>
                </div>
                <label className="kpi-detail-other-field">
                  <span>액수 (원)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={formatAmountInputDisplay(of.amount)}
                    onChange={(e) => {
                      const next = amountDigitsOnly(e.target.value);
                      setOf({ amount: next });
                    }}
                    placeholder="0"
                    maxLength={18}
                  />
                </label>
                <div className="kpi-detail-other-participants">
                  <span className="kpi-detail-other-part-label">참여자</span>
                  <div className="kpi-detail-other-chips">
                    {(of.participants || []).map((p) => (
                      <span key={String(p.userId)} className="kpi-detail-other-chip">{p.name || p.userId}</span>
                    ))}
                  </div>
                  <button type="button" className="kpi-detail-other-pick-btn" onClick={() => onOpenParticipantPicker?.()}>
                    <span className="material-symbols-outlined">group_add</span>
                    참여자 선택
                  </button>
                </div>
                <button
                  type="button"
                  className="kpi-detail-other-submit"
                  onClick={() => onSubmitOtherPerformance?.()}
                  disabled={otherSubmitting || loading}
                >
                  {otherSubmitting ? '등록 중…' : '기타 성과 등록'}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {message ? <p className="kpi-detail-modal-message">{message}</p> : null}

        <footer className="kpi-detail-modal-footer">
          <div className="kpi-detail-modal-footer-note">
            <span className="material-symbols-outlined kpi-detail-footer-info-icon">info</span>
            <p>
              {isOtherVariant
                ? '기타 성과는 회사 테넌트 DB에 저장되며, 참여자로 등록된 동료와 공유됩니다.'
                : '본 상세 내역은 확정된 수주 데이터를 바탕으로 생성되었습니다.'}
            </p>
          </div>
          <div className="kpi-detail-modal-footer-actions">
            <button type="button" className="kpi-detail-btn-ghost" onClick={onClose}>
              닫기
            </button>
            <button type="button" className="kpi-detail-btn-primary" onClick={onSave} disabled={saving || loading}>
              {saving ? '확인 중...' : '확인'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
