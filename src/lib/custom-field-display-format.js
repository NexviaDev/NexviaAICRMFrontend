/**
 * 추가 필드 표시형식 — 저장값은 변경하지 않고 화면 표시만 변환 (MS Office 숫자 서식 유사)
 */
import { parseNumericFieldValue } from '@/lib/numeric-field-value';
import {
  getCurrencyMeta,
  getCurrencySymbol,
  PRODUCT_CURRENCY_SELECT_OPTIONS
} from '@/lib/exchange-rate-currency-options';

/** 회계·통화 표시형식 — 제품 행의 currency 사용 */
export const DISPLAY_FORMAT_CURRENCY_PRODUCT = 'product';

export const CUSTOM_FIELD_DISPLAY_FORMATS = [
  { value: 'general', label: '일반', hint: '특정 서식 없음' },
  { value: 'number', label: '숫자', hint: '1,234.56' },
  { value: 'currency', label: '통화', hint: '₩1,234' },
  { value: 'accounting', label: '회계', hint: '₩1,234 · (₩123) 음수' },
  { value: 'shortDate', label: '간단한 날짜', hint: '2026-06-09' },
  { value: 'longDate', label: '자세한 날짜', hint: '2026년 6월 9일 화요일' },
  { value: 'time', label: '시간', hint: '14:30:00' },
  { value: 'percentage', label: '백분율', hint: '5 → 5%' },
  { value: 'fraction', label: '분수', hint: '0.5 → 1/2' },
  { value: 'scientific', label: '지수', hint: '1.23e+4' },
  { value: 'text', label: '텍스트', hint: '입력값 그대로' }
];

const FORMAT_VALUES = new Set(CUSTOM_FIELD_DISPLAY_FORMATS.map((f) => f.value));
const VALID_CURRENCY_CODES = new Set(PRODUCT_CURRENCY_SELECT_OPTIONS.map((o) => o.value));

export function usesDisplayFormatCurrency(format) {
  const fmt = normalizeCustomFieldDisplayFormat(format);
  return fmt === 'currency' || fmt === 'accounting';
}

export function normalizeDisplayFormatCurrency(raw, displayFormat = null) {
  const fmt = displayFormat != null ? normalizeCustomFieldDisplayFormat(displayFormat) : null;
  if (fmt && !usesDisplayFormatCurrency(fmt)) return null;

  const s = String(raw || '').trim().toUpperCase();
  if (!s || s === DISPLAY_FORMAT_CURRENCY_PRODUCT) return DISPLAY_FORMAT_CURRENCY_PRODUCT;
  if (VALID_CURRENCY_CODES.has(s)) return s;
  return DISPLAY_FORMAT_CURRENCY_PRODUCT;
}

export function getStoredDisplayFormatCurrency(def) {
  const options = normalizeCustomFieldDefOptions(def?.options);
  return normalizeDisplayFormatCurrency(options?.displayFormatCurrency, options?.displayFormat);
}

/** 표시용 ISO 통화 — product면 context.currency, 아니면 고정 코드 */
export function resolveDisplayFormatCurrency(def, context = {}) {
  const format = getCustomFieldDisplayFormat(def);
  if (!usesDisplayFormatCurrency(format)) return null;

  const stored = getStoredDisplayFormatCurrency(def);
  if (stored === DISPLAY_FORMAT_CURRENCY_PRODUCT) {
    const rowCur = String(context.currency || 'KRW').trim().toUpperCase();
    return rowCur || 'KRW';
  }
  return stored;
}

export function normalizeCustomFieldDisplayFormat(raw) {
  const s = String(raw || '').trim();
  return FORMAT_VALUES.has(s) && s !== 'general' ? s : 'general';
}

/** API/Mongoose — options 가 문자열이면 객체로 */
export function normalizeCustomFieldDefOptions(options) {
  if (options == null) return null;
  if (typeof options === 'string') {
    try {
      const parsed = JSON.parse(options);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof options === 'object' && !Array.isArray(options)) return options;
  return null;
}

export function normalizeCustomFieldDefinition(def) {
  if (!def || typeof def !== 'object') return def;
  const options = normalizeCustomFieldDefOptions(def.options);
  if (options === def.options) return def;
  return { ...def, options };
}

/** customFields 객체에서 key 조회 (대소문자 무시 fallback) */
export function readCustomFieldStoredValue(customFields, fieldKey) {
  if (!customFields || typeof customFields !== 'object') return undefined;
  const fk = String(fieldKey || '').trim();
  if (!fk) return undefined;
  if (Object.prototype.hasOwnProperty.call(customFields, fk)) {
    return customFields[fk];
  }
  const lower = fk.toLowerCase();
  for (const [k, v] of Object.entries(customFields)) {
    if (String(k).trim().toLowerCase() === lower) return v;
  }
  return undefined;
}

export function getCustomFieldDisplayFormat(def) {
  const options = normalizeCustomFieldDefOptions(def?.options);
  return normalizeCustomFieldDisplayFormat(options?.displayFormat);
}

export function isPercentageDisplayFormat(def) {
  return getCustomFieldDisplayFormat(def) === 'percentage';
}

export function findCustomFieldDefinitionByKey(definitions, key) {
  const fk = String(key || '').trim();
  if (!fk || !Array.isArray(definitions)) return null;
  return (
    definitions.find((d) => d?.key === fk) ||
    definitions.find((d) => String(d?.key || '').trim().toLowerCase() === fk.toLowerCase()) ||
    null
  );
}

/**
 * DB 저장값 → 수식 참조용 숫자.
 * 표시형식이 백분율이면 30 → 0.3 (원가×마진율 등 계산용)
 */
export function customFieldNumericForFormula(value, def) {
  const n = parseNumericFieldValue(value, { fieldType: def?.type, rejectFormula: true });
  if (n == null || !Number.isFinite(n)) return null;
  if (isPercentageDisplayFormat(def)) return n / 100;
  return n;
}

/**
 * 수식 필드 계산 결과 → 백분율 표시용 저장값.
 * 비율(0~1)로 나온 결과만 ×100 (예: [마진율]*2 → 0.6 → 60%)
 */
export function scaleFormulaResultForPercentageDisplay(value, def) {
  if (def?.type !== 'formula' || !isPercentageDisplayFormat(def)) return value;
  const n = parseNumericFieldValue(value, { rejectFormula: false });
  if (n == null || !Number.isFinite(n)) return value;
  if (n !== 0 && Math.abs(n) <= 1) return n * 100;
  return n;
}

/** options 객체에 displayFormat·displayFormatCurrency 병합 */
export function mergeDisplayFormatIntoOptions(existingOptions, displayFormat, displayFormatCurrency) {
  const fmt = normalizeCustomFieldDisplayFormat(displayFormat);
  const normalizedExisting = normalizeCustomFieldDefOptions(existingOptions);
  const base = normalizedExisting ? { ...normalizedExisting } : {};

  delete base.displayFormat;
  delete base.displayFormatCurrency;

  if (fmt === 'general') {
    return Object.keys(base).length ? base : null;
  }

  base.displayFormat = fmt;

  if (usesDisplayFormatCurrency(fmt)) {
    const cur = normalizeDisplayFormatCurrency(displayFormatCurrency, fmt);
    if (cur && cur !== DISPLAY_FORMAT_CURRENCY_PRODUCT) {
      base.displayFormatCurrency = cur;
    }
  }

  return base;
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function formatAsFraction(n) {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  const tolerance = 1e-5;
  const sign = n < 0 ? '-' : '';
  let abs = Math.abs(n);
  for (let den = 1; den <= 64; den += 1) {
    const num = Math.round(abs * den);
    if (Math.abs(num / den - abs) < tolerance) {
      const g = gcd(num, den);
      return `${sign}${num / g}/${den / g}`;
    }
  }
  return `${sign}${abs.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}`;
}

function parseDisplayDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(value ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatGeneralDisplay(value, def) {
  if (def?.type === 'checkbox') return value ? '예' : '아니오';
  if (def?.type === 'multiselect' && Array.isArray(value)) {
    return value.length ? value.join(', ') : '—';
  }
  if (def?.type === 'formula') {
    const n = Number(value);
    if (Number.isFinite(n)) {
      const scaled = scaleFormulaResultForPercentageDisplay(n, def);
      if (isPercentageDisplayFormat(def)) {
        return `${scaled.toLocaleString('ko-KR', { maximumFractionDigits: 4, minimumFractionDigits: 0 })}%`;
      }
      return scaled.toLocaleString('ko-KR', { maximumFractionDigits: 4, minimumFractionDigits: 0 });
    }
  }
  if (typeof value === 'string' && !value.trim()) return '—';
  return String(value);
}

/**
 * @param {*} value — DB 저장값 (변경하지 않음)
 * @param {{ type?: string, options?: object }} def
 * @param {{ currency?: string }} [context]
 */
export function formatCustomFieldDisplayValue(value, def, context = {}) {
  if (value === undefined || value === null) return '—';

  const format = getCustomFieldDisplayFormat(def);
  if (format === 'general') {
    return formatGeneralDisplay(value, def);
  }

  if (def?.type === 'checkbox') {
    return value ? '예' : '아니오';
  }
  if (def?.type === 'multiselect' && Array.isArray(value)) {
    return value.length ? value.join(', ') : '—';
  }

  if (format === 'text') {
    if (typeof value === 'string' && !value.trim()) return '—';
    return String(value);
  }

  if (format === 'shortDate' || format === 'longDate' || format === 'time') {
    const d = parseDisplayDate(value);
    if (!d) {
      if (typeof value === 'string' && !value.trim()) return '—';
      return String(value);
    }
    if (format === 'shortDate') {
      return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    if (format === 'longDate') {
      return d.toLocaleDateString('ko-KR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  const n =
    typeof value === 'number' && Number.isFinite(value)
      ? value
      : parseNumericFieldValue(value, { rejectFormula: false });

  if (n == null || !Number.isFinite(n)) {
    if (typeof value === 'string' && !value.trim()) return '—';
    return String(value);
  }

  const displayNum =
    def?.type === 'formula' ? scaleFormulaResultForPercentageDisplay(n, def) : n;

  const currencyCode = resolveDisplayFormatCurrency(def, context) || 'KRW';
  const sym = getCurrencySymbol(currencyCode);
  const meta = getCurrencyMeta(currencyCode);
  const numFmt = (v, frac = 2) =>
    v.toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: frac });

  switch (format) {
    case 'number':
      return numFmt(displayNum);
    case 'currency': {
      const prefix = meta.symbol === sym ? sym : `${sym}`;
      return `${prefix}${numFmt(Math.abs(displayNum))}`;
    }
    case 'accounting': {
      const prefix = meta.symbol === sym ? sym : `${sym}`;
      if (displayNum < 0) return `(${prefix}${numFmt(Math.abs(displayNum))})`;
      return `${prefix}${numFmt(displayNum)}`;
    }
    case 'percentage':
      return `${numFmt(displayNum)}%`;
    case 'scientific':
      return displayNum.toExponential(2);
    case 'fraction':
      return formatAsFraction(displayNum);
    default:
      return formatGeneralDisplay(value, def);
  }
}

export function getCustomFieldDisplayFormatClass(def) {
  const format = getCustomFieldDisplayFormat(def);
  if (format === 'accounting' || format === 'currency') return 'crm-custom-field-display--money';
  if (format === 'number' || format === 'percentage' || format === 'scientific') {
    return 'crm-custom-field-display--numeric';
  }
  return '';
}
