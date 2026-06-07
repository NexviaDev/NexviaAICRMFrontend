/**
 * 문서 메일머지 — 자사(our*) 강제 치환값 (로그인 사용자·소속 회사)
 * 백엔드 lib/quoteMergeOurForcedFields.js 와 키·라벨 동기화
 */

import {
  resolveDepartmentDisplayFromChart,
  resolveOrgChartFromListTemplates
} from '@/lib/org-chart-tree-utils';

export const OUR_MERGE_FIELD_PRESETS = [
  { key: 'ourCompanyName', label: '자사 회사명', example: '(주)넥스비아', valueKind: 'text' },
  { key: 'ourBusinessNumber', label: '자사 사업자등록번호', example: '123-45-67890', valueKind: 'text' },
  { key: 'ourRepresentativeName', label: '자사 대표자명', example: '홍길동', valueKind: 'text' },
  { key: 'ourAddress', label: '자사 주소', example: '서울특별시 …', valueKind: 'text' },
  { key: 'ourAddressDetail', label: '자사 상세주소', example: '00동 000호', valueKind: 'text' },
  { key: 'ourFullAddress', label: '자사 전체 주소', example: '서울특별시 … 00동', valueKind: 'text' },
  { key: 'ourPhone', label: '자사·담당 연락처', example: '010-1234-5678', valueKind: 'text' },
  { key: 'ourStaffName', label: '자사 담당자명', example: '김담당', valueKind: 'text' },
  { key: 'ourStaffEmail', label: '자사 담당 이메일', example: 'user@company.com', valueKind: 'text' },
  { key: 'ourStaffDepartment', label: '자사 담당 부서', example: '영업팀', valueKind: 'text' }
];

const OUR_KEY_SET = new Set(OUR_MERGE_FIELD_PRESETS.map((p) => p.key));

export function isOurForcedMergeFieldKey(key) {
  return OUR_KEY_SET.has(String(key || '').trim());
}

function joinAddress(addr, detail) {
  const a = String(addr || '').trim();
  const d = String(detail || '').trim();
  if (!a) return d;
  if (!d) return a;
  return `${a} ${d}`;
}

/** @param {object|null} user crm_user */
/** @param {object|null} company list-templates-bundle.company */
export function resolveOurForcedMergeValues(user, company, opts = {}) {
  const u = user && typeof user === 'object' ? user : {};
  const c = company && typeof company === 'object' ? company : {};
  const address = String(c.address || u.companyAddress || '').trim();
  const addressDetail = String(c.addressDetail || u.companyAddressDetail || '').trim();
  const deptRaw = String(u.companyDepartment || '').trim();
  const explicitDept = String(u.companyDepartmentDisplay || u.departmentDisplay || '').trim();
  const orgRoot =
    opts.orgChartRoot ||
    resolveOrgChartFromListTemplates(opts.listTemplates) ||
    resolveOrgChartFromListTemplates(c.listTemplates) ||
    null;
  const department = explicitDept || (deptRaw ? resolveDepartmentDisplayFromChart(orgRoot, deptRaw) : '');
  return {
    ourCompanyName: String(c.name || u.companyName || '').trim(),
    ourBusinessNumber: String(c.businessNumber || u.companyBusinessNumber || '').trim(),
    ourRepresentativeName: String(c.representativeName || '').trim(),
    ourAddress: address,
    ourAddressDetail: addressDetail,
    ourFullAddress: joinAddress(address, addressDetail),
    ourPhone: String(u.phone || '').trim(),
    ourStaffName: String(u.name || '').trim(),
    ourStaffEmail: String(u.email || '').trim(),
    ourStaffDepartment: department
  };
}

export function mergeOurForcedIntoFields(fields) {
  const list = Array.isArray(fields) ? fields.filter((f) => f && !isOurForcedMergeFieldKey(f.key)) : [];
  const seen = new Set(list.map((f) => String(f?.key || '').trim()).filter(Boolean));
  for (const preset of OUR_MERGE_FIELD_PRESETS) {
    const existing = (fields || []).find((f) => f && String(f.key) === preset.key);
    if (existing) {
      list.push(existing);
      seen.add(preset.key);
      continue;
    }
    if (seen.has(preset.key)) continue;
    seen.add(preset.key);
    list.push({
      key: preset.key,
      label: preset.label,
      example: preset.example,
      multiline: false,
      excelSpreadLines: false,
      valueKind: 'text',
      excelFormat: 'general'
    });
  }
  return list;
}

/** 시트·API용 필드 목록 — our*는 항상 맨 뒤 */
export function partitionMergeSheetFields(fields) {
  const regular = [];
  const ourForced = [];
  for (const f of fields || []) {
    if (!f?.key || String(f.key) === 'rowIndex') continue;
    if (isOurForcedMergeFieldKey(f.key)) ourForced.push(f);
    else regular.push(f);
  }
  const order = new Map(OUR_MERGE_FIELD_PRESETS.map((p, i) => [p.key, i]));
  ourForced.sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  return { regularFields: regular, ourForcedFields: ourForced, allFields: [...regular, ...ourForced] };
}

export function partitionEditorDraftByOurForced(draft) {
  const regular = [];
  const ourForced = [];
  (Array.isArray(draft) ? draft : []).forEach((f, i) => {
    const entry = { f, i };
    if (isOurForcedMergeFieldKey(f?.key)) ourForced.push(entry);
    else regular.push(entry);
  });
  return { regular, ourForced };
}

const OUR_PRESET_ORDER = new Map(OUR_MERGE_FIELD_PRESETS.map((p, idx) => [p.key, idx]));

export function orderEditorDraftWithOurForcedAtEnd(draft) {
  const { regular, ourForced } = partitionEditorDraftByOurForced(draft);
  const sortedOur = [...ourForced].sort(
    (a, b) => (OUR_PRESET_ORDER.get(a.f?.key) ?? 99) - (OUR_PRESET_ORDER.get(b.f?.key) ?? 99)
  );
  return [...regular.map((x) => x.f), ...sortedOur.map((x) => x.f)];
}

/** 병합 API row에 자사 강제값 적용 */
export function applyOurForcedToMergeRow(row, ourValues) {
  const out = row && typeof row === 'object' ? { ...row } : {};
  if (!ourValues || typeof ourValues !== 'object') return out;
  for (const preset of OUR_MERGE_FIELD_PRESETS) {
    const v = ourValues[preset.key];
    if (v != null && String(v).trim() !== '') {
      out[preset.key] = String(v).trim();
    }
  }
  return out;
}

/** 고객 데이터 입력 여부 — our* 키는 제외 */
export function rowHasCustomerMergeFieldContent(row, mergeFields) {
  if (!row || !Array.isArray(mergeFields)) return false;
  return mergeFields.some((f) => {
    const key = f?.key;
    if (!key || key === 'rowIndex' || isOurForcedMergeFieldKey(key)) return false;
    return String(row[key] ?? '').trim() !== '';
  });
}
