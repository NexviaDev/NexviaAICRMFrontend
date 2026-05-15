import { API_BASE } from '@/config';
import {
  buildAllowedScheduleCustomDateKeysFromApiItems,
  buildScheduleFieldLabelMapFromApiItems,
  resolveScheduleInnerLabel
} from '@/lib/sales-opportunity-schedule-labels';

/** 계약·수금 커스텀 필드 정의 변경 시 — 파이프라인·열 설정 모달이 라벨을 다시 받도록 */
export const SALES_OPPORTUNITY_FINANCE_DEFS_CHANGED = 'nexvia-sales-opportunity-finance-defs-changed';

export function dispatchSalesOpportunityFinanceDefsChanged() {
  try {
    window.dispatchEvent(new CustomEvent(SALES_OPPORTUNITY_FINANCE_DEFS_CHANGED));
  } catch {
    /* ignore */
  }
}

function defaultGetAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 열 키 `financeCustomFields.xxx` → 헤더 문자열 */
export function financeCustomFieldsColumnTitle(colKey, labelByKey = {}) {
  if (!String(colKey).startsWith('financeCustomFields.')) return null;
  const inner = String(colKey).slice('financeCustomFields.'.length);
  const resolved = resolveScheduleInnerLabel(inner, labelByKey);
  if (resolved) {
    const t = String(resolved).trim();
    return t || `추가·${inner}`;
  }
  return `추가·${inner}`;
}

export async function fetchSalesOpportunityFinanceFieldContext(getAuthHeader = defaultGetAuthHeader) {
  try {
    const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=salesOpportunityFinance`, {
      headers: { ...getAuthHeader() },
      credentials: 'include'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(data.items)) {
      return { labelByKey: {}, allowedKeys: new Set() };
    }
    return {
      labelByKey: buildScheduleFieldLabelMapFromApiItems(data.items),
      allowedKeys: buildAllowedScheduleCustomDateKeysFromApiItems(data.items)
    };
  } catch {
    return { labelByKey: {}, allowedKeys: new Set() };
  }
}
