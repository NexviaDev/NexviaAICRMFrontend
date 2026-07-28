/**
 * ERP 기준정보 화면 정의. 목록 열·상세 폼 필드를 한 곳에서 관리해
 * 목록(erp-master-data.js)과 상세 모달(erp-master-detail-modal.js)이 같은 스키마를 보게 합니다.
 * 백엔드 controllers/erp/* 의 허용값과 일치해야 합니다.
 */

export const STATUS_OPTIONS = [
  { value: 'active', label: '사용' },
  { value: 'inactive', label: '미사용' }
];

const STATUS_FIELD = {
  key: 'status',
  label: '상태',
  type: 'select',
  options: STATUS_OPTIONS,
  defaultValue: 'active'
};

const MEMO_FIELD = { key: 'memo', label: '메모', type: 'textarea', full: true };

export const PARTNER_TYPE_LABELS = { customer: '고객', supplier: '공급사', both: '고객·공급사' };
export const ITEM_TYPE_LABELS = { product: '제품', service: '서비스' };
export const WAREHOUSE_TYPE_LABELS = { normal: '실물창고', virtual: '가상창고' };
export const TAX_TYPE_LABELS = {
  taxable: '과세',
  zeroRated: '영세율',
  exempt: '면세',
  none: '대상아님'
};
export const APPLIES_TO_LABELS = { sales: '매출', purchase: '매입', both: '매출·매입' };
export const PAYMENT_METHOD_LABELS = {
  net: '기준일 + 유예일',
  endOfMonth: '당월 말일 기준',
  advance: '선결제',
  cod: '인도 시 결제'
};

function optionsFrom(labels) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

/** 목록 셀 표시용 — 코드값을 한국어 라벨로 */
export function labelOf(labels, value) {
  if (value == null || value === '') return '-';
  return labels[value] || value;
}

export const ERP_ENTITIES = [
  {
    key: 'partners',
    path: 'business-partners',
    label: '거래처',
    icon: 'handshake',
    description: '고객·공급사를 하나의 마스터로 관리합니다. 판매·구매 문서가 이 거래처를 참조합니다.',
    crmSync: {
      label: 'CRM 고객사 가져오기',
      sourceLabel: 'CRM 고객사',
      targetLabel: '거래처'
    },
    columns: [
      { key: 'code', label: '코드', width: '9rem' },
      { key: 'name', label: '거래처명', grow: true },
      { key: 'partnerType', label: '구분', width: '7rem', labels: PARTNER_TYPE_LABELS },
      { key: 'businessNumber', label: '사업자번호', width: '9.5rem', format: 'businessNumber' },
      { key: 'phone', label: '전화', width: '9rem' },
      { key: 'status', label: '상태', width: '6rem', badge: true }
    ],
    filters: [
      { key: 'partnerType', label: '구분', options: optionsFrom(PARTNER_TYPE_LABELS) },
      { key: 'status', label: '상태', options: STATUS_OPTIONS }
    ],
    fields: [
      { key: 'name', label: '거래처명', type: 'text', required: true },
      {
        key: 'partnerType',
        label: '거래처 구분',
        type: 'select',
        options: optionsFrom(PARTNER_TYPE_LABELS),
        defaultValue: 'customer'
      },
      {
        key: 'businessNumber',
        label: '사업자등록번호',
        type: 'text',
        placeholder: '220-81-62517',
        help: '10자리 번호를 입력하면 형식과 검증번호를 확인합니다. 개인 거래처는 비워 두세요.'
      },
      { key: 'subBusinessNumber', label: '종사업장 번호', type: 'text', placeholder: '0001' },
      { key: 'representativeName', label: '대표자명', type: 'text' },
      { key: 'businessType', label: '업태', type: 'text' },
      { key: 'businessItem', label: '종목', type: 'text' },
      { key: 'email', label: '이메일', type: 'text', placeholder: 'buyer@example.com' },
      { key: 'phone', label: '전화번호', type: 'text' },
      { key: 'fax', label: '팩스', type: 'text' },
      { key: 'address', label: '주소', type: 'text', full: true },
      { key: 'addressDetail', label: '상세주소', type: 'text', full: true },
      { key: 'currency', label: '기본 통화', type: 'text', defaultValue: 'KRW', placeholder: 'KRW' },
      { key: 'creditLimit', label: '신용한도', type: 'money' },
      { key: 'paymentTermId', label: '기본 결제조건', type: 'ref', refPath: 'payment-terms' },
      { key: 'taxCodeId', label: '기본 세금구분', type: 'ref', refPath: 'tax-codes' },
      STATUS_FIELD,
      MEMO_FIELD
    ]
  },
  {
    key: 'items',
    path: 'items',
    label: '품목',
    icon: 'inventory_2',
    description: '판매·구매·재고가 공통으로 쓰는 품목 마스터입니다. 서비스 품목은 재고를 관리하지 않습니다.',
    crmSync: {
      label: 'CRM 제품 가져오기',
      sourceLabel: 'CRM 제품',
      targetLabel: '품목'
    },
    columns: [
      { key: 'code', label: '코드', width: '9rem' },
      { key: 'name', label: '품목명', grow: true },
      { key: 'itemType', label: '구분', width: '6rem', labels: ITEM_TYPE_LABELS },
      { key: 'baseUnit', label: '단위', width: '5rem' },
      { key: 'standardPrice', label: '표준 판매가', width: '10rem', format: 'money', align: 'right' },
      { key: 'status', label: '상태', width: '6rem', badge: true }
    ],
    filters: [
      { key: 'itemType', label: '구분', options: optionsFrom(ITEM_TYPE_LABELS) },
      { key: 'status', label: '상태', options: STATUS_OPTIONS }
    ],
    fields: [
      { key: 'name', label: '품목명', type: 'text', required: true },
      {
        key: 'itemType',
        label: '품목 구분',
        type: 'select',
        options: optionsFrom(ITEM_TYPE_LABELS),
        defaultValue: 'product'
      },
      {
        key: 'stockManaged',
        label: '재고 관리 품목',
        type: 'checkbox',
        defaultValue: true,
        help: '서비스 품목으로 저장하면 자동으로 해제됩니다.'
      },
      { key: 'category', label: '분류', type: 'text' },
      { key: 'spec', label: '규격', type: 'text' },
      { key: 'barcode', label: '바코드', type: 'text' },
      { key: 'baseUnit', label: '기본 단위', type: 'text', defaultValue: 'EA', placeholder: 'EA' },
      { key: 'standardPrice', label: '표준 판매가', type: 'money' },
      { key: 'standardCost', label: '표준 원가', type: 'money' },
      { key: 'currency', label: '통화', type: 'text', defaultValue: 'KRW', placeholder: 'KRW' },
      { key: 'taxCodeId', label: '세금구분', type: 'ref', refPath: 'tax-codes' },
      { key: 'safetyStock', label: '안전재고', type: 'number' },
      { key: 'reorderPoint', label: '재주문점', type: 'number' },
      STATUS_FIELD,
      MEMO_FIELD
    ]
  },
  {
    key: 'warehouses',
    path: 'warehouses',
    label: '창고',
    icon: 'warehouse',
    description: '입고·출고·재고이동의 기준 장소입니다. 기본 창고는 회사당 하나만 지정할 수 있습니다.',
    columns: [
      { key: 'code', label: '코드', width: '7rem' },
      { key: 'name', label: '창고명', grow: true },
      { key: 'warehouseType', label: '구분', width: '7rem', labels: WAREHOUSE_TYPE_LABELS },
      { key: 'address', label: '주소', grow: true },
      { key: 'isDefault', label: '기본', width: '5rem', format: 'bool' },
      { key: 'status', label: '상태', width: '6rem', badge: true }
    ],
    filters: [
      { key: 'warehouseType', label: '구분', options: optionsFrom(WAREHOUSE_TYPE_LABELS) },
      { key: 'status', label: '상태', options: STATUS_OPTIONS }
    ],
    fields: [
      { key: 'name', label: '창고명', type: 'text', required: true },
      {
        key: 'warehouseType',
        label: '창고 구분',
        type: 'select',
        options: optionsFrom(WAREHOUSE_TYPE_LABELS),
        defaultValue: 'normal'
      },
      { key: 'address', label: '주소', type: 'text', full: true },
      { key: 'addressDetail', label: '상세주소', type: 'text', full: true },
      { key: 'phone', label: '전화번호', type: 'text' },
      {
        key: 'isDefault',
        label: '기본 창고',
        type: 'checkbox',
        help: '지정하면 기존 기본 창고는 자동으로 해제됩니다.'
      },
      {
        key: 'allowNegativeStock',
        label: '음수 재고 허용',
        type: 'checkbox',
        help: '재고 모듈에서 잔량보다 많은 출고를 허용할지 결정합니다.'
      },
      STATUS_FIELD,
      MEMO_FIELD
    ]
  },
  {
    key: 'tax-codes',
    path: 'tax-codes',
    label: '세금구분',
    icon: 'receipt_long',
    description: '문서 라인의 세액 계산 기준입니다. 확정 문서에는 세율이 스냅샷으로 복사됩니다.',
    columns: [
      { key: 'code', label: '코드', width: '7rem' },
      { key: 'name', label: '명칭', grow: true },
      { key: 'taxType', label: '과세 구분', width: '7rem', labels: TAX_TYPE_LABELS },
      { key: 'ratePercent', label: '세율', width: '6rem', format: 'percent', align: 'right' },
      { key: 'appliesTo', label: '적용', width: '7rem', labels: APPLIES_TO_LABELS },
      { key: 'status', label: '상태', width: '6rem', badge: true }
    ],
    filters: [
      { key: 'taxType', label: '과세 구분', options: optionsFrom(TAX_TYPE_LABELS) },
      { key: 'status', label: '상태', options: STATUS_OPTIONS }
    ],
    fields: [
      { key: 'name', label: '명칭', type: 'text', required: true, placeholder: '부가세 10%' },
      {
        key: 'taxType',
        label: '과세 구분',
        type: 'select',
        options: optionsFrom(TAX_TYPE_LABELS),
        defaultValue: 'taxable'
      },
      {
        key: 'ratePercent',
        label: '세율(%)',
        type: 'number',
        defaultValue: 10,
        help: '영세율·면세·대상아님은 0이어야 합니다.'
      },
      { key: 'priceIncludesTax', label: '단가에 세액 포함', type: 'checkbox' },
      {
        key: 'appliesTo',
        label: '적용 대상',
        type: 'select',
        options: optionsFrom(APPLIES_TO_LABELS),
        defaultValue: 'both'
      },
      { key: 'isDefault', label: '기본 세금구분', type: 'checkbox' },
      STATUS_FIELD,
      MEMO_FIELD
    ]
  },
  {
    key: 'payment-terms',
    path: 'payment-terms',
    label: '결제조건',
    icon: 'schedule',
    description: '거래처 기본 결제조건입니다. 판매·구매 문서의 수금·지급 예정일 계산에 사용됩니다.',
    columns: [
      { key: 'code', label: '코드', width: '7rem' },
      { key: 'name', label: '명칭', grow: true },
      { key: 'method', label: '지급 방식', width: '12rem', labels: PAYMENT_METHOD_LABELS },
      { key: 'netDays', label: '유예일', width: '6rem', align: 'right' },
      { key: 'isDefault', label: '기본', width: '5rem', format: 'bool' },
      { key: 'status', label: '상태', width: '6rem', badge: true }
    ],
    filters: [
      { key: 'method', label: '지급 방식', options: optionsFrom(PAYMENT_METHOD_LABELS) },
      { key: 'status', label: '상태', options: STATUS_OPTIONS }
    ],
    fields: [
      { key: 'name', label: '명칭', type: 'text', required: true, placeholder: '월말 30일' },
      {
        key: 'method',
        label: '지급 방식',
        type: 'select',
        options: optionsFrom(PAYMENT_METHOD_LABELS),
        defaultValue: 'net'
      },
      {
        key: 'netDays',
        label: '유예일',
        type: 'number',
        defaultValue: 30,
        help: '선결제·인도 시 결제를 고르면 0으로 저장됩니다.'
      },
      { key: 'isDefault', label: '기본 결제조건', type: 'checkbox' },
      STATUS_FIELD,
      MEMO_FIELD
    ]
  }
];

export const DEFAULT_ENTITY_KEY = ERP_ENTITIES[0].key;

export function findEntity(key) {
  return ERP_ENTITIES.find((e) => e.key === key) || ERP_ENTITIES[0];
}
