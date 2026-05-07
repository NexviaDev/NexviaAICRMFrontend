import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { DEFAULT_SALES_PIPELINE_LIST_TEMPLATE, LIST_IDS, patchListTemplate } from '@/lib/list-templates';
import { API_BASE } from '@/config';
import {
  fetchSalesOpportunityScheduleFieldContext,
  SALES_OPPORTUNITY_SCHEDULE_DEFS_CHANGED,
  scheduleCustomDatesColumnTitle
} from '@/lib/sales-opportunity-schedule-labels';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 헤더 열 재정렬 드래그 (표 행 드래그와 구분) — 파이프라인 표에서 동일 MIME 사용 */
export const DZ_COL_DRAG_MIME = 'application/x-sp-dz-col-reorder';

/** colgroup 측정 시 데이터 열 최소 너비(px) — 말줄임 없이 내용이 더 넓게 보이도록 */
export const DZ_COL_MIN_WIDTH_DATA_PX = 104;
export const DZ_COL_MIN_WIDTH_ROWNUM_PX = 52;

const MONTH_SELECT_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1).padStart(2, '0'),
  label: `${i + 1}월`
}));

const YEAR_SPAN_PAST = 12;
const YEAR_SPAN_FUTURE = 2;

/** 목록·표 헤더용 한글 라벨 (나머지는 영문 키 그대로) */
const COLUMN_LABELS = {
  _id: '문서 ID',
  companyId: '회사 ID',
  customerCompanyId: '고객사 ID',
  customerCompanyEmployeeId: '연락처 ID',
  title: '제목',
  contactName: '구매 담당자',
  value: '금액',
  currency: '통화',
  stage: '단계',
  description: '설명',
  lineItems: '제품 행',
  productId: '제품 ID',
  productName: '제품명',
  quantity: '수량',
  unitPrice: '단가',
  unitPriceBasis: '가격 기준',
  channelDistributor: '유통사',
  discountType: '할인 유형',
  discountValue: '할인값',
  discountRate: '할인율',
  discountAmount: '할인액',
  productListPriceSnapshot: '소비자가 스냅',
  productCostPriceSnapshot: '원가 스냅',
  productChannelPriceSnapshot: '유통가 스냅',
  documentRefs: '문서 링크',
  driveFolderLink: 'Drive 폴더',
  assignedTo: '담당자 ID',
  assignedToName: '판매 담당',
  createdById: '등록자 ID',
  createdByName: '등록자',
  saleDate: '계약일',
  expectedCloseMonth: '예상 마감 월',
  startDate: '시작일',
  targetDate: '구매 예정일',
  completionDate: '완료일',
  contractAmount: '계약금액',
  contractAmountDate: '계약일',
  invoiceAmount: '계산서 금액',
  invoiceAmountDate: '계약서 발행일',
  collectionEntries: '수금 내역',
  fullCollectionCompleteDate: '수금 완료일',
  licenseCertificateDeliveredDate: '증서 전달일',
  scheduleCustomDates: '추가 일정(원본)',
  commissionRecipients: '기타 금액',
  renewalCalendarEventId: '갱신 캘린더 ID',
  wonNoticeCalendarEventId: '수주 안내 일정 ID',
  preRenewalCalendarEventId: '사전 알림 일정 ID',
  renewalFollowUpOpportunityId: '후속 기회 ID',
  renewalFollowUpOpportunityIds: '후속 기회 IDs',
  comments: '코멘트',
  customerCompanyName: '고객사',
  contractAmountDate_virtual: '계약금액일(표시)',
  updatedAt: '수정일',
  createdAt: '등록일',
  __dz_net_margin: '순마진 계산',
  __dz_forecast_expected: 'Forecast 예상(계산)'
};

/**
 * 드롭존 목록 기본 열 순서 (첫 열 «행» 제외·데이터 필드 키만).
 * 저장된 사용자 순서가 있으면 그걸 우선하고, 없으면 이 순서를 따릅니다.
 */
const DROPZONE_DEFAULT_COLUMN_ORDER = [
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
  'discountAmount'
];

/**
 * 표에서 제외: 통화·참조 ID·제품 행 트리 열·목록에서 숨길 업무 필드
 * (수정일·계약일·단계·제목·설명·문서·할인 일부·등록자·Forecast 예상 등)
 */
const DROPZONE_TABLE_EXCLUDE_KEYS = new Set([
  '_id',
  '__v',
  'currency',
  'companyId',
  'customerCompanyId',
  'customerCompanyEmployeeId',
  'productId',
  'assignedTo',
  'createdById',
  'renewalCalendarEventId',
  'wonNoticeCalendarEventId',
  'preRenewalCalendarEventId',
  'renewalFollowUpOpportunityId',
  'renewalFollowUpOpportunityIds',
  'comments',
  'driveFolderLink',
  'lineItems',
  'updatedAt',
  'unitPriceBasis',
  'saleDate',
  'stage',
  'title',
  'documentRefs',
  'discountType',
  'discountValue',
  'createdByName',
  '__dz_forecast_expected',
  'description'
]);

function isDropzoneTableExcludedColumn(key) {
  if (!key) return true;
  if (DROPZONE_TABLE_EXCLUDE_KEYS.has(key)) return true;
  /** 기회 문서의 참조 폴백용 스냅샷 — 표·칸반 열로 자동 수집되면 키 문자열이 그대로 헤더에 노출됨 */
  if (typeof key === 'string' && key.startsWith('snapshot')) return true;
  return false;
}

/** 고객사 미연결(customerCompanyId 없음)·고객사명 비어 있음 → 개인 구매 건으로 표시 */
function isPersonalPurchaseOpp(opp) {
  if (!opp || typeof opp !== 'object') return false;
  const n = opp.customerCompanyName && String(opp.customerCompanyName).trim();
  if (n) return false;
  const cid = opp.customerCompanyId;
  if (cid != null && cid !== '') return false;
  return true;
}

function buildYearSelectValues(anchorYear) {
  const y0 = Number(anchorYear);
  if (!Number.isFinite(y0)) return [];
  const out = [];
  for (let y = y0 + YEAR_SPAN_FUTURE; y >= y0 - YEAR_SPAN_PAST; y -= 1) {
    out.push(y);
  }
  return out;
}

function getOppFilterInstant(opp) {
  const raw = opp?.updatedAt || opp?.createdAt;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function matchesDateRange(opp, dateStart, dateEnd) {
  if (!dateStart && !dateEnd) return true;
  const inst = getOppFilterInstant(opp);
  if (!inst) return false;
  const ms = inst.getTime();

  let startStr = dateStart;
  let endStr = dateEnd;
  if (startStr && endStr && startStr > endStr) {
    const t = startStr;
    startStr = endStr;
    endStr = t;
  }

  if (startStr) {
    const [y, m, d] = startStr.split('-').map(Number);
    const startMs = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
    if (ms < startMs) return false;
  }
  if (endStr) {
    const [y, m, d] = endStr.split('-').map(Number);
    const endMs = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
    if (ms > endMs) return false;
  }
  return true;
}

function matchesYearMonth(opp, yearStr, monthPart) {
  const rawY = String(yearStr ?? '').trim();
  if (rawY === '') return true;
  const y = parseInt(rawY, 10);
  if (!Number.isFinite(y) || y < 1900 || y > 2100) return true;
  const inst = getOppFilterInstant(opp);
  if (!inst) return false;
  const ms = inst.getTime();
  const mp = String(monthPart ?? '').trim();
  if (!mp) {
    const startMs = new Date(y, 0, 1, 0, 0, 0, 0).getTime();
    const endMs = new Date(y, 11, 31, 23, 59, 59, 999).getTime();
    return ms >= startMs && ms <= endMs;
  }
  const mo = parseInt(mp, 10);
  if (mo < 1 || mo > 12) return false;
  const startMs = new Date(y, mo - 1, 1, 0, 0, 0, 0).getTime();
  const endMs = new Date(y, mo, 0, 23, 59, 59, 999).getTime();
  return ms >= startMs && ms <= endMs;
}

function matchesLocalSearch(opp, q) {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return true;
  const atObj = opp?.assignedTo && typeof opp.assignedTo === 'object' ? opp.assignedTo : null;
  const hay = [
    opp?.title,
    opp?.contactName,
    opp?.customerCompanyName,
    opp?.productName,
    opp?.description,
    opp?.assignedToName,
    atObj?.name
  ]
    .map((x) => String(x || '').toLowerCase())
    .join(' ');
  return hay.includes(t);
}

function toMoneyNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getOppCostPerUnit(opp) {
  const snap = toMoneyNumber(opp?.productCostPriceSnapshot);
  if (snap > 0) return snap;
  const p = opp?.productId && typeof opp.productId === 'object' ? opp.productId : null;
  if (p && p.costPrice != null) {
    const c = toMoneyNumber(p.costPrice);
    if (c >= 0) return c;
  }
  return null;
}

function computeOppNetMargin(opp) {
  const pid = opp?.productId;
  const hasProduct = pid && (typeof pid === 'object' ? pid._id || pid.name : pid);
  if (!hasProduct) return null;
  const costPerUnit = getOppCostPerUnit(opp);
  if (costPerUnit == null) return null;
  const qty = Math.max(0, Number(opp.quantity) || 1);
  return Math.round(toMoneyNumber(opp.value) - costPerUnit * qty);
}

/** 통화 기호 없이 숫자만(엑셀 느낌) */
function formatAmountPlain(value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString();
}

const DATE_FIELD_NAMES = new Set([
  'saleDate',
  'startDate',
  'targetDate',
  'completionDate',
  'contractAmountDate',
  'invoiceAmountDate',
  'fullCollectionCompleteDate',
  'licenseCertificateDeliveredDate',
  'updatedAt',
  'createdAt'
]);

/** 정의(salesOpportunitySchedule)에만 있고 문서에는 아직 값이 없어도 scheduleCustomDates.* 열에 포함 */
function addScheduleCustomDateKeysFromDefinitions(set, options) {
  const {
    showScheduleCustomDateColumns = true,
    scheduleCustomDateColumnVisibility = {},
    allowedScheduleCustomDateKeys = null
  } = options || {};
  if (
    !showScheduleCustomDateColumns ||
    allowedScheduleCustomDateKeys == null ||
    allowedScheduleCustomDateKeys.size === 0
  ) {
    return;
  }
  for (const ik of allowedScheduleCustomDateKeys) {
    if (scheduleCustomDateColumnVisibility[ik] === false) continue;
    set.add(`scheduleCustomDates.${ik}`);
  }
}

/** filtered 전체 행에서 표시할 열 키 수집 — 사용자 저장 순서·기본 순서·그 외 알파벳 */
function collectColumnKeys(items, options) {
  const {
    addNetMargin,
    addForecast,
    savedColumnOrder,
    showScheduleCustomDateColumns = true,
    scheduleCustomDateColumnVisibility = {},
    /** CustomFieldDefinition(salesOpportunitySchedule) 에 등록된 key 만 scheduleCustomDates 열로 인정 */
    allowedScheduleCustomDateKeys = null
  } = options || {};
  const set = new Set();
  for (const opp of items || []) {
    if (!opp || typeof opp !== 'object') continue;
    for (const k of Object.keys(opp)) {
      if (k === 'scheduleCustomDates') continue;
      set.add(k);
    }
    const sc = opp.scheduleCustomDates;
    if (
      showScheduleCustomDateColumns &&
      sc &&
      typeof sc === 'object' &&
      !Array.isArray(sc)
    ) {
      for (const ik of Object.keys(sc)) {
        if (scheduleCustomDateColumnVisibility[ik] === false) continue;
        if (allowedScheduleCustomDateKeys != null && !allowedScheduleCustomDateKeys.has(ik)) continue;
        set.add(`scheduleCustomDates.${ik}`);
      }
    }
  }
  addScheduleCustomDateKeysFromDefinitions(set, {
    showScheduleCustomDateColumns,
    scheduleCustomDateColumnVisibility,
    allowedScheduleCustomDateKeys
  });
  if (addNetMargin) set.add('__dz_net_margin');
  if (addForecast) set.add('__dz_forecast_expected');

  const rawKeys = Array.from(set).filter((k) => !isDropzoneTableExcludedColumn(k));
  const keySet = new Set(rawKeys);
  if (!addNetMargin) keySet.delete('__dz_net_margin');
  if (!addForecast) keySet.delete('__dz_forecast_expected');

  const saved = Array.isArray(savedColumnOrder)
    ? savedColumnOrder.filter((k) => typeof k === 'string' && keySet.has(k))
    : [];

  const merged = [];
  const seen = new Set();
  const push = (k) => {
    if (!keySet.has(k) || seen.has(k)) return;
    merged.push(k);
    seen.add(k);
  };

  for (const k of saved) push(k);
  for (const k of DROPZONE_DEFAULT_COLUMN_ORDER) push(k);

  const leftovers = [...keySet]
    .filter((k) => !seen.has(k))
    .sort((a, b) => a.localeCompare(b));
  for (const k of leftovers) push(k);

  return merged;
}

/** 세일즈 파이프라인 표: 단계(stage) 열 허용 — 그 외는 드롭존 목록과 동일 제외 규칙 */
function isSalesPipelineTableExcludedColumn(key) {
  if (key === 'stage') return false;
  return isDropzoneTableExcludedColumn(key);
}

const SALES_PIPELINE_TABLE_DEFAULT_COLUMN_ORDER = [...DEFAULT_SALES_PIPELINE_LIST_TEMPLATE.columnOrder];

/**
 * 파이프라인 표·칸반: `visible`이 비어 있을 때 기본으로 켤 열 — `DEFAULT_SALES_PIPELINE_LIST_TEMPLATE` 와 동기
 */
export const SALES_PIPELINE_DEFAULT_VISIBLE_COLUMN_KEYS = new Set(
  Object.entries(DEFAULT_SALES_PIPELINE_LIST_TEMPLATE.visible)
    .filter(([, v]) => v === true)
    .map(([k]) => k)
);

export function buildSalesPipelineVisibleMap(columnOrder, savedVisible) {
  const raw =
    savedVisible && typeof savedVisible === 'object' && !Array.isArray(savedVisible) ? savedVisible : null;
  const useDefaultSubset = !raw || Object.keys(raw).length === 0;
  const visible = {};
  for (const k of columnOrder) {
    if (useDefaultSubset) {
      visible[k] = SALES_PIPELINE_DEFAULT_VISIBLE_COLUMN_KEYS.has(k);
    } else {
      visible[k] = raw[k] !== false;
    }
  }
  return visible;
}

/**
 * 파이프라인 전체 표용 열 키 (드롭존 collectColumnKeys와 동일 + stage).
 * 데이터가 없어도 기본 열 세트는 포함합니다.
 */
export function collectSalesPipelineTableColumnKeys(items, options) {
  const {
    addNetMargin,
    addForecast,
    savedColumnOrder,
    showScheduleCustomDateColumns = true,
    scheduleCustomDateColumnVisibility = {},
    allowedScheduleCustomDateKeys = null
  } = options || {};
  const set = new Set();
  for (const opp of items || []) {
    if (!opp || typeof opp !== 'object') continue;
    for (const k of Object.keys(opp)) {
      if (k === 'scheduleCustomDates') continue;
      set.add(k);
    }
    const sc = opp.scheduleCustomDates;
    if (
      showScheduleCustomDateColumns &&
      sc &&
      typeof sc === 'object' &&
      !Array.isArray(sc)
    ) {
      for (const ik of Object.keys(sc)) {
        if (scheduleCustomDateColumnVisibility[ik] === false) continue;
        if (allowedScheduleCustomDateKeys != null && !allowedScheduleCustomDateKeys.has(ik)) continue;
        set.add(`scheduleCustomDates.${ik}`);
      }
    }
  }
  addScheduleCustomDateKeysFromDefinitions(set, {
    showScheduleCustomDateColumns,
    scheduleCustomDateColumnVisibility,
    allowedScheduleCustomDateKeys
  });
  if (addNetMargin) set.add('__dz_net_margin');
  if (addForecast) set.add('__dz_forecast_expected');

  const rawKeys = Array.from(set).filter((k) => !isSalesPipelineTableExcludedColumn(k));
  const keySet = new Set(rawKeys);
  for (const k of SALES_PIPELINE_TABLE_DEFAULT_COLUMN_ORDER) keySet.add(k);
  if (!addNetMargin) keySet.delete('__dz_net_margin');
  if (!addForecast) keySet.delete('__dz_forecast_expected');

  const saved = Array.isArray(savedColumnOrder)
    ? savedColumnOrder.filter((k) => typeof k === 'string' && keySet.has(k))
    : [];

  const merged = [];
  const seen = new Set();
  const push = (k) => {
    if (!keySet.has(k) || seen.has(k)) return;
    merged.push(k);
    seen.add(k);
  };

  for (const k of saved) push(k);
  for (const k of SALES_PIPELINE_TABLE_DEFAULT_COLUMN_ORDER) push(k);

  const leftovers = [...keySet]
    .filter((k) => !seen.has(k))
    .sort((a, b) => a.localeCompare(b));
  for (const k of leftovers) push(k);

  return merged;
}

function readSavedDropZoneListColumnOrder() {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : null;
    const o = user?.listTemplates?.dropZoneListModal?.columnOrder;
    return Array.isArray(o) ? o.map((x) => String(x).trim()).filter(Boolean) : null;
  } catch (_) {}
  return null;
}

/** 회사 맞춤 일정(추가 날짜) 열 표시 — 기본 true */
function readShowScheduleCustomDateColumns() {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : null;
    const v = user?.listTemplates?.dropZoneListModal?.showScheduleCustomDateColumns;
    if (typeof v === 'boolean') return v;
  } catch (_) {}
  return true;
}

/** 키별 숨김 — 서버·로컬 모두 false만 저장 */
function readScheduleCustomDateColumnVisibility() {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : null;
    const o = user?.listTemplates?.dropZoneListModal?.scheduleCustomDateColumnVisibility;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      const ks = String(k).trim().slice(0, 120);
      if (!ks || v !== false) continue;
      out[ks] = false;
    }
    return out;
  } catch (_) {}
  return {};
}

export function reorderColumnKeysAt(keys, fromIndex, toIndex) {
  if (fromIndex === toIndex) return keys.slice();
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= keys.length || toIndex >= keys.length) return keys.slice();
  const next = keys.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function columnHeaderLabel(key, scheduleFieldLabelByKey = {}) {
  if (key.startsWith('scheduleCustomDates.')) {
    return scheduleCustomDatesColumnTitle(key, scheduleFieldLabelByKey) || key;
  }
  return COLUMN_LABELS[key] || key;
}

function formatIsoOrDate(val) {
  if (val == null || val === '') return '';
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return '';
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s.slice(0, 19) : formatIsoOrDate(d);
}

function summarizeJson(val, maxLen) {
  try {
    const s = JSON.stringify(val);
    if (s.length <= maxLen) return s;
    return `${s.slice(0, maxLen)}…`;
  } catch {
    return String(val);
  }
}

/** 제품 행이 2건 이상일 때 행마다 따로 표시할 필드 (루트 스냅샷은 첫 줄만 반영되는 경우가 많음) */
const LINE_ITEM_STACK_KEYS = new Set([
  'productId',
  'productName',
  'quantity',
  'unitPrice',
  'unitPriceBasis',
  'channelDistributor',
  'discountRate',
  'discountAmount',
  'productListPriceSnapshot',
  'productCostPriceSnapshot',
  'productChannelPriceSnapshot',
  'commissionRecipients'
]);

function hasMultiLineItems(opp) {
  return Array.isArray(opp?.lineItems) && opp.lineItems.length > 1;
}

function shouldStackLineItemColumn(colKey, opp) {
  return hasMultiLineItems(opp) && LINE_ITEM_STACK_KEYS.has(colKey);
}

function lineProductIdDisplay(val) {
  if (val == null || val === '') return '';
  if (typeof val === 'object') {
    if (val.$oid != null) return String(val.$oid);
    return val.name || val.code || String(val._id || '');
  }
  return String(val);
}

const LINE_ITEM_MONEY_KEYS = new Set([
  'unitPrice',
  'discountAmount',
  'productListPriceSnapshot',
  'productCostPriceSnapshot',
  'productChannelPriceSnapshot'
]);

/** 단일 lineItems[] 원소에서 한 열 값 — 표 텍스트·필터 문자열 공통 */
function formatLineItemField(colKey, line) {
  if (!line || typeof line !== 'object') return '';
  const val = line[colKey];
  if (colKey === 'productId') return lineProductIdDisplay(val);
  if (val == null || val === '') return '';

  if (typeof val === 'number') {
    if (colKey === 'quantity') return String(val);
    if (LINE_ITEM_MONEY_KEYS.has(colKey)) return formatAmountPlain(val);
    if (colKey === 'discountRate') return `${val}%`;
    return String(val);
  }

  if (Array.isArray(val)) {
    if (colKey === 'commissionRecipients') {
      if (!val.length) return '';
      const sum = val.reduce((s, e) => s + toMoneyNumber(e?.amount), 0);
      return `${val.length}건·${formatAmountPlain(sum)}`;
    }
    return `${val.length}건`;
  }

  if (typeof val === 'object') {
    return summarizeJson(val, 80);
  }

  return String(val);
}

/** 제품 행 열: 줄마다 한 줄 요약 (제품명·수량·단가·할인 등, 줄별 배경으로 구분) */
function formatLineItemRowSummary(line) {
  if (!line || typeof line !== 'object') return '—';
  const name = line.productName || lineProductIdDisplay(line.productId) || '—';
  const q = line.quantity != null ? String(line.quantity) : '—';
  const up =
    line.unitPrice != null && Number.isFinite(Number(line.unitPrice))
      ? formatAmountPlain(line.unitPrice)
      : '—';
  const parts = [`${name}`, `수량 ${q}`, `단가 ${up}`];
  if (line.discountRate != null && Number.isFinite(Number(line.discountRate))) {
    parts.push(`할인율 ${line.discountRate}%`);
  }
  if (line.discountAmount != null && Number(toMoneyNumber(line.discountAmount)) !== 0) {
    parts.push(`할인액 ${formatAmountPlain(line.discountAmount)}`);
  }
  return parts.join(' · ');
}

/** 다중 품목 요약 행(행 번호 1): 라인별 합계·요약 */
export function formatSummaryRowCell(colKey, opp, forecastPercent) {
  if (!hasMultiLineItems(opp)) return formatCellValue(colKey, opp, forecastPercent);

  if (colKey === '__dz_net_margin' || colKey === '__dz_forecast_expected') {
    return formatCellValue(colKey, opp, forecastPercent);
  }
  if (colKey.startsWith('scheduleCustomDates.')) {
    return formatCellValue(colKey, opp, forecastPercent);
  }

  const lines = opp.lineItems;

  if (colKey === 'lineItems') {
    const names = lines.map((l) => l.productName || lineProductIdDisplay(l.productId)).filter(Boolean);
    return `${lines.length}품목 · ${names.join(' · ')}`;
  }

  if (!LINE_ITEM_STACK_KEYS.has(colKey)) {
    return formatCellValue(colKey, opp, forecastPercent);
  }

  if (colKey === 'productName') {
    return '';
  }

  if (colKey === 'productId') {
    return `${lines.length}건`;
  }

  if (colKey === 'quantity') {
    const sum = lines.reduce((s, l) => s + Number(l.quantity || 0), 0);
    return String(sum);
  }

  if (colKey === 'unitPrice') {
    const sub = lines.reduce((s, l) => {
      const q = Number(l.quantity);
      const up = toMoneyNumber(l.unitPrice);
      const da = toMoneyNumber(l.discountAmount);
      return s + (Number.isFinite(q) && q >= 0 ? q * up - da : 0);
    }, 0);
    return `소계 ${formatAmountPlain(Math.round(sub))}`;
  }

  if (colKey === 'discountAmount') {
    return formatAmountPlain(lines.reduce((s, l) => s + toMoneyNumber(l.discountAmount), 0));
  }

  if (colKey === 'discountRate') {
    const rates = lines
      .map((l) => (l.discountRate != null ? Number(l.discountRate) : null))
      .filter((r) => r != null && Number.isFinite(r));
    const uniq = [...new Set(rates.map((r) => `${r}%`))];
    return uniq.length ? uniq.join(' · ') : '—';
  }

  /* 스냅은 품목당 단가이므로 요약 행은 Σ(수량×스냅). 예: 100×380만 + 100×220만 = 6억 */
  if (
    colKey === 'productListPriceSnapshot' ||
    colKey === 'productCostPriceSnapshot' ||
    colKey === 'productChannelPriceSnapshot'
  ) {
    const sum = lines.reduce((s, l) => {
      const q = Number(l.quantity);
      const snap = toMoneyNumber(l[colKey]);
      return s + (Number.isFinite(q) && q >= 0 ? q * snap : 0);
    }, 0);
    return `${formatAmountPlain(Math.round(sum))}`;
  }

  if (colKey === 'unitPriceBasis') {
    const uniq = [...new Set(lines.map((l) => l.unitPriceBasis).filter(Boolean))];
    return uniq.join(' / ') || '—';
  }

  if (colKey === 'channelDistributor') {
    const uniq = [...new Set(lines.map((l) => l.channelDistributor).filter(Boolean))];
    return uniq.join(' · ') || '—';
  }

  if (colKey === 'commissionRecipients') {
    const parts = lines.map((l) => formatLineItemField(colKey, l)).filter(Boolean);
    return parts.join(' | ') || '';
  }

  return lines.map((l) => formatLineItemField(colKey, l)).join(' | ');
}

/** 하위 행(1.1, 1.2): 품목 열만 값, 나머지는 비움 */
export function formatChildRowCell(colKey, line) {
  if (colKey === 'lineItems') return formatLineItemRowSummary(line);
  if (LINE_ITEM_STACK_KEYS.has(colKey)) return formatLineItemField(colKey, line);
  return '';
}

function getOppNumericContributionForTotals(colKey, opp, forecastPercent, canViewAdminContent) {
  if (colKey === '__dz_net_margin') {
    const m = computeOppNetMargin(opp);
    return m != null && Number.isFinite(m) ? m : null;
  }
  if (colKey === '__dz_forecast_expected') {
    if (!canViewAdminContent || !Number.isFinite(forecastPercent)) return null;
    return Math.round(toMoneyNumber(opp.value) * (forecastPercent / 100));
  }
  if (colKey === 'collectionEntries') {
    const arr = opp.collectionEntries;
    if (!Array.isArray(arr) || !arr.length) return null;
    const sum = arr.reduce((s, e) => s + toMoneyNumber(e?.amount), 0);
    return sum;
  }

  if (hasMultiLineItems(opp) && LINE_ITEM_STACK_KEYS.has(colKey)) {
    if (colKey === 'quantity') {
      return opp.lineItems.reduce((s, l) => s + Number(l.quantity || 0), 0);
    }
    if (colKey === 'discountAmount') {
      return opp.lineItems.reduce((s, l) => s + toMoneyNumber(l.discountAmount), 0);
    }
    if (
      colKey === 'productListPriceSnapshot' ||
      colKey === 'productCostPriceSnapshot' ||
      colKey === 'productChannelPriceSnapshot'
    ) {
      return opp.lineItems.reduce((s, l) => {
        const q = Number(l.quantity);
        const snap = toMoneyNumber(l[colKey]);
        return s + (Number.isFinite(q) && q >= 0 ? q * snap : 0);
      }, 0);
    }
    if (colKey === 'unitPrice') {
      return opp.lineItems.reduce((s, l) => {
        const q = Number(l.quantity);
        const up = toMoneyNumber(l.unitPrice);
        const da = toMoneyNumber(l.discountAmount);
        return s + (Number.isFinite(q) && q >= 0 ? q * up - da : 0);
      }, 0);
    }
    return null;
  }

  const raw = opp[colKey];
  if (typeof raw === 'number') {
    const moneyKeys = new Set([
      'value',
      'contractAmount',
      'invoiceAmount',
      'unitPrice',
      'discountValue',
      'discountAmount',
      'productListPriceSnapshot',
      'productCostPriceSnapshot',
      'productChannelPriceSnapshot'
    ]);
    if (colKey === 'quantity') return Number(raw);
    if (moneyKeys.has(colKey)) return toMoneyNumber(raw);
  }
  return null;
}

function formatTotalsAggregateForColumn(colKey, opps, forecastPercent, canViewAdminContent) {
  if (!opps.length) return '\u00A0';
  let sum = 0;
  let had = false;
  for (const opp of opps) {
    const v = getOppNumericContributionForTotals(colKey, opp, forecastPercent, canViewAdminContent);
    if (v != null && Number.isFinite(v)) {
      sum += v;
      had = true;
    }
  }
  if (!had) return '—';
  return formatAmountPlain(Math.round(sum));
}

/** 파이프라인 표 합계: 기회 단계별 Forecast% 반영 */
export function formatTotalsAggregateForColumnPipeline(
  colKey,
  opps,
  stageForecastPercentMap,
  canViewAdminContent
) {
  if (!opps.length) return '\u00A0';
  let sum = 0;
  let had = false;
  for (const opp of opps) {
    const fp = stageForecastPercentMap[opp.stage];
    const v = getOppNumericContributionForTotals(colKey, opp, fp, canViewAdminContent);
    if (v != null && Number.isFinite(v)) {
      sum += v;
      had = true;
    }
  }
  if (!had) return '—';
  return formatAmountPlain(Math.round(sum));
}

function formatCellValue(key, opp, forecastPercent) {
  if (key === '__dz_net_margin') {
    const m = computeOppNetMargin(opp);
    return m != null ? formatAmountPlain(m) : '—';
  }
  if (key === '__dz_forecast_expected') {
    const fp = forecastPercent;
    if (!Number.isFinite(fp)) return '—';
    return formatAmountPlain(Math.round(toMoneyNumber(opp.value) * (fp / 100)));
  }

  if (key === 'customerCompanyName') {
    if (isPersonalPurchaseOpp(opp)) return '개인 구매';
    let val = opp[key];
    if (val != null && String(val).trim()) return String(val).trim();
    const cid = opp.customerCompanyId;
    if (cid && typeof cid === 'object' && cid.name && String(cid.name).trim()) return String(cid.name).trim();
    return '';
  }

  let val;
  if (key.startsWith('scheduleCustomDates.')) {
    const ik = key.slice('scheduleCustomDates.'.length);
    val = opp.scheduleCustomDates?.[ik];
    return formatIsoOrDate(val);
  }

  if (key === 'lineItems') {
    const li = opp.lineItems;
    if (!Array.isArray(li) || li.length === 0) return '';
    if (li.length > 1) return li.map((line) => formatLineItemRowSummary(line)).join(' ‖ ');
    return formatLineItemRowSummary(li[0]);
  }

  if (shouldStackLineItemColumn(key, opp)) {
    return opp.lineItems.map((line) => formatLineItemField(key, line)).join(' | ');
  }

  val = opp[key];

  if (val == null || val === '') return '';

  if (val instanceof Date) {
    return formatIsoOrDate(val);
  }
  if (typeof val === 'string' && DATE_FIELD_NAMES.has(key)) {
    return formatIsoOrDate(val);
  }

  if (key === 'assignedTo' && val && typeof val === 'object' && val.name) {
    return String(val.name);
  }
  if (key === 'productId' && val && typeof val === 'object') {
    return val.name || val.code || String(val._id || '');
  }
  if (key === 'customerCompanyId' && val && typeof val === 'object') {
    return val.name || String(val._id || '');
  }
  if (key === 'customerCompanyEmployeeId' && val && typeof val === 'object') {
    return val.name || String(val._id || '');
  }

  if (typeof val === 'number') {
    const moneyKeys = new Set([
      'value',
      'contractAmount',
      'invoiceAmount',
      'unitPrice',
      'discountValue',
      'discountAmount',
      'productListPriceSnapshot',
      'productCostPriceSnapshot',
      'productChannelPriceSnapshot'
    ]);
    if (key === 'quantity') return String(val);
    if (moneyKeys.has(key)) return formatAmountPlain(val);
    return String(val);
  }

  if (Array.isArray(val)) {
    if (key === 'collectionEntries') {
      const sum = val.reduce((s, e) => s + toMoneyNumber(e?.amount), 0);
      return `${val.length}건·합 ${formatAmountPlain(sum)}`;
    }
    if (key === 'documentRefs') return `${val.length}건`;
    return `${val.length}건 ${summarizeJson(val, 80)}`;
  }

  if (typeof val === 'object') {
    return summarizeJson(val, 120);
  }

  return String(val);
}

/** 열 필터: 빈 셀과 구분하기 위한 내부 키 */
export const FILTER_VALUE_EMPTY = '__dz_filter_empty__';

/**
 * 열 필터용 후보 값들. 다중 lineItems이면 품목마다 한 값 + 요약행 문자열(있으면)을 넣어
 * 「Fusion」만 골라도 해당 품목이 있는 기회가 걸리게 함.
 */
export function collectColumnFilterCandidates(colKey, opp, forecastPercent) {
  if (!opp || typeof opp !== 'object') return [FILTER_VALUE_EMPTY];

  if (hasMultiLineItems(opp)) {
    if (colKey === 'lineItems') {
      const out = new Set();
      for (const line of opp.lineItems) {
        const s = formatLineItemRowSummary(line);
        out.add(s === '' ? FILTER_VALUE_EMPTY : s);
      }
      const summary = formatSummaryRowCell(colKey, opp, forecastPercent);
      if (summary !== '') out.add(summary);
      return Array.from(out);
    }
    if (LINE_ITEM_STACK_KEYS.has(colKey)) {
      const out = new Set();
      for (const line of opp.lineItems) {
        const v = formatLineItemField(colKey, line);
        out.add(v === '' ? FILTER_VALUE_EMPTY : v);
      }
      const summary = formatSummaryRowCell(colKey, opp, forecastPercent);
      if (summary !== '') out.add(summary);
      return Array.from(out);
    }
  }

  const s = formatCellValue(colKey, opp, forecastPercent);
  return [s === '' ? FILTER_VALUE_EMPTY : s];
}

function oppPassesColumnFilter(colKey, opp, forecastPercent, allowed) {
  return collectColumnFilterCandidates(colKey, opp, forecastPercent).some((c) => allowed.includes(c));
}

export function filterValueDisplay(key) {
  return key === FILTER_VALUE_EMPTY ? '(빈 칸)' : key;
}

function parseSortableDate(s) {
  if (s == null || s === '') return NaN;
  const str = String(s);
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const t = new Date(str).getTime();
  return Number.isNaN(t) ? NaN : t;
}

const SORT_NUMERIC_KEYS = new Set([
  'value',
  'quantity',
  'unitPrice',
  'discountValue',
  'discountRate',
  'discountAmount',
  'contractAmount',
  'invoiceAmount',
  'productListPriceSnapshot',
  'productCostPriceSnapshot',
  'productChannelPriceSnapshot'
]);

function getSortComparable(colKey, opp, forecastPercent) {
  if (colKey === '__dz_net_margin') {
    const m = computeOppNetMargin(opp);
    return { kind: 'num', n: m != null && Number.isFinite(m) ? m : NaN };
  }
  if (colKey === '__dz_forecast_expected') {
    const fp = forecastPercent;
    if (!Number.isFinite(fp)) return { kind: 'num', n: NaN };
    return { kind: 'num', n: Math.round(toMoneyNumber(opp.value) * (fp / 100)) };
  }
  if (colKey.startsWith('scheduleCustomDates.') || DATE_FIELD_NAMES.has(colKey)) {
    const s = formatCellValue(colKey, opp, forecastPercent);
    return { kind: 'num', n: parseSortableDate(s) };
  }
  if (SORT_NUMERIC_KEYS.has(colKey)) {
    if (hasMultiLineItems(opp) && LINE_ITEM_STACK_KEYS.has(colKey)) {
      const line = opp.lineItems[0];
      if (colKey === 'quantity') {
        const q = Number(line?.quantity);
        return { kind: 'num', n: Number.isFinite(q) ? q : NaN };
      }
      return { kind: 'num', n: toMoneyNumber(line?.[colKey]) };
    }
    if (colKey === 'quantity') {
      const q = Number(opp[colKey]);
      return { kind: 'num', n: Number.isFinite(q) ? q : NaN };
    }
    return { kind: 'num', n: toMoneyNumber(opp[colKey]) };
  }
  const str = formatCellValue(colKey, opp, forecastPercent);
  return { kind: 'str', s: str };
}

function compareSortable(va, vb) {
  if (va.kind === 'num' && vb.kind === 'num') {
    if (Number.isNaN(va.n) && Number.isNaN(vb.n)) return 0;
    if (Number.isNaN(va.n)) return 1;
    if (Number.isNaN(vb.n)) return -1;
    return va.n - vb.n;
  }
  const sa = va.kind === 'num' ? String(va.n) : va.s;
  const sb = vb.kind === 'num' ? String(vb.n) : vb.s;
  return String(sa).localeCompare(String(sb), 'ko', { numeric: true });
}

function compareOppsForSort(a, b, colKey, dir, forecastPercent) {
  const va = getSortComparable(colKey, a, forecastPercent);
  const vb = getSortComparable(colKey, b, forecastPercent);
  let c = compareSortable(va, vb);
  if (c === 0) {
    const ida = String(a?._id ?? '');
    const idb = String(b?._id ?? '');
    c = ida.localeCompare(idb);
  }
  return dir === 'desc' ? -c : c;
}

/** 파이프라인 전체 표: 기회마다 단계 Forecast%가 다름 */
export function compareOppsForSortPipeline(a, b, colKey, dir, stageForecastPercentMap) {
  const fpA = stageForecastPercentMap?.[a.stage];
  const fpB = stageForecastPercentMap?.[b.stage];
  const va = getSortComparable(colKey, a, fpA);
  const vb = getSortComparable(colKey, b, fpB);
  let c = compareSortable(va, vb);
  if (c === 0) {
    const ida = String(a?._id ?? '');
    const idb = String(b?._id ?? '');
    c = ida.localeCompare(idb);
  }
  return dir === 'desc' ? -c : c;
}

export function applyColumnFiltersPipeline(rows, colFilters, stageForecastPercentMap) {
  const keys = Object.keys(colFilters || {}).filter((k) => Array.isArray(colFilters[k]));
  if (keys.length === 0) return rows;
  return rows.filter((opp) => {
    const fp = stageForecastPercentMap[opp.stage];
    for (const colKey of keys) {
      const allowed = colFilters[colKey];
      if (allowed.length === 0) return false;
      if (!oppPassesColumnFilter(colKey, opp, fp, allowed)) return false;
    }
    return true;
  });
}

export function applyColumnFiltersExceptPipeline(rows, colFilters, stageForecastPercentMap, exceptKey) {
  const keys = Object.keys(colFilters || {}).filter(
    (k) => k !== exceptKey && Array.isArray(colFilters[k])
  );
  if (keys.length === 0) return rows;
  return rows.filter((opp) => {
    const fp = stageForecastPercentMap[opp.stage];
    for (const colKey of keys) {
      const allowed = colFilters[colKey];
      if (allowed.length === 0) return false;
      if (!oppPassesColumnFilter(colKey, opp, fp, allowed)) return false;
    }
    return true;
  });
}

function applyColumnFilters(rows, colFilters, forecastPercent) {
  const keys = Object.keys(colFilters || {}).filter((k) => Array.isArray(colFilters[k]));
  if (keys.length === 0) return rows;
  return rows.filter((opp) => {
    for (const colKey of keys) {
      const allowed = colFilters[colKey];
      if (allowed.length === 0) return false;
      if (!oppPassesColumnFilter(colKey, opp, forecastPercent, allowed)) return false;
    }
    return true;
  });
}

function applyColumnFiltersExcept(rows, colFilters, forecastPercent, exceptKey) {
  const keys = Object.keys(colFilters || {}).filter(
    (k) => k !== exceptKey && Array.isArray(colFilters[k])
  );
  if (keys.length === 0) return rows;
  return rows.filter((opp) => {
    for (const colKey of keys) {
      const allowed = colFilters[colKey];
      if (allowed.length === 0) return false;
      if (!oppPassesColumnFilter(colKey, opp, forecastPercent, allowed)) return false;
    }
    return true;
  });
}

export function buildFlatDisplayRows(sortedFiltered) {
  const out = [];
  (sortedFiltered || []).forEach((opp, idx) => {
    const ord = idx + 1;
    const id = String(opp?._id ?? `idx${idx}`);
    if (!hasMultiLineItems(opp)) {
      out.push({ kind: 'single', opp, rowLabel: String(ord), oppOrdinal: ord, key: `${id}-s` });
      return;
    }
    out.push({ kind: 'summary', opp, rowLabel: String(ord), oppOrdinal: ord, key: `${id}-sum` });
    opp.lineItems.forEach((line, liIdx) => {
      out.push({
        kind: 'line',
        opp,
        line,
        lineIdx: liIdx,
        rowLabel: `${ord}.${liIdx + 1}`,
        oppOrdinal: ord,
        key: `${id}-L${liIdx}`
      });
    });
  });
  return out;
}

export function renderDisplayRowCell(colKey, flatRow, forecastPercent) {
  let text = '';
  if (flatRow.kind === 'summary') {
    text = formatSummaryRowCell(colKey, flatRow.opp, forecastPercent);
  } else if (flatRow.kind === 'line') {
    text = formatChildRowCell(colKey, flatRow.line);
  } else {
    text = formatCellValue(colKey, flatRow.opp, forecastPercent);
  }
  return { text, node: text || '\u00A0' };
}

/**
 * Won / Lost / Abandoned 드롭존에서 연 기회 목록 — 검색·기간·테이블 표시
 */
export default function DropZoneListModal({
  stageKey,
  modalCfg,
  forecastPercent,
  items,
  /** 기회 모달 등 위에 다른 모달이 열려 있으면 Esc로 목록만 닫히지 않게 */
  suppressEscapeClose,
  onClose,
  onOpenEdit,
  canViewAdminContent,
  onDragStart,
  onDragEnd
}) {
  const [listSearch, setListSearch] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [filterYear, setFilterYear] = useState(() => String(new Date().getFullYear()));
  const [filterMonthPart, setFilterMonthPart] = useState('');
  const [sortState, setSortState] = useState({ key: null, dir: null });
  const [columnFilters, setColumnFilters] = useState({});
  const [openFilterCol, setOpenFilterCol] = useState(null);
  const [colFilterSearch, setColFilterSearch] = useState('');
  const filterPopoverRef = useRef(null);
  const columnReorderBusyRef = useRef(false);

  const [persistedColumnOrder, setPersistedColumnOrder] = useState(() => readSavedDropZoneListColumnOrder());
  const [showScheduleCustomDateColumns, setShowScheduleCustomDateColumns] = useState(() =>
    readShowScheduleCustomDateColumns()
  );
  const [scheduleCustomDateColumnVisibility, setScheduleCustomDateColumnVisibility] = useState(() =>
    readScheduleCustomDateColumnVisibility()
  );
  const [scheduleFieldLabelByKey, setScheduleFieldLabelByKey] = useState({});
  const [allowedScheduleCustomDateKeys, setAllowedScheduleCustomDateKeys] = useState(() => new Set());
  const [colSettingsOpen, setColSettingsOpen] = useState(false);
  const colSettingsWrapRef = useRef(null);
  const columnSettingsBusyRef = useRef(false);
  const [columnSettingsSaving, setColumnSettingsSaving] = useState(false);

  const defaultYearStr = String(new Date().getFullYear());
  const yearSelectValues = buildYearSelectValues(Number(defaultYearStr));

  useEffect(() => {
    setListSearch('');
    setDateStart('');
    setDateEnd('');
    setFilterYear(String(new Date().getFullYear()));
    setFilterMonthPart('');
    setSortState({ key: null, dir: null });
    setColumnFilters({});
    setOpenFilterCol(null);
    setColFilterSearch('');
    setPersistedColumnOrder(readSavedDropZoneListColumnOrder());
    setShowScheduleCustomDateColumns(readShowScheduleCustomDateColumns());
    setScheduleCustomDateColumnVisibility(readScheduleCustomDateColumnVisibility());
    setColSettingsOpen(false);
  }, [stageKey]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const ctx = await fetchSalesOpportunityScheduleFieldContext(getAuthHeader);
      if (cancelled) return;
      setScheduleFieldLabelByKey(ctx.labelByKey);
      setAllowedScheduleCustomDateKeys(ctx.allowedKeys);
    };
    void load();
    const onDefs = () => {
      void load();
    };
    window.addEventListener(SALES_OPPORTUNITY_SCHEDULE_DEFS_CHANGED, onDefs);
    return () => {
      cancelled = true;
      window.removeEventListener(SALES_OPPORTUNITY_SCHEDULE_DEFS_CHANGED, onDefs);
    };
  }, [stageKey]);

  useEffect(() => {
    if (!colSettingsOpen) return;
    const onDown = (e) => {
      const el = colSettingsWrapRef.current;
      if (el && !el.contains(e.target)) setColSettingsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [colSettingsOpen]);

  useEffect(() => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const k of Object.keys(next)) {
        if (!k.startsWith('scheduleCustomDates.')) continue;
        const ik = k.slice('scheduleCustomDates.'.length);
        if (!showScheduleCustomDateColumns || scheduleCustomDateColumnVisibility[ik] === false) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setOpenFilterCol((c) => {
      if (!c || !c.startsWith('scheduleCustomDates.')) return c;
      const ik = c.slice('scheduleCustomDates.'.length);
      if (!showScheduleCustomDateColumns || scheduleCustomDateColumnVisibility[ik] === false) return null;
      return c;
    });
    setSortState((s) => {
      if (!s.key || !String(s.key).startsWith('scheduleCustomDates.')) return s;
      const ik = String(s.key).slice('scheduleCustomDates.'.length);
      if (!showScheduleCustomDateColumns || scheduleCustomDateColumnVisibility[ik] === false) {
        return { key: null, dir: null };
      }
      return s;
    });
  }, [showScheduleCustomDateColumns, scheduleCustomDateColumnVisibility]);

  const filteredByToolbar = useMemo(
    () =>
      (items || []).filter(
        (opp) =>
          matchesLocalSearch(opp, listSearch) &&
          matchesDateRange(opp, dateStart, dateEnd) &&
          matchesYearMonth(opp, filterYear, filterMonthPart)
      ),
    [items, listSearch, dateStart, dateEnd, filterYear, filterMonthPart]
  );

  const filteredByColumns = useMemo(
    () => applyColumnFilters(filteredByToolbar, columnFilters, forecastPercent),
    [filteredByToolbar, columnFilters, forecastPercent]
  );

  const sortedFiltered = useMemo(() => {
    const { key, dir } = sortState;
    if (!key || !dir) return filteredByColumns;
    const arr = [...filteredByColumns];
    arr.sort((a, b) => compareOppsForSort(a, b, key, dir, forecastPercent));
    return arr;
  }, [filteredByColumns, sortState, forecastPercent]);

  const isYmDefault = filterYear === defaultYearStr && filterMonthPart === '';

  const filterMonth =
    filterYear && filterMonthPart ? `${filterYear}-${filterMonthPart}` : '';

  /** 열 설정 체크박스: CustomFieldDefinition 에 있는 일정 키만 (고아 DB 키 제외) */
  const scheduleColumnKeyCandidates = useMemo(() => {
    if (allowedScheduleCustomDateKeys && allowedScheduleCustomDateKeys.size > 0) {
      return Array.from(allowedScheduleCustomDateKeys).sort((a, b) => a.localeCompare(b));
    }
    return [];
  }, [allowedScheduleCustomDateKeys]);

  const columnKeys = useMemo(
    () =>
      collectColumnKeys(filteredByToolbar, {
        addNetMargin: Boolean(canViewAdminContent),
        /* Forecast 예상 열은 목록에서 제외(DROPZONE_TABLE_EXCLUDE_KEYS) */
        addForecast: false,
        savedColumnOrder: persistedColumnOrder,
        showScheduleCustomDateColumns,
        scheduleCustomDateColumnVisibility,
        allowedScheduleCustomDateKeys
      }),
    [
      filteredByToolbar,
      canViewAdminContent,
      forecastPercent,
      persistedColumnOrder,
      showScheduleCustomDateColumns,
      scheduleCustomDateColumnVisibility,
      allowedScheduleCustomDateKeys
    ]
  );

  const handleColumnHeaderDragStart = useCallback((e, colIdx) => {
    if (e.target.closest('button')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(DZ_COL_DRAG_MIME, String(colIdx));
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleColumnHeaderDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleColumnHeaderDrop = useCallback(
    async (e, dropIdx) => {
      e.preventDefault();
      if (columnReorderBusyRef.current) return;
      const raw = e.dataTransfer.getData(DZ_COL_DRAG_MIME);
      const fromIdx = Number(raw);
      if (!Number.isFinite(fromIdx)) return;
      if (fromIdx === dropIdx) return;
      const nextOrder = reorderColumnKeysAt(columnKeys, fromIdx, dropIdx);
      columnReorderBusyRef.current = true;
      setPersistedColumnOrder(nextOrder);
      try {
        await patchListTemplate(LIST_IDS.DROP_ZONE_LIST_MODAL, { columnOrder: nextOrder });
      } catch (err) {
        console.error(err);
        setPersistedColumnOrder(readSavedDropZoneListColumnOrder());
      } finally {
        columnReorderBusyRef.current = false;
      }
    },
    [columnKeys]
  );

  const rowsForFilterOptions = useMemo(
    () =>
      openFilterCol
        ? applyColumnFiltersExcept(filteredByToolbar, columnFilters, forecastPercent, openFilterCol)
        : [],
    [openFilterCol, filteredByToolbar, columnFilters, forecastPercent]
  );

  const filterUniqueOptions = useMemo(() => {
    if (!openFilterCol) return [];
    const uniq = new Set();
    for (const opp of rowsForFilterOptions) {
      for (const c of collectColumnFilterCandidates(openFilterCol, opp, forecastPercent)) {
        uniq.add(c);
      }
    }
    return Array.from(uniq).sort((a, b) => {
      if (a === FILTER_VALUE_EMPTY) return -1;
      if (b === FILTER_VALUE_EMPTY) return 1;
      return String(a).localeCompare(String(b), 'ko', { numeric: true });
    });
  }, [openFilterCol, rowsForFilterOptions, forecastPercent]);

  const filterUniqueForUi = useMemo(() => {
    const q = colFilterSearch.trim().toLowerCase();
    if (!q) return filterUniqueOptions;
    return filterUniqueOptions.filter((k) => filterValueDisplay(k).toLowerCase().includes(q));
  }, [filterUniqueOptions, colFilterSearch]);

  const displayRows = useMemo(() => buildFlatDisplayRows(sortedFiltered), [sortedFiltered]);

  const totalsByColumn = useMemo(() => {
    const out = {};
    for (const colKey of columnKeys) {
      out[colKey] = formatTotalsAggregateForColumn(
        colKey,
        sortedFiltered,
        forecastPercent,
        canViewAdminContent
      );
    }
    return out;
  }, [columnKeys, sortedFiltered, forecastPercent, canViewAdminContent]);

  const dataTableRef = useRef(null);
  const [measuredColWidths, setMeasuredColWidths] = useState(null);

  const measureDzTableColWidths = useCallback(() => {
    const table = dataTableRef.current;
    if (!table) return;
    const tr = table.querySelector('thead tr');
    if (!tr) return;
    const cells = tr.querySelectorAll('th');
    if (cells.length === 0) return;
    const widths = Array.from(cells).map((th, i) => {
      const raw = Math.round(th.getBoundingClientRect().width);
      if (i === 0) return Math.max(DZ_COL_MIN_WIDTH_ROWNUM_PX, raw);
      return Math.max(DZ_COL_MIN_WIDTH_DATA_PX, raw);
    });
    const bodyRows = table.querySelectorAll('tbody tr:not(.sp-dz-data-table__row--filter-empty)');
    for (const row of bodyRows) {
      const tds = row.querySelectorAll('td');
      const n = Math.min(widths.length, tds.length);
      for (let i = 0; i < n; i += 1) {
        const td = tds[i];
        const contentNeed = Math.ceil(td.scrollWidth);
        widths[i] = Math.max(widths[i], contentNeed);
      }
    }
    setMeasuredColWidths((prev) => {
      if (prev && prev.length === widths.length && prev.every((w, i) => w === widths[i])) return prev;
      return widths;
    });
  }, []);

  const columnKeysSig = useMemo(() => columnKeys.join('\0'), [columnKeys]);

  useLayoutEffect(() => {
    setMeasuredColWidths(null);
  }, [columnKeysSig]);

  useLayoutEffect(() => {
    measureDzTableColWidths();
    const t = window.setTimeout(measureDzTableColWidths, 0);
    const table = dataTableRef.current;
    let ro;
    if (table && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measureDzTableColWidths());
      ro.observe(table);
    }
    window.addEventListener('resize', measureDzTableColWidths);
    return () => {
      clearTimeout(t);
      ro?.disconnect();
      window.removeEventListener('resize', measureDzTableColWidths);
    };
  }, [measureDzTableColWidths, columnKeysSig, filteredByToolbar.length, displayRows.length]);

  const dataTableFixedStyle = useMemo(() => {
    if (!measuredColWidths?.length) return undefined;
    const w = measuredColWidths.reduce((a, b) => a + b, 0);
    return { tableLayout: 'fixed', width: w };
  }, [measuredColWidths]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (openFilterCol) {
          setOpenFilterCol(null);
          setColFilterSearch('');
          return;
        }
        if (suppressEscapeClose) return;
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, openFilterCol, suppressEscapeClose]);

  useEffect(() => {
    if (!openFilterCol) return;
    const onDown = (e) => {
      const el = filterPopoverRef.current;
      if (el && !el.contains(e.target)) {
        setOpenFilterCol(null);
        setColFilterSearch('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openFilterCol]);

  const setSortForColumn = useCallback((colKey, dir) => {
    if (dir == null) {
      setSortState({ key: null, dir: null });
    } else {
      setSortState({ key: colKey, dir });
    }
  }, []);

  const handleColumnFilterMasterToggle = useCallback((colKey, allOptions) => {
    const full = allOptions || [];
    if (full.length === 0) return;
    setColumnFilters((prev) => {
      const cur = prev[colKey];
      const allOn =
        cur == null ||
        (Array.isArray(cur) && cur.length === full.length && full.length > 0);
      if (allOn) {
        return { ...prev, [colKey]: [] };
      }
      const next = { ...prev };
      delete next[colKey];
      return next;
    });
  }, []);

  const toggleColumnFilterValue = useCallback((colKey, valueKey, allOptions) => {
    setColumnFilters((prev) => {
      const cur = prev[colKey];
      const full = [...allOptions];
      let nextArr;
      if (cur == null) {
        nextArr = full.filter((x) => x !== valueKey);
      } else {
        const set = new Set(cur);
        if (set.has(valueKey)) set.delete(valueKey);
        else set.add(valueKey);
        nextArr = Array.from(set);
      }
      if (nextArr.length === full.length) {
        const next = { ...prev };
        delete next[colKey];
        return next;
      }
      return { ...prev, [colKey]: nextArr };
    });
  }, []);

  const clearAllColumnFilters = useCallback(() => {
    setColumnFilters({});
    setOpenFilterCol(null);
    setColFilterSearch('');
  }, []);

  const openColumnFilter = useCallback((colKey) => {
    setOpenFilterCol((c) => (c === colKey ? null : colKey));
    setColFilterSearch('');
  }, []);

  const handleSearchChange = useCallback((e) => {
    setListSearch(e.target.value);
  }, []);

  const handleDateStartChange = useCallback((e) => {
    setDateStart(e.target.value);
  }, []);

  const handleDateEndChange = useCallback((e) => {
    setDateEnd(e.target.value);
  }, []);

  const handleFilterYearChange = useCallback((e) => {
    const v = e.target.value;
    setFilterYear(v);
    if (!v) setFilterMonthPart('');
  }, []);

  const handleFilterMonthPartChange = useCallback((e) => {
    setFilterMonthPart(e.target.value);
  }, []);

  const clearDateRange = useCallback(() => {
    setDateStart('');
    setDateEnd('');
    setFilterYear(String(new Date().getFullYear()));
    setFilterMonthPart('');
  }, []);

  const persistDropZoneColumnPrefs = useCallback(async (patch) => {
    if (columnSettingsBusyRef.current) return false;
    columnSettingsBusyRef.current = true;
    setColumnSettingsSaving(true);
    try {
      await patchListTemplate(LIST_IDS.DROP_ZONE_LIST_MODAL, patch);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    } finally {
      columnSettingsBusyRef.current = false;
      setColumnSettingsSaving(false);
    }
  }, []);

  const handleMasterScheduleColumnsChange = useCallback(
    async (e) => {
      const next = e.target.checked;
      const prev = showScheduleCustomDateColumns;
      setShowScheduleCustomDateColumns(next);
      const ok = await persistDropZoneColumnPrefs({ showScheduleCustomDateColumns: next });
      if (!ok) setShowScheduleCustomDateColumns(prev);
    },
    [showScheduleCustomDateColumns, persistDropZoneColumnPrefs]
  );

  const handleScheduleKeyVisibilityChange = useCallback(
    async (ik, visible) => {
      const prevVis = scheduleCustomDateColumnVisibility;
      const nextVis = { ...prevVis };
      if (visible) delete nextVis[ik];
      else nextVis[ik] = false;
      setScheduleCustomDateColumnVisibility(nextVis);
      const ok = await persistDropZoneColumnPrefs({
        scheduleCustomDateColumnVisibility: nextVis
      });
      if (!ok) setScheduleCustomDateColumnVisibility(prevVis);
    },
    [scheduleCustomDateColumnVisibility, persistDropZoneColumnPrefs]
  );

  return (
    <div
      className="sp-dz-list-modal-overlay sp-dz-list-modal-overlay--fullscreen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sp-dz-list-modal-title"
      onClick={onClose}
    >
      <div
        className="sp-dz-list-modal sp-dz-list-modal--extended sp-dz-list-modal--table sp-dz-list-modal--fullscreen"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`sp-dz-list-modal-head ${modalCfg.colorClass}`}>
          <div className="sp-dz-list-modal-head-main">
            <span className="material-symbols-outlined sp-dz-list-modal-icon sp-dz-icon--fill" aria-hidden>
              {modalCfg.icon}
            </span>
            <div>
              <h2 id="sp-dz-list-modal-title" className="sp-dz-list-modal-title">
                {modalCfg.label}
              </h2>
              {Number.isFinite(forecastPercent) ? (
                <p className="sp-dz-list-modal-sub">Forecast {forecastPercent}%</p>
              ) : null}
            </div>
          </div>
          <button type="button" className="sp-dz-list-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="sp-dz-list-modal-toolbar">
          <div className="sp-dz-list-modal-toolbar-search-row">
          <div className="sp-dz-list-modal-search-wrap">
            <span className="material-symbols-outlined sp-dz-list-modal-search-icon" aria-hidden>
              search
            </span>
            <input
              type="text"
              className="sp-dz-list-modal-search-input"
              placeholder="제목·회사·연락처·제품 검색…"
              value={listSearch}
              onChange={handleSearchChange}
              aria-label="목록 내 검색"
            />
            </div>
            <div className="sp-dz-col-settings" ref={colSettingsWrapRef}>
              <button
                type="button"
                className="sp-dz-col-settings-trigger"
                aria-expanded={colSettingsOpen}
                aria-haspopup="dialog"
                aria-controls="sp-dz-col-settings-panel"
                disabled={columnSettingsSaving}
                onClick={() => setColSettingsOpen((o) => !o)}
              >
                <span className="material-symbols-outlined sp-dz-col-settings-trigger-icon" aria-hidden>
                  view_column
                </span>
                열 추가
              </button>
              {colSettingsOpen ? (
                <div
                  id="sp-dz-col-settings-panel"
                  className="sp-dz-col-settings-pop"
                  role="dialog"
                  aria-label="표시할 맞춤 일정 열"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="sp-dz-col-settings-pop-lead">
                    회사 맞춤 일정(추가 날짜) 중 표에 넣을 열을 고릅니다. 변경 사항은 계정(listTemplates)에 저장됩니다.
                  </p>
                  <label className="sp-dz-col-settings-master">
                    <input
                      type="checkbox"
                      checked={showScheduleCustomDateColumns}
                      onChange={handleMasterScheduleColumnsChange}
                      disabled={columnSettingsSaving}
                    />
                    <span>맞춤 일정 열 전체 사용</span>
                  </label>
                  {!showScheduleCustomDateColumns ? (
                    <p className="sp-dz-col-settings-pop-note">위 선택을 끄면 아래 항목과 관계없이 맞춤 일정 열이 나오지 않습니다.</p>
                  ) : scheduleColumnKeyCandidates.length === 0 ? (
                    <p className="sp-dz-col-settings-pop-empty">
                      표시할 맞춤 일정 필드가 없습니다. 기회에 일정 값이 있거나, 회사에서 일정 필드를 정의하면 여기에서 선택할 수 있습니다.
                    </p>
                  ) : (
                    <ul className="sp-dz-col-settings-key-list">
                      {scheduleColumnKeyCandidates.map((ik) => {
                        const checked =
                          showScheduleCustomDateColumns && scheduleCustomDateColumnVisibility[ik] !== false;
                        const title =
                          scheduleFieldLabelByKey[ik] || ik;
                        const optId = `sp-dz-sck-${ik.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}`;
                        return (
                          <li key={ik}>
                            <label className="sp-dz-col-settings-key-item" htmlFor={optId}>
                              <input
                                id={optId}
                                type="checkbox"
                                checked={checked}
                                disabled={columnSettingsSaving || !showScheduleCustomDateColumns}
                                onChange={(ev) =>
                                  void handleScheduleKeyVisibilityChange(ik, ev.target.checked)
                                }
                              />
                              <span className="sp-dz-col-settings-key-label" title={ik}>
                                {title}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="sp-dz-col-settings-close"
                    onClick={() => setColSettingsOpen(false)}
                  >
                    닫기
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="sp-dz-list-modal-date-toolbar">
            <div className="sp-dz-list-modal-date-row">
              <label className="sp-dz-list-modal-date-field">
                <span className="sp-dz-list-modal-date-field-label">시작일</span>
                <input
                  type="date"
                  className="sp-dz-list-modal-date-input"
                  value={dateStart}
                  onChange={handleDateStartChange}
                  aria-label="기간 시작일"
                />
              </label>
              <span className="sp-dz-list-modal-date-sep" aria-hidden>
                ~
              </span>
              <label className="sp-dz-list-modal-date-field">
                <span className="sp-dz-list-modal-date-field-label">마감일</span>
                <input
                  type="date"
                  className="sp-dz-list-modal-date-input"
                  value={dateEnd}
                  onChange={handleDateEndChange}
                  aria-label="기간 마감일"
                />
              </label>
              <label className="sp-dz-list-modal-date-field">
                <span className="sp-dz-list-modal-date-field-label">연도</span>
                <select
                  className="sp-dz-list-modal-date-input sp-dz-list-modal-date-input--select"
                  value={filterYear}
                  onChange={handleFilterYearChange}
                  aria-label="연도"
                >
                  <option value="">연도 전체</option>
                  {yearSelectValues.map((y) => (
                    <option key={y} value={String(y)}>
                      {y}년
                    </option>
                  ))}
                </select>
              </label>
              <label className="sp-dz-list-modal-date-field">
                <span className="sp-dz-list-modal-date-field-label">월</span>
                <select
                  className="sp-dz-list-modal-date-input sp-dz-list-modal-date-input--select"
                  value={filterMonthPart}
                  onChange={handleFilterMonthPartChange}
                  aria-label={filterMonth ? `월 (${filterMonth})` : '월'}
                  disabled={!filterYear}
                >
                  <option value="">월 전체</option>
                  {MONTH_SELECT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              {dateStart || dateEnd || !isYmDefault ? (
                <button type="button" className="sp-dz-list-modal-date-clear" onClick={clearDateRange}>
                  기간·월 초기화
                </button>
              ) : null}
            </div>
            <p className="sp-dz-list-modal-date-hint">
              기준: 마지막 수정일(없으면 등록일)입니다. 열 이름을 누르면 정렬·필터 패널이 열립니다. 맞춤 일정 열은 상단{' '}
              <strong>열 추가</strong>에서 선택합니다.
            </p>
          </div>
        </div>

        <div className="sp-dz-list-modal-body sp-dz-list-modal-body--table">
          {filteredByToolbar.length === 0 ? (
            <p className="sp-dz-list-modal-empty">
              {items.length === 0 ? '표시할 기회가 없습니다.' : '조건에 맞는 기회가 없습니다.'}
            </p>
          ) : (
            <div className="sp-dz-table-panel">
              <div className="sp-dz-table-h-scroll">
                <div className="sp-dz-table-inner">
                  <div className="sp-dz-table-scroll">
                    <table
                      ref={dataTableRef}
                      className="sp-dz-data-table sp-dz-data-table--no-actions"
                      style={dataTableFixedStyle}
                    >
                      {measuredColWidths && measuredColWidths.length > 0 ? (
                        <colgroup>
                          {measuredColWidths.map((w, i) => (
                            <col key={i} style={{ width: `${w}px`, minWidth: `${w}px` }} />
                          ))}
                        </colgroup>
                      ) : null}
                      <thead>
                  <tr>
                    <th className="sp-dz-data-table__th sp-dz-data-table__th--sticky-id" scope="col">
                      행
                    </th>
                    {columnKeys.map((colKey, colIdx) => {
                      const hasColFilter = Array.isArray(columnFilters[colKey]);
                      const activeSortKey = sortState.key;
                      const activeSortDir = sortState.dir;
              return (
                        <th
                          key={colKey}
                          className="sp-dz-data-table__th sp-dz-data-table__th--col-tools sp-dz-data-table__th--dz-col-reorder"
                          scope="col"
                          title={columnHeaderLabel(colKey, scheduleFieldLabelByKey)}
                draggable
                          onDragStart={(e) => handleColumnHeaderDragStart(e, colIdx)}
                          onDragOver={handleColumnHeaderDragOver}
                          onDrop={(e) => handleColumnHeaderDrop(e, colIdx)}
                        >
                          <div
                            className="sp-dz-th-wrap"
                            ref={openFilterCol === colKey ? filterPopoverRef : null}
                          >
                    <button
                      type="button"
                              className={`sp-dz-th-col-trigger${hasColFilter ? ' sp-dz-th-col-trigger--filtered' : ''}`}
                              aria-expanded={openFilterCol === colKey}
                              aria-haspopup="dialog"
                              aria-label={`${columnHeaderLabel(colKey, scheduleFieldLabelByKey)} 정렬·필터`}
                      onClick={(e) => {
                        e.stopPropagation();
                                openColumnFilter(colKey);
                              }}
                            >
                              <span className="sp-dz-th-col-trigger__label">
                                {columnHeaderLabel(colKey, scheduleFieldLabelByKey)}
                              </span>
                              {activeSortKey === colKey && activeSortDir === 'asc' ? (
                                <span className="material-symbols-outlined sp-dz-th-col-trigger__sort-icon" aria-hidden>
                                  arrow_upward
                                </span>
                  ) : null}
                              {activeSortKey === colKey && activeSortDir === 'desc' ? (
                                <span className="material-symbols-outlined sp-dz-th-col-trigger__sort-icon" aria-hidden>
                                  arrow_downward
                                </span>
                              ) : null}
                            </button>
                            {openFilterCol === colKey ? (
                              <div
                                className="sp-dz-col-filter-pop"
                                role="dialog"
                                aria-label={`${columnHeaderLabel(colKey, scheduleFieldLabelByKey)} 정렬·필터`}
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                <div className="sp-dz-col-filter-pop__sort">
                                  <span className="sp-dz-col-filter-pop__sort-caption">정렬</span>
                                  <div className="sp-dz-col-filter-pop__sort-row">
                                    <button
                                      type="button"
                                      className={
                                        activeSortKey === colKey && activeSortDir === 'asc'
                                          ? 'sp-dz-col-filter-pop__sort-btn sp-dz-col-filter-pop__sort-btn--active'
                                          : 'sp-dz-col-filter-pop__sort-btn'
                                      }
                                      onClick={() => setSortForColumn(colKey, 'asc')}
                                    >
                                      오름차순
                                    </button>
                                    <button
                                      type="button"
                                      className={
                                        activeSortKey === colKey && activeSortDir === 'desc'
                                          ? 'sp-dz-col-filter-pop__sort-btn sp-dz-col-filter-pop__sort-btn--active'
                                          : 'sp-dz-col-filter-pop__sort-btn'
                                      }
                                      onClick={() => setSortForColumn(colKey, 'desc')}
                                    >
                                      내림차순
                                    </button>
                                    <button
                                      type="button"
                                      className="sp-dz-col-filter-pop__sort-btn sp-dz-col-filter-pop__sort-btn--ghost"
                                      onClick={() => setSortForColumn(colKey, null)}
                                    >
                                      정렬 해제
                                    </button>
                </div>
                                </div>
                                <input
                                  type="text"
                                  className="sp-dz-col-filter-pop__input"
                                  placeholder="목록에서 검색…"
                                  value={colFilterSearch}
                                  onChange={(e) => setColFilterSearch(e.target.value)}
                                />
                                <ul className="sp-dz-col-filter-pop__list">
                                  {(() => {
                                    const cur = columnFilters[colKey];
                                    const full = filterUniqueOptions;
                                    const allOn =
                                      full.length > 0 &&
                                      (cur == null ||
                                        (Array.isArray(cur) && cur.length === full.length));
                                    const partial =
                                      Array.isArray(cur) &&
                                      cur.length > 0 &&
                                      cur.length < full.length;
                                    const masterId = `sp-dz-colf-master-${colKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
                                    return (
                                      <li className="sp-dz-col-filter-pop__item sp-dz-col-filter-pop__item--master">
                                        <label className="sp-dz-col-filter-pop__label sp-dz-col-filter-pop__label--master" htmlFor={masterId}>
                                          <input
                                            id={masterId}
                                            type="checkbox"
                                            checked={Boolean(allOn)}
                                            ref={(el) => {
                                              if (el) el.indeterminate = Boolean(partial);
                                            }}
                                            disabled={full.length === 0}
                                            aria-label="이 열 값 전체 선택·전체 해제"
                                            onChange={() =>
                                              handleColumnFilterMasterToggle(colKey, filterUniqueOptions)
                                            }
                                          />
                                        </label>
                                      </li>
                                    );
                                  })()}
                                  {filterUniqueForUi.length === 0 ? (
                                    <li className="sp-dz-col-filter-pop__empty">일치하는 값 없음</li>
                                  ) : (
                                    filterUniqueForUi.map((valueKey, idx) => {
                                      const cur = columnFilters[colKey];
                                      const checked = cur == null || cur.includes(valueKey);
                                      const optId = `sp-dz-colf-${colKey.replace(/[^a-zA-Z0-9_-]/g, '_')}-${idx}`;
                                      return (
                                        <li key={`${colKey}-${valueKey}-${idx}`} className="sp-dz-col-filter-pop__item">
                                          <label className="sp-dz-col-filter-pop__label" htmlFor={optId}>
                                            <input
                                              id={optId}
                                              type="checkbox"
                                              checked={checked}
                                              onChange={() =>
                                                toggleColumnFilterValue(colKey, valueKey, filterUniqueOptions)
                                              }
                                            />
                                            <span className="sp-dz-col-filter-pop__val">
                                              {filterValueDisplay(valueKey)}
                                            </span>
                                          </label>
                                        </li>
                                      );
                                    })
                                  )}
                                </ul>
                              </div>
                ) : null}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.length === 0 ? (
                    <tr className="sp-dz-data-table__row sp-dz-data-table__row--filter-empty">
                      <td
                        className="sp-dz-data-table__td sp-dz-data-table__td--filter-empty-msg"
                        colSpan={Math.max(1, 1 + columnKeys.length)}
                      >
                        <div className="sp-dz-filter-empty-inner">
                          <p className="sp-dz-filter-empty-text">
                            열 필터 조건 때문에 표시할 행이 없습니다. 열 이름을 눌러 패널에서 값을 다시 선택하거나, 맨 위 체크박스로 전체
                            선택·해제를 바꿔 주세요.
                          </p>
                          {Object.keys(columnFilters).length > 0 ? (
                            <button
                              type="button"
                              className="sp-dz-filter-empty-reset-all"
                              onClick={clearAllColumnFilters}
                            >
                              모든 열 필터 한 번에 해제
                            </button>
                ) : null}
                  </div>
                      </td>
                    </tr>
                  ) : (
                    displayRows.map((flatRow) => {
                      const opp = flatRow.opp;
                      const trClass =
                        flatRow.kind === 'summary'
                          ? 'sp-dz-data-table__row sp-dz-data-table__row--tree-summary'
                          : flatRow.kind === 'line'
                            ? 'sp-dz-data-table__row sp-dz-data-table__row--tree-line'
                            : 'sp-dz-data-table__row';
                      return (
                        <tr
                          key={flatRow.key}
                          className={trClass}
                          draggable
                          onDragStart={(e) => onDragStart(e, opp._id)}
                          onDragEnd={onDragEnd}
                          onClick={() => onOpenEdit(opp._id)}
                        >
                          <td
                            className={`sp-dz-data-table__td sp-dz-data-table__td--rownum${
                              flatRow.kind === 'line' ? ' sp-dz-data-table__td--tree-indent' : ''
                            }`}
                          >
                            {flatRow.rowLabel}
                          </td>
                          {columnKeys.map((colKey) => {
                            const { text, node } = renderDisplayRowCell(colKey, flatRow, forecastPercent);
                            return (
                              <td
                                key={colKey}
                                className={`sp-dz-data-table__td${
                                  flatRow.kind === 'line' ? ' sp-dz-data-table__td--tree-line-indent' : ''
                                }`}
                                title={text}
                              >
                                {node}
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
                  <div className="sp-dz-table-totals-strip" aria-label="열 합계">
                    <table
                      className="sp-dz-data-table sp-dz-data-table--no-actions sp-dz-data-table--totals-only"
                      style={dataTableFixedStyle}
                    >
                      {measuredColWidths && measuredColWidths.length > 0 ? (
                        <colgroup>
                          {measuredColWidths.map((w, i) => (
                            <col key={`tot-col-${i}`} style={{ width: `${w}px`, minWidth: `${w}px` }} />
                          ))}
                        </colgroup>
                      ) : null}
                      <tbody>
                        <tr className="sp-dz-data-table__row sp-dz-data-table__row--totals">
                          <td className="sp-dz-data-table__td sp-dz-data-table__td--rownum sp-dz-data-table__td--totals-label">
                            합계
                          </td>
                          {columnKeys.map((colKey) => {
                            const t = totalsByColumn[colKey];
                            return (
                              <td
                                key={`tot-${colKey}`}
                                className="sp-dz-data-table__td sp-dz-data-table__td--totals"
                                title={t}
                              >
                                {t || '\u00A0'}
                              </td>
                            );
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {filteredByToolbar.length > 0 ? (
          <div className="sp-dz-list-modal-footer">
            <p className="sp-dz-list-modal-page-info">
              표시 행 <strong>{displayRows.length}</strong> · 기회 <strong>{sortedFiltered.length}</strong>건 · 열{' '}
              <strong>{columnKeys.length}</strong>
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { formatCellValue, columnHeaderLabel, COLUMN_LABELS, DROPZONE_DEFAULT_COLUMN_ORDER };
