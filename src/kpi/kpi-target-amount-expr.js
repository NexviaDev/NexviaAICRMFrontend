/**
 * KPI 목표 입력란용: 엑셀처럼 `*1.2`, `+1000`, `=10+20*2` 등을 정수(원·개)로 계산.
 * eval/Function 미사용, 허용 문자만 파싱.
 */

function stripSpacesAndCommas(s) {
  return String(s ?? '')
    .replace(/,/g, '')
    .replace(/\s/g, '');
}

/** 선행 연산자 + 오른쪽 피연산자 한 개 (셀 기준값 왼쪽에 붙는 형태: *1.2, +100, /2) */
function tryLeadingOpWithBase(stripped, base) {
  const m = stripped.match(/^([+*/])((?:\d+\.?\d*|\.\d+))$/);
  if (m) {
    const rhs = Number(m[2]);
    if (!Number.isFinite(rhs)) return null;
    switch (m[1]) {
      case '+':
        return base + rhs;
      case '*':
        return base * rhs;
      case '/':
        return rhs === 0 ? base : base / rhs;
      default:
        return null;
    }
  }
  const sub = stripped.match(/^-((?:\d+\.?\d*|\.\d+))$/);
  if (sub) {
    const rhs = Number(sub[1]);
    if (!Number.isFinite(rhs)) return null;
    return base - rhs;
  }
  return null;
}

/**
 * 사칙연산 + 괄호. 공백·콤마 무시.
 * @param {string} expr
 * @returns {number}
 */
function evaluateArithmeticExpression(expr) {
  const s = stripSpacesAndCommas(expr);
  if (!s || s === '=') return NaN;
  let i = 0;
  const peek = () => s[i] || '';
  const eat = (c) => {
    if (peek() === c) {
      i += 1;
      return true;
    }
    return false;
  };

  const parseNumber = () => {
    const start = i;
    if (peek() === '.') {
      i += 1;
      while (/\d/.test(peek())) i += 1;
    } else {
      while (/\d/.test(peek())) i += 1;
      if (peek() === '.') {
        i += 1;
        while (/\d/.test(peek())) i += 1;
      }
    }
    if (start === i) return NaN;
    const n = Number(s.slice(start, i));
    return Number.isFinite(n) ? n : NaN;
  };

  const parsePrimary = () => {
    if (eat('(')) {
      const v = parseExpr();
      if (!eat(')')) return NaN;
      return v;
    }
    return parseNumber();
  };

  const parseFactor = () => {
    let sign = 1;
    if (eat('+')) {
      /* unary plus */
    } else if (eat('-')) {
      sign = -1;
    }
    const p = parsePrimary();
    if (!Number.isFinite(p)) return NaN;
    let v = p * sign;
    while (peek() === '*' || peek() === '/') {
      const op = peek();
      i += 1;
      let signR = 1;
      if (eat('+')) {
        /* */
      } else if (eat('-')) {
        signR = -1;
      }
      const r = parsePrimary() * signR;
      if (!Number.isFinite(r)) return NaN;
      if (op === '*') v *= r;
      else v = r === 0 ? v : v / r;
    }
    return v;
  };

  const parseExpr = () => {
    let v = parseFactor();
    if (!Number.isFinite(v)) return NaN;
    while (peek() === '+' || peek() === '-') {
      const op = peek();
      i += 1;
      const r = parseFactor();
      if (!Number.isFinite(r)) return NaN;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };

  const out = parseExpr();
  if (i < s.length) return NaN;
  return out;
}

/**
 * @param {string} rawInput 사용자 입력(콤마·공백·선행 = 허용)
 * @param {number} baseValue 포커스 직전 셀 값(선행 연산자 모드에 사용)
 * @returns {number} NaN 이면 파싱 실패
 */
export function evaluateKpiAmountExpression(rawInput, baseValue) {
  let s = stripSpacesAndCommas(rawInput);
  if (s.startsWith('=')) s = s.slice(1);
  const base = Math.max(0, Math.round(Number(baseValue) || 0));
  if (!s) return base;

  const lead = tryLeadingOpWithBase(s, base);
  if (lead !== null && Number.isFinite(lead)) return lead;

  const onlyDigits = /^\d+$/.test(s);
  if (onlyDigits) return Number(s);

  const ar = evaluateArithmeticExpression(s);
  return ar;
}

/** onChange용: 0 이상 정수 문자열 */
export function digitsFromEvaluatedKpiAmount(rawInput, baseValue) {
  const n = evaluateKpiAmountExpression(rawInput, baseValue);
  if (!Number.isFinite(n)) return String(Math.max(0, Math.round(Number(baseValue) || 0)));
  return String(Math.max(0, Math.round(n)));
}
