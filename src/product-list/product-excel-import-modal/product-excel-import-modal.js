/**
 * 제품 목록(product-list.js)에서 URL ?modal=excel-import 로 열립니다.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession, getAuthHeader } from '@/lib/crm-auth';
import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';
import { useExchangeRates } from '@/lib/use-exchange-rates';
import {
  buildAvailableCurrencyCodesFromDealBasRMap,
  buildEximAvailableCurrencyPreviewOptions
} from '@/lib/exchange-rate-currency-options';
import ProductImportMappingModal from './product-import-mapping-modal';
import ProductImportResultModal from './product-import-result-modal';
import ProductExcelRawPreviewModal from './product-excel-raw-preview-modal';
import { buildExcelSourceOptions } from '../../customer-companies/customer-companies-excel-import-modal/excel-import-mapping-utils';
import {
  buildProductTargetOptions,
  countInvalidProductExcelDraftCells,
  createInitialProductMappingRows,
  excelRowToProductBody,
  isExcelRowEffectivelyEmpty,
  MAX_PRODUCT_EXCEL_ROWS,
  mergeCustomFieldMappingRows,
  normalizeExcelRowsBillingForPreview,
  filterMappingRowsByIncludedExcelKeys,
  planAutoCustomFieldsForUnmappedExcelColumns,
  parseExcelFileToRows,
  previewProductMappedValue,
  productMappingCanProceed,
  productRowStatus,
  resolveProductExcelColumnKey
} from './product-excel-import-utils';

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
  const excelRowsDraftRef = useRef([]);
  const excelDraftUndoRef = useRef([]);
  const MAX_EXCEL_DRAFT_UNDO = 40;
  const [importResult, setImportResult] = useState(null);
  const appliedInitialRef = useRef(false);

  const { dealBasRMap, usdSummary, pricingProfile, rateRows } = useExchangeRates({ getAuthHeader, pollMs: 0 });
  const formulaExchangeCtx = useMemo(
    () => ({ dealBasRMap, usdSummary, pricingProfile, rateRows }),
    [dealBasRMap, usdSummary, pricingProfile, rateRows]
  );
  const currencyAllowedCodes = useMemo(
    () => buildAvailableCurrencyCodesFromDealBasRMap(dealBasRMap),
    [dealBasRMap]
  );
  const currencyPreviewOptions = useMemo(
    () => buildEximAvailableCurrencyPreviewOptions(dealBasRMap),
    [dealBasRMap]
  );

  useEffect(() => {
    if (!open) {
      appliedInitialRef.current = false;
      setStep('mapping');
      setExcelRowsDraft([]);
      excelDraftUndoRef.current = [];
      setImportResult(null);
      setSaveMsg(null);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/custom-field-definitions?entityType=product`, crmFetchInit())
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
    return keys.filter((k) => !String(k).startsWith('__'));
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
      if (Array.isArray(json?.__excelHeaderCols)) {
        trimmed.__excelHeaderCols = json.__excelHeaderCols;
      }
      setExcelRows(trimmed);
      setExcelFileName(fileName || '');
      const headers = trimmed.length
        ? Object.keys(trimmed[0] || {}).filter((k) => !String(k).startsWith('__'))
        : [];
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
    const headers = Object.keys(excelRows[0] || {}).filter((k) => !String(k).startsWith('__'));
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
      const prev = previewProductMappedValue(sampleRow, row);
      const st = productRowStatus(row, prev);
      if (st.type === 'err') err += 1;
    });
    return { mapped: rows.filter((r) => r.targetKey).length, err };
  }, [rows, sampleRow]);

  useEffect(() => {
    excelRowsDraftRef.current = excelRowsDraft;
  }, [excelRowsDraft]);

  const cloneExcelDraftRows = useCallback((source) => {
    const next = Array.isArray(source) ? source.map((r) => ({ ...r })) : [];
    if (Array.isArray(source?.__excelHeaderCols)) next.__excelHeaderCols = source.__excelHeaderCols;
    return next;
  }, []);

  const pushExcelDraftUndo = useCallback(() => {
    const snap = cloneExcelDraftRows(excelRowsDraftRef.current);
    excelDraftUndoRef.current.push(snap);
    while (excelDraftUndoRef.current.length > MAX_EXCEL_DRAFT_UNDO) {
      excelDraftUndoRef.current.shift();
    }
  }, [cloneExcelDraftRows]);

  const undoExcelDraft = useCallback(() => {
    const prev = excelDraftUndoRef.current.pop();
    if (!prev) return false;
    setExcelRowsDraft(prev);
    excelRowsDraftRef.current = prev;
    return true;
  }, []);

  const mappingReady = productMappingCanProceed(rows, excelRows);

  const openRawPreview = useCallback(() => {
    if (!productMappingCanProceed(rows, excelRows)) {
      setSaveMsg('제품명 매핑을 완료하고 엑셀 파일을 업로드해 주세요.');
      return;
    }
    excelDraftUndoRef.current = [];
    setExcelRowsDraft(normalizeExcelRowsBillingForPreview(excelRows, rows, currencyAllowedCodes, customDefs));
    setStep('excel-raw');
    setSaveMsg(null);
  }, [rows, excelRows, currencyAllowedCodes, customDefs]);

  const onRawCellChange = useCallback((rowIndex, header, value) => {
    setExcelRowsDraft((prev) => {
      const next = prev.map((row, i) => (i === rowIndex ? { ...row, [header]: value } : row));
      if (Array.isArray(prev?.__excelHeaderCols)) next.__excelHeaderCols = prev.__excelHeaderCols;
      return next;
    });
  }, []);

  const onRawRowsReplaceAll = useCallback(
    (nextRows) => {
      pushExcelDraftUndo();
      const next = cloneExcelDraftRows(nextRows);
      setExcelRowsDraft(next);
    },
    [pushExcelDraftUndo, cloneExcelDraftRows]
  );

  const runImport = useCallback(
    async (sourceRows, mappingOverride = null, customDefinitionsOverride = null) => {
      const rowsToImport = Array.isArray(sourceRows) && sourceRows.length ? sourceRows : excelRows;
      if (!rowsToImport.length) {
        setSaveMsg('엑셀 파일을 먼저 올려 주세요.');
        return;
      }
      const mappingForImport = Array.isArray(mappingOverride) ? mappingOverride : rows;
      const defsForImport = Array.isArray(customDefinitionsOverride)
        ? customDefinitionsOverride
        : customDefs;

      setSaving(true);
      setSaveMsg(null);
      let ok = 0;
      let skipped = 0;
      let failed = 0;
      const successItems = [];
      const failedItems = [];
      try {
        await pingBackendHealth(getAuthHeader);
        let i = 0;
        /**
         * 목록은 updatedAt 내림차순이므로 마지막 행부터 등록해야
         * 엑셀 1번 행이 /product-list 표 맨 위에 온다.
         */
        for (let rowIndex = rowsToImport.length - 1; rowIndex >= 0; rowIndex -= 1) {
          const excelRow = rowsToImport[rowIndex];
          if (isExcelRowEffectivelyEmpty(excelRow)) {
            skipped += 1;
            continue;
          }
          const body = excelRowToProductBody(excelRow, mappingForImport, {
            allowedCodes: currencyAllowedCodes,
            exchangeCtx: formulaExchangeCtx,
            customDefinitions: defsForImport,
            excelHeaderCols: rowsToImport.__excelHeaderCols
          });
          const name = String(body.name || '').trim();
          if (body.__formulaError) {
            failed += 1;
            failedItems.push({
              rowIndex,
              name: name || `(행 ${rowIndex + 1})`,
              error: body.__formulaError
            });
            i += 1;
            continue;
          }
          if (!name) {
            skipped += 1;
            continue;
          }
          if (i > 0 && i % 20 === 0) {
            await pingBackendHealth(getAuthHeader);
          }
          const res = await fetch(`${API_BASE}/products`, crmFetchInit({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
              ...body,
              createSource: 'excel-import',
              skipCatalogRenewalCalendar: true
             })
          }));
          if (res.ok) {
            ok += 1;
            successItems.push({ rowIndex, name });
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
        const byRowIndex = (a, b) => a.rowIndex - b.rowIndex;
        setImportResult({
          totalRows: rowsToImport.length,
          success: ok,
          skipped,
          failed,
          fileName: excelFileName,
          successSamples: successItems.sort(byRowIndex).slice(0, 10),
          failedItems: failedItems.sort(byRowIndex)
        });
      } catch (e) {
        setSaveMsg(e?.message || '등록 중 오류가 났습니다.');
      } finally {
        setSaving(false);
      }
    },
    [excelRows, rows, excelFileName, onImported, currencyAllowedCodes, formulaExchangeCtx, customDefs]
  );

  const registerFromExcelRawPreview = useCallback(
    async (proceedResult) => {
      if (proceedResult && proceedResult.ok === false) {
        setSaveMsg(proceedResult.message || '등록할 수 없습니다. 매핑·체크를 확인해 주세요.');
        return;
      }

      const includedExcelKeys = proceedResult?.includedExcelKeys;
      let mappingForImport =
        includedExcelKeys != null
          ? filterMappingRowsByIncludedExcelKeys(rows, includedExcelKeys)
          : rows;

      const sourceRows = excelRowsDraft.length ? excelRowsDraft : excelRows;
      const unmapped = Array.isArray(proceedResult?.autoCreateUnmapped)
        ? proceedResult.autoCreateUnmapped
        : [];

      let defsForImport = customDefs;

      if (unmapped.length) {
        setSaving(true);
        setSaveMsg(
          `체크된 미매핑 열 ${unmapped.length}개를 제품 추가 필드로 생성하는 중…`
        );
        try {
          await pingBackendHealth(getAuthHeader);
          const plan = planAutoCustomFieldsForUnmappedExcelColumns(
            unmapped,
            sourceRows,
            customDefs,
            { pricingProfile }
          );
          const createdDefs = [];
          for (let i = 0; i < plan.createPayloads.length; i += 1) {
            const { payload } = plan.createPayloads[i];
            if (i > 0 && i % 15 === 0) await pingBackendHealth(getAuthHeader);
            let res = await fetch(
              `${API_BASE}/custom-field-definitions`,
              crmFetchInit({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              })
            );
            let data = await res.json().catch(() => ({}));
            // 수식 정의 실패 시 number로 재시도 (제품별 수식은 customFieldFormulas로 남는다)
            if (!res.ok && payload.type === 'formula') {
              const { expression, ...restOptions } = payload.options || {};
              const fallback = { ...payload, type: 'number' };
              if (Object.keys(restOptions).length) fallback.options = restOptions;
              else delete fallback.options;
              res = await fetch(
                `${API_BASE}/custom-field-definitions`,
                crmFetchInit({
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(fallback)
                })
              );
              data = await res.json().catch(() => ({}));
            }
            if (!res.ok) {
              setSaving(false);
              setSaveMsg(
                data.error ||
                  `"${payload.label}" 필드 자동 생성에 실패했습니다. 헤더 체크를 해제하거나 매핑해 주세요.`
              );
              return;
            }
            createdDefs.push(data);
          }

          defsForImport = [...customDefs, ...createdDefs];
          setCustomDefs(defsForImport);
          mappingForImport = [...mappingForImport, ...plan.mappingExtra];
          setRows((prev) => {
            const have = new Set(
              (prev || []).map((r) => `${r.sourceKey}::${r.targetKey}`)
            );
            const extra = plan.mappingExtra.filter(
              (r) => !have.has(`${r.sourceKey}::${r.targetKey}`)
            );
            return extra.length ? [...prev, ...extra] : prev;
          });
          try {
            window.dispatchEvent(
              new CustomEvent('nexvia-custom-field-definitions-changed', {
                detail: { entityType: 'product' }
              })
            );
          } catch {
            /* ignore */
          }
          setSaveMsg(
            createdDefs.length
              ? `추가 필드 ${createdDefs.length}개 생성 · 제품 등록을 시작합니다…`
              : '기존 추가 필드에 연결 · 제품 등록을 시작합니다…'
          );
        } catch (e) {
          setSaving(false);
          setSaveMsg(e?.message || '추가 필드 자동 생성 중 오류가 났습니다.');
          return;
        }
      }

      const nameColumnKey = resolveProductExcelColumnKey(mappingForImport, 'product.name');
      const billingColumnKey = resolveProductExcelColumnKey(mappingForImport, 'product.billingType');
      const billingIntervalColumnKey = resolveProductExcelColumnKey(
        mappingForImport,
        'product.billingInterval'
      );
      const statusColumnKey = resolveProductExcelColumnKey(mappingForImport, 'product.status');
      const currencyColumnKey = resolveProductExcelColumnKey(mappingForImport, 'product.currency');
      const invalid = countInvalidProductExcelDraftCells(sourceRows, {
        nameColumnKey,
        billingColumnKey,
        billingIntervalColumnKey,
        statusColumnKey,
        currencyColumnKey,
        allowedCodes: currencyAllowedCodes
      });
      if (invalid.total > 0) {
        const parts = [];
        if (invalid.nameMissing) parts.push(`제품명 ${invalid.nameMissing}건`);
        if (invalid.billing) parts.push(`결제주기 ${invalid.billing}건`);
        if (invalid.billingInterval) parts.push(`결제기간 ${invalid.billingInterval}건`);
        if (invalid.status) parts.push(`상태 ${invalid.status}건`);
        if (invalid.currency) parts.push(`통화 ${invalid.currency}건`);
        setSaving(false);
        setSaveMsg(`수정이 필요합니다: ${parts.join(', ')}. 붉은 칸을 확인해 주세요.`);
        return;
      }

      // customDefs는 runImport 클로저에 묶여 있음 → 최신 defs를 넘기기 위해 override
      void runImport(sourceRows, mappingForImport, defsForImport);
    },
    [
      excelRowsDraft,
      excelRows,
      rows,
      runImport,
      currencyAllowedCodes,
      customDefs,
      pricingProfile
    ]
  );

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
        onRowsReplaceAll={(nextRows) => {
          setSaveMsg(null);
          onRawRowsReplaceAll(nextRows);
        }}
        onUndoDraft={() => {
          const ok = undoExcelDraft();
          if (ok) setSaveMsg(null);
          return ok;
        }}
        onBeforeBulkMutation={pushExcelDraftUndo}
        saveMsg={saveMsg}
        currencyPreviewOptions={currencyPreviewOptions}
        currencyAllowedCodes={currencyAllowedCodes}
        customDefinitions={customDefs}
        formulaExchangeCtx={formulaExchangeCtx}
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
