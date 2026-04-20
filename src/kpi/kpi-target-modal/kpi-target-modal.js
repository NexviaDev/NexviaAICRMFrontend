import './kpi-target-modal.css';

/** 목표액: 숫자만 유지(부모 state는 숫자 문자열) */
function revenueDigitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function formatRevenueDisplay(digitsStr) {
  const d = revenueDigitsOnly(digitsStr);
  if (!d) return '';
  const n = Number(d);
  if (!Number.isFinite(n)) return d;
  return n.toLocaleString('ko-KR');
}

const PERIOD_LABELS = {
  annual: '연도별',
  semiannual: '반기별',
  quarterly: '분기별',
  monthly: '월별'
};

/** Sample Design 순서: 연도 → 반기 → 분기 → 월 */
const PERIOD_TAB_ORDER = ['annual', 'semiannual', 'quarterly', 'monthly'];

export default function KpiTargetModal({
  scopeType,
  onScopeTypeChange,
  periodType,
  onPeriodTypeChange,
  periodValue,
  onPeriodValueChange,
  periodValueOptions = [],
  year,
  onYearChange,
  targetRevenue,
  onTargetRevenueChange,
  targetProjects,
  onTargetProjectsChange,
  targetNote,
  onTargetNoteChange,
  departmentId,
  onDepartmentChange = () => {},
  userId,
  onUserChange = () => {},
  departmentOptions = [],
  userOptions = [],
  loading = false,
  saving,
  message,
  onSubmit,
  onClose
}) {
  const handleTargetRevenueInput = (e) => {
    onTargetRevenueChange(revenueDigitsOnly(e.target.value));
  };

  const showScopeSelect =
    (scopeType === 'team' && departmentOptions.length > 1) ||
    (scopeType === 'user' && userOptions.length > 1);

  return (
    <div className="kpi-target-modal-overlay" role="presentation">
      <div className="kpi-target-modal-backdrop-decor" aria-hidden />
      <div
        className="kpi-target-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kpi-target-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="kpi-target-modal-header">
          <div>
            <h2 id="kpi-target-modal-title" className="kpi-target-modal-title">
              KPI 목표 설정
            </h2>
            <p className="kpi-target-modal-subtitle">Strategy Lab · Growth Planning</p>
          </div>
          <button type="button" className="kpi-target-modal-close" onClick={onClose} aria-label="목표 설정 모달 닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form className="kpi-target-modal-form-wrap" onSubmit={onSubmit}>
          <div className={`kpi-target-modal-body custom-scrollbar ${loading ? 'is-loading' : ''}`}>
            {loading ? (
              <p className="kpi-target-modal-loading-banner" role="status">
                목표 정보를 불러오는 중…
              </p>
            ) : null}

            <div className="kpi-target-modal-section">
              <label className="kpi-target-modal-field-label">저장 범위</label>
              <div className="kpi-target-modal-segment" role="tablist" aria-label="저장 범위">
                <button
                  type="button"
                  className={scopeType === 'team' ? 'is-active' : ''}
                  onClick={() => onScopeTypeChange('team')}
                >
                  팀별
                </button>
                <button
                  type="button"
                  className={scopeType === 'user' ? 'is-active' : ''}
                  onClick={() => onScopeTypeChange('user')}
                >
                  개인별
                </button>
              </div>
              {showScopeSelect ? (
                <div className="kpi-target-modal-scope-select-wrap">
                  {scopeType === 'team' ? (
                    <select
                      className="kpi-target-modal-input kpi-target-modal-input--select"
                      value={departmentId}
                      onChange={(e) => onDepartmentChange(e.target.value)}
                      aria-label="부서 선택"
                    >
                      {departmentOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      className="kpi-target-modal-input kpi-target-modal-input--select"
                      value={userId}
                      onChange={(e) => onUserChange(e.target.value)}
                      aria-label="직원 선택"
                    >
                      {userOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ) : null}
            </div>

            <div className="kpi-target-modal-section">
              <label className="kpi-target-modal-field-label">목표 구분</label>
              <div className="kpi-target-modal-segment kpi-target-modal-segment--period" role="tablist" aria-label="목표 기간 유형">
                {PERIOD_TAB_ORDER.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={periodType === key ? 'is-active' : ''}
                    onClick={() => onPeriodTypeChange(key)}
                  >
                    {PERIOD_LABELS[key]}
                  </button>
                ))}
              </div>
            </div>

            <div className="kpi-target-modal-section">
              <div className="kpi-target-modal-subperiod-head">
                <label className="kpi-target-modal-field-label kpi-target-modal-field-label--inline">세부 기간 선택</label>
                <span className="kpi-target-modal-active-chip">선택 기간</span>
              </div>
              {periodValueOptions.length > 0 ? (
                <div className="kpi-target-modal-period-pills" role="group" aria-label="세부 기간">
                  {periodValueOptions.map((item) => (
                    <button
                      key={`${periodType}-${item.value}`}
                      type="button"
                      className={String(periodValue) === String(item.value) ? 'is-active' : ''}
                      onClick={() => onPeriodValueChange(String(item.value))}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="kpi-target-modal-subperiod-fallback" role="status">
                  세부 기간 항목을 불러오는 중이거나 표시할 수 없습니다.
                </p>
              )}
            </div>

            <div className="kpi-target-modal-grid-2">
              <div className="kpi-target-modal-field">
                <label className="kpi-target-modal-field-label" htmlFor="kpi-target-year">
                  기준 연도
                </label>
                <div className="kpi-target-modal-input-icon-wrap">
                  <input
                    id="kpi-target-year"
                    type="number"
                    min="2000"
                    max="9999"
                    className="kpi-target-modal-input"
                    value={year}
                    onChange={(e) => onYearChange(e.target.value)}
                    disabled={loading}
                  />
                  <span className="material-symbols-outlined kpi-target-modal-input-suffix-icon" aria-hidden>
                    calendar_today
                  </span>
                </div>
              </div>
              <div className="kpi-target-modal-field">
                <span className="kpi-target-modal-field-label">통화 단위</span>
                <div className="kpi-target-modal-currency-box" aria-readOnly>
                  <span className="kpi-target-modal-currency-flag" aria-hidden>
                    🇰🇷
                  </span>
                  <span>KRW (대한민국 원)</span>
                </div>
              </div>

              <div className="kpi-target-modal-field kpi-target-modal-field--full">
                <label className="kpi-target-modal-field-label" htmlFor="kpi-target-revenue">
                  매출 목표액
                </label>
                <div className="kpi-target-modal-revenue-field">
                  <input
                    id="kpi-target-revenue"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    className="kpi-target-modal-revenue-input"
                    value={formatRevenueDisplay(targetRevenue)}
                    onChange={handleTargetRevenueInput}
                    placeholder="0"
                    aria-label="매출 목표액 (원)"
                    disabled={loading}
                  />
                  <span className="kpi-target-modal-revenue-suffix" aria-hidden>
                    원
                  </span>
                </div>
              </div>

              <div className="kpi-target-modal-field kpi-target-modal-field--full">
                <label className="kpi-target-modal-field-label" htmlFor="kpi-target-projects">
                  목표 프로젝트 수
                </label>
                <div className="kpi-target-modal-input-icon-wrap">
                  <input
                    id="kpi-target-projects"
                    type="number"
                    min="0"
                    className="kpi-target-modal-input"
                    value={targetProjects}
                    onChange={(e) => onTargetProjectsChange(e.target.value)}
                    placeholder="12"
                    disabled={loading}
                  />
                  <span className="material-symbols-outlined kpi-target-modal-input-suffix-icon kpi-target-modal-input-suffix-icon--primary" aria-hidden>
                    assignment
                  </span>
                </div>
              </div>

              <div className="kpi-target-modal-field kpi-target-modal-field--full">
                <label className="kpi-target-modal-field-label" htmlFor="kpi-target-note">
                  전략적 메모
                </label>
                <textarea
                  id="kpi-target-note"
                  rows={3}
                  className="kpi-target-modal-textarea"
                  value={targetNote}
                  onChange={(e) => onTargetNoteChange(e.target.value)}
                  placeholder="이번 분기 핵심 성장 동력 및 리스크 관리 계획을 입력하세요..."
                  disabled={loading}
                />
              </div>
            </div>

            {message ? <p className="kpi-target-modal-message">{message}</p> : null}
          </div>

          <div className="kpi-target-modal-footer">
            <button type="button" className="kpi-target-modal-cancel" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="kpi-target-modal-submit" disabled={saving || loading}>
              <span>{saving ? '저장 중...' : '목표 저장'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
