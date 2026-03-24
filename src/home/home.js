import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import './home.css';

import { API_BASE } from '@/config';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import TodoList from '@/todo-list/todo-list';
import Calendar from '@/calendar/calendar';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 홈 패널에 표시할 캡처 리드 최대 건수 (오래된 순 정렬 후 앞쪽) */
const HOME_CAPTURE_LEADS_DISPLAY_MAX = 120;

const DEFAULT_STAGE_LABELS = {
  NewLead: '신규 리드',
  Contacted: '연락 완료',
  ProposalSent: '제안서 발송',
  Negotiation: '최종 협상',
  Won: '수주 성공'
};
const DEFAULT_ACTIVE_STAGES = ['NewLead', 'Contacted', 'ProposalSent', 'Negotiation', 'Won'];

/** sales-pipeline.js DROP_ZONE_CONFIG·하단 드롭존과 동일 — 진행 딜·첫 단계 집계에서 제외 */
const DROP_ZONE_STAGES = ['Lost', 'Abandoned'];
const CURRENCY_SYMBOLS = { KRW: '₩', USD: '$', JPY: '¥' };
const PIPELINE_STEP_HINTS = {
  NewLead: '잠재 고객 발굴',
  Contacted: '초기 미팅 완료',
  ProposalSent: '견적 및 협상',
  Negotiation: '클로징 단계',
  Won: '최종 승인'
};

function formatCurrency(value, currency) {
  const code = String(currency || 'KRW').toUpperCase();
  const prefix = CURRENCY_SYMBOLS[code] || `${code} `;
  if (!value) return `${prefix}0`;
  return prefix + Number(value).toLocaleString();
}

/** 대시보드 매출 객체 → 표시 문자열 (통화 혼합 시 · 구분) */
function formatLeadReceivedAt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

/** 리드 연락처 — customFields.phone (리드 캡처 폼과 동일), 없으면 상위 phone */
function formatLeadContact(lead) {
  const cf = lead?.customFields;
  const raw =
    cf && cf.phone != null && String(cf.phone).trim() !== ''
      ? cf.phone
      : lead?.phone != null && String(lead.phone).trim() !== ''
        ? lead.phone
        : '';
  if (raw === '' || raw == null) return '—';
  return String(raw);
}

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

function buildLinePath(series) {
  if (!Array.isArray(series) || series.length === 0) return '';
  if (series.length === 1) return 'M0,100 L400,100';
  const maxAbs = Math.max(1, ...series.map((item) => Math.abs(Number(item?.value) || 0)));
  return series.map((item, idx) => {
    const x = Math.round((idx / (series.length - 1)) * 400);
    const y = Math.round(180 - ((Number(item?.value) || 0) / maxAbs) * 130);
    return `${idx === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');
}

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leadChannels, setLeadChannels] = useState([]);
  const [leadChannelsLoading, setLeadChannelsLoading] = useState(true);
  /** 캡처 채널별 수신 리드 (receivedAt 오름차순 = 가장 오래된 것부터) */
  const [recentCaptureLeads, setRecentCaptureLeads] = useState([]);
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

  useEffect(() => {
    let cancelled = false;
    const fetchLeadCaptureDashboard = async () => {
      try {
        const res = await fetch(`${API_BASE}/lead-capture-forms`, { headers: getAuthHeader(), credentials: 'include' });
        const json = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          const items = Array.isArray(json.items) ? json.items : [];
          const bySource = new Map();
          items.forEach((item) => {
            const source = String(item?.source || '기타 채널').trim() || '기타 채널';
            const prev = bySource.get(source) || 0;
            bySource.set(source, prev + (Number(item?.totalLeads) || 0));
          });
          const sorted = Array.from(bySource.entries())
            .map(([source, count]) => ({ source, count }))
            .sort((a, b) => b.count - a.count);
          setLeadChannels(sorted);

          const leadBatches = await Promise.all(
            items.map(async (form) => {
              try {
                const lr = await fetch(`${API_BASE}/lead-capture-forms/${form._id}/leads`, {
                  headers: getAuthHeader(),
                  credentials: 'include'
                });
                const lj = await lr.json().catch(() => ({}));
                if (!lr.ok) return [];
                const list = Array.isArray(lj.items) ? lj.items : [];
                const channelLabel = String(form?.name || '').trim() || '캡처 채널';
                const channelSource = String(form?.source || '').trim() || '기타 채널';
                return list.map((lead) => ({
                  ...lead,
                  _channelLabel: channelLabel,
                  _channelSource: channelSource
                }));
              } catch {
                return [];
              }
            })
          );
          const merged = leadBatches.flat();
          merged.sort((a, b) => {
            const ta = new Date(a.receivedAt || 0).getTime();
            const tb = new Date(b.receivedAt || 0).getTime();
            return ta - tb;
          });
          if (!cancelled) setRecentCaptureLeads(merged);
        } else if (!cancelled) {
          setLeadChannels([]);
          setRecentCaptureLeads([]);
        }
      } catch (_) {
        if (!cancelled) {
          setLeadChannels([]);
          setRecentCaptureLeads([]);
        }
      } finally {
        if (!cancelled) setLeadChannelsLoading(false);
      }
    };
    fetchLeadCaptureDashboard();
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
      subtext: '지난달 대비 지표',
      icon: 'payments',
      color: 'primary',
      fromPipeline: false
    },
    {
      label: '진행 중 딜 (파이프라인)',
      value: inProgressDealCount,
      subtext: '현재 진행 단계 기준',
      icon: 'handshake',
      color: 'rose',
      fromPipeline: true
    },
    {
      label: `${firstPipelineStageLabel} · 파이프라인 첫 단계`,
      value: newLeadStageCount,
      subtext: '첫 단계 유입 건수',
      icon: 'person_add',
      color: 'mint',
      fromPipeline: true
    },
    {
      label: '업무 완료율',
      value: `${stats.taskCompletion ?? 82}%`,
      subtext: '최근 업무 처리 기준',
      icon: 'task_alt',
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
        ) : tone === 'margin' ? (
          <div className="home-line-chart-wrap">
            <svg className="home-line-chart" viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden>
              <path d={buildLinePath(series)} fill="none" />
              {series.map((item, idx) => {
                const maxAbs = Math.max(1, ...series.map((s) => Math.abs(Number(s?.value) || 0)));
                const x = series.length === 1 ? 0 : Math.round((idx / (series.length - 1)) * 400);
                const y = Math.round(180 - ((Number(item?.value) || 0) / maxAbs) * 130);
                return <circle key={`${title}-dot-${item.label}`} cx={x} cy={y} r="4" />;
              })}
            </svg>
            <div className="home-line-chart-labels">
              {series.map((item) => (
                <span key={`${title}-label-${item.label}`}>{item.label}</span>
              ))}
            </div>
          </div>
        ) : (
          <div className="home-bar-chart-wrap">
            <div className="home-mini-chart">
              {series.map((item) => (
                <div key={`${title}-${item.label}`} className="home-mini-chart-col">
                  <div className="home-mini-chart-track">
                    <div
                      className={`home-mini-chart-bar tone-${tone} ${item.value < 0 ? 'negative' : ''}`}
                      style={{ height: `${Math.max(12, item.height * 2)}%` }}
                      title={`${item.label} ${formatCurrency(item.value, selectedGraphCurrency)}`}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="home-bar-chart-labels">
              {series.map((item) => (
                <span key={`${title}-x-${item.label}`}>{item.label}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="page home-page">
      <header className="page-header">
        <PageHeaderNotifyChat />
      </header>

      <div className="page-content">
        <header className="home-overview-header">
          <h1>대시보드 개요</h1>
          <p>환영합니다! 오늘 당신의 성과를 확인해보세요.</p>
        </header>

        <div className="home-top-grid">
          <div className="panel home-lead-channel-panel">
            <div className="panel-head">
              <h2>캡처 채널별 리드 수신</h2>
              <Link to="/lead-capture" className="home-pipeline-link">채널 관리</Link>
            </div>
            <div className="home-lead-channel-body">
              {leadChannelsLoading ? (
                <p className="home-chart-empty">채널 데이터 불러오는 중…</p>
              ) : leadChannels.length === 0 ? (
                <p className="home-chart-empty">표시할 캡처 채널 데이터가 없습니다.</p>
              ) : (
                <ul className="home-lead-channel-list">
                  {leadChannels.slice(0, 8).map((channel) => (
                    <li key={channel.source} className="home-lead-channel-item">
                      <div className="home-lead-channel-source">
                        <span className="home-lead-channel-dot" />
                        <span>{channel.source}</span>
                      </div>
                      <strong>{channel.count.toLocaleString()}건</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="cards-grid cards-grid-compact">
            {cards.map((card) => (
              <div key={card.label} className="stat-card">
                <div className="stat-card-top">
                  <p className="stat-label">{card.label}</p>
                  <span className="material-symbols-outlined stat-card-icon" aria-hidden>{card.icon}</span>
                </div>
                <h3 className="stat-value">
                  {card.fromPipeline ? (pipelineLoading ? '—' : card.value) : loading ? '—' : card.value}
                </h3>
                <p className="stat-subtext">{card.subtext}</p>
                <div className="stat-bar-wrap">
                  <div className={`stat-bar stat-bar-${card.color}`} style={{ width: typeof card.value === 'string' && card.value.includes('%') ? card.value : '65%' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="home-schedule-split">
          <div className="home-schedule-left-stack">
            <div className="panel tasks-panel home-todo-panel">
              <div className="panel-head">
                <h2>예정 업무</h2>
                <Link to="/todo-list" className="home-pipeline-link">모두 보기</Link>
              </div>
              <section className="home-todo-upcoming" aria-label="예정 업무">
                <TodoList embedded />
              </section>
            </div>
            <div className="panel tasks-panel home-leads-panel">
              <div className="panel-head">
                <h2>수신 리드</h2>
                <Link to="/lead-capture" className="home-pipeline-link">리드 캡처</Link>
              </div>
              <div className="home-todo-leads-scroll" aria-label="캡처 채널 수신 리드 목록">
                {leadChannelsLoading ? (
                  <p className="home-todo-leads-empty">불러오는 중…</p>
                ) : recentCaptureLeads.length === 0 ? (
                  <p className="home-todo-leads-empty">수신된 리드가 없습니다.</p>
                ) : (
                  <>
                    <ul className="home-todo-leads-list">
                      {recentCaptureLeads.slice(0, HOME_CAPTURE_LEADS_DISPLAY_MAX).map((lead) => (
                        <li key={String(lead._id)} className="home-todo-leads-item">
                          <div className="home-todo-leads-item-main">
                            <span className="home-todo-leads-channel" title={lead._channelLabel}>
                              {lead._channelLabel}
                            </span>
                            <span className="home-todo-leads-meta">
                              {lead._channelSource}
                            </span>
                          </div>
                          <div className="home-todo-leads-item-body">
                            <strong className="home-todo-leads-name">{lead.name || '(이름 없음)'}</strong>
                            <span className="home-todo-leads-email">{lead.email || '—'}</span>
                            <span className="home-todo-leads-phone">{formatLeadContact(lead)}</span>
                          </div>
                          <time className="home-todo-leads-time" dateTime={lead.receivedAt ? new Date(lead.receivedAt).toISOString() : undefined}>
                            {formatLeadReceivedAt(lead.receivedAt)}
                          </time>
                        </li>
                      ))}
                    </ul>
                    {recentCaptureLeads.length > HOME_CAPTURE_LEADS_DISPLAY_MAX ? (
                      <p className="home-todo-leads-more">
                        오래된 순 상위 {HOME_CAPTURE_LEADS_DISPLAY_MAX}건만 표시합니다. 전체는{' '}
                        <Link to="/lead-capture">리드 캡처</Link>에서 확인하세요. (총 {recentCaptureLeads.length.toLocaleString()}건)
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="panel home-dashboard-calendar-panel">
            <div className="home-dashboard-calendar-embed">
              <div className="home-dashboard-calendar-top-link-wrap">
                <Link to="/calendar" className="home-pipeline-link">캘린더 전체 보기</Link>
              </div>
              <Calendar />
            </div>
          </div>
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
          <div className="pipeline-steps">
            {pipelineLoading ? (
              <p className="home-pipeline-loading">파이프라인 불러오는 중…</p>
            ) : pipelineColumns.length === 0 ? (
              <p className="home-pipeline-empty">표시할 단계가 없습니다. 세일즈 현황에서 단계를 설정해 주세요.</p>
            ) : (
              pipelineColumns.map((col, idx) => (
                <div key={col.stage} className="pipeline-step-wrap">
                  <div className={`pipeline-step-card pipeline-step-${col.stage}`}>
                    <span className="pipeline-step-title">{col.label}</span>
                  </div>
                  <div className="pipeline-step-metrics">
                    <p>{col.count}</p>
                    <span>{PIPELINE_STEP_HINTS[col.stage] || '파이프라인 단계'}</span>
                  </div>
                  {idx < pipelineColumns.length - 1 && (
                    <span className="material-symbols-outlined pipeline-step-arrow" aria-hidden>chevron_right</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="home-bottom">
          <div className="panel reps-panel">
            <div className="panel-head">
              <h2>우수 영업 담당자</h2>
              <div className="home-reps-switch">
                <button type="button">주간</button>
                <button type="button" className="active">월간</button>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>담당자</th>
                    <th>매출액</th>
                    <th>딜 클로징</th>
                    <th>목표 달성률</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: '이지은', init: 'EJ', deals: 12, value: '₩24,500k', quota: 95 },
                    { name: '김지우', init: 'KJ', deals: 9, value: '₩18,200k', quota: 82 },
                    { name: '박도윤', init: 'PD', deals: 7, value: '₩15,900k', quota: 70 }
                  ].map((row) => (
                    <tr key={row.name}>
                      <td>
                        <div className="cell-user">
                          <span className="avatar-initials">{row.init}</span>
                          {row.name}
                        </div>
                      </td>
                      <td className="font-semibold">{row.value}</td>
                      <td>{row.deals}</td>
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
