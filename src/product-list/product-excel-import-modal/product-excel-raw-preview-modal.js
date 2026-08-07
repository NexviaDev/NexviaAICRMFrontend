import { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import { useExcelGridClipboard } from '@/lib/use-excel-grid-clipboard';
import { normalizeGridSelection } from '@/lib/excel-grid-clipboard-utils';
import {
  readExcelMappedCell,
  resolveExcelRowHeaderKey
} from '../../customer-companies/customer-companies-excel-import-modal/excel-import-mapping-utils';
import { parseBillingIntervalInput } from '@/lib/product-billing-utils';
import {
  buildProductExcelPreviewColumns,
  buildBillingPeriodPreviewOptions,
  buildProductFormulaCatalogGroups,
  buildProductFormulaPickerOptions,
  collectProductExcelDraftHeaders,
  countInvalidProductExcelDraftCells,
  formatBillingPreviewCellValue,
  formatFormulaCapableExcelInputDisplay,
  resolveExcelCellResolvedPreview,
  isExcelFormulaInput,
  isProductPreviewCellKey,
  parseProductBillingValue,
  billingIntervalCellIsValid,
  billingPeriodCellIsValid,
  normalizeStatus,
  resolveCurrencyCode,
  sanitizeFormulaCapableExcelInput,
  PRODUCT_BILLING_PREVIEW_OPTIONS,
  isProductFormulaCapableTarget,
  PRODUCT_STATUS_PREVIEW_OPTIONS,
  readProductExcelPreviewCellRaw,
  resolveProductExcelColumnKey,
  resolveProductExcelRow,
  replaceAllInExcelDraftRows,
  listCheckedUnmappedExcelColumns
} from './product-excel-import-utils';
import '../../sales-pipeline/opportunity-modal/opportunity-modal.css';
import '../../shared/excel-import-mapping-modal.css';
import '../../shared/custom-fields-manage-modal/custom-fields-manage-modal.css';
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

function CurrencyExcelCell({ raw, saving, onPick, currencyPreviewOptions, allowedCodes }) {
  const cellRaw = raw == null ? '' : String(raw);
  const resolved = resolveCurrencyCode(cellRaw, allowedCodes ? { allowedCodes } : {});
  const valid = resolved.empty || resolved.recognized;
  const options = currencyPreviewOptions?.length ? currencyPreviewOptions : [{ value: 'KRW', label: '₩(원화-한국)' }];

  return (
    <select
      className={`opp-excel-raw-cell-select opp-excel-raw-cell-select--currency ${!valid ? 'is-invalid' : ''}`}
      value={valid && !resolved.empty ? resolved.code : ''}
      onChange={(e) => {
        const v = e.target.value;
        if (v) onPick(v);
      }}
      disabled={saving}
      aria-invalid={!valid}
      title={!valid && cellRaw ? `「${cellRaw}」은 지원 통화 목록에서 선택해 주세요.` : undefined}
    >
      {!valid && cellRaw ? (
        <option value="" disabled>
          {cellRaw} (목록에 없음)
        </option>
      ) : (
        <option value="">(기본: ₩ 원화)</option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function FormulaCapablePriceExcelCell({ raw, saving, preview, onChange }) {
  const display = formatFormulaCapableExcelInputDisplay(raw);
  const isFormula = isExcelFormulaInput(String(raw ?? ''));

  return (
    <div className="opp-excel-raw-formula-cell">
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={`opp-excel-raw-cell-input opp-excel-raw-cell-input--price${isFormula ? ' is-formula' : ''}`}
        value={display}
        onChange={(e) => onChange(sanitizeFormulaCapableExcelInput(e.target.value))}
        disabled={saving}
        placeholder="0 · 10% 또는 =[소비자가]-[원가]"
        title={
          isFormula
            ? '수식 — 「필드·함수」에서 복사 후 붙여넣기'
            : '숫자 · 확률(10% → 10/100) 또는 = 수식 입력'
        }
      />
      {preview != null ? (
        <span
          className="opp-excel-raw-formula-preview"
          title={isFormula ? '수식 결과 미리보기' : '인식된 숫자 값 (등록·함수 계산 기준)'}
        >
          {preview}
        </span>
      ) : null}
    </div>
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
  onRowsReplaceAll,
  onUndoDraft,
  onBeforeBulkMutation,
  saveMsg,
  currencyPreviewOptions = [],
  currencyAllowedCodes = null,
  customDefinitions = [],
  formulaExchangeCtx = null
}) {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [replaceMsg, setReplaceMsg] = useState(null);
  const [formulaCopyMsg, setFormulaCopyMsg] = useState(null);
  /** excelKey → 등록 포함 여부 (기본 전부 true) */
  const [includedByExcelKey, setIncludedByExcelKey] = useState({});
  /** 필드·함수 플로팅 팔레트 (상시 패널 대신) */
  const [formulaPaletteOpen, setFormulaPaletteOpen] = useState(false);
  const [formulaPalettePos, setFormulaPalettePos] = useState(null);
  const formulaPaletteDragRef = useRef(null);

  const formulaFieldOptions = useMemo(
    () => buildProductFormulaPickerOptions(customDefinitions, formulaExchangeCtx?.pricingProfile),
    [customDefinitions, formulaExchangeCtx?.pricingProfile]
  );
  const formulaCatalogGroups = useMemo(() => buildProductFormulaCatalogGroups(), []);

  const saveMsgIsError =
    saveMsg && (saveMsg.includes('실패') || saveMsg.includes('필요') || saveMsg.includes('없습니다') || saveMsg.includes('수정') || saveMsg.includes('매핑'));

  const displayRows = useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    return list.length > DISPLAY_MAX_ROWS ? list.slice(0, DISPLAY_MAX_ROWS) : list;
  }, [rows]);

  const excelHeaders = useMemo(() => collectProductExcelDraftHeaders(rows), [rows]);

  const allPreviewColumns = useMemo(
    () => buildProductExcelPreviewColumns(mappingRows, targetOptions, excelHeaders, customDefinitions),
    [mappingRows, targetOptions, excelHeaders, customDefinitions]
  );

  useEffect(() => {
    setIncludedByExcelKey((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const col of allPreviewColumns) {
        if (!col?.includeToggleable || !col.excelKey) continue;
        if (!Object.prototype.hasOwnProperty.call(next, col.excelKey)) {
          next[col.excelKey] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allPreviewColumns]);

  const displayColumns = useMemo(
    () =>
      allPreviewColumns.filter((col) => {
        if (!col) return false;
        if (!col.includeToggleable) return true;
        return includedByExcelKey[col.excelKey] !== false;
      }),
    [allPreviewColumns, includedByExcelKey]
  );

  const hiddenColumns = useMemo(
    () =>
      allPreviewColumns.filter(
        (col) => col?.includeToggleable && includedByExcelKey[col.excelKey] === false
      ),
    [allPreviewColumns, includedByExcelKey]
  );

  const toggleColumnIncluded = useCallback((excelKey, nextValue) => {
    if (!excelKey) return;
    setIncludedByExcelKey((prev) => ({ ...prev, [excelKey]: nextValue }));
  }, []);

  const includedExcelKeySet = useMemo(() => {
    const set = new Set();
    for (const col of allPreviewColumns) {
      if (!col?.excelKey) continue;
      if (!col.includeToggleable) {
        set.add(col.excelKey);
        continue;
      }
      if (includedByExcelKey[col.excelKey] !== false) set.add(col.excelKey);
    }
    return set;
  }, [allPreviewColumns, includedByExcelKey]);


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

  const isFormulaCapableColumn = useCallback(
    (col) => {
      // 미매핑이라도 =수식·금액이면 결과 미리보기 필요 (Civil 3D 등은 looksLikePriceOrNumericInput으로 보호)
      if (col?.isUnmapped) return true;
      if (!col?.targetKey) return false;
      return isProductFormulaCapableTarget(col.targetKey, customDefinitions);
    },
    [customDefinitions]
  );

  const isFormulaCapableExcelKey = useCallback(
    (excelKey) => {
      const col = displayColumns.find((c) => c.excelKey === excelKey);
      return col ? isFormulaCapableColumn(col) : false;
    },
    [displayColumns, isFormulaCapableColumn]
  );

  const rowResolved = useMemo(
    () =>
      displayRows.map((row) =>
        resolveProductExcelRow(row, mappingRows, formulaExchangeCtx, customDefinitions, {
          allowedCodes: currencyAllowedCodes,
          excelHeaderCols: rows?.__excelHeaderCols
        })
      ),
    [displayRows, mappingRows, formulaExchangeCtx, customDefinitions, currencyAllowedCodes, rows]
  );

  const copyFormulaTokenToClipboard = useCallback(async (text, label) => {
    const token = String(text ?? '').trim();
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setFormulaCopyMsg(`복사됨: ${label || token}`);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = token;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setFormulaCopyMsg(`복사됨: ${label || token}`);
      } catch {
        setFormulaCopyMsg('복사에 실패했습니다. 브라우저 권한을 확인해 주세요.');
      }
    }
  }, []);

  const handleCopyFormulaFieldLabel = useCallback(
    (label) => {
      const lb = String(label || '').trim();
      if (!lb) return;
      void copyFormulaTokenToClipboard(`[${lb}]`, `[${lb}]`);
    },
    [copyFormulaTokenToClipboard]
  );

  const handleCopyFormulaFunctionName = useCallback(
    (fnName) => {
      const name = String(fnName || '').trim().toLowerCase();
      if (!name) return;
      const token = name === 'pi' ? 'pi' : `${name}(`;
      void copyFormulaTokenToClipboard(token, token);
    },
    [copyFormulaTokenToClipboard]
  );

  useEffect(() => {
    if (!formulaCopyMsg) return undefined;
    const t = window.setTimeout(() => setFormulaCopyMsg(null), 2200);
    return () => window.clearTimeout(t);
  }, [formulaCopyMsg]);

  /** Ctrl+Z — 모두 바꾸기·붙여넣기 직전 스냅샷 되돌리기 */
  useEffect(() => {
    const onKeyDown = (e) => {
      if (saving) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.shiftKey) return;
      if (e.key !== 'z' && e.key !== 'Z') return;
      if (typeof onUndoDraft !== 'function') return;
      if (!onUndoDraft()) return;
      e.preventDefault();
      e.stopPropagation();
      setReplaceMsg('바로 전 바꾸기·붙여넣기를 되돌렸습니다. (Ctrl+Z)');
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [saving, onUndoDraft]);

  const invalidCounts = useMemo(
    () =>
      countInvalidProductExcelDraftCells(rows, {
        nameColumnKey,
        billingColumnKey,
        billingIntervalColumnKey,
        statusColumnKey,
        currencyColumnKey,
        allowedCodes: currencyAllowedCodes
      }),
    [
      rows,
      nameColumnKey,
      billingColumnKey,
      billingIntervalColumnKey,
      statusColumnKey,
      currencyColumnKey,
      currencyAllowedCodes
    ]
  );

  const handleCell = useCallback(
    (rowIndex, sourceKey, value) => {
      const row = displayRows[rowIndex];
      const actualKey = isProductPreviewCellKey(sourceKey)
        ? sourceKey
        : resolveExcelRowHeaderKey(row, sourceKey);
      onCellChange?.(rowIndex, actualKey, value);
    },
    [displayRows, onCellChange]
  );

  const previewCellRaw = useCallback(
    (row, col) => {
      if (col?.isConstant) return col.constantValue ?? '';
      if (col?.isUnmapped || !col?.targetKey) {
        return readExcelMappedCell(row, col?.excelKey) ?? '';
      }
      return readProductExcelPreviewCellRaw(
        row,
        mappingRows,
        col?.targetKey,
        customDefinitions,
        excelHeaders
      );
    },
    [mappingRows, customDefinitions, excelHeaders]
  );

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
      if (!col) return;
      handleCell(rowIndex, col.excelKey, value);
    },
    [displayColumns, handleCell]
  );

  const isGridCellEditable = useCallback(
    (rowIndex, colIndex) => Boolean(displayColumns[colIndex]),
    [displayColumns]
  );

  const sanitizeGridPaste = useCallback(
    (rowIndex, colIndex, raw) => {
      const col = displayColumns[colIndex];
      if (!col) return String(raw ?? '').trim();
      if (isProductFormulaCapableTarget(col.targetKey, customDefinitions)) {
        return sanitizeFormulaCapableExcelInput(raw);
      }
      return String(raw ?? '').trim();
    },
    [displayColumns, customDefinitions]
  );

  const {
    gridRootRef,
    selection,
    isCellSelected,
    isCellActive,
    isAltDragging,
    selectEntireRow,
    selectEntireColumn,
    selectAllCells
  } = useExcelGridClipboard({
    rowCount: displayRows.length,
    colCount: displayColumns.length,
    disabled: saving,
    getCellValue: getGridCellValue,
    setCellValue: setGridCellValue,
    isCellEditable: isGridCellEditable,
    sanitizePasteValue: sanitizeGridPaste,
    onBeforeBulkMutation
  });

  const selectionBox = useMemo(
    () => normalizeGridSelection(selection?.start, selection?.end),
    [selection]
  );

  const isEntireRowSelected = useCallback(
    (rowIndex) => {
      const box = selectionBox;
      if (!box || displayColumns.length < 1) return false;
      return (
        box.startRow === rowIndex &&
        box.endRow === rowIndex &&
        box.startCol === 0 &&
        box.endCol === displayColumns.length - 1
      );
    },
    [selectionBox, displayColumns.length]
  );

  const isEntireColumnSelected = useCallback(
    (colIndex) => {
      const box = selectionBox;
      if (!box || displayRows.length < 1) return false;
      return (
        box.startCol === colIndex &&
        box.endCol === colIndex &&
        box.startRow === 0 &&
        box.endRow === displayRows.length - 1
      );
    },
    [selectionBox, displayRows.length]
  );

  const isAllSelected = Boolean(
    selectionBox &&
      displayRows.length > 0 &&
      displayColumns.length > 0 &&
      selectionBox.startRow === 0 &&
      selectionBox.endRow === displayRows.length - 1 &&
      selectionBox.startCol === 0 &&
      selectionBox.endCol === displayColumns.length - 1
  );

  const handleReplaceAll = useCallback(() => {
    const find = String(findText ?? '');
    if (!find.trim()) {
      setReplaceMsg('찾을 내용을 입력해 주세요.');
      return;
    }
    if (typeof onRowsReplaceAll !== 'function') {
      setReplaceMsg('모두 바꾸기를 사용할 수 없습니다.');
      return;
    }

    let allowedCellKeys = null;
    if (selectionBox) {
      allowedCellKeys = new Set();
      for (let r = selectionBox.startRow; r <= selectionBox.endRow; r += 1) {
        const row = displayRows[r];
        if (!row) continue;
        for (let c = selectionBox.startCol; c <= selectionBox.endCol; c += 1) {
          const col = displayColumns[c];
          if (!col) continue;
          const header = isProductPreviewCellKey(col.excelKey)
            ? col.excelKey
            : resolveExcelRowHeaderKey(row, col.excelKey) || col.excelKey;
          if (!header || String(header).startsWith('__')) continue;
          allowedCellKeys.add(`${r}\u0000${header}`);
        }
      }
      if (!allowedCellKeys.size) {
        setReplaceMsg('선택한 셀이 없습니다. Alt+드래그로 범위를 지정하거나 선택을 해제해 전체에서 바꾸세요.');
        return;
      }
    }

    const { rows: next, changedCells, changedRows, scoped } = replaceAllInExcelDraftRows(
      rows,
      find,
      replaceText,
      { allowedCellKeys }
    );
    if (Array.isArray(rows?.__excelHeaderCols)) next.__excelHeaderCols = rows.__excelHeaderCols;
    onRowsReplaceAll(next);
    const scopeLabel = scoped ? '선택 범위' : '전체';
    setReplaceMsg(
      changedCells > 0
        ? `${scopeLabel}: ${changedRows}행 · ${changedCells}칸에서 바꿨습니다.`
        : `${scopeLabel}에서 일치하는 내용이 없습니다.`
    );
  }, [
    findText,
    replaceText,
    rows,
    onRowsReplaceAll,
    selectionBox,
    displayRows,
    displayColumns
  ]);

  const handleProceed = useCallback(() => {
    onProceed?.({
      ok: true,
      includedExcelKeys: includedExcelKeySet,
      autoCreateUnmapped: listCheckedUnmappedExcelColumns(allPreviewColumns, includedExcelKeySet)
    });
  }, [allPreviewColumns, includedExcelKeySet, onProceed]);

  const startFormulaPaletteDrag = useCallback(
    (e) => {
      if (e.button !== 0) return;
      if (e.target?.closest?.('button')) return;
      e.preventDefault();
      const panel = e.currentTarget?.closest?.('.pl-excel-formula-float');
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const startLeft = formulaPalettePos?.x ?? rect.left;
      const startTop = formulaPalettePos?.y ?? rect.top;
      formulaPaletteDragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startLeft,
        startTop,
        width: rect.width,
        height: rect.height
      };
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [formulaPalettePos]
  );

  const moveFormulaPaletteDrag = useCallback((e) => {
    const drag = formulaPaletteDragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - drag.width - margin);
    const maxY = Math.max(margin, window.innerHeight - drag.height - margin);
    const nextX = Math.min(maxX, Math.max(margin, drag.startLeft + dx));
    const nextY = Math.min(maxY, Math.max(margin, drag.startTop + dy));
    setFormulaPalettePos({ x: nextX, y: nextY });
  }, []);

  const endFormulaPaletteDrag = useCallback((e) => {
    if (!formulaPaletteDragRef.current) return;
    formulaPaletteDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!formulaPaletteOpen) return undefined;
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        setFormulaPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [formulaPaletteOpen]);

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
              엑셀 <strong>모든 열</strong>을 가져옵니다. 헤더 체크를 해제하면 열을 숨기고 등록에서 제외합니다 · 체크된
              미매핑 열은 <strong>추가 필드로 자동 생성</strong>됩니다 · 수식은 <strong>같은 행→[필드라벨]</strong> 자동
              환산 · <strong>Alt+드래그</strong> 선택 후 모두 바꾸기 · 바꾸기/붙여넣기 후 <strong>Ctrl+Z</strong> 되돌리기
            </span>
          </div>

          <div className="opp-excel-raw-preview-replace-bar" role="search" aria-label="찾기 및 모두 바꾸기">
            <label className="opp-excel-raw-preview-replace-field">
              <span>찾을 내용</span>
              <input
                type="text"
                className="opp-input"
                value={findText}
                onChange={(e) => {
                  setFindText(e.target.value);
                  setReplaceMsg(null);
                }}
                disabled={saving}
                placeholder="예: $I$1 또는 1450"
                autoComplete="off"
              />
            </label>
            <label className="opp-excel-raw-preview-replace-field">
              <span>바꿀 내용</span>
              <input
                type="text"
                className="opp-input"
                value={replaceText}
                onChange={(e) => {
                  setReplaceText(e.target.value);
                  setReplaceMsg(null);
                }}
                disabled={saving}
                placeholder="예: [USD_KRW] 또는 1380"
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleReplaceAll();
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="opp-excel-footer-btn opp-excel-footer-btn--ghost"
              disabled={saving || !String(findText || '').trim()}
              onClick={handleReplaceAll}
              title={
                selectionBox
                  ? 'Alt+드래그로 선택한 셀에서만 바꿉니다. Esc로 선택 해제 시 전체에서 바꿉니다.'
                  : '선택 없음 — 표시된 모든 셀에서 바꿉니다. Alt+드래그로 범위를 지정하면 선택 칸만 바꿉니다.'
              }
            >
              {selectionBox ? '선택 범위에서 바꾸기' : '모두 바꾸기'}
            </button>
            <button
              type="button"
              className={`opp-excel-footer-btn opp-excel-footer-btn--ghost${formulaPaletteOpen ? ' is-active' : ''}`}
              disabled={saving}
              onClick={() => setFormulaPaletteOpen((v) => !v)}
              title="금액·수식 셀에 필드·함수 삽입 (떠 있는 창 · 뒤 표 작업 가능)"
              aria-pressed={formulaPaletteOpen}
            >
              <span className="material-symbols-outlined" aria-hidden>
                functions
              </span>
              필드·함수
            </button>
            {selectionBox ? (
              <span className="excel-import-map-badge excel-import-map-badge--tag" title="Esc로 선택 해제">
                선택 {(selectionBox.endRow - selectionBox.startRow + 1) *
                  (selectionBox.endCol - selectionBox.startCol + 1)}
                칸
              </span>
            ) : null}
            {replaceMsg ? (
              <span className="opp-excel-raw-preview-replace-msg" role="status">
                {replaceMsg}
              </span>
            ) : null}
          </div>

          {hiddenColumns.length > 0 ? (
            <div className="opp-excel-raw-preview-hidden-cols" aria-label="숨긴 열">
              <span className="opp-excel-raw-preview-hidden-cols-label">숨긴 열</span>
              {hiddenColumns.map((col) => (
                <button
                  key={`hidden-${col.excelKey}`}
                  type="button"
                  className="opp-excel-raw-preview-hidden-chip"
                  disabled={saving}
                  title="다시 표시·등록에 포함"
                  onClick={() => toggleColumnIncluded(col.excelKey, true)}
                >
                  {col.excelTitle || col.label || col.excelKey}
                  <span className="material-symbols-outlined" aria-hidden>
                    add
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {!nameColumnKey ? (
            <p className="opp-excel-raw-preview-warn">
              참고: 매핑에서 제품명이 <strong>고정값</strong>이면 모든 행에 동일한 제품명이 적용됩니다.
            </p>
          ) : null}

          <div className="opp-excel-raw-preview-body-layout">
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
                  표시할 열이 없습니다. 숨긴 열 칩에서 다시 포함하거나, 매핑·엑셀 파일을 확인해 주세요.
                </p>
              ) : (
                <table className="opp-excel-raw-preview-table">
                  <thead>
                    <tr>
                      <th
                        className={`opp-excel-raw-preview-th-num${isAllSelected ? ' is-axis-selected' : ''}`}
                        title="전체 선택"
                        onMouseDown={(e) => {
                          if (e.button !== 0 || saving) return;
                          e.preventDefault();
                          selectAllCells();
                        }}
                      >
                        #
                      </th>
                      {displayColumns.map((col, colIdx) => {
                        const h = col.excelKey;
                        return (
                        <th
                          key={h}
                          data-grid-col={colIdx}
                          title={
                            col.isUnmapped
                              ? `미매핑 엑셀 열: ${col.excelTitle} — 체크 해제하거나 매핑하세요 · 클릭 시 열 전체 선택`
                              : `원본 엑셀 열: ${col.excelTitle} · 클릭 시 열 전체 선택`
                          }
                          className={[
                            'opp-excel-raw-preview-th--select-col',
                            h === nameColumnKey ||
                            h === billingColumnKey ||
                            h === billingIntervalColumnKey ||
                            h === statusColumnKey ||
                            h === currencyColumnKey ||
                            isFormulaCapableExcelKey(h)
                              ? 'opp-excel-raw-preview-th--stage'
                              : '',
                            col.isUnmapped ? 'opp-excel-raw-preview-th--unmapped' : '',
                            isEntireColumnSelected(colIdx) ? 'is-axis-selected' : ''
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onMouseDown={(e) => {
                            if (e.button !== 0 || saving) return;
                            if (e.target.closest?.('input[type="checkbox"]')) return;
                            e.preventDefault();
                            selectEntireColumn(colIdx);
                          }}
                        >
                          {col.includeToggleable ? (
                            <span className="opp-excel-raw-preview-th-include">
                              <input
                                type="checkbox"
                                checked={includedByExcelKey[h] !== false}
                                disabled={saving}
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => toggleColumnIncluded(h, e.target.checked)}
                                aria-label={`${col.label} 등록 포함`}
                              />
                              <span>{col.label}</span>
                            </span>
                          ) : (
                            <span>{col.label}</span>
                          )}
                          {col.isUnmapped ? (
                            <span className="opp-excel-raw-preview-th-badge">미매핑</span>
                          ) : null}
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
                          {!col.isUnmapped && isFormulaCapableExcelKey(h) ? (
                            <span className="opp-excel-raw-preview-th-badge">금액·수식</span>
                          ) : null}
                        </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row, idx) => (
                      <tr key={idx}>
                        <td
                          className={`opp-excel-raw-preview-td-num${isEntireRowSelected(idx) ? ' is-axis-selected' : ''}`}
                          title="행 전체 선택"
                          onMouseDown={(e) => {
                            if (e.button !== 0 || saving) return;
                            e.preventDefault();
                            selectEntireRow(idx);
                          }}
                        >
                          {idx + 1}
                        </td>
                        {displayColumns.map((col, colIdx) => {
                          const h = col.excelKey;
                          const cellRaw = previewCellRaw(row, col);
                          const cellClass = [
                            'opp-excel-grid-cell',
                            isCellSelected(idx, colIdx) ? 'is-selected' : '',
                            isCellActive(idx, colIdx) ? 'is-active' : ''
                          ]
                            .filter(Boolean)
                            .join(' ');
                          return (
                          <td
                            key={col.targetKey || h}
                            className={cellClass}
                            data-grid-row={idx}
                            data-grid-col={colIdx}
                          >
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
                                currencyPreviewOptions={currencyPreviewOptions}
                                allowedCodes={currencyAllowedCodes}
                              />
                            ) : isFormulaCapableColumn(col) ? (
                              <FormulaCapablePriceExcelCell
                                raw={cellRaw}
                                saving={saving}
                                preview={resolveExcelCellResolvedPreview(
                                  cellRaw,
                                  col,
                                  rowResolved[idx],
                                  customDefinitions
                                )}
                                onChange={(v) => handleCell(idx, h, v)}
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

          </div>

          {formulaPaletteOpen ? (
            <div
              className="pl-excel-formula-float"
              role="dialog"
              aria-modal="false"
              aria-labelledby="pl-excel-formula-float-title"
              style={
                formulaPalettePos
                  ? { left: formulaPalettePos.x, top: formulaPalettePos.y, right: 'auto' }
                  : undefined
              }
            >
              <div
                className="pl-excel-formula-float-header"
                onPointerDown={startFormulaPaletteDrag}
                onPointerMove={moveFormulaPaletteDrag}
                onPointerUp={endFormulaPaletteDrag}
                onPointerCancel={endFormulaPaletteDrag}
              >
                <div className="pl-excel-formula-float-header-text">
                  <span className="material-symbols-outlined" aria-hidden>
                    drag_indicator
                  </span>
                  <strong id="pl-excel-formula-float-title">필드 · 함수</strong>
                  <span className="pl-excel-formula-float-hint">클릭=복사 · Ctrl+V 붙여넣기</span>
                </div>
                <button
                  type="button"
                  className="pl-excel-formula-float-close"
                  onClick={() => setFormulaPaletteOpen(false)}
                  aria-label="필드·함수 닫기"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              {formulaCopyMsg ? (
                <p className="pl-excel-formula-float-copy-msg" role="status">
                  {formulaCopyMsg}
                </p>
              ) : null}
              <div
                className="custom-fields-manage-formula-fields-panel pl-excel-formula-panel pl-excel-formula-panel--float pl-excel-formula-panel--dense"
                aria-label="수식 필드·함수"
              >
                <div className="custom-fields-manage-formula-panel-col custom-fields-manage-formula-panel-col--fields">
                  <h4 className="custom-fields-manage-formula-fields-title">필드</h4>
                  <div className="custom-fields-manage-formula-panel-scroll">
                    <ul className="custom-fields-manage-formula-fields-list">
                      {formulaFieldOptions.map((opt) => (
                        <li key={opt.key}>
                          <button
                            type="button"
                            className="custom-fields-manage-formula-field-btn"
                            onClick={() => handleCopyFormulaFieldLabel(opt.label)}
                            disabled={saving}
                            title={`[${opt.label}] 복사`}
                          >
                            <span className="custom-fields-manage-formula-field-btn-label">{opt.label}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="custom-fields-manage-formula-panel-col custom-fields-manage-formula-panel-col--fn">
                  <h4 className="custom-fields-manage-formula-fields-title">함수</h4>
                  <div className="custom-fields-manage-formula-panel-scroll">
                    {formulaCatalogGroups.map((group) => (
                      <section key={group.id} className="custom-fields-manage-formula-fn-group">
                        <ul className="custom-fields-manage-formula-fn-list">
                          {group.items.map((fn) => (
                            <li key={fn.name}>
                              <button
                                type="button"
                                className="custom-fields-manage-formula-fn-btn"
                                title={`${fn.name} 복사`}
                                onClick={() => handleCopyFormulaFunctionName(fn.name)}
                                disabled={saving}
                              >
                                <span className="custom-fields-manage-formula-fn-name">{fn.name}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

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
            title={
              !canProceed
                ? '붉은 칸을 모두 수정한 뒤 등록할 수 있습니다'
                : '체크된 미매핑 열은 제품 추가 필드로 자동 생성 후 등록합니다'
            }
            onClick={handleProceed}
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
