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
    { key: 'price', label: '가격' },
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

/** PATCH /api/auth/sidebar-order 호출 후 응답의 listTemplates로 crm_user 갱신 */
export async function patchSidebarOrder(order) {
  const res = await fetch(`${API_BASE}/auth/sidebar-order`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ order })
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
