/** 제품 소비자가 — 기존 문서는 listPrice 없이 price만 있을 수 있음 */
export function listPriceFromProduct(p) {
  if (!p) return 0;
  if (p.listPrice != null && Number.isFinite(Number(p.listPrice))) return Number(p.listPrice);
  return Number(p.price) || 0;
}

/** 제품 유통가 (제품 목록·유통 마진과 동일 축) */
export function channelPriceFromProduct(p) {
  if (!p) return 0;
  return Number(p.channelPrice) || 0;
}

/**
 * 영업 기회 가격 기준 — 제품 목록의 소비자 마진 / 유통 마진과 같은 가격 축
 * @param {'consumer'|'channel'} basis
 */
export function suggestedPriceFromProduct(product, basis) {
  if (!product) return 0;
  if (basis === 'channel') return channelPriceFromProduct(product);
  return listPriceFromProduct(product);
}

/** 제품 목록(list-templates)과 동일한 용어 */
export const OPPORTUNITY_PRICE_BASIS_OPTIONS = [
  { value: 'consumer', label: '소비자 마진 기준', shortLabel: '소비자가', desc: '제품의 소비자가(리스트가)를 가격으로 사용합니다.' },
  { value: 'channel', label: '유통 마진 기준', shortLabel: '유통가', desc: '제품의 유통가를 가격으로 사용합니다.' }
];
