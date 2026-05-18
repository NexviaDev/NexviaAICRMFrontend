import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';

export const MERGE_PDF_EXPORT_PRESETS_LIST_KEY = 'mergePdfExportPresets';

export function newMergePdfExportPresetId() {
  return `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** @param {() => object} getAuthHeader */
export async function fetchCompanyMergePdfExportPresets(getAuthHeader) {
  const res = await fetch(`${API_BASE}/companies/merge-pdf-export-presets`, {
    headers: { ...getAuthHeader() },
    credentials: 'include'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '회사 PDF 설정을 불러오지 못했습니다.');
  return Array.isArray(data.items) ? data.items : [];
}

/** @param {() => object} getAuthHeader */
export async function putCompanyMergePdfExportPresets(getAuthHeader, items) {
  const res = await fetch(`${API_BASE}/companies/merge-pdf-export-presets`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify({ items: Array.isArray(items) ? items : [] })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '회사 PDF 설정을 저장하지 못했습니다.');
  return Array.isArray(data.items) ? data.items : [];
}

/** @param {() => object} getAuthHeader */
export async function fetchPersonalMergePdfExportPresets(getAuthHeader) {
  const res = await fetch(`${API_BASE}/auth/merge-pdf-export-presets`, {
    headers: { ...getAuthHeader() },
    credentials: 'include'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '개인 PDF 설정을 불러오지 못했습니다.');
  return Array.isArray(data.items) ? data.items : [];
}

/** @param {() => object} getAuthHeader */
export async function putPersonalMergePdfExportPresets(getAuthHeader, items) {
  const res = await fetch(`${API_BASE}/auth/merge-pdf-export-presets`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify({ items: Array.isArray(items) ? items : [] })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '개인 PDF 설정을 저장하지 못했습니다.');
  return Array.isArray(data.items) ? data.items : [];
}

/** @param {() => object} getAuthHeader */
export async function fetchAllMergePdfExportPresets(getAuthHeader) {
  await pingBackendHealth();
  const [companyItems, personalItems] = await Promise.all([
    fetchCompanyMergePdfExportPresets(getAuthHeader),
    fetchPersonalMergePdfExportPresets(getAuthHeader)
  ]);
  return {
    companyItems,
    personalItems,
    merged: [
      ...companyItems.map((p) => ({ ...p, scope: 'company', pickKey: `company:${p.id}` })),
      ...personalItems.map((p) => ({ ...p, scope: 'personal', pickKey: `personal:${p.id}` }))
    ]
  };
}
