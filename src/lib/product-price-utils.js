/** 제품 소비자가 — 기존 문서는 listPrice 없이 price만 있을 수 있음 */
export function listPriceFromProduct(p) {
  if (!p) return 0;
  if (p.listPrice != null && Number.isFinite(Number(p.listPrice))) return Number(p.listPrice);
  return Number(p.price) || 0;
}

/** 제품 유통가 (제품 목록·유통 세일즈와 동일 축) */
export function channelPriceFromProduct(p) {
  if (!p) return 0;
  return Number(p.channelPrice) || 0;
}

/**
 * 영업 기회 가격 기준 — 제품 목록의 다이렉트 세일즈 / 유통 세일즈와 같은 가격 축
 * @param {'consumer'|'channel'} basis
 */
export function suggestedPriceFromProduct(product, basis) {
  if (!product) return 0;
  if (basis === 'channel') return channelPriceFromProduct(product);
  return listPriceFromProduct(product);
}

/** 제품 목록(list-templates)과 동일한 용어 */
export const OPPORTUNITY_PRICE_BASIS_OPTIONS = [
  { value: 'consumer', label: '다이렉트', shortLabel: '리스트가', desc: '제품의 소비자가(리스트가)를 가격으로 사용합니다.' },
  { value: 'channel', label: '유통', shortLabel: '유통가', desc: '제품의 유통가를 가격으로 사용합니다. 유통사를 지정할 수 있습니다.' }
];
