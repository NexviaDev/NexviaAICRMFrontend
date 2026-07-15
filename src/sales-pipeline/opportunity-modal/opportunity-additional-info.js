/**
 * 기회 모달 「추가정보」탭 — 자유 Key·Value + 제품(보안 민감 필드 제외) 가져오기
 */

export function newAdditionalInfoRowId() {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Product 문서에서 추가정보로 가져오면 안 되는 필드 */
export const PRODUCT_ADDITIONAL_INFO_SENSITIVE_KEYS = new Set([
  '_id',
  '__v',
  'id',
  'companyId',
  'costPrice',
  'channelPrice',
  'consumerMargin',
  'channelMargin',
  'dsrpUsd',
  'rpiRate',
  'handlingRate',
  'fieldFormulas',
  'catalogReminderCalendarEventId',
  'price',
  'createdAt',
  'updatedAt'
]);

/** customFields 안에서도 제외할 키 */
export const PRODUCT_CUSTOM_FIELD_SENSITIVE_KEYS = new Set([
  'dsrpUsd',
  'rpiRate',
  'handlingRate',
  'costPrice',
  'channelPrice',
  'consumerMargin',
  'channelMargin'
]);

const PRODUCT_BASE_FIELD_LABELS = {
  name: '제품명',
  code: '제품 코드',
  category: '카테고리',
  version: '버전',
  listPrice: '소비자가',
  currency: '통화',
  billingType: '결제 주기',
  billingInterval: '결제 기간',
  status: '상태'
};

const BILLING_TYPE_LABEL = {
  Monthly: '월간',
  Annual: '연간',
  Perpetual: '영구'
};

const STATUS_LABEL = {
  Active: '활성',
  EndOfLife: '단종',
  Draft: '초안'
};

function formatProductFieldValue(key, value) {
  if (value == null) return '';
  if (key === 'billingType') return BILLING_TYPE_LABEL[value] || String(value);
  if (key === 'status') return STATUS_LABEL[value] || String(value);
  if (key === 'listPrice' && typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * 제품 문서 → 추가정보에 넣을 수 있는 { key, label, value } 목록
 * @param {object} product
 */
export function listSafeProductFieldsForAdditionalInfo(product) {
  if (!product || typeof product !== 'object') return [];
  const out = [];

  for (const [key, label] of Object.entries(PRODUCT_BASE_FIELD_LABELS)) {
    if (PRODUCT_ADDITIONAL_INFO_SENSITIVE_KEYS.has(key)) continue;
    if (product[key] == null || product[key] === '') continue;
    const value = formatProductFieldValue(key, product[key]);
    if (!String(value).trim()) continue;
    out.push({ key, label, value });
  }

  const cf = product.customFields && typeof product.customFields === 'object' ? product.customFields : {};
  for (const [ck, cv] of Object.entries(cf)) {
    if (!ck || PRODUCT_CUSTOM_FIELD_SENSITIVE_KEYS.has(ck)) continue;
    if (PRODUCT_ADDITIONAL_INFO_SENSITIVE_KEYS.has(ck)) continue;
    if (cv == null || cv === '') continue;
    const value = formatProductFieldValue(ck, cv);
    if (!String(value).trim()) continue;
    out.push({
      key: `custom.${ck}`,
      label: ck,
      value
    });
  }

  return out;
}

/**
 * API/저장용 배열로 정규화 (id 제거)
 * @param {{ key?: string, value?: string }[]} rows
 */
export function additionalInfoRowsToPayload(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      key: String(r?.key || '').trim().slice(0, 120),
      value: String(r?.value ?? '').trim().slice(0, 4000)
    }))
    .filter((r) => r.key);
}

/**
 * 서버 응답 → 편집용 행
 * @param {unknown} raw
 */
export function additionalInfoFromApi(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((r) => ({
        id: newAdditionalInfoRowId(),
        key: String(r?.key || '').trim(),
        value: String(r?.value ?? '').trim()
      }))
      .filter((r) => r.key);
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.entries(raw)
      .map(([key, value]) => ({
        id: newAdditionalInfoRowId(),
        key: String(key || '').trim(),
        value: value == null ? '' : String(value).trim()
      }))
      .filter((r) => r.key);
  }
  return [];
}
