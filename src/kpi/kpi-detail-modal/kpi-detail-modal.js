import './kpi-detail-modal.css';

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
  return /수주\s*(매출|성공)/.test(String(title || ''));
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
  onClose
}) {
  const mgmtRef = String(periodLabel || 'KPI')
    .replace(/\s+/g, '-')
    .replace(/[^0-9a-zA-Z가-힣·.-]/g, '')
    .slice(0, 32);
  const showBadge = showWonStyleBadge(title);

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
            {!loading && items.length === 0 ? (
              <p className="kpi-detail-empty-cell">표시할 KPI 리스트가 없습니다.</p>
            ) : null}
          </div>
        </div>

        {message ? <p className="kpi-detail-modal-message">{message}</p> : null}

        <footer className="kpi-detail-modal-footer">
          <div className="kpi-detail-modal-footer-note">
            <span className="material-symbols-outlined kpi-detail-footer-info-icon">info</span>
            <p>본 상세 내역은 확정된 수주 데이터를 바탕으로 생성되었습니다.</p>
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
