/**
 * 연락처 목록(customer-company-employees.js)에서 URL `?modal=excel-import`일 때 열립니다.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession, getAuthHeader } from '@/lib/crm-auth';
import { readSpreadsheetFileToRows } from '@/lib/spreadsheet-file-read';
import { API_BASE } from '@/config';
import ContactExcelImportMappingModal from './contact-excel-import-mapping-modal';
import ContactImportPreviewModal from '../add-customer-company-employees-modal/contact-import-preview-modal';
import BulkContactDuplicateReviewModal from '../add-customer-company-employees-modal/bulk-contact-duplicate-review-modal';
import {
  buildBulkImportRequestItems,
  postBulkContactImportInChunks,
  postContactSavePreflightInChunks
} from '../add-customer-company-employees-modal/bulk-contact-import-api';
import '../../lead-capture/lead-capture-crm-mapping/lead-capture-crm-mapping-modal.css';
import '../../customer-companies/customer-companies-excel-import-modal/customer-companies-excel-import-modal.css';
import {
  buildTargetOptionsForTarget,
  toApiMappings,
  ensureContactMappingRowsComplete,
  appendMissingContactCustomFieldRows,
  rowsFromSavedMappings,
  BUSINESS_CARD_AUTO_TARGET
} from '../../lead-capture/lead-capture-crm-mapping/lead-capture-crm-mapping-utils';
import {
  readExcelMappedCell
} from '../../customer-companies/customer-companies-excel-import-modal/excel-import-mapping-utils';
import {
  autoFillSourceKeys,
  buildMappingByHeader,
  assignHeaderToTarget,
  isTargetConnected,
  CONTACT_HEADER_RULES
} from '../../shared/excel-header-match';
import { CONTACT_EXCEL_IMPORT_MAX_ROWS, getRowCountOverflow } from '../../shared/excel-import-limits';
import ExcelRowLimitModal from '../../shared/excel-row-limit-modal';

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

/** 이름·이메일·전화 중 하나 이상이 연결돼야 등록할 수 있습니다. */
const CONTACT_IDENTIFIER_TARGETS = [
  { key: 'contact.name', label: '이름' },
  { key: 'contact.email', label: '이메일' },
  { key: 'contact.phone', label: '전화' }
];

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

function stripContactMappingRows(rows) {
  return (rows || []).filter(
    (r) => r.targetKey !== BUSINESS_CARD_AUTO_TARGET && r.targetKey !== 'contact.companyCode'
  );
}

function buildContactPayloadFromExcelRow(excelRow, mappings) {
  const vals = {};
  for (const m of mappings) {
    const key = m.targetKey;
    if (!key || !String(key).startsWith('contact.')) continue;
    const raw =
      m.sourceType === 'constant' ? m.constantValue ?? '' : readExcelMappedCell(excelRow, m.sourceKey || '');
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
  return readSpreadsheetFileToRows(file);
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
  const [saveMsg, setSaveMsg] = useState(null);
  /** 행 수 상한 초과 안내 모달 ({ rowCount, maxRows, fileName, unitLabel } | null) */
  const [rowLimitNotice, setRowLimitNotice] = useState(null);
  const [contactPreviewOpen, setContactPreviewOpen] = useState(false);
  const [contactPreviewItems, setContactPreviewItems] = useState([]);
  const [contactPreviewPreReview, setContactPreviewPreReview] = useState(null);
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [companyEmployeesForDisplay, setCompanyEmployeesForDisplay] = useState([]);
  const [assigneeDisplayText, setAssigneeDisplayText] = useState(undefined);
  const [assigneeUserIds, setAssigneeUserIds] = useState(() => {
    const id = getCurrentUserId();
    return id ? [id] : [];
  });
  /** 자동 매핑 행 추가를 파일당 한 번만 수행하기 위한 서명 */
  const autoExpandSignatureRef = useRef('');

  const registerTarget = 'contact';

  const excelHeaders = useMemo(() => {
    if (!excelRows.length) return [];
    const keys = Object.keys(excelRows[0] || {});
    return keys.filter((k) => k !== '__rowNum__');
  }, [excelRows]);

  const targetOptions = useMemo(
    () =>
      buildTargetOptionsForTarget(registerTarget, contactSchemaFields, contactCustomDefs).filter(
        (o) => o.value !== BUSINESS_CARD_AUTO_TARGET && o.value !== 'contact.companyCode'
      ),
    [contactSchemaFields, contactCustomDefs]
  );

  const effectiveTargetOptions = useMemo(
    () => (Array.isArray(targetOptions) && targetOptions.length > 0 ? targetOptions : FALLBACK_TARGET_OPTIONS),
    [targetOptions]
  );


  /**
   * 엑셀 헤더가 바뀔 때 공용 매처로 열을 자동 연결합니다.
   * 대응 필드가 있는데 기본 매핑 행이 없는 열(직책·메모 등)은 행을 새로 만들어 줍니다.
   * 단 파일·대상옵션이 그대로인 동안에는 한 번만 — 사용자가 뺀 열이 되살아나면 안 됩니다.
   */
  useEffect(() => {
    if (!open || !excelHeaders.length) return;
    const signature = `${JSON.stringify(excelHeaders)}|${effectiveTargetOptions.length}`;
    const alreadyExpanded = autoExpandSignatureRef.current === signature;
    autoExpandSignatureRef.current = signature;
    setRows((prev) =>
      autoFillSourceKeys(prev, excelHeaders, CONTACT_HEADER_RULES, {
        customFieldDefs: contactCustomDefs,
        availableTargetKeys: alreadyExpanded ? undefined : effectiveTargetOptions.map((o) => o.value),
        makeRowId: newRowId
      })
    );
  }, [open, excelHeaders, contactCustomDefs, effectiveTargetOptions]);

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
        fetch(`${API_BASE}/custom-field-definitions?entityType=contact`, crmFetchInit()).then((r) => r.json()),
        fetch(`${API_BASE}/lead-capture-forms/crm-mappable-fields`, crmFetchInit()).then((r) => r.json())
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
    fetch(`${API_BASE}/companies/overview`, crmFetchInit())
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.employees)) setCompanyEmployeesForDisplay(data.employees);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) {
      setRowLimitNotice(null);
      setExcelRows([]);
      setExcelFileName('');
      setDragOver(false);
      setSaveMsg(null);
      setContactPreviewOpen(false);
      setContactPreviewItems([]);
      setContactPreviewPreReview(null);
      setShowAssigneePicker(false);
      return;
    }
    setSaveMsg(null);
    setContactPreviewOpen(false);
    setContactPreviewItems([]);
    setContactPreviewPreReview(null);
    autoExpandSignatureRef.current = '';
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
      // 파일 상한(500건)은 올린 직후에 확인합니다. 서버에는 200건씩 나눠 보냅니다.
      // 여기서 막지 않으면 매핑·미리보기·중복검토를 다 끝낸 뒤 저장에서 실패합니다.
      const overLimit = getRowCountOverflow(parsed.length, CONTACT_EXCEL_IMPORT_MAX_ROWS, { fileName: file.name, unitLabel: '건' });
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
    // 매핑 행이 있는지가 아니라 실제로 열(또는 고정값)이 연결됐는지로 판단합니다.
    const hasIdentifier = CONTACT_IDENTIFIER_TARGETS.some((t) => isTargetConnected(rows, excelHeaders, t.key));
    if (!hasIdentifier) {
      setSaveMsg('이름·이메일·전화 중 최소 하나는 엑셀 열과 연결해 주세요.');
      return;
    }

    setSaveMsg(null);
    setContactPreviewOpen(false);
    setContactPreviewItems([]);
    setContactPreviewPreReview(null);

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
      setSaving(true);
      setSaveMsg(null);
      try {
        const items = buildBulkImportRequestItems(rowsToImport, preResults, forceAll, {
          rowNeedsHold: rowNeedsContactDuplicateHold,
          formatPhoneInput
        });
        // 서버 한 요청당 상한(200건)을 넘으면 나눠 보냅니다. 회사 묶음 정보는 요청 사이에 이어집니다.
        const { success, merged, fail, skipped, total, created } = await postBulkContactImportInChunks({
          items,
          assigneeUserIds: resolveAssigneeUserIds(),
          getAuthHeader,
          onProgress: ({ chunkCount, sentItems, totalItems }) => {
            if (chunkCount > 1) setSaveMsg(`등록 중… ${sentItems} / ${totalItems}건`);
          }
        });

        setContactPreviewOpen(false);
        setContactPreviewItems([]);
        const parts = [];
        if (created > 0) parts.push(`등록 ${created}건`);
        if (merged > 0) parts.push(`병합 ${merged}건`);
        if (skipped > 0) parts.push(`제외 ${skipped}건`);
        if (fail > 0) parts.push(`실패 ${fail}건`);
        window.alert(`${parts.join(', ')} (총 ${total}건).`);
        if (success > 0) {
          onImported?.({ summary: { total, created: success, merged, skipped, failed: fail } });
          onClose?.();
        } else {
          setSaveMsg(`등록에 실패했습니다. (${fail}건${skipped ? `, 제외 ${skipped}건` : ''})`);
        }
      } catch (e) {
        const partial = e && e.partial;
        if (partial && partial.processedItems > 0) {
          // 앞 묶음은 이미 저장됐습니다. 창을 열어 두면 다시 눌렀을 때 앞부분이 한 번 더 등록되므로
          // 목록을 새로 불러오고 닫은 뒤, 남은 행만 다시 올리도록 안내합니다.
          setContactPreviewOpen(false);
          setContactPreviewItems([]);
          window.alert(
            `${e.message}\n\n목록을 새로 불러옵니다. 같은 파일을 다시 올리면 이미 등록된 연락처는 ` +
              `중복 확인 화면(이름·전화 기준)에 표시되니, 제외하고 진행해 주세요.`
          );
          onImported?.({
            summary: {
              total: partial.processedItems,
              created: partial.success,
              merged: partial.merged,
              skipped: partial.skipped,
              failed: partial.fail
            }
          });
          onClose?.();
        } else {
          setSaveMsg(e.message || '등록 중 오류가 났습니다.');
        }
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
        // 중복 사전확인도 요청당 200건 상한이라 나눠 보내고, index 는 전체 기준으로 맞춰 받습니다.
        const preResults = await postContactSavePreflightInChunks({ entries, getAuthHeader });
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

  if (!open) return null;

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

  return (
    <>
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
        requiredTargets={CONTACT_IDENTIFIER_TARGETS}
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
