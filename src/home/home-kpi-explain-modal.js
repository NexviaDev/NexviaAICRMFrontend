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

function normalizeKpiCollectedExplain(src, curD) {
  if (!src || typeof src !== 'object') return null;
  const rows = Array.isArray(src.rows) ? src.rows : [];
  return {
    maxRows: Number(src.maxRows) || 80,
    primaryCurrency: String(src.primaryCurrency || curD || 'KRW').trim() || 'KRW',
    total: Number.isFinite(Number(src.total)) ? Number(src.total) : rows.length,
    truncated: !!src.truncated,
    rows,
    forecastFallback: false,
    forecastCapped: false
  };
}

/** 서버 kpiCollectedExplain 없을 때 Forecast 표 행으로 수금 목록 보강(최대 500건 스캔과 동일 데이터) */
function buildCollectedExplainFromForecastRows(rows, primaryCurrency, maxRows) {
  const limit = Math.max(1, Math.min(200, Number(maxRows) || 80));
  const pc = String(primaryCurrency || 'KRW').trim().toUpperCase() || 'KRW';
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const collected = Math.round(Number(r.collectedAmount) || 0);
    if (collected <= 0) continue;
    out.push({
      id: String(r.id || ''),
      company: r.companyLabel != null ? String(r.companyLabel) : '—',
      program: r.softwareLabel != null ? String(r.softwareLabel) : '—',
      stage: r.stage != null ? String(r.stage) : '—',
      collectedAmount: collected,
      currency: String(r.currency || 'KRW').trim().toUpperCase() || 'KRW',
      basisLabel: r.targetMonth != null && String(r.targetMonth).trim() ? String(r.targetMonth).trim() : '—'
    });
  }
  out.sort((a, b) => {
    const ap = String(a.currency).toUpperCase() === pc ? 1 : 0;
    const bp = String(b.currency).toUpperCase() === pc ? 1 : 0;
    if (bp !== ap) return bp - ap;
    return (b.collectedAmount || 0) - (a.collectedAmount || 0);
  });
  const total = out.length;
  const truncated = total > limit;
  return {
    maxRows: limit,
    primaryCurrency: pc,
    total,
    truncated,
    rows: truncated ? out.slice(0, limit) : out,
    forecastFallback: true,
    forecastCapped: false
  };
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
  leadCount: _leadCount,
  projectDone: _projectDone,
  projectActive: _projectActive,
  projectTotal: _projectTotal,
  loading,
  dashboardMeta: _dashboardMeta,
  kpiWonExplain,
  kpiCollectedExplain: _kpiCollectedExplain,
  forecastPipelineRows: _forecastPipelineRows,
  forecastPipelineMeta: _forecastPipelineMeta,
  homeProjectPreview = [],
  homeProjectPreviewLoading = false,
  goalFootnoteModel: _goalFootnoteModel = null
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
    const completionPct =
      _goalTaskCompletion != null && Number.isFinite(Number(_goalTaskCompletion))
        ? Math.round(Number(_goalTaskCompletion))
        : 0;
    const goalCurrentBlock = {
      title: currentBlock.title,
      items: [
        ...currentBlock.items,
        {
          label: '세일즈 현황 완료율',
          value: loading ? '—' : `${completionPct}%`
        }
      ]
    };
    let collectedBlock = null;
    if (!loading) {
      const normalized = normalizeKpiCollectedExplain(_kpiCollectedExplain, _curD);
      const serverRows = normalized && normalized.rows.length > 0;
      if (serverRows) {
        collectedBlock = { ...normalized };
      } else {
        const fb = buildCollectedExplainFromForecastRows(_forecastPipelineRows || [], _curD, 80);
        const meta = _forecastPipelineMeta && typeof _forecastPipelineMeta === 'object' ? _forecastPipelineMeta : {};
        if (fb.rows.length > 0) {
          collectedBlock = { ...fb, forecastCapped: !!meta.capped };
        } else if (normalized) {
          collectedBlock = { ...normalized };
        } else {
          collectedBlock = {
            maxRows: 80,
            primaryCurrency: String(_curD || 'KRW').trim() || 'KRW',
            total: 0,
            truncated: false,
            rows: [],
            forecastFallback: false,
            forecastCapped: false
          };
        }
      }
    }

    return {
      title: card.title,
      icon: card.icon,
      intro: simpleIntro,
      blocks: [goalCurrentBlock],
      kpiWonBlock: null,
      kpiCollectedExplainBlock: collectedBlock,
      goalFootnoteModel: _goalFootnoteModel || null
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
    const rows = (Array.isArray(homeProjectPreview) ? homeProjectPreview : [])
      .map((p) => ({
        id: String(p?._id || '').trim(),
        name: String(p?.name != null ? p.name : p?.title || '').trim() || '—',
        stage: String(p?.stage || '').trim() || '—'
      }))
      .filter((r) => r.id);
    return {
      title: card.title,
      icon: card.icon,
      intro: simpleIntro,
      blocks: [currentBlock],
      kpiWonBlock: null,
      kpiProjectPreviewBlock: {
        loading: !!homeProjectPreviewLoading,
        rows
      }
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

function HomeKpiCollectedExplainBlock({ block, onOpenOpportunity }) {
  if (!block) return null;
  const maxRows = block.maxRows != null ? Number(block.maxRows) : 80;
  const curLab = String(block.primaryCurrency || 'KRW').trim() || 'KRW';
  const total = Number.isFinite(Number(block.total)) ? Number(block.total) : 0;
  const truncated = !!block.truncated;
  const rows = Array.isArray(block.rows) ? block.rows : [];
  const canOpen = typeof onOpenOpportunity === 'function';
  const onRowActivate = (row) => {
    const id = row?.id != null ? String(row.id).trim() : '';
    if (!id || !canOpen) return;
    onOpenOpportunity(id);
  };
  return (
    <div className="home-kpi-explain-won-wrap home-kpi-explain-collected-wrap">
      <h3 className="home-kpi-explain-section-title home-kpi-explain-won-main-title">수금(누적) 반영 기회 목록</h3>
      <p className="home-kpi-explain-won-lead">
        상단 KPI 카드 합계와 동일한 조회 범위·KPI 기간입니다. 표시 통화 <strong>{curLab}</strong> 우선 정렬 · 최대{' '}
        <strong>{Number.isFinite(maxRows) ? String(maxRows) : '80'}</strong>건까지 표시합니다.
        {canOpen ? (
          <>
            {' '}
            <strong>행을 클릭</strong>하면 세일즈 파이프라인에서 해당 기회가 열립니다.
          </>
        ) : null}
      </p>
      <p className="home-kpi-explain-won-cap">
        수금 합계가 0보다 큰 기회 <strong>{total}</strong>건
        {truncated && Number.isFinite(maxRows) ? ` — 표에는 앞 ${maxRows}건만 표시` : ''}
      </p>
      {rows.length === 0 ? (
        <p className="home-kpi-explain-won-empty">해당 조건에서 수금이 입력된 기회가 없습니다.</p>
      ) : (
        <div className="home-kpi-explain-won-scroll">
          <table className="home-kpi-explain-won-table home-kpi-explain-collected-table">
            <thead>
              <tr>
                <th>업체·연락처</th>
                <th>프로그램(제품/제목)</th>
                <th>단계</th>
                <th className="home-kpi-explain-won-num">수금 합계</th>
                <th className="home-kpi-explain-won-date">기준</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = row?.id != null ? String(row.id).trim() : '';
                const clickable = canOpen && id;
                return (
                  <tr
                    key={row.id || `${row.company}-${row.basisLabel}-${row.collectedAmount}`}
                    className={clickable ? 'home-kpi-explain-row-clickable' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    role={clickable ? 'button' : undefined}
                    aria-label={clickable ? `${row.company || '기회'} 상세 열기` : undefined}
                    onClick={clickable ? () => onRowActivate(row) : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onRowActivate(row);
                            }
                          }
                        : undefined
                    }
                  >
                    <td>{row.company}</td>
                    <td>{row.program}</td>
                    <td>{row.stage != null ? String(row.stage) : '—'}</td>
                    <td className="home-kpi-explain-won-num">
                      {row.collectedKpiRowAnomaly ? (
                        <span className="home-kpi-explain-collected-anomaly-value">
                          {formatCurrency(row.collectedAmount, row.currency)}
                        </span>
                      ) : (
                        formatCurrency(row.collectedAmount, row.currency)
                      )}
                    </td>
                    <td className="home-kpi-explain-won-date">
                      {row.collectedKpiRowAnomaly ? (
                        <span className="home-kpi-explain-collected-anomaly-value">
                          {row.basisLabel != null ? String(row.basisLabel) : '—'}
                        </span>
                      ) : row.basisLabel != null ? (
                        String(row.basisLabel)
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const PROJECT_STAGE_LABEL_KO = {
  todo: '해야 할 일',
  progress: '진행 중',
  review: '검토',
  done: '완료'
};

function projectStageLabelKo(stageKey) {
  const k = String(stageKey || '').trim();
  return PROJECT_STAGE_LABEL_KO[k] || (k ? k : '—');
}

function HomeKpiProjectPreviewBlock({ block, onOpenProject }) {
  if (!block) return null;
  const loading = !!block.loading;
  const rows = Array.isArray(block.rows) ? block.rows : [];
  const canOpen = typeof onOpenProject === 'function';
  const onRowActivate = (row) => {
    const id = row?.id != null ? String(row.id).trim() : '';
    if (!id || !canOpen) return;
    onOpenProject(id);
  };
  return (
    <div className="home-kpi-explain-won-wrap home-kpi-explain-project-preview-wrap">
      <h3 className="home-kpi-explain-section-title home-kpi-explain-won-main-title">프로젝트 목록</h3>
      <p className="home-kpi-explain-won-lead">
        홈 KPI 카드와 동일한 순서(완료 우선, 이후 진행)로 표시합니다.
        {canOpen ? (
          <>
            {' '}
            <strong>행을 클릭</strong>하면 프로젝트 화면에서 해당 프로젝트가 열립니다.
          </>
        ) : null}
      </p>
      {loading && rows.length === 0 ? (
        <p className="home-kpi-explain-won-empty">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="home-kpi-explain-won-empty">표시할 프로젝트가 없습니다.</p>
      ) : (
        <div className="home-kpi-explain-won-scroll">
          <table className="home-kpi-explain-won-table home-kpi-explain-project-preview-table">
            <thead>
              <tr>
                <th>프로젝트명</th>
                <th className="home-kpi-explain-won-date">단계</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = row?.id != null ? String(row.id).trim() : '';
                const clickable = canOpen && id;
                return (
                  <tr
                    key={row.id}
                    className={clickable ? 'home-kpi-explain-row-clickable' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    role={clickable ? 'button' : undefined}
                    aria-label={clickable ? `${row.name || '프로젝트'} 상세 열기` : undefined}
                    onClick={clickable ? () => onRowActivate(row) : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onRowActivate(row);
                            }
                          }
                        : undefined
                    }
                  >
                    <td>{row.name}</td>
                    <td className="home-kpi-explain-won-date">{projectStageLabelKo(row.stage)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HomeKpiWonExplainBlock({ block, onOpenOpportunity }) {
  if (!block || !Array.isArray(block.windows)) return null;
  const { halfNote, showNetColumn, maxRows, windows, primaryCurrency } = block;
  const curLab = String(primaryCurrency || windows?.[0]?.rows?.[0]?.currency || 'KRW').trim() || 'KRW';
  const canOpen = typeof onOpenOpportunity === 'function';
  const onRowActivate = (row) => {
    const id = row?.id != null ? String(row.id).trim() : '';
    if (!id || !canOpen) return;
    onOpenOpportunity(id);
  };
  return (
    <div className="home-kpi-explain-won-wrap">
      <h3 className="home-kpi-explain-section-title home-kpi-explain-won-main-title">
        수주 성공(Won) 건 목록
      </h3>
      <p className="home-kpi-explain-won-lead">
        통화 <strong>{curLab}</strong> 기준 · 구간마다 최대 <strong>{maxRows != null ? String(maxRows) : '60'}</strong>건까지 표시합니다.
        {canOpen ? (
          <>
            {' '}
            <strong>행을 클릭</strong>하면 세일즈 파이프라인에서 해당 기회가 열립니다.
          </>
        ) : null}
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
                  {win.rows.map((row) => {
                    const id = row?.id != null ? String(row.id).trim() : '';
                    const clickable = canOpen && id;
                    return (
                      <tr
                        key={row.id || `${row.company}-${row.basisDateDisplay}`}
                        className={clickable ? 'home-kpi-explain-row-clickable' : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        role={clickable ? 'button' : undefined}
                        aria-label={clickable ? `${row.company || '기회'} 상세 열기` : undefined}
                        onClick={clickable ? () => onRowActivate(row) : undefined}
                        onKeyDown={
                          clickable
                            ? (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  onRowActivate(row);
                                }
                              }
                            : undefined
                        }
                      >
                        <td>{row.company}</td>
                        <td>{row.program}</td>
                        <td className="home-kpi-explain-won-num">{row.quantity != null ? row.quantity : '—'}</td>
                        <td className="home-kpi-explain-won-num">{formatCurrency(row.value, row.currency)}</td>
                        {showNetColumn ? (
                          <td className="home-kpi-explain-won-num">{formatCurrency(row.netMargin, row.currency)}</td>
                        ) : null}
                        <td className="home-kpi-explain-won-date">{row.basisDateDisplay}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** 수금 KPI 참고·특이 — 인트로 아래 표(리스트형) */
function HomeGoalFootnoteTable({ model }) {
  if (!model) return null;
  const { reference, anomalies } = model;
  const rows = Array.isArray(anomalies) ? anomalies : [];
  if (!reference && rows.length === 0) return null;
  return (
    <section className="home-kpi-explain-section home-kpi-explain-section--goal-footnote">
      <h3 className="home-kpi-explain-section-title">수금 참고·특이</h3>
      <div className="home-kpi-explain-won-scroll home-kpi-explain-goal-footnote-scroll">
        <table className="home-kpi-explain-won-table home-kpi-explain-goal-footnote-table">
          <thead>
            <tr>
              <th scope="col">구분</th>
              <th scope="col">내용</th>
            </tr>
          </thead>
          <tbody>
            {reference ? (
              <tr>
                <td className="home-kpi-explain-goal-footnote-kind">참고</td>
                <td>
                  전체 <span className="home-kpi-footnote-num">{reference.tot}</span>
                  {' · '}수주 <span className="home-kpi-footnote-num">{reference.won}</span>
                  {' · '}진행 <span className="home-kpi-footnote-num">{reference.prog}</span>
                </td>
              </tr>
            ) : null}
            {rows.map((a) => (
              <tr key={a.kind}>
                <td className="home-kpi-explain-goal-footnote-kind">특이</td>
                <td>
                  {a.desc}{' '}
                  <span className="home-kpi-footnote-num">{a.count}</span>건
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function HomeKpiExplainModal({ spec, onClose, onOpenSalesOpportunity, onOpenProject }) {
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
          <HomeGoalFootnoteTable model={spec.goalFootnoteModel} />
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
          {spec.kpiCollectedExplainBlock ? (
            <HomeKpiCollectedExplainBlock
              block={spec.kpiCollectedExplainBlock}
              onOpenOpportunity={onOpenSalesOpportunity}
            />
          ) : null}
          {spec.kpiWonBlock ? (
            <HomeKpiWonExplainBlock block={spec.kpiWonBlock} onOpenOpportunity={onOpenSalesOpportunity} />
          ) : null}
          {spec.kpiProjectPreviewBlock ? (
            <HomeKpiProjectPreviewBlock block={spec.kpiProjectPreviewBlock} onOpenProject={onOpenProject} />
          ) : null}
          <p className="home-kpi-explain-foot">건수가 많으면 표에는 일부만 보일 수 있습니다.</p>
        </div>
      </div>
    </div>
  );
}
