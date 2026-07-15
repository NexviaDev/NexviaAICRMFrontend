import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession, getAuthHeader } from '@/lib/crm-auth';
import SalesPipelineTablePanel from './sales-pipeline-table-panel';
import { useSearchParams } from 'react-router-dom';
import OpportunityModal from './opportunity-modal/opportunity-modal';
import PipelineStagesManageModal from './pipeline-stages-manage-modal/pipeline-stages-manage-modal';
import DropZoneListModal from './drop-zone-list-modal/drop-zone-list-modal';
import SalesPipelineExcelImportModal from './sales-opportunity-excel-import-modal/sales-pipeline-excel-import-modal';
import './sales-pipeline.css';
import './sales-pipeline-responsive.css';
import './sales-pipeline-table-theme.css';
import '@/shared/crm-list-sheet-table.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import ListTemplateModal from '@/components/list-template-modal/list-template-modal';
import {
  buildSalesPipelineVisibleMap,
  collectSalesPipelineTableColumnKeys,
  columnHeaderLabel,
  formatCellValue,
  isPersonalPurchaseOpp,
  formatProductNamesForDisplay,
  ProductNameCellContent,
  hasMultiLineItems,
  sumLineItemQuantities,
  readProductDisplayMode,
  writeProductDisplayMode,
  PRODUCT_DISPLAY_MODE_CHANGED_EVENT
} from './drop-zone-list-modal/drop-zone-list-modal';
import { listColumnValueInlineStyle } from '@/lib/list-column-cell-styles';
import { OPPORTUNITY_MERGE_SHEET_URL_PARAM } from '@/lib/merge-data-sheet-url';

import { API_BASE } from '@/config';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import { getMergedSalesPipelineTemplate, patchListTemplate, resetListTemplate, LIST_IDS } from '@/lib/list-templates';
import { buildStageForecastPercentMap } from './pipeline-forecast-utils';
import {
  buildStageLabelMapFromDefinitions,
  DEFAULT_PIPELINE_STAGE_SEED,
  invalidatePipelineStageLabelCache,
  resolvePipelineStageLabel
} from './pipeline-stage-labels';
import {
  fetchSalesOpportunityScheduleFieldContext,
  SALES_OPPORTUNITY_SCHEDULE_DEFS_CHANGED
} from '@/lib/sales-opportunity-schedule-labels';
import {
  fetchSalesOpportunityFinanceFieldContext,
  SALES_OPPORTUNITY_FINANCE_DEFS_CHANGED
} from '@/lib/sales-opportunity-finance-labels';
import { PriceWithKrwHint } from '@/lib/currency-price-display';
import { useExchangeRates } from '@/lib/use-exchange-rates';
import {
  getPipelineMoneyForColumn,
  PIPELINE_MONEY_DISPLAY_KEYS
} from './drop-zone-list-modal/drop-zone-list-modal';

const SALES_PIPELINE_LIST_ID = LIST_IDS.SALES_PIPELINE;
const MODAL_PARAM = 'oppModal';
const MODAL_EXCEL_IMPORT = 'excel-import';
const MODAL_ADD = 'add';
const MODAL_EDIT = 'edit';
const OPP_ID_PARAM = 'oppId';
const STAGE_PARAM = 'stage';

function getPipelineViewerUserId() {
  try {
    const u = getStoredCrmUser();
    return u?._id != null ? String(u._id) : '';
  } catch {
    return '';
  }
}

const DEFAULT_STAGE_LABELS = Object.fromEntries(DEFAULT_PIPELINE_STAGE_SEED.map((row) => [row.key, row.label]));
const DEFAULT_ACTIVE_STAGES = DEFAULT_PIPELINE_STAGE_SEED.map((row) => row.key);

const DROP_ZONE_CONFIG = {
  Won: { icon: 'check_circle', label: '수주 성공 (Won)', colorClass: 'dz-green' },
  Lost: { icon: 'cancel', label: '기회 상실 (Lost)', colorClass: 'dz-red' },
  Abandoned: { icon: 'pause_circle', label: '이월 (On Hold)', colorClass: 'dz-blue' }
};

/** 칸반 카드 헤더 파스텔 톤 — 기회 _id 기준 고정(순서·추가와 무관) */
const KANBAN_CARD_HEAD_TONE_COUNT = 8;

const KANBAN_MONEY_COLUMN_KEYS = new Set([
  'value',
  '__dz_net_margin',
  '__dz_forecast_expected',
  'contractAmount',
  'invoiceAmount',
  'unitPrice',
  'discountAmount',
  'discountValue'
]);

function isKanbanMoneyColumn(colKey) {
  return KANBAN_MONEY_COLUMN_KEYS.has(colKey);
}

function isKanbanDateColumn(colKey) {
  const k = String(colKey || '');
  return k.endsWith('Date') || k.startsWith('scheduleCustomDates.');
}

function kanbanCardHeadToneClass(oppId) {
  const s = String(oppId ?? '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i);
    h >>>= 0;
  }
  return `sp-kanban-card-head-tone-${h % KANBAN_CARD_HEAD_TONE_COUNT}`;
}

/** 긴 값은 2열 그리드에서 1행 전체(span-full) → 이후 줄바꿈 */
function shouldKanbanFieldSpanFullRow(colKey, text) {
  const s = String(text || '').trim();
  if (!s || s === '—') return false;
  if (s.includes('\n')) return true;
  if (s.length >= 22) return true;
  if (colKey === 'productName' && s.length >= 12) return true;
  if (colKey === 'title' && s.length >= 14) return true;
  if (String(colKey).startsWith('customFields.') && s.length >= 16) return true;
  return false;
}

/** 표 `sales-pipeline-table-panel` 과 동일 — 비관리자 마스킹 */
const PIPELINE_KANBAN_ADMIN_ONLY_KEYS = new Set([
  'value',
  'contractAmount',
  'invoiceAmount',
  '__dz_net_margin',
  '__dz_forecast_expected',
  'unitPrice',
  'discountValue',
  'discountAmount',
  'productListPriceSnapshot',
  'productCostPriceSnapshot',
  'productChannelPriceSnapshot',
  'collectionEntries'
]);

function pipelineKanbanOppCellText(colKey, opp, fp, stageLabels, canViewAdmin, productDisplayMode) {
  if (!canViewAdmin && PIPELINE_KANBAN_ADMIN_ONLY_KEYS.has(colKey)) return '—';
  if (colKey === 'stage') return resolvePipelineStageLabel(opp.stage, stageLabels);
  if (colKey === 'productName') return formatProductNamesForDisplay(opp, productDisplayMode);
  if (colKey === 'quantity' && hasMultiLineItems(opp)) {
    return `총 ${sumLineItemQuantities(opp)}`;
  }
  return formatCellValue(colKey, opp, fp);
}

function cardSubtitleLine(opp) {
  const product = opp.productName && String(opp.productName).trim();
  if (product) return product;
  const t = opp.title && String(opp.title).trim();
  if (t) return t;
  return '—';
}


/** 단계 Forecast(%) 적용 예상 매출 합(표시 통화는 열의 첫 기회 통화, 없으면 KRW) */
function sumForecastExpectedAmount(items, forecastPercent) {
  if (!Number.isFinite(forecastPercent)) return null;
  let sum = 0;
  for (const o of items || []) {
    sum += toMoneyNumber(o?.value) * (forecastPercent / 100);
  }
  return Math.round(sum);
}

function firstOppCurrency(items) {
  const c = (items || []).find((o) => o?.currency)?.currency;
  return c || 'KRW';
}

function toMoneyNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** PATCH/POST 응답에서 클라이언트에 넣을 기회 문서만 (renewalCalendar 등 제외) */
function opportunityFromSaveApiPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const { renewalCalendar, renewalCalendarRemoved, ...rest } = payload;
  if (rest._id == null) return null;
  return rest;
}

function groupedHasOpportunityId(grouped, oppId) {
  const id = String(oppId);
  return Object.values(grouped || {}).some((arr) =>
    (arr || []).some((o) => String(o?._id) === id)
  );
}

function findOpportunityInGrouped(grouped, oppId) {
  const id = String(oppId);
  for (const items of Object.values(grouped || {})) {
    const found = (items || []).find((o) => String(o?._id) === id);
    if (found) return found;
  }
  return null;
}

/** 단계 이동·필드 수정 반영: 동일 단계면 원래 위치 유지, 바뀌면 대상 단계 맨 앞 */
function upsertOpportunityInGrouped(grouped, opp) {
  if (!opp || opp._id == null) return grouped || {};
  const id = String(opp._id);
  const targetStage = opp.stage;
  if (!targetStage) return grouped || {};

  let oldStage = null;
  let oldIndex = -1;
  for (const [st, items] of Object.entries(grouped || {})) {
    const arr = items || [];
    const idx = arr.findIndex((o) => String(o?._id) === id);
    if (idx >= 0) {
      oldStage = st;
      oldIndex = idx;
      break;
    }
  }

  const next = {};
  for (const [st, items] of Object.entries(grouped || {})) {
    next[st] = (items || []).filter((o) => String(o?._id) !== id);
  }

  const list = [...(next[targetStage] || [])];
  if (oldStage === targetStage && oldIndex >= 0) {
    const pos = Math.min(oldIndex, list.length);
    list.splice(pos, 0, opp);
  } else {
    list.unshift(opp);
  }
  next[targetStage] = list;
  return next;
}

function recalcTotalsFromGrouped(grouped) {
  const totals = {};
  for (const [stage, arr] of Object.entries(grouped || {})) {
    totals[stage] = (arr || []).reduce((s, o) => s + (Number(o?.value) || 0), 0);
  }
  return totals;
}

/** opportunity-modal 순마진과 동일: 수주 금액(value) − 원가×수량. 제품·원가 없으면 표시 안 함 */
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

function renderOppAdminCardFooter(opp, forecastPercentMap, dealBasRMap) {
  const m = computeOppNetMargin(opp);
  const fp = forecastPercentMap ? forecastPercentMap[opp.stage] : null;
  const forecastAmt =
    Number.isFinite(fp) && fp != null ? Math.round(toMoneyNumber(opp.value) * (fp / 100)) : null;
  return (
    <div className="sp-card-metrics-inline" aria-label="순마진·Forecast 예상 금액">
      <div className="sp-card-metric-inline">
        <span className="sp-card-net-margin-label">순마진</span>
        <span className="sp-card-net-margin-value">
          {m != null ? (
            <PriceWithKrwHint amount={m} currency={opp.currency} dealBasRMap={dealBasRMap} />
          ) : (
            '—'
          )}
        </span>
      </div>
      <div className="sp-card-metric-inline sp-card-metric-inline--forecast">
        <span className="sp-card-net-margin-label">Forecast 예상 금액</span>
        <span className="sp-card-net-margin-value">
          {forecastAmt != null ? (
            <PriceWithKrwHint amount={forecastAmt} currency={opp.currency} dealBasRMap={dealBasRMap} />
          ) : (
            '—'
          )}
        </span>
      </div>
    </div>
  );
}

function nameInitials(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

/** 칸반 카드 — 개인 구매 시 고객사 칸에 표시할 구매 담당자명 */
function kanbanPersonalPurchaseContactLabel(opp) {
  const contact = opp?.contactName != null ? String(opp.contactName).trim() : '';
  return contact || '—';
}

/** 고객사가 없는 개인구매면 연락처(담당자) 이름, 아니면 고객사명 */
function dealTitlePrimaryLabel(opp) {
  const company = opp.customerCompanyName && String(opp.customerCompanyName).trim();
  const contact = opp.contactName && String(opp.contactName).trim();
  if (!company && contact) return contact;
  return company || '';
}

/** 카드·목록용 사내 영업 담당 표시명 */
function salesAssigneeDisplay(opp) {
  const n = opp?.assignedToName != null ? String(opp.assignedToName).trim() : '';
  if (n) return n;
  const at = opp?.assignedTo;
  if (at && typeof at === 'object' && at.name != null) {
    const nm = String(at.name).trim();
    if (nm) return nm;
  }
  return '';
}

/** 모달 기회 일정과 동일 필드 — 카드용 짧은 표기(yy.MM.dd). ISO 날짜 문자열은 TZ 보정 없이 앞 10자만 사용 */
function formatOppScheduleDateShort(raw) {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'string') {
    const t = raw.trim();
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (y && mo && d) {
        return `${String(y % 100).padStart(2, '0')}.${String(mo).padStart(2, '0')}.${String(d).padStart(2, '0')}`;
      }
    }
  }
  const dt = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(dt.getTime())) return '';
  return `${String(dt.getFullYear() % 100).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`;
}

const OPP_SCHEDULE_CARD_FIELDS = [
  { key: 'start', shortLabel: '시작', fullLabel: '시작일', field: 'startDate' },
  { key: 'target', shortLabel: '구매예정', fullLabel: '구매 예정 날짜', field: 'targetDate' },
  { key: 'sale', shortLabel: '계약', fullLabel: '계약일', field: 'saleDate' },
  { key: 'fullColl', shortLabel: '완료', fullLabel: '전체 완료 날짜', field: 'fullCollectionCompleteDate' },
  { key: 'license', shortLabel: '증서', fullLabel: '라이선스 증서 전달 날짜', field: 'licenseCertificateDeliveredDate' }
];

/** 헤더 연·월 필터: 기본 시작일(없으면 계약일→등록일) — 상한일 이전·당일 누적. 빈 값 → 최종 수정일(해당 구간만) */
const PIPELINE_SCHEDULE_FIELD_FILTER_DEFAULT = 'startDate';
const PIPELINE_SCHEDULE_FIELD_FILTER_OPTIONS = [
  { value: 'startDate', label: '시작일' },
  { value: '', label: '최종 수정일' },
  { value: 'targetDate', label: '구매 예정' },
  { value: 'saleDate', label: '계약일' },
  { value: 'fullCollectionCompleteDate', label: '전체 완료' },
  { value: 'licenseCertificateDeliveredDate', label: '증서 전달' }
];

function getOppScheduleDateEntries(opp) {
  const out = [];
  for (const def of OPP_SCHEDULE_CARD_FIELDS) {
    const display = formatOppScheduleDateShort(opp?.[def.field]);
    if (!display) continue;
    out.push({ ...def, display });
  }
  return out;
}

/** 기회 모달 사이드바 일정 — 값이 있는 항목만 칩으로 표시 */
function renderOppScheduleDatesChips(opp) {
  const entries = getOppScheduleDateEntries(opp);
  if (!entries.length) return null;
  return (
    <div className="sp-opp-dates" aria-label="기회 일정">
      {entries.map((e) => (
        <span key={e.key} className="sp-opp-date-chip" title={`${e.fullLabel} ${e.display}`}>
          <span className="sp-opp-date-chip-label">{e.shortLabel}</span>
          <span className="sp-opp-date-chip-val">{e.display}</span>
        </span>
      ))}
    </div>
  );
}

export default function SalesPipeline() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [grouped, setGrouped] = useState({});
  const [totals, setTotals] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dragId, setDragId] = useState(null);
  const kanbanDragGhostRef = useRef(null);
  /** 칸반 드래그로 단계 PATCH 중인 기회 id (중복 드롭 방지) */
  const [stagePatchingId, setStagePatchingId] = useState(null);
  /** Won / Lost / Abandoned 결과 구역 클릭 시 목록 모달 (인라인 펼침 대신) */
  const [dropZoneListStage, setDropZoneListStage] = useState(null);
  const searchTimer = useRef(null);
  /** 필터 피커 옵션 로드 시 fetchData 재생성·전체 스피너 깜빡임 방지 */
  const productFilterOptionsRef = useRef([]);
  const assigneeFilterOptionsRef = useRef([]);
  const listLoadStartedRef = useRef(false);
  const productOptionsPrimedRef = useRef(false);
  const assigneeOptionsPrimedRef = useRef(false);
  const [healthPinged, setHealthPinged] = useState(false);
  const { dealBasRMap } = useExchangeRates({ getAuthHeader, respectSessionFreeze: true });
  const [listMeta, setListMeta] = useState(null);
  const [stageDefinitions, setStageDefinitions] = useState([]);
  const [showStagesModal, setShowStagesModal] = useState(false);
  /** 모바일: 칩으로 선택한 파이프라인 단계(해당 단계 카드만 목록 표시) */
  const [mobileListStage, setMobileListStage] = useState(null);
  /** 목록 API: year/month + scheduleField(기본 시작일·서울 달력), productId·assignedTo 복수 — 기본 연·월은 전체 */
  const [filterYear, setFilterYear] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  /** 연도 선택 시 적용할 일정 필드 — 기본 시작일 */
  const [filterScheduleField, setFilterScheduleField] = useState(PIPELINE_SCHEDULE_FIELD_FILTER_DEFAULT);
  const [filterProductIds, setFilterProductIds] = useState([]);
  const [filterAssigneeIds, setFilterAssigneeIds] = useState(() => {
    const meOnly = getMergedSalesPipelineTemplate().assigneeMeOnly === true;
    const myId = getPipelineViewerUserId();
    return meOnly && myId ? [myId] : [];
  });
  const [productFilterOptions, setProductFilterOptions] = useState([]);
  const [assigneeFilterOptions, setAssigneeFilterOptions] = useState([]);
  productFilterOptionsRef.current = productFilterOptions;
  assigneeFilterOptionsRef.current = assigneeFilterOptions;
  /** listTemplates.salesPipeline.viewMode — 칸반 / 표 */
  const [pipelineViewMode, setPipelineViewMode] = useState(() => {
    const v = getMergedSalesPipelineTemplate().viewMode;
    return v === 'table' ? 'table' : 'kanban';
  });
  const [productDisplayMode, setProductDisplayMode] = useState(() => readProductDisplayMode());
  useEffect(() => {
    const sync = () => setProductDisplayMode(readProductDisplayMode());
    window.addEventListener(PRODUCT_DISPLAY_MODE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(PRODUCT_DISPLAY_MODE_CHANGED_EVENT, sync);
  }, []);
  const [pipelineListSettingsOpen, setPipelineListSettingsOpen] = useState(false);
  /** 열 설정 저장 후 collectSalesPipelineTableColumnKeys 재계산 */
  const [pipelineTemplateTick, setPipelineTemplateTick] = useState(0);
  /** scheduleCustomDates.* 열 헤더 — sales-pipeline-table-panel 과 동일 API */
  const [scheduleFieldLabelByKey, setScheduleFieldLabelByKey] = useState({});
  /** CustomFieldDefinition 에 등록된 일정 키만 열로 노출 */
  const [allowedScheduleCustomDateKeys, setAllowedScheduleCustomDateKeys] = useState(() => new Set());
  const [financeFieldLabelByKey, setFinanceFieldLabelByKey] = useState({});
  const [allowedFinanceCustomFieldKeys, setAllowedFinanceCustomFieldKeys] = useState(() => new Set());

  const modalMode = searchParams.get(MODAL_PARAM);
  const excelImportOpen = searchParams.get('modal') === MODAL_EXCEL_IMPORT;
  const editOppId = searchParams.get(OPP_ID_PARAM);
  const defaultStage = searchParams.get(STAGE_PARAM);
  const isModalOpen = modalMode === MODAL_ADD || modalMode === MODAL_EDIT;

  const openExcelImportModal = () => {
    setDropZoneListStage(null);
    const p = new URLSearchParams(searchParams);
    p.set('modal', MODAL_EXCEL_IMPORT);
    p.delete(MODAL_PARAM);
    p.delete(OPP_ID_PARAM);
    setSearchParams(p);
  };

  const closeExcelImportModal = () => {
    const p = new URLSearchParams(searchParams);
    p.delete('modal');
    setSearchParams(p, { replace: true });
  };

  const openAddModal = (stage) => {
    setDropZoneListStage(null);
    const p = new URLSearchParams(searchParams);
    p.set(MODAL_PARAM, MODAL_ADD);
    if (stage) p.set(STAGE_PARAM, stage);
    setSearchParams(p);
  };

  const openEditModal = (id, stageAfterLoad) => {
    setDropZoneListStage(null);
    const p = new URLSearchParams(searchParams);
    p.set(MODAL_PARAM, MODAL_EDIT);
    p.set(OPP_ID_PARAM, id);
    if (stageAfterLoad != null && String(stageAfterLoad).trim() !== '') {
      p.set(STAGE_PARAM, String(stageAfterLoad).trim());
    } else {
      p.delete(STAGE_PARAM);
    }
    setSearchParams(p);
  };

  const closeModal = () => {
    const p = new URLSearchParams(searchParams);
    p.delete(MODAL_PARAM);
    p.delete(OPP_ID_PARAM);
    p.delete(STAGE_PARAM);
    p.delete(OPPORTUNITY_MERGE_SHEET_URL_PARAM);
    setSearchParams(p, { replace: true });
  };

  const fetchData = useCallback(async (opts) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      /* 파이프라인 칸반: 갱신 후속(NewLead)의 미래 saleDate 숨김을 쓰지 않고 전부 표시 */
      params.set('pipelineShowAll', '1');
      if (search) params.set('search', search);
      const fy = (filterYear || '').trim();
      if (fy) {
        params.set('year', fy);
        const fm = (filterMonth || '').trim();
        if (fm) params.set('month', fm);
        /* 빈 문자열 = 최종 수정일, startDate 등 = 해당 일정 필드(기본 시작일) */
        params.set('scheduleField', (filterScheduleField || '').trim());
      }
      /*
       * productId / assignedTo 가 비어 있으면 API는 ‘전체’로 본다.
       * 피커에 올라온 항목만 전부 선택한 경우도 동일하게 취급한다(피커 밖 id가 빠지는 버그 방지).
       */
      const productFilterOptions = productFilterOptionsRef.current;
      const assigneeFilterOptions = assigneeFilterOptionsRef.current;
      let productIdsForApi = filterProductIds;
      if (productFilterOptions.length > 0 && filterProductIds.length > 0) {
        const allProductIds = new Set(productFilterOptions.map((p) => String(p._id)));
        if (
          filterProductIds.length === allProductIds.size &&
          filterProductIds.every((id) => allProductIds.has(id))
        ) {
          productIdsForApi = [];
        }
      }
      let assigneeIdsForApi = filterAssigneeIds;
      const assigneeRows = (assigneeFilterOptions || []).filter(
        (emp) => emp?.id != null && String(emp.id).trim() !== ''
      );
      if (assigneeRows.length > 0 && filterAssigneeIds.length > 0) {
        const allAssigneeIds = new Set(assigneeRows.map((e) => String(e.id)));
        if (
          filterAssigneeIds.length === allAssigneeIds.size &&
          filterAssigneeIds.every((id) => allAssigneeIds.has(id))
        ) {
          assigneeIdsForApi = [];
        }
      }
      if (productIdsForApi.length) params.set('productId', productIdsForApi.join(','));
      if (assigneeIdsForApi.length) params.set('assignedTo', assigneeIdsForApi.join(','));
      const res = await fetch(`${API_BASE}/sales-opportunities?${params}`, crmFetchInit());
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      setGrouped(data.grouped || {});
      setTotals(data.totals || {});
      setListMeta(data.meta || null);
    } catch {
      setGrouped({});
      setTotals({});
      setListMeta(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [
    search,
    filterYear,
    filterMonth,
    filterScheduleField,
    filterProductIds,
    filterAssigneeIds
  ]);

  /** 기회 모달 저장·삭제 후 전체 로딩 없이 목록만 갱신 (이미 보이는 행만 로컬 병합) */
  const handleOpportunitySaved = useCallback(
    (payload) => {
      if (payload == null || typeof payload !== 'object') {
        fetchData({ silent: true });
        return;
      }
      if (payload.deletedId != null) {
        const delId = String(payload.deletedId);
        setGrouped((prev) => {
          const next = {};
          for (const [st, items] of Object.entries(prev || {})) {
            next[st] = (items || []).filter((o) => String(o?._id) !== delId);
          }
          const totals = recalcTotalsFromGrouped(next);
          queueMicrotask(() => setTotals(totals));
          return next;
        });
        return;
      }

      const opp = opportunityFromSaveApiPayload(payload);
      if (!opp?._id) {
        queueMicrotask(() => fetchData({ silent: true }));
        return;
      }

      setGrouped((prev) => {
        if (!groupedHasOpportunityId(prev, opp._id)) {
          queueMicrotask(() => fetchData({ silent: true }));
          return prev;
        }
        const next = upsertOpportunityInGrouped(prev, opp);
        const totals = recalcTotalsFromGrouped(next);
        queueMicrotask(() => setTotals(totals));
        return next;
      });
    },
    [fetchData]
  );

  const fetchStageDefinitions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=salesPipelineStage`, crmFetchInit());
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) {
        setStageDefinitions(data.items);
        invalidatePipelineStageLabelCache();
      } else setStageDefinitions([]);
    } catch {
      setStageDefinitions([]);
    }
  }, []);

  useEffect(() => {
    fetchStageDefinitions();
  }, [fetchStageDefinitions]);

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
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const ctx = await fetchSalesOpportunityFinanceFieldContext(getAuthHeader);
      if (cancelled) return;
      setFinanceFieldLabelByKey(ctx.labelByKey);
      setAllowedFinanceCustomFieldKeys(ctx.allowedKeys);
    };
    void load();
    const onDefs = () => {
      void load();
    };
    window.addEventListener(SALES_OPPORTUNITY_FINANCE_DEFS_CHANGED, onDefs);
    return () => {
      cancelled = true;
      window.removeEventListener(SALES_OPPORTUNITY_FINANCE_DEFS_CHANGED, onDefs);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pres, ores] = await Promise.all([
          fetch(`${API_BASE}/products?productPicker=1&limit=500`, crmFetchInit()),
          fetch(`${API_BASE}/companies/overview`, crmFetchInit())
        ]);
        const pdata = await pres.json().catch(() => ({}));
        const odata = await ores.json().catch(() => ({}));
        if (!cancelled && Array.isArray(pdata.items)) setProductFilterOptions(pdata.items);
        if (!cancelled && Array.isArray(odata.employees)) setAssigneeFilterOptions(odata.employees);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onStagesUpdated = () => {
      fetchStageDefinitions();
    };
    window.addEventListener('nexvia-pipeline-stages-updated', onStagesUpdated);
    return () => window.removeEventListener('nexvia-pipeline-stages-updated', onStagesUpdated);
  }, [fetchStageDefinitions]);

  useEffect(() => {
    if (!healthPinged) {
      let cancelled = false;
      fetch(`${API_BASE}/health`).finally(() => {
        if (!cancelled) setHealthPinged(true);
      });
      return () => {
        cancelled = true;
      };
    }
    const silent = listLoadStartedRef.current;
    listLoadStartedRef.current = true;
    fetchData({ silent });
  }, [fetchData, healthPinged]);

  /** 제품·담당자 피커 옵션 로드 후 API 파라미터 정규화만 silent 재조회 */
  useEffect(() => {
    if (!healthPinged || !listLoadStartedRef.current) return;
    let needSilent = false;
    if (productFilterOptions.length > 0 && !productOptionsPrimedRef.current) {
      productOptionsPrimedRef.current = true;
      needSilent = true;
    }
    if (assigneeFilterOptions.length > 0 && !assigneeOptionsPrimedRef.current) {
      assigneeOptionsPrimedRef.current = true;
      needSilent = true;
    }
    if (needSilent) fetchData({ silent: true });
  }, [healthPinged, productFilterOptions, assigneeFilterOptions, fetchData]);

  useEffect(() => {
    const onPipelineRefresh = () => {
      fetchData({ silent: true });
    };
    window.addEventListener('nexvia-crm-pipeline-refresh', onPipelineRefresh);
    return () => window.removeEventListener('nexvia-crm-pipeline-refresh', onPipelineRefresh);
  }, [fetchData]);

  const onSearchInput = (e) => {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchData(), 350);
  };

  const persistAssigneeMeTemplate = useCallback((assigneeMeOnly) => {
    patchListTemplate(SALES_PIPELINE_LIST_ID, { assigneeMeOnly }).catch((err) => {
      window.alert(err?.message || '저장에 실패했습니다.');
    });
  }, []);

  const persistPipelineViewMode = useCallback((mode) => {
    const next = mode === 'table' ? 'table' : 'kanban';
    setPipelineViewMode(next);
    patchListTemplate(SALES_PIPELINE_LIST_ID, { viewMode: next })
      .then((data) => {
        const vm = data?.listTemplates?.salesPipeline?.viewMode;
        if (vm === 'kanban' || vm === 'table') setPipelineViewMode(vm);
      })
      .catch((err) => {
        window.alert(err?.message || '저장에 실패했습니다.');
      });
  }, []);

  const savePipelineListTemplate = useCallback(async (payload) => {
    try {
      await patchListTemplate(SALES_PIPELINE_LIST_ID, {
        columnOrder: payload.columnOrder,
        visible: payload.visible,
        columnCellStyles: payload.columnCellStyles,
        ...(payload.columnWidths !== undefined ? { columnWidths: payload.columnWidths } : {})
      });
      setPipelineTemplateTick((t) => t + 1);
    } catch (err) {
      window.alert(err?.message || '저장에 실패했습니다.');
      throw err;
    }
  }, []);

  const savePipelineColumnWidths = useCallback(
    async (columnWidths) => {
      const saved = getMergedSalesPipelineTemplate();
      try {
        await patchListTemplate(SALES_PIPELINE_LIST_ID, {
          columnOrder: saved.columnOrder,
          visible: saved.visible,
          columnCellStyles: saved.columnCellStyles,
          columnWidths
        });
        setPipelineTemplateTick((t) => t + 1);
      } catch (err) {
        window.alert(err?.message || '열 너비 저장에 실패했습니다.');
        throw err;
      }
    },
    []
  );

  const resetPipelineListTemplate = useCallback(async () => {
    try {
      await resetListTemplate(SALES_PIPELINE_LIST_ID);
      setPipelineTemplateTick((t) => t + 1);
    } catch (err) {
      window.alert(err?.message || '초기화에 실패했습니다.');
      throw err;
    }
  }, []);

  const savePipelineTableColumnOrder = useCallback(async (nextOrder) => {
    try {
      const saved = getMergedSalesPipelineTemplate();
      await patchListTemplate(SALES_PIPELINE_LIST_ID, {
        columnOrder: nextOrder,
        columnWidths: saved.columnWidths
      });
      setPipelineTemplateTick((t) => t + 1);
    } catch (err) {
      window.alert(err?.message || '저장에 실패했습니다.');
      throw err;
    }
  }, []);

  const pipelineYearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    const out = [];
    for (let i = y + 1; i >= y - 8; i -= 1) {
      out.push(i);
    }
    return out;
  }, []);

  const assigneesForSelect = useMemo(() => {
    const rows = (assigneeFilterOptions || []).filter((emp) => emp?.id != null && String(emp.id).trim() !== '');
    const myId = getPipelineViewerUserId();
    if (!myId) {
      return rows.slice().sort((a, b) => {
        const an = (a.name && String(a.name).trim()) || a.email || '';
        const bn = (b.name && String(b.name).trim()) || b.email || '';
        return String(an).localeCompare(String(bn), 'ko');
      });
    }
    const me = rows.find((e) => String(e.id) === myId);
    const rest = rows
      .filter((e) => String(e.id) !== myId)
      .sort((a, b) => {
        const an = (a.name && String(a.name).trim()) || a.email || '';
        const bn = (b.name && String(b.name).trim()) || b.email || '';
        return String(an).localeCompare(String(bn), 'ko');
      });
    return me ? [me, ...rest] : rest;
  }, [assigneeFilterOptions]);

  const pipelineViewerId = getPipelineViewerUserId();

  const assigneeFilterSummary = useMemo(() => {
    if (filterAssigneeIds.length === 0) return '전체';
    if (assigneesForSelect.length > 0) {
      const allIds = new Set(assigneesForSelect.map((e) => String(e.id)));
      if (
        filterAssigneeIds.length === allIds.size &&
        filterAssigneeIds.every((id) => allIds.has(id))
      ) {
        return '전체';
      }
    }
    if (filterAssigneeIds.length === 1) {
      const id = filterAssigneeIds[0];
      const emp = assigneesForSelect.find((e) => String(e.id) === id);
      const base = emp ? ((emp.name && String(emp.name).trim()) || emp.email || id) : id;
      return pipelineViewerId && id === pipelineViewerId ? `${base} (나)` : base;
    }
    return `${filterAssigneeIds.length}명 선택`;
  }, [filterAssigneeIds, assigneesForSelect, pipelineViewerId]);

  const productFilterSummary = useMemo(() => {
    if (filterProductIds.length === 0) return '전체';
    if (productFilterOptions.length > 0) {
      const allIds = new Set(productFilterOptions.map((p) => String(p._id)));
      if (filterProductIds.length === allIds.size && filterProductIds.every((id) => allIds.has(id))) {
        return '전체';
      }
    }
    if (filterProductIds.length === 1) {
      const id = filterProductIds[0];
      const p = productFilterOptions.find((x) => String(x._id) === id);
      return (p?.name && String(p.name).trim()) || p?.code || id;
    }
    return `${filterProductIds.length}개 선택`;
  }, [filterProductIds, productFilterOptions]);

  const toggleFilterAssigneeId = useCallback(
    (id) => {
      const sid = String(id).trim();
      if (!sid) return;
      setFilterAssigneeIds((prev) => {
        const next = prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid];
        const myId = getPipelineViewerUserId();
        persistAssigneeMeTemplate(Boolean(myId && next.length === 1 && next[0] === myId));
        return next;
      });
    },
    [persistAssigneeMeTemplate]
  );

  const toggleFilterProductId = useCallback((pid) => {
    const sid = String(pid).trim();
    if (!sid) return;
    setFilterProductIds((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));
  }, []);

  const selectAllFilterAssigneeIds = useCallback(() => {
    const ids = assigneesForSelect.map((e) => String(e.id).trim()).filter(Boolean);
    setFilterAssigneeIds(ids);
    persistAssigneeMeTemplate(false);
  }, [assigneesForSelect, persistAssigneeMeTemplate]);

  const selectAllFilterProductIds = useCallback(() => {
    const ids = productFilterOptions.map((p) => String(p._id).trim()).filter(Boolean);
    setFilterProductIds(ids);
  }, [productFilterOptions]);

  /* ---- Drag & Drop ---- */
  const cleanupKanbanDragGhost = useCallback(() => {
    const ghost = kanbanDragGhostRef.current;
    if (ghost?.parentNode) ghost.parentNode.removeChild(ghost);
    kanbanDragGhostRef.current = null;
  }, []);

  const handleDragStart = (e, id) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    const card = e.currentTarget;
    cleanupKanbanDragGhost();
    try {
      const ghost = card.cloneNode(true);
      ghost.classList.remove('sp-card-dragging', 'sp-card--stage-patching');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.cssText = [
        'position:fixed',
        'left:-10000px',
        'top:0',
        `width:${card.offsetWidth}px`,
        'opacity:1',
        'transform:none',
        'pointer-events:none',
        'z-index:-1'
      ].join(';');
      document.body.appendChild(ghost);
      kanbanDragGhostRef.current = ghost;
      const ox = Number.isFinite(e.nativeEvent?.offsetX) ? e.nativeEvent.offsetX : Math.round(card.offsetWidth / 2);
      const oy = Number.isFinite(e.nativeEvent?.offsetY) ? e.nativeEvent.offsetY : 24;
      e.dataTransfer.setDragImage(ghost, ox, oy);
    } catch {
      cleanupKanbanDragGhost();
    }
    card.classList.add('sp-card-dragging');
  };

  const handleDragEnd = (e) => {
    e.currentTarget.classList.remove('sp-card-dragging');
    cleanupKanbanDragGhost();
    setDragId(null);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('sp-drop-hover');
  };

  const handleDragLeave = (e) => {
    e.currentTarget.classList.remove('sp-drop-hover');
  };

  /** 칸반 드롭: 모달 없이 단계만 저장 (백엔드 updateStage = 모달 Won 전환·저장과 동일 서버 처리) */
  const handleDrop = async (e, targetStage) => {
    e.preventDefault();
    e.currentTarget.classList.remove('sp-drop-hover');
    const rawId = e.dataTransfer.getData('text/plain') || dragId;
    const id = rawId != null ? String(rawId) : '';
    setDragId(null);
    if (!id || stagePatchingId) return;

    let fromStage = null;
    for (const [stage, items] of Object.entries(grouped || {})) {
      if ((items || []).some((i) => String(i._id) === id)) {
        fromStage = stage;
        break;
      }
    }
    if (fromStage == null) return;
    if (String(fromStage) === String(targetStage)) return;

    const opp = findOpportunityInGrouped(grouped, id);
    if (!opp) return;

    setDropZoneListStage(null);
    const prevGrouped = grouped;
    const prevTotals = totals;
    const optimisticOpp = { ...opp, stage: targetStage };

    setStagePatchingId(id);
    setGrouped((prev) => {
      const next = upsertOpportunityInGrouped(prev, optimisticOpp);
      queueMicrotask(() => setTotals(recalcTotalsFromGrouped(next)));
      return next;
    });

    try {
      const res = await fetch(
        `${API_BASE}/sales-opportunities/${encodeURIComponent(id)}/stage`,
        crmFetchInit({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            stage: targetStage,
            renewalFollowUpLayout: 'split',
            renewalFollowUpCreateOpportunities: true
        }) })
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '단계 변경에 실패했습니다.');

      if (data.renewalCalendar || data.renewalCalendarRemoved) {
        window.dispatchEvent(new CustomEvent('nexvia-crm-calendar-refresh'));
      }
      handleOpportunitySaved(data);
    } catch (err) {
      setGrouped(prevGrouped);
      setTotals(prevTotals);
      window.alert(err?.message || '단계 변경에 실패했습니다.');
      fetchData({ silent: true });
    } finally {
      setStagePatchingId(null);
    }
  };

  const handleDelete = async (id) => {
    if (!isAdminOrAboveRole(getStoredCrmUser()?.role)) {
      window.alert('기회 삭제는 관리자(Admin) 이상만 가능합니다.');
      return;
    }
    if (!window.confirm('이 기회를 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`${API_BASE}/sales-opportunities/${id}`, crmFetchInit({ method: 'DELETE' }));
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        window.alert(data.error || '삭제 권한이 없습니다.');
        return;
      }
      fetchData();
    } catch { /* ignore */ }
  };

  const activeStages = stageDefinitions.length > 0
    ? stageDefinitions.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((d) => d.key)
    : DEFAULT_ACTIVE_STAGES;
  const boardStages = activeStages.filter((stage) => stage !== 'Won');
  const stageLabels = useMemo(
    () => buildStageLabelMapFromDefinitions(stageDefinitions),
    [stageDefinitions]
  );
  const stageForecastPercent = useMemo(() => buildStageForecastPercentMap(stageDefinitions), [stageDefinitions]);
  const stageToneByKey = useMemo(() => {
    const tone = {};
    boardStages.forEach((stage, idx) => {
      tone[stage] = `tone-${idx % 6}`;
    });
    return tone;
  }, [boardStages]);

  useEffect(() => {
    if (!boardStages.length) return;
    setMobileListStage((prev) => (prev && boardStages.includes(prev) ? prev : boardStages[0]));
  }, [boardStages]);

  /** 관리자·대표: 금액·단계 관리·기회 삭제 등 (Manager 제외) */
  const canViewAdminContent = isAdminOrAboveRole(getStoredCrmUser()?.role);

  const renderOppValue = (opp) => {
    if (!canViewAdminContent) return '—';
    return <PriceWithKrwHint amount={opp.value} currency={opp.currency} dealBasRMap={dealBasRMap} />;
  };

  const activeMobileStage =
    mobileListStage && boardStages.includes(mobileListStage) ? mobileListStage : boardStages[0];
  const mobileStageItems = activeMobileStage ? grouped[activeMobileStage] || [] : [];
  const mobileFp = activeMobileStage ? stageForecastPercent[activeMobileStage] : null;
  const mobileForecastSum =
    canViewAdminContent && activeMobileStage && Number.isFinite(mobileFp)
      ? sumForecastExpectedAmount(mobileStageItems, mobileFp)
      : null;
  const mobileColCurrency = firstOppCurrency(mobileStageItems);

  const dropZoneModalCfg = dropZoneListStage ? DROP_ZONE_CONFIG[dropZoneListStage] : null;
  const dropZoneModalItems = dropZoneListStage ? grouped[dropZoneListStage] || [] : [];

  const allOpportunities = useMemo(() => {
    const out = [];
    for (const st of boardStages) {
      out.push(...(grouped[st] || []));
    }
    for (const st of ['Won', 'Lost', 'Abandoned']) {
      out.push(...(grouped[st] || []));
    }
    return out;
  }, [grouped, boardStages]);

  const pipelineListTemplate = useMemo(() => {
    const saved = getMergedSalesPipelineTemplate();
    const columnOrder = collectSalesPipelineTableColumnKeys(allOpportunities, {
      savedColumnOrder: saved.columnOrder,
      addNetMargin: canViewAdminContent,
      addForecast: canViewAdminContent,
      allowedScheduleCustomDateKeys,
      allowedFinanceCustomFieldKeys
    });
    const visible = buildSalesPipelineVisibleMap(columnOrder, saved.visible);
    const columns = columnOrder.map((k) => ({
      key: k,
      label: columnHeaderLabel(k, scheduleFieldLabelByKey, financeFieldLabelByKey)
    }));
    const columnCellStyles =
      saved.columnCellStyles && typeof saved.columnCellStyles === 'object' && !Array.isArray(saved.columnCellStyles)
        ? { ...saved.columnCellStyles }
        : {};
    const columnWidths =
      saved.columnWidths && typeof saved.columnWidths === 'object' && !Array.isArray(saved.columnWidths)
        ? { ...saved.columnWidths }
        : {};
    return { columnOrder, visible, columns, columnCellStyles, columnWidths };
  }, [allOpportunities, canViewAdminContent, pipelineTemplateTick, scheduleFieldLabelByKey, allowedScheduleCustomDateKeys, financeFieldLabelByKey, allowedFinanceCustomFieldKeys]);

  const pipelineDisplayColumnKeys = useMemo(
    () => pipelineListTemplate.columnOrder.filter((k) => pipelineListTemplate.visible[k]),
    [pipelineListTemplate]
  );

  /** 칸반: 카드가 이미 해당 단계 열 안에 있으므로 「단계」필드는 표시하지 않음 */
  const kanbanDisplayColumnKeys = useMemo(
    () => pipelineDisplayColumnKeys.filter((k) => k !== 'stage'),
    [pipelineDisplayColumnKeys]
  );

  const renderDesktopKanbanLucidCard = (opp) => {
    const fp = stageForecastPercent[opp.stage];
    const patching = String(stagePatchingId) === String(opp._id);
    const colKeys = (isPersonalPurchaseOpp(opp)
      ? kanbanDisplayColumnKeys.filter((k) => k !== 'contactName')
      : kanbanDisplayColumnKeys);
    const accentTone = stageToneByKey[opp.stage] || 'tone-0';
    return (
      <div
        key={opp._id}
        className={`sp-card sp-card--lucid sp-card--lucid-accent-${accentTone}${patching ? ' sp-card--stage-patching' : ''}`}
        draggable={!patching}
        onDragStart={(e) => handleDragStart(e, opp._id)}
        onDragEnd={handleDragEnd}
        onClick={() => openEditModal(opp._id)}
        role="listitem"
      >
        {canViewAdminContent ? (
          <button
            type="button"
            className="sp-card-more sp-card-more--floating"
            title="삭제"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(opp._id);
            }}
          >
            <span className="material-symbols-outlined">delete</span>
          </button>
        ) : null}
        {(() => {
          const [headKey, ...bodyKeys] = colKeys;
          const renderField = (colKey, idx, keys, isHead) => {
            const personalPurchase = isPersonalPurchaseOpp(opp);
            const isPersonalCompanyCell = personalPurchase && colKey === 'customerCompanyName';
            let text = pipelineKanbanOppCellText(
              colKey,
              opp,
              fp,
              stageLabels,
              canViewAdminContent,
              productDisplayMode
            );
            if (isPersonalCompanyCell) text = kanbanPersonalPurchaseContactLabel(opp);
            const spanFull =
              isHead ||
              shouldKanbanFieldSpanFullRow(colKey, text) ||
              (keys.length % 2 === 1 && idx === keys.length - 1);
            const kStyle = listColumnValueInlineStyle(pipelineListTemplate.columnCellStyles, colKey);
            const isProductNameCol = colKey === 'productName';
            const label = columnHeaderLabel(colKey, scheduleFieldLabelByKey, financeFieldLabelByKey);
            const moneyInfo =
              canViewAdminContent && PIPELINE_MONEY_DISPLAY_KEYS.has(colKey)
                ? getPipelineMoneyForColumn(colKey, { opp, kind: 'summary' }, fp)
                : null;
            const valTitle = isPersonalCompanyCell
              ? `${text} (개인 구매)`
              : text === ''
                ? undefined
                : text;
            return (
              <div
                key={colKey}
                className={[
                  'sp-kanban-card-field',
                  isHead ? `sp-kanban-card-field--head ${kanbanCardHeadToneClass(opp._id)}` : 'sp-kanban-card-field--body',
                  spanFull ? 'sp-kanban-card-field--full' : '',
                  isProductNameCol ? 'sp-kanban-card-field--product-name' : '',
                  isPersonalCompanyCell ? 'sp-kanban-card-field--personal-company' : '',
                  isKanbanMoneyColumn(colKey) ? 'sp-kanban-card-field--money' : '',
                  isKanbanDateColumn(colKey) ? 'sp-kanban-card-field--date' : '',
                  spanFull ? 'sp-kanban-card-field--wrap' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className="sp-kanban-card-field-label">{label}</div>
                <div
                  className={`sp-kanban-card-field-val${isPersonalCompanyCell ? ' sp-kanban-card-field-val--personal' : ''}`}
                  title={valTitle}
                >
                  {isPersonalCompanyCell ? (
                    <>
                      <span
                        className={`sp-kanban-card-field-val-inner${spanFull ? ' sp-kanban-card-field-val-inner--wrap' : ''}`}
                        style={kStyle || undefined}
                      >
                        {text === '—' ? '\u00A0' : text}
                      </span>
                      <span className="sp-kanban-card-personal-tag">개인 구매</span>
                    </>
                  ) : isProductNameCol && text ? (
                    <>
                      <ProductNameCellContent opp={opp} mode={productDisplayMode} />
                      {hasMultiLineItems(opp) && productDisplayMode !== 'summary' ? (
                        <span className="sp-kanban-product-qty-meta">
                          총 수량 {sumLineItemQuantities(opp)}
                        </span>
                      ) : null}
                    </>
                  ) : moneyInfo ? (
                    <PriceWithKrwHint
                      amount={moneyInfo.amount}
                      currency={moneyInfo.currency}
                      dealBasRMap={dealBasRMap}
                    />
                  ) : (
                    <span
                      className={`sp-kanban-card-field-val-inner${spanFull ? ' sp-kanban-card-field-val-inner--wrap' : ''}`}
                      style={kStyle || undefined}
                    >
                      {text === '' ? '\u00A0' : text}
                    </span>
                  )}
                </div>
              </div>
            );
          };
          return (
            <>
              {headKey ? renderField(headKey, 0, colKeys, true) : null}
              {bodyKeys.length > 0 ? (
                <div className="sp-kanban-card-body">
                  <div className="sp-kanban-card-grid sp-kanban-card-grid--body">
                    {bodyKeys.map((colKey, idx) => renderField(colKey, idx, bodyKeys, false))}
                  </div>
                </div>
              ) : null}
            </>
          );
        })()}
      </div>
    );
  };

  return (
    <div className={`sp-container${pipelineViewMode === 'table' ? ' sp-pipeline-page--table-view' : ''}`}>
      {/* Header */}
      <header className="sp-header">
        <div className="sp-header-brand">
          <div className="sp-header-brand-title-wrap">
            <h2 className="sp-title">영업기회</h2>
            <p className="sp-title-sub">세일즈 현황</p>
          </div>
          <div className="sp-search-wrap">
            <span className="material-symbols-outlined sp-search-icon">search</span>
            <input className="sp-search" type="text" placeholder="영업기회 검색..." value={search} onChange={onSearchInput} aria-label="영업기회 검색" />
          </div>
        </div>
        <div className="sp-header-right">
          <div className="sp-view-mode-toggle" role="group" aria-label="보기 방식">
            <button
              type="button"
              className="sp-header-icon-btn sp-header-tool-btn is-active"
              onClick={() => persistPipelineViewMode(pipelineViewMode === 'kanban' ? 'table' : 'kanban')}
              title={pipelineViewMode === 'kanban' ? '표 보기로 전환' : '칸반 보기로 전환'}
              aria-label={
                pipelineViewMode === 'kanban'
                  ? '현재 칸반 보기. 표 보기로 전환'
                  : '현재 표 보기. 칸반 보기로 전환'
              }
            >
              <span className="material-symbols-outlined">
                {pipelineViewMode === 'kanban' ? 'view_kanban' : 'table_rows'}
              </span>
              <span className="sp-header-btn-label">
                {pipelineViewMode === 'kanban' ? '표 보기' : '칸반 보기'}
              </span>
            </button>
            <button
              type="button"
              className={`sp-header-icon-btn sp-header-tool-btn${productDisplayMode === 'summary' ? ' is-active' : ''}`}
              onClick={() => {
                const next = productDisplayMode === 'summary' ? 'list' : 'summary';
                writeProductDisplayMode(next);
                setProductDisplayMode(next);
              }}
              title={
                productDisplayMode === 'summary'
                  ? '제품명 세로 목록 보기로 전환'
                  : '제품 요약(제품 N건 · 총 수량 M) 보기로 전환'
              }
              aria-label="제품 표시 방식 전환"
            >
              <span className="material-symbols-outlined">inventory_2</span>
              <span className="sp-header-btn-label">
                {productDisplayMode === 'summary' ? '제품 목록' : '제품 요약'}
              </span>
            </button>
            <button
              type="button"
              className="sp-header-icon-btn sp-header-tool-btn"
              onClick={() => setPipelineListSettingsOpen(true)}
              title="표·칸반 표시 항목 설정"
              aria-label="표·칸반 표시 항목 설정"
            >
              <span className="material-symbols-outlined">settings</span>
              <span className="sp-header-btn-label">표시 설정</span>
            </button>
            <button
              type="button"
              className="sp-header-icon-btn sp-header-tool-btn"
              onClick={() => {
                setDropZoneListStage(null);
                setShowStagesModal(true);
              }}
              title="파이프라인 단계 관리"
              aria-label="단계 관리"
            >
              <span className="material-symbols-outlined">tune</span>
              <span className="sp-header-btn-label">단계 관리</span>
            </button>
          </div>
          <button
            type="button"
            className="sp-header-icon-btn sp-header-tool-btn"
            onClick={openExcelImportModal}
            title="엑셀 파일을 매핑하여 영업기회 일괄 등록"
            aria-label="엑셀 매핑 가져오기"
          >
            <span className="material-symbols-outlined">upload_file</span>
            <span className="sp-header-btn-label">엑셀 가져오기</span>
          </button>
          <button type="button" className="sp-add-btn" onClick={() => openAddModal()}>
            <span className="material-symbols-outlined">add</span>
            영업기회 추가
          </button>
          <PageHeaderNotifyChat buttonClassName="sp-header-icon-btn" wrapperClassName="sp-header-quick" />
        </div>
      </header>

      <div className="sp-pipeline-body-filters" role="region" aria-label="목록 필터">
        <div className="sp-header-filters">
          <label className="sp-filter-label">
            <span className="sp-filter-label-text">연도</span>
            <select
              className="sp-filter-select"
              value={filterYear}
              onChange={(e) => {
                const v = e.target.value;
                setFilterYear(v);
                if (!v) {
                  setFilterMonth('');
                  setFilterScheduleField(PIPELINE_SCHEDULE_FIELD_FILTER_DEFAULT);
                }
              }}
              aria-label="연도별 필터(아래 일정 기준·기본 시작일)"
            >
              <option value="">전체</option>
              {pipelineYearOptions.map((yr) => (
                <option key={yr} value={String(yr)}>
                  {yr}년
                </option>
              ))}
            </select>
          </label>
          <label className="sp-filter-label">
            <span className="sp-filter-label-text">월</span>
            <select
              className="sp-filter-select"
              value={filterMonth}
              disabled={!filterYear}
              onChange={(e) => setFilterMonth(e.target.value)}
              aria-label="월별 필터(연도 선택 시 활성)"
            >
              <option value="">전체</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={String(m)}>
                  {m}월
                </option>
              ))}
            </select>
          </label>
          <label className="sp-filter-label">
            <span className="sp-filter-label-text">일정 기준</span>
            <select
              className="sp-filter-select"
              value={filterScheduleField}
              disabled={!filterYear}
              onChange={(e) => setFilterScheduleField(e.target.value)}
              title="시작일 기준(비어 있으면 계약일→등록일): 선택 연·월 상한 이전·당일까지 모두 표시. Won은 칸반 하단 «수주 성공»."
              aria-label="연도·월 구간을 적용할 일정 필드(기본 시작일·누적)"
            >
              {PIPELINE_SCHEDULE_FIELD_FILTER_OPTIONS.map((o) => (
                <option key={o.value || 'updatedAt'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="sp-filter-label">
            <span className="sp-filter-label-text">영업 담당</span>
            <details className="sp-filter-multi">
              <summary className="sp-filter-multi-summary" aria-label="영업 담당별 필터(복수 선택)">
                {assigneeFilterSummary}
              </summary>
              <div className="sp-filter-multi-panel">
                <button
                  type="button"
                  className="sp-filter-multi-reset"
                  onClick={selectAllFilterAssigneeIds}
                  aria-label="영업 담당 전체 선택"
                >
                  전체 선택
                </button>
                {assigneesForSelect.map((emp) => {
                  const id = String(emp.id);
                  const base = (emp.name && String(emp.name).trim()) || emp.email || id;
                  const rowLabel = pipelineViewerId && id === pipelineViewerId ? `${base} (나)` : base;
                  return (
                    <label key={id} className="sp-filter-multi-row">
                      <input
                        type="checkbox"
                        checked={filterAssigneeIds.includes(id)}
                        onChange={() => toggleFilterAssigneeId(id)}
                      />
                      <span>{rowLabel}</span>
                    </label>
                  );
                })}
              </div>
            </details>
          </label>
          <label className="sp-filter-label">
            <span className="sp-filter-label-text">제품</span>
            <details className="sp-filter-multi">
              <summary className="sp-filter-multi-summary" aria-label="제품별 필터(복수 선택)">
                {productFilterSummary}
              </summary>
              <div className="sp-filter-multi-panel">
                <button
                  type="button"
                  className="sp-filter-multi-reset"
                  onClick={selectAllFilterProductIds}
                  aria-label="제품 전체 선택"
                >
                  전체 선택
                </button>
                {productFilterOptions.map((p) => {
                  const id = String(p._id);
                  const rowLabel = (p.name && String(p.name).trim()) || p.code || id;
                  return (
                    <label key={id} className="sp-filter-multi-row">
                      <input
                        type="checkbox"
                        checked={filterProductIds.includes(id)}
                        onChange={() => toggleFilterProductId(id)}
                      />
                      <span>{rowLabel}</span>
                    </label>
                  );
                })}
              </div>
            </details>
          </label>
        </div>
      </div>

      {listMeta?.listCapped ? (
        <div className="sp-list-cap-notice" role="status">
          전체 {Number(listMeta.totalOpportunities || 0).toLocaleString()}건 중 최신{' '}
          {Number(listMeta.displayedOpportunities || 0).toLocaleString()}건만 표시됩니다. 검색으로 범위를 좁혀 주세요.
        </div>
      ) : null}
      {!canViewAdminContent ? (
        <div className="sp-senior-only-notice" role="status">
          기회 금액은 관리자·대표만 표시됩니다.
        </div>
      ) : null}

      {/* Kanban Board */}
      {loading ? (
        <div className="sp-loading">
          <span className="material-symbols-outlined sp-spin">progress_activity</span>
          로딩 중...
        </div>
      ) : (
        <>
          {pipelineViewMode === 'kanban' ? (
            <>
              <section className="sp-mobile-chips-wrap sp-mobile-only" aria-label="단계 필터">
                <div className="sp-mobile-chips" role="tablist">
                  {boardStages.map((stage) => (
                    <button
                      key={`mchip-${stage}`}
                      type="button"
                      role="tab"
                      aria-selected={activeMobileStage === stage}
                      className={`sp-mobile-chip ${activeMobileStage === stage ? 'is-active' : ''}`}
                      onClick={() => setMobileListStage(stage)}
                    >
                      {stageLabels[stage] ?? stage}
                    </button>
                  ))}
                </div>
              </section>

              <section className="sp-mobile-deals sp-mobile-only" aria-live="polite">
                <div className="sp-mobile-deals-head">
                  <p className="sp-mobile-deals-head-label">
                    {stageLabels[activeMobileStage] ?? activeMobileStage} ({mobileStageItems.length})
                    {mobileForecastSum != null ? (
                      <span className="sp-mobile-deals-forecast-expected">
                        {' '}
                        · 예상{' '}
                        <PriceWithKrwHint
                          amount={mobileForecastSum}
                          currency={mobileColCurrency}
                          dealBasRMap={dealBasRMap}
                        />
                      </span>
                    ) : null}
                  </p>
                  <span className="material-symbols-outlined" style={{ fontSize: '1rem', color: '#acb3b4' }} aria-hidden>
                    sort
                  </span>
                </div>
                {mobileStageItems.length === 0 ? (
                  <p className="sp-mobile-empty">이 단계에 표시할 기회가 없습니다.</p>
                ) : (
                  <div className="sp-mobile-deals-list sp-mobile-deals-list--table">
                    {mobileStageItems.map((opp, i) => {
                      const pillClass = `sp-mobile-deal-pill--${i % 3}`;
                      const pillText = (opp.productName && String(opp.productName).trim()) || '기회';
                      const primary = dealTitlePrimaryLabel(opp);
                      const isPersonalNoCompany =
                        !(opp.customerCompanyName && String(opp.customerCompanyName).trim()) &&
                        !!(opp.contactName && String(opp.contactName).trim());
                      const sub = isPersonalNoCompany
                        ? (opp.productName && String(opp.productName).trim()) ||
                        (opp.title && String(opp.title).trim()) ||
                        '—'
                        : (opp.contactName && String(opp.contactName).trim()) ||
                        (opp.title && String(opp.title).trim()) ||
                        '—';
                      return (
                        <div
                          key={opp._id}
                          className={`sp-card sp-mobile-deal-card${String(stagePatchingId) === String(opp._id) ? ' sp-card--stage-patching' : ''}`}
                          draggable={String(stagePatchingId) !== String(opp._id)}
                          onDragStart={(e) => handleDragStart(e, opp._id)}
                          onDragEnd={handleDragEnd}
                          onClick={() => openEditModal(opp._id)}
                        >
                          <div className="sp-mobile-deal-top">
                            <div>
                              <h3 className="sp-mobile-deal-title">
                                {[primary, opp.title].filter(Boolean).join(' · ') || '—'}
                              </h3>
                              <p className="sp-mobile-deal-sub">{sub}</p>
                            </div>
                            <span className={`sp-mobile-deal-pill ${pillClass}`}>{pillText}</span>
                          </div>
                          {renderOppScheduleDatesChips(opp)}
                          <div className="sp-mobile-deal-bottom">
                            <div className="sp-mobile-deal-owner">
                              <span className="sp-mobile-deal-avatar" aria-hidden>
                                {nameInitials(salesAssigneeDisplay(opp))}
                              </span>
                              <div className="sp-mobile-deal-owner-text">
                                <span className="sp-mobile-deal-assignee-label">영업 담당</span>
                                <span className="sp-mobile-deal-owner-name">
                                  {salesAssigneeDisplay(opp) || '미지정'}
                                </span>
                              </div>
                            </div>
                            <div className="sp-mobile-deal-value-wrap">
                              <p className="sp-mobile-deal-value">{renderOppValue(opp)}</p>
                              {canViewAdminContent
                                ? renderOppAdminCardFooter(opp, stageForecastPercent, dealBasRMap)
                                : null}
                            </div>
                          </div>
                          {canViewAdminContent ? (
                            <button
                              type="button"
                              className="sp-card-delete sp-mobile-deal-delete"
                              title="삭제"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(opp._id);
                              }}
                            >
                              <span className="material-symbols-outlined">close</span>
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

            </>
          ) : null}

          {pipelineViewMode === 'table' ? (
            <div className="sp-pipeline-table-view-root sp-board--table-view">
              <SalesPipelineTablePanel
                allOpportunities={allOpportunities}
                pipelineListTemplate={pipelineListTemplate}
                displayColumnKeys={pipelineDisplayColumnKeys}
                stageForecastPercent={stageForecastPercent}
                stageLabels={stageLabels}
                canViewAdminContent={canViewAdminContent}
                dealBasRMap={dealBasRMap}
                productDisplayMode={productDisplayMode}
                onOpenEdit={openEditModal}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onSaveColumnOrder={savePipelineTableColumnOrder}
                onPersistColumnWidths={savePipelineColumnWidths}
              />
            </div>
          ) : (
          <div className="sp-board">
              <div className="sp-board-desktop">
                <div className="sp-kanban">
                  {boardStages.map((stage) => {
                    const items = grouped[stage] || [];
                    const fp = stageForecastPercent[stage];
                    const forecastExpectedSum =
                      canViewAdminContent && Number.isFinite(fp) ? sumForecastExpectedAmount(items, fp) : null;
                    const colCurrency = firstOppCurrency(items);
                    return (
                      <div
                        key={`col-${stage}`}
                        className={`sp-kanban-col sp-kanban-col--${stageToneByKey[stage] || 'tone-0'}`}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, stage)}
                      >
                        <div className="sp-kanban-col-head">
                          <div className="sp-kanban-col-head-row">
                            <div className="sp-kanban-col-head-main">
                              <span className={`sp-kanban-dot ${stageToneByKey[stage] || 'tone-0'}`} aria-hidden />
                              <h3 className="sp-kanban-col-title">{stageLabels[stage] ?? stage}</h3>
                              <span className="sp-kanban-count">{items.length}</span>
                            </div>
                            <button
                              type="button"
                              className="sp-kanban-add"
                              title="이 단계에 추가"
                              onClick={() => openAddModal(stage)}
                              aria-label={`${stageLabels[stage] ?? stage}에 영업기회 추가`}
                            >
                              <span className="material-symbols-outlined">add</span>
                            </button>
                          </div>
                          {stageForecastPercent[stage] != null || forecastExpectedSum != null ? (
                            <div className="sp-kanban-col-head-meta">
                              {stageForecastPercent[stage] != null ? (
                                <span className="sp-kanban-forecast" title="Forecast (expected probability)">
                                  Forecast {stageForecastPercent[stage]}%
                                </span>
                              ) : (
                                <span className="sp-kanban-forecast-spacer" aria-hidden />
                              )}
                              {forecastExpectedSum != null ? (
                                <span
                                  className="sp-kanban-forecast-expected"
                                  title={`이 단계 카드 금액 합 × Forecast ${fp}%`}
                                >
                                  예상 매출{' '}
                                  <PriceWithKrwHint
                                    amount={forecastExpectedSum}
                                    currency={colCurrency}
                                    dealBasRMap={dealBasRMap}
                                  />
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="sp-kanban-list-panel">
                          <div className="sp-kanban-cards" role="list">
                            {items.length === 0 ? (
                              <div className="sp-kanban-empty" aria-hidden>
                                카드를 여기로 드래그하세요
                              </div>
                            ) : (
                              items.map((opp) => renderDesktopKanbanLucidCard(opp))
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            {/* Drop Zones — Won / Lost / 보류 */}
              <div className="sp-dropzones-section">
                <div className="sp-dropzones">
                  {Object.entries(DROP_ZONE_CONFIG).map(([stage, cfg]) => {
                    const items = grouped[stage] || [];
                    const dzFp = stageForecastPercent[stage];
                    const dzForecastSum =
                      canViewAdminContent && Number.isFinite(dzFp) ? sumForecastExpectedAmount(items, dzFp) : null;
                    const dzCurrency = firstOppCurrency(items);
                    return (
                      <div key={stage} className="sp-dz-wrapper">
                        <div
                          className={`sp-dropzone ${cfg.colorClass}`}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, stage)}
                          onClick={() => items.length > 0 && setDropZoneListStage(stage)}
                          style={{ cursor: items.length > 0 ? 'pointer' : 'default' }}
                        >
                          <span className="material-symbols-outlined sp-dz-icon sp-dz-icon--fill">{cfg.icon}</span>
                          <span className="sp-dz-label-wrap">
                            <span className="sp-dz-label">{cfg.label}</span>
                            {Number.isFinite(stageForecastPercent[stage]) ? (
                              <span className="sp-dz-forecast" title="Forecast (expected probability)">
                                Forecast {stageForecastPercent[stage]}%
                              </span>
                            ) : null}
                            {dzForecastSum != null ? (
                              <span className="sp-dz-forecast-expected" title={`금액 합 × Forecast ${dzFp}%`}>
                                예상{' '}
                                <PriceWithKrwHint
                                  amount={dzForecastSum}
                                  currency={dzCurrency}
                                  dealBasRMap={dealBasRMap}
                                />
                              </span>
                            ) : null}
                          </span>
                          {items.length > 0 && (
                            <span className="sp-dz-count">
                              {items.length}건
                              <span className="material-symbols-outlined sp-dz-chevron" aria-hidden>
                                chevron_right
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
          </div>
          )}
        </>
      )}

      {!loading && (
        <button
          type="button"
          className="sp-mobile-fab"
          aria-label="영업기회 추가"
          onClick={() =>
            openAddModal(pipelineViewMode === 'kanban' ? activeMobileStage || undefined : undefined)
          }
        >
          <span className="material-symbols-outlined">add</span>
        </button>
      )}

      <SalesPipelineExcelImportModal
        open={excelImportOpen}
        onClose={closeExcelImportModal}
        onImported={() => {
          void fetchData({ silent: true });
        }}
      />

      {/* 기회 모달 */}
      {isModalOpen && (
        <OpportunityModal
          mode={modalMode}
          oppId={editOppId}
          defaultStage={defaultStage}
          stageOptions={boardStages.map((key) => ({ value: key, label: stageLabels[key] ?? key })).concat(
            [{ value: 'Won', label: '수주 성공' }],
            [{ value: 'Lost', label: '기회 상실' }, { value: 'Abandoned', label: '보류' }]
          )}
          onClose={closeModal}
          onSaved={handleOpportunitySaved}
          onSwitchToEditAfterCreate={openEditModal}
        />
      )}
      {/* 단계 관리 모달 */}
      {showStagesModal && (
        <PipelineStagesManageModal
          onClose={() => setShowStagesModal(false)}
          onSaved={() => { fetchStageDefinitions(); fetchData(); }}
        />
      )}

      {pipelineListSettingsOpen ? (
        <ListTemplateModal
          listId={SALES_PIPELINE_LIST_ID}
          titleText="표·칸반 표시 항목"
          hintText="표 보기와 칸반 카드에 동일하게 적용됩니다. 항목을 선택하고 왼쪽 핸들을 드래그해 순서를 바꿀 수 있습니다. 각 열 아래에서 셀 글자 스타일을 지정할 수 있습니다."
          columns={pipelineListTemplate.columns}
          visible={pipelineListTemplate.visible}
          columnOrder={pipelineListTemplate.columnOrder}
          columnCellStyles={pipelineListTemplate.columnCellStyles}
          onSave={savePipelineListTemplate}
          onReset={resetPipelineListTemplate}
          onClose={() => setPipelineListSettingsOpen(false)}
        />
      ) : null}

      {/* 결과 드롭존(Won/Lost/보류) 기회 목록 모달 */}
      {dropZoneModalCfg && dropZoneListStage ? (
        <DropZoneListModal
          stageKey={dropZoneListStage}
          modalCfg={dropZoneModalCfg}
          forecastPercent={stageForecastPercent[dropZoneListStage]}
          items={dropZoneModalItems}
          suppressEscapeClose={isModalOpen}
          onClose={() => setDropZoneListStage(null)}
          onOpenEdit={openEditModal}
          canViewAdminContent={canViewAdminContent}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        />
      ) : null}
    </div>
  );
}
