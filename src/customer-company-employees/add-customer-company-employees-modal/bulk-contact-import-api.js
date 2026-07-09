import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';
import {
  BULK_ROW_EXCLUDE,
  BULK_ROW_FORCE,
  BULK_ROW_MERGE,
  parseBulkPerRowResolution
} from './bulk-contact-merge-utils';

export function rowNeedsContactDuplicateHold(preResult) {
  if (!preResult) return false;
  return Array.isArray(preResult.contactCandidates) && preResult.contactCandidates.length > 0;
}

/** 미리보기 행 → bulk-import API row */
export function buildBulkImportRowPayload(row, formatPhoneInput) {
  return {
    name: String(row.name || '').replace(/\s/g, '').trim(),
    email: (row.email || '').trim(),
    phone: row.phone && formatPhoneInput ? formatPhoneInput(String(row.phone)) : (row.phone || '').trim(),
    position: (row.position || '').trim() || undefined,
    address: (row.address || '').trim() || undefined,
    birthDate: (row.birthDate || '').trim() || undefined,
    memo: (row.memo || '').trim() || undefined,
    leadSource: (row.leadSource || '').trim() || undefined,
    status: row.status || 'Lead',
    companyName: (row.companyName || '').trim(),
    companyCode: (row.companyCode || '').trim(),
    customerCompanyId: row.customerCompanyId != null ? String(row.customerCompanyId).trim() : '',
    linkedCompany: row.linkedCompany,
    customFields: row.customFields && typeof row.customFields === 'object' ? row.customFields : undefined
  };
}

/**
 * @param {object} opts
 * @param {boolean} opts.rowNeedsHold - (preResult, entry) => boolean
 */
export function buildBulkImportRequestItems(rows, preResults, forceAll, { rowNeedsHold, formatPhoneInput }) {
  const items = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const pr = (preResults && preResults[i]) || {};
    const decisionKey = Number.isInteger(Number(pr.index)) ? String(Number(pr.index)) : String(i);
    const { rowDecision, mergeContactId, mergeCompanyId } = parseBulkPerRowResolution(forceAll, decisionKey);
    const hold = typeof rowNeedsHold === 'function' ? rowNeedsHold(pr) : false;

    if (
      rowDecision === BULK_ROW_EXCLUDE ||
      (hold && rowDecision !== BULK_ROW_FORCE && rowDecision !== BULK_ROW_MERGE && forceAll !== true)
    ) {
      items.push({ index: i, action: 'skip' });
      continue;
    }

    if (rowDecision === BULK_ROW_MERGE && mergeContactId) {
      items.push({
        index: i,
        action: 'merge',
        mergeEmployeeId: mergeContactId,
        mergeCustomerCompanyId: mergeCompanyId || undefined,
        row: buildBulkImportRowPayload(row, formatPhoneInput)
      });
      continue;
    }

    const forceDup = hold && (forceAll === true || rowDecision === BULK_ROW_FORCE);
    items.push({
      index: i,
      action: 'create',
      mergeCustomerCompanyId:
        rowDecision === BULK_ROW_MERGE && mergeCompanyId ? mergeCompanyId : undefined,
      forceCreateDespiteContactDuplicate: !!forceDup,
      row: buildBulkImportRowPayload(row, formatPhoneInput)
    });
  }
  return items;
}

export async function postBulkContactImportFromPreview({
  items,
  assigneeUserIds,
  defaultCustomFields,
  fixedCustomerCompanyId,
  fixedCompanyName,
  getAuthHeader
}) {
  await pingBackendHealth(getAuthHeader);
  const res = await fetch(`${API_BASE}/customer-company-employees/bulk-import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(typeof getAuthHeader === 'function' ? getAuthHeader() : getAuthHeader || {}) },
    credentials: 'include',
    body: JSON.stringify({
      items,
      assigneeUserIds: Array.isArray(assigneeUserIds) ? assigneeUserIds : [],
      defaultCustomFields: defaultCustomFields && typeof defaultCustomFields === 'object' ? defaultCustomFields : {},
      fixedCustomerCompanyId: fixedCustomerCompanyId || undefined,
      fixedCompanyName: fixedCompanyName || undefined
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || '대량 등록에 실패했습니다.');
  }
  const s = data.summary || {};
  return {
    success: s.success ?? 0,
    merged: s.merged ?? 0,
    fail: s.fail ?? 0,
    skipped: s.skipped ?? 0,
    total: s.total ?? items.length,
    created: s.created ?? Math.max(0, (s.success ?? 0) - (s.merged ?? 0))
  };
}
