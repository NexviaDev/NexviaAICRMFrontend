import {
  DEFAULT_STEP_FORMULAS,
  PRICING_STEP_DEFS,
  STEP_RESULT_FIELD_LABELS,
  buildRateFieldValuesFromRows,
  evaluateExchangeRateStepFormula,
  mergeStepResultsIntoFieldValues
} from '@/lib/exchange-rate-formula-fields';

export const DEFAULT_EXCHANGE_RATE_PRICING_PROFILE = {
  stepFormulas: { ...DEFAULT_STEP_FORMULAS },
  referenceUsdAmount: 100
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clampUsdAmount(value, fallback) {
  const n = num(value);
  if (n == null || n < 0 || n > 1e9) return fallback;
  return n;
}

function migratePricingFormulaTokens(expr) {
  return String(expr || '').replace(/\[소비자가\]/g, '[산정 소비자가]');
}

function migrateLegacyProfile(src) {
  if (src?.stepFormulas && typeof src.stepFormulas === 'object') return null;
  const orderMult = num(src?.orderRateMult);
  const rpiMult = num(src?.rpiRateMult);
  const margin = num(src?.defaultMarginRate);
  const vat = num(src?.vatRate);
  const refUsd = clampUsdAmount(src?.referenceUsdAmount, 100);
  return {
    stepFormulas: {
      orderRate: orderMult != null ? `dec([USD-보내실 때]*${orderMult},2)` : DEFAULT_STEP_FORMULAS.orderRate,
      rpiRate: rpiMult != null ? `dec([발주환율]*${rpiMult},2)` : DEFAULT_STEP_FORMULAS.rpiRate,
      supplyCost: `round([기준USD]*[RPI환율])`,
      consumerPrice:
        margin != null ? `round([공급원가]/(1-${margin}))` : DEFAULT_STEP_FORMULAS.consumerPrice,
      vat: vat != null ? `round([산정 소비자가]*${vat})` : DEFAULT_STEP_FORMULAS.vat
    },
    referenceUsdAmount: refUsd
  };
}

function normalizeStepFormulas(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const migrated = migrateLegacyProfile(src);
  const base = migrated?.stepFormulas || src.stepFormulas || {};
  const out = {};
  for (const step of PRICING_STEP_DEFS) {
    const rawExpr = String(base[step.id] ?? DEFAULT_STEP_FORMULAS[step.id] ?? '').trim();
    const expr = migratePricingFormulaTokens(rawExpr);
    out[step.id] = expr || DEFAULT_STEP_FORMULAS[step.id];
  }
  return out;
}

export function normalizeExchangeRatePricingProfile(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const migrated = migrateLegacyProfile(src);
  return {
    stepFormulas: normalizeStepFormulas(migrated || src),
    referenceUsdAmount: clampUsdAmount(
      migrated?.referenceUsdAmount ?? src.referenceUsdAmount,
      DEFAULT_EXCHANGE_RATE_PRICING_PROFILE.referenceUsdAmount
    )
  };
}

/**
 * @param {Array} rateRows — exchange-rates/latest rows
 * @param {object} profile
 * @param {{ referenceUsdAmount?: number }} [inputs]
 */
export function computeExchangeRatePricingChain(rateRows, profile, inputs = {}) {
  const normalized = normalizeExchangeRatePricingProfile(profile);
  const refUsd = clampUsdAmount(inputs.referenceUsdAmount, normalized.referenceUsdAmount);
  const baseFields = buildRateFieldValuesFromRows(rateRows, refUsd);

  const results = {
    remittanceRate: baseFields['USD-보내실 때'] ?? null,
    orderRate: null,
    rpiRate: null,
    supplyCost: null,
    consumerPrice: null,
    vatAmount: null,
    usdAmount: refUsd,
    profile: normalized
  };

  let fieldValues = { ...baseFields };

  for (const step of PRICING_STEP_DEFS) {
    const expression = normalized.stepFormulas[step.id];
    const value = evaluateExchangeRateStepFormula(expression, fieldValues);
    results[step.resultKey] = value;
    if (value != null && STEP_RESULT_FIELD_LABELS[step.id]) {
      fieldValues[STEP_RESULT_FIELD_LABELS[step.id]] = value;
    }
    fieldValues = mergeStepResultsIntoFieldValues(fieldValues, results);
  }

  return results;
}

export function buildPricingStepRows(chain, profile) {
  const p = normalizeExchangeRatePricingProfile(profile || chain?.profile);
  const c = chain || { profile: p };

  return PRICING_STEP_DEFS.map((step) => ({
    id: step.id,
    label: step.label,
    formula: p.stepFormulas[step.id],
    result: c[step.resultKey],
    resultKind: step.resultKind
  }));
}

export function formatPricingResult(value, kind) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  if (kind === 'rate') {
    return Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  }
  return Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 0 });
}

export { PRICING_STEP_DEFS, DEFAULT_STEP_FORMULAS };
