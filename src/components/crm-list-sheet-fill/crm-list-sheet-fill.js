import { useEffect, useState } from 'react';

const DEFAULT_HEAD_H = 52;
const DEFAULT_ROW_H = 57;

/**
 * 스크롤 영역 높이에 맞춰 줄무늬·호버가 이어지는 빈 행 개수
 * @param {React.RefObject<HTMLElement|null>} scrollRef
 * @param {number} bodyRowCount 데이터·로딩·빈 목록 행 수
 */
export function useCrmListSheetFillerRowCount(scrollRef, bodyRowCount) {
  const [fillCount, setFillCount] = useState(0);

  useEffect(() => {
    const root = scrollRef?.current;
    if (!root) return;

    const measure = () => {
      const table = root.querySelector('table.crm-list-sheet');
      if (!table) return;
      const thead = table.querySelector('thead');
      const sampleRow = table.querySelector('tbody tr:not(.crm-list-sheet-fill-row)');
      const theadH = thead?.getBoundingClientRect().height ?? DEFAULT_HEAD_H;
      const rowH = sampleRow?.getBoundingClientRect().height ?? DEFAULT_ROW_H;
      const viewH = root.clientHeight;
      const slots = Math.max(0, Math.floor((viewH - theadH) / Math.max(rowH, 1)));
      setFillCount(Math.max(0, slots - bodyRowCount));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    const table = root.querySelector('table.crm-list-sheet');
    if (table) ro.observe(table);

    return () => ro.disconnect();
  }, [scrollRef, bodyRowCount]);

  return fillCount;
}

/** @param {number} colSpan 기존 colspan(체크박스·데이터 열 합) */
export function crmListSheetColSpanWithFill(colSpan) {
  return colSpan + 1;
}

export function CrmListSheetFillHeaderCell() {
  return <th className="crm-list-sheet-fill-th" aria-hidden="true" />;
}

export function CrmListSheetFillBodyCell() {
  return <td className="crm-list-sheet-fill-td" aria-hidden="true" />;
}

/**
 * @param {object} props
 * @param {number} props.count
 * @param {number} props.colSpan
 * @param {number} [props.stripeStartIndex=0]
 */
export function CrmListSheetFillerRows({ count, colSpan, stripeStartIndex = 0 }) {
  if (!count || count < 1) return null;
  return Array.from({ length: count }, (_, i) => {
    const idx = stripeStartIndex + i;
    return (
      <tr
        key={`crm-list-fill-${i}`}
        className={`crm-list-sheet-fill-row ${idx % 2 === 0 ? 'crm-list-sheet-row--stripe-a' : 'crm-list-sheet-row--stripe-b'}`}
        aria-hidden="true"
      >
        <td colSpan={colSpan} className="crm-list-sheet-fill-td-span" />
      </tr>
    );
  });
}
