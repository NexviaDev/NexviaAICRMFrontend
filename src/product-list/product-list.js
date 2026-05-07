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
  patchListTemplate,
  patchProductSearchModalUsage
} from '../lib/list-templates';
import './product-list.css';
import './product-list-responsive.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import ListPaginationButtons from '@/components/list-pagination-buttons/list-pagination-buttons';

import * as XLSX from 'xlsx';

import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import { listPriceFromProduct } from '@/lib/product-price-utils';
import { CATEGORY_AVATAR_RULES } from './product-category-avatar-config';
const LIST_ID = LIST_IDS.PRODUCT_LIST;
const LIMIT = 10;
/** 검색 모달: 페이지네이션 UI 숨김 — 한 번에 더 많이 불러옴 */
const LIMIT_SEARCH_MODAL = 500;
const EXPORT_PAGE_LIMIT = 100;

const MODAL_PARAM = 'modal';
const MODAL_DETAIL = 'detail';
const MODAL_EXCEL_IMPORT = 'excel-import';
const DETAIL_ID_PARAM = 'id';
const STATUS_LABELS = { Active: '활성', EndOfLife: 'End of Life', Draft: '초안' };
const BILLING_LABELS = { Monthly: '월간', Annual: '연간', Perpetual: '영구' };
const CUSTOM_FIELDS_PREFIX = 'customFields.';

/** API JSON의 _id(ObjectId/문자열)와 Set 비교 시 동일하게 문자열로 통일 */
function productIdKey(id) {
  return id != null && id !== '' ? String(id) : '';
}

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

/**
 * @param {{ listVariant?: 'page' | 'searchModal', onSearchModalClose?: () => void, onSearchModalConfirm?: (products: object[]) => void }} props
 */
export default function ProductList({
  listVariant = 'page',
  onSearchModalClose,
  onSearchModalConfirm
}) {
  const isSearchModal = listVariant === 'searchModal';
  const listPageLimit = isSearchModal ? LIMIT_SEARCH_MODAL : LIMIT;
  const [searchParams, setSearchParams] = useSearchParams();
  /** 검색 모달: URL 대신 로컬로 상세 열어 라우트 오염 방지 */
  const [pickerDetailProduct, setPickerDetailProduct] = useState(null);
  const pickedProductByIdRef = useRef(new Map());
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState(() => ({
    page: 1,
    limit: listVariant === 'searchModal' ? LIMIT_SEARCH_MODAL : LIMIT,
    total: 0,
    totalPages: 0
  }));
  const [searchInput, setSearchInput] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  /** 연락처 목록과 동일: 제출 시점의 검색 필드 (빈 값 = 전체 필드) */
  const [searchFieldDraft, setSearchFieldDraft] = useState('');
  const [appliedSearchField, setAppliedSearchField] = useState('');
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
  const [bulkCopyLoading, setBulkCopyLoading] = useState(false);
  const [excelImportSeed, setExcelImportSeed] = useState(null);
  const selectionAnchorIdxRef = useRef(null);
  const headerSelectAllRef = useRef(null);

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

  /** 헤더 검색 필드 셀렉트 — API searchField 쿼리와 동일 키 */
  const searchFieldOptions = useMemo(() => {
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

  const searchFieldPlaceholderHint = useMemo(() => {
    if (!searchFieldDraft) {
      return '모든 필드 검색 (제품명, 코드, 카테고리, 버전, 가격, 통화, 결제·상태, 커스텀 필드 등)…';
    }
    const opt = searchFieldOptions.find((o) => o.value === searchFieldDraft);
    return `${opt?.label || searchFieldDraft} 검색…`;
  }, [searchFieldDraft, searchFieldOptions]);

  const me = useMemo(() => getStoredCrmUser(), []);
  const canExportExcel = isAdminOrAboveRole(me?.role);
  const canDeleteProduct = isAdminOrAboveRole(me?.role);

  const detailId = searchParams.get(DETAIL_ID_PARAM);
  const modalParam = searchParams.get(MODAL_PARAM);
  const isDetailOpenPage = modalParam === MODAL_DETAIL && detailId;
  const isExcelImportOpen = !isSearchModal && modalParam === MODAL_EXCEL_IMPORT;
  const detailProductPage = isDetailOpenPage ? items.find((p) => p._id === detailId) || null : null;
  const isDetailOpen = isSearchModal ? Boolean(pickerDetailProduct) : isDetailOpenPage;
  const detailProduct = isSearchModal ? pickerDetailProduct : detailProductPage;

  const fetchList = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(listPageLimit) });
      if (searchApplied) {
        params.set('search', searchApplied);
        if (appliedSearchField) params.set('searchField', appliedSearchField);
      }
      const res = await fetch(`${API_BASE}/products?${params}`, { headers: getAuthHeader() });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setPagination((prev) => {
          const pg = data.pagination || { page: 1, limit: listPageLimit, total: 0, totalPages: 0 };
          return { ...pg, limit: prev.limit };
        });
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
  }, [searchApplied, appliedSearchField, listPageLimit]);

  useEffect(() => { fetchList(pagination.page); }, [pagination.page, fetchList]);

  useEffect(() => {
    const onExcelImported = () => { fetchList(pagination.page); };
    window.addEventListener('nexvia-product-excel-import-completed', onExcelImported);
    return () => window.removeEventListener('nexvia-product-excel-import-completed', onExcelImported);
  }, [fetchList, pagination.page]);
  useEffect(() => { setPagination((p) => ({ ...p, page: 1 })); }, [searchApplied, appliedSearchField]);

  useEffect(() => {
    setSelectedIds(new Set());
    selectionAnchorIdxRef.current = null;
  }, [searchApplied, appliedSearchField]);

  useEffect(() => {
    for (const row of items) {
      const id = productIdKey(row._id);
      if (id) pickedProductByIdRef.current.set(id, row);
    }
  }, [items]);

  /** 제품 커스텀 필드 정의 API → 열 설정·표시에 사용 (재사용: 마운트 시 + 설정 버튼 클릭 시 최신 반영) */
  const fetchProductCustomFieldColumnDefs = useCallback(async () => {
    await pingBackendHealth(getAuthHeader);
    const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=product`, { headers: getAuthHeader() });
    const data = await res.json().catch(() => ({}));
    const defs = Array.isArray(data?.items) ? data.items : [];
    return defs.map((d) => ({ key: `${CUSTOM_FIELDS_PREFIX}${d.key}`, label: d.label || d.key || '' }));
  }, []);

  /** 제품 커스텀 필드 정의 → 리스트 템플릿 열에 반영 (열 설정 모달·표시 순서) */
  useEffect(() => {
    let cancelled = false;
    fetchProductCustomFieldColumnDefs()
      .then((extra) => {
        if (cancelled) return;
        setCustomFieldColumns(extra);
        setTemplate(getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), extra));
      })
      .catch(() => {
        if (!cancelled) setCustomFieldColumns([]);
      });
    return () => { cancelled = true; };
  }, [fetchProductCustomFieldColumnDefs]);

  const openListColumnSettings = useCallback(async () => {
    try {
      const extra = await fetchProductCustomFieldColumnDefs();
      setCustomFieldColumns(extra);
      setTemplate(getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), extra));
      setSettingsOpen(true);
    } catch (_) {
      setTemplate(getEffectiveTemplate(LIST_ID, getSavedTemplate(LIST_ID), customFieldColumns));
      setSettingsOpen(true);
    }
  }, [fetchProductCustomFieldColumnDefs, customFieldColumns]);

  const runSearch = (e) => {
    e?.preventDefault();
    setSearchApplied(searchInput.trim());
    setAppliedSearchField(searchFieldDraft);
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
    if (isSearchModal) {
      setPickerDetailProduct(row);
      return;
    }
    setSearchParams({ [MODAL_PARAM]: MODAL_DETAIL, [DETAIL_ID_PARAM]: row._id });
  };
  const closeDetail = () => {
    if (isSearchModal) {
      setPickerDetailProduct(null);
      return;
    }
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
    saveTemplate({ columnOrder: order, visible: template.visible, columnCellStyles: template.columnCellStyles });
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

  const pageRowIds = useMemo(
    () => sortedItems.map((r) => productIdKey(r._id)).filter(Boolean),
    [sortedItems]
  );
  const allOnPageSelected = pageRowIds.length > 0 && pageRowIds.every((id) => selectedIds.has(id));
  const someOnPageSelected = pageRowIds.some((id) => selectedIds.has(id)) && !allOnPageSelected;

  useEffect(() => {
    const el = headerSelectAllRef.current;
    if (el) el.indeterminate = someOnPageSelected;
  }, [someOnPageSelected]);

  const handleRowCheckboxClick = useCallback((e, rowIdx, rowId) => {
    e.stopPropagation();
    /* preventDefault 금지: controlled checkbox와 충돌 시 체크 표시가 한 박자 밀림 */
    const list = sortedItems;
    const sid = productIdKey(rowId);
    if (!sid) return;
    if (e.shiftKey && selectionAnchorIdxRef.current != null) {
      const a = selectionAnchorIdxRef.current;
      const start = Math.min(a, rowIdx);
      const end = Math.max(a, rowIdx);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          const id = productIdKey(list[i]?._id);
          if (id) next.add(id);
        }
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(sid)) next.delete(sid);
        else next.add(sid);
        return next;
      });
      selectionAnchorIdxRef.current = rowIdx;
    }
  }, [sortedItems]);

  const toggleSelectAllOnPage = useCallback((e) => {
    e.stopPropagation();
    const ids = sortedItems.map((r) => productIdKey(r._id)).filter(Boolean);
    setSelectedIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
    selectionAnchorIdxRef.current = null;
  }, [sortedItems]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    selectionAnchorIdxRef.current = null;
  }, []);

  const handleSearchModalConfirm = useCallback(async () => {
    if (!isSearchModal) return;
    const ids = [...selectedIds];
    const products = ids.map((id) => pickedProductByIdRef.current.get(String(id))).filter(Boolean);
    if (products.length === 0) return;
    try {
      await patchProductSearchModalUsage(products.map((p) => String(p._id)));
    } catch (_) {
      /* 저장 실패해도 선택은 진행 */
    }
    onSearchModalConfirm?.(products);
  }, [isSearchModal, selectedIds, onSearchModalConfirm]);

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
      const openDetailId = isSearchModal ? pickerDetailProduct?._id : detailId;
      if (openDetailId && ids.includes(String(openDetailId))) closeDetail();
      setSelectedIds(new Set());
      selectionAnchorIdxRef.current = null;
      setBulkDeleteOpen(false);
      fetchList(pagination.page);
    } catch (_) {
      alert('서버에 연결할 수 없습니다.');
    } finally {
      setBulkDeleteLoading(false);
    }
  }, [canDeleteProduct, selectedIds, detailId, fetchList, pagination.page, closeDetail, isSearchModal, pickerDetailProduct?._id]);

  /** 일괄 복사: 원본 GET 후 신규 POST — 제품명 끝에 ` (복사본)` 추가, 코드는 비움(충돌 방지) */
  const runBulkCopy = useCallback(async () => {
    if (selectedIds.size === 0 || bulkCopyLoading) return;
    const n = selectedIds.size;
    if (!window.confirm(`선택한 ${n}개 제품을 복사해 새로 등록할까요?\n제품명 끝에 「 (복사본)」이 붙습니다.`)) return;
    setBulkCopyLoading(true);
    await pingBackendHealth(getAuthHeader);
    const ids = [...selectedIds];
    let ok = 0;
    let fail = 0;
    try {
      for (const id of ids) {
        try {
          const res = await fetch(`${API_BASE}/products/${encodeURIComponent(id)}`, { headers: getAuthHeader() });
          const src = await res.json().catch(() => ({}));
          if (!res.ok) {
            fail += 1;
            continue;
          }
          const baseName = String(src.name || '').trim();
          const newName = baseName ? `${baseName} (복사본)` : '(복사본)';
          const lp = listPriceFromProduct(src) ?? Number(src.listPrice ?? src.price) ?? 0;
          const costP = Number(src.costPrice) || 0;
          const channelP = Number(src.channelPrice) || 0;
          const createRes = await fetch(`${API_BASE}/products`, {
            method: 'POST',
            headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: newName,
              code: '',
              category: src.category != null ? String(src.category) : '',
              version: src.version != null ? String(src.version) : '',
              listPrice: lp,
              price: lp,
              costPrice: costP,
              channelPrice: channelP,
              currency: src.currency || 'KRW',
              billingType: src.billingType || 'Monthly',
              status: src.status || 'Active',
              customFields:
                src.customFields && typeof src.customFields === 'object' && Object.keys(src.customFields).length
                  ? { ...src.customFields }
                  : undefined
            })
          });
          if (createRes.ok) ok += 1;
          else fail += 1;
        } catch {
          fail += 1;
        }
      }
      setSelectedIds(new Set());
      selectionAnchorIdxRef.current = null;
      fetchList(pagination.page);
      if (fail > 0) {
        window.alert(`${ok}건 복사 완료, ${fail}건 실패했습니다.`);
      } else {
        window.alert(`${ok}건 복사되었습니다.`);
      }
    } catch {
      window.alert('복사 중 오류가 발생했습니다.');
    } finally {
      setBulkCopyLoading(false);
    }
  }, [selectedIds, fetchList, pagination.page]);

  const fetchAllProductsForExport = useCallback(async () => {
    let page = 1;
    let totalPages = 1;
    const all = [];
    do {
      const params = new URLSearchParams({ page: String(page), limit: String(EXPORT_PAGE_LIMIT) });
      if (searchApplied) {
        params.set('search', searchApplied);
        if (appliedSearchField) params.set('searchField', appliedSearchField);
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
  }, [searchApplied, appliedSearchField]);

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
        className={`pl-mcard ${isEol ? 'pl-mcard--eol' : ''}${isSearchModal ? ' pl-mcard--search-modal-pick' : ''}`}
        onClick={(e) => {
          if (isSearchModal) handleRowCheckboxClick(e, idx, row._id);
          else openDetail(row);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (isSearchModal) handleRowCheckboxClick(e, idx, row._id);
            else openDetail(row);
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
              checked={selectedIds.has(productIdKey(row._id))}
              onChange={() => {}}
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
    <div className={`page product-list-page${isSearchModal ? ' product-list-page--search-modal' : ''}`}>
      <header className="page-header">
        <div className="header-search">
          <button type="submit" form="product-list-search-form" className="header-search-icon-btn" aria-label="검색">
            <span className="material-symbols-outlined">search</span>
          </button>
          <form id="product-list-search-form" onSubmit={runSearch} className="header-search-form">
            <input
              type="text"
              placeholder={searchFieldPlaceholderHint}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="제품 검색"
            />
          </form>
          <select
            className="pl-search-field-select"
            value={searchFieldDraft}
            onChange={(e) => setSearchFieldDraft(e.target.value)}
            aria-label="검색 필드"
          >
            <option value="">전체 필드</option>
            {searchFieldOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label="리스트 열 설정"
            onClick={() => void openListColumnSettings()}
            title="리스트 열 설정"
          >
            <span className="material-symbols-outlined">settings</span>
          </button>
          {!isSearchModal ? <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" /> : null}
        </div>
      </header>
      <div className="page-content">
        {!isSearchModal && selectedIds.size > 0 ? (
          <div className="cce-action-bar">
            <span className="cce-action-bar-count">
              <strong>{selectedIds.size}</strong>개 선택됨
              <span className="cce-action-bar-hint">Shift+클릭으로 범위 선택</span>
            </span>
            <div className="cce-action-bar-btns">
              <button
                type="button"
                className="cce-action-bar-copy-bulk"
                onClick={runBulkCopy}
                disabled={bulkCopyLoading || bulkDeleteLoading}
                title="선택한 제품을 복사해 새로 등록합니다. 제품명 끝에 (복사본)이 붙습니다."
              >
                <span
                  className={`material-symbols-outlined${bulkCopyLoading ? ' cce-action-bar-copy-icon--spin' : ''}`}
                  aria-hidden
                >
                  {bulkCopyLoading ? 'progress_activity' : 'content_copy'}
                </span>
                {bulkCopyLoading ? '복사 중…' : '복사하기'}
              </button>
              {canDeleteProduct ? (
                <button
                  type="button"
                  className="cce-action-bar-delete"
                  onClick={() => setBulkDeleteOpen(true)}
                  disabled={bulkDeleteLoading || bulkCopyLoading}
                  title="선택한 제품을 삭제합니다 (Owner / Admin)"
                >
                  <span className="material-symbols-outlined" aria-hidden>delete</span>
                  {bulkDeleteLoading ? '삭제 중…' : '선택 항목 삭제'}
                </button>
              ) : null}
              <button type="button" className="cce-action-bar-cancel" onClick={clearSelection}>
                선택 해제
              </button>
            </div>
          </div>
        ) : null}
        {!isSearchModal ? (
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
        ) : null}
        {!isSearchModal ? (
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
        ) : null}
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
                      onChange={() => {}}
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
                      className={`${isSearchModal ? 'product-list-row--search-modal-pick' : 'product-list-row-clickable'} ${row.status === 'EndOfLife' ? 'product-list-row-eol' : ''}`}
                      onClick={(e) => {
                        if (isSearchModal) handleRowCheckboxClick(e, rowIdx, row._id);
                        else openDetail(row);
                      }}
                    >
                      <td className="pl-td-checkbox" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="pl-row-checkbox"
                          checked={selectedIds.has(productIdKey(row._id))}
                          onChange={() => {}}
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
          {!isSearchModal ? (
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
          ) : null}
        </div>
        {isSearchModal ? (
          <div className="product-list-search-modal-footer" role="group" aria-label="제품 선택">
            <p className="product-list-search-modal-footer-count">
              <strong>{selectedIds.size}</strong>개 선택 · Shift+클릭으로 범위 선택
            </p>
            <div className="product-list-search-modal-footer-btns">
              <button type="button" className="btn-outline" onClick={() => onSearchModalClose?.()}>
                취소
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={selectedIds.size === 0}
                onClick={() => void handleSearchModalConfirm()}
              >
                선택 완료
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {!isSearchModal ? (
      <button type="button" className="pl-mobile-fab" aria-label="제품 추가" onClick={openAdd}>
        <span className="material-symbols-outlined">add</span>
      </button>
      ) : null}
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
          columnCellStyles={template.columnCellStyles}
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
