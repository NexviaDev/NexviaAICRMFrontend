import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import ParticipantModal from '@/shared/participant-modal/participant-modal';
import CustomerCompanySearchModal from '@/customer-companies/customer-company-search-modal/customer-company-search-modal';
import { useExcelGridClipboard } from '@/lib/use-excel-grid-clipboard';
import {
  readExcelMappedCell,
  resolveExcelRowHeaderKey
} from '../../customer-companies/customer-companies-excel-import-modal/excel-import-mapping-utils';
import { OPPORTUNITY_PRICE_BASIS_OPTIONS } from '@/lib/product-price-utils';
import {
  sanitizePriceExcelInput,
  formatPriceExcelInputDisplay
} from '../../product-list/product-excel-import-modal/product-excel-import-utils';
import {
  resolveStageValue,
  countInvalidExcelDraftCells,
  resolveExcelStageColumnKey,
  resolveExcelPriceBasisColumnKey,
  resolveExcelChannelDistributorColumnKey,
  resolveExcelAssigneeColumnKey,
  resolveExcelCompanyColumnKey,
  resolvePriceBasisValue,
  resolveChannelDistributor,
  resolveAssigneeFromOverview,
  resolveCustomerCompanyInExcelDraft,
  resolveProductInExcelDraft,
  countSoftWarningExcelDraftCells,
  guessExcelProductColumnKey,
  buildOpportunityExcelPreviewColumns,
  isOpportunityPreviewCellKey,
  isForceImportExcelRow,
  isExcelMetaHeaderKey,
  OPP_EXCEL_ROW_META_ASSIGNEE_ID,
  OPP_EXCEL_ROW_META_COMPANY_ID,
  OPP_EXCEL_ROW_META_FORCE_IMPORT,
  readOpportunityExcelPreviewCellRaw,
  resolveCurrencyValue,
  OPP_PRICE_TARGET_KEYS
} from './opportunity-excel-import-utils';
import '../../shared/custom-fields-section.css';
import '../../sales-pipeline/opportunity-modal/opportunity-modal.css';
import '../../shared/excel-import-mapping-modal.css';
import './opportunity-excel-import.css';

const DISPLAY_MAX_ROWS = 200;

function CurrencyExcelCell({ raw, saving, onPick, currencyPreviewOptions, allowedCodes }) {
  const cellRaw = raw == null ? '' : String(raw);
  const resolved = resolveCurrencyValue(cellRaw, allowedCodes);
  const selectValue = resolved.valid ? resolved.value : '';
  const options = currencyPreviewOptions?.length ? currencyPreviewOptions : [{ value: 'KRW', label: '₩(원화-한국)' }];

  return (
    <select
      className={`opp-excel-raw-cell-select opp-excel-raw-cell-select--currency ${!resolved.valid && cellRaw ? 'is-invalid' : ''}`}
      value={selectValue || 'KRW'}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        onPick(v);
      }}
      disabled={saving}
      aria-invalid={!resolved.valid && Boolean(cellRaw)}
      title={
        !resolved.valid && cellRaw
          ? `「${cellRaw}」은 등록 가능한 통화 코드가 아닙니다.`
          : undefined
      }
    >
      {!resolved.valid && cellRaw ? (
        <option value="" disabled>
          {cellRaw} (목록에 없음)
        </option>
      ) : null}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function StageExcelCell({ raw, stageOptions, saving, onPick }) {
  const cellRaw = raw == null ? '' : String(raw);
  const resolved = resolveStageValue(cellRaw, stageOptions);
  const selectValue = resolved.valid ? resolved.value : '';

  return (
    <select
      className={`opp-excel-raw-cell-select ${!resolved.valid ? 'is-invalid' : ''}`}
      value={selectValue}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        const opt = stageOptions.find((o) => o.value === v);
        onPick(opt ? opt.value : v);
      }}
      disabled={saving}
      aria-invalid={!resolved.valid}
      title={
        !resolved.valid && cellRaw
          ? `「${cellRaw}」은 파이프라인 단계 관리에 등록된 단계가 아닙니다.`
          : undefined
      }
    >
      {!resolved.valid && cellRaw ? (
        <option value="" disabled>
          {cellRaw} (목록에 없음)
        </option>
      ) : (
        <option value="">{resolved.valid ? '' : '단계 선택…'}</option>
      )}
      {stageOptions.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label || o.value}
        </option>
      ))}
    </select>
  );
}

function PriceBasisExcelCell({ raw, distributorRaw, saving, onPick }) {
  const cellRaw = raw == null ? '' : String(raw);
  const resolved = resolvePriceBasisValue(cellRaw);
  const forcedChannel = String(distributorRaw || '').trim();
  const effective = forcedChannel && resolved.value !== 'channel' ? resolvePriceBasisValue('channel') : resolved;
  const selectValue = effective.valid ? effective.value : '';

  return (
    <select
      className={`opp-excel-raw-cell-select ${!effective.valid ? 'is-invalid' : ''}`}
      value={selectValue}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        onPick(v);
      }}
      disabled={saving}
      aria-invalid={!effective.valid}
      title={
        !effective.valid && cellRaw
          ? `「${cellRaw}」은 다이렉트·유통만 선택할 수 있습니다.`
          : forcedChannel
            ? '유통사가 있으면 가격기준은 유통입니다.'
            : undefined
      }
    >
      {!effective.valid && cellRaw ? (
        <option value="" disabled>
          {cellRaw} (목록에 없음)
        </option>
      ) : (
        <option value="">{effective.valid ? '' : '가격기준 선택…'}</option>
      )}
      {OPPORTUNITY_PRICE_BASIS_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ChannelDistributorExcelCell({ raw, priceBasisRaw, channelDistributors, saving, onPick }) {
  const cellRaw = raw == null ? '' : String(raw);
  const basis = resolvePriceBasisValue(priceBasisRaw);
  const effectiveBasis = String(cellRaw).trim() ? { value: 'channel', valid: true } : basis;
  const resolved = resolveChannelDistributor(cellRaw, { channelDistributors }, effectiveBasis.value);
  const list = Array.isArray(channelDistributors) ? channelDistributors : [];
  const selectValue = resolved.valid && list.includes(resolved.value) ? resolved.value : '';

  return (
    <select
      className={`opp-excel-raw-cell-select ${cellRaw && !resolved.valid ? 'is-invalid' : ''}`}
      value={selectValue}
      onChange={(e) => onPick(e.target.value)}
      disabled={saving}
      aria-invalid={cellRaw && !resolved.valid}
      title={
        cellRaw && !resolved.valid
          ? `「${cellRaw}」은 등록된 유통사가 아닙니다.`
          : undefined
      }
    >
      {!resolved.valid && cellRaw ? (
        <option value="" disabled>
          {cellRaw} (목록에 없음)
        </option>
      ) : (
        <option value="">—</option>
      )}
      {list.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

function CompanyExcelCell({ raw, row, companyCol, customerCompanies, saving, onTextChange, onOpenPicker, onForceRow }) {
  const cellRaw = raw == null ? '' : String(raw);
  const forcedId = row[OPP_EXCEL_ROW_META_COMPANY_ID];
  const forcedRow = isForceImportExcelRow(row);
  const resolved = resolveCustomerCompanyInExcelDraft(cellRaw, { customerCompanies }, forcedId);
  const invalid = !resolved.valid && !forcedRow;
  const placeholder =
    resolved.status === 'personal' ? '개인구매(비어 있음)' : '고객사명';

  return (
    <div className="opp-excel-raw-assignee-cell">
      <div className="opp-excel-raw-assignee-row">
        <input
          type="text"
          className={`opp-excel-raw-cell-input ${invalid ? 'is-invalid' : ''}`}
          value={cellRaw}
          onChange={(e) => onTextChange(e.target.value)}
          disabled={saving}
          placeholder={placeholder}
          aria-invalid={invalid}
          title={resolved.warn || undefined}
        />
        <button
          type="button"
          className="opp-excel-raw-assignee-search"
          onClick={onOpenPicker}
          disabled={saving}
          title="고객사 검색·선택 (추가 가능)"
          aria-label="고객사 검색"
        >
          <span className="material-symbols-outlined" aria-hidden>
            search
          </span>
        </button>
      </div>
      {resolved.warn && !forcedRow ? (
        <span className="opp-excel-raw-assignee-warn" role="status">
          {resolved.warn}
        </span>
      ) : null}
      {invalid ? (
        <button type="button" className="opp-excel-raw-force-btn" onClick={onForceRow} disabled={saving}>
          그대로 등록
        </button>
      ) : null}
      {forcedRow && resolved.status !== 'ok' && resolved.status !== 'personal' ? (
        <span className="opp-excel-raw-force-ok" role="status">
          경고 무시·스냅샷 등록
        </span>
      ) : null}
    </div>
  );
}

function AssigneeExcelCell({ raw, row, assignCol, overviewEmployees, defaultUserId, saving, onTextChange, onOpenPicker, onForceRow }) {
  const cellRaw = raw == null ? '' : String(raw);
  const forcedId = row[OPP_EXCEL_ROW_META_ASSIGNEE_ID];
  const forcedRow = isForceImportExcelRow(row);
  const resolved = resolveAssigneeFromOverview(cellRaw, overviewEmployees, forcedId, defaultUserId);
  const invalid = !resolved.valid && !forcedRow;

  return (
    <div className="opp-excel-raw-assignee-cell">
      <div className="opp-excel-raw-assignee-row">
        <input
          type="text"
          className={`opp-excel-raw-cell-input ${invalid ? 'is-invalid' : ''}`}
          value={cellRaw}
          onChange={(e) => onTextChange(e.target.value)}
          disabled={saving}
          placeholder={resolved.status === 'default' ? '미입력 · 등록 시 본인' : '사내 담당자'}
          aria-invalid={invalid}
          title={resolved.warn || undefined}
        />
        <button
          type="button"
          className="opp-excel-raw-assignee-search"
          onClick={onOpenPicker}
          disabled={saving}
          title="사내현황 직원에서 선택"
          aria-label="사내 담당자 선택"
        >
          <span className="material-symbols-outlined" aria-hidden>
            search
          </span>
        </button>
      </div>
      {resolved.warn && !forcedRow ? (
        <span className="opp-excel-raw-assignee-warn" role="status">
          {resolved.warn}
        </span>
      ) : null}
      {invalid ? (
        <button type="button" className="opp-excel-raw-force-btn" onClick={onForceRow} disabled={saving}>
          그대로 등록
        </button>
      ) : null}
      {forcedRow && !resolved.valid ? (
        <span className="opp-excel-raw-force-ok" role="status">
          경고 무시·등록
        </span>
      ) : null}
    </div>
  );
}

function ProductExcelCell({ raw, meta, saving, onTextChange }) {
  const cellRaw = raw == null ? '' : String(raw);
  const resolved = resolveProductInExcelDraft(cellRaw, meta);
  const invalid = !resolved.valid;
  return (
    <div className="opp-excel-raw-assignee-cell">
      <input
        type="text"
        className={`opp-excel-raw-cell-input ${invalid ? 'is-invalid' : ''}`}
        value={cellRaw}
        onChange={(e) => onTextChange(e.target.value)}
        disabled={saving}
        placeholder="제품명"
        title={resolved.warn || undefined}
      />
      {resolved.status === 'unregistered' ? (
        <span className="opp-excel-raw-product-hint" role="status">
          {resolved.warn}
        </span>
      ) : null}
    </div>
  );
}

/** 추가 필드 — 선택 목록 (custom-fields-section과 동일 choices) */
function SelectListExcelCell({ raw, choices, saving, onPick }) {
  const cellRaw = raw == null ? '' : String(raw);
  const list = Array.isArray(choices) ? choices : [];
  const trimmed = cellRaw.trim();
  const valid = !trimmed || list.includes(trimmed);

  return (
    <select
      className={`opp-excel-raw-cell-select opp-excel-raw-cell-select-list ${!valid ? 'is-invalid' : ''}`}
      value={valid && trimmed ? trimmed : ''}
      onChange={(e) => onPick(e.target.value)}
      disabled={saving}
      aria-invalid={!valid}
      title={!valid && trimmed ? `「${trimmed}」은 선택 목록에 없습니다.` : undefined}
    >
      {!valid && trimmed ? (
        <option value="" disabled>
          {trimmed} (목록에 없음)
        </option>
      ) : (
        <option value="">선택</option>
      )}
      {list.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

function parseMultiselectRaw(raw) {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function MultiselectExcelCell({ raw, choices, saving, isOpen, onToggleOpen, onChange, wrapRef }) {
  const list = Array.isArray(choices) ? choices : [];
  const selected = parseMultiselectRaw(raw);
  const invalid = selected.some((v) => !list.includes(v));
  const triggerLabel =
    selected.length === 0
      ? '선택'
      : selected.length === 1
        ? selected[0]
        : selected.length === 2
          ? `${selected[0]}, ${selected[1]}`
          : `${selected[0]} 외 ${selected.length - 1}개`;

  const toggle = (choice) => {
    const arr = [...selected];
    const idx = arr.indexOf(choice);
    if (idx === -1) arr.push(choice);
    else arr.splice(idx, 1);
    onChange(arr.join(', '));
  };

  return (
    <div className="opp-excel-raw-multiselect-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`opp-excel-raw-multiselect-trigger${invalid ? ' is-invalid' : ''}`}
        onClick={() => onToggleOpen()}
        disabled={saving}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span>{triggerLabel}</span>
        <span className="material-symbols-outlined" style={{ fontSize: '1rem' }} aria-hidden>
          {isOpen ? 'expand_less' : 'expand_more'}
        </span>
      </button>
      {isOpen ? (
        <div className="opp-excel-raw-multiselect-dropdown" role="listbox">
          {list.map((c) => (
            <label key={c} className="opp-excel-raw-multiselect-option" role="option">
              <input
                type="checkbox"
                checked={selected.includes(c)}
                onChange={() => toggle(c)}
                disabled={saving}
              />
              <span>{c}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function sanitizeOppPasteValue(targetKey, raw) {
  const text = String(raw ?? '').trim();
  if (OPP_PRICE_TARGET_KEYS.has(targetKey)) {
    return sanitizePriceExcelInput(text);
  }
  return text;
}

/**
 * 매핑 다음 단계 — 매핑된 CRM 대상 필드 기준으로 표시하고, 셀 값(엑셀 원본)을 수정할 수 있습니다.
 */
export default function OpportunityExcelRawPreviewModal({
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
  onAssigneePicked,
  onCompanyPicked,
  onForceImportRow,
  saveMsg,
  stageOptions,
  stageMapping,
  priceBasisMapping,
  channelMapping,
  assigneeMapping,
  companyMapping,
  customerCompanies,
  products,
  channelDistributors,
  overviewEmployees,
  teamMembersForPicker,
  currentUser,
  defaultUserId,
  currencyPreviewOptions = [],
  currencyAllowedCodes = null,
  financeFieldDefs = [],
  scheduleFieldDefs = []
}) {
  const [assigneePickerRow, setAssigneePickerRow] = useState(null);
  const [companyPickerRow, setCompanyPickerRow] = useState(null);
  const [openMultiselect, setOpenMultiselect] = useState(null);
  const multiselectWrapRef = useRef(null);

  const saveMsgIsError =
    saveMsg && (saveMsg.includes('실패') || saveMsg.includes('필요') || saveMsg.includes('없습니다') || saveMsg.includes('수정'));

  const headers = useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    const keys = new Set();
    for (const r of list.slice(0, 80)) {
      Object.keys(r || {}).forEach((k) => {
        if (!isExcelMetaHeaderKey(k)) keys.add(k);
      });
    }
    return Array.from(keys);
  }, [rows]);

  const displayColumns = useMemo(
    () => buildOpportunityExcelPreviewColumns(mappingRows, targetOptions, headers),
    [mappingRows, targetOptions, headers]
  );

  const displayRows = useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    return list.length > DISPLAY_MAX_ROWS ? list.slice(0, DISPLAY_MAX_ROWS) : list;
  }, [rows]);

  const stageColumnKey = useMemo(
    () => resolveExcelStageColumnKey(headers, stageMapping),
    [headers, stageMapping]
  );

  const priceBasisColumnKey = useMemo(
    () => resolveExcelPriceBasisColumnKey(headers, priceBasisMapping),
    [headers, priceBasisMapping]
  );

  const channelColumnKey = useMemo(
    () => resolveExcelChannelDistributorColumnKey(headers, channelMapping),
    [headers, channelMapping]
  );

  const assigneeColumnKey = useMemo(
    () => resolveExcelAssigneeColumnKey(headers, assigneeMapping),
    [headers, assigneeMapping]
  );

  const companyColumnKey = useMemo(
    () => resolveExcelCompanyColumnKey(headers, companyMapping),
    [headers, companyMapping]
  );

  const productColumnKey = useMemo(() => {
    const fromMap = displayColumns.find((c) => c.targetKey === 'opp.productName');
    if (fromMap?.excelKey) return fromMap.excelKey;
    return guessExcelProductColumnKey(headers);
  }, [displayColumns, headers]);

  const invalidCounts = useMemo(
    () =>
      countInvalidExcelDraftCells(rows, {
        headers,
        stageMapping,
        stageOptions,
        priceBasisMapping,
        channelMapping,
        assigneeMapping,
        companyMapping,
        overviewEmployees,
        defaultUserId,
        meta: { channelDistributors, customerCompanies }
      }),
    [
      rows,
      headers,
      stageMapping,
      stageOptions,
      priceBasisMapping,
      channelMapping,
      assigneeMapping,
      companyMapping,
      overviewEmployees,
      channelDistributors,
      customerCompanies,
      defaultUserId
    ]
  );

  const softWarnings = useMemo(
    () =>
      countSoftWarningExcelDraftCells(rows, {
        headers,
        companyMapping,
        assigneeMapping,
        overviewEmployees,
        defaultUserId,
        meta: { channelDistributors, customerCompanies }
      }),
    [
      rows,
      headers,
      companyMapping,
      assigneeMapping,
      overviewEmployees,
      customerCompanies,
      defaultUserId,
      channelDistributors
    ]
  );

  const handleCell = useCallback(
    (rowIndex, sourceKey, value) => {
      const row = displayRows[rowIndex];
      const actualKey = isOpportunityPreviewCellKey(sourceKey)
        ? sourceKey
        : resolveExcelRowHeaderKey(row, sourceKey);
      onCellChange?.(rowIndex, actualKey, value);
    },
    [displayRows, onCellChange]
  );

  const previewCellRaw = useCallback(
    (row, col) => {
      if (col?.isConstant) return col.constantValue ?? '';
      return readOpportunityExcelPreviewCellRaw(
        row,
        mappingRows,
        col?.targetKey,
        formulaFieldDefinitions,
        headers
      );
    },
    [mappingRows, formulaFieldDefinitions, headers]
  );

  const formulaFieldDefinitions = useMemo(
    () => [...(financeFieldDefs || []), ...(scheduleFieldDefs || [])],
    [financeFieldDefs, scheduleFieldDefs]
  );

  const financeFieldDefByTargetKey = useMemo(() => {
    const map = new Map();
    for (const def of financeFieldDefs || []) {
      if (!def?.key) continue;
      map.set(`opp.financeCustomFields.${def.key}`, def);
    }
    return map;
  }, [financeFieldDefs]);

  const getGridCellValue = useCallback(
    (rowIndex, colIndex) => {
      const col = displayColumns[colIndex];
      const row = displayRows[rowIndex];
      if (!col || !row) return '';
      return String(previewCellRaw(row, col) ?? '');
    },
    [displayColumns, displayRows, previewCellRaw]
  );

  const setGridCellValue = useCallback(
    (rowIndex, colIndex, value) => {
      const col = displayColumns[colIndex];
      if (!col || col.isConstant) return;
      handleCell(rowIndex, col.excelKey, value);
    },
    [displayColumns, handleCell]
  );

  const isGridCellEditable = useCallback(
    (rowIndex, colIndex) => {
      const col = displayColumns[colIndex];
      return Boolean(col && !col.isConstant);
    },
    [displayColumns]
  );

  const sanitizeGridPaste = useCallback(
    (rowIndex, colIndex, raw) => {
      const col = displayColumns[colIndex];
      if (!col) return String(raw ?? '').trim();
      return sanitizeOppPasteValue(col.targetKey, raw);
    },
    [displayColumns]
  );

  const {
    gridRootRef,
    isCellSelected,
    isCellActive,
    isAltDragging
  } = useExcelGridClipboard({
    rowCount: displayRows.length,
    colCount: displayColumns.length,
    disabled: saving,
    getCellValue: getGridCellValue,
    setCellValue: setGridCellValue,
    isCellEditable: isGridCellEditable,
    sanitizePasteValue: sanitizeGridPaste
  });

  useEffect(() => {
    if (openMultiselect == null) return;
    const onDocClick = (e) => {
      if (multiselectWrapRef.current && !multiselectWrapRef.current.contains(e.target)) {
        setOpenMultiselect(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [openMultiselect]);

  const renderDataCell = useCallback(
    (row, idx, col, cellRaw) => {
      const h = col.excelKey;
      const tk = col.targetKey;
      const financeDef = financeFieldDefByTargetKey.get(tk);

      if (col.isConstant) {
        return (
          <input
            type="text"
            className="opp-excel-raw-cell-input is-locked"
            value={cellRaw}
            readOnly
            disabled
            aria-label={`${idx + 1}행 ${col.label} (고정값)`}
          />
        );
      }
      if (tk === 'opp.stage') {
        return (
          <StageExcelCell
            raw={cellRaw}
            stageOptions={stageOptions}
            saving={saving}
            onPick={(v) => handleCell(idx, h, v)}
          />
        );
      }
      if (tk === 'opp.unitPriceBasis') {
        return (
          <PriceBasisExcelCell
            raw={cellRaw}
            distributorRaw={channelColumnKey ? readExcelMappedCell(row, channelColumnKey) : ''}
            saving={saving}
            onPick={(v) => handleCell(idx, h, v)}
          />
        );
      }
      if (tk === 'opp.channelDistributor') {
        return (
          <ChannelDistributorExcelCell
            raw={cellRaw}
            priceBasisRaw={priceBasisColumnKey ? readExcelMappedCell(row, priceBasisColumnKey) : ''}
            channelDistributors={channelDistributors}
            saving={saving}
            onPick={(v) => handleCell(idx, h, v)}
          />
        );
      }
      if (tk === 'opp.snapshotCompanyName') {
        return (
          <CompanyExcelCell
            raw={cellRaw}
            row={row}
            companyCol={h}
            customerCompanies={customerCompanies}
            saving={saving}
            onTextChange={(v) => handleCell(idx, h, v)}
            onOpenPicker={() => setCompanyPickerRow(idx)}
            onForceRow={() => onForceImportRow?.(idx)}
          />
        );
      }
      if (tk === 'opp.productName') {
        return (
          <ProductExcelCell
            raw={cellRaw}
            meta={{ products: products || [], customerCompanies }}
            saving={saving}
            onTextChange={(v) => handleCell(idx, h, v)}
          />
        );
      }
      if (tk === 'opp.assignedToName') {
        return (
          <AssigneeExcelCell
            raw={cellRaw}
            row={row}
            assignCol={h}
            overviewEmployees={overviewEmployees}
            defaultUserId={defaultUserId}
            saving={saving}
            onTextChange={(v) => handleCell(idx, h, v)}
            onOpenPicker={() => setAssigneePickerRow(idx)}
            onForceRow={() => onForceImportRow?.(idx)}
          />
        );
      }
      if (tk === 'opp.currency') {
        return (
          <CurrencyExcelCell
            raw={cellRaw}
            saving={saving}
            onPick={(v) => handleCell(idx, h, v)}
            currencyPreviewOptions={currencyPreviewOptions}
            allowedCodes={currencyAllowedCodes}
          />
        );
      }
      if (financeDef?.type === 'select') {
        const choices = financeDef.options?.choices || [];
        return (
          <SelectListExcelCell
            raw={cellRaw}
            choices={choices}
            saving={saving}
            onPick={(v) => handleCell(idx, h, v)}
          />
        );
      }
      if (financeDef?.type === 'multiselect') {
        const choices = financeDef.options?.choices || [];
        const msKey = `${idx}:${col.targetKey}`;
        const isOpen = openMultiselect?.key === msKey;
        return (
          <MultiselectExcelCell
            raw={cellRaw}
            choices={choices}
            saving={saving}
            isOpen={isOpen}
            wrapRef={isOpen ? multiselectWrapRef : null}
            onToggleOpen={() => setOpenMultiselect(isOpen ? null : { key: msKey })}
            onChange={(v) => handleCell(idx, h, v)}
          />
        );
      }
      if (OPP_PRICE_TARGET_KEYS.has(tk)) {
        return (
          <input
            type="text"
            className="opp-excel-raw-cell-input"
            value={formatPriceExcelInputDisplay(cellRaw) || cellRaw}
            onChange={(e) => handleCell(idx, h, sanitizePriceExcelInput(e.target.value))}
            disabled={saving}
            aria-label={`${idx + 1}행 ${col.label}`}
            inputMode="decimal"
          />
        );
      }
      return (
        <input
          type="text"
          className="opp-excel-raw-cell-input"
          value={cellRaw}
          onChange={(e) => handleCell(idx, h, e.target.value)}
          disabled={saving}
          aria-label={`${idx + 1}행 ${col.label}`}
        />
      );
    },
    [
      channelColumnKey,
      priceBasisColumnKey,
      channelDistributors,
      customerCompanies,
      products,
      overviewEmployees,
      defaultUserId,
      currencyPreviewOptions,
      currencyAllowedCodes,
      financeFieldDefByTargetKey,
      openMultiselect,
      stageOptions,
      saving,
      handleCell,
      onForceImportRow
    ]
  );

  const pickerSelected = useMemo(() => {
    if (assigneePickerRow == null) return [];
    const row = displayRows[assigneePickerRow];
    if (!row || !assigneeColumnKey) return [];
    const forced = row[OPP_EXCEL_ROW_META_ASSIGNEE_ID];
    const name = readExcelMappedCell(row, assigneeColumnKey).trim();
    if (!forced) return [];
    const tm = (teamMembersForPicker || []).find((m) => String(m._id || m.id || m.userId) === String(forced));
    if (tm) {
      return [{ userId: forced, name: tm.name || name, avatar: tm.avatar || '' }];
    }
    return name ? [{ userId: forced, name, avatar: '' }] : [];
  }, [assigneePickerRow, displayRows, assigneeColumnKey, teamMembersForPicker]);

  if (!open) return null;

  const total = rowCount ?? rows?.length ?? 0;
  const truncated = total > DISPLAY_MAX_ROWS;
  const canProceed = total > 0 && invalidCounts.total === 0;

  return (
    <div
      className="opp-modal-overlay opp-excel-raw-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sp-excel-raw-preview-title"
    >
      <div
        className="opp-modal opp-excel-raw-preview-modal opp-excel-raw-preview-modal--fullscreen"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="opp-modal-header">
          <div className="opp-modal-header-left">
            <h3 className="opp-modal-title" id="sp-excel-raw-preview-title">
              엑셀 미리보기
            </h3>
            <span className="excel-import-map-badge excel-import-map-badge--tag">편집</span>
            <span className="excel-import-map-badge excel-import-map-badge--count">
              {total > 0 ? `${total}행` : '데이터 없음'}
            </span>
            {invalidCounts.stage > 0 ? (
              <span className="excel-import-map-badge err" title="파이프라인에 없는 단계">
                단계 오류 {invalidCounts.stage}
              </span>
            ) : null}
            {invalidCounts.priceBasis > 0 ? (
              <span className="excel-import-map-badge err" title="가격기준 오류">
                가격기준 {invalidCounts.priceBasis}
              </span>
            ) : null}
            {invalidCounts.channelDistributor > 0 ? (
              <span className="excel-import-map-badge err" title="유통사 오류">
                유통사 {invalidCounts.channelDistributor}
              </span>
            ) : null}
            {invalidCounts.assignee > 0 ? (
              <span className="excel-import-map-badge err" title="사내 담당자 오류">
                담당자 {invalidCounts.assignee}
              </span>
            ) : null}
            {invalidCounts.company > 0 ? (
              <span className="excel-import-map-badge err" title="고객사 목록에 없음">
                고객사 {invalidCounts.company}
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
              <strong>CRM 매핑 가능 필드</strong> 전부 표시 · <strong>Alt</strong> 누른 채 드래그 → 범위 선택 ·{' '}
              <strong>Esc</strong> 선택 해제 · <strong>Ctrl+C / Ctrl+V</strong> 복사·붙여넣기(엑셀 TSV) ·{' '}
              <strong>고객사</strong> CRM 대조 · <strong>단계·가격기준·선택목록 필드</strong>은 드롭다운 · 잘못된 값{' '}
              <strong style={{ color: '#b91c1c' }}>붉게</strong> · 해소 후 <strong>일괄 등록</strong>
            </span>
          </div>
          {stageMapping?.mode === 'constant' ? (
            <p className="opp-excel-raw-preview-warn">
              참고: 매핑에서 단계가 <strong>고정값</strong>이면 등록 시 엑셀 「단계」열 대신 고정값이 사용됩니다.
            </p>
          ) : null}

          <div className="opp-excel-raw-preview-wrap opp-excel-raw-preview-wrap--modal">
            <div className="opp-excel-raw-preview-head">
              <h4>등록 예정 데이터</h4>
              <span className="excel-import-map-source-meta">
                {truncated ? `표시 ${DISPLAY_MAX_ROWS}행 / 전체 ${total}행` : `전체 ${total}행 · 스크롤로 확인`}
              </span>
            </div>
            <div
              className={`opp-excel-raw-preview-scroll opp-excel-raw-preview-scroll--fill${isAltDragging ? ' is-alt-dragging' : ''}`}
              ref={gridRootRef}
            >
              {displayColumns.length === 0 ? (
                <p className="opp-excel-raw-preview-empty">
                  표시할 대상 필드가 없습니다. 매핑 단계로 돌아가 주세요.
                </p>
              ) : (
                <table className="opp-excel-raw-preview-table">
                  <thead>
                    <tr>
                      <th className="opp-excel-raw-preview-th-num">#</th>
                      {displayColumns.map((col) => (
                        <th
                          key={col.targetKey}
                          title={col.excelTitle}
                          className={
                            col.targetKey === 'opp.stage' ||
                            col.targetKey === 'opp.unitPriceBasis' ||
                            col.targetKey === 'opp.channelDistributor' ||
                            col.targetKey === 'opp.assignedToName' ||
                            col.targetKey === 'opp.snapshotCompanyName' ||
                            col.targetKey === 'opp.productName' ||
                            col.targetKey === 'opp.currency' ||
                            financeFieldDefByTargetKey.get(col.targetKey)?.type === 'select' ||
                            financeFieldDefByTargetKey.get(col.targetKey)?.type === 'multiselect'
                              ? 'opp-excel-raw-preview-th--stage'
                              : ''
                          }
                        >
                          {col.label}
                          {col.targetKey === 'opp.stage' ? (
                            <span className="opp-excel-raw-preview-th-badge">단계 목록</span>
                          ) : null}
                          {col.targetKey === 'opp.snapshotCompanyName' ? (
                            <span className="opp-excel-raw-preview-th-badge">고객사 CRM</span>
                          ) : null}
                          {col.targetKey === 'opp.productName' ? (
                            <span className="opp-excel-raw-preview-th-badge">제품명</span>
                          ) : null}
                          {col.targetKey === 'opp.unitPriceBasis' ? (
                            <span className="opp-excel-raw-preview-th-badge">다이렉트·유통</span>
                          ) : null}
                          {col.targetKey === 'opp.channelDistributor' ? (
                            <span className="opp-excel-raw-preview-th-badge">유통사</span>
                          ) : null}
                          {col.targetKey === 'opp.assignedToName' ? (
                            <span className="opp-excel-raw-preview-th-badge">사내 담당</span>
                          ) : null}
                          {col.targetKey === 'opp.currency' ? (
                            <span className="opp-excel-raw-preview-th-badge">통화</span>
                          ) : null}
                          {financeFieldDefByTargetKey.get(col.targetKey)?.type === 'select' ||
                          financeFieldDefByTargetKey.get(col.targetKey)?.type === 'multiselect' ? (
                            <span className="opp-excel-raw-preview-th-badge">선택목록</span>
                          ) : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row, idx) => (
                      <tr key={idx}>
                        <td className="opp-excel-raw-preview-td-num">{idx + 1}</td>
                        {displayColumns.map((col, colIdx) => {
                          const cellRaw = previewCellRaw(row, col);
                          const cellClass = [
                            'opp-excel-grid-cell',
                            col.isConstant ? 'is-locked' : '',
                            isCellSelected(idx, colIdx) ? 'is-selected' : '',
                            isCellActive(idx, colIdx) ? 'is-active' : ''
                          ]
                            .filter(Boolean)
                            .join(' ');
                          return (
                            <td
                              key={col.targetKey}
                              className={cellClass}
                              data-grid-row={idx}
                              data-grid-col={colIdx}
                            >
                              {renderDataCell(row, idx, col, cellRaw)}
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
            title={!canProceed ? '붉은 칸·경고를 모두 해소한 뒤 등록할 수 있습니다' : undefined}
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

      {assigneePickerRow != null && assigneeColumnKey && typeof document !== 'undefined'
        ? createPortal(
            <div className="opp-excel-raw-participant-portal">
              <ParticipantModal
                teamMembers={teamMembersForPicker}
                selected={pickerSelected}
                currentUser={currentUser}
                title="사내 담당자 선택"
                bulkAddLabel="표시된 인원을 담당자로 지정"
                onConfirm={(participants) => {
                  const p = Array.isArray(participants) ? participants[0] : null;
                  if (p?.userId) {
                    onAssigneePicked?.(assigneePickerRow, assigneeColumnKey, {
                      userId: String(p.userId),
                      name: String(p.name || '').trim()
                    });
                  }
                  setAssigneePickerRow(null);
                }}
                onClose={() => setAssigneePickerRow(null)}
              />
            </div>,
            document.body
          )
        : null}

      {companyPickerRow != null && companyColumnKey && typeof document !== 'undefined'
        ? createPortal(
            <CustomerCompanySearchModal
              onClose={() => setCompanyPickerRow(null)}
              onSelect={(company) => {
                const id = String(company?._id ?? company?.id ?? '').trim();
                const name = String(company?.name ?? '').trim();
                if (id && name) {
                  onCompanyPicked?.(companyPickerRow, companyColumnKey, { companyId: id, companyName: name, company });
                }
                setCompanyPickerRow(null);
              }}
            />,
            document.body
          )
        : null}
    </div>
  );
}
