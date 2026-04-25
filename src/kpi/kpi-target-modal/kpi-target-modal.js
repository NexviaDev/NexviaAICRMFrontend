import { useState } from 'react';
import './kpi-target-modal.css';
import ProjectTitleEntryModal from './project-title-entry-modal';

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

const MONTH_COLUMNS = Array.from({ length: 12 }, (_, idx) => ({ month: idx + 1, label: `${idx + 1}월` }));

function parseMoney(value) {
  const n = Number(revenueDigitsOnly(value));
  return Number.isFinite(n) ? n : 0;
}

function parseCount(value) {
  const n = Math.floor(Number(String(value ?? '').replace(/\D/g, '')));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function sumRange(arr, startIdx, endIdx) {
  let sum = 0;
  for (let i = startIdx; i <= endIdx; i += 1) {
    sum += Number(arr?.[i] || 0);
  }
  return sum;
}

function quarterValues(monthly) {
  return [sumRange(monthly, 0, 2), sumRange(monthly, 3, 5), sumRange(monthly, 6, 8), sumRange(monthly, 9, 11)];
}

function halfValues(monthly) {
  return [sumRange(monthly, 0, 5), sumRange(monthly, 6, 11)];
}

function yearlyValue(monthly) {
  return sumRange(monthly, 0, 11);
}

function isNumericEditingKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return true;
  const key = String(event.key || '');
  if (/^\d$/.test(key)) return true;
  return ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Home', 'End'].includes(key);
}

export default function KpiTargetModal({
  scopeType,
  onScopeTypeChange,
  year,
  onYearChange,
  monthlyRevenue = [],
  monthlyProjects = [],
  monthlyProjectTitles = [],
  monthlyProjectTitleDrafts = [],
  monthlyProjectParticipantDrafts = [],
  onMonthlyRevenueChange,
  onMonthlyProjectTitleDraftChange,
  onMonthlyProjectParticipantDraftChange,
  onAddMonthlyProjectTitle,
  canSelectTeamProjectParticipants = false,
  teamProjectParticipantOptions = [],
  teamMonthlyRevenue = [],
  teamMonthlyProjects = [],
  departmentId,
  onDepartmentChange = () => {},
  userId,
  onUserChange = () => {},
  departmentOptions = [],
  userOptions = [],
  scopeNotice = '',
  loading = false,
  saving,
  message,
  canSubmit = true,
  onSubmit,
  onClose
}) {
  const editable = scopeType === 'user';
  const monthlyRevenueNumbers = MONTH_COLUMNS.map((item) => parseMoney(monthlyRevenue[item.month - 1]));
  const monthlyProjectNumbers = MONTH_COLUMNS.map((item) => {
    const titles = Array.isArray(monthlyProjectTitles[item.month - 1]) ? monthlyProjectTitles[item.month - 1] : [];
    if (titles.length > 0) return titles.length;
    return parseCount(monthlyProjects[item.month - 1]);
  });
  const monthlyTeamRevenueNumbers = MONTH_COLUMNS.map((item) => Number(teamMonthlyRevenue[item.month - 1] || 0));
  const monthlyTeamProjectNumbers = MONTH_COLUMNS.map((item) => Number(teamMonthlyProjects[item.month - 1] || 0));
  const revenueQuarter = quarterValues(monthlyRevenueNumbers);
  const projectQuarter = quarterValues(monthlyProjectNumbers);
  const revenueHalf = halfValues(monthlyRevenueNumbers);
  const projectHalf = halfValues(monthlyProjectNumbers);
  const teamRevenueQuarter = quarterValues(monthlyTeamRevenueNumbers);
  const teamProjectQuarter = quarterValues(monthlyTeamProjectNumbers);
  const teamRevenueHalf = halfValues(monthlyTeamRevenueNumbers);
  const teamProjectHalf = halfValues(monthlyTeamProjectNumbers);
  const revenueYear = yearlyValue(monthlyRevenueNumbers);
  const projectYear = yearlyValue(monthlyProjectNumbers);
  const teamRevenueYear = yearlyValue(monthlyTeamRevenueNumbers);
  const teamProjectYear = yearlyValue(monthlyTeamProjectNumbers);

  const handleMonthlyRevenueInput = (month, value) => {
    onMonthlyRevenueChange(month, revenueDigitsOnly(value));
  };
  const [projectTitleModalMonth, setProjectTitleModalMonth] = useState(null);
  const openedMonth = Number(projectTitleModalMonth) || 0;
  const openedMonthLabel = openedMonth > 0 ? `${openedMonth}월` : '';

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
          <div className="kpi-target-modal-header-copy">
            <div className="kpi-target-modal-header-title-row">
              <h2 id="kpi-target-modal-title" className="kpi-target-modal-title">
                {year}년 KPI 목표 설정
              </h2>
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
            </div>
          </div>
          <div className="kpi-target-modal-header-actions">
            <div className="kpi-target-modal-year-select">
              <input
                id="kpi-target-year"
                type="number"
                min="2000"
                max="9999"
                className="kpi-target-modal-input"
                value={year}
                onChange={(e) => onYearChange(e.target.value)}
                disabled={loading}
                aria-label="기준 연도"
              />
              <span className="material-symbols-outlined kpi-target-modal-input-suffix-icon" aria-hidden>
                calendar_today
              </span>
            </div>
            <button type="button" className="kpi-target-modal-close" onClick={onClose} aria-label="목표 설정 모달 닫기">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        <form className="kpi-target-modal-form-wrap" onSubmit={onSubmit}>
          <div className={`kpi-target-modal-body custom-scrollbar ${loading ? 'is-loading' : ''}`}>
            {loading ? (
              <p className="kpi-target-modal-loading-banner" role="status">
                목표 정보를 불러오는 중…
              </p>
            ) : null}

            <div className="kpi-target-modal-section">
              <label className="kpi-target-modal-field-label">대상 선택</label>
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
                          {item.readOnly ? `${item.label} (조회 전용)` : item.label}
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
              {scopeNotice ? <p className="kpi-target-modal-message">{scopeNotice}</p> : null}
            </div>

            <div className="kpi-target-modal-section">
              <label className="kpi-target-modal-field-label">개인별 월간 목표 테이블</label>
              <div className="kpi-target-monthly-table-wrap">
                <table className="kpi-target-monthly-table">
                  <thead>
                    <tr>
                      <th>구분</th>
                      {MONTH_COLUMNS.map((item) => (
                        <th key={`month-head-${item.month}`}>{item.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th>매출 목표(원)</th>
                      {MONTH_COLUMNS.map((item) => (
                        <td key={`revenue-${item.month}`}>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9,]*"
                            value={formatRevenueDisplay(monthlyRevenue[item.month - 1])}
                            onChange={(e) => handleMonthlyRevenueInput(item.month, e.target.value)}
                            onKeyDown={(e) => {
                              if (!isNumericEditingKey(e)) e.preventDefault();
                            }}
                            disabled={!editable || loading}
                            aria-label={`${item.label} 매출 목표`}
                          />
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th>프로젝트 목표(개)</th>
                      {MONTH_COLUMNS.map((item) => (
                        <td key={`projects-${item.month}`}>
                          <button
                            type="button"
                            className="kpi-target-project-count-button"
                            onClick={() => setProjectTitleModalMonth(item.month)}
                            disabled={loading}
                            aria-label={`${item.label} 프로젝트 목표 상세 열기`}
                          >
                            {Number(monthlyProjectNumbers[item.month - 1] || 0).toLocaleString('ko-KR')}개
                          </button>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="kpi-target-modal-section">
              <label className="kpi-target-modal-field-label">기간 합계</label>
              <div className="kpi-target-summary-table-wrap">
                <table className="kpi-target-summary-table">
                  <thead>
                    <tr>
                      <th>합계 구분</th>
                      <th>1분기</th>
                      <th>2분기</th>
                      <th>3분기</th>
                      <th>4분기</th>
                      <th>상반기</th>
                      <th>하반기</th>
                      <th>연간 합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th>개인 매출 목표</th>
                      <td>{Number(revenueQuarter[0] || 0).toLocaleString('ko-KR')}원</td>
                      <td>{Number(revenueQuarter[1] || 0).toLocaleString('ko-KR')}원</td>
                      <td>{Number(revenueQuarter[2] || 0).toLocaleString('ko-KR')}원</td>
                      <td>{Number(revenueQuarter[3] || 0).toLocaleString('ko-KR')}원</td>
                      <td>{Number(revenueHalf[0] || 0).toLocaleString('ko-KR')}원</td>
                      <td>{Number(revenueHalf[1] || 0).toLocaleString('ko-KR')}원</td>
                      <td className="is-annual">{Number(revenueYear || 0).toLocaleString('ko-KR')}원</td>
                    </tr>
                    <tr>
                      <th>개인 프로젝트 목표</th>
                      <td>{Number(projectQuarter[0] || 0).toLocaleString('ko-KR')}개</td>
                      <td>{Number(projectQuarter[1] || 0).toLocaleString('ko-KR')}개</td>
                      <td>{Number(projectQuarter[2] || 0).toLocaleString('ko-KR')}개</td>
                      <td>{Number(projectQuarter[3] || 0).toLocaleString('ko-KR')}개</td>
                      <td>{Number(projectHalf[0] || 0).toLocaleString('ko-KR')}개</td>
                      <td>{Number(projectHalf[1] || 0).toLocaleString('ko-KR')}개</td>
                      <td className="is-annual">{Number(projectYear || 0).toLocaleString('ko-KR')}개</td>
                    </tr>
                    <tr>
                      <th>팀 누적 매출 목표</th>
                      <td>{Number(teamRevenueQuarter[0] || 0).toLocaleString('ko-KR')}원</td>
                      <td>{Number(teamRevenueQuarter[1] || 0).toLocaleString('ko-KR')}원</td>
                      <td>{Number(teamRevenueQuarter[2] || 0).toLocaleString('ko-KR')}원</td>
                      <td>{Number(teamRevenueQuarter[3] || 0).toLocaleString('ko-KR')}원</td>
                      <td>{Number(teamRevenueHalf[0] || 0).toLocaleString('ko-KR')}원</td>
                      <td>{Number(teamRevenueHalf[1] || 0).toLocaleString('ko-KR')}원</td>
                      <td className="is-annual">{Number(teamRevenueYear || 0).toLocaleString('ko-KR')}원</td>
                    </tr>
                    <tr>
                      <th>팀 누적 프로젝트 목표</th>
                      <td>{Number(teamProjectQuarter[0] || 0).toLocaleString('ko-KR')}개</td>
                      <td>{Number(teamProjectQuarter[1] || 0).toLocaleString('ko-KR')}개</td>
                      <td>{Number(teamProjectQuarter[2] || 0).toLocaleString('ko-KR')}개</td>
                      <td>{Number(teamProjectQuarter[3] || 0).toLocaleString('ko-KR')}개</td>
                      <td>{Number(teamProjectHalf[0] || 0).toLocaleString('ko-KR')}개</td>
                      <td>{Number(teamProjectHalf[1] || 0).toLocaleString('ko-KR')}개</td>
                      <td className="is-annual">{Number(teamProjectYear || 0).toLocaleString('ko-KR')}개</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>


            {message ? <p className="kpi-target-modal-message">{message}</p> : null}
          </div>

          <div className="kpi-target-modal-footer">
            <button type="button" className="kpi-target-modal-cancel" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="kpi-target-modal-submit" disabled={saving || loading || !editable || !canSubmit}>
              <span>{saving ? '저장 중...' : '개인별 월간 목표 저장'}</span>
            </button>
          </div>
        </form>
      </div>
      {openedMonth > 0 ? (
        <ProjectTitleEntryModal
          month={openedMonth}
          monthLabel={openedMonthLabel}
          projectTitles={monthlyProjectTitles[openedMonth - 1] || []}
          projectTitleDraft={monthlyProjectTitleDrafts[openedMonth - 1] || ''}
          participantDraftIds={monthlyProjectParticipantDrafts[openedMonth - 1] || []}
          canSelectParticipants={scopeType === 'team' && canSelectTeamProjectParticipants}
          participantOptions={teamProjectParticipantOptions}
          editable={editable}
          loading={loading}
          onDraftChange={(value) => onMonthlyProjectTitleDraftChange(openedMonth, value)}
          onParticipantDraftChange={(nextIds) => onMonthlyProjectParticipantDraftChange(openedMonth, nextIds)}
          onAdd={() => onAddMonthlyProjectTitle(openedMonth)}
          onClose={() => setProjectTitleModalMonth(null)}
        />
      ) : null}
    </div>
  );
}
