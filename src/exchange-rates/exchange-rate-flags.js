/** ISO 3166-1 alpha-2 — CRM 환율 58통화 대표 국기 (flagcdn.com) */
const CURRENCY_FLAG_REGION = {
  USD: 'US',
  EUR: 'EU',
  JPY: 'JP',
  CNY: 'CN',
  HKD: 'HK',
  TWD: 'TW',
  GBP: 'GB',
  OMR: 'OM',
  CAD: 'CA',
  CHF: 'CH',
  SEK: 'SE',
  AUD: 'AU',
  NZD: 'NZ',
  CZK: 'CZ',
  CLP: 'CL',
  TRY: 'TR',
  MNT: 'MN',
  ILS: 'IL',
  DKK: 'DK',
  NOK: 'NO',
  SAR: 'SA',
  KWD: 'KW',
  BHD: 'BH',
  AED: 'AE',
  JOD: 'JO',
  EGP: 'EG',
  THB: 'TH',
  SGD: 'SG',
  MYR: 'MY',
  IDR: 'ID',
  QAR: 'QA',
  KZT: 'KZ',
  BND: 'BN',
  INR: 'IN',
  PKR: 'PK',
  BDT: 'BD',
  PHP: 'PH',
  MXN: 'MX',
  BRL: 'BR',
  VND: 'VN',
  ZAR: 'ZA',
  RUB: 'RU',
  HUF: 'HU',
  PLN: 'PL',
  LKR: 'LK',
  DZD: 'DZ',
  KES: 'KE',
  COP: 'CO',
  TZS: 'TZ',
  NPR: 'NP',
  RON: 'RO',
  LYD: 'LY',
  MOP: 'MO',
  MMK: 'MM',
  ETB: 'ET',
  UZS: 'UZ',
  KHR: 'KH',
  FJD: 'FJ'
};

const FLAG_CDN = 'https://flagcdn.com';

export function getCurrencyFlagRegion(currencyCode) {
  return CURRENCY_FLAG_REGION[String(currencyCode || '').toUpperCase()] || null;
}

/** @returns {{ src: string, srcSet: string } | null} */
export function getCurrencyFlagSources(currencyCode) {
  const region = getCurrencyFlagRegion(currencyCode);
  if (!region) return null;
  const cc = region.toLowerCase();
  const src = `${FLAG_CDN}/24x18/${cc}.png`;
  const src2x = `${FLAG_CDN}/48x36/${cc}.png`;
  return {
    src,
    srcSet: `${src} 1x, ${src2x} 2x`
  };
}
