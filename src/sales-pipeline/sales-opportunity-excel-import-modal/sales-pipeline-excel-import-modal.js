/**
 * 세일즈 파이프라인 — URL ?modal=excel-import
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { readSpreadsheetFileToRows } from '@/lib/spreadsheet-file-read';
import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';
import { buildExcelSourceOptions, previewExcelMappedValue } from '../../customer-companies/customer-companies-excel-import-modal/excel-import-mapping-utils';
import OpportunityExcelImportMappingModal from './opportunity-excel-import-mapping-modal';
import OpportunityExcelRawPreviewModal from './opportunity-excel-raw-preview-modal';
import { buildParticipantDirectoryFromOverview } from '@/lib/participant-directory-merge';
import {
  defaultOpportunityMappingRows,
  buildOpportunityTargetOptions,
  autoGuessMappingSourceKeys,
  ensureOpportunityMappingComplete,
  buildPreviewRowFromExcelRow,
  buildBulkImportPayloadFromPreviewRow,
  mappingCanProceed,
  opportunityMappingRowStatus,
  toApiMappings,
  getPipelineStageOptionsForImport,
  getOppStageExcelMapping,
  getOppFieldExcelMapping,
  countInvalidExcelDraftCells,
  patchExcelRowWithSideEffects,
  resolveExcelPriceBasisColumnKey,
  resolveExcelChannelDistributorColumnKey,
  resolveExcelAssigneeColumnKey,
  resolveExcelCompanyColumnKey,
  normalizeOverviewEmployees,
  normalizeExcelDraftRows,
  companyRowFromSearchModal,
  OPP_EXCEL_ROW_META_ASSIGNEE_ID,
  OPP_EXCEL_ROW_META_COMPANY_ID,
  OPP_EXCEL_ROW_META_FORCE_IMPORT,
  isExcelMetaHeaderKey
} from './opportunity-excel-import-utils';
import '../../lead-capture/lead-capture-crm-mapping/lead-capture-crm-mapping-modal.css';
import '../../customer-companies/customer-companies-excel-import-modal/customer-companies-excel-import-modal.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function SalesPipelineExcelImportModal({ open, onClose, onImported }) {
  const [meta, setMeta] = useState(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [excelRows, setExcelRows] = useState([]);
  const [excelFileName, setExcelFileName] = useState('');
  const [rows, setRows] = useState(() => defaultOpportunityMappingRows());
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  /** mapping → excel-raw(편집·등록) → (result) */
  const [step, setStep] = useState('mapping');
  const [excelRowsDraft, setExcelRowsDraft] = useState([]);
  const [importResult, setImportResult] = useState(null);
  const [overviewEmployees, setOverviewEmployees] = useState([]);
  const [overviewLoading, setOverviewLoading] = useState(false);
  /** 검색·추가로 확정한 고객사 — excel-import-meta 목록에 병합 */
  const [extraCustomerCompanies, setExtraCustomerCompanies] = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setMetaLoading(true);
    void pingBackendHealth(getAuthHeader);
    fetch(`${API_BASE}/sales-opportunities/excel-import-meta`, { headers: getAuthHeader(), credentials: 'include' })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.error || '메타 조회 실패');
        setMeta(d);
        setRows((prev) => {
          let next = ensureOpportunityMappingComplete(prev);
          const targets = new Set(next.map((r) => r.targetKey));
          const add = [];
          for (const f of d.financeFieldDefs || []) {
            const tk = `opp.financeCustomFields.${f.key}`;
            if (!targets.has(tk)) {
              targets.add(tk);
              add.push({
                id: `fin-${f.key}`,
                sourceType: 'field',
                sourceKey: '',
                constantValue: '',
                targetKey: tk
              });
            }
          }
          for (const s of (d.scheduleFieldDefs || []).filter((x) => x.type === 'date')) {
            const tk = `opp.scheduleCustomDates.${s.key}`;
            if (!targets.has(tk)) {
              targets.add(tk);
              add.push({
                id: `sch-${s.key}`,
                sourceType: 'field',
                sourceKey: '',
                constantValue: '',
                targetKey: tk
              });
            }
          }
          return add.length ? [...next, ...add] : next;
        });
      })
      .catch((e) => setSaveMsg(e.message || '필드 목록을 불러오지 못했습니다.'))
      .finally(() => setMetaLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open || step !== 'excel-raw') return;
    let cancelled = false;
    setOverviewLoading(true);
    void pingBackendHealth(getAuthHeader);
    fetch(`${API_BASE}/companies/overview`, { headers: getAuthHeader(), credentials: 'include' })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return;
        if (!ok) throw new Error(d.error || '사내 직원 목록 조회 실패');
        setOverviewEmployees(normalizeOverviewEmployees(d.employees));
      })
      .catch(() => {
        if (!cancelled) setOverviewEmployees(normalizeOverviewEmployees(meta?.users));
      })
      .finally(() => {
        if (!cancelled) setOverviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, step, meta?.users]);

  useEffect(() => {
    if (!open) {
      setExcelRows([]);
      setExcelFileName('');
      setRows(defaultOpportunityMappingRows());
      setStep('mapping');
      setExcelRowsDraft([]);
      setImportResult(null);
      setSaveMsg(null);
      setOverviewEmployees([]);
      setExtraCustomerCompanies([]);
    }
  }, [open]);

  const sourceOptions = useMemo(() => buildExcelSourceOptions(excelRows[0] ? Object.keys(excelRows[0]) : []), [excelRows]);

  const sampleRow = useMemo(() => {
    for (const r of excelRows) {
      if (r && Object.keys(r).some((k) => String(r[k] ?? '').trim() !== '')) return r;
    }
    return excelRows[0] || {};
  }, [excelRows]);

  const targetOptions = useMemo(() => buildOpportunityTargetOptions(meta), [meta]);

  const stageOptions = useMemo(() => getPipelineStageOptionsForImport(meta), [meta]);

  const stageMapping = useMemo(() => getOppStageExcelMapping(rows), [rows]);
  const priceBasisMapping = useMemo(() => getOppFieldExcelMapping(rows, 'opp.unitPriceBasis'), [rows]);
  const channelMapping = useMemo(() => getOppFieldExcelMapping(rows, 'opp.channelDistributor'), [rows]);
  const assigneeMapping = useMemo(() => getOppFieldExcelMapping(rows, 'opp.assignedToName'), [rows]);
  const companyMapping = useMemo(() => getOppFieldExcelMapping(rows, 'opp.snapshotCompanyName'), [rows]);

  const customerCompaniesForImport = useMemo(() => {
    const fromMeta = Array.isArray(meta?.customerCompanies) ? meta.customerCompanies : [];
    const seen = new Set(fromMeta.map((c) => String(c.id)));
    const merged = [...fromMeta];
    for (const c of extraCustomerCompanies) {
      const id = String(c?.id ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(c);
    }
    return merged;
  }, [meta?.customerCompanies, extraCustomerCompanies]);

  const currentUser = useMemo(() => {
    try {
      const raw = localStorage.getItem('crm_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  const metaWithEmployees = useMemo(() => {
    if (!meta) return null;
    const uid = String(currentUser?._id || currentUser?.id || currentUser?.userId || '').trim();
    const uname = String(currentUser?.name || currentUser?.displayName || currentUser?.email || '').trim();
    const pipelineStageOptions = getPipelineStageOptionsForImport(meta);
    const assigneeUsers = overviewEmployees.length
      ? overviewEmployees.map((e) => ({ id: e.id, name: e.name || e.email || e.id }))
      : meta?.users || [];
    return {
      ...meta,
      stageOptions: pipelineStageOptions,
      users: assigneeUsers,
      customerCompanies: customerCompaniesForImport,
      _overviewEmployees: overviewEmployees,
      _currentUserId: uid,
      _currentUserName: uname
    };
  }, [meta, overviewEmployees, currentUser, customerCompaniesForImport]);

  const defaultUserId = metaWithEmployees?._currentUserId || '';

  const teamMembersForPicker = useMemo(() => {
    const directory = buildParticipantDirectoryFromOverview([], { employees: overviewEmployees });
    return directory.map((m) => ({
      _id: m._id,
      id: m._id,
      userId: m._id,
      name: m.name,
      email: m.email,
      avatar: m.avatar,
      department: m.department,
      departmentDisplay: m.departmentDisplay
    }));
  }, [overviewEmployees]);

  const effectiveTargetOptions = useMemo(() => {
    const used = new Set((rows || []).map((r) => r.targetKey).filter(Boolean));
    return targetOptions.filter((o) => !used.has(o.value) || true);
  }, [targetOptions, rows]);

  const ingestFile = useCallback(async (file) => {
    setSaveMsg(null);
    try {
      const parsed = await readSpreadsheetFileToRows(file);
      if (!parsed?.length) {
        setSaveMsg('데이터 행이 없습니다. 첫 행을 헤더로 두었는지 확인해 주세요.');
        return;
      }
      const headerKeys = Object.keys(parsed[0] || {}).filter((k) => k && !String(k).startsWith('__EMPTY'));
      if (!headerKeys.length) {
        setSaveMsg('엑셀 열(헤더)을 읽지 못했습니다. 첫 행에 기회명·단계 등 열 이름이 있는지 확인해 주세요.');
        return;
      }
      setExcelRows(parsed);
      setExcelFileName(file.name || '');
      setRows((prev) => autoGuessMappingSourceKeys(ensureOpportunityMappingComplete(prev), headerKeys));
    } catch (e) {
      setSaveMsg(e.message || '파일을 읽지 못했습니다.');
    }
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) void ingestFile(file);
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
      {
        id: `row-${Date.now()}`,
        sourceType: 'constant',
        sourceKey: '',
        constantValue: '',
        targetKey: ''
      }
    ]);
  }, []);

  const summary = useMemo(() => {
    let err = 0;
    rows.forEach((row) => {
      const preview = previewExcelMappedValue(sampleRow, row);
      const st = opportunityMappingRowStatus(row, preview);
      if (st.type === 'err') err += 1;
    });
    return { mapped: rows.filter((r) => r.targetKey).length, err, totalOpt: targetOptions.length };
  }, [rows, sampleRow, targetOptions.length]);

  const mappingReady = mappingCanProceed(rows, excelRows) && !metaLoading;

  const openRawExcelPreview = useCallback(() => {
    if (!mappingCanProceed(rows, excelRows)) {
      setSaveMsg('제목·단계 매핑을 완료하고 엑셀 파일을 업로드해 주세요.');
      return;
    }
    const draft = excelRows.map((r) => ({ ...r }));
    const hdrs = draft[0] ? Object.keys(draft[0]).filter((k) => !isExcelMetaHeaderKey(k)) : [];
    const columnKeys = {
      distributorCol: resolveExcelChannelDistributorColumnKey(hdrs, channelMapping),
      priceBasisCol: resolveExcelPriceBasisColumnKey(hdrs, priceBasisMapping),
      assigneeCol: resolveExcelAssigneeColumnKey(hdrs, assigneeMapping),
      companyCol: resolveExcelCompanyColumnKey(hdrs, companyMapping)
    };
    setExcelRowsDraft(normalizeExcelDraftRows(draft, columnKeys));
    setStep('excel-raw');
    setSaveMsg(null);
  }, [rows, excelRows, channelMapping, priceBasisMapping, assigneeMapping, companyMapping]);

  const onRawCellChange = useCallback(
    (rowIndex, header, value) => {
      setExcelRowsDraft((prev) => {
        const hdrs = prev[0] ? Object.keys(prev[0]).filter((k) => !isExcelMetaHeaderKey(k)) : [];
        const columnKeys = {
          distributorCol: resolveExcelChannelDistributorColumnKey(hdrs, channelMapping),
          priceBasisCol: resolveExcelPriceBasisColumnKey(hdrs, priceBasisMapping),
          assigneeCol: resolveExcelAssigneeColumnKey(hdrs, assigneeMapping),
          companyCol: resolveExcelCompanyColumnKey(hdrs, companyMapping)
        };
        return prev.map((r, i) =>
          i === rowIndex ? patchExcelRowWithSideEffects(r, header, value, columnKeys) : r
        );
      });
    },
    [channelMapping, priceBasisMapping, assigneeMapping, companyMapping]
  );

  const onCompanyPicked = useCallback((rowIndex, companyCol, { companyId, companyName, company }) => {
    const row = companyRowFromSearchModal(company);
    if (row) {
      setExtraCustomerCompanies((prev) => {
        if (prev.some((c) => c.id === row.id)) return prev;
        return [...prev, row];
      });
    }
    setExcelRowsDraft((prev) =>
      prev.map((r, i) =>
        i === rowIndex
          ? { ...r, [companyCol]: companyName, [OPP_EXCEL_ROW_META_COMPANY_ID]: companyId }
          : r
      )
    );
  }, []);

  const onAssigneePicked = useCallback((rowIndex, assignCol, { userId, name }) => {
    setExcelRowsDraft((prev) =>
      prev.map((r, i) =>
        i === rowIndex
          ? { ...r, [assignCol]: name, [OPP_EXCEL_ROW_META_ASSIGNEE_ID]: userId }
          : r
      )
    );
  }, []);

  const onForceImportRow = useCallback((rowIndex) => {
    setExcelRowsDraft((prev) =>
      prev.map((r, i) => (i === rowIndex ? { ...r, [OPP_EXCEL_ROW_META_FORCE_IMPORT]: true } : r))
    );
    setSaveMsg(null);
  }, []);

  const runBulkImport = useCallback(
    async (rowsToImport) => {
      const list = (Array.isArray(rowsToImport) ? rowsToImport : []).filter((r) => r.isValid || r.forceImport);
      if (!list.length) {
        setSaveMsg('등록할 유효한 행이 없습니다. 붉은 칸을 모두 수정해 주세요.');
        return;
      }
      setSaving(true);
      setSaveMsg('서버에 등록 중입니다…');
      try {
        await pingBackendHealth(getAuthHeader);
        const items = list.map((row) => buildBulkImportPayloadFromPreviewRow(row, metaWithEmployees));
        const res = await fetch(`${API_BASE}/sales-opportunities/bulk-import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          credentials: 'include',
          body: JSON.stringify({ items })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '일괄 등록 실패');
        setImportResult(data);
        const created = data.summary?.created ?? 0;
        const failed = data.summary?.failed ?? 0;
        if (created > 0) {
          onImported?.(data);
          if (failed > 0) {
            setSaveMsg(`등록 완료 ${created}건, 실패 ${failed}건 — 결과 창을 확인해 주세요.`);
          } else {
            setSaveMsg(null);
          }
        } else {
          setSaveMsg(`등록에 실패했습니다. (${failed}건)`);
        }
      } catch (e) {
        setSaveMsg(e.message || '등록 중 오류');
      } finally {
        setSaving(false);
      }
    },
    [metaWithEmployees, onImported]
  );

  /** 엑셀 미리보기 — 붉은 칸·경고 해소 후 바로 일괄 등록 */
  const registerFromExcelRawPreview = useCallback(() => {
    try {
      if (!metaWithEmployees) {
        setSaveMsg('필드 목록을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      const mappings = toApiMappings(rows);
      const sourceRows = excelRowsDraft.length ? excelRowsDraft : excelRows;
      const hdrs = sourceRows[0] ? Object.keys(sourceRows[0]).filter((k) => !isExcelMetaHeaderKey(k)) : [];
      const invalid = countInvalidExcelDraftCells(sourceRows, {
        headers: hdrs,
        stageMapping,
        stageOptions,
        priceBasisMapping,
        channelMapping,
        assigneeMapping,
        companyMapping,
        overviewEmployees,
        defaultUserId,
        meta: metaWithEmployees
      });
      if (invalid.total > 0) {
        const parts = [];
        if (invalid.stage) parts.push(`단계 ${invalid.stage}건`);
        if (invalid.priceBasis) parts.push(`가격기준 ${invalid.priceBasis}건`);
        if (invalid.channelDistributor) parts.push(`유통사 ${invalid.channelDistributor}건`);
        if (invalid.assignee) parts.push(`사내담당자 ${invalid.assignee}건`);
        if (invalid.company) parts.push(`고객사 ${invalid.company}건`);
        setSaveMsg(`수정이 필요합니다: ${parts.join(', ')}. 붉은 칸을 확인해 주세요.`);
        return;
      }
      const built = [];
      for (let rowIndex = 0; rowIndex < sourceRows.length; rowIndex += 1) {
        const excelRow = sourceRows[rowIndex];
        const mapped = buildPreviewRowFromExcelRow(excelRow, rowIndex, mappings, metaWithEmployees);
        const hasTitle = (mapped.title || '').trim();
        const hasProduct = (mapped.lineItemsClient?.[0]?.productName || '').trim();
        if (hasTitle || hasProduct) built.push(mapped);
      }
      if (!built.length) {
        setSaveMsg(
          '등록할 유효한 행이 없습니다. 엑셀에 제품명·단계가 보이는지, 매핑에서 「제품명」「기회 · 단계」 열이 연결됐는지 확인해 주세요.'
        );
        return;
      }
      const ready = built.filter((r) => r.isValid || r.forceImport);
      if (!ready.length) {
        setSaveMsg('등록 가능한 행이 없습니다. 제목·필수 항목을 확인해 주세요.');
        return;
      }
      setSaveMsg(null);
      void runBulkImport(ready);
    } catch (e) {
      console.error('[SalesPipelineExcelImport] registerFromExcelRawPreview', e);
      setSaveMsg(e?.message || '등록 준비 중 오류가 났습니다.');
    }
  }, [
    rows,
    excelRowsDraft,
    excelRows,
    metaWithEmployees,
    stageMapping,
    stageOptions,
    priceBasisMapping,
    channelMapping,
    assigneeMapping,
    companyMapping,
    overviewEmployees,
    defaultUserId,
    runBulkImport
  ]);

  if (!open) return null;

  if (importResult) {
    const results = Array.isArray(importResult.results) ? importResult.results : [];
    const failed = results.filter((r) => !r.ok);
    return (
      <div className="opp-modal-overlay excel-import-map-overlay" role="dialog" aria-modal="true">
        <div className="opp-modal excel-import-map-modal" onClick={(e) => e.stopPropagation()}>
          <div className="opp-modal-header">
            <h3 className="opp-modal-title">가져오기 결과</h3>
            <button type="button" className="opp-modal-close" onClick={() => { setImportResult(null); onClose?.(); }} aria-label="닫기">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <div className="opp-modal-form" style={{ padding: '1rem 1.25rem' }}>
            <p>
              성공 <strong>{importResult.summary?.created ?? 0}</strong>건 · 실패{' '}
              <strong>{importResult.summary?.failed ?? 0}</strong>건
            </p>
            {failed.length > 0 ? (
              <ul style={{ fontSize: '0.8125rem', color: '#b91c1c', maxHeight: '12rem', overflow: 'auto' }}>
                {failed.slice(0, 20).map((r) => (
                  <li key={r.rowIndex}>
                    {r.rowIndex + 1}행: {r.error || '오류'} {r.title ? `(${r.title})` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="opp-modal-footer">
            <button
              type="button"
              className="opp-btn-primary"
              onClick={() => {
                const ok = (importResult.summary?.created ?? 0) > 0 && (importResult.summary?.failed ?? 0) === 0;
                setImportResult(null);
                setStep('mapping');
                if (ok) onClose?.();
              }}
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'excel-raw') {
    return (
      <OpportunityExcelRawPreviewModal
        open
        rows={excelRowsDraft}
        mappingRows={rows}
        targetOptions={targetOptions}
        excelFileName={excelFileName}
        rowCount={excelRowsDraft.length}
        saving={saving || overviewLoading}
        onClose={() => !saving && setStep('mapping')}
        onProceed={registerFromExcelRawPreview}
        onCellChange={(rowIndex, header, value) => {
          setSaveMsg(null);
          onRawCellChange(rowIndex, header, value);
        }}
        onAssigneePicked={(rowIndex, col, pick) => {
          setSaveMsg(null);
          onAssigneePicked(rowIndex, col, pick);
        }}
        saveMsg={saveMsg}
        stageOptions={stageOptions}
        stageMapping={stageMapping}
        priceBasisMapping={priceBasisMapping}
        channelMapping={channelMapping}
        assigneeMapping={assigneeMapping}
        companyMapping={companyMapping}
        customerCompanies={customerCompaniesForImport}
        products={meta?.products || []}
        onCompanyPicked={(rowIndex, col, pick) => {
          setSaveMsg(null);
          onCompanyPicked(rowIndex, col, pick);
        }}
        onForceImportRow={onForceImportRow}
        channelDistributors={meta?.channelDistributors}
        overviewEmployees={overviewEmployees}
        teamMembersForPicker={teamMembersForPicker}
        currentUser={currentUser}
        defaultUserId={defaultUserId}
      />
    );
  }

  return (
    <OpportunityExcelImportMappingModal
      onClose={onClose}
      saving={saving || metaLoading}
      onProceed={openRawExcelPreview}
      excelRows={excelRows}
      fileInputRef={fileInputRef}
      ingestFile={ingestFile}
      dragOver={dragOver}
      setDragOver={setDragOver}
      onDrop={onDrop}
      excelFileName={excelFileName}
      targetOptions={targetOptions}
      rows={rows}
      sampleRow={sampleRow}
      sourceOptions={sourceOptions}
      effectiveTargetOptions={effectiveTargetOptions}
      updateRow={updateRow}
      removeRow={removeRow}
      addConstantRow={addConstantRow}
      summary={summary}
      saveMsg={saveMsg}
      mappingReady={mappingReady}
    />
  );
}
