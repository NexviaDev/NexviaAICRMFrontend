import { formatNumberInput } from '@/lib/sales-opportunity-form-shared';
import { toDateInputValue, normalizeDateTypingValue } from './vacation-leave-utils';

function isValidDateParts(y, m, d) {
  const dt = new Date(y, m - 1, d);
  return (
    Number.isInteger(y) &&
    y >= 1000 &&
    y <= 9999 &&
    dt.getFullYear() === y &&
    dt.getMonth() + 1 === m &&
    dt.getDate() === d
  );
}

export function toExpenseDateTimeValue(raw) {
  if (!raw) return '';
  const s = String(raw).trim().replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const dateOnly = toDateInputValue(s);
    return dateOnly ? `${dateOnly} 00:00` : '';
  }
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(s)) {
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(5, 7));
    const d = Number(s.slice(8, 10));
    const hh = Number(s.slice(11, 13));
    const mm = Number(s.slice(14, 16));
    if (!isValidDateParts(y, m, d)) return '';
    if (Number.isNaN(hh) || hh < 0 || hh > 23) return '';
    if (Number.isNaN(mm) || mm < 0 || mm > 59) return '';
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  if (/^\d{12}$/.test(s)) {
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(4, 6));
    const d = Number(s.slice(6, 8));
    const hh = Number(s.slice(8, 10));
    const mm = Number(s.slice(10, 12));
    if (!isValidDateParts(y, m, d)) return '';
    if (Number.isNaN(hh) || hh < 0 || hh > 23) return '';
    if (Number.isNaN(mm) || mm < 0 || mm > 59) return '';
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  if (/^\d{8}$/.test(s)) {
    const dateOnly = toDateInputValue(s);
    return dateOnly ? `${dateOnly} 00:00` : '';
  }
  return '';
}

export function normalizeExpenseDateTimeTypingValue(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 12);
  const dateDigits = digits.slice(0, 8);
  const datePart = normalizeDateTypingValue(dateDigits);
  if (!datePart) return '';
  const hhDigits = digits.slice(8, 10);
  const mmDigits = digits.slice(10, 12);
  if (!hhDigits) return datePart;
  let hh = hhDigits;
  if (hhDigits.length === 2) {
    const n = Number(hhDigits);
    if (!Number.isNaN(n)) hh = String(Math.min(23, Math.max(0, n))).padStart(2, '0');
  }
  if (!mmDigits) return `${datePart} ${hh}`;
  let mm = mmDigits;
  if (mmDigits.length === 2) {
    const n = Number(mmDigits);
    if (!Number.isNaN(n)) mm = String(Math.min(59, Math.max(0, n))).padStart(2, '0');
  }
  return `${datePart} ${hh}:${mm}`;
}

export function toExpenseDateTimeLocalValue(raw) {
  const normalized = toExpenseDateTimeValue(raw);
  if (!normalized) return '';
  return normalized.replace(' ', 'T');
}

export function emptyExpenseLine() {
  return {
    expenseDate: '',
    category: '',
    content: '',
    amount: '',
    user: '',
    note: '',
    customValues: {}
  };
}

function normalizeCustomValues(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  Object.entries(raw).forEach(([k, v]) => {
    const key = String(k || '').trim().slice(0, 40);
    if (!key) return;
    out[key] = String(v ?? '').trim();
  });
  return out;
}

function normalizeExpenseLineItem(raw = {}) {
  const amountRaw = raw.amount;
  const amount =
    amountRaw != null && amountRaw !== '' ? formatNumberInput(String(amountRaw)) : '';
  const expenseDateText = String(raw.expenseDate || '').trim();
  const parsedExpenseDate = toExpenseDateTimeValue(expenseDateText);
  return {
    // 입력 중(예: "2025060214")에는 값을 보존하고, 완성되면 YYYY-MM-DD HH:mm로 정규화한다.
    expenseDate: parsedExpenseDate || normalizeExpenseDateTimeTypingValue(expenseDateText) || '',
    // category/content는 독립 입력값으로 취급한다.
    category: String(raw.category || '').trim(),
    content: String(raw.content || raw.description || '').trim(),
    amount,
    user: String(raw.user || '').trim(),
    note: String(raw.note || '').trim(),
    customValues: normalizeCustomValues(raw.customValues)
  };
}

/** 구 단일 행 · items[] 모두 지원 */
export function normalizeExpenseFormData(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  if (Array.isArray(src.items) && src.items.length) {
    return { items: src.items.map(normalizeExpenseLineItem) };
  }
  if (src.expenseDate || src.content || src.category || src.amount || src.user || src.description) {
    return {
      items: [
        normalizeExpenseLineItem({
          expenseDate: src.expenseDate,
          category: src.category || src.content,
          content: src.content || src.description,
          amount: src.amount,
          user: src.user,
          note: src.note || ''
        })
      ]
    };
  }
  return { items: [emptyExpenseLine()] };
}

export function getExpenseItems(formData) {
  return normalizeExpenseFormData(formData).items;
}

export function sumExpenseAmounts(items) {
  return (items || []).reduce((sum, row) => {
    const n = Number(String(row?.amount || '').replace(/,/g, ''));
    return sum + (Number.isNaN(n) ? 0 : n);
  }, 0);
}
