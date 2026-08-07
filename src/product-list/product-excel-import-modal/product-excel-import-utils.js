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
  evaluateFormulaExpression,
  validateFormulaExpression
} from '@/lib/custom-field-formula';
import {
  convertExcelFormulaToCrm,
  replaceAllInExcelDraftRows
} from '@/lib/excel-formula-to-crm';
import { getBuiltinFormulaFields } from '@/lib/custom-field-formula-catalog';
import {
  hasPercentSuffix,
  normalizeCustomFieldsForApiSave,
  normalizeCustomFieldsForFormula,
  normalizeFormulaBuiltInNumbers,
  parseNumericFieldValue,
  parseNumericFieldValueForFormula,
  stripPercentSuffix
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

export { replaceAllInExcelDraftRows };

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

/** 수식 [필드라벨] — 피커·평가와 동일한 표시 이름 */
export function formulaLabelForProductTarget(targetKey, customDefinitions = []) {
  const tk = String(targetKey || '').trim();
  if (!tk) return '';
  const builtInKey = PRODUCT_FORMULA_TARGET_TO_FIELD[tk];
  if (builtInKey) {
    const b = getBuiltinFormulaFields('product').find((x) => x.key === builtInKey);
    return String(b?.label || builtInKey).trim();
  }
  const ck = productCustomFieldKeyFromTarget(tk);
  if (!ck) return '';
  const def = (customDefinitions || []).find((d) => d?.key === ck);
  return String(def?.label || ck).trim();
}

/**
 * 미리보기 진입 — 모든 열의 엑셀 A1 수식을 =[라벨] 형태로 환산
 * - 같은 행 참조: 매핑된 수식가능 필드면 CRM 라벨, 아니면 엑셀 헤더명
 * - 미매핑 열 수식도 변환 (예: =H6*(1-I6) → =[SRP]*(1-[ADSK DC]))
 * - $I$1 등 다른 행·절대참조는 남겨 「모두 바꾸기」로 치환
 */
export function convertMappedExcelFormulasForPreview(
  excelRows,
  mappingRows,
  customDefinitions = []
) {
  const headerCols = Array.isArray(excelRows?.__excelHeaderCols)
    ? excelRows.__excelHeaderCols
    : [];

  /** 엑셀 헤더 키 → CRM 수식 라벨 (수식가능 매핑만) */
  const headerToCrmLabel = new Map();
  for (const row of mappingRows || []) {
    if (row?.sourceType === 'constant') continue;
    const sk = String(row?.sourceKey || '').trim();
    const tk = String(row?.targetKey || '').trim();
    if (!sk || !tk || tk === 'ignore') continue;
    if (!isProductFormulaCapableTarget(tk, customDefinitions)) continue;
    const label = formulaLabelForProductTarget(tk, customDefinitions);
    if (label) headerToCrmLabel.set(sk, label);
  }

  /** 시트 열 인덱스 → 괄호 라벨 (매핑 CRM 우선, 없으면 엑셀 헤더) */
  const absColToLabel = new Map();
  for (const h of headerCols) {
    if (h == null || h.absCol == null) continue;
    const key = String(h.key || '').replace(/\s+/g, ' ').trim();
    if (!key) continue;
    absColToLabel.set(h.absCol, headerToCrmLabel.get(h.key) || headerToCrmLabel.get(key) || key);
  }

  const nextRows = (excelRows || []).map((row) => {
    const next = { ...row };
    const excelRow1Based = Number(row?.__excelRowNum__) || 0;
    for (const key of Object.keys(row || {})) {
      if (!key || String(key).startsWith('__')) continue;
      const raw = next[key];
      if (raw == null || String(raw).trim() === '') continue;
      const rawStr = String(raw);
      if (!rawStr.trimStart().startsWith('=')) continue;
      // 이미 CRM [라벨]만 있고 A1 셀참조가 없으면 스킵
      if (!/\$?[A-Za-z]+\$?\d+\b/.test(rawStr)) continue;
      const converted = convertExcelFormulaToCrm(rawStr, {
        excelRow1Based,
        colIndexToLabel: absColToLabel
      });
      if (converted.ok && converted.formula && converted.convertedCount > 0) {
        next[key] = converted.formula;
      }
    }
    return next;
  });
  if (headerCols.length) nextRows.__excelHeaderCols = headerCols;
  return nextRows;
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

/** 엑셀·미리보기 문자열(₩, 원, 쉼표 등) 또는 숫자 셀 → API 금액. 값 뒤 %는 확률(/100) */
export function parsePriceNum(val) {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const s = String(val ?? '').trim();
  if (!s) return 0;
  if (isExcelFormulaInput(s)) return 0;
  return parseNumericFieldValueForFormula(s) ?? 0;
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

/**
 * 금액 칸 포맷/sanitize 대상인지 — 「Civil 3D」「v3」처럼 문자+숫자 혼합은 제외.
 * ₩/$/원·통화코드는 금액으로 인정.
 */
export function looksLikePriceOrNumericInput(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return false;
  if (isExcelFormulaInput(t) || t.trimStart().startsWith('=')) return true;
  if (!/\d/.test(t)) return false;
  const withoutCurrency = t
    .replace(/(USD|KRW|EUR|JPY|CNY|GBP|WON)/gi, '')
    .replace(/[₩$€£¥원%\s,]/g, '');
  if (!withoutCurrency) return false;
  if (!/^-?\d*\.?\d*$/.test(withoutCurrency) && !/^\(\d*\.?\d*\)$/.test(withoutCurrency)) {
    return false;
  }
  const lettersLeft = t
    .replace(/(USD|KRW|EUR|JPY|CNY|GBP|WON)/gi, '')
    .replace(/[₩$€£¥원%\s,.\d()\-+]/g, '');
  return lettersLeft === '';
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

/** 미리보기·입력 표시 — 기호(₩$원 등) 제거, 천 단위 쉼표 유지. 확률(10%)은 % 그대로 유지 */
export function formatPriceExcelInputDisplay(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (isExcelFormulaInput(s)) return s;
  if (!/\d/.test(s)) return s;
  // Civil 3D 등 — 숫자만 뽑으면 「3」이 되므로 원문 유지
  if (!looksLikePriceOrNumericInput(s)) return s;
  if (hasPercentSuffix(s)) {
    const pct = parseNumericFieldValue(stripPercentSuffix(s));
    if (pct == null) return s;
    return `${pct.toLocaleString('ko-KR', { maximumFractionDigits: 4, minimumFractionDigits: 0 })}%`;
  }
  const n = parsePriceNum(raw);
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0
  });
}

/** 입력 중 — 숫자·쉼표·소수점(+확률 %)만 남기고 쉼표 포맷 */
export function sanitizePriceExcelInput(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (isExcelFormulaInput(s)) return s;
  if (s.trimStart().startsWith('=')) return String(raw ?? '');
  if (!looksLikePriceOrNumericInput(s)) return String(raw ?? '');
  const percent = s.endsWith('%');
  const digitsOnly = s.replace(/,/g, '').replace(/[^\d.]/g, '');
  const formatted = formatPriceWhileTyping(digitsOnly);
  return percent ? `${formatted}%` : formatted;
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
  const withFormulas = convertMappedExcelFormulasForPreview(
    excelRows,
    mappingRows,
    customDefinitions
  );
  const billingKey = resolveProductExcelColumnKey(mappingRows, 'product.billingType');
  const baseRows = (withFormulas || []).map((r) => ({ ...r }));
  if (Array.isArray(withFormulas?.__excelHeaderCols)) {
    baseRows.__excelHeaderCols = withFormulas.__excelHeaderCols;
  }
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

  if (Array.isArray(withFormulas?.__excelHeaderCols)) {
    billingNormalized.__excelHeaderCols = withFormulas.__excelHeaderCols;
  }

  const priced = normalizeExcelRowsPricesAndCurrencyForPreview(
    billingNormalized,
    mappingRows,
    allowedCodes,
    customDefinitions
  );
  if (Array.isArray(withFormulas?.__excelHeaderCols)) {
    priced.__excelHeaderCols = withFormulas.__excelHeaderCols;
  }
  return priced;
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

function buildProductExcelCustomFormulaContext(resolvedProduct, customFieldsInput, exchangeCtx, customDefinitions, excelPeerValues = null) {
  const fxBuiltIn = exchangeCtx
    ?         buildExchangeRateFormulaBuiltin(
          exchangeCtx.usdSummary,
          exchangeCtx.dealBasRMap,
          resolvedProduct?.currency,
          { profile: exchangeCtx.pricingProfile, rateRows: exchangeCtx.rateRows }
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
  const peers =
    excelPeerValues && typeof excelPeerValues === 'object' ? excelPeerValues : {};
  return {
    entityType: 'product',
    definitions: customDefinitions || [],
    pricingProfile: exchangeCtx?.pricingProfile || null,
    builtIn: normalizeFormulaBuiltInNumbers(rawBuiltIn),
    customFields: normalizeCustomFieldsForFormula(
      { ...peers, ...(customFieldsInput || {}) },
      customDefinitions
    ),
    missingRefAsZero: Boolean(excelPeerValues && Object.keys(peers).length)
  };
}

function resolveProductExcelCustomFields(
  excelRow,
  mappingRows,
  resolvedProduct,
  rawCustomFields,
  exchangeCtx,
  customDefinitions,
  excelHeaders,
  excelPeerValues = null
) {
  const manual = customFieldsForFormulaContext(rawCustomFields, customDefinitions);
  const ctx = buildProductExcelCustomFormulaContext(
    resolvedProduct,
    manual,
    exchangeCtx,
    customDefinitions,
    excelPeerValues
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
    if (!def?.key) continue;
    if (def.type !== 'formula' && def.type !== 'number') continue;
    const tk = `${PRODUCT_CUSTOM_FIELD_TARGET_PREFIX}${def.key}`;
    const cellRaw = readMapped(excelRow, mappingRows, tk, customDefinitions, excelHeaders);
    const parsed = parseFormulaInput(cellRaw);
    if (!parsed.isFormula || !parsed.expression) continue;
    const val = evaluateFormulaExpression(parsed.expression, {
      ...formulaEvalCtx(computed),
      missingRefAsZero: true
    });
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

/**
 * 미매핑 포함 — 같은 엑셀 행의 헤더명→숫자.
 * `=[소비자가]*(1-[ADSK DC])` 처럼 미매핑 열도 서로·CRM 내장 필드와 연산 가능하게 함.
 * #REF! 가 포함된 수식은 엑셀 원본 깨진 참조라 스킵.
 */
export function computeExcelPeerNumericValues(
  excelRow,
  mappingRows = [],
  customDefinitions = [],
  exchangeCtx = null,
  headerCols = null
) {
  const headerMeta =
    Array.isArray(headerCols) && headerCols.length
      ? headerCols
      : Array.isArray(excelRow?.__excelHeaderCols)
        ? excelRow.__excelHeaderCols
        : [];
  const headers = [];
  const seen = new Set();
  for (const h of headerMeta) {
    const key = typeof h === 'string' ? h : h?.key;
    if (!key || String(key).startsWith('__') || seen.has(key)) continue;
    seen.add(key);
    headers.push(key);
  }
  for (const k of Object.keys(excelRow || {})) {
    if (!k || String(k).startsWith('__') || seen.has(k)) continue;
    seen.add(k);
    headers.push(k);
  }

  /** 엑셀 헤더 → CRM 수식 라벨 (매핑된 수식가능) */
  const headerToCrmLabel = new Map();
  const headerToFieldKey = new Map();
  for (const row of mappingRows || []) {
    if (row?.sourceType === 'constant') continue;
    const sk = String(row?.sourceKey || '').trim();
    const tk = String(row?.targetKey || '').trim();
    if (!sk || !tk || tk === 'ignore') continue;
    if (!isProductFormulaCapableTarget(tk, customDefinitions)) continue;
    const label = formulaLabelForProductTarget(tk, customDefinitions);
    if (label) headerToCrmLabel.set(sk, label);
    const fk = PRODUCT_FORMULA_TARGET_TO_FIELD[tk] || productCustomFieldKeyFromTarget(tk);
    if (fk) headerToFieldKey.set(sk, fk);
  }

  const rawByHeader = {};
  for (const h of headers) {
    rawByHeader[h] = readExcelMappedCell(excelRow, h);
  }

  const valuesByHeader = {};
  for (const h of headers) {
    const raw = rawByHeader[h];
    if (isExcelFormulaInput(raw)) continue;
    if (/#REF!/i.test(String(raw))) continue;
    // 빈 칸은 0 — =[RPI환율]*(1-[ADSK DC]) 에서 ADSK DC 없을 때 깨지지 않게
    if (raw == null || String(raw).trim() === '') {
      valuesByHeader[h] = 0;
      continue;
    }
    /** 확률(10%)은 문자열 그대로 — /100 환산은 수식 참조 시 한 번만 한다 */
    if (hasPercentSuffix(String(raw).trim())) {
      valuesByHeader[h] = String(raw).trim();
      continue;
    }
    if (looksLikePriceOrNumericInput(raw)) {
      valuesByHeader[h] = parsePriceNum(raw);
      continue;
    }
    const n = parseNumericFieldValue(raw, { rejectFormula: true });
    if (n != null) valuesByHeader[h] = n;
    else valuesByHeader[h] = 0;
  }

  const buildPeerBag = () => {
    const peers = { ...valuesByHeader };
    for (const [h, v] of Object.entries(valuesByHeader)) {
      if (v == null) continue;
      if (!hasPercentSuffix(v) && !Number.isFinite(Number(v))) continue;
      const val = hasPercentSuffix(v) ? v : Number(v);
      const label = headerToCrmLabel.get(h);
      if (label) peers[label] = val;
      /** [DSRP] → custom key 로 리맵되므로 peer에 필드 키도 넣어야 함 (라벨만 있으면 0) */
      const fk = headerToFieldKey.get(h);
      if (fk) peers[fk] = val;
    }
    return peers;
  };

  const buildBuiltIn = () => {
    const builtIn = {
      listPrice: 0,
      price: 0,
      costPrice: 0,
      channelPrice: 0,
      consumerMargin: 0,
      channelMargin: 0
    };
    for (const [h, fk] of headerToFieldKey.entries()) {
      const n = parseNumericFieldValueForFormula(valuesByHeader[h], { rejectFormula: true });
      if (n == null || !Number.isFinite(n)) continue;
      if (['listPrice', 'costPrice', 'channelPrice', 'consumerMargin', 'channelMargin'].includes(fk)) {
        builtIn[fk] = n;
        if (fk === 'listPrice') builtIn.price = builtIn.listPrice;
      }
    }
    if (exchangeCtx) {
      Object.assign(
        builtIn,
        buildExchangeRateFormulaBuiltin(
          exchangeCtx.usdSummary,
          exchangeCtx.dealBasRMap,
          null,
          { profile: exchangeCtx.pricingProfile, rateRows: exchangeCtx.rateRows }
        ) || {}
      );
    }
    return normalizeFormulaBuiltInNumbers(builtIn);
  };

  const maxPass = Math.max(8, headers.length + 4);
  for (let pass = 0; pass < maxPass; pass += 1) {
    let changed = false;
    const peers = buildPeerBag();
    const builtIn = buildBuiltIn();
    const ctx = {
      entityType: 'product',
      definitions: customDefinitions || [],
      pricingProfile: exchangeCtx?.pricingProfile || null,
      builtIn,
      customFields: normalizeCustomFieldsForFormula(peers, customDefinitions || []),
      computedFormulas: {},
      fieldTypes: {},
      customFieldKeys: new Set((customDefinitions || []).filter((d) => d?.key).map((d) => d.key)),
      missingRefAsZero: true
    };
    for (const h of headers) {
      const raw = rawByHeader[h];
      if (!isExcelFormulaInput(raw)) continue;
      if (/#REF!/i.test(String(raw))) continue;
      const parsed = parseFormulaInput(raw);
      if (!parsed.isFormula || !parsed.expression) continue;
      const val = evaluateFormulaExpression(parsed.expression, ctx);
      if (val == null || !Number.isFinite(Number(val))) continue;
      const n = Number(val);
      if (valuesByHeader[h] !== n) {
        valuesByHeader[h] = n;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return buildPeerBag();
}

/** 미리보기 — 행 단위 수식 재계산 결과 */
export function resolveProductExcelRow(excelRow, mappingRows, exchangeCtx = null, customDefinitions = [], opts = {}) {
  const { allowedCodes = null, excelHeaderCols = null } = opts;
  const excelHeaders = excelRow
    ? Object.keys(excelRow).filter((k) => k && !String(k).startsWith('__'))
    : [];
  const excelPeerValues = computeExcelPeerNumericValues(
    excelRow,
    mappingRows,
    customDefinitions,
    exchangeCtx,
    excelHeaderCols
  );
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
  let resolved = resolveProductFieldValues(draft, exchangeCtx, customDefinitions, {
    excelPeerValues
  });
  let customFields = resolveProductExcelCustomFields(
    excelRow,
    mappingRows,
    { ...resolved, currency },
    inputs.customFields,
    exchangeCtx,
    customDefinitions,
    excelHeaders,
    excelPeerValues
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
      { computedCustomFields: customFields, excelPeerValues }
    );
    customFields = resolveProductExcelCustomFields(
      excelRow,
      mappingRows,
      { ...resolved, currency },
      inputs.customFields,
      exchangeCtx,
      customDefinitions,
      excelHeaders,
      excelPeerValues
    );
    if (snapshot() === prev) break;
  }

  return { ...resolved, currency, customFields, __excelPeerValues: excelPeerValues };
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

  const peerBag = rowResolved?.__excelPeerValues;
  const peerKey = col?.excelKey;
  if (isExcelFormulaInput(raw) && peerBag && peerKey && peerBag[peerKey] != null) {
    return formatResolvedExcelFormulaPreview(peerBag[peerKey]);
  }
  if (isExcelFormulaInput(raw) && /#REF!/i.test(raw)) {
    return '깨진참조(#REF!)';
  }

  const tk = col?.targetKey;
  const builtInKey = PRODUCT_FORMULA_TARGET_TO_FIELD[tk];
  if (builtInKey) {
    if (isExcelFormulaInput(raw)) {
      return formatResolvedExcelFormulaPreview(rowResolved?.[builtInKey]);
    }
    return formatResolvedExcelFormulaPreview(parsePriceNum(cellRaw));
  }

  const customKey = productCustomFieldKeyFromTarget(tk);
  if (!customKey) {
    // 미매핑 숫자 열 — 인식값 표시
    if (!col?.isUnmapped) return null;
    if (looksLikePriceOrNumericInput(raw)) {
      return formatResolvedExcelFormulaPreview(parsePriceNum(raw));
    }
    return null;
  }

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

function extractCustomFieldFormulasFromExcelRow(
  excelRow,
  mappingRows,
  customDefinitions = [],
  excelHeaders = []
) {
  const out = {};
  for (const d of customDefinitions || []) {
    if (!d?.key) continue;
    if (!['number', 'text', 'formula', 'checkbox'].includes(d.type)) continue;
    const tk = `${PRODUCT_CUSTOM_FIELD_TARGET_PREFIX}${d.key}`;
    const cellRaw = readMapped(excelRow, mappingRows, tk, customDefinitions, excelHeaders);
    const parsed = parseFormulaInput(cellRaw);
    if (parsed.isFormula && parsed.expression) {
      out[d.key] = parsed.expression;
    }
  }
  return out;
}

/**
 * 매핑 행 + 엑셀 한 줄 → POST /products body (fieldFormulas·마진 스냅샷 포함)
 * @param {{ allowedCodes?: Set<string>|null, exchangeCtx?: object|null, customDefinitions?: Array }} [opts]
 */
export function excelRowToProductBody(excelRow, mappingRows, opts = {}) {
  const {
    allowedCodes = null,
    exchangeCtx = null,
    customDefinitions = [],
    excelHeaderCols = null
  } = opts;
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
    allowedCodes,
    excelHeaderCols
  });
  const customFieldFormulas = extractCustomFieldFormulasFromExcelRow(
    excelRow,
    mappingRows,
    customDefinitions,
    excelHeaders
  );
  const resolvedCustomRaw =
    resolvedRow?.customFields && typeof resolvedRow.customFields === 'object'
      ? resolvedRow.customFields
      : {};
  const resolvedCustom = normalizeCustomFieldsForApiSave(resolvedCustomRaw, customDefinitions);

  return {
    ...payload.body,
    fieldFormulas: payload.body.fieldFormulas || {},
    customFieldFormulas,
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

/**
 * 미리보기 표 열 — 엑셀 헤더를 모두 표시(미매핑 포함).
 * 매핑된 열은 CRM 라벨, 미매핑은 엑셀 헤더명. 고정값 매핑은 맨 뒤에 추가.
 */
export function buildProductExcelPreviewColumns(mappingRows, targetOptions, excelHeaders = [], customFieldDefs = []) {
  const labelMap = new Map();
  for (const o of targetOptions || []) {
    if (o?.value) labelMap.set(o.value, o.label || o.value);
  }
  const hdrs = (Array.isArray(excelHeaders) ? excelHeaders : []).filter(
    (h) => h && !String(h).startsWith('__')
  );

  /** 엑셀 헤더 → 매핑 행 (정확한 sourceKey 우선) */
  const mappingByHeader = new Map();
  for (const r of mappingRows || []) {
    if (!r || r.sourceType === 'constant') continue;
    const sk = String(r.sourceKey || '').trim();
    const tk = String(r.targetKey || '').trim();
    if (!sk || !tk || tk === 'ignore') continue;
    if (!mappingByHeader.has(sk)) mappingByHeader.set(sk, r);
  }

  const cols = [];
  const seenExcel = new Set();

  for (const h of hdrs) {
    if (seenExcel.has(h)) continue;
    seenExcel.add(h);
    const m = mappingByHeader.get(h);
    const targetKey = m ? String(m.targetKey || '').trim() : '';
    const mapped = Boolean(targetKey && targetKey !== 'ignore');
    cols.push({
      excelKey: h,
      targetKey: mapped ? targetKey : '',
      label: mapped ? labelMap.get(targetKey) || targetKey : h,
      excelTitle: h,
      isConstant: false,
      isUnmapped: !mapped,
      includeToggleable: true
    });
  }

  for (const r of mappingRows || []) {
    if (!r || r.sourceType !== 'constant') continue;
    const targetKey = String(r.targetKey || '').trim();
    if (!targetKey || targetKey === 'ignore') continue;
    cols.push({
      targetKey,
      excelKey: productPreviewCellKey(targetKey),
      label: labelMap.get(targetKey) || targetKey,
      excelTitle: `고정값 (${r.constantValue ?? ''})`,
      isConstant: true,
      constantValue: String(r.constantValue ?? ''),
      isUnmapped: false,
      includeToggleable: false
    });
  }

  return cols;
}

/** 미리보기에서 체크된 엑셀 열만 남기도록 매핑 행 필터 (고정값은 유지) */
export function filterMappingRowsByIncludedExcelKeys(mappingRows, includedExcelKeys) {
  const set =
    includedExcelKeys instanceof Set
      ? includedExcelKeys
      : new Set(
          Array.isArray(includedExcelKeys)
            ? includedExcelKeys
            : includedExcelKeys && typeof includedExcelKeys === 'object'
              ? Object.keys(includedExcelKeys).filter((k) => includedExcelKeys[k])
              : []
        );
  return (mappingRows || []).filter((r) => {
    if (!r) return false;
    if (r.sourceType === 'constant') return true;
    const sk = String(r.sourceKey || '').trim();
    if (!sk) return false;
    return set.has(sk);
  });
}

/** 체크돼 있지만 매핑 없는 엑셀 열 라벨 목록 */
export function listCheckedUnmappedExcelColumns(previewColumns, includedExcelKeys) {
  const set =
    includedExcelKeys instanceof Set
      ? includedExcelKeys
      : new Set(
          Array.isArray(includedExcelKeys)
            ? includedExcelKeys
            : includedExcelKeys && typeof includedExcelKeys === 'object'
              ? Object.keys(includedExcelKeys).filter((k) => includedExcelKeys[k])
              : []
        );
  return (previewColumns || []).filter(
    (c) => c && c.includeToggleable && c.isUnmapped && set.has(c.excelKey)
  );
}

/** 엑셀 헤더 → API custom field key (영문 시작 + 영숫자_) */
export function suggestProductExcelAutoFieldKey(header, index, usedKeys = new Set()) {
  const used = usedKeys instanceof Set ? usedKeys : new Set(usedKeys || []);
  const ascii = String(header || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  let base = ascii && /^[a-zA-Z]/.test(ascii) ? ascii.slice(0, 36) : `excel_col_${Number(index) + 1}`;
  if (!/^[a-zA-Z]/.test(base)) base = `f_${base}`;
  let key = base;
  let n = 2;
  while (used.has(key)) {
    key = `${base}_${n}`;
    n += 1;
  }
  used.add(key);
  return key;
}

/**
 * 미리보기 샘플로 자동 생성 필드 타입 추정
 * - 수식 셀이 많으면 함수 필드, 값 뒤 %가 많으면 백분율 숫자 필드
 * - 수식이지만 아직 검증 못한 경우에도 expression 을 돌려줘 2차 판정에 쓴다
 * @returns {{ label: string, type: 'formula'|'number'|'text', expression?: string, displayFormat?: string }}
 */
export function inferProductExcelAutoFieldSpec(
  excelKey,
  draftRows,
  customDefinitions = [],
  opts = {}
) {
  const { pricingProfile = null } = opts;
  const label = String(excelKey || '').replace(/\s+/g, ' ').trim() || '엑셀열';
  let formula = 0;
  let number = 0;
  let percent = 0;
  let text = 0;
  let firstExpr = '';
  for (const row of (draftRows || []).slice(0, 60)) {
    const raw = readExcelMappedCell(row, excelKey);
    if (raw == null || String(raw).trim() === '') continue;
    if (isExcelFormulaInput(raw)) {
      formula += 1;
      if (!firstExpr) {
        const parsed = parseFormulaInput(raw);
        if (parsed.isFormula && parsed.expression) firstExpr = parsed.expression;
      }
      continue;
    }
    if (hasPercentSuffix(String(raw).trim())) {
      percent += 1;
      number += 1;
      continue;
    }
    if (looksLikePriceOrNumericInput(raw)) number += 1;
    else text += 1;
  }

  if (formula > 0 && formula >= number && formula >= text && firstExpr) {
    const check = validateFormulaExpression(firstExpr, 'product', customDefinitions || [], {
      pricingProfile
    });
    if (check.ok) {
      return { label, type: 'formula', expression: firstExpr };
    }
    // 아직 만들어지지 않은 열을 참조 — planAuto…에서 2차 판정
    return { label, type: 'number', expression: firstExpr };
  }
  if (number > 0 && number >= text) {
    return percent > 0 && percent >= number / 2
      ? { label, type: 'number', displayFormat: 'percentage' }
      : { label, type: 'number' };
  }
  return { label, type: 'text' };
}

/**
 * 체크된 미매핑 열 → 기존 정의 재사용 또는 생성 스펙 + 매핑 행
 * @returns {{ mappingExtra: Array, createPayloads: Array<{ excelKey, payload }>, reuse: Array }}
 */
export function planAutoCustomFieldsForUnmappedExcelColumns(
  unmappedColumns,
  draftRows,
  existingDefinitions = [],
  opts = {}
) {
  const { pricingProfile = null } = opts;
  const defs = Array.isArray(existingDefinitions) ? [...existingDefinitions] : [];
  const usedKeys = new Set(defs.map((d) => d.key).filter(Boolean));
  const labelToDef = new Map();
  for (const d of defs) {
    const lb = String(d?.label || '').trim().toLowerCase();
    if (lb && !labelToDef.has(lb)) labelToDef.set(lb, d);
  }

  const mappingExtra = [];
  const createPayloads = [];
  const reuse = [];
  let orderBase = defs.length;

  (unmappedColumns || []).forEach((col, idx) => {
    const excelKey = String(col?.excelKey || '').trim();
    if (!excelKey) return;
    const label = String(col.excelTitle || col.label || excelKey).replace(/\s+/g, ' ').trim();
    const existing = labelToDef.get(label.toLowerCase());
    if (existing?.key) {
      reuse.push({ excelKey, def: existing });
      mappingExtra.push({
        id: `auto-${existing.key}`,
        sourceType: 'field',
        sourceKey: excelKey,
        constantValue: '',
        targetKey: `product.customFields.${existing.key}`
      });
      return;
    }

    const spec = inferProductExcelAutoFieldSpec(excelKey, draftRows, defs, { pricingProfile });
    const key = suggestProductExcelAutoFieldKey(label || excelKey, idx, usedKeys);
    const options = {};
    if (spec.type === 'formula' && spec.expression) options.expression = spec.expression;
    if (spec.displayFormat) options.displayFormat = spec.displayFormat;
    const payload = {
      entityType: 'product',
      key,
      label: spec.label || label,
      type: spec.type,
      required: false,
      order: orderBase + idx,
      ...(Object.keys(options).length ? { options } : {})
    };
    // provisional def for subsequent formula validation
    const provisional = {
      key,
      label: payload.label,
      type: payload.type,
      options: payload.options || null
    };
    defs.push(provisional);
    labelToDef.set(String(payload.label).trim().toLowerCase(), { key, label: payload.label });
    createPayloads.push({
      excelKey,
      payload,
      provisional,
      pendingExpression: spec.type !== 'formula' ? spec.expression || '' : ''
    });
    mappingExtra.push({
      id: `auto-new-${key}`,
      sourceType: 'field',
      sourceKey: excelKey,
      constantValue: '',
      targetKey: `product.customFields.${key}`
    });
  });

  /**
   * 2차 판정 — 뒤쪽 열을 참조해 1차에서 함수로 못 만든 열도 함수 필드로 승격.
   * (예: 시트에서 [Double]=[Half]*2 가 Half 보다 앞에 있는 경우)
   */
  for (let pass = 0; pass <= createPayloads.length; pass += 1) {
    let changed = false;
    for (const entry of createPayloads) {
      if (!entry.pendingExpression) continue;
      const check = validateFormulaExpression(entry.pendingExpression, 'product', defs, {
        pricingProfile
      });
      if (!check.ok) continue;
      entry.payload.type = 'formula';
      entry.payload.options = {
        ...(entry.payload.options || {}),
        expression: entry.pendingExpression
      };
      entry.provisional.type = 'formula';
      entry.provisional.options = entry.payload.options;
      entry.pendingExpression = '';
      changed = true;
    }
    if (!changed) break;
  }

  /**
   * 생성 순서 정렬 — 백엔드는 「이미 있는 필드」기준으로 수식을 검증하므로
   * 일반 필드 → 참조가 모두 준비된 함수 필드 순으로 만들어야 함수로 저장된다.
   * (payload.order 는 그대로라 화면 표시 순서는 엑셀 열 순서 유지)
   */
  const available = Array.isArray(existingDefinitions) ? [...existingDefinitions] : [];
  const ordered = [];
  let pendingFormula = [];
  for (const entry of createPayloads) {
    if (entry.payload.type === 'formula') {
      pendingFormula.push(entry);
      continue;
    }
    ordered.push(entry);
    available.push(entry.provisional);
  }
  for (let pass = 0; pass <= pendingFormula.length; pass += 1) {
    if (!pendingFormula.length) break;
    const ready = pendingFormula.filter((entry) =>
      validateFormulaExpression(entry.payload.options?.expression, 'product', available, {
        pricingProfile
      }).ok
    );
    if (!ready.length) break;
    for (const entry of ready) {
      ordered.push(entry);
      available.push(entry.provisional);
    }
    pendingFormula = pendingFormula.filter((entry) => !ready.includes(entry));
  }
  ordered.push(...pendingFormula);

  return { mappingExtra, createPayloads: ordered, reuse };
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

/** 미리보기 표 헤더 — `__excelHeaderCols` 순서 우선, 없으면 행 키 합집합 (`__` 메타 제외) */
export function collectProductExcelDraftHeaders(rows) {
  const ordered = [];
  const seen = new Set();
  const addKey = (k) => {
    if (!k || String(k).startsWith('__') || seen.has(k)) return;
    seen.add(k);
    ordered.push(k);
  };

  const headerMeta = Array.isArray(rows?.__excelHeaderCols) ? rows.__excelHeaderCols : [];
  for (const col of headerMeta) {
    addKey(typeof col === 'string' ? col : col?.key);
  }

  for (const r of (rows || []).slice(0, 80)) {
    if (!r || typeof r !== 'object') continue;
    Object.keys(r).forEach(addKey);
  }
  return ordered;
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
    customFieldFormulas:
      body.customFieldFormulas && typeof body.customFieldFormulas === 'object'
        ? { ...body.customFieldFormulas }
        : {},
    listPrice: body.listPrice || 0,
    costPrice: body.costPrice || 0,
    channelPrice: body.channelPrice || 0,
    consumerMargin: body.consumerMargin,
    channelMargin: body.channelMargin,
    categoryRaw: body.category || ''
  };
}

/** 엑셀 셀 — 수식 있으면 `=수식`, 아니면 화면 표시값(cell.w) 우선 */
function excelCellImportValue(cell) {
  if (!cell) return '';
  const formula = cell.f != null ? String(cell.f).trim() : '';
  if (formula) {
    return formula.startsWith('=') ? formula : `=${formula}`;
  }
  if (cell.w != null && String(cell.w).trim() !== '') return String(cell.w);
  if (cell.v == null) return '';
  return String(cell.v);
}

/** @deprecated 표시값만 필요할 때 — import는 excelCellImportValue 사용 */
function excelCellDisplayValue(cell) {
  if (!cell) return '';
  if (cell.w != null && String(cell.w).trim() !== '') return String(cell.w);
  if (cell.v == null) return '';
  return String(cell.v);
}

/**
 * 시트 → 행 배열 (헤더=시트의 첫 데이터 행, 값=수식 우선·없으면 표시 문자열)
 * 헤더 행 번호는 시트 !ref 시작 행을 따름 — 특정 행(예: 5행) 하드코딩 금지.
 * 메타: rows.__excelHeaderCols = [{ absCol, key }, ...]
 */
export function sheetToExcelDisplayRows(sheet) {
  const ref = sheet?.['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const headerRow = range.s.r;
  const headers = [];
  const headerCols = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c })];
    const rawLabel = excelCellDisplayValue(cell).trim();
    headers[c] = rawLabel;
  }

  const usedKeys = new Set();
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const key = headers[c];
    if (!key) continue;
    let finalKey = key;
    if (usedKeys.has(finalKey)) {
      let n = 2;
      while (usedKeys.has(`${key}_${n}`)) n += 1;
      finalKey = `${key}_${n}`;
    }
    usedKeys.add(finalKey);
    headers[c] = finalKey;
    headerCols.push({ absCol: c, key: finalKey });
  }

  const rows = [];
  for (let r = headerRow + 1; r <= range.e.r; r += 1) {
    const row = {};
    let hasValue = false;
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const key = headers[c];
      if (!key) continue;
      const val = excelCellImportValue(sheet[XLSX.utils.encode_cell({ r, c })]);
      if (val !== '') hasValue = true;
      row[key] = val;
    }
    if (hasValue) {
      row.__excelRowNum__ = r + 1;
      rows.push(row);
    }
  }
  rows.__excelHeaderCols = headerCols;
  return rows;
}

/** 파일 → 첫 시트 행 배열 (add-product·가져오기 공통) — 수식 셀은 =수식 보존 */
export async function parseExcelFileToRows(file) {
  const buf = await file.arrayBuffer();
  const data = new Uint8Array(buf);
  const wb = XLSX.read(data, { type: 'array', cellFormula: true });
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
