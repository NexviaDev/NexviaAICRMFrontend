import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';
import { getUserVisibleApiError } from '@/lib/api-error';
import { buildMailtoWithFields } from '@/lib/email-client-links';
import { getStoredCrmUser, isManagerOrAboveRole } from '@/lib/crm-role-utils';
import {
  buildOpportunityMergeSourceOptions,
  resolveOpportunityMergeSourceValue
} from '@/lib/opportunity-merge-sources';
import {
  fetchOpportunityMergeMappingPresets,
  fetchOpportunityMergeMappingPresetsWithMigration,
  newMappingPresetId,
  putOpportunityMergeMappingPresets
} from '@/lib/opportunity-merge-mapping-storage';
import MergeDataSheetModal, { MERGE_SHEET_FIELD_START, MERGE_SHEET_PREFIX_COL_COUNT } from '@/shared/merge-data-sheet-modal/merge-data-sheet-modal';
import MergeFieldEditorModal from '@/shared/merge-field-editor-modal/merge-field-editor-modal';
import {
  mergeFieldsWithoutRowIndex,
  buildMergeFieldsPayload,
  mapApiFieldsToEditorDraft,
  MERGE_FIELD_PRESET_NAME_MAX
} from '@/lib/merge-field-guide-payload';
import {
  MERGE_DATA_SHEET_URL_VALUE,
  OPPORTUNITY_MERGE_SHEET_URL_PARAM,
  isMergeDataSheetUrlOpen
} from '@/lib/merge-data-sheet-url';
import { MERGE_EXCEL_FORMATS } from '@/lib/merge-field-editor-constants';
import { parseTsvGrid } from '@/lib/tsv-grid';
import CustomerCompanySearchModal from '@/customer-companies/customer-company-search-modal/customer-company-search-modal';
import '@/lead-capture/lead-capture-crm-mapping/lead-capture-crm-mapping-modal.css';
import './opportunity-merge-from-opportunity.css';

const MERGE_SHEET_INITIAL_ROWS = 200;
const MERGE_SHEET_MAX_ROWS = 1000;

function isMergeFieldPresetMongoId(v) {
  if (v == null || v === '') return false;
  return /^[a-f0-9]{24}$/i.test(String(v).trim());
}

function buildEmptyRow(fields) {
  const row = {};
  if (!Array.isArray(fields)) return row;
  for (const f of fields) {
    if (f && f.key) row[f.key] = '';
  }
  return row;
}

function getRowTemplateIds(row, fallbackTid) {
  if (Array.isArray(row?._templateIds) && row._templateIds.length) {
    return row._templateIds.map(String);
  }
  const one = String(row?._templateId || '').trim();
  if (one) return [one];
  const fb = String(fallbackTid || '').trim();
  return fb ? [fb] : [];
}

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

function createInitialMergeRows(fields, templateId) {
  const n = Math.min(MERGE_SHEET_INITIAL_ROWS, MERGE_SHEET_MAX_ROWS);
  return Array.from({ length: n }, () => createMergeRowState(fields, templateId, true));
}

function defaultTemplateIdFromList(templates) {
  return templates?.[0]?._id ? String(templates[0]._id) : '';
}

function rowForApi(row) {
  const o = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (k.startsWith('_')) continue;
    o[k] = v;
  }
  return o;
}

function rowHasMergeFieldContent(row, mergeFields) {
  if (!row || !Array.isArray(mergeFields)) return false;
  return mergeFields.some(
    (f) => f?.key && String(f.key) !== 'rowIndex' && String(row[f.key] ?? '').trim() !== ''
  );
}

function rowHasContent(row) {
  return Object.entries(row || {}).some(([k, v]) => !k.startsWith('_') && String(v || '').trim() !== '');
}

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

function profileTagForMergeZip(selectedFieldPresetId, fieldGuide, fieldPresets) {
  if (!isMergeFieldPresetMongoId(selectedFieldPresetId)) return '';
  const raw =
    String(fieldGuide?.presetName || '').trim() ||
    String(fieldPresets.find((p) => String(p._id) === String(selectedFieldPresetId).trim())?.name || '').trim();
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
  const parts = s
    .split(/[\s,;|]+/)
    .map((x) => x.trim())
    .filter(Boolean);
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

function fieldSignature(fields) {
  if (!Array.isArray(fields)) return '';
  return fields
    .map(
      (f) =>
        `${f.key}:${f.label}:${f.multiline ? 1 : 0}:${f.excelSpreadLines ? 1 : 0}:${f.valueKind || 'text'}:${f.excelFormat || 'general'}`
    )
    .join('|');
}

function parseSavedCellMapping(raw) {
  if (raw == null) return { sourceType: 'field', sourceKey: '', constantValue: '' };
  if (typeof raw === 'object' && (raw.sourceType || raw.sourceKey !== undefined || raw.constantValue !== undefined)) {
    return {
      sourceType: raw.sourceType === 'constant' ? 'constant' : 'field',
      sourceKey: String(raw.sourceKey || ''),
      constantValue: String(raw.constantValue ?? '')
    };
  }
  return { sourceType: 'field', sourceKey: String(raw || ''), constantValue: '' };
}

function previewOpportunityMappedValue(ctx, row) {
  if (!row) return '';
  if (row.sourceType === 'constant') return String(row.constantValue ?? '').trim();
  if (!row.sourceKey) return '';
  const s = resolveOpportunityMergeSourceValue(row.sourceKey, ctx);
  if (!s) return '';
  const t = String(s).trim();
  if (!t) return '';
  if (t.includes('\n')) {
    const lines = t.split('\n').map((x) => x.trim()).filter((x) => x.length > 0);
    if (!lines.length) return '';
    const shown = lines.slice(0, 5);
    const summary = shown.join(' · ');
    const extra = lines.length > 5 ? ` …(+${lines.length - 5})` : '';
    const out = summary + extra;
    return out.length > 88 ? `${out.slice(0, 85)}…` : out;
  }
  if (t.length > 80) return `${t.slice(0, 77)}…`;
  return t;
}

function opportunitySourceMeta(sourceKey) {
  const id = String(sourceKey || '');
  if (!id) return '';
  if (id.startsWith('form.')) return '기회 폼';
  if (id.startsWith('finance.')) return '계약·수금 추가';
  if (id.startsWith('schedule.')) return '일정 추가';
  if (id.startsWith('fixed.')) return '문서 메일란';
  if (id.startsWith('slot.')) return '참조 슬롯';
  if (id.startsWith('snapshot.')) return '스냅샷';
  if (id.startsWith('derived.')) return '파생';
  return '기회';
}

function opportunityMergeRowStatus(row, preview) {
  if (!row?.mergeKey) return { type: 'err', label: '키 없음' };
  if (row.sourceType === 'constant') {
    return String(row.constantValue ?? '').trim() !== ''
      ? { type: 'ok', label: 'VALID' }
      : { type: 'warn', label: '값 입력' };
  }
  if (!row.sourceKey) return { type: 'warn', label: '소스 선택' };
  const empty = !preview || String(preview).trim() === '';
  if (empty) return { type: 'muted', label: '빈 값' };
  return { type: 'ok', label: 'VALID' };
}

function buildRowJobsForSheetRow({ row, rowIndex, mergeFieldsSheet, templates, fallbackTid, prof }) {
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

/**
 * 기회 모달에서 문서 메일머지: 매핑 단계 → merge-data-sheet-modal.
 * @param {{ open: boolean, onClose: () => void, getAuthHeader: () => object, mergeContext: object }} props
 */
export default function OpportunityMergeFromOpportunity({ open, onClose, getAuthHeader, mergeContext }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const sheetUrlTransitionRef = useRef(false);
  const me = useMemo(() => getStoredCrmUser(), []);
  const canManageMergeFields = isManagerOrAboveRole(me?.role);
  const companyStorageKey = String(me?.companyId || me?.company?._id || 'default');

  const [phase, setPhase] = useState('setup');
  const [fieldGuide, setFieldGuide] = useState(null);
  const [fieldPresets, setFieldPresets] = useState([]);
  const [fieldPresetsLoading, setFieldPresetsLoading] = useState(false);
  const [selectedFieldPresetId, setSelectedFieldPresetId] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [mergeRows, setMergeRows] = useState([]);
  const [mergeRunning, setMergeRunning] = useState(false);
  const [mergeMessage, setMergeMessage] = useState('');
  const [companyPickOpen, setCompanyPickOpen] = useState(false);
  const [mappingRows, setMappingRows] = useState([]);
  const [mappingHydrateNonce, setMappingHydrateNonce] = useState(0);
  const pendingHydrateMappingsRef = useRef(null);
  const [savedMappingNameDraft, setSavedMappingNameDraft] = useState('');
  const [savedMappingPickId, setSavedMappingPickId] = useState('');
  const [savedMappingPresetsFromServer, setSavedMappingPresetsFromServer] = useState([]);
  const [savedMappingPresetsLoading, setSavedMappingPresetsLoading] = useState(false);
  const [savedMappingPresetSaving, setSavedMappingPresetSaving] = useState(false);
  const [savedMappingDeleting, setSavedMappingDeleting] = useState(false);
  const [savedMappingDropdownOpen, setSavedMappingDropdownOpen] = useState(false);
  const savedMappingDropdownRef = useRef(null);
  const savedMappingDropdownPanelId = useId();
  const [mergeFieldEditorOpen, setMergeFieldEditorOpen] = useState(false);
  const [fieldDraft, setFieldDraft] = useState(null);
  const [fieldPresetNameDraft, setFieldPresetNameDraft] = useState('');
  const [fieldSaving, setFieldSaving] = useState(false);

  const mergeFieldsSheet = useMemo(() => mergeFieldsWithoutRowIndex(fieldGuide?.fields), [fieldGuide]);
  const fieldSig = useMemo(() => fieldSignature(mergeFieldsSheet), [mergeFieldsSheet]);
  const sourceOptions = useMemo(() => buildOpportunityMergeSourceOptions(mergeContext || {}), [mergeContext]);

  /** mergeKey → 행. 예전 `mappingByFieldKey` 이름·패턴과 호환되도록 유지(시트 열기 버튼 등에서 사용). */
  const mappingByFieldKey = useMemo(
    () => Object.fromEntries(mappingRows.map((r) => [r.mergeKey, r])),
    [mappingRows]
  );

  const sheetFromUrl = isMergeDataSheetUrlOpen(searchParams, OPPORTUNITY_MERGE_SHEET_URL_PARAM);

  const stripOppMergeSheetUrlParam = useCallback(() => {
    const p = new URLSearchParams(searchParams);
    if (!p.has(OPPORTUNITY_MERGE_SHEET_URL_PARAM)) return;
    p.delete(OPPORTUNITY_MERGE_SHEET_URL_PARAM);
    setSearchParams(p, { replace: true });
  }, [searchParams, setSearchParams]);

  const updateMappingRow = useCallback((rowId, patch) => {
    setMappingRows((rows) => rows.map((x) => (x.id === rowId ? { ...x, ...patch } : x)));
  }, []);

  const loadFieldGuide = useCallback(
    async (presetIdOverride) => {
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
    [getAuthHeader, selectedFieldPresetId]
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
  }, [getAuthHeader]);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/quotation-merge/templates`, {
        headers: { ...getAuthHeader() },
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '양식 목록 실패');
      const items = Array.isArray(data.items) ? data.items : [];
      setTemplates(items);
      setSelectedTemplateId((prev) => {
        if (prev && items.some((t) => String(t._id) === String(prev))) return prev;
        return items[0]?._id ? String(items[0]._id) : '';
      });
    } catch {
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  }, [getAuthHeader]);

  useEffect(() => {
    if (!open) return;
    setPhase('setup');
    setSelectedFieldPresetId('');
    pendingHydrateMappingsRef.current = null;
    setMappingRows([]);
    setMappingHydrateNonce(0);
    setSavedMappingPickId('');
    setSavedMappingNameDraft('');
    setSavedMappingDropdownOpen(false);
    setMergeMessage('');
    setSavedMappingDeleting(false);
    setMergeFieldEditorOpen(false);
    setFieldDraft(null);
    setFieldPresetNameDraft('');
    void loadFieldPresets();
    void loadTemplates();
    void loadFieldGuide('');
    /* loadFieldGuide 는 selectedFieldPresetId 에 의존해 참조가 바뀜 → deps 에 넣으면 프리셋 변경 때마다 이 effect 가 재실행되어 회사 기본으로 초기화됨. 모달 열릴 때만 초기화하려면 open 만으로 충분하고, 빈 preset 으로 가이드는 위에서 한 번 호출. */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 의도적으로 loadFieldGuide 제외(상술)
  }, [open, loadFieldPresets, loadTemplates]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setSavedMappingPresetsLoading(true);
      try {
        const items = await fetchOpportunityMergeMappingPresetsWithMigration(companyStorageKey, getAuthHeader);
        if (!cancelled) setSavedMappingPresetsFromServer(Array.isArray(items) ? items : []);
      } catch {
        if (!cancelled) setSavedMappingPresetsFromServer([]);
      } finally {
        if (!cancelled) setSavedMappingPresetsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, companyStorageKey, getAuthHeader]);

  useEffect(() => {
    if (!savedMappingDropdownOpen) return;
    const onDocMouseDown = (e) => {
      if (savedMappingDropdownRef.current && !savedMappingDropdownRef.current.contains(e.target)) {
        setSavedMappingDropdownOpen(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setSavedMappingDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [savedMappingDropdownOpen]);

  useEffect(() => {
    if (!open) return;
    void loadFieldGuide();
  }, [open, selectedFieldPresetId, loadFieldGuide]);

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
        const nextIds = preservedIds.length > 0 ? preservedIds : tid ? [tid] : defTid ? [defTid] : [];
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

  useEffect(() => {
    if (!open || phase !== 'setup') return;
    const fields = mergeFieldsSheet || [];
    const hydrate = pendingHydrateMappingsRef.current;
    pendingHydrateMappingsRef.current = null;

    setMappingRows((prev) => {
      const prevMap = new Map((prev || []).map((r) => [r.mergeKey, r]));
      if (!fields.length) return [];
      return fields.map((f) => {
        let base = prevMap.get(f.key);
        if (!base) {
          base = {
            id: `map-${f.key}`,
            mergeKey: f.key,
            targetLabel: f.label || f.key,
            sourceType: 'field',
            sourceKey: '',
            constantValue: ''
          };
        } else {
          base = {
            ...base,
            id: base.id || `map-${f.key}`,
            mergeKey: f.key,
            targetLabel: f.label || f.key
          };
        }
        if (hydrate && Object.prototype.hasOwnProperty.call(hydrate, f.key)) {
          const parsed = parseSavedCellMapping(hydrate[f.key]);
          base.sourceType = parsed.sourceType;
          base.sourceKey = parsed.sourceKey;
          base.constantValue = parsed.constantValue;
        }
        return base;
      });
    });
  }, [open, phase, fieldSig, mappingHydrateNonce, mergeFieldsSheet]);

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
        sheetCol >= mailStart && sheetCol < fieldStart ? MERGE_SHEET_MAIL_ROW_KEYS[sheetCol - mailStart] : '';
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
    [mergeRows, mergeSheetNavKeyDown]
  );

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
    [getAuthHeader]
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
    for (let i = 0; i < mergeRows.length; i += 1) {
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
      setMergeMessage(n > 0 ? `파일 ${n}개를 받았습니다.${anyPdf ? ' (PDF 포함)' : ''}` : '');
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
        `${ri + 1}행: 파일을 저장한 뒤 PC 메일(Outlook 등) 작성 창을 엽니다.\n\n` +
          '※ mailto로는 첨부가 전달되지 않습니다. 받은 파일을 메일에 직접 첨부해 주세요.\n\n' +
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

        const userBody = String(row._mailBody || '').trim();
        const bodyPlain = userBody || '';

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
            /* ignore */
          }
        }
        if (note) window.alert(note);

        const w = window.open(href, '_blank', 'noopener,noreferrer');
        if (!w) {
          window.location.assign(href);
        }
        setMergeMessage(
          n > 0 ? `${ri + 1}행: 파일 ${n}개를 받았고, 메일 작성 창을 열었습니다. 첨부는 직접 넣어 주세요.` : ''
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
      const combined = [...prev, ...appended];
      if (combined.length > MERGE_SHEET_MAX_ROWS) {
        window.alert(`행은 최대 ${MERGE_SHEET_MAX_ROWS}개입니다. 초과분은 잘렸습니다.`);
        return combined.slice(0, MERGE_SHEET_MAX_ROWS);
      }
      return combined;
    });
  };

  const renderMergeCell = (row, rowIndex, f) => {
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
        multiline: Boolean(f.multiline),
        value: val,
        commit: (next) => updateRow(rowIndex, key, next)
      });
    };

    return (
      <textarea
        className={`qdm-cell qdm-cell--sheet${f.multiline ? ' qdm-cell-tall' : ' qdm-cell-sheet-single'}`}
        rows={f.multiline ? 2 : 1}
        value={val}
        onChange={(e) => updateRow(rowIndex, key, e.target.value)}
        onPaste={tryPasteGrid}
        onKeyDown={handleSheetNavKeyDown}
        disabled={mergeRunning}
        spellCheck={false}
        aria-label={ariaLabel}
      />
    );
  };

  const applySavedPresetById = (id) => {
    const p = savedMappingPresetsFromServer.find((x) => x.id === id);
    if (!p) return;
    pendingHydrateMappingsRef.current = p.mappings || {};
    if (p.presetId && isMergeFieldPresetMongoId(p.presetId)) {
      setSelectedFieldPresetId(String(p.presetId));
    } else {
      setMappingHydrateNonce((n) => n + 1);
    }
  };

  const handleSaveMappingPreset = async () => {
    const name = String(savedMappingNameDraft || '').trim();
    if (!name) {
      window.alert('저장할 이름을 입력해 주세요.');
      return;
    }
    setSavedMappingPresetSaving(true);
    try {
      await pingBackendHealth();
      const mappings = Object.fromEntries(
        mappingRows.map((r) => [
          r.mergeKey,
          r.sourceType === 'constant'
            ? { sourceType: 'constant', sourceKey: '', constantValue: r.constantValue }
            : { sourceType: 'field', sourceKey: r.sourceKey, constantValue: '' }
        ])
      );
      const item = {
        id: newMappingPresetId(),
        name: name.slice(0, 80),
        docKind: 'quote',
        presetId: String(selectedFieldPresetId || ''),
        mappings
      };
      const latest = await fetchOpportunityMergeMappingPresets(getAuthHeader);
      const mergedList = [...latest, item];
      const { items } = await putOpportunityMergeMappingPresets(getAuthHeader, mergedList);
      setSavedMappingPresetsFromServer(Array.isArray(items) ? items : mergedList);
      setSavedMappingNameDraft('');
      setSavedMappingDropdownOpen(false);
      window.alert('「자주 사용하는 매핑」에 저장했습니다. (회사 DB에 반영)');
    } catch (e) {
      window.alert(e?.message || '저장에 실패했습니다.');
    } finally {
      setSavedMappingPresetSaving(false);
    }
  };

  const deleteSavedMappingPresetById = async (id) => {
    const idStr = String(id || '').trim();
    if (!idStr) return;
    const p = savedMappingPresetsFromServer.find((x) => x.id === idStr);
    if (!p) return;
    if (!window.confirm(`「${p.name}」저장 매핑을 회사 DB에서 삭제할까요?`)) return;
    setSavedMappingDeleting(true);
    try {
      await pingBackendHealth();
      const latest = await fetchOpportunityMergeMappingPresets(getAuthHeader);
      const next = latest.filter((x) => String(x.id) !== idStr);
      const { items } = await putOpportunityMergeMappingPresets(getAuthHeader, next);
      setSavedMappingPresetsFromServer(Array.isArray(items) ? items : next);
      setSavedMappingPickId((cur) => (String(cur) === idStr ? '' : cur));
    } catch (e) {
      window.alert(e?.message || '삭제하지 못했습니다.');
    } finally {
      setSavedMappingDeleting(false);
    }
  };

  const applyMappingToFirstRow = () => {
    const fields = mergeFieldsSheet;
    if (!fields.length) return;
    const ctx = mergeContext || {};
    const defTid = selectedTemplateId || defaultTemplateIdFromList(templates);
    const mailTo =
      String(ctx.quoteDocRecipientEmail || '').trim() ||
      String(ctx.purchaseOrderDocRecipientEmail || '').trim();
    const mailCc =
      String(ctx.quoteDocCcEmail || '').trim() || String(ctx.purchaseOrderDocCcEmail || '').trim();

    setMergeRows((rows) => {
      const next = rows.map((r, i) => {
        if (i !== 0) return r;
        const base = createMergeRowState(fields, defTid, true, defTid ? [defTid] : []);
        for (const rmap of mappingRows) {
          if (rmap.sourceType === 'constant') {
            base[rmap.mergeKey] = String(rmap.constantValue ?? '').trim();
          } else {
            base[rmap.mergeKey] = rmap.sourceKey
              ? resolveOpportunityMergeSourceValue(rmap.sourceKey, ctx)
              : '';
          }
        }
        base._mailTo = mailTo || base._mailTo;
        base._mailCc = mailCc || base._mailCc;
        return base;
      });
      return next;
    });
  };

  const closeFieldEditor = useCallback(() => {
    setFieldDraft(null);
    setFieldPresetNameDraft('');
    setMergeFieldEditorOpen(false);
  }, []);

  const openFieldEditor = useCallback(() => {
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
    setFieldDraft(mapApiFieldsToEditorDraft(fieldGuide?.fields));
  }, [mergeFieldsSheet, selectedFieldPresetId, fieldGuide, fieldPresets]);

  const openFieldEditorFromSheet = useCallback(() => {
    openFieldEditor();
    setMergeFieldEditorOpen(true);
  }, [openFieldEditor]);

  const saveFieldDraft = useCallback(async () => {
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
  }, [
    fieldDraft,
    fieldPresetNameDraft,
    selectedFieldPresetId,
    getAuthHeader,
    loadFieldGuide,
    loadFieldPresets,
    loadTemplates,
    closeFieldEditor
  ]);

  const resetFieldGuideToDefault = useCallback(async () => {
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
  }, [selectedFieldPresetId, getAuthHeader, loadFieldGuide, loadFieldPresets, closeFieldEditor]);

  const createFieldPresetFromSheet = useCallback(async () => {
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
  }, [canManageMergeFields, mergeFieldsSheet, getAuthHeader, loadFieldPresets, loadFieldGuide]);

  const createFieldPresetFromEditor = useCallback(async () => {
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
  }, [
    canManageMergeFields,
    fieldDraft,
    fieldPresetNameDraft,
    getAuthHeader,
    loadFieldPresets,
    loadFieldGuide
  ]);

  const openSheetPhase = () => {
    if (!mergeFieldsSheet.length) {
      window.alert('필드 구성을 불러온 뒤 진행해 주세요.');
      return;
    }
    const p = new URLSearchParams(searchParams);
    p.set(OPPORTUNITY_MERGE_SHEET_URL_PARAM, MERGE_DATA_SHEET_URL_VALUE);
    sheetUrlTransitionRef.current = true;
    setSearchParams(p, { replace: false });
    applyMappingToFirstRow();
    setPhase('sheet');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        sheetUrlTransitionRef.current = false;
      });
    });
  };

  const handleCloseAll = () => {
    closeFieldEditor();
    setPhase('setup');
    stripOppMergeSheetUrlParam();
    onClose();
  };

  /** 브라우저·모바일 뒤로가기로 oppDocMergeSheet 쿼리만 제거된 경우 시트 단계 해제 */
  useEffect(() => {
    if (!open || sheetUrlTransitionRef.current) return;
    if (phase === 'sheet' && !sheetFromUrl) {
      closeFieldEditor();
      setPhase('setup');
    }
  }, [open, phase, sheetFromUrl]);

  /** URL에 oppDocMergeSheet=1 이 있으면 매핑이 채워진 뒤 시트로 진입(공유·앞으로가기) */
  useEffect(() => {
    if (!open || phase === 'sheet' || !sheetFromUrl) return;
    if (!mergeFieldsSheet.length) return;
    const incomplete = mergeFieldsSheet.some((f) => f?.key && !mappingByFieldKey[f.key]);
    if (incomplete) return;
    applyMappingToFirstRow();
    setPhase('sheet');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyMappingToFirstRow: 매 렌더 스냅샷으로 호출
  }, [open, phase, sheetFromUrl, mergeFieldsSheet, mappingByFieldKey]);

  if (!open) return null;

  const docTitle = '문서 보내기';
  const disabled = templatesLoading || fieldPresetsLoading || mergeRunning;
  const ctx = mergeContext || {};

  return (
    <>
      {phase === 'setup' ? (
        <div className="lc-crm-map-overlay opp-merge-from-opp-overlay" role="dialog" aria-modal="true" aria-labelledby="opp-merge-map-title">
          <div className="lc-crm-map-panel" onClick={(e) => e.stopPropagation()}>
            <header className="lc-crm-map-head">
              <div className="lc-crm-map-head-left">
                <button
                  type="button"
                  className="lc-crm-map-btn-discard"
                  onClick={handleCloseAll}
                  aria-label="뒤로"
                  disabled={disabled}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '1.25rem', verticalAlign: 'middle' }}>
                    arrow_back
                  </span>
                </button>
                <h2 id="opp-merge-map-title">{docTitle} — 문서 매핑</h2>
                <span className="lc-crm-map-draft">Merge</span>
                <span className="lc-crm-map-lead-count" title="문서 치환 필드 수">
                  {mergeFieldsSheet.length > 0 ? `${mergeFieldsSheet.length}필드` : '필드 없음'}
                </span>
              </div>
              <div className="lc-crm-map-head-actions">
                <button type="button" className="lc-crm-map-btn-discard" onClick={handleCloseAll} disabled={disabled}>
                  닫기
                </button>
                <button
                  type="button"
                  className="lc-crm-map-btn-save"
                  onClick={openSheetPhase}
                  disabled={
                    disabled ||
                    !mergeFieldsSheet.length ||
                    templatesLoading ||
                    mergeFieldsSheet.some((f) => f?.key && !mappingByFieldKey[f.key])
                  }
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '1.1rem' }}>
                    table_rows
                  </span>
                  데이터 시트 열기
                </button>
              </div>
            </header>

            <div className="lc-crm-map-body">
              <div className="lc-crm-map-title-block">
                <h1>기회 → 문서</h1>
                <p className="lc-crm-map-lead-hint">
                  아래에서 <strong>기회에 있는 값</strong>(또는 <strong>고정값</strong>)을 각 <strong>문서 치환 키</strong>에 연결합니다.
                  <strong> 미리보기</strong>는 지금 기회 폼에 보이는 값 기준입니다. 엑셀 가져오기와 달리 파일 드래그는 없습니다.
                </p>
              </div>

              <div className="opp-merge-setup-grid">
                <section className="opp-merge-setup-grid-cell opp-merge-field-preset-section">
                <p className="lc-crm-map-target-desc" style={{ marginBottom: '0.5rem' }}>
                  <strong>1. 저장된 필드 구성</strong>
                </p>
                <div className="opp-merge-preset-row">
                  <select
                    className="opp-merge-select opp-merge-select--wide"
                    value={String(selectedFieldPresetId ?? '')}
                    onChange={(e) => setSelectedFieldPresetId(e.target.value)}
                    disabled={disabled || fieldPresetsLoading}
                    aria-label="저장된 필드 구성 선택 — 회사 기본 또는 이름 붙인 구성"
                  >
                    <option value="">회사 기본</option>
                    {fieldPresets.map((p) => (
                      <option key={p._id} value={String(p._id)}>
                        {typeof p.fieldCount === 'number' ? `${p.name} (${p.fieldCount}필드)` : p.name}
                      </option>
                    ))}
                  </select>
                </div>
                {fieldPresetsLoading ? <p className="lc-crm-map-source-meta">목록 불러오는 중…</p> : null}
              </section>

              <section className="opp-merge-setup-grid-cell opp-merge-saved-mapping-section">
                <p className="lc-crm-map-target-desc" style={{ marginBottom: '0.5rem' }}>
                  <strong>자주 사용하는 매핑</strong> (회사 DB · 동료와 공유)
                </p>
                <div className="opp-merge-saved-dropdown" ref={savedMappingDropdownRef}>
                  <button
                    type="button"
                    className="opp-merge-saved-dropdown-trigger"
                    aria-expanded={savedMappingDropdownOpen}
                    aria-haspopup="listbox"
                    aria-controls={savedMappingDropdownPanelId}
                    disabled={disabled || savedMappingPresetsLoading || savedMappingDeleting}
                    onClick={() => {
                      if (disabled || savedMappingPresetsLoading || savedMappingDeleting) return;
                      setSavedMappingDropdownOpen((o) => !o);
                    }}
                  >
                    <span className="opp-merge-saved-dropdown-trigger-text">
                      {savedMappingPickId
                        ? String(
                            savedMappingPresetsFromServer.find((x) => x.id === savedMappingPickId)?.name || ''
                          ).trim() || '선택됨'
                        : '불러오기…'}
                    </span>
                    <span
                      className={`material-symbols-outlined opp-merge-saved-dropdown-chevron${
                        savedMappingDropdownOpen ? ' is-open' : ''
                      }`}
                      aria-hidden
                    >
                      expand_more
                    </span>
                  </button>
                  {savedMappingDropdownOpen ? (
                    <div
                      id={savedMappingDropdownPanelId}
                      className="opp-merge-saved-dropdown-panel"
                      role="listbox"
                      aria-label="저장된 매핑 목록"
                    >
                      {savedMappingPresetsFromServer.length === 0 ? (
                        <p className="opp-merge-saved-dropdown-empty">저장된 항목이 없습니다. 아래에서 이름을 적고 등록하세요.</p>
                      ) : (
                        <ul className="opp-merge-saved-dropdown-list">
                          {savedMappingPresetsFromServer.map((p) => (
                            <li key={p.id} className="opp-merge-saved-dropdown-row">
                              <button
                                type="button"
                                role="option"
                                aria-selected={savedMappingPickId === p.id}
                                className={`opp-merge-saved-dropdown-option${savedMappingPickId === p.id ? ' is-active' : ''}`}
                                disabled={disabled || savedMappingDeleting}
                                onClick={() => {
                                  setSavedMappingPickId(p.id);
                                  applySavedPresetById(p.id);
                                  setSavedMappingDropdownOpen(false);
                                }}
                              >
                                {p.name}
                              </button>
                              <button
                                type="button"
                                className="opp-merge-saved-dropdown-del"
                                aria-label={`「${p.name}」 삭제`}
                                title="삭제"
                                disabled={
                                  disabled ||
                                  savedMappingPresetsLoading ||
                                  savedMappingPresetSaving ||
                                  savedMappingDeleting
                                }
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void deleteSavedMappingPresetById(p.id);
                                }}
                              >
                                <span className="material-symbols-outlined" aria-hidden>
                                  delete_outline
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="opp-merge-saved-dropdown-footer">
                        <input
                          type="text"
                          className="opp-merge-input opp-merge-saved-dropdown-footer-input"
                          placeholder="새로 저장할 이름"
                          value={savedMappingNameDraft}
                          onChange={(e) => setSavedMappingNameDraft(e.target.value)}
                          maxLength={80}
                          disabled={disabled || savedMappingPresetsLoading || savedMappingDeleting}
                          aria-label="새 매핑 저장 이름"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleSaveMappingPreset();
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="opp-merge-btn opp-merge-btn--primary opp-merge-saved-dropdown-register"
                          onClick={() => void handleSaveMappingPreset()}
                          disabled={
                            disabled ||
                            savedMappingPresetsLoading ||
                            savedMappingPresetSaving ||
                            savedMappingDeleting
                          }
                        >
                          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: '1.1rem' }}>
                            bookmark_add
                          </span>
                          {savedMappingPresetSaving ? '저장 중…' : '등록'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                {savedMappingPresetsLoading ? (
                  <p className="lc-crm-map-source-meta" style={{ marginTop: '0.35rem' }}>
                    저장된 매핑 목록을 불러오는 중…
                  </p>
                ) : null}
              </section>
              </div>

              <p className="lc-crm-map-target-desc" style={{ marginBottom: '1rem' }}>
                미리보기는 <strong>현재 기회 입력값</strong> 기준입니다. <strong>데이터 시트 열기</strong>를 누르면 아래 매핑이 첫 행에 반영됩니다.
              </p>

              <div className="lc-crm-map-table-head">
                <div>소스 (기회 값)</div>
                <div />
                <div>대상 (문서 치환)</div>
                <div>미리보기</div>
                <div style={{ textAlign: 'right' }}>상태</div>
              </div>

              <div className="lc-crm-map-rows">
                {mappingRows.map((row) => {
                  const preview = previewOpportunityMappedValue(ctx, row);
                  const status = opportunityMergeRowStatus(row, preview);
                  const isConst = row.sourceType === 'constant';
                  return (
                    <div key={row.id} className={`lc-crm-map-row ${isConst ? 'is-constant' : ''}`}>
                      <div className="lc-crm-map-source-cell">
                        <div className="lc-crm-map-icon-box">
                          <span className="material-symbols-outlined" style={{ fontSize: '1.15rem' }}>
                            {isConst ? 'add_circle' : 'input'}
                          </span>
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="lc-crm-map-source-mode-toggle" role="group" aria-label="소스: 기회 필드 또는 고정값">
                            <button
                              type="button"
                              className={!isConst ? 'is-active' : ''}
                              onClick={() => updateMappingRow(row.id, { sourceType: 'field' })}
                              disabled={disabled}
                            >
                              기회 필드
                            </button>
                            <button
                              type="button"
                              className={isConst ? 'is-active' : ''}
                              onClick={() => updateMappingRow(row.id, { sourceType: 'constant' })}
                              disabled={disabled}
                            >
                              고정값
                            </button>
                          </div>
                          {isConst ? (
                            <input
                              className="lc-crm-map-input"
                              style={{ marginTop: '0.35rem' }}
                              placeholder="값 입력…"
                              value={row.constantValue}
                              onChange={(e) => updateMappingRow(row.id, { constantValue: e.target.value })}
                              disabled={disabled}
                            />
                          ) : (
                            <>
                              <select
                                className="lc-crm-map-select"
                                value={row.sourceKey}
                                onChange={(e) => updateMappingRow(row.id, { sourceKey: e.target.value })}
                                disabled={disabled}
                              >
                                <option value="">소스 선택…</option>
                                {sourceOptions.map((source) => (
                                  <option key={source.id} value={source.id}>
                                    {source.label}
                                  </option>
                                ))}
                              </select>
                              <p className="lc-crm-map-source-meta">{opportunitySourceMeta(row.sourceKey)}</p>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="lc-crm-map-connector-wrap" style={{ display: 'flex', alignItems: 'center' }}>
                        <div className="lc-crm-map-connector" />
                      </div>
                      <div>
                        <div
                          className="lc-crm-map-input"
                          style={{
                            margin: 0,
                            background: '#f8fafc',
                            borderColor: '#e2e8f0',
                            color: '#334155',
                            fontWeight: 600,
                            fontSize: '0.78rem',
                            lineHeight: 1.35,
                            cursor: 'default'
                          }}
                        >
                          {row.targetLabel || row.mergeKey}
                          <code style={{ display: 'block', fontSize: '0.72rem', fontWeight: 500, marginTop: '0.2rem' }}>
                            {'{{'}
                            {row.mergeKey}
                            {'}}'}
                          </code>
                        </div>
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
                        <span
                          className={`lc-crm-map-badge ${status.type === 'ok' ? 'ok' : status.type === 'warn' ? 'warn' : status.type === 'err' ? 'err' : 'muted'}`}
                        >
                          {status.type === 'ok' && <span className="material-symbols-outlined">check_circle</span>}
                          {status.type === 'warn' && <span className="material-symbols-outlined">priority_high</span>}
                          {status.type === 'err' && <span className="material-symbols-outlined">error</span>}
                          {status.label}
                        </span>
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
                    <p>기회 ↔ 문서 치환</p>
                    <span>
                      저장된 필드 구성은 매핑 화면 위쪽에서 고릅니다. 데이터 시트를 연 뒤에는 상단{' '}
                      <strong>문서 치환 항목 편집</strong>에서 키·표시 이름을 바꿀 수 있습니다(매니저 이상). 각 행에서{' '}
                      <strong>기회 필드</strong>와 <strong>고정값</strong>을 바꿀 수 있으며, 미리보기로 값이 맞는지 확인한 뒤
                      데이터 시트로 넘어가세요.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {phase === 'sheet' ? (
        <MergeDataSheetModal
          open
          onClose={() => {
            closeFieldEditor();
            sheetUrlTransitionRef.current = true;
            stripOppMergeSheetUrlParam();
            setPhase('setup');
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                sheetUrlTransitionRef.current = false;
              });
            });
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
          onMergeSheetGridPaste={({ r, c }, grid) => applyMergeGridPatch(r, c, grid)}
          onMailCellPaste={handleMergeSheetCellPaste}
          onMailCellKeyDown={handleMergeSheetCellKeyDown}
          renderMergeCell={renderMergeCell}
        />
      ) : null}

      {phase === 'sheet' && mergeFieldEditorOpen && fieldDraft ? (
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
          onClose={() => setCompanyPickOpen(false)}
          onSelect={(c) => {
            const row = companyToMergeRow(c);
            if (row) appendRowsFromCompanies([row]);
            setCompanyPickOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
