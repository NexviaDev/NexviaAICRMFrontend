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
import {
  customStepBuiltinKey,
  normalizeCustomPricingSteps
} from '@/lib/exchange-rate-formula-fields';

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

/** 내장 + 회사 추가 산정 항목 (`profile.customSteps`) */
export function listExchangeRateFormulaBuiltins(profile) {
  const custom = normalizeCustomPricingSteps(profile?.customSteps);
  return [
    ...EXCHANGE_RATE_FORMULA_BUILTIN,
    ...custom.map((s) => ({
      key: customStepBuiltinKey(s.id),
      label: s.label,
      desc: '회사 USD 산정 · 추가 항목'
    }))
  ];
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 고시 표 rows 없이 dealBasRMap·usdSummary 만으로 산정 체인 재계산용 최소 행
 * (엑셀 미리보기 등 rows 미보관 경로에서 [기준환율] 등 customSteps 복원)
 */
export function buildSyntheticRateRowsForPricing(dealBasRMap = {}, usdSummary = null) {
  const map = dealBasRMap && typeof dealBasRMap === 'object' ? dealBasRMap : {};
  const codes = new Set(
    Object.keys(map)
      .map((k) => String(k).trim().toUpperCase())
      .filter(Boolean)
  );
  if (num(usdSummary?.dealBasR) != null) codes.add('USD');
  const rows = [];
  for (const code of codes) {
    const dealBasR =
      code === 'USD' ? num(usdSummary?.dealBasR) ?? num(map.USD) ?? num(map.usd) : num(map[code]);
    if (dealBasR == null || dealBasR <= 0) continue;
    rows.push({
      id: code,
      code,
      dealBasR,
      tts: code === 'USD' ? num(usdSummary?.remittanceRate) ?? dealBasR : null,
      ttb: null,
      bkpr: null,
      yyEfeeR: null,
      tenDdEfeeR: null,
      kftcDealBasR: null,
      kftcBkpr: null
    });
  }
  return rows;
}

function chainHasCustomStepValues(chain, customSteps) {
  if (!customSteps?.length) return true;
  if (!chain || typeof chain !== 'object') return false;
  return customSteps.every((s) => num(chain[s.id]) != null);
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
 * @param {{ profile?: object, usdAmount?: number, marginRate?: number, rateRows?: Array }} [options]
 */
export function buildExchangeRateFormulaBuiltin(
  usdSummary,
  dealBasRMap = {},
  currencyCode = 'USD',
  options = {}
) {
  const profile = normalizeExchangeRatePricingProfile(
    options.profile || DEFAULT_EXCHANGE_RATE_PRICING_PROFILE
  );
  const customSteps = profile.customSteps || [];
  const refUsd = options.usdAmount ?? profile.referenceUsdAmount;

  let rateRows =
    Array.isArray(options.rateRows) && options.rateRows.length ? options.rateRows : null;
  let chain = null;

  if (rateRows) {
    chain = computeExchangeRatePricingChain(rateRows, profile, { referenceUsdAmount: refUsd });
  } else if (
    usdSummary?.pricingChain &&
    chainHasCustomStepValues(usdSummary.pricingChain, customSteps)
  ) {
    chain = usdSummary.pricingChain;
  } else {
    const synth = buildSyntheticRateRowsForPricing(dealBasRMap, usdSummary);
    if (synth.length) {
      chain = computeExchangeRatePricingChain(synth, profile, { referenceUsdAmount: refUsd });
    } else if (usdSummary?.pricingChain) {
      chain = usdSummary.pricingChain;
    } else {
      chain = computeExchangeRatePricingChain([], profile, { referenceUsdAmount: refUsd });
    }
  }

  const out = {
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

  for (const step of customSteps) {
    const v = num(chain[step.id]);
    const key = customStepBuiltinKey(step.id);
    out[key] = v;
    /** 라벨 직접 참조 ([기준환율]) — picker·별도 map 없이도 해석 */
    if (step.label) out[step.label] = v;
  }

  return out;
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
