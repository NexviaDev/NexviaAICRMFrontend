/**
 * 리드 캡처 → CRM 필드 매핑 유틸.
 * 대상 필드(연락처·고객사)는 백엔드 API에서 Mongoose 스키마를 읽어 동적 반환.
 * 스키마에 필드를 추가하면 자동으로 매핑 대상에 노출 — 프런트엔드 수정 불필요.
 */

export const BUSINESS_CARD_AUTO_TARGET = 'contact.__business_card_auto';

/** UI 전용 pseudo 행: 명함 자동 업로드 (API 저장 제외) */
const BUSINESS_CARD_AUTO_OPTION = {
  value: BUSINESS_CARD_AUTO_TARGET,
  label: '연락처 · 명함 (등록 시 자동 업로드)'
};

/**
 * API에서 받은 스키마 필드 + 커스텀 필드 정의 → 대상 셀렉트 옵션 조합.
 * @param {string} registerTarget 'contact' | 'company'
 * @param {Array} schemaFields API /crm-mappable-fields 결과 (contact 또는 company 배열)
 * @param {Array} customFieldDefs 커스텀 필드 정의 (contact 또는 company)
 */
export function buildTargetOptionsForTarget(registerTarget, schemaFields = [], customFieldDefs = []) {
  const base = (schemaFields || []).map((f) => ({ value: f.value, label: f.label }));
  const prefix = registerTarget === 'company' ? 'company' : 'contact';
  const customOpts = (customFieldDefs || []).map((d) => ({
    value: `${prefix}.customFields.${d.key}`,
    label: `${prefix === 'contact' ? '연락처' : '고객사'} · ${d.label || d.key} (추가)`
  }));
  const opts = [...base, ...customOpts];
  if (registerTarget === 'contact') {
    opts.push(BUSINESS_CARD_AUTO_OPTION);
  }
  return opts;
}

/** 수신 리드 표(회사명·이름·연락처·이메일·명함) + 폼 커스텀과 동일 소스 */
export function buildSourceOptions(customFieldDefinitions = []) {
  const tableLinked = [
    { key: 'name', label: '이름 (표 · 이름)', icon: 'person', meta: '리드' },
    { key: 'email', label: '이메일 (표 · 이메일)', icon: 'mail', meta: '리드' },
    { key: 'customFields.company', label: '회사명 (표 · 회사명)', icon: 'business', meta: 'customFields' },
    { key: 'customFields.phone', label: '연락처 (표 · 연락처)', icon: 'phone', meta: 'customFields' },
    { key: 'customFields.business_card', label: '명함 URL (표 · 명함)', icon: 'badge', meta: '이미지' },
    { key: 'source', label: '소스', icon: 'label', meta: '리드' },
    { key: 'customFields.address', label: '회사 주소', icon: 'location_on', meta: 'customFields' }
  ];

  const extra = (customFieldDefinitions || [])
    .filter((d) => d.key)
    .map((d) => ({
      key: `customFields.${d.key}`,
      label: `${d.label || d.key} (폼 추가 필드)`,
      icon: 'tune',
      meta: '추가'
    }));

  return [...tableLinked, ...extra];
}

/* ------------------------------------------------------------------ */
/*  기본 행 & 병합                                                      */
/* ------------------------------------------------------------------ */

function newMappingRowId() {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function defaultContactMappingRows() {
  return [
    { id: 'c1', sourceType: 'field', sourceKey: 'name', constantValue: '', targetKey: 'contact.name' },
    { id: 'c2', sourceType: 'field', sourceKey: 'email', constantValue: '', targetKey: 'contact.email' },
    { id: 'c3', sourceType: 'field', sourceKey: 'customFields.phone', constantValue: '', targetKey: 'contact.phone' },
    { id: 'c4', sourceType: 'field', sourceKey: 'customFields.company', constantValue: '', targetKey: 'contact.companyName' },
    { id: 'c5', sourceType: 'constant', sourceKey: '', constantValue: 'Lead', targetKey: 'contact.status' },
    { id: 'c6', sourceType: 'field', sourceKey: 'customFields.business_card', constantValue: '', targetKey: BUSINESS_CARD_AUTO_TARGET }
  ];
}

export function defaultCompanyMappingRows() {
  return [
    { id: 'co1', sourceType: 'field', sourceKey: 'customFields.company', constantValue: '', targetKey: 'company.name' },
    { id: 'co2', sourceType: 'field', sourceKey: 'name', constantValue: '', targetKey: 'company.representativeName' },
    { id: 'co3', sourceType: 'field', sourceKey: 'customFields.address', constantValue: '', targetKey: 'company.address' },
    { id: 'co4', sourceType: 'constant', sourceKey: '', constantValue: 'lead', targetKey: 'company.status' }
  ];
}

export function ensureContactMappingRowsComplete(rows) {
  const targets = new Set((rows || []).map((r) => r.targetKey));
  const add = [];
  for (const d of defaultContactMappingRows()) {
    if (!targets.has(d.targetKey)) {
      targets.add(d.targetKey);
      add.push({ ...d, id: newMappingRowId() });
    }
  }
  if (add.length === 0) return rows || [];
  return [...(rows || []), ...add];
}

export function ensureCompanyMappingRowsComplete(rows) {
  const targets = new Set((rows || []).map((r) => r.targetKey));
  const add = [];
  for (const d of defaultCompanyMappingRows()) {
    if (!targets.has(d.targetKey)) {
      targets.add(d.targetKey);
      add.push({ ...d, id: newMappingRowId() });
    }
  }
  if (add.length === 0) return rows || [];
  return [...(rows || []), ...add];
}

/** 커스텀 필드 정의 중 아직 매핑 행이 없으면 자동 추가 */
export function appendMissingCustomFieldRows(rows, prefix, customFieldDefs, formCustomFieldDefinitions) {
  const formKeys = new Set((formCustomFieldDefinitions || []).filter((d) => d && d.key).map((d) => d.key));
  const targets = new Set((rows || []).map((r) => r.targetKey));
  const add = [];
  for (const def of customFieldDefs || []) {
    if (!def || !def.key) continue;
    const tk = `${prefix}.customFields.${def.key}`;
    if (targets.has(tk)) continue;
    targets.add(tk);
    add.push({
      id: newMappingRowId(),
      sourceType: 'field',
      sourceKey: formKeys.has(def.key) ? `customFields.${def.key}` : '',
      constantValue: '',
      targetKey: tk
    });
  }
  if (add.length === 0) return rows || [];
  return [...(rows || []), ...add];
}

export function appendMissingContactCustomFieldRows(rows, contactFieldDefs, formCustomFieldDefinitions) {
  return appendMissingCustomFieldRows(rows, 'contact', contactFieldDefs, formCustomFieldDefinitions);
}

export function appendMissingCompanyCustomFieldRows(rows, companyFieldDefs, formCustomFieldDefinitions) {
  return appendMissingCustomFieldRows(rows, 'company', companyFieldDefs, formCustomFieldDefinitions);
}

/* ------------------------------------------------------------------ */
/*  미리보기 · 상태 · 저장                                              */
/* ------------------------------------------------------------------ */

function getLeadVal(lead, sourceKey) {
  if (!lead || !sourceKey) return '';
  if (sourceKey === 'name') return lead.name ?? '';
  if (sourceKey === 'email') return lead.email ?? '';
  if (sourceKey.startsWith('customFields.')) {
    const sub = sourceKey.slice('customFields.'.length);
    const cf = lead.customFields || {};
    return cf[sub] ?? '';
  }
  return (lead.customFields || {})[sourceKey] ?? '';
}

export function previewMappedValue(lead, row) {
  if (!row) return '';
  if (row.sourceType === 'constant') return row.constantValue ?? '';
  const v = getLeadVal(lead, row.sourceKey);
  if (v == null) return '';
  if (typeof v === 'object') return '[객체]';
  const s = String(v);
  if (s.length > 80) return `${s.slice(0, 77)}…`;
  return s;
}

export function rowStatus(row, preview, registerTarget) {
  if (!row.targetKey) return { type: 'err', label: '대상 없음' };
  if (row.targetKey === BUSINESS_CARD_AUTO_TARGET) {
    return { type: 'ok', label: '자동' };
  }
  if (row.sourceType === 'constant') {
    return row.constantValue != null && String(row.constantValue).trim() !== ''
      ? { type: 'ok', label: 'VALID' }
      : { type: 'warn', label: '값 입력' };
  }
  if (!row.sourceKey) return { type: 'warn', label: '소스 선택' };
  const empty = !preview || String(preview).trim() === '';
  if (empty) {
    if (registerTarget === 'company' && row.targetKey === 'company.name') {
      return { type: 'warn', label: '필수' };
    }
    if (registerTarget === 'contact' && ['contact.name', 'contact.email', 'contact.phone'].includes(row.targetKey)) {
      return { type: 'warn', label: '권장' };
    }
    return { type: 'muted', label: '빈 값' };
  }
  return { type: 'ok', label: 'VALID' };
}

export function toApiMappings(rows) {
  return (rows || [])
    .filter((r) => r.targetKey && r.targetKey !== BUSINESS_CARD_AUTO_TARGET)
    .map((r) => ({
      sourceType: r.sourceType === 'constant' ? 'constant' : 'field',
      sourceKey: r.sourceType === 'constant' ? '' : (r.sourceKey || ''),
      constantValue: r.sourceType === 'constant' ? String(r.constantValue ?? '') : '',
      targetKey: r.targetKey
    }));
}

export function rowsFromSavedMappings(mappings, registerTarget) {
  const prefix = registerTarget === 'company' ? 'company.' : 'contact.';
  const list = (mappings || []).filter((m) => String(m.targetKey || '').startsWith(prefix));
  if (list.length === 0) {
    return registerTarget === 'company' ? defaultCompanyMappingRows() : defaultContactMappingRows();
  }
  return list.map((m, i) => ({
    id: `api-${i}`,
    sourceType: m.sourceType === 'constant' ? 'constant' : 'field',
    sourceKey: m.sourceKey || '',
    constantValue: m.constantValue != null ? String(m.constantValue) : '',
    targetKey: m.targetKey || ''
  }));
}

export function inferRegisterTargetFromMappings(mappings) {
  const m = mappings || [];
  if (m.length === 0) return 'contact';
  const allCo = m.every((row) => String(row.targetKey || '').startsWith('company.'));
  if (allCo) return 'company';
  return 'contact';
}
