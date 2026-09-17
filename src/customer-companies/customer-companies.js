import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession, getAuthHeader } from '@/lib/crm-auth';
import { useSearchParams, useNavigate } from 'react-router-dom';
import AddCompanyModal from './add-company-modal/add-company-modal';
import CustomerCompanyDetailModal from './customer-company-detail-modal/customer-company-detail-modal';
import CustomerCompaniesExcelImportModal from './customer-companies-excel-import-modal/customer-companies-excel-import-modal';
import ListTemplateModal from '../components/list-template-modal/list-template-modal';
import {
  LIST_IDS,
  getSavedTemplate,
  getEffectiveTemplate,
  patchListTemplate,
  resetListTemplate
} from '../lib/list-templates';
import { listColumnValueInlineStyle } from '@/lib/list-column-cell-styles';
import {
  cellValue,
  formatBusinessNumber,
  formatAddressForList,
  getNameInitials,
  COMPANY_STATUS_LABEL
} from './customer-companies-list-cells';
import './customer-companies.css';
import './customer-companies-responsive.css';
import './customer-companies-ref.css';
import '@/shared/crm-list-sheet-table.css';
import {
  useCrmListColumnResize,
  CrmListColgroup,
  CrmListColumnResizeHandle
} from '@/components/crm-list-column-resize/crm-list-column-resize';
import {
  crmListSheetColSpanWithFill,
  CrmListSheetFillHeaderCell,
  CrmListSheetFillBodyCell
} from '@/components/crm-list-sheet-fill/crm-list-sheet-fill';
import { LIST_COLUMN_FIXED_WIDTH_PX } from '@/lib/list-column-widths';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import ListPaginationButtons from '@/components/list-pagination-buttons/list-pagination-buttons';
import * as XLSX from 'xlsx';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import AssigneeHandoverModal from '@/company-overview/assignee-handover-modal/assignee-handover-modal';
import MergeCustomerCompaniesModal from './merge-customer-companies-modal/merge-customer-companies-modal';
import CustomFieldsManageModal from '@/shared/custom-fields-manage-modal/custom-fields-manage-modal';
import BulkSalesOpportunityDirectoryModal from '@/shared/bulk-sales-opportunity-directory-modal/bulk-sales-opportunity-directory-modal';

import { API_BASE } from '@/config';
import { CUSTOM_FIELDS_PREFIX, BASE_SEARCH_FIELD_OPTIONS } from '@/lib/customer-company-search-fields';
const MODAL_PARAM = 'modal';
const MODAL_ADD_COMPANY = 'add-company';
const MODAL_EXCEL_IMPORT = 'excel-import';
const MODAL_DETAIL = 'detail';
const DETAIL_ID_PARAM = 'id';
const LIMIT = 13;
const LIMIT_SEARCH_MODAL = 500;
const EXPORT_PAGE_LIMIT = 100;

const LIST_ID = LIST_IDS.CUSTOMER_COMPANIES;

export default function CustomerCompanies({
  listVariant = 'page',
  onSearchModalConfirm,
  searchModalMultiSelect,
  onSearchModalConfirmBatch,
  initialSearchQuery = '',
  includeSimilarSearch = false
}) {
  const isSearchModal = listVariant === 'searchModal';
  const listPageLimit = isSearchModal ? LIMIT_SEARCH_MODAL : LIMIT;
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [similarSearchItems, setSimilarSearchItems] = useState([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [loading, setLoading] = useState(true);
  const [customFieldColumns, setCustomFieldColumns] = useState([]);
  const [template, setTemplate] = useState(() => getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID)));
  const [dragOverKey, setDragOverKey] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [companyEmployees, setCompanyEmployees] = useState([]); // 사내 직원 (담당자 이름 표시용)
  const [companyEmployeesLoaded, setCompanyEmployeesLoaded] = useState(false);
  const [searchField, setSearchField] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: listPageLimit, total: 0, totalPages: 0 });
  const [selectedCompanyIds, setSelectedCompanyIds] = useState(new Set());
  const [selectedCompanyMap, setSelectedCompanyMap] = useState({});
  const [exportExcelLoading, setExportExcelLoading] = useState(false);
  const [selectAllLoading, setSelectAllLoading] = useState(false);
  const [lastCheckedIndex, setLastCheckedIndex] = useState(null);
  const headerSelectAllRef = useRef(null);
  const listSheetScrollRef = useRef(null);
  const searchInputRef = useRef(null);
  /** 상세 삭제 등으로 페이지가 바뀔 때 다음 목록 요청만 로딩 표시 없이 */
  const listFetchSilentOnceRef = useRef(false);
  const me = useMemo(() => getStoredCrmUser(), []);
  const canExportExcel = isAdminOrAboveRole(me?.role);
  const canManageCustomFieldDefinitions = isAdminOrAboveRole(me?.role);
  const canRequestAssigneeHandover = !!(me && String(me.role || '').toLowerCase() !== 'pending');
  const canMergeCustomerCompanies = isAdminOrAboveRole(me?.role);
  const canBulkDeleteSelected = isAdminOrAboveRole(me?.role);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const [handoverCtx, setHandoverCtx] = useState(null);
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [bulkSalesPipelineOpen, setBulkSalesPipelineOpen] = useState(false);
  const [showCustomFieldsManageModal, setShowCustomFieldsManageModal] = useState(false);
  const [searchModalAddOpen, setSearchModalAddOpen] = useState(false);

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

  const sortKey = sort.key;
  const companiesForMergeModal = useMemo(
    () => [...selectedCompanyIds].map((id) => selectedCompanyMap[id]).filter(Boolean),
    [selectedCompanyIds, selectedCompanyMap]
  );

  const assigneeIdToName = useMemo(() => {
    const map = {};
    (companyEmployees || []).forEach((e) => {
      const id = e.id != null ? String(e.id) : (e._id ? String(e._id) : null);
      if (id) map[id] = e.name || e.email || id;
    });
    return map;
  }, [companyEmployees]);

  /**
   * 엑셀 내보내기용 담당자 이름.
   * 퇴사·삭제 등으로 현재 회사 사용자 목록에 없는 담당자는 내부 ID 대신 "알 수 없는 사용자"로 적습니다.
   * (예전에는 ID가 그대로 파일에 들어갔고, 목록 화면은 같은 경우를 "—"로 보여 줘 서로 달랐습니다.)
   */
  const assigneeNamesForExport = useCallback(
    (ids) => {
      const list = Array.isArray(ids) ? ids : [];
      const names = [];
      let unknown = 0;
      list.forEach((id) => {
        const name = assigneeIdToName[String(id)];
        if (name) names.push(name);
        else unknown += 1;
      });
      if (unknown > 0) names.push(unknown === 1 ? '알 수 없는 사용자' : `알 수 없는 사용자 ${unknown}명`);
      return names.join(', ');
    },
    [assigneeIdToName]
  );
  const sortDir = sort.dir;
  /** URL로 연 상세 모달용: 목록에 없을 때 id로 따로 조회한 회사 (새로고침 시 items 비어 있을 수 있음) */
  const [detailCompanyById, setDetailCompanyById] = useState(null);
  const [loadingDetailCompany, setLoadingDetailCompany] = useState(false);
  const isAddModalOpen = isSearchModal ? searchModalAddOpen : searchParams.get(MODAL_PARAM) === MODAL_ADD_COMPANY;
  const isExcelImportOpen = !isSearchModal && searchParams.get(MODAL_PARAM) === MODAL_EXCEL_IMPORT;
  const detailId = searchParams.get(DETAIL_ID_PARAM);
  const isDetailOpen = !isSearchModal && searchParams.get(MODAL_PARAM) === MODAL_DETAIL && detailId;
  const selectedCompanyFromList = isDetailOpen
    ? items.find((c) => c._id === detailId) || null
    : null;
  const selectedCompany = selectedCompanyFromList || detailCompanyById;

  /** 사내 직원 목록 (담당자 열 이름 표시용) */
  useEffect(() => {
    let cancelled = false;
    setCompanyEmployeesLoaded(false);
    fetch(`${API_BASE}/companies/overview`, crmFetchInit())
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
    return () => { cancelled = true; };
  }, []);

  /** URL에 id가 있는데 목록에서 못 찾았을 때(로딩 중·직접 링크) id로 회사 한 건 조회 */
  useEffect(() => {
    if (!isDetailOpen || !detailId || selectedCompanyFromList) {
      if (!isDetailOpen) setDetailCompanyById(null);
      return;
    }
    setLoadingDetailCompany(true);
    let cancelled = false;
    fetch(`${API_BASE}/customer-companies/${detailId}`, crmFetchInit())
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        if (data._id) setDetailCompanyById(data);
        else setDetailCompanyById(null);
      })
      .catch(() => { if (!cancelled) setDetailCompanyById(null); })
      .finally(() => { if (!cancelled) setLoadingDetailCompany(false); });
    return () => { cancelled = true; };
  }, [isDetailOpen, detailId, selectedCompanyFromList]);

  const fetchList = useCallback(async (page = 1, opts) => {
    const silentFromOpt = opts && opts.silent === true;
    const silent = silentFromOpt || listFetchSilentOnceRef.current;
    listFetchSilentOnceRef.current = false;
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(listPageLimit) });
      if (searchApplied) {
        params.set('search', searchApplied);
        if (searchField) params.set('searchField', searchField);
      }
      const url = `${API_BASE}/customer-companies?${params.toString()}`;
      const res = await fetch(url, crmFetchInit());
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setPagination(data.pagination || { page: 1, limit: listPageLimit, total: 0, totalPages: 0 });
      } else {
        setItems([]);
        setPagination((p) => ({ ...p, total: 0, totalPages: 0 }));
      }
    } catch (_) {
      setItems([]);
      setPagination((p) => ({ ...p, total: 0, totalPages: 0 }));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [searchApplied, searchField, listPageLimit]);

  const handleAddCompanySaved = useCallback(
    (company) => {
      if (!company || !company._id) {
        fetchList(pagination.page, { silent: true });
        return;
      }
      if (String(searchApplied || '').trim()) {
        fetchList(pagination.page, { silent: true });
        return;
      }
      if (pagination.page !== 1) {
        setPagination((p) => ({ ...p, total: (p.total || 0) + 1, totalPages: Math.max(1, Math.ceil(((p.total || 0) + 1) / (p.limit || listPageLimit))) }));
        return;
      }
      setItems((prev) => {
        const next = [company, ...prev];
        return next.length > listPageLimit ? next.slice(0, listPageLimit) : next;
      });
      setPagination((p) => {
        const total = (p.total || 0) + 1;
        return { ...p, total, totalPages: Math.max(1, Math.ceil(total / (p.limit || listPageLimit))) };
      });
    },
    [fetchList, pagination.page, searchApplied, listPageLimit]
  );

  /** 검색·필터와 동일 조건 — 전체 선택용 API 1회 */
  const fetchCustomerCompaniesForSelection = useCallback(async () => {
    const params = new URLSearchParams();
    if (searchApplied) {
      params.set('search', searchApplied);
      if (searchField) params.set('searchField', searchField);
    }
    const res = await fetch(`${API_BASE}/customer-companies/for-selection?${params.toString()}`, crmFetchInit());
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '목록을 가져오지 못했습니다.');
    }
    const data = await res.json();
    return data.items || [];
  }, [searchApplied, searchField]);

  useEffect(() => {
    if (!isSearchModal) return;
    const q = String(initialSearchQuery || '').trim();
    if (!q) return;
    setSearchInput(q);
    setSearchApplied(q);
  }, [isSearchModal, initialSearchQuery]);

  useEffect(() => {
    if (!isSearchModal || !includeSimilarSearch) {
      setSimilarSearchItems([]);
      return;
    }
    const q = String(searchApplied || '').trim();
    if (!q) {
      setSimilarSearchItems([]);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ name: q });
    fetch(`${API_BASE}/customer-companies/similar-name-candidates?${params.toString()}`, crmFetchInit())
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (!cancelled) setSimilarSearchItems(Array.isArray(data?.similar) ? data.similar : []);
      })
      .catch(() => {
        if (!cancelled) setSimilarSearchItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isSearchModal, includeSimilarSearch, searchApplied]);

  useEffect(() => { fetchList(pagination.page); }, [pagination.page, fetchList]);
  useEffect(() => {
    if (isSearchModal) return undefined;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && String(e.key || '').toLowerCase() === 'k') {
        const tag = String(e.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isSearchModal]);
  useEffect(() => {
    const onExcelImportDone = () => { fetchList(pagination.page); };
    window.addEventListener('cc-excel-import-completed', onExcelImportDone);
    return () => window.removeEventListener('cc-excel-import-completed', onExcelImportDone);
  }, [fetchList, pagination.page]);
  useEffect(() => { setPagination((p) => ({ ...p, page: 1 })); }, [searchApplied, searchField]);

  /** 삭제된 커스텀 필드 등으로 선택값이 목록에 없으면 전체 필드로 되돌림 */
  useEffect(() => {
    if (!searchField) return;
    const valid = new Set(BASE_SEARCH_FIELD_OPTIONS.map((o) => o.key));
    (customFieldColumns || []).forEach((c) => {
      if (c?.key) valid.add(c.key);
    });
    if (!valid.has(searchField)) setSearchField('');
  }, [searchField, customFieldColumns]);

  const loadCustomerCompanyCustomFieldColumns = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=customerCompany`, crmFetchInit());
      const data = await res.json().catch(() => ({}));
      const items = Array.isArray(data?.items) ? data.items : [];
      const extra = items.map((d) => ({ key: `${CUSTOM_FIELDS_PREFIX}${d.key}`, label: d.label || d.key || '' }));
      setCustomFieldColumns(extra);
      setTemplate((prev) => getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), extra));
    } catch {
      setCustomFieldColumns([]);
    }
  }, []);

  /** 새 고객사 추가 시 정의된 커스텀 필드를 리스트 템플릿에 반영 */
  useEffect(() => {
    loadCustomerCompanyCustomFieldColumns();
  }, [loadCustomerCompanyCustomFieldColumns]);

  const openAddModal = () => {
    if (isSearchModal) {
      setSearchModalAddOpen(true);
      return;
    }
    setSearchParams({ [MODAL_PARAM]: MODAL_ADD_COMPANY });
  };
  const closeAddModal = () => {
    if (isSearchModal) {
      setSearchModalAddOpen(false);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    setSearchParams(next, { replace: true });
  };

  const openDetailModal = (row) => {
    if (!row?._id) return;
    if (isSearchModal) {
      if (searchModalMultiSelect && onSearchModalConfirmBatch) {
        const idx = sortedItems.findIndex((r) => String(r._id) === String(row._id));
        if (idx >= 0) toggleCompanySelection(idx, false);
        return;
      }
      onSearchModalConfirm?.(row);
      return;
    }
    setSearchParams({ [MODAL_PARAM]: MODAL_DETAIL, [DETAIL_ID_PARAM]: row._id });
  };
  const closeDetailModal = () => {
    setDetailCompanyById(null);
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    next.delete(DETAIL_ID_PARAM);
    setSearchParams(next, { replace: true });
  };

  const openExcelImportModal = () => setSearchParams({ [MODAL_PARAM]: MODAL_EXCEL_IMPORT });
  const closeExcelImportModal = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    setSearchParams(next, { replace: true });
  };

  const runSearch = (e) => {
    e?.preventDefault();
    setSelectedCompanyIds(new Set());
    setSelectedCompanyMap({});
    setSearchApplied(searchInput.trim());
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const handleToggleFavorite = async (rowId, nextValue) => {
    if (!rowId) return;
    try {
      const res = await fetch(`${API_BASE}/customer-companies/${rowId}/favorite`, crmFetchInit({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isFavorite: nextValue  })
      }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setItems((prev) => prev.map((row) => (row._id === rowId ? { ...row, isFavorite: !!data.isFavorite } : row)));
      setDetailCompanyById((prev) => (prev?._id === rowId ? { ...prev, isFavorite: !!data.isFavorite } : prev));
    } catch (_) {}
  };

  const saveTemplate = useCallback(async (payload) => {
    try {
      const data = await patchListTemplate(LIST_ID, payload);
      setTemplate(getEffectiveTemplate(LIST_ID, data.listTemplates?.[LIST_ID] || payload, customFieldColumns));
    } catch (err) {
      alert(err.message || '저장에 실패했습니다.');
    }
  }, [customFieldColumns]);

  const resetTemplate = useCallback(async () => {
    try {
      const data = await resetListTemplate(LIST_ID, customFieldColumns);
      setTemplate(getEffectiveTemplate(LIST_ID, data.listTemplates?.[LIST_ID] || null, customFieldColumns));
    } catch (err) {
      alert(err.message || '초기화에 실패했습니다.');
      throw err;
    }
  }, [customFieldColumns]);

  const handleHeaderDragStart = (e, key) => {
    e.dataTransfer.setData('text/plain', key);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleHeaderDragOver = (e, key) => {
    e.preventDefault();
    setDragOverKey(key);
  };
  const handleHeaderDragLeave = () => setDragOverKey(null);
  const handleHeaderDrop = (e, targetKey) => {
    e.preventDefault();
    setDragOverKey(null);
    const fromKey = e.dataTransfer.getData('text/plain');
    if (!fromKey || fromKey === targetKey) return;
    const order = [...template.columnOrder];
    const fromIdx = order.indexOf(fromKey);
    const toIdx = order.indexOf(targetKey);
    if (fromIdx === -1 || toIdx === -1) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, fromKey);
    saveTemplate({
      columnOrder: order,
      visible: template.visible,
      columnCellStyles: template.columnCellStyles,
      columnWidths: template.columnWidths
    });
  };

  const displayColumns = template.columns.filter((c) => template.visible[c.key]);
  const colSpan = Math.max(1, displayColumns.length);
  const displayColumnKeys = useMemo(() => displayColumns.map((c) => c.key), [displayColumns]);

  const persistColumnWidths = useCallback(
    (columnWidths) =>
      saveTemplate({
        columnOrder: template.columnOrder,
        visible: template.visible,
        columnCellStyles: template.columnCellStyles,
        columnWidths
      }),
    [saveTemplate, template.columnOrder, template.visible, template.columnCellStyles]
  );

  const { getWidthPx, tableWidthPx, startResize, isResizing } = useCrmListColumnResize({
    columnWidths: template.columnWidths,
    displayColumnKeys,
    onPersistWidths: persistColumnWidths,
    leadingColWidthsPx: [LIST_COLUMN_FIXED_WIDTH_PX.__rowCheckbox__]
  });

  const getSortValue = useCallback((row, key) => {
    if (key === 'name') return (row.name || '').toLowerCase();
    if (key === 'representativeName') return (row.representativeName || '').toLowerCase();
    if (key === 'industry') return (row.industry || '').toLowerCase();
    if (key === 'businessNumber') return String(row.businessNumber || '').replace(/\D/g, '');
    if (key === 'address') return (row.address || '').toLowerCase();
    if (key === 'status') return (row.status || '').toLowerCase();
    if (key === 'assigneeUserIds') {
      const ids = Array.isArray(row.assigneeUserIds) ? row.assigneeUserIds : [];
      const names = ids.map((id) => assigneeIdToName[String(id)] || '').filter(Boolean);
      return names.join(' ').toLowerCase();
    }
    if (key.startsWith(CUSTOM_FIELDS_PREFIX)) {
      const fieldKey = key.slice(CUSTOM_FIELDS_PREFIX.length);
      const v = row.customFields?.[fieldKey];
      return (v !== undefined && v !== null ? String(v) : '').toLowerCase();
    }
    return '';
  }, [assigneeIdToName]);

  const listItemsForDisplay = useMemo(() => {
    if (!isSearchModal || !includeSimilarSearch || !String(searchApplied || '').trim()) return items;
    const seen = new Set();
    const merged = [];
    for (const row of similarSearchItems) {
      const id = row?._id != null ? String(row._id) : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(row);
    }
    for (const row of items) {
      const id = row?._id != null ? String(row._id) : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(row);
    }
    return merged;
  }, [items, similarSearchItems, isSearchModal, includeSimilarSearch, searchApplied]);

  const sortedItems = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...listItemsForDisplay].sort((a, b) => {
      const favDiff = Number(!!b.isFavorite) - Number(!!a.isFavorite);
      if (favDiff !== 0) return favDiff;
      if (!sortKey || sortKey === '_favorite') return 0;
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [listItemsForDisplay, sortKey, sortDir, getSortValue]);

  const listSheetTableColSpan = crmListSheetColSpanWithFill(colSpan + 1);

  const companiesForBulkSalesModal = useMemo(
    () =>
      [...selectedCompanyIds]
        .map((id) => selectedCompanyMap[id] || sortedItems.find((r) => String(r._id) === String(id)))
        .filter(Boolean),
    [selectedCompanyIds, selectedCompanyMap, sortedItems]
  );

  useEffect(() => {
    if (!sortedItems.length) return;
    setSelectedCompanyMap((prev) => {
      const next = { ...prev };
      for (const row of sortedItems) {
        const id = String(row?._id || '');
        if (!id || !selectedCompanyIds.has(id)) continue;
        next[id] = row;
      }
      return next;
    });
  }, [sortedItems, selectedCompanyIds]);

  useEffect(() => {
    setLastCheckedIndex(null);
  }, [pagination.page]);

  /** 검색·필터 결과 전체가 선택됐는지 (헤더 체크박스) */
  const allCompaniesChecked =
    (pagination.total || 0) > 0 && selectedCompanyIds.size === pagination.total;

  const handleSelectAllCompanies = useCallback(async () => {
    const total = pagination.total || 0;
    if (total === 0) return;
    if (selectedCompanyIds.size === total) {
      setSelectedCompanyIds(new Set());
      setSelectedCompanyMap({});
      setLastCheckedIndex(null);
      return;
    }
    setSelectAllLoading(true);
    try {
      const rows = await fetchCustomerCompaniesForSelection();
      const nextIds = new Set();
      const nextMap = {};
      for (const r of rows) {
        const id = String(r?._id || '');
        if (!id) continue;
        nextIds.add(id);
        nextMap[id] = r;
      }
      setSelectedCompanyIds(nextIds);
      setSelectedCompanyMap(nextMap);
    } catch (e) {
      window.alert(e?.message || '전체 선택에 실패했습니다.');
    } finally {
      setSelectAllLoading(false);
    }
  }, [pagination.total, selectedCompanyIds.size, fetchCustomerCompaniesForSelection]);

  useEffect(() => {
    const el = headerSelectAllRef.current;
    if (!el) return;
    const total = pagination.total || 0;
    el.indeterminate = total > 0 && selectedCompanyIds.size > 0 && selectedCompanyIds.size < total;
  }, [selectedCompanyIds.size, pagination.total]);

  const toggleCompanySelection = useCallback((idx, shiftKey = false) => {
    const row = sortedItems[idx];
    if (!row?._id) return;
    const rowId = String(row._id);
    const rowWillBeChecked = !selectedCompanyIds.has(rowId);
    setSelectedCompanyIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastCheckedIndex !== null) {
        const start = Math.min(lastCheckedIndex, idx);
        const end = Math.max(lastCheckedIndex, idx);
        for (let i = start; i <= end; i++) {
          const targetId = String(sortedItems[i]?._id || '');
          if (!targetId) continue;
          if (rowWillBeChecked) next.add(targetId);
          else next.delete(targetId);
        }
      } else if (rowWillBeChecked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
    setSelectedCompanyMap((prev) => {
      const next = { ...prev };
      if (shiftKey && lastCheckedIndex !== null) {
        const start = Math.min(lastCheckedIndex, idx);
        const end = Math.max(lastCheckedIndex, idx);
        for (let i = start; i <= end; i++) {
          const target = sortedItems[i];
          const targetId = String(target?._id || '');
          if (!targetId) continue;
          if (rowWillBeChecked) next[targetId] = target;
          else delete next[targetId];
        }
      } else if (rowWillBeChecked) next[rowId] = row;
      else delete next[rowId];
      return next;
    });
    setLastCheckedIndex(idx);
  }, [sortedItems, selectedCompanyIds, lastCheckedIndex]);

  const clearCompanySelection = useCallback(() => {
    setSelectedCompanyIds(new Set());
    setSelectedCompanyMap({});
    setLastCheckedIndex(null);
  }, []);

  const openMergeCompaniesModal = useCallback(() => {
    if (!canMergeCustomerCompanies) return;
    if (selectedCompanyIds.size < 2) {
      window.alert('병합하려면 고객사를 2곳 이상 선택해 주세요.');
      return;
    }
    setMergeModalOpen(true);
  }, [canMergeCustomerCompanies, selectedCompanyIds.size]);

  const handleBulkDeleteSelectedCompanies = useCallback(async () => {
    if (!canBulkDeleteSelected) {
      window.alert('선택 항목 삭제는 Owner / Admin만 가능합니다.');
      return;
    }
    const ids = [...selectedCompanyIds].map((id) => String(id));
    if (ids.length === 0) return;
    const confirmed = window.confirm(
      `선택한 고객사 ${ids.length}곳을 삭제합니다.\n` +
        '연결된 연락처는 해당 고객사와의 연결이 해제되고, 업무·판매 기록 등의 고객사 참조는 비워집니다.\n' +
        '이 작업은 되돌릴 수 없습니다. 계속할까요?'
    );
    if (!confirmed) return;
    setBulkDeleteLoading(true);
    try {
      const res = await fetch(`${API_BASE}/customer-companies/bulk-delete`, crmFetchInit({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids  })
      }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(data.error || '삭제에 실패했습니다.');
        return;
      }
      const deleted = Number(data.deletedCount) || 0;
      const skipped = Number(data.skippedCount) || 0;
      if (detailId && ids.includes(String(detailId))) {
        closeDetailModal();
      }
      clearCompanySelection();
      await fetchList(pagination.page, { silent: true });
      if (skipped > 0) {
        window.alert(`삭제했습니다. (${deleted}곳, 권한 없음 등으로 제외 ${skipped}곳)`);
      } else {
        window.alert(`삭제했습니다. (${deleted}곳)`);
      }
    } catch (_) {
      window.alert('서버에 연결할 수 없습니다.');
    } finally {
      setBulkDeleteLoading(false);
    }
  }, [
    canBulkDeleteSelected,
    selectedCompanyIds,
    detailId,
    closeDetailModal,
    clearCompanySelection,
    fetchList,
    pagination.page
  ]);

  const openCompanyHandoverFromSelection = useCallback(() => {
    if (!canRequestAssigneeHandover) return;
    if (selectedCompanyIds.size === 0) return;
    const ids = [...selectedCompanyIds];
    const rows = ids
      .map((id) => selectedCompanyMap[id] || sortedItems.find((r) => String(r._id) === String(id)))
      .filter(Boolean);
    const withAssignee = rows.filter((r) => Array.isArray(r.assigneeUserIds) && r.assigneeUserIds.length > 0);
    if (withAssignee.length === 0) {
      window.alert('담당자가 지정된 고객사만 이관 신청할 수 있습니다.');
      return;
    }
    setHandoverCtx({
      targetType: 'customerCompany',
      targets: withAssignee.map((r) => ({
        targetId: r._id,
        targetLabel: `고객사: ${r.name || '—'}`,
        assigneeUserIds: r.assigneeUserIds
      }))
    });
  }, [canRequestAssigneeHandover, selectedCompanyIds, selectedCompanyMap, sortedItems]);

  const fetchAllEmployeesForCompany = useCallback(async (companyId) => {
    const all = [];
    let page = 1;
    let totalPages = 1;
    do {
      const params = new URLSearchParams({
        customerCompanyId: String(companyId),
        page: String(page),
        limit: '200'
      });
      const res = await fetch(`${API_BASE}/customer-company-employees?${params.toString()}`, crmFetchInit());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '고객사 직원 목록 조회 실패');
      const batch = Array.isArray(data.items) ? data.items : [];
      all.push(...batch);
      totalPages = Math.max(1, Number(data.pagination?.totalPages) || 1);
      page += 1;
    } while (page <= totalPages);
    return all;
  }, []);

  const handleExportSelectedCompanies = useCallback(async () => {
    if (!canExportExcel) {
      alert('엑셀 내보내기는 Owner / Admin만 가능합니다.');
      return;
    }
    const selectedIds = [...selectedCompanyIds];
    if (selectedIds.length === 0) {
      alert('내보낼 고객사를 먼저 선택해 주세요.');
      return;
    }
    if (!companyEmployeesLoaded) {
      // 사용자 목록을 받기 전에 내보내면 담당자가 전부 "알 수 없는 사용자"로 찍힙니다.
      alert('담당자 정보를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    const includeEmployees = window.confirm('선택 고객사의 직원 목록도 함께 내보낼까요?\n확인: 예 / 취소: 아니오');
    setExportExcelLoading(true);
    try {
      const customKeys = new Set();
      const selectedRows = selectedIds
        .map((id) => selectedCompanyMap[id])
        .filter(Boolean);
      if (selectedRows.length === 0) {
        alert('선택 고객사 정보를 찾을 수 없습니다. 다시 선택해 주세요.');
        return;
      }
      selectedRows.forEach((r) => {
        if (r.customFields && typeof r.customFields === 'object') {
          Object.keys(r.customFields).forEach((k) => customKeys.add(k));
        }
      });
      const sortedCustomKeys = [...customKeys].sort();
      const companyRows = selectedRows.map((row) => {
        const assignees = assigneeNamesForExport(row.assigneeUserIds);
        const out = {
          기업명: row.name || '',
          대표자: row.representativeName || '',
          사업자번호: formatBusinessNumber(row.businessNumber),
          업종: row.industry || '',
          주소: row.address || '',
          담당자: assignees,
          즐겨찾기: row.isFavorite ? 'Y' : '',
          메모: row.memo || '',
          수정일: row.updatedAt ? new Date(row.updatedAt).toLocaleString('ko-KR') : ''
        };
        sortedCustomKeys.forEach((fk) => {
          const label = customFieldColumns.find((c) => c.key === `${CUSTOM_FIELDS_PREFIX}${fk}`)?.label || `커스텀_${fk}`;
          const v = row.customFields?.[fk];
          out[label] = v !== undefined && v !== null && v !== '' ? String(v) : '';
        });
        return out;
      });

      const wb = XLSX.utils.book_new();
      const wsCompanies = XLSX.utils.json_to_sheet(companyRows);
      XLSX.utils.book_append_sheet(wb, wsCompanies, '고객사');

      if (includeEmployees) {
        const employeeRows = [];
        for (const row of selectedRows) {
          const employees = await fetchAllEmployeesForCompany(row._id);
          employees.forEach((emp) => {
            const empAssignees = assigneeNamesForExport(emp.assigneeUserIds);
            employeeRows.push({
              기업명: row.name || '',
              이름: emp.name || '',
              이메일: emp.email || '',
              전화: emp.phone || '',
              직책: emp.position || '',
              주소: emp.address || '',
              담당자: empAssignees,
              상태: emp.status || '',
              메모: emp.memo || '',
              수정일: emp.updatedAt ? new Date(emp.updatedAt).toLocaleString('ko-KR') : ''
            });
          });
        }
        const wsEmployees = XLSX.utils.json_to_sheet(employeeRows);
        XLSX.utils.book_append_sheet(wb, wsEmployees, '고객사직원');
      }

      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `고객사목록_${stamp}.xlsx`);
    } catch (e) {
      alert(e?.message || '엑셀 내보내기에 실패했습니다.');
    } finally {
      setExportExcelLoading(false);
    }
  }, [canExportExcel, companyEmployeesLoaded, selectedCompanyIds, selectedCompanyMap, assigneeNamesForExport, customFieldColumns, fetchAllEmployeesForCompany]);

  const handleSortColumn = useCallback((key) => {
    if (key === '_favorite') return;
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { key, dir: 'asc' };
    });
  }, []);

  return (
    <div className={`page customer-companies-page customer-companies-page--ref${isSearchModal ? ' customer-companies-page--search-modal' : ''}`}>
      <div className="cc-ref-shell">
      <header className="cc-ref-topbar">
        <div className="cc-ref-topbar-left">
          {!isSearchModal ? (
            <div className="cc-ref-title-block">
              <h1 className="cc-ref-title">기업 리스트</h1>
              <span className="cc-ref-count-badge">총 {pagination.total || 0}곳</span>
            </div>
          ) : null}
          <div className="cc-ref-search">
            <form id="customer-companies-search-form" onSubmit={runSearch} className="cc-ref-search-form">
              <button type="submit" className="cc-ref-search-submit" aria-label="검색">
                <span className="material-symbols-outlined" aria-hidden>search</span>
              </button>
              <input
                ref={searchInputRef}
                type="text"
                className="cc-ref-search-input"
                placeholder={
                  searchField
                    ? `${searchFieldLabelByKey[searchField] || searchField} 검색...`
                    : '모든 필드 검색 (기업명, 대표자, 주소, 메모 등)'
                }
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="고객사 검색"
              />
              {!isSearchModal ? <span className="cc-ref-search-kbd" aria-hidden>⌘K</span> : null}
            </form>
          </div>
          <select
            className="cc-ref-field-select"
            value={searchField}
            onChange={(e) => setSearchField(e.target.value)}
            aria-label="검색 필드"
            title="기본 필드와 사용자 정의 필드(추가 시 자동 반영) 중에서 검색 대상을 고릅니다."
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
        <div className="cc-ref-topbar-right">
          {!isSearchModal ? (
            <>
              <div className="cc-ref-sync-pill" title="고객사·담당자 기준으로 목록을 관리합니다">
                <span className="cc-ref-sync-dot" aria-hidden />
                <span>고객사 관리</span>
              </div>
              <span className="cc-ref-topbar-divider" aria-hidden />
              <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" />
            </>
          ) : (
            <button
              type="button"
              className="cc-ref-btn cc-ref-btn--ghost cc-ref-btn--icon"
              aria-label="리스트 열 설정"
              onClick={() => {
                setTemplate(getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), customFieldColumns));
                setSettingsOpen(true);
              }}
              title="리스트 열 설정"
            >
              <span className="material-symbols-outlined" aria-hidden>settings</span>
            </button>
          )}
        </div>
      </header>

      <div className="cc-ref-body page-content">
        {!isSearchModal ? (
          <section className="cc-ref-toolbar" aria-label="기업 리스트 도구">
            <div className="cc-ref-toolbar-left">
              <button
                type="button"
                className="cc-ref-btn cc-ref-btn--emerald"
                onClick={openExcelImportModal}
                title="엑셀 파일을 매핑하여 고객사 일괄 등록"
              >
                <span className="material-symbols-outlined" aria-hidden>upload</span>
                엑셀 가져오기
              </button>
              {canExportExcel ? (
                <button
                  type="button"
                  className="cc-ref-btn cc-ref-btn--emerald cc-ref-btn--icon"
                  onClick={handleExportSelectedCompanies}
                  disabled={exportExcelLoading}
                  title="선택한 고객사만 엑셀(.xlsx)로 받습니다. (Owner / Admin 전용)"
                  aria-label="엑셀 내보내기"
                >
                  <span className="material-symbols-outlined" aria-hidden>download</span>
                </button>
              ) : null}
              <button
                type="button"
                className="cc-ref-btn cc-ref-btn--violet"
                onClick={() => {
                  setTemplate(getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), customFieldColumns));
                  setSettingsOpen(true);
                }}
                title="리스트 열 설정"
              >
                <span className="material-symbols-outlined" aria-hidden>tune</span>
                필드 / 컬럼 관리
              </button>
              {canManageCustomFieldDefinitions ? (
                <button
                  type="button"
                  className="cc-ref-btn cc-ref-btn--ghost"
                  onClick={() => setShowCustomFieldsManageModal(true)}
                  title="고객사에 쓸 사용자 정의 필드를 추가합니다"
                >
                  <span className="material-symbols-outlined" aria-hidden>playlist_add</span>
                  필드 추가
                </button>
              ) : null}
            </div>
            <div className="cc-ref-toolbar-right">
              <button type="button" className="cc-ref-btn cc-ref-btn--primary" onClick={openAddModal}>
                <span className="material-symbols-outlined" aria-hidden>add</span>
                새 기업 추가
              </button>
            </div>
          </section>
        ) : null}

        {!isSearchModal && selectedCompanyIds.size > 0 && (
          <div className="cc-selection-action-bar">
            <span className="cc-selection-action-bar-count">
              <strong>{selectedCompanyIds.size}</strong>곳 선택됨
              <span className="cc-selection-action-bar-hint">Shift+클릭으로 범위 선택</span>
            </span>
            <div className="cc-selection-action-bar-btns">
              {canMergeCustomerCompanies ? (
                <button
                  type="button"
                  className="cc-selection-action-bar-merge"
                  onClick={openMergeCompaniesModal}
                  disabled={selectedCompanyIds.size < 2}
                  title="선택한 고객사를 하나로 합칩니다 (2곳 이상, Admin 이상)"
                >
                  <span className="material-symbols-outlined" aria-hidden>merge</span>
                  병합하기
                </button>
              ) : null}
              <button
                type="button"
                className="cc-selection-action-bar-sales"
                onClick={() => setBulkSalesPipelineOpen(true)}
                title="선택한 고객사마다 동일 제품·단계로 영업기회를 등록합니다. 고객사별 구매 담당자(소속 직원)를 지정해야 합니다."
              >
                <span className="material-symbols-outlined" aria-hidden>trending_up</span>
                영업기회에 추가
              </button>
              <button
                type="button"
                className="cc-selection-action-bar-map"
                onClick={() => {
                  const ids = [...selectedCompanyIds].filter(Boolean);
                  if (!ids.length) return;
                  navigate(`/map?mapShowIds=${encodeURIComponent(ids.join(','))}`);
                }}
                title="체크한 고객사만 지도에 마커로 표시합니다"
              >
                <span className="material-symbols-outlined" aria-hidden>map</span>
                지도에서 보기
              </button>
              {canRequestAssigneeHandover ? (
                <button
                  type="button"
                  className="cc-selection-action-bar-handover"
                  onClick={openCompanyHandoverFromSelection}
                  title="선택한 고객사의 담당 이관 신청 (여러 곳 선택 가능, 담당자가 있는 항목만 신청, 관리자 메일 승인 후 반영)"
                >
                  <span className="material-symbols-outlined" aria-hidden>swap_horiz</span>
                  인수인계
                </button>
              ) : null}
              {canBulkDeleteSelected ? (
                <button
                  type="button"
                  className="cc-selection-action-bar-delete"
                  onClick={handleBulkDeleteSelectedCompanies}
                  disabled={bulkDeleteLoading}
                  title="선택한 고객사를 삭제합니다 (Owner / Admin). 연락처는 고객사 연결만 해제됩니다."
                >
                  <span className="material-symbols-outlined" aria-hidden>delete</span>
                  {bulkDeleteLoading ? '삭제 중…' : '선택 항목 삭제'}
                </button>
              ) : null}
              <button type="button" className="cc-selection-action-bar-cancel" onClick={clearCompanySelection}>
                선택 해제
              </button>
            </div>
          </div>
        )}
        {isSearchModal && searchModalMultiSelect && onSearchModalConfirmBatch ? (
          <div className="cc-search-modal-merge-batch-bar" role="region" aria-label="문서 메일머지용 다중 선택">
            <p className="cc-search-modal-merge-batch-bar-text">
              {selectedCompanyIds.size > 0 ? (
                <>
                  <strong>{selectedCompanyIds.size}</strong>곳 선택됨 — 아래 버튼으로 문서 메일머지 표에 한 번에 넣습니다.
                </>
              ) : (
                <>체크박스를 켜거나 행을 눌러 여러 고객사를 선택하세요. (Shift+클릭으로 범위 선택)</>
              )}
            </p>
            <div className="cc-search-modal-merge-batch-bar-btns">
              <button type="button" className="cc-search-modal-merge-batch-clear" onClick={clearCompanySelection} disabled={!selectedCompanyIds.size}>
                선택 해제
              </button>
              <button
                type="button"
                className="cc-search-modal-merge-batch-add"
                disabled={!selectedCompanyIds.size}
                onClick={() => {
                  const list = [...selectedCompanyIds]
                    .map((id) => selectedCompanyMap[id] || sortedItems.find((r) => String(r._id) === String(id)))
                    .filter(Boolean);
                  if (list.length) onSearchModalConfirmBatch(list);
                }}
              >
                선택 항목 표에 추가 ({selectedCompanyIds.size})
              </button>
            </div>
          </div>
        ) : null}
        <div className="cc-ref-table-card">
        <div className="panel table-panel">
          {/* 모바일 전용 카드 목록 (customerForMobile.html 구조) */}
          <div className="customer-companies-mobile-cards-wrap">
            {loading ? (
              <p className="customer-companies-mobile-cards-message">불러오는 중...</p>
            ) : sortedItems.length === 0 ? (
              <p className="customer-companies-mobile-cards-message">등록된 고객사가 없습니다.</p>
            ) : (
              <>
                <div className="customer-companies-mobile-cards-list">
                {sortedItems.map((row, idx) => (
                  <div
                    key={row._id}
                    className="customer-companies-mobile-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => openDetailModal(row)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetailModal(row); } }}
                  >
                    <div className="customer-companies-mobile-card-avatar">
                      <div
                        className={`cc-name-cell-avatar cc-name-cell-avatar--${idx % 3}`}
                        aria-hidden
                      >
                        <span className="cc-name-cell-initials">{getNameInitials(row.name)}</span>
                      </div>
                    </div>
                    <div className="customer-companies-mobile-card-body">
                      <div className="customer-companies-mobile-card-head">
                        <label
                          className="cc-mobile-check-wrap"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCompanySelection(idx, e.shiftKey);
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedCompanyIds.has(String(row._id))}
                            onChange={() => {}}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`${row.name || '고객사'} 선택`}
                          />
                        </label>
                        <div className="customer-companies-mobile-card-name-block">
                          <h3 className="customer-companies-mobile-card-name">{row.name || '—'}</h3>
                          <p className="customer-companies-mobile-card-bn">{formatBusinessNumber(row.businessNumber)}</p>
                        </div>
                        <button
                          type="button"
                          className={`cc-favorite-btn cc-mobile-favorite-btn ${row.isFavorite ? 'is-active' : ''}`}
                          aria-label={row.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 등록'}
                          title={row.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 등록'}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleFavorite(row._id, !row.isFavorite);
                          }}
                        >
                          <span className="material-symbols-outlined" aria-hidden>star</span>
                        </button>
                      </div>
                      <p className="customer-companies-mobile-card-sub">{row.representativeName || '—'}</p>
                      <div className="customer-companies-mobile-card-details">
                        {row.industry ? (
                          <p className="customer-companies-mobile-card-meta">업종 {row.industry}</p>
                        ) : null}
                        <p className="customer-companies-mobile-card-address">{formatAddressForList(row.address)}</p>
                      </div>
                    </div>
                  </div>
                ))}
                </div>
              </>
            )}
          </div>
          <div className="crm-list-table-stack">
          <div className="table-wrap">
            <div className="crm-list-sheet-scroll" ref={listSheetScrollRef}>
            <div className="crm-list-sheet-table-wrap">
            <table
              className="data-table crm-list-sheet crm-list-sheet--resizable"
              style={{ '--crm-list-table-width': `${tableWidthPx}px` }}
            >
              <CrmListColgroup
                leadingCols={[{ key: '__rowCheckbox__', widthPx: LIST_COLUMN_FIXED_WIDTH_PX.__rowCheckbox__ }]}
                displayColumns={displayColumns}
                getWidthPx={getWidthPx}
              />
              <thead>
                <tr>
                  <th className="cc-th-check">
                    <input
                      ref={headerSelectAllRef}
                      type="checkbox"
                      checked={allCompaniesChecked}
                      disabled={selectAllLoading || loading || (pagination.total || 0) === 0}
                      onChange={handleSelectAllCompanies}
                      aria-label={
                        selectAllLoading
                          ? '전체 고객사 불러오는 중'
                          : '검색·필터 결과 전체 선택'
                      }
                      title={
                        selectAllLoading
                          ? '목록을 불러오는 중…'
                          : '현재 검색 조건에 맞는 고객사 전부를 선택합니다. 다시 누르면 전체 해제합니다.'
                      }
                    />
                  </th>
                  {displayColumns.map((col) => (
                    <th
                      key={col.key}
                      className={`${col.key === '_favorite' ? 'cc-th-favorite' : ''} ${dragOverKey === col.key ? 'list-template-drag-over' : ''} ${col.key !== '_favorite' ? 'list-template-th-sortable' : ''}`}
                      draggable={!isResizing}
                      onDragStart={(e) => handleHeaderDragStart(e, col.key)}
                      onDragOver={(e) => handleHeaderDragOver(e, col.key)}
                      onDragLeave={handleHeaderDragLeave}
                      onDrop={(e) => handleHeaderDrop(e, col.key)}
                      onClick={col.key !== '_favorite' ? () => handleSortColumn(col.key) : undefined}
                    >
                      {col.key === '_favorite' ? (
                        <span className="cc-th-favorite-icon material-symbols-outlined" aria-hidden>star</span>
                      ) : (
                        <span className="list-template-th-content">
                          <span className="material-symbols-outlined list-template-drag-handle" aria-hidden>drag_indicator</span>
                          {col.label}
                          {sortKey === col.key && (
                            <span className="list-template-sort-icon material-symbols-outlined" aria-hidden>
                              {sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                            </span>
                          )}
                        </span>
                      )}
                      <CrmListColumnResizeHandle columnKey={col.key} onResizeStart={startResize} />
                    </th>
                  ))}
                  <CrmListSheetFillHeaderCell />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={listSheetTableColSpan} className="text-center">불러오는 중...</td></tr>
                ) : sortedItems.length === 0 ? (
                  <tr><td colSpan={listSheetTableColSpan} className="text-center">등록된 고객사가 없습니다.</td></tr>
                ) : (
                  sortedItems.map((row, idx) => (
                    <tr
                      key={row._id}
                      className={`customer-companies-row-clickable ${idx % 2 === 0 ? 'crm-list-sheet-row--stripe-a' : 'crm-list-sheet-row--stripe-b'}`}
                      onClick={() => openDetailModal(row)}
                    >
                      <td
                        className="cc-td-check"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedCompanyIds.has(String(row._id))}
                          onChange={() => {}}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCompanySelection(idx, e.shiftKey);
                          }}
                          aria-label={`${row.name || '고객사'} 선택`}
                        />
                      </td>
                      {displayColumns.map((col) => {
                        const valStyle =
                          col.key === '_favorite' ? null : listColumnValueInlineStyle(template.columnCellStyles, col.key);
                        let content;
                        if (col.key === '_favorite') {
                          content = (
                            <button
                              type="button"
                              className={`cc-favorite-btn ${row.isFavorite ? 'is-active' : ''}`}
                              aria-label={row.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 등록'}
                              title={row.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 등록'}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleFavorite(row._id, !row.isFavorite);
                              }}
                            >
                              <span className="material-symbols-outlined" aria-hidden>star</span>
                            </button>
                          );
                        } else if (col.key === 'name') {
                          const avatarTone = (() => {
                            const s = String(row._id || row.name || idx);
                            let h = 0;
                            for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
                            return h % 6;
                          })();
                          content = (
                            <div className="cell-user cc-name-cell">
                              <div
                                className={`cc-name-cell-avatar cc-name-cell-avatar--${avatarTone}`}
                                aria-hidden
                              >
                                <span className="cc-name-cell-initials">{getNameInitials(row.name)}</span>
                              </div>
                              <div className="cc-name-cell-text">
                                <span className="font-semibold">{row.name || '—'}</span>
                              </div>
                            </div>
                          );
                        } else if (col.key === 'status') {
                          content = (
                            <span className={`status-badge status-${(row.status || 'active').toLowerCase()}`}>
                              {COMPANY_STATUS_LABEL[(row.status || 'active').toLowerCase()] || row.status || '—'}
                            </span>
                          );
                        } else {
                          content = cellValue(row, col.key, assigneeIdToName, companyEmployeesLoaded);
                        }
                        return (
                          <td
                            key={col.key}
                            data-label={col.key === '_favorite' ? '' : col.label}
                            className={
                              col.key === '_favorite'
                                ? 'cc-td-favorite'
                                : col.key === 'name'
                                  ? ''
                                  : 'text-muted'
                            }
                            onClick={col.key === '_favorite' ? (e) => e.stopPropagation() : undefined}
                          >
                            {valStyle ? (
                              <span className="list-col-value-style" style={valStyle}>
                                {content}
                              </span>
                            ) : (
                              content
                            )}
                          </td>
                        );
                      })}
                      <CrmListSheetFillBodyCell />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
            </div>
          </div>
          {!isSearchModal ? (
          <div className="pagination-bar crm-list-pagination-bar cc-ref-pagination">
            <p className="pagination-info">
              총 <strong>{pagination.total}</strong>건 중 <strong>{items.length ? (pagination.page - 1) * pagination.limit + 1 : 0}</strong>–<strong>{(pagination.page - 1) * pagination.limit + items.length}</strong>건 표시
            </p>
            <ListPaginationButtons
              page={pagination.page}
              totalPages={pagination.totalPages || 1}
              onPageChange={(nextPage) => setPagination((p) => ({ ...p, page: nextPage }))}
            />
          </div>
          ) : null}
          </div>
        </div>
        </div>
      </div>
      </div>
      {settingsOpen && (
        <ListTemplateModal
          listId={LIST_ID}
          columns={template.columns}
          visible={template.visible}
          columnOrder={template.columnOrder}
          columnCellStyles={template.columnCellStyles}
          onSave={saveTemplate}
          onReset={resetTemplate}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {showCustomFieldsManageModal && canManageCustomFieldDefinitions && (
        <CustomFieldsManageModal
          entityType="customerCompany"
          onClose={() => setShowCustomFieldsManageModal(false)}
          onFieldAdded={() => loadCustomerCompanyCustomFieldColumns()}
          apiBase={API_BASE}
          getAuthHeader={getAuthHeader}
        />
      )}
      {isAddModalOpen && (
        <AddCompanyModal
          initialName={isSearchModal ? (searchApplied || searchInput) : ''}
          existingCompanies={items}
          onClose={closeAddModal}
          onSaved={(payload) => {
            if (isSearchModal && payload?._id) {
              closeAddModal();
              if (searchModalMultiSelect && onSearchModalConfirmBatch) {
                onSearchModalConfirmBatch([payload]);
              } else {
                onSearchModalConfirm?.(payload);
              }
              return;
            }
            handleAddCompanySaved(payload);
          }}
        />
      )}
      <CustomerCompaniesExcelImportModal
        open={isExcelImportOpen}
        onClose={closeExcelImportModal}
        onImported={() => { fetchList(pagination.page); }}
      />
      {isDetailOpen && !selectedCompany && loadingDetailCompany && (
        <div className="customer-companies-detail-loading-overlay" role="dialog" aria-busy="true">
          <p>고객사 정보를 불러오는 중...</p>
          <button type="button" className="btn-outline" onClick={closeDetailModal}>취소</button>
        </div>
      )}
      {isDetailOpen && !selectedCompany && !loadingDetailCompany && (
        <div className="customer-companies-detail-loading-overlay" role="dialog">
          <p>해당 고객사를 찾을 수 없습니다.</p>
          <button type="button" className="btn-outline" onClick={closeDetailModal}>닫기</button>
        </div>
      )}
      {isDetailOpen && selectedCompany && (
        <CustomerCompanyDetailModal
          company={selectedCompany}
          onClose={closeDetailModal}
          onUpdated={(updatedCompany) => {
            const id = updatedCompany?._id != null ? String(updatedCompany._id) : null;
            if (id) {
              setItems((prev) => prev.map((c) =>
                String(c._id) === id ? { ...c, ...updatedCompany } : c
              ));
              setDetailCompanyById((prev) => (prev && String(prev._id) === id ? { ...prev, ...updatedCompany } : prev));
            }
          }}
          onDeleted={() => {
            const id = detailId != null ? String(detailId) : '';
            listFetchSilentOnceRef.current = true;
            setItems((prev) => prev.filter((c) => String(c._id) !== id));
            setPagination((p) => {
              const newTotal = Math.max(0, (p.total || 0) - 1);
              const totalPages = Math.max(1, Math.ceil(newTotal / (p.limit || LIMIT)));
              const nextPage = Math.min(p.page, totalPages);
              return { ...p, total: newTotal, totalPages, page: nextPage };
            });
            closeDetailModal();
          }}
        />
      )}
      {mergeModalOpen ? (
        <MergeCustomerCompaniesModal
          open
          onClose={() => setMergeModalOpen(false)}
          companies={companiesForMergeModal}
          onMerged={() => {
            fetchList(pagination.page, { silent: true });
            clearCompanySelection();
          }}
        />
      ) : null}
      {handoverCtx && (
        <AssigneeHandoverModal
          open
          onClose={() => setHandoverCtx(null)}
          onSubmitted={() => {
            fetchList(pagination.page, { silent: true });
            clearCompanySelection();
          }}
          targetType={handoverCtx.targetType}
          targets={handoverCtx.targets}
          assigneeIdToName={assigneeIdToName}
          currentUserId={me?._id || me?.id}
          companyEmployees={companyEmployees}
          companyEmployeesLoaded={companyEmployeesLoaded}
        />
      )}
      {bulkSalesPipelineOpen ? (
        <BulkSalesOpportunityDirectoryModal
          open
          mode="companies"
          entities={companiesForBulkSalesModal}
          onClose={() => setBulkSalesPipelineOpen(false)}
          onCompleted={() => {
            setBulkSalesPipelineOpen(false);
            setSelectedCompanyIds(new Set());
            setSelectedCompanyMap({});
          }}
        />
      ) : null}
      {!isSearchModal ? (
        <button type="button" className="cc-mobile-fab" onClick={openAddModal} aria-label="기업 추가">
          <span className="material-symbols-outlined">add</span>
        </button>
      ) : null}
    </div>
  );
}
