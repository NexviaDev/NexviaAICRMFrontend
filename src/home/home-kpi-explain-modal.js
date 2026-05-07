import { useEffect } from 'react';
import './home-kpi-explain-modal.css';

const CURRENCY_SYMBOLS = { KRW: '₩', USD: '$', JPY: '¥' };

function formatCurrency(value, currency) {
  const code = String(currency || 'KRW').toUpperCase();
  const prefix = CURRENCY_SYMBOLS[code] || `${code} `;
  if (!value) return `${prefix}0`;
  return prefix + Number(value).toLocaleString();
}

function kpiPeriodLabelKo(period) {
  const m = { month: '월간', quarter: '분기', half: '반기', year: '연간' };
  return m[period] || '월간';
}

/**
 * 홈 KPI 카드 클릭 시 표시할 설명 스펙.
 * 카드에 보이는 숫자 + (매출·이익률) 세일즈 건 표만 단순히 보여 줍니다.
 */
export function makeHomeKpiExplainSpec({
  card,
  cardKey,
  kpiPeriod,
  scopeLine,
  kpiMeta: _kpiMeta,
  halfFromGraphs,
  displayMain,
  forecastText,
  periodDeltaText,
  showForecast,
  showPeriod,
  forecastMetricLabel,
  periodLabel,
  targetMetricText,
  targetMetricPercent,
  targetAmountLine,
  revNum: _revNum,
  targetRevenue: _targetRevenue,
  homeKpiTargetLoading,
  homeKpiTargetReason: _homeKpiTargetReason,
  gmRatePct: _gmRatePct,
  gmNetMarginTotal: _gmNetMarginTotal,
  gmNonMarginAmount: _gmNonMarginAmount,
  curD: _curD,
  goalTaskCompletion: _goalTaskCompletion,
  taskCompletionMeta: _taskCompletionMeta,
  leadCount: _leadCount,
  projectDone: _projectDone,
  projectActive: _projectActive,
  projectTotal: _projectTotal,
  loading,
  dashboardMeta: _dashboardMeta,
  kpiWonExplain
}) {
  const periodKo = kpiPeriodLabelKo(kpiPeriod);

  const simpleIntro = [`KPI 기간: ${periodKo}`, `조회 범위: ${scopeLine}`];

  const currentBlock = {
    title: '이 카드 숫자',
    items: [
      { label: '주요 수치', value: loading ? '불러오는 중…' : displayMain },
      ...(showForecast ? [{ label: forecastMetricLabel || '보조 지표', value: loading ? '—' : forecastText }] : []),
      ...(showPeriod ? [{ label: periodLabel || '비교', value: loading ? '—' : periodDeltaText }] : []),
      ...(cardKey === 'rev'
        ? [
            {
              label: '목표액 줄',
              value: loading ? '—' : targetAmountLine || '목표 미설정'
            },
            {
              label: targetMetricText || '목표 대비',
              value: loading ? '—' : homeKpiTargetLoading ? '집계 중' : targetMetricPercent
            }
          ]
        : [])
    ]
  };

  if (cardKey === 'rev') {
    return {
      title: card.title,
      icon: card.icon,
      intro: simpleIntro,
      blocks: [currentBlock],
      kpiWonBlock:
        kpiWonExplain && Array.isArray(kpiWonExplain.windows)
          ? {
              halfNote: halfFromGraphs
                ? '반기 보기일 때는 위 큰 숫자가 아래 표 합과 1:1로 맞지 않을 수 있습니다. (그래프 막대 기준과 동일하게 잡힙니다.)'
                : null,
              showNetColumn: false,
              primaryCurrency: kpiWonExplain.primaryCurrency,
              maxRows: kpiWonExplain.maxRows,
              windows: kpiWonExplain.windows
            }
          : null
    };
  }

  if (cardKey === 'gm') {
    return {
      title: card.title,
      icon: card.icon,
      intro: simpleIntro,
      blocks: [currentBlock],
      kpiWonBlock:
        kpiWonExplain && Array.isArray(kpiWonExplain.windows)
          ? {
              halfNote: halfFromGraphs
                ? '반기 보기일 때는 위 %가 아래 표만으로 다시 계산한 값과 다를 수 있습니다.'
                : null,
              showNetColumn: true,
              primaryCurrency: kpiWonExplain.primaryCurrency,
              maxRows: kpiWonExplain.maxRows,
              windows: kpiWonExplain.windows
            }
          : null
    };
  }

  if (cardKey === 'goal') {
    return {
      title: card.title,
      icon: card.icon,
      intro: simpleIntro,
      blocks: [currentBlock],
      kpiWonBlock: null
    };
  }

  if (cardKey === 'lead') {
    return {
      title: card.title,
      icon: card.icon,
      intro: simpleIntro,
      blocks: [currentBlock],
      kpiWonBlock: null
    };
  }

  if (cardKey === 'project') {
    return {
      title: card.title,
      icon: card.icon,
      intro: simpleIntro,
      blocks: [currentBlock],
      kpiWonBlock: null
    };
  }

  return {
    title: card?.title || 'KPI',
    icon: card?.icon || 'info',
    intro: simpleIntro,
    blocks: [currentBlock],
    kpiWonBlock: null
  };
}

function HomeKpiWonExplainBlock({ block }) {
  if (!block || !Array.isArray(block.windows)) return null;
  const { halfNote, showNetColumn, maxRows, windows, primaryCurrency } = block;
  const curLab = String(primaryCurrency || windows?.[0]?.rows?.[0]?.currency || 'KRW').trim() || 'KRW';
  return (
    <div className="home-kpi-explain-won-wrap">
      <h3 className="home-kpi-explain-section-title home-kpi-explain-won-main-title">
        수주 성공(Won) 건 목록
      </h3>
      <p className="home-kpi-explain-won-lead">
        통화 <strong>{curLab}</strong> 기준 · 구간마다 최대 <strong>{maxRows != null ? String(maxRows) : '60'}</strong>건까지 표시합니다.
      </p>
      {halfNote ? <p className="home-kpi-explain-won-halfnote">{halfNote}</p> : null}
      {windows.map((win) => (
        <div key={win.key || win.title} className="home-kpi-explain-won-sub">
          <h4 className="home-kpi-explain-won-subtitle">
            {win.title}
            <span className="home-kpi-explain-won-range">{win.rangeLabel ? ` · ${win.rangeLabel}` : ''}</span>
          </h4>
          <p className="home-kpi-explain-won-cap">
            전체 <strong>{win.total != null ? win.total : 0}</strong>건
            {win.truncated ? ` — 표에는 앞 ${maxRows != null ? maxRows : 60}건만 표시` : ''}
          </p>
          {!win.rows || win.rows.length === 0 ? (
            <p className="home-kpi-explain-won-empty">이 구간에 해당하는 건이 없습니다.</p>
          ) : (
            <div className="home-kpi-explain-won-scroll">
              <table className="home-kpi-explain-won-table">
                <thead>
                  <tr>
                    <th>업체·연락처</th>
                    <th>프로그램(제품/제목)</th>
                    <th className="home-kpi-explain-won-num">수량</th>
                    <th className="home-kpi-explain-won-num">수주액</th>
                    {showNetColumn ? <th className="home-kpi-explain-won-num">순마진</th> : null}
                    <th className="home-kpi-explain-won-date">기준일</th>
                  </tr>
                </thead>
                <tbody>
                  {win.rows.map((row) => (
                    <tr key={row.id || `${row.company}-${row.basisDateDisplay}`}>
                      <td>{row.company}</td>
                      <td>{row.program}</td>
                      <td className="home-kpi-explain-won-num">{row.quantity != null ? row.quantity : '—'}</td>
                      <td className="home-kpi-explain-won-num">{formatCurrency(row.value, row.currency)}</td>
                      {showNetColumn ? (
                        <td className="home-kpi-explain-won-num">{formatCurrency(row.netMargin, row.currency)}</td>
                      ) : null}
                      <td className="home-kpi-explain-won-date">{row.basisDateDisplay}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function HomeKpiExplainModal({ spec, onClose }) {
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

  return (
    <div
      className="home-kpi-explain-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="home-kpi-explain-title"
      onClick={onBackdrop}
    >
      <div className="home-kpi-explain-dialog">
        <div className="home-kpi-explain-head">
          <h2 id="home-kpi-explain-title" className="home-kpi-explain-title">
            <span className="material-symbols-outlined home-kpi-explain-title-icon" aria-hidden>
              {spec.icon}
            </span>
            {spec.title} 보기
          </h2>
          <button type="button" className="home-kpi-explain-close" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="home-kpi-explain-body">
          <ul className="home-kpi-explain-intro">
            {(spec.intro || []).map((line, i) => (
              <li key={i} className="home-kpi-explain-intro-item">
                {line.split('**').map((chunk, j) => (j % 2 === 1 ? <strong key={j}>{chunk}</strong> : chunk))}
              </li>
            ))}
          </ul>
          {(spec.blocks || []).map((block, bi) => (
            <section key={bi} className="home-kpi-explain-section">
              <h3 className="home-kpi-explain-section-title">{block.title}</h3>
              {Array.isArray(block.items) && block.items.length > 0 ? (
                <dl className="home-kpi-explain-dl">
                  {block.items.map((row, ri) => (
                    <div key={ri} className="home-kpi-explain-dl-row">
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {Array.isArray(block.bullets) && block.bullets.length > 0 ? (
                <ul className="home-kpi-explain-bullets">
                  {block.bullets.map((line, li) => (
                    <li key={li}>
                      {String(line)
                        .split('**')
                        .map((chunk, j) => (j % 2 === 1 ? <strong key={j}>{chunk}</strong> : chunk))}
                    </li>
                  ))}
                </ul>
              ) : null}
              {(block.paragraphs || []).map((para, pi) => (
                <p key={pi} className="home-kpi-explain-p">
                  {String(para)
                    .split('**')
                    .map((chunk, j) => (j % 2 === 1 ? <strong key={j}>{chunk}</strong> : chunk))}
                </p>
              ))}
            </section>
          ))}
          {spec.kpiWonBlock ? <HomeKpiWonExplainBlock block={spec.kpiWonBlock} /> : null}
          <p className="home-kpi-explain-foot">건수가 많으면 표에는 일부만 보일 수 있습니다.</p>
        </div>
      </div>
    </div>
  );
}
