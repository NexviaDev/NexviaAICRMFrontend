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
 * 차트 시계열에서 KPI 카드용 ‘현재 기간’ 버킷 인덱스.
 * - month/week/year: 시리즈가 당기까지라 마지막 버킷
 * - quarter: 올해 4분기 막대 중 당분기
 * - half: 1~6 / 7~12 중 당반기
 */
export function resolveInsightKpiCurrentBucketIndex(period, seriesLength, now = new Date()) {
  const n = Math.max(0, Number(seriesLength) || 0);
  if (n <= 0) return -1;
  const p = String(period || '').toLowerCase();
  if (p === 'quarter') {
    const q = Math.min(3, Math.max(0, Math.floor(now.getMonth() / 3)));
    return Math.min(n - 1, q);
  }
  if (p === 'half') {
    const h = now.getMonth() <= 5 ? 0 : 1;
    return Math.min(n - 1, h);
  }
  return n - 1;
}

/**
 * salesGraphs 원화 병합 기준 KPI 수치 (백엔드 primaryCurrency 무시, 다통화→KRW)
 * kpiPeriodHint / chartMeta.kpiPeriod 에 맞는 **현재 기간 버킷만** 합산.
 * (구버전: month 시계열에 대해 앞 6버킷을 합산해 1~6월=반기 금액이 월간 매출액으로 보이던 버그 방지)
 * 후반/전반 forecast 는 단일 버킷으로는 불가 → null 반환, UI는 백엔드 kpiSummary 로 보완.
 */
export function computeKrwInsightKpiFromGraphs(salesGraphs, dealBasRMap, kpiPeriodHint) {
  const v = mergeCurrencySeriesMapToKrw(salesGraphs?.wonValueByCurrency, dealBasRMap);
  const vp = mergeCurrencySeriesMapToKrw(salesGraphs?.wonValuePrevYearByCurrency, dealBasRMap);
  const net = mergeCurrencySeriesMapToKrw(salesGraphs?.netMarginByCurrency, dealBasRMap);
  const netp = mergeCurrencySeriesMapToKrw(salesGraphs?.netMarginPrevYearByCurrency, dealBasRMap);

  const n = v.length;
  const period = String(
    kpiPeriodHint ||
      salesGraphs?.chartMeta?.kpiPeriod ||
      salesGraphs?.chartMeta?.granularity ||
      ''
  ).toLowerCase();

  const currentIdx = resolveInsightKpiCurrentBucketIndex(period, n);
  const idx = currentIdx >= 0 ? currentIdx : Math.max(0, n - 1);
  const curr = Number(v[idx]?.value) || 0;
  const prevYoy = Number(vp[idx]?.value) || 0;
  const currNet = Number(net[idx]?.value) || 0;
  const prevNet = Number(netp[idx]?.value) || 0;

  const revenueYoyPct = prevYoy > 0 ? (100 * (curr - prevYoy)) / prevYoy : null;
  const rateCurr = curr > 0 ? (100 * currNet) / curr : 0;
  const nonMarginAmount = Math.max(0, curr - currNet);
  const rateYoy = prevYoy > 0 ? (100 * prevNet) / prevYoy : null;
  const marginYoyPP =
    curr > 0 && prevYoy > 0 ? Math.round((rateCurr - rateYoy) * 10) / 10 : null;

  return {
    primaryCurrency: DASHBOARD_DISPLAY_CURRENCY,
    revenue: {
      orderValueTotal: Math.round(curr),
      primaryTotal: Math.round(curr),
      last6Total: Math.round(curr),
      forecastVsPct: null,
      yoyPct: revenueYoyPct
    },
    grossMargin: {
      ratePct: Math.round(rateCurr * 10) / 10,
      forecastVsPP: null,
      yoyPP: marginYoyPP,
      nonMarginAmount: Math.round(nonMarginAmount),
      netMarginTotal: Math.round(currNet)
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
