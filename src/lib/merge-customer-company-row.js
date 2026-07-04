/**
 * 고객사 → 문서 메일머지 데이터 시트 행
 * 백엔드 lib/quoteMergeFieldCatalog.js DEFAULT_MERGE_FIELDS 키와 동기화
 */

function joinAddress(addr, detail) {
  const a = String(addr || '').trim();
  const d = String(detail || '').trim();
  if (!a) return d;
  if (!d) return a;
  return `${a} ${d}`;
}

function firstEmployeePhone(c) {
  const list = Array.isArray(c?.employeeList) ? c.employeeList : [];
  for (const e of list) {
    const p = String(e?.phone || '').trim();
    if (p) return p;
  }
  return '';
}

/** 고객사 목록/검색에서 받은 업체 → 메일머지 행 */
export function customerCompanyToMergeRow(c) {
  if (!c) return null;
  const companyPhone = String(c.phone || '').trim();
  const address = String(c.address || '').trim();
  const addressDetail = String(c.addressDetail || '').trim();
  return {
    companyName: c.name || '',
    representativeName: c.representativeName || '',
    representativeEmail: c.representativeEmail || '',
    businessNumber: c.businessNumber || '',
    businessType: c.businessType || '',
    businessItem: c.businessItem || '',
    subBusinessNumber: c.subBusinessNumber || '',
    phone: companyPhone || firstEmployeePhone(c),
    address,
    addressDetail,
    fullAddress: joinAddress(address, addressDetail),
    memo: c.memo || '',
    productLines: '',
    fileLabel: '',
    issueDate: '',
    _sourceCompanyId: c._id
  };
}
