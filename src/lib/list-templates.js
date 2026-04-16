/**
 * 리스트 컬럼 템플릿: User listTemplates와 기본 컬럼 정의.
 * customerCompanies, customerCompanyEmployees, productList 열 순서·표시 여부,
 * calendar 보기(월/주/일), salesPipeline 필터 저장/복원.
 */

import { API_BASE } from '@/config';

export const LIST_IDS = {
  CUSTOMER_COMPANIES: 'customerCompanies',
  CUSTOMER_COMPANY_EMPLOYEES: 'customerCompanyEmployees',
  PRODUCT_LIST: 'productList',
  /** 캘린더 월/주/일 보기 — user.listTemplates.calendar */
  CALENDAR: 'calendar',
  /** 세일즈 파이프라인 «내 기회만» 필터 — listTemplates.salesPipeline.assigneeMeOnly */
  SALES_PIPELINE: 'salesPipeline'
};

const CALENDAR_VIEW_MODES = new Set(['month', 'week', 'day']);

/** 로컬 crm_user에 저장된 캘린더 보기 (기본 month) */
export function getSavedCalendarViewMode() {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : null;
    const v = user?.listTemplates?.calendar?.viewMode;
    if (CALENDAR_VIEW_MODES.has(v)) return v;
  } catch (_) {}
  return 'month';
}

/**
 * PATCH /api/auth/list-templates — listId: calendar, viewMode: month | week | day
 * 응답 listTemplates로 crm_user 동기화
 */
export async function patchCalendarViewTemplate({ viewMode }) {
  if (!CALENDAR_VIEW_MODES.has(viewMode)) {
    throw new Error('viewMode는 month, week, day 중 하나여야 합니다.');
  }
  const res = await fetch(`${API_BASE}/auth/list-templates`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify({ listId: LIST_IDS.CALENDAR, viewMode })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
  const userRaw = localStorage.getItem('crm_user');
  const user = userRaw ? JSON.parse(userRaw) : {};
  user.listTemplates = data.listTemplates || user.listTemplates || {};
  localStorage.setItem('crm_user', JSON.stringify(user));
  return data;
}

/** 각 리스트의 기본 컬럼 정의 (key, label). 순서가 기본 표시 순서. */
export const DEFAULT_COLUMNS = {
  [LIST_IDS.CUSTOMER_COMPANIES]: [
    { key: '_favorite', label: '즐겨찾기' },
    { key: 'name', label: '고객사명' },
    { key: 'representativeName', label: '대표자' },
    { key: 'industry', label: '업종' },
    { key: 'address', label: '주소' },
    { key: 'status', label: '상태', defaultVisible: false },
    { key: 'assigneeUserIds', label: '담당자' }
  ],
  [LIST_IDS.CUSTOMER_COMPANY_EMPLOYEES]: [
    { key: '_check', label: '선택' },
    { key: '_favorite', label: '즐겨찾기' },
    { key: 'company', label: '회사' },
    { key: 'name', label: '이름' },
    { key: 'phone', label: '연락처' },
    { key: 'email', label: '이메일' },
    { key: 'status', label: '상태', defaultVisible: false },
    { key: 'assigneeUserIds', label: '담당자' },
    { key: 'lastSupportedAt', label: '최근 지원 일자' }
  ],
  [LIST_IDS.PRODUCT_LIST]: [
    { key: 'name', label: '제품명' },
    { key: 'code', label: '제품 코드' },
    { key: 'category', label: '카테고리' },
    { key: 'version', label: '버전' },
    { key: 'price', label: '소비자가' },
    { key: 'costPrice', label: '원가' },
    { key: 'channelPrice', label: '유통가' },
    { key: 'consumerMargin', label: '소비자 마진' },
    { key: 'channelMargin', label: '유통 마진' },
    { key: 'currency', label: '통화' },
    { key: 'billingType', label: '결제 주기' },
    { key: 'status', label: '상태' }
  ]
};

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 저장된 템플릿과 기본값을 합쳐 실제 사용할 columnOrder, visible, columns 반환.
 * @param {string} listId
 * @param {object} saved - 저장된 템플릿 (columnOrder, visible)
 * @param {{ key: string, label: string }[]} [extraColumns] - 새 고객사/연락처 추가로 정의된 커스텀 필드 컬럼 (key: customFields.xxx, label)
 */
export function getEffectiveTemplate(listId, saved, extraColumns = []) {
  const defaults = DEFAULT_COLUMNS[listId];
  if (!defaults) return { columnOrder: [], visible: {}, columns: [] };
  const defaultOrder = defaults.map((c) => c.key);
  const extraOrder = (Array.isArray(extraColumns) ? extraColumns : []).map((c) => c.key);
  const allOrder = [...defaultOrder];
  for (const k of extraOrder) {
    if (!allOrder.includes(k)) allOrder.push(k);
  }
  const defaultVisible = Object.fromEntries(
    defaults.map((c) => [c.key, c.defaultVisible !== false])
  );
  const extraVisible = Object.fromEntries((Array.isArray(extraColumns) ? extraColumns : []).map((c) => [c.key, true]));
  const columnOrder = Array.isArray(saved?.columnOrder) && saved.columnOrder.length > 0
    ? saved.columnOrder.filter((k) => allOrder.includes(k))
    : defaultOrder;
  const missingOrder = allOrder.filter((k) => !columnOrder.includes(k));
  let order = [...columnOrder, ...missingOrder];
  if (listId === LIST_IDS.CUSTOMER_COMPANY_EMPLOYEES && order.includes('_favorite')) {
    order = order.filter((key) => key !== '_favorite');
    const checkIdx = order.indexOf('_check');
    if (checkIdx >= 0) order.splice(checkIdx + 1, 0, '_favorite');
    else order.unshift('_favorite');
  }
  if (listId === LIST_IDS.CUSTOMER_COMPANIES && order.includes('_favorite')) {
    order = order.filter((key) => key !== '_favorite');
    order.unshift('_favorite');
  }
  /** 사업자 번호는 고객사명 셀 아래에 표시하므로 열에서 제외 (저장된 템플릿 호환) */
  if (listId === LIST_IDS.CUSTOMER_COMPANIES) {
    order = order.filter((key) => key !== 'businessNumber');
  }
  const visible = { ...defaultVisible, ...extraVisible, ...(saved?.visible && typeof saved.visible === 'object' ? saved.visible : {}) };
  const columns = order.map((key) => defaults.find((c) => c.key === key) || (extraColumns || []).find((c) => c.key === key)).filter(Boolean);
  return { columnOrder: order, visible, columns };
}

/** 현재 유저의 listTemplates에서 해당 리스트 템플릿 가져오기 */
export function getSavedTemplate(listId) {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : null;
    const templates = user?.listTemplates;
    if (templates && typeof templates === 'object' && templates[listId]) return templates[listId];
  } catch (_) {}
  return null;
}

/**
 * 메일 명함 HTML: `listTemplates.emailSignature.html` 우선, 없으면 구버전 최상위 `emailSignatureHtml`
 * @param {object | null | undefined} user — crm_user 또는 GET /auth/me 의 user
 */
export function getEmailSignatureHtmlFromUser(user) {
  if (!user || typeof user !== 'object') return '';
  const lt = user.listTemplates;
  if (lt && typeof lt === 'object' && lt.emailSignature != null && typeof lt.emailSignature === 'object') {
    const h = lt.emailSignature.html;
    if (h != null && String(h).trim() !== '') return String(h);
  }
  if (user.emailSignatureHtml != null && String(user.emailSignatureHtml).trim() !== '') {
    return String(user.emailSignatureHtml);
  }
  return '';
}

/**
 * PATCH /api/auth/email-signature — 명함을 user.listTemplates.emailSignature 에 저장 후 crm_user 동기화
 * @param {string} html — 원본 HTML (서버에서 sanitize)
 */
export async function patchEmailSignatureHtml(html) {
  const res = await fetch(`${API_BASE}/auth/email-signature`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify({ emailSignatureHtml: html })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || '저장에 실패했습니다.');
  const userRaw = localStorage.getItem('crm_user');
  const user = userRaw ? JSON.parse(userRaw) : {};
  if (data.listTemplates && typeof data.listTemplates === 'object') {
    user.listTemplates = data.listTemplates;
  }
  if (data.emailSignatureHtml != null) user.emailSignatureHtml = data.emailSignatureHtml;
  localStorage.setItem('crm_user', JSON.stringify(user));
  return data;
}

/** PATCH /api/auth/list-templates 호출 후 응답의 listTemplates로 crm_user 갱신 (columnOrder, visible, assigneeMeOnly) */
export async function patchListTemplate(listId, { columnOrder, visible, assigneeMeOnly }) {
  const payload = { listId };
  if (columnOrder !== undefined) payload.columnOrder = columnOrder;
  if (visible !== undefined) payload.visible = visible;
  if (assigneeMeOnly !== undefined) payload.assigneeMeOnly = assigneeMeOnly;
  const res = await fetch(`${API_BASE}/auth/list-templates`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || '저장에 실패했습니다.');
  }
  const data = await res.json();
  const userRaw = localStorage.getItem('crm_user');
  const user = userRaw ? JSON.parse(userRaw) : {};
  user.listTemplates = data.listTemplates || user.listTemplates || {};
  localStorage.setItem('crm_user', JSON.stringify(user));
  return data;
}

/**
 * 사이드바 라우트 목록이 바뀔 때마다 1씩 올리면, Sidebar가 저장값을 다시 병합합니다.
 * (신규 메뉴 누락·PWA 구버전 번들 이슈 완화)
 */
export const SIDEBAR_MENU_EPOCH = 4;

function dedupeRoutesPreserveOrder(paths) {
  const seen = new Set();
  return paths.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

function normalizeByDefaults(defaultOrder, savedOrder) {
  const defaults = Array.isArray(defaultOrder) ? defaultOrder.filter((x) => typeof x === 'string') : [];
  const saved = Array.isArray(savedOrder)
    ? dedupeRoutesPreserveOrder(savedOrder.filter((x) => defaults.includes(x)))
    : [];
  const seen = new Set(saved);
  const merged = [...saved];
  for (const key of defaults) {
    if (!seen.has(key)) merged.push(key);
  }
  return merged;
}

/**
 * 2레벨 사이드바 정규화.
 * @param {{ key: string }[]} categories
 * @param {Record<string, { to: string }[]>} itemsByCategory
 * @param {object | null} saved
 */
export function normalizeSidebar2LevelConfig(categories, itemsByCategory, saved) {
  const categoryKeys = categories.map((c) => c.key);
  const defaultCategoryOrder = categoryKeys.slice();
  const savedCategoryOrder =
    Array.isArray(saved?.categoryOrder) ? saved.categoryOrder : null;
  const categoryOrder = normalizeByDefaults(defaultCategoryOrder, savedCategoryOrder);
  const legacyRouteOrder = dedupeRoutesPreserveOrder([
    ...(Array.isArray(saved?.order) ? saved.order : []),
    ...(Array.isArray(saved?.overflow) ? saved.overflow : [])
  ]);

  const itemOrdersByCategory = {};
  for (const categoryKey of categoryKeys) {
    const defaultItemOrder = (itemsByCategory?.[categoryKey] || []).map((item) => item.to);
    const savedOrder = saved?.itemOrdersByCategory?.[categoryKey]
      || (legacyRouteOrder.length > 0
        ? legacyRouteOrder.filter((to) => defaultItemOrder.includes(to))
        : null);
    itemOrdersByCategory[categoryKey] = normalizeByDefaults(defaultItemOrder, savedOrder);
  }

  const activeCategory = categoryOrder.includes(saved?.activeCategory)
    ? saved.activeCategory
    : categoryOrder[0] || null;

  return { categoryOrder, itemOrdersByCategory, activeCategory };
}

/** 현재 유저의 listTemplates.sidebar.order 가져오기 (사이드바 메뉴 순서) */
export function getSavedSidebarOrder() {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : null;
    const order = user?.listTemplates?.sidebar?.order;
    return Array.isArray(order) ? order : null;
  } catch (_) {}
  return null;
}

/** 현재 유저의 listTemplates.sidebar 가져오기 (order + overflow) */
export function getSavedSidebarConfig() {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : null;
    const sidebar = user?.listTemplates?.sidebar;
    if (!sidebar || typeof sidebar !== 'object') return null;
    const order = Array.isArray(sidebar.order) ? sidebar.order : null;
    const overflow = Array.isArray(sidebar.overflow) ? sidebar.overflow : null;
    if (!order && !overflow) return null;
    return { order, overflow };
  } catch (_) {}
  return null;
}

/** 현재 유저의 listTemplates.sidebar 가져오기 (2레벨 + 레거시 포함) */
export function getSavedSidebar2LevelConfig() {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : null;
    const sidebar = user?.listTemplates?.sidebar;
    if (!sidebar || typeof sidebar !== 'object') return null;
    return sidebar;
  } catch (_) {}
  return null;
}

/** localStorage의 사이드바 순서만 즉시 갱신 (드롭 직후 낙관적 반영, 리마운트 시 새 순서 유지) */
export function setSavedSidebarOrderLocally(order) {
  if (!Array.isArray(order)) return;
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : {};
    const templates = user.listTemplates && typeof user.listTemplates === 'object' ? { ...user.listTemplates } : {};
    templates.sidebar = { ...(templates.sidebar || {}), order };
    user.listTemplates = templates;
    localStorage.setItem('crm_user', JSON.stringify(user));
  } catch (_) {}
}

/** localStorage의 사이드바 config를 즉시 갱신 (order + overflow) */
export function setSavedSidebarConfigLocally({ order, overflow }) {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : {};
    const templates = user.listTemplates && typeof user.listTemplates === 'object' ? { ...user.listTemplates } : {};
    const prevSidebar = templates.sidebar && typeof templates.sidebar === 'object' ? templates.sidebar : {};
    templates.sidebar = {
      ...prevSidebar,
      ...(Array.isArray(order) ? { order } : {}),
      ...(Array.isArray(overflow) ? { overflow } : {})
    };
    user.listTemplates = templates;
    localStorage.setItem('crm_user', JSON.stringify(user));
  } catch (_) {}
}

/** localStorage의 사이드바 2레벨 config를 즉시 갱신 */
export function setSavedSidebar2LevelConfigLocally({ categoryOrder, itemOrdersByCategory, activeCategory }) {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : {};
    const templates = user.listTemplates && typeof user.listTemplates === 'object' ? { ...user.listTemplates } : {};
    const prevSidebar = templates.sidebar && typeof templates.sidebar === 'object' ? templates.sidebar : {};
    templates.sidebar = {
      ...prevSidebar,
      ...(Array.isArray(categoryOrder) ? { categoryOrder } : {}),
      ...(itemOrdersByCategory && typeof itemOrdersByCategory === 'object'
        ? { itemOrdersByCategory }
        : {}),
      ...(typeof activeCategory === 'string' || activeCategory == null ? { activeCategory } : {})
    };
    user.listTemplates = templates;
    localStorage.setItem('crm_user', JSON.stringify(user));
  } catch (_) {}
}

/** PATCH /api/auth/sidebar-order 호출 후 응답의 listTemplates로 crm_user 갱신 */
export async function patchSidebarOrder(order, overflow) {
  return patchSidebarLayout({ order, overflow });
}

/** PATCH /api/auth/sidebar-order 호출 후 응답의 listTemplates로 crm_user 갱신 */
export async function patchSidebarLayout(payload) {
  const res = await fetch(`${API_BASE}/auth/sidebar-order`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify(payload || {})
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || '사이드바 순서 저장에 실패했습니다.');
  }
  const data = await res.json();
  const userRaw = localStorage.getItem('crm_user');
  const user = userRaw ? JSON.parse(userRaw) : {};
  user.listTemplates = { ...(user.listTemplates || {}), ...(data.listTemplates || {}) };
  localStorage.setItem('crm_user', JSON.stringify(user));
  return data;
}
