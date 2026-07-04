import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { API_BASE } from '@/config';
import { crmFetchInit } from '@/lib/crm-auth';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import { pingBackendHealth } from '@/lib/backend-wake';
import { getUserVisibleApiError } from '@/lib/api-error';
import {
  formatMergePdfExportOptionsSummary,
  loadMergePdfExportOptions,
  normalizeMergePdfExportOptions,
  saveMergePdfExportOptions
} from '@/lib/merge-pdf-export-options';
import {
  buildMergeOutputEntryJobIndexes,
  mergeExportAddonWantsPdf,
  normalizeMergeExportAddon,
  resolveMergeExportAddonForRow
} from '@/lib/merge-export-addon';
import { fetchMergePdfPreviewBlob, fetchTemplatePdfPreviewBlob } from '@/lib/merge-pdf-preview-api';
import {
  fetchXlsxSheetNamesFromMergeTemplate,
  pdfExportOptionsWithSheetNames
} from '@/lib/merge-pdf-sync-from-template';
import { buildMailtoWithFields } from '@/lib/email-client-links';
import { getStoredCrmUser, isAdminOrAboveRole, isManagerOrAboveRole } from '@/lib/crm-role-utils';
import CustomerCompanySearchModal from '@/customer-companies/customer-company-search-modal/customer-company-search-modal';
import MergeDataSheetModal, {
  MERGE_SHEET_FIELD_START,
  MERGE_SHEET_MAIL_INPUT_COL_COUNT,
  MERGE_SHEET_PREFIX_COL_COUNT
} from '@/shared/merge-data-sheet-modal/merge-data-sheet-modal';
import MergeFieldEditorModal from '@/shared/merge-field-editor-modal/merge-field-editor-modal';
import MergePdfSettingsModal from '@/shared/merge-data-sheet-modal/merge-pdf-settings-modal';
import MergePdfPreviewModal from '@/shared/merge-data-sheet-modal/merge-pdf-preview-modal';
import {
  fetchMergeTemplateProfiles,
  patchMergeTemplateProfile,
  resolvePdfExportOptionsForRow
} from '@/lib/merge-template-profiles-storage';
import {
  applyMailDefaultsToMergeRow,
  buildMergeMailTokenHintFromFields,
  clearMergeRowMailFields,
  hydrateMergeRowMailFromProfiles,
  mergeRowHasFieldData,
  listMergeMailTokens,
  MERGE_MAIL_FIXED_TOKENS,
  mailDefaultsForRow,
  refreshMailTokensFromProfile,
  resolveMergeRowMailFields,
  templateProfileHasMailDefaults
} from '@/lib/merge-template-mail-defaults';
import { MERGE_EXCEL_FORMATS, MERGE_FIELD_VALUE_KINDS } from '@/lib/merge-field-editor-constants';
import {
  isAllowedMergeTemplateFilename,
  mergeTemplateAcceptAttribute,
  mergeTemplateDefaultExt,
  mergeTemplateKindLabel,
  mergeTemplateMimeType,
  MERGE_TEMPLATE_UPLOAD_HINT,
  stripKnownMergeTemplateExtensions
} from '@/lib/merge-template-file-types';
import {
  mergeFieldsWithoutRowIndex,
  buildMergeFieldsPayload,
  mapApiFieldsToEditorDraft,
  MERGE_FIELD_PRESET_NAME_MAX
} from '@/lib/merge-field-guide-payload';
import { parseTsvGrid, isSingleColumnMultilinePaste } from '@/lib/tsv-grid';
import {
  MERGE_DATA_SHEET_URL_VALUE,
  isMergeDataSheetUrlOpen
} from '@/lib/merge-data-sheet-url';
import { MERGE_RUNTIME_TENANT, mergeApiFetchInit } from '@/lib/quotation-doc-merge-runtime';
import {
  applyOurForcedToMergeRow,
  resolveOurForcedMergeValues,
  rowHasCustomerMergeFieldContent
} from '@/lib/merge-our-forced-fields';
import { resolveOrgChartFromListTemplates } from '@/lib/org-chart-tree-utils';
import { customerCompanyToMergeRow as companyToMergeRow } from '@/lib/merge-customer-company-row';
import './quotation-doc-merge.css';

const MERGE_COMMON_TEMPLATE_PROFILE_READONLY_MSG =
  '공통 양식의 PDF·메일 설정은 Nexvia Admin(/admin/quotation-doc-merge)에서만 변경할 수 있습니다.';

/** 데이터 시트를 처음 열 때 만들 빈 행 수 */
const MERGE_SHEET_INITIAL_ROWS = 200;
/** 붙여넣기·고객사 불러오기 등으로 늘릴 수 있는 행 상한 */
const MERGE_SHEET_MAX_ROWS = 1000;

function rowWantsPdfExportIntent(row, templateProfilesById, globalPdfOpts, fallbackTid) {
  const tids = getRowTemplateIds(row, fallbackTid);
  const mode = resolveMergeExportAddonForRow(row, templateProfilesById, globalPdfOpts, tids);
  return mergeExportAddonWantsPdf(mode);
}

function createInitialMergeRows(fields, templateId) {
  const n = Math.min(MERGE_SHEET_INITIAL_ROWS, MERGE_SHEET_MAX_ROWS);
  return Array.from({ length: n }, () => createMergeRowState(fields, templateId, true));
}

function isMergeFieldPresetMongoId(v) {
  if (v == null || v === '') return false;
  return /^[a-f0-9]{24}$/i.test(String(v).trim());
}

function mergeValueKindLabel(vk) {
  const id = vk === 'number' ? 'number' : 'text';
  return MERGE_FIELD_VALUE_KINDS.find((x) => x.id === id)?.label || id;
}

function mergeExcelFormatLabel(id) {
  return MERGE_EXCEL_FORMATS.find((x) => x.id === id)?.label || String(id || '');
}

/** 사업자등록번호 10자리 하이픈 (000-00-00000) */
function formatKrBusinessNumber(val) {
  const d = String(val || '')
    .replace(/\D/g, '')
    .slice(0, 10);
  if (!d) return '';
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/** 국내 전화·휴대폰 흔한 패턴으로 하이픈 */
function formatKrPhone(val) {
  const d = String(val || '')
    .replace(/\D/g, '')
    .slice(0, 11);
  if (!d) return '';
  if (d.startsWith('02')) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }
  if (d.startsWith('0')) {
    if (d.length <= 3) return d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  }
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

function buildEmptyRow(fields) {
  const row = {};
  if (!Array.isArray(fields)) return row;
  for (const f of fields) {
    if (f && f.key) row[f.key] = '';
  }
  return row;
}

function defaultTemplateIdFromList(templates) {
  return templates?.[0]?._id ? String(templates[0]._id) : '';
}

/** 시트 열: 받는 사람·참조(CC)·제목·본문 — PREFIX(3열) 뒤 4칸과 순서 일치 */
const MERGE_SHEET_MAIL_ROW_KEYS = ['_mailTo', '_mailCc', '_mailSubject', '_mailBody'];

function parseTemplateIdsFromPaste(raw, templates, fallbackTid) {
  const list = Array.isArray(templates) ? templates : [];
  const s = String(raw ?? '').trim();
  const fb = String(fallbackTid || defaultTemplateIdFromList(list) || '').trim();
  if (!s) return fb ? [fb] : [];
  const parts = s.split(/[\s,;|]+/).map((x) => x.trim()).filter(Boolean);
  const idSet = new Set(list.map((t) => String(t._id)));
  const picked = [];
  for (const p of parts) {
    if (idSet.has(p)) picked.push(p);
  }
  if (picked.length) {
    const order = list.map((t) => String(t._id));
    return order.filter((id) => picked.includes(id));
  }
  const p0 = (parts[0] || '').toLowerCase();
  if (p0) {
    for (const t of list) {
      const label = templateListFileName(t)
        .replace(/\.(docx|xlsx|pptx|hwp|hwpx)$/i, '')
        .trim()
        .toLowerCase();
      if (label && (label === p0 || p0.includes(label) || label.includes(p0))) {
        return [String(t._id)];
      }
    }
  }
  return fb ? [fb] : [];
}

/** 행에 선택된 양식 id 목록(다중 선택 지원) */
function getRowTemplateIds(row, fallbackTid) {
  if (Array.isArray(row?._templateIds) && row._templateIds.length) {
    return row._templateIds.map(String);
  }
  const one = String(row?._templateId || '').trim();
  if (one) return [one];
  const fb = String(fallbackTid || '').trim();
  return fb ? [fb] : [];
}

/** 메일머지 표 한 행: 치환 필드 + 포함 + 행별 양식(_templateId 단일 + _templateIds 다중) */
function createMergeRowState(fields, templateId, include = true, templateIds = null) {
  const tid = templateId ? String(templateId) : '';
  const ids =
    Array.isArray(templateIds) && templateIds.length
      ? templateIds.map(String)
      : tid
        ? [tid]
        : [];
  const first = ids[0] || '';
  return {
    ...buildEmptyRow(fields),
    _include: include !== false,
    _templateId: first,
    _templateIds: ids.length ? ids : tid ? [tid] : [],
    _exportAddon: 'same',
    _mailTo: '',
    _mailCc: '',
    _mailSubject: '',
    _mailBody: '',
    _pdfExportOptions: null
  };
}

/** ZIP/파일명 충돌 완화: 저장된 필드 구성 이름을 날짜 브래킷 앞 stem에 붙일 접미(앞쪽 `_`) */
function profileTagForMergeZip(selectedFieldPresetId, fieldGuide, fieldPresets) {
  if (!isMergeFieldPresetMongoId(selectedFieldPresetId)) return '';
  const raw =
    String(fieldGuide?.presetName || '').trim() ||
    String(
      fieldPresets.find((p) => String(p._id) === String(selectedFieldPresetId).trim())?.name || ''
    ).trim();
  const slug = sanitizeDownloadFileStem(raw.replace(/\s+/g, '_')).replace(/_+/g, '_');
  if (!slug) return '';
  return `_${slug}`;
}

function rowForApi(row) {
  const o = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (k.startsWith('_')) continue;
    o[k] = v;
  }
  return o;
}

function rowHasContent(row) {
  return Object.entries(row || {}).some(([k, v]) => !k.startsWith('_') && String(v || '').trim() !== '');
}

/** 다운로드 대상: 고객 치환 필드 입력 여부(our* 강제값 제외) */
function rowHasMergeFieldContent(row, mergeFields) {
  return rowHasCustomerMergeFieldContent(row, mergeFields);
}

/**
 * 시트 한 행 → merge API용 rowJobs (runMerge 와 동일 규칙).
 * @returns {{ rowJobs: { templateId: string, row: object }[], anyPreferPdf: boolean, error: string | null }}
 */
function buildRowJobsForSheetRow({
  row,
  rowIndex,
  mergeFieldsSheet,
  templates,
  fallbackTid,
  prof,
  templateProfilesById,
  globalPdfOpts,
  ourForcedValues
}) {
  if (!row || !Array.isArray(mergeFieldsSheet)) return { rowJobs: [], anyPreferPdf: false, error: '데이터를 확인해 주세요.' };
  if (!rowHasMergeFieldContent(row, mergeFieldsSheet)) {
    return { rowJobs: [], anyPreferPdf: false, error: '치환할 값이 있는지 확인해 주세요.' };
  }
  const tids = getRowTemplateIds(row, fallbackTid).filter((id) => templates.some((t) => String(t._id) === id));
  const exportAddon = resolveMergeExportAddonForRow(row, templateProfilesById, globalPdfOpts, tids);
  const anyPreferPdf = mergeExportAddonWantsPdf(exportAddon);
  if (!tids.length) return { rowJobs: [], anyPreferPdf: false, error: '사용할 양식을 선택해 주세요.' };
  const rowJobs = [];
  const baseStem =
    String(row.fileLabel || '').trim() ||
    String(row.companyName || '').trim() ||
    `row_${rowIndex + 1}`;
  for (let j = 0; j < tids.length; j += 1) {
    const tid = tids[j];
    const t = templates.find((x) => String(x._id) === tid);
    const tplRaw = stripKnownMergeTemplateExtensions(templateListFileName(t)).trim();
    const tplSlug = sanitizeDownloadFileStem(tplRaw).slice(0, 50) || 'doc';
    let apiRow = applyOurForcedToMergeRow(rowForApi(row), ourForcedValues);
    if (tids.length > 1) {
      const p = prof || '';
      const suffix = p ? `${p}_${tplSlug}` : `_${tplSlug}`;
      const combined = sanitizeDownloadFileStem(`${baseStem}${suffix}`.slice(0, 200));
      if (combined) apiRow = { ...apiRow, fileLabel: combined };
    }
    rowJobs.push({
      templateId: tid,
      row: apiRow,
      exportAddon,
      sourceRowIndex: rowIndex
    });
  }
  return { rowJobs, anyPreferPdf, error: null };
}

function formatBytes(n) {
  const x = Number(n) || 0;
  if (x < 1024) return `${x} B`;
  if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`;
  return `${(x / (1024 * 1024)).toFixed(1)} MB`;
}

/** 등록 양식 목록·드롭다운: 업로드 파일명 우선(구 데이터는 name + 확장자 보강) */
function templateListFileName(t) {
  if (!t) return '—';
  const orig = String(t.originalFilename || '').trim();
  if (orig) return orig;
  const n = String(t.name || '').trim();
  if (!n) return '—';
  if (/\.(docx|xlsx|pptx|hwp|hwpx)$/i.test(n)) return n;
  return `${n}.${mergeTemplateDefaultExt(t.fileType)}`;
}

/** Windows 등에서 문제되는 문자 제거·길이 제한(확장자 제외 파일명 줄기) */
function sanitizeDownloadFileStem(s, maxLen = 120) {
  let t = String(s || '')
    .replace(/[/\\?*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  if (!t) return '';
  try {
    t = t.normalize('NFC').slice(0, maxLen);
  } catch {
    t = t.slice(0, maxLen);
  }
  return t;
}

/** ZIP 해제·단일 행 다운로드 시 저장 파일명(확장자 제외). 미입력 시 양식 파일명 기반 */
function buildSingleMergeDownloadStem(template, row) {
  const label = String(row?.fileLabel ?? '').trim();
  if (label) {
    const noExt = label.replace(/\.(docx|xlsx|pptx|hwp|hwpx|zip)$/i, '').trim();
    const stem = sanitizeDownloadFileStem(noExt);
    if (stem) return stem;
  }
  const listName = template ? templateListFileName(template) : '';
  const rawStem = String(listName || '')
    .replace(/\.(docx|xlsx|pptx|hwp|hwpx)$/i, '')
    .trim();
  const stem = sanitizeDownloadFileStem(rawStem) || '견적';
  return stem;
}

function fieldSignature(fields) {
  if (!Array.isArray(fields)) return '';
  return fields
    .map(
      (f) =>
        `${f.key}:${f.label}:${f.valueKind || 'text'}:${f.excelFormat || 'general'}`
    )
    .join('|');
}

export default function QuotationDocMerge({ runtime = MERGE_RUNTIME_TENANT } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const me = useMemo(() => getStoredCrmUser(), []);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [orgChartRoot, setOrgChartRoot] = useState(null);
  const canDeleteTemplateByRole = isAdminOrAboveRole(me?.role);
  const canManageMergeFields =
    runtime.forceCanManageMergeFields === true || isManagerOrAboveRole(me?.role);
  const canEditTemplateProfile = useCallback(
    (template) => {
      if (typeof runtime.allowEditTemplateProfile === 'function') {
        return runtime.allowEditTemplateProfile(template);
      }
      return true;
    },
    [runtime]
  );
  const mergeApiBase = `${API_BASE}${runtime.apiPrefix}`;
  const apiFetchInit = useCallback((extra) => mergeApiFetchInit(runtime, extra), [runtime]);
  const getAuthHeader = useCallback((opts) => runtime.getAuthHeaders(opts), [runtime]);
  const sheetUrlParam = runtime.sheetUrlParam;

  const mergeDataSheetOpen = isMergeDataSheetUrlOpen(searchParams, sheetUrlParam);
  const openMergeDataSheet = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    p.set(sheetUrlParam, MERGE_DATA_SHEET_URL_VALUE);
    setSearchParams(p, { replace: false });
  }, [searchParams, setSearchParams, sheetUrlParam]);
  const closeMergeDataSheet = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    p.delete(sheetUrlParam);
    setSearchParams(p, { replace: true });
  }, [searchParams, setSearchParams, sheetUrlParam]);

  const [fieldGuide, setFieldGuide] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState('');

  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef(null);
  const [templateDropActive, setTemplateDropActive] = useState(false);
  /** 등록 양식 표: 엑셀식 행 범위 선택(행 # 열에서 드래그) */
  const [templateRowSelectedIds, setTemplateRowSelectedIds] = useState(() => new Set());
  const templateSelectAnchorIdxRef = useRef(null);
  const templateDragSelectRef = useRef({ active: false, startIdx: null });
  const templateTableScopeRef = useRef(null);
  const templateRowSelectedIdsRef = useRef(templateRowSelectedIds);

  useEffect(() => {
    templateRowSelectedIdsRef.current = templateRowSelectedIds;
  }, [templateRowSelectedIds]);

  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [mergeRows, setMergeRows] = useState([]);
  const [mergeRunning, setMergeRunning] = useState(false);
  const [mergeMessage, setMergeMessage] = useState('');
  const [pdfExportOptions, setPdfExportOptions] = useState(() => loadMergePdfExportOptions());
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [pdfPreviewObjectUrl, setPdfPreviewObjectUrl] = useState('');
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewError, setPdfPreviewError] = useState('');
  const [pdfPreviewCaption, setPdfPreviewCaption] = useState('');
  const pdfPreviewUrlRef = useRef('');
  const [companyPickOpen, setCompanyPickOpen] = useState(false);
  /** DB에 저장된 필드 구성 이름 편집용(시트에서 그 구성을 골랐을 때만 이름·항목 저장 반영) */
  const [fieldPresetNameDraft, setFieldPresetNameDraft] = useState('');
  const [fieldSaving, setFieldSaving] = useState(false);
  const [mergeFieldEditorOpen, setMergeFieldEditorOpen] = useState(false);
  /** MergeFieldEditorModal 편집 중인 필드 목록(API 형식 → 편집기 draft) */
  const [fieldDraft, setFieldDraft] = useState(null);
  const [fieldPresets, setFieldPresets] = useState([]);
  const [fieldPresetsLoading, setFieldPresetsLoading] = useState(false);
  const [selectedFieldPresetId, setSelectedFieldPresetId] = useState('');

  const [fieldGuideLoading, setFieldGuideLoading] = useState(false);
  /** 양식 등록 전 확인 — 치환 항목·메일 토큰은 fieldGuide(필드 편집기와 동일) 기준 */
  const [templateUploadPrepareOpen, setTemplateUploadPrepareOpen] = useState(false);
  /** 'create' = 새 양식 등록, 'edit' = 목록에서 선택한 양식 설정 수정 */
  const [templatePrepareMode, setTemplatePrepareMode] = useState('create');
  const [templatePrepareEditingTemplate, setTemplatePrepareEditingTemplate] = useState(null);
  const [templateUploadPendingFile, setTemplateUploadPendingFile] = useState(null);
  const [templateUploadPreparePdfOpts, setTemplateUploadPreparePdfOpts] = useState(() =>
    loadMergePdfExportOptions()
  );
  const [templateUploadPrepareMail, setTemplateUploadPrepareMail] = useState({
    mailTo: '',
    mailCc: '',
    mailSubject: '',
    mailBody: ''
  });
  const [templateUploadPrepareScope, setTemplateUploadPrepareScope] = useState('company');
  const [templateUploadPreparePdfOpen, setTemplateUploadPreparePdfOpen] = useState(false);
  const [templateUploadPrepareDropActive, setTemplateUploadPrepareDropActive] = useState(false);
  const [templateUploadPrepareMailInsertTarget, setTemplateUploadPrepareMailInsertTarget] = useState('mailSubject');
  const [templateProfilesById, setTemplateProfilesById] = useState({});

  const mergeFields = fieldGuide?.fields;
  const ourForcedValues = useMemo(
    () => resolveOurForcedMergeValues(me, companyProfile, { orgChartRoot }),
    [me, companyProfile, orgChartRoot]
  );
  const mergeFieldsSheet = useMemo(() => mergeFieldsWithoutRowIndex(mergeFields), [mergeFields]);
  const fieldSig = useMemo(() => fieldSignature(mergeFieldsSheet), [mergeFieldsSheet]);

  /** 데이터 시트 빈 메일 칸 fallback — 목록에서 선택한 양식에 등록한 메일 기본값 */
  const mergeMailFallback = useMemo(() => {
    const tid = selectedTemplateId || defaultTemplateIdFromList(templates);
    if (!tid) return null;
    const mail = templateProfilesById[String(tid)]?.mailDefaults;
    return mail && templateProfileHasMailDefaults(mail) ? mail : null;
  }, [selectedTemplateId, templates, templateProfilesById]);

  const mergeSheetMailHydratedRef = useRef(false);
  useEffect(() => {
    if (!mergeDataSheetOpen) {
      mergeSheetMailHydratedRef.current = false;
      return;
    }
    if (mergeSheetMailHydratedRef.current || !mergeFieldsSheet?.length) return;
    mergeSheetMailHydratedRef.current = true;
    setMergeRows((rows) =>
      rows.map((row, i) => {
        if (i === 0) {
          return hydrateMergeRowMailFromProfiles(
            row,
            templateProfilesById,
            mergeFieldsSheet,
            mergeMailFallback
          );
        }
        if (!mergeRowHasFieldData(row, mergeFieldsSheet)) {
          return clearMergeRowMailFields(row);
        }
        return row;
      })
    );
  }, [mergeDataSheetOpen, mergeFieldsSheet, templateProfilesById, mergeMailFallback]);

  useEffect(() => {
    if (!mergeDataSheetOpen) return;
    if (mergeFieldsSheet?.length) return;
    closeMergeDataSheet();
  }, [mergeDataSheetOpen, mergeFieldsSheet?.length, closeMergeDataSheet]);

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/companies/list-templates-bundle`, crmFetchInit());
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        setCompanyProfile(
          data.company
            ? { ...data.company, listTemplates: data.listTemplates }
            : null
        );
        const lt = data.listTemplates && typeof data.listTemplates === 'object' ? data.listTemplates : {};
        setOrgChartRoot(resolveOrgChartFromListTemplates(lt));
      } catch {
        /* our* 는 crm_user 스냅샷만으로도 부분 채움 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me, getAuthHeader]);

  const loadFieldGuide = useCallback(
    async (presetIdOverride = undefined) => {
      const eff = presetIdOverride !== undefined ? presetIdOverride : selectedFieldPresetId;
      const idStr = eff != null && eff !== '' ? String(eff).trim() : '';
      const q = isMergeFieldPresetMongoId(idStr) ? `?presetId=${encodeURIComponent(idStr)}` : '';
      setFieldGuideLoading(true);
      try {
        const res = await fetch(`${mergeApiBase}/field-guide${q}`, apiFetchInit());
        const data = await res.json().catch(() => ({}));
        if (res.ok) setFieldGuide(data);
        else setFieldGuide(null);
      } catch {
        setFieldGuide(null);
      } finally {
        setFieldGuideLoading(false);
      }
    },
    [selectedFieldPresetId, apiFetchInit, mergeApiBase]
  );

  const handleSelectFieldPresetId = useCallback(
    (presetId) => {
      setSelectedFieldPresetId(presetId);
      void loadFieldGuide(presetId);
    },
    [loadFieldGuide]
  );

  const loadFieldPresets = useCallback(async () => {
    setFieldPresetsLoading(true);
    try {
      const res = await fetch(`${mergeApiBase}/field-presets`, apiFetchInit());
      const data = await res.json().catch(() => ({}));
      if (res.ok) setFieldPresets(Array.isArray(data.items) ? data.items : []);
      else setFieldPresets([]);
    } catch {
      setFieldPresets([]);
    } finally {
      setFieldPresetsLoading(false);
    }
  }, [apiFetchInit, mergeApiBase]);

  const templateUploadPrepareCopyText = useMemo(() => {
    if (!mergeFieldsSheet.length) return '';
    return mergeFieldsSheet
      .map((f) => {
        const key = String(f.key || '').trim();
        const ex = String(f.example || '').trim();
        return `{{${key}}}\t${ex}`;
      })
      .join('\n');
  }, [mergeFieldsSheet]);

  const activeFieldConfigSummary = useMemo(() => {
    if (isMergeFieldPresetMongoId(selectedFieldPresetId)) {
      const fromGuide = String(fieldGuide?.presetName || '').trim();
      const fromList = fieldPresets.find((p) => String(p._id) === String(selectedFieldPresetId).trim());
      const name = fromGuide || String(fromList?.name || '').trim();
      return name ? `저장된 구성: ${name}` : '저장된 필드 구성';
    }
    return fieldGuide?.usingCustom ? '회사 기본 (커스텀 저장됨)' : '회사 기본 (한 벌)';
  }, [selectedFieldPresetId, fieldGuide, fieldPresets]);

  const templatePrepareMailTokens = useMemo(
    () => listMergeMailTokens(mergeFieldsSheet),
    [mergeFieldsSheet]
  );

  const templatePrepareMailTokenHint = useMemo(
    () => buildMergeMailTokenHintFromFields(mergeFieldsSheet),
    [mergeFieldsSheet]
  );

  const appendTemplatePrepareMailText = useCallback(
    (token) => {
      const piece = String(token || '');
      if (!piece) return;
      const target = templateUploadPrepareMailInsertTarget;
      setTemplateUploadPrepareMail((m) => ({
        ...m,
        [target]: `${String(m[target] || '')}${piece}`
      }));
    },
    [templateUploadPrepareMailInsertTarget]
  );

  const insertTemplatePrepareMailToken = useCallback(
    (fieldKey) => {
      const key = String(fieldKey || '').trim();
      if (!key) return;
      appendTemplatePrepareMailText(`{{${key}}}`);
    },
    [appendTemplatePrepareMailText]
  );

  const loadTemplateProfiles = useCallback(async () => {
    try {
      const map = await fetchMergeTemplateProfiles(getAuthHeader, runtime.apiPrefix, apiFetchInit);
      setTemplateProfilesById(map);
      return map;
    } catch (_) {
      setTemplateProfilesById({});
      return {};
    }
  }, [getAuthHeader, runtime.apiPrefix, apiFetchInit]);

  const openTemplateUploadPrepare = useCallback(() => {
    setTemplatePrepareMode('create');
    setTemplatePrepareEditingTemplate(null);
    void loadFieldPresets();
    void loadFieldGuide();
    setTemplateUploadPendingFile(null);
    setTemplateUploadPreparePdfOpts(loadMergePdfExportOptions());
    setTemplateUploadPrepareMail({ mailTo: '', mailCc: '', mailSubject: '', mailBody: '' });
    setTemplateUploadPrepareScope('company');
    setTemplateUploadPreparePdfOpen(false);
    setTemplateUploadPrepareOpen(true);
  }, [loadFieldPresets, loadFieldGuide]);

  const openTemplateEditPrepare = useCallback(
    async (template) => {
      if (!template?._id) return;
      if (!canEditTemplateProfile(template)) {
        window.alert(MERGE_COMMON_TEMPLATE_PROFILE_READONLY_MSG);
        return;
      }
      const tid = String(template._id);
      setSelectedTemplateId(tid);
      setTemplatePrepareMode('edit');
      setTemplatePrepareEditingTemplate(template);
      setTemplateUploadPendingFile(null);
      setTemplateUploadPreparePdfOpen(false);
      void loadFieldPresets();
      void loadFieldGuide();
      let profMap = templateProfilesById;
      try {
        profMap = await fetchMergeTemplateProfiles(getAuthHeader, runtime.apiPrefix, apiFetchInit);
        setTemplateProfilesById(profMap);
      } catch (_) {
        /* 기존 캐시로 폼 채움 */
      }
      const prof = profMap[tid];
      setTemplateUploadPreparePdfOpts(
        prof?.pdfExportOptions
          ? normalizeMergePdfExportOptions(prof.pdfExportOptions)
          : loadMergePdfExportOptions()
      );
      setTemplateUploadPrepareMail({
        mailTo: String(prof?.mailDefaults?.mailTo ?? ''),
        mailCc: String(prof?.mailDefaults?.mailCc ?? ''),
        mailSubject: String(prof?.mailDefaults?.mailSubject ?? ''),
        mailBody: String(prof?.mailDefaults?.mailBody ?? '')
      });
      setTemplateUploadPrepareScope('company');
      setTemplateUploadPrepareOpen(true);
    },
    [loadFieldPresets, loadFieldGuide, getAuthHeader, templateProfilesById, canEditTemplateProfile, apiFetchInit, runtime.apiPrefix]
  );

  const closeTemplateUploadPrepare = useCallback(() => {
    setTemplateUploadPrepareOpen(false);
    setTemplatePrepareMode('create');
    setTemplatePrepareEditingTemplate(null);
    setTemplateUploadPendingFile(null);
    setTemplateUploadPrepareDropActive(false);
  }, []);

  useEffect(() => {
    if (!templateUploadPrepareOpen || mergeFieldEditorOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') closeTemplateUploadPrepare();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [templateUploadPrepareOpen, mergeFieldEditorOpen, closeTemplateUploadPrepare]);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError('');
    try {
      const res = await fetch(`${mergeApiBase}/templates`, apiFetchInit());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '양식 목록을 불러오지 못했습니다.');
      const items = Array.isArray(data.items) ? data.items : [];
      setTemplates(items);
      setSelectedTemplateId((prev) => {
        if (prev && items.some((t) => String(t._id) === String(prev))) return prev;
        return items[0]?._id ? String(items[0]._id) : '';
      });
    } catch (e) {
      setTemplates([]);
      setTemplatesError(e.message || '양식 목록을 불러오지 못했습니다.');
    } finally {
      setTemplatesLoading(false);
    }
  }, [apiFetchInit, mergeApiBase]);

  const uploadTemplateFile = useCallback(async (file, opts = {}) => {
    if (!file) {
      window.alert('파일을 선택해 주세요.');
      return;
    }
    if (!isAllowedMergeTemplateFilename(file.name)) {
      window.alert(`${MERGE_TEMPLATE_UPLOAD_HINT} 파일만 등록할 수 있습니다.`);
      return;
    }
    const lower = String(file.name || '').toLowerCase();
    setUploading(true);
    try {
      await pingBackendHealth();
      const fd = new FormData();
      fd.append('file', file);
      if (runtime.showRegistrationScopePicker) {
        const scope = opts.registrationScope === 'personal' ? 'personal' : 'company';
        fd.append('registrationScope', scope);
      }
      const pdfOpts = opts.pdfExportOptions
        ? normalizeMergePdfExportOptions(opts.pdfExportOptions)
        : null;
      if (pdfOpts) fd.append('pdfExportOptions', JSON.stringify(pdfOpts));
      const mail = opts.mailDefaults;
      if (mail && templateProfileHasMailDefaults(mail)) {
        fd.append('mailDefaults', JSON.stringify(mail));
      }
      const res = await fetch(`${mergeApiBase}/templates`, {
        method: 'POST',
        headers: { ...getAuthHeader({ formData: true }) },
        credentials: 'include',
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(getUserVisibleApiError(data, '업로드에 실패했습니다.'));
      await loadTemplates();
      await loadTemplateProfiles();
      const newTid = data.item?._id ? String(data.item._id) : '';
      if (newTid) setSelectedTemplateId(newTid);
      if (lower.endsWith('.xlsx') && newTid) {
        try {
          const names = await fetchXlsxSheetNamesFromMergeTemplate(
            API_BASE,
            getAuthHeader,
            newTid,
            runtime.apiPrefix,
            apiFetchInit
          );
          if (names.length) {
            setPdfExportOptions((prev) =>
              saveMergePdfExportOptions(pdfExportOptionsWithSheetNames(prev, names))
            );
          }
        } catch (_) {
          /* 업로드는 성공 — PDF 시트 자동 맞춤만 생략 */
        }
      }
      opts.afterSuccess?.();
      if (data.storage === 'mongodb') {
        window.alert(
          '양식이 등록되었습니다. (Cloudinary 환경변수가 없어 DB에 저장되었습니다. Railway·Vercel에 CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET 을 설정하면 Cloudinary로 업로드됩니다.)'
        );
      } else {
        window.alert('양식이 등록되었습니다. (Cloudinary에 저장되었습니다.)');
      }
    } catch (err) {
      window.alert(err.message || '업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  }, [loadTemplates, loadTemplateProfiles, closeTemplateUploadPrepare, mergeDataSheetOpen]);

  const saveTemplateProfilePrepare = useCallback(async () => {
    const tid = templatePrepareEditingTemplate?._id
      ? String(templatePrepareEditingTemplate._id)
      : '';
    if (!tid) return;
    if (!canEditTemplateProfile(templatePrepareEditingTemplate)) {
      window.alert(MERGE_COMMON_TEMPLATE_PROFILE_READONLY_MSG);
      return;
    }
    if (!mergeFieldsSheet.length) {
      window.alert('문서 치환 항목을 불러온 뒤 저장할 수 있습니다. 필드 구성을 확인하거나 치환 항목 편집에서 항목을 추가해 주세요.');
      return;
    }
    setUploading(true);
    try {
      await pingBackendHealth();
      await patchMergeTemplateProfile(
        getAuthHeader,
        tid,
        {
          ...(runtime.showRegistrationScopePicker
            ? { registrationScope: templateUploadPrepareScope }
            : {}),
          pdfExportOptions: templateUploadPreparePdfOpts,
          mailDefaults: templateUploadPrepareMail
        },
        runtime.apiPrefix
      );
      const map = await loadTemplateProfiles();
      const prof = map[tid];
      const normPdf = prof?.pdfExportOptions
        ? normalizeMergePdfExportOptions(prof.pdfExportOptions)
        : normalizeMergePdfExportOptions(templateUploadPreparePdfOpts);
      const savedMailFallback =
        prof?.mailDefaults && templateProfileHasMailDefaults(prof.mailDefaults)
          ? prof.mailDefaults
          : mergeMailFallback;
      setMergeRows((rows) =>
        rows.map((r) => {
          const ids = getRowTemplateIds(r, selectedTemplateId || defaultTemplateIdFromList(templates));
          if (!ids.includes(tid)) return r;
          let next = { ...r, _pdfExportOptions: normPdf };
          next._exportAddon = resolveMergeExportAddonForRow(next, map, pdfExportOptions, ids);
          next = hydrateMergeRowMailFromProfiles(
            next,
            map,
            mergeFieldsSheet,
            savedMailFallback
          );
          return next;
        })
      );
      closeTemplateUploadPrepare();
      window.alert('양식의 PDF·메일 설정을 저장했습니다.');
    } catch (err) {
      window.alert(err.message || '양식 설정 저장에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  }, [
    templatePrepareEditingTemplate,
    mergeFieldsSheet.length,
    templateUploadPrepareScope,
    templateUploadPreparePdfOpts,
    templateUploadPrepareMail,
    getAuthHeader,
    loadTemplateProfiles,
    closeTemplateUploadPrepare,
    selectedTemplateId,
    templates,
    pdfExportOptions,
    mergeMailFallback,
    mergeFieldsSheet,
    runtime.apiPrefix,
    runtime.showRegistrationScopePicker,
    canEditTemplateProfile
  ]);

  const saveTemplateUploadPrepare = useCallback(async () => {
    if (templatePrepareMode === 'edit') {
      await saveTemplateProfilePrepare();
      return;
    }
    if (!templateUploadPendingFile) {
      window.alert(`${MERGE_TEMPLATE_UPLOAD_HINT} 파일을 이 창에 끌어다 놓거나 선택해 주세요.`);
      return;
    }
    if (!mergeFieldsSheet.length) {
      window.alert('문서 치환 항목을 불러온 뒤 등록할 수 있습니다. 필드 구성을 확인하거나 치환 항목 편집에서 항목을 추가해 주세요.');
      return;
    }
    await uploadTemplateFile(templateUploadPendingFile, {
      registrationScope: templateUploadPrepareScope,
      pdfExportOptions: templateUploadPreparePdfOpts,
      mailDefaults: templateUploadPrepareMail,
      afterSuccess: closeTemplateUploadPrepare
    });
  }, [
    templatePrepareMode,
    saveTemplateProfilePrepare,
    templateUploadPendingFile,
    mergeFieldsSheet.length,
    templateUploadPrepareScope,
    templateUploadPreparePdfOpts,
    templateUploadPrepareMail,
    uploadTemplateFile,
    closeTemplateUploadPrepare
  ]);

  const onTemplateDragEnter = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (templatesLoading || uploading) return;
      setTemplateDropActive(true);
    },
    [templatesLoading, uploading]
  );

  const onTemplateDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const next = e.relatedTarget;
    if (next && e.currentTarget.contains(next)) return;
    setTemplateDropActive(false);
  }, []);

  const onTemplateDragOver = useCallback(
    (e) => {
      if (templatesLoading || uploading) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    },
    [templatesLoading, uploading]
  );

  const onTemplateDrop = useCallback(
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      setTemplateDropActive(false);
      if (templatesLoading || uploading) return;
      const f = e.dataTransfer?.files?.[0];
      if (f) await uploadTemplateFile(f);
    },
    [templatesLoading, uploading, uploadTemplateFile]
  );

  useEffect(() => {
    void loadTemplates();
    void loadTemplateProfiles();
  }, [loadTemplates, loadTemplateProfiles]);

  useEffect(() => {
    void loadFieldGuide();
  }, [loadFieldGuide]);

  useEffect(() => {
    if (!mergeDataSheetOpen) return;
    void loadFieldPresets();
  }, [mergeDataSheetOpen, loadFieldPresets]);

  useEffect(() => {
    const fields = mergeFieldsWithoutRowIndex(fieldGuide?.fields);
    if (!Array.isArray(fields) || fields.length === 0) return;
    const defTid = selectedTemplateId || defaultTemplateIdFromList(templates);
    setMergeRows((prev) => {
      if (!prev.length) {
        return createInitialMergeRows(fields, defTid);
      }
      const allEmpty = prev.every((r) => !rowHasContent(r));
      if (allEmpty && prev.length < MERGE_SHEET_INITIAL_ROWS) {
        return createInitialMergeRows(fields, defTid);
      }
      return prev.map((row) => {
        const preservedIds = Array.isArray(row._templateIds)
          ? row._templateIds.map(String).filter((id) => templates.some((t) => String(t._id) === id))
          : [];
        let tid =
          row._templateId && templates.some((t) => String(t._id) === String(row._templateId))
            ? String(row._templateId)
            : defTid;
        const nextIds =
          preservedIds.length > 0 ? preservedIds : tid ? [tid] : defTid ? [defTid] : [];
        const firstTid = nextIds[0] || defTid || '';
        const next = createMergeRowState(fields, firstTid, row._include !== false, nextIds);
        for (const f of fields) {
          next[f.key] = row[f.key] != null ? String(row[f.key]) : '';
        }
        const profForRow = firstTid ? templateProfilesById[String(firstTid)] : null;
        if (profForRow?.pdfExportOptions) {
          next._pdfExportOptions = normalizeMergePdfExportOptions(profForRow.pdfExportOptions);
        }
        next._exportAddon = resolveMergeExportAddonForRow(
          next,
          templateProfilesById,
          pdfExportOptions,
          nextIds
        );
        next._mailTo = row._mailTo != null ? String(row._mailTo) : '';
        next._mailCc = row._mailCc != null ? String(row._mailCc) : '';
        next._mailSubject = row._mailSubject != null ? String(row._mailSubject) : '';
        next._mailBody = row._mailBody != null ? String(row._mailBody) : '';
        return next;
      });
    });
  }, [fieldSig, fieldGuide, selectedTemplateId, templates, templateProfilesById, pdfExportOptions]);

  const openFieldEditor = () => {
    if (!mergeFieldsSheet?.length) {
      window.alert('문서 치환 항목을 불러온 뒤 편집할 수 있습니다. 필드 구성을 확인하거나 잠시 후 다시 시도해 주세요.');
      return;
    }
    const presetId = isMergeFieldPresetMongoId(selectedFieldPresetId) ? String(selectedFieldPresetId).trim() : '';
    if (presetId) {
      const fromGuide = String(fieldGuide?.presetName || '').trim();
      const fromList = fieldPresets.find((p) => String(p._id) === presetId);
      const fromListName = String(fromList?.name || '').trim();
      setFieldPresetNameDraft((fromGuide || fromListName || '새 구성').slice(0, MERGE_FIELD_PRESET_NAME_MAX));
    } else {
      setFieldPresetNameDraft('');
    }
    setFieldDraft(mapApiFieldsToEditorDraft(mergeFields));
  };

  const openFieldEditorFromSheet = () => {
    openFieldEditor();
    setMergeFieldEditorOpen(true);
  };

  const openFieldEditorFromTemplatePrepare = () => {
    openFieldEditor();
    setMergeFieldEditorOpen(true);
  };

  const closeFieldEditor = () => {
    setFieldDraft(null);
    setFieldPresetNameDraft('');
    setMergeFieldEditorOpen(false);
  };

  const saveFieldDraft = async () => {
    const built = buildMergeFieldsPayload(fieldDraft);
    if (!built.ok) {
      window.alert(built.error);
      return;
    }
    const fieldsPayload = built.fields;
    const presetId = isMergeFieldPresetMongoId(selectedFieldPresetId) ? String(selectedFieldPresetId).trim() : '';
    if (presetId) {
      const nameTrim = String(fieldPresetNameDraft || '').trim();
      if (!nameTrim) {
        window.alert('구성 이름을 입력해 주세요.');
        return;
      }
      if (nameTrim.length > MERGE_FIELD_PRESET_NAME_MAX) {
        window.alert(`구성 이름은 ${MERGE_FIELD_PRESET_NAME_MAX}자 이하로 해 주세요.`);
        return;
      }
    }

    setFieldSaving(true);
    try {
      await pingBackendHealth();
      const url = presetId
        ? `${mergeApiBase}/field-presets/${presetId}`
        : `${mergeApiBase}/field-config`;
      const body = presetId
        ? { fields: fieldsPayload, name: String(fieldPresetNameDraft || '').trim().slice(0, MERGE_FIELD_PRESET_NAME_MAX) }
        : { fields: fieldsPayload };
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(getUserVisibleApiError(data, '저장에 실패했습니다.'));
      await loadFieldGuide();
      await loadFieldPresets();
      await loadTemplates();
      closeFieldEditor();
      window.alert(presetId ? '저장된 필드 구성을 반영했습니다.' : '회사 기본 치환 항목을 저장했습니다.');
    } catch (e) {
      window.alert(e.message || '저장에 실패했습니다.');
    } finally {
      setFieldSaving(false);
    }
  };

  const resetFieldGuideToDefault = async () => {
    const presetId = isMergeFieldPresetMongoId(selectedFieldPresetId) ? String(selectedFieldPresetId).trim() : '';
    if (presetId) {
      if (!window.confirm('이 이름으로 저장된 필드 구성을 DB에서 삭제할까요?')) return;
    } else if (!window.confirm('저장된 커스텀 필드를 지우고 기본 필드로 되돌릴까요?')) {
      return;
    }
    setFieldSaving(true);
    try {
      await pingBackendHealth();
      if (presetId) {
        const res = await fetch(`${mergeApiBase}/field-presets/${presetId}`, {
          method: 'DELETE',
          headers: { ...getAuthHeader() },
          credentials: 'include'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(getUserVisibleApiError(data, '삭제에 실패했습니다.'));
        setSelectedFieldPresetId('');
        await loadFieldPresets();
        await loadFieldGuide();
        closeFieldEditor();
        window.alert('저장된 필드 구성을 삭제했습니다.');
      } else {
        const res = await fetch(`${mergeApiBase}/field-config`, {
          method: 'DELETE',
          headers: { ...getAuthHeader() },
          credentials: 'include'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(getUserVisibleApiError(data, '초기화에 실패했습니다.'));
        await loadFieldGuide();
        closeFieldEditor();
        window.alert('회사 기본 치환 항목으로 되돌렸습니다.');
      }
    } catch (e) {
      window.alert(e.message || '처리에 실패했습니다.');
    } finally {
      setFieldSaving(false);
    }
  };

  const createFieldPresetFromSheet = async () => {
    if (!canManageMergeFields || !mergeFieldsSheet?.length) return;
    const name = window.prompt('새 필드 구성 이름(나중에 시트 맨 위에서 고를 수 있습니다):', '')?.trim();
    if (!name) return;
    setFieldPresetsLoading(true);
    try {
      await pingBackendHealth();
      const built = buildMergeFieldsPayload(mergeFieldsSheet);
      if (!built.ok) {
        window.alert(built.error);
        return;
      }
      const res = await fetch(`${mergeApiBase}/field-presets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
        body: JSON.stringify({ name, fields: built.fields })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(getUserVisibleApiError(data, '새 구성을 만들지 못했습니다.'));
      const newId = data.item?._id ? String(data.item._id) : '';
      await loadFieldPresets();
      if (newId) setSelectedFieldPresetId(newId);
      await loadFieldGuide(newId || undefined);
      window.alert('새 필드 구성을 저장했습니다.');
    } catch (e) {
      window.alert(e.message || '새 구성을 만들지 못했습니다.');
    } finally {
      setFieldPresetsLoading(false);
    }
  };

  /** 편집기: 현재 시트 항목으로 새 DB 필드 구성 등록(회사 기본 한 벌 모드에서 사용) */
  const createFieldPresetFromEditor = async () => {
    if (!canManageMergeFields) return;
    const built = buildMergeFieldsPayload(fieldDraft);
    if (!built.ok) {
      window.alert(built.error);
      return;
    }
    const nameTrim = String(fieldPresetNameDraft || '').trim().slice(0, MERGE_FIELD_PRESET_NAME_MAX);
    if (!nameTrim) {
      window.alert('위 칸에 새 구성 이름을 입력한 뒤 「새 구성 DB 등록」을 눌러 주세요.');
      return;
    }
    setFieldSaving(true);
    try {
      await pingBackendHealth();
      const res = await fetch(`${mergeApiBase}/field-presets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
        body: JSON.stringify({ name: nameTrim, fields: built.fields })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(getUserVisibleApiError(data, '새 구성을 만들지 못했습니다.'));
      const newId = data.item?._id ? String(data.item._id) : '';
      if (!newId) throw new Error('저장된 구성 id를 받지 못했습니다.');
      setSelectedFieldPresetId(newId);
      await loadFieldPresets();
      await loadFieldGuide(newId);
      const nm = String(data.item?.name || nameTrim).trim().slice(0, MERGE_FIELD_PRESET_NAME_MAX);
      setFieldPresetNameDraft(nm);
      if (Array.isArray(data.item?.fields)) {
        setFieldDraft(mapApiFieldsToEditorDraft(data.item.fields));
      }
      window.alert('새 필드 구성을 DB에 등록했습니다. 데이터 시트 맨 위에서도 골라 쓸 수 있습니다.');
    } catch (e) {
      window.alert(e.message || '새 구성을 만들지 못했습니다.');
    } finally {
      setFieldSaving(false);
    }
  };

  const fetchTemplateFileBlob = async (id) => {
    await pingBackendHealth();
    const res = await fetch(`${mergeApiBase}/templates/${id}/download`, apiFetchInit());
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(getUserVisibleApiError(data, '양식 파일을 불러오지 못했습니다.'));
    }
    return res.blob();
  };

  const downloadTemplateFile = async (id, filename) => {
    try {
      const blob = await fetchTemplateFileBlob(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'template.bin';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert(e.message || '다운로드에 실패했습니다.');
    }
  };

  const deleteTemplate = async (id) => {
    if (!window.confirm('이 양식을 삭제할까요?')) return;
    try {
      await pingBackendHealth();
      const res = await fetch(`${mergeApiBase}/templates/${id}`, {
        method: 'DELETE',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(getUserVisibleApiError(data, '삭제에 실패했습니다.'));
      await loadTemplates();
    } catch (e) {
      window.alert(e.message || '삭제에 실패했습니다.');
    }
  };

  useEffect(() => {
    setTemplateRowSelectedIds((prev) => {
      const next = new Set();
      for (const id of prev) {
        if (templates.some((t) => String(t._id) === id)) next.add(id);
      }
      return next;
    });
  }, [templates]);

  const setTemplateRangeSelectionByIndex = useCallback((fromIdx, toIdx) => {
    const a = Math.max(0, Math.min(fromIdx, toIdx));
    const b = Math.min(templates.length - 1, Math.max(fromIdx, toIdx));
    if (a > b || !templates.length) {
      setTemplateRowSelectedIds(new Set());
      return;
    }
    const next = new Set();
    for (let i = a; i <= b; i += 1) {
      const id = templates[i]?._id;
      if (id != null) next.add(String(id));
    }
    setTemplateRowSelectedIds(next);
  }, [templates]);

  const handleTemplateGutterMouseDown = useCallback(
    (e, idx) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const id = String(templates[idx]?._id ?? '');
      if (!id) return;

      if (e.shiftKey && templateSelectAnchorIdxRef.current != null) {
        setTemplateRangeSelectionByIndex(templateSelectAnchorIdxRef.current, idx);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        setTemplateRowSelectedIds((prev) => {
          const n = new Set(prev);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
        });
        templateSelectAnchorIdxRef.current = idx;
        return;
      }

      templateSelectAnchorIdxRef.current = idx;
      templateDragSelectRef.current = { active: true, startIdx: idx };

      const onMove = (ev) => {
        if (!templateDragSelectRef.current.active) return;
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const tr = el && typeof el.closest === 'function' ? el.closest('tr[data-template-row-index]') : null;
        if (!tr) return;
        const endIdx = Number(tr.getAttribute('data-template-row-index'));
        if (Number.isNaN(endIdx)) return;
        const startIdx = templateDragSelectRef.current.startIdx;
        if (startIdx == null) return;
        setTemplateRangeSelectionByIndex(startIdx, endIdx);
      };

      const onUp = () => {
        templateDragSelectRef.current = { active: false, startIdx: null };
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      setTemplateRowSelectedIds(new Set([id]));
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [templates, setTemplateRangeSelectionByIndex]
  );

  const copySelectedTemplatesTsv = useCallback(async (opts) => {
    const silent = opts?.silent === true;
    const sel = templateRowSelectedIdsRef.current;
    const rows = templates.filter((t) => sel.has(String(t._id)));
    if (rows.length === 0) {
      if (!silent) window.alert('선택된 행이 없습니다. 왼쪽 # 열을 드래그하거나 Ctrl+클릭으로 선택하세요.');
      return;
    }
    const header = ['파일 이름', '종류', '크기', '등록일'].join('\t');
    const body = rows
      .map((t) => {
        const name = templateListFileName(t);
        const kind = mergeTemplateKindLabel(t.fileType);
        const size = formatBytes(t.sizeBytes);
        const date = t.createdAt ? new Date(t.createdAt).toLocaleString('ko-KR') : '—';
        return [name, kind, size, date].join('\t');
      })
      .join('\n');
    const tsv = `${header}\n${body}`;
    try {
      await navigator.clipboard.writeText(tsv);
      if (!silent) window.alert('클립보드에 탭으로 구분된 표를 복사했습니다. 엑셀에 붙여넣기(Ctrl+V) 하세요.');
    } catch {
      window.alert('복사에 실패했습니다. 브라우저 클립보드 권한을 확인해 주세요.');
    }
  }, [templates]);

  const downloadSelectedTemplates = useCallback(async () => {
    const sel = templateRowSelectedIdsRef.current;
    const rows = templates.filter((t) => sel.has(String(t._id)));
    if (rows.length === 0) return;
    for (let i = 0; i < rows.length; i += 1) {
      const t = rows[i];
      await downloadTemplateFile(t._id, t.originalFilename || `${t.name}.${t.fileType}`);
      if (i < rows.length - 1) await new Promise((r) => setTimeout(r, 400));
    }
  }, [templates]);

  useEffect(() => {
    const el = templateTableScopeRef.current;
    if (!el) return;
    const onKeyDown = (e) => {
      if (!templates.length) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          setTemplateRowSelectedIds(new Set(templates.map((t) => String(t._id))));
          templateSelectAnchorIdxRef.current = templates.length - 1;
        }
        if (e.key === 'c' || e.key === 'C') {
          if (templateRowSelectedIdsRef.current.size === 0) return;
          e.preventDefault();
          void copySelectedTemplatesTsv({ silent: true });
        }
      }
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [templates, copySelectedTemplatesTsv]);

  const updateRow = (index, key, value) => {
    setMergeRows((rows) =>
      rows.map((r, i) => {
        if (i !== index) return r;
        let next = { ...r, [key]: value };
        const isMergeField =
          key &&
          !String(key).startsWith('_') &&
          (mergeFieldsSheet || []).some((f) => f.key === key);
        if (isMergeField) {
          const profMail = mailDefaultsForRow(next, templateProfilesById);
          next = refreshMailTokensFromProfile(next, profMail, mergeFieldsSheet, {
            templateProfilesById,
            pageMailFallback: mergeMailFallback
          });
        }
        return next;
      })
    );
  };

  const updateRowTemplates = useCallback(
    (index, templateIds) => {
      const def = selectedTemplateId || defaultTemplateIdFromList(templates);
      let clean = [
        ...new Set(
          (Array.isArray(templateIds) ? templateIds : [])
            .map(String)
            .filter((id) => templates.some((t) => String(t._id) === id))
        )
      ];
      if (!clean.length && def) clean = [String(def)];
      const first = clean[0] || '';
      const primaryId = clean[0] || '';
      const prof = primaryId ? templateProfilesById[String(primaryId)] : null;
      setMergeRows((rows) =>
        rows.map((r, i) => {
          if (i !== index) return r;
          let next = { ...r, _templateIds: clean, _templateId: first };
          const normPdf = prof?.pdfExportOptions
            ? normalizeMergePdfExportOptions(prof.pdfExportOptions)
            : null;
          next._pdfExportOptions = normPdf;
          next._exportAddon = resolveMergeExportAddonForRow(
            next,
            templateProfilesById,
            pdfExportOptions,
            clean
          );
          return hydrateMergeRowMailFromProfiles(
            next,
            templateProfilesById,
            mergeFieldsSheet,
            mergeMailFallback
          );
        })
      );
    },
    [
      templates,
      selectedTemplateId,
      templateProfilesById,
      mergeFieldsSheet,
      pdfExportOptions,
      mergeMailFallback
    ]
  );

  const applyMergeGridPatch = useCallback(
    (anchorRow, anchorSheetCol, grid) => {
      const cols = mergeFieldsSheet || [];
      if (!Array.isArray(grid) || !grid.length) return;
      const prefixN = MERGE_SHEET_PREFIX_COL_COUNT;
      const fieldStart = MERGE_SHEET_FIELD_START;
      setMergeRows((rows) => {
        const tid = selectedTemplateId || defaultTemplateIdFromList(templates);
        let next = rows.map((r) => ({ ...r }));
        const needRows = anchorRow + grid.length;
        while (next.length < needRows && next.length < MERGE_SHEET_MAX_ROWS) {
          next.push(createMergeRowState(cols, tid, true));
        }
        for (let r = 0; r < grid.length; r += 1) {
          for (let c = 0; c < grid[r].length; c += 1) {
            const ri = anchorRow + r;
            const sheetCol = anchorSheetCol + c;
            if (ri < 0 || ri >= next.length) continue;
            if (sheetCol >= 0 && sheetCol < prefixN) {
              if (sheetCol === 0) {
                const ids = parseTemplateIdsFromPaste(grid[r][c], templates, tid);
                const first = ids[0] || '';
                next[ri] = { ...next[ri], _templateIds: ids, _templateId: first };
              }
              continue;
            }
            if (sheetCol >= prefixN && sheetCol < fieldStart) {
              const mk = MERGE_SHEET_MAIL_ROW_KEYS[sheetCol - prefixN];
              if (mk) next[ri] = { ...next[ri], [mk]: grid[r][c] ?? '' };
              continue;
            }
            const fi = sheetCol - fieldStart;
            if (fi < 0 || fi >= cols.length) continue;
            const fk = cols[fi].key;
            next[ri] = { ...next[ri], [fk]: grid[r][c] ?? '' };
          }
        }
        return next;
      });
    },
    [mergeFieldsSheet, templates, selectedTemplateId]
  );

  const focusMergeSheetCell = useCallback(
    (r, sheetCol) => {
      const cols = mergeFieldsSheet || [];
      const nSheet = MERGE_SHEET_FIELD_START + cols.length;
      const nrows = mergeRows.length;
      if (r < 0 || sheetCol < 0 || r >= nrows || sheetCol >= nSheet) return;
      requestAnimationFrame(() => {
        const td = document.querySelector(
          `.merge-data-sheet-modal-root [data-merge-sheet-row="${r}"][data-merge-sheet-col="${sheetCol}"]`
        );
        const el = td?.querySelector('textarea.qdm-cell--sheet');
        if (!el) return;
        el.focus();
        try {
          const len = el.value.length;
          el.selectionStart = el.selectionEnd = len;
        } catch (_) {
          /* ignore */
        }
      });
    },
    [mergeRows.length, mergeFieldsSheet]
  );

  const mergeSheetNavKeyDown = useCallback(
    (e, { rowIndex, sheetCol, multiline, value, commit }) => {
      if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
      const isEnter = e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter';
      const nrows = mergeRows.length;
      const nSheetCols = MERGE_SHEET_FIELD_START + (mergeFieldsSheet || []).length;

      if (isEnter && e.altKey) {
        if (!multiline) {
          e.preventDefault();
          return;
        }
        const ta = e.currentTarget;
        if (ta.tagName !== 'TEXTAREA') return;
        e.preventDefault();
        const start = ta.selectionStart ?? 0;
        const end = ta.selectionEnd ?? 0;
        const next = value.slice(0, start) + '\n' + value.slice(end);
        const pos = start + 1;
        flushSync(() => {
          commit(next);
        });
        requestAnimationFrame(() => {
          try {
            ta.focus();
            ta.selectionStart = ta.selectionEnd = pos;
          } catch (_) {
            /* ignore */
          }
        });
        return;
      }

      if (isEnter && !e.altKey) {
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        if (rowIndex + 1 < nrows) focusMergeSheetCell(rowIndex + 1, sheetCol);
        return;
      }
      if (e.key === 'Tab') {
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        let nr = rowIndex;
        let nc = sheetCol;
        if (e.shiftKey) {
          nc -= 1;
          if (nc < 0) {
            nc = nSheetCols - 1;
            nr -= 1;
          }
        } else {
          nc += 1;
          if (nc >= nSheetCols) {
            nc = 0;
            nr += 1;
          }
        }
        if (nr < 0 || nr >= nrows) return;
        focusMergeSheetCell(nr, nc);
      }
    },
    [mergeRows, mergeFieldsSheet, focusMergeSheetCell]
  );

  const handleMergeSheetCellPaste = useCallback(
    (e, rowIndex, sheetCol) => {
      const t = e.clipboardData?.getData('text/plain');
      if (t == null || t === '') return;
      const grid = parseTsvGrid(t);
      if (!grid.length) return;
      const multi = grid.length > 1 || (grid[0] && grid[0].length > 1);
      if (!multi) return;
      e.preventDefault();
      applyMergeGridPatch(rowIndex, sheetCol, grid);
    },
    [applyMergeGridPatch]
  );

  const handleMergeSheetCellKeyDown = useCallback(
    (e, rowIndex, sheetCol) => {
      const mailStart = MERGE_SHEET_PREFIX_COL_COUNT;
      const fieldStart = MERGE_SHEET_FIELD_START;
      const key =
        sheetCol >= mailStart && sheetCol < fieldStart
          ? MERGE_SHEET_MAIL_ROW_KEYS[sheetCol - mailStart]
          : '';
      const multiline = sheetCol === fieldStart - 1;
      const row = mergeRows[rowIndex];
      const value = row && key && row[key] != null ? String(row[key]) : '';
      mergeSheetNavKeyDown(e, {
        rowIndex,
        sheetCol,
        multiline,
        value,
        commit: key ? (next) => updateRow(rowIndex, key, next) : () => {}
      });
    },
    [mergeRows, mergeSheetNavKeyDown, updateRow]
  );

  const handleMergeSheetGridPaste = useCallback(
    (anchor, grid) => {
      applyMergeGridPatch(anchor.r, anchor.c, grid);
    },
    [applyMergeGridPatch]
  );

  const appendRowsFromCompanies = (rows) => {
    const fields = mergeFieldsSheet || [];
    const tid = selectedTemplateId || defaultTemplateIdFromList(templates);
    const empty = createMergeRowState(fields, tid, true);
    setMergeRows((prev) => {
      const appended = rows.map((r) => ({
        ...empty,
        ...r,
        _include: true,
        _templateId: tid,
        _templateIds: tid ? [tid] : []
      }));
      /* 기존 빈 행도「내용 없음」으로 간주되므로 prev를 비우면 안 됨 — 불러온 행은 뒤에 이어 붙임 */
      const combined = [...prev, ...appended];
      if (combined.length > MERGE_SHEET_MAX_ROWS) {
        window.alert(`행은 최대 ${MERGE_SHEET_MAX_ROWS}개입니다. 초과분은 잘렸습니다.`);
        return combined.slice(0, MERGE_SHEET_MAX_ROWS);
      }
      return combined;
    });
  };

  const blurFormatCell = (rowIndex, key, raw) => {
    if (key === 'businessNumber') {
      const formatted = formatKrBusinessNumber(raw);
      if (formatted !== raw) updateRow(rowIndex, key, formatted);
      return;
    }
    if (key === 'phone') {
      const formatted = formatKrPhone(raw);
      if (formatted !== raw) updateRow(rowIndex, key, formatted);
    }
  };

  /** ZIP 없음: plan으로 출력 개수 확인 후 `singleOutputIndex`로 각 파일을 순서대로 받습니다. */
  const handleChangePdfExportOptions = useCallback((next) => {
    const norm = saveMergePdfExportOptions(next);
    setPdfExportOptions(norm);
  }, []);

  const closePdfPreview = useCallback(() => {
    setPdfPreviewOpen(false);
    if (pdfPreviewUrlRef.current) {
      URL.revokeObjectURL(pdfPreviewUrlRef.current);
      pdfPreviewUrlRef.current = '';
    }
    setPdfPreviewObjectUrl('');
    setPdfPreviewError('');
    setPdfPreviewCaption('');
  }, []);

  const requestPdfPreview = useCallback(
    async (_pdfOpts, explicitRowIndex) => {
      const fallbackTid = selectedTemplateId || defaultTemplateIdFromList(templates);
      const prof = profileTagForMergeZip(selectedFieldPresetId, fieldGuide, fieldPresets);
      const fieldPresetIdParam = isMergeFieldPresetMongoId(selectedFieldPresetId)
        ? String(selectedFieldPresetId).trim()
        : undefined;
      let previewRowIndex = -1;
      if (
        typeof explicitRowIndex === 'number' &&
        explicitRowIndex >= 0 &&
        explicitRowIndex < mergeRows.length
      ) {
        const row = mergeRows[explicitRowIndex];
        if (!rowWantsPdfExportIntent(row, templateProfilesById, pdfExportOptions, fallbackTid)) {
          throw new Error(
            'PDF 미리보기: 이 행 양식의 PDF 설정에서 PDF 추가·만 추출을 켜 주세요. (양식 등록·PDF 설정)'
          );
        }
        if (!rowHasMergeFieldContent(row, mergeFieldsSheet)) {
          throw new Error('PDF 미리보기: 이 행에 치환 데이터를 입력해 주세요.');
        }
        previewRowIndex = explicitRowIndex;
      } else {
        for (let i = 0; i < mergeRows.length; i += 1) {
          if (
            rowWantsPdfExportIntent(mergeRows[i], templateProfilesById, pdfExportOptions, fallbackTid) &&
            rowHasMergeFieldContent(mergeRows[i], mergeFieldsSheet)
          ) {
            previewRowIndex = i;
            break;
          }
        }
        if (previewRowIndex < 0) {
          throw new Error(
            'PDF 미리보기: PDF 추가·만 추출이 켜진 양식이 있고 치환 데이터가 있는 행이 없습니다.'
          );
        }
      }
      const previewRow = mergeRows[previewRowIndex];
      const pdfOpts = resolvePdfExportOptionsForRow(
        previewRow,
        templateProfilesById,
        pdfExportOptions,
        getRowTemplateIds(previewRow, fallbackTid),
        templates
      );
      const built = buildRowJobsForSheetRow({
        row: previewRow,
        rowIndex: previewRowIndex,
        mergeFieldsSheet,
        templates,
        fallbackTid,
        prof,
        templateProfilesById,
        globalPdfOpts: pdfExportOptions,
        ourForcedValues
      });
      if (built.error) throw new Error(built.error);

      if (pdfPreviewUrlRef.current) {
        URL.revokeObjectURL(pdfPreviewUrlRef.current);
        pdfPreviewUrlRef.current = '';
      }
      setPdfPreviewObjectUrl('');
      setPdfPreviewError('');
      setPdfPreviewCaption(`${previewRowIndex + 1}행 기준 · 현재 설정으로 서버 PDF 생성`);
      setPdfPreviewOpen(true);
      setPdfPreviewLoading(true);

      try {
        const blob = await fetchMergePdfPreviewBlob({
          apiBase: API_BASE,
          getAuthHeader,
          rowJobs: built.rowJobs,
          fieldPresetId: fieldPresetIdParam,
          pdfExportOptions: pdfOpts,
          apiPrefix: runtime.apiPrefix
        });
        const url = URL.createObjectURL(blob);
        pdfPreviewUrlRef.current = url;
        setPdfPreviewObjectUrl(url);
      } catch (e) {
        setPdfPreviewError(e?.message || 'PDF 미리보기에 실패했습니다.');
      } finally {
        setPdfPreviewLoading(false);
      }
    },
    [
      mergeRows,
      mergeFieldsSheet,
      templates,
      selectedTemplateId,
      fieldGuide,
      fieldPresets,
      selectedFieldPresetId,
      templateProfilesById,
      pdfExportOptions,
      runtime.apiPrefix,
      getAuthHeader
    ]
  );

  const requestTemplatePreparePdfPreview = useCallback(
    async (pdfOpts) => {
      let previewFile = templateUploadPendingFile;
      let previewLabel = templateUploadPendingFile?.name || '양식';
      if (!previewFile && templatePrepareMode === 'edit' && templatePrepareEditingTemplate?._id) {
        const t = templatePrepareEditingTemplate;
        const blob = await fetchTemplateFileBlob(String(t._id));
        previewLabel = templateListFileName(t);
        previewFile = new File([blob], previewLabel, {
          type: mergeTemplateMimeType(t.fileType)
        });
      }
      if (!previewFile) {
        throw new Error('등록할 양식 파일을 먼저 선택해 주세요.');
      }
      if (pdfPreviewUrlRef.current) {
        URL.revokeObjectURL(pdfPreviewUrlRef.current);
        pdfPreviewUrlRef.current = '';
      }
      setPdfPreviewObjectUrl('');
      setPdfPreviewError('');
      setPdfPreviewCaption(
        `${templatePrepareMode === 'edit' ? '양식 설정' : '양식 등록'} 미리보기 · ${previewLabel} · ${formatMergePdfExportOptionsSummary(pdfOpts)}`
      );
      setTemplateUploadPreparePdfOpen(false);
      setPdfPreviewOpen(true);
      setPdfPreviewLoading(true);
      try {
        const blob = await fetchTemplatePdfPreviewBlob({
          apiBase: API_BASE,
          getAuthHeader,
          file: previewFile,
          pdfExportOptions: pdfOpts,
          apiPrefix: runtime.apiPrefix
        });
        const url = URL.createObjectURL(blob);
        pdfPreviewUrlRef.current = url;
        setPdfPreviewObjectUrl(url);
      } catch (e) {
        setPdfPreviewError(e?.message || 'PDF 미리보기에 실패했습니다.');
      } finally {
        setPdfPreviewLoading(false);
      }
    },
    [templateUploadPendingFile, templatePrepareMode, templatePrepareEditingTemplate, getAuthHeader, runtime.apiPrefix]
  );

  const downloadMergeOutputsAsSeparateFiles = useCallback(
    async (rowJobs, fieldPresetId, globalPdfOpts, ctx = {}) => {
      const { mergeRows: rowsCtx, templateProfilesById: profMap, templates: tplCtx, fallbackTid } = ctx;
      const planBody = { rowJobs };
      if (fieldPresetId && isMergeFieldPresetMongoId(fieldPresetId)) {
        planBody.fieldPresetId = String(fieldPresetId).trim();
      }
      const planRes = await fetch(`${mergeApiBase}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
        body: JSON.stringify(planBody)
      });
      const plan = await planRes.json().catch(() => ({}));
      if (!planRes.ok) {
        throw new Error(getUserVisibleApiError(plan, '파일명 검사에 실패했습니다.'));
      }
      const entries = Array.isArray(plan.entries) ? plan.entries : [];
      if (!entries.length) {
        throw new Error('생성할 파일 정보가 없습니다.');
      }
      const entryJobIndexes = buildMergeOutputEntryJobIndexes(rowJobs);
      for (let i = 0; i < entries.length; i += 1) {
        await pingBackendHealth();
        const jobIndex = entryJobIndexes[i] ?? i;
        const job = rowJobs[jobIndex];
        const srcRow =
          job && typeof job.sourceRowIndex === 'number' ? rowsCtx?.[job.sourceRowIndex] : null;
        const templateIdsForPdf =
          job?.templateId != null
            ? [String(job.templateId)]
            : srcRow
              ? getRowTemplateIds(srcRow, fallbackTid)
              : [];
        const pdfExportOptionsBody = normalizeMergePdfExportOptions(
          resolvePdfExportOptionsForRow(
            srcRow,
            profMap,
            globalPdfOpts,
            templateIdsForPdf,
            tplCtx
          )
        );
        const body = {
          rowJobs,
          zipCollisionPolicy: 'rename',
          asZip: false,
          singleOutputIndex: i,
          pdfExportOptions: pdfExportOptionsBody
        };
        if (planBody.fieldPresetId) body.fieldPresetId = planBody.fieldPresetId;
        const res = await fetch(`${mergeApiBase}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          credentials: 'include',
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(getUserVisibleApiError(data, `${i + 1}번째 파일 생성에 실패했습니다.`));
        }
        const blob = await res.blob();
        const fname = String(entries[i]?.fileName || `quotation_${i + 1}`).replace(/[/\\?%*:|"<>]/g, '_');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fname;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        if (i < entries.length - 1) {
          await new Promise((r) => setTimeout(r, 120));
        }
      }
      return entries.length;
    },
    [getAuthHeader, mergeApiBase]
  );

  const runMerge = async () => {
    if (!templates.length || !mergeFieldsSheet?.length) return;
    const fallbackTid = selectedTemplateId || defaultTemplateIdFromList(templates);
    const fieldPresetIdParam = isMergeFieldPresetMongoId(selectedFieldPresetId)
      ? String(selectedFieldPresetId).trim()
      : undefined;
    const rowsWithFieldData = mergeRows.filter((r) => rowHasMergeFieldContent(r, mergeFieldsSheet));
    if (rowsWithFieldData.length === 0) {
      window.alert('표에 넣을 값이 하나도 없는 행뿐입니다. 최소 한 행에 내용을 입력한 뒤 다시 시도해 주세요.');
      return;
    }
    const rowJobs = [];
    const prof = profileTagForMergeZip(selectedFieldPresetId, fieldGuide, fieldPresets);
    for (let i = 0; i < mergeRows.length; i++) {
      const r = mergeRows[i];
      if (!rowHasMergeFieldContent(r, mergeFieldsSheet)) continue;
      const tids = getRowTemplateIds(r, fallbackTid).filter((id) => templates.some((t) => String(t._id) === id));
      if (!tids.length) {
        window.alert(`${i + 1}행: 사용할 양식을 선택해 주세요.`);
        return;
      }
      const exportAddon = resolveMergeExportAddonForRow(
        r,
        templateProfilesById,
        pdfExportOptions,
        tids
      );
      const baseStem =
        String(r.fileLabel || '').trim() ||
        String(r.companyName || '').trim() ||
        `row_${i + 1}`;
      for (let j = 0; j < tids.length; j += 1) {
        const tid = tids[j];
        const t = templates.find((x) => String(x._id) === tid);
        const tplRaw = stripKnownMergeTemplateExtensions(templateListFileName(t)).trim();
        const tplSlug = sanitizeDownloadFileStem(tplRaw).slice(0, 50) || 'doc';
        let apiRow = applyOurForcedToMergeRow(rowForApi(r), ourForcedValues);
        if (tids.length > 1) {
          const p = prof || '';
          const suffix = p ? `${p}_${tplSlug}` : `_${tplSlug}`;
          const combined = sanitizeDownloadFileStem(`${baseStem}${suffix}`.slice(0, 200));
          if (combined) apiRow = { ...apiRow, fileLabel: combined };
        }
        rowJobs.push({
          templateId: tid,
          row: apiRow,
          exportAddon,
          sourceRowIndex: i
        });
      }
    }
    if (rowJobs.length === 0) {
      window.alert('입력된 치환 데이터로 생성할 파일이 없습니다.');
      return;
    }
    setMergeRunning(true);
    setMergeMessage('');
    try {
      await pingBackendHealth();
      const n = await downloadMergeOutputsAsSeparateFiles(rowJobs, fieldPresetIdParam, pdfExportOptions, {
        mergeRows,
        templateProfilesById,
        templates,
        fallbackTid
      });
      const anyPdf = rowJobs.some((j) => mergeExportAddonWantsPdf(j.exportAddon));
      setMergeMessage(
        n > 0 ? `파일 ${n}개를 받았습니다.${anyPdf ? ' (PDF 포함)' : ''}` : ''
      );
    } catch (e) {
      window.alert(e.message || '파일 생성을 시작하지 못했습니다.');
    } finally {
      setMergeRunning(false);
    }
  };

  const runSheetDownloadForRow = useCallback(
    async (rowIndex) => {
      if (!templates.length || !mergeFieldsSheet?.length) return;
      const ri = Number(rowIndex);
      if (!Number.isFinite(ri) || ri < 0 || ri >= mergeRows.length) return;

      const fieldPresetIdParam = isMergeFieldPresetMongoId(selectedFieldPresetId)
        ? String(selectedFieldPresetId).trim()
        : undefined;
      const fallbackTid = selectedTemplateId || defaultTemplateIdFromList(templates);
      const prof = profileTagForMergeZip(selectedFieldPresetId, fieldGuide, fieldPresets);

      const row = mergeRows[ri];
      if (!row || !rowHasMergeFieldContent(row, mergeFieldsSheet)) {
        window.alert(`${ri + 1}행: 치환할 데이터가 없습니다.`);
        return;
      }

      const built = buildRowJobsForSheetRow({
        row,
        rowIndex: ri,
        mergeFieldsSheet,
        templates,
        fallbackTid,
        prof,
        templateProfilesById,
        globalPdfOpts: pdfExportOptions,
        ourForcedValues
      });
      if (built.error) {
        window.alert(`${ri + 1}행: ${built.error}`);
        return;
      }
      const { rowJobs } = built;

      setMergeRunning(true);
      setMergeMessage('');
      try {
        await pingBackendHealth();
        const n = await downloadMergeOutputsAsSeparateFiles(rowJobs, fieldPresetIdParam, pdfExportOptions, {
          mergeRows,
          templateProfilesById,
          templates,
          fallbackTid
        });
        setMergeMessage(n > 0 ? `${ri + 1}행: 파일 ${n}개를 받았습니다.` : '');
      } catch (e) {
        window.alert(e.message || '파일 받기에 실패했습니다.');
      } finally {
        setMergeRunning(false);
      }
    },
    [
      templates,
      mergeFieldsSheet,
      selectedFieldPresetId,
      selectedTemplateId,
      fieldGuide,
      fieldPresets,
      mergeRows,
      pdfExportOptions,
      downloadMergeOutputsAsSeparateFiles,
      templateProfilesById,
      ourForcedValues
    ]
  );

  const runSheetMailHandoffForRow = useCallback(
    async (rowIndex) => {
      if (!templates.length || !mergeFieldsSheet?.length) return;
      const ri = Number(rowIndex);
      if (!Number.isFinite(ri) || ri < 0 || ri >= mergeRows.length) return;

      const row = mergeRows[ri];
      const mail = resolveMergeRowMailFields(
        row,
        templateProfilesById,
        mergeFieldsSheet,
        mergeMailFallback
      );
      if (!row || !mail.mailTo) {
        window.alert(
          `${ri + 1}행: 받는 사람 이메일이 없습니다. 시트에 입력하거나, 사용 양식에 메일 기본값(받는 사람)을 등록해 주세요.`
        );
        return;
      }

      const ok = window.confirm(
        `${ri + 1}행: PC 메일(Outlook 등) 작성 창을 엽니다.\n\n` +
          '※ 파일은 보내지 않습니다. 왼쪽「받기」로 먼저 받은 뒤 메일에 직접 첨부해 주세요.\n' +
          '※ 작성 창을 초안으로 두면 Outlook 등 메일 앱의 임시보관함에 남을 수 있습니다.\n\n' +
          '계속할까요?'
      );
      if (!ok) return;

      setMergeMessage('');
      try {
        const bodyPlain = mail.mailBody;

        const { href, note, clipboardPlain } = buildMailtoWithFields({
          to: mail.mailTo,
          cc: mail.mailCc,
          subject: mail.mailSubject || '(제목 없음)',
          body: bodyPlain
        });
        if (!href) {
          window.alert(`${ri + 1}행: 메일 주소를 확인해 주세요.`);
          return;
        }
        if (clipboardPlain != null) {
          try {
            await navigator.clipboard.writeText(clipboardPlain);
          } catch {
            window.alert(
              `${ri + 1}행: 본문이 길어 클립보드 복사에 실패했을 수 있습니다. 메일 창에서 본문을 확인해 주세요.`
            );
          }
        }
        if (note) window.alert(note);

        const w = window.open(href, '_blank', 'noopener,noreferrer');
        if (!w) {
          window.location.assign(href);
        }
        setMergeMessage(`${ri + 1}행: 메일 작성 창을 열었습니다.`);
      } catch (e) {
        window.alert(e.message || '메일 준비에 실패했습니다.');
      }
    },
    [templates, mergeFieldsSheet, mergeRows, templateProfilesById, mergeMailFallback]
  );

  const renderMergeCell = (row, rowIndex, f) => {
    /** 시트 셀은 힌트 문구 없음(aria-label만). 과거 placeholder 변수 참조로 런타임 오류 나지 않도록 고정. */
    const cellPlaceholder = '';
    const key = f.key;
    const val = row[key] != null ? String(row[key]) : '';
    const fieldColIndex = (mergeFieldsSheet || []).findIndex((x) => x.key === f.key);
    const ariaLabel = f.label ? `${f.label} (${key})` : key;
    const sheetCol = MERGE_SHEET_FIELD_START + fieldColIndex;

    const tryPasteGrid = (e) => {
      const t = e.clipboardData?.getData('text/plain');
      if (t == null || t === '') return;
      const grid = parseTsvGrid(t);
      if (!grid.length) return;
      if (isSingleColumnMultilinePaste(grid)) {
        e.preventDefault();
        updateRow(rowIndex, key, grid.map((r) => r[0]).join('\n'));
        return;
      }
      const multi = grid.length > 1 || (grid[0] && grid[0].length > 1);
      if (!multi) return;
      e.preventDefault();
      applyMergeGridPatch(rowIndex, sheetCol, grid);
    };

    const handleSheetNavKeyDown = (e) => {
      mergeSheetNavKeyDown(e, {
        rowIndex,
        sheetCol,
        multiline: false,
        value: val,
        commit: (next) => updateRow(rowIndex, key, next)
      });
    };

    const onBlur =
      key === 'businessNumber' || key === 'phone'
        ? () => blurFormatCell(rowIndex, key, row[key] != null ? String(row[key]) : '')
        : undefined;

    return (
      <textarea
        className="qdm-cell qdm-cell--sheet qdm-cell-sheet-single qdm-cell--auto-fit"
        value={val}
        rows={1}
        onChange={(e) => updateRow(rowIndex, key, e.target.value)}
        onPaste={tryPasteGrid}
        onKeyDown={handleSheetNavKeyDown}
        onBlur={onBlur}
        aria-label={ariaLabel}
        placeholder={cellPlaceholder}
      />
    );
  };

  return (
    <div className="page quotation-doc-merge-page">
      <header className="page-header quotation-doc-merge-header">
        <div>
          <h1 className="page-title">{runtime.pageTitle}</h1>
          {runtime.pageSubtitle ? (
            <p className="quotation-doc-merge-lead">{runtime.pageSubtitle}</p>
          ) : null}
        </div>
        <div className="quotation-doc-merge-header-tools">
          <PageHeaderNotifyChat />
        </div>
      </header>

      <div className="page-content quotation-doc-merge-content">
        {mergeRunning ? (
          <div className="qdm-global-spinner" aria-live="polite">
            <span className="qdm-spinner" aria-hidden />
            문서 생성 중…
          </div>
        ) : null}

        <section className="quotation-doc-merge-card">
          <div className="qdm-card-head">
            <div className="qdm-card-head-left">
              <h2 className="quotation-doc-merge-card-title">등록된 양식</h2>
            </div>
            <div className="qdm-card-head-right">
              <input
                ref={uploadInputRef}
                type="file"
                className="qdm-sr-only-input"
                accept={mergeTemplateAcceptAttribute()}
                aria-label={`양식 파일 선택 (${MERGE_TEMPLATE_UPLOAD_HINT})`}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  if (templateUploadPrepareOpen) setTemplateUploadPendingFile(f);
                  else void uploadTemplateFile(f, { afterSuccess: closeTemplateUploadPrepare });
                }}
              />
              <button
                type="button"
                className="qdm-template-add-btn"
                onClick={openTemplateUploadPrepare}
                disabled={templatesLoading || uploading}
                title="양식 등록 전, 어떤 치환 항목 목록을 쓸지 확인한 뒤 파일 선택"
                aria-label="양식 파일 추가"
              >
                <span className="material-symbols-outlined" aria-hidden>
                  add
                </span>
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => void loadTemplates()}
                disabled={templatesLoading}
                title="목록 새로고침"
                aria-label="목록 새로고침"
              >
                <span className="material-symbols-outlined" aria-hidden>
                  refresh
                </span>
              </button>
            </div>
          </div>
        
          {templatesError ? <p className="qdm-banner qdm-banner-error">{templatesError}</p> : null}
          {uploading ? <p className="quotation-doc-merge-desc qdm-template-uploading-note">양식 업로드 중…</p> : null}
          <div
            className={`qdm-template-drop-zone${templateDropActive ? ' qdm-template-drop-zone--active' : ''}`}
            onDragEnter={onTemplateDragEnter}
            onDragLeave={onTemplateDragLeave}
            onDragOver={onTemplateDragOver}
            onDrop={onTemplateDrop}
          >
            {templatesLoading ? (
              <p className="quotation-doc-merge-desc">불러오는 중…</p>
            ) : templates.length === 0 ? (
              <p className="quotation-doc-merge-desc qdm-template-drop-empty">
                등록된 양식이 없습니다. + 버튼으로 어떤 {'{{항목}}'}이 들어가는지 확인한 뒤 파일을 고르거나, 이 영역에 {MERGE_TEMPLATE_UPLOAD_HINT} 파일을 놓아 주세요.
              </p>
            ) : (
              <div
                ref={templateTableScopeRef}
                className="qdm-excel-template-scope"
                tabIndex={0}
                role="application"
                aria-label="등록된 양식 표. Ctrl+A 전체 선택, Ctrl+C 탭 구분 복사"
              >
                {templateRowSelectedIds.size > 0 ? (
                  <div className="qdm-excel-selection-bar" role="status" aria-live="polite">
                    <span className="qdm-excel-selection-count">
                      <strong>{templateRowSelectedIds.size}</strong>행 선택
                    </span>
                    <div className="qdm-excel-selection-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setTemplateRowSelectedIds(new Set())}
                        title="선택 해제"
                        aria-label="선택 해제"
                      >
                        <span className="material-symbols-outlined" aria-hidden>
                          close
                        </span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn qdm-excel-selection-icon--primary"
                        onClick={() => void downloadSelectedTemplates()}
                        title="선택한 양식 파일 받기"
                        aria-label="선택한 양식 파일 받기"
                      >
                        <span className="material-symbols-outlined" aria-hidden>
                          file_download
                        </span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => void copySelectedTemplatesTsv()}
                        title="표 복사 (탭 구분, 엑셀 붙여넣기)"
                        aria-label="표 복사 탭 구분"
                      >
                        <span className="material-symbols-outlined" aria-hidden>
                          content_copy
                        </span>
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="qdm-table-wrap qdm-table-wrap--excel-template">
                  <table className="qdm-table qdm-table--excel">
                    <thead>
                      <tr>
                        <th className="qdm-excel-th qdm-excel-th--gutter" scope="col" title="행 번호 · 여기서 드래그하면 범위 선택">
                          #
                        </th>
                        <th scope="col">파일 이름</th>
                        <th scope="col">종류</th>
                        <th scope="col">크기</th>
                        <th scope="col">등록일</th>
                        <th scope="col" className="qdm-excel-th--actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {templates.map((t, idx) => {
                        const isDefault = String(t._id) === String(selectedTemplateId);
                        const isRangeSelected = templateRowSelectedIds.has(String(t._id));
                        const templateProfileEditable = canEditTemplateProfile(t);
                        return (
                          <tr
                            key={t._id}
                            data-template-row-index={idx}
                            className={[
                              'qdm-template-row',
                              'qdm-template-row--excel',
                              isDefault ? 'qdm-template-row--default' : '',
                              isRangeSelected ? 'qdm-template-row--range-selected' : '',
                              !templateProfileEditable ? 'qdm-template-row--profile-readonly' : ''
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            onClick={(e) => {
                              if (e.target.closest('button')) return;
                              if (e.target.closest('.qdm-excel-td--gutter')) return;
                              if (!templateProfileEditable) return;
                              void openTemplateEditPrepare(t);
                            }}
                            title={
                              templateProfileEditable
                                ? '행 클릭: PDF·메일 설정 편집. # 열: 선택·드래그.'
                                : '공통 양식 — PDF·메일 설정은 Admin에서만 변경. 파일 받기는 사용 가능.'
                            }
                          >
                            <td
                              className="qdm-excel-td qdm-excel-td--gutter"
                              onMouseDown={(e) => handleTemplateGutterMouseDown(e, idx)}
                            >
                              {idx + 1}
                            </td>
                            <td className="qdm-excel-td">
                              {templateListFileName(t)}
                              {runtime.showCommonTemplateBadge && t.isCommon ? (
                                <span className="qdm-badge qdm-badge-common" title="모든 회사에서 사용 가능한 공통 양식">
                                  공통
                                </span>
                              ) : null}
                            </td>
                            <td className="qdm-excel-td">{mergeTemplateKindLabel(t.fileType)}</td>
                            <td className="qdm-excel-td">{formatBytes(t.sizeBytes)}</td>
                            <td className="qdm-excel-td">{t.createdAt ? new Date(t.createdAt).toLocaleString('ko-KR') : '—'}</td>
                            <td className="qdm-excel-td qdm-excel-td--actions" onClick={(e) => e.stopPropagation()}>
                              <div className="qdm-table-row-actions" role="group" aria-label="양식 파일 작업">
                                <button
                                  type="button"
                                  className="icon-btn qdm-excel-row-icon-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    downloadTemplateFile(t._id, t.originalFilename || `${t.name}.${t.fileType}`);
                                  }}
                                  title="파일 받기"
                                  aria-label="파일 받기"
                                >
                                  <span className="material-symbols-outlined" aria-hidden>
                                    file_download
                                  </span>
                                </button>
                                {runtime.allowDeleteTemplate(t, canDeleteTemplateByRole) ? (
                                  <button
                                    type="button"
                                    className="icon-btn qdm-excel-row-icon-btn qdm-excel-row-icon-btn--danger"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteTemplate(t._id);
                                    }}
                                    title="양식 삭제"
                                    aria-label="양식 삭제"
                                  >
                                    <span className="material-symbols-outlined" aria-hidden>
                                      delete
                                    </span>
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="quotation-doc-merge-card">
          <div className="qdm-card-head">
            <div className="qdm-card-head-left">
              <h2 className="quotation-doc-merge-card-title">데이터 입력 후 파일 받기</h2>
            </div>
            <div className="qdm-card-head-right">
              <button
                type="button"
                className="btn-primary"
                onClick={() => openMergeDataSheet()}
                disabled={!mergeFieldsSheet?.length}
                title={!mergeFieldsSheet?.length ? '문서 치환 항목을 불러온 뒤 사용할 수 있습니다.' : '전체 화면에서 시트 입력'}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  table_chart
                </span>
                시트 열기
              </button>
            </div>
          </div>
          <p className="quotation-doc-merge-desc">
            고객사 불러오기, 행 추가·입력, 파일 받기·행별 메일 보내기는 <strong>시트 열기</strong> 후 전체 화면에서 진행합니다. (ZIP 없이 파일마다
            순서대로 받습니다.)
          </p>
          {mergeMessage && !mergeDataSheetOpen ? (
            <p className="qdm-banner qdm-banner-ok" role="status">
              {mergeMessage}
            </p>
          ) : null}
        </section>
      </div>

      {mergeDataSheetOpen ? (
        <MergeDataSheetModal
          open={mergeDataSheetOpen}
          onClose={() => {
            closeMergeDataSheet();
            closeFieldEditor();
          }}
          mergeRows={mergeRows}
          mergeFields={mergeFieldsSheet}
          templates={templates}
          selectedTemplateId={selectedTemplateId}
          templateListFileName={templateListFileName}
          mergeRunning={mergeRunning}
          mergeMessage={mergeMessage}
          fieldEditorOpen={mergeFieldEditorOpen}
          canManageMergeFields={canManageMergeFields}
          fieldPresets={fieldPresets}
          fieldPresetsLoading={fieldPresetsLoading}
          selectedFieldPresetId={selectedFieldPresetId}
          fieldGuide={fieldGuide}
          onSelectFieldPresetId={handleSelectFieldPresetId}
          onCreateFieldPreset={canManageMergeFields ? createFieldPresetFromSheet : undefined}
          onOpenFieldEditor={openFieldEditorFromSheet}
          onOpenCompanyPick={() => setCompanyPickOpen(true)}
          onUpdateRow={updateRow}
          onUpdateRowTemplates={updateRowTemplates}
          onRunMerge={runMerge}
          templateProfilesById={templateProfilesById}
          mergeMailFallback={mergeMailFallback}
          pdfExportOptions={pdfExportOptions}
          onRequestPdfPreview={requestPdfPreview}
          pdfPreviewOpen={pdfPreviewOpen}
          pdfPreviewObjectUrl={pdfPreviewObjectUrl}
          pdfPreviewLoading={pdfPreviewLoading}
          pdfPreviewError={pdfPreviewError}
          pdfPreviewCaption={pdfPreviewCaption}
          onClosePdfPreview={closePdfPreview}
          apiBase={API_BASE}
          mergeApiPrefix={runtime.apiPrefix}
          getAuthHeader={getAuthHeader}
          apiFetchInit={apiFetchInit}
          onDownloadRow={runSheetDownloadForRow}
          onMailtoHandoffRow={runSheetMailHandoffForRow}
          onMailCellPaste={handleMergeSheetCellPaste}
          onMailCellKeyDown={handleMergeSheetCellKeyDown}
          onMergeSheetGridPaste={handleMergeSheetGridPaste}
          renderMergeCell={renderMergeCell}
          ourForcedValues={ourForcedValues}
        />
      ) : null}

      {(mergeDataSheetOpen || templateUploadPrepareOpen) && mergeFieldEditorOpen && fieldDraft ? (
        <MergeFieldEditorModal
          open
          onClose={closeFieldEditor}
          fieldDraft={fieldDraft}
          setFieldDraft={setFieldDraft}
          fieldSaving={fieldSaving}
          onSave={saveFieldDraft}
          onResetDefault={resetFieldGuideToDefault}
          resetButtonLabel={isMergeFieldPresetMongoId(selectedFieldPresetId) ? '이 구성 삭제' : '기본값 복원'}
          fieldGuideUsingCustom={!!fieldGuide?.usingCustom}
          fieldProfileName={fieldPresetNameDraft}
          setFieldProfileName={setFieldPresetNameDraft}
          hasActiveProfile={isMergeFieldPresetMongoId(selectedFieldPresetId)}
          canManageProfiles={canManageMergeFields}
          onCreateProfile={canManageMergeFields ? createFieldPresetFromEditor : undefined}
          onDeleteProfile={canManageMergeFields ? resetFieldGuideToDefault : undefined}
          fieldProfileNameMaxLength={MERGE_FIELD_PRESET_NAME_MAX}
          ourForcedValues={ourForcedValues}
        />
      ) : null}

      {companyPickOpen ? (
        <CustomerCompanySearchModal
          multiSelect
          onClose={() => setCompanyPickOpen(false)}
          onSelectBatch={(companies) => {
            const rows = (Array.isArray(companies) ? companies : []).map(companyToMergeRow).filter(Boolean);
            if (rows.length) appendRowsFromCompanies(rows);
          }}
        />
      ) : null}

      {templateUploadPrepareOpen ? (
        <div
          className="qdm-template-prepare-modal-root"
          role="dialog"
          aria-modal="true"
          aria-labelledby="qdm-template-prepare-title"
        >
          <button
            type="button"
            className="qdm-template-prepare-modal-backdrop"
            aria-label="닫기"
            onClick={closeTemplateUploadPrepare}
          />
          <div className="qdm-template-prepare-modal-panel">
            <header className="qdm-template-prepare-modal-head">
              <div>
                <h2 id="qdm-template-prepare-title" className="qdm-template-prepare-modal-title">
                  {templatePrepareMode === 'edit' ? '양식 설정 편집' : '양식 등록 전 확인'}
                </h2>
                <p className="qdm-template-prepare-modal-sub">
                  {templatePrepareMode === 'edit' ? (
                    <>
                      <strong>{templateListFileName(templatePrepareEditingTemplate)}</strong> 양식의 PDF·메일
                      기본값을 수정합니다. 치환 항목은 이 페이지의 <strong>문서 치환 항목 편집</strong>·데이터 시트와{' '}
                      <strong>같은 필드 구성</strong>입니다.
                    </>
                  ) : (
                    <>
                      아래 치환 항목은 이 페이지의 <strong>문서 치환 항목 편집</strong>·데이터 시트와{' '}
                      <strong>같은 필드 구성</strong>입니다. 편집·저장하면 표·메일 토큰이 바로 반영됩니다.
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                className="qdm-template-prepare-modal-close icon-btn"
                onClick={closeTemplateUploadPrepare}
                aria-label="닫기"
              >
                <span className="material-symbols-outlined" aria-hidden>
                  close
                </span>
              </button>
            </header>

            <div className="qdm-template-prepare-modal-body">
              <label className="qdm-template-prepare-label" htmlFor="qdm-template-prepare-preset">
                문서 치환 필드 구성
              </label>
              <select
                id="qdm-template-prepare-preset"
                className="qdm-template-prepare-select qdm-select"
                value={String(selectedFieldPresetId || '')}
                onChange={(e) => handleSelectFieldPresetId(e.target.value)}
                disabled={fieldPresetsLoading || fieldGuideLoading || uploading}
                aria-busy={fieldPresetsLoading || fieldGuideLoading}
              >
                <option value="">회사 기본 (한 벌)</option>
                {fieldPresets.map((p) => (
                  <option key={p._id} value={String(p._id)}>
                    {String(p.name || '').trim() || '이름 없음'}
                  </option>
                ))}
              </select>
              {fieldPresetsLoading ? (
                <p className="qdm-template-prepare-note">저장된 구성 목록 불러오는 중…</p>
              ) : null}

              <div className="qdm-template-prepare-field-config-row">
                <p className="qdm-template-prepare-field-config-summary">{activeFieldConfigSummary}</p>
                {canManageMergeFields ? (
                  <button
                    type="button"
                    className="qdm-btn qdm-btn-ghost qdm-btn-small"
                    onClick={openFieldEditorFromTemplatePrepare}
                    disabled={fieldGuideLoading || !mergeFieldsSheet.length}
                    title={
                      !mergeFieldsSheet.length
                        ? '문서 치환 항목을 불러온 뒤 사용할 수 있습니다.'
                        : '문서에 넣을 {{항목}} 이름·표시 이름 등을 바꿉니다. 저장하면 아래 표·메일 토큰이 바로 반영됩니다.'
                    }
                  >
                    <span className="material-symbols-outlined" aria-hidden>
                      tune
                    </span>
                    문서 치환 항목 편집
                  </button>
                ) : null}
              </div>

              {fieldGuideLoading ? (
                <p className="qdm-template-prepare-note">선택한 구성의 치환 항목을 불러오는 중…</p>
              ) : null}

              {!fieldGuideLoading && mergeFieldsSheet.length === 0 ? (
                <p className="qdm-banner qdm-banner-error">
                  문서 치환 항목을 불러오지 못했습니다. 동의·권한을 확인하거나 잠시 후 다시 시도해 주세요.
                </p>
              ) : null}

              {mergeFieldsSheet.length > 0 ? (
                <>
                  <p className="qdm-template-prepare-hint">
                    Word·PowerPoint·HWP 본문/슬라이드·Excel 셀에 아래 <strong>치환자</strong> 열 값을 그대로 넣으면 됩니다. 예시 열은 문서 편집 시 참고용입니다.
                  </p>
                  <div className="qdm-template-prepare-table-wrap">
                    <table className="qdm-template-prepare-table">
                      <thead>
                        <tr>
                          <th>치환자</th>
                          <th>키</th>
                          <th>표시 이름</th>
                          <th>예시(참고)</th>
                          <th>값 종류</th>
                          <th>Excel 표시</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mergeFieldsSheet.map((f, i) => {
                          const key = String(f.key || '').trim();
                          const token = key ? `{{${key}}}` : '';
                          return (
                            <tr key={key || `row-${i}`}>
                              <td>
                                <code className="qdm-template-prepare-code">{token}</code>
                              </td>
                              <td>{key}</td>
                              <td>{String(f.label || '').trim()}</td>
                              <td className="qdm-template-prepare-td-example">{String(f.example || '').trim()}</td>
                              <td>{mergeValueKindLabel(f.valueKind)}</td>
                              <td>{f.valueKind === 'number' ? mergeExcelFormatLabel(f.excelFormat) : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="qdm-template-prepare-copy-block">
                    <div className="qdm-template-prepare-copy-head">
                      <span className="qdm-template-prepare-copy-label">복사용 (탭 구분: 치환자 → 예시)</span>
                      <button
                        type="button"
                        className="qdm-btn qdm-btn-ghost qdm-btn-small"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(templateUploadPrepareCopyText);
                            window.alert('클립보드에 복사했습니다.');
                          } catch {
                            window.alert('복사에 실패했습니다. 아래 칸에서 직접 선택(Ctrl+A) 후 복사해 주세요.');
                          }
                        }}
                        disabled={!templateUploadPrepareCopyText}
                      >
                        전체 복사
                      </button>
                    </div>
                    <textarea
                      className="qdm-template-prepare-copy-textarea"
                      readOnly
                      rows={Math.min(14, Math.max(4, mergeFieldsSheet.length + 1))}
                      value={templateUploadPrepareCopyText}
                      spellCheck={false}
                      aria-label="치환자와 예시 탭 구분 복사용"
                    />
                  </div>
                </>
              ) : null}

              {mergeFieldsSheet.length > 0 ? (
                <>
                {templatePrepareMode === 'edit' && templatePrepareEditingTemplate ? (
                  <div className="qdm-template-prepare-edit-info" role="status">
                    <p className="qdm-template-prepare-edit-info-name">
                      <strong>{templateListFileName(templatePrepareEditingTemplate)}</strong>
                    </p>
                    <p className="qdm-template-prepare-note">
                      {mergeTemplateKindLabel(templatePrepareEditingTemplate.fileType)} ·{' '}
                      {formatBytes(templatePrepareEditingTemplate.sizeBytes)} · 등록{' '}
                      {templatePrepareEditingTemplate.createdAt
                        ? new Date(templatePrepareEditingTemplate.createdAt).toLocaleString('ko-KR')
                        : '—'}
                    </p>
                    <p className="qdm-template-prepare-note">
                      양식 파일은 바꾸지 않습니다. PDF·메일 기본값
                      {runtime.showRegistrationScopePicker ? '과 저장 위치' : ''}만 수정합니다.
                    </p>
                  </div>
                ) : (
                <div
                  className={`qdm-template-prepare-drop${templateUploadPrepareDropActive ? ' qdm-template-prepare-drop--active' : ''}`}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!uploading) setTemplateUploadPrepareDropActive(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const next = e.relatedTarget;
                    if (next && e.currentTarget.contains(next)) return;
                    setTemplateUploadPrepareDropActive(false);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setTemplateUploadPrepareDropActive(false);
                    const f = e.dataTransfer?.files?.[0];
                    if (f) setTemplateUploadPendingFile(f);
                  }}
                >
                  {templateUploadPendingFile ? (
                    <p className="qdm-template-prepare-drop-file" role="status">
                      선택된 파일: <strong>{templateUploadPendingFile.name}</strong>
                    </p>
                  ) : (
                    <p className="qdm-template-prepare-drop-hint">
                      {MERGE_TEMPLATE_UPLOAD_HINT} 파일을 <strong>여기에 끌어다 놓으세요</strong>
                    </p>
                  )}
                  <button
                    type="button"
                    className="qdm-btn qdm-btn-ghost qdm-btn-small"
                    disabled={uploading}
                    onClick={() => uploadInputRef.current?.click()}
                  >
                    파일 찾기
                  </button>
                </div>
                )}

                {runtime.showRegistrationScopePicker ? (
                  <fieldset className="qdm-template-prepare-fieldset">
                    <legend className="qdm-template-prepare-label">저장 위치</legend>
                    <label className="qdm-template-prepare-radio">
                      <input type="radio" name="template-upload-scope" checked={templateUploadPrepareScope !== 'personal'} onChange={() => setTemplateUploadPrepareScope('company')} />
                      <span>회사 (Company.listTemplates)</span>
                    </label>
                    <label className="qdm-template-prepare-radio">
                      <input type="radio" name="template-upload-scope" checked={templateUploadPrepareScope === 'personal'} onChange={() => setTemplateUploadPrepareScope('personal')} />
                      <span>개인 (User.listTemplates)</span>
                    </label>
                  </fieldset>
                ) : null}

                <div className="qdm-template-prepare-pdf-block">
                  <div className="qdm-template-prepare-pdf-head">
                    <span className="qdm-template-prepare-label">PDF 인쇄 설정</span>
                    <button type="button" className="qdm-btn qdm-btn-ghost qdm-btn-small" onClick={() => setTemplateUploadPreparePdfOpen(true)} disabled={uploading}>PDF 설정 편집</button>
                  </div>
                  <p className="qdm-template-prepare-note" role="status">{formatMergePdfExportOptionsSummary(templateUploadPreparePdfOpts)}</p>
                </div>

                <fieldset className="qdm-template-prepare-fieldset">
                  <legend className="qdm-template-prepare-label">메일 기본값</legend>
                  <p className="qdm-template-prepare-mail-token-hint" role="note">
                    {templatePrepareMailTokenHint}
                  </p>
                  {templatePrepareMailTokens.length || MERGE_MAIL_FIXED_TOKENS.length ? (
                    <div className="qdm-template-prepare-mail-tokens" role="region" aria-label="메일에 넣을 치환자">
                      <p className="qdm-template-prepare-mail-tokens-label">
                        치환자 삽입 (위 표·복사용과 동일 · 클릭 시{' '}
                        {templateUploadPrepareMailInsertTarget === 'mailBody'
                          ? '본문'
                          : templateUploadPrepareMailInsertTarget === 'mailSubject'
                            ? '제목'
                            : templateUploadPrepareMailInsertTarget === 'mailCc'
                              ? '참조'
                              : '받는 사람'}
                        에 추가)
                      </p>
                      <ul className="qdm-template-prepare-mail-token-list">
                        {MERGE_MAIL_FIXED_TOKENS.map((t) => (
                          <li key={t.key}>
                            <button
                              type="button"
                              className="qdm-template-prepare-mail-token-chip qdm-template-prepare-mail-token-chip--mail-fixed"
                              onClick={() => appendTemplatePrepareMailText(`{{${t.key}}}`)}
                              data-mail-token-label={t.label}
                              title={`고정 치환자: ${t.label} (키: ${t.key}) — 데이터 시트 해당 행의 ${t.rowKey === '_mailTo' ? '받는 사람' : '참조(CC)'} 값`}
                              aria-label={`{{${t.key}}} — ${t.label}`}
                            >
                              {`{{${t.key}}}`}
                            </button>
                          </li>
                        ))}
                        <li>
                          <button
                            type="button"
                            className="qdm-template-prepare-mail-token-chip qdm-template-prepare-mail-token-chip--extra"
                            onClick={() => appendTemplatePrepareMailText('{{customerDisplayName}}')}
                            data-mail-token-label="고객 표시명 (고객사 없으면 연락처·대표자)"
                            title="표시 이름: 고객 표시명 — 고객사명 없으면 연락처·대표자명 (키: customerDisplayName)"
                            aria-label="{{customerDisplayName}} — 표시 이름: 고객 표시명"
                          >
                            {'{{customerDisplayName}}'}
                          </button>
                        </li>
                        {templatePrepareMailTokens.map((t) => (
                          <li key={t.key}>
                            <button
                              type="button"
                              className="qdm-template-prepare-mail-token-chip"
                              onClick={() => insertTemplatePrepareMailToken(t.key)}
                              data-mail-token-label={t.label}
                              title={`표시 이름: ${t.label} · 키: ${t.key}`}
                              aria-label={`${t.token} — 표시 이름: ${t.label}`}
                            >
                              {t.token}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <label className="qdm-template-prepare-mail-field">
                    <span>받는 사람</span>
                    <input
                      type="text"
                      className="qdm-cell"
                      value={templateUploadPrepareMail.mailTo}
                      onFocus={() => setTemplateUploadPrepareMailInsertTarget('mailTo')}
                      onChange={(e) => setTemplateUploadPrepareMail((m) => ({ ...m, mailTo: e.target.value }))}
                    />
                  </label>
                  <label className="qdm-template-prepare-mail-field">
                    <span>참조(CC)</span>
                    <input
                      type="text"
                      className="qdm-cell"
                      value={templateUploadPrepareMail.mailCc}
                      onFocus={() => setTemplateUploadPrepareMailInsertTarget('mailCc')}
                      onChange={(e) => setTemplateUploadPrepareMail((m) => ({ ...m, mailCc: e.target.value }))}
                    />
                  </label>
                  <label className="qdm-template-prepare-mail-field">
                    <span>메일 제목</span>
                    <input
                      type="text"
                      className="qdm-cell"
                      value={templateUploadPrepareMail.mailSubject}
                      onFocus={() => setTemplateUploadPrepareMailInsertTarget('mailSubject')}
                      onChange={(e) => setTemplateUploadPrepareMail((m) => ({ ...m, mailSubject: e.target.value }))}
                    />
                  </label>
                  <label className="qdm-template-prepare-mail-field">
                    <span>메일 본문</span>
                    <textarea
                      className="qdm-cell qdm-template-prepare-mail-body"
                      rows={4}
                      value={templateUploadPrepareMail.mailBody}
                      onFocus={() => setTemplateUploadPrepareMailInsertTarget('mailBody')}
                      onChange={(e) => setTemplateUploadPrepareMail((m) => ({ ...m, mailBody: e.target.value }))}
                    />
                  </label>
                </fieldset>
                </>
              ) : null}
            </div>

            <footer className="qdm-template-prepare-modal-foot">
              <button type="button" className="qdm-btn qdm-btn-ghost" onClick={closeTemplateUploadPrepare} disabled={uploading}>
                취소
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={
                  uploading ||
                  fieldGuideLoading ||
                  !mergeFieldsSheet.length ||
                  (templatePrepareMode !== 'edit' && !templateUploadPendingFile)
                }
                title={
                  templatePrepareMode === 'edit'
                    ? 'PDF·메일 기본값을 저장합니다.'
                    : !templateUploadPendingFile
                      ? '파일을 끌어다 놓은 뒤 저장할 수 있습니다.'
                      : '양식 파일과 PDF·메일 설정을 함께 등록합니다.'
                }
                onClick={() => void saveTemplateUploadPrepare()}
              >
                {uploading
                  ? templatePrepareMode === 'edit'
                    ? '저장 중…'
                    : '등록 중…'
                  : templatePrepareMode === 'edit'
                    ? '설정 저장 (PDF·메일)'
                    : '저장 (양식·PDF·메일 설정)'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {templateUploadPrepareOpen && templateUploadPreparePdfOpen ? (
        <MergePdfSettingsModal
          open
          onClose={() => setTemplateUploadPreparePdfOpen(false)}
          options={templateUploadPreparePdfOpts}
          onSave={(opts) => {
            setTemplateUploadPreparePdfOpts(opts);
            setTemplateUploadPreparePdfOpen(false);
          }}
          onRequestPreview={requestTemplatePreparePdfPreview}
          apiBase={API_BASE}
          mergeApiPrefix={runtime.apiPrefix}
          getAuthHeader={getAuthHeader}
          apiFetchInit={apiFetchInit}
          printAreaTemplateId={
            templatePrepareMode === 'edit' && templatePrepareEditingTemplate?._id
              ? String(templatePrepareEditingTemplate._id)
              : null
          }
          printAreaTemplateName={
            templatePrepareMode === 'edit' && templatePrepareEditingTemplate
              ? templateListFileName(templatePrepareEditingTemplate)
              : templateUploadPendingFile?.name || ''
          }
          localXlsxFile={
            templatePrepareMode !== 'edit' &&
            templateUploadPendingFile &&
            /\.xlsx$/i.test(templateUploadPendingFile.name || '')
              ? templateUploadPendingFile
              : null
          }
          requirePrintAreaForPreview={
            templatePrepareMode === 'edit'
              ? templatePrepareEditingTemplate?.fileType === 'xlsx'
              : !!(
                  templateUploadPendingFile &&
                  /\.xlsx$/i.test(templateUploadPendingFile.name || '')
                )
          }
        />
      ) : null}

      <MergePdfPreviewModal
        open={pdfPreviewOpen}
        onClose={closePdfPreview}
        pdfObjectUrl={pdfPreviewObjectUrl}
        loading={pdfPreviewLoading}
        error={pdfPreviewError}
        caption={pdfPreviewCaption}
      />
    </div>
  );
}
