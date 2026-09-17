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

/** 서버 한 요청당 상한 (backend/lib/bulkContactImportFromPreview.js BULK_IMPORT_MAX_ITEMS, save-preflight 도 동일) */
export const BULK_CONTACT_REQUEST_CHUNK = 200;

function chunkArray(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * save-preflight 를 200건씩 나눠 호출하고, 결과 index 를 전체 기준으로 맞춰 이어 붙입니다.
 * (한 번에 보냈을 때와 같은 모양: results[i].index === i)
 */
export async function postContactSavePreflightInChunks({ entries, getAuthHeader }) {
  const list = Array.isArray(entries) ? entries : [];
  const results = [];
  let offset = 0;
  for (const chunk of chunkArray(list, BULK_CONTACT_REQUEST_CHUNK)) {
    const res = await fetch(`${API_BASE}/customer-company-employees/save-preflight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(typeof getAuthHeader === 'function' ? getAuthHeader() : {}) },
      credentials: 'include',
      body: JSON.stringify({ entries: chunk })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '대량 등록을 미리 확인하는 데 실패했습니다.');
    const part = Array.isArray(data.results) ? data.results : [];
    part.forEach((pr, i) => {
      const localIndex = Number.isInteger(Number(pr?.index)) ? Number(pr.index) : i;
      results.push({ ...pr, index: offset + localIndex });
    });
    offset += chunk.length;
  }
  return results;
}

/**
 * bulk-import 를 200건씩 순서대로 나눠 보내고 요약을 합칩니다.
 *
 * 서버는 한 요청 안에서 같은 회사명(공백·㈜ 등을 무시한 키)을 한 고객사로 묶는데,
 * 요청이 바뀌면 그 기억이 사라집니다. 응답의 batchCompanyKeys 를 다음 요청에 넘겨
 * 한 번에 보냈을 때와 같은 결과가 나오게 합니다.
 *
 * 중간 묶음에서 실패하면 앞 묶음은 이미 저장된 상태이므로, 에러에 저장된 건수를 담아 던집니다.
 */
export async function postBulkContactImportInChunks({ items, onProgress, ...rest }) {
  const list = Array.isArray(items) ? items : [];
  const chunks = chunkArray(list, BULK_CONTACT_REQUEST_CHUNK);
  const total = { success: 0, merged: 0, fail: 0, skipped: 0, total: 0, created: 0 };
  let batchCompanyKeys = {};
  let sent = 0;

  for (let c = 0; c < chunks.length; c += 1) {
    if (typeof onProgress === 'function') {
      onProgress({ chunkIndex: c, chunkCount: chunks.length, sentItems: sent, totalItems: list.length });
    }
    let part;
    try {
      part = await postBulkContactImportFromPreview({ ...rest, items: chunks[c], batchCompanyKeys });
    } catch (e) {
      const err = new Error(
        sent > 0
          ? `${list.length}건 중 앞 ${sent}건은 이미 처리되었고, 이후 등록에 실패했습니다: ${e.message || '오류'}`
          : e.message || '대량 등록에 실패했습니다.'
      );
      err.partial = { ...total, processedItems: sent };
      throw err;
    }
    for (const key of Object.keys(total)) total[key] += Number(part[key]) || 0;
    batchCompanyKeys = part.batchCompanyKeys || batchCompanyKeys;
    sent += chunks[c].length;
  }
  return total;
}

export async function postBulkContactImportFromPreview({
  items,
  assigneeUserIds,
  defaultCustomFields,
  fixedCustomerCompanyId,
  fixedCompanyName,
  batchCompanyKeys,
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
      fixedCompanyName: fixedCompanyName || undefined,
      batchCompanyKeys: batchCompanyKeys && Object.keys(batchCompanyKeys).length ? batchCompanyKeys : undefined
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
    created: s.created ?? Math.max(0, (s.success ?? 0) - (s.merged ?? 0)),
    batchCompanyKeys: s.batchCompanyKeys && typeof s.batchCompanyKeys === 'object' ? s.batchCompanyKeys : {}
  };
}
