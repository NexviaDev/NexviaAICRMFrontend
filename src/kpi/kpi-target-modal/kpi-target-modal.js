import './kpi-target-modal.css';

const PERIOD_LABELS = {
  monthly: '월별',
  quarterly: '분기별',
  semiannual: '반기별',
  annual: '연도별'
};

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
  saving,
  message,
  onSubmit,
  onClose
}) {
  return (
    <div className="kpi-target-modal-overlay" role="presentation">
      <div
        className="kpi-target-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kpi-target-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="kpi-target-modal-header">
          <div>
            <p className="kpi-target-modal-eyebrow">목표 설정</p>
            <h3 id="kpi-target-modal-title">범위별 KPI 목표 저장</h3>
            <p className="kpi-target-modal-desc">팀별 또는 개인별 목표를 기간 단위로 저장합니다.</p>
          </div>
          <button type="button" className="kpi-target-modal-close" onClick={onClose} aria-label="목표 설정 모달 닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form className="kpi-target-modal-form" onSubmit={onSubmit}>
          <div className="kpi-target-modal-switch-row">
            <div className="kpi-target-modal-scope-switch" role="tablist" aria-label="목표 범위">
              <button type="button" className={scopeType === 'team' ? 'is-active' : ''} onClick={() => onScopeTypeChange('team')}>
                팀별
              </button>
              <button type="button" className={scopeType === 'user' ? 'is-active' : ''} onClick={() => onScopeTypeChange('user')}>
                개인별
              </button>
            </div>

            <div className="kpi-target-modal-period-switch" role="tablist" aria-label="목표 기간">
              {Object.entries(PERIOD_LABELS).map(([key, label]) => (
                <button key={key} type="button" className={periodType === key ? 'is-active' : ''} onClick={() => onPeriodTypeChange(key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="kpi-target-modal-grid">
            <label>
              <span>연도</span>
              <input type="number" min="2000" max="9999" value={year} onChange={(e) => onYearChange(e.target.value)} />
            </label>
            <label>
              <span>세부 기간</span>
              <select value={periodValue} onChange={(e) => onPeriodValueChange(e.target.value)}>
                {periodValueOptions.map((item) => (
                  <option key={`${periodType}-${item.value}`} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="kpi-target-modal-grid">
            <label>
              <span>목표액</span>
              <input type="number" min="0" value={targetRevenue} onChange={(e) => onTargetRevenueChange(e.target.value)} placeholder="목표 매출액" />
            </label>
            <label>
              <span>목표 프로젝트 수</span>
              <input type="number" min="0" value={targetProjects} onChange={(e) => onTargetProjectsChange(e.target.value)} placeholder="목표 프로젝트 수" />
            </label>
          </div>

          <label>
            <span>메모</span>
            <textarea rows="4" value={targetNote} onChange={(e) => onTargetNoteChange(e.target.value)} placeholder="목표 관련 메모" />
          </label>

          {message ? <p className="kpi-target-modal-message">{message}</p> : null}

          <div className="kpi-target-modal-actions">
            <button type="button" className="kpi-target-modal-cancel" onClick={onClose}>닫기</button>
            <button type="submit" className="kpi-target-modal-submit" disabled={saving}>
              {saving ? '저장 중...' : '목표 저장'}
            </button>수수
          </div>
        </form>
      </div>
    </div>
  );
}
