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
  parseNumericFieldValue
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
 */
export function validateFormulaExpression(expression, entityType, definitions = []) {
  const expr = String(expression || '').trim();
  if (!expr) return { ok: false, error: '수식을 입력해 주세요.' };
  const refs = extractFormulaRefs(expr);
  for (const r of refs) {
    if (!resolveFormulaRefToken(r, entityType, definitions)) {
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
      n = customFieldNumericForFormula(raw, defForRef || {});
    }
    if (n != null) return n;
  }
  // 추가 필드 키인데 값 없음 — 환율 내장(fxConsumerRate 등)으로 대체하지 않음
  if (customKeys.has(refKey)) return null;

  if (builtIn[refKey] !== undefined && builtIn[refKey] !== '') {
    return parseNumericFieldValue(builtIn[refKey], { rejectFormula: true });
  }
  return null;
}

/** @param {string} expression @param {object} context */
export function evaluateFormulaExpression(expression, context) {
  const expr = String(expression || '').trim();
  if (!expr) return null;
  const entityType = context?.entityType || '';
  const definitions = context?.definitions || [];
  const refMaps = entityType ? buildFormulaRefMaps(entityType, definitions) : null;
  let replaced = expr;
  const refs = extractFormulaRefs(expr);
  for (const ref of refs) {
    const refKey = refMaps?.labelToKey?.get(ref) ?? ref;
    const v = resolveRefValue(refKey, context);
    if (v == null) return null;
    replaced = replaced.replace(new RegExp(`\\[${escapeRegExp(ref)}\\]`, 'g'), `(${v})`);
  }
  REF_PATTERN.lastIndex = 0;
  if (REF_PATTERN.test(replaced)) return null;
  REF_PATTERN.lastIndex = 0;
  return evaluateFormulaExpressionString(replaced, context?.evalOptions || null);
}

/**
 * 정의 목록 + 컨텍스트 → formula 타입 필드 계산값
 * @returns {Record<string, number>}
 */
export function computeCustomFieldFormulas(definitions = [], context = {}) {
  const formulaDefs = (definitions || []).filter((d) => d?.type === 'formula' && d?.options?.expression);
  if (!formulaDefs.length) return {};

  const manualCustom = normalizeCustomFieldsForFormula(context.customFields || {}, definitions);
  for (const d of formulaDefs) {
    delete manualCustom[d.key];
  }

  const fieldTypes = buildFieldTypesMap(definitions);
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
        customFieldKeys: buildCustomFieldKeySet(definitions)
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

/** 저장 API body용 — 수동 입력 + formula 계산값 병합 */
export function mergeCustomFieldsForSave(definitions = [], manualValues = {}, formulaContext = null) {
  const manual = { ...(manualValues || {}) };
  for (const d of definitions || []) {
    if (d?.type === 'formula' && d.key) delete manual[d.key];
  }
  if (!formulaContext) return Object.keys(manual).length ? manual : undefined;
  const computed = computeCustomFieldFormulas(definitions, {
    builtIn: formulaContext.builtIn || {},
    customFields: manual,
    entityType: formulaContext.entityType,
    definitions
  });
  const merged = { ...manual, ...computed };
  return Object.keys(merged).length ? merged : undefined;
}
