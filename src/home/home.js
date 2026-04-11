import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import HomeLeadDetailModal from './home-lead-detail-modal';
import HomeFullViewModal from './home-full-view-modal';

function getGreetingForHome() {
  const h = new Date().getHours();
  if (h < 12) return '좋은 아침입니다';
  if (h < 18) return '안녕하세요';
  return '좋은 저녁입니다';
}

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 홈의 「캡처 채널별 리드 수신」「수신 리드」: 대표·관리자(Senior 포함)는 전체 폼,
 * 그 외 역할은 본인이 담당자(assigneeUserIds)로 지정된 폼만 집계·조회합니다.
 */
function filterLeadCaptureFormsForHomeViewer(items, crmUser) {
  if (!Array.isArray(items)) return [];
  if (isAdminOrAboveRole(crmUser?.role)) return items;
  const myId = crmUser?._id != null ? String(crmUser._id) : '';
  if (!myId) return [];
  return items.filter((form) => {
    const arr = Array.isArray(form?.assigneeUserIds) ? form.assigneeUserIds : [];
    return arr.some((a) => String(a?._id ?? a) === myId);
  });
}

/** 홈 패널에 표시할 캡처 리드 최대 건수 (오래된 순 정렬 후 앞쪽) */
const HOME_CAPTURE_LEADS_DISPLAY_MAX = 120;

/** 모바일 홈 「전체 보기」 모달 — URL `?homeView=todo|leads|calendar|channels` */
const HOME_VIEW_PARAM = 'homeView';
const HOME_VIEW_VALUES = new Set(['todo', 'leads', 'calendar', 'channels']);
const HOME_VIEW_TITLES = {
  todo: '예정 업무',
  leads: '수신 리드',
  calendar: '캘린더',
  channels: '캡처 채널별 리드 수신'
};
/** 모바일 미리보기 줄 수 — 나머지는 모달에서만 스크롤 */
const HOME_MOBILE_PREVIEW_LEADS = 5;
const HOME_MOBILE_PREVIEW_TODO = 5;

const DEFAULT_STAGE_LABELS = {
  NewLead: '신규 리드',
  Contacted: '연락 완료',
  ProposalSent: '제안서 발송',
  Negotiation: '최종 협상',
  Won: '수주 성공'
};
const DEFAULT_ACTIVE_STAGES = ['NewLead', 'Contacted', 'ProposalSent', 'Negotiation', 'Won'];

/** sales-pipeline.js 하단 드롭존과 동일 — 파이프라인 메인 칸 집계에서 제외 */
const DROP_ZONE_STAGES = ['Lost', 'Abandoned'];
/** 수주 완료 열 — sales-pipeline.js `boardStages`(activeStages에서 Won 제외)와 맞춤. 진행 중 딜 카운트에 넣지 않음 */
const CLOSED_WON_STAGE = 'Won';
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

/** 세일즈 파이프라인 수주(Won) 집계용 시점: 판매일 우선, 없으면 수정일 */
function getWonOpportunityDate(opp) {
  if (opp?.saleDate) {
    const t = new Date(opp.saleDate).getTime();
    if (!Number.isNaN(t)) return new Date(opp.saleDate);
  }
  if (opp?.updatedAt) return new Date(opp.updatedAt);
  if (opp?.createdAt) return new Date(opp.createdAt);
  return new Date(0);
}

/** 주간(최근 7일)·월간(당월) — 수주 성공 건만 넘긴 뒤 필터 */
function isWonOpportunityInPeriod(opp, mode) {
  const d = getWonOpportunityDate(opp);
  const now = new Date();
  if (mode === 'week') {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    return d >= start && d <= now;
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  return d >= start && d <= now;
}

function nameToInitials(name) {
  const s = String(name || '').trim();
  if (!s || s === '미지정') return '?';
  const noSpace = s.replace(/\s/g, '');
  if (noSpace.length <= 2) return noSpace.toUpperCase();
  return (noSpace[0] + noSpace[noSpace.length - 1]).toUpperCase();
}

/**
 * sales-opportunities API의 grouped.Won 배열 → 담당자별 매출·건수 (sales-pipeline과 동일 데이터 소스)
 */
function aggregateWonLeaderboard(wonOpportunities, mode) {
  const filtered = (wonOpportunities || []).filter((o) => isWonOpportunityInPeriod(o, mode));
  const totalDeals = filtered.length;
  const byAssignee = new Map();
  for (const opp of filtered) {
    const displayName = (opp.assignedToName || '').trim() || '미지정';
    if (!byAssignee.has(displayName)) {
      byAssignee.set(displayName, { name: displayName, deals: 0, KRW: 0, USD: 0, JPY: 0 });
    }
    const row = byAssignee.get(displayName);
    row.deals += 1;
    const cur = String(opp.currency || 'KRW').toUpperCase();
    const v = Number(opp.value) || 0;
    if (cur === 'USD') row.USD += v;
    else if (cur === 'JPY') row.JPY += v;
    else row.KRW += v;
  }
  const sortedBuckets = Array.from(byAssignee.values()).sort(
    (a, b) => b.deals - a.deals || b.KRW - a.KRW || String(a.name).localeCompare(String(b.name), 'ko')
  );
  const rows = sortedBuckets.map((r) => {
    const parts = [];
    if (r.KRW > 0) parts.push(formatCurrency(r.KRW, 'KRW'));
    if (r.USD > 0) parts.push(formatCurrency(r.USD, 'USD'));
    if (r.JPY > 0) parts.push(formatCurrency(r.JPY, 'JPY'));
    const revenueDisplay = parts.length ? parts.join(' · ') : '—';
    const sharePct = totalDeals > 0 ? Math.round((r.deals / totalDeals) * 100) : 0;
    return {
      name: r.name,
      initials: nameToInitials(r.name),
      deals: r.deals,
      revenueDisplay,
      sharePct
    };
  });
  return { rows: rows.slice(0, 20), totalDeals };
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
  /** 인사이트 그래프: 서버 /auth/me 기준 (localStorage만 쓰면 DB 역할 변경·오래된 캐시와 어긋날 수 있음) */
  const [insightAccess, setInsightAccess] = useState({ checked: false, seniorPlus: false });
  /** 우수 영업 담당자: sales-opportunities의 수주 성공(Won) — 관리자·대표만 표시 */
  const [wonLeaderboardMode, setWonLeaderboardMode] = useState('month');
  const [wonLeaderboardRows, setWonLeaderboardRows] = useState([]);
  const [wonLeaderboardLoading, setWonLeaderboardLoading] = useState(false);
  const [wonLeaderboardRefreshTick, setWonLeaderboardRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem('crm_token');
    if (!token) {
      setInsightAccess({ checked: true, seniorPlus: false });
      return undefined;
    }
    fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        if (data?.user) {
          try {
            localStorage.setItem('crm_user', JSON.stringify(data.user));
          } catch (_) {}
          setInsightAccess({
            checked: true,
            seniorPlus: isAdminOrAboveRole(data.user.role)
          });
        } else {
          setInsightAccess({
            checked: true,
            seniorPlus: isAdminOrAboveRole(getStoredCrmUser()?.role)
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setInsightAccess({
          checked: true,
          seniorPlus: isAdminOrAboveRole(getStoredCrmUser()?.role)
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!insightAccess.checked || !insightAccess.seniorPlus) return undefined;
    let cancelled = false;
    setWonLeaderboardLoading(true);
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/sales-opportunities`, { headers: getAuthHeader() });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const won = Array.isArray(data.grouped?.Won) ? data.grouped.Won : [];
        const { rows } = aggregateWonLeaderboard(won, wonLeaderboardMode);
        setWonLeaderboardRows(rows);
      } catch {
        if (!cancelled) setWonLeaderboardRows([]);
      } finally {
        if (!cancelled) setWonLeaderboardLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [insightAccess.checked, insightAccess.seniorPlus, wonLeaderboardMode, wonLeaderboardRefreshTick]);

  useEffect(() => {
    if (!insightAccess.checked || !insightAccess.seniorPlus) return undefined;
    const handler = () => setWonLeaderboardRefreshTick((t) => t + 1);
    window.addEventListener('nexvia-crm-pipeline-refresh', handler);
    return () => window.removeEventListener('nexvia-crm-pipeline-refresh', handler);
  }, [insightAccess.checked, insightAccess.seniorPlus]);

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
          taskCompletion: 0,
          taskCompletionMeta: { totalOpportunities: 0, wonCount: 0 }
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
          const visibleForms = filterLeadCaptureFormsForHomeViewer(items, getStoredCrmUser());
          const bySource = new Map();
          visibleForms.forEach((item) => {
            const source = String(item?.source || '기타 채널').trim() || '기타 채널';
            const prev = bySource.get(source) || 0;
            bySource.set(source, prev + (Number(item?.totalLeads) || 0));
          });
          const sorted = Array.from(bySource.entries())
            .map(([source, count]) => ({ source, count }))
            .sort((a, b) => b.count - a.count);
          setLeadChannels(sorted);

          const leadBatches = await Promise.all(
            visibleForms.map(async (form) => {
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

  /** 진행 중 딜: 메인 보드 단계만 (Won·Lost·Abandoned 제외 — 파이프라인 칸반과 동일 범의) */
  const inProgressDealCount = useMemo(
    () =>
      pipelineMainStages
        .filter((s) => s !== CLOSED_WON_STAGE)
        .reduce((sum, s) => sum + (grouped[s]?.length || 0), 0),
    [pipelineMainStages, grouped]
  );

  const homeUserDisplay = useMemo(() => {
    const u = getStoredCrmUser();
    const n = (u?.name && String(u.name).trim()) || (u?.email && String(u.email).split('@')[0]) || '사용자';
    return n;
  }, []);

  const scheduleTodayLabel = useMemo(() => {
    try {
      return new Date().toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        weekday: 'short'
      });
    } catch {
      return '';
    }
  }, []);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const fn = () => setIsMobile(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  const [searchParams, setSearchParams] = useSearchParams();
  const activeHomeView = useMemo(() => {
    const v = searchParams.get(HOME_VIEW_PARAM);
    return HOME_VIEW_VALUES.has(v) ? v : null;
  }, [searchParams]);

  const closeHomeView = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(HOME_VIEW_PARAM);
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const openHomeView = useCallback(
    (view) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set(HOME_VIEW_PARAM, view);
        return next;
      });
    },
    [setSearchParams]
  );

  useEffect(() => {
    if (!activeHomeView) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closeHomeView();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeHomeView, closeHomeView]);

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

  const leadsCappedForHome = useMemo(
    () => visibleHomeCaptureLeads.slice(0, HOME_CAPTURE_LEADS_DISPLAY_MAX),
    [visibleHomeCaptureLeads]
  );

  const leadsForHomePanel = useMemo(() => {
    if (isMobile) return leadsCappedForHome.slice(0, HOME_MOBILE_PREVIEW_LEADS);
    return leadsCappedForHome;
  }, [isMobile, leadsCappedForHome]);

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

  const openLeadDetail = useCallback(
    (lead) => {
      const fid = lead.leadCaptureFormId?._id ?? lead.leadCaptureFormId;
      if (!fid || lead._id == null) return;
      if (activeHomeView) closeHomeView();
      setLeadDetailContext({
        formId: String(fid),
        leadId: String(lead._id),
        channelLabel: lead._channelLabel,
        channelSource: lead._channelSource
      });
      setLeadDetailOpen(true);
    },
    [activeHomeView, closeHomeView]
  );

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
      value: `${stats.taskCompletion ?? 0}%`,
      subtext: (() => {
        const m = stats.taskCompletionMeta;
        if (m && typeof m.totalOpportunities === 'number') {
          return `전체 기회 ${m.totalOpportunities}건 중 수주 성공 ${Number(m.wonCount) || 0}건`;
        }
        return '세일즈 파이프라인 전체 기회 대비 수주 성공(Won) 비율';
      })(),
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

  /** 소비자가·순마진 인사이트 그래프: 관리자·대표만 (위 insightAccess = /auth/me 반영 후) */
  const canViewInsightCharts = insightAccess.checked && insightAccess.seniorPlus;

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

  const renderCaptureLeadRow = (lead) => (
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
          <span className="home-todo-leads-meta">{lead._channelSource}</span>
        </div>
        <div className="home-todo-leads-item-body">
          <strong className="home-todo-leads-name">{lead.name || '(이름 없음)'}</strong>
          <span className="home-todo-leads-email">{lead.email || '—'}</span>
          <span className="home-todo-leads-phone">{formatLeadContact(lead)}</span>
        </div>
      </div>
      <span className="home-todo-leads-chevron" aria-hidden>
        <span className="material-symbols-outlined">chevron_right</span>
      </span>
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
        <time
          className="home-todo-leads-time"
          dateTime={lead.receivedAt ? new Date(lead.receivedAt).toISOString() : undefined}
        >
          {formatLeadReceivedAt(lead.receivedAt)}
        </time>
      </div>
    </li>
  );

  return (
    <div className={`page home-page${activeHomeView ? ' home-page--full-view-open' : ''}`}>
      <HomeLeadDetailModal
        open={leadDetailOpen}
        formId={leadDetailContext?.formId}
        leadId={leadDetailContext?.leadId}
        channelLabel={leadDetailContext?.channelLabel}
        channelSource={leadDetailContext?.channelSource}
        onClose={closeLeadDetail}
        onUpdated={() => {}}
      />
      <header className="page-header home-page-header">
        <div className="home-page-header-actions">
          <PageHeaderNotifyChat wrapperClassName="home-page-header-notify-wrap" />
        </div>
      </header>

      <div className="page-content home-page-content">
        <section className="home-mobile-hero" aria-label="대시보드 인사">
          <p className="home-mobile-greet">
            {getGreetingForHome()}, {homeUserDisplay}
          </p>
          <h2 className="home-mobile-dashboard-title">일일 대시보드</h2>
        </section>

        <div className="home-top-grid">
          <div className="panel home-lead-channel-panel">
            <div className="panel-head">
              <h2>캡처 채널별 리드 수신</h2>
              {isMobile ? (
                <button
                  type="button"
                  className="home-pipeline-link home-pipeline-link--btn"
                  onClick={() => openHomeView('channels')}
                >
                  전체 보기
                </button>
              ) : (
                <Link to="/lead-capture" className="home-pipeline-link">
                  채널 관리
                </Link>
              )}
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

          <div className="cards-grid cards-grid-compact home-metrics-bento">
            {cards.map((card, idx) => (
              <div key={card.label} className={`stat-card stat-card--bento stat-card--bento-${idx}`}>
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
              <div className="panel-head home-todo-panel-head">
                <div className="home-todo-title-row">
                  <h2>예정 업무</h2>
                  <time className="home-schedule-date" dateTime={new Date().toISOString().slice(0, 10)}>
                    {scheduleTodayLabel}
                  </time>
                </div>
                {isMobile ? (
                  <button
                    type="button"
                    className="home-pipeline-link home-pipeline-link--btn"
                    onClick={() => openHomeView('todo')}
                  >
                    전체 보기
                  </button>
                ) : (
                  <Link to="/todo-list" className="home-pipeline-link">
                    모두 보기
                  </Link>
                )}
              </div>
              <section className="home-todo-upcoming" aria-label="예정 업무">
                <TodoList embedded previewMax={isMobile ? HOME_MOBILE_PREVIEW_TODO : null} />
              </section>
            </div>
            <div className="panel tasks-panel home-leads-panel">
              <div className="panel-head home-leads-panel-head">
                <h2>수신 리드</h2>
                <div className="home-leads-panel-actions">
                  {isMobile ? (
                    <button
                      type="button"
                      className="home-pipeline-link home-pipeline-link--btn"
                      onClick={() => openHomeView('leads')}
                    >
                      전체 보기
                    </button>
                  ) : null}
                  <Link to="/lead-capture" className="home-pipeline-link">
                    리드 캡처
                  </Link>
                </div>
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
                      {leadsForHomePanel.map(renderCaptureLeadRow)}
                    </ul>
                    {isMobile && leadsCappedForHome.length > HOME_MOBILE_PREVIEW_LEADS ? (
                      <p className="home-todo-leads-more">
                        상위 {HOME_MOBILE_PREVIEW_LEADS}건만 미리 보여 줍니다. 나머지는 「전체 보기」에서
                        확인하세요. (숨김 제외 {visibleHomeCaptureLeads.length.toLocaleString()}건)
                      </p>
                    ) : !isMobile && visibleHomeCaptureLeads.length > HOME_CAPTURE_LEADS_DISPLAY_MAX ? (
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
                {isMobile ? (
                  <button
                    type="button"
                    className="home-pipeline-link home-pipeline-link--btn"
                    onClick={() => openHomeView('calendar')}
                  >
                    전체 보기
                  </button>
                ) : (
                  <Link to="/calendar" className="home-pipeline-link">
                    캘린더 전체 보기
                  </Link>
                )}
              </div>
              <Calendar embedded hideBottomSection />
            </div>
          </div>
        </div>

        <div className="home-insights-grid">
          {!insightAccess.checked ? (
            <div className="panel home-chart-panel home-insights-role-loading" aria-busy="true">
              <p className="home-chart-empty">권한 확인 중…</p>
            </div>
          ) : canViewInsightCharts ? (
            <>
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
            </>
          ) : (
            <div className="panel home-chart-panel home-insights-restricted-panel" aria-live="polite">
              <div className="panel-head home-chart-head">
                <div>
                  <h2>매출 인사이트 그래프</h2>
                  <p className="home-chart-subtitle">소비자가·순마진 추이</p>
                </div>
              </div>
              <div className="home-insights-restricted-body">
                <span className="material-symbols-outlined home-insights-restricted-icon" aria-hidden>
                  lock
                </span>
                <p>
                  이 영역은 <strong>관리자·대표</strong> 권한에서만 열람할 수 있습니다. (Staff·권한 대기 계정은 표시되지 않습니다.)
                </p>
              </div>
            </div>
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

        {insightAccess.checked && (
          insightAccess.seniorPlus ? (
            <div className="home-bottom">
              <div className="panel reps-panel">
                <div className="panel-head reps-panel-head">
                  <h2>우수 영업 담당자</h2>
                  <div className="panel-actions reps-panel-actions">
                    <div className="home-reps-switch">
                      <button
                        type="button"
                        className={wonLeaderboardMode === 'week' ? 'active' : ''}
                        onClick={() => setWonLeaderboardMode('week')}
                      >
                        주간
                      </button>
                      <button
                        type="button"
                        className={wonLeaderboardMode === 'month' ? 'active' : ''}
                        onClick={() => setWonLeaderboardMode('month')}
                      >
                        월간
                      </button>
                    </div>
                    <Link to="/sales-pipeline" className="home-pipeline-link">
                      세일즈 현황
                      <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
                    </Link>
                  </div>
                </div>
                <p className="home-reps-source-hint">
                  세일즈 현황과 동일한 데이터입니다. <strong>수주 성공(Won)</strong>만 집계합니다. 기간은 판매일(없으면 수정일) 기준 — {wonLeaderboardMode === 'week' ? '최근 7일' : '당월'}.
                </p>
                <div className="table-wrap">
                  {wonLeaderboardLoading ? (
                    <p className="home-chart-empty home-reps-loading">불러오는 중…</p>
                  ) : wonLeaderboardRows.length === 0 ? (
                    <p className="home-chart-empty home-reps-empty">
                      해당 기간에 수주 성공 건이 없거나, 담당자 정보가 없습니다.
                    </p>
                  ) : (
                    <table className="data-table home-reps-table">
                      <thead>
                        <tr>
                          <th>담당자</th>
                          <th>매출액</th>
                          <th className="home-reps-col-extra">수주 성공 건수</th>
                          <th className="home-reps-col-extra">비중(건수)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {wonLeaderboardRows.map((row) => (
                          <tr key={row.name}>
                            <td>
                              <div className="cell-user">
                                <span className="avatar-initials">{row.initials}</span>
                                {row.name}
                              </div>
                            </td>
                            <td className="font-semibold">{row.revenueDisplay}</td>
                            <td className="home-reps-col-extra">{row.deals}</td>
                            <td className="home-reps-col-extra">
                              <div className="quota-cell">
                                <div className="quota-bar">
                                  <div className="quota-fill" style={{ width: `${row.sharePct}%` }} />
                                </div>
                                <span>{row.sharePct}%</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="home-bottom">
              <div className="panel reps-panel home-reps-panel-restricted">
                <div className="panel-head">
                  <h2>우수 영업 담당자</h2>
                </div>
                <div className="home-insights-restricted-body home-reps-restricted-inner">
                  <span className="material-symbols-outlined home-insights-restricted-icon" aria-hidden>
                    lock
                  </span>
                  <p>
                    이 표는 <strong>관리자·대표</strong>만 열람할 수 있습니다. (수주 성공 실적은 세일즈 현황과 연동됩니다.)
                  </p>
                </div>
              </div>
            </div>
          )
        )}
      </div>

      <HomeFullViewModal
        open={Boolean(activeHomeView)}
        title={activeHomeView ? HOME_VIEW_TITLES[activeHomeView] : ''}
        onClose={closeHomeView}
      >
        {activeHomeView === 'todo' ? <TodoList embedded /> : null}
        {activeHomeView === 'leads' ? (
          <div className="home-modal-leads" aria-label="수신 리드 전체">
            {leadChannelsLoading ? (
              <p className="home-todo-leads-empty">불러오는 중…</p>
            ) : recentCaptureLeads.length === 0 ? (
              <p className="home-todo-leads-empty">수신된 리드가 없습니다.</p>
            ) : visibleHomeCaptureLeads.length === 0 ? (
              <p className="home-todo-leads-empty">
                표시할 리드가 없습니다. (완료·1주 미표시 항목은 숨겨져 있습니다.)
              </p>
            ) : (
              <ul className="home-todo-leads-list home-modal-leads-list">{leadsCappedForHome.map(renderCaptureLeadRow)}</ul>
            )}
          </div>
        ) : null}
        {activeHomeView === 'calendar' ? <Calendar embedded hideBottomSection={false} /> : null}
        {activeHomeView === 'channels' ? (
          <div className="home-modal-channels" aria-label="캡처 채널 전체">
            {leadChannelsLoading ? (
              <p className="home-chart-empty">채널 데이터 불러오는 중…</p>
            ) : leadChannels.length === 0 ? (
              <p className="home-chart-empty">표시할 캡처 채널 데이터가 없습니다.</p>
            ) : (
              <ul className="home-lead-channel-list">
                {leadChannels.map((channel) => (
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
        ) : null}
      </HomeFullViewModal>

      <Link to="/lead-capture" className="home-mobile-fab" title="리드 캡처" aria-label="리드 캡처로 이동">
        <span className="material-symbols-outlined" aria-hidden>
          add
        </span>
      </Link>
    </div>
  );
}
