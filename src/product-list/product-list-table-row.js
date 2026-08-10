import { memo } from 'react';
import { CrmListSheetFillBodyCell } from '@/components/crm-list-sheet-fill/crm-list-sheet-fill';
import { listPriceFromProduct } from '@/lib/product-price-utils';
import {
  getConsumerMargin,
  getChannelMargin,
  shouldDashChannelMargin
} from '@/lib/product-margin';
import { formatProductBillingDisplay } from '@/lib/product-billing-utils';

/**
 * 제품 표 본문 행 — selected 등 props가 같으면 재렌더 생략.
 * 검색 모달에서 체크 토글 시 전체 행×열 재계산으로 수 초 지연되던 문제를 막는다.
 */
function ProductListTableRow({
  row,
  rowIdx,
  selected,
  isSearchModal,
  stripeClass,
  displayColumns,
  columnCellStyles,
  billingTypeVisible,
  productCustomFieldDefMaps,
  normalizedProductCustomFieldDefinitions,
  productFormulaExchangeCtx,
  CUSTOM_FIELDS_PREFIX,
  STATUS_LABELS,
  normalizeProductListCustomFieldKey,
  findListColumnDisplayFormatDef,
  isProductPricingHighlightColumn,
  wrapProductListCellContent,
  renderPriceCell,
  renderProductCustomFieldCell,
  onSelectClick,
  onSelectChange,
  onOpenDetail
}) {
  return (
    <tr
      className={`${isSearchModal ? 'product-list-row--search-modal-pick' : 'product-list-row-clickable'} ${row.status === 'EndOfLife' ? 'product-list-row-eol' : ''} ${stripeClass}${selected ? ' is-selected' : ''}`}
      onClick={(e) => {
        if (isSearchModal) onSelectClick(e, rowIdx, row._id);
        else onOpenDetail(row);
      }}
    >
      <td className="pl-td-checkbox" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="pl-row-checkbox"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onSelectChange(e, rowIdx, row._id)}
          aria-label={`${row.name || '제품'} 선택`}
        />
      </td>
      {displayColumns.map((col) => {
        const customFieldKey = col.key.startsWith(CUSTOM_FIELDS_PREFIX)
          ? normalizeProductListCustomFieldKey(col.key)
          : null;
        const columnDisplayDef = findListColumnDisplayFormatDef(
          col,
          customFieldKey,
          productCustomFieldDefMaps
        );
        return (
          <td
            key={col.key}
            className={isProductPricingHighlightColumn(col) ? 'pl-col-pricing-highlight' : undefined}
          >
            {wrapProductListCellContent(
              (() => {
                if (col.key === 'name') {
                  return (
                    <div className="product-list-cell-name">
                      <span className="product-list-name">{row.name || '—'}</span>
                    </div>
                  );
                }
                if (col.key === 'category') {
                  return row.category ? (
                    <span className="product-list-category-badge">{row.category}</span>
                  ) : (
                    '—'
                  );
                }
                if (col.key === 'version') {
                  return <span className="product-list-version">{row.version || '—'}</span>;
                }
                if (col.key === 'code') {
                  return <span className="text-muted">{row.code || '—'}</span>;
                }
                if (col.key === 'currency') {
                  return (
                    <span className="product-list-currency-label" title={row.currency || undefined}>
                      {row.currency || '—'}
                    </span>
                  );
                }
                if (col.key === 'billingType') {
                  return (
                    <span className="product-list-billing">
                      {formatProductBillingDisplay(row.billingType, row.billingInterval)}
                    </span>
                  );
                }
                if (col.key === 'price') {
                  return (
                    <div className="product-list-pricing">
                      {renderPriceCell(listPriceFromProduct(row), {
                        row,
                        displayDef: columnDisplayDef
                      })}
                      {row.billingType && !billingTypeVisible && (
                        <span className="product-list-billing">
                          {formatProductBillingDisplay(row.billingType, row.billingInterval)}
                        </span>
                      )}
                    </div>
                  );
                }
                if (col.key === 'costPrice') {
                  return renderPriceCell(row.costPrice, { row, displayDef: columnDisplayDef });
                }
                if (col.key === 'channelPrice') {
                  return renderPriceCell(row.channelPrice, { row, displayDef: columnDisplayDef });
                }
                if (col.key === 'consumerMargin') {
                  return renderPriceCell(getConsumerMargin(row), { row, displayDef: columnDisplayDef });
                }
                if (col.key === 'channelMargin') {
                  return renderPriceCell(getChannelMargin(row), {
                    dashed: shouldDashChannelMargin(row),
                    row,
                    displayDef: columnDisplayDef
                  });
                }
                if (col.key === 'status') {
                  return (
                    <span
                      className={`status-badge status-${row.status === 'Active' ? 'active' : row.status === 'EndOfLife' ? 'eol' : 'draft'}`}
                    >
                      {STATUS_LABELS[row.status] || row.status}
                    </span>
                  );
                }
                if (customFieldKey) {
                  return renderProductCustomFieldCell(
                    row,
                    customFieldKey,
                    normalizedProductCustomFieldDefinitions,
                    productFormulaExchangeCtx,
                    columnDisplayDef
                  );
                }
                return '—';
              })(),
              col.key,
              columnCellStyles
            )}
          </td>
        );
      })}
      <CrmListSheetFillBodyCell />
    </tr>
  );
}

function rowPropsAreEqual(prev, next) {
  return (
    prev.row === next.row &&
    prev.rowIdx === next.rowIdx &&
    prev.selected === next.selected &&
    prev.isSearchModal === next.isSearchModal &&
    prev.stripeClass === next.stripeClass &&
    prev.displayColumns === next.displayColumns &&
    prev.columnCellStyles === next.columnCellStyles &&
    prev.billingTypeVisible === next.billingTypeVisible &&
    prev.productCustomFieldDefMaps === next.productCustomFieldDefMaps &&
    prev.normalizedProductCustomFieldDefinitions === next.normalizedProductCustomFieldDefinitions &&
    prev.productFormulaExchangeCtx === next.productFormulaExchangeCtx &&
    prev.onSelectClick === next.onSelectClick &&
    prev.onSelectChange === next.onSelectChange &&
    prev.onOpenDetail === next.onOpenDetail
  );
}

export default memo(ProductListTableRow, rowPropsAreEqual);
