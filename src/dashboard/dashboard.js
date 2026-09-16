import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession, getAuthHeader } from '@/lib/crm-auth';
import { createPortal } from 'react-dom';
import { Link, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import './dashboard.css';
import './home-ref.css';
import { HomeContributionCalcModal } from './home-contribution-calc-modal';
import HomeKpiExplainModal, { makeHomeKpiExplainSpec } from './home-kpi-explain-modal';

import { API_BASE } from '@/config';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import { HomeCalendarModalEmbed } from './home-schedule-embed';
import { HomeRefActionCalendarWidget, HomeRefRankingWidget } from './home-ref-side-widgets';
import { deferAfterPaint } from '@/lib/defer-after-paint';
import {
  getLeadVisibilityUserKey,
  loadHomeCaptureLeadVisibility,
  saveHomeCaptureLeadVisibility,
  isLeadVisibleInHome,
  SNOOZE_MS
} from '@/lib/home-capture-leads-visibility';
import { formatPhone } from '@/register/phoneFormat';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import { getSavedHomeDashboardTemplate, patchHomeDashboardTemplate } from '@/lib/list-templates';
import { pingBackendHealth } from '@/lib/backend-wake';
import OpportunityModal from '@/sales-pipeline/opportunity-modal/opportunity-modal';
import '@/sales-pipeline/opportunity-modal/opportunity-modal.css';
import HomeLeadDetailModal from './home-lead-detail-modal';
import HomeFullViewModal from './home-full-view-modal';
import {
  HomeForecastTable,
  HomeForecastPairTable,
  getHomeForecastColumnWidthsFromUser
} from './home-forecast-table';
import ProjectFormModal from '@/project/project-form-modal';
import '@/project/project-form-modal.css';
import { buildParticipantDirectoryFromOverview } from '@/lib/participant-directory-merge';
import { getCurrencySymbol } from '@/lib/exchange-rate-currency-options';
import { useExchangeRates } from '@/lib/use-exchange-rates';
import {
  DASHBOARD_DISPLAY_CURRENCY,
  toKrwAmount,
  mergeCurrencySeriesMapToKrw,
  sumCurrencyBreakdownToKrw,
  computeKrwInsightKpiFromGraphs,
  mergeProductSalesRowsToKrw,
  sumForecastTotalsKrw,
  rebuildContributionBarKrw
} from '@/lib/dashboard-krw-aggregate';

/** 프로젝트 KPI에서 편집 모달 열 때 단계 옵션(프로젝트 칸반 기본과 동일) */
const HOME_PROJECT_KPI_STAGE_OPTIONS = [
  { value: 'todo', label: '해야 할 일' },
  { value: 'progress', label: '진행 중' },
  { value: 'review', label: '검토' },
  { value: 'done', label: '완료' }
];

/** 인사이트 권한 확인·차트 로딩 — 파스텔 링 스피너 (그라데이션 없음) */
function HomePastelSpinner({ size = 'md', label, reducedMotion, className = '' }) {
  return (
    <span
      className={`home-pastel-spinner home-pastel-spinner--${size}${reducedMotion ? ' home-pastel-spinner--reduced' : ''} ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      <span className="home-pastel-spinner-ring" aria-hidden />
      {label ? <span className="home-pastel-spinner-label">{label}</span> : null}
    </span>
  );
}

function getGreetingForHome() {
  const h = new Date().getHours();
  if (h < 12) return '좋은 아침입니다';
  if (h < 18) return '안녕하세요';
  return '좋은 저녁입니다';
}

/**
 * 수금 KPI 참고·특이 — 카드·설명 모달에서 동일 모델 사용.
 * 숫자는 `.home-kpi-footnote-num`(적붉은 파스텔)으로 감싸 렌더합니다.
 */
function buildGoalKpiFootnoteModel(stats) {
  const kpi = stats?.kpiSummary;
  const goal = kpi?.goal;
  const m = stats?.taskCompletionMeta || {};
  const tot = Number(m?.totalOpportunities);
  const won = Number(m?.wonCount) || 0;
  const inProg = Number(m?.inProgressDealCount);
  const prog = Number.isFinite(inProg) ? inProg : 0;
  const an = goal?.collectedKpiAnomalies;
  const partial = Number(an?.partialByCollectionDateInWindowCount) || 0;
  const straddle = Number(an?.fullSumIncludesRowsOutsideWindowCount) || 0;
  const crossYear = Number(an?.contractYearVsCollectionClosedYearMismatchCount) || 0;
  const reference = Number.isFinite(tot) && tot > 0 ? { tot, won, prog } : null;
  const anomalies = [];
  if (partial > 0) {
    anomalies.push({ kind: 'partial', count: partial, desc: '수금일만 KPI에 맞춰 합산' });
  }
  if (straddle > 0) {
    anomalies.push({ kind: 'straddle', count: straddle, desc: '당기 포함 건·수금 전액 합산' });
  }
  if (crossYear > 0) {
    anomalies.push({ kind: 'crossYear', count: crossYear, desc: '계약연·완납 연도 다름' });
  }
  if (!reference && anomalies.length === 0) return null;
  return { reference, anomalies };
}

/** @deprecated buildGoalKpiFootnoteModel — HMR·구 호출 호환 */
function buildGoalKpiCardFootnoteLines(stats) {
  return buildGoalKpiFootnoteModel(stats);
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

/** 모바일 홈 「전체 보기」 모달 — URL `?homeView=leads|calendar|channels|forecast|completed` */
const HOME_VIEW_PARAM = 'homeView';
const HOME_VIEW_VALUES = new Set(['leads', 'calendar', 'channels', 'forecast', 'completed']);
const HOME_VIEW_TITLES = {
  leads: '신규 리드',
  calendar: '캘린더',
  channels: '캡처 채널별 리드 수신',
  forecast: 'Forecast 전체',
  completed: '완료 기회 전체'
};
const HOME_FORECAST_PREVIEW_MAX = 5;
const HOME_LEAD_COMPLETED_SHARED_PREFIX = 'crm_home_capture_leads_completed_shared_';

function getLeadCompletedCompanyKey() {
  try {
    const u = JSON.parse(localStorage.getItem('crm_user') || '{}');
    return String(u.companyId || u.companyName || 'global');
  } catch {
    return 'global';
  }
}

function loadSharedCompletedLeadMap() {
  try {
    const raw = localStorage.getItem(`${HOME_LEAD_COMPLETED_SHARED_PREFIX}${getLeadCompletedCompanyKey()}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveSharedCompletedLeadMap(mapObj) {
  try {
    const next = mapObj && typeof mapObj === 'object' ? mapObj : {};
    localStorage.setItem(`${HOME_LEAD_COMPLETED_SHARED_PREFIX}${getLeadCompletedCompanyKey()}`, JSON.stringify(next));
  } catch (_) { }
}

const DEFAULT_STAGE_LABELS = {
  NewLead: '신규 리드',
  Contacted: '연락 완료',
  ProposalSent: '제안서 전달 완료',
  TechDemo: '기술 시연',
  Quotation: '견적',
  Negotiation: '최종 협상',
  Won: '수주 성공'
};
const DEFAULT_ACTIVE_STAGES = [
  'NewLead',
  'Contacted',
  'ProposalSent',
  'TechDemo',
  'Quotation',
  'Negotiation',
  'Won'
];

/** sales-pipeline.js 하단 드롭존과 동일 — 파이프라인 메인 칸 집계에서 제외 */
const DROP_ZONE_STAGES = ['Lost', 'Abandoned'];
/** 수주 완료 열 — sales-pipeline.js `boardStages`(activeStages에서 Won 제외)와 맞춤. 진행 중 딜 카운트에 넣지 않음 */
const CLOSED_WON_STAGE = 'Won';
/** 대시보드 금액 — 항상 원화 환산 후 ₩ 표기만 */
function DashboardKrwCell({ amount, currency, dealBasRMap }) {
  const krw = toKrwAmount(amount, currency, dealBasRMap);
  return <span className="crm-price-main">{formatCurrency(krw, DASHBOARD_DISPLAY_CURRENCY)}</span>;
}

function dashboardKrwLabel(amount, currency, dealBasRMap) {
  return formatCurrency(toKrwAmount(amount, currency, dealBasRMap), DASHBOARD_DISPLAY_CURRENCY);
}

const PIPELINE_STEP_HINTS = {
  NewLead: '잠재 고객 발굴',
  Contacted: '초기 미팅 완료',
  ProposalSent: '제안·자료 전달',
  TechDemo: '기술 시연·POC',
  Quotation: '견적 제출',
  Negotiation: '클로징 단계',
  Won: '최종 승인'
};

function formatCurrency(value, currency) {
  const code = String(currency || 'KRW').toUpperCase();
  const sym = getCurrencySymbol(code);
  if (!value && value !== 0) return `${sym}0`;
  return `${sym}${Number(value).toLocaleString()}`;
}

function formatRevenueCompact(value) {
  const v = Math.round(Number(value) || 0);
  if (v >= 100000000) return `₩${(v / 100000000).toFixed(1)}억`;
  if (v >= 10000) return `₩${Math.round(v / 10000).toLocaleString('ko-KR')}만`;
  return `₩${v.toLocaleString('ko-KR')}`;
}

/** 홈 목표 기여 막대 — 세그먼트 호버 시 상세(순마진·비중·목표·달성률) */
function HomeTargetAchievementSegHoverCard({
  label,
  amount,
  targetRevenue,
  displayPct,
  liveBarSharePct,
  vsPoolPct,
  vsPoolLabel,
  achievementPct
}) {
  const share = Number(liveBarSharePct);
  const shareText = Number.isFinite(share) ? `${share.toFixed(1)}%` : '—';
  const disp = displayPct == null || displayPct === '' ? '—' : `${displayPct}%`;
  const poolText = vsPoolPct == null ? '목표 미설정 또는 산출 불가' : `${vsPoolPct}%`;
  const achText = achievementPct == null ? '목표 미설정' : `${achievementPct}%`;
  return (
    <div className="home-contribution-seg-hover-card" role="tooltip">
      <div className="home-contribution-seg-hover-title">{label}</div>
      <dl className="home-contribution-seg-hover-dl">
        <div className="home-contribution-seg-hover-row">
          <dt>순마진</dt>
          <dd>{formatRevenueCompact(amount)}</dd>
        </div>
        <div className="home-contribution-seg-hover-row">
          <dt>막대 내 실적 비중</dt>
          <dd>{shareText}</dd>
        </div>
        <div className="home-contribution-seg-hover-row">
          <dt>순마진 비중(표시)</dt>
          <dd>{disp}</dd>
        </div>
        <div className="home-contribution-seg-hover-row">
          <dt>목표액</dt>
          <dd>{formatRevenueCompact(targetRevenue)}</dd>
        </div>
        <div className="home-contribution-seg-hover-row">
          <dt>{vsPoolLabel}</dt>
          <dd>{poolText}</dd>
        </div>
        <div className="home-contribution-seg-hover-row">
          <dt>팀/개인 목표 대비 달성률</dt>
          <dd>{achText}</dd>
        </div>
      </dl>
    </div>
  );
}

/** 원형(도넛) 기여도·비중 차트 */
const HOME_DONUT_COLORS = ['#facc15', '#9f1239', '#ea580c', '#14b8a6', '#2563eb', '#22c55e'];

/** 달성률·순마진 비중 — 제품군 목록과 동일하게 클릭 시 범례 팝오버 */
function buildHomeDonutLegendItems(segments) {
  const rowsRaw = (Array.isArray(segments) ? segments : []).map((seg, idx) => ({
    key: seg.id ?? `donut-${idx}`,
    label: seg.label || '구간',
    pct: Math.max(0, Number(seg.pct) || 0),
    amount: Math.max(0, Number(seg.amount) || 0),
    color: HOME_DONUT_COLORS[idx % HOME_DONUT_COLORS.length]
  }));
  const hasPositive = rowsRaw.some((seg) => seg.pct > 0 || seg.amount > 0);
  return hasPositive
    ? rowsRaw.filter((seg) => seg.pct > 0 || seg.amount > 0)
    : rowsRaw;
}

function HomeContributionDonutChart({
  segments,
  centerPrimary = '—',
  centerSecondary = '',
  ariaLabel = '원형 비중 차트'
}) {
  const rows = buildHomeDonutLegendItems(segments).map((seg) => ({
    id: seg.key,
    label: seg.label,
    pct: seg.pct,
    amount: seg.amount,
    color: seg.color
  }));
  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = 62;
  const stroke = 30;
  const circ = 2 * Math.PI * r;
  const pctSum = rows.reduce((s, x) => s + x.pct, 0);
  const norm = pctSum > 0 ? pctSum : 100;
  let offset = 0;

  return (
    <div className="home-donut-chart">
      <div className="home-donut-chart-visual" role="img" aria-label={ariaLabel}>
        <svg className="home-donut-svg" viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={stroke}
          />
          {rows.map((seg) => {
            const len = (seg.pct / norm) * circ;
            const dashOffset = -offset;
            offset += len;
            return (
              <circle
                key={String(seg.id)}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={stroke}
                strokeDasharray={`${Math.max(0, len)} ${Math.max(0, circ - len)}`}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${cx} ${cy})`}
              >
                <title>{`${seg.label} ${seg.pct}%`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="home-donut-center">
          <strong>{centerPrimary}</strong>
          {centerSecondary ? <span>{centerSecondary}</span> : null}
        </div>
      </div>
    </div>
  );
}

/** Forecast 표 — 예상 월(YYYY-MM) 표기 */
function formatForecastExpectedMonthCell(ym) {
  const s = String(ym || '').trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return '—';
  const [y, m] = s.split('-');
  return `${y}년 ${Number(m)}월`;
}

function renderSoftwareLabelCell(value) {
  const text = String(value || '').trim();
  if (!text) return '—';
  const items = text
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (items.length <= 1) return items[0] || '—';
  return (
    <span className="home-forecast-software-lines">
      {items.map((item, idx) => (
        <span key={`${item}-${idx}`} className="home-forecast-software-line">{item}</span>
      ))}
    </span>
  );
}

const HOME_FORECAST_MONTH_NONE = '__none__';

function filterHomeForecastRows(rows, filters) {
  const product = String(filters?.product || '').trim();
  const probStr = filters?.probability === '' || filters?.probability == null ? '' : String(filters.probability);
  const month = String(filters?.targetMonth || '').trim();
  if (!product && !probStr && !month) return rows;
  return rows.filter((row) => {
    if (product) {
      const tags = Array.isArray(row?.forecastProductNames) ? row.forecastProductNames : [];
      if (tags.length > 0) {
        if (!tags.includes(product)) return false;
      } else {
        const raw = String(row?.softwareLabel || '').trim();
        const parts = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
        const tokenMatch = parts.length ? parts.some((p) => p === product) : raw === product;
        if (!tokenMatch) return false;
      }
    }
    if (probStr !== '') {
      const p = Number(row?.probabilityPct);
      if (!Number.isFinite(p) || String(p) !== probStr) return false;
    }
    if (month) {
      const m = String(row?.targetMonth || '').trim();
      if (month === HOME_FORECAST_MONTH_NONE) {
        if (/^\d{4}-\d{2}$/.test(m)) return false;
      } else if (m !== month) return false;
    }
    return true;
  });
}

function buildHomeForecastProductOptions(rows) {
  const set = new Set();
  for (const row of rows) {
    const tags = Array.isArray(row?.forecastProductNames) ? row.forecastProductNames : [];
    if (tags.length > 0) {
      tags.forEach((t) => {
        if (t && t !== '—') set.add(t);
      });
      continue;
    }
    const raw = String(row?.softwareLabel || '').trim();
    if (!raw || raw === '—') continue;
    raw.split(',').forEach((chunk) => {
      const tt = String(chunk || '').trim();
      if (tt) set.add(tt);
    });
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
}

/** 제품 필터 선택 시 행·합계에 표시할 금액(복수 lineItems 분배 — 서버 forecast* 필드) */
function getForecastRowDisplayForProductFilter(row, productFilter) {
  const pf = String(productFilter || '').trim();
  const vm = row?.forecastValueByProduct && typeof row.forecastValueByProduct === 'object' ? row.forecastValueByProduct : null;
  if (!pf || !vm || vm[pf] == null) {
    return {
      softwareLabel: row.softwareLabel,
      unitPrice: Number(row?.unitPrice) || 0,
      quantity: Number(row?.quantity) || 0,
      finalPrice: Number(row?.finalPrice) || 0,
      forecastAmount: Number(row?.forecastAmount) || 0,
      contractAmount: Number(row?.contractAmount) || 0,
      invoiceAmount: Number(row?.invoiceAmount) || 0,
      collectedAmount: Number(row?.collectedAmount) || 0,
      marginAmount: Number(row?.marginAmount) || 0
    };
  }
  const full = Number(row?.finalPrice) || 0;
  const part = Number(vm[pf]) || 0;
  const ratio = full > 0 ? part / full : 0;
  const qm = row?.forecastQtyByProduct && typeof row.forecastQtyByProduct === 'object' ? row.forecastQtyByProduct : {};
  const um = row?.forecastUnitPriceByProduct && typeof row.forecastUnitPriceByProduct === 'object' ? row.forecastUnitPriceByProduct : {};
  let qty = qm[pf] != null ? Number(qm[pf]) : Math.round((Number(row?.quantity) || 0) * ratio);
  if (!Number.isFinite(qty)) qty = 0;
  let unitPrice = um[pf] != null ? Number(um[pf]) : 0;
  if (!unitPrice && qty > 0 && part > 0) unitPrice = Math.round(part / qty);
  return {
    softwareLabel: pf,
    unitPrice,
    quantity: qty,
    finalPrice: part,
    forecastAmount: Math.round((Number(row?.forecastAmount) || 0) * ratio),
    contractAmount: Math.round((Number(row?.contractAmount) || 0) * ratio),
    invoiceAmount: Math.round((Number(row?.invoiceAmount) || 0) * ratio),
    collectedAmount: Math.round((Number(row?.collectedAmount) || 0) * ratio),
    marginAmount: Math.round((Number(row?.marginAmount) || 0) * ratio)
  };
}

function sumForecastTotalsForRows(rows, productFilter) {
  const pf = String(productFilter || '').trim();
  return rows.reduce(
    (acc, row) => {
      const d = getForecastRowDisplayForProductFilter(row, pf);
      acc.unitPrice += d.unitPrice;
      acc.quantity += d.quantity;
      acc.finalPrice += d.finalPrice;
      acc.forecast += d.forecastAmount;
      acc.contract += d.contractAmount;
      acc.invoice += d.invoiceAmount;
      acc.collected += d.collectedAmount;
      acc.margin += d.marginAmount;
      return acc;
    },
    {
      unitPrice: 0,
      quantity: 0,
      finalPrice: 0,
      forecast: 0,
      contract: 0,
      invoice: 0,
      collected: 0,
      margin: 0
    }
  );
}

function buildHomeForecastProbabilityOptions(rows) {
  const set = new Set();
  for (const row of rows) {
    const p = Number(row?.probabilityPct);
    if (Number.isFinite(p)) set.add(p);
  }
  return [...set].sort((a, b) => a - b);
}

function buildHomeForecastTargetMonthMeta(rows) {
  const set = new Set();
  let hasNone = false;
  for (const row of rows) {
    const m = String(row?.targetMonth || '').trim();
    if (/^\d{4}-\d{2}$/.test(m)) set.add(m);
    else hasNone = true;
  }
  return { sortedMonths: [...set].sort(), hasNone };
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

function formatWonRevenue(w, dealBasRMap) {
  const krw = sumCurrencyBreakdownToKrw(w, dealBasRMap);
  return formatCurrency(krw, DASHBOARD_DISPLAY_CURRENCY);
}

/** 서버가 비교 기준이 없을 때 null/생략을 주는지 — 0을 임의로 넣어 비교한 값은 표시하지 않음 */
function homeKpiComparisonRawIsPresent(raw) {
  if (raw === undefined || raw === null) return false;
  if (typeof raw === 'string' && String(raw).trim() === '') return false;
  const n = Number(raw);
  return Number.isFinite(n);
}

/** 홈 상단 KPI — Forecast 비율(달성도) */
function formatHomeKpiForecastPct(pct) {
  if (!homeKpiComparisonRawIsPresent(pct)) return '—';
  const n = Number(pct);
  return `${Math.round(n)}%`;
}

/** 매출총이익률 등 — Forecast 대비(퍼센트포인트) */
function formatHomeKpiForecastPP(pp) {
  if (!homeKpiComparisonRawIsPresent(pp)) return '—';
  const n = Number(pp);
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%p`;
}

/** 전년·전월 등 증감률 + 방향(화살표용) */
function formatHomeKpiDeltaPct(pct, isPP) {
  if (!homeKpiComparisonRawIsPresent(pct)) return { text: '—', dir: null };
  const n = Number(pct);
  const dir = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  const body = (n > 0 ? '+' : '') + n.toFixed(1);
  return { text: isPP ? `${body}%p` : `${body}%`, dir };
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/** OS「모션 줄이기」— 감소 시 보간 시간 0 */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? true
      : false
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fn = () => setReduced(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return reduced;
}

/**
 * 인사이트 대시보드 `data`가 바뀔 때마다 증가 — 조회 범위·KPI 기간 전환 시 숫자/차트 보간 트리거
 * (fetch가 loading을 다시 켜지 않으므로 data 참조로만 감지)
 */
function useInsightAnimEpoch(data) {
  const [epoch, setEpoch] = useState(0);
  const lastRef = useRef(null);
  useEffect(() => {
    if (!data || lastRef.current === data) return;
    lastRef.current = data;
    setEpoch((e) => e + 1);
  }, [data]);
  return epoch;
}

function useAnimatedScalar(target, animEpoch, durationMs) {
  const safe = Number.isFinite(Number(target)) ? Number(target) : 0;
  const [display, setDisplay] = useState(safe);
  const displayRef = useRef(safe);
  displayRef.current = display;

  useEffect(() => {
    if (durationMs <= 0) {
      setDisplay(safe);
      return;
    }
    const from = displayRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now) => {
      const u = Math.min(1, (now - start) / durationMs);
      const e = easeOutCubic(u);
      setDisplay(from + (safe - from) * e);
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [safe, animEpoch, durationMs]);

  return display;
}

function useTweenedDualSeries(curA, curB, animEpoch, durationMs) {
  const norm = (s) => (Array.isArray(s) ? s : []);
  const [outA, setOutA] = useState(() => norm(curA));
  const [outB, setOutB] = useState(() => norm(curB));
  const pairRef = useRef({ a: outA, b: outB });
  pairRef.current = { a: outA, b: outB };

  useEffect(() => {
    const ta = norm(curA);
    const tb = norm(curB);
    if (durationMs <= 0) {
      setOutA(ta);
      setOutB(tb);
      return;
    }
    const { a: fa, b: fb } = pairRef.current;
    /** 새 집계 구간(주간↔반기 등) 버킷 수는 ta/tb 기준이어야 함. 이전 프레임(fa)이 더 길면 n을 늘리면 막대 개수가 남습니다. */
    const n = Math.max(ta.length, tb.length);
    const start = performance.now();
    let raf = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const e = easeOutCubic(t);
      const na = [];
      const nb = [];
      for (let i = 0; i < n; i += 1) {
        const va = Number(ta[i]?.value) || 0;
        const vb = Number(tb[i]?.value) || 0;
        const oa = i < fa.length ? Number(fa[i]?.value) || 0 : 0;
        const ob = i < fb.length ? Number(fb[i]?.value) || 0 : 0;
        na.push({
          label: String(ta[i]?.label ?? fa[i]?.label ?? ''),
          value: oa + (va - oa) * e
        });
        nb.push({
          label: String(tb[i]?.label ?? fb[i]?.label ?? ''),
          value: ob + (vb - ob) * e
        });
      }
      setOutA(na);
      setOutB(nb);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [curA, curB, animEpoch, durationMs]);

  return [outA, outB];
}

/** 통화별 합계 — 순마진 등 음수·0 구분 표시 */
function formatDashboardCurrencyTotals(w, dealBasRMap) {
  const krw = sumCurrencyBreakdownToKrw(w, dealBasRMap);
  return formatCurrency(krw, DASHBOARD_DISPLAY_CURRENCY);
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

/** 홈 인사이트 차트 — ref_home 톤 (blue / amber / purple / emerald / indigo) */
const CHART_VIVID_COLORS = [
  '#3b82f6', /* blue-500 */
  '#f59e0b', /* amber-500 */
  '#a855f7', /* purple-500 */
  '#10b981', /* emerald-500 */
  '#6366f1', /* indigo-500 */
  '#254deb', /* brand-600 */
  '#f97316', /* orange-500 */
  '#ec4899', /* pink-500 */
  '#14b8a6', /* teal-500 */
  '#64748b' /* slate-500 */
];
const CHART_VIVID_NEGATIVE = '#ef4444';

function chartColorAt(index) {
  return CHART_VIVID_COLORS[((index % CHART_VIVID_COLORS.length) + CHART_VIVID_COLORS.length) % CHART_VIVID_COLORS.length];
}

/** 막대 배경색 대비 — 밝으면 진한 글씨, 어두우면 흰 글씨 */
function contrastTextOnHex(bg) {
  const raw = String(bg || '').trim();
  const m = raw.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return '#ffffff';
  let hex = m[1];
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.58 ? '#0f172a' : '#ffffff';
}

/** 인사이트 4열 카드 — 막대·X축 라벨을 항상 한 줄(열 수 고정) */
function fixedInsightChartColumnsStyle(colCount) {
  const n = Number(colCount) || 0;
  if (n <= 0) return undefined;
  return { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };
}

function fixedInsightChartColumnsDenseClass(colCount) {
  return Number(colCount) > 0 ? ' home-mini-chart--dense-cols' : '';
}

function fixedInsightChartLabelsDenseClass(colCount) {
  return Number(colCount) > 0 ? ' home-bar-chart-labels--dense-cols' : '';
}

const CHART_CURSOR_TIP_GAP = 14;
const CHART_CURSOR_TIP_MARGIN = 12;

/** 마우스 근처 툴팁 — 우·하단 가장자리에서는 반대쪽으로 플립, 뷰포트 밖으로 나가지 않게 클램프 */
function clampHomeChartCursorTip(clientX, clientY, width, height) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  const margin = CHART_CURSOR_TIP_MARGIN;

  let left = clientX + CHART_CURSOR_TIP_GAP;
  let top = clientY + CHART_CURSOR_TIP_GAP;

  if (left + w + margin > vw) {
    left = clientX - w - CHART_CURSOR_TIP_GAP;
  }
  if (top + h + margin > vh) {
    top = clientY - h - CHART_CURSOR_TIP_GAP;
  }

  left = Math.max(margin, Math.min(left, Math.max(margin, vw - w - margin)));
  top = Math.max(margin, Math.min(top, Math.max(margin, vh - h - margin)));

  return { left, top };
}

/** 차트 호버 — 커서 근처 포털 툴팁(overflow·패널 z-index에 가리지 않음) */
function HomeChartCursorTooltipPortal({ open, chartTitle, children, clientX, clientY }) {
  const tipRef = useRef(null);
  const [pos, setPos] = useState(() =>
    clientX != null && clientY != null
      ? clampHomeChartCursorTip(clientX, clientY, 240, 72)
      : { left: -9999, top: -9999 }
  );

  useLayoutEffect(() => {
    if (!open || clientX == null || clientY == null || !tipRef.current) return;
    const el = tipRef.current;
    setPos(clampHomeChartCursorTip(clientX, clientY, el.offsetWidth, el.offsetHeight));
  }, [open, clientX, clientY, children, chartTitle]);

  if (!open || clientX == null || clientY == null || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={tipRef}
      className="home-chart-cursor-tooltip"
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      role="tooltip"
      aria-live="polite"
    >
      {chartTitle ? <p className="home-chart-cursor-tooltip__chart">{chartTitle}</p> : null}
      <div className="home-chart-cursor-tooltip__body">{children}</div>
    </div>,
    document.body
  );
}

function chartLineHoverZoneProps(idx, setHoverIdx, setCursor) {
  return {
    onMouseEnter: (e) => {
      setHoverIdx(idx);
      setCursor({ x: e.clientX, y: e.clientY });
    },
    onMouseMove: (e) => setCursor({ x: e.clientX, y: e.clientY }),
    onMouseLeave: () => {
      setHoverIdx(null);
      setCursor(null);
    }
  };
}

function HomeChartHoverTip({ chartTitle, tip, className, children }) {
  const [hover, setHover] = useState(false);
  const [cursor, setCursor] = useState(null);
  const trackCursor = useCallback((e) => {
    setCursor({ x: e.clientX, y: e.clientY });
  }, []);

  return (
    <>
      <div
        className={className}
        onMouseEnter={(e) => {
          setHover(true);
          trackCursor(e);
        }}
        onMouseMove={trackCursor}
        onMouseLeave={() => {
          setHover(false);
          setCursor(null);
        }}
      >
        {children}
      </div>
      <HomeChartCursorTooltipPortal
        open={hover}
        chartTitle={chartTitle}
        clientX={cursor?.x}
        clientY={cursor?.y}
      >
        {tip}
      </HomeChartCursorTooltipPortal>
    </>
  );
}

/** 제품군·수량 차트 — 가로 스크롤 칩 범례 (좁은 4열 레이아웃용) */
function HomeProductChartLegend({ items, colorAt = chartColorAt }) {
  const rows = Array.isArray(items) ? items : [];
  if (rows.length === 0) return null;
  return (
    <div className="home-product-chart-legend" role="list" aria-label="제품 범례">
      {rows.map((p, pi) => (
        <span key={String(p.key)} className="home-product-chart-legend-chip" role="listitem" title={p.label}>
          <span className="home-product-chart-legend-dot" style={{ backgroundColor: colorAt(pi) }} aria-hidden />
          <span className="home-product-chart-legend-label">{p.label}</span>
        </span>
      ))}
    </div>
  );
}

/** 제품 범례 — 아이콘 클릭 시 전체 목록 팝오버 */
function HomeProductLegendMenu({
  items,
  colorAt = chartColorAt,
  ariaLabel = '제품군 목록',
  title = '제품군 목록'
}) {
  const rows = Array.isArray(items) ? items : [];
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (rows.length === 0) return null;

  return (
    <div className="home-product-legend-menu" ref={rootRef}>
      <button
        type="button"
        className={`home-product-legend-menu-btn${open ? ' is-open' : ''}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="material-symbols-outlined" aria-hidden>
          list
        </span>
      </button>
      {open ? (
        <div className="home-product-legend-menu-panel" role="dialog" aria-label={title}>
          <div className="home-product-legend-menu-head">
            <strong>{title}</strong>
            <span className="home-product-legend-menu-count">{rows.length}개</span>
          </div>
          <ul className="home-product-legend-menu-list">
            {rows.map((p, pi) => (
              <li key={String(p.key ?? p.label ?? pi)} className="home-product-legend-menu-item">
                <span
                  className="home-product-legend-menu-dot"
                  style={{ backgroundColor: p.color || colorAt(pi) }}
                  aria-hidden
                />
                <span className="home-product-legend-menu-label">{p.label}</span>
                {p.pct != null && p.pct !== '' ? (
                  <span className="home-product-legend-menu-pct">{p.pct}%</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** 순마진: 올해·작년 동일 Y축 스케일 — ref emerald */
const MARGIN_LINE_CURRENT = '#059669';
const MARGIN_LINE_PREV = '#cbd5e1';
/** 소비자가 단일 꺾은선 — ref_home brand blue */
const CONSUMER_LINE_COLOR = '#254deb';
const CONSUMER_LINE_FILL = '#3b66f5';

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

/** 건수 등 비음수 시리즈: 0을 아래에 둠 */
function lineChartYFromBottom(value, maxAbs) {
  const { h, padYTop, padYBottom } = LINE_CHART_VB;
  const plotH = h - padYTop - padYBottom;
  const v = Number(value) || 0;
  const scale = Math.max(maxAbs, 1e-9);
  return Math.round(h - padYBottom - (v / scale) * plotH);
}

/**
 * 순마진·소비자가 꺾은선: 음수가 없으면 0=아래, 음수가 있을 때만 [min,max]에 맞춰 0선이 필요한 만큼 올라감 (항상 중앙 고정 아님)
 */
function lineChartExtentsFromSeries(seriesA, seriesB) {
  const vals = [...(Array.isArray(seriesA) ? seriesA : []), ...(Array.isArray(seriesB) ? seriesB : [])].map(
    (x) => Number(x?.value) || 0
  );
  if (vals.length === 0) return { hasNegative: false, vMin: 0, vMax: 1 };
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  if (rawMin >= 0) {
    return { hasNegative: false, vMin: 0, vMax: Math.max(1, rawMax) };
  }
  const range = rawMax - rawMin;
  const pad = range > 1e-9 ? range * 0.06 : Math.max(Math.abs(rawMin), Math.abs(rawMax), 1) * 0.08;
  return { hasNegative: true, vMin: rawMin - pad, vMax: rawMax + pad };
}

function lineChartYMargin(value, extents) {
  const { h, padYTop, padYBottom } = LINE_CHART_VB;
  const plotTop = padYTop;
  const plotBottom = h - padYBottom;
  const plotH = plotBottom - plotTop;
  const v = Number(value) || 0;
  if (!extents.hasNegative) {
    const scale = Math.max(extents.vMax, 1e-9);
    return Math.round(plotBottom - (v / scale) * plotH);
  }
  const span = Math.max(extents.vMax - extents.vMin, 1e-9);
  return Math.round(plotBottom - ((v - extents.vMin) / span) * plotH);
}

/**
 * 꺾은선(polyline) — 포인트를 직선으로만 연결.
 * 스플라인 보간 시 평탄 구간(동일 값)에서 곡선이 0선 아래로 내려가는 현상을 방지합니다.
 */
function buildLinePathD(series, getY) {
  if (!Array.isArray(series) || series.length === 0) return '';
  const n = series.length;
  const points = series.map((item, idx) => ({
    x: lineChartX(idx, n),
    y: getY(Number(item?.value) || 0)
  }));

  if (n === 1) {
    return `M${points[0].x},${points[0].y}`;
  }

  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < n; i += 1) {
    d += `L${points[i].x},${points[i].y}`;
  }
  return d;
}

/** 꺾은선 아래 영역 채움 (그라데이션용 path) */
function buildAreaPathD(series, getY, baselineY) {
  if (!Array.isArray(series) || series.length === 0) return '';
  const n = series.length;
  const points = series.map((item, idx) => ({
    x: lineChartX(idx, n),
    y: getY(Number(item?.value) || 0)
  }));
  let d = `M${points[0].x},${baselineY}L${points[0].x},${points[0].y}`;
  for (let i = 1; i < n; i += 1) {
    d += `L${points[i].x},${points[i].y}`;
  }
  d += `L${points[n - 1].x},${baselineY}Z`;
  return d;
}

function chartSeriesAllZero(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.length === 0 || arr.every((x) => Number(x?.value) === 0);
}

function startOfWeekMonday(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function formatShortMd(d) {
  try {
    return new Date(d).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
  } catch {
    return '';
  }
}

/**
 * 캡처 리드 receivedAt 기준 최근 numWeeks주(월요일 시작). 시계열은 왼쪽이 가장 오래된 주.
 */
function computeWeeklyLeadSeries(leads, numWeeks = 6) {
  const now = new Date();
  const list = Array.isArray(leads) ? leads : [];
  const thisMonday = startOfWeekMonday(now);
  const series = [];
  for (let i = 0; i < numWeeks; i++) {
    const ws = new Date(thisMonday);
    ws.setDate(thisMonday.getDate() - (numWeeks - 1 - i) * 7);
    const weFull = new Date(ws);
    weFull.setDate(ws.getDate() + 7);
    weFull.setMilliseconds(-1);
    const isCurrentWeek = i === numWeeks - 1;
    const upper = isCurrentWeek ? now : weFull;
    const t0 = ws.getTime();
    const t1 = upper.getTime();
    let count = 0;
    for (const lead of list) {
      const raw = lead?.receivedAt;
      if (raw == null) continue;
      const t = new Date(raw).getTime();
      if (!Number.isNaN(t) && t >= t0 && t <= t1) count += 1;
    }
    const label = `${formatShortMd(ws)}–${formatShortMd(upper)}`;
    series.push({ label, value: count });
  }
  return series;
}

/** 주간 리드 건수 단일 꺾은선 (순마진 차트와 동일 레이아웃·툴팁) */
function WeeklyLeadCountLineChart({ series, title }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const [cursor, setCursor] = useState(null);
  const cur = Array.isArray(series) ? series : [];
  const maxAbs = lineChartMaxAbs(cur, []);
  const getY = (v) => lineChartYFromBottom(v, maxAbs);
  const dCur = buildLinePathD(cur, getY);
  const stroke = MARGIN_LINE_CURRENT;

  return (
    <div className="home-line-chart-chart-block">
      <svg
        className="home-line-chart"
        viewBox={`0 0 ${LINE_CHART_VB.w} ${LINE_CHART_VB.h}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {dCur ? (
          <path
            className="home-line-stroke"
            d={dCur}
            fill="none"
            stroke={stroke}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {cur.map((item, idx) => {
          const x = lineChartX(idx, cur.length);
          const y = getY(Number(item?.value) || 0);
          return (
            <circle
              key={`${title}-lw-dot-${item.label}-${idx}`}
              cx={x}
              cy={y}
              r="5"
              fill={stroke}
              stroke="#fff"
              strokeWidth="1.5"
            />
          );
        })}
      </svg>
      <div className="home-line-chart-hover-zones" role="presentation">
        {cur.map((item, idx) => (
          <div
            key={`${title}-lw-hz-${item.label}-${idx}`}
            className="home-line-chart-hover-zone"
            {...chartLineHoverZoneProps(idx, setHoverIdx, setCursor)}
          />
        ))}
      </div>
      <HomeChartCursorTooltipPortal
        open={hoverIdx != null && cur[hoverIdx] != null}
        chartTitle={title}
        clientX={cursor?.x}
        clientY={cursor?.y}
      >
        {hoverIdx != null && cur[hoverIdx] ? (
          <>
            <strong>{cur[hoverIdx].label}</strong>
            <div>수신 {Number(cur[hoverIdx].value) || 0}건</div>
          </>
        ) : null}
      </HomeChartCursorTooltipPortal>
    </div>
  );
}

/** 올해·전년 이중 꺾은선 (순마진·소비자가 공용) */
function MarginLineChartWithTooltips({
  marginLineCurrent,
  marginLinePrev,
  currency,
  title,
  dealBasRMap = {},
  strokeCurrent = MARGIN_LINE_CURRENT,
  strokePrev = MARGIN_LINE_PREV,
  fillUnder = false,
  fillColor = CONSUMER_LINE_FILL,
  hollowMarkers = false,
  tipLastValue = false
}) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const [cursor, setCursor] = useState(null);
  const cur = marginLineCurrent;
  const prev = marginLinePrev;
  const extents = lineChartExtentsFromSeries(cur, prev);
  const getY = (v) => lineChartYMargin(v, extents);
  const dPrev = buildLinePathD(prev, getY);
  const dCur = buildLinePathD(cur, getY);
  const zeroY = lineChartYMargin(0, extents);
  const baselineY = extents.hasNegative ? zeroY : LINE_CHART_VB.h - LINE_CHART_VB.padYBottom;
  const dArea = fillUnder ? buildAreaPathD(cur, getY, baselineY) : '';
  const showZeroLine = extents.hasNegative && extents.vMin <= 0 && extents.vMax >= 0;
  const axisX1 = LINE_CHART_VB.padX;
  const axisX2 = LINE_CHART_VB.w - LINE_CHART_VB.padX;
  const gradId = `home-trend-fill-${String(title || 'chart').replace(/\W+/g, '-')}`;
  const lastIdx = cur.length > 0 ? cur.length - 1 : -1;
  const lastX = lastIdx >= 0 ? lineChartX(lastIdx, cur.length) : 0;
  const lastY = lastIdx >= 0 ? getY(Number(cur[lastIdx]?.value) || 0) : 0;
  const lastXPct = lastIdx >= 0 ? (lastX / LINE_CHART_VB.w) * 100 : 0;
  const lastYPct = lastIdx >= 0 ? (lastY / LINE_CHART_VB.h) * 100 : 0;
  // 끝점은 항상 왼쪽에 팁을 붙여 잘림/겹침 방지
  const lastTip =
    tipLastValue && lastIdx >= 0
      ? formatRevenueCompact(Number(cur[lastIdx]?.value) || 0)
      : '';
  const tipClassName = [
    'home-ref-trend-value-tip',
    'is-beside',
    lastYPct <= 22 ? 'is-top' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const tipStyle = lastTip
    ? { left: `${lastXPct}%`, top: `${lastYPct}%` }
    : undefined;
  const areaTopY = cur.reduce((minY, item) => {
    const y = getY(Number(item?.value) || 0);
    return Math.min(minY, y);
  }, baselineY);

  return (
    <div className="home-line-chart-chart-block">
      <svg
        className="home-line-chart"
        viewBox={`0 0 ${LINE_CHART_VB.w} ${LINE_CHART_VB.h}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {fillUnder && dArea ? (
          <defs>
            <linearGradient
              id={gradId}
              gradientUnits="userSpaceOnUse"
              x1="0"
              x2="0"
              y1={areaTopY}
              y2={baselineY}
            >
              <stop offset="0%" stopColor={fillColor} stopOpacity="0.55" />
              <stop offset="45%" stopColor={fillColor} stopOpacity="0.28" />
              <stop offset="100%" stopColor={fillColor} stopOpacity="0.06" />
            </linearGradient>
          </defs>
        ) : null}
        {showZeroLine ? (
          <line
            x1={axisX1}
            x2={axisX2}
            y1={zeroY}
            y2={zeroY}
            stroke="rgba(91, 124, 153, 0.2)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {dArea ? (
          <>
            <path
              className="home-line-area"
              d={dArea}
              stroke="none"
              style={{ fill: fillColor, fillOpacity: 0.2 }}
            />
            <path
              className="home-line-area"
              d={dArea}
              stroke="none"
              style={{ fill: `url(#${gradId})` }}
            />
          </>
        ) : null}
        {dPrev ? (
          <path
            className="home-line-stroke"
            d={dPrev}
            fill="none"
            stroke={strokePrev}
            strokeWidth="2.5"
            strokeDasharray="4 4"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {dCur ? (
          <path
            className="home-line-stroke"
            d={dCur}
            fill="none"
            stroke={strokeCurrent}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      {/* preserveAspectRatio=none 이면 SVG circle이 타원으로 찌그러져 HTML 원형 마커 사용 */}
      <div className="home-line-chart-markers" aria-hidden>
        {cur.map((item, idx) => {
          const x = lineChartX(idx, cur.length);
          const y = getY(Number(item?.value) || 0);
          const isLast = idx === lastIdx;
          return (
            <span
              key={`${title}-dot-${item.label}-${idx}`}
              className={`home-line-chart-marker${hollowMarkers ? ' is-hollow' : ''}${isLast && tipLastValue ? ' is-last' : ''}`}
              style={{
                left: `${(x / LINE_CHART_VB.w) * 100}%`,
                top: `${(y / LINE_CHART_VB.h) * 100}%`,
                color: strokeCurrent,
                borderColor:
                  hollowMarkers && !(isLast && tipLastValue) ? strokeCurrent : '#ffffff',
                backgroundColor:
                  hollowMarkers && !(isLast && tipLastValue) ? '#ffffff' : strokeCurrent
              }}
            />
          );
        })}
      </div>
      {lastTip ? (
        <div className={tipClassName} style={tipStyle}>
          {lastTip}
        </div>
      ) : null}
      <div className="home-line-chart-hover-zones" role="presentation">
        {cur.map((item, idx) => (
          <div
            key={`${title}-hz-${item.label}-${idx}`}
            className="home-line-chart-hover-zone"
            {...chartLineHoverZoneProps(idx, setHoverIdx, setCursor)}
          />
        ))}
      </div>
      <HomeChartCursorTooltipPortal
        open={hoverIdx != null && cur[hoverIdx] != null}
        chartTitle={title}
        clientX={cursor?.x}
        clientY={cursor?.y}
      >
        {hoverIdx != null && cur[hoverIdx] ? (
          <>
            <strong>{cur[hoverIdx].label}</strong>
            <div>올해: {formatCurrency(Number(cur[hoverIdx].value) || 0, DASHBOARD_DISPLAY_CURRENCY)}</div>
            <div>전년: {formatCurrency(prev[hoverIdx] != null ? Number(prev[hoverIdx].value) : 0, DASHBOARD_DISPLAY_CURRENCY)}</div>
          </>
        ) : null}
      </HomeChartCursorTooltipPortal>
    </div>
  );
}

/** 제품별 다중 꺾은선 — Y축 공통(순마진 차트와 동일 보간 규칙) */
function lineChartExtentsFromManySeries(seriesList) {
  const vals = [];
  for (const s of Array.isArray(seriesList) ? seriesList : []) {
    for (const x of Array.isArray(s) ? s : []) {
      vals.push(Number(x?.value) || 0);
    }
  }
  if (vals.length === 0) return { hasNegative: false, vMin: 0, vMax: 1 };
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  if (rawMin >= 0) {
    return { hasNegative: false, vMin: 0, vMax: Math.max(1, rawMax) };
  }
  const range = rawMax - rawMin;
  const pad = range > 1e-9 ? range * 0.06 : Math.max(Math.abs(rawMin), Math.abs(rawMax), 1) * 0.08;
  return { hasNegative: true, vMin: rawMin - pad, vMax: rawMax + pad };
}

function ProductSalesLinesChartWithTooltips({ products, currency, title, formatValue }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const [cursor, setCursor] = useState(null);
  const list = Array.isArray(products) ? products : [];
  const fmt =
    typeof formatValue === 'function'
      ? formatValue
      : (v) => formatCurrency(Number(v) || 0, currency);
  const seriesList = list.map((p) => (Array.isArray(p.series) ? p.series : []));
  const extents = lineChartExtentsFromManySeries(seriesList);
  const getY = (v) => lineChartYMargin(v, extents);
  const refSeries = list[0]?.series || [];
  const nPts = refSeries.length;
  const zeroY = lineChartYMargin(0, extents);
  const showZeroLine = extents.hasNegative && extents.vMin <= 0 && extents.vMax >= 0;
  const axisX1 = LINE_CHART_VB.padX;
  const axisX2 = LINE_CHART_VB.w - LINE_CHART_VB.padX;

  return (
    <div className="home-line-chart-chart-block">
      <svg
        className="home-line-chart"
        viewBox={`0 0 ${LINE_CHART_VB.w} ${LINE_CHART_VB.h}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {showZeroLine ? (
          <line
            x1={axisX1}
            x2={axisX2}
            y1={zeroY}
            y2={zeroY}
            stroke="rgba(91, 124, 153, 0.2)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {list.map((p, pi) => {
          const d = buildLinePathD(p.series, getY);
          if (!d) return null;
          const stroke = chartColorAt(pi);
          return (
            <path
              className="home-line-stroke"
              key={`${title}-prod-line-${p.key || pi}`}
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={nPts <= 3 ? 3 : 2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      <div className="home-line-chart-hover-zones" role="presentation">
        {refSeries.map((item, idx) => (
          <div
            key={`${title}-prod-hz-${item.label}-${idx}`}
            className="home-line-chart-hover-zone"
            {...chartLineHoverZoneProps(idx, setHoverIdx, setCursor)}
          />
        ))}
      </div>
      <HomeChartCursorTooltipPortal
        open={hoverIdx != null && refSeries[hoverIdx] != null}
        chartTitle={title}
        clientX={cursor?.x}
        clientY={cursor?.y}
      >
        {hoverIdx != null && refSeries[hoverIdx] ? (
          <>
            <strong>{refSeries[hoverIdx].label}</strong>
            {list.map((p, pi) => (
              <div key={`${String(p.key)}-${pi}-tip`}>
                {p.label}: {fmt(Number(p.series[hoverIdx]?.value) || 0)}
              </div>
            ))}
            <div className="home-product-sales-tooltip-sum">
              합계: {fmt(list.reduce((s, p) => s + (Number(p.series[hoverIdx]?.value) || 0), 0))}
            </div>
          </>
        ) : null}
      </HomeChartCursorTooltipPortal>
    </div>
  );
}

function productSalesInsightAllEmpty(products) {
  if (!Array.isArray(products) || products.length === 0) return true;
  return products.every((p) => chartSeriesAllZero(p.series));
}

function formatHomeProductQty(n) {
  const v = Math.round(Number(n) || 0);
  return `${v.toLocaleString('ko-KR')}개`;
}

/** 소비자가 전년 점선 — 순마진 전년과 동일 톤 */
const CONSUMER_LINE_PREV = MARGIN_LINE_PREV;

/** 회사 전체 — URL 동기화, 백엔드 insightScope=full (역할 무관) */
const HOME_INSIGHT_PARAM = 'homeInsight';
/** 팀장·관리자 «팀별 / 개인 보기» — 백엔드는 insightDept(팀) 또는 insightUser(개인)로 반영 */
const HOME_INSIGHT_VIEW_PARAM = 'homeInsightView';

/** 팀장 전용: 하위 부서·직원으로 인사이트 범위 좁히기 (백엔드 insightDept / insightUser) */
const HOME_INSIGHT_DEPT_PARAM = 'homeInsightDept';
const HOME_INSIGHT_USER_PARAM = 'homeInsightUser';

/** 홈 KPI 카드 집계 기간 — 백엔드 kpiPeriod (month|quarter|half|year). URL 없음 = 월간. 구값 week 는 월간으로 정리 */
const HOME_KPI_PERIOD_PARAM = 'kpiPeriod';

/** 홈에서 기회 추가 모달 — 세일즈 현황과 동일 쿼리 키(뒤로가기 시 닫힘) */
const HOME_OPP_MODAL_PARAM = 'oppModal';
const HOME_OPP_ID_PARAM = 'oppId';
const HOME_OPP_STAGE_PARAM = 'stage';

function normalizeHomeKpiPeriod(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'week') return 'month';
  if (['month', 'quarter', 'half', 'year'].includes(s)) return s;
  return 'month';
}

/** 홈 인사이트·KPI 기간 쿼리가 없을 때만 DB 템플릿으로 URL 복원(북마크·공유 URL은 유지) */
function isHomeInsightToolbarUrlEmpty(p) {
  return (
    !p.has(HOME_INSIGHT_PARAM) &&
    !p.has(HOME_INSIGHT_VIEW_PARAM) &&
    !p.has(HOME_INSIGHT_DEPT_PARAM) &&
    !p.has(HOME_INSIGHT_USER_PARAM) &&
    !p.has(HOME_KPI_PERIOD_PARAM)
  );
}

/** listTemplates.homeDashboard → URLSearchParams (뮤테이트) */
function applySavedHomeDashboardToSearchParams(p, hd, myCrmUserId) {
  if (!hd || typeof hd !== 'object') return;
  const kpi = normalizeHomeKpiPeriod(hd.kpiPeriod);
  if (kpi !== 'month') p.set(HOME_KPI_PERIOD_PARAM, kpi);
  else p.delete(HOME_KPI_PERIOD_PARAM);

  if (hd.companyWideInsight === true) {
    p.set(HOME_INSIGHT_PARAM, 'full');
    p.delete(HOME_INSIGHT_VIEW_PARAM);
    p.delete(HOME_INSIGHT_DEPT_PARAM);
    p.delete(HOME_INSIGHT_USER_PARAM);
    return;
  }
  p.delete(HOME_INSIGHT_PARAM);
  const kind = hd.leaderInsightViewKind === 'personal' ? 'personal' : 'team';
  if (kind === 'personal') {
    p.set(HOME_INSIGHT_VIEW_PARAM, 'personal');
    p.delete(HOME_INSIGHT_DEPT_PARAM);
    const uid = String(hd.insightUserId || '').trim() || String(myCrmUserId || '').trim();
    if (uid) p.set(HOME_INSIGHT_USER_PARAM, uid);
    else p.delete(HOME_INSIGHT_USER_PARAM);
  } else {
    p.set(HOME_INSIGHT_VIEW_PARAM, 'team');
    p.delete(HOME_INSIGHT_USER_PARAM);
    const did = String(hd.insightDeptId || '').trim();
    if (did) p.set(HOME_INSIGHT_DEPT_PARAM, did);
    else p.delete(HOME_INSIGHT_DEPT_PARAM);
  }
}

function resolveHomeKpiTargetPeriod(kpiPeriod, now = new Date()) {
  const year = Number(now.getFullYear()) || new Date().getFullYear();
  const month = (Number(now.getMonth()) || 0) + 1;
  if (kpiPeriod === 'year') {
    return { year, periodType: 'annual', periodValue: 1, periodLabel: '연간 목표' };
  }
  if (kpiPeriod === 'half') {
    return { year, periodType: 'semiannual', periodValue: month <= 6 ? 1 : 2, periodLabel: '반기 목표' };
  }
  if (kpiPeriod === 'quarter') {
    return { year, periodType: 'quarterly', periodValue: Math.ceil(month / 3), periodLabel: '분기 목표' };
  }
  return { year, periodType: 'monthly', periodValue: month, periodLabel: '월간 목표' };
}

function distributeEvenIntForHomeKpi(total, partCount) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  const p = Math.max(1, Math.floor(Number(partCount) || 1));
  const base = Math.floor(n / p);
  const rem = n - base * p;
  return Array.from({ length: p }, (_, idx) => base + (idx < rem ? 1 : 0));
}

function homeKpiTopDownFromAnnual(annual) {
  const annualValue = Math.max(0, Math.round(Number(annual) || 0));
  const semi = distributeEvenIntForHomeKpi(annualValue, 2);
  const quarter = [
    ...distributeEvenIntForHomeKpi(semi[0], 2),
    ...distributeEvenIntForHomeKpi(semi[1], 2)
  ];
  const month = [];
  for (let qi = 0; qi < 4; qi += 1) {
    month.push(...distributeEvenIntForHomeKpi(quarter[qi], 3));
  }
  return { annual: annualValue, semi, quarter, month };
}

function homeKpiBlockFromYearMatrix(matrix) {
  const monthly = Array.from({ length: 12 }, (_, idx) => {
    const hit = (Array.isArray(matrix?.monthly) ? matrix.monthly : []).find((row) => Number(row?.periodValue) === idx + 1);
    return Math.max(0, Math.round(Number(hit?.targetRevenue) || 0));
  });
  const quarter = Array.from({ length: 4 }, (_, idx) => {
    const hit = (Array.isArray(matrix?.quarterly) ? matrix.quarterly : []).find((row) => Number(row?.periodValue) === idx + 1);
    return Math.max(0, Math.round(Number(hit?.targetRevenue) || 0));
  });
  const semi = Array.from({ length: 2 }, (_, idx) => {
    const hit = (Array.isArray(matrix?.semiannual) ? matrix.semiannual : []).find((row) => Number(row?.periodValue) === idx + 1);
    return Math.max(0, Math.round(Number(hit?.targetRevenue) || 0));
  });
  return {
    annual: Math.max(0, Math.round(Number(matrix?.annual?.targetRevenue) || 0)),
    semi,
    quarter,
    month: monthly
  };
}

function homeKpiBlockHasStoredTarget(block) {
  return (
    Math.max(0, Math.round(Number(block?.annual) || 0)) > 0 ||
    (Array.isArray(block?.month) && block.month.some((value) => Math.max(0, Math.round(Number(value) || 0)) > 0))
  );
}

function homeKpiTargetValueFromBlock(block, period) {
  if (!block) return 0;
  if (period.periodType === 'annual') return Math.max(0, Math.round(Number(block.annual) || 0));
  if (period.periodType === 'semiannual') {
    return Math.max(0, Math.round(Number(block.semi?.[Number(period.periodValue) - 1]) || 0));
  }
  if (period.periodType === 'quarterly') {
    return Math.max(0, Math.round(Number(block.quarter?.[Number(period.periodValue) - 1]) || 0));
  }
  return Math.max(0, Math.round(Number(block.month?.[Number(period.periodValue) - 1]) || 0));
}

function normalizeHomeKpiUserId(user) {
  return String(user?.id || user?._id || '').trim();
}

function normalizeHomeKpiUserDept(user) {
  return String(user?.companyDepartment || user?.departmentId || user?.department || '').trim();
}

async function fetchHomeKpiYearMatrix(year, scopeType, scopeId = '') {
  const params = new URLSearchParams({
    year: String(year),
    scopeType
  });
  if (scopeType !== 'company') params.set('scopeId', String(scopeId || ''));
  const res = await fetch(`${API_BASE}/kpi/targets/year-matrix?${params.toString()}`, crmFetchInit());
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || '목표 정보를 불러오지 못했습니다.');
  return json;
}

const HOME_KPI_YEAR_MATRIX_TTL_MS = 60000;
const homeKpiYearMatrixCache = new Map();

async function fetchHomeKpiYearMatrixCached(year, scopeType, scopeId = '') {
  const key = `${year}|${scopeType}|${scopeId}`;
  const now = Date.now();
  const hit = homeKpiYearMatrixCache.get(key);
  if (hit?.data && now - hit.at < HOME_KPI_YEAR_MATRIX_TTL_MS) return hit.data;
  if (hit?.inflight) return hit.inflight;
  const inflight = fetchHomeKpiYearMatrix(year, scopeType, scopeId)
    .then((data) => {
      homeKpiYearMatrixCache.set(key, { at: Date.now(), data, inflight: null });
      return data;
    })
    .catch((err) => {
      homeKpiYearMatrixCache.delete(key);
      throw err;
    });
  homeKpiYearMatrixCache.set(key, { at: now, data: null, inflight });
  return inflight;
}

/** buildHomeKpiOrgAdjustedTargetResolver 가 짧은 간격으로 여러 번 불릴 때 overview 중복 호출 완화 */
let homeKpiOverviewCache = { at: 0, employees: null };
const HOME_KPI_OVERVIEW_TTL_MS = 12000;

const HOME_KPI_RESOLVER_TTL_MS = 15000;
let homeKpiResolverCache = { key: '', at: 0, resolver: null, inflight: null };

function homeKpiResolverCacheKey(period, filterUsers, filterDepartments) {
  const userIds = (Array.isArray(filterUsers) ? filterUsers : [])
    .map((u) => normalizeHomeKpiUserId(u))
    .filter(Boolean)
    .sort()
    .join(',');
  const deptIds = (Array.isArray(filterDepartments) ? filterDepartments : [])
    .map((d) => String(d?.id || '').trim())
    .filter(Boolean)
    .sort()
    .join(',');
  return `${period.year}|${period.periodType}|${period.periodValue}|${userIds}|${deptIds}`;
}

async function getHomeKpiOrgAdjustedTargetResolver(params) {
  const key = homeKpiResolverCacheKey(params.period, params.filterUsers, params.filterDepartments);
  const now = Date.now();
  if (
    homeKpiResolverCache.key === key &&
    homeKpiResolverCache.resolver &&
    now - homeKpiResolverCache.at < HOME_KPI_RESOLVER_TTL_MS
  ) {
    return homeKpiResolverCache.resolver;
  }
  if (homeKpiResolverCache.key === key && homeKpiResolverCache.inflight) {
    return homeKpiResolverCache.inflight;
  }
  const inflight = buildHomeKpiOrgAdjustedTargetResolver(params).then((resolver) => {
    homeKpiResolverCache = { key, at: Date.now(), resolver, inflight: null };
    return resolver;
  });
  homeKpiResolverCache = { key, at: now, resolver: null, inflight };
  return inflight;
}

async function fetchHomeKpiCurrentEmployees() {
  const now = Date.now();
  if (
    Array.isArray(homeKpiOverviewCache.employees) &&
    now - homeKpiOverviewCache.at < HOME_KPI_OVERVIEW_TTL_MS
  ) {
    return homeKpiOverviewCache.employees;
  }
  const res = await fetch(`${API_BASE}/companies/overview`, crmFetchInit());
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || '회사 직원 목록을 불러오지 못했습니다.');
  const list = Array.isArray(json?.employees) ? json.employees : [];
  homeKpiOverviewCache = { at: now, employees: list };
  return list;
}

async function buildHomeKpiOrgAdjustedTargetResolver({ period, filterUsers = [], filterDepartments = [] }) {
  const overviewEmployees = await fetchHomeKpiCurrentEmployees();
  const userById = new Map();
  [...overviewEmployees, ...(Array.isArray(filterUsers) ? filterUsers : [])].forEach((user) => {
    const id = normalizeHomeKpiUserId(user);
    if (!id) return;
    userById.set(id, { ...(userById.get(id) || {}), ...user, id });
  });
  const deptIds = Array.from(
    new Set([
      ...(Array.isArray(filterDepartments) ? filterDepartments : []).map((dept) => String(dept?.id || '').trim()),
      ...[...userById.values()].map((user) => normalizeHomeKpiUserDept(user))
    ].filter(Boolean))
  );
  const teamMatrixCache = new Map();
  const userMatrixCache = new Map();
  const deptMemberIds = (deptId) =>
    [...userById.values()]
      .filter((user) => normalizeHomeKpiUserDept(user) === String(deptId || '').trim())
      .map((user) => normalizeHomeKpiUserId(user))
      .filter(Boolean);
  const getTeamBlock = async (deptId) => {
    const id = String(deptId || '').trim();
    if (!id) return { annual: 0, semi: [0, 0], quarter: [0, 0, 0, 0], month: Array(12).fill(0) };
    if (!teamMatrixCache.has(id)) {
      teamMatrixCache.set(
        id,
        fetchHomeKpiYearMatrixCached(period.year, 'team', id).then(homeKpiBlockFromYearMatrix)
      );
    }
    return teamMatrixCache.get(id);
  };
  let companyBlockPromise = null;
  const getCompanyBlock = async () => {
    if (!companyBlockPromise) {
      companyBlockPromise = fetchHomeKpiYearMatrixCached(period.year, 'company', '').then(homeKpiBlockFromYearMatrix);
    }
    return companyBlockPromise;
  };
  const getUserBlock = async (userId) => {
    const id = String(userId || '').trim();
    if (!id) return { annual: 0, semi: [0, 0], quarter: [0, 0, 0, 0], month: Array(12).fill(0) };
    if (!userMatrixCache.has(id)) {
      userMatrixCache.set(id, (async () => {
        const stored = homeKpiBlockFromYearMatrix(await fetchHomeKpiYearMatrixCached(period.year, 'user', id));
        if (homeKpiBlockHasStoredTarget(stored)) return stored;
        const deptId = normalizeHomeKpiUserDept(userById.get(id));
        if (!deptId) return stored;
        const teamBlock = await getTeamBlock(deptId);
        const memberCount = Math.max(1, deptMemberIds(deptId).length || 1);
        return homeKpiTopDownFromAnnual(Math.floor((Number(teamBlock?.annual) || 0) / memberCount));
      })());
    }
    return userMatrixCache.get(id);
  };
  const getUserTarget = async (userId) => homeKpiTargetValueFromBlock(await getUserBlock(userId), period);
  const getTeamTarget = async (deptId) => {
    const teamBlock = await getTeamBlock(deptId);
    if (homeKpiBlockHasStoredTarget(teamBlock)) {
      return homeKpiTargetValueFromBlock(teamBlock, period);
    }
    const members = deptMemberIds(deptId);
    if (members.length > 0) {
      const values = await Promise.all(members.map((uid) => getUserTarget(uid).catch(() => 0)));
      return values.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
    }
    return homeKpiTargetValueFromBlock(teamBlock, period);
  };
  const getCompanyTarget = async (preferredDeptIds = []) => {
    const companyBlock = await getCompanyBlock();
    if (homeKpiBlockHasStoredTarget(companyBlock)) {
      return homeKpiTargetValueFromBlock(companyBlock, period);
    }
    const ids = Array.from(
      new Set((preferredDeptIds.length ? preferredDeptIds : deptIds).map((id) => String(id || '').trim()).filter(Boolean))
    );
    if (!ids.length) return 0;
    const values = await Promise.all(ids.map((id) => getTeamTarget(id).catch(() => 0)));
    return values.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  };
  return { getUserTarget, getTeamTarget, getCompanyTarget };
}

function formatLeaderEmployeeOptionLabel(u, departments) {
  const deptLabel = (departments || []).find((d) => d.id === u.departmentId)?.label;
  if (deptLabel) return `${u.name} (${deptLabel})`;
  return u.name;
}

/** 대시보드 응답 메타 — diff 시 제외 후 마지막에 덮어씀 */
const DASHBOARD_RESPONSE_META_KEYS = new Set([
  'dashboardCacheHit',
  'dashboardStale',
  'dashboardCacheKey',
  'dashboardFingerprint'
]);

const HOME_DASHBOARD_LOCAL_CACHE_PREFIX = `crm_home_dashboard_snapshot_v2_${String(import.meta.env.VITE_APP_BUILD_ID || 'dev')}_`;
const HOME_DASHBOARD_LOCAL_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

function getHomeDashboardLocalCacheOwnerKey() {
  try {
    const u = getStoredCrmUser();
    const companyId = String(u?.companyId || u?.company?._id || u?.companyName || 'global').trim();
    const userId = String(u?._id || u?.id || u?.email || 'anonymous').trim();
    return `${companyId || 'global'}:${userId || 'anonymous'}`;
  } catch {
    return 'global:anonymous';
  }
}

function encodeHomeDashboardLocalCachePart(value) {
  try {
    return btoa(unescape(encodeURIComponent(String(value || '')))).replace(/=+$/g, '');
  } catch {
    return String(value || '').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 180);
  }
}

function buildHomeDashboardLocalCacheKey(queryString) {
  const raw = [
    API_BASE,
    getHomeDashboardLocalCacheOwnerKey(),
    String(queryString || '')
  ].join('|');
  return `${HOME_DASHBOARD_LOCAL_CACHE_PREFIX}${encodeHomeDashboardLocalCachePart(raw)}`;
}

function slimHomeDashboardLocalCachePayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const copy = { ...payload };
  delete copy.kpiWonExplain;
  delete copy.kpiCollectedExplain;
  delete copy.leaderScopeBreakdown;
  copy.forecastPipelineRows = Array.isArray(copy.forecastPipelineRows)
    ? copy.forecastPipelineRows.slice(0, HOME_FORECAST_PREVIEW_MAX)
    : [];
  copy.dashboardLocalCache = true;
  copy.dashboardLocalCachedAt = new Date().toISOString();
  copy.dashboardStale = true;
  return copy;
}

function readHomeDashboardLocalCache(cacheKey) {
  if (!cacheKey) return null;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const cachedAt = Number(parsed?.cachedAt);
    if (!cachedAt || Date.now() - cachedAt > HOME_DASHBOARD_LOCAL_CACHE_MAX_AGE_MS) {
      localStorage.removeItem(cacheKey);
      return null;
    }
    const payload = parsed?.payload;
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function writeHomeDashboardLocalCache(cacheKey, payload) {
  if (!cacheKey) return;
  try {
    const slim = slimHomeDashboardLocalCachePayload(payload);
    if (!slim) return;
    localStorage.setItem(cacheKey, JSON.stringify({ cachedAt: Date.now(), payload: slim }));
  } catch (_) {
    try {
      localStorage.removeItem(cacheKey);
    } catch (_) { }
  }
}

function clearHomeDashboardLocalCaches() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(HOME_DASHBOARD_LOCAL_CACHE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch (_) { }
}

/** stale 캐시 응답이면 정밀 재조회 생략 가능(구형 필드 누락 시 false) */
function isHomeStaleDashboardPayloadComplete(j1) {
  if (!j1 || typeof j1 !== 'object') return false;
  const fr = j1.forecastPipelineRows;
  const forecastMetaOk =
    !Array.isArray(fr) ||
    fr.length === 0 ||
    (fr[0] && Object.prototype.hasOwnProperty.call(fr[0], 'forecastProductNames'));
  const ps = j1.productSalesGraphs;
  const productSalesQtyOk =
    ps != null && typeof ps === 'object' && Array.isArray(ps.quantityByProduct);
  /** 구형 회사 캐시는 kpiCollectedExplain 없이도 “완전”으로 판정되어 정밀 재조회가 끊기면 수금 모달 목록이 비게 됨 */
  const collectedExplainOk =
    j1.kpiCollectedExplain != null &&
    typeof j1.kpiCollectedExplain === 'object' &&
    Object.prototype.hasOwnProperty.call(j1.kpiCollectedExplain, 'rows');
  return (
    j1.dashboardCacheHit &&
    !j1.dashboardStale &&
    j1.productSalesGraphs != null &&
    typeof j1.productSalesGraphs === 'object' &&
    productSalesQtyOk &&
    forecastMetaOk &&
    collectedExplainOk
  );
}

/** 정밀 조회 결과에서 이전과 다른 최상위 키만 병합(불필요한 전체 리렌더 완화) */
function homeDashboardPayloadDiffPatch(prev, next) {
  if (!next) return prev;
  if (!prev) return next;
  const patch = {};
  for (const key of Object.keys(next)) {
    if (DASHBOARD_RESPONSE_META_KEYS.has(key)) continue;
    let changed = false;
    try {
      changed = JSON.stringify(prev[key]) !== JSON.stringify(next[key]);
    } catch (_) {
      changed = true;
    }
    if (changed) patch[key] = next[key];
  }
  const meta = {};
  for (const k of DASHBOARD_RESPONSE_META_KEYS) {
    if (Object.prototype.hasOwnProperty.call(next, k)) meta[k] = next[k];
  }
  const merged = Object.keys(patch).length === 0 ? { ...prev, ...meta } : { ...prev, ...patch, ...meta };
  // next에 없는 키는 이전 필터 잔존값으로 남지 않게 제거
  for (const key of Object.keys(merged)) {
    if (DASHBOARD_RESPONSE_META_KEYS.has(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(next, key)) delete merged[key];
  }
  return merged;
}

export default function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const homeProjectCurrentUser = useMemo(() => {
    try {
      const raw = localStorage.getItem('crm_user');
      const user = raw ? JSON.parse(raw) : null;
      if (!user) return null;
      return {
        _id: user.id || user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar || ''
      };
    } catch {
      return null;
    }
  }, []);
  const [data, setData] = useState(null);
  const dataRef = useRef(null);
  dataRef.current = data;
  const [loading, setLoading] = useState(true);
  const { dealBasRMap, exchangeRatesFrozen } = useExchangeRates({
    getAuthHeader,
    respectSessionFreeze: true
  });
  /** 필터·기간만 바꿀 때: 전역 스켈레톤 대신 툴바 옆 경량 표시 */
  const [dashboardDataBusy, setDashboardDataBusy] = useState(false);
  const [leadChannelsLoading, setLeadChannelsLoading] = useState(true);
  /** 캡처 채널별 수신 리드 (receivedAt 오름차순 = 가장 오래된 것부터) */
  const [recentCaptureLeads, setRecentCaptureLeads] = useState([]);
  /** GET /reports/home-pipeline-summary — 단계별 count·total, wonLeaderboard */
  const [pipelineSummary, setPipelineSummary] = useState(null);
  const [stageDefinitions, setStageDefinitions] = useState([]);
  const [pipelineLoading, setPipelineLoading] = useState(true);
  /** 인사이트 그래프: 막대 | 꺾은선 — User.listTemplates.homeDashboard 와 동기 */
  const savedHomeDashInit = getSavedHomeDashboardTemplate();
  const [consumerChartMode, setConsumerChartMode] = useState(() =>
    savedHomeDashInit?.consumerChartMode === 'line' || savedHomeDashInit?.consumerChartMode === 'bar'
      ? savedHomeDashInit.consumerChartMode
      : 'bar'
  );
  const [marginChartMode, setMarginChartMode] = useState(() =>
    savedHomeDashInit?.marginChartMode === 'line' || savedHomeDashInit?.marginChartMode === 'bar'
      ? savedHomeDashInit.marginChartMode
      : 'line'
  );
  /** 제품군 판매 — 월간 KPI에서는 제품별 추세를 보기 쉬워 꺾은선 기본(저장값 우선) */
  const [productChartMode, setProductChartMode] = useState(() => {
    if (savedHomeDashInit?.productChartMode === 'line' || savedHomeDashInit?.productChartMode === 'bar') {
      return savedHomeDashInit.productChartMode;
    }
    const kp = String(savedHomeDashInit?.kpiPeriod || '').trim().toLowerCase();
    return kp === 'month' ? 'line' : 'bar';
  });
  const [quantityChartMode, setQuantityChartMode] = useState(() => {
    if (savedHomeDashInit?.quantityChartMode === 'line' || savedHomeDashInit?.quantityChartMode === 'bar') {
      return savedHomeDashInit.quantityChartMode;
    }
    const kp = String(savedHomeDashInit?.kpiPeriod || '').trim().toLowerCase();
    return kp === 'month' ? 'line' : 'bar';
  });
  /** 홈 캡처 채널 주간 리드: 꺾은선 기본, 막대 옵션 (순마진 그래프와 동일 토글 UX) */
  const [leadChannelChartMode, setLeadChannelChartMode] = useState('line');
  /** 홈 수신 리드: 완료 숨김(permanent) · 1주 스누즈(snoozed ISO) */
  const [leadHomeVisibility, setLeadHomeVisibility] = useState(() =>
    loadHomeCaptureLeadVisibility(getLeadVisibilityUserKey())
  );
  const [sharedCompletedLeadMap, setSharedCompletedLeadMap] = useState(() => loadSharedCompletedLeadMap());
  const [leadDetailOpen, setLeadDetailOpen] = useState(false);
  const [leadDetailContext, setLeadDetailContext] = useState(null);
  const pipelineMounted = useRef(true);
  /**
   * 인사이트 영역: 토큰·로컬 crm_user 로 즉시 checked 해제해 대시보드 요청을 앞당김.
   * seniorPlus 는 /auth/me 수신 시 서버 역할로 다시 맞춤(역할 변경·만료 토큰은 서버가 권한).
   */
  const [insightAccess, setInsightAccess] = useState(() => {
    try {
      const token = typeof localStorage !== 'undefined' ? getCrmToken() : '';
      if (!token) return { checked: true, seniorPlus: false };
      return { checked: true, seniorPlus: isAdminOrAboveRole(getStoredCrmUser()?.role) };
    } catch {
      return { checked: true, seniorPlus: false };
    }
  });
  const insightDeptQ = String(searchParams.get(HOME_INSIGHT_DEPT_PARAM) || '').trim();
  const insightUserQ = String(searchParams.get(HOME_INSIGHT_USER_PARAM) || '').trim();
  const kpiPeriod = normalizeHomeKpiPeriod(searchParams.get(HOME_KPI_PERIOD_PARAM));
  const isCompanyWideInsight = String(searchParams.get(HOME_INSIGHT_PARAM) || '').toLowerCase() === 'full';
  const leaderInsightViewKind =
    String(searchParams.get(HOME_INSIGHT_VIEW_PARAM) || 'team').toLowerCase() === 'personal'
      ? 'personal'
      : 'team';
  const myCrmUserId = String(getStoredCrmUser()?._id || '').trim();
  const homeOppModalMode = String(searchParams.get(HOME_OPP_MODAL_PARAM) || '').trim();
  const homeOppEditId = String(searchParams.get(HOME_OPP_ID_PARAM) || '').trim();
  const homeOppStageQ = String(searchParams.get(HOME_OPP_STAGE_PARAM) || '').trim();
  const isHomeOppModalOpen = homeOppModalMode === 'add' || homeOppModalMode === 'edit';
  /** 홈 운영 허브 표 탭 — forecast | completed | team */
  const [homeDealsHubTab, setHomeDealsHubTab] = useState('forecast');
  const [homeTargetContributionBar, setHomeTargetContributionBar] = useState(null);
  /** 기여 막대 계산 방식 모달 — { kind: 'target'|'share', mode: 'team'|'user' } */
  const [homeContributionCalcModal, setHomeContributionCalcModal] = useState(null);
  const [homeKpiExplainSpec, setHomeKpiExplainSpec] = useState(null);
  const [homeKpiTargetSnapshot, setHomeKpiTargetSnapshot] = useState({
    loading: false,
    periodLabel: '',
    reason: '',
    target: null
  });
  /** 대시보드 /reports/dashboard 재조회(기회 저장 등) */
  const [dashboardRefreshTick, setDashboardRefreshTick] = useState(0);
  const openSalesOpportunityFromKpiExplain = useCallback(
    (oppId) => {
      const id = String(oppId || '').trim();
      if (!id) return;
      setHomeKpiExplainSpec(null);
      navigate(`/sales-pipeline?oppModal=edit&oppId=${encodeURIComponent(id)}`);
    },
    [navigate]
  );
  const [homeProjectModalOpen, setHomeProjectModalOpen] = useState(false);
  const [homeProjectModalLoading, setHomeProjectModalLoading] = useState(false);
  const [homeProjectEditing, setHomeProjectEditing] = useState(null);
  const [homeProjectSaving, setHomeProjectSaving] = useState(false);
  const [homeProjectTeamMembers, setHomeProjectTeamMembers] = useState([]);
  const [homeProjectCompanyContext, setHomeProjectCompanyContext] = useState({
    name: '',
    businessNumber: '',
    driveRootUrl: ''
  });

  const fetchHomeProjectParticipantContext = useCallback(async () => {
    try {
      const headers = getAuthHeader();
      const [teamRes, overviewRes] = await Promise.all([
        fetch(`${API_BASE}/calendar-events/team-members`, { headers }),
        fetch(`${API_BASE}/companies/overview`, { headers })
      ]);
      const teamData = await teamRes.json().catch(() => ({}));
      const overviewData = await overviewRes.json().catch(() => ({}));
      const merged = buildParticipantDirectoryFromOverview(
        Array.isArray(teamData?.members) ? teamData.members : [],
        overviewData && typeof overviewData === 'object' ? overviewData : null
      );
      setHomeProjectTeamMembers(merged);
      setHomeProjectCompanyContext({
        name: String(overviewData?.company?.name || '').trim(),
        businessNumber: String(overviewData?.company?.businessNumber || '').trim(),
        driveRootUrl: String(overviewData?.company?.driveRootUrl || '').trim()
      });
    } catch {
      setHomeProjectTeamMembers([]);
      setHomeProjectCompanyContext({ name: '', businessNumber: '', driveRootUrl: '' });
    }
  }, []);

  const openProjectFromKpiExplain = useCallback(
    async (projectId) => {
      const id = String(projectId || '').trim();
      if (!id) return;
      setHomeKpiExplainSpec(null);
      setHomeProjectModalOpen(true);
      setHomeProjectModalLoading(true);
      setHomeProjectEditing(null);
      pingBackendHealth(getAuthHeader).catch(() => {});
      try {
        const [boardRes] = await Promise.all([
          fetch(`${API_BASE}/projects/board?projectId=${encodeURIComponent(id)}`, crmFetchInit()),
          fetchHomeProjectParticipantContext()
        ]);
        const data = await boardRes.json().catch(() => ({}));
        if (!boardRes.ok) throw new Error(data.error || '프로젝트를 불러오지 못했습니다.');
        let item = null;
        for (const col of data.kanban?.columns || []) {
          for (const it of col.items || []) {
            if (String(it?._id || '') === id) {
              item = it;
              break;
            }
          }
          if (item) break;
        }
        if (!item) throw new Error('프로젝트를 찾을 수 없습니다.');
        setHomeProjectEditing(item);
      } catch (e) {
        window.alert(e.message || '프로젝트를 불러오지 못했습니다.');
        setHomeProjectModalOpen(false);
      } finally {
        setHomeProjectModalLoading(false);
      }
    },
    [fetchHomeProjectParticipantContext]
  );

  const closeHomeProjectModal = useCallback(() => {
    if (homeProjectSaving) return;
    setHomeProjectModalOpen(false);
    setHomeProjectModalLoading(false);
    setHomeProjectEditing(null);
  }, [homeProjectSaving]);

  const handleSaveHomeProject = useCallback(
    async (payload) => {
      const proj = homeProjectEditing;
      if (!proj?._id) return;
      setHomeProjectSaving(true);
      try {
        const isLegacyTask = proj?.entityType === 'legacyTask' && proj?.sourceProjectId;
        let path = `${API_BASE}/projects`;
        let method = 'POST';
        if (isLegacyTask) {
          path = `${API_BASE}/projects/${encodeURIComponent(proj.sourceProjectId)}/tasks/${encodeURIComponent(proj._id)}`;
          method = 'PATCH';
        } else {
          path = `${API_BASE}/projects/${encodeURIComponent(proj._id)}`;
          method = 'PATCH';
        }
        const res = await fetch(path, {
          method,
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '프로젝트 저장에 실패했습니다.');
        setHomeProjectModalOpen(false);
        setHomeProjectEditing(null);
        clearHomeDashboardLocalCaches();
        setDashboardRefreshTick((t) => t + 1);
      } catch (err) {
        window.alert(err.message || '프로젝트 저장에 실패했습니다.');
      } finally {
        setHomeProjectSaving(false);
      }
    },
    [homeProjectEditing]
  );

  /** 틱이 막 올랐을 때만 스테일 1단계 생략(틱>0 고정이면 필터 변경 시에도 스테일이 막히는 문제 방지) */
  const lastHandledDashboardRefreshTickRef = useRef(0);
  /** 필터 전환 레이스 — 이전 요청 응답이 새 필터 UI를 덮지 않게 */
  const dashboardFetchGenRef = useRef(0);
  const [homeForecastActiveFilters, setHomeForecastActiveFilters] = useState({
    product: '',
    probability: '',
    targetMonth: ''
  });
  const [homeForecastCompletedFilters, setHomeForecastCompletedFilters] = useState({
    product: '',
    probability: '',
    targetMonth: ''
  });
  const [homeForecastColumnWidths, setHomeForecastColumnWidths] = useState(() =>
    getHomeForecastColumnWidthsFromUser(getSavedHomeDashboardTemplate())
  );
  /** 홈 KPI — 프로젝트 카드 (/api/projects, 완료 후 진행 순) */
  const [homeProjectPreview, setHomeProjectPreview] = useState([]);
  const [homeProjectPreviewLoading, setHomeProjectPreviewLoading] = useState(false);
  /** 프로젝트 달성률 막대 보간 — 목록 fetch 시에도 반영 */
  const [projectBarAnimEpoch, setProjectBarAnimEpoch] = useState(0);
  const homeDashboardToolbarPersistTimerRef = useRef(null);
  /** /auth/me 반영 후 listTemplates→URL 1회 적용 완료 전에는 persist 금지(기본 URL로 DB 덮어쓰기 방지) */
  const [homeInsightToolbarTemplateReady, setHomeInsightToolbarTemplateReady] = useState(false);
  const consumerChartTitle = useMemo(() => {
    const labelMap = {
      month: '월간',
      quarter: '분기',
      half: '반기',
      year: '연간'
    };
    return `${labelMap[kpiPeriod] || '월간'}별 매출액`;
  }, [kpiPeriod]);

  useEffect(() => {
    let cancelled = false;
    const token = getCrmToken();
    if (!token) {
      setInsightAccess({ checked: true, seniorPlus: false });
      return undefined;
    }
    fetch(`${API_BASE}/auth/me`, { headers: { ...getCrmAuthHeaders() } })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        if (data?.user) {
          try {
            localStorage.setItem('crm_user', JSON.stringify(data.user));
          } catch (_) { }
          const hd = data.user.listTemplates?.homeDashboard;
          if (hd && typeof hd === 'object') {
            if (hd.consumerChartMode === 'bar' || hd.consumerChartMode === 'line') {
              setConsumerChartMode(hd.consumerChartMode);
            }
            if (hd.marginChartMode === 'bar' || hd.marginChartMode === 'line') {
              setMarginChartMode(hd.marginChartMode);
            }
            if (hd.productChartMode === 'bar' || hd.productChartMode === 'line') {
              setProductChartMode(hd.productChartMode);
            }
            if (hd.quantityChartMode === 'bar' || hd.quantityChartMode === 'line') {
              setQuantityChartMode(hd.quantityChartMode);
            }
            if (hd.forecastColumnWidths && typeof hd.forecastColumnWidths === 'object') {
              setHomeForecastColumnWidths({ ...hd.forecastColumnWidths });
            }
          }
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
    let cancelled = false;
    const token = getCrmToken();
    if (!token) {
      setHomeProjectPreview([]);
      setHomeProjectPreviewLoading(false);
      return undefined;
    }
    setHomeProjectPreviewLoading(true);
    pingBackendHealth(getAuthHeader).catch(() => { });
    fetch(`${API_BASE}/projects`, crmFetchInit())
      .then((r) => r.json().catch(() => ({})))
      .then((payload) => {
        if (cancelled) return;
        const rows = Array.isArray(payload?.projects) ? payload.projects : [];
        const byUpdated = (a, b) => {
          const ta = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
          const tb = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
          return tb - ta;
        };
        const done = rows.filter((p) => String(p?.stage || '') === 'done').sort(byUpdated);
        const active = rows.filter((p) => String(p?.stage || '') !== 'done').sort(byUpdated);
        setHomeProjectPreview([...done, ...active]);
      })
      .catch(() => {
        if (!cancelled) setHomeProjectPreview([]);
      })
      .finally(() => {
        if (!cancelled) setHomeProjectPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dashboardRefreshTick]);

  useEffect(() => {
    setProjectBarAnimEpoch((e) => e + 1);
  }, [homeProjectPreview]);

  const closeHomeOppModal = useCallback(() => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete(HOME_OPP_MODAL_PARAM);
        p.delete(HOME_OPP_ID_PARAM);
        p.delete(HOME_OPP_STAGE_PARAM);
        return p;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const setCompanyWideInsight = useCallback(
    (enable) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (enable) {
            p.set(HOME_INSIGHT_PARAM, 'full');
            p.delete(HOME_INSIGHT_VIEW_PARAM);
            p.delete(HOME_INSIGHT_DEPT_PARAM);
            p.delete(HOME_INSIGHT_USER_PARAM);
          } else {
            p.delete(HOME_INSIGHT_PARAM);
            if (!p.get(HOME_INSIGHT_VIEW_PARAM)) p.set(HOME_INSIGHT_VIEW_PARAM, 'team');
          }
          return p;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setLeaderInsightViewKind = useCallback(
    (kind) => {
      const next = kind === 'personal' ? 'personal' : 'team';
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.delete(HOME_INSIGHT_PARAM);
          if (next === 'team') {
            p.set(HOME_INSIGHT_VIEW_PARAM, 'team');
            p.delete(HOME_INSIGHT_USER_PARAM);
          } else {
            p.set(HOME_INSIGHT_VIEW_PARAM, 'personal');
            p.delete(HOME_INSIGHT_DEPT_PARAM);
            const uid = String(getStoredCrmUser()?._id || '').trim();
            if (uid) p.set(HOME_INSIGHT_USER_PARAM, uid);
          }
          return p;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setHomeInsightDeptFilter = useCallback(
    (deptId) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.delete(HOME_INSIGHT_PARAM);
          p.set(HOME_INSIGHT_VIEW_PARAM, 'team');
          const v = String(deptId || '').trim();
          if (!v) p.delete(HOME_INSIGHT_DEPT_PARAM);
          else p.set(HOME_INSIGHT_DEPT_PARAM, v);
          p.delete(HOME_INSIGHT_USER_PARAM);
          return p;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setHomeInsightUserFilter = useCallback(
    (userId) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.delete(HOME_INSIGHT_PARAM);
          p.set(HOME_INSIGHT_VIEW_PARAM, 'personal');
          const v = String(userId || '').trim();
          if (!v) p.delete(HOME_INSIGHT_USER_PARAM);
          else p.set(HOME_INSIGHT_USER_PARAM, v);
          p.delete(HOME_INSIGHT_DEPT_PARAM);
          return p;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setHomeKpiPeriod = useCallback(
    (period) => {
      const next = normalizeHomeKpiPeriod(period);
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === 'month') p.delete(HOME_KPI_PERIOD_PARAM);
          else p.set(HOME_KPI_PERIOD_PARAM, next);
          return p;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const handleConsumerChartModeChange = useCallback((next) => {
    setConsumerChartMode(next);
    patchHomeDashboardTemplate({ consumerChartMode: next }).catch(() => { });
  }, []);

  const handleMarginChartModeChange = useCallback((next) => {
    setMarginChartMode(next);
    patchHomeDashboardTemplate({ marginChartMode: next }).catch(() => { });
  }, []);

  const handleProductChartModeChange = useCallback((next) => {
    setProductChartMode(next);
    patchHomeDashboardTemplate({ productChartMode: next }).catch(() => { });
  }, []);

  const handleQuantityChartModeChange = useCallback((next) => {
    setQuantityChartMode(next);
    patchHomeDashboardTemplate({ quantityChartMode: next }).catch(() => { });
  }, []);

  /** 사이드바 로고 클릭 — URL·모달 초기화 후 저장된 홈 대시보드 템플릿으로 복원 */
  useEffect(() => {
    if (!location.state?.sidebarHome) return;
    setHomeInsightToolbarTemplateReady(false);
    setHomeKpiExplainSpec(null);
    setHomeContributionCalcModal(null);
    setHomeProjectModalOpen(false);
    setHomeProjectEditing(null);
    setSearchParams({}, { replace: true });
    navigate('/dashboard', { replace: true, state: {} });
  }, [location.state?.sidebarHome, navigate, setSearchParams]);

  /**
   * URL에 인사이트·기간 쿼리가 없으면 listTemplates.homeDashboard 로 URL 복원.
   * 사이드바 로고는 state.sidebarHome 으로 쿼리를 비운 뒤 이 effect가 다시 적용됩니다.
   * 빈 URL로 복원할 때는 persist 가 기본값으로 DB를 덮지 않도록 ready 를 false 로 둠.
   */
  useEffect(() => {
    if (!insightAccess.checked) return undefined;
    const hd = getSavedHomeDashboardTemplate();
    const p = new URLSearchParams(searchParams);
    if (isHomeInsightToolbarUrlEmpty(p) && hd && typeof hd === 'object') {
      setHomeInsightToolbarTemplateReady(false);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          applySavedHomeDashboardToSearchParams(next, hd, myCrmUserId);
          return next;
        },
        { replace: true }
      );
      return undefined;
    }
    setHomeInsightToolbarTemplateReady(true);
    return undefined;
  }, [insightAccess.checked, searchParams, setSearchParams, myCrmUserId]);

  /** 조회 범위·KPI 기간 변경 시 User.listTemplates.homeDashboard 에 디바운스 저장 */
  useEffect(() => {
    if (!insightAccess.checked || !homeInsightToolbarTemplateReady) return undefined;
    if (homeDashboardToolbarPersistTimerRef.current) {
      clearTimeout(homeDashboardToolbarPersistTimerRef.current);
    }
    homeDashboardToolbarPersistTimerRef.current = setTimeout(() => {
      homeDashboardToolbarPersistTimerRef.current = null;
      const payload = {
        companyWideInsight: isCompanyWideInsight,
        kpiPeriod,
        leaderInsightViewKind,
        insightDeptId: '',
        insightUserId: ''
      };
      if (!isCompanyWideInsight && leaderInsightViewKind === 'team') {
        payload.insightDeptId = insightDeptQ;
      }
      if (!isCompanyWideInsight && leaderInsightViewKind === 'personal') {
        payload.insightUserId = insightUserQ || myCrmUserId;
      }
      patchHomeDashboardTemplate(payload).catch(() => { });
    }, 450);
    return () => {
      if (homeDashboardToolbarPersistTimerRef.current) {
        clearTimeout(homeDashboardToolbarPersistTimerRef.current);
        homeDashboardToolbarPersistTimerRef.current = null;
      }
    };
  }, [
    insightAccess.checked,
    homeInsightToolbarTemplateReady,
    isCompanyWideInsight,
    leaderInsightViewKind,
    insightDeptQ,
    insightUserQ,
    myCrmUserId,
    kpiPeriod
  ]);

  useEffect(() => {
    if (!insightAccess.checked || !homeInsightToolbarTemplateReady) return undefined;
    const ac = new AbortController();
    let cancelled = false;
    const fetchGen = ++dashboardFetchGenRef.current;
    const isCurrentFetch = () => !cancelled && fetchGen === dashboardFetchGenRef.current;
    const fetchData = async () => {
      const hadData = dataRef.current != null;
      /** 필터·기간 전환: 이전 스코프 숫자를 붙잡지 말고 정밀 조회를 끝까지 받음 */
      const isScopeRefetch = hadData;
      if (isCurrentFetch()) {
        if (isScopeRefetch) setDashboardDataBusy(true);
        else setLoading(true);
      }
      const q = new URLSearchParams();
      if (isCompanyWideInsight) {
        q.set('insightScope', 'full');
      } else {
        q.set('insightScope', 'personal');
        if (leaderInsightViewKind === 'personal') {
          const uid = insightUserQ || myCrmUserId;
          if (uid) q.set('insightUser', uid);
        } else if (insightDeptQ) {
          q.set('insightDept', insightDeptQ);
        }
      }
      q.set('leaderBreakdown', 'employee');
      q.set('kpiPeriod', kpiPeriod);

      const skipStaleFirst = dashboardRefreshTick > lastHandledDashboardRefreshTickRef.current;
      const dashboardQueryString = q.toString();
      const localCacheKey = buildHomeDashboardLocalCacheKey(dashboardQueryString);
      let usedLocalSnapshot = false;
      // 필터 전환 시에도 해당 쿼리 로컬 스냅샷이 있으면 즉시 표시(이전 스코프 잔상 제거)
      if (!skipStaleFirst) {
        const localCached = readHomeDashboardLocalCache(localCacheKey);
        if (localCached) {
          dataRef.current = localCached;
          if (isCurrentFetch()) {
            setData(localCached);
            if (!isScopeRefetch) setLoading(false);
            setDashboardDataBusy(true);
          }
          usedLocalSnapshot = true;
        }
      }
      let appliedStale = false;
      let freshAppliedOk = false;
      const cancelFreshIfStaleDone = new AbortController();
      /** 첫 진입 + 완전 캐시일 때만 정밀 취소. 필터 전환·강제갱신에서는 항상 정밀 조회 유지 */
      const allowCancelFreshOnCompleteStale =
        !isScopeRefetch && !skipStaleFirst && !usedLocalSnapshot;
      const freshSignal =
        typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function'
          ? AbortSignal.any([ac.signal, cancelFreshIfStaleDone.signal])
          : ac.signal;

      const tryCancelFreshOnly = () => {
        try {
          cancelFreshIfStaleDone.abort();
        } catch (_) {
          /* ignore */
        }
      };

      const applyStalePayload = (j1) => {
        if (!isCurrentFetch() || freshAppliedOk || !j1 || typeof j1 !== 'object') return;
        setData(j1);
        appliedStale = true;
        if (!isScopeRefetch && !usedLocalSnapshot) setLoading(false);
        if (allowCancelFreshOnCompleteStale && isHomeStaleDashboardPayloadComplete(j1)) {
          setDashboardDataBusy(false);
          tryCancelFreshOnly();
        }
      };

      const applyFreshPayload = (j2) => {
        if (!isCurrentFetch() || !j2 || typeof j2 !== 'object') return;
        freshAppliedOk = true;
        writeHomeDashboardLocalCache(localCacheKey, j2);
        setData((prev) => {
          // 필터 전환·강제 새로고침·스테일 미적용: 전체 교체(이전 스코프 잔존 키 방지)
          if (skipStaleFirst || isScopeRefetch || !appliedStale) return j2;
          const prevKey = prev && typeof prev === 'object' ? String(prev.dashboardCacheKey || '') : '';
          const nextKey = String(j2.dashboardCacheKey || '');
          if (prevKey && nextKey && prevKey !== nextKey) return j2;
          return homeDashboardPayloadDiffPatch(prev, j2);
        });
        if (!isScopeRefetch) setLoading(false);
      };

      try {
        const freshUrl = `${API_BASE}/reports/dashboard?${dashboardQueryString}`;
        const tasks = [];

        if (!skipStaleFirst) {
          const qs = new URLSearchParams(q);
          qs.set('allowStaleCache', '1');
          tasks.push(
            fetch(`${API_BASE}/reports/dashboard?${qs}`, { ...crmFetchInit(), signal: ac.signal })
              .then(async (r1) => {
                if (!isCurrentFetch()) return;
                if (r1.status === 204) {
                  /* 회사 캐시 없음 — 정밀만 */
                  return;
                }
                if (!r1.ok) return;
                const j1 = await r1.json().catch(() => null);
                applyStalePayload(j1);
              })
              .catch((e) => {
                if (e?.name === 'AbortError') return;
              })
          );
        }

        tasks.push(
          fetch(freshUrl, { ...crmFetchInit(), signal: freshSignal })
            .then(async (r2) => {
              if (!isCurrentFetch()) return;
              if (!r2.ok) return;
              const j2 = await r2.json().catch(() => null);
              applyFreshPayload(j2);
            })
            .catch((e) => {
              if (e?.name === 'AbortError') return;
            })
        );

        await Promise.allSettled(tasks);
        if (isCurrentFetch() && !appliedStale && !freshAppliedOk && !usedLocalSnapshot) {
          setData({
            wonRevenue: { KRW: 0, USD: 0 },
            salesGraphs: {
              currencies: ['KRW'],
              chartMeta: {
                kpiPeriod: 'half',
                title: '올해 반기(1~6월·7~12월) · 전년 동반기',
                legendCurrent: '올해(반기)',
                legendPrev: '전년 동반기',
                granularity: 'half'
              },
              consumerByCurrency: { KRW: [] },
              consumerPrevYearByCurrency: { KRW: [] },
              netMarginByCurrency: { KRW: [] },
              netMarginPrevYearByCurrency: { KRW: [] },
              wonValueByCurrency: { KRW: [] },
              wonValuePrevYearByCurrency: { KRW: [] }
            },
            activeDeals: 128,
            newLeads: 45,
            taskCompletion: 0,
            taskCompletionMeta: {
              totalOpportunities: 0,
              wonCount: 0,
              inProgressDealCount: 0,
              collectedAmount: 0,
              collectedTotalsByCurrency: {}
            },
            kpiSummary: null,
            pipelineKpi: null,
            forecastPipelineRows: [],
            forecastPipelineMeta: { maxRows: 0, returnedRows: 0, capped: false }
          });
        }
      } catch (err) {
        if (err?.name === 'AbortError') return;
        if (isCurrentFetch() && !usedLocalSnapshot && !appliedStale && !freshAppliedOk) {
          setData({
            wonRevenue: { KRW: 0, USD: 0 },
            salesGraphs: {
              currencies: ['KRW'],
              chartMeta: {
                kpiPeriod: 'half',
                title: '올해 반기(1~6월·7~12월) · 전년 동반기',
                legendCurrent: '올해(반기)',
                legendPrev: '전년 동반기',
                granularity: 'half'
              },
              consumerByCurrency: { KRW: [] },
              consumerPrevYearByCurrency: { KRW: [] },
              netMarginByCurrency: { KRW: [] },
              netMarginPrevYearByCurrency: { KRW: [] },
              wonValueByCurrency: { KRW: [] },
              wonValuePrevYearByCurrency: { KRW: [] }
            },
            activeDeals: 128,
            newLeads: 45,
            taskCompletion: 0,
            taskCompletionMeta: {
              totalOpportunities: 0,
              wonCount: 0,
              inProgressDealCount: 0,
              collectedAmount: 0,
              collectedTotalsByCurrency: {}
            },
            kpiSummary: null,
            pipelineKpi: null,
            forecastPipelineRows: [],
            forecastPipelineMeta: { maxRows: 0, returnedRows: 0, capped: false }
          });
        }
      } finally {
        if (isCurrentFetch()) {
          lastHandledDashboardRefreshTickRef.current = dashboardRefreshTick;
          setLoading(false);
          setDashboardDataBusy(false);
        }
      }
    };
    fetchData();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    isCompanyWideInsight,
    leaderInsightViewKind,
    insightDeptQ,
    insightUserQ,
    myCrmUserId,
    kpiPeriod,
    dashboardRefreshTick,
    insightAccess.checked,
    homeInsightToolbarTemplateReady
  ]);

  useEffect(() => {
    let cancelled = false;
    const runHomeKpiTargetWork = async () => {
      const period = resolveHomeKpiTargetPeriod(kpiPeriod, new Date());
      const base = { loading: false, periodLabel: period.periodLabel, reason: '', target: null };
      const leaderScope = Boolean(data?.insightScope?.leaderSubtree);
      const filterUsers = Array.isArray(data?.insightLeaderFilters?.users) ? data.insightLeaderFilters.users : [];
      const filterDepartments = Array.isArray(data?.insightLeaderFilters?.departments)
        ? data.insightLeaderFilters.departments
        : [];
      const baseBar = data?.homeContributionBar;
      const krwBar = rebuildContributionBarKrw(baseBar, dealBasRMap);
      const segments = Array.isArray(krwBar?.segments) ? krwBar.segments : [];
      let resolver = null;
      const ensureResolver = async () => {
        if (!resolver) {
          resolver = await getHomeKpiOrgAdjustedTargetResolver({ period, filterUsers, filterDepartments });
        }
        return resolver;
      };

      const applyContributionBar = async () => {
        if (!baseBar || segments.length === 0) {
          if (!cancelled) setHomeTargetContributionBar(null);
          return;
        }
        try {
          const r = await ensureResolver();
          const resolved = await Promise.all(
            segments.map(async (seg) => {
              try {
                const targetRevenue =
                  baseBar.mode === 'team'
                    ? Math.max(0, Number(await r.getTeamTarget(seg.id)) || 0)
                    : Math.max(0, Number(await r.getUserTarget(seg.id)) || 0);
                const amount = Math.max(0, Number(seg.amount || 0));
                const achievement =
                  targetRevenue > 0 ? Number(((amount / targetRevenue) * 100).toFixed(1)) : null;
                return { ...seg, achievement, targetRevenue };
              } catch {
                return { ...seg, achievement: null, targetRevenue: 0 };
              }
            })
          );
          if (cancelled) return;
          const isPersonalSelf =
            baseBar.personalSelf === true ||
            (baseBar.mode !== 'team' &&
              Array.isArray(resolved) &&
              resolved.length === 1 &&
              leaderInsightViewKind === 'personal');
          const isTeamMembers =
            !isPersonalSelf &&
            baseBar.mode !== 'team' &&
            leaderInsightViewKind === 'team';
          setHomeTargetContributionBar({
            mode: baseBar.mode === 'team' ? 'team' : 'user',
            title: isPersonalSelf
              ? '본인 목표대비 달성률'
              : baseBar.mode === 'team'
                ? '팀별 목표대비 달성률'
                : isTeamMembers
                  ? '팀원별 목표대비 달성률'
                  : '개인별 목표대비 달성률',
            sublabel: isPersonalSelf
              ? `${period.periodLabel} 본인 달성 현황`
              : baseBar.mode === 'team'
                ? `${period.periodLabel} 팀별 달성 현황`
                : isTeamMembers
                  ? `${period.periodLabel} 팀원별 달성 현황`
                  : `${period.periodLabel} 개인별 달성 현황`,
            segments: resolved.map((seg, idx) => ({
              ...seg,
              color: seg.color || chartColorAt(idx)
            }))
          });
        } catch {
          if (!cancelled) setHomeTargetContributionBar(null);
        }
      };

      if (!isCompanyWideInsight) {
        if (leaderScope && leaderInsightViewKind === 'team') {
          if (!insightDeptQ) {
            const userIds = Array.from(
              new Set(filterUsers.map((u) => normalizeHomeKpiUserId(u)).filter(Boolean))
            );
            if (userIds.length === 0) {
              if (!cancelled) setHomeKpiTargetSnapshot(base);
              await applyContributionBar();
              return;
            }
            if (!cancelled) setHomeKpiTargetSnapshot((prev) => ({ ...prev, loading: true, periodLabel: period.periodLabel, reason: '' }));
            try {
              const r = await ensureResolver();
              const values = await Promise.all(userIds.map((uid) => r.getUserTarget(uid).catch(() => 0)));
              const targetRevenue = values.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
              if (!cancelled) {
                setHomeKpiTargetSnapshot({
                  loading: false,
                  periodLabel: `${period.periodLabel} (팀 누적)`,
                  reason: '',
                  target: { targetRevenue }
                });
              }
            } catch (err) {
              if (!cancelled) {
                setHomeKpiTargetSnapshot({
                  loading: false,
                  periodLabel: period.periodLabel,
                  reason: err.message || '목표 정보를 불러오지 못했습니다.',
                  target: null
                });
              }
            }
            await applyContributionBar();
            return;
          }
          if (!cancelled) setHomeKpiTargetSnapshot((prev) => ({ ...prev, loading: true, periodLabel: period.periodLabel, reason: '' }));
          try {
            const r = await ensureResolver();
            const targetRevenue = await r.getTeamTarget(insightDeptQ);
            if (!cancelled) {
              setHomeKpiTargetSnapshot({
                loading: false,
                periodLabel: period.periodLabel,
                reason: '',
                target: { targetRevenue }
              });
            }
          } catch (err) {
            if (!cancelled) {
              setHomeKpiTargetSnapshot({
                loading: false,
                periodLabel: period.periodLabel,
                reason: err.message || '목표 정보를 불러오지 못했습니다.',
                target: null
              });
            }
          }
          await applyContributionBar();
          return;
        }
        const uid = String((leaderInsightViewKind === 'personal' ? insightUserQ : '') || myCrmUserId || '').trim();
        if (!uid) {
          if (!cancelled) setHomeKpiTargetSnapshot(base);
          await applyContributionBar();
          return;
        }
        if (!cancelled) setHomeKpiTargetSnapshot((prev) => ({ ...prev, loading: true, periodLabel: period.periodLabel, reason: '' }));
        try {
          const r = await ensureResolver();
          const targetRevenue = await r.getUserTarget(uid);
          if (!cancelled) {
            setHomeKpiTargetSnapshot({
              loading: false,
              periodLabel: period.periodLabel,
              reason: '',
              target: { targetRevenue }
            });
          }
        } catch (err) {
          if (!cancelled) {
            setHomeKpiTargetSnapshot({
              loading: false,
              periodLabel: period.periodLabel,
              reason: err.message || '목표 정보를 불러오지 못했습니다.',
              target: null
            });
          }
        }
        await applyContributionBar();
        return;
      }

      if (!cancelled) setHomeKpiTargetSnapshot((prev) => ({ ...prev, loading: true, periodLabel: period.periodLabel, reason: '' }));
      try {
        let targetRevenue = 0;
        try {
          const matrix = await fetchHomeKpiYearMatrixCached(period.year, 'company', '');
          const block = homeKpiBlockFromYearMatrix(matrix);
          if (homeKpiBlockHasStoredTarget(block)) {
            targetRevenue = homeKpiTargetValueFromBlock(block, period);
          }
        } catch (_) {
          /* 회사 단일 매트릭스 실패 시 resolver 합산으로 폴백 */
        }
        if (targetRevenue <= 0) {
          const r = await ensureResolver();
          targetRevenue = await r.getCompanyTarget();
        }
        if (!cancelled) {
          setHomeKpiTargetSnapshot({
            loading: false,
            periodLabel: period.periodLabel,
            reason: '',
            target: { targetRevenue }
          });
        }
      } catch (err) {
        if (!cancelled) {
          setHomeKpiTargetSnapshot({
            loading: false,
            periodLabel: period.periodLabel,
            reason: err.message || '목표 정보를 불러오지 못했습니다.',
            target: null
          });
        }
      }
      await applyContributionBar();
    };
    runHomeKpiTargetWork();
    return () => {
      cancelled = true;
    };
  }, [
    isCompanyWideInsight,
    leaderInsightViewKind,
    insightDeptQ,
    insightUserQ,
    myCrmUserId,
    kpiPeriod,
    data?.insightScope?.leaderSubtree,
    data?.insightLeaderFilters?.users,
    data?.insightLeaderFilters?.departments,
    data?.homeContributionBar,
    dealBasRMap,
    dashboardRefreshTick
  ]);

  useEffect(() => {
    if (!insightAccess.checked) return undefined;
    let cancelled = false;
    const fetchLeadCaptureDashboard = async () => {
      try {
        const res = await fetch(`${API_BASE}/reports/home-capture-leads?limit=120`, crmFetchInit());
        const json = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          const items = Array.isArray(json.items) ? json.items : [];
          if (!cancelled) setRecentCaptureLeads(items);
        } else if (!cancelled) {
          setRecentCaptureLeads([]);
        }
      } catch (_) {
        if (!cancelled) {
          setRecentCaptureLeads([]);
        }
      } finally {
        if (!cancelled) setLeadChannelsLoading(false);
      }
    };
    const cancelDefer = deferAfterPaint(() => {
      if (!cancelled) fetchLeadCaptureDashboard();
    });
    return () => {
      cancelled = true;
      cancelDefer();
    };
  }, [insightAccess.checked]);

  const fetchStageDefinitions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=salesPipelineStage`, crmFetchInit());
      const json = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(json.items)) setStageDefinitions(json.items);
      else setStageDefinitions([]);
    } catch {
      setStageDefinitions([]);
    }
  }, []);

  const fetchHomePipelineSummary = useCallback(async () => {
    setPipelineLoading(true);
    try {
      const res = await fetch(`${API_BASE}/reports/home-pipeline-summary`, crmFetchInit());
      if (!res.ok) throw new Error('fetch failed');
      const json = await res.json();
      if (pipelineMounted.current) {
        setPipelineSummary(json && typeof json === 'object' ? json : null);
      }
    } catch {
      if (pipelineMounted.current) {
        setPipelineSummary(null);
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
    const onStagesUpdated = () => {
      fetchStageDefinitions();
    };
    window.addEventListener('nexvia-pipeline-stages-updated', onStagesUpdated);
    return () => window.removeEventListener('nexvia-pipeline-stages-updated', onStagesUpdated);
  }, [fetchStageDefinitions]);

  /** 슬립 깨우기는 즉시, 전체 sales-opportunities는 첫 화면 이후 idle에 로드 */
  useEffect(() => {
    pingBackendHealth(getAuthHeader).catch(() => {});
    const cancelDefer = deferAfterPaint(() => fetchHomePipelineSummary());
    return cancelDefer;
  }, [fetchHomePipelineSummary]);

  useEffect(() => {
    if (!insightAccess.checked) return undefined;
    const handler = () => {
      clearHomeDashboardLocalCaches();
      setDashboardRefreshTick((t) => t + 1);
      fetchHomePipelineSummary();
    };
    window.addEventListener('nexvia-crm-pipeline-refresh', handler);
    return () => window.removeEventListener('nexvia-crm-pipeline-refresh', handler);
  }, [insightAccess.checked, fetchHomePipelineSummary]);

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

  /** 홈에서 기회 추가 모달 — opportunity-modal 과 동일 단계 옵션 */
  const homeOpportunityStageOptions = useMemo(() => {
    const act = stageDefinitions.length > 0
      ? stageDefinitions.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((d) => d.key)
      : DEFAULT_ACTIVE_STAGES;
    const labels = stageDefinitions.length > 0
      ? Object.fromEntries(stageDefinitions.map((d) => [d.key, d.label]))
      : DEFAULT_STAGE_LABELS;
    const board = act.filter((s) => s !== 'Won');
    const opts = board.map((key) => ({ value: key, label: labels[key] ?? key }));
    const wonL = labels.Won || DEFAULT_STAGE_LABELS.Won || '수주 성공';
    const lostL = labels.Lost || '기회 상실';
    const abL = labels.Abandoned || '보류';
    return opts.concat(
      [{ value: 'Won', label: wonL }],
      [{ value: 'Lost', label: lostL }, { value: 'Abandoned', label: abL }]
    );
  }, [stageDefinitions]);

  const defaultHomeOppStage = useMemo(() => {
    const first = homeOpportunityStageOptions.find(
      (o) => o && !['Won', 'Lost', 'Abandoned'].includes(o.value)
    );
    return first?.value || 'NewLead';
  }, [homeOpportunityStageOptions]);

  const homeOppModalDefaultStage = useMemo(() => {
    if (homeOppStageQ && homeOpportunityStageOptions.some((o) => o.value === homeOppStageQ)) {
      return homeOppStageQ;
    }
    return defaultHomeOppStage;
  }, [homeOppStageQ, homeOpportunityStageOptions, defaultHomeOppStage]);

  const openHomeAddOpportunity = useCallback(async () => {
    try {
      await pingBackendHealth(getAuthHeader);
    } catch {
      /* ignore */
    }
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set(HOME_OPP_MODAL_PARAM, 'add');
        p.delete(HOME_OPP_ID_PARAM);
        p.set(HOME_OPP_STAGE_PARAM, defaultHomeOppStage);
        return p;
      },
      { replace: true }
    );
  }, [setSearchParams, defaultHomeOppStage]);

  const openHomeEditOpportunity = useCallback(
    (oppId) => {
      const id = String(oppId || '').trim();
      if (!id) return;
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set(HOME_OPP_MODAL_PARAM, 'edit');
          p.set(HOME_OPP_ID_PARAM, id);
          p.delete(HOME_OPP_STAGE_PARAM);
          return p;
        },
        { replace: false }
      );
    },
    [setSearchParams]
  );

  const handleHomeOppSaved = useCallback(
    (payload, meta) => {
      if (!meta?.keepOpen) closeHomeOppModal();
      clearHomeDashboardLocalCaches();
      setDashboardRefreshTick((t) => t + 1);
      fetchHomePipelineSummary();
    },
    [closeHomeOppModal, fetchHomePipelineSummary]
  );

  const homeUserDisplay = useMemo(() => {
    const u = getStoredCrmUser();
    const n = (u?.name && String(u.name).trim()) || (u?.email && String(u.email).split('@')[0]) || '사용자';
    return n;
  }, []);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const fn = () => setIsMobile(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

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

  const visibleHomeCaptureLeads = useMemo(
    () =>
      recentCaptureLeads.filter(
        (lead) =>
          lead._id != null &&
          isLeadVisibleInHome(lead._id, leadHomeVisibility) &&
          !sharedCompletedLeadMap[String(lead._id)]
      ),
    [recentCaptureLeads, leadHomeVisibility, sharedCompletedLeadMap]
  );

  const pendingLeadCount = leadChannelsLoading ? 0 : visibleHomeCaptureLeads.length;
  const completedHomeCaptureLeads = useMemo(
    () =>
      recentCaptureLeads.filter((lead) => {
        const id = String(lead?._id || '');
        return !!id && !!sharedCompletedLeadMap[id];
      }),
    [recentCaptureLeads, sharedCompletedLeadMap]
  );

  /** 캡처 리드 주간(월요일 기준 6주) 집계 — 꺾은선·막대 공용 */
  const leadWeeklySeries = useMemo(
    () => computeWeeklyLeadSeries(recentCaptureLeads, 6),
    [recentCaptureLeads]
  );
  const leadWeeklyBarSeries = useMemo(() => prepareChartSeries(leadWeeklySeries), [leadWeeklySeries]);

  const dismissLeadFromHome = useCallback((leadId) => {
    const id = String(leadId || '');
    if (!id) return;
    const actor = getStoredCrmUser();
    const byUserId = String(actor?._id || actor?.id || '');
    const byName = String(actor?.name || actor?.email || '사용자').trim() || '사용자';
    const doneAt = new Date().toISOString();

    setSharedCompletedLeadMap((prev) => {
      const next = { ...(prev || {}), [id]: { byUserId, byName, doneAt } };
      saveSharedCompletedLeadMap(next);
      return next;
    });

    const key = getLeadVisibilityUserKey();
    setLeadHomeVisibility((prev) => {
      const snoozed = { ...(prev?.snoozed || {}) };
      delete snoozed[id];
      const next = { permanent: prev?.permanent || [], snoozed };
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
  /** 최초 대시보드 로드 전에만 차트·KPI를 막음 — 재조회 시에는 기존 값 유지 후 응답으로 갱신 */
  const dashboardShellBlocking = loading && data == null;
  const insightAnimEpoch = useInsightAnimEpoch(data);
  const prefersReducedMotion = usePrefersReducedMotion();
  const insightAnimMs = prefersReducedMotion ? 0 : 520;

  /** 대시보드는 모든 통화를 원화 환산 후 합산해 표시 (동기화 중지 시 고정 환율 적용) */
  const selectedGraphCurrency = DASHBOARD_DISPLAY_CURRENCY;

  const krwInsightKpi = useMemo(
    () => computeKrwInsightKpiFromGraphs(stats.salesGraphs, dealBasRMap, kpiPeriod),
    [stats.salesGraphs, dealBasRMap, kpiPeriod]
  );

  const homeContributionBarKrw = useMemo(
    () => rebuildContributionBarKrw(data?.homeContributionBar, dealBasRMap),
    [data?.homeContributionBar, dealBasRMap]
  );

  const homeProjectCounts = useMemo(() => {
    let done = 0;
    let active = 0;
    for (const p of homeProjectPreview) {
      if (String(p?.stage || '') === 'done') done += 1;
      else active += 1;
    }
    return { done, active, total: done + active };
  }, [homeProjectPreview]);

  const kpiAnimSrc = stats.kpiSummary;
  const revNum =
    Number(
      krwInsightKpi?.revenue?.orderValueTotal ??
      krwInsightKpi?.revenue?.primaryTotal ??
      kpiAnimSrc?.revenue?.orderValueTotal ??
      0
    ) || 0;
  const gmRateNum = krwInsightKpi?.grossMargin?.ratePct ?? kpiAnimSrc?.grossMargin?.ratePct ?? 0;
  const goalCollectedKrw = useMemo(() => {
    const byCur =
      kpiAnimSrc?.goal?.collectedTotalsByCurrency ||
      stats.taskCompletionMeta?.collectedTotalsByCurrency ||
      {};
    const fromMap = sumCurrencyBreakdownToKrw(byCur, dealBasRMap);
    if (fromMap > 0) return fromMap;
    return toKrwAmount(
      kpiAnimSrc?.goal?.collectedAmount,
      kpiAnimSrc?.primaryCurrency || DASHBOARD_DISPLAY_CURRENCY,
      dealBasRMap
    );
  }, [kpiAnimSrc, stats.taskCompletionMeta, dealBasRMap]);
  const goalNum = goalCollectedKrw;
  const goalCompletionNum = Number(kpiAnimSrc?.goal?.taskCompletion) || 0;
  const leadNum = kpiAnimSrc?.newLeads?.count ?? kpiAnimSrc?.newLeads?.count30d ?? 0;
  const revFcRaw = krwInsightKpi?.revenue?.forecastVsPct ?? kpiAnimSrc?.revenue?.forecastVsPct;
  const gmFcRaw = krwInsightKpi?.grossMargin?.forecastVsPP ?? kpiAnimSrc?.grossMargin?.forecastVsPP;
  const leadFcRaw = kpiAnimSrc?.newLeads?.forecastVsPct;
  const revYoyRaw = krwInsightKpi?.revenue?.yoyPct ?? kpiAnimSrc?.revenue?.yoyPct;
  const gmYoyRaw = krwInsightKpi?.grossMargin?.yoyPP ?? kpiAnimSrc?.grossMargin?.yoyPP;
  const leadYoyRaw = kpiAnimSrc?.newLeads?.yoyPct;
  const goalYoyRaw = kpiAnimSrc?.goal?.yoyPct;

  const revAnim = useAnimatedScalar(revNum, insightAnimEpoch, insightAnimMs);
  const gmRateAnim = useAnimatedScalar(gmRateNum, insightAnimEpoch, insightAnimMs);
  const goalAnim = useAnimatedScalar(goalNum, insightAnimEpoch, insightAnimMs);
  const goalCompletionAnim = useAnimatedScalar(goalCompletionNum, insightAnimEpoch, insightAnimMs);
  const goalYoyAnim = useAnimatedScalar(goalYoyRaw, insightAnimEpoch, insightAnimMs);
  const leadAnim = useAnimatedScalar(leadNum, insightAnimEpoch, insightAnimMs);
  const revFcAnim = useAnimatedScalar(revFcRaw != null ? Number(revFcRaw) : 0, insightAnimEpoch, insightAnimMs);
  const gmFcAnim = useAnimatedScalar(gmFcRaw != null ? Number(gmFcRaw) : 0, insightAnimEpoch, insightAnimMs);
  const leadFcAnim = useAnimatedScalar(leadFcRaw != null ? Number(leadFcRaw) : 0, insightAnimEpoch, insightAnimMs);
  const revYoyAnim = useAnimatedScalar(revYoyRaw != null ? Number(revYoyRaw) : 0, insightAnimEpoch, insightAnimMs);
  const gmYoyAnim = useAnimatedScalar(gmYoyRaw != null ? Number(gmYoyRaw) : 0, insightAnimEpoch, insightAnimMs);
  const leadYoyAnim = useAnimatedScalar(leadYoyRaw != null ? Number(leadYoyRaw) : 0, insightAnimEpoch, insightAnimMs);

  const projectAchievePctNum =
    homeProjectCounts.total > 0
      ? Math.round((100 * homeProjectCounts.done) / homeProjectCounts.total)
      : 0;
  const projectAchieveAnim = useAnimatedScalar(
    projectAchievePctNum,
    projectBarAnimEpoch,
    insightAnimMs
  );

  /** KPI 카드 설명 모달 — 상단 조회 범위 문구 */
  const homeKpiScopeDescription = useMemo(() => {
    if (isCompanyWideInsight) {
      return '회사 전체 조회 범위입니다. KPI·그래프·파이프라인이 동일 범위로 집계됩니다.';
    }
    if (leaderInsightViewKind === 'personal') {
      const uid = String(insightUserQ || myCrmUserId || '').trim();
      const users = Array.isArray(data?.insightLeaderFilters?.users) ? data.insightLeaderFilters.users : [];
      const u = users.find((x) => String(x.id) === uid);
      if (u?.name) return `개인 보기 · ${u.name}`;
      return '개인 보기 · 선택된 CRM 사용자 기준';
    }
    const depts = Array.isArray(data?.insightLeaderFilters?.departments)
      ? data.insightLeaderFilters.departments
      : [];
    const did = String(insightDeptQ || '').trim();
    const d = depts.find((x) => String(x.id) === did);
    if (d?.label) return `팀별 보기 · 부서「${d.label}」`;
    return '팀별 보기 · 팀 전체(부서 미선택)';
  }, [
    isCompanyWideInsight,
    leaderInsightViewKind,
    insightUserQ,
    insightDeptQ,
    myCrmUserId,
    data?.insightLeaderFilters
  ]);

  const wonLeaderboardPeriodLabel = useMemo(() => {
    const labelMap = {
      month: '월간',
      quarter: '분기',
      half: '반기',
      year: '연간'
    };
    return labelMap[kpiPeriod] || '월간';
  }, [kpiPeriod]);

  const homeKpiCards = useMemo(() => {
    const kpi = stats.kpiSummary;
    const cur = DASHBOARD_DISPLAY_CURRENCY;
    if (!kpi) {
      return [
        { key: 'rev', skeleton: true },
        { key: 'gm', skeleton: true },
        { key: 'goal', skeleton: true },
        { key: 'lead', skeleton: true },
        { key: 'project', skeleton: true }
      ];
    }
    const rev = kpi.revenue;
    const gm = kpi.grossMargin;
    const goal = kpi.goal;
    const nl = kpi.newLeads;
    const meta = kpi.kpiMeta || {};
    const revTotal =
      Number(
        krwInsightKpi?.revenue?.orderValueTotal ??
        rev?.orderValueTotal ??
        rev?.primaryTotal ??
        rev?.last6Total ??
        0
      ) || 0;
    const revenueYoyLabel = meta.revenueYoyLabel || '전년 동기 대비';
    const leadHint = meta.leadHint || '해당 기간 신규 기회(생성일 기준)';
    const leadSeqLabel = meta.leadSeqLabel || '직전 구간 대비';
    const revHint =
      (meta.revenueHint && String(meta.revenueHint).trim()) ||
      '해당 기간 수주 금액 합계(원가금액 차감 전)';

    return [
      {
        key: 'rev',
        title: `${wonLeaderboardPeriodLabel} 총 매출액 (수주 완료)`,
        hint: revHint,
        value: formatCurrency(revTotal, cur),
        icon: 'payments',
        tone: 'blue',
        showForecast: true,
        showPeriod: true,
        forecastMetricLabel: '기간 후반/전반',
        forecast: rev?.forecastVsPct,
        forecastMode: 'pct',
        period: rev?.yoyPct,
        periodLabel: revenueYoyLabel,
        periodMode: 'deltaPct'
      },
      {
        key: 'gm',
        title: '매출 총이익률 (순마진)',
        hint: meta.marginHint || '원가/수수료 공제 순수익',
        value: `${krwInsightKpi?.grossMargin?.ratePct ?? gm?.ratePct ?? 0}%`,
        icon: 'monitoring',
        tone: 'emerald',
        showForecast: true,
        showPeriod: true,
        forecastMetricLabel: '기간 후반/전반',
        forecast: gm?.forecastVsPP,
        forecastMode: 'pp',
        period: gm?.yoyPP,
        periodLabel: revenueYoyLabel,
        periodMode: 'deltaPP'
      },
      {
        key: 'goal',
        title: '수금 완료 & 전환 진척도',
        hint: '',
        goalFootnoteModel: buildGoalKpiFootnoteModel(stats),
        value: formatCurrency(goalCollectedKrw, DASHBOARD_DISPLAY_CURRENCY),
        icon: 'verified_user',
        tone: 'purple',
        showForecast: true,
        showPeriod: true,
        forecastMetricLabel: '세일즈 완료율',
        forecast: goal?.taskCompletion,
        forecastMode: 'rawPct',
        period: goal?.yoyPct,
        periodLabel: revenueYoyLabel,
        periodMode: 'deltaPct'
      },
      {
        key: 'lead',
        title: '신규 활성 리드 (Lead Pool)',
        hint: leadHint,
        value: `${nl?.count ?? nl?.count30d ?? 0}건`,
        icon: 'group',
        tone: 'amber',
        showForecast: true,
        showPeriod: true,
        forecastMetricLabel: '단기 추세',
        forecast: nl?.forecastVsPct,
        forecastMode: 'pct',
        period: nl?.yoyPct,
        periodLabel: leadSeqLabel,
        periodMode: 'deltaPct'
      },
      {
        key: 'project',
        title: '프로젝트',
        hint: isCompanyWideInsight
          ? ''
          : '',
        value:
          homeProjectCounts.total > 0
            ? `${Math.round((100 * homeProjectCounts.done) / homeProjectCounts.total)}%`
            : '—',
        icon: 'folder_special',
        tone: 'indigo',
        showForecast: true,
        showPeriod: true,
        forecastMetricLabel: '완료 비중',
        forecast:
          homeProjectCounts.total > 0
            ? (100 * homeProjectCounts.done) / homeProjectCounts.total
            : null,
        forecastMode: 'rawPct',
        period: null,
        periodLabel: '진행·완료 추이',
        periodMode: 'deltaPct'
      }
    ];
  }, [stats.kpiSummary, stats.taskCompletionMeta, krwInsightKpi, goalCollectedKrw, dealBasRMap, homeProjectCounts, isCompanyWideInsight, wonLeaderboardPeriodLabel]);

  const pipelineColumns = useMemo(() => {
    const byStage = pipelineSummary?.byStage && typeof pipelineSummary.byStage === 'object'
      ? pipelineSummary.byStage
      : {};
    const cols = pipelineMainStages.map((stage) => {
      const row = byStage[stage] || {};
      const count = Number(row.count) || 0;
      const total = Number(row.total) || 0;
      return { stage, label: stageLabels[stage] ?? stage, count, total, currency: 'KRW' };
    });
    const maxCount = Math.max(1, ...cols.map((c) => c.count));
    const maxTotal = Math.max(1, ...cols.map((c) => c.total));
    return cols.map((c) => ({
      ...c,
      hCount: Math.round((c.count / maxCount) * 95),
      hValue: Math.round((c.total / maxTotal) * 95),
      hMix: Math.round(((c.count / maxCount + c.total / maxTotal) / 2) * 95)
    }));
  }, [pipelineMainStages, pipelineSummary, stageLabels]);

  const wonLeaderboardRows = useMemo(() => {
    const rows = Array.isArray(data?.assigneeProfitLeaderboard) ? data.assigneeProfitLeaderboard : [];
    return rows.map((row) => {
      const name = String(row?.name || '').trim() || '미지정';
      return {
        name,
        initials: nameToInitials(name),
        deals: Math.max(0, Number(row?.dealCount) || 0),
        revenueDisplay: formatCurrency(Math.round(Number(row?.revenue) || 0), 'KRW'),
        netProfit: Number(row?.netProfit)
      };
    });
  }, [data?.assigneeProfitLeaderboard]);

  const [dashboardExporting, setDashboardExporting] = useState(false);
  const handleDashboardExport = async () => {
    setDashboardExporting(true);
    try {
      const res = await fetch(`${API_BASE}/reports/dashboard-export`, crmFetchInit());
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '엑셀보내기에 실패했습니다.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nexvia-dashboard-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[Dashboard] export error:', err);
      window.alert(err?.message || '엑셀보내기에 실패했습니다.');
    } finally {
      setDashboardExporting(false);
    }
  };

  const consumerRaw = useMemo(
    () => mergeCurrencySeriesMapToKrw(stats.salesGraphs?.consumerByCurrency, dealBasRMap),
    [stats.salesGraphs, dealBasRMap]
  );
  const consumerPrevRaw = useMemo(
    () => mergeCurrencySeriesMapToKrw(stats.salesGraphs?.consumerPrevYearByCurrency, dealBasRMap),
    [stats.salesGraphs, dealBasRMap]
  );
  const netMarginRaw = useMemo(
    () => mergeCurrencySeriesMapToKrw(stats.salesGraphs?.netMarginByCurrency, dealBasRMap),
    [stats.salesGraphs, dealBasRMap]
  );
  const netMarginPrevRaw = useMemo(
    () => mergeCurrencySeriesMapToKrw(stats.salesGraphs?.netMarginPrevYearByCurrency, dealBasRMap),
    [stats.salesGraphs, dealBasRMap]
  );
  const [consumerTween, consumerPrevTween] = useTweenedDualSeries(
    consumerRaw,
    consumerPrevRaw,
    insightAnimEpoch,
    insightAnimMs
  );
  const [netTween, netPrevTween] = useTweenedDualSeries(
    netMarginRaw,
    netMarginPrevRaw,
    insightAnimEpoch,
    insightAnimMs
  );
  const consumerSeries = useMemo(() => prepareChartSeries(consumerTween), [consumerTween]);
  const netMarginSeries = useMemo(() => prepareChartSeries(netTween), [netTween]);

  const salesChartMeta = stats.salesGraphs?.chartMeta;
  const insightChartLegendCurrent = salesChartMeta?.legendCurrent || '올해';
  const insightChartLegendPrev = salesChartMeta?.legendPrev || '전년 동월';
  const consumerInsightSubtitle = salesChartMeta?.title
    ? `수주 성공 건의 소비자가(목록가×수량) 합계입니다. ${salesChartMeta.title}.`
    : '수주 성공 건의 소비자가 합계입니다. KPI 기간에 맞춰 달력 단위로 집계하며, 꺾은선은 전년 동일 구간과 같은 눈금으로 비교합니다.';
  const marginInsightSubtitle = salesChartMeta?.title
    ? `수주 금액에서 원가×수량을 뺀 금액입니다. ${salesChartMeta.title}.`
    : '수주 금액에서 원가×수량을 뺀 금액입니다. KPI 기간에 맞춰 달력 단위로 집계하며, 전년 동일 구간과 비교합니다.';
  const consumerInsightEmpty = salesChartMeta?.legendCurrent
    ? `${insightChartLegendCurrent}·${insightChartLegendPrev} 소비자가 데이터가 없습니다.`
    : '집계 구간·전년 동일 구간 소비자가 데이터가 없습니다.';
  const marginInsightEmpty = salesChartMeta?.legendCurrent
    ? `${insightChartLegendCurrent}·${insightChartLegendPrev} 순마진 데이터가 없습니다.`
    : '집계 구간·전년 동일 구간 순마진 데이터가 없습니다.';
  const productSalesTopN = Number(stats.productSalesGraphs?.topN) || 8;
  const productSalesRows = useMemo(
    () =>
      mergeProductSalesRowsToKrw(
        stats.productSalesGraphs?.wonValueByProductByCurrency,
        dealBasRMap,
        Number(stats.productSalesGraphs?.topN) || 8
      ),
    [stats.productSalesGraphs, dealBasRMap]
  );
  const productQtyRows = useMemo(
    () =>
      Array.isArray(stats.productSalesGraphs?.quantityByProduct)
        ? stats.productSalesGraphs.quantityByProduct
        : [],
    [stats.productSalesGraphs]
  );
  const productSalesSubtitle = salesChartMeta?.title
    ? `수주 성공(Won) 금액을 제품(행)별로 나눈 합계입니다. 복수 제품 기회는 행별 최종 금액(할인율·차감 반영) 비중으로 수주액을 배분합니다. 통화별 상위 ${productSalesTopN}개 제품. ${salesChartMeta.title}.`
    : `수주 성공(Won) 금액을 제품별로 나눈 합계입니다. 복수 제품 기회는 행별 최종 금액(할인 반영) 비중으로 배분하며, 통화별 상위 ${productSalesTopN}개 제품만 표시합니다.`;
  const productQtySubtitle = salesChartMeta?.title
    ? `수주 성공(Won) 건의 제품(행)별 판매 수량입니다. 복수 제품이면 각 행 수량을 합산합니다. 전체 기준 상위 ${productSalesTopN}개 제품. ${salesChartMeta.title}.`
    : `수주 성공(Won) 건의 제품별 판매 수량입니다. lineItems 가 있으면 행 수량을 합산하고, 상위 ${productSalesTopN}개 제품만 표시합니다.`;
  const forecastAllRows = useMemo(
    () => (Array.isArray(data?.forecastPipelineRows) ? data.forecastPipelineRows : []),
    [data?.forecastPipelineRows]
  );
  const forecastCompletedRowsUnfiltered = useMemo(
    () =>
      forecastAllRows.filter((row) => {
        const prob = Number(row?.probabilityPct || 0);
        const stage = String(row?.stage || row?.stageLabel || '').trim().toLowerCase();
        return prob >= 100 || stage === 'won' || stage === 'closed';
      }),
    [forecastAllRows]
  );
  const forecastActiveRowsUnfiltered = useMemo(
    () => forecastAllRows.filter((row) => !forecastCompletedRowsUnfiltered.includes(row)),
    [forecastAllRows, forecastCompletedRowsUnfiltered]
  );
  const forecastActiveProductOptions = useMemo(
    () => buildHomeForecastProductOptions(forecastActiveRowsUnfiltered),
    [forecastActiveRowsUnfiltered]
  );
  const forecastActiveProbabilityOptions = useMemo(
    () => buildHomeForecastProbabilityOptions(forecastActiveRowsUnfiltered),
    [forecastActiveRowsUnfiltered]
  );
  const forecastActiveTargetMonthMeta = useMemo(
    () => buildHomeForecastTargetMonthMeta(forecastActiveRowsUnfiltered),
    [forecastActiveRowsUnfiltered]
  );
  const forecastCompletedProductOptions = useMemo(
    () => buildHomeForecastProductOptions(forecastCompletedRowsUnfiltered),
    [forecastCompletedRowsUnfiltered]
  );
  const forecastCompletedProbabilityOptions = useMemo(
    () => buildHomeForecastProbabilityOptions(forecastCompletedRowsUnfiltered),
    [forecastCompletedRowsUnfiltered]
  );
  const forecastCompletedTargetMonthMeta = useMemo(
    () => buildHomeForecastTargetMonthMeta(forecastCompletedRowsUnfiltered),
    [forecastCompletedRowsUnfiltered]
  );
  const forecastActiveRows = useMemo(
    () => filterHomeForecastRows(forecastActiveRowsUnfiltered, homeForecastActiveFilters),
    [forecastActiveRowsUnfiltered, homeForecastActiveFilters]
  );
  const forecastCompletedRows = useMemo(
    () => filterHomeForecastRows(forecastCompletedRowsUnfiltered, homeForecastCompletedFilters),
    [forecastCompletedRowsUnfiltered, homeForecastCompletedFilters]
  );
  const forecastCompletedPreviewRows = useMemo(
    () => forecastCompletedRows.slice(0, HOME_FORECAST_PREVIEW_MAX),
    [forecastCompletedRows]
  );
  const forecastActivePreviewRows = useMemo(
    () => forecastActiveRows.slice(0, HOME_FORECAST_PREVIEW_MAX),
    [forecastActiveRows]
  );
  const forecastActiveTotals = useMemo(
    () =>
      sumForecastTotalsKrw(
        forecastActiveRows,
        homeForecastActiveFilters.product,
        dealBasRMap,
        getForecastRowDisplayForProductFilter
      ),
    [forecastActiveRows, homeForecastActiveFilters.product, dealBasRMap]
  );
  const forecastCompletedTotals = useMemo(
    () =>
      sumForecastTotalsKrw(
        forecastCompletedRows,
        homeForecastCompletedFilters.product,
        dealBasRMap,
        getForecastRowDisplayForProductFilter
      ),
    [forecastCompletedRows, homeForecastCompletedFilters.product, dealBasRMap]
  );

  const persistHomeForecastColumnWidths = useCallback((widths) => {
    setHomeForecastColumnWidths(widths);
    patchHomeDashboardTemplate({ forecastColumnWidths: widths }).catch(() => {});
  }, []);

  /** 인사이트 툴바(회사·팀·개인·부서·직원·KPI 기간) 변경 시에만 초기화 — `forecastPipelineRows` 참조만 바뀌는 갱신에 필터가 풀리지 않게 함 */
  useEffect(() => {
    setHomeForecastActiveFilters({ product: '', probability: '', targetMonth: '' });
    setHomeForecastCompletedFilters({ product: '', probability: '', targetMonth: '' });
  }, [
    isCompanyWideInsight,
    leaderInsightViewKind,
    insightDeptQ,
    insightUserQ,
    kpiPeriod,
    dashboardRefreshTick
  ]);

  const renderHomeForecastFilterBar = useCallback(
    (variant, opts = {}) => {
      const isActive = variant === 'active';
      const compact = opts.compact === true;
      const filters = isActive ? homeForecastActiveFilters : homeForecastCompletedFilters;
      const setFilters = isActive ? setHomeForecastActiveFilters : setHomeForecastCompletedFilters;
      const productOpts = isActive ? forecastActiveProductOptions : forecastCompletedProductOptions;
      const probOpts = isActive ? forecastActiveProbabilityOptions : forecastCompletedProbabilityOptions;
      const monthMeta = isActive ? forecastActiveTargetMonthMeta : forecastCompletedTargetMonthMeta;
      const aria = isActive ? 'Forecast 진행 중 표 필터' : '완료 기회 표 필터';

      return (
        <div className={`home-forecast-filters${compact ? ' home-forecast-filters--pair' : ''}`} role="toolbar" aria-label={aria}>
          <div className="home-forecast-filters-row">
            <label className="home-forecast-filter-pair">
              <span className="home-forecast-filter-label">{compact ? (isActive ? '확률' : '제품군') : '제품'}</span>
              {compact && isActive ? (
                <select
                  className="home-forecast-filter-select"
                  value={filters.probability}
                  onChange={(e) => setFilters((prev) => ({ ...prev, probability: e.target.value }))}
                >
                  <option value="">전체 확률</option>
                  {probOpts.map((p) => (
                    <option key={p} value={String(p)}>
                      {`${p}%`}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className="home-forecast-filter-select"
                  value={filters.product}
                  onChange={(e) => setFilters((prev) => ({ ...prev, product: e.target.value }))}
                >
                  <option value="">{compact ? '제품군 전체' : '전체'}</option>
                  {productOpts.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              )}
            </label>
            {compact ? (
              <label className="home-forecast-filter-pair">
                <span className="home-forecast-filter-label">{isActive ? '마감월' : '연도·월'}</span>
                <select
                  className="home-forecast-filter-select"
                  value={filters.targetMonth}
                  onChange={(e) => setFilters((prev) => ({ ...prev, targetMonth: e.target.value }))}
                >
                  <option value="">{isActive ? '마감월 전체' : '연간 전체'}</option>
                  {monthMeta.sortedMonths.map((ym) => (
                    <option key={ym} value={ym}>
                      {formatForecastExpectedMonthCell(ym)}
                    </option>
                  ))}
                  {monthMeta.hasNone ? (
                    <option value={HOME_FORECAST_MONTH_NONE}>목표 월 없음</option>
                  ) : null}
                </select>
              </label>
            ) : (
              <>
                <label className="home-forecast-filter-pair">
                  <span className="home-forecast-filter-label">확률</span>
                  <select
                    className="home-forecast-filter-select"
                    value={filters.probability}
                    onChange={(e) => setFilters((prev) => ({ ...prev, probability: e.target.value }))}
                  >
                    <option value="">전체</option>
                    {probOpts.map((p) => (
                      <option key={p} value={String(p)}>
                        {`${p}%`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="home-forecast-filter-pair">
                  <span className="home-forecast-filter-label">목표 월</span>
                  <select
                    className="home-forecast-filter-select"
                    value={filters.targetMonth}
                    onChange={(e) => setFilters((prev) => ({ ...prev, targetMonth: e.target.value }))}
                  >
                    <option value="">전체</option>
                    {monthMeta.sortedMonths.map((ym) => (
                      <option key={ym} value={ym}>
                        {formatForecastExpectedMonthCell(ym)}
                      </option>
                    ))}
                    {monthMeta.hasNone ? (
                      <option value={HOME_FORECAST_MONTH_NONE}>목표 월 없음</option>
                    ) : null}
                  </select>
                </label>
              </>
            )}
          </div>
        </div>
      );
    },
    [
      homeForecastActiveFilters,
      homeForecastCompletedFilters,
      forecastActiveProductOptions,
      forecastCompletedProductOptions,
      forecastActiveProbabilityOptions,
      forecastCompletedProbabilityOptions,
      forecastActiveTargetMonthMeta,
      forecastCompletedTargetMonthMeta
    ]
  );

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

    const renderBarBlock = (barSeries) => {
      const nums = barSeries.map((it) => Number(it?.value) || 0);
      const rawMin = nums.length ? Math.min(...nums) : 0;
      const rawMax = nums.length ? Math.max(...nums) : 0;
      const barHasNegative = rawMin < 0;
      const posSpan = Math.max(rawMax, 0);
      const negSpan = Math.max(-rawMin, 0);
      const spanSum = posSpan + negSpan;
      const topFr = spanSum > 0 ? posSpan : 1;
      const botFr = spanSum > 0 ? negSpan : 1;
      const barCount = barSeries.length;
      const barGridStyle = fixedInsightChartColumnsStyle(barCount);

      return (
        <div className="home-bar-chart-wrap">
          <div
            className={`home-mini-chart${fixedInsightChartColumnsDenseClass(barCount)}`}
            style={barGridStyle}
          >
            {barSeries.map((item, idx) => {
              const v = Number(item.value) || 0;
              if (!barHasNegative) {
                const isZero = v === 0;
                return (
                  <HomeChartHoverTip
                    key={`${title}-${item.label}-${idx}`}
                    className="home-mini-chart-col home-mini-chart-col--tip"
                    chartTitle={title}
                    tip={
                      <>
                        <strong>{item.label}</strong>
                        <span>{formatCurrency(item.value, DASHBOARD_DISPLAY_CURRENCY)}</span>
                      </>
                    }
                  >
                    <div className="home-mini-chart-track">
                      <div className="home-mini-chart-bar-hit">
                        <div
                          className={`home-mini-chart-bar home-mini-chart-bar--insight-anim ${item.value < 0 ? 'negative' : ''
                            }${isZero ? ' home-mini-chart-bar--zero-line' : ''}`}
                          style={
                            isZero
                              ? undefined
                              : {
                                height: `${Math.max(12, item.height * 2)}%`,
                                backgroundColor: item.value < 0 ? CHART_VIVID_NEGATIVE : chartColorAt(idx)
                              }
                          }
                        />
                      </div>
                    </div>
                  </HomeChartHoverTip>
                );
              }
              const posPct =
                v > 0 && rawMax > 0 ? Math.max(15, Math.round((v / rawMax) * 100)) : v > 0 ? 100 : 0;
              const negPct =
                v < 0 && rawMin < 0 ? Math.max(15, Math.round((Math.abs(v) / negSpan) * 100)) : v < 0 ? 100 : 0;
              return (
                <HomeChartHoverTip
                  key={`${title}-${item.label}-${idx}`}
                  className="home-mini-chart-col home-mini-chart-col--tip"
                  chartTitle={title}
                  tip={
                    <>
                      <strong>{item.label}</strong>
                      <span>{formatCurrency(item.value, DASHBOARD_DISPLAY_CURRENCY)}</span>
                    </>
                  }
                >
                  <div className="home-mini-chart-track home-mini-chart-track--split-axis">
                    <div className="home-mini-chart-bar-hit home-mini-chart-bar-hit--split">
                      <div
                        className="home-mini-chart-split-top"
                        style={{ flex: posSpan > 0 ? `${topFr} 1 0` : '0 1 0', minHeight: 0 }}
                      >
                        {v > 0 && posSpan > 0 ? (
                          <div
                            className="home-mini-chart-bar home-mini-chart-bar--insight-anim"
                            style={{
                              height: `${posPct}%`,
                              backgroundColor: chartColorAt(idx)
                            }}
                          />
                        ) : null}
                      </div>
                      <div className="home-mini-chart-split-mid" aria-hidden />
                      <div
                        className="home-mini-chart-split-bot"
                        style={{ flex: negSpan > 0 ? `${botFr} 1 0` : '0 1 0', minHeight: 0 }}
                      >
                        {v < 0 && negSpan > 0 ? (
                          <div
                            className="home-mini-chart-bar home-mini-chart-bar--insight-anim negative"
                            style={{
                              height: `${negPct}%`,
                              backgroundColor: CHART_VIVID_NEGATIVE
                            }}
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                </HomeChartHoverTip>
              );
            })}
          </div>
          <div
            className={`home-bar-chart-labels${fixedInsightChartLabelsDenseClass(barCount)}`}
            style={barGridStyle}
          >
            {barSeries.map((item) => (
              <span key={`${title}-x-${item.label}`}>{item.label}</span>
            ))}
          </div>
        </div>
      );
    };

    return (
      <div
        className={`panel home-chart-panel${prefersReducedMotion ? ' home-chart-panel--motion-reduced' : ''
          }`}>
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
          {dashboardShellBlocking ? (
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
                  dealBasRMap={dealBasRMap}
                />
                <div className="home-line-chart-legend" aria-hidden>
                  <span>
                    <span className="home-line-legend-swatch current" /> {insightChartLegendCurrent}
                  </span>
                  <span>
                    <span className="home-line-legend-swatch prev" /> {insightChartLegendPrev}
                  </span>
                </div>
                <div
                  className={`home-line-chart-labels${fixedInsightChartLabelsDenseClass(marginLineCurrent.length)}`}
                  style={fixedInsightChartColumnsStyle(marginLineCurrent.length)}
                >
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
                dealBasRMap={dealBasRMap}
                strokeCurrent={CONSUMER_LINE_COLOR}
                strokePrev={CONSUMER_LINE_PREV}
              />
              <div className="home-line-chart-legend" aria-hidden>
                <span>
                  <span className="home-line-legend-swatch current consumer" /> {insightChartLegendCurrent}
                </span>
                <span>
                  <span className="home-line-legend-swatch prev consumer" /> {insightChartLegendPrev}
                </span>
              </div>
              <div
                className={`home-line-chart-labels${fixedInsightChartLabelsDenseClass(consumerLineCurrent.length)}`}
                style={fixedInsightChartColumnsStyle(consumerLineCurrent.length)}
              >
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

  const renderProductSalesInsightPanel = (opts = {}) => {
    const embedded = opts.embedded === true;
    const prows = productSalesRows;
    const nCols = prows[0]?.series?.length || 0;
    const colGridStyle = fixedInsightChartColumnsStyle(nCols);
    const empty = productSalesInsightAllEmpty(prows);
    const emptyMsg =
      forecastCompletedRowsUnfiltered.length > 0
        ? '제품별 수주 그래프는 단계가 수주 성공(Won)이고 계약일(saleDate)이 있는 건만 집계합니다. Forecast 「완료」에는 확률 100% 등으로 표시되는 기회가 있어, 아래 목록이 보여도 이 그래프는 비어 있을 수 있습니다.'
        : '이 조회 범위·기간·통화에 표시할 제품별 수주(Won) 데이터가 없습니다. 수주 건에 계약일(saleDate)이 없으면 기간 집계에서 제외됩니다.';

    const chartBody = (
          <>
          {dashboardShellBlocking ? (
            <div className="home-ref-trend-empty" role="status">
              <span className="material-symbols-outlined" aria-hidden>hourglass_empty</span>
              <p>그래프 불러오는 중…</p>
            </div>
          ) : empty ? (
            <div className="home-ref-trend-empty" role="status">
              <span className="material-symbols-outlined" aria-hidden>inbox</span>
              <p>{emptyMsg}</p>
            </div>
          ) : productChartMode === 'line' ? (
            <div className="home-line-chart-wrap">
              <ProductSalesLinesChartWithTooltips
                products={prows}
                currency={selectedGraphCurrency}
                title="제품군 판매"
                formatValue={(v) => formatCurrency(Number(v) || 0, DASHBOARD_DISPLAY_CURRENCY)}
              />
              {embedded ? null : <HomeProductChartLegend items={prows} />}
              <div
                className={`home-line-chart-labels${fixedInsightChartLabelsDenseClass(nCols)}`}
                style={colGridStyle}
              >
                {(prows[0]?.series || []).map((item) => (
                  <span key={`제품군-x-${item.label}`}>{item.label}</span>
                ))}
              </div>
            </div>
          ) : (
            <div className="home-bar-chart-wrap">
              <div
                className={`home-mini-chart${fixedInsightChartColumnsDenseClass(nCols)}`}
                style={colGridStyle}
              >
                {Array.from({ length: nCols }, (_, j) => {
                  const lab = prows[0]?.series?.[j]?.label || `${j}`;
                  const total = prows.reduce((s, p) => s + (Number(p.series[j]?.value) || 0), 0);
                  return (
                    <HomeChartHoverTip
                      key={`prod-col-${lab}-${j}`}
                      className="home-mini-chart-col home-mini-chart-col--tip"
                      chartTitle="제품군 판매"
                      tip={
                        <>
                          <strong>{lab}</strong>
                          {prows.map((p) => (
                            <div key={`tt-${String(p.key)}-${j}`}>
                              {p.label}: {formatCurrency(Number(p.series[j]?.value) || 0, DASHBOARD_DISPLAY_CURRENCY)}
                            </div>
                          ))}
                          <div className="home-product-sales-tooltip-sum">
                            합계: {formatCurrency(total, DASHBOARD_DISPLAY_CURRENCY)}
                          </div>
                        </>
                      }
                    >
                      <div className="home-mini-chart-track">
                        <div className="home-mini-chart-bar-hit">
                          {total <= 0 ? (
                            <div className="home-product-sales-stack home-product-sales-stack--zero" aria-hidden />
                          ) : (
                            <div className="home-product-sales-stack">
                              {prows.map((p, pi) => {
                                const v = Math.max(0, Number(p.series[j]?.value) || 0);
                                return (
                                  <div
                                    key={`${String(p.key)}-seg-${j}`}
                                    className="home-product-sales-stack-seg"
                                    style={{
                                      flex: v > 0 ? `${v} 1 0` : '0 1 0',
                                      minHeight: v > 0 ? 3 : 0,
                                      backgroundColor: chartColorAt(pi)
                                    }}
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </HomeChartHoverTip>
                  );
                })}
              </div>
              <div
                className={`home-bar-chart-labels${fixedInsightChartLabelsDenseClass(nCols)}`}
                style={colGridStyle}
              >
                {(prows[0]?.series || []).map((item) => (
                  <span key={`prod-bar-x-${item.label}`}>{item.label}</span>
                ))}
              </div>
              {embedded ? null : <HomeProductChartLegend items={prows} />}
            </div>
          )}
          </>
    );
    if (embedded) {
      return <div className="home-ref-trend-embed-body">{chartBody}</div>;
    }
    return (
      <div
        className={`panel home-chart-panel home-chart-panel--product-sales${prefersReducedMotion ? ' home-chart-panel--motion-reduced' : ''
          }`}>
        <div className="panel-head home-chart-head">
          <div>
            <h2>제품군 판매</h2>
            <p className="home-chart-subtitle">{productSalesSubtitle}</p>
          </div>
          <div className="home-chart-actions">
            <div className="home-chart-view-toggle">
              <button
                type="button"
                className="home-chart-type-icon active"
                onClick={() => handleProductChartModeChange(productChartMode === 'bar' ? 'line' : 'bar')}
                aria-label={
                  productChartMode === 'bar'
                    ? '막대 그래프로 보는 중입니다. 제품별 꺾은선으로 전환합니다.'
                    : '제품별 꺾은선으로 보는 중입니다. 막대로 전환합니다.'
                }
                title={productChartMode === 'bar' ? '제품별 꺾은선으로 전환' : '막대(누적)로 전환'}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  {productChartMode === 'bar' ? 'bar_chart' : 'show_chart'}
                </span>
              </button>
            </div>
          </div>
        </div>
        <div className="home-chart-body">{chartBody}</div>
      </div>
    );
  };

  const renderProductQtyInsightPanel = (opts = {}) => {
    const embedded = opts.embedded === true;
    const qrows = productQtyRows;
    const nCols = qrows[0]?.series?.length || 0;
    const colGridStyle = fixedInsightChartColumnsStyle(nCols);
    const empty = productSalesInsightAllEmpty(qrows);
    const emptyMsgQty =
      forecastCompletedRowsUnfiltered.length > 0
        ? '제품별 수량 그래프는 수주 성공(Won)이고 계약일(saleDate)이 있는 건만 집계합니다. Forecast 목록과 다를 수 있습니다.'
        : '이 조회 범위·기간에 표시할 제품별 수량 데이터가 없습니다.';

    const chartBody = (
          <>
          {dashboardShellBlocking ? (
            <div className="home-ref-trend-empty" role="status">
              <span className="material-symbols-outlined" aria-hidden>hourglass_empty</span>
              <p>그래프 불러오는 중…</p>
            </div>
          ) : empty ? (
            <div className="home-ref-trend-empty" role="status">
              <span className="material-symbols-outlined" aria-hidden>inbox</span>
              <p>{emptyMsgQty}</p>
            </div>
          ) : quantityChartMode === 'line' ? (
            <div className="home-line-chart-wrap">
              <ProductSalesLinesChartWithTooltips
                products={qrows}
                currency={selectedGraphCurrency}
                title="제품별 판매 수량"
                formatValue={formatHomeProductQty}
              />
              {embedded ? null : <HomeProductChartLegend items={qrows} />}
              <div
                className={`home-line-chart-labels${fixedInsightChartLabelsDenseClass(nCols)}`}
                style={colGridStyle}
              >
                {(qrows[0]?.series || []).map((item) => (
                  <span key={`제품수량-x-${item.label}`}>{item.label}</span>
                ))}
              </div>
            </div>
          ) : (
            <div className="home-bar-chart-wrap">
              <div
                className={`home-mini-chart${fixedInsightChartColumnsDenseClass(nCols)}`}
                style={colGridStyle}
              >
                {Array.from({ length: nCols }, (_, j) => {
                  const lab = qrows[0]?.series?.[j]?.label || `${j}`;
                  const total = qrows.reduce((s, p) => s + (Number(p.series[j]?.value) || 0), 0);
                  return (
                    <HomeChartHoverTip
                      key={`qty-col-${lab}-${j}`}
                      className="home-mini-chart-col home-mini-chart-col--tip"
                      chartTitle="제품별 판매 수량"
                      tip={
                        <>
                          <strong>{lab}</strong>
                          {qrows.map((p) => (
                            <div key={`qty-tt-${String(p.key)}-${j}`}>
                              {p.label}: {formatHomeProductQty(Number(p.series[j]?.value) || 0)}
                            </div>
                          ))}
                          <div className="home-product-sales-tooltip-sum">
                            합계: {formatHomeProductQty(total)}
                          </div>
                        </>
                      }
                    >
                      <div className="home-mini-chart-track">
                        <div className="home-mini-chart-bar-hit">
                          {total <= 0 ? (
                            <div className="home-product-sales-stack home-product-sales-stack--zero" aria-hidden />
                          ) : (
                            <div className="home-product-sales-stack">
                              {qrows.map((p, pi) => {
                                const v = Math.max(0, Number(p.series[j]?.value) || 0);
                                return (
                                  <div
                                    key={`${String(p.key)}-qty-seg-${j}`}
                                    className="home-product-sales-stack-seg"
                                    style={{
                                      flex: v > 0 ? `${v} 1 0` : '0 1 0',
                                      minHeight: v > 0 ? 3 : 0,
                                      backgroundColor: chartColorAt(pi)
                                    }}
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </HomeChartHoverTip>
                  );
                })}
              </div>
              <div
                className={`home-bar-chart-labels${fixedInsightChartLabelsDenseClass(nCols)}`}
                style={colGridStyle}
              >
                {(qrows[0]?.series || []).map((item) => (
                  <span key={`qty-bar-x-${item.label}`}>{item.label}</span>
                ))}
              </div>
              {embedded ? null : <HomeProductChartLegend items={qrows} />}
            </div>
          )}
          </>
    );
    if (embedded) {
      return <div className="home-ref-trend-embed-body">{chartBody}</div>;
    }
    return (
      <div
        className={`panel home-chart-panel home-chart-panel--product-qty${prefersReducedMotion ? ' home-chart-panel--motion-reduced' : ''
          }`}
      >
        <div className="panel-head home-chart-head">
          <div>
            <h2>제품별 판매 수량</h2>
            <p className="home-chart-subtitle">{productQtySubtitle}</p>
          </div>
          <div className="home-chart-actions">
            <div className="home-chart-view-toggle">
              <button
                type="button"
                className="home-chart-type-icon active"
                onClick={() => handleQuantityChartModeChange(quantityChartMode === 'bar' ? 'line' : 'bar')}
                aria-label={
                  quantityChartMode === 'bar'
                    ? '막대 그래프로 보는 중입니다. 제품별 꺾은선으로 전환합니다.'
                    : '제품별 꺾은선으로 보는 중입니다. 막대로 전환합니다.'
                }
                title={quantityChartMode === 'bar' ? '제품별 꺾은선으로 전환' : '막대(누적)로 전환'}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  {quantityChartMode === 'bar' ? 'bar_chart' : 'show_chart'}
                </span>
              </button>
            </div>
          </div>
        </div>
        <div className="home-chart-body">{chartBody}</div>
      </div>
    );
  };

  /** ref_home: 추이 차트는 매출·순마진 / 제품·수량 두 묶음으로 표시 */
  const renderHomeRefTrendCard = () => {
    const yearBadge = (() => {
      const labs = Array.isArray(consumerTween)
        ? consumerTween.map((x) => String(x?.label || '').trim()).filter(Boolean)
        : [];
      if (kpiPeriod === 'year' && labs.length >= 2) {
        const first = labs[0].replace(/\s*\(?당해\)?\s*$/u, '');
        const last = labs[labs.length - 1].replace(/\s*\(?당해\)?\s*$/u, '');
        return `${labs.length}개년 비교 (${first} - ${last})`;
      }
      return salesChartMeta?.title || consumerChartTitle || '기간 비교';
    })();
    const isYearChart = kpiPeriod === 'year';
    const legendCurrent =
      salesChartMeta?.legendCurrent ||
      (isYearChart ? '해당 연도' : '해당 기간');
    const legendPrev =
      salesChartMeta?.legendPrev ||
      (isYearChart ? '전년 동일 연도' : '전년 동일 기간');
    const formatAxis = (v) => {
      const n = Math.abs(Number(v) || 0);
      if (n >= 100000000) return `${Math.round(n / 100000000)}억`;
      if (n >= 10000) return `${Math.round(n / 10000).toLocaleString('ko-KR')}만`;
      return String(Math.round(n));
    };
    const shareItems = (() => {
      const rows = Array.isArray(productSalesRows) ? productSalesRows : [];
      const withTot = rows.map((p, pi) => ({
        key: p.key,
        label: p.label,
        color: chartColorAt(pi),
        total: (p.series || []).reduce((s, x) => s + Math.max(0, Number(x?.value) || 0), 0)
      }));
      const sum = withTot.reduce((s, t) => s + t.total, 0);
      return withTot
        .filter((t) => t.total > 0)
        .map((t) => ({
          ...t,
          pct: sum > 0 ? Math.round((t.total / sum) * 100) : 0
        }))
        .sort((a, b) => b.total - a.total);
    })();

    const renderLineBlock = (kind) => {
      const isMargin = kind === 'margin';
      const cur = isMargin ? netTween : consumerTween;
      const prev = isMargin ? netPrevTween : consumerPrevTween;
      const empty = isMargin
        ? chartSeriesAllZero(cur)
        : chartSeriesAllZero(cur) && chartSeriesAllZero(prev);
      const emptyText = isMargin ? marginInsightEmpty : consumerInsightEmpty;
      if (dashboardShellBlocking) {
        return (
          <div className="home-ref-trend-empty" role="status">
            <span className="material-symbols-outlined" aria-hidden>hourglass_empty</span>
            <p>그래프 불러오는 중…</p>
          </div>
        );
      }
      if (empty) {
        return (
          <div className="home-ref-trend-empty" role="status">
            <span className="material-symbols-outlined" aria-hidden>inbox</span>
            <p>{emptyText || '표시할 데이터가 없습니다.'}</p>
          </div>
        );
      }
      const extents = lineChartExtentsFromSeries(cur, prev);
      const yTicks = [1, 0.667, 0.333, 0.167, 0].map((r) => ({
        key: String(r),
        label: r === 0 ? '0' : formatAxis(extents.vMax * r)
      }));
      return (
        <div className="home-ref-trend-plot home-ref-trend-plot--compact home-line-chart-wrap">
          <div className="home-ref-trend-y-axis" aria-hidden>
            {yTicks.map((t) => (
              <div key={t.key} className="home-ref-trend-y-row">
                <span>{t.label}</span>
              </div>
            ))}
          </div>
          <MarginLineChartWithTooltips
            marginLineCurrent={cur}
            marginLinePrev={prev}
            currency={selectedGraphCurrency}
            title={isMargin ? '순마진' : consumerChartTitle}
            dealBasRMap={dealBasRMap}
            strokeCurrent={isMargin ? MARGIN_LINE_CURRENT : CONSUMER_LINE_COLOR}
            strokePrev={isMargin ? MARGIN_LINE_PREV : CONSUMER_LINE_PREV}
            fillUnder
            fillColor={isMargin ? MARGIN_LINE_CURRENT : CONSUMER_LINE_FILL}
            hollowMarkers
            tipLastValue
          />
          <div className="home-ref-trend-x-labels">
            {cur.map((item, idx) => {
              const xPct = (lineChartX(idx, cur.length) / LINE_CHART_VB.w) * 100;
              const isLast = idx === cur.length - 1;
              const isPrev = idx === cur.length - 2;
              const rawLabel = String(item.label || '').trim();
              const yearLabel = rawLabel
                .replace(/\s*\(?당해\)?\s*$/u, '')
                .replace(/년\s*$/u, '');
              const shortYear = yearLabel.replace(/^20(?=\d{2}$)/, '');
              // 연간 차트만 마지막을 '당해'로 축약. 월/분기/반기는 실제 구간 라벨 유지(10~12월 등).
              const displayLabel = isYearChart
                ? (isLast ? '당해' : shortYear)
                : (rawLabel || shortYear);
              const titleText = isYearChart
                ? (isLast ? `${yearLabel}년 (당해)` : `${yearLabel}년`)
                : rawLabel;
              return (
                <span
                  key={`trend-x-${kind}-${item.label}-${idx}`}
                  className={[
                    isLast ? 'home-ref-trend-x-current is-end' : '',
                    isPrev ? 'is-prev-end' : ''
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined}
                  style={{ left: `${xPct}%` }}
                  title={titleText}
                >
                  {displayLabel}
                </span>
              );
            })}
          </div>
        </div>
      );
    };

    const renderMiniFooter = (isMargin) => (
      <div className="home-ref-trend-footer home-ref-trend-footer--compact">
        <div className="home-ref-trend-footer-lines">
          <span className="home-ref-trend-leg">
            <span className={`home-ref-trend-leg-swatch solid${isMargin ? ' is-margin' : ''}`} />
            <span className="home-ref-trend-leg-label">
              {isMargin ? `${legendCurrent} 순마진` : `${legendCurrent} 매출`}
            </span>
          </span>
          <span className="home-ref-trend-leg">
            <span className="home-ref-trend-leg-swatch dashed" />
            <span className="home-ref-trend-leg-label muted">{legendPrev}</span>
          </span>
        </div>
      </div>
    );

    return (
      <div className="home-ref-trend-bundles" data-purpose="chart-bundles">
        <section
          className={`panel home-chart-panel home-ref-trend-card home-ref-trend-card--bundle${prefersReducedMotion ? ' home-chart-panel--motion-reduced' : ''}`}
          aria-label={`${consumerChartTitle} 및 순마진`}
        >
          <div className="home-ref-trend-head">
            <div className="home-ref-trend-head-text">
              <h2 className="home-ref-trend-title">
                <span>{`${wonLeaderboardPeriodLabel}별 매출 · 순마진`}</span>
                <span className="home-ref-trend-badge">{yearBadge}</span>
              </h2>
              <p className="home-ref-trend-sub">수주 성공 건의 소비자가·순마진 추이</p>
            </div>
          </div>
          <div className="home-ref-trend-bundle-stack">
            <div className="home-ref-trend-bundle-item">
              <h3 className="home-ref-trend-bundle-item-title">{consumerChartTitle}</h3>
              <div className="home-ref-trend-body home-chart-body">{renderLineBlock('revenue')}</div>
              {renderMiniFooter(false)}
            </div>
            <div className="home-ref-trend-bundle-item">
              <h3 className="home-ref-trend-bundle-item-title">순마진</h3>
              <div className="home-ref-trend-body home-chart-body">{renderLineBlock('margin')}</div>
              {renderMiniFooter(true)}
            </div>
          </div>
        </section>

        <section
          className={`panel home-chart-panel home-ref-trend-card home-ref-trend-card--bundle${prefersReducedMotion ? ' home-chart-panel--motion-reduced' : ''}`}
          aria-label="제품군별 판매 및 수량"
        >
          <div className="home-ref-trend-head">
            <div className="home-ref-trend-head-text">
              <h2 className="home-ref-trend-title">
                <span>제품군별 판매 · 수량</span>
                <span className="home-ref-trend-badge">{yearBadge}</span>
              </h2>
              <p className="home-ref-trend-sub">수주 성공 건의 제품군 금액·수량 비중</p>
            </div>
            <HomeProductLegendMenu
              items={shareItems}
              title="제품군 목록"
              ariaLabel="제품군 목록 보기"
            />
          </div>
          <div className="home-ref-trend-bundle-stack">
            <div className="home-ref-trend-bundle-item">
              <h3 className="home-ref-trend-bundle-item-title">제품군별 판매</h3>
              <div className="home-ref-trend-body home-chart-body">
                {renderProductSalesInsightPanel({ embedded: true })}
              </div>
            </div>
            <div className="home-ref-trend-bundle-item">
              <h3 className="home-ref-trend-bundle-item-title">수량</h3>
              <div className="home-ref-trend-body home-chart-body">
                {renderProductQtyInsightPanel({ embedded: true })}
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  };

  const renderCaptureLeadRow = (lead, options = {}) => {
    const isCompletedRow = options.completed === true;
    const completedMeta = isCompletedRow ? sharedCompletedLeadMap[String(lead?._id || '')] : null;
    return (
      <li
        key={String(lead._id)}
        className="home-todo-leads-item home-todo-leads-item--clickable"
        onClick={() => openLeadDetail(lead)}
      >
        {isCompletedRow ? (
          <span className="home-lead-check home-lead-check--done" aria-hidden>
            <span className="material-symbols-outlined">check_circle</span>
          </span>
        ) : (
          <button
            type="button"
            className="home-lead-check"
            onClick={(e) => {
              e.stopPropagation();
              dismissLeadFromHome(lead._id);
            }}
            aria-label="처리 완료"
            title="처리 완료"
          >
            <span className="material-symbols-outlined" aria-hidden>radio_button_unchecked</span>
          </button>
        )}
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
            {isCompletedRow ? (
              <span className="home-todo-leads-processed-by">
                처리: {String(completedMeta?.byName || '사용자')} · {formatLeadReceivedAt(completedMeta?.doneAt)}
              </span>
            ) : null}
          </div>
        </div>
        <span className="home-todo-leads-chevron" aria-hidden>
          <span className="material-symbols-outlined">chevron_right</span>
        </span>
        <div className="home-todo-leads-item-trailing">
          {!isCompletedRow ? (
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
          ) : null}
          <time
            className="home-todo-leads-time"
            dateTime={lead.receivedAt ? new Date(lead.receivedAt).toISOString() : undefined}
          >
            {formatLeadReceivedAt(lead.receivedAt)}
          </time>
        </div>
      </li>
    );
  };

  return (
    <div className={`page home-page home-page--ref${activeHomeView ? ' home-page--full-view-open' : ''}`}>
      <HomeLeadDetailModal
        open={leadDetailOpen}
        formId={leadDetailContext?.formId}
        leadId={leadDetailContext?.leadId}
        channelLabel={leadDetailContext?.channelLabel}
        channelSource={leadDetailContext?.channelSource}
        onClose={closeLeadDetail}
        onUpdated={() => { }}
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

        <section className="home-insights-top" aria-label="소비자가·순마진 인사이트">
          {!insightAccess.checked || !homeInsightToolbarTemplateReady ? (
            <>
              <div className="home-insight-toolbar home-insight-toolbar--access-loading" aria-busy="true">
                <div className="home-insight-toolbar-access-placeholder">
                  <HomePastelSpinner
                    size="sm"
                    label="조회 범위·기간 불러오는 중"
                    reducedMotion={prefersReducedMotion}
                  />
                </div>
              </div>
              <div
                className={`home-kpi-strip${prefersReducedMotion ? ' home-kpi-strip--motion-reduced' : ''}`}
                aria-label="핵심 실적 요약"
              >
                {['rev', 'gm', 'goal', 'lead', 'project'].map((key) => (
                  <div
                    key={key}
                    className="home-kpi-card home-kpi-card--access-loading"
                    aria-busy="true"
                    aria-label="권한 확인 중"
                  >
                    <div className="home-kpi-card-access-spin">
                      <HomePastelSpinner size="kpi" reducedMotion={prefersReducedMotion} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="home-insights-charts-grid" aria-label="인사이트 차트">
              <div className="panel home-chart-panel home-chart-panel--access-loading" aria-busy="true">
                <div className="panel-head home-chart-head">
                  <div>
                    <h2>{consumerChartTitle}</h2>
                    <p className="home-chart-subtitle">수주·파이프라인 기준 (확인 후 표시)</p>
                  </div>
                </div>
                <div className="home-chart-body home-chart-body--access-loading">
                  <HomePastelSpinner label="권한 확인 중" reducedMotion={prefersReducedMotion} />
                </div>
              </div>
              <div className="panel home-chart-panel home-chart-panel--access-loading" aria-busy="true">
                <div className="panel-head home-chart-head">
                  <div>
                    <h2>순마진 그래프</h2>
                    <p className="home-chart-subtitle">동일 기간·범위 (확인 후 표시)</p>
                  </div>
                </div>
                <div className="home-chart-body home-chart-body--access-loading">
                  <HomePastelSpinner label="권한 확인 중" reducedMotion={prefersReducedMotion} />
                </div>
              </div>
              <div className="panel home-chart-panel home-chart-panel--access-loading" aria-busy="true">
                <div className="panel-head home-chart-head">
                  <div>
                    <h2>제품군 판매</h2>
                    <p className="home-chart-subtitle">동일 필터·기간 (확인 후 표시)</p>
                  </div>
                </div>
                <div className="home-chart-body home-chart-body--access-loading">
                  <HomePastelSpinner label="권한 확인 중" reducedMotion={prefersReducedMotion} />
                </div>
              </div>
              <div className="panel home-chart-panel home-chart-panel--access-loading" aria-busy="true">
                <div className="panel-head home-chart-head">
                  <div>
                    <h2>제품별 판매 수량</h2>
                    <p className="home-chart-subtitle">동일 필터·기간 (확인 후 표시)</p>
                  </div>
                </div>
                <div className="home-chart-body home-chart-body--access-loading">
                  <HomePastelSpinner label="권한 확인 중" reducedMotion={prefersReducedMotion} />
                </div>
              </div>
              </div>
            </>
          ) : (
            <>
              <div className="home-insight-toolbar">
                <div
                  className={`home-insight-toolbar-rows${dashboardDataBusy ? ' home-insight-toolbar-rows--dashboard-refresh' : ''}`}
                >
                  <div className="home-insight-toolbar-primary-row">
                    <div className="home-insight-toolbar-scope">
                      <div className="home-insight-toolbar-scope-cluster">
                        {data?.insightScope?.leaderSubtree ? (
                          <div
                            className="home-insight-mode-switch home-insight-mode-switch--leader home-insight-mode-switch--with-company"
                            role="tablist"
                            aria-label="소비자가·순마진 조회 범위"
                          >
                            <button
                              type="button"
                              className={isCompanyWideInsight ? 'is-active' : ''}
                              onClick={() => setCompanyWideInsight(true)}
                              title="회사 전체 수주·파이프라인 기준"
                            >
                              회사 전체
                            </button>
                            <button
                              type="button"
                              className={!isCompanyWideInsight && leaderInsightViewKind === 'team' ? 'is-active' : ''}
                              onClick={() => setLeaderInsightViewKind('team')}
                            >
                              팀별
                            </button>
                            <button
                              type="button"
                              className={!isCompanyWideInsight && leaderInsightViewKind === 'personal' ? 'is-active' : ''}
                              onClick={() => setLeaderInsightViewKind('personal')}
                            >
                              개인 보기
                            </button>
                          </div>
                        ) : (
                          <div
                            className="home-insight-mode-switch home-insight-mode-switch--with-company home-insight-mode-switch--solo-non-leader"
                            role="tablist"
                            aria-label="조회 범위"
                          >
                            <button
                              type="button"
                              className={isCompanyWideInsight ? 'is-active' : ''}
                              onClick={() => setCompanyWideInsight(true)}
                              title="회사 전체 수주·파이프라인 기준"
                            >
                              회사 전체
                            </button>
                            <button
                              type="button"
                              className={!isCompanyWideInsight && leaderInsightViewKind === 'team' ? 'is-active' : ''}
                              onClick={() => setLeaderInsightViewKind('team')}
                            >
                              팀별
                            </button>
                            <button
                              type="button"
                              className={!isCompanyWideInsight && leaderInsightViewKind === 'personal' ? 'is-active' : ''}
                              onClick={() => setLeaderInsightViewKind('personal')}
                            >
                              개인 보기
                            </button>
                          </div>
                        )}
                        <button
                          type="button"
                          className="home-insight-lead-badge"
                          aria-label="신규 리드 진행 건수"
                          onClick={() => openHomeView('leads')}
                        >
                          <span className="home-insight-lead-badge-pulse" aria-hidden />
                          <span
                            className="home-insight-lead-badge-label"
                            title="리드 캡처·웹폼 등으로 들어온 미처리 건수입니다. 아래 KPI 카드「신규 리드 건수」(세일즈 파이프라인 신규 단계)와는 다른 지표입니다."
                          >
                            새로운 수신 리드 <strong className="home-insight-lead-badge-count">{pendingLeadCount.toLocaleString('ko-KR')}건</strong> 유입
                          </span>
                        </button>
                        {data?.insightScope?.leaderSubtree ? (
                          !isCompanyWideInsight && data?.insightLeaderFilters ? (
                            <div className="home-insight-leader-filters-inline" aria-label="팀·직원 범위">
                              {leaderInsightViewKind === 'team' ? (
                                <label className="home-insight-filter-field home-insight-filter-field--inline">
                                  {(() => {
                                    const deptOptions = Array.isArray(data.insightLeaderFilters.departments)
                                      ? data.insightLeaderFilters.departments
                                      : [];
                                    const deptIdSet = new Set(deptOptions.map((d) => String(d?.id || '').trim()).filter(Boolean));
                                    const deptSelectValue =
                                      insightDeptQ && deptIdSet.has(insightDeptQ) ? insightDeptQ : '';
                                    return (
                                      <select
                                        className="home-insight-filter-select home-insight-filter-select--inline"
                                        value={deptSelectValue}
                                        onChange={(e) => setHomeInsightDeptFilter(e.target.value)}
                                        aria-label="팀 부서 범위"
                                      >
                                        <option value="">팀 전체</option>
                                        {deptOptions.map((d) => (
                                          <option key={d.id} value={d.id}>
                                            {d.label}
                                          </option>
                                        ))}
                                      </select>
                                    );
                                  })()}
                                </label>
                              ) : (
                                <label className="home-insight-filter-field home-insight-filter-field--inline">
                                  <select
                                    className="home-insight-filter-select home-insight-filter-select--inline"
                                    value={insightUserQ || myCrmUserId}
                                    onChange={(e) => setHomeInsightUserFilter(e.target.value)}
                                  >
                                    {(data.insightLeaderFilters.users || []).map((u) => (
                                      <option key={u.id} value={u.id}>
                                        {formatLeaderEmployeeOptionLabel(u, data.insightLeaderFilters.departments)}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                            </div>
                          ) : null
                        ) : null}
                      </div>
                    </div>

                    <div className="home-kpi-period-toolbar">
                      {dashboardDataBusy ? (
                        <div className="home-insight-dashboard-refresh" aria-live="polite" aria-busy="true">
                          <HomePastelSpinner size="sm" label="집계 반영 중" reducedMotion={prefersReducedMotion} />
                        </div>
                      ) : null}
                      <div
                        className="home-insight-mode-switch home-kpi-period-switch"
                        role="tablist"
                        aria-label="KPI 집계 기간"
                      >
                        {[
                          { id: 'month', label: '월간' },
                          { id: 'quarter', label: '분기' },
                          { id: 'half', label: '반기' },
                          { id: 'year', label: '연간' }
                        ].map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            className={kpiPeriod === opt.id ? 'is-active' : ''}
                            onClick={() => setHomeKpiPeriod(opt.id)}
                            title={
                              opt.id === 'half'
                                ? '당반기(1~6월 또는 7~12월) 월별 — 아래 그래프 버킷과 동일'
                                : '매출·이익률·신규 리드는 이 기간으로 집계됩니다. 위 조회 범위(회사 전체·팀·개인)와 함께 적용됩니다.'
                            }
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div
                className={`home-kpi-strip${prefersReducedMotion ? ' home-kpi-strip--motion-reduced' : ''}`}
                aria-label="핵심 실적 요약"
              >
                {homeKpiCards.map((card) => {
                  const gmNonMarginAmount = Number(
                    krwInsightKpi?.grossMargin?.nonMarginAmount ??
                    stats.kpiSummary?.grossMargin?.nonMarginAmount ??
                    0
                  );
                  const gmNetMarginTotal = Number(
                    krwInsightKpi?.grossMargin?.netMarginTotal ??
                    stats.kpiSummary?.grossMargin?.netMarginTotal ??
                    0
                  );
                  if (card.skeleton) {
                    return (
                      <div key={card.key} className="home-kpi-card home-kpi-card--skeleton" aria-busy="true">
                        <div className="home-kpi-skel-line home-kpi-skel-line--short" />
                        <div className="home-kpi-skel-line home-kpi-skel-line--value" />
                        <div className="home-kpi-skel-line" />
                        <div className="home-kpi-skel-line" />
                      </div>
                    );
                  }
                  const showForecast = card.showForecast === true;
                  const showPeriod = card.showPeriod === true;
                  const curD = DASHBOARD_DISPLAY_CURRENCY;
                  const projectDoneCount = homeProjectCounts.done;
                  const projectActiveCount = homeProjectCounts.active;
                  const projectTotalCount = homeProjectCounts.total;
                  let displayMain = card.value;
                  let displayMainNode = null;
                  if (!dashboardShellBlocking) {
                    if (card.key === 'rev') {
                      displayMain = formatCurrency(Math.round(revAnim), curD);
                      displayMainNode = (
                        <DashboardKrwCell
                          amount={Math.round(revAnim)}
                          currency={curD}
                          dealBasRMap={dealBasRMap}
                        />
                      );
                    } else if (card.key === 'gm') displayMain = `${gmRateAnim.toFixed(1)}%`;
                    else if (card.key === 'goal') {
                      displayMain = formatCurrency(Math.round(goalAnim), curD);
                      displayMainNode = (
                        <DashboardKrwCell
                          amount={Math.round(goalAnim)}
                          currency={curD}
                          dealBasRMap={dealBasRMap}
                        />
                      );
                    }
                    else if (card.key === 'lead') displayMain = `${Math.round(leadAnim)}건`;
                    else if (card.key === 'project') {
                      displayMain = homeProjectPreviewLoading
                        ? '…'
                        : projectTotalCount <= 0
                          ? '—'
                          : `${Math.round(projectAchieveAnim)}%`;
                    }
                  }
                  let forecastText = '—';
                  if (!dashboardShellBlocking && showForecast) {
                    if (card.forecastMode === 'rawPct') {
                      if (card.key === 'goal') {
                        forecastText = `${Math.round(goalCompletionAnim)}%`;
                      } else if (card.key === 'project') {
                        forecastText =
                          projectTotalCount > 0 && !homeProjectPreviewLoading
                            ? `${Math.round(projectAchieveAnim)}%`
                            : '—';
                      } else if (homeKpiComparisonRawIsPresent(card.forecast)) {
                        forecastText = `${Number(card.forecast).toFixed(1)}%`;
                      }
                    } else if (card.forecastMode === 'pp' && card.key === 'gm') {
                      forecastText = !homeKpiComparisonRawIsPresent(gmFcRaw)
                        ? '—'
                        : formatHomeKpiForecastPP(gmFcAnim);
                    } else if (card.key === 'rev') {
                      forecastText = !homeKpiComparisonRawIsPresent(revFcRaw)
                        ? '—'
                        : formatHomeKpiForecastPct(revFcAnim);
                    } else if (card.key === 'lead') {
                      forecastText = !homeKpiComparisonRawIsPresent(leadFcRaw)
                        ? '—'
                        : formatHomeKpiForecastPct(leadFcAnim);
                    } else {
                      forecastText = !homeKpiComparisonRawIsPresent(card.forecast)
                        ? '—'
                        : card.forecastMode === 'pp'
                          ? formatHomeKpiForecastPP(card.forecast)
                          : formatHomeKpiForecastPct(card.forecast);
                    }
                  }
                  const periodIsPP = card.periodMode === 'deltaPP';
                  let delta = formatHomeKpiDeltaPct(null, periodIsPP);
                  if (!dashboardShellBlocking && showPeriod) {
                    if (card.key === 'rev') {
                      delta = !homeKpiComparisonRawIsPresent(revYoyRaw)
                        ? formatHomeKpiDeltaPct(null, periodIsPP)
                        : formatHomeKpiDeltaPct(revYoyAnim, periodIsPP);
                    } else if (card.key === 'gm') {
                      delta = !homeKpiComparisonRawIsPresent(gmYoyRaw)
                        ? formatHomeKpiDeltaPct(null, periodIsPP)
                        : formatHomeKpiDeltaPct(gmYoyAnim, periodIsPP);
                    } else if (card.key === 'lead') {
                      delta = !homeKpiComparisonRawIsPresent(leadYoyRaw)
                        ? formatHomeKpiDeltaPct(null, periodIsPP)
                        : formatHomeKpiDeltaPct(leadYoyAnim, periodIsPP);
                    } else if (card.key === 'goal') {
                      delta = !homeKpiComparisonRawIsPresent(goalYoyRaw)
                        ? formatHomeKpiDeltaPct(null, periodIsPP)
                        : formatHomeKpiDeltaPct(goalYoyAnim, periodIsPP);
                    } else {
                      delta = !homeKpiComparisonRawIsPresent(card.period)
                        ? formatHomeKpiDeltaPct(null, periodIsPP)
                        : formatHomeKpiDeltaPct(card.period, periodIsPP);
                    }
                  }
                  const showTargetLine = card.key === 'rev';
                  const targetRevenue = Number(homeKpiTargetSnapshot?.target?.targetRevenue || 0);
                  let targetMetricText = '—';
                  let targetMetricPercent = '—';
                  let targetAmountUnderValue = '';
                  let targetTrendClass = '';
                  if (showTargetLine) {
                    if (homeKpiTargetSnapshot.loading) {
                      targetMetricText = '집계 중';
                      targetMetricPercent = '—';
                    } else if (homeKpiTargetSnapshot.reason) {
                      targetMetricText = '—';
                      targetMetricPercent = '—';
                    } else if (card.key === 'rev') {
                      if (targetRevenue <= 0) {
                        targetMetricText = '목표 미설정';
                        targetMetricPercent = '—';
                      } else {
                        const pct = (Number(revNum || 0) / targetRevenue) * 100;
                        targetAmountUnderValue = `목표 ${formatCurrency(Math.round(targetRevenue), curD)}`;
                        targetMetricText = homeKpiTargetSnapshot.periodLabel || '목표 대비';
                        targetMetricPercent = `${Number.isFinite(pct) ? pct.toFixed(1) : '0.0'}%`;
                        targetTrendClass = pct >= 100 ? 'is-up' : pct > 0 ? 'is-down' : '';
                      }
                    }
                  }
                  const periodDeltaText = dashboardShellBlocking ? '—' : delta.text;
                  const openHomeKpiExplainModal = () => {
                    if (card.skeleton) return;
                    setHomeKpiExplainSpec(
                      makeHomeKpiExplainSpec({
                        card,
                        cardKey: card.key,
                        kpiPeriod,
                        scopeLine: homeKpiScopeDescription,
                        kpiMeta: stats.kpiSummary?.kpiMeta,
                        halfFromGraphs: kpiPeriod === 'half',
                        displayMain: dashboardShellBlocking ? '—' : displayMain,
                        forecastText,
                        periodDeltaText,
                        showForecast,
                        showPeriod,
                        forecastMetricLabel: card.forecastMetricLabel,
                        periodLabel: card.periodLabel,
                        targetMetricText,
                        targetMetricPercent,
                        targetAmountLine: dashboardShellBlocking ? '—' : targetAmountUnderValue || '목표 미설정',
                        revNum,
                        targetRevenue,
                        homeKpiTargetLoading: !!homeKpiTargetSnapshot.loading,
                        homeKpiTargetReason: homeKpiTargetSnapshot.reason || '',
                        gmRatePct: stats.kpiSummary?.grossMargin?.ratePct,
                        gmNetMarginTotal,
                        gmNonMarginAmount,
                        curD,
                        goalTaskCompletion: stats.kpiSummary?.goal?.taskCompletion,
                        leadCount: leadNum,
                        projectDone: projectDoneCount,
                        projectActive: projectActiveCount,
                        projectTotal: projectTotalCount,
                        loading: dashboardShellBlocking,
                        dashboardMeta: stats.dashboardMeta || null,
                        kpiWonExplain: stats.kpiWonExplain || null,
                        kpiCollectedExplain: stats.kpiCollectedExplain || null,
                        forecastPipelineRows: stats.forecastPipelineRows || [],
                        forecastPipelineMeta: stats.forecastPipelineMeta || null,
                        homeProjectPreview,
                        homeProjectPreviewLoading,
                        goalFootnoteModel: buildGoalKpiFootnoteModel(stats)
                      })
                    );
                  };
                  const onKpiExplainCardKeyDown = (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openHomeKpiExplainModal();
                    }
                  };
                  if (card.key === 'project') {
                    const doneW =
                      projectTotalCount > 0 ? Math.round((100 * projectDoneCount) / projectTotalCount) : 0;
                    const activeW =
                      projectTotalCount > 0 ? Math.max(0, Math.min(100, 100 - doneW)) : 0;
                    return (
                      <article
                        key={card.key}
                        className={`home-kpi-card home-kpi-card--project-preview home-kpi-card--clickable home-kpi-card--tone-${card.tone || 'indigo'}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${card.title} 자세히 보기`}
                        onClick={openHomeKpiExplainModal}
                        onKeyDown={onKpiExplainCardKeyDown}
                      >
                        <div className="home-kpi-card-head">
                          <span className="home-kpi-card-title">{card.title}</span>
                          <span className={`home-kpi-card-icon-wrap home-kpi-card-icon-wrap--${card.tone || 'indigo'}`} aria-hidden>
                            <span className="material-symbols-outlined home-kpi-card-icon">
                              {card.icon}
                            </span>
                          </span>
                        </div>
                        <p className="home-kpi-card-value home-kpi-card-value--insight-anim">
                          {dashboardShellBlocking || homeProjectPreviewLoading ? '—' : displayMain}
                        </p>
                        {!dashboardShellBlocking && !homeProjectPreviewLoading && projectTotalCount > 0 ? (
                          <p className="home-kpi-card-target-amount home-kpi-card-target-amount--project-caption">
                            완료 {projectDoneCount}건 · 진행 {projectActiveCount}건 · 전체 {projectTotalCount}건
                          </p>
                        ) : !dashboardShellBlocking && !homeProjectPreviewLoading && projectTotalCount === 0 ? (
                          <p className="home-kpi-card-target-amount home-kpi-card-target-amount--project-caption home-kpi-card-target-amount--muted">
                            등록된 프로젝트가 없습니다
                          </p>
                        ) : null}
                        <p className="home-kpi-card-hint">{card.hint}</p>
                        {!dashboardShellBlocking && !homeProjectPreviewLoading && projectTotalCount > 0 ? (
                          <div
                            className={`home-kpi-project-bar-stack${prefersReducedMotion ? ' home-kpi-project-bar-stack--motion-reduced' : ''}`}
                            role="img"
                            aria-label={`프로젝트 비중 완료 ${doneW}%, 진행 ${activeW}%. 전체 ${projectTotalCount}건`}
                          >
                            <div className="home-kpi-project-bar-stack-track">
                              {doneW > 0 ? (
                                <div
                                  className="home-kpi-project-bar-stack-seg home-kpi-project-bar-stack-seg--done home-kpi-project-bar-stack-seg--anim"
                                  style={{ width: `${doneW}%` }}
                                  title={`완료 ${projectDoneCount}건 (${doneW}%)`}
                                />
                              ) : null}
                              {activeW > 0 ? (
                                <div
                                  className="home-kpi-project-bar-stack-seg home-kpi-project-bar-stack-seg--active home-kpi-project-bar-stack-seg--anim"
                                  style={{ width: `${activeW}%` }}
                                  title={`진행 ${projectActiveCount}건 (${activeW}%)`}
                                />
                              ) : null}
                            </div>
                            <div className="home-kpi-project-bar-stack-legend" aria-hidden>
                              <span className="home-kpi-project-bar-stack-legend-item home-kpi-project-bar-stack-legend-item--done">
                                완료 {doneW}%
                              </span>
                              <span className="home-kpi-project-bar-stack-legend-item home-kpi-project-bar-stack-legend-item--active">
                                진행 {activeW}%
                              </span>
                            </div>
                          </div>
                        ) : null}
                        {showForecast || showPeriod ? (
                          <div className="home-kpi-card-metrics">
                            {showForecast ? (
                              <div className="home-kpi-metric-line">
                                <span className="home-kpi-dot home-kpi-dot--forecast" aria-hidden />
                                <span className="home-kpi-metric-label">
                                  {card.forecastMetricLabel || '완료 비중'}
                                </span>
                                <span className="home-kpi-metric-val home-kpi-metric-val--insight-anim">
                                  {dashboardShellBlocking || homeProjectPreviewLoading ? '—' : forecastText}
                                </span>
                              </div>
                            ) : null}
                            {showPeriod ? (
                              <div className="home-kpi-metric-line">
                                <span className="home-kpi-dot home-kpi-dot--period" aria-hidden />
                                <span className="home-kpi-metric-label">{card.periodLabel}</span>
                                <span className="home-kpi-metric-trend home-kpi-metric-trend--insight-anim">
                                  —
                                </span>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    );
                  }
                  return (
                    <article
                      key={card.key}
                      className={`home-kpi-card home-kpi-card--clickable home-kpi-card--tone-${card.tone || 'blue'}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`${card.title} 자세히 보기`}
                      onClick={openHomeKpiExplainModal}
                      onKeyDown={onKpiExplainCardKeyDown}
                    >
                      <div className="home-kpi-card-head">
                        <span className="home-kpi-card-title">{card.title}</span>
                        <span className={`home-kpi-card-icon-wrap home-kpi-card-icon-wrap--${card.tone || 'blue'}`} aria-hidden>
                          <span className="material-symbols-outlined home-kpi-card-icon">
                            {card.icon}
                          </span>
                        </span>
                      </div>
                      <p className="home-kpi-card-value home-kpi-card-value--insight-anim">
                        {dashboardShellBlocking ? '—' : displayMainNode || displayMain}
                      </p>
                      {card.key === 'goal' ? (
                        <>
                          <p className="home-kpi-card-target-amount">
                            {dashboardShellBlocking ? '—' : `세일즈 현황 완료율 ${Math.round(goalCompletionAnim)}%`}
                          </p>
                          <div className="home-kpi-goal-bar" aria-hidden>
                            <div
                              className="home-kpi-goal-fill home-kpi-goal-fill--insight-anim"
                              style={{ width: `${Math.min(100, Math.max(0, goalCompletionAnim))}%` }}
                            />
                          </div>
                        </>
                      ) : null}
                      {card.key === 'rev' ? (
                        <p className="home-kpi-card-target-amount">{dashboardShellBlocking ? '—' : (targetAmountUnderValue || '목표 미설정')}</p>
                      ) : null}
                      {card.key === 'gm' ? (
                        <p className="home-kpi-card-target-amount">
                          {dashboardShellBlocking
                            ? '—'
                            : (
                              <>
                                순마진{' '}
                                <DashboardKrwCell
                                  amount={Math.round(
                                    gmNetMarginTotal > 0 || stats.kpiSummary?.grossMargin?.netMarginTotal != null
                                      ? gmNetMarginTotal
                                      : Math.max(0, Math.round(revNum) - gmNonMarginAmount)
                                  )}
                                  currency={curD}
                                  dealBasRMap={dealBasRMap}
                                />
                              </>
                            )}
                        </p>
                      ) : null}
                      {card.key === 'goal' && card.goalFootnoteModel ? (
                        <div className="home-kpi-goal-footnotes" role="note">
                          {card.goalFootnoteModel.reference ? (
                            <p className="home-kpi-card-hint home-kpi-card-hint--goal-foot">
                              참고: 전체{' '}
                              <span className="home-kpi-footnote-num">{card.goalFootnoteModel.reference.tot}</span>
                              {' · '}수주{' '}
                              <span className="home-kpi-footnote-num">{card.goalFootnoteModel.reference.won}</span>
                              {' · '}진행{' '}
                              <span className="home-kpi-footnote-num">{card.goalFootnoteModel.reference.prog}</span>
                            </p>
                          ) : null}
                          {(card.goalFootnoteModel.anomalies || []).map((a) => (
                            <p key={a.kind} className="home-kpi-card-hint home-kpi-card-hint--goal-foot">
                              특이: {a.desc}{' '}
                              <span className="home-kpi-footnote-num">{a.count}</span>건
                            </p>
                          ))}
                        </div>
                      ) : card.key !== 'goal' ? (
                        <p className="home-kpi-card-hint">{card.hint}</p>
                      ) : null}
                      {showForecast || showPeriod || showTargetLine ? (
                        <div className="home-kpi-card-metrics">
                          {showForecast ? (
                            <div className="home-kpi-metric-line">
                              <span className="home-kpi-dot home-kpi-dot--forecast" aria-hidden />
                              <span className="home-kpi-metric-label">
                                {card.forecastMetricLabel || '목표액'}
                              </span>
                              <span className="home-kpi-metric-val home-kpi-metric-val--insight-anim">
                                {dashboardShellBlocking ? '—' : forecastText}
                              </span>
                            </div>
                          ) : null}
                          {showPeriod ? (
                            <div className="home-kpi-metric-line">
                              <span className="home-kpi-dot home-kpi-dot--period" aria-hidden />
                              <span className="home-kpi-metric-label">{card.periodLabel}</span>
                              <span
                                className={`home-kpi-metric-trend home-kpi-metric-trend--insight-anim ${delta.dir === 'up' ? 'is-up' : delta.dir === 'down' ? 'is-down' : ''
                                  }`}
                              >
                                {delta.dir === 'up' ? (
                                  <span className="material-symbols-outlined" aria-hidden>
                                    trending_up
                                  </span>
                                ) : delta.dir === 'down' ? (
                                  <span className="material-symbols-outlined" aria-hidden>
                                    trending_down
                                  </span>
                                ) : null}{' '}
                                {dashboardShellBlocking ? '—' : delta.text}
                              </span>
                            </div>
                          ) : null}
                          {showTargetLine ? (
                            <div className="home-kpi-metric-line">
                              <span className="home-kpi-dot home-kpi-dot--target" aria-hidden />
                              <span className="home-kpi-metric-label">{targetMetricText || '목표 대비'}</span>
                              <span className={`home-kpi-metric-trend home-kpi-metric-trend--target ${targetTrendClass}`}>
                                {dashboardShellBlocking ? '—' : targetMetricPercent}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
              <div className="home-ref-analytics" data-purpose="analytics-and-pipeline">
              <div className="home-ref-analytics-charts">
              {(() => {
                const showTargetDonut =
                  !dashboardShellBlocking && !!homeTargetContributionBar?.segments?.length;
                const showShareDonut =
                  !dashboardShellBlocking && !!homeContributionBarKrw?.segments?.length;
                const showDonutCol = showTargetDonut || showShareDonut;
                const targetSegs = showTargetDonut ? homeTargetContributionBar.segments : [];
                const targetTotalTarget = targetSegs.reduce(
                  (sum, seg) => sum + Math.max(0, Number(seg?.targetRevenue || 0)),
                  0
                );
                const targetTotalAmount = targetSegs.reduce(
                  (sum, seg) => sum + Math.max(0, Number(seg?.amount || 0)),
                  0
                );
                const targetAchievement =
                  targetTotalTarget > 0
                    ? Number(((targetTotalAmount / targetTotalTarget) * 100).toFixed(1))
                    : null;
                const shareSegs = showShareDonut ? homeContributionBarKrw.segments : [];
                const shareTotal = shareSegs.reduce(
                  (sum, seg) => sum + Math.max(0, Number(seg?.amount || 0)),
                  0
                );
                return (
                  <div
                    className={`home-ref-donut-trend${showDonutCol ? '' : ' home-ref-donut-trend--trend-only'}`}
                    data-purpose="donut-and-trend"
                  >
                    {showDonutCol ? (
                      <div className="home-ref-donut-stack">
                        {showTargetDonut ? (
                          <section
                            className="home-contribution-panel home-contribution-panel--donut"
                            aria-labelledby="home-achievement-title"
                          >
                            <div className="home-contribution-head home-contribution-head--row">
                              <h3 id="home-achievement-title">{homeTargetContributionBar.title}</h3>
                              <div className="home-contribution-head-actions">
                                <HomeProductLegendMenu
                                  items={buildHomeDonutLegendItems(targetSegs)}
                                  title={
                                    homeTargetContributionBar.mode === 'team' ? '팀 목록' : '구성 목록'
                                  }
                                  ariaLabel={
                                    homeTargetContributionBar.mode === 'team'
                                      ? '팀 목록 보기'
                                      : '구성 목록 보기'
                                  }
                                />
                                <button
                                  type="button"
                                  className="home-contribution-calc-detail-btn"
                                  onClick={() =>
                                    setHomeContributionCalcModal({
                                      kind: 'target',
                                      mode: homeTargetContributionBar.mode === 'user' ? 'user' : 'team'
                                    })
                                  }
                                >
                                  자세히 보기
                                </button>
                              </div>
                            </div>
                            <p className="home-contribution-single-caption">
                              {`목표액 ${formatRevenueCompact(targetTotalTarget)} · 순마진 ${formatRevenueCompact(targetTotalAmount)} · 달성률 ${
                                targetAchievement == null ? '목표 미설정' : `${targetAchievement}%`
                              }`}
                            </p>
                            <HomeContributionDonutChart
                              segments={targetSegs}
                              centerPrimary={
                                targetAchievement == null ? '—' : `${targetAchievement}%`
                              }
                              centerSecondary="달성률"
                              ariaLabel={homeTargetContributionBar.title}
                            />
                          </section>
                        ) : null}
                        {showShareDonut ? (
                          <section
                            className="home-contribution-panel home-contribution-panel--donut"
                            aria-labelledby="home-contribution-title"
                          >
                            <div className="home-contribution-head home-contribution-head--row">
                              <h3 id="home-contribution-title">{homeContributionBarKrw.title}</h3>
                              <div className="home-contribution-head-actions">
                                <HomeProductLegendMenu
                                  items={buildHomeDonutLegendItems(shareSegs)}
                                  title={
                                    homeContributionBarKrw.mode === 'team' ? '팀 목록' : '구성 목록'
                                  }
                                  ariaLabel={
                                    homeContributionBarKrw.mode === 'team'
                                      ? '팀 목록 보기'
                                      : '구성 목록 보기'
                                  }
                                />
                                <button
                                  type="button"
                                  className="home-contribution-calc-detail-btn"
                                  onClick={() =>
                                    setHomeContributionCalcModal({
                                      kind: 'share',
                                      mode: homeContributionBarKrw.mode === 'user' ? 'user' : 'team'
                                    })
                                  }
                                >
                                  자세히 보기
                                </button>
                              </div>
                            </div>
                            <p className="home-contribution-single-caption">
                              {`순마진 합계 ${formatRevenueCompact(shareTotal)}`}
                            </p>
                            <HomeContributionDonutChart
                              segments={shareSegs}
                              centerPrimary={formatRevenueCompact(shareTotal)}
                              centerSecondary="순마진"
                              ariaLabel={homeContributionBarKrw.title}
                            />
                          </section>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="home-ref-donut-trend-main">{renderHomeRefTrendCard()}</div>
                  </div>
                );
              })()}
              </div>
              <div className="panel home-chart-panel sales-pipeline home-ref-pipeline-funnel" data-purpose="pipeline-funnel">
                <div className="panel-head home-chart-head">
                  <div>
                    <h2>영업 파이프라인 퍼널</h2>
                    <p className="home-chart-subtitle">단계별 진행 기회 건수 및 볼륨</p>
                  </div>
                  <div className="home-chart-actions">
                    <Link to="/sales-pipeline" className="home-pipeline-link">
                      상세보기
                      <span className="material-symbols-outlined" aria-hidden>chevron_right</span>
                    </Link>
                  </div>
                </div>
                <div className="home-chart-body home-pipeline-body">
                  <div className="pipeline-steps">
                    {pipelineLoading ? (
                      <p className="home-pipeline-loading">파이프라인 불러오는 중…</p>
                    ) : pipelineColumns.length === 0 ? (
                      <p className="home-pipeline-empty">표시할 단계가 없습니다. 세일즈 현황에서 단계를 설정해 주세요.</p>
                    ) : (
                      pipelineColumns.map((col, idx) => {
                        const count = Math.max(0, Number(col.count) || 0);
                        const isLast = idx === pipelineColumns.length - 1;
                        const toneClass =
                          count > 0 ? (isLast ? ' is-closing' : ' is-hot') : '';
                        return (
                          <div key={col.stage} className="pipeline-step-wrap">
                            <div className={`pipeline-step-card pipeline-step-${col.stage}${toneClass}`}>
                              <div className="home-ref-funnel-left">
                                <span className="home-ref-funnel-idx" aria-hidden>{idx + 1}</span>
                                <div>
                                  <span className="pipeline-step-title">{col.label}</span>
                                  <span className="pipeline-step-hint">
                                    {PIPELINE_STEP_HINTS[col.stage] || '파이프라인 단계'}
                                  </span>
                                </div>
                              </div>
                              <div className="pipeline-step-metrics">
                                <p>{count} 건</p>
                                <span>{formatCurrency(Math.round(col.total || 0), 'KRW')}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {!pipelineLoading && pipelineColumns.length > 0 ? (
                    <div className="home-ref-funnel-summary">
                      <span>현재 활성 포캐스트 합계</span>
                      <strong>
                        {`총 ${pipelineColumns.reduce((s, c) => s + Math.max(0, Number(c.count) || 0), 0)}건 (${formatCurrency(
                          Math.round(
                            pipelineColumns.reduce((s, c) => s + Math.max(0, Number(c.total) || 0), 0)
                          ),
                          'KRW'
                        )})`}
                      </strong>
                    </div>
                  ) : null}
                </div>
              </div>

              </div>

              <div className="home-ref-ops-hub" data-purpose="deals-table-and-side-widgets">
                <div className="home-ref-ops-main">
                  <section className="panel home-chart-panel home-forecast-panel home-forecast-hub" aria-label="기회·계약 허브">
                    <div className="home-forecast-hub-top">
                      <div className="home-forecast-hub-tabs" role="tablist" aria-label="딜 허브 탭">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={homeDealsHubTab === 'forecast'}
                          className={`home-forecast-hub-tab${homeDealsHubTab === 'forecast' ? ' is-active' : ''}`}
                          onClick={() => setHomeDealsHubTab('forecast')}
                        >
                          <span>진행 중 포캐스트</span>
                          <span className="home-forecast-hub-tab-count">{forecastActiveRows.length}</span>
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={homeDealsHubTab === 'completed'}
                          className={`home-forecast-hub-tab${homeDealsHubTab === 'completed' ? ' is-active' : ''}`}
                          onClick={() => setHomeDealsHubTab('completed')}
                        >
                          <span>수주 완료 계약</span>
                          <span className="home-forecast-hub-tab-count">{forecastCompletedRows.length}</span>
                        </button>
                        {data?.insightScope?.leaderSubtree && data?.leaderScopeBreakdown ? (
                          <button
                            type="button"
                            role="tab"
                            aria-selected={homeDealsHubTab === 'team'}
                            className={`home-forecast-hub-tab${homeDealsHubTab === 'team' ? ' is-active' : ''}`}
                            onClick={() => setHomeDealsHubTab('team')}
                          >
                            <span>팀 실적 요약</span>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="home-forecast-add-opp-btn"
                          onClick={() => openHomeAddOpportunity()}
                          aria-label="기회 추가"
                          title="진행 중 기회 추가"
                        >
                          <span className="material-symbols-outlined" aria-hidden>add</span>
                        </button>
                      </div>
                      {homeDealsHubTab !== 'team' ? (
                        <div className="home-forecast-hub-filters">
                          {renderHomeForecastFilterBar(homeDealsHubTab === 'completed' ? 'completed' : 'active', {
                            compact: true
                          })}
                          <button
                            type="button"
                            className="home-forecast-hub-more-link"
                            onClick={() => openHomeView(homeDealsHubTab === 'completed' ? 'completed' : 'forecast')}
                          >
                            전체보기
                            <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className="home-forecast-hub-body" role="tabpanel">
                      {homeDealsHubTab === 'team' ? (
                        (() => {
                          const rawRows = data?.leaderScopeBreakdown?.rows || [];
                          const leaderRows = rawRows.filter((row) => Number(row?.orderCount) > 0);
                          if (leaderRows.length === 0) {
                            return (
                              <p className="home-leader-breakdown-empty">
                                {rawRows.length === 0
                                  ? '표시할 행이 없습니다. 팀원 부서(조직도 노드 id) 배정을 확인해 주세요.'
                                  : '건수가 0인 항목은 표시하지 않습니다. 현재 조건에서는 표시할 행이 없습니다.'}
                              </p>
                            );
                          }
                          return (
                            <div className="home-leader-breakdown-table-wrap">
                              <table className="home-leader-breakdown-table">
                                <thead>
                                  <tr>
                                    <th scope="col">
                                      {data.leaderScopeBreakdown.mode === 'department' ? '부서' : '직원'}
                                    </th>
                                    <th scope="col">건수</th>
                                    <th scope="col">수주액</th>
                                    <th scope="col">순마진</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {leaderRows.map((row) => (
                                    <tr key={row.key}>
                                      <td>{row.label}</td>
                                      <td>{row.orderCount}</td>
                                      <td>{formatWonRevenue(row.revenueByCurrency, dealBasRMap)}</td>
                                      <td>{formatDashboardCurrencyTotals(row.netMarginByCurrency, dealBasRMap)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        })()
                      ) : homeDealsHubTab === 'completed' ? (
                        forecastCompletedRowsUnfiltered.length === 0 ? (
                          <p className="home-leader-breakdown-empty">표시할 완료 기회가 없습니다.</p>
                        ) : forecastCompletedRows.length === 0 ? (
                          <p className="home-leader-breakdown-empty">선택한 필터에 맞는 완료 기회가 없습니다.</p>
                        ) : (
                          <HomeForecastPairTable
                            variant="completed"
                            rows={forecastCompletedPreviewRows}
                            productFilter={homeForecastCompletedFilters.product}
                            dealBasRMap={dealBasRMap}
                            getRowDisplay={getForecastRowDisplayForProductFilter}
                            formatTargetMonth={formatForecastExpectedMonthCell}
                            stageLabels={stageLabels}
                            onRowClick={openHomeEditOpportunity}
                            showMoreDots={forecastCompletedRows.length > forecastCompletedPreviewRows.length}
                          />
                        )
                      ) : forecastActiveRowsUnfiltered.length === 0 ? (
                        <p className="home-leader-breakdown-empty">표시할 진행 중 기회가 없습니다.</p>
                      ) : forecastActiveRows.length === 0 ? (
                        <p className="home-leader-breakdown-empty">선택한 필터에 맞는 진행 중 기회가 없습니다.</p>
                      ) : (
                        <HomeForecastPairTable
                          variant="active"
                          rows={forecastActivePreviewRows}
                          productFilter={homeForecastActiveFilters.product}
                          dealBasRMap={dealBasRMap}
                          getRowDisplay={getForecastRowDisplayForProductFilter}
                          formatTargetMonth={formatForecastExpectedMonthCell}
                          stageLabels={stageLabels}
                          onRowClick={openHomeEditOpportunity}
                          showMoreDots={forecastActiveRows.length > forecastActivePreviewRows.length}
                        />
                      )}
                    </div>

                    {homeDealsHubTab !== 'team' ? (
                      <div className="home-forecast-hub-foot">
                        {homeDealsHubTab === 'completed' ? (
                          <>
                            <span>수주 완료 합계 ({forecastCompletedRows.length}건 선택됨)</span>
                            <div className="home-forecast-hub-foot-metrics">
                              <span>
                                수량 합계:{' '}
                                <strong>
                                  {Math.round(forecastCompletedTotals.quantity || 0).toLocaleString('ko-KR')}개
                                </strong>
                              </span>
                              <span>
                                체결 총액:{' '}
                                <strong className="is-done">
                                  {formatCurrency(
                                    Math.round(
                                      Math.max(
                                        Number(forecastCompletedTotals.contract) || 0,
                                        Number(forecastCompletedTotals.finalPrice) || 0
                                      )
                                    ),
                                    DASHBOARD_DISPLAY_CURRENCY
                                  )}
                                </strong>
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <span>진행 중 포캐스트 합계 ({forecastActiveRows.length}건 선택됨)</span>
                            <div className="home-forecast-hub-foot-metrics">
                              <span>
                                수량 합계:{' '}
                                <strong>
                                  {Math.round(forecastActiveTotals.quantity || 0).toLocaleString('ko-KR')}개
                                </strong>
                              </span>
                              <span>
                                최종 예상 총액:{' '}
                                <strong className="is-active">
                                  {formatCurrency(
                                    Math.round(forecastActiveTotals.finalPrice || 0),
                                    DASHBOARD_DISPLAY_CURRENCY
                                  )}
                                </strong>
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    ) : null}
                  </section>
                </div>

                <div className="home-ref-ops-side">
                  <HomeRefActionCalendarWidget />
                  <HomeRefRankingWidget
                    rows={wonLeaderboardRows}
                    periodLabel={
                      wonLeaderboardPeriodLabel === '월간'
                        ? '당월 누적'
                        : `상단 조회 · ${wonLeaderboardPeriodLabel}`
                    }
                    loading={dashboardShellBlocking}
                    goalRemainText={
                      homeKpiTargetSnapshot?.target != null && Number(homeKpiTargetSnapshot.target) > 0
                        ? (() => {
                            const target = Math.round(Number(homeKpiTargetSnapshot.target) || 0);
                            const won = Math.round(
                              Number(
                                krwInsightKpi?.revenue?.orderValueTotal ??
                                  krwInsightKpi?.revenue?.primaryTotal ??
                                  stats?.kpiSummary?.revenue?.orderValueTotal ??
                                  0
                              ) || 0
                            );
                            const remain = Math.max(0, target - won);
                            if (remain <= 0) return `목표 매출 ${formatCurrency(target, DASHBOARD_DISPLAY_CURRENCY)} 달성!`;
                            return `목표 매출 ${formatCurrency(target, DASHBOARD_DISPLAY_CURRENCY)}까지 ${formatCurrency(remain, DASHBOARD_DISPLAY_CURRENCY)} 남았습니다`;
                          })()
                        : ''
                    }
                  />
                </div>

              </div>

            </>
          )}
        </section>

        <div className="home-bottom home-bottom--ref-export">
          <div className="panel home-chart-panel reps-panel reps-panel--export-only">
            <div className="panel-head home-chart-head reps-panel-head">
              <div>
                <h2>데이터 내보내기</h2>
                <p className="home-chart-subtitle">파이프라인·담당자 실적을 엑셀로 저장합니다.</p>
              </div>
              <div className="home-chart-actions">
                <Link to="/sales-pipeline" className="home-pipeline-link">
                  세일즈 현황
                  <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
                </Link>
                <button
                  type="button"
                  className="home-pipeline-link home-pipeline-link--btn"
                  onClick={handleDashboardExport}
                  disabled={dashboardExporting || pipelineLoading}
                  title="단계별 파이프라인·담당자별 수익 엑셀보내기"
                >
                  {dashboardExporting ? '보내는 중…' : '엑셀보내기'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {homeKpiExplainSpec ? (
        <HomeKpiExplainModal
          spec={homeKpiExplainSpec}
          onClose={() => setHomeKpiExplainSpec(null)}
          onOpenSalesOpportunity={openSalesOpportunityFromKpiExplain}
          onOpenProject={openProjectFromKpiExplain}
        />
      ) : null}
      {homeProjectModalLoading ? (
        <div className="home-project-fetch-overlay" role="status" aria-live="polite" aria-busy="true">
          <HomePastelSpinner size="kpi" label="프로젝트 불러오는 중…" reducedMotion={prefersReducedMotion} />
        </div>
      ) : null}
      {homeProjectModalOpen && homeProjectEditing ? (
        <ProjectFormModal
          mode="edit"
          companyContext={homeProjectCompanyContext}
          teamMembers={homeProjectTeamMembers}
          currentUser={homeProjectCurrentUser}
          stageOptions={HOME_PROJECT_KPI_STAGE_OPTIONS}
          initialProject={homeProjectEditing}
          saving={homeProjectSaving}
          onSubmit={handleSaveHomeProject}
          onClose={closeHomeProjectModal}
        />
      ) : null}
      {homeContributionCalcModal ? (
        <HomeContributionCalcModal
          spec={homeContributionCalcModal}
          targetBar={homeTargetContributionBar}
          shareBar={data?.homeContributionBar}
          periodLabel={resolveHomeKpiTargetPeriod(kpiPeriod).periodLabel}
          onClose={() => setHomeContributionCalcModal(null)}
        />
      ) : null}

      <HomeFullViewModal
        open={Boolean(activeHomeView)}
        title={activeHomeView ? HOME_VIEW_TITLES[activeHomeView] : ''}
        onClose={closeHomeView}
      >
        {activeHomeView === 'leads' ? (
          <div className="home-modal-leads" aria-label="신규 리드 전체">
            {leadChannelsLoading ? (
              <p className="home-todo-leads-empty">불러오는 중…</p>
            ) : recentCaptureLeads.length === 0 ? (
              <p className="home-todo-leads-empty">수신된 리드가 없습니다.</p>
            ) : (
              <>
                <section className="home-modal-leads-section">
                  <div className="home-modal-leads-section-head">
                    <h3>지금 확인할 리드</h3>
                    <span>{visibleHomeCaptureLeads.length.toLocaleString('ko-KR')}건</span>
                  </div>
                  {visibleHomeCaptureLeads.length === 0 ? (
                    <p className="home-todo-leads-empty">진행 중인 리드가 없습니다.</p>
                  ) : (
                    <ul className="home-todo-leads-list home-modal-leads-list">
                      {visibleHomeCaptureLeads.map((lead) => renderCaptureLeadRow(lead, { completed: false }))}
                    </ul>
                  )}
                </section>
                <section className="home-modal-leads-section home-modal-leads-section--completed">
                  <div className="home-modal-leads-section-head">
                    <h3>완료 처리된 리드</h3>
                    <span>{completedHomeCaptureLeads.length.toLocaleString('ko-KR')}건</span>
                  </div>
                  {completedHomeCaptureLeads.length === 0 ? (
                    <p className="home-todo-leads-empty">완료 처리된 리드가 없습니다.</p>
                  ) : (
                    <ul className="home-todo-leads-list home-modal-leads-list">
                      {completedHomeCaptureLeads.map((lead) => renderCaptureLeadRow(lead, { completed: true }))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>
        ) : null}
        {activeHomeView === 'calendar' ? <HomeCalendarModalEmbed /> : null}
        {activeHomeView === 'forecast' ? (
          <div className="home-modal-forecast" aria-label="Forecast 전체">
            {renderHomeForecastFilterBar('active')}
            {forecastActiveRowsUnfiltered.length === 0 ? (
              <p className="home-leader-breakdown-empty">표시할 진행 중 기회가 없습니다.</p>
            ) : forecastActiveRows.length === 0 ? (
              <p className="home-leader-breakdown-empty">선택한 필터에 맞는 진행 중 기회가 없습니다.</p>
            ) : (
              <div className="home-forecast-table-wrap">
                <HomeForecastTable
                  rows={forecastActiveRows}
                  productFilter={homeForecastActiveFilters.product}
                  dealBasRMap={dealBasRMap}
                  columnWidths={homeForecastColumnWidths}
                  onPersistColumnWidths={persistHomeForecastColumnWidths}
                  getRowDisplay={getForecastRowDisplayForProductFilter}
                  formatTargetMonth={formatForecastExpectedMonthCell}
                  renderSoftwareLabel={renderSoftwareLabelCell}
                  onRowClick={openHomeEditOpportunity}
                  dataRowClassName="home-forecast-table-row-click"
                />
              </div>
            )}
          </div>
        ) : null}
        {activeHomeView === 'completed' ? (
          <div className="home-modal-forecast" aria-label="완료 기회 전체">
            {renderHomeForecastFilterBar('completed')}
            {forecastCompletedRowsUnfiltered.length === 0 ? (
              <p className="home-leader-breakdown-empty">표시할 완료 기회가 없습니다.</p>
            ) : forecastCompletedRows.length === 0 ? (
              <p className="home-leader-breakdown-empty">선택한 필터에 맞는 완료 기회가 없습니다.</p>
            ) : (
              <div className="home-forecast-table-wrap">
                <HomeForecastTable
                  rows={forecastCompletedRows}
                  productFilter={homeForecastCompletedFilters.product}
                  dealBasRMap={dealBasRMap}
                  columnWidths={homeForecastColumnWidths}
                  onPersistColumnWidths={persistHomeForecastColumnWidths}
                  getRowDisplay={getForecastRowDisplayForProductFilter}
                  formatTargetMonth={formatForecastExpectedMonthCell}
                  renderSoftwareLabel={renderSoftwareLabelCell}
                  onRowClick={openHomeEditOpportunity}
                  showProbabilityColumn
                />
              </div>
            )}
          </div>
        ) : null}
        {activeHomeView === 'channels' ? (
          <div className="home-modal-channels home-modal-channels--chart" aria-label="캡처 채널별 리드 주간 그래프">
            {!leadChannelsLoading && recentCaptureLeads.length > 0 ? (
              <div className="home-modal-channel-chart-toolbar">
                <span className="home-modal-channel-chart-toolbar-label">표시 형식</span>
                <div className="home-chart-view-toggle">
                  <button
                    type="button"
                    className={`home-chart-type-icon${leadChannelChartMode === 'line' ? ' active' : ''}`}
                    onClick={() => setLeadChannelChartMode('line')}
                    aria-pressed={leadChannelChartMode === 'line'}
                    aria-label="꺾은선 그래프"
                    title="꺾은선"
                  >
                    <span className="material-symbols-outlined" aria-hidden>
                      show_chart
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`home-chart-type-icon${leadChannelChartMode === 'bar' ? ' active' : ''}`}
                    onClick={() => setLeadChannelChartMode('bar')}
                    aria-pressed={leadChannelChartMode === 'bar'}
                    aria-label="막대 그래프"
                    title="막대"
                  >
                    <span className="material-symbols-outlined" aria-hidden>
                      bar_chart
                    </span>
                  </button>
                </div>
              </div>
            ) : null}
            {leadChannelsLoading ? (
              <p className="home-chart-empty">채널 데이터 불러오는 중…</p>
            ) : recentCaptureLeads.length === 0 ? (
              <p className="home-chart-empty">표시할 캡처 리드가 없습니다.</p>
            ) : leadChannelChartMode === 'line' ? (
              <div className="home-line-chart-wrap">
                <WeeklyLeadCountLineChart series={leadWeeklySeries} title="home-modal-lead-weekly" />
                <div className="home-line-chart-legend" aria-hidden>
                  <span>
                    <span className="home-line-legend-swatch current" /> 주간 수신 건수
                  </span>
                </div>
                <div className="home-line-chart-labels">
                  {leadWeeklySeries.map((item) => (
                    <span key={`modal-lw-lbl-${item.label}`}>{item.label}</span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="home-bar-chart-wrap">
                <div className="home-mini-chart">
                  {leadWeeklyBarSeries.map((item, idx) => (
                    <HomeChartHoverTip
                      key={`modal-lw-bar-${item.label}-${idx}`}
                      className="home-mini-chart-col home-mini-chart-col--tip"
                      chartTitle="주간 수신 리드"
                      tip={
                        <>
                          <strong>{item.label}</strong>
                          <span>{Number(item.value) || 0}건</span>
                        </>
                      }
                    >
                      <div className="home-mini-chart-track">
                        <div className="home-mini-chart-bar-hit">
                          <div
                            className={`home-mini-chart-bar ${item.value < 0 ? 'negative' : ''}`}
                            style={{
                              height: `${Math.max(12, item.height * 2)}%`,
                              backgroundColor:
                                item.value < 0 ? CHART_VIVID_NEGATIVE : chartColorAt(idx)
                            }}
                          />
                        </div>
                      </div>
                    </HomeChartHoverTip>
                  ))}
                </div>
                <div className="home-bar-chart-labels">
                  {leadWeeklyBarSeries.map((item) => (
                    <span key={`modal-lw-x-${item.label}`}>{item.label}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </HomeFullViewModal>

      {isHomeOppModalOpen ? (
        <OpportunityModal
          mode={homeOppModalMode === 'edit' ? 'edit' : 'add'}
          oppId={homeOppModalMode === 'edit' ? homeOppEditId : undefined}
          defaultStage={homeOppModalDefaultStage}
          stageOptions={homeOpportunityStageOptions}
          onClose={closeHomeOppModal}
          onSaved={handleHomeOppSaved}
          onSwitchToEditAfterCreate={openHomeEditOpportunity}
        />
      ) : null}

    </div>
  );
}
