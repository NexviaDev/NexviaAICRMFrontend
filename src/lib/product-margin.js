import { listPriceFromProduct } from './product-price-utils';

/** 내장 순·유통 마진 수식 (커스텀 필드 함수 UI와 동일 토큰) */
export const PRODUCT_BUILTIN_MARGIN_EXPRESSIONS = {
  consumerMargin: '[제품 소비자가]-[제품 원가]',
  channelMargin: '[제품 유통가]-[제품 원가]'
};


/** 순 마진 = 소비자가 − 원가 (저장 스냅샷 우선) */
export function getConsumerMargin(row) {
  const stored = Number(row?.consumerMargin);
  if (Number.isFinite(stored)) return stored;
  return (Number(listPriceFromProduct(row)) || 0) - (Number(row?.costPrice) || 0);
}

/** 유통시 순 마진 = 유통가 − 원가 (저장 스냅샷 우선) */
export function getChannelMargin(row) {
  const stored = Number(row?.channelMargin);
  if (Number.isFinite(stored)) return stored;
  return (Number(row?.channelPrice) || 0) - (Number(row?.costPrice) || 0);
}

/** 유통가가 0이거나 원가 이하이면 유통시 순마진은 표시하지 않음(하이픈) */
export function shouldDashChannelMargin(row) {
  if (row?.fieldFormulas?.channelMargin) return false;
  if (Number.isFinite(Number(row?.channelMargin))) return false;
  const chRaw = Number(row?.channelPrice);
  const ch = Number.isFinite(chRaw) ? chRaw : 0;
  const cost = Number(row?.costPrice);
  const costNum = Number.isFinite(cost) ? cost : 0;
  if (ch === 0) return true;
  if (ch <= costNum) return true;
  return false;
}

/** 소비자가 대비 순 마진율(%) */
export function getConsumerMarginPercent(row) {
  const lp = Number(listPriceFromProduct(row)) || 0;
  if (lp <= 0) return null;
  return (getConsumerMargin(row) / lp) * 100;
}

/** 폼 입력값 기준 마진 계산 */
export function computeMarginsFromPrices({ listPrice, costPrice, channelPrice }) {
  const row = { listPrice, price: listPrice, costPrice, channelPrice };
  return {
    consumerMargin: getConsumerMargin(row),
    channelMargin: getChannelMargin(row),
    dashChannelMargin: shouldDashChannelMargin(row)
  };
}
