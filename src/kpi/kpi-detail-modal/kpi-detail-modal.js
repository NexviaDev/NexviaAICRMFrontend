import './kpi-detail-modal.css';
import { useCallback, useMemo, useState } from 'react';
import KpiDetailNestedModal from './kpi-detail-nested-modal';

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
  return k.startsWith('opportunity:') || k.startsWith('deal:') || k.startsWith('work:') || k.startsWith('project:');
}

function isProjectKey(item) {
  return String(item?.key || '').startsWith('project:');
}

/** KPI용 자동 추가 행 — 점수·참여자 목록에서 제외 */
const PROJECT_CREATOR_LABEL = '프로젝트 생성자';

function isProjectCreatorParticipantRow(p) {
  return String(p?.name || '').trim() === PROJECT_CREATOR_LABEL;
}

/** 점수 부여·참여자 표시용(생성자 가상 행 제외) */
function participantsForProjectScoring(list) {
  return (Array.isArray(list) ? list : []).filter((p) => !isProjectCreatorParticipantRow(p));
}

/** 클릭으로 고른 값만 1~5로 고정 */
function clampProjectScore15(n) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return 1;
  if (x < 1) return 1;
  if (x > 5) return 5;
  return x;
}

/** 저장된 행: 0=미선택, 1~5 유효, 레거시 큰 값은 5로 */
function normalizeStoredParticipantScore(s) {
  const x = Math.round(Number(s));
  if (!Number.isFinite(x) || x <= 0) return 0;
  if (x > 5) return 5;
  return x;
}

/** 표시용: 저장값이 1~5 밖이면 가장 가까운 단계로 보정(레거시 대비) */
function displayProjectScore15(n) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x) || x < 1) return null;
  if (x > 5) return 5;
  return x;
}

/** 1~5만 유효, 그 외·0 은 null */
function safeLikertFromNumber(n) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x) || x < 1 || x > 5) return null;
  return x;
}

const PROJECT_SCORE_LIKERT = [
  { value: 1, label: '매우 못함' },
  { value: 2, label: '못함' },
  { value: 3, label: '보통' },
  { value: 4, label: '잘함' },
  { value: 5, label: '매우 잘함' }
];

function projectParticipantCountForUi(item) {
  const list = participantsForProjectScoring(item?.projectParticipants);
  return Math.max(1, Number(item?.projectParticipantCount) || list.length || 1);
}

/** 개인별 대시보드에서 특정 직원만 선택 시: 해당 직원만 목록·점수에 노출 */
function projectParticipantsInStaffScope(item, staffFilterUserId) {
  const all = participantsForProjectScoring(item?.projectParticipants);
  const fid = String(staffFilterUserId || '').trim();
  if (!fid) return all;
  return all.filter((p) => String(p.userId) === fid);
}

function patchParticipantScoreKeepingOthers(item, userId, newScore) {
  const scoredParts = participantsForProjectScoring(item.projectParticipants);
  const uid = String(userId);
  const nextScore = clampProjectScore15(newScore);
  const byUid = new Map();
  if (item.participantScores && item.participantScores.length) {
    for (const x of item.participantScores) {
      const id = String(x.userId);
      if (!scoredParts.some((p) => String(p.userId) === id)) continue;
      byUid.set(id, { userId: id, score: normalizeStoredParticipantScore(x.score) });
    }
  }
  for (const p of scoredParts) {
    const id = String(p.userId);
    if (!byUid.has(id)) byUid.set(id, { userId: id, score: 0 });
  }
  const next = scoredParts.map((p) => {
    const id = String(p.userId);
    const row = byUid.get(id) || { userId: id, score: 0 };
    return id === uid ? { ...row, score: nextScore } : row;
  });
  const total = next.reduce((s, r) => s + (Number(r.score) || 0), 0);
  return {
    projectScoreMode: 'individual',
    projectUniformUnit: 0,
    participantScores: next,
    score: total
  };
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

function isCurrentUserDepartmentLeader(userId, departmentLeaderList) {
  const uid = String(userId || '').trim();
  if (!uid) return false;
  const list = Array.isArray(departmentLeaderList) ? departmentLeaderList : [];
  return list.some((row) => String(row?.userId || '').trim() === uid);
}

function kpiDetailLucidListTitle(item) {
  if (isProjectKey(item)) return String(item.label || '').trim() || '프로젝트';
  if (isDealLikeItem(item)) {
    const c = companyHeadline(item.customerCompanyDisplay);
    if (c && c !== '미연결') return c;
  }
  return String(item.label || '').trim() || '항목';
}

function kpiDetailLucidListMeta(item) {
  if (isProjectKey(item)) {
    const bits = [];
    if (item.progress != null) bits.push(`${Math.max(0, Number(item.progress) || 0)}%`);
    const n = participantsForProjectScoring(item.projectParticipants).length;
    if (n) bits.push(`참여 ${n}`);
    return bits.join(' · ');
  }
  return (
    String(item.completedDateDisplay || '').trim()
    || String(item.currentDisplay || '').trim()
    || ''
  );
}

function KpiDetailOtherPerfCard({ item, staffFilterUserId, onScoreChange, onDeleteOtherEntry }) {
  const opFid = String(staffFilterUserId || '').trim();
  const opAll = Array.isArray(item.otherParticipants) ? item.otherParticipants : [];
  const opShown = opFid ? opAll.filter((p) => String(p.userId) === opFid) : opAll;
  const names = opShown.map((p) => p.name).filter(Boolean).join(', ') || (opFid ? '—' : (item.assigneeDisplay || '—'));
  const periodTxt = item.contactDisplay || item.completedDateDisplay || '—';
  return (
    <article className="kpi-detail-other-card">
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

function rollupPointsForParticipant(item, userId) {
  const uid = String(userId || '');
  const row = (Array.isArray(item.participantScoresRollup) ? item.participantScoresRollup : []).find(
    (x) => String(x.userId) === uid
  );
  if (!row) return null;
  return Math.max(0, Math.floor(Number(row.score) || 0));
}

function KpiDetailLucidCard({
  item,
  staffFilterUserId,
  canViewSensitiveTotals,
  onScoreChange,
  onChecklistItemPatch
}) {
  const dealLike = isDealLikeItem(item);
  const plainLines = filterLegacyDetailLines(item.detailLines || []);
  const oppOrDeal = isOpportunityOrDeal(item);
  const showProductGrid = oppOrDeal && (item.productName || item.quantity > 0 || item.unitPriceLabel);
  const companyName = companyHeadline(item.customerCompanyDisplay);
  const isProjCard = isProjectKey(item);
  const staffFid = String(staffFilterUserId || '').trim();
  const isStaffFilteredProject = Boolean(staffFid) && isProjCard;
  const allProjParts = isProjCard && Array.isArray(item.projectParticipants) ? item.projectParticipants : [];
  const allForScore = isProjCard ? participantsForProjectScoring(allProjParts) : [];
  const projParts = isStaffFilteredProject ? projectParticipantsInStaffScope(item, staffFid) : allForScore;
  const subLine = isProjCard
    ? null
    : (item.businessNumberDisplay
      ? { icon: 'numbers', text: `사업자등록번호 ${item.businessNumberDisplay}` }
      : (item.label && companyName !== item.label ? { icon: 'sell', text: item.label } : null));

  const showPeerRollup = isProjCard
    && Array.isArray(item.participantScoresRollup)
    && item.participantScoresRollup.length > 0;

  return (
    <article className="kpi-detail-lucid-card">
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

          {dealLike && !showProductGrid && isProjectKey(item) ? (
            <p className="kpi-detail-lucid-work-body">
              {item.label}
              {item.progress != null ? ` · 진행률 ${Math.max(0, Number(item.progress) || 0)}%` : ''}
            </p>
          ) : null}

          {isProjCard && projParts.length > 0 ? (
            <div className="kpi-detail-lucid-project-roster" aria-label="프로젝트 참여자">
              <p className="kpi-detail-lucid-project-roster-label">{isStaffFilteredProject ? '선택 직원' : '참여자'}</p>
              <ul className="kpi-detail-lucid-project-roster-list">
                {projParts.map((p) => {
                  const nm = String(p.name || '').trim() || '사용자';
                  const ms = String(p.mission || '').trim();
                  return (
                    <li key={`${item.key}-rost-${p.userId}`}>
                      {ms ? `${nm} — ${ms}` : nm}
                    </li>
                  );
                })}
              </ul>
            </div>
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
                <span className="kpi-detail-lucid-cell-total">
                  {canViewSensitiveTotals ? totalAmountDisplay(item) : '—'}
                </span>
              </div>
            </div>
          ) : null}
          {showProductGrid && !canViewSensitiveTotals ? (
            <p className="kpi-detail-lucid-total-guard" role="note">
              «사내 현황»에 등록된 부서장만 총 합계 금액을 조회할 수 있습니다.
            </p>
          ) : null}

          {!isStaffFilteredProject &&
          ((item.assigneeDisplay && item.assigneeDisplay !== '-') ||
          (item.contactDisplay && item.contactDisplay !== '-') ||
          item.contactPhone ||
          item.contactEmail) ? (
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
            <div className="kpi-detail-lucid-controls kpi-detail-lucid-controls--stack">
              {isProjCard &&
              typeof onChecklistItemPatch === 'function' &&
              (!isStaffFilteredProject || projParts.length >= 1) ? (
                <>
                  <div className="kpi-detail-lucid-project-score-block">
                    {!isStaffFilteredProject && allForScore.length >= 2 ? (
                    <label className="kpi-detail-lucid-inline-check">
                      <input
                        type="checkbox"
                        checked={item.projectScoreMode === 'uniform_each'}
                        onChange={(e) => {
                          const n = Math.max(1, allForScore.length);
                          const checked = e.target.checked;
                          if (checked) {
                            let rawUnit = Math.floor(Number(item.projectUniformUnit) || 0);
                            let unit = rawUnit ? clampProjectScore15(rawUnit) : 0;
                            if (!unit && item.projectScoreMode === 'individual' && Array.isArray(item.participantScores)) {
                              const arr = item.participantScores
                                .map((x) => safeLikertFromNumber(x.score))
                                .filter((v) => v != null);
                              const sum = arr.reduce((a, b) => a + b, 0);
                              unit = arr.length ? clampProjectScore15(Math.round(sum / arr.length)) : 0;
                            }
                            if (!unit) {
                              const avg = n > 0 ? Math.round(Math.max(0, Number(item.score) || 0) / n) : 0;
                              unit = avg ? clampProjectScore15(avg) : 3;
                            }
                            onChecklistItemPatch(item.key, {
                              projectScoreMode: 'uniform_each',
                              projectUniformUnit: unit,
                              participantScores: [],
                              score: unit * n
                            });
                          } else {
                            let rawU = Math.floor(Number(item.projectUniformUnit) || 0);
                            let unit = rawU ? clampProjectScore15(rawU) : 0;
                            if (!unit && n > 0) {
                              const avg = Math.round(Math.max(0, Number(item.score) || 0) / n);
                              unit = avg ? clampProjectScore15(avg) : 0;
                            }
                            if (!unit) unit = 3;
                            const scores = allForScore.map((p) => {
                              const hit = (item.participantScores || []).find(
                                (x) => String(x.userId) === String(p.userId)
                              );
                              return {
                                userId: String(p.userId),
                                score: hit != null ? clampProjectScore15(hit.score) : unit
                              };
                            });
                            const total = scores.reduce((s, r) => s + r.score, 0);
                            onChecklistItemPatch(item.key, {
                              projectScoreMode: 'individual',
                              projectUniformUnit: 0,
                              participantScores: scores,
                              score: total
                            });
                          }
                        }}
                      />
                      <span>참여자에게 동일 점수 부여</span>
                    </label>
                    ) : !isStaffFilteredProject && allForScore.length < 2 ? (
                      <p className="kpi-detail-lucid-project-score-solo-hint">
                        {allForScore.length === 0
                          ? '등록된 참여자가 없어 프로젝트 단위(1~5)로만 평가합니다.'
                          : '참여자 1명: 아래에서 1~5점으로 평가합니다.'}
                      </p>
                    ) : isStaffFilteredProject ? (
                      <p className="kpi-detail-lucid-project-score-solo-hint">
                        선택 직원만 표시합니다. «전체 직원»으로 바꾸면 모든 참여자의 점수를 함께 편집할 수 있습니다.
                      </p>
                    ) : null}
                    <p className="kpi-detail-lucid-project-score-hint">
                      {isStaffFilteredProject
                        ? (item.projectScoreMode === 'individual'
                          ? '이 직원 행만 수정합니다. 다른 참여자 점수는 유지되며, 저장 시 프로젝트 합계에 반영됩니다.'
                          : '프로젝트 전체에 대한 체크리스트 점수입니다.')
                        : (item.projectScoreMode === 'uniform_each'
                          ? '합계 = (1인당 1~5점 × 참여자 수)입니다.'
                          : item.projectScoreMode === 'individual'
                            ? (showPeerRollup
                              ? '개별 평가: 사내 직원이 참여자·임무를 보고 각자 1~5점을 부여합니다. 아래는 내가 입력한 점수이며, «사내 누적»은 동료가 부여한 점수까지 합산한 값입니다.'
                              : '합계 = 참여자별 1~5점의 합입니다.')
                            : '프로젝트당 1~5점 한 번만 합산됩니다. 동일 부여 시 인원수만큼 곱합니다.')}
                    </p>
                  </div>
                  {allForScore.length >= 1 && item.projectScoreMode === 'individual' ? (
                    <ul className="kpi-detail-lucid-participant-scores">
                      {(isStaffFilteredProject ? projParts : allForScore).map((p) => {
                        const row = (item.participantScores || []).find(
                          (x) => String(x.userId) === String(p.userId)
                        ) || { userId: p.userId, score: 0 };
                        const picked = displayProjectScore15(row.score);
                        const peerRoll = rollupPointsForParticipant(item, p.userId);
                        return (
                          <li key={`${item.key}-ps-${p.userId}`} className="kpi-detail-lucid-participant-score-row">
                            <div className="kpi-detail-lucid-participant-score-head">
                              <span className="kpi-detail-lucid-participant-name">
                                {p.name || '사용자'}
                                {String(p.mission || '').trim() ? ` · ${String(p.mission).trim()}` : ''}
                              </span>
                              {showPeerRollup && peerRoll != null ? (
                                <span className="kpi-detail-lucid-participant-rollup">사내 누적 {peerRoll}점</span>
                              ) : null}
                            </div>
                            <div
                              className="kpi-detail-project-likert"
                              role="radiogroup"
                              aria-label={`${p.name || '참여자'} 평가`}
                            >
                              {PROJECT_SCORE_LIKERT.map(({ value: lv, label: lb }) => (
                                <button
                                  key={lv}
                                  type="button"
                                  role="radio"
                                  aria-checked={picked === lv}
                                  className={`kpi-detail-project-likert-btn ${picked === lv ? 'is-selected' : ''}`}
                                  onClick={() => {
                                    onChecklistItemPatch(
                                      item.key,
                                      patchParticipantScoreKeepingOthers(item, p.userId, lv)
                                    );
                                  }}
                                >
                                  <span className="kpi-detail-project-likert-num">{lv}</span>
                                  <span className="kpi-detail-project-likert-text">{lb}</span>
                                </button>
                              ))}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="kpi-detail-project-flat-likert-wrap">
                      <span className="kpi-detail-project-flat-likert-label">
                        {item.projectScoreMode === 'flat'
                          ? '프로젝트 통합 평가 (1~5)'
                          : '참여자 1인당 평가 (1~5)'}
                      </span>
                      <div
                        className="kpi-detail-project-likert kpi-detail-project-likert--compact"
                        role="radiogroup"
                        aria-label={item.projectScoreMode === 'flat' ? '프로젝트 통합 평가' : '참여자당 동일 평가'}
                      >
                        {(() => {
                          const pickedFlat = item.projectScoreMode === 'flat'
                            ? displayProjectScore15(item.score)
                            : displayProjectScore15(item.projectUniformUnit);
                          const nUniform = Math.max(1, allForScore.length || 1);
                          return PROJECT_SCORE_LIKERT.map(({ value: lv, label: lb }) => (
                            <button
                              key={lv}
                              type="button"
                              role="radio"
                              aria-checked={pickedFlat === lv}
                              className={`kpi-detail-project-likert-btn ${pickedFlat === lv ? 'is-selected' : ''}`}
                              onClick={() => {
                                if (item.projectScoreMode === 'flat') {
                                  onChecklistItemPatch(item.key, {
                                    projectScoreMode: 'flat',
                                    projectUniformUnit: 0,
                                    participantScores: [],
                                    score: lv
                                  });
                                } else {
                                  onChecklistItemPatch(item.key, {
                                    projectScoreMode: 'uniform_each',
                                    projectUniformUnit: lv,
                                    participantScores: [],
                                    score: lv * nUniform
                                  });
                                }
                              }}
                            >
                              <span className="kpi-detail-project-likert-num">{lv}</span>
                              <span className="kpi-detail-project-likert-text">{lb}</span>
                            </button>
                          ));
                        })()}
                      </div>
                    </div>
                  )}
                  <p className="kpi-detail-lucid-project-total-note" aria-live="polite">
                    {isStaffFilteredProject && item.projectScoreMode === 'individual' && projParts.length === 1 ? (
                      <>
                        선택 직원 반영:{' '}
                        <strong>
                          {clampProjectScore15(
                            Number(
                              (item.participantScores || []).find(
                                (x) => String(x.userId) === String(projParts[0]?.userId)
                              )?.score
                            ) || 0
                          )}
                        </strong>
                        점 · 내 합계{' '}
                        <strong>{Math.max(0, Math.floor(Number(item.score) || 0))}</strong>점
                        {showPeerRollup && item.projectRollupScore != null ? (
                          <> · 전 직원 누적 <strong>{Math.max(0, Math.floor(Number(item.projectRollupScore) || 0))}</strong>점</>
                        ) : null}
                      </>
                    ) : (
                      <>
                        내가 부여한 합계: <strong>{Math.max(0, Math.floor(Number(item.score) || 0))}</strong>점
                        {showPeerRollup && item.projectRollupScore != null ? (
                          <> · 전 직원 누적 <strong>{Math.max(0, Math.floor(Number(item.projectRollupScore) || 0))}</strong>점</>
                        ) : null}
                      </>
                    )}
                  </p>
                </>
              ) : (
                <label className="kpi-detail-lucid-score">
                  <span>점수</span>
                  <input
                    type="number"
                    min="0"
                    value={item.score}
                    onChange={(e) => onScoreChange?.(item.key, e.target.value)}
                  />
                </label>
              )}
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
  onChecklistItemPatch,
  onSave,
  onClose,
  variant = 'default',
  otherForm = null,
  onOtherFormChange,
  onOpenParticipantPicker,
  onSubmitOtherPerformance,
  onDeleteOtherEntry,
  otherSubmitting = false,
  /** 개인별 + 특정 직원 선택 시에만 전달. 전체 직원이면 비움 → 참여자·직원별 점수 전체 UI */
  staffFilterUserId = null,
  departmentLeaderList = [],
  currentUserId = ''
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
  const canViewSensitiveTotals = useMemo(
    () => isCurrentUserDepartmentLeader(currentUserId, departmentLeaderList),
    [currentUserId, departmentLeaderList]
  );

  const { projectChecklistItems, restChecklistItems, otherPerfChecklistItems } = useMemo(() => {
    const projects = [];
    const rest = [];
    const op = [];
    for (const it of items) {
      if (isOtherVariant && isOtherPerformanceItem(it)) {
        op.push(it);
        continue;
      }
      if (isProjectKey(it)) projects.push(it);
      else rest.push(it);
    }
    return {
      projectChecklistItems: projects,
      restChecklistItems: rest,
      otherPerfChecklistItems: op
    };
  }, [items, isOtherVariant]);

  const [nestedDetail, setNestedDetail] = useState(null);
  const nestedSurfaceItem = useMemo(() => {
    if (!nestedDetail) return null;
    const k = nestedDetail.item?.key;
    if (k == null) return nestedDetail.item;
    return items.find((it) => it.key === k) || nestedDetail.item;
  }, [items, nestedDetail]);

  const nestedTitle = useMemo(() => {
    if (!nestedDetail || !nestedSurfaceItem) return '';
    if (nestedDetail.type === 'other') {
      return String(nestedSurfaceItem.label || '').trim() || '기타 성과';
    }
    return kpiDetailLucidListTitle(nestedSurfaceItem);
  }, [nestedDetail, nestedSurfaceItem]);

  /** 중첩 «확인»: 점수(체크리스트) 저장 성공 시 항목 상세만 닫고 부모 KPI 상세는 유지 */
  const handleNestedSaveAndClose = useCallback(async () => {
    if (typeof onSave !== 'function') return;
    const ok = await Promise.resolve(onSave());
    if (ok === true) setNestedDetail(null);
  }, [onSave]);

  return (
    <div className={`kpi-detail-modal-overlay${saving ? ' is-saving' : ''}`} role="presentation">
      <div
        className={`kpi-detail-modal${saving ? ' is-saving' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kpi-detail-modal-title"
        aria-busy={saving}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="kpi-detail-modal-header">
          <div className="kpi-detail-modal-header-title">
            <span className="kpi-detail-modal-title-bar" aria-hidden />
            <h1 id="kpi-detail-modal-title" className="kpi-detail-modal-title-text">{title}</h1>
          </div>
          <button
            type="button"
            className="kpi-detail-modal-close"
            onClick={onClose}
            disabled={saving}
            aria-label="상세 모달 닫기"
          >
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
            {otherPerfChecklistItems.length > 0 ? (
              <section className="kpi-detail-section kpi-detail-section--list" aria-label="기타 성과">
                <div className="kpi-detail-section-heading">
                  <span className="material-symbols-outlined kpi-detail-section-heading-ic" aria-hidden>
                    stars
                  </span>
                  <span className="kpi-detail-section-heading-title">기타 성과</span>
                  <span className="kpi-detail-section-heading-count">{otherPerfChecklistItems.length}</span>
                </div>
                <ul className="kpi-detail-item-picker">
                  {otherPerfChecklistItems.map((item) => (
                    <li key={item.key}>
                      <button
                        type="button"
                        className="kpi-detail-item-picker-row"
                        onClick={() => setNestedDetail({ type: 'other', item })}
                      >
                        <span className="kpi-detail-item-picker-title">
                          {String(item.label || '').trim() || '기타 성과'}
                        </span>
                        <span className="kpi-detail-item-picker-meta">
                          {String(item.currentDisplay || '').trim() || '—'}
                        </span>
                        <span className="material-symbols-outlined kpi-detail-item-picker-go" aria-hidden>
                          chevron_right
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {projectChecklistItems.length > 0 ? (
              <section className="kpi-detail-section kpi-detail-section--list" aria-label="프로젝트 목록">
                <div className="kpi-detail-section-heading">
                  <span className="material-symbols-outlined kpi-detail-section-heading-ic" aria-hidden>
                    folder_special
                  </span>
                  <span className="kpi-detail-section-heading-title">프로젝트</span>
                  <span className="kpi-detail-section-heading-count">{projectChecklistItems.length}</span>
                </div>
                <ul className="kpi-detail-item-picker">
                  {projectChecklistItems.map((item) => (
                    <li key={item.key}>
                      <button
                        type="button"
                        className="kpi-detail-item-picker-row"
                        onClick={() => setNestedDetail({ type: 'lucid', item })}
                      >
                        <span className="kpi-detail-item-picker-title">{kpiDetailLucidListTitle(item)}</span>
                        <span className="kpi-detail-item-picker-meta">
                          {kpiDetailLucidListMeta(item) || '—'}
                        </span>
                        <span className="material-symbols-outlined kpi-detail-item-picker-go" aria-hidden>
                          chevron_right
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {restChecklistItems.length > 0 ? (
              <section className="kpi-detail-section kpi-detail-section--list" aria-label="수주 업무 기타">
                <div className="kpi-detail-section-heading">
                  <span className="material-symbols-outlined kpi-detail-section-heading-ic" aria-hidden>
                    contract
                  </span>
                  <span className="kpi-detail-section-heading-title">수주 · 업무 · 기타</span>
                  <span className="kpi-detail-section-heading-count">{restChecklistItems.length}</span>
                </div>
                <ul className="kpi-detail-item-picker">
                  {restChecklistItems.map((item) => (
                    <li key={item.key}>
                      <button
                        type="button"
                        className="kpi-detail-item-picker-row"
                        onClick={() => setNestedDetail({ type: 'lucid', item })}
                      >
                        <span className="kpi-detail-item-picker-title">{kpiDetailLucidListTitle(item)}</span>
                        <span className="kpi-detail-item-picker-meta">
                          {kpiDetailLucidListMeta(item) || '—'}
                        </span>
                        <span className="material-symbols-outlined kpi-detail-item-picker-go" aria-hidden>
                          chevron_right
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

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
            <button type="button" className="kpi-detail-btn-ghost" onClick={onClose} disabled={saving}>
              닫기
            </button>
            <button type="button" className="kpi-detail-btn-primary" onClick={onSave} disabled={saving || loading}>
              {saving ? '저장 중…' : '확인'}
            </button>
          </div>
        </footer>
      </div>
      {nestedDetail && nestedSurfaceItem ? (
        <KpiDetailNestedModal
          title={nestedTitle}
          isOtherType={nestedDetail.type === 'other'}
          onClose={() => setNestedDetail(null)}
          onSave={handleNestedSaveAndClose}
          saving={saving}
          loading={loading}
        >
          {nestedDetail.type === 'other' ? (
            <KpiDetailOtherPerfCard
              item={nestedSurfaceItem}
              staffFilterUserId={staffFilterUserId}
              onScoreChange={onScoreChange}
              onDeleteOtherEntry={(key) => {
                onDeleteOtherEntry?.(key);
                setNestedDetail(null);
              }}
            />
          ) : (
            <KpiDetailLucidCard
              item={nestedSurfaceItem}
              staffFilterUserId={staffFilterUserId}
              canViewSensitiveTotals={canViewSensitiveTotals}
              onScoreChange={onScoreChange}
              onChecklistItemPatch={onChecklistItemPatch}
            />
          )}
        </KpiDetailNestedModal>
      ) : null}
    </div>
  );
}
