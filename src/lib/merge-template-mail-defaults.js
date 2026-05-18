const MAIL_KEYS = [
  { rowKey: '_mailTo', defaultKey: 'mailTo' },
  { rowKey: '_mailCc', defaultKey: 'mailCc' },
  { rowKey: '_mailSubject', defaultKey: 'mailSubject' },
  { rowKey: '_mailBody', defaultKey: 'mailBody' }
];

const ROW_INDEX_KEY = 'rowIndex';

/** `{{치환자}}`에 넣는 동적 값 — Excel/PDF용 줄바꿈만 쉼표로 (본문 템플릿 줄바꿈은 유지) */
export function commaJoinMailTokenLineBreaks(s) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  return t.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+/g, ',');
}

/** 메일 시트·양식 등록 UI — 받는 사람/참조 고정 치환자 */
export const MERGE_MAIL_FIXED_TOKENS = [
  { key: 'Target_Email', label: '받는 이메일', rowKey: '_mailTo' },
  { key: 'ReferenceEmail', label: '참조 이메일', rowKey: '_mailCc' }
];

const MAIL_TOKEN_ALIASES = {
  target_email: '__mailTo__',
  targetemail: '__mailTo__',
  받는이메일: '__mailTo__',
  referenceemail: '__mailCc__',
  참조이메일: '__mailCc__',
  customercompany: 'companyName',
  customer: 'companyName',
  company: 'companyName',
  companyname: 'companyName',
  고객사: 'companyName',
  고객사명: 'companyName',
  contactname: 'representativeName',
  contact: 'representativeName',
  고객명: 'representativeName',
  대표자: 'representativeName',
  대표자명: 'representativeName',
  customerdisplayname: '__customerDisplayName__',
  고객표시명: '__customerDisplayName__',
  displayname: '__customerDisplayName__'
};

function normalizeMailTokenKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function fieldList(fields) {
  return Array.isArray(fields)
    ? fields.filter((f) => {
        const key = String(f?.key || '').trim();
        return key && key !== ROW_INDEX_KEY;
      })
    : [];
}

/** 위·복사용 표와 동일 — 메일·시트에서 쓸 수 있는 `{{key}}` 목록 */
export function listMergeMailTokens(fields) {
  return fieldList(fields).map((f) => {
    const key = String(f.key).trim();
    const label = String(f.label || key).trim();
    return { key, label, token: `{{${key}}}` };
  });
}

/** 양식 등록 UI — 현재 필드 구성 기준 안내 문구 */
export function buildMergeMailTokenHintFromFields(fields) {
  const tokens = listMergeMailTokens(fields);
  if (!tokens.length) {
    return '치환 항목을 불러온 뒤, 아래 치환자를 메일 제목·본문에 넣을 수 있습니다. 데이터 시트 열 때 행 값으로 자동 치환됩니다.';
  }
  const sample = tokens
    .slice(0, 6)
    .map((t) => t.token)
    .join(', ');
  const more = tokens.length > 6 ? ` 외 ${tokens.length - 6}개` : '';
  return `제목·본문에 위 표와 같은 치환자(예: ${sample}${more})를 넣으면, 데이터 시트에서 그때그때 행 데이터로 치환됩니다. 표시 이름으로도 쓸 수 있습니다(예: {{고객사명}}). 고정: {{Target_Email}} 받는 이메일, {{ReferenceEmail}} 참조 이메일. 추가: {{customerDisplayName}} — 고객사 없으면 연락처·대표자명.`;
}

function getRowFieldValue(row, fieldKey) {
  if (!row || !fieldKey) return '';
  const v = row[fieldKey];
  return v != null ? String(v).trim() : '';
}

/** 고객사명 우선, 없으면 대표자/연락처명 */
function resolveCustomerDisplayName(row, fields) {
  const company = getRowFieldValue(row, 'companyName');
  if (company) return company;
  for (const key of ['representativeName', 'contactName']) {
    const v = getRowFieldValue(row, key);
    if (v) return v;
  }
  for (const f of fieldList(fields)) {
    const lab = normalizeMailTokenKey(f.label);
    if (lab === '고객명' || lab === '연락처명' || lab === 'contactname') {
      const v = getRowFieldValue(row, f.key);
      if (v) return v;
    }
  }
  return '';
}

/**
 * @param {string} token 괄호 안 문자열
 * @param {object[]} fields
 * @returns {string | null} merge field key 또는 __customerDisplayName__
 */
export function resolveMailTokenFieldKey(token, fields) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  if (raw === 'Target_Email') return '__mailTo__';
  if (raw === 'ReferenceEmail') return '__mailCc__';
  const list = fieldList(fields);
  const exact = list.find((f) => String(f.key) === raw);
  if (exact) return exact.key;
  const ci = list.find((f) => String(f.key).toLowerCase() === raw.toLowerCase());
  if (ci) return ci.key;
  const norm = normalizeMailTokenKey(raw);
  if (MAIL_TOKEN_ALIASES[norm]) return MAIL_TOKEN_ALIASES[norm];
  const byLabel = list.find((f) => normalizeMailTokenKey(f.label) === norm);
  if (byLabel) return byLabel.key;
  return null;
}

function buildMailSubstOpts(rowKey, extra = {}) {
  return {
    commaJoinLineBreaks: rowKey === '_mailBody',
    skipMailFixedTokens: rowKey === '_mailTo' || rowKey === '_mailCc',
    ...extra
  };
}

function resolveMailFixedTokenRowValue(rowKey, row, fields, opts = {}) {
  if (opts.skipMailFixedTokens) return '';
  const direct = String(row?.[rowKey] ?? '').trim();
  if (direct) {
    if (direct.includes('{{')) {
      return substituteMergeMailTokens(direct, row, fields, buildMailSubstOpts(rowKey, { ...opts, skipMailFixedTokens: true }));
    }
    return direct;
  }
  if (opts.templateProfilesById) {
    return resolveMergeRowMailField(
      row,
      rowKey,
      opts.templateProfilesById,
      fields,
      opts.pageMailFallback ?? null,
      opts
    );
  }
  return '';
}

export function resolveMailTokenValue(token, row, fields, opts = {}) {
  const commaJoin = Boolean(opts.commaJoinLineBreaks);
  const resolved = resolveMailTokenFieldKey(token, fields);
  let v = '';
  if (resolved === '__mailTo__') {
    v = resolveMailFixedTokenRowValue('_mailTo', row, fields, opts);
  } else if (resolved === '__mailCc__') {
    v = resolveMailFixedTokenRowValue('_mailCc', row, fields, opts);
  } else if (resolved === '__customerDisplayName__') {
    v = resolveCustomerDisplayName(row, fields);
  } else if (resolved) {
    v = getRowFieldValue(row, resolved);
  }
  return commaJoin ? commaJoinMailTokenLineBreaks(v) : v;
}

/**
 * `{{fieldKey}}` · `{{고객사명}}` · `{{Customer Company}}` 등 치환
 * @param {{ commaJoinLineBreaks?: boolean }} [opts] 메일 본문용 — 동적 값 줄바꿈만 `,` 로
 */
export function substituteMergeMailTokens(template, row, fields, opts = {}) {
  const src = String(template || '');
  if (!src.includes('{{')) return src;
  return src.replace(/\{\{([^}]+)\}\}/g, (_, inner) =>
    resolveMailTokenValue(inner, row, fields, opts)
  );
}

export function templateProfileHasMailDefaults(mailDefaults) {
  if (!mailDefaults || typeof mailDefaults !== 'object') return false;
  return MAIL_KEYS.some(({ defaultKey }) => String(mailDefaults[defaultKey] || '').trim());
}

/**
 * 제목·본문 — 양식 프로필 문자열에 {{ }} 가 있으면 행 데이터로 다시 치환
 */
export function refreshMailTokensFromProfile(row, mailDefaults, fields, mailResolveCtx = null) {
  if (!mailDefaults || !templateProfileHasMailDefaults(mailDefaults)) return row;
  const ctx = mailResolveCtx && typeof mailResolveCtx === 'object' ? mailResolveCtx : {};
  const next = { ...row };
  for (const { rowKey, defaultKey } of MAIL_KEYS) {
    const raw = String(mailDefaults[defaultKey] || '').trim();
    if (!raw.includes('{{')) continue;
    next[rowKey] = substituteMergeMailTokens(raw, next, fields, buildMailSubstOpts(rowKey, ctx));
  }
  return next;
}

/**
 * 빈 메일 칸만 양식 기본값·fallback으로 채움.
 * @param {object} [mailResolveCtx] `{ templateProfilesById, pageMailFallback }` — {{Target_Email}} 등 치환용
 */
export function applyMailDefaultsToMergeRow(row, mailDefaults, mergeMailFallback, fields, mailResolveCtx = null) {
  const ctx =
    mailResolveCtx && typeof mailResolveCtx === 'object'
      ? mailResolveCtx
      : { pageMailFallback: mergeMailFallback };
  if (!ctx.pageMailFallback && mergeMailFallback) ctx.pageMailFallback = mergeMailFallback;
  const next = { ...row };
  for (const { rowKey, defaultKey } of MAIL_KEYS) {
    if (String(next[rowKey] || '').trim()) continue;
    for (const src of [mailDefaults, mergeMailFallback]) {
      if (!src) continue;
      const raw = String(src[defaultKey] || '').trim();
      if (!raw) continue;
      next[rowKey] = substituteMergeMailTokens(raw, next, fields, buildMailSubstOpts(rowKey, ctx));
      break;
    }
  }
  return next;
}

export function primaryTemplateIdFromRow(row) {
  if (!row) return '';
  const ids = Array.isArray(row._templateIds) ? row._templateIds : row._templateId ? [row._templateId] : [];
  return ids.map(String).find(Boolean) || '';
}

export function mailDefaultsForRow(row, templateProfilesById) {
  const tid = primaryTemplateIdFromRow(row);
  if (!tid || !templateProfilesById) return null;
  return templateProfilesById[String(tid)]?.mailDefaults || null;
}

function mailDefaultKeyForRowKey(rowKey) {
  return MAIL_KEYS.find((k) => k.rowKey === rowKey)?.defaultKey || '';
}

function resolveMailDefaultString(raw, row, fields, rowKey, mailResolveCtx = null) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const ctx = mailResolveCtx && typeof mailResolveCtx === 'object' ? mailResolveCtx : {};
  return s.includes('{{')
    ? substituteMergeMailTokens(s, row, fields, buildMailSubstOpts(rowKey, ctx))
    : s;
}

/**
 * 메일 칸 실제 사용 값 — 1) 시트 행 입력 2) 행 사용 양식 프로필 3) 페이지 fallback(quotation 등록 등)
 */
export function resolveMergeRowMailField(
  row,
  rowKey,
  templateProfilesById,
  fields,
  pageMailFallback = null,
  mailResolveCtx = null
) {
  const direct = String(row?.[rowKey] ?? '').trim();
  if (direct) {
    if (direct.includes('{{')) {
      const ctx = {
        ...(mailResolveCtx && typeof mailResolveCtx === 'object' ? mailResolveCtx : {}),
        templateProfilesById,
        pageMailFallback
      };
      return substituteMergeMailTokens(direct, row, fields, buildMailSubstOpts(rowKey, { ...ctx, skipMailFixedTokens: true }));
    }
    return direct;
  }

  const defaultKey = mailDefaultKeyForRowKey(rowKey);
  if (!defaultKey) return '';

  const substCtx = {
    ...(mailResolveCtx && typeof mailResolveCtx === 'object' ? mailResolveCtx : {}),
    templateProfilesById,
    pageMailFallback
  };
  const prof = mailDefaultsForRow(row, templateProfilesById);
  const sources = [prof, pageMailFallback].filter(
    (src) => src && templateProfileHasMailDefaults(src)
  );
  for (const src of sources) {
    const v = resolveMailDefaultString(src[defaultKey], row, fields, rowKey, substCtx);
    if (v) return v;
  }
  return '';
}

/** 보내기(mailto) 등에 쓸 메일 필드 일괄 해석 */
export function resolveMergeRowMailFields(row, templateProfilesById, fields, pageMailFallback = null) {
  return {
    mailTo: resolveMergeRowMailField(row, '_mailTo', templateProfilesById, fields, pageMailFallback),
    mailCc: resolveMergeRowMailField(row, '_mailCc', templateProfilesById, fields, pageMailFallback),
    mailSubject: resolveMergeRowMailField(
      row,
      '_mailSubject',
      templateProfilesById,
      fields,
      pageMailFallback
    ),
    mailBody: resolveMergeRowMailField(row, '_mailBody', templateProfilesById, fields, pageMailFallback)
  };
}

/** 치환 필드(고객사명 등)에 값이 하나라도 있는지 */
export function mergeRowHasFieldData(row, fields) {
  return fieldList(fields).some((f) => String(row?.[f.key] ?? '').trim());
}

export function clearMergeRowMailFields(row) {
  const next = { ...row };
  for (const { rowKey } of MAIL_KEYS) next[rowKey] = '';
  return next;
}

/** 빈 시트 메일 칸만 양식·fallback으로 채움(이미 입력된 칸은 유지) */
export function hydrateMergeRowMailFromProfiles(
  row,
  templateProfilesById,
  fields,
  pageMailFallback = null
) {
  const preserved = {};
  for (const { rowKey } of MAIL_KEYS) {
    const v = String(row?.[rowKey] ?? '').trim();
    if (v) preserved[rowKey] = v;
  }
  const prof = mailDefaultsForRow(row, templateProfilesById);
  const mailResolveCtx = { templateProfilesById, pageMailFallback };
  let next = applyMailDefaultsToMergeRow({ ...row }, prof, pageMailFallback, fields, mailResolveCtx);
  next = refreshMailTokensFromProfile(next, prof, fields, mailResolveCtx);
  for (const [rowKey, val] of Object.entries(preserved)) {
    next[rowKey] = val;
  }
  return next;
}
