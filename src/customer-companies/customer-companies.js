import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import AddCompanyModal from './add-company-modal/add-company-modal';
import CustomerCompanyDetailModal from './customer-company-detail-modal/customer-company-detail-modal';
import CustomerCompaniesExcelImportModal from './customer-companies-excel-import-modal/customer-companies-excel-import-modal';
import ListTemplateModal from '../components/list-template-modal/list-template-modal';
import {
  LIST_IDS,
  getSavedTemplate,
  getEffectiveTemplate,
  patchListTemplate
} from '../lib/list-templates';
import './customer-companies.css';
import './customer-companies-responsive.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import ListPaginationButtons from '@/components/list-pagination-buttons/list-pagination-buttons';
import * as XLSX from 'xlsx';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import AssigneeHandoverModal from '@/company-overview/assignee-handover-modal/assignee-handover-modal';
import CustomFieldsManageModal from '@/shared/custom-fields-manage-modal/custom-fields-manage-modal';

import { API_BASE } from '@/config';
const MODAL_PARAM = 'modal';
const MODAL_ADD_COMPANY = 'add-company';
const MODAL_EXCEL_IMPORT = 'excel-import';
const MODAL_DETAIL = 'detail';
const DETAIL_ID_PARAM = 'id';
const LIMIT = 10;
const EXPORT_PAGE_LIMIT = 100;

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatBusinessNumber(num) {
  if (!num) return '—';
  const s = String(num).replace(/\D/g, '');
  if (s.length <= 3) return s;
  if (s.length <= 5) return `${s.slice(0, 3)}-${s.slice(3)}`;
  return `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5, 10)}`;
}

/** 고객사명 아바타 이니셜 (연락처 리스트 getNameInitials 와 동일 규칙) */
function getNameInitials(name) {
  const s = (name || '?').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  }
  return s.slice(0, 2).toUpperCase();
}

const LIST_ID = LIST_IDS.CUSTOMER_COMPANIES;

const COMPANY_STATUS_LABEL = { active: '활성', inactive: '비활성', lead: '리드' };

const CUSTOM_FIELDS_PREFIX = 'customFields.';
/** @param {Record<string, string>} [assigneeIdToName] - userId → 이름 (목록 담당자 셀 표시용) */
function cellValue(row, key, assigneeIdToName = {}, assigneeNamesReady = false) {
  if (key === 'name') return row.name || '—';
  if (key === 'representativeName') return row.representativeName || '—';
  if (key === 'industry') return row.industry || '—';
  if (key === 'businessNumber') return formatBusinessNumber(row.businessNumber);
  if (key === 'address') return row.address || '—';
  if (key === 'status') {
    const st = (row.status || 'active').toLowerCase();
    return COMPANY_STATUS_LABEL[st] || row.status || '—';
  }
  if (key === 'assigneeUserIds') {
    const ids = Array.isArray(row.assigneeUserIds) ? row.assigneeUserIds : [];
    const names = ids.map((id) => assigneeIdToName[String(id)] || '').filter(Boolean);
    if (names.length) return names.join(', ');
    if (ids.length === 0) return '—';
    return assigneeNamesReady ? '—' : '담당자 불러오는 중...';
  }
  if (key.startsWith(CUSTOM_FIELDS_PREFIX)) {
    const fieldKey = key.slice(CUSTOM_FIELDS_PREFIX.length);
    const v = row.customFields?.[fieldKey];
    return v !== undefined && v !== null && v !== '' ? String(v) : '—';
  }
  return '—';
}

export default function CustomerCompanies() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [assigneeMeOnly, setAssigneeMeOnly] = useState(() => getSavedTemplate(LIST_ID)?.assigneeMeOnly === true);
  const [loading, setLoading] = useState(true);
  const [customFieldColumns, setCustomFieldColumns] = useState([]);
  const [template, setTemplate] = useState(() => getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID)));
  const [dragOverKey, setDragOverKey] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [companyEmployees, setCompanyEmployees] = useState([]); // 사내 직원 (담당자 이름 표시용)
  const [companyEmployeesLoaded, setCompanyEmployeesLoaded] = useState(false);
  const [searchField, setSearchField] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: LIMIT, total: 0, totalPages: 0 });
  const [selectedCompanyIds, setSelectedCompanyIds] = useState(new Set());
  const [selectedCompanyMap, setSelectedCompanyMap] = useState({});
  const [exportExcelLoading, setExportExcelLoading] = useState(false);
  const [selectAllLoading, setSelectAllLoading] = useState(false);
  const [lastCheckedIndex, setLastCheckedIndex] = useState(null);
  const headerSelectAllRef = useRef(null);
  const me = useMemo(() => getStoredCrmUser(), []);
  const canExportExcel = isAdminOrAboveRole(me?.role);
  const canManageCustomFieldDefinitions = isAdminOrAboveRole(me?.role);
  const canRequestAssigneeHandover = !!(me && String(me.role || '').toLowerCase() !== 'pending');
  const [handoverCtx, setHandoverCtx] = useState(null);
  const [showCustomFieldsManageModal, setShowCustomFieldsManageModal] = useState(false);
  const SEARCH_FIELD_OPTIONS = [
    { key: 'name', label: '고객사명' },
    { key: 'representativeName', label: '대표자' },
    { key: 'businessNumber', label: '사업자 번호' },
    { key: 'industry', label: '업종' },
    { key: 'address', label: '주소' },
    { key: 'status', label: '상태' },
    { key: 'assigneeUserIds', label: '담당자' },
    { key: 'memo', label: '메모' }
  ];
  const sortKey = sort.key;
  const assigneeIdToName = useMemo(() => {
    const map = {};
    (companyEmployees || []).forEach((e) => {
      const id = e.id != null ? String(e.id) : (e._id ? String(e._id) : null);
      if (id) map[id] = e.name || e.email || id;
    });
    return map;
  }, [companyEmployees]);
  const sortDir = sort.dir;
  /** URL로 연 상세 모달용: 목록에 없을 때 id로 따로 조회한 회사 (새로고침 시 items 비어 있을 수 있음) */
  const [detailCompanyById, setDetailCompanyById] = useState(null);
  const [loadingDetailCompany, setLoadingDetailCompany] = useState(false);
  const isAddModalOpen = searchParams.get(MODAL_PARAM) === MODAL_ADD_COMPANY;
  const isExcelImportOpen = searchParams.get(MODAL_PARAM) === MODAL_EXCEL_IMPORT;
  const detailId = searchParams.get(DETAIL_ID_PARAM);
  const isDetailOpen = searchParams.get(MODAL_PARAM) === MODAL_DETAIL && detailId;
  const selectedCompanyFromList = isDetailOpen
    ? items.find((c) => c._id === detailId) || null
    : null;
  const selectedCompany = selectedCompanyFromList || detailCompanyById;

  /** 사내 직원 목록 (담당자 열 이름 표시용) */
  useEffect(() => {
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
    fetch(`${API_BASE}/customer-companies/${detailId}`, { headers: getAuthHeader() })
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

  const fetchList = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (searchApplied) {
        params.set('search', searchApplied);
        if (searchField) params.set('searchField', searchField);
      }
      if (assigneeMeOnly) params.set('assigneeMe', '1');
      const url = `${API_BASE}/customer-companies?${params.toString()}`;
      const res = await fetch(url, { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setPagination(data.pagination || { page: 1, limit: LIMIT, total: 0, totalPages: 0 });
      } else {
        setItems([]);
        setPagination((p) => ({ ...p, total: 0, totalPages: 0 }));
      }
    } catch (_) {
      setItems([]);
      setPagination((p) => ({ ...p, total: 0, totalPages: 0 }));
    } finally {
      setLoading(false);
    }
  }, [searchApplied, searchField, assigneeMeOnly]);

  /** 검색·필터와 동일 조건으로 전체 고객사 목록 (전체 선택용) */
  const fetchAllCustomerCompaniesForSelection = useCallback(async () => {
    let page = 1;
    let totalPages = 1;
    const all = [];
    do {
      const params = new URLSearchParams({ page: String(page), limit: String(EXPORT_PAGE_LIMIT) });
      if (searchApplied) {
        params.set('search', searchApplied);
        if (searchField) params.set('searchField', searchField);
      }
      if (assigneeMeOnly) params.set('assigneeMe', '1');
      const res = await fetch(`${API_BASE}/customer-companies?${params.toString()}`, { headers: getAuthHeader() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || '목록을 가져오지 못했습니다.');
      }
      const data = await res.json();
      all.push(...(data.items || []));
      totalPages = Math.max(1, Number(data.pagination?.totalPages) || 1);
      page += 1;
    } while (page <= totalPages);
    return all;
  }, [searchApplied, searchField, assigneeMeOnly]);

  useEffect(() => { fetchList(pagination.page); }, [pagination.page, fetchList]);
  useEffect(() => {
    const onExcelImportDone = () => { fetchList(pagination.page); };
    window.addEventListener('cc-excel-import-completed', onExcelImportDone);
    return () => window.removeEventListener('cc-excel-import-completed', onExcelImportDone);
  }, [fetchList, pagination.page]);
  useEffect(() => { setPagination((p) => ({ ...p, page: 1 })); }, [searchApplied, searchField, assigneeMeOnly]);

  const loadCustomerCompanyCustomFieldColumns = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=customerCompany`, { headers: getAuthHeader() });
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

  const openAddModal = () => setSearchParams({ [MODAL_PARAM]: MODAL_ADD_COMPANY });
  const closeAddModal = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    setSearchParams(next, { replace: true });
  };

  const openDetailModal = (row) => {
    if (!row?._id) return;
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
      const res = await fetch(`${API_BASE}/customer-companies/${rowId}/favorite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ isFavorite: nextValue })
      });
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
    saveTemplate({ columnOrder: order, visible: template.visible });
  };

  const displayColumns = template.columns.filter((c) => template.visible[c.key]);
  const colSpan = Math.max(1, displayColumns.length);

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

  const sortedItems = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      const favDiff = Number(!!b.isFavorite) - Number(!!a.isFavorite);
      if (favDiff !== 0) return favDiff;
      if (!sortKey || sortKey === '_favorite') return 0;
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [items, sortKey, sortDir, getSortValue]);

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
      const rows = await fetchAllCustomerCompaniesForSelection();
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
  }, [pagination.total, selectedCompanyIds.size, fetchAllCustomerCompaniesForSelection]);

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
      const res = await fetch(`${API_BASE}/customer-company-employees?${params.toString()}`, { headers: getAuthHeader() });
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
        const ids = Array.isArray(row.assigneeUserIds) ? row.assigneeUserIds : [];
        const assignees = ids.map((id) => assigneeIdToName[String(id)] || String(id)).filter(Boolean).join(', ');
        const out = {
          고객사명: row.name || '',
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
            const empAssignees = (Array.isArray(emp.assigneeUserIds) ? emp.assigneeUserIds : [])
              .map((id) => assigneeIdToName[String(id)] || String(id))
              .filter(Boolean)
              .join(', ');
            employeeRows.push({
              고객사명: row.name || '',
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
  }, [canExportExcel, selectedCompanyIds, selectedCompanyMap, assigneeIdToName, customFieldColumns, fetchAllEmployeesForCompany]);

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
    <div className="page customer-companies-page">
      <header className="page-header">
        <div className="header-search">
          <button type="submit" form="customer-companies-search-form" className="header-search-icon-btn" aria-label="검색">
            <span className="material-symbols-outlined">search</span>
          </button>
          <form id="customer-companies-search-form" onSubmit={runSearch} className="header-search-form">
            <input
              type="text"
              placeholder={searchField ? `${SEARCH_FIELD_OPTIONS.find((o) => o.key === searchField)?.label || searchField} 검색...` : '모든 필드 검색 (고객사명, 대표자, 주소, 메모, 커스텀 필드 등)...'}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="고객사 검색"
            />
          </form>
          <select
            className="cc-sort-column-select"
            value={searchField}
            onChange={(e) => setSearchField(e.target.value)}
            aria-label="검색 필드"
          >
            <option value="">전체 필드</option>
            {SEARCH_FIELD_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="header-actions">
          <button type="button" className="icon-btn" aria-label="리스트 열 설정" onClick={() => { setTemplate(getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), customFieldColumns)); setSettingsOpen(true); }} title="리스트 열 설정">
            <span className="material-symbols-outlined">settings</span>
          </button>
          <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" />
        </div>
      </header>
      <div className="page-content">
        <div className="customer-companies-top">
          <div>
            <h2>고객사 리스트</h2>
            <p className="page-desc">
              총 {pagination.total || 0}개 고객사를 관리 중입니다
            </p>
          </div>
          <div className="customer-companies-actions">
            <button
              type="button"
              className={`icon-btn cc-assignee-filter-btn ${assigneeMeOnly ? 'active' : ''}`}
              onClick={() => {
                const next = !assigneeMeOnly;
                setSelectedCompanyIds(new Set());
                setSelectedCompanyMap({});
                setAssigneeMeOnly(next);
                patchListTemplate(LIST_ID, { assigneeMeOnly: next }).catch((err) => {
                  alert(err?.message || '저장에 실패했습니다.');
                  setAssigneeMeOnly(assigneeMeOnly);
                });
              }}
              title={assigneeMeOnly ? '전체 고객사 보기' : '내 담당 업체 보기'}
              aria-label={assigneeMeOnly ? '전체 고객사 보기' : '내 담당 업체 보기'}
            >
              <span className="material-symbols-outlined">person_pin_circle</span>
              <span className="cc-filter-label">내 담당 업체 보기</span>
            </button>
            <button
              type="button"
              className="icon-btn cc-assignee-filter-btn"
              onClick={openExcelImportModal}
              title="엑셀 파일을 매핑하여 고객사 일괄 등록"
              aria-label="엑셀 매핑 가져오기"
            >
              <span className="material-symbols-outlined">upload_file</span>
              <span className="cc-filter-label">엑셀 매핑</span>
            </button>
            {canExportExcel ? (
              <button
                type="button"
                className="btn-outline"
                onClick={handleExportSelectedCompanies}
                disabled={exportExcelLoading}
                title="선택한 고객사만 엑셀(.xlsx)로 내보냅니다. (Owner / Admin 전용)"
              >
                <span className="material-symbols-outlined">file_download</span>
                {exportExcelLoading ? '내보내는 중…' : `내보내기${selectedCompanyIds.size ? ` (${selectedCompanyIds.size})` : ''}`}
              </button>
            ) : null}
            {canManageCustomFieldDefinitions ? (
              <button
                type="button"
                className="btn-outline"
                onClick={() => setShowCustomFieldsManageModal(true)}
                title="고객사에 쓸 사용자 정의 필드를 추가합니다"
              >
                <span className="material-symbols-outlined">playlist_add</span>
                필드 추가
              </button>
            ) : null}
            <button type="button" className="btn-primary" onClick={openAddModal}><span className="material-symbols-outlined">add</span> 고객사 추가</button>
          </div>
        </div>
        {selectedCompanyIds.size > 0 && (
          <div className="cc-selection-action-bar">
            <span className="cc-selection-action-bar-count">
              <strong>{selectedCompanyIds.size}</strong>곳 선택됨
              <span className="cc-selection-action-bar-hint">Shift+클릭으로 범위 선택</span>
            </span>
            <div className="cc-selection-action-bar-btns">
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
              <button type="button" className="cc-selection-action-bar-cancel" onClick={clearCompanySelection}>
                선택 해제
              </button>
            </div>
          </div>
        )}
        <div className="panel table-panel">
          {/* 모바일 전용 카드 목록 (customerForMobile.html 구조) */}
          <div className="customer-companies-mobile-cards-wrap">
            {loading ? (
              <p className="customer-companies-mobile-cards-message">불러오는 중...</p>
            ) : sortedItems.length === 0 ? (
              <p className="customer-companies-mobile-cards-message">등록된 고객사가 없습니다.</p>
            ) : (
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
                        <p className="customer-companies-mobile-card-address">{row.address || '—'}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <colgroup>
                <col style={{ width: '3rem' }} />
                {displayColumns.map((col) => (
                  <col key={col.key} style={col.key === '_favorite' ? { width: '3.25rem' } : undefined} />
                ))}
              </colgroup>
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
                          : '현재 검색·내 담당 필터에 맞는 고객사 전부를 선택합니다. 다시 누르면 전체 해제합니다.'
                      }
                    />
                  </th>
                  {displayColumns.map((col) => (
                    <th
                      key={col.key}
                      className={`${col.key === '_favorite' ? 'cc-th-favorite' : ''} ${dragOverKey === col.key ? 'list-template-drag-over' : ''} ${col.key !== '_favorite' ? 'list-template-th-sortable' : ''}`}
                      draggable
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
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={colSpan + 1} className="text-center">불러오는 중...</td></tr>
                ) : sortedItems.length === 0 ? (
                  <tr><td colSpan={colSpan + 1} className="text-center">등록된 고객사가 없습니다.</td></tr>
                ) : (
                  sortedItems.map((row, idx) => (
                    <tr key={row._id} className="customer-companies-row-clickable" onClick={() => openDetailModal(row)}>
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
                      {displayColumns.map((col) => (
                        <td
                          key={col.key}
                          data-label={col.key === '_favorite' ? '' : col.label}
                          className={col.key === '_favorite' ? 'cc-td-favorite' : col.key === 'name' ? '' : 'text-muted'}
                          onClick={col.key === '_favorite' ? (e) => e.stopPropagation() : undefined}
                        >
                          {col.key === '_favorite' ? (
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
                          ) : col.key === 'name' ? (
                            <div className="cell-user cc-name-cell">
                              <div
                                className={`cc-name-cell-avatar cc-name-cell-avatar--${idx % 3}`}
                                aria-hidden
                              >
                                <span className="cc-name-cell-initials">{getNameInitials(row.name)}</span>
                              </div>
                              <div className="cc-name-cell-text">
                                <span className="font-semibold">{row.name || '—'}</span>
                                <span className="cc-name-cell-bn">{formatBusinessNumber(row.businessNumber)}</span>
                              </div>
                            </div>
                          ) : col.key === 'status' ? (
                            <span className={`status-badge status-${(row.status || 'active').toLowerCase()}`}>
                              {COMPANY_STATUS_LABEL[(row.status || 'active').toLowerCase()] || row.status || '—'}
                            </span>
                          ) : (
                            cellValue(row, col.key, assigneeIdToName, companyEmployeesLoaded)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="pagination-bar">
            <p className="pagination-info">
              <strong>{pagination.total}</strong>개 중 <strong>{items.length ? (pagination.page - 1) * pagination.limit + 1 : 0}</strong>–<strong>{(pagination.page - 1) * pagination.limit + items.length}</strong>건 표시
            </p>
            <ListPaginationButtons
              page={pagination.page}
              totalPages={pagination.totalPages || 1}
              onPageChange={(nextPage) => setPagination((p) => ({ ...p, page: nextPage }))}
            />
          </div>
        </div>
      </div>
      {settingsOpen && (
        <ListTemplateModal
          listId={LIST_ID}
          columns={template.columns}
          visible={template.visible}
          columnOrder={template.columnOrder}
          onSave={saveTemplate}
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
          onClose={closeAddModal}
          onSaved={() => { fetchList(pagination.page); closeAddModal(); }}
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
            fetchList(pagination.page);
          }}
          onDeleted={() => {
            fetchList(pagination.page);
            closeDetailModal();
          }}
        />
      )}
      {handoverCtx && (
        <AssigneeHandoverModal
          open
          onClose={() => setHandoverCtx(null)}
          onSubmitted={() => {
            fetchList(pagination.page);
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
    </div>
  );
}
