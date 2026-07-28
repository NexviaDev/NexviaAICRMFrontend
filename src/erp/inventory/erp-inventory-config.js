/** ERP 재고 화면 탭·열 정의 */

export const MOVEMENT_TYPE_LABELS = {
  receipt: '입고',
  issue: '출고',
  transfer_in: '이동입고',
  transfer_out: '이동출고',
  adjust: '조정',
  shipment_issue: '판매출고',
  shipment_issue_reverse: '출고취소'
};

export const INVENTORY_TABS = [
  {
    key: 'balances',
    label: '재고 현황',
    icon: 'inventory_2',
    description: '창고·품목별 현재고와 가용 수량입니다. 출고 확정 시 자동으로 차감됩니다.',
    columns: [
      { key: 'warehouseName', label: '창고' },
      { key: 'itemCode', label: '품목코드' },
      { key: 'itemName', label: '품목명' },
      { key: 'onHand', label: '현재고', format: 'qty' },
      { key: 'reserved', label: '예약', format: 'qty' },
      { key: 'available', label: '가용', format: 'qty' },
      { key: 'safetyStock', label: '안전재고', format: 'qty' },
      { key: 'baseUnit', label: '단위' },
      { key: 'updatedAt', label: '갱신', format: 'date' }
    ]
  },
  {
    key: 'movements',
    label: '수불 원장',
    icon: 'swap_vert',
    description: '입고·출고·조정 등 append-only 수불 내역입니다. 확정 후 수정하지 않습니다.',
    columns: [
      { key: 'code', label: '수불번호' },
      { key: 'movedAt', label: '일시', format: 'date' },
      { key: 'movementType', label: '유형', labels: MOVEMENT_TYPE_LABELS },
      { key: 'itemCode', label: '품목코드' },
      { key: 'itemName', label: '품목명' },
      { key: 'quantity', label: '수량', format: 'qty' },
      { key: 'sourceCode', label: '원천문서' },
      { key: 'memo', label: '메모' }
    ]
  }
];

export const DEFAULT_TAB_KEY = 'balances';

export function findInventoryTab(key) {
  return INVENTORY_TABS.find((t) => t.key === key) || INVENTORY_TABS[0];
}

export function labelOf(labels, value) {
  if (!labels) return value == null ? '-' : String(value);
  return labels[value] || String(value || '-');
}

export function formatQtyDisplay(value) {
  if (value == null || value === '') return '-';
  const s = String(value);
  const neg = s.startsWith('-');
  const raw = neg ? s.slice(1) : s;
  const [intPart, frac] = raw.split('.');
  const withComma = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${withComma}${frac != null ? `.${frac}` : ''}`;
}

export function formatDateDisplay(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}
