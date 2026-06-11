/**
 * 환율 산정 수식 — [USD-보내실 때] · [발주환율] 등 필드 토큰
 */
import { evaluateFormulaExpressionString } from '@/lib/formula-expression-evaluator';

export const EXIM_RATE_FIELD_COLUMNS = [
  { key: 'dealBasR', label: '매매기준율' },
  { key: 'tts', label: '보내실 때' },
  { key: 'ttb', label: '받으실 때' },
  { key: 'bkpr', label: '장부가격' },
  { key: 'yyEfeeR', label: '년환가료율' },
  { key: 'tenDdEfeeR', label: '10일환가료율' },
  { key: 'kftcDealBasR', label: '중개 매매기준' },
  { key: 'kftcBkpr', label: '중개 장부가격' }
];

export const PRICING_STEP_DEFS = [
  { id: 'orderRate', label: '발주환율', resultKey: 'orderRate', resultKind: 'rate' },
  { id: 'rpiRate', label: 'RPI환율', resultKey: 'rpiRate', resultKind: 'rate' },
  { id: 'supplyCost', label: '공급원가', resultKey: 'supplyCost', resultKind: 'money' },
  { id: 'consumerPrice', label: '산정 소비자가', resultKey: 'consumerPrice', resultKind: 'money' },
  { id: 'vat', label: 'VAT', resultKey: 'vatAmount', resultKind: 'money' }
];

export const STEP_RESULT_FIELD_LABELS = {
  orderRate: '발주환율',
  rpiRate: 'RPI환율',
  supplyCost: '공급원가',
  consumerPrice: '산정 소비자가',
  vat: 'VAT'
};

export const REFERENCE_USD_FIELD_LABEL = '기준USD';

/** Excel 스타일 — 평가·치환 전 선행 = 제거 */
export function stripExchangeRateFormulaPrefix(raw) {
  let s = String(raw || '').trim();
  while (s.startsWith('=')) s = s.slice(1).trim();
  return s;
}

/** 저장·표시용 — 맨 앞 = 보장 */
export function normalizeExchangeRateStepFormula(raw) {
  const body = stripExchangeRateFormulaPrefix(raw);
  if (!body) return '';
  return `=${body}`;
}

export const DEFAULT_STEP_FORMULAS = {
  orderRate: '=dec([USD-보내실 때]*1.02,2)',
  rpiRate: '=dec([발주환율]*1.03,2)',
  supplyCost: '=round([기준USD]*[RPI환율])',
  consumerPrice: '=round([공급원가]/(1-0.25))',
  vat: '=round([산정 소비자가]*0.10)'
};

const REF_PATTERN = /\[([^\]]+)\]/g;

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildRateFieldToken(currencyCode, columnLabel) {
  const code = String(currencyCode || '').trim().toUpperCase();
  const label = String(columnLabel || '').trim();
  if (!code || !label) return '';
  return `[${code}-${label}]`;
}

export function buildStepResultToken(stepId) {
  const label = STEP_RESULT_FIELD_LABELS[stepId];
  return label ? `[${label}]` : '';
}

export function buildReferenceUsdToken() {
  return `[${REFERENCE_USD_FIELD_LABEL}]`;
}

export function buildRateFieldValuesFromRows(rows, referenceUsdAmount = 1) {
  const values = {};
  const usd = num(referenceUsdAmount);
  if (usd != null) values[REFERENCE_USD_FIELD_LABEL] = usd;

  for (const row of rows || []) {
    const code = String(row.code || row.id || '').trim().toUpperCase();
    if (!code) continue;
    for (const col of EXIM_RATE_FIELD_COLUMNS) {
      const v = num(row[col.key]);
      if (v == null) continue;
      values[`${code}-${col.label}`] = v;
    }
  }
  return values;
}

export function mergeStepResultsIntoFieldValues(fieldValues, stepResults = {}) {
  const merged = { ...fieldValues };
  for (const step of PRICING_STEP_DEFS) {
    const label = STEP_RESULT_FIELD_LABELS[step.id];
    const v = num(stepResults[step.resultKey]);
    if (label && v != null) merged[label] = v;
  }
  return merged;
}

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

/** 수식 참조 하이라이트 — 엑셀 스타일 파스텔 (순환) */
export const FORMULA_REF_PALETTE = [
  { bg: 'rgba(255, 205, 210, 0.78)', border: 'rgba(210, 120, 130, 0.62)', accent: '#b85a68' },
  { bg: 'rgba(205, 232, 205, 0.78)', border: 'rgba(100, 150, 110, 0.62)', accent: '#4a8a58' },
  { bg: 'rgba(205, 218, 255, 0.78)', border: 'rgba(100, 130, 190, 0.62)', accent: '#4a6aab' },
  { bg: 'rgba(255, 230, 205, 0.78)', border: 'rgba(190, 140, 80, 0.62)', accent: '#a87840' },
  { bg: 'rgba(230, 205, 255, 0.78)', border: 'rgba(150, 100, 190, 0.62)', accent: '#7a50a8' },
  { bg: 'rgba(205, 245, 245, 0.78)', border: 'rgba(80, 160, 160, 0.62)', accent: '#3a9090' }
];

const LABEL_TO_COL_KEY = Object.fromEntries(
  EXIM_RATE_FIELD_COLUMNS.map((col) => [col.label, col.key])
);

/** `[USD-보내실 때]` → { code, label, columnKey } — 환율 표 셀 매핑 */
export function parseRateFieldRef(ref) {
  const s = String(ref || '').trim();
  const dash = s.indexOf('-');
  if (dash <= 0) return null;
  const code = s.slice(0, dash).trim().toUpperCase();
  const label = s.slice(dash + 1).trim();
  const columnKey = LABEL_TO_COL_KEY[label];
  if (!code || !columnKey) return null;
  return { code, label, columnKey, refKey: s };
}

export function getFormulaRefPaletteEntry(colorIndex) {
  if (!FORMULA_REF_PALETTE.length) return null;
  const idx =
    ((Number(colorIndex) % FORMULA_REF_PALETTE.length) + FORMULA_REF_PALETTE.length) %
    FORMULA_REF_PALETTE.length;
  return FORMULA_REF_PALETTE[idx];
}

/**
 * 활성 수식의 [필드] 참조별 색·환율 표 셀/열/행 매핑
 * @returns {{ refColorIndex: Map, cellColorIndex: Map, columnColorIndex: Map, rowColorIndex: Map }}
 */
export function buildFormulaRefColorMaps(expression) {
  const refs = extractFormulaRefs(expression);
  const refColorIndex = new Map();
  const cellColorIndex = new Map();
  const columnColorIndex = new Map();
  const rowColorIndex = new Map();

  refs.forEach((ref, idx) => {
    const colorIdx = idx % FORMULA_REF_PALETTE.length;
    refColorIndex.set(ref, colorIdx);
    const parsed = parseRateFieldRef(ref);
    if (!parsed) return;
    cellColorIndex.set(`${parsed.code}:${parsed.columnKey}`, colorIdx);
    columnColorIndex.set(parsed.columnKey, colorIdx);
    rowColorIndex.set(parsed.code, colorIdx);
  });

  return { refColorIndex, cellColorIndex, columnColorIndex, rowColorIndex, refs };
}

/** 수식 문자열을 텍스트·참조 조각으로 분리 (입력란 색상 표시용) */
export function splitFormulaExpressionParts(expression, refColorIndex = new Map()) {
  const s = String(expression || '');
  const parts = [];
  let last = 0;
  REF_PATTERN.lastIndex = 0;
  let m;
  while ((m = REF_PATTERN.exec(s)) !== null) {
    if (m.index > last) parts.push({ type: 'text', value: s.slice(last, m.index) });
    const refKey = m[1];
    parts.push({
      type: 'ref',
      value: m[0],
      refKey,
      colorIndex: refColorIndex.has(refKey) ? refColorIndex.get(refKey) : null
    });
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ type: 'text', value: s.slice(last) });
  if (!parts.length && s) parts.push({ type: 'text', value: s });
  return parts;
}

export function substituteFormulaRefs(expression, fieldValues = {}) {
  const expr = stripExchangeRateFormulaPrefix(expression);
  if (!expr) return { ok: false };
  let replaced = expr;
  for (const ref of extractFormulaRefs(expr)) {
    const v = num(fieldValues[ref]);
    if (v == null) return { ok: false, missingRef: ref };
    replaced = replaced.replace(new RegExp(`\\[${escapeRegExp(ref)}\\]`, 'g'), `(${v})`);
  }
  REF_PATTERN.lastIndex = 0;
  if (REF_PATTERN.test(replaced)) return { ok: false };
  return { ok: true, expr: replaced };
}

export function evaluateExchangeRateStepFormula(expression, fieldValues = {}) {
  const sub = substituteFormulaRefs(expression, fieldValues);
  if (!sub.ok) return null;
  return evaluateFormulaExpressionString(sub.expr, null);
}

export function validateExchangeRateStepFormula(expression, fieldValues = {}) {
  const expr = stripExchangeRateFormulaPrefix(expression);
  if (!expr) return { ok: false, error: '수식을 입력해 주세요.' };
  const sub = substituteFormulaRefs(expr, fieldValues);
  if (!sub.ok) {
    return {
      ok: false,
      error: sub.missingRef
        ? `수식에 값이 없는 필드 [${sub.missingRef}] 가 있습니다.`
        : '수식 필드 참조를 확인해 주세요.'
    };
  }
  const val = evaluateFormulaExpressionString(sub.expr, null);
  if (val == null) {
    return { ok: false, error: '수식을 계산할 수 없습니다. round, dec, + - * / 등을 확인해 주세요.' };
  }
  return { ok: true, value: val };
}

export function listKnownRateFieldTokens(rows = []) {
  const tokens = [buildReferenceUsdToken()];
  for (const row of rows || []) {
    const code = String(row.code || row.id || '').trim().toUpperCase();
    if (!code) continue;
    for (const col of EXIM_RATE_FIELD_COLUMNS) {
      if (num(row[col.key]) != null) tokens.push(buildRateFieldToken(code, col.label));
    }
  }
  for (const label of Object.values(STEP_RESULT_FIELD_LABELS)) {
    tokens.push(`[${label}]`);
  }
  return tokens;
}
