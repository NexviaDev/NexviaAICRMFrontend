/**
 * 표시형식(회계·통화)용 통화 선택 — exchange-rates.js 와 동일 고시 통화·국기
 */
import { PRODUCT_CURRENCY_SELECT_OPTIONS } from '@/lib/exchange-rate-currency-options';
import { getCurrencyFlagSources } from '@/exchange-rates/exchange-rate-flags';
import { DISPLAY_FORMAT_CURRENCY_PRODUCT } from '@/lib/custom-field-display-format';
import './display-format-currency-picker.css';

function CurrencyFlag({ code, country }) {
  const flag = getCurrencyFlagSources(code);
  if (!flag) return null;
  return (
    <img
      className="df-currency-flag-img"
      src={flag.src}
      srcSet={flag.srcSet}
      alt=""
      title={country}
      width={20}
      height={15}
      loading="lazy"
      decoding="async"
    />
  );
}

export default function DisplayFormatCurrencyPicker({
  value,
  onChange,
  entityType = 'product',
  disabled = false,
  compact = false,
  id,
  className = ''
}) {
  const showProductOption = entityType === 'product';
  let normalized = String(value || DISPLAY_FORMAT_CURRENCY_PRODUCT).trim().toUpperCase();
  if (!showProductOption && normalized === DISPLAY_FORMAT_CURRENCY_PRODUCT) {
    normalized = 'KRW';
  }
  const previewOpt = PRODUCT_CURRENCY_SELECT_OPTIONS.find((o) => o.value === normalized);

  return (
    <div
      className={`df-currency-picker${compact ? ' df-currency-picker--compact' : ''}${className ? ` ${className}` : ''}`}
    >
      <label className="df-currency-picker-label" htmlFor={id}>
        표시 통화
      </label>
      <div className="df-currency-picker-select-wrap">
        <select
          id={id}
          className="df-currency-picker-select"
          value={normalized}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label="표시 통화"
        >
          {showProductOption ? (
            <option value={DISPLAY_FORMAT_CURRENCY_PRODUCT}>제품 통화 (행별 자동)</option>
          ) : null}
          {PRODUCT_CURRENCY_SELECT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {normalized !== DISPLAY_FORMAT_CURRENCY_PRODUCT ? (
          <span className="df-currency-picker-preview" aria-hidden="true">
            <CurrencyFlag code={normalized} country={previewOpt?.country} />
            <span className="df-currency-picker-preview-code">{normalized}</span>
          </span>
        ) : (
          <span className="df-currency-picker-preview df-currency-picker-preview--product" aria-hidden="true">
            제품별
          </span>
        )}
      </div>
    </div>
  );
}
