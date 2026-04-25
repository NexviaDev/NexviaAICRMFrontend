import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { API_BASE } from '@/config';
import ListPaginationButtons from '@/components/list-pagination-buttons/list-pagination-buttons';
import { CUSTOM_FIELDS_PREFIX, BASE_SEARCH_FIELD_OPTIONS } from '@/lib/customer-company-search-fields';
import './map-company-picker-modal.css';

const PAGE_SIZE = 20;
const DISPLAY_FIELDS_STORAGE_KEY = 'mapCompanyPickerVisibleFields:v1';
const INFLOW_FIELD_KEY = '__inflow';
const DEFAULT_DISPLAY_FIELDS = ['name', 'representativeName', 'address', 'industry', INFLOW_FIELD_KEY];

const COMPANY_STATUS_LABEL = { active: '활성', inactive: '비활성', lead: '리드' };

function formatBusinessNumber(num) {
  if (!num) return '';
  const s = String(num).replace(/\D/g, '');
  if (s.length <= 3) return s;
  if (s.length <= 5) return `${s.slice(0, 3)}-${s.slice(3)}`;
  return `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5, 10)}`;
}

function fieldValueForSearch(row, key, assigneeIdToName, assigneeNamesReady) {
  if (key === 'name') return row.name || '';
  if (key === 'representativeName') return row.representativeName || '';
  if (key === 'industry') return row.industry || '';
  if (key === 'businessNumber') return formatBusinessNumber(row.businessNumber) + String(row.businessNumber || '');
  if (key === 'address') return row.address || '';
  if (key === 'status') {
    const st = (row.status || 'active').toLowerCase();
    return `${COMPANY_STATUS_LABEL[st] || row.status || ''} ${row.status || ''}`;
  }
  if (key === 'assigneeUserIds') {
    const ids = Array.isArray(row.assigneeUserIds) ? row.assigneeUserIds : [];
    const names = ids.map((id) => assigneeIdToName[String(id)] || '').filter(Boolean);
    if (names.length) return names.join(' ');
    if (ids.length === 0) return '';
    return assigneeNamesReady ? '' : ids.join(' ');
  }
  if (key === 'memo') return row.memo || '';
  if (key === 'code') return row.code || '';
  if (key.startsWith(CUSTOM_FIELDS_PREFIX)) {
    const fieldKey = key.slice(CUSTOM_FIELDS_PREFIX.length);
    const v = row.customFields?.[fieldKey];
    return v !== undefined && v !== null ? String(v) : '';
  }
  return '';
}

function companyMatchesPickerSearch(c, searchApplied, searchField, assigneeIdToName, assigneeNamesReady) {
  const q = String(searchApplied || '').trim().toLowerCase();
  if (!q) return true;
  if (!searchField) {
    const parts = [
      c.name,
      c.representativeName,
      c.address,
      c.industry,
      c.memo,
      c.code,
      c.businessNumber,
      c.status,
      ...(typeof c.customFields === 'object' && c.customFields ? Object.values(c.customFields).map(String) : [])
    ].map((x) => String(x || '').toLowerCase());
    const ids = Array.isArray(c.assigneeUserIds) ? c.assigneeUserIds : [];
    const names = ids.map((id) => String(assigneeIdToName[String(id)] || '').toLowerCase()).join(' ');
    return parts.some((p) => p.includes(q)) || names.includes(q);
  }
  const hay = fieldValueForSearch(c, searchField, assigneeIdToName, assigneeNamesReady).toLowerCase();
  return hay.includes(q);
}

function useInflowFieldKey(customFieldColumns) {
  return useMemo(() => {
    for (const col of customFieldColumns || []) {
      const lab = String(col.label || '').toLowerCase();
      const k = String(col.key || '').replace(CUSTOM_FIELDS_PREFIX, '').toLowerCase();
      if (
        lab.includes('유입') ||
        lab.includes('경로') ||
        lab.includes('채널') ||
        k.includes('lead') ||
        k.includes('source') ||
        k.includes('channel') ||
        k.includes('유입') ||
        k.includes('inflow')
      ) {
        return col.key.replace(CUSTOM_FIELDS_PREFIX, '');
      }
    }
    return null;
  }, [customFieldColumns]);
}

function heuristicInflowKeyForRow(customFields) {
  if (!customFields || typeof customFields !== 'object') return null;
  for (const key of Object.keys(customFields)) {
    const kl = key.toLowerCase();
    if (
      kl.includes('lead') ||
      kl.includes('source') ||
      kl.includes('channel') ||
      kl.includes('유입') ||
      kl.includes('inflow') ||
      kl.includes('경로')
    ) {
      return key;
    }
  }
  return null;
}

function inflowDisplay(c, defKey) {
  const hKey = defKey || heuristicInflowKeyForRow(c.customFields);
  if (!hKey) return '—';
  const v = c.customFields?.[hKey];
  return v != null && String(v).trim() !== '' ? String(v) : '—';
}

function locationDisplay(c) {
  const a = (c.address && String(c.address).trim()) || '';
  if (a) return a;
  if (c.latitude != null && c.longitude != null) {
    return `${Number(c.latitude).toFixed(4)}, ${Number(c.longitude).toFixed(4)}`;
  }
  return '—';
}

function loadSavedDisplayFields() {
  if (typeof window === 'undefined') return DEFAULT_DISPLAY_FIELDS;
  try {
    const raw = window.localStorage.getItem(DISPLAY_FIELDS_STORAGE_KEY);
    if (!raw) return DEFAULT_DISPLAY_FIELDS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_DISPLAY_FIELDS;
    return parsed.map(String).filter(Boolean);
  } catch {
    return DEFAULT_DISPLAY_FIELDS;
  }
}

/**
 * 지도: 좌표 있는 고객사만 표시할 업체를 고르는 바텀/모달 시트
 * @param {{ open: boolean, companies: object[], initialSelectedIds: Set<string>|null, getAuthHeader: () => Record<string,string>, onClose: () => void, onConfirm: (ids: Set<string>) => void }} props
 */
export default function MapCompanyPickerModal({
  open,
  companies,
  initialSelectedIds,
  getAuthHeader,
  onClose,
  onConfirm
}) {
  const [checkedIds, setCheckedIds] = useState(() => new Set());
  const [searchInput, setSearchInput] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [searchField, setSearchField] = useState('');
  const [page, setPage] = useState(1);
  const [customFieldColumns, setCustomFieldColumns] = useState([]);
  const [assigneeIdToName, setAssigneeIdToName] = useState({});
  const [assigneeNamesReady, setAssigneeNamesReady] = useState(false);
  const [displayFields, setDisplayFields] = useState(() => loadSavedDisplayFields());
  const [fieldPickerOpen, setFieldPickerOpen] = useState(false);
  const lastGlobalIndexRef = useRef(null);
  const inflowDefKey = useInflowFieldKey(customFieldColumns);

  const searchFieldLabelByKey = useMemo(() => {
    const map = {};
    BASE_SEARCH_FIELD_OPTIONS.forEach((o) => {
      map[o.key] = o.label;
    });
    (customFieldColumns || []).forEach((c) => {
      if (!c?.key) return;
      map[c.key] = c.label || c.key.replace(CUSTOM_FIELDS_PREFIX, '');
    });
    return map;
  }, [customFieldColumns]);

  useEffect(() => {
    if (!searchField) return;
    const valid = new Set(BASE_SEARCH_FIELD_OPTIONS.map((o) => o.key));
    (customFieldColumns || []).forEach((c) => {
      if (c?.key) valid.add(c.key);
    });
    if (!valid.has(searchField)) setSearchField('');
  }, [searchField, customFieldColumns]);

  const displayFieldOptions = useMemo(() => {
    const base = BASE_SEARCH_FIELD_OPTIONS.map((o) => ({ key: o.key, label: o.label }));
    const custom = (customFieldColumns || []).map((c) => ({
      key: c.key,
      label: c.label || c.key.replace(CUSTOM_FIELDS_PREFIX, '')
    }));
    return [
      ...base,
      ...custom,
      { key: INFLOW_FIELD_KEY, label: '유입 경로' }
    ];
  }, [customFieldColumns]);

  const displayLabelByKey = useMemo(() => {
    const map = {};
    displayFieldOptions.forEach((f) => {
      map[f.key] = f.label;
    });
    return map;
  }, [displayFieldOptions]);

  useEffect(() => {
    const valid = new Set(displayFieldOptions.map((f) => f.key));
    setDisplayFields((prev) => {
      const kept = (prev || []).filter((k) => valid.has(k));
      if (kept.length > 0) return kept;
      return DEFAULT_DISPLAY_FIELDS.filter((k) => valid.has(k));
    });
  }, [displayFieldOptions]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(DISPLAY_FIELDS_STORAGE_KEY, JSON.stringify(displayFields));
    } catch {
      /* ignore */
    }
  }, [displayFields]);

  useEffect(() => {
    if (!open) return;
    setAssigneeNamesReady(false);
    setCheckedIds(
      new Set(
        initialSelectedIds && initialSelectedIds.size > 0 ? [...initialSelectedIds].map(String) : []
      )
    );
    setSearchInput('');
    setSearchApplied('');
    setSearchField('');
    setPage(1);
    lastGlobalIndexRef.current = null;

    let cancelled = false;
    (async () => {
      try {
        const [defsRes, ovRes] = await Promise.all([
          fetch(`${API_BASE}/custom-field-definitions?entityType=customerCompany`, { headers: getAuthHeader() }),
          fetch(`${API_BASE}/companies/overview`, { headers: getAuthHeader() })
        ]);
        const defsData = await defsRes.json().catch(() => ({}));
        const ovData = await ovRes.json().catch(() => ({}));
        if (cancelled) return;
        const items = Array.isArray(defsData?.items) ? defsData.items : [];
        setCustomFieldColumns(items.map((d) => ({ key: `${CUSTOM_FIELDS_PREFIX}${d.key}`, label: d.label || d.key || '' })));
        const emap = {};
        if (Array.isArray(ovData?.employees)) {
          ovData.employees.forEach((e) => {
            /** GET /companies/overview 는 직원에 `id` 를 내보내고 `_id` 는 없을 수 있음 (customer-companies.js 와 동일) */
            const id = e?.id != null ? String(e.id) : e?._id != null ? String(e._id) : '';
            if (!id) return;
            emap[id] = (e.name && String(e.name).trim()) || (e.email && String(e.email).trim()) || id;
          });
        }
        setAssigneeIdToName(emap);
      } catch {
        if (!cancelled) {
          setCustomFieldColumns([]);
          setAssigneeIdToName({});
        }
      } finally {
        if (!cancelled) setAssigneeNamesReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // initialSelectedIds: 모달이 열릴 때(open=true) 부모가 넘긴 스냅샷만 사용 — 열린 채로 부모 Set 참조가 바뀌어도 목록·선택을 덮어쓰지 않음
  }, [open, getAuthHeader]);

  const filtered = useMemo(
    () =>
      (companies || []).filter((c) =>
        companyMatchesPickerSearch(c, searchApplied, searchField, assigneeIdToName, assigneeNamesReady)
      ),
    [companies, searchApplied, searchField, assigneeIdToName, assigneeNamesReady]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const runSearch = useCallback((e) => {
    e?.preventDefault();
    setSearchApplied(searchInput.trim());
    setPage(1);
    lastGlobalIndexRef.current = null;
  }, [searchInput]);

  const toggleOne = useCallback((id) => {
    const sid = String(id);
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  }, []);

  const applyRangeSelection = useCallback((from, to) => {
    const a = Math.min(from, to);
    const b = Math.max(from, to);
    setCheckedIds((prev) => {
      const next = new Set(prev);
      for (let i = a; i <= b; i++) {
        const row = filtered[i];
        if (row?._id) next.add(String(row._id));
      }
      return next;
    });
  }, [filtered]);

  const handleRowInteraction = useCallback(
    (companyId, globalIndex, shiftKey) => {
      if (shiftKey && lastGlobalIndexRef.current != null) {
        applyRangeSelection(lastGlobalIndexRef.current, globalIndex);
      } else {
        toggleOne(companyId);
      }
      lastGlobalIndexRef.current = globalIndex;
    },
    [applyRangeSelection, toggleOne]
  );

  const selectAllFiltered = useCallback(() => {
    setCheckedIds(new Set(filtered.map((c) => String(c._id))));
  }, [filtered]);

  const clearSelection = useCallback(() => {
    setCheckedIds(new Set());
    lastGlobalIndexRef.current = null;
  }, []);

  const toggleDisplayField = useCallback((key) => {
    setDisplayFields((prev) => {
      const has = prev.includes(key);
      if (has) {
        const next = prev.filter((k) => k !== key);
        return next.length > 0 ? next : prev;
      }
      return [...prev, key];
    });
  }, []);

  const displayCellValue = useCallback((row, key) => {
    if (key === INFLOW_FIELD_KEY) return inflowDisplay(row, inflowDefKey);
    if (key === 'name') return row.name || '(이름 없음)';
    if (key === 'address') return locationDisplay(row);
    if (key === 'businessNumber') return formatBusinessNumber(row.businessNumber) || '—';
    if (key === 'status') {
      const st = (row.status || 'active').toLowerCase();
      return COMPANY_STATUS_LABEL[st] || row.status || '—';
    }
    if (key === 'assigneeUserIds') {
      const raw = row.assigneeUserIds;
      if (!Array.isArray(raw) || raw.length === 0) return '—';
      const parts = raw.map((item) => {
        if (item != null && typeof item === 'object' && !Array.isArray(item)) {
          if (item.name && String(item.name).trim()) return String(item.name).trim();
          if (item.email && String(item.email).trim()) return String(item.email).trim();
          const oid = item._id != null ? String(item._id) : null;
          return oid && assigneeIdToName[oid] ? assigneeIdToName[oid] : '';
        }
        const sid = String(item);
        return assigneeIdToName[sid] || '';
      }).filter(Boolean);
      if (parts.length) return parts.join(', ');
      return assigneeNamesReady ? '—' : '불러오는 중...';
    }
    if (key.startsWith(CUSTOM_FIELDS_PREFIX)) {
      const fk = key.slice(CUSTOM_FIELDS_PREFIX.length);
      const v = row.customFields?.[fk];
      return v != null && String(v).trim() !== '' ? String(v) : '—';
    }
    const v = row?.[key];
    return v != null && String(v).trim() !== '' ? String(v) : '—';
  }, [assigneeIdToName, assigneeNamesReady, inflowDefKey]);

  const handleConfirm = useCallback(() => {
    onConfirm(new Set(checkedIds));
  }, [checkedIds, onConfirm]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="map-company-picker-backdrop"
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className="map-company-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-company-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="map-company-picker-header">
          <h2 id="map-company-picker-title" className="map-company-picker-title">
            지도에 표시할 고객사
          </h2>
          <button type="button" className="map-company-picker-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <p className="map-company-picker-desc">
          위·경도가 있는 고객사만 목록에 나옵니다. 필드·검색어로 좁힌 뒤 체크하고 확인을 누르면 선택한 곳만 마커로
          보입니다. 페이지를 넘겨도 선택은 유지됩니다. 행을 클릭한 뒤 Shift+다른 행을 클릭하면 그 사이 구간이 한꺼번에
          선택됩니다.
        </p>

        <div className="map-company-picker-search-toolbar">
          <button type="submit" form="map-company-picker-search-form" className="map-company-picker-search-icon-btn" aria-label="검색">
            <span className="material-symbols-outlined">search</span>
          </button>
          <form id="map-company-picker-search-form" onSubmit={runSearch} className="map-company-picker-search-form">
            <input
              type="text"
              placeholder={
                searchField
                  ? `${searchFieldLabelByKey[searchField] || searchField} 검색...`
                  : '모든 필드 검색 (기업명, 대표자, 주소, 메모, 사용자 정의 필드 등)...'
              }
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="고객사 검색"
            />
          </form>
          <select
            className="map-company-picker-field-select"
            value={searchField}
            onChange={(e) => setSearchField(e.target.value)}
            aria-label="검색 필드"
            title="기본 필드와 사용자 정의 필드 중 검색 대상을 고릅니다."
          >
            <option value="">전체 필드</option>
            <optgroup label="기본 필드">
              {BASE_SEARCH_FIELD_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </optgroup>
            {(customFieldColumns || []).length > 0 ? (
              <optgroup label="사용자 정의 필드">
                {customFieldColumns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label || c.key.replace(CUSTOM_FIELDS_PREFIX, '')}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>

        <div className="map-company-picker-actions-top">
          <button
            type="button"
            className="map-company-picker-text-btn"
            onClick={() => setFieldPickerOpen((v) => !v)}
            aria-expanded={fieldPickerOpen}
          >
            표시 필드 설정
          </button>
          <button type="button" className="map-company-picker-text-btn" onClick={selectAllFiltered}>
            검색 결과 전체 선택
          </button>
          <button type="button" className="map-company-picker-text-btn" onClick={clearSelection}>
            전체 해제
          </button>
          <span className="map-company-picker-count">
            {checkedIds.size}곳 선택 · 검색 결과 {filtered.length}곳
          </span>
        </div>
        {fieldPickerOpen ? (
          <div className="map-company-picker-field-panel">
            <p className="map-company-picker-field-panel-title">표시할 컬럼 선택 (최소 1개)</p>
            <div className="map-company-picker-field-grid">
              {displayFieldOptions.map((f) => {
                const checked = displayFields.includes(f.key);
                const disableUncheck = checked && displayFields.length <= 1;
                return (
                  <label key={f.key} className="map-company-picker-field-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disableUncheck}
                      onChange={() => toggleDisplayField(f.key)}
                    />
                    <span>{f.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="map-company-picker-table-wrap">
          <table className="map-company-picker-table">
            <thead>
              <tr>
                <th className="map-company-picker-th-check" scope="col">
                  선택
                </th>
                {displayFields.map((k) => (
                  <th key={k} scope="col">{displayLabelByKey[k] || k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((c, rowIdx) => {
                const globalIndex = (page - 1) * PAGE_SIZE + rowIdx;
                const idStr = String(c._id);
                return (
                  <tr
                    key={idStr}
                    className="map-company-picker-tr"
                    onClick={(e) => {
                      if (e.target.closest('input[type="checkbox"]')) return;
                      handleRowInteraction(c._id, globalIndex, e.shiftKey);
                    }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={checkedIds.has(idStr)}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleRowInteraction(c._id, globalIndex, e.nativeEvent?.shiftKey === true);
                        }}
                        aria-label={`${c.name || '고객사'} 선택`}
                      />
                    </td>
                    {displayFields.map((k) => (
                      <td
                        key={`${idStr}-${k}`}
                        className={
                          k === 'name'
                            ? 'map-company-picker-td-name'
                            : k === 'address'
                              ? 'map-company-picker-td-loc'
                              : k === INFLOW_FIELD_KEY
                                ? 'map-company-picker-td-inflow'
                                : ''
                        }
                      >
                        {displayCellValue(c, k)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 ? (
          <p className="map-company-picker-empty">조건에 맞는 고객사가 없습니다.</p>
        ) : null}

        {filtered.length > PAGE_SIZE ? (
          <div className="map-company-picker-pagination">
            <ListPaginationButtons page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        ) : null}

        <footer className="map-company-picker-footer">
          <button type="button" className="map-company-picker-btn map-company-picker-btn-cancel" onClick={onClose}>
            취소
          </button>
          <button type="button" className="map-company-picker-btn map-company-picker-btn-confirm" onClick={handleConfirm}>
            확인
          </button>
        </footer>
      </div>
    </div>
  );
}
