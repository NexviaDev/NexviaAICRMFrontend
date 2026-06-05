/**
 * 영업 기회 엑셀 가져오기 — 매핑·검증·API 본문 (opportunity-modal / sales-opportunity-form-shared 와 동일 규칙)
 */
import {
  buildOpportunityCreatePayload,
  buildLineFromProduct,
  buildPipelineStageSelectOptionsFromDefinitions,
  formatNumberInput,
  parseNumber,
  priceBasisLabelsForValue
} from '@/lib/sales-opportunity-form-shared';
import { OPPORTUNITY_PRICE_BASIS_OPTIONS } from '@/lib/product-price-utils';
import {
  readExcelMappedCell,
  normalizeExcelHeaderKey
} from '../../customer-companies/customer-companies-excel-import-modal/excel-import-mapping-utils';

export const OPP_EXCEL_REQUIRED_TARGETS = new Set(['opp.title', 'opp.stage']);

/** 엑셀 미리보기 행 — 사내 담당자 확정 userId (표시 열에는 이름만) */
export const OPP_EXCEL_ROW_META_ASSIGNEE_ID = '__assigneeUserId';

/** 엑셀 미리보기 행 — 고객사 확정 id (표시 열에는 고객사명) */
export const OPP_EXCEL_ROW_META_COMPANY_ID = '__customerCompanyId';

/** 엑셀 미리보기 행 — 경고(미등록·동명) 무시하고 등록 */
export const OPP_EXCEL_ROW_META_FORCE_IMPORT = '__forceImportRow';

export function isForceImportExcelRow(row) {
  const v = row?.[OPP_EXCEL_ROW_META_FORCE_IMPORT];
  return v === true || v === 1 || v === '1';
}

export function isExcelMetaHeaderKey(key) {
  const k = String(key || '');
  if (k.startsWith('__preview:')) return false;
  return k.startsWith('__');
}

/** 열 미연결 시 미리보기·등록용 가상 열 키 */
export function opportunityPreviewCellKey(targetKey) {
  return `__preview:${String(targetKey || '').trim()}`;
}

export function isOpportunityPreviewCellKey(key) {
  return String(key || '').startsWith('__preview:');
}

function resolveExcelFieldColumnKey(headers, mapping, targetKey, guessFn) {
  if (mapping?.mode === 'constant') return '';
  if (mapping?.mode === 'field' && mapping.sourceKey) return mapping.sourceKey;
  const guessed = guessFn ? guessFn(headers) : guessOpportunityExcelSourceKey(targetKey, headers);
  if (guessed) return guessed;
  if (mapping?.mode === 'field') return opportunityPreviewCellKey(targetKey);
  return '';
}

export function newMappingRowId() {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function defaultOpportunityMappingRows() {
  return [
    { id: 'o1', sourceType: 'field', sourceKey: '', constantValue: '', targetKey: 'opp.title' },
    { id: 'o2', sourceType: 'field', sourceKey: '', constantValue: '', targetKey: 'opp.stage' },
    { id: 'o3', sourceType: 'field', sourceKey: '', constantValue: '', targetKey: 'opp.snapshotCompanyName' },
    { id: 'o4', sourceType: 'field', sourceKey: '', constantValue: '', targetKey: 'opp.contactName' },
    { id: 'o5', sourceType: 'field', sourceKey: '', constantValue: '', targetKey: 'opp.snapshotContactPhone' },
    { id: 'o6', sourceType: 'field', sourceKey: '', constantValue: '', targetKey: 'opp.snapshotContactEmail' },
    { id: 'o7', sourceType: 'field', sourceKey: '', constantValue: '', targetKey: 'opp.productName' },
    { id: 'o8', sourceType: 'field', sourceKey: '', constantValue: '', targetKey: 'opp.quantity' },
    { id: 'o9', sourceType: 'field', sourceKey: '', constantValue: '', targetKey: 'opp.unitPrice' },
    { id: 'o10', sourceType: 'constant', sourceKey: '', constantValue: 'KRW', targetKey: 'opp.currency' }
  ];
}

export function buildOpportunityTargetOptions(meta) {
  const fromApi = Array.isArray(meta?.mappableFields) ? meta.mappableFields : [];
  if (fromApi.length) {
    return fromApi.map((f) => ({ value: f.value, label: f.label || f.value }));
  }
  return defaultOpportunityMappingRows().map((r) => ({
    value: r.targetKey,
    label: r.targetKey
  }));
}

export function guessOpportunityExcelSourceKey(targetKey, headers) {
  if (!targetKey || !Array.isArray(headers) || !headers.length) return '';
  const rules = [
    { target: 'opp.title', test: (s) => /제목|기회명|프로젝트|건\s*명|title|subject/i.test(s) },
    { target: 'opp.stage', test: (s) => /단계|스테이지|stage|파이프라인/i.test(s) },
    { target: 'opp.snapshotCompanyName', test: (s) => /고객사|업체|회사|법인|company/i.test(s) },
    { target: 'opp.contactName', test: (s) => /담당|연락처\s*명|고객명|이름|contact/i.test(s) },
    { target: 'opp.snapshotContactPhone', test: (s) => /전화|휴대|연락처|phone|tel|mobile/i.test(s) },
    { target: 'opp.snapshotContactEmail', test: (s) => /이메일|email|메일/i.test(s) },
    { target: 'opp.productName', test: (s) => /제품|품목|상품|product/i.test(s) },
    { target: 'opp.quantity', test: (s) => /수량|qty|quantity/i.test(s) },
    { target: 'opp.unitPrice', test: (s) => /단가|가격|금액|price|amount/i.test(s) },
    { target: 'opp.unitPriceBasis', test: (s) => /가격\s*기준|다이렉트|유통|basis/i.test(s) },
    { target: 'opp.channelDistributor', test: (s) => /유통사|채널|distributor/i.test(s) },
    { target: 'opp.assignedToName', test: (s) => /사내\s*담당|사내담당|영업\s*담당|기회\s*담당|owner|assignee/i.test(s) },
    { target: 'opp.currency', test: (s) => /통화|currency/i.test(s) },
    { target: 'opp.description', test: (s) => /설명|비고|메모|description|note/i.test(s) },
    { target: 'opp.saleDate', test: (s) => /판매일|수주일|sale/i.test(s) },
    { target: 'opp.startDate', test: (s) => /시작일|start/i.test(s) },
    { target: 'opp.targetDate', test: (s) => /목표일|마감|target|close/i.test(s) },
    { target: 'opp.contractAmount', test: (s) => /계약\s*금액|contract/i.test(s) }
  ];
  const rule = rules.find((r) => r.target === targetKey);
  if (!rule) return '';
  for (const h of headers) {
    const s = String(h || '').trim();
    if (!s) continue;
    if (rule.test(s)) return h;
  }
  return '';
}

export function autoGuessMappingSourceKeys(rows, headers) {
  return (rows || []).map((row) => {
    if (row.sourceType === 'constant' || row.sourceKey) return row;
    const guessed = guessOpportunityExcelSourceKey(row.targetKey, headers);
    return guessed ? { ...row, sourceKey: guessed } : row;
  });
}

export function readMappedValuesFromExcelRow(excelRow, mappings) {
  const vals = {};
  for (const m of mappings || []) {
    const key = m.targetKey;
    if (!key || !String(key).startsWith('opp.')) continue;
    const raw =
      m.sourceType === 'constant'
        ? m.constantValue ?? ''
        : readExcelMappedCell(excelRow, m.sourceKey || '') ||
          readExcelMappedCell(excelRow, opportunityPreviewCellKey(key));
    vals[key] = raw == null ? '' : String(raw).trim();
  }
  return vals;
}

function normalizeYmdInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (m) {
    const mm = String(m[2]).padStart(2, '0');
    const dd = String(m[3]).padStart(2, '0');
    return `${m[1]}-${mm}-${dd}`;
  }
  const n = Number(s);
  if (Number.isFinite(n) && n > 30000 && n < 60000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + n * 86400000);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  return s;
}

/** pipeline-stages-manage-modal 과 동일한 단계 목록 (커스텀 정의 + Won/Lost/Abandoned) */
export function getPipelineStageOptionsForImport(meta) {
  const defs = meta?.stageDefinitions;
  if (Array.isArray(defs) && defs.length > 0) {
    return buildPipelineStageSelectOptionsFromDefinitions(defs);
  }
  return Array.isArray(meta?.stageOptions) ? meta.stageOptions : [];
}

/** 매핑 행에서 opp.* 엑셀 열 / 고정값 정보 */
export function getOppFieldExcelMapping(mappingRows, targetKey) {
  const row = (mappingRows || []).find((r) => r.targetKey === targetKey);
  if (!row) return { mode: 'missing' };
  if (row.sourceType === 'constant') {
    const constantValue = String(row.constantValue ?? '').trim();
    return { mode: 'constant', sourceKey: '', constantValue };
  }
  return { mode: 'field', sourceKey: String(row.sourceKey ?? '').trim(), constantValue: '' };
}

/** 매핑 행에서 opp.stage 엑셀 열 / 고정값 정보 */
export function getOppStageExcelMapping(mappingRows) {
  return getOppFieldExcelMapping(mappingRows, 'opp.stage');
}

/** 미리보기 표 — 매핑 대상 필드 전부(열 미선택 포함), 헤더는 CRM 라벨 */
export function buildOpportunityExcelPreviewColumns(mappingRows, targetOptions, excelHeaders = []) {
  const labelMap = new Map();
  for (const o of targetOptions || []) {
    if (o?.value) labelMap.set(o.value, o.label || o.value);
  }
  const hdrs = Array.isArray(excelHeaders) ? excelHeaders : [];
  const seenTargets = new Set();
  const cols = [];
  for (const row of mappingRows || []) {
    const targetKey = String(row?.targetKey ?? '').trim();
    if (!targetKey || seenTargets.has(targetKey)) continue;
    seenTargets.add(targetKey);

    if (row.sourceType === 'constant') {
      cols.push({
        targetKey,
        excelKey: opportunityPreviewCellKey(targetKey),
        label: labelMap.get(targetKey) || targetKey,
        excelTitle: `고정값 (${row.constantValue ?? ''})`,
        isConstant: true,
        constantValue: String(row.constantValue ?? '')
      });
      continue;
    }

    const mapping = getOppFieldExcelMapping(mappingRows, targetKey);
    const excelKey = resolveExcelFieldColumnKey(hdrs, mapping, targetKey, () =>
      guessOpportunityExcelSourceKey(targetKey, hdrs)
    );
    if (!excelKey) continue;

    cols.push({
      targetKey,
      excelKey,
      label: labelMap.get(targetKey) || targetKey,
      excelTitle: isOpportunityPreviewCellKey(excelKey)
        ? '열 미연결 · 미리보기에서 직접 입력'
        : excelKey,
      isPreviewOnly: isOpportunityPreviewCellKey(excelKey)
    });
  }
  return cols;
}

export function resolveStageValue(raw, stageOptions) {
  const s = String(raw || '').trim();
  if (!s) return { value: '', valid: false, label: '' };
  const opts = Array.isArray(stageOptions) ? stageOptions : [];
  const byValue = opts.find((o) => o.value === s);
  if (byValue) return { value: byValue.value, valid: true, label: byValue.label || byValue.value };
  const byLabel = opts.find((o) => (o.label || '').trim() === s);
  if (byLabel) return { value: byLabel.value, valid: true, label: byLabel.label || byLabel.value };
  return { value: s, valid: false, label: s };
}

/** 엑셀 헤더 중 단계 열 추정 (매핑 열이 없을 때 미리보기용) */
export function guessExcelStageColumnKey(headers) {
  if (!Array.isArray(headers)) return '';
  const rules = (s) => /단계|스테이지|stage|파이프라인/i.test(String(s || '').trim());
  for (const h of headers) {
    if (rules(h)) return h;
  }
  return '';
}

/** 미리보기·검증에 쓸 단계 엑셀 열 이름 */
export function resolveExcelStageColumnKey(headers, stageMapping) {
  return resolveExcelFieldColumnKey(headers, stageMapping, 'opp.stage', guessExcelStageColumnKey);
}

export function guessExcelPriceBasisColumnKey(headers) {
  if (!Array.isArray(headers)) return '';
  for (const h of headers) {
    if (isExcelMetaHeaderKey(h)) continue;
    if (/가격\s*기준|unit\s*price\s*basis|price\s*basis/i.test(String(h || '').trim())) return h;
  }
  return '';
}

export function guessExcelChannelDistributorColumnKey(headers) {
  if (!Array.isArray(headers)) return '';
  for (const h of headers) {
    if (isExcelMetaHeaderKey(h)) continue;
    if (/유통사|채널\s*사|distributor/i.test(String(h || '').trim())) return h;
  }
  return '';
}

export function guessExcelAssigneeColumnKey(headers) {
  if (!Array.isArray(headers)) return '';
  for (const h of headers) {
    if (isExcelMetaHeaderKey(h)) continue;
    const s = String(h || '').trim();
    if (/사내\s*담당|사내담당|영업\s*담당|기회\s*담당|owner|assignee/i.test(s)) return h;
  }
  return '';
}

export function guessExcelCompanyColumnKey(headers) {
  if (!Array.isArray(headers)) return '';
  for (const h of headers) {
    if (isExcelMetaHeaderKey(h)) continue;
    const s = String(h || '').trim();
    if (/고객사|업체\s*명|법인\s*명|회사\s*명|^company$/i.test(s) && !/사내|영업\s*담당/i.test(s)) return h;
  }
  return '';
}

export function resolveExcelCompanyColumnKey(headers, mapping) {
  return resolveExcelFieldColumnKey(headers, mapping, 'opp.snapshotCompanyName', guessExcelCompanyColumnKey);
}

/** 고객사명으로 CRM 목록 매칭(정확·정규화) */
export function findCustomerCompaniesByName(nameRaw, meta) {
  const name = String(nameRaw || '').trim();
  if (!name || isPersonalPurchaseCompanyName(name)) return [];
  const list = Array.isArray(meta?.customerCompanies) ? meta.customerCompanies : [];
  const norm = normalizeExcelHeaderKey(name);
  return list.filter((c) => {
    const cn = String(c.name || '').trim();
    return cn === name || normalizeExcelHeaderKey(cn) === norm;
  });
}

/** 엑셀 미리보기 — 고객사명 vs customer-companies 목록 */
export function resolveCustomerCompanyInExcelDraft(nameRaw, meta, forcedCompanyId) {
  const name = String(nameRaw || '').trim();
  if (isPersonalPurchaseCompanyName(name)) {
    return {
      status: 'personal',
      valid: true,
      personalPurchase: true,
      customerCompanyId: null,
      customerCompanyName: '',
      warn: '',
      candidates: []
    };
  }
  const list = Array.isArray(meta?.customerCompanies) ? meta.customerCompanies : [];
  const forced = String(forcedCompanyId || '').trim();
  if (forced) {
    const hit = list.find((c) => String(c.id) === forced);
    if (hit) {
      return {
        status: 'ok',
        valid: true,
        personalPurchase: false,
        customerCompanyId: hit.id,
        customerCompanyName: hit.name,
        warn: '',
        candidates: []
      };
    }
    return {
      status: 'missing',
      valid: false,
      personalPurchase: false,
      customerCompanyId: null,
      customerCompanyName: name,
      warn: '선택한 고객사를 찾을 수 없습니다. 다시 검색해 주세요.',
      candidates: []
    };
  }
  const matches = findCustomerCompaniesByName(name, meta);
  if (matches.length === 1) {
    const hit = matches[0];
    return {
      status: 'ok',
      valid: true,
      personalPurchase: false,
      customerCompanyId: hit.id,
      customerCompanyName: hit.name,
      warn: '',
      candidates: []
    };
  }
  if (matches.length > 1) {
    return {
      status: 'duplicate',
      valid: false,
      personalPurchase: false,
      customerCompanyId: null,
      customerCompanyName: name,
      warn: `동명업체 ${matches.length}건 — 돋보기로 선택하거나 「그대로 등록」을 사용해 주세요.`,
      candidates: matches
    };
  }
  if (!name) {
    return {
      status: 'personal',
      valid: true,
      personalPurchase: true,
      customerCompanyId: null,
      customerCompanyName: '',
      warn: '',
      candidates: []
    };
  }
  return {
    status: 'missing',
    valid: false,
    personalPurchase: false,
    customerCompanyId: null,
    customerCompanyName: name,
    warn: '고객사 목록에 없습니다. 돋보기로 검색·선택, 「고객사 추가」, 또는 「그대로 등록」을 이용해 주세요.',
    candidates: []
  };
}

/** 제품명 — 목록에 없어도 등록 가능(이름만 있으면 통과) */
export function resolveProductInExcelDraft(nameRaw, meta) {
  const name = String(nameRaw || '').trim();
  if (!name) {
    return { status: 'empty', valid: false, productId: '', productName: '', warn: '제품명이 비어 있습니다.' };
  }
  const products = Array.isArray(meta?.products) ? meta.products : [];
  const hit = products.find((p) => (p.name || '').trim() === name);
  if (hit) {
    return {
      status: 'ok',
      valid: true,
      productId: hit.id,
      productName: hit.name,
      warn: ''
    };
  }
  return {
    status: 'unregistered',
    valid: true,
    productId: '',
    productName: name,
    warn: '제품 목록에 없습니다. 엑셀 제품명 그대로 등록됩니다.'
  };
}

export function companyRowFromSearchModal(company) {
  const id = String(company?._id ?? company?.id ?? '').trim();
  if (!id) return null;
  return {
    id,
    name: String(company?.name ?? '').trim(),
    businessNumber: String(company?.businessNumber ?? '').trim(),
    address: String(company?.address ?? '').trim()
  };
}

export function resolveExcelPriceBasisColumnKey(headers, mapping) {
  return resolveExcelFieldColumnKey(headers, mapping, 'opp.unitPriceBasis', guessExcelPriceBasisColumnKey);
}

export function resolveExcelChannelDistributorColumnKey(headers, mapping) {
  return resolveExcelFieldColumnKey(
    headers,
    mapping,
    'opp.channelDistributor',
    guessExcelChannelDistributorColumnKey
  );
}

export function resolveExcelAssigneeColumnKey(headers, mapping) {
  return resolveExcelFieldColumnKey(headers, mapping, 'opp.assignedToName', guessExcelAssigneeColumnKey);
}

export function normalizeOverviewEmployees(employees) {
  return (Array.isArray(employees) ? employees : [])
    .map((e) => ({
      id: String(e?.id ?? e?._id ?? '').trim(),
      name: String(e?.name || '').trim(),
      email: String(e?.email || '').trim(),
      department: String(e?.department || '').trim()
    }))
    .filter((e) => e.id);
}

/** 사내현황 직원 목록 기준 — 이름·이메일 매칭, 동명인·미매칭 경고 · 비어 있으면 defaultUserId(로그인 본인) */
export function resolveAssigneeFromOverview(nameRaw, employees, forcedUserId, defaultUserId) {
  const list = normalizeOverviewEmployees(employees);
  const forced = String(forcedUserId || '').trim();
  const defaultId = String(defaultUserId || '').trim();
  if (forced) {
    const hit = list.find((e) => e.id === forced);
    if (hit) {
      return { status: 'ok', userId: hit.id, name: hit.name, valid: true, candidates: [], warn: '' };
    }
    return {
      status: 'missing',
      userId: '',
      name: String(nameRaw || '').trim(),
      valid: false,
      candidates: [],
      warn: '선택한 담당자가 사내 목록에 없습니다. 다시 선택해 주세요.'
    };
  }
  const name = String(nameRaw || '').trim();
  if (!name) {
    const defHit = defaultId ? list.find((e) => e.id === defaultId) : null;
    return {
      status: 'default',
      userId: defaultId,
      name: defHit?.name || '',
      valid: true,
      candidates: [],
      warn: ''
    };
  }
  const matches = list.filter((e) => e.name === name || (e.email && e.email === name));
  if (matches.length === 1) {
    return { status: 'ok', userId: matches[0].id, name: matches[0].name, valid: true, candidates: [], warn: '' };
  }
  if (matches.length > 1) {
    return {
      status: 'duplicate',
      userId: '',
      name,
      valid: false,
      candidates: matches,
      warn: `동명이인 ${matches.length}명 — 돋보기로 선택하거나 「그대로 등록」을 사용해 주세요.`
    };
  }
  return {
    status: 'missing',
    userId: '',
    name,
    valid: false,
    candidates: [],
    warn: '사내현황 직원 목록에 없는 이름입니다. 돋보기로 선택하거나 이름을 수정해 주세요.'
  };
}

export function overviewEmployeesForMeta(meta) {
  if (Array.isArray(meta?._overviewEmployees) && meta._overviewEmployees.length) {
    return meta._overviewEmployees;
  }
  const users = Array.isArray(meta?.users) ? meta.users : [];
  return users.map((u) => ({ id: u.id, name: u.name, email: '', department: '' }));
}

/** 엑셀 미리보기 — 단계 열에 목록에 없는 값이 있는 행 수 */
export function countInvalidStageCellsInExcelDraft(excelRows, stageMapping, stageOptions, headers) {
  if (!Array.isArray(excelRows) || !excelRows.length) return 0;
  const col = resolveExcelStageColumnKey(headers || (excelRows[0] ? Object.keys(excelRows[0]) : []), stageMapping);
  if (stageMapping?.mode === 'constant') {
    const fixed = resolveStageValue(stageMapping.constantValue, stageOptions);
    if (!fixed.valid) return 1;
    if (!col) return 0;
  }
  if (!col) return excelRows.length;
  let n = 0;
  for (const row of excelRows) {
    const raw = readExcelMappedCell(row, col);
    if (!resolveStageValue(raw, stageOptions).valid) n += 1;
  }
  return n;
}

/** 드롭다운 저장 시 CRM 단계 key(영문 코드)로 엑셀 셀에 기록 */
export function stageKeyForExcelCell(raw, stageOptions) {
  const resolved = resolveStageValue(raw, stageOptions);
  return resolved.valid ? resolved.value : '';
}

export function resolveCurrencyValue(raw, currencies) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return { value: 'KRW', valid: true };
  const list = Array.isArray(currencies) ? currencies : ['KRW', 'USD', 'JPY'];
  if (list.includes(s)) return { value: s, valid: true };
  if (s === '원' || s === '₩') return { value: 'KRW', valid: true };
  if (s === '$' || s === '달러') return { value: 'USD', valid: true };
  if (s === '엔' || s === '¥') return { value: 'JPY', valid: true };
  return { value: s, valid: false };
}

export function resolvePriceBasisValue(raw) {
  const s = String(raw || '').trim();
  if (!s) return { value: 'consumer', valid: true };
  if (s === 'consumer' || s === 'channel') return { value: s, valid: true };
  const opt = OPPORTUNITY_PRICE_BASIS_OPTIONS.find((o) => o.label === s || o.value === s);
  if (opt) return { value: opt.value, valid: true };
  if (/유통|channel/i.test(s)) return { value: 'channel', valid: true };
  if (/다이렉트|소비자|consumer|리스트/i.test(s)) return { value: 'consumer', valid: true };
  return { value: s, valid: false };
}

/** 고객사명 비어 있거나 개인구매로 쓰는 표기 */
export function isPersonalPurchaseCompanyName(nameRaw) {
  const name = String(nameRaw || '').trim();
  if (!name) return true;
  return /^(개인\s*구매|개인|personal|없음|미기재|미입력|해당\s*없음|해당없음|-|—|\.{1,3}|n\/a|null|none)$/i.test(name);
}

export function resolveCompanyFromName(nameRaw, meta) {
  const name = String(nameRaw || '').trim();
  if (isPersonalPurchaseCompanyName(name)) {
    return { personalPurchase: true, customerCompanyId: null, customerCompanyName: '', valid: true };
  }
  const list = Array.isArray(meta?.customerCompanies) ? meta.customerCompanies : [];
  const exact = list.find((c) => (c.name || '').trim() === name);
  if (exact) {
    return {
      personalPurchase: false,
      customerCompanyId: exact.id,
      customerCompanyName: exact.name,
      snapshotCompanyBusinessNumber: exact.businessNumber || '',
      snapshotCompanyAddress: exact.address || '',
      valid: true
    };
  }
  const norm = normalizeExcelHeaderKey(name);
  const fuzzy = list.find((c) => normalizeExcelHeaderKey(c.name) === norm);
  if (fuzzy) {
    return {
      personalPurchase: false,
      customerCompanyId: fuzzy.id,
      customerCompanyName: fuzzy.name,
      snapshotCompanyBusinessNumber: fuzzy.businessNumber || '',
      snapshotCompanyAddress: fuzzy.address || '',
      valid: true
    };
  }
  return {
    personalPurchase: false,
    customerCompanyId: null,
    customerCompanyName: name,
    valid: false
  };
}

export function resolveProductLine(productNameRaw, meta, priceBasis = 'consumer') {
  const name = String(productNameRaw || '').trim();
  const products = Array.isArray(meta?.products) ? meta.products : [];
  const p = products.find((x) => (x.name || '').trim() === name);
  if (p && meta?._productObjectsById?.[p.id]) {
    return buildLineFromProduct(meta._productObjectsById[p.id], priceBasis);
  }
  const fb = priceBasisLabelsForValue(priceBasis === 'channel' ? 'channel' : 'consumer');
  return {
    lineId: `import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    productId: p?.id || '',
    productName: name,
    unitPrice: '',
    priceBasis,
    priceBasisLabel: fb.priceBasisLabel,
    priceBasisShortLabel: fb.priceBasisShortLabel,
    channelDistributor: '',
    quantity: '1',
    discountRate: '',
    discountAmount: '',
    purchaseCostTotal: '',
    commissionRecipients: []
  };
}

export function resolveAssignedUserId(nameRaw, meta, forcedUserId) {
  const res = resolveAssigneeFromOverview(
    nameRaw,
    overviewEmployeesForMeta(meta),
    forcedUserId,
    meta?._currentUserId
  );
  return {
    userId: res.userId,
    valid: res.valid,
    name: res.name,
    raw: res.name || String(nameRaw || '').trim(),
    status: res.status,
    warn: res.warn
  };
}

function countInvalidPriceBasisCellsInExcelDraft(excelRows, basisMapping, channelMapping, headers) {
  if (!Array.isArray(excelRows) || !excelRows.length) return 0;
  const hdrs = headers || Object.keys(excelRows[0] || {}).filter((k) => !isExcelMetaHeaderKey(k));
  const col = resolveExcelPriceBasisColumnKey(hdrs, basisMapping);
  if (basisMapping?.mode === 'constant') {
    const fixed = resolvePriceBasisValue(basisMapping.constantValue);
    if (!fixed.valid) return 1;
    if (!col) return 0;
  }
  if (!col) return 0;
  const distCol = resolveExcelChannelDistributorColumnKey(hdrs, channelMapping);
  let n = 0;
  for (const row of excelRows) {
    const distRaw = distCol ? readExcelMappedCell(row, distCol) : '';
    const raw = readExcelMappedCell(row, col);
    if (String(distRaw || '').trim()) {
      const basis = resolvePriceBasisValue(raw);
      if (basis.value !== 'channel') n += 1;
      continue;
    }
    if (!resolvePriceBasisValue(raw).valid) n += 1;
  }
  return n;
}

function countInvalidChannelDistributorCellsInExcelDraft(excelRows, basisMapping, channelMapping, meta, headers) {
  if (!Array.isArray(excelRows) || !excelRows.length) return 0;
  const hdrs = headers || Object.keys(excelRows[0] || {}).filter((k) => !isExcelMetaHeaderKey(k));
  const basisCol = resolveExcelPriceBasisColumnKey(hdrs, basisMapping);
  const chCol = resolveExcelChannelDistributorColumnKey(hdrs, channelMapping);
  if (!chCol) return 0;
  let n = 0;
  for (const row of excelRows) {
    const basisRaw = basisCol ? readExcelMappedCell(row, basisCol) : basisMapping?.mode === 'constant' ? basisMapping.constantValue : '';
    const basis = resolvePriceBasisValue(basisRaw);
    const chCellRaw = readExcelMappedCell(row, chCol);
    const effectiveBasis =
      String(chCellRaw || '').trim() && basis.value !== 'channel' ? { value: 'channel', valid: true } : basis;
    const chRes = resolveChannelDistributor(chCellRaw, meta, effectiveBasis.value);
    if (!chRes.valid) n += 1;
  }
  return n;
}

function countInvalidCompanyCellsInExcelDraft(excelRows, companyMapping, meta, headers) {
  if (!Array.isArray(excelRows) || !excelRows.length) return 0;
  if (companyMapping?.mode === 'constant') return 0;
  const hdrs = headers || Object.keys(excelRows[0] || {}).filter((k) => !isExcelMetaHeaderKey(k));
  const col = resolveExcelCompanyColumnKey(hdrs, companyMapping);
  if (!col) return 0;
  let n = 0;
  for (const row of excelRows) {
    if (isForceImportExcelRow(row)) continue;
    const forced = row[OPP_EXCEL_ROW_META_COMPANY_ID];
    const res = resolveCustomerCompanyInExcelDraft(readExcelMappedCell(row, col), meta, forced);
    if (!res.valid) n += 1;
  }
  return n;
}

function countInvalidAssigneeCellsInExcelDraft(excelRows, assigneeMapping, employees, headers, defaultUserId) {
  if (!Array.isArray(excelRows) || !excelRows.length) return 0;
  if (assigneeMapping?.mode === 'constant') return 0;
  const hdrs = headers || Object.keys(excelRows[0] || {}).filter((k) => !isExcelMetaHeaderKey(k));
  const col = resolveExcelAssigneeColumnKey(hdrs, assigneeMapping);
  if (!col) return 0;
  let n = 0;
  for (const row of excelRows) {
    if (isForceImportExcelRow(row)) continue;
    const forced = row[OPP_EXCEL_ROW_META_ASSIGNEE_ID];
    const res = resolveAssigneeFromOverview(readExcelMappedCell(row, col), employees, forced, defaultUserId);
    if (!res.valid) n += 1;
  }
  return n;
}

export function countSoftWarningExcelDraftCells(excelRows, ctx) {
  const headers = ctx?.headers || (excelRows?.[0] ? Object.keys(excelRows[0]).filter((k) => !isExcelMetaHeaderKey(k)) : []);
  let company = 0;
  let assignee = 0;
  let product = 0;
  const companyCol = resolveExcelCompanyColumnKey(headers, ctx?.companyMapping);
  const assigneeCol = resolveExcelAssigneeColumnKey(headers, ctx?.assigneeMapping);
  const productCol = guessExcelProductColumnKey(headers);
  for (const row of excelRows || []) {
    if (isForceImportExcelRow(row)) continue;
    if (companyCol) {
      const res = resolveCustomerCompanyInExcelDraft(row[companyCol], ctx?.meta, row[OPP_EXCEL_ROW_META_COMPANY_ID]);
      if (!res.valid && res.status !== 'personal') company += 1;
    }
    if (assigneeCol) {
      const res = resolveAssigneeFromOverview(
        row[assigneeCol],
        ctx?.overviewEmployees,
        row[OPP_EXCEL_ROW_META_ASSIGNEE_ID],
        ctx?.defaultUserId
      );
      if (!res.valid && res.status !== 'empty' && res.status !== 'default') assignee += 1;
    }
    if (productCol) {
      const res = resolveProductInExcelDraft(row[productCol], ctx?.meta);
      if (res.status === 'unregistered') product += 1;
    }
  }
  return { company, assignee, product, total: company + assignee + product };
}

export function guessExcelProductColumnKey(headers) {
  if (!Array.isArray(headers)) return '';
  for (const h of headers) {
    if (isExcelMetaHeaderKey(h)) continue;
    if (/제품|품목|상품|product/i.test(String(h || '').trim())) return h;
  }
  return '';
}

/** 엑셀 미리보기 — 단계·가격기준·유통사·사내담당자 오류 건수 */
export function countInvalidExcelDraftCells(excelRows, ctx) {
  const headers = ctx?.headers || (excelRows?.[0] ? Object.keys(excelRows[0]).filter((k) => !isExcelMetaHeaderKey(k)) : []);
  const stage = countInvalidStageCellsInExcelDraft(
    excelRows,
    ctx?.stageMapping,
    ctx?.stageOptions,
    headers
  );
  const priceBasis = countInvalidPriceBasisCellsInExcelDraft(
    excelRows,
    ctx?.priceBasisMapping,
    ctx?.channelMapping,
    headers
  );
  const channelDistributor = countInvalidChannelDistributorCellsInExcelDraft(
    excelRows,
    ctx?.priceBasisMapping,
    ctx?.channelMapping,
    ctx?.meta,
    headers
  );
  const assignee = countInvalidAssigneeCellsInExcelDraft(
    excelRows,
    ctx?.assigneeMapping,
    ctx?.overviewEmployees,
    headers,
    ctx?.defaultUserId
  );
  const company = countInvalidCompanyCellsInExcelDraft(excelRows, ctx?.companyMapping, ctx?.meta, headers);
  return {
    stage,
    priceBasis,
    channelDistributor,
    assignee,
    company,
    total: stage + priceBasis + channelDistributor + assignee + company
  };
}

/** 엑셀 미리보기 진입 시 — 유통사가 있으면 가격기준을 유통으로 일괄 보정 */
export function normalizeExcelDraftRows(rows, columnKeys) {
  const { distributorCol, priceBasisCol } = columnKeys || {};
  if (!distributorCol || !priceBasisCol || !Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!String(row[distributorCol] || '').trim()) return row;
    if (resolvePriceBasisValue(row[priceBasisCol]).value === 'channel') return row;
    return { ...row, [priceBasisCol]: 'channel' };
  });
}

/** 유통사 입력 시 가격기준을 유통(channel)으로 맞춤 */
export function patchExcelRowWithSideEffects(row, header, value, columnKeys) {
  const next = { ...row, [header]: value };
  const { distributorCol, priceBasisCol, assigneeCol, companyCol } = columnKeys || {};
  if (distributorCol && header === distributorCol && String(value || '').trim() && priceBasisCol) {
    next[priceBasisCol] = 'channel';
  }
  if (assigneeCol && header === assigneeCol) {
    delete next[OPP_EXCEL_ROW_META_ASSIGNEE_ID];
    delete next[OPP_EXCEL_ROW_META_FORCE_IMPORT];
  }
  if (companyCol && header === companyCol) {
    delete next[OPP_EXCEL_ROW_META_COMPANY_ID];
    delete next[OPP_EXCEL_ROW_META_FORCE_IMPORT];
  }
  return next;
}

export function resolveChannelDistributor(raw, meta, priceBasis) {
  const s = String(raw || '').trim();
  if (priceBasis !== 'channel') return { value: '', valid: true };
  if (!s) return { value: '', valid: true };
  const list = Array.isArray(meta?.channelDistributors) ? meta.channelDistributors : [];
  if (list.includes(s)) return { value: s, valid: true };
  return { value: s, valid: false };
}

export function buildPreviewRowFromExcelRow(excelRow, rowIndex, mappings, meta) {
  const vals = readMappedValuesFromExcelRow(excelRow, mappings);
  const title = (vals['opp.title'] || '').trim();
  const stageOptions = getPipelineStageOptionsForImport(meta);
  const stageRes = resolveStageValue(vals['opp.stage'], stageOptions);
  const currencyRes = resolveCurrencyValue(vals['opp.currency'], meta?.currencies);
  let basisRes = resolvePriceBasisValue(vals['opp.unitPriceBasis']);
  const companyNameRaw = vals['opp.snapshotCompanyName'];
  const hasContactInfo = Boolean(
    String(vals['opp.contactName'] || '').trim() ||
      String(vals['opp.snapshotContactPhone'] || '').trim() ||
      String(vals['opp.snapshotContactEmail'] || '').trim()
  );
  const forcedCompanyId = excelRow[OPP_EXCEL_ROW_META_COMPANY_ID] || '';
  const forceImport = isForceImportExcelRow(excelRow);
  const companyDraft = resolveCustomerCompanyInExcelDraft(companyNameRaw, meta, forcedCompanyId);
  let companyRes = {
    personalPurchase: companyDraft.personalPurchase,
    customerCompanyId: companyDraft.customerCompanyId,
    customerCompanyName: companyDraft.customerCompanyName,
    snapshotCompanyBusinessNumber: '',
    snapshotCompanyAddress: '',
    valid: companyDraft.valid
  };
  if (companyDraft.customerCompanyId) {
    const hit = meta?.customerCompanies?.find((c) => c.id === companyDraft.customerCompanyId);
    if (hit) {
      companyRes.snapshotCompanyBusinessNumber = hit.businessNumber || '';
      companyRes.snapshotCompanyAddress = hit.address || '';
    }
  }
  if (forceImport && !companyDraft.valid && !companyDraft.personalPurchase && String(companyNameRaw || '').trim()) {
    companyRes = {
      personalPurchase: false,
      customerCompanyId: null,
      customerCompanyName: String(companyNameRaw).trim(),
      snapshotCompanyBusinessNumber: '',
      snapshotCompanyAddress: '',
      valid: true,
      snapshotOnly: true
    };
  }
  if (hasContactInfo && isPersonalPurchaseCompanyName(companyNameRaw)) {
    companyRes = {
      personalPurchase: true,
      customerCompanyId: null,
      customerCompanyName: '',
      valid: true,
      snapshotCompanyBusinessNumber: '',
      snapshotCompanyAddress: ''
    };
  }
  const forcedAssigneeId = excelRow[OPP_EXCEL_ROW_META_ASSIGNEE_ID] || '';
  const assignRes = resolveAssignedUserId(vals['opp.assignedToName'], meta, forcedAssigneeId);
  if (String(vals['opp.channelDistributor'] || '').trim()) {
    basisRes = { value: 'channel', valid: true };
  }
  const channelRes = resolveChannelDistributor(vals['opp.channelDistributor'], meta, basisRes.value);

  const qtyRaw = vals['opp.quantity'] || '1';
  const unitRaw = vals['opp.unitPrice'] || '';
  const productDraft = resolveProductInExcelDraft(vals['opp.productName'], meta);
  const lineBase = resolveProductLine(productDraft.productName || vals['opp.productName'], meta, basisRes.value);
  if (productDraft.productId) lineBase.productId = productDraft.productId;
  if (productDraft.productName) lineBase.productName = productDraft.productName;
  lineBase.quantity = String(Math.max(0, Number(qtyRaw) || 1));
  if (unitRaw) lineBase.unitPrice = formatNumberInput(String(parseNumber(unitRaw)));
  lineBase.discountRate = vals['opp.discountRate'] || '';
  lineBase.discountAmount = vals['opp.discountAmount'] ? formatNumberInput(String(parseNumber(vals['opp.discountAmount']))) : '';
  lineBase.channelDistributor = channelRes.value;
  lineBase.priceBasis = basisRes.value;

  const financeCustomDates = {};
  const scheduleCustomDates = {};
  const financeCustomFieldValues = {};
  for (const [k, v] of Object.entries(vals)) {
    if (k.startsWith('opp.financeCustomFields.')) {
      financeCustomFieldValues[k.replace('opp.financeCustomFields.', '')] = v;
    }
    if (k.startsWith('opp.scheduleCustomDates.')) {
      scheduleCustomDates[k.replace('opp.scheduleCustomDates.', '')] = normalizeYmdInput(v);
    }
  }

  const row = {
    rowIndex,
    title,
    stage: stageRes.value,
    stageValid: stageRes.valid,
    currency: currencyRes.value,
    currencyValid: currencyRes.valid,
    unitPriceBasis: basisRes.value,
    unitPriceBasisValid: basisRes.valid,
    channelDistributor: channelRes.value,
    channelDistributorValid: channelRes.valid,
    personalPurchase: companyRes.personalPurchase,
    customerCompanyId: companyRes.customerCompanyId,
    customerCompanyName: companyRes.customerCompanyName,
    companyValid: companyRes.valid,
    snapshotCompanyBusinessNumber: vals['opp.snapshotCompanyBusinessNumber'] || companyRes.snapshotCompanyBusinessNumber || '',
    snapshotCompanyAddress: vals['opp.snapshotCompanyAddress'] || companyRes.snapshotCompanyAddress || '',
    contactName: vals['opp.contactName'] || '',
    contactPhone: vals['opp.snapshotContactPhone'] || '',
    contactEmail: vals['opp.snapshotContactEmail'] || '',
    description: vals['opp.description'] || '',
    assignedToUserId:
      forceImport && !assignRes.valid
        ? ''
        : assignRes.userId || (assignRes.status === 'default' ? meta?._currentUserId : '') || '',
    assignedToName:
      forceImport && !assignRes.valid
        ? String(vals['opp.assignedToName'] || '').trim()
        : assignRes.name ||
          vals['opp.assignedToName'] ||
          (assignRes.status === 'default' ? meta?._currentUserName : '') ||
          '',
    assignedToValid: assignRes.valid || forceImport,
    saleDateYmd: normalizeYmdInput(vals['opp.saleDate']),
    startDateYmd: normalizeYmdInput(vals['opp.startDate']),
    targetDateYmd: normalizeYmdInput(vals['opp.targetDate']),
    expectedCloseMonth: vals['opp.expectedCloseMonth'] || '',
    contractAmountStr: vals['opp.contractAmount'] ? formatNumberInput(String(parseNumber(vals['opp.contractAmount']))) : '',
    invoiceAmountStr: vals['opp.invoiceAmount'] ? formatNumberInput(String(parseNumber(vals['opp.invoiceAmount']))) : '',
    invoiceAmountDateYmd: normalizeYmdInput(vals['opp.invoiceAmountDate']),
    fullCollectionCompleteDateYmd: normalizeYmdInput(vals['opp.fullCollectionCompleteDate']),
    licenseCertificateDeliveredDateYmd: normalizeYmdInput(vals['opp.licenseCertificateDeliveredDate']),
    driveFolderLink: vals['opp.driveFolderLink'] || '',
    lineItemsClient: [lineBase],
    financeCustomFieldValues,
    scheduleCustomDates,
    collectionEntriesClient: [],
    companyStatus: companyDraft.status,
    companyWarn: companyDraft.warn || '',
    productWarn: productDraft.warn || '',
    productStatus: productDraft.status,
    forceImport
  };

  row.invalidCells = collectInvalidCells(row);
  row.isValid = row.invalidCells.size === 0 && !!title;
  return row;
}

export function collectInvalidCells(row) {
  const bad = new Set();
  const force = row.forceImport === true;
  if (!row.title) bad.add('title');
  if (!row.stageValid) bad.add('stage');
  if (!row.currencyValid) bad.add('currency');
  if (!row.unitPriceBasisValid) bad.add('unitPriceBasis');
  if (!row.companyValid && !row.personalPurchase && !force) bad.add('customerCompanyName');
  if (!row.channelDistributorValid) bad.add('channelDistributor');
  if (!row.assignedToValid && !force) bad.add('assignedToName');
  const li0 = row.lineItemsClient?.[0];
  if (!li0?.productName?.trim()) bad.add('productName');
  return bad;
}

export function revalidatePreviewRow(row, meta) {
  const stageOptions = getPipelineStageOptionsForImport(meta);
  const stageRes = resolveStageValue(row.stage, stageOptions);
  const currencyRes = resolveCurrencyValue(row.currency, meta?.currencies);
  const basisRes = resolvePriceBasisValue(row.unitPriceBasis);
  const companyDraft = resolveCustomerCompanyInExcelDraft(
    row.customerCompanyName,
    meta,
    row.customerCompanyId || ''
  );
  let companyRes = {
    personalPurchase: companyDraft.personalPurchase,
    customerCompanyId: companyDraft.customerCompanyId,
    customerCompanyName: companyDraft.customerCompanyName,
    valid: companyDraft.valid || row.forceImport
  };
  if (row.forceImport && !companyDraft.valid && !companyDraft.personalPurchase && (row.customerCompanyName || '').trim()) {
    companyRes = {
      personalPurchase: false,
      customerCompanyId: null,
      customerCompanyName: row.customerCompanyName,
      valid: true
    };
  }
  const assignRes = row.assignedToUserId
    ? resolveAssignedUserId(row.assignedToName, meta, row.assignedToUserId)
    : resolveAssignedUserId(row.assignedToName, meta);
  const channelRes = resolveChannelDistributor(row.channelDistributor, meta, basisRes.value);
  const productDraft = resolveProductInExcelDraft(row.lineItemsClient?.[0]?.productName, meta);

  const next = {
    ...row,
    stage: stageRes.value,
    stageValid: stageRes.valid,
    currency: currencyRes.value,
    currencyValid: currencyRes.valid,
    unitPriceBasis: basisRes.value,
    unitPriceBasisValid: basisRes.valid,
    channelDistributor: channelRes.value,
    channelDistributorValid: channelRes.valid,
    personalPurchase: companyRes.personalPurchase,
    customerCompanyId: companyRes.customerCompanyId,
    customerCompanyName: companyRes.customerCompanyName,
    companyValid: companyRes.valid,
    assignedToUserId: row.forceImport && !assignRes.valid ? '' : assignRes.userId,
    assignedToName:
      row.forceImport && !assignRes.valid
        ? String(row.assignedToName || assignRes.raw || '').trim()
        : assignRes.name || row.assignedToName,
    assignedToValid: assignRes.valid || row.forceImport,
    companyWarn: companyDraft.warn,
    companyStatus: companyDraft.status,
    productWarn: productDraft.warn,
    productStatus: productDraft.status
  };
  next.invalidCells = collectInvalidCells(next);
  next.isValid = next.invalidCells.size === 0 && !!next.title;
  return next;
}

export function buildBulkImportPayloadFromPreviewRow(row, meta) {
  const scheduleFieldDefs = meta?.scheduleFieldDefs || [];
  const snapshotOnlyCompany =
    row.forceImport === true && !row.personalPurchase && !row.customerCompanyId && !!(row.customerCompanyName || '').trim();
  const body = buildOpportunityCreatePayload({
    title: row.title,
    personalPurchase: row.personalPurchase,
    customerCompanyId: row.customerCompanyId,
    customerCompanyEmployeeId: null,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    snapshotCompanyName: row.personalPurchase ? '' : row.customerCompanyName,
    snapshotCompanyBusinessNumber: row.personalPurchase ? '' : row.snapshotCompanyBusinessNumber,
    snapshotCompanyAddress: row.personalPurchase ? '' : row.snapshotCompanyAddress,
    snapshotContactName: row.contactName,
    snapshotContactPhone: row.contactPhone,
    snapshotContactEmail: row.contactEmail,
    lineItemsClient: row.lineItemsClient,
    currency: row.currency,
    stage: row.stage,
    description: row.description,
    saleDateYmd: row.saleDateYmd,
    startDateYmd: row.startDateYmd,
    targetDateYmd: row.targetDateYmd,
    expectedCloseMonth: row.expectedCloseMonth,
    assignedToUserId: row.assignedToUserId,
    contractAmountStr: row.contractAmountStr,
    fullCollectionCompleteDateYmd: row.fullCollectionCompleteDateYmd,
    invoiceAmountStr: row.invoiceAmountStr,
    invoiceAmountDateYmd: row.invoiceAmountDateYmd,
    licenseCertificateDeliveredDateYmd: row.licenseCertificateDeliveredDateYmd,
    collectionEntriesClient: row.collectionEntriesClient,
    scheduleFieldDefs,
    scheduleCustomDates: row.scheduleCustomDates,
    documentRefs: [],
    driveFolderLink: row.driveFolderLink
  });
  const fc = row.financeCustomFieldValues;
  if (fc && typeof fc === 'object' && Object.keys(fc).length > 0) {
    body.financeCustomFields = { ...fc };
  }
  if (snapshotOnlyCompany) {
    body.snapshotCompanyName = String(row.customerCompanyName || '').trim();
    body.snapshotCompanyBusinessNumber = String(row.snapshotCompanyBusinessNumber || '').trim();
    body.snapshotCompanyAddress = String(row.snapshotCompanyAddress || '').trim();
    body._importSnapshotCompanyOnly = true;
  }
  if (row.forceImport && !(row.assignedToUserId || '').trim() && (row.assignedToName || '').trim()) {
    body._importAssignedToName = String(row.assignedToName).trim();
  }
  return body;
}

export function opportunityMappingRowStatus(row, preview) {
  if (!row.targetKey) return { type: 'err', label: '대상 없음' };
  if (row.sourceType === 'constant') {
    return row.constantValue != null && String(row.constantValue).trim() !== ''
      ? { type: 'ok', label: 'VALID' }
      : { type: 'warn', label: '값 입력' };
  }
  if (!row.sourceKey) {
    if (OPP_EXCEL_REQUIRED_TARGETS.has(row.targetKey)) return { type: 'err', label: '필수' };
    return { type: 'warn', label: '소스 선택' };
  }
  const empty = !preview || String(preview).trim() === '';
  if (empty && OPP_EXCEL_REQUIRED_TARGETS.has(row.targetKey)) {
    return { type: 'warn', label: '첫 행 비어 있음' };
  }
  if (empty) return { type: 'muted', label: '빈 값' };
  return { type: 'ok', label: 'VALID' };
}

export function ensureOpportunityMappingComplete(rows) {
  const targets = new Set((rows || []).map((r) => r.targetKey));
  const add = [];
  for (const d of defaultOpportunityMappingRows()) {
    if (!targets.has(d.targetKey)) {
      targets.add(d.targetKey);
      add.push({ ...d, id: newMappingRowId() });
    }
  }
  if (!add.length) return rows || [];
  return [...(rows || []), ...add];
}

export function toApiMappings(rows) {
  return (rows || [])
    .filter((r) => r.targetKey)
    .map((r) => ({
      sourceType: r.sourceType === 'constant' ? 'constant' : 'field',
      sourceKey: r.sourceType === 'constant' ? '' : (r.sourceKey || ''),
      constantValue: r.sourceType === 'constant' ? String(r.constantValue ?? '') : '',
      targetKey: r.targetKey
    }));
}

/** 매핑 단계 진행 가능 여부 — 열 연결·고정값만 검사(첫 행 미리보기 값은 검증 단계에서 확인) */
export function mappingCanProceed(rows, excelRows) {
  if (!excelRows?.length) return false;
  for (const targetKey of OPP_EXCEL_REQUIRED_TARGETS) {
    const r = (rows || []).find((row) => row.targetKey === targetKey);
    if (!r) return false;
    if (r.sourceType === 'constant') {
      if (!String(r.constantValue ?? '').trim()) return false;
    } else if (!String(r.sourceKey ?? '').trim()) {
      return false;
    }
  }
  return true;
}
