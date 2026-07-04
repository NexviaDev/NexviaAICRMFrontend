/**
 * 커스텀 필드 수식 — 엔티티별 기본(내장) 숫자 필드 목록
 * 수식에서 [costPrice] 형태로 참조
 */
import { EXCHANGE_RATE_FORMULA_BUILTIN } from '@/lib/exchange-rate-formula-builtin';
import { filterActiveCustomFieldDefinitions } from '@/lib/custom-field-definition-utils';

export const FORMULA_ELIGIBLE_CUSTOM_TYPES = new Set(['number', 'text', 'checkbox', 'formula']);

export const CUSTOM_FIELD_FORMULA_BUILTIN = {
  product: [
    { key: 'listPrice', label: '제품 소비자가' },
    { key: 'costPrice', label: '제품 원가' },
    { key: 'channelPrice', label: '제품 유통가' },
    { key: 'price', label: '제품 가격' },
    ...EXCHANGE_RATE_FORMULA_BUILTIN.map(({ key, label }) => ({ key, label }))
  ],
  customerCompany: [
    { key: 'latitude', label: '위도' },
    { key: 'longitude', label: '경도' }
  ],
  contact: []
};

/** @param {string} entityType */
export function getBuiltinFormulaFields(entityType) {
  return CUSTOM_FIELD_FORMULA_BUILTIN[entityType] || [];
}

/**
 * 수식 필드 선택 목록 = 내장 + 추가된 필드(숫자·글자·체크박스·다른 함수)
 * @param {string} entityType
 * @param {Array<{ key: string, label?: string, type?: string }>} definitions
 * @param {string} [excludeKey] — 편집 중인 필드 자신 제외
 */
export function buildFormulaFieldPickerOptions(entityType, definitions = [], excludeKey = '') {
  const seenKeys = new Set();
  const seenLabels = new Set();
  const out = [];
  for (const b of getBuiltinFormulaFields(entityType)) {
    if (!b.key || seenKeys.has(b.key)) continue;
    const label = String(b.label || b.key).trim();
    if (!label || seenLabels.has(label)) continue;
    seenKeys.add(b.key);
    seenLabels.add(label);
    const fxMeta = EXCHANGE_RATE_FORMULA_BUILTIN.find((f) => f.key === b.key);
    out.push({
      key: b.key,
      label,
      subtitle: fxMeta?.desc || null,
      source: 'builtin',
      fieldType: fxMeta ? 'exchange' : 'builtin'
    });
  }
  for (const d of filterActiveCustomFieldDefinitions(definitions)) {
    if (!d?.key || d.key === excludeKey || seenKeys.has(d.key)) continue;
    if (!FORMULA_ELIGIBLE_CUSTOM_TYPES.has(d.type)) continue;
    const label = String(d.label || d.key).trim();
    if (!label) continue;
    const duplicateBuiltinLabel = seenLabels.has(label);
    seenKeys.add(d.key);
    seenLabels.add(label);
    out.push({
      key: d.key,
      label,
      subtitle: duplicateBuiltinLabel ? '내장(환율) 필드와 같은 이름 — 수식은 추가 필드 우선' : null,
      source: 'custom',
      fieldType: d.type
    });
  }
  return out;
}

/** @param {string} entityType @param {Array} definitions */
export function buildFormulaRefMaps(entityType, definitions = []) {
  const labelToKey = new Map();

  for (const b of getBuiltinFormulaFields(entityType)) {
    if (!b?.key) continue;
    labelToKey.set(b.key, b.key);
    const label = String(b.label || '').trim();
    if (label) labelToKey.set(label, b.key);
  }

  if (entityType === 'product') {
    const aliases = {
      소비자가: 'listPrice',
      소비자: 'listPrice',
      원가: 'costPrice',
      유통가: 'channelPrice',
      가격: 'price',
      '가격(price)': 'price',
      fxConsumerPrice: 'fxConsumerRate'
    };
    for (const [label, key] of Object.entries(aliases)) {
      if (!labelToKey.has(label)) labelToKey.set(label, key);
    }
  }

  // 추가 필드 라벨은 내장(환율 등)과 겹치면 추가 필드가 우선 — 예: [산정 소비자가]
  for (const d of definitions || []) {
    if (!d?.key || !FORMULA_ELIGIBLE_CUSTOM_TYPES.has(d.type)) continue;
    labelToKey.set(d.key, d.key);
    const label = String(d.label || d.key).trim();
    if (label) labelToKey.set(label, d.key);
  }

  return { labelToKey };
}

/** @param {string} token — 괄호 안 문자열(표시 이름 또는 key) */
export function resolveFormulaRefToken(token, entityType, definitions = []) {
  const { labelToKey } = buildFormulaRefMaps(entityType, definitions);
  if (labelToKey.has(token)) return labelToKey.get(token);
  return null;
}

/** @param {string} [fieldType] */
export function getFormulaFieldTypeHint(fieldType) {
  if (fieldType === 'builtin') return '기본';
  if (fieldType === 'exchange') return '환율';
  if (fieldType === 'number') return '숫자';
  if (fieldType === 'text') return '글자→숫자';
  if (fieldType === 'checkbox') return '0/1';
  if (fieldType === 'formula') return '함수';
  return '추가';
}
