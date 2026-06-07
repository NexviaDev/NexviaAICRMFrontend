/**
 * 기회 문서 매핑 — 함수(연산) 소스.
 * 줄바꿈(제품 행)이 있으면 같은 줄끼리 * + - / 적용.
 *
 * 예: derived.linesCostPrices * derived.linesQuantities
 *     @unitPrice * @quantity  (@ = 다른 치환 키)
 */

import { parseNumber } from '@/lib/sales-opportunity-form-shared';
import { resolveOpportunityMergeSourceValue } from '@/lib/opportunity-merge-sources';

const OPERAND_RE =
  /^(derived\.[a-zA-Z0-9_.]+|form\.[a-zA-Z0-9_]+|fixed\.[a-zA-Z0-9_.]+|snapshot\.[a-zA-Z0-9_.]+|slot\.[a-zA-Z0-9_.]+|finance\.[a-zA-Z0-9_]+|schedule\.[a-zA-Z0-9_]+|@[a-zA-Z0-9_]+)$/;

const BINARY_EXPR_RE =
  /^(.+?)\s*([*+\-/])\s*(.+?)$/;

export const FORMULA_OPERATORS = Object.freeze([
  { id: '*', label: '×' },
  { id: '+', label: '+' },
  { id: '-', label: '−' },
  { id: '/', label: '÷' }
]);

export const MERGE_FORMULA_PRESETS = Object.freeze([
  {
    id: 'cost-times-qty',
    label: '원가 × 수량',
    left: 'derived.linesCostPrices',
    op: '*',
    right: 'derived.linesQuantities'
  },
  {
    id: 'unit-times-qty',
    label: '단가 × 수량',
    left: 'derived.linesUnitPrices',
    op: '*',
    right: 'derived.linesQuantities'
  },
  {
    id: 'line-amount',
    label: '행별 금액(할인 반영)',
    left: 'derived.linesLineAmounts',
    op: '*',
    right: ''
  }
]);

export function buildFormulaExpression(left, op, right) {
  const l = String(left || '').trim();
  const r = String(right || '').trim();
  const operator = String(op || '*').trim() || '*';
  if (!l) return '';
  if (!r) return l;
  return `${l} ${operator} ${r}`;
}

/** 저장된 formulaExpression 문자열 → UI 선택값 (레거시 호환) */
export function parseFormulaExpressionToParts(expression) {
  const expr = normalizeMergeFormulaExpression(expression);
  if (!expr) return { left: '', op: '*', right: '' };
  const single = expr.match(OPERAND_RE);
  if (single) return { left: expr, op: '*', right: '' };
  const m = expr.match(BINARY_EXPR_RE);
  if (!m) return { left: '', op: '*', right: '' };
  const left = m[1].trim();
  const right = m[3].trim();
  if (!OPERAND_RE.test(left) || !OPERAND_RE.test(right)) {
    return { left: '', op: '*', right: '' };
  }
  return { left, op: m[2], right };
}

function splitLines(raw) {
  return String(raw ?? '').split(/\r\n|\n|\r/);
}

function resolveOperandToken(token, ctx, mappingRows, selfMergeKey) {
  const t = String(token || '').trim();
  if (!t) return '';
  if (t.startsWith('@')) {
    const key = t.slice(1);
    const row = (mappingRows || []).find((r) => r && r.mergeKey === key);
    if (!row || key === selfMergeKey) return '';
    if (row.sourceType === 'constant') return String(row.constantValue ?? '');
    if (row.sourceType === 'field' && row.sourceKey) {
      return String(resolveOpportunityMergeSourceValue(row.sourceKey, ctx) ?? '');
    }
    return '';
  }
  return String(resolveOpportunityMergeSourceValue(t, ctx) ?? '');
}

function applyLineWiseBinary(leftRaw, rightRaw, op) {
  const leftLines = splitLines(leftRaw);
  const rightLines = splitLines(rightRaw);
  const lineCount = Math.max(leftLines.length, rightLines.length, 1);
  const out = [];
  for (let i = 0; i < lineCount; i += 1) {
    const a = parseNumber(leftLines[i] ?? leftLines[leftLines.length - 1] ?? '0');
    const b = parseNumber(rightLines[i] ?? rightLines[rightLines.length - 1] ?? '0');
    let v = 0;
    if (op === '*') v = a * b;
    else if (op === '+') v = a + b;
    else if (op === '-') v = a - b;
    else if (op === '/') v = b !== 0 ? a / b : 0;
    if (!Number.isFinite(v)) v = 0;
    out.push(String(Math.round(v)));
  }
  return out.join('\n');
}

/**
 * @param {string} expression
 * @param {object} ctx mergeContext
 * @param {object[]} [mappingRows]
 * @param {string} [selfMergeKey]
 */
export function evaluateOpportunityMergeFormula(expression, ctx, mappingRows, selfMergeKey) {
  const expr = String(expression || '').trim();
  if (!expr) return '';

  const single = expr.match(OPERAND_RE);
  if (single) {
    return resolveOperandToken(expr, ctx, mappingRows, selfMergeKey).trim();
  }

  const m = expr.match(BINARY_EXPR_RE);
  if (!m) return '';

  const leftTok = m[1].trim();
  const op = m[2];
  const rightTok = m[3].trim();
  if (!OPERAND_RE.test(leftTok) || !OPERAND_RE.test(rightTok)) return '';

  const leftVal = resolveOperandToken(leftTok, ctx, mappingRows, selfMergeKey);
  const rightVal = resolveOperandToken(rightTok, ctx, mappingRows, selfMergeKey);
  return applyLineWiseBinary(leftVal, rightVal, op);
}

export function normalizeMergeFormulaExpression(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/×/g, '*')
    .replace(/÷/g, '/');
}
