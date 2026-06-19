import { useCallback, useMemo } from 'react';
import {
  useCrmListColumnResize,
  CrmListColgroup,
  CrmListColumnResizeHandle
} from '@/components/crm-list-column-resize/crm-list-column-resize';
import {
  CrmListSheetFillHeaderCell,
  CrmListSheetFillBodyCell,
  crmListSheetColSpanWithFill
} from '@/components/crm-list-sheet-fill/crm-list-sheet-fill';
import {
  DASHBOARD_DISPLAY_CURRENCY,
  toKrwAmount,
  sumForecastTotalsKrw
} from '@/lib/dashboard-krw-aggregate';
import { getCurrencySymbol } from '@/lib/exchange-rate-currency-options';
import '@/shared/crm-list-sheet-table.css';

/** listTemplates.homeDashboard.forecastColumnWidths 키 */
export const HOME_FORECAST_TABLE_COLUMNS = [
  { key: 'company', label: '업체명' },
  { key: 'software', label: '제안 소프트웨어' },
  { key: 'unitPrice', label: '금액' },
  { key: 'quantity', label: '수량' },
  { key: 'finalPrice', label: '최종 가격' },
  { key: 'forecast', label: 'Forcast' },
  { key: 'targetMonth', label: '목표 월' },
  { key: 'contract', label: '계약금액' },
  { key: 'invoice', label: '계산서 금액' },
  { key: 'collected', label: '수금 완료 금액' },
  { key: 'margin', label: '마진 금액' }
];

const PROBABILITY_COLUMN = { key: 'probability', label: '확률' };

function formatForecastKrw(amount, currency, dealBasRMap) {
  const code = String(currency || 'KRW').toUpperCase();
  const sym = getCurrencySymbol(code);
  const krw = toKrwAmount(amount, currency, dealBasRMap);
  if (!krw && krw !== 0) return `${sym}0`;
  return `${sym}${Number(krw).toLocaleString()}`;
}

function ForecastKrwCell({ amount, currency, dealBasRMap }) {
  return (
    <span className="crm-price-main">
      {formatForecastKrw(amount, currency, dealBasRMap)}
    </span>
  );
}

export function buildHomeForecastDisplayColumns(showProbability = false) {
  if (!showProbability) return [...HOME_FORECAST_TABLE_COLUMNS];
  const cols = [...HOME_FORECAST_TABLE_COLUMNS];
  const forecastIdx = cols.findIndex((c) => c.key === 'forecast');
  cols.splice(forecastIdx >= 0 ? forecastIdx : cols.length, 0, PROBABILITY_COLUMN);
  return cols;
}

export function getHomeForecastColumnWidthsFromUser(userOrTemplate) {
  const raw =
    userOrTemplate?.forecastColumnWidths ??
    userOrTemplate?.listTemplates?.homeDashboard?.forecastColumnWidths;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return { ...raw };
}

/**
 * @param {object} props
 * @param {object[]} props.rows
 * @param {object[]} [props.totalRows] 합계 행 계산용(미리보기는 전체 필터 결과)
 * @param {string} props.productFilter
 * @param {Record<string, number>} props.dealBasRMap
 * @param {Record<string, number>} props.columnWidths
 * @param {(widths: Record<string, number>) => void|Promise<void>} props.onPersistColumnWidths
 * @param {(row: object, product: string) => object} props.getRowDisplay
 * @param {(ym: string) => string} props.formatTargetMonth
 * @param {(value: string) => React.ReactNode} props.renderSoftwareLabel
 * @param {(id: string) => void} props.onRowClick
 * @param {boolean} [props.showProbabilityColumn]
 * @param {boolean} [props.showMoreDots]
 * @param {string} [props.dataRowClassName='home-forecast-data-row']
 */
export function HomeForecastTable({
  rows,
  totalRows,
  productFilter,
  dealBasRMap,
  columnWidths = {},
  onPersistColumnWidths,
  getRowDisplay,
  formatTargetMonth,
  renderSoftwareLabel,
  onRowClick,
  showProbabilityColumn = false,
  showMoreDots = false,
  dataRowClassName = 'home-forecast-data-row'
}) {
  const displayColumns = useMemo(
    () => buildHomeForecastDisplayColumns(showProbabilityColumn),
    [showProbabilityColumn]
  );
  const displayColumnKeys = useMemo(() => displayColumns.map((c) => c.key), [displayColumns]);
  const tableColSpan = crmListSheetColSpanWithFill(displayColumns.length);

  const persistColumnWidths = useCallback(
    (widths) => {
      void onPersistColumnWidths?.(widths);
    },
    [onPersistColumnWidths]
  );

  const { getWidthPx, tableWidthPx, startResize } = useCrmListColumnResize({
    columnWidths,
    displayColumnKeys,
    onPersistWidths: persistColumnWidths
  });

  const rowsForTotals = totalRows ?? rows;
  const totals = useMemo(
    () => sumForecastTotalsKrw(rowsForTotals, productFilter, dealBasRMap, getRowDisplay),
    [rowsForTotals, productFilter, dealBasRMap, getRowDisplay]
  );

  const renderDataCell = (colKey, row, d) => {
    switch (colKey) {
      case 'company':
        return row.companyLabel;
      case 'software':
        return renderSoftwareLabel(d.softwareLabel);
      case 'unitPrice':
        return <ForecastKrwCell amount={d.unitPrice} currency={row.currency} dealBasRMap={dealBasRMap} />;
      case 'quantity':
        return d.quantity;
      case 'finalPrice':
        return <ForecastKrwCell amount={d.finalPrice} currency={row.currency} dealBasRMap={dealBasRMap} />;
      case 'probability':
        return Number.isFinite(row.probabilityPct) ? `${row.probabilityPct}%` : '—';
      case 'forecast':
        return <ForecastKrwCell amount={d.forecastAmount} currency={row.currency} dealBasRMap={dealBasRMap} />;
      case 'targetMonth':
        return formatTargetMonth(row.targetMonth);
      case 'contract':
        return <ForecastKrwCell amount={d.contractAmount} currency={row.currency} dealBasRMap={dealBasRMap} />;
      case 'invoice':
        return <ForecastKrwCell amount={d.invoiceAmount} currency={row.currency} dealBasRMap={dealBasRMap} />;
      case 'collected':
        return <ForecastKrwCell amount={d.collectedAmount} currency={row.currency} dealBasRMap={dealBasRMap} />;
      case 'margin':
        return <ForecastKrwCell amount={d.marginAmount} currency={row.currency} dealBasRMap={dealBasRMap} />;
      default:
        return '—';
    }
  };

  const renderTotalCell = (colKey) => {
    switch (colKey) {
      case 'company':
        return '합계';
      case 'software':
        return null;
      case 'unitPrice':
        return <ForecastKrwCell amount={totals.unitPrice} currency={DASHBOARD_DISPLAY_CURRENCY} dealBasRMap={dealBasRMap} />;
      case 'quantity':
        return Number(totals.quantity || 0).toLocaleString('ko-KR');
      case 'finalPrice':
        return <ForecastKrwCell amount={totals.finalPrice} currency={DASHBOARD_DISPLAY_CURRENCY} dealBasRMap={dealBasRMap} />;
      case 'probability':
        return '—';
      case 'forecast':
        return <ForecastKrwCell amount={totals.forecast} currency={DASHBOARD_DISPLAY_CURRENCY} dealBasRMap={dealBasRMap} />;
      case 'targetMonth':
        return '—';
      case 'contract':
        return <ForecastKrwCell amount={totals.contract} currency={DASHBOARD_DISPLAY_CURRENCY} dealBasRMap={dealBasRMap} />;
      case 'invoice':
        return <ForecastKrwCell amount={totals.invoice} currency={DASHBOARD_DISPLAY_CURRENCY} dealBasRMap={dealBasRMap} />;
      case 'collected':
        return <ForecastKrwCell amount={totals.collected} currency={DASHBOARD_DISPLAY_CURRENCY} dealBasRMap={dealBasRMap} />;
      case 'margin':
        return <ForecastKrwCell amount={totals.margin} currency={DASHBOARD_DISPLAY_CURRENCY} dealBasRMap={dealBasRMap} />;
      default:
        return '—';
    }
  };

  return (
    <table
      className="home-leader-breakdown-table home-forecast-table data-table crm-list-sheet crm-list-sheet--resizable"
      style={{ '--crm-list-table-width': `${tableWidthPx}px` }}
    >
      <CrmListColgroup displayColumns={displayColumns} getWidthPx={getWidthPx} />
      <thead>
        <tr>
          {displayColumns.map((col) => (
            <th key={col.key} scope="col" className="home-forecast-th-resizable">
              <span className="list-template-th-content">{col.label}</span>
              <CrmListColumnResizeHandle columnKey={col.key} onResizeStart={startResize} />
            </th>
          ))}
          <CrmListSheetFillHeaderCell />
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const d = getRowDisplay(row, productFilter);
          return (
            <tr
              key={row.id}
              className={`${dataRowClassName} ${idx % 2 === 0 ? 'crm-list-sheet-row--stripe-a' : 'crm-list-sheet-row--stripe-b'}`}
              tabIndex={0}
              role="button"
              aria-label={`기회 ${row.companyLabel} 상세`}
              onClick={() => onRowClick(row.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onRowClick(row.id);
                }
              }}
            >
              {displayColumns.map((col) => (
                <td key={col.key}>{renderDataCell(col.key, row, d)}</td>
              ))}
              <CrmListSheetFillBodyCell />
            </tr>
          );
        })}
        {showMoreDots ? (
          <tr className="home-forecast-more-row">
            <td colSpan={tableColSpan}>
              <span className="home-forecast-more-dots" aria-hidden>
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            </td>
          </tr>
        ) : null}
        <tr className="home-forecast-total-row">
          <td colSpan={2}>합계</td>
          {displayColumns.slice(2).map((col) => (
            <td key={`total-${col.key}`}>{renderTotalCell(col.key)}</td>
          ))}
          <CrmListSheetFillBodyCell />
        </tr>
      </tbody>
    </table>
  );
}
