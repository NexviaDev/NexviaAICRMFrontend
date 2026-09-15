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

function companyInitialFromLabel(label) {
  const s = String(label || '').trim().replace(/^\(+|\)+$/g, '');
  if (!s) return '?';
  const cleaned = s.replace(/^(주\)|주식회사|㈜)\s*/u, '').trim() || s;
  return cleaned.charAt(0);
}

function productChipTone(label) {
  const s = String(label || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h + s.charCodeAt(i) * (i + 1)) % 3;
  return h === 0 ? 'sky' : h === 1 ? 'brand' : 'amber';
}

function stageBadgeTone(stage) {
  const s = String(stage || '').trim();
  if (s === 'Won') return 'green';
  if (s === 'Negotiation') return 'amber';
  if (s === 'TechDemo') return 'slate';
  if (s === 'Quotation' || s === 'ProposalSent') return 'blue';
  if (s === 'Contacted') return 'indigo';
  if (s === 'NewLead') return 'purple';
  return 'slate';
}

/**
 * 홈 ref_home — 운영 허브 딜 표 (탭: 진행 중 / 수주 완료)
 * @param {'active'|'completed'} variant
 */
export function HomeForecastPairTable({
  variant = 'active',
  rows,
  productFilter,
  dealBasRMap,
  getRowDisplay,
  formatTargetMonth,
  stageLabels = {},
  onRowClick,
  showMoreDots = false
}) {
  const isCompleted = variant === 'completed';
  const avatarTones = ['blue', 'emerald', 'purple', 'indigo', 'slate', 'amber'];

  return (
    <div className="home-forecast-hub-table-scroll">
      <table className="home-forecast-hub-table">
        <thead>
          <tr>
            <th scope="col">고객사 / 업체명</th>
            <th scope="col">{isCompleted ? '계약 제품' : '제안 솔루션'}</th>
            <th scope="col" className="is-right">
              단가
            </th>
            <th scope="col" className="is-center">
              수량
            </th>
            <th scope="col" className="is-right">
              {isCompleted ? '체결 금액' : '최종 제안액'}
            </th>
            <th scope="col" className="is-center">
              {isCompleted ? '체결 시기' : '클로징 목표월'}
            </th>
            <th scope="col" className="is-center">
              {isCompleted ? '상태' : '진행 단계'}
            </th>
          </tr>
        </thead>
        <tbody>
          {(rows || []).map((row, idx) => {
            const d = getRowDisplay(row, productFilter);
            const company = String(row?.companyLabel || '—');
            const software = String(d?.softwareLabel || '—');
            const qty = Math.max(0, Number(d?.quantity) || 0);
            const unitPrice = Number(d?.unitPrice) || 0;
            const amount = isCompleted
              ? Math.max(Number(d?.contractAmount) || 0, Number(d?.finalPrice) || 0)
              : Number(d?.finalPrice) || 0;
            const stageKey = String(row?.stage || '').trim();
            const stageLabel =
              stageLabels[stageKey] ||
              (isCompleted ? '수주 성공' : stageKey || '—');
            const monthLabel = formatTargetMonth?.(row?.targetMonth) || '—';
            const tone = avatarTones[idx % avatarTones.length];
            const chipTone = productChipTone(software);
            const badgeTone = isCompleted ? 'green' : stageBadgeTone(stageKey);
            return (
              <tr
                key={row.id}
                tabIndex={0}
                role="button"
                aria-label={`기회 ${company} 상세`}
                onClick={() => onRowClick?.(row.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onRowClick?.(row.id);
                  }
                }}
              >
                <td>
                  <div className="home-forecast-hub-company">
                    <span className={`home-forecast-hub-avatar tone-${tone}`} aria-hidden>
                      {companyInitialFromLabel(company)}
                    </span>
                    <span className="home-forecast-hub-company-text">
                      <strong>{company}</strong>
                      <span>
                        {isCompleted
                          ? Number.isFinite(Number(row?.probabilityPct))
                            ? `확률 ${Number(row.probabilityPct)}%`
                            : '수주 완료'
                          : Number.isFinite(Number(row?.probabilityPct))
                            ? `확률 ${Number(row.probabilityPct)}%`
                            : '진행 중'}
                      </span>
                    </span>
                  </div>
                </td>
                <td>
                  <span className={`home-forecast-hub-chip tone-${chipTone}`} title={software}>
                    {software}
                  </span>
                </td>
                <td className="is-right">
                  <span className={`home-forecast-hub-money${unitPrice <= 0 ? ' is-muted' : ''}`}>
                    {unitPrice <= 0
                      ? '₩0 (견적 산정)'
                      : formatForecastKrw(unitPrice, row.currency, dealBasRMap)}
                  </span>
                </td>
                <td className="is-center">
                  <strong className="home-forecast-hub-qty">{qty.toLocaleString('ko-KR')}</strong>
                </td>
                <td className="is-right">
                  <span className={`home-forecast-hub-money is-strong${amount <= 0 ? ' is-muted' : ''}`}>
                    {amount <= 0 ? '—' : formatForecastKrw(amount, row.currency, dealBasRMap)}
                  </span>
                </td>
                <td className="is-center">
                  <span className="home-forecast-hub-month">{monthLabel}</span>
                </td>
                <td className="is-center">
                  <span className={`home-forecast-hub-badge tone-${badgeTone}`}>
                    {isCompleted ? '완료' : stageLabel}
                  </span>
                </td>
              </tr>
            );
          })}
          {showMoreDots ? (
            <tr className="home-forecast-hub-more">
              <td colSpan={7}>
                <span className="home-forecast-more-dots" aria-hidden>
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
