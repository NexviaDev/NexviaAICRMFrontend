import { useMemo, useCallback } from 'react';
import {
  readExcelMappedCell,
  resolveExcelRowHeaderKey
} from '../../customer-companies/customer-companies-excel-import-modal/excel-import-mapping-utils';
import { parseBillingIntervalInput } from '@/lib/product-billing-utils';
import {
  buildProductExcelPreviewColumns,
  buildBillingPeriodPreviewOptions,
  countInvalidProductExcelDraftCells,
  formatBillingPreviewCellValue,
  parseProductBillingValue,
  billingIntervalCellIsValid,
  billingPeriodCellIsValid,
  normalizeStatus,
  normalizeCurrency,
  PRODUCT_BILLING_PREVIEW_OPTIONS,
  PRODUCT_STATUS_PREVIEW_OPTIONS,
  PRODUCT_CURRENCY_PREVIEW_OPTIONS,
  resolveProductExcelColumnKey
} from './product-excel-import-utils';
import '../../sales-pipeline/opportunity-modal/opportunity-modal.css';
import '../../shared/excel-import-mapping-modal.css';
import '../../sales-pipeline/sales-opportunity-excel-import-modal/opportunity-excel-import.css';

const DISPLAY_MAX_ROWS = 200;
const BILLING_PERIOD_OPTIONS = buildBillingPeriodPreviewOptions();

function BillingTypeExcelCell({ raw, intervalRaw, hasIntervalColumn, saving, onPick }) {
  const cellRaw = raw == null ? '' : String(raw);
  const ivRaw = intervalRaw == null ? '' : String(intervalRaw);
  const valid = billingPeriodCellIsValid(cellRaw, ivRaw, hasIntervalColumn);

  if (!hasIntervalColumn) {
    const parsed = parseProductBillingValue(cellRaw);
    const displayVal =
      parsed && valid ? formatBillingPreviewCellValue(parsed.billingType, parsed.billingInterval) : '';

    return (
      <select
        className={`opp-excel-raw-cell-select ${!valid ? 'is-invalid' : ''}`}
        value={displayVal}
        onChange={(e) => {
          const v = e.target.value;
          if (v) onPick(v);
        }}
        disabled={saving}
        aria-invalid={!valid}
        title={
          !valid && cellRaw
            ? `「${cellRaw}」은 1Y·1M·P, 1년·1개월·영구 형식만 사용할 수 있습니다.`
            : '1Y→1년, 1M→1개월, P→영구로 표시됩니다.'
        }
      >
        {!valid && cellRaw ? (
          <option value="" disabled>
            {cellRaw} (인식 불가)
          </option>
        ) : (
          <option value="">(기본: 1개월)</option>
        )}
        {BILLING_PERIOD_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  const parsed = parseProductBillingValue(cellRaw, ivRaw);
  const typeVal =
    parsed?.billingType === 'Perpetual'
      ? '영구'
      : parsed?.billingType === 'Annual'
        ? '연간'
        : parsed?.billingType === 'Monthly'
          ? '월간'
          : '';

  return (
    <select
      className={`opp-excel-raw-cell-select ${!valid ? 'is-invalid' : ''}`}
      value={typeVal}
      onChange={(e) => {
        const v = e.target.value;
        if (v) onPick(v);
      }}
      disabled={saving}
      aria-invalid={!valid}
      title={!valid && cellRaw ? `「${cellRaw}」은 월간·연간·영구만 선택할 수 있습니다.` : undefined}
    >
      {!valid && cellRaw ? (
        <option value="" disabled>
          {cellRaw} (목록에 없음)
        </option>
      ) : (
        <option value="">(기본: 월간)</option>
      )}
      <option value="월간">월간 (Monthly)</option>
      <option value="연간">연간 (Annual)</option>
      <option value="영구">영구 (Perpetual)</option>
    </select>
  );
}

function StatusExcelCell({ raw, saving, onPick }) {
  const cellRaw = raw == null ? '' : String(raw);
  const normalized = normalizeStatus(cellRaw);
  const valid =
    !cellRaw.trim() ||
    ['Active', 'EndOfLife', 'Draft'].includes(cellRaw) ||
    PRODUCT_STATUS_PREVIEW_OPTIONS.some((o) => o.value === normalized);

  return (
    <select
      className={`opp-excel-raw-cell-select ${!valid ? 'is-invalid' : ''}`}
      value={valid && normalized ? normalized : ''}
      onChange={(e) => {
        const v = e.target.value;
        if (v) onPick(v);
      }}
      disabled={saving}
      aria-invalid={!valid}
      title={!valid && cellRaw ? `「${cellRaw}」은 활성·EOL·초안만 선택할 수 있습니다.` : undefined}
    >
      {!valid && cellRaw ? (
        <option value="" disabled>
          {cellRaw} (목록에 없음)
        </option>
      ) : (
        <option value="">(기본: 활성)</option>
      )}
      {PRODUCT_STATUS_PREVIEW_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function CurrencyExcelCell({ raw, saving, onPick }) {
  const cellRaw = raw == null ? '' : String(raw);
  const normalized = normalizeCurrency(cellRaw);
  const valid = !cellRaw.trim() || ['KRW', 'USD'].includes(normalized) || cellRaw === '$';

  return (
    <select
      className={`opp-excel-raw-cell-select ${!valid ? 'is-invalid' : ''}`}
      value={valid && normalized ? normalized : ''}
      onChange={(e) => {
        const v = e.target.value;
        if (v) onPick(v);
      }}
      disabled={saving}
      aria-invalid={!valid}
      title={!valid && cellRaw ? `「${cellRaw}」은 KRW·USD만 선택할 수 있습니다.` : undefined}
    >
      {!valid && cellRaw ? (
        <option value="" disabled>
          {cellRaw} (목록에 없음)
        </option>
      ) : (
        <option value="">(기본: KRW)</option>
      )}
      {PRODUCT_CURRENCY_PREVIEW_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function BillingIntervalExcelCell({ raw, billingTypeRaw, saving, onChange }) {
  const cellRaw = raw == null ? '' : String(raw);
  const parsed = parseProductBillingValue(billingTypeRaw, cellRaw);
  const billingType = parsed?.billingType || 'Monthly';
  const show = billingType === 'Monthly' || billingType === 'Annual';
  if (!show) {
    return <span className="opp-excel-raw-cell-muted">—</span>;
  }
  const valid = billingIntervalCellIsValid(cellRaw, billingType);
  const displayVal =
    cellRaw.trim() === ''
      ? ''
      : String(parseBillingIntervalInput(cellRaw, billingType));

  return (
    <input
      type="number"
      min={1}
      max={99}
      step={1}
      inputMode="numeric"
      className={`opp-excel-raw-cell-input opp-excel-raw-cell-input--narrow ${!valid ? 'is-invalid' : ''}`}
      value={displayVal}
      onChange={(e) => onChange(e.target.value)}
      disabled={saving}
      placeholder="1"
      aria-invalid={!valid}
      title={!valid && cellRaw ? `「${cellRaw}」은 1~99 사이 숫자만 입력할 수 있습니다.` : '비우면 1로 적용'}
    />
  );
}

function NameExcelCell({ raw, saving, onChange }) {
  const cellRaw = raw == null ? '' : String(raw);
  const invalid = !cellRaw.trim();

  return (
    <input
      type="text"
      className={`opp-excel-raw-cell-input ${invalid ? 'is-invalid' : ''}`}
      value={cellRaw}
      onChange={(e) => onChange(e.target.value)}
      disabled={saving}
      aria-invalid={invalid}
      placeholder="제품명 (필수)"
      title={invalid ? '제품명은 필수입니다.' : undefined}
    />
  );
}

export default function ProductExcelRawPreviewModal({
  open,
  rows,
  mappingRows,
  targetOptions,
  excelFileName,
  rowCount,
  saving,
  onClose,
  onProceed,
  onCellChange,
  saveMsg
}) {
  const saveMsgIsError =
    saveMsg && (saveMsg.includes('실패') || saveMsg.includes('필요') || saveMsg.includes('없습니다') || saveMsg.includes('수정'));

  const displayColumns = useMemo(
    () => buildProductExcelPreviewColumns(mappingRows, targetOptions),
    [mappingRows, targetOptions]
  );

  const displayRows = useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    return list.length > DISPLAY_MAX_ROWS ? list.slice(0, DISPLAY_MAX_ROWS) : list;
  }, [rows]);

  const nameColumnKey = useMemo(
    () => resolveProductExcelColumnKey(mappingRows, 'product.name'),
    [mappingRows]
  );
  const billingColumnKey = useMemo(
    () => resolveProductExcelColumnKey(mappingRows, 'product.billingType'),
    [mappingRows]
  );
  const billingIntervalColumnKey = useMemo(
    () => resolveProductExcelColumnKey(mappingRows, 'product.billingInterval'),
    [mappingRows]
  );
  const statusColumnKey = useMemo(
    () => resolveProductExcelColumnKey(mappingRows, 'product.status'),
    [mappingRows]
  );
  const currencyColumnKey = useMemo(
    () => resolveProductExcelColumnKey(mappingRows, 'product.currency'),
    [mappingRows]
  );

  const invalidCounts = useMemo(
    () =>
      countInvalidProductExcelDraftCells(rows, {
        nameColumnKey,
        billingColumnKey,
        billingIntervalColumnKey,
        statusColumnKey,
        currencyColumnKey
      }),
    [rows, nameColumnKey, billingColumnKey, billingIntervalColumnKey, statusColumnKey, currencyColumnKey]
  );

  const handleCell = useCallback(
    (rowIndex, sourceKey, value) => {
      const row = displayRows[rowIndex];
      const actualKey = resolveExcelRowHeaderKey(row, sourceKey);
      onCellChange?.(rowIndex, actualKey, value);
    },
    [displayRows, onCellChange]
  );

  if (!open) return null;

  const total = rowCount ?? rows?.length ?? 0;
  const truncated = total > DISPLAY_MAX_ROWS;
  const canProceed = total > 0 && invalidCounts.total === 0;

  return (
    <div
      className="opp-modal-overlay opp-excel-raw-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pl-excel-raw-preview-title"
    >
      <div
        className="opp-modal opp-excel-raw-preview-modal opp-excel-raw-preview-modal--fullscreen"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="opp-modal-header">
          <div className="opp-modal-header-left">
            <h3 className="opp-modal-title" id="pl-excel-raw-preview-title">
              엑셀 미리보기
            </h3>
            <span className="excel-import-map-badge excel-import-map-badge--tag">편집</span>
            <span className="excel-import-map-badge excel-import-map-badge--count">
              {total > 0 ? `${total}행` : '데이터 없음'}
            </span>
            {invalidCounts.nameMissing > 0 ? (
              <span className="excel-import-map-badge err" title="제품명 없음">
                제품명 {invalidCounts.nameMissing}
              </span>
            ) : null}
            {invalidCounts.billing > 0 ? (
              <span className="excel-import-map-badge err" title="결제 주기 오류">
                결제주기 {invalidCounts.billing}
              </span>
            ) : null}
            {invalidCounts.billingInterval > 0 ? (
              <span className="excel-import-map-badge err" title="결제 기간 수 오류">
                결제기간 {invalidCounts.billingInterval}
              </span>
            ) : null}
            {invalidCounts.status > 0 ? (
              <span className="excel-import-map-badge err" title="상태 오류">
                상태 {invalidCounts.status}
              </span>
            ) : null}
            {invalidCounts.currency > 0 ? (
              <span className="excel-import-map-badge err" title="통화 오류">
                통화 {invalidCounts.currency}
              </span>
            ) : null}
            {excelFileName ? (
              <span className="excel-import-map-badge excel-import-map-badge--muted" title={excelFileName}>
                {excelFileName.length > 28 ? `${excelFileName.slice(0, 25)}…` : excelFileName}
              </span>
            ) : null}
          </div>
          <button type="button" className="opp-modal-close" onClick={onClose} disabled={saving} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="opp-excel-raw-preview-modal-body">
          <div className="opp-excel-raw-preview-intro-bar">
            <span>
              <strong>매핑한 대상 필드</strong> 기준 표시(헤더 위에 마우스를 올리면 원본 엑셀 열 이름) · 셀을 직접 수정 ·{' '}
              <strong>제품명</strong> 필수 · 결제주기는 <strong>1Y→1년, 1M→1개월, P→영구</strong>로 표시 · 상태·통화는 목록 선택 · 잘못된 값은{' '}
              <strong style={{ color: '#b91c1c' }}>붉게</strong> 표시 · 해소 후 <strong>일괄 등록</strong>
            </span>
          </div>
          {!nameColumnKey ? (
            <p className="opp-excel-raw-preview-warn">
              참고: 매핑에서 제품명이 <strong>고정값</strong>이면 모든 행에 동일한 제품명이 적용됩니다.
            </p>
          ) : null}

          <div className="opp-excel-raw-preview-wrap opp-excel-raw-preview-wrap--modal">
            <div className="opp-excel-raw-preview-head">
              <h4>등록 예정 데이터</h4>
              <span className="excel-import-map-source-meta">
                {truncated ? `표시 ${DISPLAY_MAX_ROWS}행 / 전체 ${total}행` : `전체 ${total}행 · 스크롤로 확인`}
              </span>
            </div>
            <div className="opp-excel-raw-preview-scroll opp-excel-raw-preview-scroll--fill">
              {displayColumns.length === 0 ? (
                <p className="opp-excel-raw-preview-empty">
                  매핑된 열이 없습니다. 매핑 단계에서 엑셀 열을 대상 필드에 연결해 주세요.
                </p>
              ) : (
                <table className="opp-excel-raw-preview-table">
                  <thead>
                    <tr>
                      <th className="opp-excel-raw-preview-th-num">#</th>
                      {displayColumns.map((col) => {
                        const h = col.excelKey;
                        return (
                        <th
                          key={h}
                          title={`원본 엑셀 열: ${col.excelTitle}`}
                          className={
                            h === nameColumnKey ||
                            h === billingColumnKey ||
                            h === billingIntervalColumnKey ||
                            h === statusColumnKey ||
                            h === currencyColumnKey
                              ? 'opp-excel-raw-preview-th--stage'
                              : ''
                          }
                        >
                          {col.label}
                          {h === nameColumnKey ? (
                            <span className="opp-excel-raw-preview-th-badge">제품명 필수</span>
                          ) : null}
                          {h === billingColumnKey ? (
                            <span className="opp-excel-raw-preview-th-badge">결제주기</span>
                          ) : null}
                          {h === billingIntervalColumnKey ? (
                            <span className="opp-excel-raw-preview-th-badge">기간수</span>
                          ) : null}
                          {h === statusColumnKey ? (
                            <span className="opp-excel-raw-preview-th-badge">상태</span>
                          ) : null}
                          {h === currencyColumnKey ? (
                            <span className="opp-excel-raw-preview-th-badge">통화</span>
                          ) : null}
                        </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row, idx) => (
                      <tr key={idx}>
                        <td className="opp-excel-raw-preview-td-num">{idx + 1}</td>
                        {displayColumns.map((col) => {
                          const h = col.excelKey;
                          const cellRaw = readExcelMappedCell(row, h);
                          return (
                          <td key={h}>
                            {h === nameColumnKey ? (
                              <NameExcelCell
                                raw={cellRaw}
                                saving={saving}
                                onChange={(v) => handleCell(idx, h, v)}
                              />
                            ) : h === billingColumnKey ? (
                              <BillingTypeExcelCell
                                raw={cellRaw}
                                intervalRaw={
                                  billingIntervalColumnKey
                                    ? readExcelMappedCell(row, billingIntervalColumnKey)
                                    : ''
                                }
                                hasIntervalColumn={Boolean(billingIntervalColumnKey)}
                                saving={saving}
                                onPick={(v) => handleCell(idx, h, v)}
                              />
                            ) : h === billingIntervalColumnKey ? (
                              <BillingIntervalExcelCell
                                raw={cellRaw}
                                billingTypeRaw={
                                  billingColumnKey
                                    ? readExcelMappedCell(row, billingColumnKey)
                                    : 'Monthly'
                                }
                                saving={saving}
                                onChange={(v) => handleCell(idx, h, v)}
                              />
                            ) : h === statusColumnKey ? (
                              <StatusExcelCell
                                raw={cellRaw}
                                saving={saving}
                                onPick={(v) => handleCell(idx, h, v)}
                              />
                            ) : h === currencyColumnKey ? (
                              <CurrencyExcelCell
                                raw={cellRaw}
                                saving={saving}
                                onPick={(v) => handleCell(idx, h, v)}
                              />
                            ) : (
                              <input
                                type="text"
                                className="opp-excel-raw-cell-input"
                                value={cellRaw}
                                onChange={(e) => handleCell(idx, h, e.target.value)}
                                disabled={saving}
                                aria-label={`${idx + 1}행 ${col.label}`}
                              />
                            )}
                          </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {saveMsg ? (
            <p
              className={`excel-import-map-save-msg ${saveMsgIsError ? 'is-error' : ''}`}
              style={{ margin: 0, padding: '0.5rem 1.25rem', flexShrink: 0 }}
            >
              {saveMsg}
            </p>
          ) : null}
        </div>

        <div className="opp-modal-footer opp-excel-import-footer">
          <button
            type="button"
            className="opp-excel-footer-btn opp-excel-footer-btn--ghost"
            onClick={onClose}
            disabled={saving}
          >
            <span className="material-symbols-outlined" aria-hidden>
              arrow_back
            </span>
            뒤로 (매핑)
          </button>
          <button
            type="button"
            className="opp-excel-footer-btn opp-excel-footer-btn--register"
            disabled={saving || !canProceed}
            title={!canProceed ? '붉은 칸을 모두 수정한 뒤 등록할 수 있습니다' : undefined}
            onClick={onProceed}
          >
            <span
              className={`material-symbols-outlined${saving ? ' opp-excel-footer-icon-spin' : ''}`}
              aria-hidden
            >
              {saving ? 'progress_activity' : 'upload'}
            </span>
            {saving ? '등록 중…' : '일괄 등록'}
          </button>
        </div>
      </div>
    </div>
  );
}
