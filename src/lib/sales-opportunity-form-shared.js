/**
 * 영업 기회( opportunity-modal )와 동일한 단계·라인 아이템 API 형식.
 * opportunity-modal.js 가 바뀔 때 이 파일의 페이로드·단계 목록을 함께 맞춥니다.
 */
import { suggestedPriceFromProduct, OPPORTUNITY_PRICE_BASIS_OPTIONS } from '@/lib/product-price-utils';

/**
 * 기본 파이프라인 단계(커스텀 정의 없을 때) — `sales-pipeline.js` 의 DEFAULT_ACTIVE_STAGES / 라벨과 동일 순서·문구 유지
 */
export const DEFAULT_PIPELINE_ACTIVE_STAGES = [
  'NewLead',
  'Contacted',
  'ProposalSent',
  'TechDemo',
  'Quotation',
  'Negotiation',
  'Won'
];

export const DEFAULT_PIPELINE_STAGE_LABELS = {
  NewLead: '신규 리드 & 추가 구매건',
  Contacted: '연락 완료',
  ProposalSent: '제안서 전달 완료',
  TechDemo: '기술 시연',
  Quotation: '견적',
  Negotiation: '최종 협상',
  Won: '수주 성공',
  Lost: '기회 상실',
  Abandoned: '보류'
};

/** 레거시·단순 화면용(커스텀 단계 없을 때) */
export const OPPORTUNITY_STAGE_OPTIONS = [
  { value: 'NewLead', label: '신규 리드' },
  { value: 'Contacted', label: '연락 완료' },
  { value: 'ProposalSent', label: '제안서 전달' },
  { value: 'TechDemo', label: '기술 시연' },
  { value: 'Quotation', label: '견적' },
  { value: 'Negotiation', label: '최종 협상' },
  { value: 'Won', label: '수주 성공' },
  { value: 'Lost', label: '기회 상실' },
  { value: 'Abandoned', label: '보류' }
];

/**
 * `custom-field-definitions?entityType=salesPipelineStage` 결과 → 기회 모달·파이프라인과 동일한 단계 선택지
 * (칸반 열 순서·커스텀 단계 포함, 끝에 Won / Lost / Abandoned 고정 추가 — sales-pipeline.js 와 동일 규칙)
 */
export function buildPipelineStageSelectOptionsFromDefinitions(stageDefinitions) {
  const defs = Array.isArray(stageDefinitions) ? stageDefinitions : [];
  const activeStages =
    defs.length > 0
      ? defs
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((d) => d.key)
          .filter((k) => k && String(k).trim())
      : [...DEFAULT_PIPELINE_ACTIVE_STAGES];
  const labelsFromDefs =
    defs.length > 0 ? Object.fromEntries(defs.map((d) => [d.key, d.label]).filter(([k]) => k)) : null;
  const labels = { ...DEFAULT_PIPELINE_STAGE_LABELS, ...(labelsFromDefs || {}) };
  const board = activeStages.filter((stage) => stage !== 'Won');
  const base = board.map((key) => ({ value: key, label: labels[key] ?? key }));
  return base.concat(
    [{ value: 'Won', label: labels.Won ?? '수주 성공' }],
    [{ value: 'Lost', label: labels.Lost ?? '기회 상실' }, { value: 'Abandoned', label: labels.Abandoned ?? '보류' }]
  );
}

export function computeLineFinalAmount(line) {
  const qty = Math.max(0, Number(line.quantity) || 1);
  const unit = parseNumber(line.unitPrice) || 0;
  let subtotal = qty * unit;
  const dRate = Math.max(0, Math.min(100, Number(line.discountRate) || 0));
  const dAmount = parseNumber(line.discountAmount) || 0;
  if (dRate > 0) subtotal = subtotal * (1 - dRate / 100);
  subtotal = Math.max(0, subtotal - dAmount);
  return Math.round(subtotal);
}

export function computeLineDeduction(line) {
  const qty = Math.max(0, Number(line.quantity) || 1);
  const unit = parseNumber(line.unitPrice) || 0;
  const subtotal = qty * unit;
  return Math.max(0, subtotal - computeLineFinalAmount(line));
}

export function computeTotalFinalAmount(lineItems) {
  return (Array.isArray(lineItems) ? lineItems : []).reduce((sum, line) => sum + computeLineFinalAmount(line), 0);
}

export function computeTotalDeduction(lineItems) {
  return (Array.isArray(lineItems) ? lineItems : []).reduce((sum, line) => sum + computeLineDeduction(line), 0);
}

export function parseNumber(val) {
  return Number(String(val).replace(/[^0-9]/g, '')) || 0;
}

export function formatNumberInput(val) {
  const num = String(val).replace(/[^0-9]/g, '');
  if (!num) return '';
  return Number(num).toLocaleString();
}

export function priceBasisLabelsForValue(value) {
  const opt = OPPORTUNITY_PRICE_BASIS_OPTIONS.find((o) => o.value === value);
  return {
    priceBasisLabel: opt?.label ?? (value === 'channel' ? '유통' : '다이렉트'),
    priceBasisShortLabel: opt?.shortLabel != null ? String(opt.shortLabel) : ''
  };
}

export function newOppLineId() {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function newCommissionRecipientId() {
  return `commission-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function createEmptyCommissionRow() {
  return { id: newCommissionRecipientId(), remarks: '', commissionAmount: '' };
}

export function buildLineFromProduct(product, priceBasisPref = 'consumer') {
  const basis = priceBasisPref === 'channel' ? 'channel' : 'consumer';
  const { priceBasisLabel, priceBasisShortLabel } = priceBasisLabelsForValue(basis);
  const price = suggestedPriceFromProduct(product, basis);
  const cost = Number(product.costPrice);
  const qty = 1;
  const pc =
    Number.isFinite(cost) && cost >= 0 && qty > 0 ? Math.round(cost * qty).toLocaleString() : '';
  return {
    lineId: newOppLineId(),
    productId: String(product._id),
    productName: product.name || '',
    unitPrice: price > 0 ? price.toLocaleString() : '',
    priceBasis: basis,
    priceBasisLabel,
    priceBasisShortLabel,
    channelDistributor: '',
    quantity: '1',
    discountRate: '',
    discountAmount: '',
    purchaseCostTotal: pc,
    commissionRecipients: [createEmptyCommissionRow()]
  };
}

export function buildLineItemsPayloadFromClientLines(lineItems) {
  return (Array.isArray(lineItems) ? lineItems : []).map((li) => {
    const basis = li.priceBasis === 'channel' ? 'channel' : 'consumer';
    const fb = priceBasisLabelsForValue(basis);
    return {
      productId: li.productId || null,
      productName: li.productName?.trim() || '',
      unitPrice: parseNumber(li.unitPrice),
      unitPriceBasis: basis,
      unitPriceBasisLabel: String(li.priceBasisLabel || '').trim().slice(0, 80) || fb.priceBasisLabel,
      unitPriceBasisShortLabel:
        String(li.priceBasisShortLabel != null ? li.priceBasisShortLabel : '').trim().slice(0, 80) ||
        fb.priceBasisShortLabel,
      channelDistributor: li.priceBasis === 'channel' ? String(li.channelDistributor || '').trim() : '',
      quantity: Math.max(0, Number(li.quantity) || 1),
      discountRate: Math.max(0, Math.min(100, Number(li.discountRate) || 0)),
      discountAmount: parseNumber(li.discountAmount) || 0,
      commissionRecipients: (Array.isArray(li.commissionRecipients) ? li.commissionRecipients : [])
        .map((r) => ({
          remarks: String(r.remarks || '').trim().slice(0, 2000),
          commissionAmount: parseNumber(r.commissionAmount) || 0
        }))
        .filter((r) => r.remarks || r.commissionAmount > 0)
    };
  });
}

export function toIsoDateForOpportunityPayload(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const parsed = new Date(`${s}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
}

/**
 * POST /sales-opportunities 본문 — opportunity-modal 저장 시 lineItems·스냅샷 규칙과 동일.
 * Drive·증빙은 일괄 등록에서 비움.
 */
export function buildOpportunityCreatePayload({
  title,
  personalPurchase,
  customerCompanyId,
  customerCompanyEmployeeId,
  contactName,
  contactPhone,
  contactEmail,
  snapshotCompanyName,
  snapshotCompanyBusinessNumber,
  snapshotCompanyAddress,
  snapshotContactName,
  snapshotContactPhone,
  snapshotContactEmail,
  lineItemsClient,
  currency,
  stage,
  description,
  saleDateYmd,
  startDateYmd,
  targetDateYmd,
  expectedCloseMonth,
  assignedToUserId,
  contractAmountStr,
  fullCollectionCompleteDateYmd,
  invoiceAmountStr,
  invoiceAmountDateYmd,
  licenseCertificateDeliveredDateYmd,
  collectionEntriesClient,
  scheduleFieldDefs,
  scheduleCustomDates,
  documentRefs: documentRefsIn,
  driveFolderLink: driveFolderLinkIn
}) {
  const selectedStage = stage || 'NewLead';
  const sd = String(saleDateYmd || '').trim();
  let saleDatePayload = null;
  if (selectedStage === 'Won') {
    if (sd) {
      const parsed = new Date(`${sd}T12:00:00`);
      saleDatePayload = !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
    }
  }
  const ccIdPayload = personalPurchase ? null : customerCompanyId || null;
  const empIdPayload = customerCompanyEmployeeId || null;

  const lineItemsPayload = buildLineItemsPayloadFromClientLines(lineItemsClient);
  const collectionEntriesPayload = (Array.isArray(collectionEntriesClient) ? collectionEntriesClient : [])
    .map((entry) => {
      const amount = parseNumber(entry?.amount);
      const date = toIsoDateForOpportunityPayload(entry?.date);
      if (amount <= 0 && !date) return null;
      return { amount: Math.max(0, amount), date };
    })
    .filter(Boolean);

  const targetDateRaw = String(targetDateYmd || '').trim();
  const targetYm = /^\d{4}-\d{2}-\d{2}$/.test(targetDateRaw) ? targetDateRaw.slice(0, 7) : '';
  const ymFallback = String(expectedCloseMonth || '').trim();
  const expectedCloseMonthPayload = /^\d{4}-\d{2}$/.test(targetYm)
    ? targetYm
    : /^\d{4}-\d{2}$/.test(ymFallback)
      ? ymFallback
      : '';

  const li0 = lineItemsClient?.[0];
  const snap = {
    snapshotUnitPriceBasisLabel: (() => {
      if (!li0) return '';
      const fb = priceBasisLabelsForValue(li0.priceBasis === 'channel' ? 'channel' : 'consumer');
      return String(li0.priceBasisLabel || '').trim().slice(0, 80) || fb.priceBasisLabel;
    })(),
    snapshotUnitPriceBasisShortLabel: (() => {
      if (!li0) return '';
      const fb = priceBasisLabelsForValue(li0.priceBasis === 'channel' ? 'channel' : 'consumer');
      return (
        String(li0.priceBasisShortLabel != null ? li0.priceBasisShortLabel : '').trim().slice(0, 80) ||
        fb.priceBasisShortLabel
      );
    })()
  };

  const body = {
    title: String(title || '').trim(),
    customerCompanyId: ccIdPayload,
    customerCompanyEmployeeId: empIdPayload,
    contactName: String(contactName || '').trim(),
    snapshotCompanyName: ccIdPayload ? String(snapshotCompanyName || '').trim() : '',
    snapshotCompanyBusinessNumber: ccIdPayload ? String(snapshotCompanyBusinessNumber || '').trim() : '',
    snapshotCompanyAddress: ccIdPayload ? String(snapshotCompanyAddress || '').trim() : '',
    snapshotContactPhone: empIdPayload ? String(contactPhone || '').trim() : '',
    snapshotContactEmail: empIdPayload ? String(contactEmail || '').trim() : '',
    snapshotContactName: empIdPayload ? String(contactName || '').trim() : '',
    ...snap,
    lineItems: lineItemsPayload,
    currency: currency || 'KRW',
    stage: selectedStage,
    description: String(description || '').trim(),
    documentRefs: Array.isArray(documentRefsIn) ? documentRefsIn.filter((d) => d?.url) : [],
    driveFolderLink:
      driveFolderLinkIn != null && String(driveFolderLinkIn).trim() ? String(driveFolderLinkIn).trim() : undefined,
    saleDate: saleDatePayload,
    assignedTo: String(assignedToUserId || '').trim() || null,
    expectedCloseMonth: expectedCloseMonthPayload,
    startDate: toIsoDateForOpportunityPayload(startDateYmd),
    targetDate: toIsoDateForOpportunityPayload(targetDateYmd),
    contractAmount: parseNumber(contractAmountStr) || 0,
    contractAmountDate: selectedStage === 'Won' ? toIsoDateForOpportunityPayload(saleDateYmd) : null,
    fullCollectionCompleteDate: toIsoDateForOpportunityPayload(fullCollectionCompleteDateYmd),
    licenseCertificateDeliveredDate: toIsoDateForOpportunityPayload(licenseCertificateDeliveredDateYmd),
    invoiceAmount: parseNumber(invoiceAmountStr) || 0,
    invoiceAmountDate: toIsoDateForOpportunityPayload(invoiceAmountDateYmd),
    collectionEntries: collectionEntriesPayload
  };

  const scheduleDateDefs = (Array.isArray(scheduleFieldDefs) ? scheduleFieldDefs : []).filter((d) => d.type === 'date');
  if (scheduleDateDefs.length > 0) {
    if (selectedStage === 'Won') {
      body.scheduleCustomDates = Object.fromEntries(
        scheduleDateDefs.map((d) => [d.key, toIsoDateForOpportunityPayload(scheduleCustomDates?.[d.key]) || null])
      );
    } else {
      const scPayload = {};
      for (const d of scheduleDateDefs) {
        if (!d.options?.editableBeforeWon) continue;
        scPayload[d.key] = toIsoDateForOpportunityPayload(scheduleCustomDates?.[d.key]) || null;
      }
      if (Object.keys(scPayload).length > 0) {
        body.scheduleCustomDates = scPayload;
      }
    }
  }

  return body;
}
