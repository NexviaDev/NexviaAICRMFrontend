/**
 * ERP 판매·수금 화면 정의.
 * 목록 열·필터·상세 폼 필드·상태 명령을 한 곳에서 관리해
 * 목록(erp-sales.js)과 문서 모달(erp-sales-document-modal.js)이 같은 스키마를 봅니다.
 * 백엔드 controllers/erp/* 와 lib/erp/documentStatus.js 의 허용값과 반드시 일치해야 합니다.
 */

/* ---------------- 상태·코드 라벨 (색이 아니라 텍스트로 구분) ---------------- */

export const QUOTATION_STATUS_LABELS = {
  draft: '작성중',
  submitted: '승인요청',
  approved: '승인됨',
  rejected: '반려',
  converted: '주문전환',
  expired: '만료',
  cancelled: '취소'
};

export const SALES_ORDER_STATUS_LABELS = {
  draft: '작성중',
  confirmed: '확정',
  closed: '종료',
  cancelled: '취소'
};

export const SHIPMENT_STATUS_LABELS = {
  draft: '작성중',
  confirmed: '출고완료',
  cancelled: '취소'
};

export const SALES_INVOICE_STATUS_LABELS = {
  draft: '작성중',
  issued: '확정',
  cancelled: '취소'
};

export const RECEIPT_STATUS_LABELS = {
  draft: '작성중',
  confirmed: '수금완료',
  cancelled: '취소'
};

export const CREDIT_NOTE_STATUS_LABELS = {
  draft: '작성중',
  issued: '확정',
  cancelled: '취소'
};

export const AR_STATUS_LABELS = {
  unpaid: '미수',
  partiallyPaid: '부분수금',
  paid: '수금완료',
  cancelled: '취소'
};

export const FULFILLMENT_STATUS_LABELS = {
  notShipped: '미출고',
  partiallyShipped: '부분출고',
  shipped: '출고완료'
};

export const INVOICE_PROGRESS_LABELS = {
  notInvoiced: '매출 미발행',
  partiallyInvoiced: '부분발행',
  invoiced: '발행완료'
};

export const RECEIPT_METHOD_LABELS = {
  bankTransfer: '계좌이체',
  cash: '현금',
  card: '카드',
  promissoryNote: '어음',
  offset: '상계',
  other: '기타'
};

export const CREDIT_REASON_LABELS = {
  return: '반품',
  discount: '에누리',
  error: '오류',
  cancel: '취소',
  other: '기타'
};

/** 상태 배지 톤 — 색은 보조 수단이고 라벨 텍스트가 항상 함께 표시됩니다 */
const TONE_BY_STATUS = {
  draft: 'draft',
  submitted: 'progress',
  approved: 'done',
  confirmed: 'done',
  issued: 'done',
  converted: 'done',
  closed: 'neutral',
  rejected: 'danger',
  cancelled: 'danger',
  expired: 'neutral',
  unpaid: 'progress',
  partiallyPaid: 'progress',
  paid: 'done',
  notShipped: 'draft',
  partiallyShipped: 'progress',
  shipped: 'done',
  notInvoiced: 'draft',
  partiallyInvoiced: 'progress',
  invoiced: 'done'
};

export function statusTone(value) {
  return TONE_BY_STATUS[value] || 'neutral';
}

export function optionsFrom(labels) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

/** 코드값 → 한국어 라벨 */
export function labelOf(labels, value) {
  if (value == null || value === '') return '-';
  return labels[value] || value;
}

/** `partnerSnapshot.name` 처럼 중첩 경로를 읽습니다 */
export function readPath(row, key) {
  if (!row || !key) return undefined;
  if (!key.includes('.')) return row[key];
  return key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), row);
}

/* ---------------- 공통 폼 조각 ---------------- */

const PARTNER_FIELD = {
  key: 'partnerId',
  label: '거래처',
  type: 'ref',
  refPath: 'business-partners',
  required: true,
  lockAfterCreate: true,
  help: '거래처는 등록 후 바꿀 수 없습니다. 잘못 골랐다면 문서를 취소하고 새로 만들어 주세요.'
};

const CURRENCY_FIELD = {
  key: 'currency',
  label: '통화',
  type: 'text',
  defaultValue: 'KRW',
  placeholder: 'KRW',
  lockAfterCreate: true
};

const MEMO_FIELD = { key: 'memo', label: '메모', type: 'textarea', full: true };

const DEFAULT_TAX_FIELD = {
  key: 'defaultTaxCodeId',
  label: '기본 세금구분',
  type: 'ref',
  refPath: 'tax-codes',
  transient: true,
  help: '라인에 세금구분을 지정하지 않았을 때 적용됩니다.'
};

/* ---------------- 문서 정의 ---------------- */

export const SALES_DOCUMENTS = [
  {
    key: 'quotations',
    path: 'quotations',
    label: '견적',
    icon: 'request_quote',
    description:
      '고객에게 제시하는 견적입니다. 승인되면 판매주문으로 전환하고, 승인 후 내용을 바꿀 때는 개정본을 새로 만듭니다.',
    statusLabels: QUOTATION_STATUS_LABELS,
    dateField: 'documentDate',
    hasLines: true,
    createEnabled: true,
    deletable: true,
    editableStatuses: ['draft', 'rejected'],
    searchPlaceholder: '견적번호·제목·거래처 검색',
    columns: [
      { key: 'code', label: '견적번호', width: '9.5rem' },
      { key: 'documentDate', label: '견적일자', width: '7.5rem', format: 'date' },
      { key: 'partnerSnapshot.name', label: '거래처' },
      { key: 'title', label: '제목' },
      { key: 'totalAmount', label: '합계', width: '10rem', format: 'money', align: 'right' },
      { key: 'revision', label: '개정', width: '4.5rem', align: 'right' },
      { key: 'status', label: '상태', width: '6.5rem', badge: QUOTATION_STATUS_LABELS }
    ],
    filters: [{ key: 'status', label: '상태', options: optionsFrom(QUOTATION_STATUS_LABELS) }],
    fields: [
      PARTNER_FIELD,
      { key: 'title', label: '제목', type: 'text', placeholder: '2026년 1분기 정기 공급' },
      { key: 'documentDate', label: '견적일자', type: 'date' },
      { key: 'validUntilDate', label: '유효기한', type: 'date' },
      CURRENCY_FIELD,
      DEFAULT_TAX_FIELD,
      MEMO_FIELD
    ],
    commands: [
      { key: 'submit', label: '승인요청', when: ['draft', 'rejected'], confirm: '이 견적을 승인요청 상태로 올릴까요?' },
      { key: 'approve', label: '승인', when: ['submitted'], confirm: '이 견적을 승인할까요?' },
      { key: 'reject', label: '반려', when: ['submitted'], danger: true, reason: true, reasonRequired: true, reasonLabel: '반려 사유' },
      {
        key: 'cancel',
        label: '취소',
        when: ['draft', 'submitted', 'approved', 'rejected', 'expired'],
        danger: true,
        reason: true,
        reasonLabel: '취소 사유'
      },
      {
        key: 'revise',
        label: '개정본 만들기',
        when: ['draft', 'submitted', 'approved', 'rejected', 'expired', 'cancelled'],
        idempotent: true,
        creates: true,
        confirm: '현재 내용을 복사해 새 개정본(작성중)을 만들까요?',
        enabled: (record) => Boolean(record && record.isLatestRevision)
      }
    ]
  },
  {
    key: 'sales-orders',
    path: 'sales-orders',
    label: '판매주문',
    icon: 'shopping_cart',
    description:
      '확정되면 라인 수량이 고정되고, 출고·매출이 라인별 잔량을 소진합니다. 보통 승인된 견적에서 전환해 만듭니다.',
    statusLabels: SALES_ORDER_STATUS_LABELS,
    dateField: 'documentDate',
    hasLines: true,
    createEnabled: true,
    deletable: true,
    editableStatuses: ['draft'],
    traceable: true,
    searchPlaceholder: '주문번호·제목·거래처 검색',
    columns: [
      { key: 'code', label: '주문번호', width: '9.5rem' },
      { key: 'documentDate', label: '주문일자', width: '7.5rem', format: 'date' },
      { key: 'partnerSnapshot.name', label: '거래처' },
      { key: 'totalAmount', label: '합계', width: '10rem', format: 'money', align: 'right' },
      { key: 'fulfillmentStatus', label: '출고', width: '6.5rem', badge: FULFILLMENT_STATUS_LABELS },
      { key: 'invoiceStatus', label: '매출', width: '7rem', badge: INVOICE_PROGRESS_LABELS },
      { key: 'status', label: '상태', width: '6rem', badge: SALES_ORDER_STATUS_LABELS }
    ],
    filters: [
      { key: 'status', label: '상태', options: optionsFrom(SALES_ORDER_STATUS_LABELS) },
      { key: 'fulfillmentStatus', label: '출고', options: optionsFrom(FULFILLMENT_STATUS_LABELS) },
      { key: 'invoiceStatus', label: '매출', options: optionsFrom(INVOICE_PROGRESS_LABELS) }
    ],
    fields: [
      PARTNER_FIELD,
      { key: 'title', label: '제목', type: 'text' },
      { key: 'documentDate', label: '주문일자', type: 'date' },
      { key: 'requestedDeliveryDate', label: '납기 희망일', type: 'date' },
      { key: 'paymentTermId', label: '결제조건', type: 'ref', refPath: 'payment-terms', help: '매출의 수금 예정일 계산에 사용됩니다.' },
      CURRENCY_FIELD,
      { key: 'shippingAddress', label: '배송지', type: 'text', full: true },
      DEFAULT_TAX_FIELD,
      MEMO_FIELD
    ],
    commands: [
      { key: 'confirm', label: '확정', when: ['draft'], confirm: '이 주문을 확정할까요? 확정 후에는 라인을 수정할 수 없습니다.' },
      { key: 'close', label: '종료', when: ['confirmed'], confirm: '이 주문을 종료할까요? 이후 출고·매출을 만들 수 없습니다.' },
      {
        key: 'cancel',
        label: '취소',
        when: ['draft', 'confirmed'],
        danger: true,
        reason: true,
        reasonLabel: '취소 사유'
      }
    ]
  },
  {
    key: 'shipments',
    path: 'shipments',
    label: '출고',
    icon: 'local_shipping',
    description: '판매주문에서만 생성됩니다. 확정하면 주문 라인의 출고 잔량이 소진됩니다.',
    statusLabels: SHIPMENT_STATUS_LABELS,
    dateField: 'documentDate',
    hasLines: false,
    createEnabled: false,
    deletable: true,
    editableStatuses: ['draft'],
    createHint: '출고는 확정된 판매주문 상세에서 "출고 만들기"로 생성합니다.',
    searchPlaceholder: '출고번호·주문번호·송장번호 검색',
    columns: [
      { key: 'code', label: '출고번호', width: '9.5rem' },
      { key: 'documentDate', label: '출고일자', width: '7.5rem', format: 'date' },
      { key: 'salesOrderCode', label: '주문번호', width: '9.5rem' },
      { key: 'partnerSnapshot.name', label: '거래처' },
      { key: 'carrier', label: '운송사', width: '8rem' },
      { key: 'trackingNumber', label: '송장번호', width: '10rem' },
      { key: 'status', label: '상태', width: '6.5rem', badge: SHIPMENT_STATUS_LABELS }
    ],
    filters: [{ key: 'status', label: '상태', options: optionsFrom(SHIPMENT_STATUS_LABELS) }],
    fields: [
      { key: 'documentDate', label: '출고일자', type: 'date' },
      { key: 'warehouseId', label: '출고 창고', type: 'ref', refPath: 'warehouses' },
      { key: 'carrier', label: '운송사', type: 'text' },
      { key: 'trackingNumber', label: '송장번호', type: 'text' },
      { key: 'shippingAddress', label: '배송지', type: 'text', full: true },
      MEMO_FIELD
    ],
    /** 출고는 수량을 바꾸지 않고 물류 정보만 PATCH 합니다 */
    patchOnlyFields: true,
    commands: [
      { key: 'confirm', label: '출고 확정', when: ['draft'], confirm: '출고를 확정할까요? 주문 잔량이 소진됩니다.' },
      {
        key: 'cancel',
        label: '취소',
        when: ['draft', 'confirmed'],
        danger: true,
        reason: true,
        reasonLabel: '취소 사유'
      }
    ]
  },
  {
    key: 'sales-invoices',
    path: 'sales-invoices',
    label: '매출',
    icon: 'receipt',
    description:
      '매출채권의 기준 문서입니다. 판매주문에서만 생성되며 확정된 매출은 대변전표로만 금액을 줄일 수 있습니다.',
    statusLabels: SALES_INVOICE_STATUS_LABELS,
    dateField: 'documentDate',
    hasLines: true,
    /** 매출 라인은 판매주문에서 만들어진 그대로 두고 일자·메모만 고칩니다 (주문 라인 연결 보존) */
    linesEditable: false,
    createEnabled: false,
    deletable: true,
    editableStatuses: ['draft'],
    createHint: '매출은 확정된 판매주문 상세에서 "매출 만들기"로 생성합니다.',
    searchPlaceholder: '매출번호·주문번호·거래처 검색',
    columns: [
      { key: 'code', label: '매출번호', width: '9.5rem' },
      { key: 'documentDate', label: '매출일자', width: '7.5rem', format: 'date' },
      { key: 'dueDate', label: '수금예정일', width: '7.5rem', format: 'date' },
      { key: 'partnerSnapshot.name', label: '거래처' },
      { key: 'totalAmount', label: '매출액', width: '9.5rem', format: 'money', align: 'right' },
      { key: 'balanceAmount', label: '채권잔액', width: '9.5rem', format: 'money', align: 'right' },
      { key: 'arStatus', label: '채권', width: '6.5rem', badge: AR_STATUS_LABELS },
      { key: 'status', label: '상태', width: '6rem', badge: SALES_INVOICE_STATUS_LABELS }
    ],
    filters: [
      { key: 'status', label: '상태', options: optionsFrom(SALES_INVOICE_STATUS_LABELS) },
      { key: 'arStatus', label: '채권', options: optionsFrom(AR_STATUS_LABELS) }
    ],
    fields: [
      { key: 'documentDate', label: '매출일자', type: 'date' },
      { key: 'dueDate', label: '수금예정일', type: 'date' },
      MEMO_FIELD
    ],
    /**
     * 판매주문에서 만든 매출은 PATCH 하지 않습니다.
     * 서버가 PATCH 때 라인을 다시 계산하면서 라인의 salesOrderLineNo(주문 라인 연결)가 사라져
     * 확정 시 주문 잔량이 소진되지 않고 같은 수량으로 매출을 또 만들 수 있게 됩니다.
     * 일자·수금예정일은 판매주문에서 매출을 만들 때 지정합니다.
     */
    formEditableWhen: (record) => !record || !record.salesOrderId,
    readOnlyNote:
      '판매주문에서 생성된 매출이라 내용을 수정하지 않습니다. 일자·수금예정일은 판매주문에서 매출을 만들 때 지정하고, 금액을 줄여야 하면 대변전표를 발행해 주세요.',
    commands: [
      { key: 'issue', label: '매출 확정', when: ['draft'], confirm: '매출을 확정할까요? 채권이 발생하고 주문 잔량이 소진됩니다.' },
      {
        key: 'cancel',
        label: '취소',
        when: ['draft', 'issued'],
        danger: true,
        reason: true,
        reasonLabel: '취소 사유'
      }
    ]
  },
  {
    key: 'receipts',
    path: 'receipts',
    label: '수금',
    icon: 'payments',
    description:
      '입금액을 미수 매출에 배부합니다. 배부하지 않은 금액은 선수금으로 남고, 확정 시 채권 잔액이 줄어듭니다.',
    statusLabels: RECEIPT_STATUS_LABELS,
    dateField: 'receiptDate',
    hasLines: false,
    hasAllocations: true,
    createEnabled: true,
    deletable: true,
    editableStatuses: ['draft'],
    searchPlaceholder: '수금번호·입금자·적요 검색',
    columns: [
      { key: 'code', label: '수금번호', width: '9.5rem' },
      { key: 'receiptDate', label: '수금일자', width: '7.5rem', format: 'date' },
      { key: 'partnerSnapshot.name', label: '거래처' },
      { key: 'method', label: '수단', width: '7rem', labels: RECEIPT_METHOD_LABELS },
      { key: 'receivedAmount', label: '입금액', width: '9.5rem', format: 'money', align: 'right' },
      { key: 'unallocatedAmount', label: '선수금', width: '9rem', format: 'money', align: 'right' },
      { key: 'status', label: '상태', width: '6.5rem', badge: RECEIPT_STATUS_LABELS }
    ],
    filters: [
      { key: 'status', label: '상태', options: optionsFrom(RECEIPT_STATUS_LABELS) },
      { key: 'method', label: '수단', options: optionsFrom(RECEIPT_METHOD_LABELS) }
    ],
    fields: [
      PARTNER_FIELD,
      CURRENCY_FIELD,
      { key: 'receiptDate', label: '수금일자', type: 'date' },
      { key: 'documentDate', label: '전표일자', type: 'date' },
      {
        key: 'method',
        label: '수금 수단',
        type: 'select',
        options: optionsFrom(RECEIPT_METHOD_LABELS),
        defaultValue: 'bankTransfer'
      },
      { key: 'receivedAmount', label: '입금액', type: 'money', required: true },
      { key: 'bankAccountName', label: '입금 계좌·입금자', type: 'text' },
      { key: 'referenceNumber', label: '참조번호', type: 'text' },
      MEMO_FIELD
    ],
    commands: [
      { key: 'confirm', label: '수금 확정', when: ['draft'], confirm: '수금을 확정할까요? 배부한 매출의 채권 잔액이 줄어듭니다.' },
      {
        key: 'cancel',
        label: '취소',
        when: ['draft', 'confirmed'],
        danger: true,
        reason: true,
        reasonLabel: '취소 사유'
      }
    ]
  },
  {
    key: 'credit-notes',
    path: 'credit-notes',
    label: '대변전표',
    icon: 'assignment_return',
    description:
      '반품·에누리처럼 확정된 매출을 줄여야 할 때 발행합니다. 확정된 매출을 직접 수정하지 않고 이 문서로 상계합니다.',
    statusLabels: CREDIT_NOTE_STATUS_LABELS,
    dateField: 'documentDate',
    hasLines: true,
    createEnabled: true,
    deletable: true,
    editableStatuses: ['draft'],
    searchPlaceholder: '전표번호·매출번호·사유 검색',
    columns: [
      { key: 'code', label: '전표번호', width: '9.5rem' },
      { key: 'documentDate', label: '전표일자', width: '7.5rem', format: 'date' },
      { key: 'salesInvoiceCode', label: '대상 매출', width: '9.5rem' },
      { key: 'partnerSnapshot.name', label: '거래처' },
      { key: 'reasonType', label: '사유', width: '6.5rem', labels: CREDIT_REASON_LABELS },
      { key: 'totalAmount', label: '대변금액', width: '10rem', format: 'money', align: 'right' },
      { key: 'status', label: '상태', width: '6rem', badge: CREDIT_NOTE_STATUS_LABELS }
    ],
    filters: [
      { key: 'status', label: '상태', options: optionsFrom(CREDIT_NOTE_STATUS_LABELS) },
      { key: 'reasonType', label: '사유', options: optionsFrom(CREDIT_REASON_LABELS) }
    ],
    fields: [
      PARTNER_FIELD,
      CURRENCY_FIELD,
      {
        key: 'salesInvoiceId',
        label: '대상 매출',
        type: 'invoiceRef',
        required: true,
        lockAfterCreate: true,
        help: '확정(issued)된 매출만 선택할 수 있습니다. 거래처를 먼저 고르면 목록이 채워집니다.'
      },
      { key: 'documentDate', label: '전표일자', type: 'date' },
      {
        key: 'reasonType',
        label: '사유 구분',
        type: 'select',
        options: optionsFrom(CREDIT_REASON_LABELS),
        defaultValue: 'return'
      },
      { key: 'reason', label: '사유', type: 'text', full: true },
      DEFAULT_TAX_FIELD,
      MEMO_FIELD
    ],
    commands: [
      { key: 'issue', label: '대변 확정', when: ['draft'], confirm: '대변전표를 확정할까요? 대상 매출의 채권 잔액이 줄어듭니다.' },
      {
        key: 'cancel',
        label: '취소',
        when: ['draft', 'issued'],
        danger: true,
        reason: true,
        reasonLabel: '취소 사유'
      }
    ]
  }
];

/** 채권 연령 화면 — 문서 목록이 아니라 분석 탭 */
export const AR_AGING_TAB = {
  key: 'ar-aging',
  label: '채권 연령',
  icon: 'insights',
  analytics: true,
  description: '기준일 현재 미수 매출을 연체 구간별로 집계합니다. 통화가 섞이면 합산이 무의미하므로 통화별로 나눠 보여줍니다.'
};

export const SALES_TABS = [...SALES_DOCUMENTS, AR_AGING_TAB];

export const DEFAULT_TAB_KEY = SALES_DOCUMENTS[0].key;

export function findSalesTab(key) {
  return SALES_TABS.find((tab) => tab.key === key) || SALES_DOCUMENTS[0];
}

export function findSalesDocument(key) {
  return SALES_DOCUMENTS.find((doc) => doc.key === key) || null;
}

/** 문서 상태에서 지금 실행할 수 있는 명령만 남깁니다 */
export function availableCommands(documentConfig, record) {
  if (!documentConfig || !record) return [];
  return (documentConfig.commands || []).filter((command) => {
    if (!command.when.includes(record.status)) return false;
    if (typeof command.enabled === 'function' && !command.enabled(record)) return false;
    return true;
  });
}
