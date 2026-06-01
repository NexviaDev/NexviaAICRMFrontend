import { useMemo } from 'react';
import './product-sales-preview-table.css';

function formatSaleDate(dateVal) {
  if (!dateVal) return '—';
  const d = new Date(dateVal);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function saleTimeMs(opp) {
  const d = new Date(opp?.saleDate || opp?.createdAt || 0);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function productRefFromLine(li) {
  const pid = li?.productId;
  if (pid && typeof pid === 'object') return pid;
  return null;
}

/** 기회 한 건의 제품 행( lineItems 없으면 레거시 단일 productId 필드 ) */
export function getSaleLineItems(opp) {
  if (!opp) return [];
  if (Array.isArray(opp.lineItems) && opp.lineItems.length > 0) {
    return opp.lineItems.map((li, idx) => {
      const prod = productRefFromLine(li);
      const version =
        String(li.productVersion || prod?.version || '').trim() || '—';
      return {
        key: li._id || `${opp._id}-line-${idx}`,
        productName: String(li.productName || prod?.name || '').trim() || '—',
        version,
        quantity: Math.max(0, Number(li.quantity) || 0)
      };
    });
  }
  const legacyName = String(opp.productName || '').trim();
  const prod = opp.productId && typeof opp.productId === 'object' ? opp.productId : null;
  if (legacyName || opp.productId) {
    return [{
      key: `${opp._id}-legacy`,
      productName: legacyName || prod?.name || '—',
      version: String(prod?.version || '').trim() || '—',
      quantity: Math.max(0, Number(opp.quantity) || 1)
    }];
  }
  return [];
}

/** 수주 건별 요약(호환) */
export function summarizeSale(opp) {
  const lines = getSaleLineItems(opp);
  const totalQty = lines.reduce((sum, li) => sum + li.quantity, 0);
  const names = [...new Set(lines.map((li) => li.productName).filter((n) => n && n !== '—'))];
  let productLabel = '—';
  if (names.length === 1) productLabel = names[0];
  else if (names.length > 1) productLabel = `${names[0]} 외 ${names.length - 1}종`;
  return { lines, totalQty, productLabel };
}

/** Won 판매를 시간순(오래된 것 위 → 신규 구매는 아래)으로 펼친 제품 행 */
export function buildProductSalesPreviewRows(items) {
  const won = (items || []).filter((row) => row.stage === 'Won');
  won.sort((a, b) => saleTimeMs(a) - saleTimeMs(b));
  const rows = [];
  for (const opp of won) {
    const saleDate = opp.saleDate || opp.createdAt;
    const lines = getSaleLineItems(opp);
    for (const li of lines) {
      rows.push({
        ...li,
        saleDate,
        saleDateLabel: formatSaleDate(saleDate),
        oppId: String(opp._id || ''),
        oppTitle: String(opp.title || '').trim()
      });
    }
  }
  return rows;
}

/**
 * 제품 판매 현황 미리보기 — 수주(Won) 제품 행을 표로 바로 표시, 신규 구매는 아래에 누적
 */
export default function ProductSalesPreviewTable({ items, maxRows = 0, className = '' }) {
  const previewRows = useMemo(() => {
    const rows = buildProductSalesPreviewRows(items);
    if (maxRows > 0) return rows.slice(-maxRows);
    return rows;
  }, [items, maxRows]);

  if (previewRows.length === 0) return null;

  return (
    <div className={`product-sales-preview-table-wrap customer-company-detail-product-sales-preview${className ? ` ${className}` : ''}`}>
      <div className="product-sales-preview-table-scroll">
        <table className="product-sales-preview-table">
          <thead>
            <tr>
              <th scope="col" className="product-sales-preview-th">제품</th>
              <th scope="col" className="product-sales-preview-th">버전</th>
              <th scope="col" className="product-sales-preview-th product-sales-preview-th--qty">수량</th>
              <th scope="col" className="product-sales-preview-th product-sales-preview-th--date">판매일</th>
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, idx) => {
              const prev = previewRows[idx - 1];
              const isNewPurchaseBlock = !prev || prev.oppId !== row.oppId;
              return (
                <tr
                  key={row.key}
                  className={`product-sales-preview-data-row${isNewPurchaseBlock && idx > 0 ? ' product-sales-preview-data-row--new-block' : ''}`}
                >
                  <td className="product-sales-preview-td product-sales-preview-td--product">
                    <span className="product-sales-preview-product-label">{row.productName}</span>
                    {row.oppTitle ? (
                      <span className="product-sales-preview-sale-title">{row.oppTitle}</span>
                    ) : null}
                  </td>
                  <td className="product-sales-preview-td product-sales-preview-td--meta">{row.version}</td>
                  <td className="product-sales-preview-td product-sales-preview-td--qty">
                    <span className="product-sales-preview-qty-badge">{row.quantity}</span>
                  </td>
                  <td className="product-sales-preview-td product-sales-preview-td--date">{row.saleDateLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
