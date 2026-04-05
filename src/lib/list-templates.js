/**
 * 리스트 컬럼 템플릿: User listTemplates와 기본 컬럼 정의.
 * customerCompanies, customerCompanyEmployees, productList 세 화면의 열 순서·표시 여부 저장/복원.
 */

import { API_BASE } from '@/config';

export const LIST_IDS = {
  CUSTOMER_COMPANIES: 'customerCompanies',
  CUSTOMER_COMPANY_EMPLOYEES: 'customerCompanyEmployees',
  PRODUCT_LIST: 'productList'
};

/** 각 리스트의 기본 컬럼 정의 (key, label). 순서가 기본 표시 순서. */
export const DEFAULT_COLUMNS = {
  [LIST_IDS.CUSTOMER_COMPANIES]: [
    { key: '_favorite', label: '즐겨찾기' },
    { key: 'name', label: '고객사명' },
    { key: 'representativeName', label: '대표자' },
    { key: 'businessNumber', label: '사업자 번호' },
    { key: 'industry', label: '업종' },
    { key: 'address', label: '주소' },
    { key: 'assigneeUserIds', label: '담당자' }
  ],
  [LIST_IDS.CUSTOMER_COMPANY_EMPLOYEES]: [
    { key: '_check', label: '선택' },
    { key: '_favorite', label: '즐겨찾기' },
    { key: 'company', label: '회사' },
    { key: 'name', label: '이름' },
    { key: 'email', label: '이메일' },
    { key: 'phone', label: '전화' },
    { key: 'status', label: '상태' },
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
  const defaultVisible = Object.fromEntries(defaults.map((c) => [c.key, true]));
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
 * 기본으로 햄버거 메뉴(overflow)에 두는 라우트. 사용자가 드래그로 메인에 꺼낼 수 있음.
 * user.js listTemplates.sidebar.overflow 와 동일 문자열 배열로 저장됨.
 */
export const DEFAULT_SIDEBAR_OVERFLOW_ROUTES = ['/lead-capture', '/map', '/ai-voice'];

/**
 * 사이드바 라우트 목록이 바뀔 때마다 1씩 올리면, Sidebar가 저장값을 다시 병합합니다.
 * (신규 메뉴 누락·PWA 구버전 번들 이슈 완화)
 */
export const SIDEBAR_MENU_EPOCH = 2;

function dedupeRoutesPreserveOrder(paths) {
  const seen = new Set();
  return paths.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

/**
 * 메인/overflow 각각·교집합을 정리하고, 정의된 모든 메뉴 경로가 한 번씩만 나타나게 합니다.
 */
function finalizeSidebarOrders(mainOrder, overflowOrder, allTos, defaultOv) {
  let m = dedupeRoutesPreserveOrder(mainOrder);
  let o = dedupeRoutesPreserveOrder(overflowOrder);
  const mainSet = new Set(m);
  o = o.filter((t) => !mainSet.has(t));
  const seen = new Set([...m, ...o]);
  for (const t of allTos) {
    if (seen.has(t)) continue;
    seen.add(t);
    if (defaultOv.includes(t)) o.push(t);
    else m.push(t);
  }
  return { mainOrder: m, overflowOrder: o };
}

/**
 * 메인 사이드바 순서(order)와 더보기(overflow)를 정규화.
 * - order만 있고 overflow 키가 없으면(레거시) DEFAULT_SIDEBAR_OVERFLOW_ROUTES 에 해당하는 항목을 overflow로 분리.
 * - 양쪽에 없는 신규 메뉴는 기본 overflow 목록에 있으면 overflow 끝에, 아니면 메인 끝에 추가.
 * @param {{ to: string }[]} menuItems
 * @param {{ order?: string[], overflow?: string[] } | null} saved
 */
export function normalizeSidebarOrders(menuItems, saved) {
  const allTos = menuItems.map((i) => i.to);
  const defaultOv = DEFAULT_SIDEBAR_OVERFLOW_ROUTES.filter((t) => allTos.includes(t));
  const rawOrder = dedupeRoutesPreserveOrder(
    Array.isArray(saved?.order) ? saved.order.filter((t) => allTos.includes(t)) : []
  );
  const hasExplicitOverflow =
    saved != null && Object.prototype.hasOwnProperty.call(saved, 'overflow') && Array.isArray(saved.overflow);
  const rawOverflow = hasExplicitOverflow
    ? dedupeRoutesPreserveOrder(saved.overflow.filter((t) => allTos.includes(t)))
    : null;

  let mainOrder;
  let overflowOrder;

  if (rawOrder.length === 0) {
    mainOrder = allTos.filter((t) => !defaultOv.includes(t));
    overflowOrder = defaultOv.slice();
    return finalizeSidebarOrders(mainOrder, overflowOrder, allTos, defaultOv);
  }

  if (!hasExplicitOverflow) {
    overflowOrder = rawOrder.filter((t) => defaultOv.includes(t));
    mainOrder = rawOrder.filter((t) => !defaultOv.includes(t));
    const seen = new Set(rawOrder);
    for (const t of allTos) {
      if (!seen.has(t)) {
        if (defaultOv.includes(t)) overflowOrder.push(t);
        else mainOrder.push(t);
      }
    }
    return finalizeSidebarOrders(mainOrder, overflowOrder, allTos, defaultOv);
  }

  mainOrder = rawOrder.slice();
  overflowOrder = rawOverflow.slice();
  const mainSet = new Set(mainOrder);
  overflowOrder = overflowOrder.filter((t) => !mainSet.has(t));
  const seen = new Set([...mainOrder, ...overflowOrder]);
  for (const t of allTos) {
    if (!seen.has(t)) {
      if (defaultOv.includes(t)) overflowOrder.push(t);
      else mainOrder.push(t);
    }
  }
  return finalizeSidebarOrders(mainOrder, overflowOrder, allTos, defaultOv);
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

/** PATCH /api/auth/sidebar-order 호출 후 응답의 listTemplates로 crm_user 갱신 */
export async function patchSidebarOrder(order, overflow) {
  const res = await fetch(`${API_BASE}/auth/sidebar-order`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ order, overflow })
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
