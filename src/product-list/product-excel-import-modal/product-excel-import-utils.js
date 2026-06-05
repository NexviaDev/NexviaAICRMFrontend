/**
 * 제품 엑셀 가져오기 — 매핑 행·행→API body 변환
 */
import * as XLSX from 'xlsx';
import {
  readExcelMappedCell,
  resolveExcelRowHeaderKey
} from '../../customer-companies/customer-companies-excel-import-modal/excel-import-mapping-utils';
import { normalizeBillingInterval, parseBillingIntervalInput } from '@/lib/product-billing-utils';

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
  { value: 'product.currency', label: '통화 (KRW/USD)' },
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

function readMappedValue(excelRow, mappingRows, targetKey) {
  const m = (mappingRows || []).find((r) => String(r?.targetKey || '') === targetKey);
  if (!m) return '';
  if (m.sourceType === 'constant') {
    const cv = m.constantValue;
    return cv == null ? '' : cv;
  }
  if (!m.sourceKey) return '';
  const v = excelRow && typeof excelRow === 'object' ? excelRow[m.sourceKey] : undefined;
  if (v == null || v === '') return '';
  return v;
}

function readMapped(excelRow, mappingRows, targetKey) {
  const v = readMappedValue(excelRow, mappingRows, targetKey);
  if (v === '' || v == null) return '';
  return String(v).trim();
}

/** 엑셀·미리보기 문자열(₩, 원, 쉼표 등) 또는 숫자 셀 → API 금액 */
function parsePriceNum(val) {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  const s = String(val ?? '').trim();
  if (!s) return 0;
  const cleaned = s.replace(/,/g, '').replace(/[^\d.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
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
export function normalizeExcelRowsBillingForPreview(excelRows, mappingRows) {
  const billingKey = resolveProductExcelColumnKey(mappingRows, 'product.billingType');
  if (!billingKey) return (excelRows || []).map((r) => ({ ...r }));

  const intervalKey = resolveProductExcelColumnKey(mappingRows, 'product.billingInterval');

  return (excelRows || []).map((row) => {
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

export function normalizeCurrency(raw) {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s === 'USD' || s === '$' || s.includes('달러')) return 'USD';
  return 'KRW';
}

/**
 * 매핑 행 + 엑셀 한 줄 → POST /products body (add-product-modal과 동일 필드)
 */
export function excelRowToProductBody(excelRow, mappingRows) {
  const get = (k) => readMapped(excelRow, mappingRows, k);

  const name = get('product.name');
  const code = get('product.code');
  const category = get('product.category');
  const version = get('product.version');
  const listP = parsePriceNum(readMappedValue(excelRow, mappingRows, 'product.listPrice'));
  const costP = parsePriceNum(readMappedValue(excelRow, mappingRows, 'product.costPrice'));
  const channelP = parsePriceNum(readMappedValue(excelRow, mappingRows, 'product.channelPrice'));

  const customFields = {};
  for (const r of mappingRows || []) {
    const tk = String(r?.targetKey || '');
    if (!tk.startsWith('product.customFields.')) continue;
    const ck = tk.slice('product.customFields.'.length);
    if (!ck) continue;
    const val = readMapped(excelRow, mappingRows, tk);
    if (val !== '') customFields[ck] = val;
  }

  const billingRaw = get('product.billingType');
  const intervalRaw = get('product.billingInterval');
  const parsed = parseProductBillingValue(billingRaw, intervalRaw);
  const billingType = parsed?.billingType || 'Monthly';
  const billingInterval = parsed?.billingInterval ?? 1;

  return {
    name: name.trim(),
    code: code || undefined,
    category: category || undefined,
    version: version || undefined,
    listPrice: listP,
    costPrice: costP,
    channelPrice: channelP,
    price: listP,
    currency: normalizeCurrency(get('product.currency')),
    billingType,
    billingInterval,
    status: normalizeStatus(get('product.status')),
    customFields: Object.keys(customFields).length ? customFields : undefined
  };
}

export function isExcelRowEffectivelyEmpty(excelRow) {
  if (!excelRow || typeof excelRow !== 'object') return true;
  return !Object.values(excelRow).some((v) => v != null && String(v).trim() !== '');
}

/** 미리보기 표 — 매핑된 엑셀 열만, 헤더는 CRM 대상 필드 라벨 */
export function buildProductExcelPreviewColumns(mappingRows, targetOptions) {
  const labelMap = new Map();
  for (const o of targetOptions || []) {
    if (o?.value) labelMap.set(o.value, o.label || o.value);
  }
  const seen = new Set();
  const cols = [];
  for (const row of mappingRows || []) {
    if (row?.sourceType === 'constant') continue;
    const excelKey = String(row?.sourceKey ?? '').trim();
    if (!excelKey || seen.has(excelKey)) continue;
    const targetKey = String(row?.targetKey ?? '').trim();
    if (!targetKey) continue;
    seen.add(excelKey);
    cols.push({
      excelKey,
      targetKey,
      label: labelMap.get(targetKey) || targetKey,
      excelTitle: excelKey
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

function currencyCellIsValid(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return true;
  const u = s.toUpperCase();
  if (u === 'KRW' || u === 'USD' || u === '$') return true;
  if (s.includes('달러') || s.includes('원')) return true;
  return false;
}

/** 미리보기 — 붉은 칸(등록 전 수정 필요) 건수 */
export function countInvalidProductExcelDraftCells(
  rows,
  { nameColumnKey, billingColumnKey, billingIntervalColumnKey, statusColumnKey, currencyColumnKey }
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
    if (currencyColumnKey && !currencyCellIsValid(readExcelMappedCell(row, currencyColumnKey))) currency += 1;
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

export const PRODUCT_CURRENCY_PREVIEW_OPTIONS = [
  { value: 'KRW', label: 'KRW (원)' },
  { value: 'USD', label: 'USD ($)' }
];

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
    listPrice: body.listPrice || 0,
    costPrice: body.costPrice || 0,
    channelPrice: body.channelPrice || 0,
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
