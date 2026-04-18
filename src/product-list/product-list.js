import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import AddProductModal from './add-product-modal/add-product-modal';
import ProductDetailModal from './product-detail-modal/product-detail-modal';
import ProductExcelImportModal from './product-excel-import-modal/product-excel-import-modal';
import ListTemplateModal from '../components/list-template-modal/list-template-modal';
import {
  LIST_IDS,
  getSavedTemplate,
  getEffectiveTemplate,
  patchListTemplate
} from '../lib/list-templates';
import './product-list.css';
import './product-list-responsive.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import ListPaginationButtons from '@/components/list-pagination-buttons/list-pagination-buttons';

import * as XLSX from 'xlsx';

import { API_BASE } from '@/config';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import { listPriceFromProduct } from '@/lib/product-price-utils';
import { CATEGORY_AVATAR_RULES } from './product-category-avatar-config';
const LIST_ID = LIST_IDS.PRODUCT_LIST;
const LIMIT = 10;
const EXPORT_PAGE_LIMIT = 100;

const MODAL_PARAM = 'modal';
const MODAL_DETAIL = 'detail';
const MODAL_EXCEL_IMPORT = 'excel-import';
const DETAIL_ID_PARAM = 'id';
const STATUS_LABELS = { Active: '활성', EndOfLife: 'End of Life', Draft: '초안' };
const BILLING_LABELS = { Monthly: '월간', Annual: '연간', Perpetual: '영구' };
const CUSTOM_FIELDS_PREFIX = 'customFields.';

/** API filterField 값 — 백엔드 Product 스키마 + customFields.xxx */
const PRODUCT_FIELD_FILTER_STATIC = [
  { value: 'name', label: '제품명' },
  { value: 'code', label: '코드' },
  { value: 'category', label: '카테고리' },
  { value: 'version', label: '버전' },
  { value: 'currency', label: '통화' },
  { value: 'status', label: '상태' },
  { value: 'billingType', label: '결제 주기' },
  { value: 'listPrice', label: '소비자가(listPrice)' },
  { value: 'price', label: '가격(price)' },
  { value: 'costPrice', label: '원가' },
  { value: 'channelPrice', label: '유통가' },
  { value: 'createdAt', label: '등록일' },
  { value: 'updatedAt', label: '수정일' }
];

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatPrice(price, currency) {
  if (price == null) return '—';
  const sym = currency === 'USD' ? '$' : '₩';
  return `${sym}${Number(price).toLocaleString()}`;
}

/** 유통시 순 마진(금액) = 유통가 − 원가 — 영업 기회「유통시 순 마진 기준」가격(channelPrice)과 동일 축 */
function getChannelMargin(row) {
  return (Number(row.channelPrice) || 0) - (Number(row.costPrice) || 0);
}

/** 유통가가 0이거나 원가 이하이면 유통시 순마진은 표시하지 않음(하이픈) */
function shouldDashChannelMargin(row) {
  const chRaw = Number(row.channelPrice);
  const ch = Number.isFinite(chRaw) ? chRaw : 0;
  const cost = Number(row.costPrice);
  const costNum = Number.isFinite(cost) ? cost : 0;
  if (ch === 0) return true;
  if (ch <= costNum) return true;
  return false;
}

/** 순 마진(금액) = 소비자가 − 원가 — 영업 기회「순 마진 기준」가격(listPrice/price)과 동일 축 */
function getConsumerMargin(row) {
  return (Number(listPriceFromProduct(row)) || 0) - (Number(row.costPrice) || 0);
}

/** 소비자가 대비 순 마진율(%) — 모바일 카드 표시용 */
function getConsumerMarginPercent(row) {
  const lp = Number(listPriceFromProduct(row)) || 0;
  if (lp <= 0) return null;
  return (getConsumerMargin(row) / lp) * 100;
}

function getProductInitials(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  if (/[가-힣]/.test(s)) return s.slice(0, 2);
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && /^[a-zA-Z]/.test(parts[0])) {
    const a = parts[0][0];
    const b = parts[1][0];
    if (/[a-zA-Z0-9]/.test(a) && /[a-zA-Z0-9]/.test(b)) return (a + b).toUpperCase();
  }
  const alnum = s.replace(/[^a-zA-Z0-9가-힣]/g, '');
  if (alnum.length >= 2) return alnum.slice(0, 2).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

/** 데스크톱 표: 소비자가+순 마진 / 유통가+유통시 순 마진 묶음 배경 */
function productListColumnToneClass(key) {
  if (key === 'price' || key === 'consumerMargin') return 'pl-col--direct';
  if (key === 'channelPrice' || key === 'channelMargin') return 'pl-col--channel';
  return '';
}

function hashToneFromString(seed) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 4;
}

function resolveProductAvatar(row, idx) {
  const cat = String(row.category || '').toLowerCase();
  for (const rule of CATEGORY_AVATAR_RULES) {
    if (rule.keys.some((k) => cat.includes(k.toLowerCase()))) {
      return { kind: 'icon', icon: rule.icon, tone: rule.tone % 4 };
    }
  }
  const initials = getProductInitials(row.name);
  const tone = hashToneFromString(row._id || row.name || String(idx));
  return { kind: 'initials', initials, tone };
}

function ProductListAvatar({ row, idx }) {
  const av = resolveProductAvatar(row, idx);
  const base = `pl-mcard-icon pl-mcard-icon--${av.tone}`;
  if (av.kind === 'initials') {
    return (
      <div className={`${base} pl-mcard-icon--initials`} aria-hidden>
        <span className="pl-mcard-icon-initials">{av.initials}</span>
      </div>
    );
  }
  return (
    <div className={base} aria-hidden>
      <span className="material-symbols-outlined">{av.icon}</span>
    </div>
  );
}

export default function ProductList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: LIMIT, total: 0, totalPages: 0 });
  const [searchInput, setSearchInput] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterBilling, setFilterBilling] = useState('');
  const [loading, setLoading] = useState(true);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [customFieldColumns, setCustomFieldColumns] = useState([]);
  const [template, setTemplate] = useState(() => getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID)));
  const [dragOverKey, setDragOverKey] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [exportExcelLoading, setExportExcelLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const [excelImportSeed, setExcelImportSeed] = useState(null);
  const selectionAnchorIdxRef = useRef(null);
  const headerSelectAllRef = useRef(null);

  const [fieldFilterSelect, setFieldFilterSelect] = useState('name');
  const [fieldFilterInput, setFieldFilterInput] = useState('');
  const [fieldFilterFieldApplied, setFieldFilterFieldApplied] = useState('');
  const [fieldFilterValueApplied, setFieldFilterValueApplied] = useState('');

  const sortKey = sort.key;
  const sortDir = sort.dir;

  const customFieldLabelByKey = useMemo(() => {
    const m = {};
    customFieldColumns.forEach((c) => {
      if (!c?.key?.startsWith(CUSTOM_FIELDS_PREFIX)) return;
      const fk = c.key.slice(CUSTOM_FIELDS_PREFIX.length);
      m[fk] = (c.label || fk).trim() || fk;
    });
    return m;
  }, [customFieldColumns]);

  const fieldFilterOptions = useMemo(() => {
    const customOpts = customFieldColumns.map((c) => {
      const k = c.key?.startsWith(CUSTOM_FIELDS_PREFIX)
        ? `customFields.${c.key.slice(CUSTOM_FIELDS_PREFIX.length)}`
        : c.key;
      return { value: k, label: c.label || k };
    });
    const seen = new Set();
    const out = [];
    for (const o of [...PRODUCT_FIELD_FILTER_STATIC, ...customOpts]) {
      if (!o.value || seen.has(o.value)) continue;
      seen.add(o.value);
      out.push(o);
    }
    return out;
  }, [customFieldColumns]);

  const me = useMemo(() => getStoredCrmUser(), []);
  const canExportExcel = isAdminOrAboveRole(me?.role);
  const canDeleteProduct = isAdminOrAboveRole(me?.role);

  const detailId = searchParams.get(DETAIL_ID_PARAM);
  const modalParam = searchParams.get(MODAL_PARAM);
  const isDetailOpen = modalParam === MODAL_DETAIL && detailId;
  const isExcelImportOpen = modalParam === MODAL_EXCEL_IMPORT;
  const detailProduct = isDetailOpen ? items.find((p) => p._id === detailId) || null : null;

  const fetchList = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (searchApplied) params.set('search', searchApplied);
      if (filterStatus) params.set('status', filterStatus);
      if (filterBilling) params.set('billingType', filterBilling);
      if (fieldFilterFieldApplied && fieldFilterValueApplied) {
        params.set('filterField', fieldFilterFieldApplied);
        params.set('filterValue', fieldFilterValueApplied);
      }
      const res = await fetch(`${API_BASE}/products?${params}`, { headers: getAuthHeader() });
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
  }, [searchApplied, filterStatus, filterBilling, fieldFilterFieldApplied, fieldFilterValueApplied]);

  useEffect(() => { fetchList(pagination.page); }, [pagination.page, fetchList]);

  useEffect(() => {
    const onExcelImported = () => { fetchList(pagination.page); };
    window.addEventListener('nexvia-product-excel-import-completed', onExcelImported);
    return () => window.removeEventListener('nexvia-product-excel-import-completed', onExcelImported);
  }, [fetchList, pagination.page]);
  useEffect(() => { setPagination((p) => ({ ...p, page: 1 })); }, [searchApplied, filterStatus, filterBilling, fieldFilterFieldApplied, fieldFilterValueApplied]);

  useEffect(() => {
    setSelectedIds(new Set());
    selectionAnchorIdxRef.current = null;
  }, [searchApplied, filterStatus, filterBilling, fieldFilterFieldApplied, fieldFilterValueApplied]);

  /** 제품 커스텀 필드 정의 → 리스트 템플릿 열에 반영 (열 설정 모달·표시 순서) */
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/custom-field-definitions?entityType=product`, { headers: getAuthHeader() })
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

  const runSearch = (e) => {
    e?.preventDefault();
    setSearchApplied(searchInput.trim());
    setPagination((p) => ({ ...p, page: 1 }));
  };

  const openAdd = () => setAddModalOpen(true);
  const closeAddModal = () => setAddModalOpen(false);

  const openExcelImportModal = useCallback(() => {
    setExcelImportSeed(null);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set(MODAL_PARAM, MODAL_EXCEL_IMPORT);
      return p;
    });
  }, [setSearchParams]);

  const closeExcelImportModal = useCallback(() => {
    setExcelImportSeed(null);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete(MODAL_PARAM);
      return p;
    }, { replace: true });
  }, [setSearchParams]);
  const openDetail = (row) => {
    if (!row?._id) return;
    setSearchParams({ [MODAL_PARAM]: MODAL_DETAIL, [DETAIL_ID_PARAM]: row._id });
  };
  const closeDetail = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(MODAL_PARAM);
    next.delete(DETAIL_ID_PARAM);
    setSearchParams(next, { replace: true });
  };

  const handleDelete = async (row) => {
    if (!isAdminOrAboveRole(getStoredCrmUser()?.role)) {
      alert('제품 삭제는 관리자(Admin) 이상만 가능합니다.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/products/${row._id}`, { method: 'DELETE', headers: getAuthHeader() });
      if (res.ok) {
        closeDetail();
        fetchList(pagination.page);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || '삭제에 실패했습니다.');
      }
    } catch (_) {
      alert('서버에 연결할 수 없습니다.');
    }
  };

  const saveTemplate = useCallback(async (payload) => {
    try {
      const data = await patchListTemplate(LIST_ID, payload);
      const next = getEffectiveTemplate(LIST_ID, data.listTemplates?.[LIST_ID] || payload, customFieldColumns);
      setTemplate(next);
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
  const colSpan = Math.max(1, displayColumns.length + 1);

  const getSortValue = useCallback((row, key) => {
    if (key === 'name') return (row.name || '').toLowerCase();
    if (key === 'code') return (row.code || '').toLowerCase();
    if (key === 'category') return (row.category || '').toLowerCase();
    if (key === 'version') return (row.version || '').toLowerCase();
    if (key === 'price') return listPriceFromProduct(row);
    if (key === 'costPrice') return Number(row.costPrice) || 0;
    if (key === 'channelPrice') return Number(row.channelPrice) || 0;
    if (key === 'consumerMargin') return getConsumerMargin(row);
    if (key === 'channelMargin') return getChannelMargin(row);
    if (key === 'currency') return (row.currency || '').toLowerCase();
    if (key === 'billingType') return (row.billingType || '').toLowerCase();
    if (key === 'status') return (row.status || '').toLowerCase();
    if (key.startsWith(CUSTOM_FIELDS_PREFIX)) {
      const fk = key.slice(CUSTOM_FIELDS_PREFIX.length);
      const v = row.customFields?.[fk];
      return (v !== undefined && v !== null ? String(v) : '').toLowerCase();
    }
    return '';
  }, []);

  const sortedItems = useMemo(() => {
    if (!sortKey) return items;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [items, sortKey, sortDir, getSortValue]);

  /** 현재 페이지에 표시된 제품만으로 평균 순 마진율(%) — 모바일 요약 카드 */
  const avgMarginPercent = useMemo(() => {
    const rows = items.filter((r) => (Number(listPriceFromProduct(r)) || 0) > 0);
    if (rows.length === 0) return null;
    const sum = rows.reduce((acc, r) => acc + (getConsumerMarginPercent(r) || 0), 0);
    return sum / rows.length;
  }, [items]);

  const handleSortColumn = useCallback((key) => {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { key, dir: 'asc' };
    });
  }, []);

  const pageRowIds = useMemo(() => sortedItems.map((r) => r._id).filter(Boolean), [sortedItems]);
  const allOnPageSelected = pageRowIds.length > 0 && pageRowIds.every((id) => selectedIds.has(id));
  const someOnPageSelected = pageRowIds.some((id) => selectedIds.has(id)) && !allOnPageSelected;

  useEffect(() => {
    const el = headerSelectAllRef.current;
    if (el) el.indeterminate = someOnPageSelected;
  }, [someOnPageSelected]);

  const handleRowCheckboxClick = useCallback((e, rowIdx, rowId) => {
    e.stopPropagation();
    e.preventDefault();
    const list = sortedItems;
    if (!rowId) return;
    if (e.shiftKey && selectionAnchorIdxRef.current != null) {
      const a = selectionAnchorIdxRef.current;
      const start = Math.min(a, rowIdx);
      const end = Math.max(a, rowIdx);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          const id = list[i]?._id;
          if (id) next.add(id);
        }
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(rowId)) next.delete(rowId);
        else next.add(rowId);
        return next;
      });
      selectionAnchorIdxRef.current = rowIdx;
    }
  }, [sortedItems]);

  const toggleSelectAllOnPage = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    const ids = sortedItems.map((r) => r._id).filter(Boolean);
    const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
    selectionAnchorIdxRef.current = null;
  }, [sortedItems, selectedIds]);

  const applyFieldFilter = useCallback(() => {
    const v = fieldFilterInput.trim();
    if (!fieldFilterSelect || !v) {
      alert('필드와 검색 값을 입력해 주세요.');
      return;
    }
    setFieldFilterFieldApplied(fieldFilterSelect);
    setFieldFilterValueApplied(v);
    setPagination((p) => ({ ...p, page: 1 }));
  }, [fieldFilterInput, fieldFilterSelect]);

  const clearFieldFilter = useCallback(() => {
    setFieldFilterFieldApplied('');
    setFieldFilterValueApplied('');
    setFieldFilterInput('');
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  const confirmBulkDelete = useCallback(async () => {
    if (!canDeleteProduct || selectedIds.size === 0) return;
    setBulkDeleteLoading(true);
    try {
      const ids = [...selectedIds];
      const res = await fetch(`${API_BASE}/products/bulk-delete`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || '삭제에 실패했습니다.');
        return;
      }
      if (detailId && ids.includes(detailId)) closeDetail();
      setSelectedIds(new Set());
      selectionAnchorIdxRef.current = null;
      setBulkDeleteOpen(false);
      fetchList(pagination.page);
    } catch (_) {
      alert('서버에 연결할 수 없습니다.');
    } finally {
      setBulkDeleteLoading(false);
    }
  }, [canDeleteProduct, selectedIds, detailId, fetchList, pagination.page, closeDetail]);

  const fetchAllProductsForExport = useCallback(async () => {
    let page = 1;
    let totalPages = 1;
    const all = [];
    do {
      const params = new URLSearchParams({ page: String(page), limit: String(EXPORT_PAGE_LIMIT) });
      if (searchApplied) params.set('search', searchApplied);
      if (filterStatus) params.set('status', filterStatus);
      if (filterBilling) params.set('billingType', filterBilling);
      if (fieldFilterFieldApplied && fieldFilterValueApplied) {
        params.set('filterField', fieldFilterFieldApplied);
        params.set('filterValue', fieldFilterValueApplied);
      }
      const res = await fetch(`${API_BASE}/products?${params}`, { headers: getAuthHeader() });
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
  }, [searchApplied, filterStatus, filterBilling, fieldFilterFieldApplied, fieldFilterValueApplied]);

  const handleDownloadExcel = useCallback(async () => {
    const viewer = getStoredCrmUser();
    if (!isAdminOrAboveRole(viewer?.role)) {
      alert('엑셀 내려받기는 대표(Owner) 또는 관리자(Admin)만 사용할 수 있습니다.');
      return;
    }
    setExportExcelLoading(true);
    try {
      const rows = await fetchAllProductsForExport();
      if (rows.length === 0) {
        alert('보낼 제품이 없습니다.');
        return;
      }
      const customKeys = new Set();
      rows.forEach((r) => {
        if (r.customFields && typeof r.customFields === 'object') {
          Object.keys(r.customFields).forEach((k) => customKeys.add(k));
        }
      });
      const sortedCustomKeys = [...customKeys].sort();
      const exportRows = rows.map((row) => {
        const o = {
          제품명: row.name || '',
          코드: row.code || '',
          카테고리: row.category || '',
          버전: row.version || '',
          소비자가: listPriceFromProduct(row) ?? '',
          원가: row.costPrice ?? '',
          유통가: row.channelPrice ?? '',
          '순 마진': getConsumerMargin(row),
          '유통시 순 마진': shouldDashChannelMargin(row) ? '-' : getChannelMargin(row),
          통화: row.currency || '',
          결제주기: row.billingType ? BILLING_LABELS[row.billingType] || row.billingType : '',
          상태: row.status ? STATUS_LABELS[row.status] || row.status : '',
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
      XLSX.utils.book_append_sheet(wb, ws, '제품');
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `제품목록_${stamp}.xlsx`);
    } catch (e) {
      alert(e?.message || '엑셀 저장에 실패했습니다.');
    } finally {
      setExportExcelLoading(false);
    }
  }, [fetchAllProductsForExport, customFieldLabelByKey]);

  const renderMobileCard = (row, idx) => {
    const mp = getConsumerMarginPercent(row);
    const isEol = row.status === 'EndOfLife';
    const badgeClass =
      row.status === 'Active' ? 'pl-mcard-badge--active' : row.status === 'EndOfLife' ? 'pl-mcard-badge--eol' : 'pl-mcard-badge--draft';
    const sub =
      (row.category && String(row.category).trim()) ||
      (row.code && String(row.code).trim() && `코드 ${row.code}`) ||
      '—';
    return (
      <div
        key={row._id}
        role="button"
        tabIndex={0}
        className={`pl-mcard ${isEol ? 'pl-mcard--eol' : ''}`}
        onClick={() => openDetail(row)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDetail(row);
          }
        }}
      >
        <div className="pl-mcard-top">
          <div
            className="pl-mcard-checkbox-wrap"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            <input
              type="checkbox"
              className="pl-mcard-row-cb"
              checked={selectedIds.has(row._id)}
              onClick={(e) => handleRowCheckboxClick(e, idx, row._id)}
              aria-label={`${row.name || '제품'} 선택`}
            />
          </div>
          <div className="pl-mcard-id">
            <ProductListAvatar row={row} idx={idx} />
            <div className="pl-mcard-text">
              <h3 className="pl-mcard-name">{row.name || '—'}</h3>
              <p className="pl-mcard-sub">{sub}</p>
            </div>
          </div>
          <span className={`pl-mcard-badge ${badgeClass}`}>{STATUS_LABELS[row.status] || row.status || '—'}</span>
        </div>
        <div className={`pl-mcard-grid ${isEol ? 'pl-mcard-grid--muted' : ''}`}>
          <div className="pl-mcard-metric">
            <span className="pl-mcard-metric-label">원가</span>
            <span className="pl-mcard-metric-val">{formatPrice(row.costPrice, row.currency)}</span>
          </div>
          <div className="pl-mcard-metric">
            <span className="pl-mcard-metric-label">소비자가</span>
            <span className="pl-mcard-metric-val">{formatPrice(listPriceFromProduct(row), row.currency)}</span>
          </div>
          <div className="pl-mcard-metric">
            <span className="pl-mcard-metric-label">순 마진</span>
            <span className="pl-mcard-metric-val pl-mcard-metric-val--margin">
              {mp != null ? `${mp.toFixed(1)}%` : '—'}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="page product-list-page">
      <header className="page-header">
        <div className="header-search">
          <button type="submit" form="product-list-search-form" className="header-search-icon-btn" aria-label="검색">
            <span className="material-symbols-outlined">search</span>
          </button>
          <form id="product-list-search-form" onSubmit={runSearch} className="header-search-form">
            <input
              type="text"
              placeholder="모든 필드 검색 (제품명, 코드, 카테고리, 버전, 가격, 통화, 결제·상태, 커스텀 필드 등)…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="제품 검색"
            />
          </form>
        </div>
        <div className="header-actions">
          {canDeleteProduct && selectedIds.size > 0 ? (
            <button
              type="button"
              className="icon-btn product-list-header-delete-btn"
              aria-label="선택한 제품 삭제"
              title="선택한 제품 삭제"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <span className="material-symbols-outlined">delete</span>
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            aria-label="리스트 열 설정"
            onClick={() => {
              setTemplate(getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), customFieldColumns));
              setSettingsOpen(true);
            }}
            title="리스트 열 설정"
          >
            <span className="material-symbols-outlined">settings</span>
          </button>
          <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" />
        </div>
      </header>
      <div className="page-content">
        <section className="pl-mobile-hero pl-mobile-only" aria-label="포트폴리오 요약">
          <p className="pl-mobile-kicker">제품 개요</p>
          <h2 className="pl-mobile-title">현재 포트폴리오</h2>
          <div className="pl-mobile-bento">
            <div className="pl-mobile-bento-card pl-mobile-bento-card--lavender">
              <p className="pl-mobile-bento-label">등록 제품</p>
              <p className="pl-mobile-bento-value">{pagination.total != null ? `${pagination.total.toLocaleString()}개` : '—'}</p>
            </div>
            <div className="pl-mobile-bento-card pl-mobile-bento-card--peach">
              <p className="pl-mobile-bento-label">목록 평균 순 마진</p>
              <p className="pl-mobile-bento-value">
                {avgMarginPercent != null ? `${avgMarginPercent.toFixed(1)}%` : '—'}
              </p>
            </div>
          </div>
        </section>
        <div className="product-list-top pl-desktop-only">
          <div>
            <h2>제품 리스트</h2>
            <p className="page-desc">총 {pagination.total}개 제품</p>
          </div>
          <div className="product-list-top-actions">
            {canExportExcel ? (
              <button
                type="button"
                className="btn-outline product-list-excel-btn"
                onClick={openExcelImportModal}
                title="엑셀 열을 제품 필드에 매핑하여 여러 건을 한 번에 등록합니다. (Owner / Admin 전용)"
              >
                <span className="material-symbols-outlined">upload_file</span>
                엑셀 가져오기
              </button>
            ) : null}
            {canExportExcel ? (
              <button
                type="button"
                className="btn-outline product-list-excel-btn"
                onClick={handleDownloadExcel}
                disabled={exportExcelLoading}
                title="현재 검색·필터 조건에 맞는 제품 전체를 엑셀(.xlsx)로 받습니다. (Owner / Admin 전용)"
              >
                <span className="material-symbols-outlined">download</span>
                {exportExcelLoading ? '준비 중…' : '내보내기'}
              </button>
            ) : null}
            <button type="button" className="btn-primary" onClick={openAdd}>
              <span className="material-symbols-outlined">add</span> 제품 추가
            </button>
          </div>
        </div>
        <div className="product-list-toolbar">
          <div className="product-list-filters pl-desktop-only">
            <select
              className="product-list-filter-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              aria-label="상태 필터"
            >
              <option value="">상태: 전체</option>
              <option value="Active">활성</option>
              <option value="EndOfLife">End of Life</option>
              <option value="Draft">초안</option>
            </select>
            <select
              className="product-list-filter-select"
              value={filterBilling}
              onChange={(e) => setFilterBilling(e.target.value)}
              aria-label="결제 주기 필터"
            >
              <option value="">결제: 전체</option>
              <option value="Monthly">월간</option>
              <option value="Annual">연간</option>
              <option value="Perpetual">영구</option>
            </select>
            <div className="product-list-field-filter" role="group" aria-label="필드별 필터">
              <select
                className="product-list-filter-select product-list-field-filter-select"
                value={fieldFilterSelect}
                onChange={(e) => setFieldFilterSelect(e.target.value)}
                aria-label="필터 필드"
              >
                {fieldFilterOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <input
                type="text"
                className="product-list-field-filter-input"
                value={fieldFilterInput}
                onChange={(e) => setFieldFilterInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyFieldFilter();
                  }
                }}
                placeholder="해당 필드 값"
                aria-label="필드 검색 값"
              />
              <button type="button" className="btn-outline product-list-field-filter-apply" onClick={applyFieldFilter}>
                필터 적용
              </button>
              {fieldFilterFieldApplied && fieldFilterValueApplied ? (
                <button type="button" className="btn-outline product-list-field-filter-clear" onClick={clearFieldFilter}>
                  필터 해제
                </button>
              ) : null}
            </div>
          </div>
          <div className="pl-mobile-field-filter pl-mobile-only">
            <p className="pl-mobile-chips-label">필드 필터</p>
            <div className="pl-mobile-field-filter-row">
              <select
                className="product-list-filter-select product-list-field-filter-select"
                value={fieldFilterSelect}
                onChange={(e) => setFieldFilterSelect(e.target.value)}
                aria-label="필터 필드"
              >
                {fieldFilterOptions.map((opt) => (
                  <option key={`m-${opt.value}`} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <input
                type="text"
                className="product-list-field-filter-input"
                value={fieldFilterInput}
                onChange={(e) => setFieldFilterInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyFieldFilter();
                  }
                }}
                placeholder="값"
                aria-label="필드 검색 값"
              />
            </div>
            <div className="pl-mobile-field-filter-actions">
              <button type="button" className="btn-outline product-list-field-filter-apply" onClick={applyFieldFilter}>
                적용
              </button>
              {fieldFilterFieldApplied && fieldFilterValueApplied ? (
                <button type="button" className="btn-outline product-list-field-filter-clear" onClick={clearFieldFilter}>
                  해제
                </button>
              ) : null}
            </div>
          </div>
          <div className="pl-mobile-chips-block pl-mobile-only">
            <p className="pl-mobile-chips-label">상태</p>
            <div className="pl-mobile-chips-row">
              {[
                { value: '', label: '전체' },
                { value: 'Active', label: '활성' },
                { value: 'EndOfLife', label: 'EOL' },
                { value: 'Draft', label: '초안' }
              ].map((opt) => (
                <button
                  key={`st-${opt.value || 'all'}`}
                  type="button"
                  className={`pl-mobile-chip ${filterStatus === opt.value ? 'is-active' : ''}`}
                  onClick={() => setFilterStatus(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="pl-mobile-chips-label pl-mobile-chips-label--spaced">결제</p>
            <div className="pl-mobile-chips-row">
              {[
                { value: '', label: '전체' },
                { value: 'Monthly', label: '월간' },
                { value: 'Annual', label: '연간' },
                { value: 'Perpetual', label: '영구' }
              ].map((opt) => (
                <button
                  key={`bl-${opt.value || 'all'}`}
                  type="button"
                  className={`pl-mobile-chip ${filterBilling === opt.value ? 'is-active' : ''}`}
                  onClick={() => setFilterBilling(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="panel table-panel">
          <div className="pl-mobile-cards-wrap">
            {loading ? (
              <p className="pl-mobile-cards-message">불러오는 중...</p>
            ) : sortedItems.length === 0 ? (
              <p className="pl-mobile-cards-message">등록된 제품이 없습니다.</p>
            ) : (
              <div className="pl-mobile-cards-list">
                {sortedItems.map((row, idx) => renderMobileCard(row, idx))}
              </div>
            )}
          </div>
          <div className="table-wrap">
            <table className="data-table product-list-table">
              <thead>
                <tr>
                  <th className="pl-th-checkbox" scope="col" aria-label="현재 페이지 전체 선택">
                    <input
                      ref={headerSelectAllRef}
                      type="checkbox"
                      className="pl-row-checkbox"
                      checked={allOnPageSelected}
                      onClick={toggleSelectAllOnPage}
                      title="현재 페이지 전체 선택"
                    />
                  </th>
                  {displayColumns.map((col) => (
                    <th
                      key={col.key}
                      className={[
                        'list-template-th-sortable',
                        dragOverKey === col.key ? 'list-template-drag-over' : '',
                        productListColumnToneClass(col.key)
                      ].filter(Boolean).join(' ')}
                      draggable
                      onDragStart={(e) => handleHeaderDragStart(e, col.key)}
                      onDragOver={(e) => handleHeaderDragOver(e, col.key)}
                      onDragLeave={handleHeaderDragLeave}
                      onDrop={(e) => handleHeaderDrop(e, col.key)}
                      onClick={() => handleSortColumn(col.key)}
                    >
                      <span className="list-template-th-content">
                        <span className="material-symbols-outlined list-template-drag-handle" aria-hidden>drag_indicator</span>
                        {col.label}
                        {sortKey === col.key && (
                          <span className="list-template-sort-icon material-symbols-outlined" aria-hidden>
                            {sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                          </span>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={colSpan} className="text-center">불러오는 중...</td></tr>
                ) : sortedItems.length === 0 ? (
                  <tr><td colSpan={colSpan} className="text-center">등록된 제품이 없습니다.</td></tr>
                ) : (
                  sortedItems.map((row, rowIdx) => (
                    <tr
                      key={row._id}
                      className={`product-list-row-clickable ${row.status === 'EndOfLife' ? 'product-list-row-eol' : ''}`}
                      onClick={() => openDetail(row)}
                    >
                      <td className="pl-td-checkbox" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="pl-row-checkbox"
                          checked={selectedIds.has(row._id)}
                          onClick={(e) => handleRowCheckboxClick(e, rowIdx, row._id)}
                          aria-label={`${row.name || '제품'} 선택`}
                        />
                      </td>
                      {displayColumns.map((col) => (
                        <td key={col.key} className={productListColumnToneClass(col.key)}>
                          {col.key === 'name' && (
                            <div className="product-list-cell-name">
                              <ProductListAvatar row={row} idx={rowIdx} />
                              <div>
                                <span className="product-list-name">{row.name || '—'}</span>
                                {row.code && !template.visible?.code && (
                                  <span className="product-list-uid">UID: {row.code}</span>
                                )}
                              </div>
                            </div>
                          )}
                          {col.key === 'category' && (
                            row.category ? (
                              <span className="product-list-category-badge">{row.category}</span>
                            ) : '—'
                          )}
                          {col.key === 'version' && <span className="product-list-version">{row.version || '—'}</span>}
                          {col.key === 'code' && <span className="text-muted">{row.code || '—'}</span>}
                          {col.key === 'currency' && <span>{row.currency || '—'}</span>}
                          {col.key === 'billingType' && (
                            <span className="product-list-billing">{row.billingType ? BILLING_LABELS[row.billingType] || row.billingType : '—'}</span>
                          )}
                          {col.key === 'price' && (
                            <div className="product-list-pricing">
                              <span className="product-list-price">{formatPrice(listPriceFromProduct(row), row.currency)}</span>
                              {row.billingType && !template.visible?.billingType && (
                                <span className="product-list-billing">{BILLING_LABELS[row.billingType] || row.billingType}</span>
                              )}
                            </div>
                          )}
                          {col.key === 'costPrice' && (
                            <span className="product-list-price">{formatPrice(row.costPrice, row.currency)}</span>
                          )}
                          {col.key === 'channelPrice' && (
                            <span className="product-list-price">{formatPrice(row.channelPrice, row.currency)}</span>
                          )}
                          {col.key === 'consumerMargin' && (
                            <span className="product-list-price">{formatPrice(getConsumerMargin(row), row.currency)}</span>
                          )}
                          {col.key === 'channelMargin' && (
                            <span className="product-list-price">
                              {shouldDashChannelMargin(row) ? '-' : formatPrice(getChannelMargin(row), row.currency)}
                            </span>
                          )}
                          {col.key === 'status' && (
                            <span className={`status-badge status-${row.status === 'Active' ? 'active' : row.status === 'EndOfLife' ? 'eol' : 'draft'}`}>
                              {STATUS_LABELS[row.status] || row.status}
                            </span>
                          )}
                          {col.key.startsWith(CUSTOM_FIELDS_PREFIX) && (() => {
                            const fk = col.key.slice(CUSTOM_FIELDS_PREFIX.length);
                            const v = row.customFields?.[fk];
                            return <span className="text-muted">{v !== undefined && v !== null && v !== '' ? String(v) : '—'}</span>;
                          })()}
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
      <button type="button" className="pl-mobile-fab" aria-label="제품 추가" onClick={openAdd}>
        <span className="material-symbols-outlined">add</span>
      </button>
      {addModalOpen && (
        <AddProductModal
          product={null}
          onClose={closeAddModal}
          onSaved={() => { fetchList(pagination.page); closeAddModal(); }}
          onOpenBulkImport={({ rows, fileName }) => {
            setExcelImportSeed({ rows, fileName: fileName || '' });
            closeAddModal();
            setSearchParams((prev) => {
              const p = new URLSearchParams(prev);
              p.set(MODAL_PARAM, MODAL_EXCEL_IMPORT);
              return p;
            });
          }}
        />
      )}
      {isExcelImportOpen && (
        <ProductExcelImportModal
          open={isExcelImportOpen}
          onClose={closeExcelImportModal}
          onImported={() => { fetchList(pagination.page); }}
          initialExcelRows={excelImportSeed?.rows ?? null}
          initialFileName={excelImportSeed?.fileName ?? ''}
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
      {isDetailOpen && detailProduct && (
        <ProductDetailModal
          product={detailProduct}
          onClose={closeDetail}
          onUpdated={() => { fetchList(pagination.page); }}
          onDelete={canDeleteProduct ? handleDelete : undefined}
        />
      )}
      {bulkDeleteOpen && canDeleteProduct ? (
        <div className="product-bulk-delete-overlay" role="presentation">
          <div
            className="product-bulk-delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-bulk-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="product-bulk-delete-title" className="product-bulk-delete-title">선택한 제품 삭제</h3>
            <p className="product-bulk-delete-msg">삭제 하시겠습니까? ({selectedIds.size}건)</p>
            <div className="product-bulk-delete-actions">
              <button
                type="button"
                className="btn-outline"
                disabled={bulkDeleteLoading}
                onClick={() => setBulkDeleteOpen(false)}
              >
                취소
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={bulkDeleteLoading}
                onClick={confirmBulkDelete}
              >
                {bulkDeleteLoading ? '삭제 중…' : '확인'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
