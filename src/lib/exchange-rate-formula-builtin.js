/**
 * 환율 화면(exchange-rates) USD RPA 요약 + 통화별 매매기준율 — 수식 [필드] 참조
 * 값은 저장하지 않고 조회·입력 시점의 고시 환율로 계산 (변동 반영)
 */
import { EXCHANGE_RATE_QUOTE_UNITS } from '@/lib/exchange-rate-convert';
import {
  computeExchangeRatePricingChain,
  DEFAULT_EXCHANGE_RATE_PRICING_PROFILE,
  normalizeExchangeRatePricingProfile
} from '@/lib/exchange-rate-pricing-profile';

/** product 수식 필드 picker · 라벨 매핑 (제품 필드·환율 산정 필드 명칭 구분) */
export const EXCHANGE_RATE_FORMULA_BUILTIN = [
  { key: 'fxDealBasR', label: 'USD 매매기준율', desc: 'USD 고시 매매기준율' },
  { key: 'fxRemittanceRate', label: 'USD 송금환율', desc: 'USD 보내실 때(TTS)' },
  { key: 'fxOrderRate', label: '발주환율', desc: '송금환율 × 회사 배율' },
  { key: 'fxRpiRate', label: 'RPI환율', desc: '발주환율 × 회사 배율' },
  { key: 'fxSupplyCost', label: '공급원가', desc: '기준USD × RPI환율' },
  { key: 'fxConsumerRate', label: '산정 소비자가', desc: '환율 산정 체인 소비자가' },
  { key: 'fxVatAmount', label: '산정 VAT', desc: '산정 소비자가 × VAT율' },
  { key: 'fxCurrencyDealBasR', label: '통화환율', desc: '제품 통화 매매기준율' }
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** @param {Record<string, number>} dealBasRMap */
export function resolveCurrencyDealBasR(dealBasRMap, currencyCode) {
  const code = String(currencyCode || '').trim().toUpperCase();
  if (!code || code === 'KRW') return 1;
  const rate = num(dealBasRMap?.[code]);
  return rate != null && rate > 0 ? rate : null;
}

/**
 * @param {object|null} usdSummary — /exchange-rates/latest meta.usdSummary
 * @param {Record<string, number>} dealBasRMap
 * @param {string} [currencyCode] — 제품 통화
 * @param {{ profile?: object, usdAmount?: number, marginRate?: number }} [options]
 */
export function buildExchangeRateFormulaBuiltin(
  usdSummary,
  dealBasRMap = {},
  currencyCode = 'USD',
  options = {}
) {
  const profile = normalizeExchangeRatePricingProfile(options.profile || DEFAULT_EXCHANGE_RATE_PRICING_PROFILE);
  let chain = usdSummary?.pricingChain || null;
  if (!chain && Array.isArray(options.rateRows) && options.rateRows.length) {
    chain = computeExchangeRatePricingChain(options.rateRows, profile, {
      referenceUsdAmount: options.usdAmount ?? profile.referenceUsdAmount
    });
  }
  if (!chain) {
    chain = computeExchangeRatePricingChain([], profile, {
      referenceUsdAmount: options.usdAmount ?? profile.referenceUsdAmount
    });
  }

  return {
    fxDealBasR: num(usdSummary?.dealBasR) ?? resolveCurrencyDealBasR(dealBasRMap, 'USD'),
    fxRemittanceRate: chain.remittanceRate,
    fxOrderRate: chain.orderRate,
    fxRpiRate: chain.rpiRate,
    fxSupplyCost: chain.supplyCost,
    fxConsumerRate: chain.consumerPrice,
    fxConsumerPrice: chain.consumerPrice,
    fxVatAmount: chain.vatAmount,
    fxCurrencyDealBasR: resolveCurrencyDealBasR(dealBasRMap, currencyCode)
  };
}

/** 외화 금액 × (통화환율 / quoteUnits) — 수식 보조용 */
export function convertForeignToKrwUsingDealBasR(amount, currencyCode, dealBasRMap) {
  const code = String(currencyCode || '').trim().toUpperCase();
  if (!code || code === 'KRW') return num(amount);
  const n = num(amount);
  const dealBasR = resolveCurrencyDealBasR(dealBasRMap, code);
  if (n == null || dealBasR == null) return null;
  const quoteUnits = EXCHANGE_RATE_QUOTE_UNITS[code] || 1;
  return Math.round(n * (dealBasR / quoteUnits) * 100) / 100;
}
