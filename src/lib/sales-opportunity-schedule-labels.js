import { API_BASE } from '@/config';

/** 기회 일정 커스텀 필드 정의가 바뀌었을 때 — 파이프라인·표·열 설정 모달이 라벨 맵을 다시 받도록 */
export const SALES_OPPORTUNITY_SCHEDULE_DEFS_CHANGED = 'nexvia-sales-opportunity-schedule-defs-changed';

export function dispatchSalesOpportunityScheduleDefsChanged() {
  try {
    window.dispatchEvent(new CustomEvent(SALES_OPPORTUNITY_SCHEDULE_DEFS_CHANGED));
  } catch {
    /* ignore */
  }
}

function defaultGetAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * GET /custom-field-definitions?entityType=salesOpportunitySchedule 의 items 로부터
 * scheduleCustomDates.{key} 헤더용 맵. 정의 key 와 Mongo _id 문자열 둘 다 넣어 레거시·불일치 완화.
 */
/** entityType salesOpportunitySchedule 정의에 등록된 필드 key 만 (열·표시 후보 화이트리스트) */
export function buildAllowedScheduleCustomDateKeysFromApiItems(items) {
  const s = new Set();
  if (!Array.isArray(items)) return s;
  for (const d of items) {
    if (d?.key) s.add(String(d.key).trim());
  }
  return s;
}

export function buildScheduleFieldLabelMapFromApiItems(items) {
  const map = {};
  if (!Array.isArray(items)) return map;
  for (const d of items) {
    if (!d || typeof d !== 'object') continue;
    const keyRaw = d.key != null ? String(d.key).trim() : '';
    const labelFromDef = d.label != null ? String(d.label).trim() : '';
    const resolvedLabel = labelFromDef || keyRaw;
    if (keyRaw) map[keyRaw] = resolvedLabel || keyRaw;
    if (d._id != null) {
      const idStr = String(d._id);
      const v = keyRaw ? map[keyRaw] : resolvedLabel;
      if (v) map[idStr] = v;
    }
  }
  return map;
}

/** scheduleCustomDates 의 객체 키(inner) → 표시 라벨 */
export function resolveScheduleInnerLabel(inner, labelByKey = {}) {
  if (inner == null || inner === '') return null;
  const s = String(inner).trim();
  if (!s) return null;
  if (labelByKey[s]) return labelByKey[s];
  const lower = s.toLowerCase();
  for (const k of Object.keys(labelByKey)) {
    if (k.toLowerCase() === lower) return labelByKey[k];
  }
  return null;
}

/** 열 키 `scheduleCustomDates.xxx` → 헤더 문자열 (정의 없으면 일정·xxx) */
export function scheduleCustomDatesColumnTitle(colKey, labelByKey = {}) {
  if (!String(colKey).startsWith('scheduleCustomDates.')) return null;
  const inner = String(colKey).slice('scheduleCustomDates.'.length);
  const resolved = resolveScheduleInnerLabel(inner, labelByKey);
  if (resolved) {
    const t = String(resolved).trim();
    return t || `일정·${inner}`;
  }
  return `일정·${inner}`;
}

export async function fetchSalesOpportunityScheduleFieldContext(getAuthHeader = defaultGetAuthHeader) {
  try {
    const res = await fetch(
      `${API_BASE}/custom-field-definitions?entityType=salesOpportunitySchedule`,
      { headers: { ...getAuthHeader() }, credentials: 'include' }
    );
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

export async function fetchSalesOpportunityScheduleLabelMap(getAuthHeader = defaultGetAuthHeader) {
  const { labelByKey } = await fetchSalesOpportunityScheduleFieldContext(getAuthHeader);
  return labelByKey;
}
