import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import './home.css';

import { API_BASE } from '@/config';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import TodoList from '@/todo-list/todo-list';
import Calendar from '@/calendar/calendar';
import {
  getLeadVisibilityUserKey,
  loadHomeCaptureLeadVisibility,
  saveHomeCaptureLeadVisibility,
  isLeadVisibleInHome,
  SNOOZE_MS
} from '@/lib/home-capture-leads-visibility';
import { formatPhone } from '@/register/phoneFormat';
import HomeLeadDetailModal from './home-lead-detail-modal';

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

/** 리드 연락처 — customFields.phone (리드 캡처 폼과 동일), 없으면 상위 phone. 한국 번호는 하이픈 표기 (register/phoneFormat.js와 동일 규칙) */
function formatLeadContact(lead) {
  const cf = lead?.customFields;
  const raw =
    cf && cf.phone != null && String(cf.phone).trim() !== ''
      ? cf.phone
      : lead?.phone != null && String(lead.phone).trim() !== ''
        ? lead.phone
        : '';
  if (raw === '' || raw == null) return '—';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('82') && digits.length >= 11) {
    digits = `0${digits.slice(2)}`;
  }
  if (digits.length === 0) return '—';
  return formatPhone(digits);
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

/** 홈 인사이트 차트 — 막대·라인 구간·포인트 공용 파스텔 (단색, 그라데이션 없음) */
const CHART_PASTEL_COLORS = [
  '#b8d4f0',
  '#d8c8f0',
  '#a8e8d4',
  '#ffe0c0',
  '#f5c8dc',
  '#c4e0fa'
];
const CHART_PASTEL_NEGATIVE = '#f0b8c8';

function chartPastelAt(index) {
  return CHART_PASTEL_COLORS[((index % CHART_PASTEL_COLORS.length) + CHART_PASTEL_COLORS.length) % CHART_PASTEL_COLORS.length];
}

/** 순마진: 올해·작년 동일 Y축 스케일 */
const MARGIN_LINE_CURRENT = '#5a9e82';
const MARGIN_LINE_PREV = '#b8d4c8';
/** 소비자가 단일 꺾은선 */
const CONSUMER_LINE_COLOR = '#5a8ec4';

function lineChartMaxAbs(seriesA, seriesB) {
  const a = Array.isArray(seriesA) ? seriesA : [];
  const b = Array.isArray(seriesB) ? seriesB : [];
  const vals = [...a, ...b].map((x) => Math.abs(Number(x?.value) || 0));
  return Math.max(1, ...vals);
}

/** viewBox 400×200 — 좌우 끝 포인트(반지름·선 두께)가 잘리지 않게 플롯 영역만 사용 */
const LINE_CHART_VB = { w: 400, h: 200, padX: 28, padYTop: 14, padYBottom: 18 };

function lineChartX(idx, len) {
  if (len <= 1) return LINE_CHART_VB.w / 2;
  const inner = LINE_CHART_VB.w - 2 * LINE_CHART_VB.padX;
  return Math.round(LINE_CHART_VB.padX + (idx / (len - 1)) * inner);
}

function lineChartY(value, maxAbs) {
  const { h, padYTop, padYBottom } = LINE_CHART_VB;
  const plotH = h - padYTop - padYBottom;
  const v = Number(value) || 0;
  return Math.round(h - padYBottom - (v / maxAbs) * plotH);
}

function buildLinePathD(series, maxAbs) {
  if (!Array.isArray(series) || series.length === 0) return '';
  const n = series.length;
  if (n === 1) {
    const v = Number(series[0]?.value) || 0;
    const x = lineChartX(0, 1);
    const y = lineChartY(v, maxAbs);
    return `M${x},${y}L${x},${y}`;
  }
  return series
    .map((item, idx) => {
      const x = lineChartX(idx, n);
      const y = lineChartY(Number(item?.value) || 0, maxAbs);
      return `${idx === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
}

function chartSeriesAllZero(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.length === 0 || arr.every((x) => Number(x?.value) === 0);
}

/** 올해·전년 이중 꺾은선 (순마진·소비자가 공용) */
function MarginLineChartWithTooltips({
  marginLineCurrent,
  marginLinePrev,
  currency,
  title,
  strokeCurrent = MARGIN_LINE_CURRENT,
  strokePrev = MARGIN_LINE_PREV
}) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const cur = marginLineCurrent;
  const prev = marginLinePrev;
  const maxAbs = lineChartMaxAbs(cur, prev);
  const dPrev = buildLinePathD(prev, maxAbs);
  const dCur = buildLinePathD(cur, maxAbs);

  return (
    <div className="home-line-chart-chart-block">
      <svg
        className="home-line-chart"
        viewBox={`0 0 ${LINE_CHART_VB.w} ${LINE_CHART_VB.h}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {dPrev ? (
          <path
            d={dPrev}
            fill="none"
            stroke={strokePrev}
            strokeWidth="2.5"
            strokeDasharray="7 5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {dCur ? (
          <path
            d={dCur}
            fill="none"
            stroke={strokeCurrent}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {cur.map((item, idx) => {
          const x = lineChartX(idx, cur.length);
          const y = lineChartY(Number(item?.value) || 0, maxAbs);
          return (
            <circle
              key={`${title}-dot-${item.label}-${idx}`}
              cx={x}
              cy={y}
              r="5"
              fill={strokeCurrent}
              stroke="#fff"
              strokeWidth="1.5"
            />
          );
        })}
      </svg>
      <div className="home-line-chart-hover-zones" role="presentation">
        {cur.map((item, idx) => {
          const prevItem = prev[idx];
          const prevVal = prevItem != null ? Number(prevItem.value) : 0;
          return (
            <div
              key={`${title}-hz-${item.label}-${idx}`}
              className="home-line-chart-hover-zone"
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
            >
              {hoverIdx === idx ? (
                <div className="home-chart-tooltip-fly home-chart-tooltip-fly--line" role="tooltip">
                  <strong>{item.label}</strong>
                  <div>올해: {formatCurrency(Number(item.value) || 0, currency)}</div>
                  <div>전년: {formatCurrency(prevVal, currency)}</div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 소비자가 전년 점선 — 순마진 전년과 동일 톤 */
const CONSUMER_LINE_PREV = MARGIN_LINE_PREV;

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
  /** 인사이트 그래프: 막대 | 꺾은선 (기본 소비자=막대, 순마진=꺾은선) */
  const [consumerChartMode, setConsumerChartMode] = useState('bar');
  const [marginChartMode, setMarginChartMode] = useState('line');
  /** 홈 수신 리드: 완료 숨김(permanent) · 1주 스누즈(snoozed ISO) */
  const [leadHomeVisibility, setLeadHomeVisibility] = useState(() =>
    loadHomeCaptureLeadVisibility(getLeadVisibilityUserKey())
  );
  const [leadDetailOpen, setLeadDetailOpen] = useState(false);
  const [leadDetailContext, setLeadDetailContext] = useState(null);
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
            consumerPrevYearByCurrency: { KRW: [] },
            netMarginByCurrency: { KRW: [] },
            netMarginPrevYearByCurrency: { KRW: [] }
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
                const lr = await fetch(
                  `${API_BASE}/lead-capture-forms/${form._id}/leads?limit=120&page=1`,
                  { headers: getAuthHeader(), credentials: 'include' }
                );
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

  const visibleHomeCaptureLeads = useMemo(
    () =>
      recentCaptureLeads.filter(
        (lead) => lead._id != null && isLeadVisibleInHome(lead._id, leadHomeVisibility)
      ),
    [recentCaptureLeads, leadHomeVisibility]
  );

  const dismissLeadFromHome = useCallback((leadId) => {
    const key = getLeadVisibilityUserKey();
    setLeadHomeVisibility((prev) => {
      const id = String(leadId);
      const permanent = [...new Set([...prev.permanent, id])];
      const snoozed = { ...prev.snoozed };
      delete snoozed[id];
      const next = { permanent, snoozed };
      saveHomeCaptureLeadVisibility(key, next);
      return next;
    });
  }, []);

  const openLeadDetail = useCallback((lead) => {
    const fid = lead.leadCaptureFormId?._id ?? lead.leadCaptureFormId;
    if (!fid || lead._id == null) return;
    setLeadDetailContext({
      formId: String(fid),
      leadId: String(lead._id),
      channelLabel: lead._channelLabel,
      channelSource: lead._channelSource
    });
    setLeadDetailOpen(true);
  }, []);

  const closeLeadDetail = useCallback(() => {
    setLeadDetailOpen(false);
    setLeadDetailContext(null);
  }, []);

  const snoozeLeadHomeOneWeek = useCallback((leadId) => {
    const key = getLeadVisibilityUserKey();
    const until = new Date(Date.now() + SNOOZE_MS).toISOString();
    setLeadHomeVisibility((prev) => {
      const id = String(leadId);
      const snoozed = { ...prev.snoozed, [id]: until };
      const permanent = prev.permanent.filter((p) => p !== id);
      const next = { permanent, snoozed };
      saveHomeCaptureLeadVisibility(key, next);
      return next;
    });
  }, []);

  const stats = data || {};
  const graphCurrencies = useMemo(() => {
    const currencies = Array.isArray(stats.salesGraphs?.currencies)
      ? stats.salesGraphs.currencies.filter(Boolean)
      : [];
    return currencies.length > 0 ? currencies : ['KRW'];
  }, [stats.salesGraphs]);

  /** 통화 선택 UI 제거 — API 통화 목록의 첫 통화로 그래프 표시 */
  const selectedGraphCurrency = graphCurrencies[0] || 'KRW';

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

  const consumerRaw = useMemo(
    () => stats.salesGraphs?.consumerByCurrency?.[selectedGraphCurrency] || [],
    [stats.salesGraphs, selectedGraphCurrency]
  );
  const consumerPrevRaw = useMemo(
    () => stats.salesGraphs?.consumerPrevYearByCurrency?.[selectedGraphCurrency] || [],
    [stats.salesGraphs, selectedGraphCurrency]
  );
  const consumerSeries = useMemo(() => prepareChartSeries(consumerRaw), [consumerRaw]);
  const netMarginRaw = useMemo(
    () => stats.salesGraphs?.netMarginByCurrency?.[selectedGraphCurrency] || [],
    [stats.salesGraphs, selectedGraphCurrency]
  );
  const netMarginPrevRaw = useMemo(
    () => stats.salesGraphs?.netMarginPrevYearByCurrency?.[selectedGraphCurrency] || [],
    [stats.salesGraphs, selectedGraphCurrency]
  );
  const netMarginSeries = useMemo(() => prepareChartSeries(netMarginRaw), [netMarginRaw]);
  const renderChartPanel = (title, subtitle, series, tone, emptyText, chartOptions = {}) => {
    const {
      marginLineCurrent = [],
      marginLinePrev = [],
      consumerLineCurrent = [],
      consumerLinePrev = [],
      chartMode = 'bar',
      onChartModeChange
    } = chartOptions;
    const isMargin = tone === 'margin';
    const marginEmpty = isMargin && chartSeriesAllZero(marginLineCurrent);
    const consumerEmpty =
      !isMargin &&
      (chartMode === 'line'
        ? chartSeriesAllZero(consumerLineCurrent) && chartSeriesAllZero(consumerLinePrev)
        : series.length === 0 || series.every((item) => item.value === 0));

    const renderBarBlock = (barSeries) => (
      <div className="home-bar-chart-wrap">
        <div className="home-mini-chart">
          {barSeries.map((item, idx) => (
            <div key={`${title}-${item.label}-${idx}`} className="home-mini-chart-col home-mini-chart-col--tip">
              <div className="home-mini-chart-track">
                <div className="home-mini-chart-bar-hit">
                  <div
                    className={`home-mini-chart-bar ${item.value < 0 ? 'negative' : ''}`}
                    style={{
                      height: `${Math.max(12, item.height * 2)}%`,
                      backgroundColor: item.value < 0 ? CHART_PASTEL_NEGATIVE : chartPastelAt(idx)
                    }}
                  />
                  <div className="home-chart-tooltip-fly home-chart-tooltip-fly--bar" role="tooltip">
                    <strong>{item.label}</strong>
                    <span>{formatCurrency(item.value, selectedGraphCurrency)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="home-bar-chart-labels">
          {barSeries.map((item) => (
            <span key={`${title}-x-${item.label}`}>{item.label}</span>
          ))}
        </div>
      </div>
    );

    return (
      <div className="panel home-chart-panel">
        <div className="panel-head home-chart-head">
          <div>
            <h2>{title}</h2>
            <p className="home-chart-subtitle">{subtitle}</p>
          </div>
          <div className="home-chart-actions">
            {typeof onChartModeChange === 'function' ? (
              <div className="home-chart-view-toggle">
                <button
                  type="button"
                  className="home-chart-type-icon active"
                  onClick={() => onChartModeChange(chartMode === 'bar' ? 'line' : 'bar')}
                  aria-label={
                    chartMode === 'bar'
                      ? '막대 그래프로 보는 중입니다. 꺾은선으로 전환합니다.'
                      : '꺾은선 그래프로 보는 중입니다. 막대로 전환합니다.'
                  }
                  title={chartMode === 'bar' ? '꺾은선 그래프로 전환' : '막대 그래프로 전환'}
                >
                  <span className="material-symbols-outlined" aria-hidden>
                    {chartMode === 'bar' ? 'bar_chart' : 'show_chart'}
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="home-chart-body">
          {loading ? (
            <p className="home-chart-empty">그래프 불러오는 중…</p>
          ) : isMargin ? (
            marginEmpty ? (
              <p className="home-chart-empty">{emptyText}</p>
            ) : chartMode === 'line' ? (
              <div className="home-line-chart-wrap">
                <MarginLineChartWithTooltips
                  marginLineCurrent={marginLineCurrent}
                  marginLinePrev={marginLinePrev}
                  currency={selectedGraphCurrency}
                  title={title}
                />
                <div className="home-line-chart-legend" aria-hidden>
                  <span>
                    <span className="home-line-legend-swatch current" /> 올해(최근 6개월)
                  </span>
                  <span>
                    <span className="home-line-legend-swatch prev" /> 전년 동월
                  </span>
                </div>
                <div className="home-line-chart-labels">
                  {marginLineCurrent.map((item) => (
                    <span key={`${title}-label-${item.label}`}>{item.label}</span>
                  ))}
                </div>
              </div>
            ) : (
              renderBarBlock(series)
            )
          ) : consumerEmpty ? (
            <p className="home-chart-empty">{emptyText}</p>
          ) : chartMode === 'line' ? (
            <div className="home-line-chart-wrap">
              <MarginLineChartWithTooltips
                marginLineCurrent={consumerLineCurrent}
                marginLinePrev={consumerLinePrev}
                currency={selectedGraphCurrency}
                title={title}
                strokeCurrent={CONSUMER_LINE_COLOR}
                strokePrev={CONSUMER_LINE_PREV}
              />
              <div className="home-line-chart-legend" aria-hidden>
                <span>
                  <span className="home-line-legend-swatch current consumer" /> 올해(최근 6개월)
                </span>
                <span>
                  <span className="home-line-legend-swatch prev consumer" /> 전년 동월
                </span>
              </div>
              <div className="home-line-chart-labels">
                {consumerLineCurrent.map((item) => (
                  <span key={`${title}-cline-${item.label}`}>{item.label}</span>
                ))}
              </div>
            </div>
          ) : (
            renderBarBlock(series)
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="page home-page">
      <HomeLeadDetailModal
        open={leadDetailOpen}
        formId={leadDetailContext?.formId}
        leadId={leadDetailContext?.leadId}
        channelLabel={leadDetailContext?.channelLabel}
        channelSource={leadDetailContext?.channelSource}
        onClose={closeLeadDetail}
        onUpdated={() => {}}
      />
      <header className="page-header">
        <PageHeaderNotifyChat />
      </header>

      <div className="page-content">
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
                ) : visibleHomeCaptureLeads.length === 0 ? (
                  <p className="home-todo-leads-empty">표시할 리드가 없습니다. (완료·1주 미표시 항목은 숨겨져 있습니다.)</p>
                ) : (
                  <>
                    <ul className="home-todo-leads-list">
                      {visibleHomeCaptureLeads.slice(0, HOME_CAPTURE_LEADS_DISPLAY_MAX).map((lead) => (
                        <li
                          key={String(lead._id)}
                          className="home-todo-leads-item home-todo-leads-item--clickable"
                          onClick={() => openLeadDetail(lead)}
                        >
                          <button
                            type="button"
                            className="home-lead-check"
                            onClick={(e) => {
                              e.stopPropagation();
                              dismissLeadFromHome(lead._id);
                            }}
                            aria-label="처리 완료·목록에서 숨기기"
                            title="처리 완료·목록에서 숨기기"
                          >
                            <span className="material-symbols-outlined" aria-hidden>radio_button_unchecked</span>
                          </button>
                          <div className="home-todo-leads-item-stack">
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
                          </div>
                          <div className="home-todo-leads-item-trailing">
                            <button
                              type="button"
                              className="home-lead-snooze-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                snoozeLeadHomeOneWeek(lead._id);
                              }}
                              aria-label="일주일 뒤에 다시 표시"
                              title="일주일 뒤에 다시 표시"
                            >
                              1주 보류
                            </button>
                            <time className="home-todo-leads-time" dateTime={lead.receivedAt ? new Date(lead.receivedAt).toISOString() : undefined}>
                              {formatLeadReceivedAt(lead.receivedAt)}
                            </time>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {visibleHomeCaptureLeads.length > HOME_CAPTURE_LEADS_DISPLAY_MAX ? (
                      <p className="home-todo-leads-more">
                        오래된 순 상위 {HOME_CAPTURE_LEADS_DISPLAY_MAX}건만 표시합니다. 전체는{' '}
                        <Link to="/lead-capture">리드 캡처</Link>에서 확인하세요. (숨김 제외{' '}
                        {visibleHomeCaptureLeads.length.toLocaleString()}건 · 서버 수신 총{' '}
                        {recentCaptureLeads.length.toLocaleString()}건)
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
            '수주 성공 건의 최근 6개월 소비자가 합계입니다. 꺾은선에서는 전년 동월과 같은 눈금으로 비교합니다.',
            consumerSeries,
            'consumer',
            '최근 6개월·전년 동월 소비자가 데이터가 없습니다.',
            {
              chartMode: consumerChartMode,
              onChartModeChange: setConsumerChartMode,
              consumerLineCurrent: consumerRaw,
              consumerLinePrev: consumerPrevRaw
            }
          )}
          {renderChartPanel(
            '순마진 그래프',
            '수주 금액에서 원가×수량을 뺀 금액입니다. 최근 6개월과 전년 동월 6개월을 같은 눈금으로 비교합니다.',
            netMarginSeries,
            'margin',
            '최근 6개월·전년 동월 순마진 데이터가 없습니다.',
            {
              chartMode: marginChartMode,
              onChartModeChange: setMarginChartMode,
              marginLineCurrent: netMarginRaw,
              marginLinePrev: netMarginPrevRaw
            }
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
