import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import '../../customer-companies/add-company-modal/add-company-modal.css';
import '../../customer-companies/customer-companies.css';
import '../../customer-companies/customer-companies-responsive.css';
import './contact-import-preview-modal.css';

import { API_BASE } from '@/config';
import CustomerCompanySearchModal from '../../customer-companies/customer-company-search-modal/customer-company-search-modal';
import { LIST_IDS, getEffectiveTemplate, getSavedTemplate } from '@/lib/list-templates';
import { listColumnValueInlineStyle } from '@/lib/list-column-cell-styles';
import { CUSTOM_FIELDS_PREFIX } from '@/lib/customer-company-search-fields';
import { cellValue, getNameInitials, COMPANY_STATUS_LABEL } from '../../customer-companies/customer-companies-list-cells';
import { normalizeBulkImportCompanyGroupKey } from '@/lib/bulk-import-company-group-key';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** add-customer-company-employees-modal.js 의 formatPhoneInput 과 동일 */
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

const LIST_ID = LIST_IDS.CUSTOMER_COMPANIES;
const COLUMN_HEADER_MAX_CHARS = 20;

const GROUP_ROW_BG = [
  'rgba(232, 240, 254, 0.55)',
  'rgba(237, 247, 237, 0.55)',
  'rgba(255, 243, 224, 0.55)',
  'rgba(252, 228, 236, 0.55)',
  'rgba(237, 231, 246, 0.55)',
  'rgba(224, 242, 241, 0.55)',
  'rgba(255, 248, 225, 0.55)',
  'rgba(227, 242, 253, 0.55)'
];

function rowAffiliationKey(row) {
  const cid = (row.customerCompanyId || '').trim();
  if (cid) return `id:${cid}`;
  const cn = (row.companyName || '').trim();
  const ad = (row.address || '').trim();
  if (!cn && !ad) return 'individual';
  return `new:${normalizeBulkImportCompanyGroupKey(cn)}@@${normalizeBulkImportCompanyGroupKey(ad)}`;
}

function truncateColumnLabel(label, max = COLUMN_HEADER_MAX_CHARS) {
  const chars = Array.from(String(label || ''));
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, max).join('')}...`;
}

function companyClipboardFromRow(row) {
  if (row.linkedCompany) {
    const lid = row.customerCompanyId || row.linkedCompany._id;
    if (lid) {
      return {
        type: 'linked',
        customerCompanyId: String(lid),
        linkedCompany: { ...row.linkedCompany },
        companyName: row.linkedCompany.name || row.companyName || '',
        address: row.linkedCompany.address != null ? String(row.linkedCompany.address) : (row.address || ''),
        representativeName: row.linkedCompany.representativeName || row.representativeName || '',
        industry: row.linkedCompany.industry || row.industry || '',
        businessNumber: row.linkedCompany.businessNumber || row.businessNumber || '',
        companyStatus: row.linkedCompany.status || row.companyStatus || 'active',
        companyCustomFields: { ...(row.linkedCompany.customFields || row.companyCustomFields || {}) }
      };
    }
  }
  return {
    type: 'new',
    companyName: row.companyName || '',
    address: row.address || '',
    representativeName: row.representativeName || '',
    industry: row.industry || '',
    businessNumber: row.businessNumber || '',
    companyStatus: row.companyStatus || 'active',
    companyCustomFields: { ...(row.companyCustomFields || {}) }
  };
}

function applyClipboardToRow(row, clip) {
  if (clip.type === 'linked') {
    const co = clip.linkedCompany;
    return {
      ...row,
      customerCompanyId: clip.customerCompanyId,
      linkedCompany: { ...co },
      companyName: co.name || row.companyName || '',
      address: co.address != null ? String(co.address) : (clip.address || row.address),
      representativeName: co.representativeName || clip.representativeName || row.representativeName || '',
      industry: co.industry || clip.industry || row.industry || '',
      businessNumber: co.businessNumber || clip.businessNumber || row.businessNumber || '',
      companyStatus: co.status || clip.companyStatus || row.companyStatus || 'active',
      companyCustomFields: { ...(clip.companyCustomFields || co.customFields || row.companyCustomFields || {}) }
    };
  }
  return {
    ...row,
    customerCompanyId: null,
    linkedCompany: null,
    companyName: clip.companyName,
    address: clip.address,
    representativeName: clip.representativeName,
    industry: clip.industry,
    businessNumber: clip.businessNumber,
    companyStatus: clip.companyStatus || row.companyStatus || 'active',
    companyCustomFields: { ...(clip.companyCustomFields || {}) }
  };
}

function toCompanyLikeRow(row) {
  if (row.linkedCompany && row.customerCompanyId) return { ...row.linkedCompany };
  const cf = row.companyCustomFields && typeof row.companyCustomFields === 'object' ? { ...row.companyCustomFields } : {};
  return {
    _id: '',
    name: row.companyName || '',
    representativeName: row.representativeName || '',
    industry: row.industry || '',
    businessNumber: row.businessNumber || '',
    address: row.address || '',
    status: row.companyStatus || 'active',
    assigneeUserIds: [],
    customFields: cf
  };
}

function normalizeIncomingRow(r) {
  return {
    ...r,
    customerCompanyId: r.customerCompanyId || null,
    linkedCompany: r.linkedCompany || null,
    companyStatus: r.companyStatus || 'active',
    companyCustomFields: r.companyCustomFields || {}
  };
}

function linkedNameSynced(row) {
  if (!row.customerCompanyId || !row.linkedCompany) return false;
  const a = String(row.companyName || '').trim();
  const b = String(row.linkedCompany.name || '').trim();
  return a === b && a.length > 0;
}

function rangeRows(a, b) {
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  if (start < 0 || end < 0) return [];
  const rows = [];
  for (let i = start; i <= end; i += 1) rows.push(i);
  return rows;
}

function normalizeSelectedRows(rows) {
  return [...new Set((rows || []).filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
}

/**
 * @param {(rows: object[]) => void} [props.onConfirm]
 */
export default function ContactImportPreviewModal({ open, items, bulkSaving, fixedCompany, onClose, onConfirm }) {
  const [draft, setDraft] = useState([]);
  const [template, setTemplate] = useState(() => getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), []));
  const [companyEmployees, setCompanyEmployees] = useState([]);
  const [companyEmployeesLoaded, setCompanyEmployeesLoaded] = useState(false);
  const [companySearchRow, setCompanySearchRow] = useState(null);
  /** 같은 소속 행 묶음 호버 — `rowAffiliationKey` 원문과 비교 */
  const [hoveredAffiliationKey, setHoveredAffiliationKey] = useState(null);

  const [selectedNameRows, setSelectedNameRowsState] = useState([0]);
  const excelSelRef = useRef({ anchor: 0, focus: 0 });
  const selectedNameRowsRef = useRef([0]);
  const lastAnchorRef = useRef(0);
  const nameDragActiveRef = useRef(false);
  const nameDragStartRef = useRef(null);
  const nameDragModeRef = useRef('replace');
  const nameDragBaseRowsRef = useRef([]);
  const dragMovedRef = useRef(false);
  const mouseDownPosRef = useRef({ x: 0, y: 0 });

  const clipboardRef = useRef(null);
  const draftRef = useRef([]);
  const panelRef = useRef(null);

  const assigneeIdToName = useMemo(() => {
    const map = {};
    (companyEmployees || []).forEach((e) => {
      const id = e.id != null ? String(e.id) : (e._id ? String(e._id) : null);
      if (id) map[id] = e.name || e.email || id;
    });
    return map;
  }, [companyEmployees]);

  const setSelectedNameRows = useCallback((rows) => {
    const next = normalizeSelectedRows(rows);
    selectedNameRowsRef.current = next;
    setSelectedNameRowsState(next);
  }, []);

  const setSel = useCallback((anchor, focus) => {
    excelSelRef.current = { anchor, focus };
    setSelectedNameRows(rangeRows(anchor, focus));
  }, [setSelectedNameRows]);

  const loadCustomFieldColumns = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=customerCompany`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      const defs = Array.isArray(data?.items) ? data.items : [];
      const extra = defs.map((d) => ({ key: `${CUSTOM_FIELDS_PREFIX}${d.key}`, label: d.label || d.key || '' }));
      setTemplate(getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), extra));
    } catch {
      setTemplate(getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), []));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadCustomFieldColumns();
  }, [open, loadCustomFieldColumns]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCompanyEmployeesLoaded(false);
    fetch(`${API_BASE}/companies/overview`, { headers: getAuthHeader() })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.employees)) setCompanyEmployees(data.employees);
      })
      .catch(() => {
        if (!cancelled) setCompanyEmployees([]);
      })
      .finally(() => {
        if (!cancelled) setCompanyEmployeesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!open) return;
    setDraft((items || []).map((r) => normalizeIncomingRow({ ...r })));
    clipboardRef.current = null;
    setCompanySearchRow(null);
    setHoveredAffiliationKey(null);
    setSel(0, 0);
    lastAnchorRef.current = 0;
  }, [open, items, setSel]);

  const displayColumns = useMemo(
    () => template.columns.filter((c) => template.visible[c.key] && c.key !== '_favorite'),
    [template]
  );

  const headerStats = useMemo(() => {
    const total = draft.length;
    const newKeys = new Set();
    for (const row of draft) {
      if (row.customerCompanyId) continue;
      const cn = (row.companyName || '').trim();
      const ad = (row.address || '').trim();
      if (!cn && !ad) continue;
      newKeys.add(rowAffiliationKey(row));
    }
    return { total, newCompanyCount: newKeys.size };
  }, [draft]);

  /** 같은 소속(고객사 id 또는 신규 묶음 키)은 떨어져 있어도 같은 색으로 표시 */
  const rowBackgrounds = useMemo(() => {
    const out = [];
    const colorByAff = new Map();
    let prevColor = null;
    let band = -1;
    for (let i = 0; i < draft.length; i += 1) {
      const aff = rowAffiliationKey(draft[i]);
      if (aff === 'individual') {
        out.push(undefined);
        prevColor = null;
        continue;
      }
      if (!colorByAff.has(aff)) {
        let nextColor = GROUP_ROW_BG[(band + 1) % GROUP_ROW_BG.length];
        if (nextColor === prevColor && GROUP_ROW_BG.length > 1) {
          band += 1;
          nextColor = GROUP_ROW_BG[(band + 1) % GROUP_ROW_BG.length];
        }
        band += 1;
        colorByAff.set(aff, nextColor);
      }
      const color = colorByAff.get(aff);
      out.push(color);
      prevColor = color;
    }
    return out;
  }, [draft]);

  const affiliationAttr = useCallback((aff) => (aff === 'individual' ? '' : encodeURIComponent(aff)), []);

  const handleAffRowMouseEnter = useCallback((aff) => {
    if (aff !== 'individual') setHoveredAffiliationKey(aff);
  }, []);

  const handleAffRowMouseLeave = useCallback(
    (e, aff) => {
      if (aff === 'individual') return;
      const rt = e.relatedTarget;
      const trLeft = e.currentTarget;
      if (rt instanceof Element) {
        const tbody = trLeft.parentElement;
        if (tbody?.contains(rt)) {
          const nextRow = rt.closest('tr.contact-import-preview-body-row');
          if (nextRow && nextRow === trLeft) return;
          const enc = affiliationAttr(aff);
          if (nextRow && nextRow !== trLeft && nextRow.getAttribute('data-cip-affiliation') === enc) return;
        }
      }
      setHoveredAffiliationKey(null);
    },
    [affiliationAttr]
  );

  const patchCompanyField = useCallback((rowIdx, colKey, value) => {
    setDraft((prev) =>
      prev.map((row, i) => {
        if (i !== rowIdx) return row;
        const v = value != null ? String(value) : '';

        if (colKey === 'name') {
          if (fixedCompany) return row;
          const trimmed = v.trim();
          const linkedNm = (row.linkedCompany?.name || '').trim();
          if (row.linkedCompany && linkedNm) {
            if (trimmed === linkedNm) {
              const lid = row.linkedCompany._id != null ? String(row.linkedCompany._id) : '';
              return {
                ...row,
                companyName: v,
                customerCompanyId: lid || row.customerCompanyId || null
              };
            }
            return { ...row, companyName: v, customerCompanyId: null };
          }
          return { ...row, companyName: v };
        }

        if (row.customerCompanyId && !fixedCompany) return row;

        if (colKey === 'address') return { ...row, address: v };
        if (colKey === 'representativeName') return { ...row, representativeName: v };
        if (colKey === 'industry') return { ...row, industry: v };
        if (colKey === 'businessNumber') return { ...row, businessNumber: v.replace(/\D/g, '') };
        if (colKey === 'status') return { ...row, companyStatus: v };
        if (colKey.startsWith(CUSTOM_FIELDS_PREFIX)) {
          const fk = colKey.slice(CUSTOM_FIELDS_PREFIX.length);
          return {
            ...row,
            companyCustomFields: { ...(row.companyCustomFields || {}), [fk]: v }
          };
        }
        return row;
      })
    );
  }, [fixedCompany]);

  const patchContactField = useCallback((rowIdx, field, value) => {
    if (bulkSaving) return;
    const v = value != null ? String(value) : '';
    if (!['name', 'email', 'phone', 'position'].includes(field)) return;
    setDraft((prev) =>
      prev.map((row, i) => {
        if (i !== rowIdx) return row;
        if (field === 'phone') return { ...row, phone: formatPhoneInput(v) };
        return { ...row, [field]: v };
      })
    );
  }, [bulkSaving]);

  const applyPasteToRange = useCallback((clip) => {
    if (!clip || fixedCompany) return false;
    const selectedRows = selectedNameRowsRef.current;
    if (!selectedRows.length) return false;
    const prev = draftRef.current;
    const next = [...prev];
    let touched = 0;
    for (const i of selectedRows) {
      if (!next[i]) continue;
      next[i] = applyClipboardToRow(next[i], clip);
      touched += 1;
    }
    if (touched === 0) return false;
    draftRef.current = next;
    setDraft(next);
    return true;
  }, [fixedCompany]);

  const applyCompanyClipboardToSelection = useCallback(() => {
    const selectedRows = selectedNameRowsRef.current;
    const clip = clipboardRef.current;
    if (!clip || !selectedRows.length) return false;
    const end = selectedRows[selectedRows.length - 1];
    const applied = applyPasteToRange(clip);
    if (applied) {
      setSel(-1, -1);
      if (end >= 0) lastAnchorRef.current = end;
    }
    return applied;
  }, [applyPasteToRange, setSel]);

  useEffect(() => {
    if (!open) return;

    const endNameDrag = () => {
      if (!nameDragActiveRef.current) return;
      nameDragActiveRef.current = false;
      nameDragStartRef.current = null;
      const moved = dragMovedRef.current;
      dragMovedRef.current = false;
      if (!moved) {
        const { anchor: aa, focus: bb } = excelSelRef.current;
        const a = Math.min(aa, bb);
        const b = Math.max(aa, bb);
        if (a >= 0 && a === b) {
          const el = panelRef.current?.querySelector(`input[data-cip-name-row="${a}"]`);
          if (el && typeof el.focus === 'function') {
            setTimeout(() => el.focus(), 0);
          }
        }
      }
    };

    const onMove = (e) => {
      if (!nameDragActiveRef.current || nameDragStartRef.current === null) return;
      const dx = e.clientX - mouseDownPosRef.current.x;
      const dy = e.clientY - mouseDownPosRef.current.y;
      if (dx * dx + dy * dy > 16) dragMovedRef.current = true;

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cell = el?.closest?.('[data-cip-name-row-cell]');
      if (!cell || !panelRef.current?.contains(cell)) return;
      const nextIdx = Number(cell.getAttribute('data-cip-name-row-cell'));
      if (!Number.isInteger(nextIdx) || nextIdx < 0) return;

      const rows = rangeRows(nameDragStartRef.current, nextIdx);
      excelSelRef.current = { anchor: nameDragStartRef.current, focus: nextIdx };
      if (nameDragModeRef.current === 'add') {
        setSelectedNameRows([...nameDragBaseRowsRef.current, ...rows]);
        return;
      }
      setSelectedNameRows(rows);
    };

    document.addEventListener('mouseup', endNameDrag);
    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mouseup', endNameDrag);
      document.removeEventListener('mousemove', onMove);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      const panel = panelRef.current;
      if (!panel) return;
      const ae = document.activeElement;
      if (!(e.ctrlKey || e.metaKey)) return;

      if (e.key === 'c' || e.key === 'C') {
        const selectedRows = selectedNameRowsRef.current;
        if (!selectedRows.length && !panel.contains(e.target) && !panel.contains(ae)) return;
        if (ae && panel.contains(ae) && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
          const hasSel =
            typeof ae.selectionStart === 'number' &&
            typeof ae.selectionEnd === 'number' &&
            ae.selectionEnd > ae.selectionStart;
          if (hasSel) return;
        }
        const src = selectedRows.length ? selectedRows[0] : -1;
        const row = draftRef.current[src];
        if (!row || src < 0) {
          if (ae && ae.classList?.contains('cip-name-field-input')) {
            e.preventDefault();
            const full = String(ae.value ?? '');
            if (full && navigator.clipboard?.writeText) void navigator.clipboard.writeText(full);
          }
          return;
        }
        e.preventDefault();
        clipboardRef.current = companyClipboardFromRow(row);
        return;
      }

      if (e.key === 'v' || e.key === 'V') {
        if (clipboardRef.current && selectedNameRowsRef.current.length > 0) {
          e.preventDefault();
          applyCompanyClipboardToSelection();
          return;
        }
        if (!panel.contains(e.target) && !panel.contains(ae)) return;
      }
    };

    const onPaste = (e) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (!clipboardRef.current || !selectedNameRowsRef.current.length) return;
      const ae = document.activeElement;
      if (!panel.contains(e.target) && !panel.contains(ae)) return;
      e.preventDefault();
      e.stopPropagation();
      applyCompanyClipboardToSelection();
    };

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('paste', onPaste, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('paste', onPaste, true);
    };
  }, [open, applyCompanyClipboardToSelection]);

  const handleConfirmClick = () => {
    onConfirm?.(draft);
  };

  const handleNameCellMouseDown = (e, idx) => {
    if (e.button !== 0 || fixedCompany || bulkSaving) return;
    if (e.target.closest('.cip-name-search-btn')) return;
    const modifiedSelection = !!(e.ctrlKey || e.metaKey || e.shiftKey);
    dragMovedRef.current = false;
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    const additive = !!(e.ctrlKey || e.metaKey);

    if (e.shiftKey) {
      const rows = rangeRows(lastAnchorRef.current, idx);
      if (additive) {
        setSelectedNameRows([...selectedNameRowsRef.current, ...rows]);
        excelSelRef.current = { anchor: lastAnchorRef.current, focus: idx };
      } else {
        setSel(lastAnchorRef.current, idx);
      }
      return;
    }

    lastAnchorRef.current = idx;
    nameDragStartRef.current = idx;
    nameDragActiveRef.current = true;
    nameDragModeRef.current = additive ? 'add' : 'replace';
    nameDragBaseRowsRef.current = additive ? selectedNameRowsRef.current : [];
    if (additive) {
      excelSelRef.current = { anchor: idx, focus: idx };
      setSelectedNameRows([...nameDragBaseRowsRef.current, idx]);
    } else {
      setSel(idx, idx);
    }
    e.preventDefault();
  };

  const handleNameCellMouseEnter = (idx) => {
    if (!nameDragActiveRef.current || nameDragStartRef.current === null) return;
    const rows = rangeRows(nameDragStartRef.current, idx);
    excelSelRef.current = { anchor: nameDragStartRef.current, focus: idx };
    if (nameDragModeRef.current === 'add') {
      setSelectedNameRows([...nameDragBaseRowsRef.current, ...rows]);
      return;
    }
    setSelectedNameRows(rows);
  };

  const renderCompanyCell = (row, rowIdx, col, companyLike) => {
    const valStyle = listColumnValueInlineStyle(template.columnCellStyles, col.key);
    const locked = !!fixedCompany || (!!row.customerCompanyId && col.key !== 'name');

    if (col.key === 'name') {
      const synced = linkedNameSynced(row);
      const linkedLocked = !!row.customerCompanyId && !!row.linkedCompany;
      const selected = selectedNameRows.includes(rowIdx);
      const showMini = !!row.linkedCompany;
      const miniLabel = row.linkedCompany?.name || row.companyName || '';
      const inp = (
        <div className={`cip-name-field-shell ${synced ? 'cip-name-field-shell--linked-sync' : ''}`}>
          {showMini ? (
            <div className={`cip-name-avatar-mini cip-name-avatar-mini--${rowIdx % 3}`} aria-hidden title={miniLabel}>
              <span className="cip-name-avatar-mini-initials">{getNameInitials(miniLabel)}</span>
            </div>
          ) : null}
          <input
            type="text"
            data-cip-name-row={rowIdx}
            className="cip-name-field-input"
            value={row.companyName ?? ''}
            onChange={(e) => patchCompanyField(rowIdx, 'name', e.target.value)}
            placeholder="고객사명"
            disabled={!!fixedCompany || linkedLocked}
          />
          {!fixedCompany ? (
            <button
              type="button"
              className={`cip-name-search-btn ${linkedLocked ? 'cip-name-search-btn--unlink' : ''}`}
              aria-label={linkedLocked ? '고객사 연결 해제' : '고객사 찾기'}
              title={linkedLocked ? '고객사 연결 해제' : '고객사 찾기'}
              disabled={bulkSaving}
              onClick={(e) => {
                e.stopPropagation();
                if (linkedLocked) {
                  setDraft((prev) =>
                    prev.map((r, i) =>
                      i === rowIdx
                        ? {
                            ...r,
                            customerCompanyId: null,
                            linkedCompany: null
                          }
                        : r
                    )
                  );
                  return;
                }
                setCompanySearchRow(rowIdx);
              }}
            >
              <span className="material-symbols-outlined" aria-hidden>
                {linkedLocked ? 'close' : 'search'}
              </span>
            </button>
          ) : null}
        </div>
      );
      const wrap = (
        <td
          key={col.key}
          className={`cip-td-company cip-td-excel-name ${selected ? 'cip-name-cell--selected' : ''}`}
          data-cip-company-col={col.key}
          data-cip-name-row-cell={rowIdx}
          onMouseDown={(e) => handleNameCellMouseDown(e, rowIdx)}
          onMouseEnter={() => handleNameCellMouseEnter(rowIdx)}
        >
          {valStyle ? <span className="list-col-value-style" style={valStyle}>{inp}</span> : inp}
        </td>
      );
      return wrap;
    }

    if (col.key === 'status') {
      const content = locked ? (
        <span className={`status-badge status-${(companyLike.status || 'active').toLowerCase()}`}>
          {COMPANY_STATUS_LABEL[(companyLike.status || 'active').toLowerCase()] || companyLike.status || '—'}
        </span>
      ) : (
        <select
          className="add-contact-import-company-input add-contact-import-company-input--in-table"
          value={(row.companyStatus || companyLike.status || 'active').toLowerCase()}
          onChange={(e) => patchCompanyField(rowIdx, 'status', e.target.value)}
        >
          <option value="active">활성</option>
          <option value="inactive">비활성</option>
          <option value="lead">리드</option>
        </select>
      );
      return (
        <td key={col.key} className="cip-td-company text-muted" data-cip-company-col={col.key}>
          {valStyle ? <span className="list-col-value-style" style={valStyle}>{content}</span> : content}
        </td>
      );
    }

    if (!locked && ['address', 'representativeName', 'industry', 'businessNumber'].includes(col.key)) {
      const raw =
        col.key === 'address'
          ? row.address
          : col.key === 'representativeName'
            ? row.representativeName
            : col.key === 'industry'
              ? row.industry
              : row.businessNumber;
      const inp = (
        <input
          type="text"
          className="add-contact-import-company-input add-contact-import-company-input--in-table"
          value={raw ?? ''}
          onChange={(e) => patchCompanyField(rowIdx, col.key, e.target.value)}
        />
      );
      return (
        <td key={col.key} className="cip-td-company text-muted" data-cip-company-col={col.key}>
          {valStyle ? <span className="list-col-value-style" style={valStyle}>{inp}</span> : inp}
        </td>
      );
    }

    if (!locked && col.key.startsWith(CUSTOM_FIELDS_PREFIX)) {
      const fk = col.key.slice(CUSTOM_FIELDS_PREFIX.length);
      const raw = row.companyCustomFields?.[fk] ?? '';
      const inp = (
        <input
          type="text"
          className="add-contact-import-company-input add-contact-import-company-input--in-table"
          value={raw}
          onChange={(e) => patchCompanyField(rowIdx, col.key, e.target.value)}
        />
      );
      return (
        <td key={col.key} className="cip-td-company text-muted" data-cip-company-col={col.key}>
          {valStyle ? <span className="list-col-value-style" style={valStyle}>{inp}</span> : inp}
        </td>
      );
    }

    const text = cellValue(companyLike, col.key, assigneeIdToName, companyEmployeesLoaded);
    const content = <span className={col.key === 'name' ? '' : 'text-muted'}>{text}</span>;
    return (
      <td key={col.key} className="cip-td-company text-muted" data-cip-company-col={col.key}>
        {valStyle ? <span className="list-col-value-style" style={valStyle}>{content}</span> : content}
      </td>
    );
  };

  if (!open) return null;

  return (
    <div
      className="add-company-import-preview-overlay contact-import-preview-overlay"
      onClick={() => !bulkSaving && onClose?.()}
      role="dialog"
      aria-modal="true"
      aria-label="연락처 등록 예정"
    >
      <div
        ref={panelRef}
        className="add-company-import-preview-panel add-contact-import-preview-panel contact-import-preview-panel"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <header className="contact-import-preview-header">
          <h3 className="add-company-section-title contact-import-preview-title">연락처 등록 예정</h3>
          <p className="contact-import-preview-header-stats">
            <span>
              <strong>{headerStats.total}</strong>명 등록 예정
            </span>
            <span className="contact-import-preview-header-sep">·</span>
            <span>
              신규 고객사(배치 내 신규 묶음) <strong>{headerStats.newCompanyCount}</strong>개
            </span>
          </p>
        </header>

        <div className="contact-import-preview-scroll">
          <div className="contact-import-preview-table-outer">
            <table className="data-table contact-import-preview-main-table">
              <colgroup>
                <col style={{ width: '2.5rem' }} />
                <col style={{ width: '7rem' }} />
                <col style={{ width: '9rem' }} />
                <col style={{ width: '10rem' }} />
                <col style={{ width: '6rem' }} />
                {displayColumns.map((col) => (
                  <col key={col.key} className="cip-col-company" />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="cip-th-index">#</th>
                  <th>이름</th>
                  <th>이메일</th>
                  <th>전화</th>
                  <th>직책</th>
                  {displayColumns.map((col) => (
                    <th key={col.key} className="list-template-th-sortable cip-th-company" title={col.label}>
                      <span className="list-template-th-content">{truncateColumnLabel(col.label)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draft.map((row, idx) => {
                  const bg = rowBackgrounds[idx];
                  const aff = rowAffiliationKey(row);
                  const affHover = aff !== 'individual' && hoveredAffiliationKey === aff;
                  const companyLike = toCompanyLikeRow(row);
                  return (
                    <tr
                      key={idx}
                      className={`contact-import-preview-body-row${affHover ? ' contact-import-preview-body-row--aff-hover' : ''}`}
                      style={bg ? { background: bg } : undefined}
                      data-cip-affiliation={affiliationAttr(aff)}
                      onMouseEnter={() => handleAffRowMouseEnter(aff)}
                      onMouseLeave={(e) => handleAffRowMouseLeave(e, aff)}
                    >
                      <td className="cip-td-index text-muted">{idx + 1}</td>
                      <td className="cip-td-contact">
                        <input
                          type="text"
                          className="add-contact-import-company-input add-contact-import-company-input--in-table cip-contact-field-input"
                          value={row.name ?? ''}
                          onChange={(e) => patchContactField(idx, 'name', e.target.value)}
                          placeholder="이름"
                          disabled={bulkSaving}
                          aria-label={`${idx + 1}행 이름`}
                        />
                      </td>
                      <td className="cip-td-contact">
                        <input
                          type="email"
                          className="add-contact-import-company-input add-contact-import-company-input--in-table cip-contact-field-input"
                          value={row.email ?? ''}
                          onChange={(e) => patchContactField(idx, 'email', e.target.value)}
                          placeholder="이메일"
                          disabled={bulkSaving}
                          autoComplete="off"
                          aria-label={`${idx + 1}행 이메일`}
                        />
                      </td>
                      <td className="cip-td-contact">
                        <input
                          type="tel"
                          inputMode="numeric"
                          className="add-contact-import-company-input add-contact-import-company-input--in-table cip-contact-field-input"
                          value={row.phone ?? ''}
                          onChange={(e) => patchContactField(idx, 'phone', e.target.value)}
                          placeholder="전화"
                          disabled={bulkSaving}
                          aria-label={`${idx + 1}행 전화`}
                        />
                      </td>
                      <td className="cip-td-contact">
                        <input
                          type="text"
                          className="add-contact-import-company-input add-contact-import-company-input--in-table cip-contact-field-input"
                          value={row.position ?? ''}
                          onChange={(e) => patchContactField(idx, 'position', e.target.value)}
                          placeholder="직책"
                          disabled={bulkSaving}
                          aria-label={`${idx + 1}행 직책`}
                        />
                      </td>
                      {displayColumns.map((col) => renderCompanyCell(row, idx, col, companyLike))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="contact-import-preview-footer">
          <div className="add-company-import-preview-actions contact-import-preview-footer-actions">
            <button
              type="button"
              className="add-company-btn-cancel add-contact-import-btn-outline"
              disabled={bulkSaving}
              onClick={() => onClose?.()}
            >
              취소
            </button>
            <button
              type="button"
              className="btn-primary add-contact-import-btn-confirm"
              disabled={bulkSaving}
              onClick={handleConfirmClick}
            >
              <span className="material-symbols-outlined" aria-hidden>
                {bulkSaving ? 'hourglass_empty' : 'check_circle'}
              </span>
              {bulkSaving ? '등록 중…' : '확인 후 등록'}
            </button>
          </div>
        </footer>
      </div>

      {companySearchRow != null && (
        <CustomerCompanySearchModal
          onClose={() => setCompanySearchRow(null)}
          onSelect={(company) => {
            setDraft((prev) =>
              prev.map((r, i) =>
                i === companySearchRow
                  ? {
                      ...r,
                      customerCompanyId: String(company._id),
                      linkedCompany: company,
                      companyName: company.name || '',
                      address: company.address != null ? String(company.address) : r.address
                    }
                  : r
              )
            );
            setCompanySearchRow(null);
          }}
        />
      )}
    </div>
  );
}
