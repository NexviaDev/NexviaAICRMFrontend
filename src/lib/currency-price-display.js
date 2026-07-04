import React from 'react';
import { getCurrencyMeta, getCurrencySymbol } from '@/lib/exchange-rate-currency-options';
import {
  convertAmountToKrw,
  EXCHANGE_RATE_QUOTE_UNITS,
  formatKrwConvertedLabel
} from '@/lib/exchange-rate-convert';

/** 금액 + 통화 기호 (예: $1,234) */
export function formatPriceAmount(amount, currency) {
  if (amount == null || amount === '') return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  const sym = getCurrencySymbol(currency);
  return `${sym}${n.toLocaleString()}`;
}

/** 적용 환율 라벨 — 고정 시 「USD 1,350원/달러 고정 (시각)」 */
export function formatAppliedExchangeRateLabel(
  currency,
  dealBasRMap,
  { frozen = false, frozenAt = null } = {}
) {
  const code = String(currency || '').trim().toUpperCase();
  if (!code || code === 'KRW') return null;
  const rate = dealBasRMap?.[code];
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const meta = getCurrencyMeta(code);
  const quoteUnits = EXCHANGE_RATE_QUOTE_UNITS[code] || 1;
  const rateStr = Number(rate).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  const perUnit =
    quoteUnits === 100 ? `100${meta.currencyName || code}` : meta.currencyName || meta.symbol || code;
  const frozenTag = frozen ? ' 고정' : '';
  const frozenTime =
    frozen && frozenAt
      ? ` (${new Date(frozenAt).toLocaleString('ko-KR', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })})`
      : '';
  return `${code} ${rateStr}원/${perUnit}${frozenTag}${frozenTime}`;
}

function buildKrwHintText(amount, currency, dealBasRMap, { exchangeRatesFrozen, frozenAt, extraKrwHint } = {}) {
  if (extraKrwHint) return extraKrwHint;
  const code = String(currency || 'KRW').trim().toUpperCase();
  const n = Number(amount);
  const krw = convertAmountToKrw(amount, currency, dealBasRMap);
  const krwLabel =
    code !== 'KRW' && Number.isFinite(n) && n !== 0 && krw != null
      ? formatKrwConvertedLabel(krw)
      : null;
  if (!krwLabel) return null;
  let hint = `약 ${krwLabel}`;
  if (exchangeRatesFrozen) {
    const rateLabel = formatAppliedExchangeRateLabel(currency, dealBasRMap, {
      frozen: true,
      frozenAt
    });
    if (rateLabel) hint += ` · ${rateLabel}`;
  }
  return hint;
}

/** title 등 문자열용 — 원화 환산 힌트 포함 */
export function formatPriceWithKrwHintText(
  amount,
  currency,
  dealBasRMap,
  { exchangeRatesFrozen = false, frozenAt = null, extraKrwHint = null } = {}
) {
  const main = formatPriceAmount(amount, currency);
  if (main === '—') return main;
  const hint = buildKrwHintText(amount, currency, dealBasRMap, {
    exchangeRatesFrozen,
    frozenAt,
    extraKrwHint
  });
  if (!hint) return main;
  return `${main} (${hint})`;
}

export function PriceWithKrwHint({
  amount,
  currency,
  dealBasRMap,
  exchangeRatesFrozen = false,
  frozenAt = null,
  extraKrwHint = null,
  className = '',
  dashed = false,
  stackClassName = 'crm-price-stack',
  mainClassName = 'crm-price-main',
  hintClassName = 'crm-price-krw-hint'
}) {
  if (dashed) {
    return <span className={`${mainClassName} ${className}`.trim()}>-</span>;
  }
  const main = formatPriceAmount(amount, currency);
  if (main === '—') {
    return <span className={`${mainClassName} ${className}`.trim()}>{main}</span>;
  }
  const hintText = buildKrwHintText(amount, currency, dealBasRMap, {
    exchangeRatesFrozen,
    frozenAt,
    extraKrwHint
  });

  if (!hintText) {
    return <span className={`${mainClassName} ${className}`.trim()}>{main}</span>;
  }

  const hintTitle = exchangeRatesFrozen
    ? '고정된 매매기준율 기준 환산'
    : '환율 고시 매매기준율 기준 환산';

  return (
    <div className={stackClassName}>
      <span className={`${mainClassName} ${className}`.trim()}>{main}</span>
      <span className={hintClassName} title={hintTitle}>
        {hintText}
      </span>
    </div>
  );
}
