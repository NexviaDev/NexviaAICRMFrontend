/**
 * 제품 목록(product-list.js)에서 URL ?modal=excel-import 로 열립니다.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';
import ProductImportMappingModal from './product-import-mapping-modal';
import {
  buildExcelSourceOptions,
  previewExcelMappedValue
} from '../../customer-companies/customer-companies-excel-import-modal/excel-import-mapping-utils';
import '../../lead-capture/lead-capture-crm-mapping/lead-capture-crm-mapping-modal.css';
import '../../customer-companies/customer-companies-excel-import-modal/customer-companies-excel-import-modal.css';
import {
  buildProductTargetOptions,
  createInitialProductMappingRows,
  excelRowToProductBody,
  isExcelRowEffectivelyEmpty,
  MAX_PRODUCT_EXCEL_ROWS,
  mergeCustomFieldMappingRows,
  parseExcelFileToRows,
  productRowStatus
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
  const appliedInitialRef = useRef(false);

  useEffect(() => {
    if (!open) {
      appliedInitialRef.current = false;
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

  const runImport = useCallback(async () => {
    if (!excelRows.length) {
      setSaveMsg('엑셀 파일을 먼저 올려 주세요.');
      return;
    }
    const nameRow = rows.find((r) => r.targetKey === 'product.name');
    if (!nameRow) {
      setSaveMsg('제품명(product.name) 매핑 행을 추가해 주세요.');
      return;
    }
    const prev = previewExcelMappedValue(sampleRow, nameRow);
    const st = productRowStatus(nameRow, prev);
    if (st.type !== 'ok') {
      setSaveMsg('첫 데이터 행 기준으로 제품명이 비어 있으면 안 됩니다. 매핑을 확인해 주세요.');
      return;
    }

    setSaving(true);
    setSaveMsg(null);
    let ok = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];
    try {
      await pingBackendHealth(getAuthHeader);
      let i = 0;
      for (const excelRow of excelRows) {
        if (isExcelRowEffectivelyEmpty(excelRow)) {
          skipped += 1;
          continue;
        }
        const body = excelRowToProductBody(excelRow, rows);
        if (!body.name?.trim()) {
          skipped += 1;
          continue;
        }
        if (i > 0 && i % 20 === 0) {
          await pingBackendHealth(getAuthHeader);
        }
        const res = await fetch(`${API_BASE}/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify(body)
        });
        if (res.ok) {
          ok += 1;
        } else {
          failed += 1;
          const errData = await res.json().catch(() => ({}));
          errors.push(errData.error || `HTTP ${res.status}`);
        }
        i += 1;
      }
      const parts = [`완료: 성공 ${ok}건`];
      if (skipped) parts.push(`빈 행·제품명 없음 ${skipped}건 건너뜀`);
      if (failed) parts.push(`실패 ${failed}건`);
      setSaveMsg(parts.join(' · ') + (errors.length ? ` (${errors.slice(0, 3).join('; ')})` : ''));
      if (ok > 0) {
        try {
          window.dispatchEvent(new CustomEvent('nexvia-product-excel-import-completed'));
        } catch {
          /* ignore */
        }
        onImported?.();
      }
    } catch (e) {
      setSaveMsg(e?.message || '등록 중 오류가 났습니다.');
    } finally {
      setSaving(false);
    }
  }, [excelRows, rows, onImported]);

  if (!open) return null;

  return (
    <ProductImportMappingModal
      onClose={onClose}
      saving={saving}
      onImport={runImport}
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
