/**
 * 세일즈 기회 → 견적/발주 문서 메일머지 시트 매핑용 소스 목록·값 해석.
 */

import { computeLineFinalAmount, parseNumber } from '@/lib/sales-opportunity-form-shared';

/** 제품 행마다 한 줄 — 칸·문서에서 줄바꿈으로 구분(한 줄에 `/`로 이으면 끝이 잘리기 쉬움) */
function linesSummary(lineItems) {
  const rows = Array.isArray(lineItems) ? lineItems : [];
  if (!rows.length) return '';
  return rows
    .map((l) => {
      const name = String(l?.productName || '').trim() || '제품';
      const qty = Math.max(0, Number(l?.quantity) || 1);
      return `${name} ×${qty}`;
    })
    .join('\n');
}

/** 제품명만, 행 순서 = lineItems 순서 — `derived.linesQuantities` 와 같은 줄 수로 맞춤 */
function linesProductNamesOnly(lineItems) {
  const rows = Array.isArray(lineItems) ? lineItems : [];
  if (!rows.length) return '';
  return rows.map((l) => String(l?.productName || '').trim() || '제품').join('\n');
}

/** 수량만(숫자), 행 순서 = lineItems 순서 — 제품명 열과 한 줄씩 대응 */
function linesQuantitiesOnly(lineItems) {
  const rows = Array.isArray(lineItems) ? lineItems : [];
  if (!rows.length) return '';
  return rows.map((l) => String(Math.max(0, Number(l?.quantity) || 1))).join('\n');
}

/** 단가만(숫자) — 기회 모달 제품 행 `unitPrice` 입력과 동일하게 `parseNumber` 해석 */
function linesUnitPricesOnly(lineItems) {
  const rows = Array.isArray(lineItems) ? lineItems : [];
  if (!rows.length) return '';
  return rows.map((l) => String(parseNumber(l?.unitPrice))).join('\n');
}

/** 행별 금액(할인 반영 후) — 기회 모달 `computeLineFinalAmount` 와 동일(수량×단가−할인·율) */
function linesLineFinalAmountsOnly(lineItems) {
  const rows = Array.isArray(lineItems) ? lineItems : [];
  if (!rows.length) return '';
  return rows.map((l) => String(computeLineFinalAmount(l))).join('\n');
}

/**
 * @param {{
 *   form: object,
 *   lineItems: object[],
 *   financeCustomFieldValues: object,
 *   scheduleCustomDates: object,
 *   financeFieldDefs: { key: string, label?: string, type?: string }[],
 *   scheduleFieldDefs: { key: string, label?: string, type?: string }[],
 *   businessNumber?: string,
 *   quoteDocRecipientEmail?: string,
 *   quoteDocCcEmail?: string,
 *   purchaseOrderDocRecipientEmail?: string,
 *   purchaseOrderDocCcEmail?: string,
 *   docEmailReferenceSlots?: { key: string, alias?: string }[]
 * }} ctx
 * @returns {{ id: string, label: string }[]}
 */
export function buildOpportunityMergeSourceOptions(ctx) {
  const c = ctx || {};
  const form = c.form || {};
  const opts = [];

  const add = (id, label) => {
    if (!id) return;
    opts.push({ id, label });
  };

  add('form.title', '기회명(자동 제목 등)');
  add('form.contactName', '고객명');
  add('form.contactPhone', '고객 전화');
  add('form.contactEmail', '고객 이메일');
  add('form.customerCompanyName', '고객사명');
  add('form.customerCompanyAddress', '고객사 주소');
  add('form.description', '기회 설명');
  add('form.contractAmount', '계약금액(입력값)');
  add('form.invoiceAmount', '계산서 금액(입력값)');
  add('form.expectedCloseMonth', '예상 마감 월');
  add('form.startDate', '시작일');
  add('form.targetDate', '목표일');
  add('form.saleDate', '수주·판매일');
  add('form.assignedToName', '판매 담당 이름');
  add('snapshot.businessNumber', '사업자번호(표시)');
  add('derived.linesSummary', '제품·수량 (줄마다 1제품, 이름×수량)');
  add('derived.linesProductNames', '제품명만 (줄마다 1행·수량 열과 순서 동일)');
  add('derived.linesQuantities', '수량만 (줄마다 1행·제품명 열과 순서 동일)');
  add('derived.linesUnitPrices', '단가만 (줄마다 1행·제품명 열과 순서 동일)');
  add('derived.linesLineAmounts', '행별 금액(할인 반영, 줄마다 1행·제품명 열과 순서 동일)');

  add('fixed.docRecipientEmail', '받는 메일 주소(기회 문서 메일)');
  add('fixed.docCcEmail', '참조 메일 주소 CC(기회 문서 메일)');

  for (const slot of c.docEmailReferenceSlots || []) {
    const k = String(slot?.key || '').trim();
    if (!k) continue;
    const al = String(slot?.alias || '').trim();
    add(`slot.${k}`, al ? `참조 슬롯: ${al} (${k})` : `참조 슬롯: ${k}`);
  }

  for (const d of c.financeFieldDefs || []) {
    const key = String(d?.key || '').trim();
    if (!key) continue;
    const lab = String(d?.label || key).trim();
    add(`finance.${key}`, `추가 필드(계약·수금): ${lab}`);
  }

  for (const d of c.scheduleFieldDefs || []) {
    const key = String(d?.key || '').trim();
    if (!key) continue;
    const lab = String(d?.label || key).trim();
    add(`schedule.${key}`, `추가 일정: ${lab}`);
  }

  return opts;
}

/** 매핑 드롭다운 「문서 메일란」 그룹 — 기회 모달 받는 사람·CC 와 동일(견적·발주 통합) */
export const OPPORTUNITY_DOC_MAIL_FIXED_SOURCES = [
  { id: 'fixed.docRecipientEmail', label: '받는 메일 주소(기회 문서 메일)' },
  { id: 'fixed.docCcEmail', label: '참조 메일 주소 CC(기회 문서 메일)' }
];

/** 예전 4분할 소스 id → 통합 2개 (저장된 매핑 프리셋 호환) */
export function normalizeOpportunityMergeSourceId(sourceId) {
  const s = String(sourceId || '').trim();
  if (s === 'fixed.quoteDocRecipientEmail' || s === 'fixed.purchaseOrderDocRecipientEmail') {
    return 'fixed.docRecipientEmail';
  }
  if (s === 'fixed.quoteDocCcEmail' || s === 'fixed.purchaseOrderDocCcEmail') {
    return 'fixed.docCcEmail';
  }
  return s;
}

/** 기회 모달 받는 메일 주소 입력과 동일(견적·발주 둘 다 있으면 견적 우선) */
export function resolveOpportunityDocRecipientEmail(ctx) {
  const q = String(ctx?.quoteDocRecipientEmail || '').trim();
  const p = String(ctx?.purchaseOrderDocRecipientEmail || '').trim();
  if (q && p && q !== p) return q;
  return q || p;
}

/** 기회 모달 참조(CC) 입력과 동일 */
export function resolveOpportunityDocCcEmail(ctx) {
  const q = String(ctx?.quoteDocCcEmail || '').trim();
  const p = String(ctx?.purchaseOrderDocCcEmail || '').trim();
  if (q && p && q !== p) return q;
  return q || p;
}

/** 데이터 시트 _mailTo / _mailCc 가 비어 있을 때 쓸 fallback */
export function buildOpportunityDocMailFallback(ctx) {
  const mailTo = resolveOpportunityDocRecipientEmail(ctx);
  const mailCc = resolveOpportunityDocCcEmail(ctx);
  if (!mailTo && !mailCc) return null;
  return { mailTo, mailCc, mailSubject: '', mailBody: '' };
}

/** 치환 매핑에서「받는 메일 주소(기회 문서 메일)」소스를 쓰는지 */
export function opportunityMappingUsesDocRecipient(mappingRows) {
  return (mappingRows || []).some((r) => {
    if (r?.sourceType === 'constant') return false;
    return normalizeOpportunityMergeSourceId(r?.sourceKey) === 'fixed.docRecipientEmail';
  });
}

/** 치환 매핑에서「참조 CC(기회 문서 메일)」소스를 쓰는지 */
export function opportunityMappingUsesDocCc(mappingRows) {
  return (mappingRows || []).some((r) => {
    if (r?.sourceType === 'constant') return false;
    return normalizeOpportunityMergeSourceId(r?.sourceKey) === 'fixed.docCcEmail';
  });
}

/**
 * 기회 문서 메일 fallback — 매핑에 명시한 칸만 기회 모달 값 허용.
 * 받는 사람·CC를 매핑하지 않았으면 양식 등록(quotation-doc-merge) mailDefaults가 우선.
 */
export function buildOpportunityMergeMailFallback(ctx, mappingRows) {
  const full = buildOpportunityDocMailFallback(ctx);
  if (!full) return null;
  const usesTo = opportunityMappingUsesDocRecipient(mappingRows);
  const usesCc = opportunityMappingUsesDocCc(mappingRows);
  if (!usesTo && !usesCc) return null;
  return {
    mailTo: usesTo ? full.mailTo : '',
    mailCc: usesCc ? full.mailCc : '',
    mailSubject: '',
    mailBody: ''
  };
}

const MERGE_SOURCE_GROUP_ORDER = [
  { key: 'fixed', label: '문서 메일란 (기회 저장)', match: (id) => id.startsWith('fixed.') },
  { key: 'form', label: '기회 폼', match: (id) => id.startsWith('form.') },
  { key: 'derived', label: '제품·파생', match: (id) => id.startsWith('derived.') },
  { key: 'snapshot', label: '스냅샷', match: (id) => id.startsWith('snapshot.') },
  { key: 'slot', label: '참조 슬롯', match: (id) => id.startsWith('slot.') },
  { key: 'finance', label: '계약·수금 추가 필드', match: (id) => id.startsWith('finance.') },
  { key: 'schedule', label: '일정 추가 필드', match: (id) => id.startsWith('schedule.') }
];

/** 매핑 `<select>`용 — 문서 메일란 소스가 목록 상단에 보이도록 그룹화 */
export function groupOpportunityMergeSourceOptions(opts) {
  const list = Array.isArray(opts) ? opts : [];
  const used = new Set();
  const groups = [];
  for (const g of MERGE_SOURCE_GROUP_ORDER) {
    const items = list.filter((o) => {
      if (used.has(o.id)) return false;
      if (!g.match(o.id)) return false;
      used.add(o.id);
      return true;
    });
    if (items.length) groups.push({ label: g.label, items });
  }
  const rest = list.filter((o) => !used.has(o.id));
  if (rest.length) groups.push({ label: '기타', items: rest });
  return groups;
}

/**
 * @param {string} sourceId
 * @param {object} ctx mergeContext (기회 모달에서 넘김)
 */
export function resolveOpportunityMergeSourceValue(sourceId, ctx) {
  if (sourceId == null || sourceId === '') return '';
  const sid = normalizeOpportunityMergeSourceId(sourceId);
  const form = ctx?.form || {};
  const fc = ctx?.financeCustomFieldValues || {};
  const sc = ctx?.scheduleCustomDates || {};

  if (sid.startsWith('form.')) {
    const k = sid.slice(5);
    const v = form[k];
    return v != null ? String(v) : '';
  }
  if (sid === 'snapshot.businessNumber') {
    return String(ctx?.businessNumber || '').trim();
  }
  if (sid === 'derived.linesSummary') {
    return linesSummary(ctx?.lineItems);
  }
  if (sid === 'derived.linesProductNames') {
    return linesProductNamesOnly(ctx?.lineItems);
  }
  if (sid === 'derived.linesQuantities') {
    return linesQuantitiesOnly(ctx?.lineItems);
  }
  if (sid === 'derived.linesUnitPrices') {
    return linesUnitPricesOnly(ctx?.lineItems);
  }
  if (sid === 'derived.linesLineAmounts') {
    return linesLineFinalAmountsOnly(ctx?.lineItems);
  }
  if (sid === 'fixed.docRecipientEmail') return resolveOpportunityDocRecipientEmail(ctx);
  if (sid === 'fixed.docCcEmail') return resolveOpportunityDocCcEmail(ctx);
  if (sid.startsWith('slot.')) {
    const key = sid.slice(5);
    const slot = (ctx?.docEmailReferenceSlots || []).find((s) => String(s?.key || '').trim() === key);
    return String(slot?.addresses || '').trim();
  }
  if (sid.startsWith('finance.')) {
    const k = sid.slice(8);
    const v = fc[k];
    if (v == null) return '';
    if (typeof v === 'boolean') return v ? '예' : '아니오';
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  }
  if (sid.startsWith('schedule.')) {
    const k = sid.slice(9);
    const v = sc[k];
    return v != null ? String(v) : '';
  }
  return '';
}
