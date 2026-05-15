import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { API_BASE } from '@/config';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import { pingBackendHealth } from '@/lib/backend-wake';
import { getUserVisibleApiError } from '@/lib/api-error';
import { buildMailtoWithFields } from '@/lib/email-client-links';
import { getStoredCrmUser, isAdminOrAboveRole, isManagerOrAboveRole } from '@/lib/crm-role-utils';
import CustomerCompanySearchModal from '@/customer-companies/customer-company-search-modal/customer-company-search-modal';
import MergeDataSheetModal, {
  MERGE_SHEET_FIELD_START,
  MERGE_SHEET_MAIL_INPUT_COL_COUNT,
  MERGE_SHEET_PREFIX_COL_COUNT
} from '@/shared/merge-data-sheet-modal/merge-data-sheet-modal';
import MergeFieldEditorModal from '@/shared/merge-field-editor-modal/merge-field-editor-modal';
import { MERGE_EXCEL_FORMATS, MERGE_FIELD_VALUE_KINDS } from '@/lib/merge-field-editor-constants';
import {
  mergeFieldsWithoutRowIndex,
  buildMergeFieldsPayload,
  mapApiFieldsToEditorDraft,
  MERGE_FIELD_PRESET_NAME_MAX
} from '@/lib/merge-field-guide-payload';
import { parseTsvGrid } from '@/lib/tsv-grid';
import {
  MERGE_DATA_SHEET_URL_PARAM,
  MERGE_DATA_SHEET_URL_VALUE,
  isMergeDataSheetUrlOpen
} from '@/lib/merge-data-sheet-url';
import './quotation-doc-merge.css';

/** 데이터 시트를 처음 열 때 만들 빈 행 수 */
const MERGE_SHEET_INITIAL_ROWS = 200;
/** 붙여넣기·고객사 불러오기 등으로 늘릴 수 있는 행 상한 */
const MERGE_SHEET_MAX_ROWS = 1000;

/** 행별「추가 추출」— `same`: 양식 확장자만 / `pdfAddon`: 양식+PDF / `pdfOnly`: PDF만 (서버는 LibreOffice로 PDF 생성). 예전 `preferPdf` → pdfAddon */
function normalizeMergeRowExportAddon(v) {
  const s = String(v || '').trim();
  if (s === 'pdfOnly') return 'pdfOnly';
  if (s === 'pdfAddon' || s === 'preferPdf') return 'pdfAddon';
  return 'same';
}

function rowWantsPdfExportIntent(row) {
  const m = normalizeMergeRowExportAddon(row?._exportAddon);
  return m === 'pdfAddon' || m === 'pdfOnly';
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

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
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

function parseExportAddonFromPaste(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'same';
  if (s === 'pdfonly' || s === 'pdf_only') return 'pdfOnly';
  if (s === 'pdfaddon' || s === 'pdf_addon' || s === 'preferpdf') return 'pdfAddon';
  if (s === 'same') return 'same';
  if (s.includes('만') && s.includes('pdf')) return 'pdfOnly';
  if (s.includes('추가') && s.includes('pdf')) return 'pdfAddon';
  return 'same';
}

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
        .replace(/\.(docx|xlsx)$/i, '')
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
    _mailBody: ''
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

function firstEmployeePhone(c) {
  const list = Array.isArray(c.employeeList) ? c.employeeList : [];
  for (const e of list) {
    const p = String(e?.phone || '').trim();
    if (p) return p;
  }
  return '';
}

/** 고객사 목록/검색 모달에서 받은 업체 → 메일머지 행 */
function companyToMergeRow(c) {
  if (!c) return null;
  const companyPhone = String(c.phone || '').trim();
  return {
    companyName: c.name || '',
    representativeName: c.representativeName || '',
    businessNumber: c.businessNumber || '',
    phone: companyPhone || firstEmployeePhone(c),
    address: c.address || '',
    memo: c.memo || '',
    productLines: '',
    fileLabel: '',
    issueDate: '',
    _sourceCompanyId: c._id
  };
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

/** 다운로드 대상: 현재 치환 필드 목록 기준으로, 양식(_*) 제외 실제 입력이 하나라도 있는지 */
function rowHasMergeFieldContent(row, mergeFields) {
  if (!row || !Array.isArray(mergeFields)) return false;
  return mergeFields.some(
    (f) => f?.key && String(f.key) !== 'rowIndex' && String(row[f.key] ?? '').trim() !== ''
  );
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
  prof
}) {
  if (!row || !Array.isArray(mergeFieldsSheet)) return { rowJobs: [], anyPreferPdf: false, error: '데이터를 확인해 주세요.' };
  if (!rowHasMergeFieldContent(row, mergeFieldsSheet)) {
    return { rowJobs: [], anyPreferPdf: false, error: '치환할 값이 있는지 확인해 주세요.' };
  }
  const anyPreferPdf = rowWantsPdfExportIntent(row);
  const tids = getRowTemplateIds(row, fallbackTid).filter((id) => templates.some((t) => String(t._id) === id));
  if (!tids.length) return { rowJobs: [], anyPreferPdf: false, error: '사용할 양식을 선택해 주세요.' };
  const rowJobs = [];
  const baseStem =
    String(row.fileLabel || '').trim() ||
    String(row.companyName || '').trim() ||
    `row_${rowIndex + 1}`;
  for (let j = 0; j < tids.length; j += 1) {
    const tid = tids[j];
    const t = templates.find((x) => String(x._id) === tid);
    const tplRaw = templateListFileName(t).replace(/\.(docx|xlsx)$/i, '').trim();
    const tplSlug = sanitizeDownloadFileStem(tplRaw).slice(0, 50) || 'doc';
    const apiRow = { ...rowForApi(row) };
    if (tids.length > 1) {
      const p = prof || '';
      const suffix = p ? `${p}_${tplSlug}` : `_${tplSlug}`;
      const combined = sanitizeDownloadFileStem(`${baseStem}${suffix}`.slice(0, 200));
      if (combined) apiRow.fileLabel = combined;
    }
    rowJobs.push({
      templateId: tid,
      row: apiRow,
      exportAddon: normalizeMergeRowExportAddon(row._exportAddon)
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
  if (/\.(docx|xlsx)$/i.test(n)) return n;
  const ext = t.fileType === 'xlsx' ? 'xlsx' : 'docx';
  return `${n}.${ext}`;
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
    const noExt = label.replace(/\.(docx|xlsx|zip)$/i, '').trim();
    const stem = sanitizeDownloadFileStem(noExt);
    if (stem) return stem;
  }
  const listName = template ? templateListFileName(template) : '';
  const rawStem = String(listName || '')
    .replace(/\.(docx|xlsx)$/i, '')
    .trim();
  const stem = sanitizeDownloadFileStem(rawStem) || '견적';
  return stem;
}

function fieldSignature(fields) {
  if (!Array.isArray(fields)) return '';
  return fields
    .map(
      (f) =>
        `${f.key}:${f.label}:${f.multiline ? 1 : 0}:${f.excelSpreadLines ? 1 : 0}:${f.valueKind || 'text'}:${f.excelFormat || 'general'}`
    )
    .join('|');
}

export default function QuotationDocMerge() {
  const [searchParams, setSearchParams] = useSearchParams();
  const me = useMemo(() => getStoredCrmUser(), []);
  const canDeleteTemplate = isAdminOrAboveRole(me?.role);
  const canManageMergeFields = isManagerOrAboveRole(me?.role);

  const mergeDataSheetOpen = isMergeDataSheetUrlOpen(searchParams, MERGE_DATA_SHEET_URL_PARAM);
  const openMergeDataSheet = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    p.set(MERGE_DATA_SHEET_URL_PARAM, MERGE_DATA_SHEET_URL_VALUE);
    setSearchParams(p, { replace: false });
  }, [searchParams, setSearchParams]);
  const closeMergeDataSheet = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    p.delete(MERGE_DATA_SHEET_URL_PARAM);
    setSearchParams(p, { replace: true });
  }, [searchParams, setSearchParams]);

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

  /** 양식 + 업로드 전: 필드 구성 선택·치환 항목 미리보기(메인 fieldGuide 와 분리) */
  const [templateUploadPrepareOpen, setTemplateUploadPrepareOpen] = useState(false);
  const [templateUploadPreparePresetId, setTemplateUploadPreparePresetId] = useState('');
  const [templateUploadPrepareGuide, setTemplateUploadPrepareGuide] = useState(null);
  const [templateUploadPrepareGuideLoading, setTemplateUploadPrepareGuideLoading] = useState(false);

  const mergeFields = fieldGuide?.fields;
  const mergeFieldsSheet = useMemo(() => mergeFieldsWithoutRowIndex(mergeFields), [mergeFields]);
  const fieldSig = useMemo(() => fieldSignature(mergeFieldsSheet), [mergeFieldsSheet]);

  useEffect(() => {
    if (!mergeDataSheetOpen) return;
    if (mergeFieldsSheet?.length) return;
    closeMergeDataSheet();
  }, [mergeDataSheetOpen, mergeFieldsSheet?.length, closeMergeDataSheet]);

  const loadFieldGuide = useCallback(
    async (presetIdOverride = undefined) => {
      const eff = presetIdOverride !== undefined ? presetIdOverride : selectedFieldPresetId;
      const idStr = eff != null && eff !== '' ? String(eff).trim() : '';
      const q = isMergeFieldPresetMongoId(idStr) ? `?presetId=${encodeURIComponent(idStr)}` : '';
      try {
        const res = await fetch(`${API_BASE}/quotation-merge/field-guide${q}`, {
          headers: { ...getAuthHeader() },
          credentials: 'include'
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) setFieldGuide(data);
        else setFieldGuide(null);
      } catch {
        setFieldGuide(null);
      }
    },
    [selectedFieldPresetId]
  );

  const loadFieldPresets = useCallback(async () => {
    setFieldPresetsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/quotation-merge/field-presets`, {
        headers: { ...getAuthHeader() },
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setFieldPresets(Array.isArray(data.items) ? data.items : []);
      else setFieldPresets([]);
    } catch {
      setFieldPresets([]);
    } finally {
      setFieldPresetsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!templateUploadPrepareOpen) {
      setTemplateUploadPrepareGuide(null);
      return;
    }
    let cancelled = false;
    setTemplateUploadPrepareGuideLoading(true);
    const idStr = isMergeFieldPresetMongoId(templateUploadPreparePresetId)
      ? String(templateUploadPreparePresetId).trim()
      : '';
    const q = idStr ? `?presetId=${encodeURIComponent(idStr)}` : '';
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/quotation-merge/field-guide${q}`, {
          headers: { ...getAuthHeader() },
          credentials: 'include'
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) setTemplateUploadPrepareGuide(data);
        else setTemplateUploadPrepareGuide(null);
      } catch {
        if (!cancelled) setTemplateUploadPrepareGuide(null);
      } finally {
        if (!cancelled) setTemplateUploadPrepareGuideLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateUploadPrepareOpen, templateUploadPreparePresetId]);

  const templateUploadPrepareCopyText = useMemo(() => {
    const fields = templateUploadPrepareGuide?.fields;
    if (!Array.isArray(fields)) return '';
    return fields
      .map((f) => {
        const key = String(f.key || '').trim();
        const ex = String(f.example || '').trim();
        return `{{${key}}}\t${ex}`;
      })
      .join('\n');
  }, [templateUploadPrepareGuide]);

  const templatePrepareFields = useMemo(
    () => (Array.isArray(templateUploadPrepareGuide?.fields) ? templateUploadPrepareGuide.fields : []),
    [templateUploadPrepareGuide]
  );

  const canPickTemplateFileForPrepare =
    templateUploadPrepareOpen &&
    !templatesLoading &&
    !uploading &&
    !templateUploadPrepareGuideLoading &&
    templatePrepareFields.length > 0;

  const openTemplateUploadPrepare = useCallback(() => {
    void loadFieldPresets();
    setTemplateUploadPreparePresetId(
      isMergeFieldPresetMongoId(selectedFieldPresetId) ? String(selectedFieldPresetId).trim() : ''
    );
    setTemplateUploadPrepareOpen(true);
  }, [loadFieldPresets, selectedFieldPresetId]);

  const closeTemplateUploadPrepare = useCallback(() => setTemplateUploadPrepareOpen(false), []);

  useEffect(() => {
    if (!templateUploadPrepareOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') closeTemplateUploadPrepare();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [templateUploadPrepareOpen, closeTemplateUploadPrepare]);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError('');
    try {
      const res = await fetch(`${API_BASE}/quotation-merge/templates`, {
        headers: { ...getAuthHeader() },
        credentials: 'include'
      });
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
  }, []);

  const uploadTemplateFile = useCallback(async (file, opts = {}) => {
    if (!file) {
      window.alert('파일을 선택해 주세요.');
      return;
    }
    const lower = String(file.name || '').toLowerCase();
    if (!lower.endsWith('.docx') && !lower.endsWith('.xlsx')) {
      window.alert('Word(.docx) 또는 Excel(.xlsx) 파일만 등록할 수 있습니다.');
      return;
    }
    setUploading(true);
    try {
      await pingBackendHealth();
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/quotation-merge/templates`, {
        method: 'POST',
        headers: { ...getAuthHeader() },
        credentials: 'include',
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(getUserVisibleApiError(data, '업로드에 실패했습니다.'));
      await loadTemplates();
      if (data.item?._id) setSelectedTemplateId(String(data.item._id));
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
  }, [loadTemplates, closeTemplateUploadPrepare]);

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
  }, [loadTemplates]);

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
        next._exportAddon = normalizeMergeRowExportAddon(row._exportAddon);
        next._mailTo = row._mailTo != null ? String(row._mailTo) : '';
        next._mailCc = row._mailCc != null ? String(row._mailCc) : '';
        next._mailSubject = row._mailSubject != null ? String(row._mailSubject) : '';
        next._mailBody = row._mailBody != null ? String(row._mailBody) : '';
        return next;
      });
    });
  }, [fieldSig, fieldGuide, selectedTemplateId, templates]);

  const openFieldEditor = () => {
    if (!mergeFieldsSheet?.length) return;
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
        ? `${API_BASE}/quotation-merge/field-presets/${presetId}`
        : `${API_BASE}/quotation-merge/field-config`;
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
        const res = await fetch(`${API_BASE}/quotation-merge/field-presets/${presetId}`, {
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
        const res = await fetch(`${API_BASE}/quotation-merge/field-config`, {
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
      const fieldsPayload = mergeFieldsSheet.map((f) => {
        const multiline = Boolean(f.multiline);
        const valueKind = f.valueKind === 'number' ? 'number' : 'text';
        let excelFormat = MERGE_EXCEL_FORMATS.some((x) => x.id === f.excelFormat) ? f.excelFormat : 'general';
        if (valueKind === 'text') excelFormat = 'general';
        return {
          key: String(f.key || '').trim(),
          label: String(f.label || f.key || '').trim(),
          example: String(f.example || '').trim(),
          multiline,
          excelSpreadLines: multiline && Boolean(f.excelSpreadLines),
          valueKind,
          excelFormat
        };
      });
      const res = await fetch(`${API_BASE}/quotation-merge/field-presets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
        body: JSON.stringify({ name, fields: fieldsPayload })
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
      const res = await fetch(`${API_BASE}/quotation-merge/field-presets`, {
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

  const downloadTemplateFile = async (id, filename) => {
    try {
      await pingBackendHealth();
      const res = await fetch(`${API_BASE}/quotation-merge/templates/${id}/download`, {
        headers: { ...getAuthHeader() },
        credentials: 'include'
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(getUserVisibleApiError(data, '다운로드에 실패했습니다.'));
      }
      const blob = await res.blob();
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
      const res = await fetch(`${API_BASE}/quotation-merge/templates/${id}`, {
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
    const header = ['파일 이름', '종류', '저장', '크기', '등록일'].join('\t');
    const body = rows
      .map((t) => {
        const name = templateListFileName(t);
        const kind = t.fileType === 'docx' ? 'Word' : 'Excel';
        const storage = t.cloudinaryUrl ? 'Cloudinary' : 'DB';
        const size = formatBytes(t.sizeBytes);
        const date = t.createdAt ? new Date(t.createdAt).toLocaleString('ko-KR') : '—';
        return [name, kind, storage, size, date].join('\t');
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
    setMergeRows((rows) => rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
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
      setMergeRows((rows) =>
        rows.map((r, i) => (i === index ? { ...r, _templateIds: clean, _templateId: first } : r))
      );
    },
    [templates, selectedTemplateId]
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
              } else if (sheetCol === 1) {
                next[ri] = { ...next[ri], _exportAddon: parseExportAddonFromPaste(grid[r][c]) };
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
  const downloadMergeOutputsAsSeparateFiles = useCallback(
    async (rowJobs, fieldPresetId) => {
      const planBody = { rowJobs };
      if (fieldPresetId && isMergeFieldPresetMongoId(fieldPresetId)) {
        planBody.fieldPresetId = String(fieldPresetId).trim();
      }
      const planRes = await fetch(`${API_BASE}/quotation-merge/plan`, {
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
      for (let i = 0; i < entries.length; i += 1) {
        await pingBackendHealth();
        const body = {
          rowJobs,
          zipCollisionPolicy: 'rename',
          asZip: false,
          singleOutputIndex: i
        };
        if (planBody.fieldPresetId) body.fieldPresetId = planBody.fieldPresetId;
        const res = await fetch(`${API_BASE}/quotation-merge/run`, {
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
    []
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
      const baseStem =
        String(r.fileLabel || '').trim() ||
        String(r.companyName || '').trim() ||
        `row_${i + 1}`;
      for (let j = 0; j < tids.length; j += 1) {
        const tid = tids[j];
        const t = templates.find((x) => String(x._id) === tid);
        const tplRaw = templateListFileName(t).replace(/\.(docx|xlsx)$/i, '').trim();
        const tplSlug = sanitizeDownloadFileStem(tplRaw).slice(0, 50) || 'doc';
        const apiRow = { ...rowForApi(r) };
        if (tids.length > 1) {
          const p = prof || '';
          const suffix = p ? `${p}_${tplSlug}` : `_${tplSlug}`;
          const combined = sanitizeDownloadFileStem(`${baseStem}${suffix}`.slice(0, 200));
          if (combined) apiRow.fileLabel = combined;
        }
        rowJobs.push({
          templateId: tid,
          row: apiRow,
          exportAddon: normalizeMergeRowExportAddon(r._exportAddon)
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
      const n = await downloadMergeOutputsAsSeparateFiles(rowJobs, fieldPresetIdParam);
      const anyPdf = rowJobs.some((j) => {
        const ea = normalizeMergeRowExportAddon(j.exportAddon);
        return ea === 'pdfAddon' || ea === 'pdfOnly';
      });
      setMergeMessage(
        n > 0 ? `파일 ${n}개를 받았습니다.${anyPdf ? ' (PDF 포함)' : ''}` : ''
      );
    } catch (e) {
      window.alert(e.message || '파일 생성을 시작하지 못했습니다.');
    } finally {
      setMergeRunning(false);
    }
  };

  const runSheetMailHandoffForRow = useCallback(
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
      if (!row || !String(row._mailTo || '').trim()) {
        window.alert(`${ri + 1}행: 받는 사람 이메일을 입력해 주세요.`);
        return;
      }
      if (!rowHasMergeFieldContent(row, mergeFieldsSheet)) {
        window.alert(`${ri + 1}행: 치환할 데이터가 없습니다.`);
        return;
      }

      const ok = window.confirm(
        `${ri + 1}행: 견적 파일을 저장한 뒤 PC 메일(Outlook 등) 작성 창을 엽니다.\n\n` +
          '※ mailto로는 첨부가 전달되지 않습니다. 받은 파일을 메일에 직접 첨부해 주세요.\n' +
          '※ 작성 창을 초안으로 두면 Outlook 등 메일 앱의 임시보관함에 남을 수 있습니다.\n\n' +
          '계속할까요?'
      );
      if (!ok) return;

      const built = buildRowJobsForSheetRow({
        row,
        rowIndex: ri,
        mergeFieldsSheet,
        templates,
        fallbackTid,
        prof
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
        const n = await downloadMergeOutputsAsSeparateFiles(rowJobs, fieldPresetIdParam);

        const hint =
          '';
        const userBody = String(row._mailBody || '').trim();
        const bodyPlain = userBody ? `${userBody}${hint}` : `${hint}`;

        const { href, note, clipboardPlain } = buildMailtoWithFields({
          to: String(row._mailTo || '').trim(),
          cc: String(row._mailCc || '').trim(),
          subject: String(row._mailSubject || '').trim() || '(제목 없음)',
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
        setMergeMessage(
          n > 0
            ? `${ri + 1}행: 파일 ${n}개를 받았고, 메일 작성 창을 열었습니다. 첨부는 직접 넣어 주세요.`
            : ''
        );
      } catch (e) {
        window.alert(e.message || '메일 준비에 실패했습니다.');
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
      downloadMergeOutputsAsSeparateFiles
    ]
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
      const multi = grid.length > 1 || (grid[0] && grid[0].length > 1);
      if (!multi) return;
      e.preventDefault();
      applyMergeGridPatch(rowIndex, sheetCol, grid);
    };

    const handleSheetNavKeyDown = (e) => {
      mergeSheetNavKeyDown(e, {
        rowIndex,
        sheetCol,
        multiline: f.multiline,
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
        className={['qdm-cell', 'qdm-cell--sheet', f.multiline ? 'qdm-cell-tall' : 'qdm-cell-sheet-single']
          .filter(Boolean)
          .join(' ')}
        value={val}
        rows={f.multiline ? 2 : 1}
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
        <h1 className="page-title">문서 메일머지</h1>
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
                accept=".docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                aria-label="양식 파일 선택 (.docx .xlsx)"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void uploadTemplateFile(f, { afterSuccess: closeTemplateUploadPrepare });
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
                등록된 양식이 없습니다. + 버튼으로 어떤 {'{{항목}}'}이 들어가는지 확인한 뒤 파일을 고르거나, 이 영역에 Word/Excel 파일을 놓아 주세요.
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
                        <th scope="col">저장</th>
                        <th scope="col">크기</th>
                        <th scope="col">등록일</th>
                        <th scope="col" className="qdm-excel-th--actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {templates.map((t, idx) => {
                        const isDefault = String(t._id) === String(selectedTemplateId);
                        const isRangeSelected = templateRowSelectedIds.has(String(t._id));
                        return (
                          <tr
                            key={t._id}
                            data-template-row-index={idx}
                            className={[
                              'qdm-template-row',
                              'qdm-template-row--excel',
                              isDefault ? 'qdm-template-row--default' : '',
                              isRangeSelected ? 'qdm-template-row--range-selected' : ''
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            onClick={(e) => {
                              if (e.target.closest('button')) return;
                              if (e.target.closest('.qdm-excel-td--gutter')) return;
                              setSelectedTemplateId(String(t._id));
                            }}
                            title="데이터 칸 클릭: 기본 사용 양식. # 열: 선택·드래그."
                          >
                            <td
                              className="qdm-excel-td qdm-excel-td--gutter"
                              onMouseDown={(e) => handleTemplateGutterMouseDown(e, idx)}
                            >
                              {idx + 1}
                            </td>
                            <td className="qdm-excel-td">{templateListFileName(t)}</td>
                            <td className="qdm-excel-td">{t.fileType === 'docx' ? 'Word' : 'Excel'}</td>
                            <td className="qdm-excel-td">
                              {t.cloudinaryUrl ? (
                                <span className="qdm-badge qdm-badge-cloud" title={t.cloudinaryUrl}>
                                  Cloudinary
                                </span>
                              ) : (
                                <span className="qdm-badge qdm-badge-db" title="MongoDB에 바이너리 저장(구방식)">
                                  DB
                                </span>
                              )}
                            </td>
                            <td className="qdm-excel-td">{formatBytes(t.sizeBytes)}</td>
                            <td className="qdm-excel-td">{t.createdAt ? new Date(t.createdAt).toLocaleString('ko-KR') : '—'}</td>
                            <td className="qdm-table-actions qdm-excel-td qdm-excel-td--actions" onClick={(e) => e.stopPropagation()}>
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
                              {canDeleteTemplate ? (
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
          onSelectFieldPresetId={setSelectedFieldPresetId}
          onCreateFieldPreset={canManageMergeFields ? createFieldPresetFromSheet : undefined}
          onOpenFieldEditor={openFieldEditorFromSheet}
          onOpenCompanyPick={() => setCompanyPickOpen(true)}
          onUpdateRow={updateRow}
          onUpdateRowTemplates={updateRowTemplates}
          onRunMerge={runMerge}
          onMailtoHandoffRow={runSheetMailHandoffForRow}
          onMailCellPaste={handleMergeSheetCellPaste}
          onMailCellKeyDown={handleMergeSheetCellKeyDown}
          onMergeSheetGridPaste={handleMergeSheetGridPaste}
          renderMergeCell={renderMergeCell}
        />
      ) : null}

      {mergeDataSheetOpen && mergeFieldEditorOpen && fieldDraft ? (
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
                  양식 등록 전 확인
                </h2>
                <p className="qdm-template-prepare-modal-sub">
                  편집할 Word/Excel에 넣을 <strong>{'{{키}}'}</strong> 목록을 확인한 뒤 파일을 선택합니다. (데이터 시트 맨 위의「저장된 필드 구성」과는 별개로, 여기서만 미리보기용입니다.)
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
                미리보기 기준 — 저장된 필드 구성
              </label>
              <select
                id="qdm-template-prepare-preset"
                className="qdm-template-prepare-select qdm-select"
                value={String(templateUploadPreparePresetId || '')}
                onChange={(e) => setTemplateUploadPreparePresetId(e.target.value)}
                disabled={fieldPresetsLoading || uploading}
                aria-busy={fieldPresetsLoading}
              >
                <option value="">회사 기본 (한 벌·가이드 문서)</option>
                {fieldPresets.map((p) => (
                  <option key={p._id} value={String(p._id)}>
                    {String(p.name || '').trim() || '이름 없음'}
                  </option>
                ))}
              </select>
              {fieldPresetsLoading ? (
                <p className="qdm-template-prepare-note">저장된 구성 목록 불러오는 중…</p>
              ) : null}

              {templateUploadPrepareGuideLoading ? (
                <p className="qdm-template-prepare-note">선택한 구성의 치환 항목을 불러오는 중…</p>
              ) : null}

              {!templateUploadPrepareGuideLoading && templatePrepareFields.length === 0 ? (
                <p className="qdm-banner qdm-banner-error">
                  문서 치환 항목을 불러오지 못했습니다. 동의·권한을 확인하거나 잠시 후 다시 시도해 주세요.
                </p>
              ) : null}

              {templatePrepareFields.length > 0 ? (
                <>
                  <p className="qdm-template-prepare-hint">
                    Word 본문·Excel 셀에 아래 <strong>치환자</strong> 열 값을 그대로 넣으면 됩니다. 예시 열은 문서 편집 시 참고용입니다.
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
                          <th>옵션</th>
                        </tr>
                      </thead>
                      <tbody>
                        {templatePrepareFields.map((f, i) => {
                          const key = String(f.key || '').trim();
                          const token = key ? `{{${key}}}` : '';
                          const ml = Boolean(f.multiline);
                          const xl = Boolean(f.excelSpreadLines);
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
                              <td className="qdm-template-prepare-td-flags">
                                {ml ? '여러줄 ' : ''}
                                {ml && xl ? '줄→셀' : ''}
                                {!ml && !xl ? '—' : ''}
                              </td>
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
                      rows={Math.min(14, Math.max(4, templatePrepareFields.length + 1))}
                      value={templateUploadPrepareCopyText}
                      spellCheck={false}
                      aria-label="치환자와 예시 탭 구분 복사용"
                    />
                  </div>
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
                disabled={!canPickTemplateFileForPrepare}
                title={
                  !canPickTemplateFileForPrepare
                    ? '{{항목}} 목록이 준비된 뒤 선택할 수 있습니다.'
                    : '.docx 또는 .xlsx 파일을 고릅니다.'
                }
                onClick={() => uploadInputRef.current?.click()}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  upload_file
                </span>
                파일 선택하여 등록
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
