import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import AddContactModal from './add-customer-company-employees-modal/add-customer-company-employees-modal';
import ContactDetailModal from './customer-company-employees-detail-modal/customer-company-employees-detail-modal';
import SmsDraftModal, { phoneToSmsHref } from './sms-draft-modal/sms-draft-modal';
import { saveBulkSmsAfterSend } from './sms-bulk-history';
import EmailComposeModal from '../email/email-compose-modal.jsx';
import ListTemplateModal from '../components/list-template-modal/list-template-modal';
import {
  LIST_IDS,
  getSavedTemplate,
  getEffectiveTemplate,
  patchListTemplate
} from '../lib/list-templates';
import { listColumnValueInlineStyle } from '@/lib/list-column-cell-styles';
import './customer-company-employees.css';
import './customer-company-employees-responsive.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import ListPaginationButtons from '@/components/list-pagination-buttons/list-pagination-buttons';
import CustomerCompanyEmployeesExcelImportModal from './customer-company-employees-excel-import-modal/customer-company-employees-excel-import-modal';
import AssigneeHandoverModal from '@/company-overview/assignee-handover-modal/assignee-handover-modal';
import GoogleContactsSaveResultModal from './google-contacts-save-result-modal/google-contacts-save-result-modal';
import CustomFieldsManageModal from '@/shared/custom-fields-manage-modal/custom-fields-manage-modal';
import BulkSalesOpportunityDirectoryModal from '@/shared/bulk-sales-opportunity-directory-modal/bulk-sales-opportunity-directory-modal';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';

import * as XLSX from 'xlsx';

import { API_BASE } from '@/config';
const LIST_ID = LIST_IDS.CUSTOMER_COMPANY_EMPLOYEES;
const EXPORT_PAGE_LIMIT = 100;
const MODAL_PARAM = 'modal';
const MODAL_ADD_CONTACT = 'add-contact';
const MODAL_EXCEL_IMPORT = 'excel-import';
const MODAL_DETAIL = 'detail';
const DETAIL_ID_PARAM = 'id';
const LIMIT = 10;

/** 모바일 카드 아바타 이니셜 */
function getNameInitials(name) {
  const s = (name || '?').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  }
  return s.slice(0, 2).toUpperCase();
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

async function appendCommunicationHistoryForContacts({ contacts, channel, subject = '', body = '' }) {
  const list = Array.isArray(contacts) ? contacts : [];
  const normalizedBody = String(body || '').trim();
  if (!list.length || !normalizedBody) return;
  const normalizedChannel = channel === 'email' ? 'email' : 'sms';
  const channelLabel = normalizedChannel === 'email' ? '메일' : '문자';
  const normalizedSubject = String(subject || '').trim();
  const noteLines = [
    `[${channelLabel} 발송 기록]`,
    normalizedSubject ? `제목: ${normalizedSubject}` : null,
    `본문: ${normalizedBody}`,
    `코멘트: 위 내용이 ${channelLabel}로 발송되었습니다.`
  ].filter(Boolean);
  const content = noteLines.join('\n');
  const headers = { 'Content-Type': 'application/json', ...getAuthHeader() };
  const uniqueContacts = list.filter((c, idx, arr) => c?._id && arr.findIndex((x) => String(x?._id) === String(c._id)) === idx);
  await Promise.all(
    uniqueContacts.map(async (contact) => {
      try {
        await fetch(`${API_BASE}/customer-company-employees/${contact._id}/history`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            content,
            workCategory: 'sales',
            contactChannel: normalizedChannel
          })
        });
      } catch (_) {
        // 커뮤니케이션 기록 실패는 발송 흐름을 막지 않는다.
      }
    })
  );
}

const statusClass = { Active: 'status-active', Pending: 'status-pending', Lead: 'status-lead', Inactive: 'status-inactive' };
const statusLabel = { Active: '활성', Pending: '대기', Lead: '리드', Inactive: '비활성' };
const statusHint = { Lead: '잠재 고객', Active: '거래 진행 중', Pending: '회신 대기', Inactive: '관리 종료' };
const STATUS_OPTIONS = ['', 'Lead', 'Active', 'Pending', 'Inactive'];
const CUSTOM_FIELDS_PREFIX = 'customFields.';

export default function CustomerCompanyEmployees() {
  const me = useMemo(() => getStoredCrmUser(), []);
  const canManageCustomFieldDefinitions = isAdminOrAboveRole(me?.role);
  const canBulkDeleteSelected = isAdminOrAboveRole(me?.role);
  const canRequestAssigneeHandover = !!(me && String(me.role || '').toLowerCase() !== 'pending');
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const [handoverCtx, setHandoverCtx] = useState(null);
  const [showCustomFieldsManageModal, setShowCustomFieldsManageModal] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: LIMIT, total: 0, totalPages: 0 });
  /** 입력 중인 검색어·필드(제출 전) — API는 applied* 만 사용 */
  const [searchDraft, setSearchDraft] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [assigneeMeOnly, setAssigneeMeOnly] = useState(() => getSavedTemplate(LIST_ID)?.assigneeMeOnly === true);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState(new Set());
  /** 선택 ID별 행 스냅샷 — 페이지를 넘겨도 단체 문자·메일·구글 저장에 사용 */
  const selectedRowsRef = useRef(new Map());
  const lastClickedIdx = useRef(null);
  const headerSelectAllRef = useRef(null);
  /** 상세 삭제 등으로 페이지가 바뀔 때 다음 목록 요청만 로딩 표시 없이 */
  const listFetchSilentOnceRef = useRef(false);

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
  const [bulkSalesPipelineOpen, setBulkSalesPipelineOpen] = useState(false);
  /** `{ initialTo }` — 단체 시 쉼표로 구분된 수신자 */
  const [emailCompose, setEmailCompose] = useState(null);
  const sortKey = sort.key;
  const sortDir = sort.dir;
  const [companyEmployees, setCompanyEmployees] = useState([]);
  const [companyEmployeesLoaded, setCompanyEmployeesLoaded] = useState(false);
  const [searchFieldDraft, setSearchFieldDraft] = useState('');
  const [appliedSearchField, setAppliedSearchField] = useState('');
  const SEARCH_FIELD_OPTIONS = [
    { key: 'name', label: '이름' },
    { key: 'company', label: '회사' },
    { key: 'email', label: '이메일' },
    { key: 'phone', label: '연락처' },
    { key: 'position', label: '직책' },
    { key: 'leadSource', label: '유입 경로' },
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
  const isExcelImportOpen = searchParams.get(MODAL_PARAM) === MODAL_EXCEL_IMPORT;
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
      .then(async (r) => ({
        ok: r.ok,
        status: r.status,
        data: await r.json().catch(() => ({}))
      }))
      .then(({ ok, status, data }) => {
        if (cancelled) return;
        if (ok && data._id) {
          setDetailContactById(data);
          return;
        }
        setDetailContactById(null);
        if (status === 404) {
          const next = new URLSearchParams(searchParams);
          if (next.get(MODAL_PARAM) === MODAL_DETAIL && next.get(DETAIL_ID_PARAM) === String(detailId)) {
            next.delete(MODAL_PARAM);
            next.delete(DETAIL_ID_PARAM);
            setSearchParams(next, { replace: true });
          }
        }
      })
      .catch(() => { if (!cancelled) setDetailContactById(null); })
      .finally(() => { if (!cancelled) setLoadingDetailContact(false); });
    return () => { cancelled = true; };
  }, [isDetailOpen, detailId, selectedContactFromList, searchParams, setSearchParams]);

  const openAddModal = () => setSearchParams({ [MODAL_PARAM]: MODAL_ADD_CONTACT });
  const closeAddModal = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    setSearchParams(next, { replace: true });
  };

  const openExcelImportModal = () => setSearchParams({ [MODAL_PARAM]: MODAL_EXCEL_IMPORT });
  const closeExcelImportModal = () => {
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

  const fetchContacts = useCallback(async (page = 1, opts = {}) => {
    const silentFromOpt = opts.silent === true;
    const silent = silentFromOpt || listFetchSilentOnceRef.current;
    listFetchSilentOnceRef.current = false;
    const overrideStatus = opts.overrideStatus !== undefined ? opts.overrideStatus : '';
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: LIMIT });
      if (appliedSearch.trim()) {
        params.set('search', appliedSearch.trim());
        if (appliedSearchField) params.set('searchField', appliedSearchField);
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
      if (!silent) setLoading(false);
    }
  }, [appliedSearch, appliedSearchField, assigneeMeOnly]);

  const handleAddContactSaved = useCallback(
    (contact) => {
      if (!contact || !contact._id) {
        fetchContacts(pagination.page, { silent: true });
        return;
      }
      const meId = String(me?._id || me?.id || '');
      if (assigneeMeOnly && meId) {
        const ids = Array.isArray(contact.assigneeUserIds) ? contact.assigneeUserIds.map(String) : [];
        if (!ids.includes(meId)) {
          fetchContacts(pagination.page, { silent: true });
          return;
        }
      }
      if (String(appliedSearch || '').trim()) {
        fetchContacts(pagination.page, { silent: true });
        return;
      }
      if (pagination.page !== 1) {
        setPagination((p) => {
          const total = (p.total || 0) + 1;
          return { ...p, total, totalPages: Math.max(1, Math.ceil(total / (p.limit || LIMIT))) };
        });
        return;
      }
      setItems((prev) => {
        const next = [contact, ...prev];
        return next.length > LIMIT ? next.slice(0, LIMIT) : next;
      });
      setPagination((p) => {
        const total = (p.total || 0) + 1;
        return { ...p, total, totalPages: Math.max(1, Math.ceil(total / (p.limit || LIMIT))) };
      });
    },
    [fetchContacts, pagination.page, appliedSearch, assigneeMeOnly, me, LIMIT]
  );

  useEffect(() => { fetchContacts(pagination.page); }, [pagination.page, fetchContacts]);

  const loadContactCustomFieldColumns = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=contact`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      const defs = Array.isArray(data?.items) ? data.items : [];
      const extra = defs.map((d) => ({ key: `${CUSTOM_FIELDS_PREFIX}${d.key}`, label: d.label || d.key || '' }));
      setCustomFieldColumns(extra);
      setTemplate((prev) => getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), extra));
    } catch {
      setCustomFieldColumns([]);
    }
  }, []);

  /** 새 연락처 추가 시 정의된 커스텀 필드를 리스트 템플릿에 반영 */
  useEffect(() => {
    loadContactCustomFieldColumns();
  }, [loadContactCustomFieldColumns]);

  const onSearch = (e) => {
    e?.preventDefault();
    clearSelection();
    setAppliedSearch(searchDraft.trim());
    setAppliedSearchField(searchFieldDraft);
    setPagination((p) => ({ ...p, page: 1 }));
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

  /** 모바일 Ethereal 스타일: 전체 / 즐겨찾기 / 내 담당 칩 */
  const [mobileChipFilter, setMobileChipFilter] = useState(() =>
    getSavedTemplate(LIST_ID)?.assigneeMeOnly === true ? 'assignee' : 'all'
  );

  const handleBulkSmsOpened = useCallback((payload) => {
    saveBulkSmsAfterSend(payload);
    void appendCommunicationHistoryForContacts({
      contacts: payload?.contacts || [],
      channel: 'sms',
      subject: payload?.title || '',
      body: payload?.body || ''
    });
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
    saveTemplate({ columnOrder: order, visible: template.visible, columnCellStyles: template.columnCellStyles });
  };

  const displayColumns = template.columns.filter((c) => template.visible[c.key]);
  const colSpan = Math.max(1, displayColumns.length);

  const getSortValue = useCallback((row, key) => {
    if (key === 'company') return (row.company || '').toLowerCase();
    if (key === 'name') return (row.name || '').toLowerCase();
    if (key === 'email') return (row.email || '').toLowerCase();
    if (key === 'phone') return (row.phone || '').toLowerCase();
    if (key === 'leadSource') return (row.leadSource || '').toLowerCase();
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

  const contactsForBulkSalesModal = useMemo(
    () => [...selected].map((id) => selectedRowsRef.current.get(id) || sortedItems.find((r) => String(r._id) === String(id))).filter(Boolean),
    [selected, sortedItems]
  );

  const mobileListItems = useMemo(() => {
    if (mobileChipFilter === 'favorite') return sortedItems.filter((r) => r.isFavorite);
    return sortedItems;
  }, [sortedItems, mobileChipFilter]);

  const mobileFavoriteSection = useMemo(
    () => mobileListItems.filter((r) => r.isFavorite),
    [mobileListItems]
  );
  const mobileRestSection = useMemo(
    () => mobileListItems.filter((r) => !r.isFavorite),
    [mobileListItems]
  );

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

  const openHandoverFromSelection = useCallback(() => {
    if (!canRequestAssigneeHandover) return;
    if (selected.size === 0) return;
    const rows = [];
    for (const id of selected) {
      const row = selectedRowsRef.current.get(id) || sortedItems.find((r) => String(r._id) === String(id));
      if (row) rows.push(row);
    }
    const withAssignee = rows.filter((r) => Array.isArray(r.assigneeUserIds) && r.assigneeUserIds.length > 0);
    if (withAssignee.length === 0) {
      window.alert('담당자가 지정된 연락처만 이관 신청할 수 있습니다.');
      return;
    }
    setHandoverCtx({
      targetType: 'customerCompanyEmployee',
      targets: withAssignee.map((r) => ({
        targetId: r._id,
        targetLabel: `연락처: ${r.name || '—'}`,
        assigneeUserIds: r.assigneeUserIds
      }))
    });
  }, [canRequestAssigneeHandover, selected, sortedItems]);

  const handleBulkDeleteSelectedContacts = useCallback(async () => {
    if (!canBulkDeleteSelected) {
      window.alert('선택 항목 삭제는 Owner / Admin만 가능합니다.');
      return;
    }
    const ids = [...selected].map((id) => String(id));
    if (ids.length === 0) return;
    const confirmed = window.confirm(
      `선택한 연락처 ${ids.length}명을 삭제합니다.\n` +
        '고객사에 연결된 경우 목록에서도 제거되며, 이 작업은 되돌릴 수 없습니다.\n' +
        '계속할까요?'
    );
    if (!confirmed) return;
    setBulkDeleteLoading(true);
    let ok = 0;
    const errors = [];
    try {
      for (const id of ids) {
        const res = await fetch(`${API_BASE}/customer-company-employees/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: getAuthHeader()
        });
        if (res.status === 204 || res.ok) {
          ok += 1;
        } else {
          const data = await res.json().catch(() => ({}));
          errors.push({ id, error: data.error || `HTTP ${res.status}` });
        }
      }
    } finally {
      setBulkDeleteLoading(false);
    }
    if (detailId && ids.includes(String(detailId))) {
      closeDetailModal();
    }
    clearSelection();
    await fetchContacts(pagination.page, { silent: true });
    if (errors.length === 0) {
      window.alert(`삭제했습니다. (${ok}명)`);
    } else {
      const extra = errors.length > 1 ? ` 외 ${errors.length - 1}건` : '';
      window.alert(
        `처리 결과: 성공 ${ok}명, 실패 ${errors.length}건.\n첫 오류: ${errors[0].error}${extra}`
      );
    }
  }, [
    canBulkDeleteSelected,
    selected,
    detailId,
    closeDetailModal,
    clearSelection,
    fetchContacts,
    pagination.page
  ]);

  const fetchAllContactsForExport = useCallback(async () => {
    let page = 1;
    let totalPages = 1;
    const all = [];
    do {
      const params = new URLSearchParams({ page: String(page), limit: String(EXPORT_PAGE_LIMIT) });
      if (appliedSearch.trim()) {
        params.set('search', appliedSearch.trim());
        if (appliedSearchField) params.set('searchField', appliedSearchField);
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
  }, [appliedSearch, appliedSearchField, assigneeMeOnly]);

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
          '유입 경로': row.leadSource || '',
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
    setEmailCompose({ initialTo: unique.join(', '), contacts: withEmail });
  }, [selected]);

  const renderMobileCard = (row, idxInMobileList) => {
    const sortedIdx = sortedItems.findIndex((r) => r._id === row._id);
    const idx = sortedIdx >= 0 ? sortedIdx : idxInMobileList;
    const telHref = phoneToTelHref(row.phone);
    const displayPhone = row.phone || '—';
    const em = String(row.email || '').trim();
    const tone = idxInMobileList % 3;
    return (
      <div
        key={row._id}
        className={`cce-mobile-card cce-mobile-card--tone-${tone}`}
        role="button"
        tabIndex={0}
        onClick={() => openDetailModal(row)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDetailModal(row);
          }
        }}
      >
        <div className="cce-mobile-card-main-row">
          <div className="cce-mobile-card-select-col">
            <input
              type="checkbox"
              className="cce-row-checkbox cce-mobile-card-checkbox"
              checked={selected.has(row._id)}
              aria-label={`${row.name || '연락처'} 선택`}
              onChange={() => {}}
              onClick={(e) => handleCheckboxClick(idx, e)}
            />
          </div>
          <div className={`cce-mobile-card-avatar cce-mobile-card-avatar--${tone}`} aria-hidden>
            <span className="cce-mobile-card-initials">{getNameInitials(row.name)}</span>
          </div>
          <div className="cce-mobile-card-body">
            <button
              type="button"
              className={`cce-favorite-btn cce-mobile-favorite-btn cce-mobile-favorite-corner ${row.isFavorite ? 'is-active' : ''}`}
              aria-label={row.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 등록'}
              title={row.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 등록'}
              onClick={(e) => {
                e.stopPropagation();
                handleToggleFavorite(row._id, !row.isFavorite);
              }}
            >
              <span className="material-symbols-outlined" aria-hidden>star</span>
            </button>
            <h3 className="cce-mobile-card-name">{row.name || '—'}</h3>
            <div
              className="cce-mobile-name-phone-row"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              role="presentation"
            >
              <span className="cce-mobile-name-phone-num">{displayPhone}</span>
              {telHref ? (
                <a
                  href={telHref}
                  className="cce-mobile-quick-btn cce-mobile-name-phone-icon"
                  title="전화 걸기"
                  aria-label={`전화 걸기 ${displayPhone}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="material-symbols-outlined" aria-hidden>call</span>
                </a>
              ) : (
                <span className="cce-mobile-quick-btn cce-mobile-quick-btn--disabled cce-mobile-name-phone-icon" aria-hidden>
                  <span className="material-symbols-outlined">call</span>
                </span>
              )}
              {row.phone?.trim() ? (
                <button
                  type="button"
                  className="cce-mobile-quick-btn cce-mobile-name-phone-icon"
                  title="문자 (AI 초안 후 전송)"
                  aria-label={`문자 보내기 ${displayPhone}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSmsModal({
                      phone: row.phone,
                      recipientName: row.name || '',
                      companyName: row.company || ''
                    });
                  }}
                >
                  <span className="material-symbols-outlined" aria-hidden>chat_bubble</span>
                </button>
              ) : (
                <span className="cce-mobile-quick-btn cce-mobile-quick-btn--disabled cce-mobile-name-phone-icon" aria-hidden>
                  <span className="material-symbols-outlined">chat_bubble</span>
                </span>
              )}
            </div>
            <div
              className="cce-mobile-name-email-row"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              role="presentation"
            >
              <span className="cce-mobile-name-email-text" title={em || undefined}>{em || '—'}</span>
              {em ? (
                <button
                  type="button"
                  className="cce-mobile-quick-btn cce-mobile-name-email-icon"
                  title="메일 작성"
                  aria-label={`${em}에게 메일 작성`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEmailCompose({ initialTo: em, contacts: [row] });
                  }}
                >
                  <span className="material-symbols-outlined" aria-hidden>mail</span>
                </button>
              ) : (
                <span className="cce-mobile-quick-btn cce-mobile-quick-btn--disabled cce-mobile-name-email-icon" aria-hidden>
                  <span className="material-symbols-outlined">mail</span>
                </span>
              )}
            </div>
            <p className="cce-mobile-card-company">{row.company || '—'}</p>
            {row.leadSource ? (
              <p className="cce-mobile-card-lead-source text-muted" title={String(row.leadSource)}>
                유입: {String(row.leadSource)}
              </p>
            ) : null}
          </div>
          <span className="cce-mobile-card-chevron material-symbols-outlined" aria-hidden>chevron_right</span>
        </div>
        {template.visible?.lastSupportedAt ? (
          <div className="cce-mobile-card-details">
            <p className="cce-mobile-card-meta">
              최근 지원: {row.lastSupportedAt ? formatDate(row.lastSupportedAt) : '—'}
            </p>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="page customer-company-employees-page">
      <header className="page-header">
        <div className="header-search">
          <button type="submit" form="customer-company-employees-search-form" className="header-search-icon-btn" aria-label="검색">
            <span className="material-symbols-outlined">search</span>
          </button>
          <form id="customer-company-employees-search-form" onSubmit={onSearch} className="header-search-form">
            <input
              type="text"
              placeholder={searchFieldDraft ? `${SEARCH_FIELD_OPTIONS.find((o) => o.key === searchFieldDraft)?.label || searchFieldDraft} 검색...` : '모든 필드 검색 (이름, 회사, 이메일, 전화, 직책, 유입 경로, 메모, 커스텀 필드 등)...'}
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              aria-label="연락처 검색"
            />
          </form>
          <select
            className="cce-sort-column-select"
            value={searchFieldDraft}
            onChange={(e) => setSearchFieldDraft(e.target.value)}
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
                setMobileChipFilter(next ? 'assignee' : 'all');
                patchListTemplate(LIST_ID, { assigneeMeOnly: next }).catch((err) => {
                  alert(err?.message || '저장에 실패했습니다.');
                  setAssigneeMeOnly(assigneeMeOnly);
                  setMobileChipFilter(assigneeMeOnly ? 'assignee' : 'all');
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
              className="btn-outline cce-excel-import-btn"
              onClick={openExcelImportModal}
              title="엑셀 열을 이름·회사·연락처·이메일 등에 매핑하여 연락처를 한 번에 등록합니다."
            >
              <span className="material-symbols-outlined">upload_file</span>
              엑셀 매핑
            </button>
            <button
              type="button"
              className="btn-outline cce-excel-export-btn"
              onClick={handleDownloadExcel}
              disabled={exportExcelLoading}
              title="현재 검색·내 담당 필터에 맞는 연락처 전체를 엑셀(.xlsx)로 받습니다."
            >
              <span className="material-symbols-outlined">download</span>
              {exportExcelLoading ? '준비 중…' : '내보내기'}
            </button>
            {canManageCustomFieldDefinitions ? (
              <button
                type="button"
                className="btn-outline"
                onClick={() => setShowCustomFieldsManageModal(true)}
                title="연락처에 쓸 사용자 정의 필드를 추가합니다"
              >
                <span className="material-symbols-outlined">playlist_add</span>
                필드 추가
              </button>
            ) : null}
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
                문자 (단체)
              </button>
              <button
                type="button"
                className="cce-action-bar-email-bulk"
                onClick={openBulkEmailFromSelection}
                title="이메일이 있는 연락처만 받는 사람 칸에 넣고 새 메일 작성을 엽니다 (중복 주소는 한 번만)."
              >
                <span className="material-symbols-outlined" aria-hidden>mail</span>
                메일 (단체)
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
              <button
                type="button"
                className="cce-action-bar-sales"
                onClick={() => setBulkSalesPipelineOpen(true)}
                title="선택한 연락처마다 동일 제품·단계로 영업 기회를 등록합니다. 기본은 개인 구매이며, 해제 시 소속 고객사가 함께 연결됩니다."
              >
                <span className="material-symbols-outlined" aria-hidden>trending_up</span>
                세일즈 현황에 추가
              </button>
              {canRequestAssigneeHandover ? (
                <button
                  type="button"
                  className="cce-action-bar-handover"
                  onClick={openHandoverFromSelection}
                  title="선택한 연락처의 담당 이관 신청 (여러 명 선택 가능, 담당자가 있는 항목만 신청, 관리자 메일 승인 후 반영)"
                >
                  <span className="material-symbols-outlined" aria-hidden>swap_horiz</span>
                  인수인계
                </button>
              ) : null}
              {canBulkDeleteSelected ? (
                <button
                  type="button"
                  className="cce-action-bar-delete"
                  onClick={handleBulkDeleteSelectedContacts}
                  disabled={bulkDeleteLoading}
                  title="선택한 연락처를 삭제합니다 (Owner / Admin)"
                >
                  <span className="material-symbols-outlined" aria-hidden>delete</span>
                  {bulkDeleteLoading ? '삭제 중…' : '선택 항목 삭제'}
                </button>
              ) : null}
              <button type="button" className="cce-action-bar-cancel" onClick={clearSelection}>선택 해제</button>
            </div>
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
              <>
                <div className="cce-mobile-filter-chips" role="tablist" aria-label="목록 필터">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mobileChipFilter === 'all'}
                    className={`cce-mobile-chip ${mobileChipFilter === 'all' ? 'is-active' : ''}`}
                    onClick={() => {
                      setMobileChipFilter('all');
                      if (assigneeMeOnly) {
                        clearSelection();
                        setAssigneeMeOnly(false);
                        patchListTemplate(LIST_ID, { assigneeMeOnly: false }).catch((err) => {
                          alert(err?.message || '저장에 실패했습니다.');
                          setAssigneeMeOnly(true);
                          setMobileChipFilter('assignee');
                        });
                      }
                    }}
                  >
                    전체
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mobileChipFilter === 'favorite'}
                    className={`cce-mobile-chip ${mobileChipFilter === 'favorite' ? 'is-active' : ''}`}
                    onClick={() => setMobileChipFilter('favorite')}
                  >
                    즐겨찾기
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mobileChipFilter === 'assignee'}
                    className={`cce-mobile-chip ${mobileChipFilter === 'assignee' ? 'is-active' : ''}`}
                    onClick={() => {
                      setMobileChipFilter('assignee');
                      if (!assigneeMeOnly) {
                        clearSelection();
                        setAssigneeMeOnly(true);
                        patchListTemplate(LIST_ID, { assigneeMeOnly: true }).catch((err) => {
                          alert(err?.message || '저장에 실패했습니다.');
                          setAssigneeMeOnly(false);
                          setMobileChipFilter('all');
                        });
                      }
                    }}
                  >
                    내 담당
                  </button>
                </div>
                <div className="cce-mobile-activity-bento" aria-hidden={false}>
                  <div className="cce-mobile-activity-card cce-mobile-activity-card--lavender">
                    <span className="material-symbols-outlined cce-mobile-activity-icon" aria-hidden>history</span>
                    <div>
                      <p className="cce-mobile-activity-value">{pagination.total ?? 0}</p>
                      <p className="cce-mobile-activity-label">전체 연락처</p>
                    </div>
                  </div>
                </div>
                {mobileChipFilter === 'favorite' && mobileListItems.length === 0 ? (
                  <p className="cce-mobile-cards-message">즐겨찾기 연락처가 없습니다.</p>
                ) : (
                  <div className="cce-mobile-cards-list">
                    {mobileChipFilter === 'favorite' ? (
                      mobileListItems.map((row, i) => renderMobileCard(row, i))
                    ) : (
                      <>
                        {mobileFavoriteSection.length > 0 && (
                          <div className="cce-mobile-list-section">
                            <h3 className="cce-mobile-section-title">즐겨찾기 연락처</h3>
                            <div className="cce-mobile-cards-list-inner">
                              {mobileFavoriteSection.map((row, i) => renderMobileCard(row, i))}
                            </div>
                          </div>
                        )}
                        {mobileRestSection.length > 0 && (
                          <div className={`cce-mobile-list-section ${mobileFavoriteSection.length ? 'cce-mobile-list-section--spaced' : ''}`}>
                            <h3 className="cce-mobile-section-title">
                              {mobileFavoriteSection.length ? '연락처' : '연락처'}
                            </h3>
                            <div className="cce-mobile-cards-list-inner">
                              {mobileRestSection.map((row, i) => renderMobileCard(row, mobileFavoriteSection.length + i))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </>
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
                        {displayColumns.map((col) => {
                          const valStyle =
                            col.key === '_check' || col.key === '_favorite'
                              ? null
                              : listColumnValueInlineStyle(template.columnCellStyles, col.key);
                          return (
                          <td
                            key={col.key}
                            data-label={col.key === '_check' || col.key === '_favorite' ? '' : col.label}
                            className={
                              col.key === '_check'
                                ? 'cce-td-check'
                                : col.key === '_favorite'
                                  ? 'cce-td-favorite'
                                  : col.key === 'status'
                                    ? 'cce-td-status'
                                    : col.key === 'name' || col.key === 'phone' || col.key === 'email'
                                      ? ''
                                      : 'text-muted'
                            }
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
                            {col.key !== '_check' && col.key !== '_favorite' ? (
                              <span className="list-col-value-style" style={valStyle || undefined}>
                            {col.key === 'company' && (() => {
                              const hasConfirmedCompany = row.customerCompanyId && String(row.customerCompanyId.businessNumber || '').trim();
                              const unconfirmed = row.company && !hasConfirmedCompany;
                              return (
                                <span className={unconfirmed ? 'cce-company-unconfirmed' : undefined}>
                                  {row.company || '—'}
                                </span>
                              );
                            })()}
                            {col.key === 'name' && (() => {
                              const avatarTone = idx % 3;
                              return (
                                <div className="cell-user cce-name-cell">
                                  <div
                                    className={`cce-name-cell-avatar cce-name-cell-avatar--${avatarTone}`}
                                    aria-hidden
                                  >
                                    <span className="cce-name-cell-initials">{getNameInitials(row.name)}</span>
                                  </div>
                                  <div className="cce-name-cell-text">
                                    <span className="font-semibold">{row.name || '—'}</span>
                                  </div>
                                </div>
                              );
                            })()}
                            {col.key === 'phone' && (() => {
                              const telHref = phoneToTelHref(row.phone);
                              const displayPhone = row.phone || '—';
                              return (
                                <div
                                  className="cce-contact-cell"
                                  onClick={(e) => e.stopPropagation()}
                                  role="presentation"
                                >
                                  <span className="cce-phone-text text-muted">{displayPhone}</span>
                                  {row.phone?.trim() && telHref ? (
                                    <span className="cce-phone-action-btns">
                                      <a
                                        href={telHref}
                                        className="cce-phone-call-btn"
                                        title="전화 걸기"
                                        aria-label={`전화 걸기 ${displayPhone}`}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <span className="material-symbols-outlined" aria-hidden>call</span>
                                      </a>
                                      <button
                                        type="button"
                                        className="cce-phone-sms-btn"
                                        title="문자 (AI 초안 후 전송)"
                                        aria-label={`문자 보내기 ${displayPhone}`}
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
                                  ) : null}
                                </div>
                              );
                            })()}
                            {col.key === 'email' && (() => {
                              const em = String(row.email || '').trim();
                              return (
                                <div
                                  className="cce-email-cell"
                                  onClick={(e) => e.stopPropagation()}
                                  role="presentation"
                                >
                                  <span className="cce-email-text text-muted" title={em || undefined}>
                                    {em || '—'}
                                  </span>
                                  {em ? (
                                    <button
                                      type="button"
                                      className="cce-email-compose-btn"
                                      title="메일 작성"
                                      aria-label={`${em}에게 메일 작성`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEmailCompose({ initialTo: em, contacts: [row] });
                                      }}
                                    >
                                      <span className="material-symbols-outlined" aria-hidden>mail</span>
                                    </button>
                                  ) : null}
                                </div>
                              );
                            })()}
                            {col.key === 'leadSource' && (row.leadSource ? String(row.leadSource) : '—')}
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
                              </span>
                            ) : null}
                          </td>
                          );
                        })}
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
            <ListPaginationButtons
              page={pagination.page}
              totalPages={pagination.totalPages || 1}
              onPageChange={(nextPage) => setPagination((p) => ({ ...p, page: nextPage }))}
            />
          </div>
        </div>
      </div>
      <button type="button" className="cce-mobile-fab" onClick={openAddModal} aria-label="새 연락처 추가">
        <span className="material-symbols-outlined">add</span>
      </button>
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
      {emailCompose ? (
        <EmailComposeModal
          key={emailCompose.initialTo}
          initialTo={emailCompose.initialTo}
          onClose={() => setEmailCompose(null)}
          onSent={(payload) => {
            void appendCommunicationHistoryForContacts({
              contacts: emailCompose.contacts || [],
              channel: 'email',
              subject: payload?.subject || '',
              body: payload?.body || ''
            });
            setEmailCompose(null);
          }}
        />
      ) : null}
      {isExcelImportOpen && (
        <CustomerCompanyEmployeesExcelImportModal
          open
          onClose={closeExcelImportModal}
          onImported={() => { fetchContacts(1); setPagination((p) => ({ ...p, page: 1 })); }}
        />
      )}
      {showCustomFieldsManageModal && canManageCustomFieldDefinitions && (
        <CustomFieldsManageModal
          entityType="contact"
          onClose={() => setShowCustomFieldsManageModal(false)}
          onFieldAdded={() => loadContactCustomFieldColumns()}
          apiBase={API_BASE}
          getAuthHeader={getAuthHeader}
        />
      )}
      {isAddModalOpen && (
        <AddContactModal
          onClose={closeAddModal}
          onSaved={(payload) => {
            handleAddContactSaved(payload);
          }}
        />
      )}
      {settingsOpen && (
        <ListTemplateModal
          listId={LIST_ID}
          columns={template.columns}
          visible={template.visible}
          columnOrder={template.columnOrder}
          columnCellStyles={template.columnCellStyles}
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
            if (updatedContact?.deletedId != null) {
              const delId = String(updatedContact.deletedId);
              listFetchSilentOnceRef.current = true;
              setItems((prev) => prev.filter((c) => String(c._id) !== delId));
              setPagination((p) => {
                const newTotal = Math.max(0, (p.total || 0) - 1);
                const totalPages = Math.max(1, Math.ceil(newTotal / (p.limit || LIMIT)));
                const nextPage = Math.min(p.page, totalPages);
                return { ...p, total: newTotal, totalPages, page: nextPage };
              });
              setDetailContactById(null);
              return;
            }
            const id = updatedContact?._id != null ? String(updatedContact._id) : null;
            if (id) {
              setItems((prev) => prev.map((c) =>
                String(c._id) === id ? { ...c, ...updatedContact } : c
              ));
              setDetailContactById((prev) => (prev && String(prev._id) === id ? { ...prev, ...updatedContact } : prev));
            }
          }}
        />
      )}
      {handoverCtx && (
        <AssigneeHandoverModal
          open
          onClose={() => setHandoverCtx(null)}
          onSubmitted={() => {
            fetchContacts(pagination.page, { silent: true });
            clearSelection();
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
          mode="employees"
          entities={contactsForBulkSalesModal}
          onClose={() => setBulkSalesPipelineOpen(false)}
          onCompleted={() => {
            setBulkSalesPipelineOpen(false);
            clearSelection();
          }}
        />
      ) : null}
      {googleResult ? (
        <GoogleContactsSaveResultModal result={googleResult} onClose={() => setGoogleResult(null)} />
      ) : null}
    </div>
  );
}
