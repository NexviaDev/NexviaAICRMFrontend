import { API_BASE } from '@/config';

export const BULK_ROW_EXCLUDE = 'exclude';
export const BULK_ROW_FORCE = 'force';
export const BULK_ROW_MERGE = 'merge';

function fillIfEmpty(patch, key, incoming, current) {
  const inc = incoming != null ? String(incoming).trim() : '';
  const cur = current != null ? String(current).trim() : '';
  if (inc && !cur) patch[key] = inc;
}

/** 기존 연락처에 빈 칸만 채우는 PATCH 본문 */
export function buildContactMergePatchFromImportRow(existing, importRow, formatPhoneInput) {
  if (!existing || !importRow) return {};
  const patch = {};
  const nameInc = importRow.name != null ? String(importRow.name).replace(/\s/g, '').trim() : '';
  fillIfEmpty(patch, 'name', nameInc, existing.name);
  fillIfEmpty(patch, 'email', importRow.email, existing.email);
  const phoneInc = importRow.phone && formatPhoneInput ? formatPhoneInput(String(importRow.phone)) : importRow.phone;
  fillIfEmpty(patch, 'phone', phoneInc, existing.phone);
  fillIfEmpty(patch, 'position', importRow.position, existing.position);
  fillIfEmpty(patch, 'address', importRow.address, existing.address);
  fillIfEmpty(patch, 'birthDate', importRow.birthDate, existing.birthDate);
  fillIfEmpty(patch, 'memo', importRow.memo, existing.memo);
  fillIfEmpty(patch, 'leadSource', importRow.leadSource, existing.leadSource);

  const existCustom =
    existing.customFields && typeof existing.customFields === 'object' ? { ...existing.customFields } : {};
  const incCustom =
    importRow.customFields && typeof importRow.customFields === 'object' ? importRow.customFields : {};
  const mergedCustom = { ...existCustom };
  let customChanged = false;
  for (const [k, v] of Object.entries(incCustom)) {
    const cur = mergedCustom[k] != null ? String(mergedCustom[k]).trim() : '';
    const inc = v != null ? String(v).trim() : '';
    if (inc && !cur) {
      mergedCustom[k] = v;
      customChanged = true;
    }
  }
  if (customChanged) patch.customFields = mergedCustom;

  return patch;
}

export async function fetchEmployeeForBulkMerge(employeeId, getAuthHeader) {
  const id = String(employeeId || '').trim();
  if (!id) return null;
  const res = await fetch(`${API_BASE}/customer-company-employees/${encodeURIComponent(id)}`, {
    headers: typeof getAuthHeader === 'function' ? getAuthHeader() : getAuthHeader || {}
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  return data;
}

/**
 * 등록 예정 행 → 기존 연락처에 병합(PATCH). 빈 필드만 채움.
 */
export async function mergeImportRowIntoExistingEmployee({
  employeeId,
  importRow,
  getAuthHeader,
  formatPhoneInput,
  mergeCompanyId
}) {
  const existing = await fetchEmployeeForBulkMerge(employeeId, getAuthHeader);
  if (!existing?._id) {
    return { ok: false, error: '기존 연락처를 불러오지 못했습니다.' };
  }

  const patch = buildContactMergePatchFromImportRow(existing, importRow, formatPhoneInput);
  const companyId = mergeCompanyId != null ? String(mergeCompanyId).trim() : '';
  if (companyId && !existing.customerCompanyId) {
    patch.customerCompanyId = companyId;
    const cn = (importRow.companyName || '').trim();
    if (cn) patch.companyName = cn;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, merged: true, unchanged: true };
  }

  const res = await fetch(`${API_BASE}/customer-company-employees/${encodeURIComponent(String(existing._id))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(typeof getAuthHeader === 'function' ? getAuthHeader() : getAuthHeader || {}) },
    body: JSON.stringify(patch)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data.error || '병합 저장에 실패했습니다.' };
  }
  return { ok: true, merged: true, employee: data };
}

export function parseBulkPerRowResolution(forceAll, decisionKey) {
  const perRowDecisions =
    forceAll && typeof forceAll === 'object' && forceAll.mode === 'perRow' && forceAll.decisions
      ? forceAll.decisions
      : null;
  const mergeContactIds =
    forceAll && typeof forceAll === 'object' && forceAll.mergeContactIds ? forceAll.mergeContactIds : null;
  const mergeCompanyIds =
    forceAll && typeof forceAll === 'object' && forceAll.mergeCompanyIds ? forceAll.mergeCompanyIds : null;
  const rowDecision = perRowDecisions ? perRowDecisions[decisionKey] : null;
  const mergeContactId = mergeContactIds ? mergeContactIds[decisionKey] : null;
  const mergeCompanyId = mergeCompanyIds ? mergeCompanyIds[decisionKey] : null;
  return { perRowDecisions, rowDecision, mergeContactId, mergeCompanyId };
}
