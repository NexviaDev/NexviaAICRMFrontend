import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';

/** 예전 브라우저 전용 저장 — 1회 서버 이전 후 해당 회사 버킷 제거 */
const LS_KEY = 'nexvia_opp_merge_mapping_presets_v1';

/** Company.listTemplates.opportunityMergeMappingPresets 와 동일 키 (백엔드와 맞출 것) */
export const OPPORTUNITY_MERGE_MAPPING_LIST_TEMPLATES_KEY = 'opportunityMergeMappingPresets';

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function legacyLoadFromLocal(companyKey) {
  const ck = String(companyKey || 'default');
  const root = safeParse(typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) || '' : '') || {};
  const bucket = root[ck];
  return Array.isArray(bucket) ? bucket : [];
}

function legacyClearCompany(companyKey) {
  if (typeof localStorage === 'undefined') return;
  const ck = String(companyKey || 'default');
  const root = safeParse(localStorage.getItem(LS_KEY) || '') || {};
  if (!Object.prototype.hasOwnProperty.call(root, ck)) return;
  delete root[ck];
  const keys = Object.keys(root);
  if (keys.length === 0) localStorage.removeItem(LS_KEY);
  else localStorage.setItem(LS_KEY, JSON.stringify(root));
}

/**
 * @param {() => object} getAuthHeader
 * @returns {Promise<{ id: string, name: string, docKind: 'quote'|'po', presetId: string, mappings: Record<string, object|string> }[]>}
 */
export async function fetchOpportunityMergeMappingPresets(getAuthHeader) {
  const res = await fetch(`${API_BASE}/companies/opportunity-merge-mapping-presets`, {
    headers: { ...getAuthHeader() },
    credentials: 'include'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '매핑 양식을 불러오지 못했습니다.');
  return Array.isArray(data.items) ? data.items : [];
}

/**
 * @param {() => object} getAuthHeader
 * @param {object[]} items 전체 목록(덮어쓰기)
 */
export async function putOpportunityMergeMappingPresets(getAuthHeader, items) {
  const res = await fetch(`${API_BASE}/companies/opportunity-merge-mapping-presets`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify({ items: Array.isArray(items) ? items : [] })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '매핑 양식을 저장하지 못했습니다.');
  return { items: Array.isArray(data.items) ? data.items : [] };
}

/**
 * 서버 목록을 불러오고, 비어 있으면 예전 localStorage 값을 1회 업로드합니다.
 * @param {string} companyKey
 * @param {() => object} getAuthHeader
 */
export async function fetchOpportunityMergeMappingPresetsWithMigration(companyKey, getAuthHeader) {
  await pingBackendHealth();
  let items = await fetchOpportunityMergeMappingPresets(getAuthHeader);
  if (items.length === 0 && companyKey) {
    const legacy = legacyLoadFromLocal(companyKey);
    if (legacy.length) {
      try {
        const { items: uploaded } = await putOpportunityMergeMappingPresets(getAuthHeader, legacy);
        items = uploaded;
        legacyClearCompany(companyKey);
      } catch {
        /* 서버 저장 실패 시 로컬은 유지 */
      }
    }
  }
  return items;
}

export function newMappingPresetId() {
  return `mp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
