/** 제품 소비자가 — 기존 문서는 listPrice 없이 price만 있을 수 있음 */
export function listPriceFromProduct(p) {
  if (!p) return 0;
  if (p.listPrice != null && Number.isFinite(Number(p.listPrice))) return Number(p.listPrice);
  return Number(p.price) || 0;
}
