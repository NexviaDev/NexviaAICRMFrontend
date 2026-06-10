/**
 * 수식 표현식 평가 — [필드] 치환 후 산술 + 엑셀형 함수
 * 보안: eval() 미사용, 화이트리스트 함수만
 */
import { parseNumericFieldValue, parseNumericFieldValueOrZero } from './numeric-field-value';

const FORMULA_CONSTANTS = {
  pi: Math.PI
};

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function assertNum(n, name) {
  if (!Number.isFinite(n)) throw new Error(`invalid:${name}`);
  return n;
}

function fn1(fn, name) {
  return { minArgs: 1, maxArgs: 1, fn: ([x]) => fn(assertNum(toNum(x), name)) };
}

function fn1Any(fn) {
  return { minArgs: 1, maxArgs: 1, fn: ([x]) => fn(x) };
}

function fn2(fn, name) {
  return { minArgs: 2, maxArgs: 2, fn: ([a, b]) => fn(assertNum(toNum(a), name), assertNum(toNum(b), name)) };
}

function fnVar(fn, minArgs = 1, maxArgs = 16) {
  return {
    minArgs,
    maxArgs,
    fn: (args) => {
      const nums = args.map((v, i) => assertNum(toNum(v), `arg${i + 1}`));
      return fn(nums);
    }
  };
}

function excelDateSerial(d = new Date()) {
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor(utc / 86400000) + 25569;
}

function excelTimeFraction(d = new Date()) {
  return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000) / 86400;
}

function mod2(a, b) {
  if (b === 0) throw new Error('div0');
  return ((a % b) + b) % b;
}

function ceiling2(x, significance) {
  if (significance === 0) return 0;
  return Math.ceil(x / significance) * significance;
}

/** Excel ROUND(number, num_digits) — num_digits 음수면 만·억 단위 등 */
function excelRound(x, places) {
  const p = Math.round(toNum(places));
  if (!Number.isFinite(p)) throw new Error('invalid:round');
  const f = 10 ** p;
  return Math.round(toNum(x) * f) / f;
}

function dec(x, places) {
  return excelRound(x, places);
}

function strVal(v) {
  return v == null ? '' : String(v);
}

/** 산술 연산용 — ₩$원% 등 제거 후 숫자 */
function coerceToNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = parseNumericFieldValue(v, { rejectFormula: false });
  return n != null ? n : NaN;
}

function isTruthy(v) {
  if (typeof v === 'string') return v.length > 0 && coerceToNum(v) !== 0;
  const n = coerceToNum(v);
  return Number.isFinite(n) && n !== 0;
}

function isCmpToken(tok) {
  return tok && typeof tok === 'object' && tok.type === 'cmp';
}

function getCmpOp(tok) {
  if (tok && typeof tok === 'object' && tok.type === 'cmp') return tok.op;
  return null;
}

/** 괄호 깊이 0에서 다음 콤마 또는 닫는 괄호 위치 */
function locateExpressionEnd(tokens, start) {
  let pos = start;
  let depth = 0;
  while (pos < tokens.length) {
    const tok = tokens[pos];
    if (tok === '(') depth += 1;
    else if (tok === ')') {
      if (depth === 0) return pos;
      depth -= 1;
    } else if (tok === ',' && depth === 0) return pos;
    pos += 1;
  }
  return pos;
}

function evalFromTokens(tokens, start, end, evalCtx) {
  let pos = start;
  const val = parseComparison(tokens, () => pos, (v) => { pos = v; }, evalCtx);
  if (pos !== end) throw new Error('slice');
  return val;
}

function tryEvalFromTokens(tokens, start, end, evalCtx) {
  try {
    const val = evalFromTokens(tokens, start, end, evalCtx);
    const n = coerceToNum(val);
    if (!Number.isFinite(n)) return null;
    return val;
  } catch {
    return null;
  }
}

function parseIfCall(tokens, getPos, setPos, evalCtx) {
  let pos = getPos();
  if (tokens[pos] !== '(') throw new Error('paren');
  pos += 1;
  const condStart = pos;
  const condEnd = locateExpressionEnd(tokens, condStart);
  if (tokens[condEnd] !== ',') throw new Error('paren');
  const cond = evalFromTokens(tokens, condStart, condEnd, evalCtx);
  pos = condEnd + 1;
  const trueStart = pos;
  const trueEnd = locateExpressionEnd(tokens, trueStart);
  if (tokens[trueEnd] !== ',') throw new Error('paren');
  pos = trueEnd + 1;
  const falseStart = pos;
  const falseEnd = locateExpressionEnd(tokens, falseStart);
  if (tokens[falseEnd] !== ')') throw new Error('paren');
  pos = falseEnd + 1;
  setPos(pos);
  return isTruthy(cond)
    ? evalFromTokens(tokens, trueStart, trueEnd, evalCtx)
    : evalFromTokens(tokens, falseStart, falseEnd, evalCtx);
}

function parseIferrorCall(tokens, getPos, setPos, evalCtx) {
  let pos = getPos();
  if (tokens[pos] !== '(') throw new Error('paren');
  pos += 1;
  const valStart = pos;
  const valEnd = locateExpressionEnd(tokens, valStart);
  if (tokens[valEnd] !== ',') throw new Error('paren');
  const val = tryEvalFromTokens(tokens, valStart, valEnd, evalCtx);
  pos = valEnd + 1;
  const fbStart = pos;
  const fbEnd = locateExpressionEnd(tokens, fbStart);
  if (tokens[fbEnd] !== ')') throw new Error('paren');
  pos = fbEnd + 1;
  setPos(pos);
  if (val != null) return val;
  return evalFromTokens(tokens, fbStart, fbEnd, evalCtx);
}

/** 1-based start, length (Excel MID) */
function substr(s, start, len) {
  const text = strVal(s);
  const st = Math.max(1, Math.floor(toNum(start)));
  const ln = Math.max(0, Math.floor(toNum(len)));
  return text.slice(st - 1, st - 1 + ln);
}

/** 1-based start/end inclusive */
function substrsec(s, start, end) {
  const text = strVal(s);
  const st = Math.max(1, Math.floor(toNum(start)));
  const en = Math.max(st, Math.floor(toNum(end)));
  return text.slice(st - 1, en);
}

const FORMULA_FUNCTIONS = {
  abs: fn1(Math.abs, 'abs'),
  acos: fn1(Math.acos, 'acos'),
  asin: fn1(Math.asin, 'asin'),
  atan: fn1(Math.atan, 'atan'),
  atan2: fn2(Math.atan2, 'atan2'),
  ceiling: fn1(Math.ceil, 'ceiling'),
  ceiling2: fn2(ceiling2, 'ceiling2'),
  cos: fn1(Math.cos, 'cos'),
  cosh: fn1(Math.cosh, 'cosh'),
  cot: fn1((x) => 1 / Math.tan(x), 'cot'),
  csc: fn1((x) => 1 / Math.sin(x), 'csc'),
  deg: fn1((x) => (x * 180) / Math.PI, 'deg'),
  exp: fn1(Math.exp, 'exp'),
  floor: fn1(Math.floor, 'floor'),
  ln: fn1(Math.log, 'ln'),
  log: fn1(Math.log10, 'log'),
  max: fnVar((args) => Math.max(...args), 1, 16),
  min: fnVar((args) => Math.min(...args), 1, 16),
  mod: fn2(mod2, 'mod'),
  mod2: fn2(mod2, 'mod2'),
  rad: fn1((x) => (x * Math.PI) / 180, 'rad'),
  round: {
    minArgs: 1,
    maxArgs: 2,
    fn: (args) => excelRound(args[0], args.length > 1 ? args[1] : 0)
  },
  sec: fn1((x) => 1 / Math.cos(x), 'sec'),
  sin: fn1(Math.sin, 'sin'),
  sinh: fn1(Math.sinh, 'sinh'),
  sqrt: fn1(Math.sqrt, 'sqrt'),
  tan: fn1(Math.tan, 'tan'),
  tanh: fn1(Math.tanh, 'tanh'),
  num2str: fn1Any((x) => strVal(x)),
  str2num: fn1Any((x) => parseNumericFieldValueOrZero(x, { rejectFormula: false })),
  string_length: fn1Any((x) => strVal(x).length),
  substr: {
    minArgs: 3,
    maxArgs: 3,
    fn: ([s, a, b]) => substr(s, a, b)
  },
  substrsec: {
    minArgs: 3,
    maxArgs: 3,
    fn: ([s, a, b]) => substrsec(s, a, b)
  },
  date: { minArgs: 0, maxArgs: 0, fn: () => excelDateSerial(new Date()) },
  time: { minArgs: 0, maxArgs: 0, fn: () => excelTimeFraction(new Date()) },
  dec: fn2(dec, 'dec'),
  pathparam: {
    minArgs: 0,
    maxArgs: 1,
    fn: (args, ctx) => {
      const key = args[0] != null ? String(args[0]).trim() : '';
      const map = ctx?.pathParams || {};
      if (!key) return toNum(map.default ?? 0);
      return toNum(map[key] ?? 0);
    }
  }
};

/** UI 그룹 — 회계·금액 함수를 목록 상단에 표시 */
export const FORMULA_FUNCTION_GROUP_LABELS = {
  accounting: '회계·금액',
  general: '일반',
  advanced: '고급(삼각함수)'
};

/** UI·문서용 함수 목록 — group 순: accounting → general → advanced */
export const FORMULA_FUNCTION_CATALOG = [
  { group: 'accounting', name: 'if', desc: '조건 분기', example: 'if([소비자가]>0,dec(([소비자가]-[원가])/[소비자가]*100,2),0)' },
  { group: 'accounting', name: 'iferror', desc: '오류·0나눗셈 시 대체', example: 'iferror(([소비자가]-[원가])/[소비자가]*100,0)' },
  { group: 'accounting', name: 'round', desc: '반올림(자릿수)', example: 'round([소비자가]*[환율],-4)' },
  { group: 'accounting', name: 'floor', desc: '내림(버림)', example: 'floor(3.9)' },
  { group: 'accounting', name: 'ceiling', desc: '올림', example: 'ceiling(3.1)' },
  { group: 'accounting', name: 'ceiling2', desc: '배수 올림', example: 'ceiling2(13,5)' },
  { group: 'accounting', name: 'dec', desc: '소수·만원 단위 반올림(round 동일)', example: 'dec([소비자가]*[환율],-4)' },
  { group: 'accounting', name: 'abs', desc: '절대값', example: 'abs(-5)' },
  { group: 'accounting', name: 'max', desc: '최대값', example: 'max(1,5,3)' },
  { group: 'accounting', name: 'min', desc: '최소값', example: 'min(1,5,3)' },
  { group: 'accounting', name: 'mod', desc: '나머지', example: 'mod(10,3)' },
  { group: 'accounting', name: 'mod2', desc: '나머지', example: 'mod2(10,3)' },
  { group: 'accounting', name: 'str2num', desc: '문자→숫자', example: 'str2num("120")' },
  { group: 'general', name: 'sqrt', desc: '제곱근', example: 'sqrt(16)' },
  { group: 'general', name: 'ln', desc: '자연로그', example: 'ln(2.718)' },
  { group: 'general', name: 'log', desc: '상용로그', example: 'log(100)' },
  { group: 'general', name: 'exp', desc: '지수(e^x)', example: 'exp(1)' },
  { group: 'general', name: 'date', desc: '오늘 날짜(일련번호)', example: 'date()' },
  { group: 'general', name: 'time', desc: '현재 시각(0~1)', example: 'time()' },
  { group: 'general', name: 'num2str', desc: '숫자→문자', example: 'num2str(120)' },
  { group: 'general', name: 'string_length', desc: '문자 길이', example: 'string_length("abc")' },
  { group: 'general', name: 'substr', desc: '부분 문자열', example: 'substr("abc",1,2)' },
  { group: 'general', name: 'substrsec', desc: '구간 문자열', example: 'substrsec("abc",1,2)' },
  { group: 'general', name: 'pathparam', desc: '경로 파라미터', example: 'pathparam("key")' },
  { group: 'advanced', name: 'sin', desc: '사인', example: 'sin(rad(90))' },
  { group: 'advanced', name: 'cos', desc: '코사인', example: 'cos(0)' },
  { group: 'advanced', name: 'tan', desc: '탄젠트', example: 'tan(rad(45))' },
  { group: 'advanced', name: 'cot', desc: '코탄젠트', example: 'cot(rad(45))' },
  { group: 'advanced', name: 'sec', desc: '시컨트', example: 'sec(rad(60))' },
  { group: 'advanced', name: 'csc', desc: '코시컨트', example: 'csc(rad(90))' },
  { group: 'advanced', name: 'asin', desc: '역사인', example: 'asin(0)' },
  { group: 'advanced', name: 'acos', desc: '역코사인', example: 'acos(1)' },
  { group: 'advanced', name: 'atan', desc: '역탄젠트', example: 'atan(1)' },
  { group: 'advanced', name: 'atan2', desc: '역탄젠트(Y,X)', example: 'atan2(1,1)' },
  { group: 'advanced', name: 'sinh', desc: '쌍곡 사인', example: 'sinh(0)' },
  { group: 'advanced', name: 'cosh', desc: '쌍곡 코사인', example: 'cosh(0)' },
  { group: 'advanced', name: 'tanh', desc: '쌍곡 탄젠트', example: 'tanh(0)' },
  { group: 'advanced', name: 'deg', desc: '라디안→도', example: 'deg(pi)' },
  { group: 'advanced', name: 'rad', desc: '도→라디안', example: 'rad(180)' },
  { group: 'advanced', name: 'pi', desc: '원주율 상수', example: 'pi' }
];

export function getFormulaFunctionNames() {
  return Object.keys(FORMULA_FUNCTIONS).sort();
}

export function isKnownFormulaIdentifier(name) {
  const n = String(name || '').toLowerCase();
  return n === 'pi' || n === 'if' || n === 'iferror'
    || Object.prototype.hasOwnProperty.call(FORMULA_FUNCTIONS, n);
}

function tokenize(expr) {
  const tokens = [];
  const s = String(expr || '').replace(/\s+/g, '');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const two = s.slice(i, i + 2);
    if (two === '>=' || two === '<=' || two === '<>') {
      tokens.push({ type: 'cmp', op: two });
      i += 2;
      continue;
    }
    if (c === '>' || c === '<') {
      tokens.push({ type: 'cmp', op: c });
      i += 1;
      continue;
    }
    if (c === '=') {
      tokens.push({ type: 'cmp', op: '=' });
      i += 1;
      continue;
    }
    if ('+-*/(),'.includes(c)) {
      tokens.push(c);
      i += 1;
      continue;
    }
    if (/\d/.test(c) || (c === '.' && i + 1 < s.length && /\d/.test(s[i + 1]))) {
      let j = i + 1;
      while (j < s.length && /[\d.]/.test(s[j])) j += 1;
      tokens.push({ type: 'num', value: parseFloat(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let value = '';
      while (j < s.length && s[j] !== quote) {
        value += s[j];
        j += 1;
      }
      if (j >= s.length) throw new Error('string');
      tokens.push({ type: 'str', value });
      i = j + 1;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j += 1;
      tokens.push({ type: 'id', value: s.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    throw new Error('token');
  }
  return tokens;
}

function parseExpression(tokens, getPos, setPos, evalCtx) {
  let pos = getPos();
  const left = parseComparison(tokens, () => pos, (v) => { pos = v; }, evalCtx);
  setPos(pos);
  return left;
}

function parseComparison(tokens, getPos, setPos, evalCtx) {
  let pos = getPos();
  let left = parseAddSub(tokens, () => pos, (v) => { pos = v; }, evalCtx);
  while (pos < tokens.length && isCmpToken(tokens[pos])) {
    const op = getCmpOp(tokens[pos]);
    pos += 1;
    const right = parseAddSub(tokens, () => pos, (v) => { pos = v; }, evalCtx);
    const l = coerceToNum(left);
    const r = coerceToNum(right);
    let ok = false;
    if (op === '>') ok = l > r;
    else if (op === '<') ok = l < r;
    else if (op === '>=') ok = l >= r;
    else if (op === '<=') ok = l <= r;
    else if (op === '=') ok = l === r;
    else if (op === '<>') ok = l !== r;
    left = ok ? 1 : 0;
  }
  setPos(pos);
  return left;
}

function parseAddSub(tokens, getPos, setPos, evalCtx) {
  let pos = getPos();
  let left = parseMulDiv(tokens, () => pos, (v) => { pos = v; }, evalCtx);
  while (pos < tokens.length && (tokens[pos] === '+' || tokens[pos] === '-')) {
    const op = tokens[pos];
    pos += 1;
    const right = parseMulDiv(tokens, () => pos, (v) => { pos = v; }, evalCtx);
    const l = coerceToNum(left);
    const r = coerceToNum(right);
    left = op === '+' ? l + r : l - r;
  }
  setPos(pos);
  return left;
}

function parseMulDiv(tokens, getPos, setPos, evalCtx) {
  let pos = getPos();
  let left = parseUnary(tokens, () => pos, (v) => { pos = v; }, evalCtx);
  while (pos < tokens.length && (tokens[pos] === '*' || tokens[pos] === '/')) {
    const op = tokens[pos];
    pos += 1;
    const right = parseUnary(tokens, () => pos, (v) => { pos = v; }, evalCtx);
    const l = coerceToNum(left);
    const r = coerceToNum(right);
    if (op === '/' && r === 0) throw new Error('div0');
    left = op === '*' ? l * r : l / r;
  }
  setPos(pos);
  return left;
}

function parseUnary(tokens, getPos, setPos, evalCtx) {
  let pos = getPos();
  if (tokens[pos] === '+') {
    pos += 1;
    setPos(pos);
    return parseUnary(tokens, getPos, setPos, evalCtx);
  }
  if (tokens[pos] === '-') {
    pos += 1;
    setPos(pos);
    return -coerceToNum(parseUnary(tokens, getPos, setPos, evalCtx));
  }
  return parsePrimary(tokens, getPos, setPos, evalCtx);
}

function parseArgList(tokens, getPos, setPos, evalCtx) {
  let pos = getPos();
  const args = [];
  if (tokens[pos] === ')') {
    setPos(pos);
    return args;
  }
  args.push(parseExpression(tokens, () => pos, (v) => { pos = v; }, evalCtx));
  while (tokens[pos] === ',') {
    pos += 1;
    args.push(parseExpression(tokens, () => pos, (v) => { pos = v; }, evalCtx));
  }
  setPos(pos);
  return args;
}

function parsePrimary(tokens, getPos, setPos, evalCtx) {
  let pos = getPos();
  const tok = tokens[pos];
  if (tok === '(') {
    pos += 1;
    const inner = parseExpression(tokens, () => pos, (v) => { pos = v; }, evalCtx);
    if (tokens[pos] !== ')') throw new Error('paren');
    pos += 1;
    setPos(pos);
    return inner;
  }
  if (tok && typeof tok === 'object' && tok.type === 'num') {
    pos += 1;
    setPos(pos);
    return tok.value;
  }
  if (tok && typeof tok === 'object' && tok.type === 'str') {
    pos += 1;
    setPos(pos);
    return tok.value;
  }
  if (tok && typeof tok === 'object' && tok.type === 'id') {
    const name = tok.value;
    pos += 1;
    if (tokens[pos] === '(') {
      if (name === 'if') {
        setPos(pos);
        return parseIfCall(tokens, getPos, setPos, evalCtx);
      }
      if (name === 'iferror') {
        setPos(pos);
        return parseIferrorCall(tokens, getPos, setPos, evalCtx);
      }
      pos += 1;
      const args = parseArgList(tokens, () => pos, (v) => { pos = v; }, evalCtx);
      if (tokens[pos] !== ')') throw new Error('paren');
      pos += 1;
      setPos(pos);
      const def = FORMULA_FUNCTIONS[name];
      if (!def) throw new Error(`fn:${name}`);
      if (args.length < def.minArgs || args.length > def.maxArgs) throw new Error(`argc:${name}`);
      return def.fn(args, evalCtx);
    }
    if (name === 'pi') {
      setPos(pos);
      return FORMULA_CONSTANTS.pi;
    }
    throw new Error(`id:${name}`);
  }
  throw new Error('primary');
}

/**
 * @param {string} expr — [필드] 치환 완료된 수식
 * @param {object} [evalCtx] — pathParams 등
 */
export function evaluateFormulaExpressionString(expr, evalCtx = null) {
  const s = String(expr || '').replace(/\s+/g, '');
  if (!s) return null;
  try {
    const tokens = tokenize(s);
    if (!tokens.length) return null;
    let pos = 0;
    const result = parseExpression(tokens, () => pos, (v) => { pos = v; }, evalCtx);
    if (pos !== tokens.length) return null;
    const final = coerceToNum(result);
    if (!Number.isFinite(final)) return null;
    if (Math.abs(final) === Infinity) return null;
    return Math.round(final * 1e6) / 1e6;
  } catch {
    return null;
  }
}

/** 검증용 — 알 수 없는 식별자/함수 반환 */
export function validateFormulaExpressionString(expr, evalCtx = null) {
  const s = String(expr || '').replace(/\s+/g, '');
  if (!s) return { ok: false, error: '수식을 입력해 주세요.' };
  try {
    const val = evaluateFormulaExpressionString(s, evalCtx);
    if (val == null) return { ok: false, error: '수식을 계산할 수 없습니다. 괄호·함수·연산자를 확인해 주세요.' };
    return { ok: true, value: val };
  } catch (e) {
    const msg = String(e?.message || '');
    if (msg.startsWith('fn:')) return { ok: false, error: `지원하지 않는 함수입니다: ${msg.slice(3)}` };
    if (msg.startsWith('id:')) return { ok: false, error: `알 수 없는 식별자입니다: ${msg.slice(3)}` };
    return { ok: false, error: '수식을 계산할 수 없습니다.' };
  }
}
