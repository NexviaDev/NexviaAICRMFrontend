/**
 * 고객사 목록(customer-companies.js)에서 URL `?modal=excel-import`일 때 열립니다.
 * 뒤로가기로 닫히도록 부모가 searchParams로 open/onClose를 제어합니다.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession, getAuthHeader } from '@/lib/crm-auth';
import * as XLSX from 'xlsx';
import { API_BASE } from '@/config';
import {
  getGoogleMapsApiKey,
  loadGoogleMapsPromise,
  geocodeAddressWithGoogleMaps
} from '@/lib/google-maps-client';
import ImportMappingModal from './import-mapping-modal';
import ImportProgressModal from './import-progress-modal';
import ImportResultModal from './import-result-modal';
import '../../lead-capture/lead-capture-crm-mapping/lead-capture-crm-mapping-modal.css';
import './customer-companies-excel-import-modal.css';
import {
  buildTargetOptionsForTarget,
  toApiMappings,
  ensureCompanyMappingRowsComplete,
  appendMissingCompanyCustomFieldRows,
  rowsFromSavedMappings
} from '../../lead-capture/lead-capture-crm-mapping/lead-capture-crm-mapping-utils';
import {
  autoFillSourceKeys,
  buildMappingByHeader,
  assignHeaderToTarget,
  isTargetConnected,
  COMPANY_HEADER_RULES
} from '../../shared/excel-header-match';
import { COMPANY_EXCEL_IMPORT_MAX_ROWS, getRowCountOverflow } from '../../shared/excel-import-limits';
import ExcelRowLimitModal from '../../shared/excel-row-limit-modal';
import { mapWithConcurrency } from '@/lib/map-with-concurrency';

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
  { key: 'company.name', label: '기업명' },
  { key: 'company.representativeName', label: '대표자명' },
  { key: 'company.address', label: '주소' }
];

const FALLBACK_TARGET_OPTIONS = [
  { value: 'company.businessNumber', label: '고객사 · 사업자 번호' },
  { value: 'company.name', label: '고객사 · 기업명' },
  { value: 'company.representativeName', label: '고객사 · 대표자명' },
  { value: 'company.address', label: '고객사 · 주소' },
  { value: 'company.status', label: '고객사 · 상태' },
  { value: 'company.memo', label: '고객사 · 메모' }
];

const GOOGLE_MAPS_API_KEY = getGoogleMapsApiKey();
const CLIENT_GEO_LAT_KEY = '__nexvia_client_latitude__';
const CLIENT_GEO_LNG_KEY = '__nexvia_client_longitude__';
/** 가져오기 직전 클라이언트 지오코딩 동시 요청 상한 */
const EXCEL_IMPORT_GEOCODE_CONCURRENCY = 4;

function digitsOnly(value) {
  if (value == null) return '';
  return String(value).replace(/\D/g, '');
}

function holdBusinessNumberKey(item, fallbackIndex) {
  const fromPayload = digitsOnly(item?.companyPayload?.businessNumber);
  if (fromPayload) return fromPayload;
  const ri = item?.rowIndex;
  if (ri != null && ri !== '') return `no_bn_${String(ri)}`;
  return `no_bn_${fallbackIndex}`;
}

function buildHoldGroups(holdItems) {
  const map = new Map();
  holdItems.forEach((item, idx) => {
    const key = String(holdBusinessNumberKey(item, idx));
    if (!map.has(key)) map.set(key, { key, businessNumber: key.startsWith('no_bn_') ? '' : key, items: [] });
    map.get(key).items.push(item);
  });
  return Array.from(map.values());
}

function buildExistingCandidatesForGroup(group) {
  const map = new Map();
  (group?.items || []).forEach((item) => {
    const list = Array.isArray(item?.conflictCandidates) ? item.conflictCandidates : [];
    list.forEach((candidate) => {
      const id = String(candidate?.companyId || '').trim();
      if (!id || map.has(id)) return;
      map.set(id, {
        companyId: id,
        name: candidate?.name || '',
        businessNumber: candidate?.businessNumber || ''
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
    const ri = Number(item.rowIndex);
    if (!Number.isFinite(ri)) return;
    if (picked.type === 'existing') {
      actions.push({
        rowIndex: ri,
        action: 'merge',
        targetCompanyId: String(picked.key || ''),
        targetHoldRowIndex: ''
      });
    } else {
      const isPickedHold = String(item.rowIndex) === String(picked.key || '');
      actions.push({
        rowIndex: ri,
        action: isPickedHold ? 'add' : 'merge',
        targetCompanyId: '',
        targetHoldRowIndex: isPickedHold ? '' : String(picked.key || '')
      });
    }
  });
  return actions;
}

function readMappedExcelValue(excelRow, mapping) {
  if (!mapping) return '';
  if (mapping.sourceType === 'constant') return mapping.constantValue ?? '';
  if (!mapping.sourceKey) return '';
  return excelRow && typeof excelRow === 'object' ? excelRow[mapping.sourceKey] ?? '' : '';
}

function readCompanyFieldValueFromExcelRow(excelRow, mappings, targetKey) {
  const mapping = (mappings || []).find((item) => String(item?.targetKey || '') === targetKey);
  const value = readMappedExcelValue(excelRow, mapping);
  return value == null ? '' : String(value).trim();
}

function applyResolvedActionsToPreviewResults(results, actions) {
  const list = Array.isArray(results) ? results : [];
  const actionList = Array.isArray(actions) ? actions : [];
  const actionByRowIndex = new Map(
    actionList
      .map((action) => [Number(action?.rowIndex), action])
      .filter(([rowIndex]) => Number.isFinite(rowIndex))
  );

  return list.map((item) => {
    const rowIndex = Number(item?.rowIndex);
    const action = actionByRowIndex.get(rowIndex);
    if (!action) return item;
    return {
      ...item,
      hold: false,
      previewPending: true,
      previewResolved: true,
      previewResolvedAction: String(action.action || ''),
      previewResolvedTargetCompanyId: String(action.targetCompanyId || ''),
      previewResolvedTargetHoldRowIndex: String(action.targetHoldRowIndex || ''),
      reason: '',
      code: action.action === 'add' ? 'hold_resolved_add_preview' : 'hold_resolved_merge_preview'
    };
  });
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

/** POST /import-excel/preview 응답 → 결과 모달용 results (아직 MongoDB 반영 전) */
function mapPreviewResultsToUiResults(previewResults) {
  const results = [];
  for (const pr of previewResults) {
    const i = pr.rowIndex;
    const name = (pr.companyName || '').trim();
    if (pr.kind === 'create') {
      results.push({
        rowIndex: i,
        ok: true,
        companyName: name,
        previewPending: true,
        businessNumber: pr.businessNumber || '',
        /** 같은 사업자번호·기업명으로 이 행에 합쳐질 행 수 */
        mergedRowCount: pr.mergedRowCount || 0,
        /** 합칠 때 값이 서로 달라 첫 값을 쓰는 칸 */
        fieldDiffs: Array.isArray(pr.fieldDiffs) ? pr.fieldDiffs : [],
        businessNumberInvalid: !!pr.businessNumberInvalid,
        businessNumberCleared: !!pr.businessNumberCleared
      });
    } else if (pr.kind === 'merge') {
      results.push({ rowIndex: i, ok: true, skipped: 'merged', companyName: name, mergeIntoRowIndex: pr.mergeIntoRowIndex });
    } else if (pr.kind === 'conflict') {
      // 사업자번호는 같은데 기업명이 다름 — 사용자 선택 전까지 등록 불가 (예전 hold 흐름과 섞이지 않게 별도 플래그)
      results.push({ rowIndex: i, ok: true, bnConflict: true, conflictKey: pr.conflictKey, companyName: name, businessNumber: pr.businessNumber || '' });
    } else if (pr.kind === 'conflict_skipped') {
      results.push({ rowIndex: i, ok: true, skipped: 'bn_conflict', conflictKey: pr.conflictKey, companyName: name });
    } else if (pr.kind === 'error') {
      results.push({ rowIndex: i, ok: false, error: pr.error, companyName: name });
    } else if (pr.kind === 'empty') {
      results.push({ rowIndex: i, ok: true, skipped: 'empty_row', companyName: '' });
    } else if (pr.kind === 'duplicate') {
      // 사업자번호가 DB 또는 같은 파일 앞 행과 같아 건너뛸 행 (서버 job 결과와 같은 모양)
      results.push({
        rowIndex: i,
        ok: true,
        skipped: 'duplicate_company',
        companyName: name,
        businessNumber: pr.businessNumber || '',
        duplicateOf: pr.duplicateOf || null
      });
    } else {
      results.push({ rowIndex: i, ok: false, error: '잘못된 행', companyName: name });
    }
  }
  return results;
}

function buildPreviewSummary(previewResults) {
  let created = 0;
  let merged = 0;
  let skippedDuplicateCompany = 0;
  let conflictRows = 0;
  let conflictSkipped = 0;
  let invalidBusinessNumber = 0;
  let onHold = 0;
  let failed = 0;
  let emptySkipped = 0;
  for (const p of previewResults) {
    if (p.kind === 'create') {
      created += 1;
      if (p.businessNumberInvalid) invalidBusinessNumber += 1;
    } else if (p.kind === 'merge') merged += 1;
    else if (p.kind === 'duplicate') skippedDuplicateCompany += 1;
    else if (p.kind === 'conflict') conflictRows += 1;
    else if (p.kind === 'conflict_skipped') conflictSkipped += 1;
    else if (p.kind === 'error') failed += 1;
    else if (p.kind === 'empty') emptySkipped += 1;
    else failed += 1;
  }
  return {
    total: previewResults.length,
    created,
    merged,
    skippedDuplicateCompany,
    conflictRows,
    conflictSkipped,
    invalidBusinessNumber,
    onHold,
    failed,
    emptySkipped,
    registerTarget: 'company'
  };
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
  /** 가져오기 클릭 후 서버 미리보기 API 대기 중 — 이 동안만 별도 모달 표시 */
  const [previewChecking, setPreviewChecking] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  /** 행 수 상한 초과 안내 모달 ({ rowCount, maxRows, fileName, unitLabel } | null) */
  const [rowLimitNotice, setRowLimitNotice] = useState(null);
  const [importResult, setImportResult] = useState(null);
  /** 사업자번호 충돌 선택 { [번호]: { mode: 'keep', nameKey } | { mode: 'all' } } */
  const [bnConflictResolutions, setBnConflictResolutions] = useState({});
  /** 충돌 선택을 반영해 미리보기를 다시 계산하는 중 */
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [inProgressJob, setInProgressJob] = useState(null);
  const [resolvedHoldActions, setResolvedHoldActions] = useState([]);
  const [appliedHoldGroupKeys, setAppliedHoldGroupKeys] = useState({});
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [companyEmployeesForDisplay, setCompanyEmployeesForDisplay] = useState([]);
  const [assigneeDisplayText, setAssigneeDisplayText] = useState(undefined);
  const [assigneeUserIds, setAssigneeUserIds] = useState(() => {
    const id = getCurrentUserId();
    return id ? [id] : [];
  });
  const previewRawSessionRef = useRef(null);
  /** 자동 매핑 행 추가를 파일당 한 번만 수행하기 위한 서명 */
  const autoExpandSignatureRef = useRef('');
  /** 사용자가 확인을 눌러 실제 저장을 시작한 현재 작업만 폴링 결과로 반영 */
  const activeImportJobRef = useRef(null);

  const registerTarget = 'company';

  const excelHeaders = useMemo(() => {
    if (!excelRows.length) return [];
    const keys = Object.keys(excelRows[0] || {});
    return keys.filter((k) => k !== '__rowNum__');
  }, [excelRows]);

  const targetOptions = useMemo(
    () => buildTargetOptionsForTarget(registerTarget, companySchemaFields, companyCustomDefs),
    [companySchemaFields, companyCustomDefs]
  );
  const effectiveTargetOptions = useMemo(
    () => (Array.isArray(targetOptions) && targetOptions.length > 0 ? targetOptions : FALLBACK_TARGET_OPTIONS),
    [targetOptions]
  );


  /**
   * 파일을 올리거나 바꿀 때 엑셀 헤더를 보고 대상 필드에 열을 자동 연결합니다.
   * 기본 매핑 행의 sourceKey 는 리드 캡처 폼 키(customFields.company 등)라
   * 엑셀 파일에는 존재하지 않습니다 — 자동 매칭이 없으면 필수 4개를 전부 손으로 골라야 합니다.
   */
  useEffect(() => {
    if (!open || !excelHeaders.length) return;
    // 대응 필드가 있는데 기본 매핑 행이 없는 열(업종 등)은 행을 새로 만들어 연결합니다.
    // 단 파일·대상옵션이 그대로인 동안에는 한 번만 — 사용자가 뺀 열이 되살아나면 안 됩니다.
    const signature = `${JSON.stringify(excelHeaders)}|${effectiveTargetOptions.length}`;
    const alreadyExpanded = autoExpandSignatureRef.current === signature;
    autoExpandSignatureRef.current = signature;
    setRows((prev) =>
      autoFillSourceKeys(prev, excelHeaders, COMPANY_HEADER_RULES, {
        customFieldDefs: companyCustomDefs,
        availableTargetKeys: alreadyExpanded ? undefined : effectiveTargetOptions.map((o) => o.value),
        makeRowId: newRowId
      })
    );
  }, [open, excelHeaders, companyCustomDefs, effectiveTargetOptions]);

  /** 시트 미리보기 열 헤더에 "이 열 → 어떤 필드" 상태를 보여 주기 위한 역방향 맵 */
  const mappingByHeader = useMemo(() => buildMappingByHeader(rows), [rows]);

  const handleMapHeader = useCallback((header, targetKey) => {
    setRows((prev) => assignHeaderToTarget(prev, header, targetKey, newRowId));
  }, []);

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
        fetch(`${API_BASE}/custom-field-definitions?entityType=customerCompany`, crmFetchInit()).then((r) => r.json()),
        fetch(`${API_BASE}/lead-capture-forms/crm-mappable-fields`, crmFetchInit()).then((r) => r.json())
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

  // 이 모달은 고객사 목록에 항상 마운트돼 있습니다(open 으로만 표시 제어).
  // open 가드가 없으면 모달을 열지 않아도 목록 진입 때마다 이 요청이 나갑니다.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    fetch(`${API_BASE}/companies/overview`, crmFetchInit())
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.employees)) setCompanyEmployeesForDisplay(data.employees);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setRowLimitNotice(null);
      setBnConflictResolutions({});
      setResolvingConflict(false);
      setExcelRows([]);
      setExcelFileName('');
      setDragOver(false);
      setSaveMsg(null);
      setImportResult(null);
      setInProgressJob(null);
      setShowAssigneePicker(false);
      activeImportJobRef.current = null;
      return;
    }
    setSaveMsg(null);
    setImportResult(null);
    setInProgressJob(null);
    setResolvedHoldActions([]);
    setAppliedHoldGroupKeys({});
    activeImportJobRef.current = null;
    autoExpandSignatureRef.current = '';
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
      // 상한 초과는 올린 직후에 알려 줍니다.
      // (예전에는 매핑·미리보기를 다 끝낸 뒤 서버에서 거절당했습니다.)
      const overLimit = getRowCountOverflow(parsed.length, COMPANY_EXCEL_IMPORT_MAX_ROWS, { fileName: file.name });
      if (overLimit) {
        // 인라인 문구 대신 모달로 안내합니다 (눈에 띄지 않아 놓치기 쉬웠음).
        setSaveMsg(null);
        setRowLimitNotice(overLimit);
        setExcelRows([]);
        setExcelFileName('');
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
    // 매핑 행이 있는지가 아니라 실제로 열(또는 고정값)이 연결됐는지로 판단합니다.
    // 기본 매핑 행은 파일에 맞는 열이 없어도 항상 있어서, 예전 검사는 늘 통과했습니다.
    const missingRequired = REQUIRED_TARGETS.filter((target) => !isTargetConnected(rows, excelHeaders, target.key));
    if (missingRequired.length > 0) {
      const missingLabels = missingRequired.map((item) => item.label).join(', ');
      setSaveMsg(`필수 매핑 누락: ${missingLabels}`);
      return;
    }

    setPreviewChecking(true);
    setSaveMsg(null);
    setInProgressJob(null);
    setImportResult(null);
    setResolvedHoldActions([]);
    setAppliedHoldGroupKeys({});
    setBnConflictResolutions({});
    activeImportJobRef.current = null;
    try {
      setImportResult(await requestPreview({}));
    } catch (e) {
      setSaveMsg(e.message || '실패');
    } finally {
      setPreviewChecking(false);
    }
  };

  /** 미리보기 요청 — 사업자번호 충돌 선택이 바뀌면 같은 파일로 다시 계산합니다(서버가 판정 기준). */
  const requestPreview = async (resolutions) => {
    const previewRes = await fetch(`${API_BASE}/customer-companies/import-excel/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      credentials: 'include',
      body: JSON.stringify({
        mappings: toApiMappings(rows),
        rows: excelRows,
        assigneeUserIds: Array.isArray(assigneeUserIds) && assigneeUserIds.length > 0 ? assigneeUserIds : undefined,
        businessNumberConflictResolutions: resolutions
      })
    });
    const previewData = await previewRes.json().catch(() => ({}));
    if (!previewRes.ok) throw new Error(previewData.error || '미리보기에 실패했습니다.');
    const list = Array.isArray(previewData.results) ? previewData.results : [];
    return {
      phase: 'preview',
      rawPreviewResults: list,
      conflicts: previewData.conflicts && typeof previewData.conflicts === 'object' ? previewData.conflicts : {},
      summary: buildPreviewSummary(list),
      results: mapPreviewResultsToUiResults(list)
    };
  };

  const handleResolveConflict = async (bnKey, resolution) => {
    const prev = bnConflictResolutions;
    const next = { ...prev, [bnKey]: resolution };
    setBnConflictResolutions(next);
    setResolvingConflict(true);
    setSaveMsg(null);
    try {
      setImportResult(await requestPreview(next));
    } catch (e) {
      // 재계산에 실패하면 화면의 선택과 미리보기 숫자가 어긋나므로 선택을 되돌립니다.
      setBnConflictResolutions(prev);
      // 결과 화면은 문구에 "실패"가 있어야 오류 색으로 보여 줍니다.
      setSaveMsg(`충돌 선택 반영에 실패했습니다. 다시 선택해 주세요. (${e.message || '알 수 없는 오류'})`);
    } finally {
      setResolvingConflict(false);
    }
  };

  const geocodeAddressForImport = useCallback(async (google, address) => {
    const addr = String(address || '').trim();
    if (!addr) return null;

    const clientCoords = google ? await geocodeAddressWithGoogleMaps(google, addr) : null;
    if (clientCoords?.latitude != null && clientCoords?.longitude != null) {
      return clientCoords;
    }

    const geoRes = await fetch(`${API_BASE}/customer-companies/geocode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      credentials: 'include',
      body: JSON.stringify({ address: addr })
    });
    const geoData = await geoRes.json().catch(() => ({}));
    if (!geoRes.ok) {
      throw new Error(geoData.error || `주소 좌표 계산 실패: ${addr}`);
    }
    if (geoData.latitude == null || geoData.longitude == null) {
      throw new Error(`주소 좌표를 찾을 수 없습니다: ${addr}`);
    }
    return {
      latitude: Number(geoData.latitude),
      longitude: Number(geoData.longitude)
    };
  }, []);

  const buildClientGeocodedImportPayload = useCallback(async () => {
    const mappings = toApiMappings(rows);
    const previewRows = Array.isArray(importResult?.rawPreviewResults) ? importResult.rawPreviewResults : [];
    if (previewRows.length === 0) {
      throw new Error('미리보기 데이터가 없습니다. 다시 가져오기를 눌러 주세요.');
    }

    const rowsToGeocode = previewRows.filter((item) => item?.kind === 'create');
    if (rowsToGeocode.length === 0) {
      return { mappings, rows: excelRows, geocodedCount: 0 };
    }

    const enrichedRows = excelRows.map((row) => (
      row && typeof row === 'object' ? { ...row } : row
    ));
    const hasLatitudeMapping = mappings.some((m) => String(m?.targetKey || '') === 'company.latitude');
    const hasLongitudeMapping = mappings.some((m) => String(m?.targetKey || '') === 'company.longitude');
    const google = GOOGLE_MAPS_API_KEY ? await loadGoogleMapsPromise() : null;
    let geocodedCount = 0;
    let firstGeocodeError = '';
    let addressedRows = 0;

    const geoResults = await mapWithConcurrency(rowsToGeocode, EXCEL_IMPORT_GEOCODE_CONCURRENCY, async (item) => {
      const rowIndex = Number(item?.rowIndex);
      if (!Number.isFinite(rowIndex) || !enrichedRows[rowIndex] || typeof enrichedRows[rowIndex] !== 'object') {
        return { type: 'skip' };
      }
      const address =
        String(item?.companyPayload?.address || '').trim() ||
        readCompanyFieldValueFromExcelRow(enrichedRows[rowIndex], mappings, 'company.address');
      if (!address) return { type: 'skip' };
      try {
        const coords = await geocodeAddressForImport(google, address);
        if (!coords) return { type: 'no_coords' };
        return { type: 'ok', rowIndex, coords };
      } catch (e) {
        return { type: 'err', error: e.message || '위도·경도 계산 실패' };
      }
    });

    for (const r of geoResults) {
      if (r.type === 'skip') continue;
      if (r.type === 'no_coords' || r.type === 'ok' || r.type === 'err') addressedRows += 1;
      if (r.type === 'ok' && r.coords && Number.isFinite(r.rowIndex)) {
        enrichedRows[r.rowIndex][CLIENT_GEO_LAT_KEY] = r.coords.latitude;
        enrichedRows[r.rowIndex][CLIENT_GEO_LNG_KEY] = r.coords.longitude;
        geocodedCount += 1;
      } else if (r.type === 'err' && r.error && !firstGeocodeError) {
        firstGeocodeError = r.error;
      }
    }

    if (addressedRows > 0 && geocodedCount === 0 && firstGeocodeError) {
      throw new Error(firstGeocodeError);
    }

    const nextMappings = [...mappings];
    if (geocodedCount > 0) {
      if (!hasLatitudeMapping) {
        nextMappings.push({
          sourceType: 'field',
          sourceKey: CLIENT_GEO_LAT_KEY,
          constantValue: '',
          targetKey: 'company.latitude'
        });
      }
      if (!hasLongitudeMapping) {
        nextMappings.push({
          sourceType: 'field',
          sourceKey: CLIENT_GEO_LNG_KEY,
          constantValue: '',
          targetKey: 'company.longitude'
        });
      }
    }

    return { mappings: nextMappings, rows: enrichedRows, geocodedCount };
  }, [excelRows, importResult, rows, geocodeAddressForImport]);

  const commitExcelImport = useCallback(
    async ({ stagedActions = [], mappingsOverride, rowsOverride, startMessage } = {}) => {
      const previewRows = Array.isArray(importResult?.rawPreviewResults) ? importResult.rawPreviewResults : [];
      if (previewRows.length === 0) {
        setSaveMsg('미리보기 데이터가 없습니다. 다시 가져오기를 눌러 주세요.');
        return;
      }

      const mappings = Array.isArray(mappingsOverride) && mappingsOverride.length > 0 ? mappingsOverride : toApiMappings(rows);
      const importRows = Array.isArray(rowsOverride) && rowsOverride.length > 0 ? rowsOverride : excelRows;

      setSaving(true);
      setSaveMsg(startMessage || '서버에 등록 중입니다…');
      try {
        const res = await fetch(`${API_BASE}/customer-companies/import-excel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          credentials: 'include',
          body: JSON.stringify({
            mappings,
            rows: importRows,
            assigneeUserIds: Array.isArray(assigneeUserIds) && assigneeUserIds.length > 0 ? assigneeUserIds : undefined,
            holdResolutions: Array.isArray(stagedActions) ? stagedActions : [],
            // 서버 job 이 미리보기와 같은 선택으로 판정하도록 함께 보냅니다.
            businessNumberConflictResolutions: bnConflictResolutions
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '가져오기 실패');

        setImportResult(null);
        setResolvedHoldActions([]);
        setAppliedHoldGroupKeys({});

        if (res.status === 202 && data.jobId) {
          activeImportJobRef.current = String(data.jobId);
          setInProgressJob({
            jobId: data.jobId,
            totalRows: data.totalRows ?? importRows.length,
            processedRows: 0,
            processingStats: null
          });
          setSaveMsg('처리 중입니다. 완료될 때까지 이 화면을 유지해 주세요.');
          return;
        }

        setSaveMsg(null);
        setImportResult(data);
      } catch (e) {
        setSaveMsg(e.message || '실패');
      } finally {
        setSaving(false);
      }
    },
    [rows, excelRows, assigneeUserIds, importResult, bnConflictResolutions]
  );

  const handleResultConfirm = useCallback(async () => {
    if (importResult?.phase === 'preview') {
      const results = Array.isArray(importResult.results) ? importResult.results : [];
      const stagedActions = Array.isArray(resolvedHoldActions) ? resolvedHoldActions : [];
      setSaving(true);
      try {
        const { mappings, rows: importRows, geocodedCount } = await buildClientGeocodedImportPayload();
        await commitExcelImport({
          stagedActions,
          mappingsOverride: mappings,
          rowsOverride: importRows,
          startMessage:
            geocodedCount > 0
              ? `위도·경도 ${geocodedCount}건 계산 후 서버에 등록 중입니다…`
              : '좌표 계산 가능한 주소가 없어 원본 데이터로 서버 등록을 진행합니다…'
        });
      } catch (e) {
        setSaveMsg(e.message || '위도·경도 계산 또는 등록 준비에 실패했습니다.');
        setSaving(false);
      }
      return;
    }

    if (importResult) onImported?.(importResult);
    setImportResult(null);
    setResolvedHoldActions([]);
    setAppliedHoldGroupKeys({});
    onClose?.();
  }, [importResult, onClose, onImported, resolvedHoldActions, buildClientGeocodedImportPayload, commitExcelImport]);

  useEffect(() => {
    if (!inProgressJob?.jobId || !open) return;
    let stopped = false;
    const run = async () => {
      try {
        const res = await fetch(`${API_BASE}/customer-companies/import-excel/jobs/${inProgressJob.jobId}`, crmFetchInit());
        const data = await res.json().catch(() => ({}));
        if (!res.ok || stopped) return;
        if (!activeImportJobRef.current) return;
        if (String(inProgressJob.jobId) !== String(activeImportJobRef.current)) return;
        if (data.status === 'completed' || data.status === 'failed') {
          activeImportJobRef.current = null;
          setInProgressJob(null);
          setSaveMsg(null);
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
    if (!importResult) {
      previewRawSessionRef.current = null;
      return;
    }
    const raw = importResult.rawPreviewResults;
    const isPreview = importResult.phase === 'preview';
    if (!isPreview || !Array.isArray(raw)) {
      if (!isPreview) previewRawSessionRef.current = null;
      return;
    }
    if (previewRawSessionRef.current === raw) {
      return;
    }
    previewRawSessionRef.current = raw;

    const results = Array.isArray(importResult.results) ? importResult.results : [];
    const holdItems = results.filter((r) => r && r.hold);
    const groups = buildHoldGroups(holdItems);

    let allActions = [];
    const appliedKeys = {};
    groups.forEach((g) => {
      const existing = buildExistingCandidatesForGroup(g);
      const selected =
        existing.length > 0
          ? { type: 'existing', key: String(existing[0].companyId) }
          : { type: 'hold', key: String(g.items[0].rowIndex) };
      const actions = buildResolveActionsForGroup(g, selected);
      allActions = allActions.concat(actions);
      appliedKeys[g.key] = true;
    });
    setResolvedHoldActions(allActions);
    setAppliedHoldGroupKeys(appliedKeys);
    if (allActions.length > 0) {
      setImportResult((prev) => {
        if (!prev || prev.phase !== 'preview') return prev;
        return {
          ...prev,
          results: applyResolvedActionsToPreviewResults(prev.results, allActions)
        };
      });
    } else {
      setResolvedHoldActions([]);
      setAppliedHoldGroupKeys({});
    }
  }, [importResult]);

  if (!open) return null;

  if (previewChecking) {
    return (
      <div className="lc-crm-map-overlay cc-excel-import-modal" role="dialog" aria-modal="true">
        <div className="lc-crm-result-panel" onClick={(e) => e.stopPropagation()}>
          <div className="lc-crm-result-icon-wrap">
            <span className="material-symbols-outlined lc-crm-result-icon" style={{ color: '#3d5a80' }}>
              sync
            </span>
          </div>
          <h2 className="lc-crm-result-title">매칭 처리 중입니다</h2>
          <p className="lc-crm-result-sub">행별 미리보기를 준비하고 있습니다. 잠시만 기다려 주세요…</p>
          <p className="lc-crm-map-save-msg" style={{ marginTop: '0.75rem', color: '#64748b' }}>
            이 단계에서는 위·경도를 계산하지 않습니다.
          </p>
        </div>
      </div>
    );
  }

  if (inProgressJob?.jobId) {
    return <ImportProgressModal inProgressJob={inProgressJob} />;
  }

  if (importResult) {
    const isPreviewPhase = importResult.phase === 'preview';
    const s = importResult.summary || {};
    const results = Array.isArray(importResult.results) ? importResult.results : [];
    const created = s.created ?? 0;
    const completedResolved = (s.holdResolvedAdd ?? 0) + (s.holdResolvedMerge ?? 0);
    const stagedCompleted = Array.isArray(resolvedHoldActions) ? resolvedHoldActions.length : 0;
    const previewNewPlanned = s.created ?? 0;
    const completedTotal = created + completedResolved + stagedCompleted;
    const skippedDup = s.skippedDuplicateCompany ?? 0;
    const emptySk = s.emptySkipped ?? 0;
    const skipped = skippedDup + emptySk;
    const failed = s.failed ?? 0;
    const total = s.total ?? results.length;
    const failedItems = results.filter((r) => !r.ok);
    const skippedItems = results.filter((r) => r.ok && r.skipped);
    const holdItems = results.filter((r) => r && r.hold);
    const allHoldGroups = buildHoldGroups(holdItems);
    const visibleHoldGroups = allHoldGroups.filter((group) => !appliedHoldGroupKeys[group.key]);
    const onHoldRemaining = visibleHoldGroups.reduce((acc, g) => acc + g.items.length, 0);
    const onHold = isPreviewPhase
      ? onHoldRemaining
      : (s.onHold ?? results.filter((r) => r && r.hold).length);
    const stagedResolvedItems = allHoldGroups
      .filter((group) => appliedHoldGroupKeys[group.key])
      .flatMap((group) => group.items || []);
    const previewReadyCount = previewNewPlanned + stagedResolvedItems.length;
    // 사업자번호 충돌은 선택해야 확정할 수 있습니다.
    const conflictList = isPreviewPhase ? Object.values(importResult.conflicts || {}) : [];
    const unresolvedConflictCount = conflictList.filter((c) => !bnConflictResolutions[c.bnKey]).length;
    const canConfirmPreview = isPreviewPhase && onHoldRemaining === 0 && unresolvedConflictCount === 0 && !resolvingConflict;
    const successItems = isPreviewPhase
      ? results.filter((r) => r.ok && r.previewPending)
      : results.filter((r) => r.ok && !r.skipped && !r.hold);
    // 많이 합쳐지는 묶음부터 보여 줍니다.
    const mergeGroups = isPreviewPhase
      ? results.filter((r) => r.previewPending && r.mergedRowCount > 0).sort((a, b) => b.mergedRowCount - a.mergedRowCount)
      : [];
    const invalidBnItems = isPreviewPhase
      ? results.filter((r) => r.previewPending && r.businessNumberInvalid)
      : results.filter((r) => r.code === 'business_number_invalid');

    return (
      <ImportResultModal
        isPreviewPhase={isPreviewPhase}
        failed={failed}
        total={total}
        previewReadyCount={previewReadyCount}
        completedTotal={completedTotal}
        skipped={skipped}
        onHold={onHold}
        failedItems={failedItems}
        skippedDup={skippedDup}
        duplicateItems={results.filter((r) => r && r.skipped === 'duplicate_company')}
        mergedCount={s.merged ?? 0}
        mergeGroups={mergeGroups}
        conflicts={conflictList}
        conflictResolutions={bnConflictResolutions}
        onResolveConflict={handleResolveConflict}
        resolvingConflict={resolvingConflict}
        conflictSkipped={s.conflictSkipped ?? 0}
        invalidBnItems={invalidBnItems}
        emptySk={emptySk}
        successItems={successItems}
        stagedResolvedItems={stagedResolvedItems}
        saving={saving}
        canConfirmPreview={canConfirmPreview}
        onConfirm={handleResultConfirm}
        saveMsg={saveMsg}
      />
    );
  }

  return (
    <>
      <ImportMappingModal
        onClose={onClose}
        saving={saving}
        previewChecking={previewChecking}
        inProgressJob={inProgressJob}
        onImport={handleImport}
        excelRows={excelRows}
        fileInputRef={fileInputRef}
        ingestFile={ingestFile}
        dragOver={dragOver}
        setDragOver={setDragOver}
        onDrop={onDrop}
        excelFileName={excelFileName}
        excelHeaders={excelHeaders}
        mappingByHeader={mappingByHeader}
        onMapHeader={handleMapHeader}
        targetOptions={targetOptions}
        assigneeInputValue={assigneeInputValue}
        onAssigneeInputChange={setAssigneeDisplayText}
        onOpenAssigneePicker={() => setShowAssigneePicker(true)}
        showMeBadge={showMeBadge}
        rows={rows}
        effectiveTargetOptions={effectiveTargetOptions}
        requiredTargets={REQUIRED_TARGETS}
        updateRow={updateRow}
        removeRow={removeRow}
        addConstantRow={addConstantRow}
        saveMsg={saveMsg}
        showAssigneePicker={showAssigneePicker}
        assigneeUserIds={assigneeUserIds}
        assigneeIdToName={assigneeIdToName}
        onCloseAssigneePicker={() => setShowAssigneePicker(false)}
        onConfirmAssigneePicker={(ids) => {
          setAssigneeUserIds(ids || []);
          const names = (ids || []).map((id) => assigneeIdToName[String(id)] || id).join(', ');
          setAssigneeDisplayText(names);
          setShowAssigneePicker(false);
        }}
      />
      <ExcelRowLimitModal notice={rowLimitNotice} onClose={() => setRowLimitNotice(null)} />
    </>
  );
}
