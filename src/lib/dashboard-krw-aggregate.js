import { convertAmountToKrw } from '@/lib/exchange-rate-convert';

export const DASHBOARD_DISPLAY_CURRENCY = 'KRW';

/** 외화 → 원화(고정·실시간 dealBasRMap 반영). KRW는 그대로 반올림 */
export function toKrwAmount(amount, currency, dealBasRMap) {
  const code = String(currency || 'KRW').trim().toUpperCase();
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  if (code === 'KRW') return Math.round(n);
  const krw = convertAmountToKrw(n, code, dealBasRMap);
  return krw != null ? Math.round(krw) : 0;
}

function sumInsightSeriesValues(series, from, to) {
  if (!Array.isArray(series)) return 0;
  const end = to == null ? series.length : Math.min(to, series.length);
  let s = 0;
  for (let i = from; i < end; i += 1) {
    s += Number(series[i]?.value) || 0;
  }
  return s;
}

/** 통화별 시계열 맵 → 원화 합산 단일 시계열 */
export function mergeCurrencySeriesMapToKrw(byCurrency, dealBasRMap) {
  const map = byCurrency && typeof byCurrency === 'object' ? byCurrency : {};
  const currencies = Object.keys(map);
  if (!currencies.length) return [];
  const refSeries = map[currencies[0]] || [];
  if (!Array.isArray(refSeries) || !refSeries.length) return [];
  return refSeries.map((point, idx) => {
    let sum = 0;
    for (const cur of currencies) {
      const series = map[cur] || [];
      const val = Number(series[idx]?.value) || 0;
      sum += toKrwAmount(val, cur, dealBasRMap);
    }
    return { label: point.label, value: sum };
  });
}

/** { KRW: n, USD: n, ... } → 원화 합계 */
export function sumCurrencyBreakdownToKrw(byCurrency, dealBasRMap) {
  const map = byCurrency && typeof byCurrency === 'object' ? byCurrency : {};
  let sum = 0;
  for (const [cur, raw] of Object.entries(map)) {
    sum += toKrwAmount(raw, cur, dealBasRMap);
  }
  return sum;
}

/**
 * salesGraphs 원화 병합 기준 KPI 수치 (백엔드 primaryCurrency 무시)
 * buildHomeKpiSummaryFromGraphs 와 동일 구간 규칙
 */
export function computeKrwInsightKpiFromGraphs(salesGraphs, dealBasRMap) {
  const v = mergeCurrencySeriesMapToKrw(salesGraphs?.wonValueByCurrency, dealBasRMap);
  const vp = mergeCurrencySeriesMapToKrw(salesGraphs?.wonValuePrevYearByCurrency, dealBasRMap);
  const net = mergeCurrencySeriesMapToKrw(salesGraphs?.netMarginByCurrency, dealBasRMap);
  const netp = mergeCurrencySeriesMapToKrw(salesGraphs?.netMarginPrevYearByCurrency, dealBasRMap);

  const n = v.length;
  let last6;
  let prev6;
  let last3;
  let prev3;
  let m6;
  let m6py;
  let m3;
  let v3;
  let m3p;
  let v3p;

  if (n === 2) {
    last6 = sumInsightSeriesValues(v, 0, 2);
    prev6 = sumInsightSeriesValues(vp, 0, 2);
    last3 = sumInsightSeriesValues(v, 1, 2);
    prev3 = sumInsightSeriesValues(v, 0, 1);
    m6 = sumInsightSeriesValues(net, 0, 2);
    m6py = sumInsightSeriesValues(netp, 0, 2);
    m3 = sumInsightSeriesValues(net, 1, 2);
    v3 = sumInsightSeriesValues(v, 1, 2);
    m3p = sumInsightSeriesValues(net, 0, 1);
    v3p = sumInsightSeriesValues(v, 0, 1);
  } else {
    last6 = sumInsightSeriesValues(v, 0, 6);
    prev6 = sumInsightSeriesValues(vp, 0, 6);
    last3 = sumInsightSeriesValues(v, 3, 6);
    prev3 = sumInsightSeriesValues(v, 0, 3);
    m6 = sumInsightSeriesValues(net, 0, 6);
    m6py = sumInsightSeriesValues(netp, 0, 6);
    m3 = sumInsightSeriesValues(net, 3, 6);
    v3 = sumInsightSeriesValues(v, 3, 6);
    m3p = sumInsightSeriesValues(net, 0, 3);
    v3p = sumInsightSeriesValues(v, 0, 3);
  }

  const revenueYoyPct = prev6 > 0 ? (100 * (last6 - prev6)) / prev6 : null;
  const revenueForecastPct = v3p > 0 ? (100 * v3) / v3p : null;
  const rate6 = last6 > 0 ? (100 * m6) / last6 : 0;
  const nonMarginAmount = Math.max(0, last6 - m6);
  const rate6py = prev6 > 0 ? (100 * m6py) / prev6 : null;
  const marginYoyPP =
    last6 > 0 && prev6 > 0 ? Math.round((rate6 - rate6py) * 10) / 10 : null;
  const rate3 = v3 > 0 ? (100 * m3) / v3 : 0;
  const rate3p = v3p > 0 ? (100 * m3p) / v3p : 0;
  const marginForecastPP =
    v3 > 0 && v3p > 0 ? Math.round((rate3 - rate3p) * 10) / 10 : null;

  return {
    primaryCurrency: DASHBOARD_DISPLAY_CURRENCY,
    revenue: {
      orderValueTotal: Math.round(last6),
      primaryTotal: Math.round(last6),
      last6Total: Math.round(last6),
      forecastVsPct: revenueForecastPct,
      yoyPct: revenueYoyPct
    },
    grossMargin: {
      ratePct: Math.round(rate6 * 10) / 10,
      forecastVsPP: marginForecastPP,
      yoyPP: marginYoyPP,
      nonMarginAmount: Math.round(nonMarginAmount),
      netMarginTotal: Math.round(m6)
    }
  };
}

/** 제품별 수주 그래프 — 통화별 상위 N → 원화 병합 후 재정렬 */
export function mergeProductSalesRowsToKrw(byCurrency, dealBasRMap, topN = 8) {
  const map = byCurrency && typeof byCurrency === 'object' ? byCurrency : {};
  const byKey = new Map();

  for (const [cur, rows] of Object.entries(map)) {
    for (const row of rows || []) {
      const key = String(row?.key || row?.label || '');
      if (!key) continue;
      const converted = (row.series || []).map((p) => ({
        label: p.label,
        value: toKrwAmount(p.value, cur, dealBasRMap)
      }));
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          key: row.key,
          label: row.label || '미등록',
          series: converted
        });
      } else {
        existing.series = existing.series.map((p, i) => ({
          label: p.label,
          value: p.value + (Number(converted[i]?.value) || 0)
        }));
        if (existing.label === '미등록' && row.label) existing.label = row.label;
      }
    }
  }

  const scored = [...byKey.values()].map((row) => ({
    ...row,
    score: (row.series || []).reduce((s, p) => s + (Number(p.value) || 0), 0)
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map(({ key, label, series }) => ({ key, label, series }));
}

export function sumForecastTotalsKrw(rows, productFilter, dealBasRMap, getRowDisplay) {
  const pf = String(productFilter || '').trim();
  return (rows || []).reduce(
    (acc, row) => {
      const d = getRowDisplay(row, pf);
      const cur = row?.currency || 'KRW';
      acc.unitPrice += toKrwAmount(d.unitPrice, cur, dealBasRMap);
      acc.quantity += d.quantity;
      acc.finalPrice += toKrwAmount(d.finalPrice, cur, dealBasRMap);
      acc.forecast += toKrwAmount(d.forecastAmount, cur, dealBasRMap);
      acc.contract += toKrwAmount(d.contractAmount, cur, dealBasRMap);
      acc.invoice += toKrwAmount(d.invoiceAmount, cur, dealBasRMap);
      acc.collected += toKrwAmount(d.collectedAmount, cur, dealBasRMap);
      acc.margin += toKrwAmount(d.marginAmount, cur, dealBasRMap);
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

/** 기여도 막대 — segment.netMarginByCurrency 가 있으면 원화 합산 */
export function rebuildContributionBarKrw(bar, dealBasRMap) {
  if (!bar || !Array.isArray(bar.segments) || !bar.segments.length) return bar;
  const segments = bar.segments
    .map((seg) => {
      const byCur = seg.netMarginByCurrency;
      const amount =
        byCur && typeof byCur === 'object'
          ? sumCurrencyBreakdownToKrw(byCur, dealBasRMap)
          : toKrwAmount(seg.amount, bar.currency || 'KRW', dealBasRMap);
      return { ...seg, amount: Math.round(amount) };
    })
    .filter((seg) => seg.amount > 0);
  const total = segments.reduce((s, seg) => s + seg.amount, 0);
  if (total <= 0) return null;
  return {
    ...bar,
    currency: DASHBOARD_DISPLAY_CURRENCY,
    segments: segments
      .map((seg) => ({
        ...seg,
        pct: total > 0 ? Number(((seg.amount / total) * 100).toFixed(1)) : 0
      }))
      .sort((a, b) => b.amount - a.amount)
  };
}

/** 우수 담당자 — revenueByCurrency → 원화 단일 표기 */
export function formatLeaderboardRevenueKrw(row, dealBasRMap, formatCurrencyFn) {
  if (row?.revenueByCurrency && typeof row.revenueByCurrency === 'object') {
    const krw = sumCurrencyBreakdownToKrw(row.revenueByCurrency, dealBasRMap);
    return krw > 0 ? formatCurrencyFn(krw, DASHBOARD_DISPLAY_CURRENCY) : '—';
  }
  if (row?.KRW != null || row?.USD != null || row?.JPY != null) {
    const byCur = {};
    if (row.KRW) byCur.KRW = row.KRW;
    if (row.USD) byCur.USD = row.USD;
    if (row.JPY) byCur.JPY = row.JPY;
    const krw = sumCurrencyBreakdownToKrw(byCur, dealBasRMap);
    return krw > 0 ? formatCurrencyFn(krw, DASHBOARD_DISPLAY_CURRENCY) : '—';
  }
  return row?.revenueDisplay || '—';
}
