import { listPriceFromProduct } from '@/lib/product-price-utils';
import { parseNumericFieldValueOrZero } from '@/lib/numeric-field-value';
import { PRODUCT_BUILTIN_MARGIN_EXPRESSIONS } from '@/lib/product-margin';
import { buildExchangeRateFormulaBuiltin } from '@/lib/exchange-rate-formula-builtin';
import {
  computeCustomFieldFormulas,
  evaluateFormulaExpression,
  formatFormulaExpressionForLabel,
  parseFormulaInput,
  validateFormulaExpression
} from '@/lib/custom-field-formula';
import {
  normalizeCustomFieldsForFormula,
  normalizeFormulaBuiltInNumbers
} from '@/lib/numeric-field-value';
import { FORMULA_FUNCTION_CATALOG, FORMULA_FUNCTION_GROUP_LABELS } from '@/lib/formula-expression-evaluator';
import { buildFormulaFieldPickerOptions } from '@/lib/custom-field-formula-catalog';

export const PRODUCT_FORMULA_NUMERIC_KEYS = [
  'listPrice',
  'costPrice',
  'channelPrice',
  'consumerMargin',
  'channelMargin',
  'billingInterval'
];
export const PRODUCT_FORMULA_TEXT_KEYS = ['name', 'code', 'version', 'category'];
export const PRODUCT_FORMULA_KEYS = [...PRODUCT_FORMULA_TEXT_KEYS, ...PRODUCT_FORMULA_NUMERIC_KEYS];

const FORMULA_FN_GROUP_ORDER = ['accounting', 'general', 'advanced'];

export function buildProductFormulaCatalogGroups() {
  const grouped = new Map();
  for (const fn of FORMULA_FUNCTION_CATALOG) {
    const groupId = fn.group || 'general';
    if (!grouped.has(groupId)) grouped.set(groupId, []);
    grouped.get(groupId).push(fn);
  }
  return FORMULA_FN_GROUP_ORDER.filter((id) => grouped.has(id)).map((id) => ({
    id,
    label: FORMULA_FUNCTION_GROUP_LABELS[id] || id,
    items: grouped.get(id)
  }));
}

export function buildProductFormulaPickerOptions(definitions = []) {
  return buildFormulaFieldPickerOptions('product', definitions);
}

function literalProductFieldValue(product, fieldKey) {
  if (!product) return fieldKey === 'billingInterval' ? 1 : '';
  switch (fieldKey) {
    case 'name':
      return product.name ?? '';
    case 'code':
      return product.code ?? '';
    case 'version':
      return product.version ?? '';
    case 'category':
      return product.category ?? '';
    case 'listPrice':
      return listPriceFromProduct(product);
    case 'costPrice':
      return parseNumericFieldValueOrZero(product.costPrice);
    case 'channelPrice':
      return parseNumericFieldValueOrZero(product.channelPrice);
    case 'consumerMargin':
      return Number.isFinite(Number(product.consumerMargin)) ? Number(product.consumerMargin) : null;
    case 'channelMargin':
      return Number.isFinite(Number(product.channelMargin)) ? Number(product.channelMargin) : null;
    case 'billingInterval':
      return Number(product.billingInterval) || 1;
    default:
      return '';
  }
}

/** DB fieldFormulas + 저장값 → 폼 입력 문자열 */
export function productFieldInputFromStored(fieldKey, product, { formatPriceDisplay } = {}) {
  const formulas = product?.fieldFormulas && typeof product.fieldFormulas === 'object'
    ? product.fieldFormulas
    : {};
  const expr = formulas[fieldKey];
  if (expr) return formatFormulaExpressionForLabel(expr);
  if (fieldKey === 'consumerMargin' || fieldKey === 'channelMargin') {
    const literal = literalProductFieldValue(product, fieldKey);
    if (literal != null && Number.isFinite(literal)) {
      return typeof formatPriceDisplay === 'function' ? formatPriceDisplay(literal) : String(literal);
    }
    const defaultExpr = fieldKey === 'consumerMargin'
      ? PRODUCT_BUILTIN_MARGIN_EXPRESSIONS.consumerMargin
      : PRODUCT_BUILTIN_MARGIN_EXPRESSIONS.channelMargin;
    return formatFormulaExpressionForLabel(defaultExpr);
  }
  const literal = literalProductFieldValue(product, fieldKey);
  if (PRODUCT_FORMULA_NUMERIC_KEYS.includes(fieldKey) && fieldKey !== 'billingInterval') {
    return typeof formatPriceDisplay === 'function' ? formatPriceDisplay(literal) : String(literal);
  }
  return String(literal ?? '');
}

export function isProductFieldFormulaInput(raw) {
  return parseFormulaInput(raw).isFormula;
}

export function extractFieldFormulasFromInputs(inputs = {}) {
  const out = {};
  for (const key of PRODUCT_FORMULA_KEYS) {
    const parsed = parseFormulaInput(inputs[key]);
    if (parsed.isFormula && parsed.expression) out[key] = parsed.expression;
  }
  return out;
}

export function buildLiveProductDraft({
  nameInput,
  codeInput,
  versionInput,
  categoryKey,
  categoryOther,
  listPriceInput,
  costPriceInput,
  channelPriceInput,
  consumerMarginInput,
  channelMarginInput,
  billingIntervalInput,
  currency,
  customFields,
  parsePriceInput
}) {
  const inputs = {
    name: nameInput,
    code: codeInput,
    version: versionInput,
    category: categoryKey === 'other' ? categoryOther : categoryKey,
    listPrice: listPriceInput,
    costPrice: costPriceInput,
    channelPrice: channelPriceInput,
    consumerMargin: consumerMarginInput,
    channelMargin: channelMarginInput,
    billingInterval: billingIntervalInput,
    customFields
  };
  const fieldFormulas = extractFieldFormulasFromInputs(inputs);
  const draft = {
    currency,
    customFields: customFields || {},
    fieldFormulas,
    name: String(nameInput ?? '').trim(),
    code: String(codeInput ?? '').trim(),
    version: String(versionInput ?? '').trim(),
    category: categoryKey === 'other' ? String(categoryOther || '').trim() : String(categoryKey || ''),
    listPrice: typeof parsePriceInput === 'function' ? parsePriceInput(listPriceInput) : 0,
    costPrice: typeof parsePriceInput === 'function' ? parsePriceInput(costPriceInput) : 0,
    channelPrice: typeof parsePriceInput === 'function' ? parsePriceInput(channelPriceInput) : 0,
    consumerMargin: typeof parsePriceInput === 'function' ? parsePriceInput(consumerMarginInput) : 0,
    channelMargin: typeof parsePriceInput === 'function' ? parsePriceInput(channelMarginInput) : 0,
    billingInterval: parseInt(String(billingIntervalInput ?? '').replace(/,/g, ''), 10) || 1
  };
  return draft;
}

export function validateProductFieldFormulas(fieldFormulas, definitions = []) {
  const src = fieldFormulas && typeof fieldFormulas === 'object' ? fieldFormulas : {};
  const out = {};
  for (const [key, rawExpr] of Object.entries(src)) {
    if (!PRODUCT_FORMULA_KEYS.includes(key)) {
      return { ok: false, error: `지원하지 않는 수식 필드입니다: ${key}` };
    }
    const parsed = parseFormulaInput(rawExpr);
    if (!parsed.isFormula || !parsed.expression) {
      return { ok: false, error: `${key} 수식이 올바르지 않습니다.` };
    }
    const check = validateFormulaExpression(parsed.expression, 'product', definitions);
    if (!check.ok) return { ok: false, error: check.error || `${key} 수식 오류` };
    out[key] = parsed.expression;
  }
  return { ok: true, fieldFormulas: out };
}

function computedConsumerMargin(numeric) {
  return (Number(numeric.listPrice) || 0) - (Number(numeric.costPrice) || 0);
}

function computedChannelMargin(numeric) {
  return (Number(numeric.channelPrice) || 0) - (Number(numeric.costPrice) || 0);
}

function buildEvalContext(product, exchangeCtx, definitions, resolvedNumeric, opts = {}) {
  const { computedCustomFields = {} } = opts;
  const fxBuiltIn = exchangeCtx
    ? buildExchangeRateFormulaBuiltin(
        exchangeCtx.usdSummary,
        exchangeCtx.dealBasRMap,
        product?.currency,
        { profile: exchangeCtx.pricingProfile }
      )
    : {};
  const builtIn = {
    listPrice: resolvedNumeric.listPrice,
    price: resolvedNumeric.listPrice,
    costPrice: resolvedNumeric.costPrice,
    channelPrice: resolvedNumeric.channelPrice,
    consumerMargin: resolvedNumeric.consumerMargin,
    channelMargin: resolvedNumeric.channelMargin,
    ...fxBuiltIn
  };
  return {
    entityType: 'product',
    definitions: definitions || [],
    builtIn: normalizeFormulaBuiltInNumbers(builtIn),
    customFields: normalizeCustomFieldsForFormula(product?.customFields || {}, definitions || []),
    computedFormulas: computedCustomFields,
    customFieldKeys: new Set((definitions || []).filter((d) => d?.key).map((d) => d.key))
  };
}

/**
 * fieldFormulas가 있으면 환율 등 컨텍스트로 재계산된 표시값 반환
 * @returns {object} row와 병합 가능한 resolved 필드
 */
export function resolveProductFieldValues(product, exchangeCtx = null, definitions = [], opts = {}) {
  const { computedCustomFields = {} } = opts;
  const formulas = product?.fieldFormulas && typeof product.fieldFormulas === 'object'
    ? product.fieldFormulas
    : {};
  const hasFormula = Object.keys(formulas).length > 0;
  const resolved = {
    name: String(product?.name ?? ''),
    code: String(product?.code ?? ''),
    version: String(product?.version ?? ''),
    category: String(product?.category ?? ''),
    listPrice: listPriceFromProduct(product),
    price: listPriceFromProduct(product),
    costPrice: Number(product?.costPrice) || 0,
    channelPrice: Number(product?.channelPrice) || 0,
    billingInterval: Number(product?.billingInterval) || 1,
    consumerMargin: Number.isFinite(Number(product?.consumerMargin))
      ? Number(product.consumerMargin)
      : computedConsumerMargin({
        listPrice: listPriceFromProduct(product),
        costPrice: Number(product?.costPrice) || 0
      }),
    channelMargin: Number.isFinite(Number(product?.channelMargin))
      ? Number(product.channelMargin)
      : computedChannelMargin({
        channelPrice: Number(product?.channelPrice) || 0,
        costPrice: Number(product?.costPrice) || 0
      })
  };
  if (!hasFormula) return resolved;

  const numeric = {
    listPrice: resolved.listPrice,
    costPrice: resolved.costPrice,
    channelPrice: resolved.channelPrice,
    consumerMargin: resolved.consumerMargin,
    channelMargin: resolved.channelMargin,
    billingInterval: resolved.billingInterval
  };

  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false;
    for (const key of PRODUCT_FORMULA_NUMERIC_KEYS) {
      const expr = formulas[key];
      if (!expr) continue;
      const ctx = buildEvalContext(product, exchangeCtx, definitions, numeric, { computedCustomFields });
      const val = evaluateFormulaExpression(expr, ctx);
      if (val == null || !Number.isFinite(Number(val))) continue;
      const n = Number(val);
      if (numeric[key] !== n) {
        numeric[key] = n;
        changed = true;
      }
    }
    if (!changed) break;
  }

  resolved.listPrice = numeric.listPrice;
  resolved.price = numeric.listPrice;
  resolved.costPrice = numeric.costPrice;
  resolved.channelPrice = numeric.channelPrice;
  resolved.consumerMargin = numeric.consumerMargin;
  resolved.channelMargin = numeric.channelMargin;
  resolved.billingInterval = Math.min(99, Math.max(1, Math.round(numeric.billingInterval)));

  for (const key of PRODUCT_FORMULA_TEXT_KEYS) {
    const expr = formulas[key];
    if (!expr) continue;
    const ctx = buildEvalContext(product, exchangeCtx, definitions, numeric, { computedCustomFields });
    const val = evaluateFormulaExpression(expr, ctx);
    if (val == null) continue;
    resolved[key] = String(val);
  }

  return resolved;
}

function buildProductCustomFormulaContext(product, exchangeCtx, definitions, resolvedNumeric, rawCustomFields = null) {
  const fxBuiltIn = exchangeCtx
    ? buildExchangeRateFormulaBuiltin(
        exchangeCtx.usdSummary,
        exchangeCtx.dealBasRMap,
        product?.currency,
        { profile: exchangeCtx.pricingProfile }
      )
    : {};
  const customFields = rawCustomFields ?? product?.customFields ?? {};
  return {
    entityType: 'product',
    definitions: definitions || [],
    builtIn: normalizeFormulaBuiltInNumbers({
      listPrice: resolvedNumeric.listPrice,
      price: resolvedNumeric.listPrice,
      costPrice: resolvedNumeric.costPrice,
      channelPrice: resolvedNumeric.channelPrice,
      consumerMargin: resolvedNumeric.consumerMargin,
      channelMargin: resolvedNumeric.channelMargin,
      ...fxBuiltIn
    }),
    customFields: normalizeCustomFieldsForFormula(customFields, definitions || [])
  };
}

function stableFormulasSnapshot(resolved, customComputed) {
  return JSON.stringify({
    listPrice: resolved.listPrice,
    costPrice: resolved.costPrice,
    channelPrice: resolved.channelPrice,
    consumerMargin: resolved.consumerMargin,
    channelMargin: resolved.channelMargin,
    billingInterval: resolved.billingInterval,
    custom: customComputed
  });
}

/**
 * 내장 필드(fieldFormulas)와 커스텀 수식 필드를 함께 반복 계산 — 열/필드 순서와 무관
 */
export function resolveProductFormulasUnified(product, exchangeCtx = null, definitions = []) {
  const formulaDefs = (definitions || []).filter((d) => d?.type === 'formula');
  const hasBuiltinFormulas = product?.fieldFormulas && Object.keys(product.fieldFormulas).length > 0;
  const hasCustomFormulas = formulaDefs.some((d) => d?.options?.expression);

  if (!hasBuiltinFormulas && !hasCustomFormulas) {
    const resolved = resolveProductFieldValues(product, exchangeCtx, definitions);
    return {
      ...resolved,
      customFields: product?.customFields && typeof product.customFields === 'object'
        ? { ...product.customFields }
        : {}
    };
  }

  let resolved = resolveProductFieldValues(product, exchangeCtx, definitions);
  let customComputed = computeCustomFieldFormulas(
    definitions,
    buildProductCustomFormulaContext(product, exchangeCtx, definitions, resolved)
  );

  const maxPass = formulaDefs.length + Object.keys(product?.fieldFormulas || {}).length + 8;
  for (let pass = 0; pass < maxPass; pass += 1) {
    const snap = stableFormulasSnapshot(resolved, customComputed);

    resolved = resolveProductFieldValues(
      { ...product, customFields: { ...(product?.customFields || {}), ...customComputed } },
      exchangeCtx,
      definitions,
      { computedCustomFields: customComputed }
    );

    customComputed = computeCustomFieldFormulas(definitions, {
      ...buildProductCustomFormulaContext(product, exchangeCtx, definitions, resolved),
      computedFormulas: customComputed
    });

    if (stableFormulasSnapshot(resolved, customComputed) === snap) break;
  }

  return {
    ...resolved,
    customFields: {
      ...(product?.customFields && typeof product.customFields === 'object' ? product.customFields : {}),
      ...customComputed
    }
  };
}

/** 폼 입력 → API body (fieldFormulas + 계산 스냅샷) */
export function buildProductFieldPayload({
  inputs,
  categoryKey,
  categoryOther,
  currency,
  definitions = [],
  exchangeCtx = null,
  parsePriceInput
}) {
  const fieldFormulas = {};
  const draft = {
    currency,
    customFields: inputs.customFields || {},
    fieldFormulas: {}
  };

  const readInput = (key) => {
    if (key === 'category') {
      return categoryKey === 'other' ? String(categoryOther || '') : String(categoryKey || '');
    }
    return inputs[key];
  };

  for (const key of PRODUCT_FORMULA_KEYS) {
    const raw = readInput(key);
    const parsed = parseFormulaInput(raw);
    if (parsed.isFormula && parsed.expression) {
      fieldFormulas[key] = parsed.expression;
      draft.fieldFormulas[key] = parsed.expression;
    } else if (PRODUCT_FORMULA_NUMERIC_KEYS.includes(key)) {
      if (key === 'billingInterval') {
        const n = parseInt(String(raw ?? '').replace(/,/g, ''), 10);
        draft[key] = Number.isFinite(n) ? n : 1;
      } else {
        draft[key] = typeof parsePriceInput === 'function' ? parsePriceInput(raw) : Number(raw) || 0;
      }
    } else {
      draft[key] = String(raw ?? '').trim();
    }
  }

  const check = validateProductFieldFormulas(fieldFormulas, definitions);
  if (!check.ok) return check;

  draft.fieldFormulas = check.fieldFormulas;
  const merged = resolveProductFormulasUnified(draft, exchangeCtx, definitions);

  if (!String(merged.name || '').trim()) {
    return { ok: false, error: '제품명을 입력해 주세요.' };
  }

  return {
    ok: true,
    body: {
      name: String(merged.name).trim(),
      code: String(merged.code || '').trim(),
      version: String(merged.version || '').trim(),
      category: String(merged.category || '').trim(),
      listPrice: merged.listPrice,
      price: merged.listPrice,
      costPrice: merged.costPrice,
      channelPrice: merged.channelPrice,
      consumerMargin: merged.consumerMargin,
      channelMargin: merged.channelMargin,
      billingInterval: merged.billingInterval,
      fieldFormulas: check.fieldFormulas
    }
  };
}

export function mergeResolvedProductRow(row, exchangeCtx, definitions) {
  if (!row?.fieldFormulas || !Object.keys(row.fieldFormulas).length) return row;
  const resolved = resolveProductFormulasUnified(row, exchangeCtx, definitions);
  return {
    ...row,
    name: resolved.name,
    code: resolved.code,
    version: resolved.version,
    category: resolved.category,
    listPrice: resolved.listPrice,
    price: resolved.price,
    costPrice: resolved.costPrice,
    channelPrice: resolved.channelPrice,
    consumerMargin: resolved.consumerMargin,
    channelMargin: resolved.channelMargin,
    billingInterval: resolved.billingInterval,
    customFields: {
      ...(row.customFields && typeof row.customFields === 'object' ? row.customFields : {}),
      ...(resolved.customFields || {})
    }
  };
}
