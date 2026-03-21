import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import './home.css';

import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const DEFAULT_STAGE_LABELS = {
  NewLead: '신규 리드',
  Contacted: '접촉 완료',
  ProposalSent: '제안서 발송'
};
const DEFAULT_ACTIVE_STAGES = ['NewLead', 'Contacted', 'ProposalSent'];

/** sales-pipeline.js DROP_ZONE_CONFIG·하단 드롭존과 동일 — 진행 딜·첫 단계 집계에서 제외 */
const DROP_ZONE_STAGES = ['Lost', 'Abandoned', 'Won'];
const CURRENCY_SYMBOLS = { KRW: '₩', USD: '$', JPY: '¥' };

function formatCurrency(value, currency) {
  const code = String(currency || 'KRW').toUpperCase();
  const prefix = CURRENCY_SYMBOLS[code] || `${code} `;
  if (!value) return `${prefix}0`;
  return prefix + Number(value).toLocaleString();
}

/** 대시보드 매출 객체 → 표시 문자열 (통화 혼합 시 · 구분) */
function formatWonRevenue(w) {
  const entries = Object.entries(w || {}).filter(([, amount]) => Number(amount) > 0);
  if (entries.length === 0) return formatCurrency(0, 'KRW');
  const parts = [];
  for (const [currency, amount] of entries) {
    parts.push(formatCurrency(amount, currency));
  }
  return parts.join(' · ');
}

function prepareChartSeries(series) {
  const items = Array.isArray(series) ? series : [];
  const maxAbs = Math.max(1, ...items.map((item) => Math.abs(Number(item?.value) || 0)));
  return items.map((item) => {
    const value = Number(item?.value) || 0;
    return {
      label: item?.label || '',
      value,
      height: value === 0 ? 0 : Math.max(10, Math.round((Math.abs(value) / maxAbs) * 48))
    };
  });
}

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [grouped, setGrouped] = useState({});
  const [totals, setTotals] = useState({});
  const [stageDefinitions, setStageDefinitions] = useState([]);
  const [pipelineLoading, setPipelineLoading] = useState(true);
  const [healthPinged, setHealthPinged] = useState(false);
  const [selectedGraphCurrency, setSelectedGraphCurrency] = useState('KRW');
  const pipelineMounted = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const res = await fetch(`${API_BASE}/reports/dashboard`, { headers: getAuthHeader() });
        if (!cancelled && res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (_) {
        if (!cancelled) setData({
          wonRevenue: { KRW: 0, USD: 0 },
          salesGraphs: {
            currencies: ['KRW'],
            consumerByCurrency: { KRW: [] },
            netMarginByCurrency: { KRW: [] }
          },
          activeDeals: 128,
          newLeads: 45,
          taskCompletion: 82
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, []);

  const fetchStageDefinitions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=salesPipelineStage`, { headers: getAuthHeader() });
      const json = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(json.items)) setStageDefinitions(json.items);
      else setStageDefinitions([]);
    } catch {
      setStageDefinitions([]);
    }
  }, []);

  const fetchPipeline = useCallback(async () => {
    setPipelineLoading(true);
    try {
      const res = await fetch(`${API_BASE}/sales-opportunities`, { headers: getAuthHeader() });
      if (!res.ok) throw new Error('fetch failed');
      const json = await res.json();
      if (pipelineMounted.current) {
        setGrouped(json.grouped || {});
        setTotals(json.totals || {});
      }
    } catch {
      if (pipelineMounted.current) {
        setGrouped({});
        setTotals({});
      }
    } finally {
      if (pipelineMounted.current) setPipelineLoading(false);
    }
  }, []);

  useEffect(() => {
    pipelineMounted.current = true;
    return () => { pipelineMounted.current = false; };
  }, []);

  useEffect(() => {
    fetchStageDefinitions();
  }, [fetchStageDefinitions]);

  useEffect(() => {
    if (!healthPinged) {
      fetch(`${API_BASE}/health`).finally(() => setHealthPinged(true));
      return;
    }
    fetchPipeline();
  }, [fetchPipeline, healthPinged]);

  const activeStages = stageDefinitions.length > 0
    ? stageDefinitions.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((d) => d.key)
    : DEFAULT_ACTIVE_STAGES;
  const stageLabels = stageDefinitions.length > 0
    ? Object.fromEntries(stageDefinitions.map((d) => [d.key, d.label]))
    : DEFAULT_STAGE_LABELS;

  /** 세일즈 현황 메인 컬럼만 (Quick Actions·드롭존 단계 제외) */
  const pipelineMainStages = useMemo(
    () => activeStages.filter((s) => !DROP_ZONE_STAGES.includes(s)),
    [activeStages]
  );

  const inProgressDealCount = useMemo(
    () => pipelineMainStages.reduce((sum, s) => sum + (grouped[s]?.length || 0), 0),
    [pipelineMainStages, grouped]
  );

  /** 파이프라인 첫 컬럼 = 세일즈 현황 좌측 첫 단계(기본 NewLead) */
  const firstPipelineStageKey = pipelineMainStages[0] || 'NewLead';
  const newLeadStageCount = grouped[firstPipelineStageKey]?.length ?? 0;
  const firstPipelineStageLabel =
    stageLabels[firstPipelineStageKey] ||
    DEFAULT_STAGE_LABELS[firstPipelineStageKey] ||
    firstPipelineStageKey;

  const stats = data || {};
  const graphCurrencies = useMemo(() => {
    const currencies = Array.isArray(stats.salesGraphs?.currencies)
      ? stats.salesGraphs.currencies.filter(Boolean)
      : [];
    return currencies.length > 0 ? currencies : ['KRW'];
  }, [stats.salesGraphs]);

  useEffect(() => {
    if (!graphCurrencies.includes(selectedGraphCurrency)) {
      setSelectedGraphCurrency(graphCurrencies[0] || 'KRW');
    }
  }, [graphCurrencies, selectedGraphCurrency]);

  const cards = [
    {
      label: '총 매출 (수주 성공)',
      value: formatWonRevenue(stats.wonRevenue),
      color: 'primary',
      fromPipeline: false
    },
    {
      label: '진행 중 딜 (파이프라인)',
      value: inProgressDealCount,
      color: 'rose',
      fromPipeline: true
    },
    {
      label: `${firstPipelineStageLabel} · 파이프라인 첫 단계`,
      value: newLeadStageCount,
      color: 'mint',
      fromPipeline: true
    },
    {
      label: '업무 완료율',
      value: `${stats.taskCompletion ?? 82}%`,
      color: 'primary',
      fromPipeline: false
    }
  ];

  const pipelineColumns = useMemo(() => {
    const cols = pipelineMainStages.map((stage) => {
      const items = grouped[stage] || [];
      const total = totals[stage] || 0;
      const mainCurrency = items.length > 0 ? (items[0].currency || 'KRW') : 'KRW';
      return { stage, label: stageLabels[stage] ?? stage, count: items.length, total, currency: mainCurrency };
    });
    const maxCount = Math.max(1, ...cols.map((c) => c.count));
    const maxTotal = Math.max(1, ...cols.map((c) => c.total));
    return cols.map((c) => ({
      ...c,
      hCount: Math.round((c.count / maxCount) * 95),
      hValue: Math.round((c.total / maxTotal) * 95),
      hMix: Math.round(((c.count / maxCount + c.total / maxTotal) / 2) * 95)
    }));
  }, [pipelineMainStages, grouped, totals, stageLabels]);

  const consumerSeries = useMemo(
    () => prepareChartSeries(stats.salesGraphs?.consumerByCurrency?.[selectedGraphCurrency] || []),
    [stats.salesGraphs, selectedGraphCurrency]
  );
  const netMarginSeries = useMemo(
    () => prepareChartSeries(stats.salesGraphs?.netMarginByCurrency?.[selectedGraphCurrency] || []),
    [stats.salesGraphs, selectedGraphCurrency]
  );
  const consumerTotal = useMemo(
    () => consumerSeries.reduce((sum, item) => sum + item.value, 0),
    [consumerSeries]
  );
  const netMarginTotal = useMemo(
    () => netMarginSeries.reduce((sum, item) => sum + item.value, 0),
    [netMarginSeries]
  );

  const renderChartPanel = (title, subtitle, total, series, tone, emptyText) => (
    <div className="panel home-chart-panel">
      <div className="panel-head home-chart-head">
        <div>
          <h2>{title}</h2>
          <p className="home-chart-subtitle">{subtitle}</p>
        </div>
        <div className="home-chart-actions">
          <span className={`panel-badge home-chart-total tone-${tone}`}>{formatCurrency(total, selectedGraphCurrency)}</span>
          {graphCurrencies.length > 0 && (
            <div className="panel-actions">
              {graphCurrencies.map((currency) => (
                <button
                  key={currency}
                  type="button"
                  className={`chip ${selectedGraphCurrency === currency ? 'active' : ''}`}
                  onClick={() => setSelectedGraphCurrency(currency)}
                >
                  {currency}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="home-chart-body">
        {loading ? (
          <p className="home-chart-empty">그래프 불러오는 중…</p>
        ) : series.length === 0 || series.every((item) => item.value === 0) ? (
          <p className="home-chart-empty">{emptyText}</p>
        ) : (
          <div className="home-mini-chart">
            {series.map((item) => (
              <div key={`${title}-${item.label}`} className="home-mini-chart-col">
                <span className={`home-mini-chart-value tone-${tone}`}>{formatCurrency(item.value, selectedGraphCurrency)}</span>
                <div className="home-mini-chart-track">
                  <div
                    className={`home-mini-chart-bar tone-${tone} ${item.value < 0 ? 'negative' : ''}`}
                    style={{ height: `${item.height}%` }}
                    title={`${item.label} ${formatCurrency(item.value, selectedGraphCurrency)}`}
                  />
                </div>
                <span className="home-mini-chart-label">{item.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="page home-page">
      <header className="page-header">
        <div className="header-search">
          <span className="material-symbols-outlined">search</span>
          <input type="text" placeholder="딜, 연락처, 업무 검색..." />
        </div>
        <div className="header-actions">
          <button type="button" className="icon-btn"><span className="material-symbols-outlined">notifications</span></button>
          <button type="button" className="icon-btn"><span className="material-symbols-outlined">chat_bubble</span></button>
          <button type="button" className="btn-primary"><span className="material-symbols-outlined">add</span> 새로 만들기</button>
        </div>
      </header>

      <div className="page-content">
        <div className="cards-grid">
          {cards.map((card) => (
            <div key={card.label} className="stat-card">
              <div className="stat-card-top">
                <p className="stat-label">{card.label}</p>
              </div>
              <h3 className="stat-value">
                {card.fromPipeline ? (pipelineLoading ? '—' : card.value) : loading ? '—' : card.value}
              </h3>
              <div className="stat-bar-wrap">
                <div className={`stat-bar stat-bar-${card.color}`} style={{ width: typeof card.value === 'string' && card.value.includes('%') ? card.value : '65%' }} />
              </div>
            </div>
          ))}
        </div>

        <div className="home-insights-grid">
          {renderChartPanel(
            '소비자가 기준 그래프',
            '수주 성공 건의 최근 6개월 소비자가 합계입니다.',
            consumerTotal,
            consumerSeries,
            'consumer',
            '최근 6개월 소비자가 데이터가 없습니다.'
          )}
          {renderChartPanel(
            '순마진 그래프',
            '수주 금액에서 원가와 유통가를 제외한 최근 6개월 순마진입니다.',
            netMarginTotal,
            netMarginSeries,
            'margin',
            '최근 6개월 순마진 데이터가 없습니다.'
          )}
        </div>

        <div className="panel sales-pipeline">
          <div className="panel-head">
            <h2>영업 파이프라인</h2>
            <div className="panel-actions">
              <Link to="/sales-pipeline" className="home-pipeline-link">
                세일즈 현황에서 관리
                <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
              </Link>
            </div>
          </div>
          <div className="pipeline-bars">
            {pipelineLoading ? (
              <p className="home-pipeline-loading">파이프라인 불러오는 중…</p>
            ) : pipelineColumns.length === 0 ? (
              <p className="home-pipeline-empty">표시할 단계가 없습니다. 세일즈 현황에서 단계를 설정해 주세요.</p>
            ) : (
              pipelineColumns.map((col) => (
                <div key={col.stage} className="pipeline-col">
                  <div className="pipeline-label">
                    <span>{col.label} ({col.count})</span>
                    <span className="pipeline-value">{formatCurrency(col.total, col.currency)}</span>
                  </div>
                  <div className="pipeline-bar-wrap">
                    <div className="pipeline-bar" style={{ height: `${col.hCount}%` }} title={`건수 비중 ${col.count}건`} />
                    <div className="pipeline-bar alt" style={{ height: `${col.hValue}%` }} title="단계별 금액 비중" />
                    <div className="pipeline-bar dark" style={{ height: `${col.hMix}%` }} title="건수·금액 혼합" />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="home-bottom">
          <div className="panel tasks-panel">
            <div className="panel-head"><h2>예정 업무</h2></div>
            <div className="tasks-list">
              <div className="task-item done">
                <span className="material-symbols-outlined text-mint">check_circle</span>
                <div>
                  <p>Acme Corp 후속 연락</p>
                  <span className="task-meta">오늘 14:30</span>
                </div>
              </div>
              <div className="task-item">
                <span className="material-symbols-outlined">radio_button_unchecked</span>
                <div>
                  <p>GlobalX 제안서 검토</p>
                  <span className="task-meta">내일 10:00</span>
                </div>
              </div>
              <div className="task-item">
                <span className="material-symbols-outlined">radio_button_unchecked</span>
                <div>
                  <p>팀 분기 정기 회의</p>
                  <span className="task-meta">금요일 16:00</span>
                </div>
              </div>
            </div>
            <button type="button" className="link-btn">전체 업무 보기</button>
          </div>
          <div className="panel reps-panel">
            <div className="panel-head">
              <h2>우수 영업 담당자</h2>
              <span className="panel-badge">3분기 실적</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>담당자</th>
                    <th>계약 건수</th>
                    <th>총 금액</th>
                    <th>목표 달성률</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: 'Sarah Jenkins', init: 'SR', deals: 24, value: '$184,000', quota: 95 },
                    { name: 'Mark Thompson', init: 'MT', deals: 19, value: '$142,500', quota: 82 },
                    { name: 'David Lee', init: 'DL', deals: 15, value: '$98,000', quota: 65 }
                  ].map((row) => (
                    <tr key={row.name}>
                      <td>
                        <div className="cell-user">
                          <span className="avatar-initials">{row.init}</span>
                          {row.name}
                        </div>
                      </td>
                      <td>{row.deals}</td>
                      <td className="font-semibold">{row.value}</td>
                      <td>
                        <div className="quota-cell">
                          <div className="quota-bar"><div className="quota-fill" style={{ width: row.quota + '%' }} /></div>
                          <span>{row.quota}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
