/**
 * exchange-rates/latest rows.dealBasR 기준 외화 → 원화 환산.
 * JPY·IDR·VND 는 고시가 100단위(백엔드 exchangeRateApiClient 와 동일).
 */
export const EXCHANGE_RATE_QUOTE_UNITS = {
  JPY: 100,
  IDR: 100,
  VND: 100
};

/** @param {Array<{ code?: string, id?: string, dealBasR?: number }>} rows */
export function buildDealBasRMapFromRows(rows) {
  const map = {};
  for (const row of rows || []) {
    const code = String(row?.code || row?.id || '').trim().toUpperCase();
    const rate = Number(row?.dealBasR);
    if (!code || !Number.isFinite(rate) || rate <= 0) continue;
    map[code] = rate;
  }
  return map;
}

/**
 * @param {number|string|null|undefined} amount 외화 금액(해당 통화 1단위 기준)
 * @param {string} currencyCode ISO 코드
 * @param {Record<string, number>} dealBasRMap code → 매매기준율(KRW)
 * @returns {number|null}
 */
export function convertAmountToKrw(amount, currencyCode, dealBasRMap) {
  const code = String(currencyCode || '').trim().toUpperCase();
  if (!code || code === 'KRW') return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const dealBasR = dealBasRMap?.[code];
  if (!Number.isFinite(dealBasR) || dealBasR <= 0) return null;
  const quoteUnits = EXCHANGE_RATE_QUOTE_UNITS[code] || 1;
  const krw = n * (dealBasR / quoteUnits);
  return Math.round(krw * 100) / 100;
}

export function formatKrwConvertedLabel(krwAmount) {
  if (krwAmount == null || !Number.isFinite(Number(krwAmount))) return null;
  return `₩${Number(krwAmount).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`;
}
