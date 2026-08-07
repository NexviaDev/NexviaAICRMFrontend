/**
 * 커스텀 필드 수식 — [표시이름] 또는 [fieldKey] 참조, + - * / 연산, 엑셀형 함수
 */
import {
  buildFormulaRefMaps,
  resolveFormulaRefToken
} from './custom-field-formula-catalog';
import {
  evaluateFormulaExpressionString,
  validateFormulaExpressionString,
  FORMULA_FUNCTION_CATALOG,
  FORMULA_FUNCTION_GROUP_LABELS
} from './formula-expression-evaluator';
import {
  looksLikeNumericTextForFormula,
  normalizeCustomFieldsForFormula,
  normalizeFormulaBuiltInNumbers,
  parseNumericFieldValue,
  parseNumericFieldValueForFormula
} from './numeric-field-value';
import {
  customFieldNumericForFormula,
  findCustomFieldDefinitionByKey
} from './custom-field-display-format';

export { FORMULA_FUNCTION_CATALOG, FORMULA_FUNCTION_GROUP_LABELS };

const REF_PATTERN = /\[([^\]]+)\]/g;

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 추가 필드 값 → 수식용 숫자 (₩$원% 등 제거) */
export function coerceFieldValueToNumber(value, fieldType) {
  return parseNumericFieldValue(value, { fieldType, rejectFormula: true });
}

function buildFieldTypesMap(definitions = []) {
  const map = {};
  for (const d of definitions || []) {
    if (d?.key) map[d.key] = d.type;
  }
  return map;
}

/** @param {string} expression */
export function extractFormulaRefs(expression) {
  const refs = [];
  const s = String(expression || '');
  let m;
  REF_PATTERN.lastIndex = 0;
  while ((m = REF_PATTERN.exec(s)) !== null) {
    if (m[1] && !refs.includes(m[1])) refs.push(m[1]);
  }
  return refs;
}

/**
 * @param {string} expression
 * @param {string} entityType
 * @param {Array} definitions
 * @param {{ pricingProfile?: object }} [options]
 */
export function validateFormulaExpression(expression, entityType, definitions = [], options = {}) {
  const expr = String(expression || '').trim();
  if (!expr) return { ok: false, error: '수식을 입력해 주세요.' };
  const refs = extractFormulaRefs(expr);
  for (const r of refs) {
    if (!resolveFormulaRefToken(r, entityType, definitions, options)) {
      return { ok: false, error: `수식에 없는 필드 [${r}] 가 있습니다.` };
    }
  }
  const substituted = expr.replace(REF_PATTERN, '1');
  const check = validateFormulaExpressionString(substituted, null);
  if (!check.ok) {
    return { ok: false, error: check.error || '수식을 계산할 수 없습니다.' };
  }
  return { ok: true, refs };
}

function buildCustomFieldKeySet(definitions = []) {
  return new Set((definitions || []).filter((d) => d?.key).map((d) => d.key));
}

function resolveRefValue(refKey, context) {
  const builtIn = context?.builtIn || {};
  const custom = context?.customFields || {};
  const computed = context?.computedFormulas || {};
  const fieldTypes = context?.fieldTypes || {};
  const definitions = context?.definitions || [];
  const customKeys = context?.customFieldKeys || buildCustomFieldKeySet(definitions);
  const zeroWhenMissingCustomKeys = context?.zeroWhenMissingCustomKeys;
  const defForRef = findCustomFieldDefinitionByKey(definitions, refKey);

  if (computed[refKey] !== undefined) {
    const n = customFieldNumericForFormula(computed[refKey], defForRef);
    if (n != null) return n;
  }
  if (Object.prototype.hasOwnProperty.call(custom, refKey)) {
    const ft = fieldTypes[refKey];
    const raw = custom[refKey];
    let n = null;
    if (ft === 'number' || ft === 'checkbox') {
      n = customFieldNumericForFormula(raw, defForRef || { type: ft });
    } else if (!ft || looksLikeNumericTextForFormula(raw)) {
      /** 숫자처럼 보이는 글자 필드(10, 10%)도 참조 가능 — 정의 타입으로 막지 않는다 */
      n = customFieldNumericForFormula(raw, defForRef ? { ...defForRef, type: 'number' } : {});
    }
    if (n != null) return n;
  }
  // 정의된 추가 필드가 비어 있으면 제품 엑셀 수식에서는 0으로 이어서 계산한다.
  // 환율 내장값 누락까지 0으로 숨기지 않도록 custom key에만 제한한다.
  if (customKeys.has(refKey)) {
    const canUseZero =
      context?.missingCustomRefAsZero &&
      (!(zeroWhenMissingCustomKeys instanceof Set) || zeroWhenMissingCustomKeys.has(refKey));
    return canUseZero ? 0 : null;
  }

  if (builtIn[refKey] !== undefined && builtIn[refKey] !== '') {
    return parseNumericFieldValueForFormula(builtIn[refKey], { rejectFormula: true });
  }
  return null;
}

/** @param {string} expression @param {object} context */
export function evaluateFormulaExpression(expression, context) {
  const expr = String(expression || '').trim();
  if (!expr) return null;
  const entityType = context?.entityType || '';
  const definitions = context?.definitions || [];
  const refMaps = entityType
    ? buildFormulaRefMaps(entityType, definitions, {
        pricingProfile: context?.pricingProfile
      })
    : null;
  const missingRefAsZero = Boolean(context?.missingRefAsZero);
  let replaced = expr;
  const refs = extractFormulaRefs(expr);
  for (const ref of refs) {
    const refKey = refMaps?.labelToKey?.get(ref) ?? ref;
    let v = resolveRefValue(refKey, context);
    /** 리맵 키가 peer에 없고 원라벨(peers['DSRP'] 등)만 있을 때 보조 */
    if (v == null && refKey !== ref) {
      v = resolveRefValue(ref, context);
    }
    if (v == null && missingRefAsZero) v = 0;
    if (v == null) return null;
    replaced = replaced.replace(new RegExp(`\\[${escapeRegExp(ref)}\\]`, 'g'), `(${v})`);
  }
  REF_PATTERN.lastIndex = 0;
  if (REF_PATTERN.test(replaced)) return null;
  REF_PATTERN.lastIndex = 0;
  return evaluateFormulaExpressionString(replaced, context?.evalOptions || null);
}

/**
 * 정의 formula + 제품별 customFieldFormulas → 평가용 def 목록
 * (제품 수식이 있으면 정의 수식을 덮어씀. number 필드에도 제품 수식 가능)
 */
function buildEffectiveCustomFormulaDefs(definitions = [], customFieldFormulas = {}) {
  const productExprs =
    customFieldFormulas && typeof customFieldFormulas === 'object' ? customFieldFormulas : {};
  const byKey = new Map();

  for (const d of definitions || []) {
    if (!d?.key) continue;
    if (d.type === 'formula' && d?.options?.expression) {
      byKey.set(d.key, {
        key: d.key,
        type: 'formula',
        label: d.label || d.key,
        options: { expression: String(d.options.expression).trim() }
      });
    }
  }

  for (const [key, rawExpr] of Object.entries(productExprs)) {
    const expr = String(rawExpr || '').trim().replace(/^\s*=/, '').trim();
    if (!expr) continue;
    const def = (definitions || []).find((d) => d?.key === key);
    if (!def) continue;
    if (!['number', 'text', 'formula', 'checkbox'].includes(def.type)) continue;
    byKey.set(key, {
      key,
      type: 'formula',
      label: def.label || key,
      options: { expression: expr }
    });
  }

  return [...byKey.values()].filter((d) => d?.options?.expression);
}

/**
 * 정의 목록 + 컨텍스트 → formula 타입 필드 계산값
 * context.customFieldFormulas — 제품별 추가필드 수식
 * @returns {Record<string, number>}
 */
export function computeCustomFieldFormulas(definitions = [], context = {}) {
  const formulaDefs = buildEffectiveCustomFormulaDefs(
    definitions,
    context.customFieldFormulas
  );
  if (!formulaDefs.length) return {};

  const manualCustom = normalizeCustomFieldsForFormula(context.customFields || {}, definitions);
  for (const d of formulaDefs) {
    delete manualCustom[d.key];
  }

  const fieldTypes = buildFieldTypesMap(definitions);
  const effectiveFormulaKeys = new Set(formulaDefs.map((d) => d.key));
  const zeroWhenMissingCustomKeys = new Set(
    (definitions || [])
      .filter((d) => d?.key && !effectiveFormulaKeys.has(d.key))
      .map((d) => d.key)
  );
  const computed = {};
  const maxPass = formulaDefs.length + 2;
  const builtIn = normalizeFormulaBuiltInNumbers(context.builtIn || {});
  for (let pass = 0; pass < maxPass; pass += 1) {
    let changed = false;
    for (const def of formulaDefs) {
      const val = evaluateFormulaExpression(def.options.expression, {
        builtIn,
        customFields: manualCustom,
        computedFormulas: computed,
        fieldTypes,
        entityType: context.entityType,
        definitions,
        pricingProfile: context.pricingProfile || null,
        customFieldKeys: buildCustomFieldKeySet(definitions),
        zeroWhenMissingCustomKeys,
        missingCustomRefAsZero: Boolean(context.missingCustomRefAsZero),
        missingRefAsZero: Boolean(context.missingRefAsZero)
      });
      if (val == null) continue;
      if (computed[def.key] !== val) {
        computed[def.key] = val;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return computed;
}

export function formatFormulaDisplayValue(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  if (Number.isInteger(n)) return n.toLocaleString('ko-KR');
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 4 });
}

/** 필드 제목 옆 수식 표시 — Excel 입력과 동일하게 = 접두 */
export function formatFormulaExpressionForLabel(expression) {
  const raw = String(expression || '').trim();
  if (!raw) return '';
  return raw.startsWith('=') ? raw : `=${raw}`;
}

const FORMULA_DEFAULT_TARGET_PREFIXES = [
  { prefix: 'product.customFields.', match: (d, key) => d?.key === key },
  { prefix: 'opp.financeCustomFields.', match: (d, key) => d?.key === key },
  { prefix: 'opp.scheduleCustomDates.', match: (d, key) => d?.key === key }
];

/** 추가 필드 정의(type=formula)에 저장된 수식 — 엑셀 미리보기 기본값 */
export function getDefinitionFormulaDefaultDisplay(targetKey, definitions = []) {
  const tk = String(targetKey || '').trim();
  if (!tk || !Array.isArray(definitions) || !definitions.length) return '';
  for (const { prefix, match } of FORMULA_DEFAULT_TARGET_PREFIXES) {
    if (!tk.startsWith(prefix)) continue;
    const fieldKey = tk.slice(prefix.length);
    if (!fieldKey) continue;
    const def = definitions.find((d) => match(d, fieldKey));
    const expr = def?.type === 'formula' ? def?.options?.expression : '';
    if (!expr || !String(expr).trim()) continue;
    return formatFormulaExpressionForLabel(expr);
  }
  return '';
}

export function parseFormulaInput(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { isFormula: false, expression: '' };
  if (trimmed.startsWith('=')) {
    const expression = trimmed.slice(1).trim();
    return { isFormula: !!expression, expression };
  }
  if (/\[[^\]]+\]/.test(trimmed)) {
    return { isFormula: true, expression: trimmed };
  }
  return { isFormula: false, expression: '' };
}

export function insertFormulaRef(expression, refLabel) {
  const label = String(refLabel || '').trim();
  if (!label) return String(expression || '');
  const base = String(expression || '');
  const token = `[${label}]`;
  return base ? `${base}${token}` : token;
}

/** 빈 입력·선행 = 보정 후, 삽입 위치는 항상 선행 = 뒤(인덱스 1 이상) */
function prepareFormulaEditContext(raw, start, end) {
  const input = String(raw ?? '');
  const inputLen = input.length;
  let ss = typeof start === 'number' ? start : inputLen;
  let ee = typeof end === 'number' ? end : ss;
  ss = Math.min(Math.max(0, ss), inputLen);
  ee = Math.min(Math.max(ss, ee), inputLen);

  if (!input.trim()) {
    return { value: '=', start: 1, end: 1 };
  }

  if (!input.trimStart().startsWith('=')) {
    const value = `=${input.replace(/^=+/, '')}`;
    const offset = 1;
    return {
      value,
      start: Math.min(value.length, ss + offset),
      end: Math.min(value.length, ee + offset)
    };
  }

  const value = input;
  const minPos = 1;
  return {
    value,
    start: Math.max(minPos, Math.min(ss, value.length)),
    end: Math.max(minPos, Math.min(ee, value.length))
  };
}

export function insertFormulaInputFieldAtCursor(formulaInput, refLabel, start, end) {
  const label = String(refLabel || '').trim();
  const { value: s, start: ss, end: ee } = prepareFormulaEditContext(formulaInput, start, end);
  if (!label) return { value: s, caret: ss };
  const token = `[${label}]`;
  return { value: `${s.slice(0, ss)}${token}${s.slice(ee)}`, caret: ss + token.length };
}

export function insertFormulaFunctionAtCursor(formulaInput, fnName, start, end) {
  const name = String(fnName || '').trim().toLowerCase();
  const { value: s, start: ss, end: ee } = prepareFormulaEditContext(formulaInput, start, end);
  if (!name) return { value: s, caret: ss };
  const insertText = name === 'pi' ? 'pi' : `${name}(`;
  return { value: `${s.slice(0, ss)}${insertText}${s.slice(ee)}`, caret: ss + insertText.length };
}

export function appendFormulaOperatorAtCursor(formulaInput, op, start, end) {
  const { value: s, start: ss, end: ee } = prepareFormulaEditContext(formulaInput, start, end);
  const insertText = String(op || '');
  if (!insertText) return { value: s, caret: ss };
  return { value: `${s.slice(0, ss)}${insertText}${s.slice(ee)}`, caret: ss + insertText.length };
}

/** =[소비자가]-[원가] 입력에 필드 클릭 삽입 */
export function insertFormulaInputField(formulaInput, refLabel) {
  const label = String(refLabel || '').trim();
  if (!label) return String(formulaInput || '');
  let s = String(formulaInput || '');
  if (!s.trim()) s = '=';
  if (!s.trimStart().startsWith('=')) s = `=${s.replace(/^=+/, '')}`;
  const expr = s.slice(1);
  return `=${insertFormulaRef(expr, label)}`;
}

/** 수식 입력에 함수 이름 삽입 — 예: round( */
export function insertFormulaFunction(formulaInput, fnName) {
  const name = String(fnName || '').trim().toLowerCase();
  if (!name) return String(formulaInput || '');
  let s = String(formulaInput || '');
  if (!s.trim()) s = '=';
  if (!s.trimStart().startsWith('=')) s = `=${s.replace(/^=+/, '')}`;
  const expr = s.slice(1);
  if (name === 'pi') return expr ? `=${expr}${name}` : `=${name}`;
  return `=${expr}${name}(`;
}

export function appendFormulaOperator(formulaInput, op) {
  let s = String(formulaInput || '');
  if (!s.trim()) s = '=';
  if (!s.trimStart().startsWith('=')) s = `=${s.replace(/^=+/, '')}`;
  const expr = appendFormulaOperatorExpr(s.slice(1), op);
  return `=${expr}`;
}

function appendFormulaOperatorExpr(expression, op) {
  const base = String(expression || '');
  if (!base) return '';
  return `${base}${op}`;
}

export function splitCustomFieldFormulasFromValues(definitions = [], manualValues = {}) {
  const customFieldFormulas = {};
  const manual = {};
  for (const [key, val] of Object.entries(manualValues || {})) {
    const def = (definitions || []).find((d) => d?.key === key);
    if (!def) continue;
    if (['number', 'text', 'checkbox', 'formula'].includes(def.type)) {
      const parsed = parseFormulaInput(val);
      if (parsed.isFormula && parsed.expression) {
        customFieldFormulas[key] = parsed.expression;
        continue;
      }
    }
    if (def.type === 'formula') continue;
    manual[key] = val;
  }
  return { manual, customFieldFormulas };
}

/** DB 저장값 → 폼 표시 (제품 수식 있으면는 =수식) */
export function buildCustomFieldFormValuesFromStored(product, definitions = []) {
  const values =
    product?.customFields && typeof product.customFields === 'object'
      ? { ...product.customFields }
      : {};
  const formulas =
    product?.customFieldFormulas && typeof product.customFieldFormulas === 'object'
      ? product.customFieldFormulas
      : {};
  for (const [key, expr] of Object.entries(formulas)) {
    const def = (definitions || []).find((d) => d?.key === key);
    if (!def) continue;
    if (expr) values[key] = formatFormulaExpressionForLabel(expr);
  }
  for (const d of definitions || []) {
    if (d?.type === 'formula' && d.key && !formulas[d.key]) delete values[d.key];
  }
  return values;
}

/** 저장 API body용 — 수동 입력 + formula 계산값 병합 */
export function mergeCustomFieldsForSave(definitions = [], manualValues = {}, formulaContext = null) {
  const { manual, customFieldFormulas } = splitCustomFieldFormulasFromValues(
    definitions,
    manualValues
  );
  for (const d of definitions || []) {
    if (d?.type === 'formula' && d.key) delete manual[d.key];
  }
  if (!formulaContext) return Object.keys(manual).length ? manual : undefined;
  const computed = computeCustomFieldFormulas(definitions, {
    builtIn: formulaContext.builtIn || {},
    customFields: manual,
    entityType: formulaContext.entityType,
    definitions,
    customFieldFormulas: {
      ...(formulaContext.customFieldFormulas || {}),
      ...customFieldFormulas
    },
    pricingProfile: formulaContext.pricingProfile || null,
    missingRefAsZero: Boolean(formulaContext.missingRefAsZero)
  });
  const merged = { ...manual, ...computed };
  return Object.keys(merged).length ? merged : undefined;
}

/** 제품 저장 — customFields 스냅샷 + customFieldFormulas */
export function prepareProductCustomFieldsForSave(
  definitions = [],
  manualValues = {},
  formulaContext = null
) {
  const { manual, customFieldFormulas } = splitCustomFieldFormulasFromValues(
    definitions,
    manualValues
  );
  const ctx = {
    ...(formulaContext || {}),
    customFieldFormulas: {
      ...(formulaContext?.customFieldFormulas || {}),
      ...customFieldFormulas
    }
  };
  const customFields = mergeCustomFieldsForSave(definitions, manual, ctx);
  return {
    customFields,
    customFieldFormulas: Object.keys(customFieldFormulas).length ? customFieldFormulas : {}
  };
}
