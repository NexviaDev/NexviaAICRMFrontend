/**
 * 연락처 목록(customer-company-employees.js)에서 URL `?modal=excel-import`일 때 열립니다.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { API_BASE } from '@/config';
import ContactExcelImportMappingModal from './contact-excel-import-mapping-modal';
import ContactImportPreviewModal from '../add-customer-company-employees-modal/contact-import-preview-modal';
import BulkContactDuplicateReviewModal from '../add-customer-company-employees-modal/bulk-contact-duplicate-review-modal';
import ImportResultModal from '../../customer-companies/customer-companies-excel-import-modal/import-result-modal';
import { normalizeBulkImportCompanyGroupKey } from '@/lib/bulk-import-company-group-key';
import '../../lead-capture/lead-capture-crm-mapping/lead-capture-crm-mapping-modal.css';
import '../../customer-companies/customer-companies-excel-import-modal/customer-companies-excel-import-modal.css';
import {
  buildTargetOptionsForTarget,
  toApiMappings,
  rowStatus,
  ensureContactMappingRowsComplete,
  appendMissingContactCustomFieldRows,
  rowsFromSavedMappings,
  BUSINESS_CARD_AUTO_TARGET
} from '../../lead-capture/lead-capture-crm-mapping/lead-capture-crm-mapping-utils';
import { buildExcelSourceOptions, previewExcelMappedValue } from '../../customer-companies/customer-companies-excel-import-modal/excel-import-mapping-utils';

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

function formatPhoneInput(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.startsWith('010') && digits.length <= 11) {
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
  }
  if (digits.startsWith('02') && digits.length <= 10) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

const FALLBACK_TARGET_OPTIONS = [
  { value: 'contact.name', label: '연락처 · 이름' },
  { value: 'contact.email', label: '연락처 · 이메일' },
  { value: 'contact.phone', label: '연락처 · 전화' },
  { value: 'contact.companyName', label: '연락처 · 회사명(자유 입력)' },
  { value: 'contact.position', label: '연락처 · 직책' },
  { value: 'contact.address', label: '연락처 · 주소' },
  { value: 'contact.birthDate', label: '연락처 · 생년월일' },
  { value: 'contact.status', label: '연락처 · 상태' },
  { value: 'contact.memo', label: '연락처 · 메모' }
];

function readMappedExcelValue(excelRow, mapping) {
  if (!mapping) return '';
  if (mapping.sourceType === 'constant') return mapping.constantValue ?? '';
  if (!mapping.sourceKey) return '';
  return excelRow && typeof excelRow === 'object' ? excelRow[mapping.sourceKey] ?? '' : '';
}

function stripContactMappingRows(rows) {
  return (rows || []).filter((r) => r.targetKey !== BUSINESS_CARD_AUTO_TARGET);
}

function buildContactPayloadFromExcelRow(excelRow, mappings) {
  const vals = {};
  for (const m of mappings) {
    const key = m.targetKey;
    if (!key || !String(key).startsWith('contact.')) continue;
    const raw = readMappedExcelValue(excelRow, m);
    vals[key] = raw == null ? '' : String(raw).trim();
  }

  const name = (vals['contact.name'] || '').replace(/\s/g, '').trim();
  const email = (vals['contact.email'] || '').trim();
  let phone = formatPhoneInput(vals['contact.phone'] || '');
  const position = (vals['contact.position'] || '').trim();
  const companyName = (vals['contact.companyName'] || '').trim();
  const address = (vals['contact.address'] || '').trim();
  const birthDate = (vals['contact.birthDate'] || '').trim();
  let status = (vals['contact.status'] || '').trim() || 'Lead';
  const memo = (vals['contact.memo'] || '').trim();

  const customFields = {};
  for (const [k, v] of Object.entries(vals)) {
    if (k.startsWith('contact.customFields.')) {
      const ck = k.replace('contact.customFields.', '');
      if (v) customFields[ck] = v;
    }
  }

  const hasName = !!name;
  const hasEmail = !!email;
  const hasPhone = !!phone;
  if (!hasName && !hasEmail && !hasPhone) return null;

  const payload = {
    name,
    email,
    phone,
    position: position || undefined,
    address: address || undefined,
    birthDate: birthDate || undefined,
    status: status || 'Lead',
    memo: memo || undefined
  };
  if (Object.keys(customFields).length) payload.customFields = customFields;

  if (companyName) {
    payload.customerCompanyId = null;
    payload.companyName = companyName;
  } else {
    payload.isIndividual = true;
    payload.customerCompanyId = null;
    payload.companyName = '';
  }

  return payload;
}

function buildPreviewRowFromContactPayload(payload, rowIndex) {
  return {
    rowIndex,
    name: payload.name || '',
    email: payload.email || '',
    phone: payload.phone || '',
    position: payload.position || '',
    address: payload.address || '',
    birthDate: payload.birthDate || '',
    memo: payload.memo || '',
    status: payload.status || 'Lead',
    customFields: payload.customFields || {},
    companyName: payload.companyName || '',
    customerCompanyId: payload.customerCompanyId || null,
    linkedCompany: null,
    companyStatus: 'active',
    companyCustomFields: {}
  };
}

function buildPreflightEntryFromPreviewRow(row) {
  return {
    name: String(row.name || '').replace(/\s/g, '').trim(),
    phone: row.phone ? formatPhoneInput(String(row.phone)) : '',
    companyName: (row.companyName || row.linkedCompany?.name || '').trim(),
    customerCompanyId: row.customerCompanyId != null ? String(row.customerCompanyId).trim() : ''
  };
}

function rowNeedsContactDuplicateHold(preflightResult) {
  if (!preflightResult) return false;
  return (preflightResult.contactCandidates || []).length > 0;
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

function digitsOnly(value) {
  if (value == null) return '';
  return String(value).replace(/\D/g, '');
}

function holdContactGroupKey(item, fallbackIndex) {
  const phoneDigits = digitsOnly(item?.contactPayload?.phone);
  if (phoneDigits) return `phone_${phoneDigits}`;
  const email = String(item?.contactPayload?.email || '').trim().toLowerCase();
  if (email) return `email_${email}`;
  const ri = item?.rowIndex;
  if (ri != null && ri !== '') return `row_${String(ri)}`;
  return `row_${fallbackIndex}`;
}

function buildHoldGroups(holdItems) {
  const map = new Map();
  holdItems.forEach((item, idx) => {
    const key = String(holdContactGroupKey(item, idx));
    if (!map.has(key)) {
      map.set(key, {
        key,
        businessNumber: key.replace(/^phone_/, '').replace(/^email_/, ''),
        items: []
      });
    }
    map.get(key).items.push(item);
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
        targetEmployeeId: String(picked.key || ''),
        targetHoldRowIndex: ''
      });
    } else {
      const isPickedHold = String(item.rowIndex) === String(picked.key || '');
      actions.push({
        rowIndex: ri,
        action: isPickedHold ? 'add' : 'merge',
        targetEmployeeId: '',
        targetHoldRowIndex: isPickedHold ? '' : String(picked.key || '')
      });
    }
  });
  return actions;
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
      previewResolvedTargetEmployeeId: String(action.targetEmployeeId || ''),
      previewResolvedTargetHoldRowIndex: String(action.targetHoldRowIndex || ''),
      reason: '',
      code: action.action === 'add' ? 'hold_resolved_add_preview' : 'hold_resolved_merge_preview'
    };
  });
}

/** POST /import-excel/preview 응답 → 결과 모달용 results (아직 MongoDB 반영 전) */
function mapPreviewResultsToUiResults(previewResults) {
  const results = [];
  for (const pr of previewResults) {
    const i = pr.rowIndex;
    const name = (pr.contactName || '').trim();
    if (pr.kind === 'create') {
      results.push({ rowIndex: i, ok: true, contactName: name, previewPending: true });
    } else if (pr.kind === 'duplicate_exact') {
      results.push({ rowIndex: i, ok: true, skipped: true, employeeId: pr.employeeId, contactName: name });
    } else if (pr.kind === 'hold') {
      results.push({
        rowIndex: i,
        ok: true,
        hold: true,
        contactName: name,
        reason: '동일 전화번호 또는 파일 내 중복으로 확인이 필요합니다.',
        contactPayload: pr.contactPayload,
        conflictCandidates: pr.conflictCandidates || [],
        code: pr.code
      });
    } else if (pr.kind === 'error') {
      results.push({ rowIndex: i, ok: false, error: pr.error, contactName: name });
    } else if (pr.kind === 'empty') {
      results.push({ rowIndex: i, ok: true, skipped: 'empty_row', contactName: '' });
    } else {
      results.push({ rowIndex: i, ok: false, error: '잘못된 행', contactName: name });
    }
  }
  return results;
}

function buildPreviewSummary(previewResults) {
  let created = 0;
  let skippedDuplicateContact = 0;
  let onHold = 0;
  let failed = 0;
  let emptySkipped = 0;
  for (const p of previewResults) {
    if (p.kind === 'create') created += 1;
    else if (p.kind === 'duplicate_exact') skippedDuplicateContact += 1;
    else if (p.kind === 'hold') onHold += 1;
    else if (p.kind === 'error') failed += 1;
    else if (p.kind === 'empty') emptySkipped += 1;
    else failed += 1;
  }
  return {
    total: previewResults.length,
    created,
    skippedDuplicateContact,
    onHold,
    failed,
    emptySkipped,
    registerTarget: 'contact'
  };
}

function buildExistingCandidatesForContactGroup(group) {
  const map = new Map();
  (group?.items || []).forEach((item) => {
    const list = Array.isArray(item?.conflictCandidates) ? item.conflictCandidates : [];
    list.forEach((candidate) => {
      const id = String(candidate?.employeeId || '').trim();
      if (!id || map.has(id)) return;
      map.set(id, { employeeId: id });
    });
  });
  return Array.from(map.values());
}

export default function CustomerCompanyEmployeesExcelImportModal({ open, onClose, onImported }) {
  const fileInputRef = useRef(null);
  const [contactSchemaFields, setContactSchemaFields] = useState([]);
  const [contactCustomDefs, setContactCustomDefs] = useState([]);
  const [rows, setRows] = useState([]);
  const [excelRows, setExcelRows] = useState([]);
  const [excelFileName, setExcelFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewChecking, setPreviewChecking] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [contactPreviewOpen, setContactPreviewOpen] = useState(false);
  const [contactPreviewItems, setContactPreviewItems] = useState([]);
  const [contactPreviewPreReview, setContactPreviewPreReview] = useState(null);
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

  const registerTarget = 'contact';

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
    () => buildTargetOptionsForTarget(registerTarget, contactSchemaFields, contactCustomDefs)
      .filter((o) => o.value !== BUSINESS_CARD_AUTO_TARGET),
    [contactSchemaFields, contactCustomDefs]
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
        fetch(`${API_BASE}/custom-field-definitions?entityType=contact`, {
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
        setContactCustomDefs(Array.isArray(c2Res.value?.items) ? c2Res.value.items : []);
      }
      if (sfRes.status === 'fulfilled') {
        setContactSchemaFields(Array.isArray(sfRes.value?.contact) ? sfRes.value.contact : []);
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
      setContactPreviewOpen(false);
      setContactPreviewItems([]);
      setContactPreviewPreReview(null);
      setResolvedHoldActions([]);
      setAppliedHoldGroupKeys({});
      setShowAssigneePicker(false);
      return;
    }
    setSaveMsg(null);
    setImportResult(null);
    setContactPreviewOpen(false);
    setContactPreviewItems([]);
    setContactPreviewPreReview(null);
    setResolvedHoldActions([]);
    setAppliedHoldGroupKeys({});
    const initial = stripContactMappingRows(
      ensureContactMappingRowsComplete(rowsFromSavedMappings(null, registerTarget))
    );
    setRows(initial);
    const id = getCurrentUserId();
    setAssigneeUserIds(id ? [id] : []);
    setAssigneeDisplayText(undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setRows((prev) => stripContactMappingRows(appendMissingContactCustomFieldRows(prev, contactCustomDefs, [])));
  }, [open, contactCustomDefs]);

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
        targetKey: 'contact.memo'
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

  const resolveAssigneeUserIds = useCallback(() => {
    let ids = Array.isArray(assigneeUserIds) ? [...assigneeUserIds] : [];
    if (ids.length === 0) {
      const self = getCurrentUserId();
      if (self) ids = [self];
    }
    return ids.filter(Boolean);
  }, [assigneeUserIds]);

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
    const invalid = mappings.some((m) => !String(m.targetKey || '').startsWith('contact.'));
    if (invalid) {
      setSaveMsg('대상은 연락처 필드만 선택할 수 있습니다.');
      return;
    }
    const mappedTargets = new Set(mappings.map((m) => m.targetKey));
    const hasIdentifier = ['contact.name', 'contact.email', 'contact.phone'].some((k) => mappedTargets.has(k));
    if (!hasIdentifier) {
      setSaveMsg('이름·이메일·전화 중 최소 하나는 엑셀 열과 연결해 주세요.');
      return;
    }

    setSaveMsg(null);
    setImportResult(null);
    setContactPreviewOpen(false);
    setContactPreviewItems([]);
    setContactPreviewPreReview(null);
    setResolvedHoldActions([]);
    setAppliedHoldGroupKeys({});

    try {
      const items = excelRows
        .map((excelRow, idx) => {
          const payload = buildContactPayloadFromExcelRow(excelRow, mappings);
          return payload ? buildPreviewRowFromContactPayload(payload, idx) : null;
        })
        .filter(Boolean);
      if (!items.length) {
        setSaveMsg('등록할 유효한 행이 없습니다. 이름·이메일·전화 중 하나 이상이 필요합니다.');
        return;
      }
      setContactPreviewItems(items);
      setContactPreviewOpen(true);
    } catch (e) {
      setSaveMsg(e.message || '실패');
    }
  };

  const runContactPreviewRowsImport = useCallback(
    async (rowsToImport, preResults = [], forceAll = false) => {
      const assigneeUserIds = resolveAssigneeUserIds();
      const batchCustomerCompanyIdByNormKey = new Map();
      const perRowDecisions =
        forceAll && typeof forceAll === 'object' && forceAll.mode === 'perRow' && forceAll.decisions
          ? forceAll.decisions
          : null;
      let success = 0;
      let fail = 0;
      let skipped = 0;

      setSaving(true);
      setSaveMsg(null);
      try {
        for (let idx = 0; idx < rowsToImport.length; idx += 1) {
          const row = rowsToImport[idx];
          const preResult = preResults[idx] || {};
          const decisionKey = Number.isInteger(Number(preResult.index)) ? String(Number(preResult.index)) : String(idx);
          const rowDecision = perRowDecisions ? perRowDecisions[decisionKey] : null;
          if (rowDecision === 'exclude' || (rowNeedsContactDuplicateHold(preResult) && rowDecision !== 'force' && forceAll !== true)) {
            skipped += 1;
            continue;
          }
          try {
            const payload = {
              name: String(row.name || '').replace(/\s/g, '').trim(),
              email: (row.email || '').trim(),
              phone: row.phone ? formatPhoneInput(String(row.phone)) : '',
              position: (row.position || '').trim() || undefined,
              address: (row.address || '').trim() || undefined,
              birthDate: (row.birthDate || '').trim() || undefined,
              memo: (row.memo || '').trim() || undefined,
              status: row.status || 'Lead',
              assigneeUserIds
            };

            if (row.customFields && Object.keys(row.customFields).length) {
              payload.customFields = row.customFields;
            }

            const linkedRaw = row.customerCompanyId != null ? String(row.customerCompanyId).trim() : '';
            const linkedOk = linkedRaw && /^[a-f\d]{24}$/i.test(linkedRaw);
            if (linkedOk) {
              const cnLink = (row.companyName || row.linkedCompany?.name || '').trim();
              payload.customerCompanyId = linkedRaw;
              payload.companyName = cnLink;
              const gkLink = normalizeBulkImportCompanyGroupKey(cnLink);
              if (gkLink) batchCustomerCompanyIdByNormKey.set(gkLink, linkedRaw);
            } else {
              const cn = (row.companyName || '').trim();
              if (cn) {
                const gk = normalizeBulkImportCompanyGroupKey(cn);
                const reuseId = gk ? batchCustomerCompanyIdByNormKey.get(gk) : null;
                if (reuseId) {
                  payload.customerCompanyId = reuseId;
                  payload.companyName = cn;
                } else {
                  payload.customerCompanyId = null;
                  payload.companyName = cn;
                  payload.forceCreateNewCustomerCompany = true;
                }
              } else {
                payload.isIndividual = true;
                payload.customerCompanyId = null;
                payload.companyName = '';
              }
            }

            if (!payload.name && !payload.email && !payload.phone) {
              fail += 1;
              continue;
            }
            if (rowNeedsContactDuplicateHold(preResult) && (forceAll === true || rowDecision === 'force')) {
              payload.forceCreateDespiteContactDuplicate = true;
            }

            const res = await fetch(`${API_BASE}/customer-company-employees`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
              credentials: 'include',
              body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
              success += 1;
              const cn = (row.companyName || '').trim();
              if (cn && data.customerCompanyId) {
                const gk = normalizeBulkImportCompanyGroupKey(cn);
                if (gk && !batchCustomerCompanyIdByNormKey.has(gk)) {
                  batchCustomerCompanyIdByNormKey.set(gk, String(data.customerCompanyId));
                }
              }
            } else {
              fail += 1;
            }
          } catch (_) {
            fail += 1;
          }
        }

        setContactPreviewOpen(false);
        setContactPreviewItems([]);
        window.alert(`등록 ${success}건${skipped ? `, 제외 ${skipped}건` : ''}${fail ? `, 실패 ${fail}건` : ''} (총 ${rowsToImport.length}건).`);
        if (success > 0) {
          onImported?.({ summary: { total: rowsToImport.length, created: success, skipped, failed: fail } });
          onClose?.();
        } else {
          setSaveMsg(`등록에 실패했습니다. (${fail}건${skipped ? `, 제외 ${skipped}건` : ''})`);
        }
      } catch (e) {
        setSaveMsg(e.message || '등록 중 오류가 났습니다.');
      } finally {
        setSaving(false);
      }
    },
    [onClose, onImported, resolveAssigneeUserIds]
  );

  const confirmContactPreviewImport = useCallback(
    async (editedRows) => {
      const rowsToImport = (Array.isArray(editedRows) ? editedRows : contactPreviewItems).filter(
        (r) => !r.error && ((r.name || '').trim() || (r.email || '').trim() || (r.phone || '').trim())
      );
      if (!rowsToImport.length) {
        setSaveMsg('등록할 유효한 행이 없습니다.');
        return;
      }

      setSaving(true);
      setSaveMsg(null);
      setContactPreviewPreReview(null);
      try {
        const entries = rowsToImport.map((row) => buildPreflightEntryFromPreviewRow(row));
        const preRes = await fetch(`${API_BASE}/customer-company-employees/save-preflight`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          credentials: 'include',
          body: JSON.stringify({ entries })
        });
        const preData = await preRes.json().catch(() => ({}));
        if (!preRes.ok) throw new Error(preData.error || '대량 등록을 미리 확인하는 데 실패했습니다.');
        const preResults = Array.isArray(preData.results) ? preData.results : [];
        const hasDuplicateContacts = preResults.some((pr) => rowNeedsContactDuplicateHold(pr));
        if (hasDuplicateContacts) {
          setContactPreviewPreReview({
            source: 'excel',
            importRows: rowsToImport,
            preResults,
            entries
          });
          return;
        }
        await runContactPreviewRowsImport(rowsToImport, preResults, false);
      } catch (e) {
        setSaveMsg(e.message || '대량 등록을 미리 확인하는 데 실패했습니다.');
      } finally {
        setSaving(false);
      }
    },
    [contactPreviewItems, runContactPreviewRowsImport]
  );

  const resolveContactPreviewPreReview = useCallback(
    async (forceAll) => {
      if (!contactPreviewPreReview) return;
      const b = contactPreviewPreReview;
      setContactPreviewPreReview(null);
      await runContactPreviewRowsImport(b.importRows || [], b.preResults || [], forceAll);
    },
    [contactPreviewPreReview, runContactPreviewRowsImport]
  );

  const summary = useMemo(() => {
    let err = 0;
    rows.forEach((row) => {
      const prev = previewExcelMappedValue(sampleRow, row);
      const st = rowStatus(row, prev, registerTarget);
      if (st.type === 'err') err += 1;
    });
    return { mapped: rows.filter((r) => r.targetKey).length, err, totalOpt: targetOptions.length };
  }, [rows, sampleRow, targetOptions.length]);

  if (!open) return null;

  const commitExcelImport = useCallback(
    async ({ stagedActions = [] } = {}) => {
      const previewRows = Array.isArray(importResult?.rawPreviewResults) ? importResult.rawPreviewResults : [];
      if (previewRows.length === 0) {
        setSaveMsg('미리보기 데이터가 없습니다. 다시 가져오기를 눌러 주세요.');
        return;
      }
      const mappings = toApiMappings(rows);
      setSaving(true);
      setSaveMsg('서버에 등록 중입니다…');
      try {
        const res = await fetch(`${API_BASE}/customer-company-employees/import-excel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          credentials: 'include',
          body: JSON.stringify({
            mappings,
            rows: excelRows,
            assigneeUserIds: resolveAssigneeUserIds(),
            holdResolutions: Array.isArray(stagedActions) ? stagedActions : []
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '가져오기 실패');
        setSaveMsg(null);
        setImportResult(data);
      } catch (e) {
        setSaveMsg(e.message || '실패');
      } finally {
        setSaving(false);
      }
    },
    [rows, excelRows, importResult, resolveAssigneeUserIds]
  );

  const handleResultConfirm = useCallback(async () => {
    if (importResult?.phase === 'preview') {
      const results = Array.isArray(importResult.results) ? importResult.results : [];
      const stagedActions = Array.isArray(resolvedHoldActions) ? resolvedHoldActions : [];
      await commitExcelImport({ stagedActions });
      return;
    }

    if (importResult) onImported?.(importResult);
    setImportResult(null);
    setResolvedHoldActions([]);
    setAppliedHoldGroupKeys({});
    onClose?.();
  }, [importResult, onClose, onImported, resolvedHoldActions, commitExcelImport]);

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
    if (previewRawSessionRef.current === raw) return;
    previewRawSessionRef.current = raw;

    const results = Array.isArray(importResult.results) ? importResult.results : [];
    const holdItems = results.filter((r) => r && r.hold);
    const groups = buildHoldGroups(holdItems);

    let allActions = [];
    const appliedKeys = {};
    groups.forEach((g) => {
      const existing = buildExistingCandidatesForContactGroup(g);
      const selected =
        existing.length > 0
          ? { type: 'existing', key: String(existing[0].employeeId) }
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

  if (contactPreviewOpen) {
    return (
      <>
        <ContactImportPreviewModal
          open={contactPreviewOpen}
          items={contactPreviewItems}
          bulkSaving={saving}
          fixedCompany={false}
          onClose={() => !saving && setContactPreviewOpen(false)}
          onConfirm={(editedRows) => {
            if (Array.isArray(editedRows)) setContactPreviewItems(editedRows);
            void confirmContactPreviewImport(editedRows);
          }}
        />
        <BulkContactDuplicateReviewModal
          review={contactPreviewPreReview}
          saving={saving}
          onClose={() => setContactPreviewPreReview(null)}
          onConfirmForce={(forceAll) => void resolveContactPreviewPreReview(forceAll)}
        />
      </>
    );
  }

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
          <p className="lc-crm-result-sub">중복 검사를 실행하고 있습니다. 잠시만 기다려 주세요…</p>
        </div>
      </div>
    );
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
    const skippedDup = s.skippedDuplicateContact ?? 0;
    const emptySk = s.emptySkipped ?? 0;
    const skipped = skippedDup + emptySk;
    const failed = s.failed ?? 0;
    const total = s.total ?? results.length;
    const failedItems = results.filter((r) => !r.ok);
    const holdItems = results.filter((r) => r && r.hold);
    const allHoldGroups = buildHoldGroups(holdItems);
    const visibleHoldGroups = allHoldGroups.filter((group) => !appliedHoldGroupKeys[group.key]);
    const onHoldRemaining = visibleHoldGroups.reduce((acc, g) => acc + g.items.length, 0);
    const onHold = isPreviewPhase ? onHoldRemaining : (s.onHold ?? holdItems.length);
    const stagedResolvedItems = allHoldGroups
      .filter((group) => appliedHoldGroupKeys[group.key])
      .flatMap((group) => group.items || []);
    const previewReadyCount = previewNewPlanned + stagedResolvedItems.length;
    const canConfirmPreview = isPreviewPhase && onHoldRemaining === 0;
    const successItems = isPreviewPhase
      ? results.filter((r) => r.ok && r.previewPending)
      : results.filter((r) => r.ok && !r.skipped && !r.hold);

    return (
      <ImportResultModal
        variant="contact"
        isPreviewPhase={isPreviewPhase}
        failed={failed}
        total={total}
        previewReadyCount={previewReadyCount}
        completedTotal={completedTotal}
        skipped={skipped}
        onHold={onHold}
        failedItems={failedItems}
        skippedDup={skippedDup}
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
    <ContactExcelImportMappingModal
      onClose={onClose}
      saving={saving}
      onImport={handleImport}
      excelRows={excelRows}
      fileInputRef={fileInputRef}
      ingestFile={ingestFile}
      dragOver={dragOver}
      setDragOver={setDragOver}
      onDrop={onDrop}
      excelFileName={excelFileName}
      targetOptions={targetOptions}
      assigneeInputValue={assigneeInputValue}
      onAssigneeInputChange={setAssigneeDisplayText}
      onOpenAssigneePicker={() => setShowAssigneePicker(true)}
      showMeBadge={showMeBadge}
      rows={rows}
      sampleRow={sampleRow}
      registerTarget={registerTarget}
      sourceOptions={sourceOptions}
      effectiveTargetOptions={effectiveTargetOptions}
      updateRow={updateRow}
      removeRow={removeRow}
      addConstantRow={addConstantRow}
      summary={summary}
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
  );
}
