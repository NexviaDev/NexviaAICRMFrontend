/**
 * 고객사 목록(customer-companies.js)에서 URL `?modal=excel-import`일 때 열립니다.
 * 뒤로가기로 닫히도록 부모가 searchParams로 open/onClose를 제어합니다.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { API_BASE } from '@/config';
import AssigneePickerModal from '../../company-overview/assignee-picker-modal/assignee-picker-modal';
import ImportProgressModal from './import-progress-modal';
import '../../lead-capture/lead-capture-crm-mapping/lead-capture-crm-mapping-modal.css';
import './customer-companies-excel-import-modal.css';
import {
  buildTargetOptionsForTarget,
  toApiMappings,
  rowStatus,
  ensureCompanyMappingRowsComplete,
  appendMissingCompanyCustomFieldRows,
  rowsFromSavedMappings
} from '../../lead-capture/lead-capture-crm-mapping/lead-capture-crm-mapping-utils';
import { buildExcelSourceOptions, previewExcelMappedValue } from './excel-import-mapping-utils';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function newRowId() {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getCurrentUserId() {
  try {
    const u = JSON.parse(localStorage.getItem('crm_user') || '{}');
    return u?._id ? String(u._id) : null;
  } catch (_) {
    return null;
  }
}

const REQUIRED_TARGETS = [
  { key: 'company.businessNumber', label: '사업자 번호' },
  { key: 'company.name', label: '고객사 명' },
  { key: 'company.representativeName', label: '대표자명' },
  { key: 'company.address', label: '주소' }
];

const FALLBACK_TARGET_OPTIONS = [
  { value: 'company.businessNumber', label: '고객사 · 사업자 번호' },
  { value: 'company.name', label: '고객사 · 고객사명' },
  { value: 'company.representativeName', label: '고객사 · 대표자명' },
  { value: 'company.address', label: '고객사 · 주소' },
  { value: 'company.status', label: '고객사 · 상태' },
  { value: 'company.memo', label: '고객사 · 메모' }
];

function digitsOnly(value) {
  if (value == null) return '';
  return String(value).replace(/\D/g, '');
}

function holdBusinessNumberKey(item, fallbackIndex) {
  const fromPayload = digitsOnly(item?.companyPayload?.businessNumber);
  if (fromPayload) return fromPayload;
  return `no_bn_${fallbackIndex}`;
}

function buildHoldGroups(holdItems) {
  const map = new Map();
  holdItems.forEach((item, idx) => {
    const key = holdBusinessNumberKey(item, idx);
    if (!map.has(key)) map.set(key, { key, businessNumber: key.startsWith('no_bn_') ? '' : key, items: [] });
    map.get(key).items.push(item);
  });
  return Array.from(map.values());
}

function buildExistingCandidatesForGroup(group) {
  const map = new Map();
  (group?.items || []).forEach((item) => {
    const list = Array.isArray(item?.conflictCandidates) ? item.conflictCandidates : [];
    list.forEach((c) => {
      const id = String(c?.companyId || '').trim();
      if (!id || map.has(id)) return;
      map.set(id, {
        companyId: id,
        name: c?.name || '',
        businessNumber: c?.businessNumber || ''
      });
    });
  });
  return Array.from(map.values());
}

function buildResolveActionsForGroup(group, selected) {
  if (!group?.items?.length) return [];
  const picked = selected || { type: 'hold', key: String(group.items[0].rowIndex) };
  const actions = [];
  group.items.forEach((item) => {
    if (picked.type === 'existing') {
      actions.push({
        rowIndex: item.rowIndex,
        action: 'merge',
        targetCompanyId: String(picked.key || ''),
        targetHoldRowIndex: ''
      });
    } else {
      const isPickedHold = String(item.rowIndex) === String(picked.key || '');
      actions.push({
        rowIndex: item.rowIndex,
        action: isPickedHold ? 'add' : 'merge',
        targetCompanyId: '',
        targetHoldRowIndex: isPickedHold ? '' : String(picked.key || '')
      });
    }
  });
  return actions;
}

async function parseExcelToRows(file) {
  const buf = await file.arrayBuffer();
  const data = new Uint8Array(buf);
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('시트가 없습니다.');
  const sheet = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (!Array.isArray(json)) return [];
  return json;
}

export default function CustomerCompaniesExcelImportModal({ open, onClose, onImported }) {
  const fileInputRef = useRef(null);
  const [companySchemaFields, setCompanySchemaFields] = useState([]);
  const [companyCustomDefs, setCompanyCustomDefs] = useState([]);
  const [rows, setRows] = useState([]);
  const [excelRows, setExcelRows] = useState([]);
  const [excelFileName, setExcelFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [inProgressJob, setInProgressJob] = useState(null);
  const [showHoldList, setShowHoldList] = useState(false);
  const [holdGroupSelection, setHoldGroupSelection] = useState({});
  const [stagedHoldGroupActions, setStagedHoldGroupActions] = useState({});
  const [resolvingHold, setResolvingHold] = useState(false);
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [companyEmployeesForDisplay, setCompanyEmployeesForDisplay] = useState([]);
  const [assigneeDisplayText, setAssigneeDisplayText] = useState(undefined);
  const [assigneeUserIds, setAssigneeUserIds] = useState(() => {
    const id = getCurrentUserId();
    return id ? [id] : [];
  });

  const registerTarget = 'company';

  const excelHeaders = useMemo(() => {
    if (!excelRows.length) return [];
    const keys = Object.keys(excelRows[0] || {});
    return keys.filter((k) => k !== '__rowNum__');
  }, [excelRows]);

  const sampleRow = useMemo(() => {
    for (const r of excelRows) {
      if (r && typeof r === 'object' && Object.values(r).some((v) => v != null && String(v).trim() !== '')) {
        return r;
      }
    }
    return excelRows[0] || {};
  }, [excelRows]);

  const targetOptions = useMemo(
    () => buildTargetOptionsForTarget(registerTarget, companySchemaFields, companyCustomDefs),
    [companySchemaFields, companyCustomDefs]
  );
  const effectiveTargetOptions = useMemo(
    () => (Array.isArray(targetOptions) && targetOptions.length > 0 ? targetOptions : FALLBACK_TARGET_OPTIONS),
    [targetOptions]
  );

  const sourceOptions = useMemo(() => buildExcelSourceOptions(excelHeaders), [excelHeaders]);
  const currentUserId = useMemo(() => getCurrentUserId(), []);
  const assigneeIdToName = useMemo(() => {
    const map = {};
    (companyEmployeesForDisplay || []).forEach((e) => {
      const id = e.id != null ? String(e.id) : null;
      if (id) map[id] = e.name || e.email || id;
    });
    return map;
  }, [companyEmployeesForDisplay]);
  const assigneeInputValue = assigneeDisplayText !== undefined && assigneeDisplayText !== null
    ? assigneeDisplayText
    : (assigneeUserIds || [])
      .map((id) => {
        const sid = String(id);
        if (currentUserId && sid === currentUserId) return '';
        return assigneeIdToName[sid] || '선택된 사용자';
      })
      .join(', ');
  const showMeBadge = assigneeDisplayText === undefined &&
    Array.isArray(assigneeUserIds) &&
    assigneeUserIds.length === 1 &&
    currentUserId &&
    String(assigneeUserIds[0]) === currentUserId;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [c2Res, sfRes] = await Promise.allSettled([
        fetch(`${API_BASE}/custom-field-definitions?entityType=customerCompany`, {
          headers: getAuthHeader(),
          credentials: 'include'
        }).then((r) => r.json()),
        fetch(`${API_BASE}/lead-capture-forms/crm-mappable-fields`, {
          headers: getAuthHeader(),
          credentials: 'include'
        }).then((r) => r.json())
      ]);
      if (cancelled) return;
      if (c2Res.status === 'fulfilled') {
        setCompanyCustomDefs(Array.isArray(c2Res.value?.items) ? c2Res.value.items : []);
      }
      if (sfRes.status === 'fulfilled') {
        setCompanySchemaFields(Array.isArray(sfRes.value?.company) ? sfRes.value.company : []);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/companies/overview`, { headers: getAuthHeader() })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.employees)) setCompanyEmployeesForDisplay(data.employees);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) {
      setExcelRows([]);
      setExcelFileName('');
      setDragOver(false);
      setSaveMsg(null);
      setImportResult(null);
      setInProgressJob(null);
      setShowAssigneePicker(false);
      return;
    }
    setSaveMsg(null);
    setImportResult(null);
    setRows(ensureCompanyMappingRowsComplete(rowsFromSavedMappings(null, registerTarget)));
    const id = getCurrentUserId();
    setAssigneeUserIds(id ? [id] : []);
    setAssigneeDisplayText(undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setRows((prev) => appendMissingCompanyCustomFieldRows(prev, companyCustomDefs, []));
  }, [open, companyCustomDefs]);

  const updateRow = useCallback((id, patch) => {
    setRows((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const addConstantRow = useCallback(() => {
    setRows((p) => [
      ...p,
      {
        id: newRowId(),
        sourceType: 'constant',
        sourceKey: '',
        constantValue: '',
        targetKey: 'company.memo'
      }
    ]);
  }, []);

  const removeRow = useCallback((id) => {
    setRows((p) => (p.length <= 1 ? p : p.filter((r) => r.id !== id)));
  }, []);

  const ingestFile = useCallback(async (file) => {
    if (!file) return;
    const name = (file.name || '').toLowerCase();
    const ok =
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      name.endsWith('.csv') ||
      file.type === 'text/csv' ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel';
    if (!ok) {
      setSaveMsg('엑셀(.xlsx, .xls) 또는 CSV 파일만 올려 주세요.');
      return;
    }
    setSaveMsg(null);
    try {
      const parsed = await parseExcelToRows(file);
      if (!parsed.length) {
        setSaveMsg('데이터 행이 없습니다. 첫 행을 헤더로 사용합니다.');
        setExcelRows([]);
        setExcelFileName(file.name);
        return;
      }
      setExcelRows(parsed);
      setExcelFileName(file.name);
    } catch (e) {
      setSaveMsg(e.message || '파일을 읽지 못했습니다.');
    }
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) void ingestFile(f);
    },
    [ingestFile]
  );

  const handleImport = async () => {
    if (!excelRows.length) {
      setSaveMsg('먼저 엑셀 파일을 드래그하거나 선택해 주세요.');
      return;
    }
    const mappings = toApiMappings(rows);
    if (mappings.length === 0) {
      setSaveMsg('최소 하나 이상의 대상 필드를 매핑해 주세요.');
      return;
    }
    const invalid = mappings.some((m) => !String(m.targetKey || '').startsWith('company.'));
    if (invalid) {
      setSaveMsg('대상은 고객사 필드만 선택할 수 있습니다.');
      return;
    }
    const mappedTargetKeys = new Set(mappings.map((m) => m.targetKey));
    const missingRequired = REQUIRED_TARGETS.filter((target) => !mappedTargetKeys.has(target.key));
    if (missingRequired.length > 0) {
      const missingLabels = missingRequired.map((item) => item.label).join(', ');
      setSaveMsg(`필수 매핑 누락: ${missingLabels}`);
      return;
    }

    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`${API_BASE}/customer-companies/import-excel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
        body: JSON.stringify({
          mappings,
          rows: excelRows,
          assigneeUserIds: Array.isArray(assigneeUserIds) && assigneeUserIds.length > 0 ? assigneeUserIds : undefined
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '가져오기 실패');

      if (res.status === 202 && data.jobId) {
        setInProgressJob({
          jobId: data.jobId,
          totalRows: data.totalRows ?? excelRows.length,
          processedRows: 0,
          processingStats: null
        });
        setSaveMsg('처리 중입니다. 완료될 때까지 이 화면을 유지해 주세요.');
        return;
      }

      setImportResult(data);
    } catch (e) {
      setSaveMsg(e.message || '실패');
    } finally {
      setSaving(false);
    }
  };

  const summary = useMemo(() => {
    let err = 0;
    rows.forEach((row) => {
      const prev = previewExcelMappedValue(sampleRow, row);
      const st = rowStatus(row, prev, registerTarget);
      if (st.type === 'err') err += 1;
    });
    return { mapped: rows.filter((r) => r.targetKey).length, err, totalOpt: targetOptions.length };
  }, [rows, sampleRow, targetOptions.length]);

  const handleResultConfirm = useCallback(() => {
    if (importResult) onImported?.(importResult);
    setImportResult(null);
    setShowHoldList(false);
    setHoldGroupSelection({});
    setStagedHoldGroupActions({});
    onClose?.();
  }, [importResult, onClose, onImported]);

  useEffect(() => {
    if (!inProgressJob?.jobId || !open) return;
    let stopped = false;
    const run = async () => {
      try {
        const res = await fetch(`${API_BASE}/customer-companies/import-excel/jobs/${inProgressJob.jobId}`, {
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || stopped) return;
        if (data.status === 'completed' || data.status === 'failed') {
          setInProgressJob(null);
          setImportResult({
            ...data,
            jobId: data.jobId || data._id || inProgressJob.jobId
          });
          return;
        }
        setInProgressJob((prev) => (
          prev
            ? {
                ...prev,
                processedRows: data.processedRows ?? prev.processedRows,
                processingStats: data.processingStats || prev.processingStats
              }
            : prev
        ));
      } catch (_) {}
    };
    const timer = setInterval(run, 700);
    void run();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [inProgressJob?.jobId, open]);

  useEffect(() => {
    if (!inProgressJob?.jobId) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [inProgressJob?.jobId]);

  useEffect(() => {
    if (!importResult) return;
    const results = Array.isArray(importResult.results) ? importResult.results : [];
    const holdItems = results.filter((r) => r && r.hold);
    const groups = buildHoldGroups(holdItems);
    const defaults = {};
    groups.forEach((g) => {
      const existing = buildExistingCandidatesForGroup(g);
      if (existing.length > 0) {
        defaults[g.key] = { type: 'existing', key: existing[0].companyId };
      } else if (g.items.length > 0) {
        defaults[g.key] = { type: 'hold', key: String(g.items[0].rowIndex) };
      }
    });
    setHoldGroupSelection(defaults);
    setStagedHoldGroupActions({});
  }, [importResult]);

  const handleResolveHolds = useCallback(async (overrideActions = null) => {
    const effectiveJobId = importResult?.jobId || importResult?._id || inProgressJob?.jobId;
    if (!effectiveJobId) {
      setSaveMsg('작업 ID가 없어 보류 처리를 진행할 수 없습니다.');
      return false;
    }
    const actions = Array.isArray(overrideActions) ? overrideActions : [];
    if (!actions.length) {
      setSaveMsg('보류 목록에서 최소 1건 이상 체크해 주세요.');
      return false;
    }

    setResolvingHold(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`${API_BASE}/customer-companies/import-excel/jobs/${effectiveJobId}/resolve-holds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
        body: JSON.stringify({ actions })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '보류 처리 실패');
      setImportResult((prev) => (prev ? { ...prev, summary: data.summary || prev.summary, results: data.results || prev.results } : prev));
      setStagedHoldGroupActions({});
      if (Array.isArray(data.resolveErrors) && data.resolveErrors.length) {
        setSaveMsg(`일부 보류 처리 실패: ${data.resolveErrors.length}건`);
        return false;
      } else {
        setSaveMsg('보류 항목 처리를 완료했습니다.');
      }
      return true;
    } catch (e) {
      setSaveMsg(e.message || '보류 처리 실패');
      return false;
    } finally {
      setResolvingHold(false);
    }
  }, [importResult, inProgressJob?.jobId]);

  const handleResolveSingleHoldGroup = useCallback((group) => {
    const existing = buildExistingCandidatesForGroup(group);
    const defaultSelection = existing.length > 0
      ? { type: 'existing', key: existing[0].companyId }
      : { type: 'hold', key: String(group.items?.[0]?.rowIndex ?? '') };
    const selected = holdGroupSelection[group.key] || defaultSelection;
    const actions = buildResolveActionsForGroup(group, selected);
    if (!actions.length) return;
    setStagedHoldGroupActions((prev) => ({ ...prev, [group.key]: actions }));
    setSaveMsg('선택한 보류 그룹을 완료 처리 목록으로 이동했습니다. 마지막에 확인을 눌러 저장하세요.');
  }, [holdGroupSelection]);

  if (!open) return null;

  if (inProgressJob?.jobId) {
    return <ImportProgressModal inProgressJob={inProgressJob} />;
  }

  if (importResult) {
    const s = importResult.summary || {};
    const results = Array.isArray(importResult.results) ? importResult.results : [];
    const created = s.created ?? 0;
    const completedResolved = (s.holdResolvedAdd ?? 0) + (s.holdResolvedMerge ?? 0);
    const stagedCompleted = Object.values(stagedHoldGroupActions).reduce(
      (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
      0
    );
    const completedTotal = created + completedResolved + stagedCompleted;
    const skippedDup = s.skippedDuplicateCompany ?? 0;
    const onHold = s.onHold ?? results.filter((r) => r && r.hold).length;
    const emptySk = s.emptySkipped ?? 0;
    const skipped = skippedDup + emptySk;
    const failed = s.failed ?? 0;
    const total = s.total ?? results.length;
    const failedItems = results.filter((r) => !r.ok);
    const skippedItems = results.filter((r) => r.ok && r.skipped);
    const holdItems = results.filter((r) => r && r.hold);
    const visibleHoldGroups = buildHoldGroups(holdItems).filter((g) => !stagedHoldGroupActions[g.key]);
    const successItems = results.filter((r) => r.ok && !r.skipped);

    return (
      <div className="lc-crm-map-overlay" role="dialog" aria-modal="true">
        <div className="lc-crm-result-panel" onClick={(e) => e.stopPropagation()}>
          <div className="lc-crm-result-icon-wrap">
            <span
              className="material-symbols-outlined lc-crm-result-icon"
              style={{ color: failed > 0 ? '#f59e0b' : '#10b981' }}
            >
              {failed > 0 ? 'warning' : 'check_circle'}
            </span>
          </div>
          <h2 className="lc-crm-result-title">{failed > 0 ? '가져오기 완료 (일부 실패)' : '가져오기 완료'}</h2>
          <p className="lc-crm-result-sub">총 {total}행 처리 · 고객사 리스트</p>

          <div className="lc-crm-result-cards">
            <div className="lc-crm-result-card success">
              <span className="material-symbols-outlined">check_circle</span>
              <div>
                <p className="lc-crm-result-card-num">{completedTotal}건</p>
                <p className="lc-crm-result-card-label">완료 처리</p>
              </div>
            </div>
            <div className="lc-crm-result-card skip">
              <span className="material-symbols-outlined">content_copy</span>
              <div>
                <p className="lc-crm-result-card-num">{skipped}건</p>
                <p className="lc-crm-result-card-label">스킵 (중복·빈 행)</p>
              </div>
            </div>
            <div className="lc-crm-result-card fail">
              <span className="material-symbols-outlined">error</span>
              <div>
                <p className="lc-crm-result-card-num">{failed}건</p>
                <p className="lc-crm-result-card-label">실패</p>
              </div>
            </div>
            <div className="lc-crm-result-card warn">
              <span className="material-symbols-outlined">pending</span>
              <div>
                <p className="lc-crm-result-card-num">{onHold}건</p>
                <p className="lc-crm-result-card-label">보류</p>
              </div>
            </div>
          </div>

          {failedItems.length > 0 && (
            <div className="lc-crm-result-detail-section">
              <h3 className="lc-crm-result-detail-title fail">
                <span className="material-symbols-outlined">error</span>
                실패 상세
              </h3>
              <ul className="lc-crm-result-detail-list">
                {failedItems.map((item, i) => (
                  <li key={i} className="lc-crm-result-detail-item fail">
                    <span className="lc-crm-result-detail-id">
                      {String(item.companyName || '').trim() || `행 ${(item.rowIndex ?? i) + 1}`}
                    </span>
                    <span>{item.error || '알 수 없는 오류'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {skippedItems.length > 0 && skippedDup > 0 && (
            <div className="lc-crm-result-detail-section">
              <h3 className="lc-crm-result-detail-title skip">
                <span className="material-symbols-outlined">content_copy</span>
                중복 스킵 (이름+사업자번호 동일)
              </h3>
              <p className="lc-crm-map-save-msg" style={{ marginTop: '0.5rem' }}>
                빈 행 {emptySk}건은 자동으로 건너뛰었습니다.
              </p>
            </div>
          )}

          {successItems.length > 0 && (
            <div className="lc-crm-result-detail-section">
              <h3 className="lc-crm-result-detail-title success">
                <span className="material-symbols-outlined">check_circle</span>
                신규 등록 {successItems.length}건
              </h3>
            </div>
          )}

          {visibleHoldGroups.length > 0 && (
            <div className="lc-crm-result-detail-section">
              <h3 className="lc-crm-result-detail-title skip" style={{ justifyContent: 'space-between' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span className="material-symbols-outlined">pending</span>
                  보류 {visibleHoldGroups.reduce((acc, g) => acc + g.items.length, 0)}건
                </span>
                <button
                  type="button"
                  className="lc-crm-map-btn-discard"
                  onClick={() => setShowHoldList((v) => !v)}
                  style={{ minWidth: 0, padding: '0.35rem 0.65rem' }}
                >
                  {showHoldList ? '숨기기' : '목록 보기'}
                </button>
              </h3>
              {showHoldList && (
                <div>
                  {visibleHoldGroups.map((group) => {
                    const existingCandidates = buildExistingCandidatesForGroup(group);
                    const selected = holdGroupSelection[group.key] || null;
                    return (
                    <div key={group.key} className="lc-crm-result-detail-section" style={{ marginTop: '0.6rem', padding: '0.65rem', border: '1px solid #e2e8f0', borderRadius: '0.6rem' }}>
                      <h4 style={{ margin: 0, fontSize: '0.85rem', color: '#334155' }}>
                        사업자번호 그룹: {group.businessNumber || '미기입'}
                      </h4>
                      <p style={{ margin: '0.25rem 0 0.55rem', fontSize: '0.75rem', color: '#64748b' }}>
                        이 그룹에서 1개만 체크하면 해당 업체를 기준으로 나머지는 합쳐집니다. (기존 업체 우선)
                      </p>
                      {existingCandidates.length > 0 && (
                        <>
                          <h5 style={{ margin: '0 0 0.35rem', fontSize: '0.78rem', color: '#475569' }}>기존 DB 업체</h5>
                          <ul className="lc-crm-result-detail-list">
                            {existingCandidates.map((c) => {
                              const checked = selected?.type === 'existing' && String(selected?.key) === String(c.companyId);
                              return (
                                <li key={`existing-${c.companyId}`} className="lc-crm-result-detail-item success">
                                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', width: '100%' }}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => setHoldGroupSelection((prev) => ({ ...prev, [group.key]: { type: 'existing', key: String(c.companyId) } }))}
                                    />
                                    <span>{c.name || '(이름없음)'} / {c.businessNumber || '-'}</span>
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        </>
                      )}
                      <h5 style={{ margin: '0.45rem 0 0.35rem', fontSize: '0.78rem', color: '#475569' }}>이번 업로드 문제 업체</h5>
                      <ul className="lc-crm-result-detail-list">
                        {group.items.map((item, i) => {
                          const checked = selected?.type === 'hold' && String(selected?.key) === String(item.rowIndex);
                          return (
                            <li key={String(item.rowIndex)} className="lc-crm-result-detail-item skip">
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', width: '100%' }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => setHoldGroupSelection((prev) => ({ ...prev, [group.key]: { type: 'hold', key: String(item.rowIndex) } }))}
                                />
                                <span>
                                  {String(item.companyName || '').trim() || `행 ${(item.rowIndex ?? i) + 1}`}
                                  {item.reason ? ` — 사유: ${item.reason}` : ''}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.55rem' }}>
                        <button
                          type="button"
                          className="lc-crm-result-confirm"
                          onClick={() => handleResolveSingleHoldGroup(group)}
                          disabled={resolvingHold}
                          style={{ minWidth: '7.5rem' }}
                        >
                          {resolvingHold ? '적용 중…' : '이 그룹 적용'}
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            className="lc-crm-result-confirm"
            onClick={async () => {
              const stagedActions = Object.values(stagedHoldGroupActions).flatMap((list) => (Array.isArray(list) ? list : []));
              if (stagedActions.length > 0) {
                const ok = await handleResolveHolds(stagedActions);
                if (!ok) return;
              }
              const unresolved = visibleHoldGroups.length;
              if (unresolved > 0) {
                setSaveMsg(`아직 보류 그룹 ${unresolved}개가 남아 있습니다. 남은 그룹도 적용 후 확인해 주세요.`);
                return;
              }
              handleResultConfirm();
            }}
            disabled={resolvingHold}
          >
            확인
          </button>
          {saveMsg && (
            <p className={`lc-crm-map-save-msg ${saveMsg.includes('실패') || saveMsg.includes('남아') || saveMsg.includes('먼저') ? 'err' : ''}`}>
              {saveMsg}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="lc-crm-map-overlay" role="dialog" aria-modal="true" aria-labelledby="cc-excel-map-title">
      <div className="lc-crm-map-panel" onClick={(e) => e.stopPropagation()}>
        <header className="lc-crm-map-head">
          <div className="lc-crm-map-head-left">
            <button
              type="button"
              className="lc-crm-map-btn-discard"
              onClick={onClose}
              aria-label="뒤로"
              disabled={saving || resolvingHold || !!inProgressJob?.jobId}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '1.25rem', verticalAlign: 'middle' }}>
                arrow_back
              </span>
            </button>
            <h2 id="cc-excel-map-title">엑셀 → 고객사 매핑</h2>
            <span className="lc-crm-map-draft">Excel</span>
            <span className="lc-crm-map-lead-count" title="업로드된 행 수">
              {excelRows.length > 0 ? `${excelRows.length}행` : '파일 없음'}
            </span>
          </div>
          <div className="lc-crm-map-head-actions">
            <button type="button" className="lc-crm-map-btn-discard" onClick={onClose} disabled={saving || resolvingHold || !!inProgressJob?.jobId}>
              닫기
            </button>
            <button type="button" className="lc-crm-map-btn-save" onClick={handleImport} disabled={saving || !!inProgressJob?.jobId}>
              <span className="material-symbols-outlined" style={{ fontSize: '1.1rem' }}>
                play_arrow
              </span>
              {saving ? '처리 중…' : '가져오기'}
            </button>
          </div>
        </header>

        <div className="lc-crm-map-body">
          <div className="lc-crm-map-title-block">
            <h1>고객사 일괄 등록</h1>
            <p className="lc-crm-map-lead-hint">
              엑셀 <strong>첫 행은 헤더</strong>(열 이름)로 사용됩니다. 각 열을 <strong>고객사 필드</strong>에 연결한 뒤{' '}
              <strong>가져오기</strong>를 누르세요. 대상 필드는 서버 스키마에서 자동으로 불러오며, 커스텀 필드가 추가되면
              여기에도 반영됩니다.
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            className="visually-hidden"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void ingestFile(f);
              e.target.value = '';
            }}
          />

          <div
            role="button"
            tabIndex={0}
            className={`cc-excel-dropzone ${dragOver ? 'is-dragover' : ''}`}
            onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            <span className="material-symbols-outlined cc-excel-dropzone-icon">cloud_upload</span>
            <p className="cc-excel-dropzone-title">엑셀 파일을 여기에 놓거나 클릭하여 선택</p>
            <p className="cc-excel-dropzone-hint">.xlsx · .xls · CSV · 최대 500행 (서버 제한)</p>
            {excelFileName ? (
              <div className="cc-excel-file-badge">
                <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>
                  description
                </span>
                {excelFileName}
              </div>
            ) : null}
          </div>

          <p className="lc-crm-map-target-desc" style={{ marginBottom: '1rem' }}>
            미리보기는 <strong>첫 데이터 행</strong> 기준입니다. 열 이름이 바뀌면 소스 매핑을 다시 확인하세요.{' '}
            먼저 <strong>고객사명+사업자번호 중복</strong>을 검사하고, 등록 가능한 행만 <strong>주소</strong> 기준
            Gemini 지오코딩(비어 있는 위·경도만 보강)을 진행합니다.
          </p>
          <p className="lc-crm-map-target-desc" style={{ marginTop: '-0.5rem', marginBottom: '1rem' }}>
            필수 매핑: <strong>사업자 번호, 고객사 명, 대표자명, 주소</strong>
          </p>
          {targetOptions.length === 0 && (
            <p className="lc-crm-map-source-meta" style={{ marginTop: '-0.35rem', marginBottom: '0.85rem', color: '#b45309' }}>
              대상 필드 API 응답이 비어 기본 필드 목록으로 표시 중입니다.
            </p>
          )}
          <div className="add-company-field add-company-field-assignee" style={{ marginBottom: '1rem' }}>
            <label className="add-company-label" htmlFor="cc-import-assignee-input">담당자</label>
            <div className="add-company-assignee-input-wrap">
              <input
                id="cc-import-assignee-input"
                type="text"
                className="add-company-input"
                placeholder="담당자를 선택해 주세요"
                value={assigneeInputValue}
                onChange={(e) => setAssigneeDisplayText(e.target.value)}
              />
              <button
                type="button"
                className="add-company-assignee-search-icon-btn"
                onClick={() => setShowAssigneePicker(true)}
                title="담당자 선택"
                aria-label="담당자 선택"
              >
                <span className="material-symbols-outlined">search</span>
              </button>
            </div>
            {showMeBadge && (
              <div style={{ marginTop: '0.45rem' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    padding: '0.2rem 0.6rem',
                    borderRadius: '999px',
                    background: '#e8f3ff',
                    color: '#295b8c',
                    fontSize: '0.75rem',
                    fontWeight: 700
                  }}
                >
                  나
                </span>
              </div>
            )}
            <p className="lc-crm-map-source-meta" style={{ marginTop: '0.35rem' }}>
              담당자를 선택하지 않으면 로그인한 사용자 본인으로 등록됩니다.
            </p>
          </div>

          <div className="lc-crm-map-table-head">
            <div>소스 필드 (엑셀 열)</div>
            <div />
            <div>대상 필드 (고객사 CRM)</div>
            <div>미리보기</div>
            <div style={{ textAlign: 'right' }}>상태</div>
          </div>

          <div className="lc-crm-map-rows">
            {rows.map((row) => {
              const preview = previewExcelMappedValue(sampleRow, row);
              const st = rowStatus(row, preview, registerTarget);
              const isConst = row.sourceType === 'constant';
              return (
                <div key={row.id} className={`lc-crm-map-row ${isConst ? 'is-constant' : ''}`}>
                  <div className="lc-crm-map-source-cell">
                    <div className="lc-crm-map-icon-box">
                      <span className="material-symbols-outlined" style={{ fontSize: '1.15rem' }}>
                        {isConst ? 'add_circle' : 'input'}
                      </span>
                    </div>
                    <p>{isConst ? '고정값' : '엑셀 열'}</p>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {isConst ? (
                        <input
                          className="lc-crm-map-input"
                          style={{ marginTop: '0.35rem' }}
                          placeholder="값 입력…"
                          value={row.constantValue}
                          onChange={(e) => updateRow(row.id, { constantValue: e.target.value })}
                        />
                      ) : (
                        <>
                          <select
                            className="lc-crm-map-select"
                            value={row.sourceKey}
                            onChange={(e) => updateRow(row.id, { sourceKey: e.target.value })}
                          >
                            <option value="">소스 선택…</option>
                            {sourceOptions.map((s) => (
                              <option key={s.key} value={s.key}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                          <p className="lc-crm-map-source-meta">
                            {sourceOptions.find((x) => x.key === row.sourceKey)?.meta || ''}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="lc-crm-map-connector-wrap" style={{ display: 'flex', alignItems: 'center' }}>
                    <div className="lc-crm-map-connector" />
                  </div>
                  <div>
                    <select
                      className="lc-crm-map-select"
                      value={row.targetKey}
                      onChange={(e) => updateRow(row.id, { targetKey: e.target.value })}
                    >
                      <option value="">대상 선택…</option>
                      {effectiveTargetOptions.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="lc-crm-map-preview">
                    <span className="material-symbols-outlined">visibility</span>
                    <span>{preview || '—'}</span>
                  </div>
                  <div
                    className="lc-crm-map-status"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      gap: '0.35rem',
                      flexWrap: 'wrap'
                    }}
                  >
                    {!isConst && (
                      <span
                        className={`lc-crm-map-badge ${st.type === 'ok' ? 'ok' : st.type === 'warn' ? 'warn' : st.type === 'err' ? 'err' : 'muted'}`}
                      >
                        {st.type === 'ok' && <span className="material-symbols-outlined">check_circle</span>}
                        {st.type === 'warn' && <span className="material-symbols-outlined">priority_high</span>}
                        {st.type === 'err' && <span className="material-symbols-outlined">error</span>}
                        {st.label}
                      </span>
                    )}
                    {rows.length > 1 && (
                      <button
                        type="button"
                        className="lc-crm-map-row-delete"
                        onClick={() => removeRow(row.id)}
                        aria-label="행 삭제"
                      >
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="lc-crm-map-footer-card">
            <div className="lc-crm-map-footer-hint">
              <div className="lc-crm-map-footer-icon">
                <span className="material-symbols-outlined">lightbulb</span>
              </div>
              <div>
                <p>동적 필드</p>
                <span>
                  고객사 스키마·커스텀 필드 정의는 API에서 가져옵니다. 새 필드를 DB에 추가하면 다음에 모달을 열 때 대상
                  목록에 자동 반영됩니다.
                </span>
              </div>
            </div>
            <button type="button" className="lc-crm-map-btn-add-const" onClick={addConstantRow}>
              <span className="material-symbols-outlined" style={{ fontSize: '1.15rem' }}>
                add
              </span>
              고정값 추가
            </button>
          </div>

          <div className="lc-crm-map-summary">
            <div className="lc-crm-map-summary-card">
              <p>매핑된 대상</p>
              <p className="num">
                {summary.mapped} / {rows.length}
              </p>
              <div className="lc-crm-map-bar">
                <div style={{ width: `${rows.length ? Math.min(100, (summary.mapped / rows.length) * 100) : 0}%` }} />
              </div>
            </div>
            <div className="lc-crm-map-summary-card">
              <p>주의</p>
              <p className="num rose">{summary.err}</p>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.65rem', color: '#64748b' }}>
                미리보기 = 첫 데이터 행
              </p>
            </div>
            <div className="lc-crm-map-summary-card">
              <p>등록</p>
              <p className="num" style={{ fontSize: '1rem' }}>
                고객사만
              </p>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.65rem', color: '#64748b' }}>
                중복(상호+사업자번호)은 스킵
              </p>
            </div>
          </div>

          {saveMsg && (
            <p className={`lc-crm-map-save-msg ${saveMsg.includes('실패') || saveMsg.includes('필요') ? 'err' : ''}`}>
              {saveMsg}
            </p>
          )}
        </div>
      </div>
      {showAssigneePicker && (
        <AssigneePickerModal
          open={showAssigneePicker}
          onClose={() => setShowAssigneePicker(false)}
          selectedIds={assigneeUserIds || []}
          onConfirm={(ids) => {
            setAssigneeUserIds(ids || []);
            const names = (ids || []).map((id) => assigneeIdToName[String(id)] || id).join(', ');
            setAssigneeDisplayText(names);
            setShowAssigneePicker(false);
          }}
        />
      )}
    </div>
  );
}
