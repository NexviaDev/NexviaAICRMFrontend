/**
 * 제품 엑셀 가져오기 — 매핑 행·행→API body 변환
 */
import * as XLSX from 'xlsx';

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
      sourceKey: matchHeader(h, ['코드', 'code', 'uid', '제품코드', '제품 코드']),
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
      sourceKey: matchHeader(h, ['소비자가', 'listprice', 'list price', '가격', 'price', '판매가']),
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
      sourceKey: matchHeader(h, ['유통가', 'channel', 'channelprice', '유통 가격']),
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
      sourceKey: matchHeader(h, ['결제주기', '결제 주기', 'billing', 'billingtype', '과금주기', '청구주기']),
      constantValue: '',
      targetKey: 'product.billingType'
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

function readMapped(excelRow, mappingRows, targetKey) {
  const m = (mappingRows || []).find((r) => String(r?.targetKey || '') === targetKey);
  if (!m) return '';
  if (m.sourceType === 'constant') return String(m.constantValue ?? '').trim();
  if (!m.sourceKey) return '';
  const v = excelRow && typeof excelRow === 'object' ? excelRow[m.sourceKey] : undefined;
  if (v == null) return '';
  return String(v).trim();
}

function parsePriceNum(str) {
  const n = parseFloat(String(str ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function normalizeBilling(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'Monthly';
  if (['Monthly', 'Annual', 'Perpetual'].includes(s)) return s;
  const ko = BILLING_KO[s];
  if (ko) return ko;
  const sl = s.toLowerCase();
  if (sl.includes('월')) return 'Monthly';
  if (sl.includes('연') || sl.includes('년')) return 'Annual';
  if (sl.includes('영') || sl.includes('perpet')) return 'Perpetual';
  return 'Monthly';
}

function normalizeStatus(raw) {
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

function normalizeCurrency(raw) {
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
  const listP = parsePriceNum(get('product.listPrice'));
  const costP = parsePriceNum(get('product.costPrice'));
  const channelP = parsePriceNum(get('product.channelPrice'));

  const customFields = {};
  for (const r of mappingRows || []) {
    const tk = String(r?.targetKey || '');
    if (!tk.startsWith('product.customFields.')) continue;
    const ck = tk.slice('product.customFields.'.length);
    if (!ck) continue;
    const val = readMapped(excelRow, mappingRows, tk);
    if (val !== '') customFields[ck] = val;
  }

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
    billingType: normalizeBilling(get('product.billingType')),
    status: normalizeStatus(get('product.status')),
    customFields: Object.keys(customFields).length ? customFields : undefined
  };
}

export function isExcelRowEffectivelyEmpty(excelRow) {
  if (!excelRow || typeof excelRow !== 'object') return true;
  return !Object.values(excelRow).some((v) => v != null && String(v).trim() !== '');
}

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
      status: body.status || 'Active',
      customFields: body.customFields && typeof body.customFields === 'object' ? { ...body.customFields } : {}
    },
    listPrice: body.listPrice || 0,
    costPrice: body.costPrice || 0,
    channelPrice: body.channelPrice || 0,
    categoryRaw: body.category || ''
  };
}

/** 파일 → 첫 시트 행 배열 (add-product·가져오기 공통) */
export async function parseExcelFileToRows(file) {
  const buf = await file.arrayBuffer();
  const data = new Uint8Array(buf);
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('시트가 없습니다.');
  const sheet = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (!Array.isArray(json)) return [];
  return json;
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
