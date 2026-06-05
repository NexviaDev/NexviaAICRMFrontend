/**
 * 제품 결제 주기 — 월간·연간 주기 수(billingInterval) 공통 (프론트)
 */

export const PRODUCT_BILLING_TYPES = ['Monthly', 'Annual', 'Perpetual'];

export const PRODUCT_BILLING_LABELS = {
  Monthly: '월간',
  Annual: '연간',
  Perpetual: '영구'
};

export function clampBillingInterval(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 99);
}

export function normalizeBillingInterval(billingType, raw) {
  if (billingType === 'Perpetual') return 1;
  return clampBillingInterval(raw ?? 1);
}

export function billingIntervalUnitLabel(billingType) {
  if (billingType === 'Annual') return '년';
  if (billingType === 'Monthly') return '개월';
  return '';
}

export function formatProductBillingDisplay(billingType, billingInterval = 1) {
  const iv = normalizeBillingInterval(billingType, billingInterval);
  const base = PRODUCT_BILLING_LABELS[billingType] || billingType || '—';
  if (billingType === 'Perpetual' || iv === 1) return base;
  return `${base} ×${iv}`;
}

export function parseBillingIntervalInput(raw, billingType) {
  if (billingType === 'Perpetual') return 1;
  const s = String(raw ?? '').trim();
  if (!s) return 1;
  const cleaned = s.replace(/,/g, '').replace(/[^\d.]/g, '');
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 1) return 1;
  return clampBillingInterval(n);
}

export function showBillingIntervalInput(billingType) {
  return billingType === 'Monthly' || billingType === 'Annual';
}
