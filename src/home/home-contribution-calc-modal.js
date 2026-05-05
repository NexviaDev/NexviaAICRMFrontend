import { useEffect } from 'react';
import './home-contribution-calc-modal.css';

function formatRevenueFull(value) {
  const v = Math.round(Number(value) || 0);
  return `₩${v.toLocaleString('ko-KR')}`;
}

export function HomeContributionCalcModal({ spec, targetBar, shareBar, periodLabel, onClose }) {
  useEffect(() => {
    if (!spec) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spec, onClose]);

  if (!spec) return null;

  const onBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const titleMain =
    spec.kind === 'target' ? '목표 대비 달성 막대 — 계산 방식' : '순마진 비중 막대 — 계산 방식';

  let body = null;
  if (spec.kind === 'target' && Array.isArray(targetBar?.segments) && targetBar.segments.length > 0) {
    const segments = targetBar.segments;
    const totalTarget = segments.reduce((sum, seg) => sum + Math.max(0, Number(seg?.targetRevenue || 0)), 0);
    const totalAmount = segments.reduce((sum, seg) => sum + Math.max(0, Number(seg?.amount || 0)), 0);
    const totalAchievement = totalTarget > 0 ? Number(((totalAmount / totalTarget) * 100).toFixed(1)) : null;
    const r = totalTarget > 0 ? totalAmount / totalTarget : null;
    const met = r == null ? 1 : Math.min(r, 1);
    const over = r == null ? 0 : Math.max(0, r - 1);
    const gap = r == null ? 0 : Math.max(0, 1 - met);
    const vsTargetBar = totalTarget > 0;
    const totalTargetPool = segments.reduce((sum, s) => sum + Math.max(0, Number(s?.targetRevenue || 0)), 0);
    const totalAmountForBar = segments.reduce((sum, s) => sum + Math.max(0, Number(s?.amount || 0)), 0);
    const poolLabel =
      spec.mode === 'team' ? '전체 목표액(Σ) 대비 순마진 비중' : '팀 목표액(Σ) 대비 순마진 비중';
    const scopeLabel = spec.mode === 'team' ? '전사 팀' : '선택 팀 내 구성원';

    body = (
      <>
        <p className="home-contribution-calc-lead">
          아래 표는 화면의 막대와 동일한 숫자를 기준으로 합니다. 팀별 달성률은 각 팀의{' '}
          <strong>순마진 ÷ 해당 팀 목표액</strong>으로, 막대 안 색 너비는 <strong>순마진 ÷ 순마진 합계</strong>로 나눕니다.
          막대 전체 길이는 <strong>Σ 목표액을 100%</strong>로 두고, 실적 구간·초과·미달 구간을 나눕니다.
        </p>

        <h4 className="home-calc-section-title">1. 합산 요약</h4>
        <div className="home-calc-table-wrap">
          <table className="home-calc-table">
            <thead>
              <tr>
                <th scope="col">항목</th>
                <th scope="col">값</th>
                <th scope="col">산식·설명</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Σ 목표액</td>
                <td>{formatRevenueFull(totalTarget)}</td>
                <td className="home-calc-table-formula">각 {scopeLabel}의 목표액을 모두 더한 값</td>
              </tr>
              <tr>
                <td>Σ 순마진</td>
                <td>{formatRevenueFull(totalAmount)}</td>
                <td className="home-calc-table-formula">각 {scopeLabel}의 순마진을 모두 더한 값</td>
              </tr>
              <tr>
                <td>전체 달성률</td>
                <td>{totalAchievement == null ? '—' : `${totalAchievement}%`}</td>
                <td className="home-calc-table-formula">
                  {totalTarget > 0
                    ? `ROUND( (Σ 순마진) ÷ (Σ 목표액) × 100, 1 ) = ROUND( ${totalAmount} ÷ ${totalTarget} × 100, 1 )`
                    : 'Σ 목표액이 0이면 계산하지 않습니다.'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4 className="home-calc-section-title">2. 막대 축척 (Σ 목표 = 100% 기준)</h4>
        <div className="home-calc-table-wrap">
          <table className="home-calc-table">
            <thead>
              <tr>
                <th scope="col">구간</th>
                <th scope="col">비율 (flex-grow)</th>
                <th scope="col">설명</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>실적(색 막대)</td>
                <td>{vsTargetBar ? met.toFixed(4) : '1'}</td>
                <td className="home-calc-table-formula">
                  {vsTargetBar
                    ? `min( Σ순마진÷Σ목표, 1 ) = min( ${totalAmount}÷${totalTarget}, 1 )`
                    : '목표가 없으면 막대 전체에 실적만 표시합니다.'}
                </td>
              </tr>
              <tr>
                <td>초과 구간(주황)</td>
                <td>{vsTargetBar && over > 0 ? over.toFixed(4) : '0'}</td>
                <td className="home-calc-table-formula">max( 0, Σ순마진÷Σ목표 − 1 ) — 목표를 넘긴 만큼</td>
              </tr>
              <tr>
                <td>미달 구간(회색)</td>
                <td>{vsTargetBar && gap > 0 ? gap.toFixed(4) : '0'}</td>
                <td className="home-calc-table-formula">max( 0, 1 − min(Σ순마진÷Σ목표, 1) ) — 목표 대비 부족분</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4 className="home-calc-section-title">3. {scopeLabel}별 상세</h4>
        <div className="home-calc-table-wrap home-calc-table-wrap--scroll">
          <table className="home-calc-table">
            <thead>
              <tr>
                <th scope="col">이름</th>
                <th scope="col">순마진</th>
                <th scope="col">목표액</th>
                <th scope="col">목표 대비 달성률</th>
                <th scope="col">{poolLabel}</th>
                <th scope="col">막대 내 실적 비중</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((seg) => {
                const amt = Math.max(0, Number(seg?.amount || 0));
                const tgt = Math.max(0, Number(seg?.targetRevenue || 0));
                const widthPct =
                  totalAmountForBar > 0 ? (amt / totalAmountForBar) * 100 : Math.max(0, Number(seg?.pct || 0));
                const vsPoolPct =
                  totalTargetPool > 0 ? Number(((amt / totalTargetPool) * 100).toFixed(1)) : null;
                const ach = tgt > 0 ? Number(((amt / tgt) * 100).toFixed(1)) : null;
                return (
                  <tr key={`calc-${seg.id}`}>
                    <td>{seg.label}</td>
                    <td>{formatRevenueFull(amt)}</td>
                    <td>{formatRevenueFull(tgt)}</td>
                    <td>{ach == null ? '—' : `${ach}%`}</td>
                    <td>{vsPoolPct == null ? '—' : `${vsPoolPct}%`}</td>
                    <td>{Number(widthPct).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h4 className="home-calc-section-title">4. 열 계산식 (행 공통)</h4>
        <div className="home-calc-table-wrap">
          <table className="home-calc-table">
            <thead>
              <tr>
                <th scope="col">열</th>
                <th scope="col">식</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>목표 대비 달성률</td>
                <td className="home-calc-table-formula">목표액 &gt; 0 일 때 ROUND( 순마진 ÷ 목표액 × 100, 1 ), 아니면 표시 없음</td>
              </tr>
              <tr>
                <td>{poolLabel}</td>
                <td className="home-calc-table-formula">Σ 목표액 &gt; 0 일 때 ROUND( 순마진 ÷ Σ 목표액 × 100, 1 )</td>
              </tr>
              <tr>
                <td>막대 내 실적 비중</td>
                <td className="home-calc-table-formula">Σ 순마진 &gt; 0 일 때 ROUND( 순마진 ÷ Σ 순마진 × 100, 1 ), 아니면 표시용 pct</td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    );
  } else if (spec.kind === 'share' && Array.isArray(shareBar?.segments) && shareBar.segments.length > 0) {
    const segments = shareBar.segments;
    const totalAmount = segments.reduce((sum, seg) => sum + Math.max(0, Number(seg?.amount || 0)), 0);
    body = (
      <>
        <p className="home-contribution-calc-lead">
          순마진 비중 막대는 <strong>각 구간 순마진 ÷ 순마진 합계 × 100</strong>으로 너비를 나눕니다. 화면의{' '}
          <strong>표시 비중(%)</strong>는 대시보드 집계·백엔드에서 내려준 값이며, 아래 &quot;계산 비중&quot;과 비교할 수 있습니다.
        </p>
        <h4 className="home-calc-section-title">1. 합산</h4>
        <div className="home-calc-table-wrap">
          <table className="home-calc-table">
            <thead>
              <tr>
                <th scope="col">항목</th>
                <th scope="col">값</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Σ 순마진</td>
                <td>{formatRevenueFull(totalAmount)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <h4 className="home-calc-section-title">2. 구간별</h4>
        <div className="home-calc-table-wrap home-calc-table-wrap--scroll">
          <table className="home-calc-table">
            <thead>
              <tr>
                <th scope="col">이름</th>
                <th scope="col">순마진</th>
                <th scope="col">표시 비중 (%)</th>
                <th scope="col">계산 비중 (%)</th>
                <th scope="col">계산식</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((seg) => {
                const amt = Math.max(0, Number(seg?.amount || 0));
                const calcPct = totalAmount > 0 ? Number(((amt / totalAmount) * 100).toFixed(2)) : 0;
                const dispPct = Number(seg?.pct);
                return (
                  <tr key={`share-calc-${seg.id}`}>
                    <td>{seg.label}</td>
                    <td>{formatRevenueFull(amt)}</td>
                    <td>{Number.isFinite(dispPct) ? `${dispPct}%` : '—'}</td>
                    <td>{totalAmount > 0 ? `${calcPct}%` : '—'}</td>
                    <td className="home-calc-table-formula">
                      {totalAmount > 0
                        ? `ROUND( ${amt} ÷ ${totalAmount} × 100, 2 )`
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  } else {
    body = <p className="home-contribution-calc-empty">표시할 데이터가 없습니다.</p>;
  }

  return (
    <div
      className="home-contribution-calc-modal-overlay"
      role="presentation"
      onClick={onBackdrop}
    >
      <div
        className="home-contribution-calc-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-contribution-calc-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="home-contribution-calc-modal-head">
          <h2 id="home-contribution-calc-title" className="home-contribution-calc-modal-title">
            {titleMain}
          </h2>
          <button type="button" className="home-contribution-calc-close" onClick={onClose}>
            닫기
          </button>
        </div>
        <p className="home-contribution-calc-period">{periodLabel} 기준</p>
        <div className="home-contribution-calc-body">{body}</div>
      </div>
    </div>
  );
}
