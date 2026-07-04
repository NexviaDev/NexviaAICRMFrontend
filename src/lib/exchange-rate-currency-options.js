/**
 * 환율 화면(exchange-rates) 고시 통화 목록과 동일한 코드·국가명.
 * 제품 등록 등 셀렉트 라벨: $(달러-미국), ₩(원화-한국) 형식.
 */

const KRW_CURRENCY = {
  code: 'KRW',
  country: '한국',
  currencyName: '원화',
  symbol: '₩'
};

/** exchangeRateCatalog.js 와 동일 순서·국가명 */
const EXCHANGE_RATE_CURRENCY_ROWS = [
  { code: 'USD', country: '미국', currencyName: '달러', symbol: '$' },
  { code: 'EUR', country: '유럽연합', currencyName: '유로', symbol: '€' },
  { code: 'JPY', country: '일본', currencyName: '엔', symbol: '¥' },
  { code: 'CNY', country: '중국', currencyName: '위안', symbol: '¥' },
  { code: 'HKD', country: '홍콩', currencyName: '홍콜달러', symbol: 'HK$' },
  { code: 'TWD', country: '대만', currencyName: '대만달러', symbol: 'NT$' },
  { code: 'GBP', country: '영국', currencyName: '파운드', symbol: '£' },
  { code: 'OMR', country: '오만', currencyName: '리얄', symbol: 'OMR' },
  { code: 'CAD', country: '캐나다', currencyName: '캐나다달러', symbol: 'C$' },
  { code: 'CHF', country: '스위스', currencyName: '프랑', symbol: 'CHF' },
  { code: 'SEK', country: '스웨덴', currencyName: '크로나', symbol: 'kr' },
  { code: 'AUD', country: '호주', currencyName: '호주달러', symbol: 'A$' },
  { code: 'NZD', country: '뉴질랜드', currencyName: '뉴질랜드달러', symbol: 'NZ$' },
  { code: 'CZK', country: '체코', currencyName: '코루나', symbol: 'Kč' },
  { code: 'CLP', country: '칠레', currencyName: '페소', symbol: 'CLP' },
  { code: 'TRY', country: '튀르키예', currencyName: '리라', symbol: '₺' },
  { code: 'MNT', country: '몽골', currencyName: '투그릭', symbol: '₮' },
  { code: 'ILS', country: '이스라엘', currencyName: '세켈', symbol: '₪' },
  { code: 'DKK', country: '덴마크', currencyName: '크로네', symbol: 'kr' },
  { code: 'NOK', country: '노르웨이', currencyName: '크로네', symbol: 'kr' },
  { code: 'SAR', country: '사우디아라비아', currencyName: '리얄', symbol: 'SAR' },
  { code: 'KWD', country: '쿠웨이트', currencyName: '디나르', symbol: 'KWD' },
  { code: 'BHD', country: '바레인', currencyName: '디나르', symbol: 'BHD' },
  { code: 'AED', country: '아랍에미리트', currencyName: '디르함', symbol: 'AED' },
  { code: 'JOD', country: '요르단', currencyName: '디나르', symbol: 'JOD' },
  { code: 'EGP', country: '이집트', currencyName: '파운드', symbol: 'EGP' },
  { code: 'THB', country: '태국', currencyName: '바트', symbol: '฿' },
  { code: 'SGD', country: '싱가포르', currencyName: '싱가포르달러', symbol: 'S$' },
  { code: 'MYR', country: '말레이시아', currencyName: '링깃', symbol: 'RM' },
  { code: 'IDR', country: '인도네시아', currencyName: '루피아', symbol: 'Rp' },
  { code: 'QAR', country: '카타르', currencyName: '리얄', symbol: 'QAR' },
  { code: 'KZT', country: '카자흐스탄', currencyName: '텡게', symbol: '₸' },
  { code: 'BND', country: '브루나이', currencyName: '브루나이달러', symbol: 'B$' },
  { code: 'INR', country: '인도', currencyName: '루피', symbol: '₹' },
  { code: 'PKR', country: '파키스탄', currencyName: '루피', symbol: 'PKR' },
  { code: 'BDT', country: '방글라데시', currencyName: '타카', symbol: '৳' },
  { code: 'PHP', country: '필리핀', currencyName: '페소', symbol: '₱' },
  { code: 'MXN', country: '멕시코', currencyName: '페소', symbol: 'MX$' },
  { code: 'BRL', country: '브라질', currencyName: '헤알', symbol: 'R$' },
  { code: 'VND', country: '베트남', currencyName: '동', symbol: '₫' },
  { code: 'ZAR', country: '남아프리카 공화국', currencyName: '랜드', symbol: 'R' },
  { code: 'RUB', country: '러시아', currencyName: '루블', symbol: '₽' },
  { code: 'HUF', country: '헝가리', currencyName: '포린트', symbol: 'Ft' },
  { code: 'PLN', country: '폴란드', currencyName: '즐로티', symbol: 'zł' },
  { code: 'LKR', country: '스리랑카', currencyName: '루피', symbol: 'LKR' },
  { code: 'DZD', country: '알제리', currencyName: '디나르', symbol: 'DZD' },
  { code: 'KES', country: '케냐', currencyName: '실링', symbol: 'KES' },
  { code: 'COP', country: '콜롬비아', currencyName: '페소', symbol: 'COP' },
  { code: 'TZS', country: '탄자니아', currencyName: '실링', symbol: 'TZS' },
  { code: 'NPR', country: '네팔', currencyName: '루피', symbol: 'NPR' },
  { code: 'RON', country: '루마니아', currencyName: '레우', symbol: 'RON' },
  { code: 'LYD', country: '리비아', currencyName: '디나르', symbol: 'LYD' },
  { code: 'MOP', country: '마카오', currencyName: '파타카', symbol: 'MOP' },
  { code: 'MMK', country: '미얀마', currencyName: '짯', symbol: 'MMK' },
  { code: 'ETB', country: '에티오피아', currencyName: '비르', symbol: 'ETB' },
  { code: 'UZS', country: '우즈베키스탄', currencyName: '숨', symbol: 'UZS' },
  { code: 'KHR', country: '캄보디아', currencyName: '리엘', symbol: 'KHR' },
  { code: 'FJD', country: '피지', currencyName: '피지달러', symbol: 'FJD' }
];

const CURRENCY_META_BY_CODE = new Map(
  [KRW_CURRENCY, ...EXCHANGE_RATE_CURRENCY_ROWS].map((row) => [row.code, row])
);

/** @returns {string} 예: $(달러-미국) */
export function formatCurrencySelectLabel(row) {
  const code = String(row?.code || '').trim().toUpperCase();
  const meta = CURRENCY_META_BY_CODE.get(code) || {
    code,
    country: row?.country || code,
    currencyName: row?.currencyName || code,
    symbol: row?.symbol || code
  };
  return `${meta.symbol}(${meta.currencyName}-${meta.country})`;
}

/** 환율 화면 통화 + KRW(기본). value=ISO 코드, label=표시용 */
export const PRODUCT_CURRENCY_SELECT_OPTIONS = [
  {
    value: KRW_CURRENCY.code,
    label: formatCurrencySelectLabel(KRW_CURRENCY),
    country: KRW_CURRENCY.country,
    code: KRW_CURRENCY.code
  },
  ...EXCHANGE_RATE_CURRENCY_ROWS.map((row) => ({
    value: row.code,
    label: formatCurrencySelectLabel(row),
    country: row.country,
    code: row.code
  }))
];

export function getCurrencyMeta(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return KRW_CURRENCY;
  return (
    CURRENCY_META_BY_CODE.get(normalized) || {
      code: normalized,
      country: normalized,
      currencyName: normalized,
      symbol: normalized
    }
  );
}

export function getCurrencySymbol(code) {
  return getCurrencyMeta(code).symbol;
}

export function getCurrencySelectLabel(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return formatCurrencySelectLabel(KRW_CURRENCY);
  const found = PRODUCT_CURRENCY_SELECT_OPTIONS.find((opt) => opt.value === normalized);
  if (found) return found.label;
  return formatCurrencySelectLabel(getCurrencyMeta(normalized));
}

/** 수출입은행 AP01 고시가 있는 통화만 — KRW 항상 포함 */
export function buildAvailableCurrencyCodesFromDealBasRMap(dealBasRMap) {
  const codes = new Set(['KRW']);
  for (const [code, rate] of Object.entries(dealBasRMap || {})) {
    const normalized = String(code || '').trim().toUpperCase();
    const n = Number(rate);
    if (normalized && Number.isFinite(n) && n > 0) codes.add(normalized);
  }
  return codes;
}

/** 셀렉트·엑셀 미리보기용 — Exim dealBasR 기준 필터 */
export function buildEximAvailableCurrencySelectOptions(dealBasRMap, currentValue = '') {
  const availableCodes = buildAvailableCurrencyCodesFromDealBasRMap(dealBasRMap);
  return resolveProductCurrencySelectOptions(currentValue, { availableCodes });
}

export function buildEximAvailableCurrencyPreviewOptions(dealBasRMap, currentValue = '') {
  return buildEximAvailableCurrencySelectOptions(dealBasRMap, currentValue).map((opt) => ({
    value: opt.value,
    label: opt.label
  }));
}

/**
 * @param {string} currentValue
 * @param {{ availableCodes?: Set<string>|string[]|null }} [opts] 환율 고시가 있는 통화만 (KRW 항상 포함)
 */
export function resolveProductCurrencySelectOptions(currentValue, opts = {}) {
  const normalized = String(currentValue || '').trim().toUpperCase();
  let base = PRODUCT_CURRENCY_SELECT_OPTIONS;

  const { availableCodes = null } = opts;
  if (availableCodes instanceof Set && availableCodes.size > 0) {
    base = base.filter((opt) => availableCodes.has(opt.value));
  } else if (Array.isArray(availableCodes) && availableCodes.length > 0) {
    const set = new Set(availableCodes.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean));
    set.add('KRW');
    base = base.filter((opt) => set.has(opt.value));
  }

  if (!normalized || base.some((opt) => opt.value === normalized)) {
    return base;
  }
  return [
    ...base,
    {
      value: normalized,
      label: getCurrencySelectLabel(normalized),
      country: normalized,
      code: normalized
    }
  ];
}
