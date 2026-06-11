/**
 * 제품 엑셀 가져오기 — 매핑 행·행→API body 변환
 */
import * as XLSX from 'xlsx';
import {
  readExcelMappedCell,
  resolveExcelRowHeaderKey,
  previewExcelMappedValue
} from '../../customer-companies/customer-companies-excel-import-modal/excel-import-mapping-utils';
import { normalizeBillingInterval, parseBillingIntervalInput } from '@/lib/product-billing-utils';
import {
  parseFormulaInput,
  getDefinitionFormulaDefaultDisplay,
  computeCustomFieldFormulas,
  evaluateFormulaExpression
} from '@/lib/custom-field-formula';
import {
  normalizeCustomFieldsForApiSave,
  normalizeCustomFieldsForFormula,
  normalizeFormulaBuiltInNumbers,
  parseNumericFieldValue,
  parseNumericFieldValueOrZero
} from '@/lib/numeric-field-value';
import { buildExchangeRateFormulaBuiltin } from '@/lib/exchange-rate-formula-builtin';
import {
  buildLiveProductDraft,
  buildProductFieldPayload,
  buildProductFormulaCatalogGroups,
  buildProductFormulaPickerOptions,
  resolveProductFieldValues
} from '@/lib/product-field-formulas';
import {
  getCurrencyMeta,
  getCurrencySelectLabel,
  PRODUCT_CURRENCY_SELECT_OPTIONS,
  resolveProductCurrencySelectOptions
} from '@/lib/exchange-rate-currency-options';

export const PRODUCT_PRICE_TARGET_KEYS = new Set([
  'product.listPrice',
  'product.costPrice',
  'product.channelPrice',
  'product.consumerMargin',
  'product.channelMargin'
]);

/** 수식(=…) 입력 가능한 매핑 대상 */
export const PRODUCT_FORMULA_CAPABLE_TARGET_KEYS = new Set([
  'product.listPrice',
  'product.costPrice',
  'product.channelPrice',
  'product.consumerMargin',
  'product.channelMargin'
]);

export const PRODUCT_FORMULA_TARGET_TO_FIELD = {
  'product.listPrice': 'listPrice',
  'product.costPrice': 'costPrice',
  'product.channelPrice': 'channelPrice',
  'product.consumerMargin': 'consumerMargin',
  'product.channelMargin': 'channelMargin'
};

const PRODUCT_CUSTOM_FIELD_TARGET_PREFIX = 'product.customFields.';

export function productCustomFieldKeyFromTarget(targetKey) {
  const tk = String(targetKey || '');
  if (!tk.startsWith(PRODUCT_CUSTOM_FIELD_TARGET_PREFIX)) return '';
  return tk.slice(PRODUCT_CUSTOM_FIELD_TARGET_PREFIX.length);
}

/** 수식 입력·미리보기 UI — 내장 금액 필드 + type=formula|number 추가 필드 */
export function isProductFormulaCapableTarget(targetKey, customDefinitions = []) {
  const tk = String(targetKey || '');
  if (PRODUCT_FORMULA_CAPABLE_TARGET_KEYS.has(tk)) return true;
  const ck = productCustomFieldKeyFromTarget(tk);
  if (!ck) return false;
  const def = (customDefinitions || []).find((d) => d?.key === ck);
  return def?.type === 'formula' || def?.type === 'number';
}

function productCustomFieldDefFromTarget(targetKey, customDefinitions = []) {
  const ck = productCustomFieldKeyFromTarget(targetKey);
  if (!ck) return null;
  return (customDefinitions || []).find((d) => d?.key === ck) || null;
}

export { buildProductFormulaCatalogGroups, buildProductFormulaPickerOptions };

function resolveCurrencySelectOptions(allowedCodes = null) {
  if (allowedCodes instanceof Set && allowedCodes.size > 0) {
    return resolveProductCurrencySelectOptions('', { availableCodes: allowedCodes });
  }
  return PRODUCT_CURRENCY_SELECT_OPTIONS;
}

function resolveCurrencyCodeSet(allowedCodes = null) {
  return new Set(resolveCurrencySelectOptions(allowedCodes).map((o) => o.value));
}

export const MAX_PRODUCT_EXCEL_ROWS = 500;

export const PRODUCT_REQUIRED_TARGETS = new Set(['product.name']);

const BILLING_KO = { 월간: 'Monthly', 연간: 'Annual', 영구: 'Perpetual' };
const STATUS_KO = { 활성: 'Active', 'end of life': 'EndOfLife', eol: 'EndOfLife', 초안: 'Draft' };

function newRowId() {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** API 실패·로딩 전에도 매핑 UI에 표시할 고정 목록 */
export const PRODUCT_TARGET_OPTIONS_FALLBACK = [
  { value: 'product.name', label: '제품명 (필수)' },
  { value: 'product.code', label: '코드(UID)' },
  { value: 'product.category', label: '카테고리·분류' },
  { value: 'product.version', label: '버전' },
  { value: 'product.listPrice', label: '소비자가(listPrice)' },
  { value: 'product.costPrice', label: '원가' },
  { value: 'product.channelPrice', label: '유통가' },
  { value: 'product.consumerMargin', label: '순 마진' },
  { value: 'product.channelMargin', label: '유통시 순 마진' },
  { value: 'product.currency', label: '통화' },
  { value: 'product.billingType', label: '결제 주기 (월간·연간·영구)' },
  { value: 'product.billingInterval', label: '결제 기간 수 (연간=년, 월간=개월)' },
  { value: 'product.status', label: '상태 (활성·EOL·초안)' }
];

export function buildProductTargetOptions(customFieldDefs = []) {
  const base = [...PRODUCT_TARGET_OPTIONS_FALLBACK];
  const custom = (customFieldDefs || [])
    .filter((d) => d?.key)
    .map((d) => ({
      value: `product.customFields.${d.key}`,
      label: `제품 · ${d.label || d.key} (추가 필드)`
    }));
  return [...base, ...custom];
}

/** 엑셀 헤더 문자열 → 매칭된 소스 열 키 */
export function matchHeader(excelHeaders, candidates) {
  const list = Array.isArray(excelHeaders) ? excelHeaders : [];
  for (const c of candidates) {
    const cl = String(c).toLowerCase().trim();
    const exact = list.find((h) => String(h).trim().toLowerCase() === cl);
    if (exact != null) return exact;
  }
  for (const c of candidates) {
    const cl = String(c).toLowerCase().trim();
    const partial = list.find((h) => String(h).toLowerCase().includes(cl));
    if (partial != null) return partial;
  }
  return '';
}

/**
 * 매핑 UI 초기 행 — 엑셀 첫 행 헤더 기준 자동 연결
 * @param {string[]} excelHeaders
 * @param {Array<{ key: string, label?: string }>} customFieldDefs
 */
export function createInitialProductMappingRows(excelHeaders, customFieldDefs = []) {
  const id = newRowId;
  const h = excelHeaders || [];
  const rows = [
    {
      id: id(),
      sourceType: 'field',
      sourceKey: matchHeader(h, ['제품명', 'name', 'productname', '제품', 'product']),
      constantValue: '',
      targetKey: 'product.name'
    },
    {
      id: id(),
      sourceType: 'field',
      sourceKey: matchHeader(h, ['발주코드', '코드', 'code', 'uid', '제품코드', '제품 코드', 'sku']),
      constantValue: '',
      targetKey: 'product.code'
    },
    {
      id: id(),
      sourceType: 'field',
      sourceKey: matchHeader(h, ['카테고리', 'category', '분류', '카테고리 분류', '카테고리분류', '분류명']),
      constantValue: '',
      targetKey: 'product.category'
    },
    {
      id: id(),
      sourceType: 'field',
      sourceKey: matchHeader(h, ['버전', 'version', 'ver']),
      constantValue: '',
      targetKey: 'product.version'
    },
    {
      id: id(),
      sourceType: 'field',
      sourceKey: matchHeader(h, ['소비자가', 'listprice', 'list price', 'srp', 'dsrp', '가격', 'price', '판매가', 'msrp']),
      constantValue: '',
      targetKey: 'product.listPrice'
    },
    {
      id: id(),
      sourceType: 'field',
      sourceKey: matchHeader(h, ['원가', 'cost', 'costprice', '매입가']),
      constantValue: '',
      targetKey: 'product.costPrice'
    },
    {
      id: id(),
      sourceType: 'field',
      sourceKey: matchHeader(h, ['제공가', '유통가', 'channel', 'channelprice', '유통 가격']),
      constantValue: '',
      targetKey: 'product.channelPrice'
    },
    {
      id: id(),
      sourceType: 'field',
      sourceKey: matchHeader(h, ['순마진', '순 마진', 'consumermargin', 'consumer margin', 'margin']),
      constantValue: '',
      targetKey: 'product.consumerMargin'
    },
    {
      id: id(),
      sourceType: 'field',
      sourceKey: matchHeader(h, ['유통시 순마진', '유통시 순 마진', '유통마진', 'channelmargin', 'channel margin']),
      constantValue: '',
      targetKey: 'product.channelMargin'
    },
    {
      id: id(),
      sourceType: 'field',
      sourceKey: matchHeader(h, ['통화', 'currency', 'cur']),
      constantValue: '',
      targetKey: 'product.currency'
    },
    {
      id: id(),
      sourceType: 'field',
      sourceKey: matchHeader(h, [
        '결제주기',
        '결제 주기',
        'billing',
        'billingtype',
        'billing period',
        'billingperiod',
        '과금주기',
        '청구주기',
        'subscription',
        'term',
        'period',
        '주기'
      ]),
      constantValue: '',
      targetKey: 'product.billingType'
    },
    {
      id: id(),
      sourceType: 'field',
      sourceKey: matchHeader(h, [
        '결제기간',
        '결제 기간',
        '주기수',
        '기간수',
        'billinginterval',
        'billing interval',
        '구독기간',
        '구독 기간',
        '계약기간',
        '계약 기간'
      ]),
      constantValue: '',
      targetKey: 'product.billingInterval'
    },
    {
      id: id(),
      sourceType: 'field',
      sourceKey: matchHeader(h, ['상태', 'status']),
      constantValue: '',
      targetKey: 'product.status'
    }
  ];

  for (const d of customFieldDefs || []) {
    if (!d?.key) continue;
    const label = (d.label || d.key || '').trim();
    const sk =
      matchHeader(h, [label, `커스텀_${d.key}`, d.key]) ||
      matchHeader(h, [`추가_${label}`]);
    rows.push({
      id: id(),
      sourceType: 'field',
      sourceKey: sk,
      constantValue: '',
      targetKey: `product.customFields.${d.key}`
    });
  }

  return rows;
}

/** 열 미연결 시 미리보기·등록용 가상 열 키 */
export function productPreviewCellKey(targetKey) {
  return `__preview:${String(targetKey || '').trim()}`;
}

export function isProductPreviewCellKey(key) {
  return String(key || '').startsWith('__preview:');
}

function getProductFieldExcelMapping(mappingRows, targetKey) {
  const row = (mappingRows || []).find((r) => String(r?.targetKey || '') === targetKey);
  if (!row) return { mode: 'missing' };
  if (row.sourceType === 'constant') {
    return { mode: 'constant', sourceKey: '', constantValue: String(row.constantValue ?? '').trim() };
  }
  return { mode: 'field', sourceKey: String(row.sourceKey ?? '').trim(), constantValue: '' };
}

const PRODUCT_HEADER_GUESS = {
  'product.name': ['제품명', 'name', 'productname', '제품', 'product'],
  'product.code': ['발주코드', '코드', 'code', 'uid', '제품코드', '제품 코드', 'sku'],
  'product.category': ['카테고리', 'category', '분류', '카테고리 분류', '카테고리분류', '분류명'],
  'product.version': ['버전', 'version', 'ver'],
  'product.listPrice': ['소비자가', 'listprice', 'list price', 'srp', 'dsrp', '가격', 'price', '판매가', 'msrp'],
  'product.costPrice': ['원가', 'cost', 'costprice', '매입가'],
  'product.channelPrice': ['제공가', '유통가', 'channel', 'channelprice', '유통 가격'],
  'product.consumerMargin': ['순마진', '순 마진', 'consumermargin', 'consumer margin', 'margin'],
  'product.channelMargin': ['유통시 순마진', '유통시 순 마진', '유통마진', 'channelmargin', 'channel margin'],
  'product.currency': ['통화', 'currency', 'cur'],
  'product.billingType': ['결제주기', 'billing', 'billingtype', 'billing type', '월간', '연간', '영구'],
  'product.billingInterval': ['결제기간', 'billinginterval', 'billing interval', '기간수', '계약기간', '계약 기간'],
  'product.status': ['상태', 'status']
};

export function guessProductExcelSourceKey(targetKey, headers, customFieldDefs = []) {
  const list = Array.isArray(headers) ? headers : [];
  const rules = PRODUCT_HEADER_GUESS[targetKey];
  if (rules) {
    const hit = matchHeader(list, rules);
    if (hit) return hit;
  }
  if (String(targetKey || '').startsWith('product.customFields.')) {
    const ck = targetKey.slice('product.customFields.'.length);
    const def = (customFieldDefs || []).find((d) => d?.key === ck);
    const label = String(def?.label || ck || '').trim();
    return matchHeader(list, [label, ck, `커스텀_${ck}`, `추가_${label}`].filter(Boolean));
  }
  return '';
}

function resolveProductExcelFieldColumnKey(headers, mapping, targetKey, customFieldDefs) {
  if (mapping?.mode === 'constant') return '';
  if (mapping?.mode === 'field' && mapping.sourceKey) return mapping.sourceKey;
  const guessed = guessProductExcelSourceKey(targetKey, headers, customFieldDefs);
  if (guessed) return guessed;
  if (mapping?.mode === 'field' || mapping?.mode === 'missing') return productPreviewCellKey(targetKey);
  return '';
}

/** 미리보기·등록 공통 — 대상 필드별 엑셀 열(또는 가상 열) 키 */
export function resolveProductFieldExcelKey(mappingRows, targetKey, excelHeaders = [], customFieldDefs = []) {
  const mapping = getProductFieldExcelMapping(mappingRows, targetKey);
  if (mapping.mode === 'constant') {
    return {
      mode: 'constant',
      excelKey: productPreviewCellKey(targetKey),
      constantValue: mapping.constantValue
    };
  }
  const hdrs = Array.isArray(excelHeaders) ? excelHeaders : [];
  const excelKey =
    resolveProductExcelFieldColumnKey(hdrs, mapping, targetKey, customFieldDefs) ||
    productPreviewCellKey(targetKey);
  return { mode: 'field', excelKey, constantValue: '' };
}

/** 미리보기 셀 원값 — 엑셀·가상열·필드 정의 수식 순 */
export function readProductExcelPreviewCellRaw(
  excelRow,
  mappingRows,
  targetKey,
  customDefinitions = [],
  excelHeaders = []
) {
  const hdrs =
    excelHeaders && excelHeaders.length
      ? excelHeaders
      : excelRow
        ? Object.keys(excelRow).filter((k) => k && !String(k).startsWith('__'))
        : [];
  const resolved = resolveProductFieldExcelKey(mappingRows, targetKey, hdrs, customDefinitions);
  if (resolved.mode === 'constant') return String(resolved.constantValue ?? '');

  let raw = readExcelMappedCell(excelRow, resolved.excelKey);
  if (raw != null && String(raw).trim() !== '') return String(raw);

  if (!isProductPreviewCellKey(resolved.excelKey)) {
    const previewRaw = readExcelMappedCell(excelRow, productPreviewCellKey(targetKey));
    if (previewRaw != null && String(previewRaw).trim() !== '') return String(previewRaw);
  }

  return getDefinitionFormulaDefaultDisplay(targetKey, customDefinitions);
}

function readMappedValue(excelRow, mappingRows, targetKey, customDefinitions = [], excelHeaders = []) {
  return readProductExcelPreviewCellRaw(excelRow, mappingRows, targetKey, customDefinitions, excelHeaders);
}

function readMapped(excelRow, mappingRows, targetKey, customDefinitions = [], excelHeaders = []) {
  const v = readMappedValue(excelRow, mappingRows, targetKey, customDefinitions, excelHeaders);
  if (v === '' || v == null) return '';
  return String(v).trim();
}

/** 엑셀·미리보기 문자열(₩, 원, 쉼표 등) 또는 숫자 셀 → API 금액 */
export function parsePriceNum(val) {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const s = String(val ?? '').trim();
  if (!s) return 0;
  if (isExcelFormulaInput(s)) return 0;
  return parseNumericFieldValueOrZero(s);
}

function formatPriceWhileTyping(raw) {
  const s = String(raw).replace(/,/g, '');
  if (s.trimStart().startsWith('=')) return String(raw);
  if (s === '') return '';
  if (s === '.') return '.';
  const dot = s.indexOf('.');
  const intRaw = dot === -1 ? s : s.slice(0, dot);
  const decRaw = dot === -1 ? '' : s.slice(dot + 1).replace(/\./g, '');
  if (!/^\d*$/.test(intRaw) || !/^\d*$/.test(decRaw)) {
    return formatPriceExcelInputDisplay(parsePriceNum(raw));
  }
  const intFmt = intRaw === '' ? '' : intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (dot === -1) return intFmt;
  return `${intFmt}.${decRaw}`;
}

/** 엑셀·미리보기 — 수식(=…) 문자열 여부 */
export function isExcelFormulaInput(raw) {
  return parseFormulaInput(raw).isFormula;
}

/** 미리보기·입력 표시 — 수식은 그대로, 숫자는 기호 제거·쉼표 */
export function formatFormulaCapableExcelInputDisplay(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (isExcelFormulaInput(s)) return s;
  if (s.trimStart().startsWith('=')) return String(raw ?? '').trimStart();
  return formatPriceExcelInputDisplay(raw);
}

/** 입력 중 — 수식은 유지, 숫자만 sanitize */
export function sanitizeFormulaCapableExcelInput(raw) {
  const s = String(raw ?? '');
  if (isExcelFormulaInput(s)) return s;
  if (s.trimStart().startsWith('=')) return s;
  return sanitizePriceExcelInput(raw);
}

/** 미리보기·입력 표시 — 기호(₩$원 등) 제거, 천 단위 쉼표 유지 */
export function formatPriceExcelInputDisplay(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (isExcelFormulaInput(s)) return s;
  if (!/\d/.test(s)) return s;
  const n = parsePriceNum(raw);
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0
  });
}

/** 입력 중 — 숫자·쉼표·소수점만 남기고 쉼표 포맷 */
export function sanitizePriceExcelInput(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (isExcelFormulaInput(s)) return s;
  if (s.trimStart().startsWith('=')) return String(raw ?? '');
  const digitsOnly = s.replace(/,/g, '').replace(/[^\d.]/g, '');
  return formatPriceWhileTyping(digitsOnly);
}

/**
 * 엑셀 통화 문자열 → ISO 코드
 * @param {string} raw
 * @param {{ allowedCodes?: Set<string>|null }} [opts] Exim dealBasR 기준 허용 통화 (KRW 포함)
 * @returns {{ code: string, recognized: boolean, empty: boolean }}
 */
export function resolveCurrencyCode(raw, opts = {}) {
  const { allowedCodes = null } = opts;
  const selectOptions = resolveCurrencySelectOptions(allowedCodes);
  const codeSet = resolveCurrencyCodeSet(allowedCodes);
  const s = String(raw ?? '').trim();
  if (!s) return { code: 'KRW', recognized: true, empty: true };

  const u = s.toUpperCase();
  if (codeSet.has(u)) {
    return { code: u, recognized: true, empty: false };
  }

  if (u === 'WON' || s.includes('원화') || (s.includes('원') && !s.includes('달러'))) {
    return codeSet.has('KRW')
      ? { code: 'KRW', recognized: true, empty: false }
      : { code: 'KRW', recognized: false, empty: false };
  }
  if (u === '$' || u === 'US$' || u === 'USD' || (s.includes('달러') && s.includes('미국'))) {
    return codeSet.has('USD')
      ? { code: 'USD', recognized: true, empty: false }
      : { code: 'USD', recognized: false, empty: false };
  }
  if (u === '€' || u === 'EUR' || s.includes('유로')) {
    return codeSet.has('EUR')
      ? { code: 'EUR', recognized: true, empty: false }
      : { code: 'EUR', recognized: false, empty: false };
  }
  if (s.includes('엔') || (u === '¥' && s.includes('일본'))) {
    return codeSet.has('JPY')
      ? { code: 'JPY', recognized: true, empty: false }
      : { code: 'JPY', recognized: false, empty: false };
  }
  if (s.includes('위안') || (u === '¥' && s.includes('중국'))) {
    return codeSet.has('CNY')
      ? { code: 'CNY', recognized: true, empty: false }
      : { code: 'CNY', recognized: false, empty: false };
  }
  if (u === '£' || u === 'GBP' || s.includes('파운드')) {
    return codeSet.has('GBP')
      ? { code: 'GBP', recognized: true, empty: false }
      : { code: 'GBP', recognized: false, empty: false };
  }

  for (const opt of selectOptions) {
    if (u.includes(opt.value)) {
      return { code: opt.value, recognized: true, empty: false };
    }
    const meta = getCurrencyMeta(opt.value);
    if (meta.currencyName && s.includes(meta.currencyName)) {
      return { code: opt.value, recognized: true, empty: false };
    }
    if (meta.symbol && meta.symbol.length <= 3 && s.includes(meta.symbol)) {
      return { code: opt.value, recognized: true, empty: false };
    }
  }

  return { code: 'KRW', recognized: false, empty: false };
}

/** 매핑 미리보기 — 가격·통화 필드 포맷 */
export function previewProductMappedValue(sampleRow, mappingRow) {
  const raw = previewExcelMappedValue(sampleRow, mappingRow);
  const tk = String(mappingRow?.targetKey || '');
  if (PRODUCT_PRICE_TARGET_KEYS.has(tk)) {
    const formatted = formatFormulaCapableExcelInputDisplay(raw);
    return formatted || raw || '';
  }
  if (tk === 'product.currency') {
    if (!raw || !String(raw).trim()) return '';
    const { code, recognized } = resolveCurrencyCode(raw);
    return recognized ? getCurrencySelectLabel(code) : String(raw);
  }
  return raw;
}

export function normalizeBilling(raw) {
  const parsed = parseProductBillingValue(raw);
  return parsed?.billingType || 'Monthly';
}

/**
 * 엑셀 결제 주기 통합 파서 — 1Y·2Y·1M·P, 1년·3개월·1달·영구, 연간×3, Monthly/Annual 등
 * @returns {{ billingType: string, billingInterval: number } | null}
 */
export function parseProductBillingValue(raw, intervalRaw) {
  const s = String(raw ?? '').trim();
  const ivS = intervalRaw != null ? String(intervalRaw).trim() : '';

  if (!s && !ivS) return { billingType: 'Monthly', billingInterval: 1 };

  if (/^(p|perpetual|영구)$/i.test(s)) {
    return { billingType: 'Perpetual', billingInterval: 1 };
  }

  let m =
    s.match(/^(\d+)\s*[yY](?:\b|$|[^a-zA-Z가-힣])/i) ||
    s.match(/^(\d+)\s*년$/i) ||
    s.match(/^(\d+)\s*년\s*$/i);
  if (m) {
    return {
      billingType: 'Annual',
      billingInterval: parseBillingIntervalInput(m[1], 'Annual')
    };
  }

  m =
    s.match(/^(\d+)\s*[mM](?:\b|$|[^a-zA-Z가-힣])/i) ||
    s.match(/^(\d+)\s*(?:개월|달)$/i);
  if (m) {
    return {
      billingType: 'Monthly',
      billingInterval: parseBillingIntervalInput(m[1], 'Monthly')
    };
  }

  if (/^[yY년]$/.test(s) || s === '연' || s === '연간') {
    const iv = ivS ? parseBillingIntervalInput(ivS, 'Annual') : 1;
    return { billingType: 'Annual', billingInterval: iv };
  }
  if (/^[mM]$/.test(s) || s === '월' || s === '월간') {
    const iv = ivS ? parseBillingIntervalInput(ivS, 'Monthly') : 1;
    return { billingType: 'Monthly', billingInterval: iv };
  }

  if (['Monthly', 'Annual', 'Perpetual'].includes(s) || BILLING_KO[s]) {
    const bt = ['Monthly', 'Annual', 'Perpetual'].includes(s) ? s : BILLING_KO[s];
    const iv =
      bt === 'Perpetual'
        ? 1
        : ivS
          ? parseBillingIntervalInput(ivS, bt)
          : 1;
    return { billingType: bt, billingInterval: iv };
  }

  const sl = s.toLowerCase();
  if (sl.includes('영') || sl.includes('perpet')) {
    return { billingType: 'Perpetual', billingInterval: 1 };
  }

  const multMatch = s.match(/[×xX*]\s*(\d+)/);
  if (multMatch) {
    const bt = sl.includes('월') ? 'Monthly' : sl.includes('연') || sl.includes('년') ? 'Annual' : 'Annual';
    return {
      billingType: bt,
      billingInterval: parseBillingIntervalInput(multMatch[1], bt)
    };
  }

  if (sl.includes('월') || sl.includes('개월') || sl.includes('달')) {
    const numM = s.match(/(\d+)/);
    const iv = ivS
      ? parseBillingIntervalInput(ivS, 'Monthly')
      : numM
        ? parseBillingIntervalInput(numM[1], 'Monthly')
        : 1;
    return { billingType: 'Monthly', billingInterval: iv };
  }
  if (sl.includes('연') || sl.includes('년')) {
    const numY = s.match(/(\d+)/);
    const iv = ivS
      ? parseBillingIntervalInput(ivS, 'Annual')
      : numY
        ? parseBillingIntervalInput(numY[1], 'Annual')
        : 1;
    return { billingType: 'Annual', billingInterval: iv };
  }

  if (ivS) {
    const bt = sl.includes('연') || sl.includes('년') ? 'Annual' : sl.includes('월') ? 'Monthly' : 'Monthly';
    return { billingType: bt, billingInterval: parseBillingIntervalInput(ivS, bt) };
  }

  if (!s) return { billingType: 'Monthly', billingInterval: 1 };
  return null;
}

/** 결제 주기 열에 「연간×3」「3년」「1Y」 등이 함께 적힌 경우 분리 */
export function parseBillingFromExcel(raw) {
  const parsed = parseProductBillingValue(raw);
  return parsed || { billingType: 'Monthly', billingInterval: 1 };
}

/** 미리보기·등록용 한글 표시 — 1Y→1년, 1M→1개월, P→영구 */
export function formatBillingPreviewCellValue(billingType, billingInterval = 1) {
  const iv = normalizeBillingInterval(billingType, billingInterval);
  if (billingType === 'Perpetual') return '영구';
  if (billingType === 'Annual') return `${iv}년`;
  if (billingType === 'Monthly') return `${iv}개월`;
  return '';
}

/** 미리보기 진입 시 결제 주기 열을 한글(1년·1개월·영구)로 정규화 */
function normalizeExcelRowsPricesAndCurrencyForPreview(
  excelRows,
  mappingRows,
  allowedCodes = null,
  customDefinitions = []
) {
  const currencyKey = resolveProductExcelColumnKey(mappingRows, 'product.currency');
  const priceTargets = [
    'product.listPrice',
    'product.costPrice',
    'product.channelPrice',
    'product.consumerMargin',
    'product.channelMargin'
  ];
  const numericCustomTargets = (customDefinitions || [])
    .filter((d) => d?.key && (d.type === 'number' || d.type === 'formula'))
    .map((d) => `${PRODUCT_CUSTOM_FIELD_TARGET_PREFIX}${d.key}`);
  const currencyOpts = allowedCodes ? { allowedCodes } : {};

  return (excelRows || []).map((row) => {
    const next = { ...row };
    for (const target of [...priceTargets, ...numericCustomTargets]) {
      const colKey = resolveProductExcelColumnKey(mappingRows, target);
      if (!colKey) continue;
      const h = resolveExcelRowHeaderKey(row, colKey) || colKey;
      const raw = next[h];
      if (raw != null && String(raw).trim() !== '') {
        next[h] = formatFormulaCapableExcelInputDisplay(raw);
      }
    }
    if (currencyKey) {
      const h = resolveExcelRowHeaderKey(row, currencyKey) || currencyKey;
      const raw = next[h];
      if (raw != null && String(raw).trim() !== '') {
        const { code, recognized } = resolveCurrencyCode(raw, currencyOpts);
        if (recognized) next[h] = code;
      }
    }
    return next;
  });
}

export function normalizeExcelRowsBillingForPreview(
  excelRows,
  mappingRows,
  allowedCodes = null,
  customDefinitions = []
) {
  const billingKey = resolveProductExcelColumnKey(mappingRows, 'product.billingType');
  const baseRows = (excelRows || []).map((r) => ({ ...r }));
  const intervalKey = resolveProductExcelColumnKey(mappingRows, 'product.billingInterval');

  const billingNormalized = !billingKey
    ? baseRows
    : baseRows.map((row) => {
        const next = { ...row };
        const bKey = resolveExcelRowHeaderKey(row, billingKey) || billingKey;
        const billingRaw = String(next[bKey] ?? '').trim();
        const iKey = intervalKey ? resolveExcelRowHeaderKey(row, intervalKey) || intervalKey : '';
        const intervalRaw = iKey ? String(next[iKey] ?? '').trim() : '';

        const parsed = parseProductBillingValue(billingRaw, intervalRaw);
        if (!parsed) return next;

        if (intervalKey) {
          next[bKey] =
            parsed.billingType === 'Perpetual' ? '영구' : parsed.billingType === 'Annual' ? '연간' : '월간';
          next[iKey] = parsed.billingType === 'Perpetual' ? '' : String(parsed.billingInterval);
        } else {
          next[bKey] = formatBillingPreviewCellValue(parsed.billingType, parsed.billingInterval);
        }
        return next;
      });

  return normalizeExcelRowsPricesAndCurrencyForPreview(
    billingNormalized,
    mappingRows,
    allowedCodes,
    customDefinitions
  );
}

export function billingIntervalCellIsValid(raw, billingTypeHint = 'Monthly') {
  const s = String(raw ?? '').trim();
  if (!s) return true;
  const parsed = parseProductBillingValue(billingTypeHint, s);
  if (!parsed) return false;
  if (parsed.billingType === 'Perpetual') return true;
  const n = parseBillingIntervalInput(s, parsed.billingType);
  return Number.isFinite(n) && n >= 1 && n <= 99;
}

export function billingPeriodCellIsValid(raw, intervalRaw = '', hasIntervalColumn = false) {
  const s = String(raw ?? '').trim();
  const iv = hasIntervalColumn ? String(intervalRaw ?? '').trim() : '';
  if (!s && !iv) return true;
  return parseProductBillingValue(s, hasIntervalColumn ? iv : '') !== null;
}

/** 미리보기 셀렉트 옵션 — 1개월~24개월, 1년~10년, 영구 */
export function buildBillingPeriodPreviewOptions() {
  const opts = [];
  for (let i = 1; i <= 24; i += 1) {
    opts.push({ value: `${i}개월`, label: `${i}개월 (${i}M)` });
  }
  for (let i = 1; i <= 10; i += 1) {
    opts.push({ value: `${i}년`, label: `${i}년 (${i}Y)` });
  }
  opts.push({ value: '영구', label: '영구 (P)' });
  return opts;
}

export function normalizeStatus(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'Active';
  if (['Active', 'EndOfLife', 'Draft'].includes(s)) return s;
  const ko = STATUS_KO[s.toLowerCase()];
  if (ko) return ko;
  const sl = s.toLowerCase();
  if (sl.includes('eol') || sl.includes('end')) return 'EndOfLife';
  if (sl.includes('draft') || sl.includes('초안')) return 'Draft';
  if (sl.includes('active') || sl.includes('활성')) return 'Active';
  return 'Active';
}

export function normalizeCurrency(raw, allowedCodes = null) {
  return resolveCurrencyCode(raw, allowedCodes ? { allowedCodes } : {}).code;
}

function readExcelRowCustomFields(excelRow, mappingRows, customDefinitions = [], excelHeaders = []) {
  const customFields = {};
  const keys = new Set();
  for (const d of customDefinitions || []) {
    if (d?.key) keys.add(d.key);
  }
  for (const r of mappingRows || []) {
    const tk = String(r?.targetKey || '');
    if (!tk.startsWith(PRODUCT_CUSTOM_FIELD_TARGET_PREFIX)) continue;
    keys.add(tk.slice(PRODUCT_CUSTOM_FIELD_TARGET_PREFIX.length));
  }
  for (const ck of keys) {
    const tk = `${PRODUCT_CUSTOM_FIELD_TARGET_PREFIX}${ck}`;
    const val = readMapped(excelRow, mappingRows, tk, customDefinitions, excelHeaders);
    if (val !== '') customFields[ck] = val;
  }
  return customFields;
}

/** 수식 계산용 customFields — formula 셀 =… 제외, number만 숫자화(text 등은 원문 유지) */
function customFieldsForFormulaContext(rawCustomFields = {}, customDefinitions = []) {
  return normalizeCustomFieldsForFormula(rawCustomFields, customDefinitions);
}

function buildProductExcelCustomFormulaContext(resolvedProduct, customFieldsInput, exchangeCtx, customDefinitions) {
  const fxBuiltIn = exchangeCtx
    ? buildExchangeRateFormulaBuiltin(
        exchangeCtx.usdSummary,
        exchangeCtx.dealBasRMap,
        resolvedProduct?.currency,
        { profile: exchangeCtx.pricingProfile }
      )
    : {};
  const rawBuiltIn = {
    listPrice: resolvedProduct?.listPrice ?? 0,
    price: resolvedProduct?.price ?? resolvedProduct?.listPrice ?? 0,
    costPrice: resolvedProduct?.costPrice ?? 0,
    channelPrice: resolvedProduct?.channelPrice ?? 0,
    consumerMargin: resolvedProduct?.consumerMargin ?? 0,
    channelMargin: resolvedProduct?.channelMargin ?? 0,
    ...fxBuiltIn
  };
  return {
    entityType: 'product',
    definitions: customDefinitions || [],
    builtIn: normalizeFormulaBuiltInNumbers(rawBuiltIn),
    customFields: normalizeCustomFieldsForFormula(customFieldsInput || {}, customDefinitions)
  };
}

function resolveProductExcelCustomFields(
  excelRow,
  mappingRows,
  resolvedProduct,
  rawCustomFields,
  exchangeCtx,
  customDefinitions,
  excelHeaders
) {
  const manual = customFieldsForFormulaContext(rawCustomFields, customDefinitions);
  const ctx = buildProductExcelCustomFormulaContext(
    resolvedProduct,
    manual,
    exchangeCtx,
    customDefinitions
  );
  const fieldTypes = {};
  for (const d of customDefinitions || []) {
    if (d?.key) fieldTypes[d.key] = d.type;
  }
  const formulaEvalCtx = (computed) => ({
    ...ctx,
    computedFormulas: computed,
    fieldTypes,
    definitions: customDefinitions
  });

  let computed = computeCustomFieldFormulas(customDefinitions, ctx);

  for (const def of customDefinitions || []) {
    if (def?.type !== 'formula' || !def.key) continue;
    const tk = `${PRODUCT_CUSTOM_FIELD_TARGET_PREFIX}${def.key}`;
    const cellRaw = readMapped(excelRow, mappingRows, tk, customDefinitions, excelHeaders);
    const parsed = parseFormulaInput(cellRaw);
    if (!parsed.isFormula || !parsed.expression) continue;
    const val = evaluateFormulaExpression(parsed.expression, formulaEvalCtx(computed));
    if (val != null && Number.isFinite(Number(val))) {
      computed[def.key] = Number(val);
    }
  }

  const formulaDefs = (customDefinitions || []).filter(
    (d) => d?.type === 'formula' && d?.options?.expression
  );
  const maxPass = formulaDefs.length + 2;
  for (let pass = 0; pass < maxPass; pass += 1) {
    let changed = false;
    for (const def of formulaDefs) {
      const tk = `${PRODUCT_CUSTOM_FIELD_TARGET_PREFIX}${def.key}`;
      const cellRaw = readMapped(excelRow, mappingRows, tk, customDefinitions, excelHeaders);
      if (parseFormulaInput(cellRaw).isFormula) continue;
      const val = evaluateFormulaExpression(def.options.expression, formulaEvalCtx(computed));
      if (val == null || !Number.isFinite(Number(val))) continue;
      if (computed[def.key] !== val) {
        computed[def.key] = val;
        changed = true;
      }
    }
    if (!changed) break;
  }

  const merged = { ...(rawCustomFields || {}) };
  for (const def of customDefinitions || []) {
    if (def?.type === 'formula' && def.key) delete merged[def.key];
  }
  for (const [key, val] of Object.entries(computed)) {
    if (val == null || !Number.isFinite(Number(val))) continue;
    merged[key] = val;
  }
  for (const def of customDefinitions || []) {
    if (def?.type !== 'number' || !def.key) continue;
    if (merged[def.key] == null || merged[def.key] === '') continue;
    const n = parseNumericFieldValue(merged[def.key], { fieldType: 'number', rejectFormula: true });
    if (n != null) merged[def.key] = n;
  }
  return merged;
}

function readExcelRowFormulaInputs(excelRow, mappingRows, customDefinitions = [], excelHeaders = []) {
  const readInput = (targetKey) =>
    readMapped(excelRow, mappingRows, targetKey, customDefinitions, excelHeaders);
  return {
    name: readInput('product.name'),
    code: readInput('product.code'),
    version: readInput('product.version'),
    category: readInput('product.category'),
    listPrice: readInput('product.listPrice'),
    costPrice: readInput('product.costPrice'),
    channelPrice: readInput('product.channelPrice'),
    consumerMargin: readInput('product.consumerMargin'),
    channelMargin: readInput('product.channelMargin'),
    billingInterval: readInput('product.billingInterval') || '1',
    customFields: readExcelRowCustomFields(excelRow, mappingRows, customDefinitions, excelHeaders)
  };
}

/** 미리보기 — 행 단위 수식 재계산 결과 */
export function resolveProductExcelRow(excelRow, mappingRows, exchangeCtx = null, customDefinitions = [], opts = {}) {
  const { allowedCodes = null } = opts;
  const excelHeaders = excelRow ? Object.keys(excelRow).filter((k) => k && !String(k).startsWith('__')) : [];
  const inputs = readExcelRowFormulaInputs(excelRow, mappingRows, customDefinitions, excelHeaders);
  const currency = normalizeCurrency(
    readMapped(excelRow, mappingRows, 'product.currency', customDefinitions, excelHeaders),
    allowedCodes
  );
  const draft = buildLiveProductDraft({
    nameInput: inputs.name,
    codeInput: inputs.code,
    versionInput: inputs.version,
    categoryKey: 'other',
    categoryOther: inputs.category,
    listPriceInput: inputs.listPrice,
    costPriceInput: inputs.costPrice,
    channelPriceInput: inputs.channelPrice,
    consumerMarginInput: inputs.consumerMargin,
    channelMarginInput: inputs.channelMargin,
    billingIntervalInput: inputs.billingInterval,
    currency,
    customFields: inputs.customFields,
    parsePriceInput: parsePriceNum
  });
  let resolved = resolveProductFieldValues(draft, exchangeCtx, customDefinitions);
  let customFields = resolveProductExcelCustomFields(
    excelRow,
    mappingRows,
    { ...resolved, currency },
    inputs.customFields,
    exchangeCtx,
    customDefinitions,
    excelHeaders
  );

  const formulaDefCount = (customDefinitions || []).filter((d) => d?.type === 'formula').length;
  const builtinFormulaCount = Object.keys(draft.fieldFormulas || {}).length;
  const maxPass = formulaDefCount + builtinFormulaCount + 8;

  function snapshot() {
    return JSON.stringify({
      listPrice: resolved.listPrice,
      costPrice: resolved.costPrice,
      channelPrice: resolved.channelPrice,
      consumerMargin: resolved.consumerMargin,
      channelMargin: resolved.channelMargin,
      customFields
    });
  }

  for (let pass = 0; pass < maxPass; pass += 1) {
    const prev = snapshot();
    resolved = resolveProductFieldValues(
      { ...draft, customFields: { ...inputs.customFields, ...customFields } },
      exchangeCtx,
      customDefinitions,
      { computedCustomFields: customFields }
    );
    customFields = resolveProductExcelCustomFields(
      excelRow,
      mappingRows,
      { ...resolved, currency },
      inputs.customFields,
      exchangeCtx,
      customDefinitions,
      excelHeaders
    );
    if (snapshot() === prev) break;
  }

  return { ...resolved, currency, customFields };
}

export function formatResolvedExcelFormulaPreview(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 4, minimumFractionDigits: 0 });
}

/**
 * 엑셀 미리보기 — 셀 인식값(등록·함수 계산과 동일 기준)
 * @returns {string|null} null이면 미리보기 줄 숨김
 */
export function resolveExcelCellResolvedPreview(cellRaw, col, rowResolved = {}, customDefinitions = []) {
  const raw = String(cellRaw ?? '').trim();
  if (!raw) return null;

  const tk = col?.targetKey;
  const builtInKey = PRODUCT_FORMULA_TARGET_TO_FIELD[tk];
  if (builtInKey) {
    if (isExcelFormulaInput(raw)) {
      return formatResolvedExcelFormulaPreview(rowResolved?.[builtInKey]);
    }
    return formatResolvedExcelFormulaPreview(parsePriceNum(cellRaw));
  }

  const customKey = productCustomFieldKeyFromTarget(tk);
  if (!customKey) return null;

  const def = productCustomFieldDefFromTarget(tk, customDefinitions);
  if (!def) return null;

  if (def.type === 'formula') {
    if (isExcelFormulaInput(raw)) {
      return formatResolvedExcelFormulaPreview(rowResolved?.customFields?.[customKey]);
    }
    return formatResolvedExcelFormulaPreview(
      parseNumericFieldValue(cellRaw, { fieldType: 'number', rejectFormula: true })
    );
  }

  if (def.type === 'number') {
    return formatResolvedExcelFormulaPreview(
      parseNumericFieldValue(cellRaw, { fieldType: 'number', rejectFormula: true })
    );
  }

  return null;
}

/**
 * 매핑 행 + 엑셀 한 줄 → POST /products body (fieldFormulas·마진 스냅샷 포함)
 * @param {{ allowedCodes?: Set<string>|null, exchangeCtx?: object|null, customDefinitions?: Array }} [opts]
 */
export function excelRowToProductBody(excelRow, mappingRows, opts = {}) {
  const { allowedCodes = null, exchangeCtx = null, customDefinitions = [] } = opts;
  const excelHeaders = excelRow ? Object.keys(excelRow).filter((k) => k && !String(k).startsWith('__')) : [];
  const inputs = readExcelRowFormulaInputs(excelRow, mappingRows, customDefinitions, excelHeaders);
  const currency = normalizeCurrency(
    readMapped(excelRow, mappingRows, 'product.currency', customDefinitions, excelHeaders),
    allowedCodes
  );

  const payload = buildProductFieldPayload({
    inputs: {
      name: inputs.name,
      code: inputs.code,
      version: inputs.version,
      listPrice: inputs.listPrice,
      costPrice: inputs.costPrice,
      channelPrice: inputs.channelPrice,
      consumerMargin: inputs.consumerMargin,
      channelMargin: inputs.channelMargin,
      billingInterval: inputs.billingInterval,
      customFields: inputs.customFields
    },
    categoryKey: 'other',
    categoryOther: inputs.category,
    currency,
    definitions: customDefinitions,
    exchangeCtx,
    parsePriceInput: parsePriceNum
  });

  if (!payload.ok) {
    return {
      __formulaError: payload.error || '수식 또는 금액 입력을 확인해 주세요.',
      name: String(inputs.name || '').trim()
    };
  }

  const billingRaw = readMapped(excelRow, mappingRows, 'product.billingType', customDefinitions, excelHeaders);
  const intervalRaw = readMapped(excelRow, mappingRows, 'product.billingInterval', customDefinitions, excelHeaders);
  const parsed = parseProductBillingValue(billingRaw, intervalRaw);
  const billingType = parsed?.billingType || 'Monthly';
  const billingInterval = parsed?.billingInterval ?? payload.body.billingInterval ?? 1;

  const resolvedRow = resolveProductExcelRow(excelRow, mappingRows, exchangeCtx, customDefinitions, {
    allowedCodes
  });
  const resolvedCustomRaw =
    resolvedRow?.customFields && typeof resolvedRow.customFields === 'object'
      ? resolvedRow.customFields
      : {};
  const resolvedCustom = normalizeCustomFieldsForApiSave(resolvedCustomRaw, customDefinitions);

  return {
    ...payload.body,
    fieldFormulas: payload.body.fieldFormulas || {},
    listPrice: resolvedRow.listPrice,
    price: resolvedRow.listPrice,
    costPrice: resolvedRow.costPrice,
    channelPrice: resolvedRow.channelPrice,
    consumerMargin: resolvedRow.consumerMargin,
    channelMargin: resolvedRow.channelMargin,
    billingInterval: resolvedRow.billingInterval ?? payload.body.billingInterval,
    currency,
    billingType,
    billingInterval,
    status: normalizeStatus(readMapped(excelRow, mappingRows, 'product.status', customDefinitions, excelHeaders)),
    customFields: Object.keys(resolvedCustom).length ? resolvedCustom : undefined
  };
}

export function isExcelRowEffectivelyEmpty(excelRow) {
  if (!excelRow || typeof excelRow !== 'object') return true;
  return !Object.values(excelRow).some((v) => v != null && String(v).trim() !== '');
}

/** 미리보기 표 — CRM 매핑 가능 필드 전부(미연결 포함), 헤더는 CRM 라벨 */
export function buildProductExcelPreviewColumns(mappingRows, targetOptions, excelHeaders = [], customFieldDefs = []) {
  const labelMap = new Map();
  for (const o of targetOptions || []) {
    if (o?.value) labelMap.set(o.value, o.label || o.value);
  }
  const hdrs = Array.isArray(excelHeaders) ? excelHeaders : [];
  const seenTargets = new Set();
  const cols = [];
  const optionTargets = (targetOptions || []).map((o) => String(o?.value ?? '').trim()).filter(Boolean);
  const targets = optionTargets.length
    ? optionTargets
    : (mappingRows || [])
        .filter((r) => r?.sourceType !== 'constant')
        .map((r) => String(r?.targetKey ?? '').trim())
        .filter(Boolean);

  for (const targetKey of targets) {
    if (!targetKey || seenTargets.has(targetKey)) continue;
    seenTargets.add(targetKey);

    const resolved = resolveProductFieldExcelKey(mappingRows, targetKey, hdrs, customFieldDefs);
    if (resolved.mode === 'constant') {
      cols.push({
        targetKey,
        excelKey: resolved.excelKey,
        label: labelMap.get(targetKey) || targetKey,
        excelTitle: `고정값 (${resolved.constantValue ?? ''})`,
        isConstant: true,
        constantValue: String(resolved.constantValue ?? '')
      });
      continue;
    }

    const excelKey = resolved.excelKey;
    cols.push({
      targetKey,
      excelKey,
      label: labelMap.get(targetKey) || targetKey,
      excelTitle: isProductPreviewCellKey(excelKey)
        ? '열 미연결 · 미리보기에서 직접 입력'
        : excelKey,
      isPreviewOnly: isProductPreviewCellKey(excelKey)
    });
  }
  return cols;
}

/** 매핑 행 → 엑셀 원본 열 키 (고정값 매핑이면 빈 문자열) */
export function resolveProductExcelColumnKey(mappingRows, targetKey) {
  const m = (mappingRows || []).find((r) => String(r?.targetKey || '') === targetKey);
  if (!m || m.sourceType === 'constant') return '';
  return m.sourceKey || '';
}

/** 매핑 + 파일 준비 여부 (미리보기 진입) */
export function productMappingCanProceed(mappingRows, excelRows) {
  if (!Array.isArray(excelRows) || excelRows.length === 0) return false;
  const nameRow = (mappingRows || []).find((r) => r.targetKey === 'product.name');
  if (!nameRow) return false;
  if (nameRow.sourceType === 'constant') {
    return String(nameRow.constantValue ?? '').trim() !== '';
  }
  return !!nameRow.sourceKey;
}

/** 미리보기 표 헤더 — 행 객체 키 합집합 */
export function collectProductExcelDraftHeaders(rows) {
  const keys = new Set();
  for (const r of (rows || []).slice(0, 80)) {
    if (!r || typeof r !== 'object') continue;
    Object.keys(r).forEach((k) => {
      if (k !== '__rowNum__') keys.add(k);
    });
  }
  return Array.from(keys);
}

function billingCellIsValid(raw, intervalRaw = '', hasIntervalColumn = false) {
  return billingPeriodCellIsValid(raw, intervalRaw, hasIntervalColumn);
}

function statusCellIsValid(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return true;
  if (['Active', 'EndOfLife', 'Draft'].includes(s)) return true;
  const sl = s.toLowerCase();
  if (STATUS_KO[sl]) return true;
  if (sl.includes('eol') || sl.includes('end')) return true;
  if (sl.includes('draft') || sl.includes('초안')) return true;
  if (sl.includes('active') || sl.includes('활성')) return true;
  return false;
}

function currencyCellIsValid(raw, allowedCodes = null) {
  const r = resolveCurrencyCode(raw, allowedCodes ? { allowedCodes } : {});
  if (r.empty) return true;
  return r.recognized;
}

/** 미리보기 — 붉은 칸(등록 전 수정 필요) 건수 */
export function countInvalidProductExcelDraftCells(
  rows,
  { nameColumnKey, billingColumnKey, billingIntervalColumnKey, statusColumnKey, currencyColumnKey, allowedCodes = null }
) {
  let nameMissing = 0;
  let billing = 0;
  let billingInterval = 0;
  let status = 0;
  let currency = 0;
  for (const row of rows || []) {
    if (isExcelRowEffectivelyEmpty(row)) continue;
    if (nameColumnKey) {
      const name = readExcelMappedCell(row, nameColumnKey);
      if (!String(name).trim()) nameMissing += 1;
    }
    const billingRaw = billingColumnKey ? readExcelMappedCell(row, billingColumnKey) : '';
    const intervalCellRaw = billingIntervalColumnKey
      ? readExcelMappedCell(row, billingIntervalColumnKey)
      : '';
    const hasIntervalColumn = Boolean(billingIntervalColumnKey);
    if (billingColumnKey && !billingCellIsValid(billingRaw, intervalCellRaw, hasIntervalColumn)) billing += 1;
    if (
      billingIntervalColumnKey &&
      !billingIntervalCellIsValid(readExcelMappedCell(row, billingIntervalColumnKey), billingRaw)
    ) {
      billingInterval += 1;
    }
    if (statusColumnKey && !statusCellIsValid(readExcelMappedCell(row, statusColumnKey))) status += 1;
    if (currencyColumnKey && !currencyCellIsValid(readExcelMappedCell(row, currencyColumnKey), allowedCodes)) currency += 1;
  }
  return {
    total: nameMissing + billing + billingInterval + status + currency,
    nameMissing,
    billing,
    billingInterval,
    status,
    currency
  };
}

export const PRODUCT_BILLING_PREVIEW_OPTIONS = [
  { value: 'Monthly', label: '월간 (Monthly)' },
  { value: 'Annual', label: '연간 (Annual)' },
  { value: 'Perpetual', label: '영구 (Perpetual)' }
];

export const PRODUCT_STATUS_PREVIEW_OPTIONS = [
  { value: 'Active', label: '활성 (Active)' },
  { value: 'EndOfLife', label: 'End of Life' },
  { value: 'Draft', label: '초안 (Draft)' }
];

/** @deprecated buildEximAvailableCurrencyPreviewOptions(dealBasRMap) 사용 */
export const PRODUCT_CURRENCY_PREVIEW_OPTIONS = PRODUCT_CURRENCY_SELECT_OPTIONS.map((opt) => ({
  value: opt.value,
  label: opt.label
}));

/** 매핑 행 상태 (import-mapping UI) */
export function productRowStatus(row, preview) {
  if (!row?.targetKey) return { type: 'err', label: '대상 없음' };
  if (row.sourceType === 'constant') {
    return row.constantValue != null && String(row.constantValue).trim() !== ''
      ? { type: 'ok', label: 'VALID' }
      : { type: 'warn', label: '값 입력' };
  }
  if (!row.sourceKey) {
    if (PRODUCT_REQUIRED_TARGETS.has(row.targetKey)) return { type: 'warn', label: '필수' };
    return { type: 'warn', label: '소스 선택' };
  }
  const empty = !preview || String(preview).trim() === '';
  if (empty) {
    if (PRODUCT_REQUIRED_TARGETS.has(row.targetKey)) return { type: 'warn', label: '필수' };
    return { type: 'muted', label: '빈 값' };
  }
  return { type: 'ok', label: 'VALID' };
}

/**
 * 단일 엑셀 행(헤더→값 객체) → add-product-modal 초기값용 (휴리스틱, 매핑 행과 동일 규칙)
 */
export function excelObjectToProductFormDraft(rowObj, customFieldDefs = []) {
  const headers = Object.keys(rowObj || {});
  const rows = createInitialProductMappingRows(headers, customFieldDefs);
  const body = excelRowToProductBody(rowObj, rows);
  return {
    form: {
      name: body.name || '',
      code: body.code || '',
      version: body.version || '',
      currency: body.currency || 'KRW',
      billingType: body.billingType || 'Monthly',
      billingInterval: body.billingInterval ?? 1,
      status: body.status || 'Active',
      customFields: body.customFields && typeof body.customFields === 'object' ? { ...body.customFields } : {}
    },
    fieldFormulas: body.fieldFormulas && typeof body.fieldFormulas === 'object' ? { ...body.fieldFormulas } : {},
    listPrice: body.listPrice || 0,
    costPrice: body.costPrice || 0,
    channelPrice: body.channelPrice || 0,
    consumerMargin: body.consumerMargin,
    channelMargin: body.channelMargin,
    categoryRaw: body.category || ''
  };
}

/** 엑셀 셀 — 화면에 보이는 문자열(cell.w) 우선 (원가·유통가 환산 소수 등 내부값과 표시값 불일치 방지) */
function excelCellDisplayValue(cell) {
  if (!cell) return '';
  if (cell.w != null && String(cell.w).trim() !== '') return String(cell.w);
  if (cell.v == null) return '';
  return String(cell.v);
}

/** 시트 → 행 배열 (헤더=첫 행, 값=엑셀 표시 문자열) */
export function sheetToExcelDisplayRows(sheet) {
  const ref = sheet?.['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const headerRow = range.s.r;
  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c })];
    headers[c] = excelCellDisplayValue(cell).trim();
  }

  const rows = [];
  for (let r = headerRow + 1; r <= range.e.r; r += 1) {
    const row = {};
    let hasValue = false;
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const key = headers[c];
      if (!key) continue;
      const val = excelCellDisplayValue(sheet[XLSX.utils.encode_cell({ r, c })]);
      if (val !== '') hasValue = true;
      let finalKey = key;
      if (Object.prototype.hasOwnProperty.call(row, finalKey)) {
        let n = 2;
        while (Object.prototype.hasOwnProperty.call(row, `${key}_${n}`)) n += 1;
        finalKey = `${key}_${n}`;
      }
      row[finalKey] = val;
    }
    if (hasValue) rows.push(row);
  }
  return rows;
}

/** 파일 → 첫 시트 행 배열 (add-product·가져오기 공통) */
export async function parseExcelFileToRows(file) {
  const buf = await file.arrayBuffer();
  const data = new Uint8Array(buf);
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('시트가 없습니다.');
  const sheet = wb.Sheets[sheetName];
  return sheetToExcelDisplayRows(sheet);
}

/** 커스텀 필드 정의가 늦게 로드된 뒤 매핑 행만 보강 */
export function mergeCustomFieldMappingRows(prevRows, excelHeaders, customFieldDefs) {
  const have = new Set((prevRows || []).map((r) => r.targetKey));
  const extra = [];
  for (const d of customFieldDefs || []) {
    if (!d?.key) continue;
    const tk = `product.customFields.${d.key}`;
    if (have.has(tk)) continue;
    extra.push({
      id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      sourceType: 'field',
      sourceKey: matchHeader(excelHeaders, [String(d.label || ''), d.key, `커스텀_${d.key}`]),
      constantValue: '',
      targetKey: tk
    });
  }
  return extra.length ? [...prevRows, ...extra] : prevRows;
}
