import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import AddContactModal from './add-customer-company-employees-modal/add-customer-company-employees-modal';
import ContactDetailModal from './customer-company-employees-detail-modal/customer-company-employees-detail-modal';
import SmsDraftModal, { phoneToSmsHref } from './sms-draft-modal/sms-draft-modal';
import { loadSmsBulkHistory, removeSmsBulkHistoryEntry, saveBulkSmsAfterSend, updateSmsBulkHistoryEntry } from './sms-bulk-history';
import SmsBulkHistoryModal from './sms-bulk-history-modal/sms-bulk-history-modal.jsx';
import EmailComposeModal from '../email/email-compose-modal.jsx';
import ListTemplateModal from '../components/list-template-modal/list-template-modal';
import {
  LIST_IDS,
  getSavedTemplate,
  getEffectiveTemplate,
  patchListTemplate
} from '../lib/list-templates';
import './customer-company-employees.css';
import './customer-company-employees-responsive.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';

import * as XLSX from 'xlsx';

import { API_BASE } from '@/config';
const LIST_ID = LIST_IDS.CUSTOMER_COMPANY_EMPLOYEES;
const EXPORT_PAGE_LIMIT = 100;
const MODAL_PARAM = 'modal';
const MODAL_ADD_CONTACT = 'add-contact';
const MODAL_DETAIL = 'detail';
const DETAIL_ID_PARAM = 'id';
const LIMIT = 10;

/** 페이지네이션에 표시할 번호 목록 (현재 페이지 주변 + 첫/끝, 생략은 '...') */
function getPageNumbers(current, total) {
  if (total <= 0) return [];
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('...');
    result.push(sorted[i]);
  }
  return result;
}

/** 리스트에서 `tel:` 로 모바일 전화·데스크톱 기본 전화 앱 연결 */
function phoneToTelHref(phone) {
  if (phone == null) return '';
  const s = String(phone).trim();
  if (!s) return '';
  const cleaned = s.replace(/[^\d+]/g, '');
  if (!cleaned || !cleaned.replace(/\+/g, '')) return '';
  return `tel:${cleaned}`;
}

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const statusClass = { Active: 'status-active', Pending: 'status-pending', Lead: 'status-lead', Inactive: 'status-inactive' };
const statusLabel = { Active: '활성', Pending: '대기', Lead: '리드', Inactive: '비활성' };
const statusHint = { Lead: '잠재 고객', Active: '거래 진행 중', Pending: '회신 대기', Inactive: '관리 종료' };
const STATUS_OPTIONS = ['', 'Lead', 'Active', 'Pending', 'Inactive'];
const CUSTOM_FIELDS_PREFIX = 'customFields.';

export default function CustomerCompanyEmployees() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: LIMIT, total: 0, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [assigneeMeOnly, setAssigneeMeOnly] = useState(() => getSavedTemplate(LIST_ID)?.assigneeMeOnly === true);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState(new Set());
  /** 선택 ID별 행 스냅샷 — 페이지를 넘겨도 단체 문자·메일·구글 저장에 사용 */
  const selectedRowsRef = useRef(new Map());
  const lastClickedIdx = useRef(null);
  const headerSelectAllRef = useRef(null);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    selectedRowsRef.current.clear();
    lastClickedIdx.current = null;
  }, []);
  const [googleSaving, setGoogleSaving] = useState(false);
  const [googleResult, setGoogleResult] = useState(null);
  const [customFieldColumns, setCustomFieldColumns] = useState([]);
  const [template, setTemplate] = useState(() => getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID)));
  const [dragOverKey, setDragOverKey] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [exportExcelLoading, setExportExcelLoading] = useState(false);
  const [selectAllLoading, setSelectAllLoading] = useState(false);
  const [smsModal, setSmsModal] = useState(null);
  /** `null` = 닫힘, 배열 = 선택 행(전화 있는 사람만) */
  const [bulkSmsRows, setBulkSmsRows] = useState(null);
  /** 기록에서 다시 보내기 시 단체 모달에 넣을 제목·본문 */
  const [bulkSmsPrefill, setBulkSmsPrefill] = useState(null);
  /** 기록에서 연 경우 문자 앱 열 때 같은 기록만 갱신 */
  const [bulkSmsHistoryEntryId, setBulkSmsHistoryEntryId] = useState(null);
  const [smsHistoryOpen, setSmsHistoryOpen] = useState(false);
  const [smsHistoryTick, setSmsHistoryTick] = useState(0);
  /** `{ initialTo }` — 단체 시 쉼표로 구분된 수신자 */
  const [emailCompose, setEmailCompose] = useState(null);
  const sortKey = sort.key;
  const sortDir = sort.dir;
  const [companyEmployees, setCompanyEmployees] = useState([]);
  const [companyEmployeesLoaded, setCompanyEmployeesLoaded] = useState(false);
  const [searchField, setSearchField] = useState('');
  const SEARCH_FIELD_OPTIONS = [
    { key: 'name', label: '이름' },
    { key: 'company', label: '회사' },
    { key: 'email', label: '이메일' },
    { key: 'phone', label: '전화' },
    { key: 'position', label: '직책' },
    { key: 'address', label: '주소' },
    { key: 'status', label: '상태' },
    { key: 'assigneeUserIds', label: '담당자' },
    { key: 'memo', label: '메모' }
  ];
  const assigneeIdToName = useMemo(() => {
    const map = {};
    (companyEmployees || []).forEach((e) => {
      const id = e.id != null ? String(e.id) : (e._id ? String(e._id) : null);
      if (id) map[id] = e.name || e.email || id;
    });
    return map;
  }, [companyEmployees]);

  const customFieldLabelByKey = useMemo(() => {
    const m = {};
    customFieldColumns.forEach((c) => {
      if (!c?.key?.startsWith(CUSTOM_FIELDS_PREFIX)) return;
      const fk = c.key.slice(CUSTOM_FIELDS_PREFIX.length);
      m[fk] = (c.label || fk).trim() || fk;
    });
    return m;
  }, [customFieldColumns]);
  /** URL로 연 상세 모달용: 목록에 없을 때 id로 따로 조회한 연락처 (새로고침·다른 페이지일 수 있음) */
  const [detailContactById, setDetailContactById] = useState(null);
  const [loadingDetailContact, setLoadingDetailContact] = useState(false);

  const isAddModalOpen = searchParams.get(MODAL_PARAM) === MODAL_ADD_CONTACT;
  const detailId = searchParams.get(DETAIL_ID_PARAM);
  const isDetailOpen = searchParams.get(MODAL_PARAM) === MODAL_DETAIL && detailId;
  const selectedContactFromList = isDetailOpen ? items.find((c) => c._id === detailId) || null : null;
  const selectedContact = selectedContactFromList || detailContactById;

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

  /** URL에 id가 있는데 목록에서 못 찾았을 때(로딩 중·다른 페이지·직접 링크) id로 연락처 한 건 조회 */
  useEffect(() => {
    if (!isDetailOpen || !detailId || selectedContactFromList) {
      if (!isDetailOpen) setDetailContactById(null);
      return;
    }
    setLoadingDetailContact(true);
    let cancelled = false;
    fetch(`${API_BASE}/customer-company-employees/${detailId}`, { headers: getAuthHeader() })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        if (data._id) setDetailContactById(data);
        else setDetailContactById(null);
      })
      .catch(() => { if (!cancelled) setDetailContactById(null); })
      .finally(() => { if (!cancelled) setLoadingDetailContact(false); });
    return () => { cancelled = true; };
  }, [isDetailOpen, detailId, selectedContactFromList]);

  const openAddModal = () => setSearchParams({ [MODAL_PARAM]: MODAL_ADD_CONTACT });
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
    setDetailContactById(null);
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    next.delete(DETAIL_ID_PARAM);
    setSearchParams(next, { replace: true });
  };

  const fetchContacts = useCallback(async (page = 1, overrideStatus) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: LIMIT });
      if (search.trim()) {
        params.set('search', search.trim());
        if (searchField) params.set('searchField', searchField);
      }
      const st = overrideStatus !== undefined ? overrideStatus : '';
      if (st) params.set('status', st);
      if (assigneeMeOnly) params.set('assigneeMe', '1');
      const res = await fetch(`${API_BASE}/customer-company-employees?${params}`, { headers: getAuthHeader() });
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
  }, [search, searchField, assigneeMeOnly]);

  useEffect(() => { fetchContacts(pagination.page); }, [pagination.page, fetchContacts]);

  /** 새 연락처 추가 시 정의된 커스텀 필드를 리스트 템플릿에 반영 */
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/custom-field-definitions?entityType=contact`, { headers: getAuthHeader() })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        const defs = Array.isArray(data?.items) ? data.items : [];
        const extra = defs.map((d) => ({ key: `${CUSTOM_FIELDS_PREFIX}${d.key}`, label: d.label || d.key || '' }));
        setCustomFieldColumns(extra);
        setTemplate((prev) => getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), extra));
      })
      .catch(() => { if (!cancelled) setCustomFieldColumns([]); });
    return () => { cancelled = true; };
  }, []);

  const onSearch = (e) => {
    e?.preventDefault();
    clearSelection();
    setPagination((p) => ({ ...p, page: 1 }));
    fetchContacts(1);
  };

  const handleToggleFavorite = async (rowId, nextValue) => {
    if (!rowId) return;
    try {
      const res = await fetch(`${API_BASE}/customer-company-employees/${rowId}/favorite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ isFavorite: nextValue })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setItems((prev) => prev.map((row) => (
        row._id === rowId ? { ...row, isFavorite: !!data.isFavorite } : row
      )));
      setDetailContactById((prev) => (
        prev?._id === rowId ? { ...prev, isFavorite: !!data.isFavorite } : prev
      ));
      fetchContacts(pagination.page);
    } catch (_) {}
  };

  const handleSaveToGoogle = async () => {
    const rows = [...selected].map((id) => selectedRowsRef.current.get(id)).filter(Boolean);
    const contacts = rows.map((r) => ({
      name: r.name || '',
      email: r.email || '',
      phone: r.phone || '',
      company: r.company || ''
    }));
    if (contacts.length === 0) return;
    setGoogleSaving(true);
    setGoogleResult(null);
    try {
      const res = await fetch(`${API_BASE}/google-contacts/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ contacts })
      });
      const data = await res.json();
      if (res.ok) {
        setGoogleResult({ success: data.success, fail: data.fail, total: data.total, errors: data.errors });
        if (data.success > 0) clearSelection();
      } else {
        setGoogleResult({ error: data.error || 'Google 주소록 저장에 실패했습니다.', needsReauth: data.needsReauth });
      }
    } catch (_) {
      setGoogleResult({ error: '서버에 연결할 수 없습니다.' });
    } finally {
      setGoogleSaving(false);
    }
  };

  const formatDate = (d) => {
    if (!d) return '—';
    const date = new Date(d);
    const now = new Date();
    const diffMs = now - date;
    if (diffMs < 0) return date.toLocaleDateString('ko-KR');
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return '방금 전';
    if (diffMin < 60) return `${diffMin}분 전`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}시간 전`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay}일 전`;
    return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const smsBulkHistoryList = useMemo(() => loadSmsBulkHistory(), [smsHistoryTick]);

  const handleBulkSmsOpened = useCallback((payload) => {
    saveBulkSmsAfterSend(payload);
    setSmsHistoryTick((t) => t + 1);
  }, []);

  const resendBulkSmsFromHistory = useCallback((entry) => {
    const withPhone = (entry.contacts || []).filter((r) => phoneToSmsHref(r?.phone, ''));
    if (withPhone.length === 0) {
      window.alert('저장된 연락처에 전화번호가 있는 사람이 없어 다시 보낼 수 없습니다.');
      return;
    }
    setBulkSmsPrefill({ title: entry.title || '', body: entry.body ?? '' });
    setBulkSmsRows(withPhone);
    setBulkSmsHistoryEntryId(entry.id);
    setSmsHistoryOpen(false);
  }, []);

  const handleHistoryContactsUpdate = useCallback((entryId, contacts) => {
    updateSmsBulkHistoryEntry(entryId, { contacts });
    setSmsHistoryTick((t) => t + 1);
  }, []);

  const deleteSmsBulkHistoryEntryCb = useCallback((id) => {
    removeSmsBulkHistoryEntry(id);
    setSmsHistoryTick((t) => t + 1);
  }, []);

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
    if (key === 'company') return (row.company || '').toLowerCase();
    if (key === 'name') return (row.name || '').toLowerCase();
    if (key === 'email') return (row.email || '').toLowerCase();
    if (key === 'phone') return (row.phone || '').toLowerCase();
    if (key === 'status') return (row.status || '').toLowerCase();
    if (key === 'assigneeUserIds') {
      const ids = Array.isArray(row.assigneeUserIds) ? row.assigneeUserIds : [];
      const names = ids.map((id) => assigneeIdToName[String(id)] || '').filter(Boolean);
      return names.join(' ').toLowerCase();
    }
    if (key === 'lastSupportedAt') return new Date(row.lastSupportedAt || 0).getTime();
    if (key.startsWith(CUSTOM_FIELDS_PREFIX)) {
      const fieldKey = key.slice(CUSTOM_FIELDS_PREFIX.length);
      const v = row.customFields?.[fieldKey];
      return (v !== undefined && v !== null ? String(v) : '').toLowerCase();
    }
    return '';
  }, [assigneeIdToName]);

  const sortedItems = useMemo(() => {
    const base = [...items].sort((a, b) => {
      const favDiff = Number(!!b.isFavorite) - Number(!!a.isFavorite);
      if (favDiff !== 0) return favDiff;
      if (!sortKey || sortKey === '_check' || sortKey === '_favorite') return 0;
      const dir = sortDir === 'asc' ? 1 : -1;
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return base;
  }, [items, sortKey, sortDir, getSortValue]);

  const handleCheckboxClick = useCallback((idx, e) => {
    e.stopPropagation();
    setGoogleResult(null);

    if (e.shiftKey && lastClickedIdx.current !== null) {
      const start = Math.min(lastClickedIdx.current, idx);
      const end = Math.max(lastClickedIdx.current, idx);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          const row = sortedItems[i];
          if (row) {
            next.add(row._id);
            selectedRowsRef.current.set(row._id, row);
          }
        }
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        const row = sortedItems[idx];
        if (!row) return next;
        const id = row._id;
        if (next.has(id)) {
          next.delete(id);
          selectedRowsRef.current.delete(id);
        } else {
          next.add(id);
          selectedRowsRef.current.set(id, row);
        }
        return next;
      });
    }
    lastClickedIdx.current = idx;
  }, [sortedItems]);

  const handleSortColumn = useCallback((key) => {
    if (key === '_check' || key === '_favorite') return;
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { key, dir: 'asc' };
    });
  }, []);

  const fetchAllContactsForExport = useCallback(async () => {
    let page = 1;
    let totalPages = 1;
    const all = [];
    do {
      const params = new URLSearchParams({ page: String(page), limit: String(EXPORT_PAGE_LIMIT) });
      if (search.trim()) {
        params.set('search', search.trim());
        if (searchField) params.set('searchField', searchField);
      }
      if (assigneeMeOnly) params.set('assigneeMe', '1');
      const res = await fetch(`${API_BASE}/customer-company-employees?${params}`, { headers: getAuthHeader() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || '목록을 가져오지 못했습니다.');
      }
      const data = await res.json();
      const batch = data.items || [];
      all.push(...batch);
      totalPages = Math.max(1, Number(data.pagination?.totalPages) || 1);
      page += 1;
    } while (page <= totalPages);
    return all;
  }, [search, searchField, assigneeMeOnly]);

  /** 검색·필터 결과 전체가 선택됐는지 (헤더 체크박스) */
  const allChecked =
    (pagination.total || 0) > 0 && selected.size === pagination.total;

  /** 헤더 체크: 현재 조건의 전체 연락처 선택 / 이미 전체면 전체 해제 */
  const handleSelectAll = useCallback(async () => {
    setGoogleResult(null);
    const total = pagination.total || 0;
    if (total === 0) return;

    if (selected.size === total) {
      clearSelection();
      return;
    }

    setSelectAllLoading(true);
    try {
      const rows = await fetchAllContactsForExport();
      const next = new Set();
      selectedRowsRef.current.clear();
      for (const r of rows) {
        if (r?._id) {
          next.add(r._id);
          selectedRowsRef.current.set(r._id, r);
        }
      }
      setSelected(next);
    } catch (e) {
      window.alert(e?.message || '전체 선택에 실패했습니다.');
    } finally {
      setSelectAllLoading(false);
    }
  }, [pagination.total, selected.size, fetchAllContactsForExport, clearSelection]);

  useEffect(() => {
    const el = headerSelectAllRef.current;
    if (!el) return;
    const total = pagination.total || 0;
    el.indeterminate = total > 0 && selected.size > 0 && selected.size < total;
  }, [selected.size, pagination.total]);

  const handleDownloadExcel = useCallback(async () => {
    setExportExcelLoading(true);
    try {
      const rows = await fetchAllContactsForExport();
      if (rows.length === 0) {
        alert('다운로드할 연락처가 없습니다.');
        return;
      }
      const nameMap = assigneeIdToName;
      const customKeys = new Set();
      rows.forEach((r) => {
        if (r.customFields && typeof r.customFields === 'object') {
          Object.keys(r.customFields).forEach((k) => customKeys.add(k));
        }
      });
      const sortedCustomKeys = [...customKeys].sort();
      const exportRows = rows.map((row) => {
        const ids = Array.isArray(row.assigneeUserIds) ? row.assigneeUserIds : [];
        const 담당자 = ids.map((id) => nameMap[String(id)] || String(id)).filter(Boolean).join(', ');
        const cc = row.customerCompanyId && typeof row.customerCompanyId === 'object' ? row.customerCompanyId : null;
        const o = {
          이름: row.name || '',
          회사: row.company || cc?.name || row.companyName || '',
          직접입력회사명: row.companyName && !cc?.name ? row.companyName : '',
          이메일: row.email || '',
          전화: row.phone || '',
          직책: row.position || '',
          주소: row.address || '',
          상태: row.status ? statusLabel[row.status] || row.status : '',
          담당자,
          최근지원일: row.lastSupportedAt ? new Date(row.lastSupportedAt).toLocaleString('ko-KR') : '',
          즐겨찾기: row.isFavorite ? 'Y' : '',
          사업자번호: cc?.businessNumber || '',
          메모: row.memo || '',
          생년월일: row.birthDate != null && row.birthDate !== '' ? String(row.birthDate) : '',
          수정일: row.updatedAt ? new Date(row.updatedAt).toLocaleString('ko-KR') : ''
        };
        sortedCustomKeys.forEach((fk) => {
          const colName = customFieldLabelByKey[fk] || `커스텀_${fk}`;
          const v = row.customFields?.[fk];
          o[colName] = v !== undefined && v !== null && v !== '' ? String(v) : '';
        });
        return o;
      });
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportRows);
      XLSX.utils.book_append_sheet(wb, ws, '연락처');
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `연락처목록_${stamp}.xlsx`);
    } catch (e) {
      alert(e?.message || '엑셀 저장에 실패했습니다.');
    } finally {
      setExportExcelLoading(false);
    }
  }, [fetchAllContactsForExport, assigneeIdToName, customFieldLabelByKey]);

  const openBulkSmsFromSelection = useCallback(() => {
    const rows = [...selected].map((id) => selectedRowsRef.current.get(id)).filter(Boolean);
    const withPhone = rows.filter((r) => phoneToSmsHref(r.phone, ''));
    const skipped = rows.length - withPhone.length;
    if (withPhone.length === 0) {
      window.alert('선택한 연락처에 전화번호가 있는 사람이 없습니다.');
      return;
    }
    if (skipped > 0) {
      window.alert(`전화번호가 없는 ${skipped}명은 제외하고 ${withPhone.length}명에게 단체 문자를 준비합니다.`);
    }
    setBulkSmsPrefill(null);
    setBulkSmsHistoryEntryId(null);
    setBulkSmsRows(withPhone);
  }, [selected]);

  const openBulkEmailFromSelection = useCallback(() => {
    const rows = [...selected].map((id) => selectedRowsRef.current.get(id)).filter(Boolean);
    const withEmail = rows.filter((r) => String(r.email || '').trim());
    const skipped = rows.length - withEmail.length;
    if (withEmail.length === 0) {
      window.alert('선택한 연락처에 이메일이 있는 사람이 없습니다.');
      return;
    }
    if (skipped > 0) {
      window.alert(`이메일이 없는 ${skipped}명은 제외하고 ${withEmail.length}명의 주소로 메일 작성 화면을 엽니다.`);
    }
    const unique = [...new Set(withEmail.map((r) => String(r.email).trim()))];
    setEmailCompose({ initialTo: unique.join(', ') });
  }, [selected]);

  return (
    <div className="page customer-company-employees-page">
      <header className="page-header">
        <div className="header-search">
          <button type="submit" form="customer-company-employees-search-form" className="header-search-icon-btn" aria-label="검색">
            <span className="material-symbols-outlined">search</span>
          </button>
          <form id="customer-company-employees-search-form" onSubmit={onSearch}>
            <input
              type="text"
              placeholder={searchField ? `${SEARCH_FIELD_OPTIONS.find((o) => o.key === searchField)?.label || searchField} 검색...` : '모든 필드 검색 (이름, 회사, 이메일, 전화, 직책, 메모, 커스텀 필드 등)...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
          <select
            className="cce-sort-column-select"
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
          <button
            type="button"
            className="icon-btn cce-sms-history-header-btn"
            aria-label="단체 문자 기록"
            title="문자 앱으로 열었던 단체 문자 기록 (이 브라우저에만 저장)"
            onClick={() => setSmsHistoryOpen(true)}
          >
            <span className="material-symbols-outlined">chat</span>
            {smsBulkHistoryList.length > 0 ? (
              <span className="cce-sms-history-badge" aria-hidden>
                {smsBulkHistoryList.length > 99 ? '99+' : smsBulkHistoryList.length}
              </span>
            ) : null}
          </button>
          <button type="button" className="icon-btn" aria-label="리스트 열 설정" onClick={() => { setTemplate(getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), customFieldColumns)); setSettingsOpen(true); }} title="리스트 열 설정">
            <span className="material-symbols-outlined">settings</span>
          </button>
          <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" />
        </div>
      </header>
      <div className="page-content">
        <div className="customer-company-employees-top">
          <div>
            <h2>연락처</h2>
            <p className="page-desc">총 {pagination.total || 0}건의 연락처를 관리 중입니다</p>
          </div>
          <div className="customer-company-employees-actions">
            <button
              type="button"
              className={`icon-btn cce-assignee-filter-btn ${assigneeMeOnly ? 'active' : ''}`}
              onClick={() => {
                const next = !assigneeMeOnly;
                clearSelection();
                setAssigneeMeOnly(next);
                patchListTemplate(LIST_ID, { assigneeMeOnly: next }).catch((err) => {
                  alert(err?.message || '저장에 실패했습니다.');
                  setAssigneeMeOnly(assigneeMeOnly);
                });
              }}
              title={assigneeMeOnly ? '전체 연락처 보기' : '내 담당 직원 보기'}
              aria-label={assigneeMeOnly ? '전체 연락처 보기' : '내 담당 직원 보기'}
            >
              <span className="material-symbols-outlined">person_pin_circle</span>
              <span className="cce-filter-label">내 담당 직원 보기</span>
            </button>
            <button
              type="button"
              className="btn-outline cce-excel-export-btn"
              onClick={handleDownloadExcel}
              disabled={exportExcelLoading}
              title="현재 검색·내 담당 필터에 맞는 연락처 전체를 엑셀(.xlsx)로 받습니다."
            >
              <span className="material-symbols-outlined">download</span>
              {exportExcelLoading ? '준비 중…' : '엑셀 내려받기'}
            </button>
            <button type="button" className="btn-primary" onClick={openAddModal}><span className="material-symbols-outlined">add</span> 새 연락처 추가</button>
          </div>
        </div>

        {/* 선택 액션 바 */}
        {selected.size > 0 && (
          <div className="cce-action-bar">
            <span className="cce-action-bar-count">
              <strong>{selected.size}</strong>명 선택됨
              <span className="cce-action-bar-hint">Shift+클릭으로 범위 선택</span>
            </span>
            <div className="cce-action-bar-btns">
              <button
                type="button"
                className="cce-action-bar-sms-bulk"
                onClick={openBulkSmsFromSelection}
                title="동일 본문으로 문자 앱에 수신자를 한꺼번에 넣습니다 (기기·앱에 따라 다를 수 있음). 연락처마다 이름이 필요하면 모달에서 개별 발송을 선택하세요."
              >
                <span className="material-symbols-outlined" aria-hidden>sms</span>
                선택 {selected.size}명에게 문자 (단체)
              </button>
              <button
                type="button"
                className="cce-action-bar-email-bulk"
                onClick={openBulkEmailFromSelection}
                title="이메일이 있는 연락처만 받는 사람 칸에 넣고 새 메일 작성을 엽니다 (중복 주소는 한 번만)."
              >
                <span className="material-symbols-outlined" aria-hidden>mail</span>
                선택 {selected.size}명에게 메일 (단체)
              </button>
              <button
                type="button"
                className="cce-action-bar-google"
                onClick={handleSaveToGoogle}
                disabled={googleSaving}
              >
                <img src="https://www.gstatic.com/images/branding/product/1x/contacts_2022_48dp.png" alt="" className="cce-action-google-icon" />
                {googleSaving ? '저장 중...' : `구글 주소록에 저장 (${selected.size}명)`}
              </button>
              <button type="button" className="cce-action-bar-cancel" onClick={clearSelection}>선택 해제</button>
            </div>
          </div>
        )}

        {/* Google 저장 결과 */}
        {googleResult && (
          <div className={`cce-google-result ${googleResult.error ? 'error' : googleResult.fail > 0 ? 'warn' : 'ok'}`}>
            <span className="material-symbols-outlined">
              {googleResult.error ? 'error' : googleResult.fail > 0 ? 'info' : 'check_circle'}
            </span>
            {googleResult.error
              ? <>{googleResult.error}{googleResult.needsReauth && <> (Google 계정으로 재로그인 필요)</>}</>
              : <>
                  총 {googleResult.total}명 중 <strong>{googleResult.success}명</strong> 저장 완료
                  {googleResult.fail > 0 && <>, {googleResult.fail}명 실패</>}
                  {googleResult.errors?.length > 0 && (
                    <span className="cce-google-result-detail"> — {googleResult.errors[0].detail?.slice(0, 80)}</span>
                  )}
                </>
            }
            <button type="button" className="cce-google-result-dismiss" onClick={() => setGoogleResult(null)}>×</button>
          </div>
        )}

        <div className="panel table-panel">
          {/* 모바일 전용 카드 목록 (customerForMobile.html 구조) */}
          <div className="cce-mobile-cards-wrap">
            {loading ? (
              <p className="cce-mobile-cards-message">불러오는 중...</p>
            ) : sortedItems.length === 0 ? (
              <p className="cce-mobile-cards-message">등록된 연락처가 없습니다.</p>
            ) : (
              <div className="cce-mobile-cards-list">
                {sortedItems.map((row, idx) => (
                  <div
                    key={row._id}
                    className="cce-mobile-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => openDetailModal(row)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetailModal(row); } }}
                  >
                    <div className="cce-mobile-card-avatar">
                      <div className="avatar-img" aria-hidden />
                    </div>
                    <div className="cce-mobile-card-body">
                      <div className="cce-mobile-card-controls">
                        <input
                          type="checkbox"
                          className="cce-row-checkbox cce-mobile-card-checkbox"
                          checked={selected.has(row._id)}
                          aria-label={`${row.name || '연락처'} 선택`}
                          onChange={() => {}}
                          onClick={(e) => handleCheckboxClick(idx, e)}
                        />
                        <button
                          type="button"
                          className={`cce-favorite-btn cce-mobile-favorite-btn ${row.isFavorite ? 'is-active' : ''}`}
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
                      <div className="cce-mobile-card-head">
                        <h3 className="cce-mobile-card-name">{row.name || '—'}</h3>
                        <div className="cce-mobile-card-head-actions">
                          <span className={`cce-mobile-card-status status-badge ${statusClass[row.status] || ''}`}>
                            {statusLabel[row.status] || row.status || '—'}
                          </span>
                        </div>
                      </div>
                      <p className="cce-mobile-card-company">{row.company || '—'}</p>
                      <div className="cce-mobile-card-details">
                        <div className="cce-mobile-card-email">
                          <span className="material-symbols-outlined cce-email-icon" aria-hidden>mail</span>
                          <span className="cce-mobile-card-email-text">{row.email || '—'}</span>
                          {String(row.email || '').trim() ? (
                            <button
                              type="button"
                              className="cce-email-compose-btn"
                              title="메일 작성"
                              aria-label={`${String(row.email).trim()}에게 메일 작성`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setEmailCompose({ initialTo: String(row.email).trim() });
                              }}
                            >
                              <span className="material-symbols-outlined" aria-hidden>edit</span>
                            </button>
                          ) : null}
                        </div>
                        {(() => {
                          const telHref = phoneToTelHref(row.phone);
                          const display = row.phone || '—';
                          return (
                            <div className="cce-mobile-card-phone">
                              <span className="material-symbols-outlined" aria-hidden>call</span>
                              <div className="cce-mobile-card-phone-content">
                                {!row.phone?.trim() || !telHref ? (
                                  <span className="cce-mobile-card-phone-text">{display}</span>
                                ) : (
                                  <>
                                    <span className="cce-mobile-card-phone-text">{display}</span>
                                    <div className="cce-phone-action-btns">
                                      <a
                                        href={telHref}
                                        className="cce-phone-call-btn cce-mobile-card-call-btn"
                                        title="전화 걸기"
                                        aria-label={`전화 걸기 ${display}`}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <span className="material-symbols-outlined" aria-hidden>call</span>
                                      </a>
                                      <button
                                        type="button"
                                        className="cce-phone-sms-btn cce-mobile-card-call-btn"
                                        title="문자 (AI 초안 후 전송)"
                                        aria-label={`문자 보내기 ${display}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSmsModal({
                                            phone: row.phone,
                                            recipientName: row.name || '',
                                            companyName: row.company || ''
                                          });
                                        }}
                                      >
                                        <span className="material-symbols-outlined" aria-hidden>sms</span>
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                        <p className="cce-mobile-card-meta">
                          최근 지원: {row.lastSupportedAt ? formatDate(row.lastSupportedAt) : '—'}
                        </p>
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
                {displayColumns.map((col) => (
                  <col
                    key={col.key}
                    style={
                      col.key === '_check'
                        ? { width: '2.75rem' }
                        : col.key === '_favorite'
                          ? { width: '3.25rem' }
                          : undefined
                    }
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {displayColumns.map((col) => (
                    <th
                      key={col.key}
                      className={`${col.key === '_check' ? 'cce-th-check' : ''} ${col.key === '_favorite' ? 'cce-th-favorite' : ''} ${col.key === 'status' ? 'cce-td-status' : ''} ${dragOverKey === col.key ? 'list-template-drag-over' : ''} ${col.key !== '_check' && col.key !== '_favorite' ? 'list-template-th-sortable' : ''}`}
                      draggable
                      onDragStart={(e) => handleHeaderDragStart(e, col.key)}
                      onDragOver={(e) => handleHeaderDragOver(e, col.key)}
                      onDragLeave={handleHeaderDragLeave}
                      onDrop={(e) => handleHeaderDrop(e, col.key)}
                      onClick={col.key !== '_check' && col.key !== '_favorite' ? () => handleSortColumn(col.key) : undefined}
                    >
                      {col.key === '_check' ? (
                        <input
                          ref={headerSelectAllRef}
                          type="checkbox"
                          className="cce-row-checkbox"
                          checked={allChecked}
                          disabled={selectAllLoading || loading || (pagination.total || 0) === 0}
                          onChange={handleSelectAll}
                          aria-label={
                            selectAllLoading
                              ? '전체 연락처 불러오는 중'
                              : '검색·필터 결과 전체 선택'
                          }
                          title={
                            selectAllLoading
                              ? '목록을 불러오는 중…'
                              : '현재 검색·내 담당 필터에 맞는 연락처 전부를 선택합니다. 다시 누르면 전체 해제합니다.'
                          }
                        />
                      ) : col.key === '_favorite' ? (
                        <span className="cce-th-favorite-icon material-symbols-outlined" aria-hidden>star</span>
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
                  <tr><td colSpan={colSpan} className="text-center">불러오는 중...</td></tr>
                ) : sortedItems.length === 0 ? (
                  <tr><td colSpan={colSpan} className="text-center">등록된 연락처가 없습니다.</td></tr>
                ) : (
                  sortedItems.map((row, idx) => {
                    const isChecked = selected.has(row._id);
                    return (
                      <tr
                        key={row._id}
                        className={`customer-company-employees-row-clickable ${isChecked ? 'cce-row-selected' : ''}`}
                        onClick={() => openDetailModal(row)}
                      >
                        {displayColumns.map((col) => (
                          <td
                            key={col.key}
                            data-label={col.key === '_check' || col.key === '_favorite' ? '' : col.label}
                            className={col.key === '_check' ? 'cce-td-check' : col.key === '_favorite' ? 'cce-td-favorite' : col.key === 'status' ? 'cce-td-status' : col.key !== 'name' ? 'text-muted' : ''}
                            onClick={col.key === '_check' || col.key === '_favorite' ? (e) => e.stopPropagation() : undefined}
                          >
                            {col.key === '_check' && (
                              <input
                                type="checkbox"
                                className="cce-row-checkbox"
                                checked={isChecked}
                                onChange={() => {}}
                                onClick={(e) => handleCheckboxClick(idx, e)}
                              />
                            )}
                            {col.key === '_favorite' && (
                              <button
                                type="button"
                                className={`cce-favorite-btn ${row.isFavorite ? 'is-active' : ''}`}
                                aria-label={row.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 등록'}
                                title={row.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 등록'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleFavorite(row._id, !row.isFavorite);
                                }}
                              >
                                <span className="material-symbols-outlined" aria-hidden>
                                  {row.isFavorite ? 'star' : 'star'}
                                </span>
                              </button>
                            )}
                            {col.key === 'company' && (() => {
                              const hasConfirmedCompany = row.customerCompanyId && String(row.customerCompanyId.businessNumber || '').trim();
                              const unconfirmed = row.company && !hasConfirmedCompany;
                              return (
                                <span className={unconfirmed ? 'cce-company-unconfirmed' : undefined}>
                                  {row.company || '—'}
                                </span>
                              );
                            })()}
                            {col.key === 'name' && (
                              <div className="cell-user">
                                <div className="avatar-img" />
                                <span className="font-semibold">{row.name || '—'}</span>
                              </div>
                            )}
                            {col.key === 'email' &&
                              (() => {
                                const em = String(row.email || '').trim();
                                return (
                                  <span className="cce-email-cell">
                                    <span className="material-symbols-outlined cce-email-icon" aria-hidden>
                                      mail
                                    </span>
                                    <span className="cce-email-text">{em || '—'}</span>
                                    {em ? (
                                      <button
                                        type="button"
                                        className="cce-email-compose-btn"
                                        title="메일 작성"
                                        aria-label={`${em}에게 메일 작성`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEmailCompose({ initialTo: em });
                                        }}
                                      >
                                        <span className="material-symbols-outlined" aria-hidden>edit</span>
                                      </button>
                                    ) : null}
                                  </span>
                                );
                              })()}
                            {col.key === 'phone' && (() => {
                              const telHref = phoneToTelHref(row.phone);
                              const display = row.phone || '—';
                              if (!row.phone?.trim() || !telHref) return display;
                              return (
                                <span className="cce-phone-cell">
                                  <span className="cce-phone-text">{display}</span>
                                  <span className="cce-phone-action-btns">
                                    <a
                                      href={telHref}
                                      className="cce-phone-call-btn"
                                      title="전화 걸기"
                                      aria-label={`전화 걸기 ${display}`}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <span className="material-symbols-outlined" aria-hidden>call</span>
                                    </a>
                                    <button
                                      type="button"
                                      className="cce-phone-sms-btn"
                                      title="문자 (AI 초안 후 전송)"
                                      aria-label={`문자 보내기 ${display}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSmsModal({
                                          phone: row.phone,
                                          recipientName: row.name || '',
                                          companyName: row.company || ''
                                        });
                                      }}
                                    >
                                      <span className="material-symbols-outlined" aria-hidden>sms</span>
                                    </button>
                                  </span>
                                </span>
                              );
                            })()}
                            {col.key === 'status' && (
                              <span className={`status-badge ${statusClass[row.status] || ''}`}>{statusLabel[row.status] || row.status || '—'}</span>
                            )}
                            {col.key === 'assigneeUserIds' && (() => {
                              const ids = Array.isArray(row.assigneeUserIds) ? row.assigneeUserIds : [];
                              const names = ids.map((id) => assigneeIdToName[String(id)] || '').filter(Boolean);
                              if (names.length) return names.join(', ');
                              if (ids.length === 0) return '—';
                              return companyEmployeesLoaded ? '—' : '담당자 불러오는 중...';
                            })()}
                            {col.key === 'lastSupportedAt' && (row.lastSupportedAt ? formatDate(row.lastSupportedAt) : '—')}
                            {col.key.startsWith(CUSTOM_FIELDS_PREFIX) && (() => {
                              const fieldKey = col.key.slice(CUSTOM_FIELDS_PREFIX.length);
                              const v = row.customFields?.[fieldKey];
                              return v !== undefined && v !== null && v !== '' ? String(v) : '—';
                            })()}
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="pagination-bar">
            <p className="pagination-info">
              <strong>{pagination.total}</strong>건 중 <strong>{items.length ? (pagination.page - 1) * pagination.limit + 1 : 0}</strong>–<strong>{(pagination.page - 1) * pagination.limit + items.length}</strong>건 표시
            </p>
            <div className="pagination-btns">
              <button type="button" className="pagination-btn" aria-label="첫 페이지" disabled={pagination.page <= 1} onClick={() => setPagination((p) => ({ ...p, page: 1 }))}><span className="material-symbols-outlined">first_page</span></button>
              <button type="button" className="pagination-btn" aria-label="이전 페이지" disabled={pagination.page <= 1} onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}><span className="material-symbols-outlined">chevron_left</span></button>
              {getPageNumbers(pagination.page, pagination.totalPages || 1).map((n, i) =>
                n === '...' ? (
                  <span key={`ellipsis-${i}`} className="pagination-ellipsis" aria-hidden>…</span>
                ) : (
                  <button
                    key={n}
                    type="button"
                    className={`pagination-btn pagination-btn-num ${pagination.page === n ? 'active' : ''}`}
                    aria-label={`${n}페이지`}
                    aria-current={pagination.page === n ? 'page' : undefined}
                    onClick={() => setPagination((p) => ({ ...p, page: n }))}
                  >
                    {n}
                  </button>
                )
              )}
              <button type="button" className="pagination-btn" aria-label="다음 페이지" disabled={pagination.page >= (pagination.totalPages || 1)} onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}><span className="material-symbols-outlined">chevron_right</span></button>
              <button type="button" className="pagination-btn" aria-label="마지막 페이지" disabled={pagination.page >= (pagination.totalPages || 1)} onClick={() => setPagination((p) => ({ ...p, page: pagination.totalPages || 1 }))}><span className="material-symbols-outlined">last_page</span></button>
            </div>
          </div>
        </div>
      </div>
      <SmsDraftModal
        open={!!smsModal || bulkSmsRows !== null}
        onClose={() => {
          setSmsModal(null);
          setBulkSmsRows(null);
          setBulkSmsPrefill(null);
          setBulkSmsHistoryEntryId(null);
        }}
        phone={smsModal?.phone}
        recipientName={smsModal?.recipientName}
        companyName={smsModal?.companyName}
        bulkContacts={bulkSmsRows || undefined}
        initialBulkTitle={bulkSmsPrefill?.title ?? ''}
        initialBulkBody={bulkSmsPrefill?.body}
        onBulkSmsOpened={bulkSmsRows ? handleBulkSmsOpened : undefined}
        bulkHistoryEntryId={bulkSmsHistoryEntryId}
      />
      <SmsBulkHistoryModal
        open={smsHistoryOpen}
        onClose={() => setSmsHistoryOpen(false)}
        entries={smsBulkHistoryList}
        pickableContacts={items}
        onResend={resendBulkSmsFromHistory}
        onDeleteEntry={deleteSmsBulkHistoryEntryCb}
        onUpdateEntryContacts={handleHistoryContactsUpdate}
      />
      {emailCompose ? (
        <EmailComposeModal
          key={emailCompose.initialTo}
          initialTo={emailCompose.initialTo}
          onClose={() => setEmailCompose(null)}
          onSent={() => setEmailCompose(null)}
        />
      ) : null}
      {isAddModalOpen && (
        <AddContactModal
          onClose={closeAddModal}
          onSaved={() => { fetchContacts(pagination.page); closeAddModal(); }}
        />
      )}
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
      {isDetailOpen && !selectedContact && loadingDetailContact && (
        <div className="customer-company-employees-detail-loading-overlay" role="dialog" aria-busy="true">
          <p>연락처 정보를 불러오는 중...</p>
          <button type="button" className="btn-outline" onClick={closeDetailModal}>취소</button>
        </div>
      )}
      {isDetailOpen && !selectedContact && !loadingDetailContact && (
        <div className="customer-company-employees-detail-loading-overlay" role="dialog">
          <p>해당 연락처를 찾을 수 없습니다.</p>
          <button type="button" className="btn-outline" onClick={closeDetailModal}>닫기</button>
        </div>
      )}
      {isDetailOpen && selectedContact && (
        <ContactDetailModal
          contact={selectedContact}
          onClose={closeDetailModal}
          onUpdated={(updatedContact) => {
            const id = updatedContact?._id != null ? String(updatedContact._id) : null;
            if (id) {
              setItems((prev) => prev.map((c) =>
                String(c._id) === id ? { ...c, ...updatedContact } : c
              ));
              setDetailContactById((prev) => (prev && String(prev._id) === id ? { ...prev, ...updatedContact } : prev));
            }
            fetchContacts(pagination.page);
          }}
        />
      )}
    </div>
  );
}
