/**
 * 리스트 컬럼 템플릿: User listTemplates와 기본 컬럼 정의.
 * customerCompanies, customerCompanyEmployees, productList 열 순서·표시 여부,
 * calendar 보기(월/주/일), salesPipeline 필터 저장/복원, 홈 대시보드 인사이트(homeDashboard),
 * 드롭존 목록(dropZoneListModal): columnOrder, showScheduleCustomDateColumns, scheduleCustomDateColumnVisibility(키별 숨김=false만 저장).
 * 메일 작성 AI 문장 다듬기(guided_rewrite 5축) — listTemplates.emailComposeModal.guidedRewrite
 */

import { API_BASE } from '@/config';
import { buildDefaultSidebar2LevelTemplate } from '@/layout/sidebar-menu-config';
import {
  AI_GUIDED_AUDIENCES,
  AI_GUIDED_DEFAULTS,
  AI_GUIDED_EXTRAS,
  AI_GUIDED_GOALS,
  AI_GUIDED_LENGTHS,
  AI_GUIDED_TONES
} from './gmail-ai-guided-options';

export const LIST_IDS = {
  CUSTOMER_COMPANIES: 'customerCompanies',
  CUSTOMER_COMPANY_EMPLOYEES: 'customerCompanyEmployees',
  PRODUCT_LIST: 'productList',
  /** 캘린더 월/주/일 보기 — user.listTemplates.calendar */
  CALENDAR: 'calendar',
  /** 세일즈 파이프라인 — listTemplates.salesPipeline { assigneeMeOnly, viewMode, columnOrder, visible } */
  SALES_PIPELINE: 'salesPipeline',
  /** 제품 검색 모달 선택 빈도 — listTemplates.productSearchModal { usage, order } */
  PRODUCT_SEARCH_MODAL: 'productSearchModal',
  /** 신규 제품 등록 모달 기본값 — listTemplates.addProductModal { categoryKey, categoryOther, billingType } */
  ADD_PRODUCT_MODAL: 'addProductModal',
  /** 고객사 상세 모달 표시 — listTemplates.customerCompanyDetailModal { presentation: 'side' | 'center' } */
  CUSTOMER_COMPANY_DETAIL_MODAL: 'customerCompanyDetailModal',
  /** 연락처 상세 모달 표시 — listTemplates.customerCompanyEmployeesDetailModal { presentation: 'side' | 'center' } */
  CUSTOMER_COMPANY_EMPLOYEES_DETAIL_MODAL: 'customerCompanyEmployeesDetailModal',
  /** 홈 일일 대시보드 — listTemplates.homeDashboard { companyWideInsight, kpiPeriod, consumerChartMode, marginChartMode, productChartMode, quantityChartMode, … } */
  HOME_DASHBOARD: 'homeDashboard',
  /** 결과 드롭존 목록 표 열 순서 — listTemplates.dropZoneListModal { columnOrder } */
  DROP_ZONE_LIST_MODAL: 'dropZoneListModal',
  /** 전자결재 지출 결의서 표 컬럼 순서 — listTemplates.eApprovalExpenseLines.columnOrder */
  E_APPROVAL_EXPENSE_LINES: 'eApprovalExpenseLines',
  /** 사내 현황 직원 리스트 표 컬럼 순서 — listTemplates.companyOverviewEmployees.columnOrder */
  COMPANY_OVERVIEW_EMPLOYEES: 'companyOverviewEmployees',
  /** 메일 작성 모달 AI 문장 다듬기 기본값 — listTemplates.emailComposeModal { guidedRewrite } */
  EMAIL_COMPOSE_MODAL: 'emailComposeModal'
};

function pickGuidedOption(value, options, fallback) {
  const allowed = new Set(options.map((o) => o.value));
  const v = String(value ?? '').trim();
  return allowed.has(v) ? v : fallback;
}

/**
 * user.listTemplates.emailComposeModal.guidedRewrite 에서 문장 다듬기 5축 복원 (crm_user·GET /auth/me user)
 */
export function getEmailComposeModalGuidedFromUser(user) {
  const raw = user?.listTemplates?.emailComposeModal?.guidedRewrite;
  const g = raw && typeof raw === 'object' ? raw : {};
  return {
    guidedGoal: pickGuidedOption(g.guidedGoal, AI_GUIDED_GOALS, AI_GUIDED_DEFAULTS.goal),
    guidedTone: pickGuidedOption(g.guidedTone, AI_GUIDED_TONES, AI_GUIDED_DEFAULTS.tone),
    guidedAudience: pickGuidedOption(g.guidedAudience, AI_GUIDED_AUDIENCES, AI_GUIDED_DEFAULTS.audience),
    guidedLength: pickGuidedOption(g.guidedLength, AI_GUIDED_LENGTHS, AI_GUIDED_DEFAULTS.length),
    guidedExtra: pickGuidedOption(g.guidedExtra, AI_GUIDED_EXTRAS, AI_GUIDED_DEFAULTS.extra)
  };
}

/** 로컬 crm_user 동기 복원 — 모달 초기 state용 */
export function getSavedEmailComposeModalGuidedSync() {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : null;
    return getEmailComposeModalGuidedFromUser(user);
  } catch (_) {
    return getEmailComposeModalGuidedFromUser(null);
  }
}

/**
 * PATCH /api/auth/list-templates — listId: emailComposeModal, guidedGoal·guidedTone·… (부분 갱신)
 */
export async function patchEmailComposeModalGuided(fields) {
  if (!fields || typeof fields !== 'object') {
    throw new Error('저장할 값이 없습니다.');
  }
  const keys = ['guidedGoal', 'guidedTone', 'guidedAudience', 'guidedLength', 'guidedExtra'];
  const payload = { listId: LIST_IDS.EMAIL_COMPOSE_MODAL };
  let n = 0;
  for (const k of keys) {
    if (fields[k] !== undefined) {
      payload[k] = fields[k];
      n += 1;
    }
  }
  if (n === 0) throw new Error('저장할 값이 없습니다.');
  const res = await fetch(`${API_BASE}/auth/list-templates`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
  const userRaw = localStorage.getItem('crm_user');
  const user = userRaw ? JSON.parse(userRaw) : {};
  user.listTemplates = data.listTemplates || user.listTemplates || {};
  localStorage.setItem('crm_user', JSON.stringify(user));
  return data;
}

/** 로컬 crm_user — 홈 인사이트·차트 표현 저장값 */
export function getSavedHomeDashboardTemplate() {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : null;
    const h = user?.listTemplates?.homeDashboard;
    if (h && typeof h === 'object') return h;
  } catch (_) {}
  return null;
}

/**
 * PATCH /api/auth/list-templates — listId: homeDashboard (부분 갱신, 서버에서 기존 값과 병합)
 * @param {object} patch — kpiPeriod, companyWideInsight, leaderInsightViewKind, insightDeptId, insightUserId, consumerChartMode, marginChartMode, productChartMode, quantityChartMode
 */
export async function patchHomeDashboardTemplate(patch) {
  if (!patch || typeof patch !== 'object') {
    throw new Error('저장할 값이 없습니다.');
  }
  const body = { listId: LIST_IDS.HOME_DASHBOARD, ...patch };
  const res = await fetch(`${API_BASE}/auth/list-templates`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
  const userRaw = localStorage.getItem('crm_user');
  const user = userRaw ? JSON.parse(userRaw) : {};
  user.listTemplates = data.listTemplates || user.listTemplates || {};
  localStorage.setItem('crm_user', JSON.stringify(user));
  return data;
}

const CUSTOMER_COMPANY_DETAIL_MODAL_PRESENTATIONS = new Set(['side', 'center']);
const CUSTOMER_COMPANY_DETAIL_MODAL_WORK_CATEGORIES = new Set(['tech', 'sales', 'marketing']);
const CUSTOMER_COMPANY_DETAIL_MODAL_CONTACT_CHANNELS = new Set(['phone', 'visit', 'email', 'sms']);

/** 고객사 상세: 우측 슬라이드(side) · 화면 중앙(center). 기본 side */
export function getSavedCustomerCompanyDetailModalPresentation() {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : null;
    const p = user?.listTemplates?.customerCompanyDetailModal?.presentation;
    if (CUSTOMER_COMPANY_DETAIL_MODAL_PRESENTATIONS.has(p)) return p;
  } catch (_) {}
  return 'side';
}

/**
 * PATCH /api/auth/list-templates — listId: customerCompanyDetailModal, presentation: side | center
 */
export async function patchCustomerCompanyDetailModalTemplate({ presentation }) {
  if (!CUSTOMER_COMPANY_DETAIL_MODAL_PRESENTATIONS.has(presentation)) {
    throw new Error('presentation은 side 또는 center여야 합니다.');
  }
  const res = await fetch(`${API_BASE}/auth/list-templates`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify({ listId: LIST_IDS.CUSTOMER_COMPANY_DETAIL_MODAL, presentation })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
  const userRaw = localStorage.getItem('crm_user');
  const user = userRaw ? JSON.parse(userRaw) : {};
  user.listTemplates = data.listTemplates || user.listTemplates || {};
  localStorage.setItem('crm_user', JSON.stringify(user));
  return data;
}

/** 고객사 상세 업무기록 기본값 — 분류/방식 */
export function getSavedCustomerCompanyDetailModalJournalDefaults() {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : null;
    const saved = user?.listTemplates?.customerCompanyDetailModal;
    const workCategory = CUSTOMER_COMPANY_DETAIL_MODAL_WORK_CATEGORIES.has(saved?.journalWorkCategory)
      ? saved.journalWorkCategory
      : 'tech';
    const contactChannel = CUSTOMER_COMPANY_DETAIL_MODAL_CONTACT_CHANNELS.has(saved?.journalContactChannel)
      ? saved.journalContactChannel
      : 'phone';
    return { workCategory, contactChannel };
  } catch (_) {}
  return { workCategory: 'tech', contactChannel: 'phone' };
}

/**
 * PATCH /api/auth/list-templates — listId: customerCompanyDetailModal, journalWorkCategory / journalContactChannel
 */
export async function patchCustomerCompanyDetailModalJournalDefaults({ workCategory, contactChannel }) {
  const normalizedWorkCategory = CUSTOMER_COMPANY_DETAIL_MODAL_WORK_CATEGORIES.has(workCategory) ? workCategory : 'tech';
  const normalizedContactChannel = CUSTOMER_COMPANY_DETAIL_MODAL_CONTACT_CHANNELS.has(contactChannel) ? contactChannel : 'phone';
  const res = await fetch(`${API_BASE}/auth/list-templates`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify({
      listId: LIST_IDS.CUSTOMER_COMPANY_DETAIL_MODAL,
      journalWorkCategory: normalizedWorkCategory,
      journalContactChannel: normalizedContactChannel
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
  const userRaw = localStorage.getItem('crm_user');
  const user = userRaw ? JSON.parse(userRaw) : {};
  user.listTemplates = data.listTemplates || user.listTemplates || {};
  localStorage.setItem('crm_user', JSON.stringify(user));
  return data;
}

/** 연락처 상세: 우측 슬라이드(side) · 화면 중앙(center). 기본 side */
export function getSavedCustomerCompanyEmployeesDetailModalPresentation() {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : null;
    const p = user?.listTemplates?.customerCompanyEmployeesDetailModal?.presentation;
    if (CUSTOMER_COMPANY_DETAIL_MODAL_PRESENTATIONS.has(p)) return p;
  } catch (_) {}
  return 'side';
}

/**
 * PATCH /api/auth/list-templates — listId: customerCompanyEmployeesDetailModal, presentation: side | center
 */
export async function patchCustomerCompanyEmployeesDetailModalTemplate({ presentation }) {
  if (!CUSTOMER_COMPANY_DETAIL_MODAL_PRESENTATIONS.has(presentation)) {
    throw new Error('presentation은 side 또는 center여야 합니다.');
  }
  const res = await fetch(`${API_BASE}/auth/list-templates`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify({ listId: LIST_IDS.CUSTOMER_COMPANY_EMPLOYEES_DETAIL_MODAL, presentation })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
  const userRaw = localStorage.getItem('crm_user');
  const user = userRaw ? JSON.parse(userRaw) : {};
  user.listTemplates = data.listTemplates || user.listTemplates || {};
  localStorage.setItem('crm_user', JSON.stringify(user));
  return data;
}

const ADD_PRODUCT_BILLING = new Set(['Monthly', 'Annual', 'Perpetual']);

/** 로컬 crm_user — 신규 제품 등록 시 복원할 카테고리·결제 주기 */
export function getSavedAddProductModalDefaults() {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : null;
    const d = user?.listTemplates?.addProductModal;
    if (d && typeof d === 'object') {
      const billingType = ADD_PRODUCT_BILLING.has(d.billingType) ? d.billingType : 'Monthly';
      const rawIv = Number(d.billingInterval);
      const billingInterval =
        billingType === 'Perpetual'
          ? 1
          : Number.isFinite(rawIv) && rawIv >= 1
            ? Math.min(99, Math.round(rawIv))
            : 1;
      return {
        categoryKey: typeof d.categoryKey === 'string' ? d.categoryKey : '',
        categoryOther: typeof d.categoryOther === 'string' ? d.categoryOther : '',
        billingType,
        billingInterval
      };
    }
  } catch (_) {}
  return { categoryKey: '', categoryOther: '', billingType: 'Monthly', billingInterval: 1 };
}

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
    { key: 'name', label: '기업명' },
    { key: 'businessNumber', label: '사업자번호', defaultVisible: false },
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
    { key: 'leadSource', label: '유입 경로' },
    { key: 'status', label: '상태', defaultVisible: false },
    { key: 'assigneeUserIds', label: '담당자' },
    { key: 'lastSupportedAt', label: '최근 지원 일자', defaultVisible: false }
  ],
  [LIST_IDS.PRODUCT_LIST]: [
    { key: 'name', label: '제품명' },
    { key: 'code', label: '제품 코드' },
    { key: 'category', label: '카테고리' },
    { key: 'version', label: '버전' },
    { key: 'costPrice', label: '원가' },
    { key: 'price', label: '소비자가' },
    { key: 'consumerMargin', label: '순 마진' },
    { key: 'channelPrice', label: '유통가' },
    { key: 'channelMargin', label: '유통시 순 마진' },
    { key: 'currency', label: '통화', defaultVisible: false },
    { key: 'billingType', label: '결제 주기' },
    { key: 'status', label: '상태' }
  ]
};

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * PATCH /api/auth/list-templates — 신규 제품 등록 모달만 사용 (categoryKey, categoryOther, billingType)
 */
export async function patchAddProductModalDefaults({ categoryKey, categoryOther, billingType, billingInterval }) {
  const res = await fetch(`${API_BASE}/auth/list-templates`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify({
      listId: LIST_IDS.ADD_PRODUCT_MODAL,
      categoryKey,
      categoryOther,
      billingType,
      billingInterval
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
  const userRaw = localStorage.getItem('crm_user');
  const user = userRaw ? JSON.parse(userRaw) : {};
  user.listTemplates = data.listTemplates || user.listTemplates || {};
  localStorage.setItem('crm_user', JSON.stringify(user));
  return data;
}

/**
 * 저장된 템플릿과 기본값을 합쳐 실제 사용할 columnOrder, visible, columns, columnCellStyles 반환.
 * @param {string} listId
 * @param {object} saved - 저장된 템플릿 (columnOrder, visible, columnCellStyles)
 * @param {{ key: string, label: string }[]} [extraColumns] - 새 고객사/연락처 추가로 정의된 커스텀 필드 컬럼 (key: customFields.xxx, label)
 */
export function getEffectiveTemplate(listId, saved, extraColumns = []) {
  const defaults = DEFAULT_COLUMNS[listId];
  if (!defaults) return { columnOrder: [], visible: {}, columns: [], columnCellStyles: {} };
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
  const visible = { ...defaultVisible, ...extraVisible, ...(saved?.visible && typeof saved.visible === 'object' ? saved.visible : {}) };
  const columns = order.map((key) => defaults.find((c) => c.key === key) || (extraColumns || []).find((c) => c.key === key)).filter(Boolean);
  const columnCellStyles =
    saved?.columnCellStyles && typeof saved.columnCellStyles === 'object' && !Array.isArray(saved.columnCellStyles)
      ? { ...saved.columnCellStyles }
      : {};
  return { columnOrder: order, visible, columns, columnCellStyles };
}

/**
 * 제품 검색 모달: 저장된 order(자주 선택한 순) 기준으로 정렬, 나머지는 제품명 가나다
 * @param {{ _id?: unknown, name?: string }[]} items
 * @param {string[]} orderIds — 사용 빈도 내림차순 id 배열
 */
export function sortProductsByPickerUsage(items, orderIds) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const order = Array.isArray(orderIds) ? orderIds.map(String) : [];
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const ida = a._id != null ? String(a._id) : '';
    const idb = b._id != null ? String(b._id) : '';
    const ra = rank.has(ida) ? rank.get(ida) : 999999;
    const rb = rank.has(idb) ? rank.get(idb) : 999999;
    if (ra !== rb) return ra - rb;
    return (a.name || '').localeCompare(b.name || '', 'ko');
  });
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
 * 세일즈 파이프라인 — `listTemplates.salesPipeline` 미저장·부분 저장 시 병합 기준.
 * 저장값이 있으면 그 위에 덮어씀; `columnOrder`가 비어 있으면 아래 순서를 사용.
 */
export const DEFAULT_SALES_PIPELINE_LIST_TEMPLATE = {
  columnOrder: [
    'stage',
    'customerCompanyName',
    'contactName',
    'productName',
    'value',
    '__dz_net_margin',
    'productChannelPriceSnapshot',
    'productCostPriceSnapshot',
    'productListPriceSnapshot',
    'quantity',
    'assignedToName',
    'startDate',
    'contractAmountDate',
    'invoiceAmountDate',
    'fullCollectionCompleteDate',
    'channelDistributor',
    'discountAmount',
    'collectionEntries',
    'commissionRecipients',
    'completionDate',
    'contractAmount',
    'createdAt',
    'discountRate',
    'expectedCloseMonth',
    'invoiceAmount',
    'scheduleCustomDates.field_1778161937716',
    'targetDate',
    'unitPrice'
  ],
  visible: {
    stage: false,
    customerCompanyName: true,
    contactName: true,
    productName: true,
    value: true,
    __dz_net_margin: false,
    productChannelPriceSnapshot: false,
    productCostPriceSnapshot: false,
    productListPriceSnapshot: false,
    quantity: true,
    assignedToName: true,
    startDate: true,
    contractAmountDate: true,
    invoiceAmountDate: false,
    fullCollectionCompleteDate: false,
    channelDistributor: false,
    discountAmount: false,
    collectionEntries: false,
    commissionRecipients: false,
    completionDate: false,
    contractAmount: false,
    createdAt: false,
    discountRate: false,
    expectedCloseMonth: false,
    invoiceAmount: false,
    'scheduleCustomDates.field_1778161937716': false,
    targetDate: false,
    unitPrice: false,
    /** 견적·발주 문서 메일 — 표·칸반 기본은 숨김(사용자가 설정에서 켜면 저장됨) */
    quoteDocRecipientEmail: false,
    quoteDocCcEmail: false,
    purchaseOrderDocRecipientEmail: false,
    purchaseOrderDocCcEmail: false
  },
  assigneeMeOnly: false,
  viewMode: 'kanban',
  columnCellStyles: {
    customerCompanyName: {
      fontSize: '0.875rem',
      fontWeight: '700'
    },
    assignedToName: {
      fontWeight: '700',
      color: '#474c52'
    },
    startDate: {
      color: '#c66a53',
      fontStyle: 'italic'
    },
    contractAmountDate: {
      color: '#b04f4f',
      fontStyle: 'italic'
    }
  }
};

export function getMergedSalesPipelineTemplate() {
  const d = DEFAULT_SALES_PIPELINE_LIST_TEMPLATE;
  const saved = getSavedTemplate(LIST_IDS.SALES_PIPELINE);
  if (!saved || typeof saved !== 'object') {
    return {
      columnOrder: [...d.columnOrder],
      visible: { ...d.visible },
      assigneeMeOnly: d.assigneeMeOnly,
      viewMode: d.viewMode,
      columnCellStyles: { ...d.columnCellStyles }
    };
  }
  const columnOrder =
    Array.isArray(saved.columnOrder) && saved.columnOrder.length > 0 ? [...saved.columnOrder] : [...d.columnOrder];
  const visible = {
    ...d.visible,
    ...(saved.visible && typeof saved.visible === 'object' && !Array.isArray(saved.visible) ? saved.visible : {})
  };
  const assigneeMeOnly = typeof saved.assigneeMeOnly === 'boolean' ? saved.assigneeMeOnly : d.assigneeMeOnly;
  const viewMode = saved.viewMode === 'table' || saved.viewMode === 'kanban' ? saved.viewMode : d.viewMode;
  const columnCellStyles = {
    ...d.columnCellStyles,
    ...(saved.columnCellStyles &&
    typeof saved.columnCellStyles === 'object' &&
    !Array.isArray(saved.columnCellStyles)
      ? saved.columnCellStyles
      : {})
  };
  return { columnOrder, visible, assigneeMeOnly, viewMode, columnCellStyles };
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

/**
 * 제품 검색 모달에서 선택 완료 시 호출 — 서버가 usage·order 전체 갱신 저장
 * @param {string[]} selectedProductIds — 이번에 선택한 제품 _id (복수 가능)
 */
export async function patchProductSearchModalUsage(selectedProductIds) {
  const ids = Array.isArray(selectedProductIds) ? selectedProductIds.map((id) => String(id).trim()).filter(Boolean) : [];
  const res = await fetch(`${API_BASE}/auth/list-templates`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify({ listId: LIST_IDS.PRODUCT_SEARCH_MODAL, selectedProductIds: ids })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
  const userRaw = localStorage.getItem('crm_user');
  const user = userRaw ? JSON.parse(userRaw) : {};
  user.listTemplates = data.listTemplates || user.listTemplates || {};
  localStorage.setItem('crm_user', JSON.stringify(user));
  return data;
}

/** 열 설정 외 필터·보기 모드 등이 같은 섹션에 함께 저장되는 listId */
const LIST_TEMPLATE_COLUMN_ONLY_RESET_IDS = new Set([
  LIST_IDS.SALES_PIPELINE,
  LIST_IDS.CUSTOMER_COMPANIES,
  LIST_IDS.CUSTOMER_COMPANY_EMPLOYEES
]);

/**
 * 리스트 열 설정(표시·순서·스타일)을 기본값으로 되돌림.
 * salesPipeline·고객사·연락처는 담당자 필터 등은 유지하고 열 설정만 복원합니다.
 * @param {{ key: string, label: string }[]} [extraColumns] — 커스텀 필드 열(고객사·연락처)
 */
export async function resetListTemplate(listId, extraColumns = []) {
  if (LIST_TEMPLATE_COLUMN_ONLY_RESET_IDS.has(listId)) {
    if (listId === LIST_IDS.SALES_PIPELINE) {
      const d = DEFAULT_SALES_PIPELINE_LIST_TEMPLATE;
      return patchListTemplate(listId, {
        columnOrder: [...d.columnOrder],
        visible: { ...d.visible },
        columnCellStyles: {}
      });
    }
    const defaults = getEffectiveTemplate(listId, null, extraColumns);
    return patchListTemplate(listId, {
      columnOrder: defaults.columnOrder,
      visible: defaults.visible,
      columnCellStyles: {}
    });
  }
  const res = await fetch(`${API_BASE}/auth/list-templates/section/${encodeURIComponent(listId)}`, {
    method: 'DELETE',
    headers: { ...getAuthHeader() }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '초기화에 실패했습니다.');
  const userRaw = localStorage.getItem('crm_user');
  const user = userRaw ? JSON.parse(userRaw) : {};
  user.listTemplates = data.listTemplates || user.listTemplates || {};
  localStorage.setItem('crm_user', JSON.stringify(user));
  return data;
}

/** PATCH /api/auth/list-templates 호출 후 응답의 listTemplates로 crm_user 갱신 */
export async function patchListTemplate(listId, fields = {}) {
  const payload = { listId, ...fields };
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
/** 사이드바 기본 순서·구조를 다시 적용할 때마다 1 올림(저장된 순서 무시 = 초기화) */
export const SIDEBAR_MENU_EPOCH = 9;

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
  const savedEpoch = saved && typeof saved.menuEpoch === 'number' ? saved.menuEpoch : null;
  const s = savedEpoch === SIDEBAR_MENU_EPOCH ? saved : null;

  const categoryKeys = categories.map((c) => c.key);
  const defaultCategoryOrder = categoryKeys.slice();
  const savedCategoryOrder =
    Array.isArray(s?.categoryOrder) ? s.categoryOrder : null;
  const categoryOrder = normalizeByDefaults(defaultCategoryOrder, savedCategoryOrder);
  const legacyRouteOrder = dedupeRoutesPreserveOrder([
    ...(Array.isArray(s?.order) ? s.order : []),
    ...(Array.isArray(s?.overflow) ? s.overflow : [])
  ]);

  const itemOrdersByCategory = {};
  for (const categoryKey of categoryKeys) {
    const defaultItemOrder = (itemsByCategory?.[categoryKey] || []).map((item) => item.to);
    const savedOrder = s?.itemOrdersByCategory?.[categoryKey]
      || (legacyRouteOrder.length > 0
        ? legacyRouteOrder.filter((to) => defaultItemOrder.includes(to))
        : null);
    itemOrdersByCategory[categoryKey] = normalizeByDefaults(defaultItemOrder, savedOrder);
  }

  const activeCategory = categoryOrder.includes(s?.activeCategory)
    ? s.activeCategory
    : categoryOrder[0] || null;

  return { categoryOrder, itemOrdersByCategory, activeCategory };
}

/** 로그인·가입 직후 listTemplates.sidebar 기본 템플릿(고정 순서) 적용 */
export function ensureUserSidebarDefaultTemplate(user) {
  if (!user || typeof user !== 'object') return { user, applied: false };
  const sidebar = user.listTemplates?.sidebar;
  const epochOk = sidebar?.menuEpoch === SIDEBAR_MENU_EPOCH;
  const hasOrders =
    sidebar?.itemOrdersByCategory &&
    typeof sidebar.itemOrdersByCategory === 'object' &&
    Object.keys(sidebar.itemOrdersByCategory).length > 0;
  if (epochOk && hasOrders) {
    return { user, applied: false };
  }
  const def = buildDefaultSidebar2LevelTemplate(SIDEBAR_MENU_EPOCH);
  const next = {
    ...user,
    listTemplates: {
      ...(user.listTemplates && typeof user.listTemplates === 'object' ? user.listTemplates : {}),
      sidebar: {
        ...(sidebar && typeof sidebar === 'object' ? sidebar : {}),
        ...def
      }
    }
  };
  return { user: next, applied: true };
}

/** crm_user 저장 + 필요 시 서버에 기본 사이드바 동기화 */
export async function storeUserWithDefaultSidebarTemplate(user) {
  const { user: next, applied } = ensureUserSidebarDefaultTemplate(user);
  localStorage.setItem('crm_user', JSON.stringify(next));
  if (applied) {
    const def = buildDefaultSidebar2LevelTemplate(SIDEBAR_MENU_EPOCH);
    try {
      await patchSidebarLayout({
        categoryOrder: def.categoryOrder,
        itemOrdersByCategory: def.itemOrdersByCategory,
        activeCategory: def.activeCategory,
        order: def.order,
        overflow: def.overflow,
        menuEpoch: def.menuEpoch
      });
    } catch {
      /* 오프라인·슬립 복구 후 Sidebar 마운트 시 재시도 */
    }
  }
  return next;
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
      ...(typeof activeCategory === 'string' || activeCategory == null ? { activeCategory } : {}),
      menuEpoch: SIDEBAR_MENU_EPOCH
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
