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
    { key: 'name', label: '고객사명' },
    { key: 'representativeName', label: '대표자' },
    { key: 'businessNumber', label: '사업자 번호' },
    { key: 'address', label: '주소' }
  ],
  [LIST_IDS.CUSTOMER_COMPANY_EMPLOYEES]: [
    { key: '_check', label: '선택' },
    { key: 'company', label: '회사' },
    { key: 'name', label: '이름' },
    { key: 'email', label: '이메일' },
    { key: 'phone', label: '전화' },
    { key: 'status', label: '상태' },
    { key: 'lastSupportedAt', label: '최근 지원 일자' }
  ],
  [LIST_IDS.PRODUCT_LIST]: [
    { key: 'name', label: '제품명' },
    { key: 'category', label: '카테고리' },
    { key: 'version', label: '버전' },
    { key: 'price', label: '가격' },
    { key: 'status', label: '상태' }
  ]
};

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 저장된 템플릿과 기본값을 합쳐 실제 사용할 columnOrder, visible 반환 */
export function getEffectiveTemplate(listId, saved) {
  const defaults = DEFAULT_COLUMNS[listId];
  if (!defaults) return { columnOrder: [], visible: {}, columns: [] };
  const defaultOrder = defaults.map((c) => c.key);
  const defaultVisible = Object.fromEntries(defaults.map((c) => [c.key, true]));
  const columnOrder = Array.isArray(saved?.columnOrder) && saved.columnOrder.length > 0
    ? saved.columnOrder.filter((k) => defaultOrder.includes(k))
    : defaultOrder;
  const missingOrder = defaultOrder.filter((k) => !columnOrder.includes(k));
  const order = [...columnOrder, ...missingOrder];
  const visible = { ...defaultVisible, ...(saved?.visible && typeof saved.visible === 'object' ? saved.visible : {}) };
  const columns = order.map((key) => defaults.find((c) => c.key === key)).filter(Boolean);
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

/** PATCH /api/auth/list-templates 호출 후 응답의 listTemplates로 crm_user 갱신 */
export async function patchListTemplate(listId, { columnOrder, visible }) {
  const res = await fetch(`${API_BASE}/auth/list-templates`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ listId, columnOrder, visible })
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
  user.listTemplates = data.listTemplates || user.listTemplates || {};
  localStorage.setItem('crm_user', JSON.stringify(user));
  return data;
}
