/**
 * 영업기회 lineItems 가격·수수료·순이익 (백엔드 opportunityLinePricing.js 와 동기)
 */

export const DEFAULT_HANDLING_RATE = 0.05;
export const DEFAULT_RPI_RATE = 0.16;
export const LICENSE_ANNUAL_DAYS_PER_YEAR = 364;

export function toMoneyNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function sumCommissionRecipients(commissionRecipients) {
  if (!Array.isArray(commissionRecipients)) return 0;
  return Math.round(
    commissionRecipients.reduce((sum, r) => sum + toMoneyNumber(r?.commissionAmount), 0)
  );
}

export function computeLineFinalValue(qty, unit, dRate, dAmount) {
  const q = Math.max(0, Number(qty) || 0);
  const u = Math.max(0, Number(unit) || 0);
  let subtotal = q * u;
  const dr = Math.max(0, Math.min(100, Number(dRate) || 0));
  const da = Math.max(0, Number(dAmount) || 0);
  if (dr > 0) subtotal *= 1 - dr / 100;
  subtotal = Math.max(0, subtotal - da);
  return Math.round(subtotal);
}

export function computeLineNetProfitAfterCommission(line, parseNumber = Number) {
  const qty = Math.max(0, Number(line?.quantity) || 0);
  const parseAmt = (v) => {
    const n = typeof parseNumber === 'function' ? parseNumber(v) : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const finalAmt = computeLineFinalValue(
    qty,
    parseAmt(line?.unitPrice),
    line?.discountRate,
    parseAmt(line?.discountAmount)
  );
  const unitCost = toMoneyNumber(line?.productCostPriceSnapshot);
  const costTotal = Math.round(unitCost * qty);
  const commission = sumCommissionRecipients(line?.commissionRecipients);
  const stored = line?.snapshotNetProfitAfterCommission;
  if (stored != null && line?.pricingFrozenAt) return toMoneyNumber(stored);
  return Math.round(finalAmt - costTotal - commission);
}

function addDaysLocal(ymd, days) {
  const s = String(ymd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addMonthsLocalYmd(ymd, months) {
  const s = String(ymd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 라이선스 종료일 YYYY-MM-DD — 연간 1년 = 시작일 + 364일 */
export function computeLicenseCompletionDateYmd(startDateYmd, billingType, billingInterval = 1) {
  const start = String(startDateYmd || '').trim();
  if (!start) return '';
  const n = Math.max(1, Math.min(99, Math.floor(Number(billingInterval) || 1)));
  const bt = String(billingType || 'Monthly').trim();
  if (bt === 'Perpetual') return '';
  if (bt === 'Annual') {
    const days = n * (LICENSE_ANNUAL_DAYS_PER_YEAR + 1) - 1;
    return addDaysLocal(start, days);
  }
  if (bt === 'Monthly') {
    const end = addMonthsLocalYmd(start, n);
    return end ? addDaysLocal(end, -1) : '';
  }
  return '';
}

/** 제품 billingType/Interval 로 종료일 자동 계산 */
export function suggestCompletionDateFromProduct(startDateYmd, product) {
  if (!product || !startDateYmd) return '';
  return computeLicenseCompletionDateYmd(
    startDateYmd,
    product.billingType || 'Monthly',
    product.billingInterval ?? 1
  );
}

export function sumLineRpiAmountKrw(line) {
  const unit = toMoneyNumber(line?.snapshotRpiAmountKrw);
  if (!unit) return 0;
  const qty = Math.max(0, Number(line?.quantity) || 0);
  return Math.round(unit * qty);
}

export function sumLineHandlingAmountKrw(line) {
  const unit = toMoneyNumber(line?.snapshotHandlingAmountKrw);
  if (!unit) return 0;
  const qty = Math.max(0, Number(line?.quantity) || 0);
  return Math.round(unit * qty);
}

export function sumLinesRpiTotal(lines) {
  if (!Array.isArray(lines)) return 0;
  return lines.reduce((s, l) => s + sumLineRpiAmountKrw(l), 0);
}

export function sumLinesHandlingTotal(lines) {
  if (!Array.isArray(lines)) return 0;
  return lines.reduce((s, l) => s + sumLineHandlingAmountKrw(l), 0);
}

export function sumLinesCommissionTotal(lines, parseNumber = Number) {
  if (!Array.isArray(lines)) return 0;
  return lines.reduce((sum, line) => {
    const rows = Array.isArray(line?.commissionRecipients) ? line.commissionRecipients : [];
    return (
      sum +
      rows.reduce((s, r) => {
        const n =
          typeof parseNumber === 'function' ? parseNumber(r?.commissionAmount) : Number(r?.commissionAmount);
        return s + (Number.isFinite(n) ? n : 0);
      }, 0)
    );
  }, 0);
}

export function formatPricingSnapshotHint(line) {
  const parts = [];
  if (line?.snapshotOrderExchangeRate != null) {
    parts.push(`발주환율 ${Number(line.snapshotOrderExchangeRate).toLocaleString('ko-KR')}`);
  }
  if (line?.snapshotRpiAmountKrw != null) {
    parts.push(`RPI ₩${Number(line.snapshotRpiAmountKrw).toLocaleString('ko-KR')}`);
  }
  if (line?.snapshotHandlingAmountKrw != null) {
    parts.push(`핸들링 ₩${Number(line.snapshotHandlingAmountKrw).toLocaleString('ko-KR')}`);
  }
  return parts.join(' · ');
}
