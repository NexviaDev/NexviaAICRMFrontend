/**
 * 제품 목록(product-list.js)에서 URL ?modal=excel-import 로 열립니다.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';
import ProductImportMappingModal from './product-import-mapping-modal';
import ProductImportResultModal from './product-import-result-modal';
import ProductExcelRawPreviewModal from './product-excel-raw-preview-modal';
import {
  buildExcelSourceOptions,
  previewExcelMappedValue
} from '../../customer-companies/customer-companies-excel-import-modal/excel-import-mapping-utils';
import {
  buildProductTargetOptions,
  countInvalidProductExcelDraftCells,
  createInitialProductMappingRows,
  excelRowToProductBody,
  isExcelRowEffectivelyEmpty,
  MAX_PRODUCT_EXCEL_ROWS,
  mergeCustomFieldMappingRows,
  normalizeExcelRowsBillingForPreview,
  parseExcelFileToRows,
  productMappingCanProceed,
  productRowStatus,
  resolveProductExcelColumnKey
} from './product-excel-import-utils';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function newRowId() {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function ProductExcelImportModal({
  open,
  onClose,
  onImported,
  initialExcelRows = null,
  initialFileName = ''
}) {
  const fileInputRef = useRef(null);
  const [customDefs, setCustomDefs] = useState([]);
  const [rows, setRows] = useState(() => createInitialProductMappingRows([], []));
  const [excelRows, setExcelRows] = useState([]);
  const [excelFileName, setExcelFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  /** mapping → excel-raw(편집·등록) → (result) */
  const [step, setStep] = useState('mapping');
  const [excelRowsDraft, setExcelRowsDraft] = useState([]);
  const [importResult, setImportResult] = useState(null);
  const appliedInitialRef = useRef(false);

  useEffect(() => {
    if (!open) {
      appliedInitialRef.current = false;
      setStep('mapping');
      setExcelRowsDraft([]);
      setImportResult(null);
      setSaveMsg(null);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/custom-field-definitions?entityType=product`, { headers: getAuthHeader() })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setCustomDefs(Array.isArray(data?.items) ? data.items : []);
      })
      .catch(() => { if (!cancelled) setCustomDefs([]); });
    return () => { cancelled = true; };
  }, [open]);

  const targetOptions = useMemo(() => buildProductTargetOptions(customDefs), [customDefs]);

  const excelHeaders = useMemo(() => {
    if (!excelRows.length) return [];
    const keys = Object.keys(excelRows[0] || {});
    return keys.filter((k) => k !== '__rowNum__');
  }, [excelRows]);

  const sourceOptions = useMemo(() => buildExcelSourceOptions(excelHeaders), [excelHeaders]);

  const sampleRow = useMemo(() => {
    for (const r of excelRows) {
      if (r && typeof r === 'object' && Object.values(r).some((v) => v != null && String(v).trim() !== '')) {
        return r;
      }
    }
    return excelRows[0] || {};
  }, [excelRows]);

  const ingestRows = useCallback(
    (json, fileName) => {
      const list = Array.isArray(json) ? json : [];
      const trimmed = list.slice(0, MAX_PRODUCT_EXCEL_ROWS);
      setExcelRows(trimmed);
      setExcelFileName(fileName || '');
      const headers = trimmed.length ? Object.keys(trimmed[0] || {}).filter((k) => k !== '__rowNum__') : [];
      setRows(createInitialProductMappingRows(headers, customDefs));
      if (list.length > MAX_PRODUCT_EXCEL_ROWS) {
        setSaveMsg(`행이 많아 앞 ${MAX_PRODUCT_EXCEL_ROWS}행만 불러왔습니다.`);
      } else {
        setSaveMsg(null);
      }
    },
    [customDefs]
  );

  const ingestFile = useCallback(
    async (file) => {
      if (!file) return;
      const name = file.name || '';
      const ok =
        name.endsWith('.xlsx') ||
        name.endsWith('.xls') ||
        name.endsWith('.csv') ||
        /spreadsheet|excel|csv/i.test(file.type || '');
      if (!ok) {
        setSaveMsg('엑셀(.xlsx, .xls) 또는 CSV 파일만 올려 주세요.');
        return;
      }
      try {
        const json = await parseExcelFileToRows(file);
        ingestRows(json, name);
      } catch (e) {
        setSaveMsg(e?.message || '파일을 읽지 못했습니다.');
      }
    },
    [ingestRows]
  );

  /** URL로 열 때 부모가 넘긴 초기 행 (add-product-modal에서 다량 드롭) */
  useEffect(() => {
    if (!open || !initialExcelRows?.length || appliedInitialRef.current) return;
    appliedInitialRef.current = true;
    ingestRows(initialExcelRows, initialFileName || '');
  }, [open, initialExcelRows, initialFileName, ingestRows]);

  /** 파일 없이 모달만 연 경우에도 매핑 행·대상 필드가 보이도록, 커스텀 정의 로드 시 행 갱신 */
  useEffect(() => {
    if (!open || excelRows.length) return;
    setRows(createInitialProductMappingRows([], customDefs));
  }, [open, customDefs, excelRows.length]);

  /** 커스텀 필드 정의가 파일 이후에 도착한 경우 매핑 행만 보강(기존 행 유지) */
  useEffect(() => {
    if (!open || !excelRows.length || !customDefs.length) return;
    const headers = Object.keys(excelRows[0] || {}).filter((k) => k !== '__rowNum__');
    setRows((prev) => mergeCustomFieldMappingRows(prev, headers, customDefs));
  }, [customDefs, open, excelRows]);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) void ingestFile(f);
    },
    [ingestFile]
  );

  const updateRow = useCallback((id, patch) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const removeRow = useCallback((id) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const addConstantRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      { id: newRowId(), sourceType: 'constant', sourceKey: '', constantValue: '', targetKey: '' }
    ]);
  }, []);

  const summary = useMemo(() => {
    let err = 0;
    rows.forEach((row) => {
      const prev = previewExcelMappedValue(sampleRow, row);
      const st = productRowStatus(row, prev);
      if (st.type === 'err') err += 1;
    });
    return { mapped: rows.filter((r) => r.targetKey).length, err };
  }, [rows, sampleRow]);

  const mappingReady = productMappingCanProceed(rows, excelRows);

  const openRawPreview = useCallback(() => {
    if (!productMappingCanProceed(rows, excelRows)) {
      setSaveMsg('제품명 매핑을 완료하고 엑셀 파일을 업로드해 주세요.');
      return;
    }
    setExcelRowsDraft(normalizeExcelRowsBillingForPreview(excelRows, rows));
    setStep('excel-raw');
    setSaveMsg(null);
  }, [rows, excelRows]);

  const onRawCellChange = useCallback((rowIndex, header, value) => {
    setExcelRowsDraft((prev) =>
      prev.map((r, i) => (i === rowIndex ? { ...r, [header]: value } : r))
    );
  }, []);

  const runImport = useCallback(
    async (sourceRows) => {
      const rowsToImport = Array.isArray(sourceRows) && sourceRows.length ? sourceRows : excelRows;
      if (!rowsToImport.length) {
        setSaveMsg('엑셀 파일을 먼저 올려 주세요.');
        return;
      }

      setSaving(true);
      setSaveMsg(null);
      let ok = 0;
      let skipped = 0;
      let failed = 0;
      const successSamples = [];
      const failedItems = [];
      try {
        await pingBackendHealth(getAuthHeader);
        let i = 0;
        for (let rowIndex = 0; rowIndex < rowsToImport.length; rowIndex += 1) {
          const excelRow = rowsToImport[rowIndex];
          if (isExcelRowEffectivelyEmpty(excelRow)) {
            skipped += 1;
            continue;
          }
          const body = excelRowToProductBody(excelRow, rows);
          const name = String(body.name || '').trim();
          if (!name) {
            skipped += 1;
            continue;
          }
          if (i > 0 && i % 20 === 0) {
            await pingBackendHealth(getAuthHeader);
          }
          const res = await fetch(`${API_BASE}/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
            body: JSON.stringify({
              ...body,
              createSource: 'excel-import',
              skipCatalogRenewalCalendar: true
            })
          });
          if (res.ok) {
            ok += 1;
            if (successSamples.length < 10) {
              successSamples.push({ rowIndex, name });
            }
          } else {
            failed += 1;
            const errData = await res.json().catch(() => ({}));
            failedItems.push({
              rowIndex,
              name,
              error: errData.error || `HTTP ${res.status}`
            });
          }
          i += 1;
        }
        if (ok > 0) {
          try {
            window.dispatchEvent(new CustomEvent('nexvia-product-excel-import-completed'));
          } catch {
            /* ignore */
          }
          onImported?.();
        }
        setImportResult({
          totalRows: rowsToImport.length,
          success: ok,
          skipped,
          failed,
          fileName: excelFileName,
          successSamples,
          failedItems
        });
      } catch (e) {
        setSaveMsg(e?.message || '등록 중 오류가 났습니다.');
      } finally {
        setSaving(false);
      }
    },
    [excelRows, rows, excelFileName, onImported]
  );

  const registerFromExcelRawPreview = useCallback(() => {
    const sourceRows = excelRowsDraft.length ? excelRowsDraft : excelRows;
    const nameColumnKey = resolveProductExcelColumnKey(rows, 'product.name');
    const billingColumnKey = resolveProductExcelColumnKey(rows, 'product.billingType');
    const billingIntervalColumnKey = resolveProductExcelColumnKey(rows, 'product.billingInterval');
    const statusColumnKey = resolveProductExcelColumnKey(rows, 'product.status');
    const currencyColumnKey = resolveProductExcelColumnKey(rows, 'product.currency');
    const invalid = countInvalidProductExcelDraftCells(sourceRows, {
      nameColumnKey,
      billingColumnKey,
      billingIntervalColumnKey,
      statusColumnKey,
      currencyColumnKey
    });
    if (invalid.total > 0) {
      const parts = [];
      if (invalid.nameMissing) parts.push(`제품명 ${invalid.nameMissing}건`);
      if (invalid.billing) parts.push(`결제주기 ${invalid.billing}건`);
      if (invalid.billingInterval) parts.push(`결제기간 ${invalid.billingInterval}건`);
      if (invalid.status) parts.push(`상태 ${invalid.status}건`);
      if (invalid.currency) parts.push(`통화 ${invalid.currency}건`);
      setSaveMsg(`수정이 필요합니다: ${parts.join(', ')}. 붉은 칸을 확인해 주세요.`);
      return;
    }
    setSaveMsg(null);
    void runImport(sourceRows);
  }, [excelRowsDraft, excelRows, rows, runImport]);

  const handleConfirmResult = useCallback(() => {
    setImportResult(null);
    onClose?.();
  }, [onClose]);

  if (!open) return null;

  if (importResult) {
    return (
      <ProductImportResultModal
        result={importResult}
        onConfirm={handleConfirmResult}
      />
    );
  }

  if (step === 'excel-raw') {
    return (
      <ProductExcelRawPreviewModal
        open
        rows={excelRowsDraft}
        mappingRows={rows}
        targetOptions={targetOptions}
        excelFileName={excelFileName}
        rowCount={excelRowsDraft.length}
        saving={saving}
        onClose={() => !saving && setStep('mapping')}
        onProceed={registerFromExcelRawPreview}
        onCellChange={(rowIndex, header, value) => {
          setSaveMsg(null);
          onRawCellChange(rowIndex, header, value);
        }}
        saveMsg={saveMsg}
      />
    );
  }

  return (
    <ProductImportMappingModal
      onClose={onClose}
      saving={saving}
      onProceed={openRawPreview}
      mappingReady={mappingReady}
      excelRows={excelRows}
      fileInputRef={fileInputRef}
      ingestFile={ingestFile}
      dragOver={dragOver}
      setDragOver={setDragOver}
      onDrop={onDrop}
      excelFileName={excelFileName}
      targetOptions={targetOptions}
      sourceOptions={sourceOptions}
      rows={rows}
      sampleRow={sampleRow}
      updateRow={updateRow}
      removeRow={removeRow}
      addConstantRow={addConstantRow}
      summary={summary}
      saveMsg={saveMsg}
    />
  );
}
