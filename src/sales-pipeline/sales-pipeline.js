import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import OpportunityModal from './opportunity-modal/opportunity-modal';
import PipelineStagesManageModal from './pipeline-stages-manage-modal/pipeline-stages-manage-modal';
import DropZoneListModal from './drop-zone-list-modal/drop-zone-list-modal';
import './sales-pipeline.css';
import './sales-pipeline-responsive.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';

import { API_BASE } from '@/config';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import { getSavedTemplate, patchListTemplate, LIST_IDS } from '@/lib/list-templates';
import { buildStageForecastPercentMap } from './pipeline-forecast-utils';

const SALES_PIPELINE_LIST_ID = LIST_IDS.SALES_PIPELINE;
const MODAL_PARAM = 'oppModal';
const MODAL_ADD = 'add';
const MODAL_EDIT = 'edit';
const OPP_ID_PARAM = 'oppId';
const STAGE_PARAM = 'stage';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const DEFAULT_STAGE_LABELS = {
  NewLead: '신규 리드',
  Contacted: '연락 완료',
  ProposalSent: '제안서 전달 완료',
  TechDemo: '기술 시연',
  Quotation: '견적',
  Negotiation: '최종 협상',
  Won: '수주 성공'
};
const DEFAULT_ACTIVE_STAGES = [
  'NewLead',
  'Contacted',
  'ProposalSent',
  'TechDemo',
  'Quotation',
  'Negotiation',
  'Won'
];

const DROP_ZONE_CONFIG = {
  Won: { icon: 'check_circle', label: '수주 성공 (Won)', colorClass: 'dz-green' },
  Lost: { icon: 'cancel', label: '기회 상실 (Lost)', colorClass: 'dz-red' },
  Abandoned: { icon: 'pause_circle', label: '보류 (On Hold)', colorClass: 'dz-blue' }
};

/** 샘플 카드 상단 태그 — 제품명 일부 또는 플레이스홀더 */
function getCardTagText(opp, index) {
  const p = opp.productName && String(opp.productName).trim();
  if (p) {
    const u = p.toUpperCase();
    return u.length > 12 ? `${u.slice(0, 10)}…` : u;
  }
  return ['DEAL', 'PIPELINE', 'GROWTH', 'FOCUS'][index % 4];
}

function cardSubtitleLine(opp) {
  const product = opp.productName && String(opp.productName).trim();
  if (product) return product;
  const t = opp.title && String(opp.title).trim();
  if (t) return t;
  return '—';
}

function formatCurrency(value, currency) {
  if (!value && value !== 0) return currency === 'KRW' ? '₩0' : '$0';
  if (currency === 'USD') return '$' + Number(value).toLocaleString();
  if (currency === 'JPY') return '¥' + Number(value).toLocaleString();
  return '₩' + Number(value).toLocaleString();
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

function renderOppNetMargin(opp) {
  const m = computeOppNetMargin(opp);
  if (m == null) return null;
  return (
    <div className="sp-card-net-margin" aria-label="순마진">
      <span className="sp-card-net-margin-label">순마진</span>
      <span className="sp-card-net-margin-value">{formatCurrency(m, opp.currency)}</span>
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

/** 고객사가 없는 개인구매면 연락처(담당자) 이름, 아니면 고객사명 */
function dealTitlePrimaryLabel(opp) {
  const company = opp.customerCompanyName && String(opp.customerCompanyName).trim();
  const contact = opp.contactName && String(opp.contactName).trim();
  if (!company && contact) return contact;
  return company || '';
}

export default function SalesPipeline() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [grouped, setGrouped] = useState({});
  const [totals, setTotals] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dragId, setDragId] = useState(null);
  /** Won / Lost / Abandoned 결과 구역 클릭 시 목록 모달 (인라인 펼침 대신) */
  const [dropZoneListStage, setDropZoneListStage] = useState(null);
  const searchTimer = useRef(null);
  const [healthPinged, setHealthPinged] = useState(false);
  const [listMeta, setListMeta] = useState(null);
  const [stageDefinitions, setStageDefinitions] = useState([]);
  const [showStagesModal, setShowStagesModal] = useState(false);
  /** 모바일: 칩으로 선택한 파이프라인 단계(해당 단계 카드만 목록 표시) */
  const [mobileListStage, setMobileListStage] = useState(null);
  /** 고객사/연락처와 동일: listTemplates.salesPipeline.assigneeMeOnly 로 «내 기회만» 필터 저장 */
  const [mineOnly, setMineOnly] = useState(() => getSavedTemplate(SALES_PIPELINE_LIST_ID)?.assigneeMeOnly === true);
  /** 목록 API: productId, assignedTo 쿼리 (빈 값 = 필터 없음) */
  const [filterProductId, setFilterProductId] = useState('');
  const [filterAssigneeId, setFilterAssigneeId] = useState('');
  const [productFilterOptions, setProductFilterOptions] = useState([]);
  const [assigneeFilterOptions, setAssigneeFilterOptions] = useState([]);

  const modalMode = searchParams.get(MODAL_PARAM);
  const editOppId = searchParams.get(OPP_ID_PARAM);
  const defaultStage = searchParams.get(STAGE_PARAM);
  const isModalOpen = modalMode === MODAL_ADD || modalMode === MODAL_EDIT;

  const openAddModal = (stage) => {
    setDropZoneListStage(null);
    const p = new URLSearchParams(searchParams);
    p.set(MODAL_PARAM, MODAL_ADD);
    if (stage) p.set(STAGE_PARAM, stage);
    setSearchParams(p);
  };

  const openEditModal = (id) => {
    setDropZoneListStage(null);
    const p = new URLSearchParams(searchParams);
    p.set(MODAL_PARAM, MODAL_EDIT);
    p.set(OPP_ID_PARAM, id);
    setSearchParams(p);
  };

  const closeModal = () => {
    const p = new URLSearchParams(searchParams);
    p.delete(MODAL_PARAM);
    p.delete(OPP_ID_PARAM);
    p.delete(STAGE_PARAM);
    setSearchParams(p, { replace: true });
  };

  const fetchData = useCallback(async (opts) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (mineOnly) params.set('createdByMe', '1');
      const fp = (filterProductId || '').trim();
      if (fp) params.set('productId', fp);
      const fa = (filterAssigneeId || '').trim();
      if (fa) params.set('assignedTo', fa);
      const res = await fetch(`${API_BASE}/sales-opportunities?${params}`, { headers: getAuthHeader() });
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
  }, [search, mineOnly, filterProductId, filterAssigneeId]);

  const fetchStageDefinitions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=salesPipelineStage`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) setStageDefinitions(data.items);
      else setStageDefinitions([]);
    } catch {
      setStageDefinitions([]);
    }
  }, []);

  useEffect(() => {
    fetchStageDefinitions();
  }, [fetchStageDefinitions]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pres, ores] = await Promise.all([
          fetch(`${API_BASE}/products?productPicker=1&limit=500`, { headers: getAuthHeader() }),
          fetch(`${API_BASE}/companies/overview`, { headers: getAuthHeader() })
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
      fetch(`${API_BASE}/health`).finally(() => setHealthPinged(true));
      return;
    }
    fetchData();
  }, [fetchData, healthPinged]);

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

  const toggleMineOnly = useCallback(() => {
    const prev = mineOnly;
    const next = !mineOnly;
    setMineOnly(next);
    patchListTemplate(SALES_PIPELINE_LIST_ID, { assigneeMeOnly: next }).catch((err) => {
      window.alert(err?.message || '저장에 실패했습니다.');
      setMineOnly(prev);
    });
  }, [mineOnly]);

  const setMineOnlyFromChip = useCallback(
    (next) => {
      if (next === mineOnly) return;
      const prev = mineOnly;
      setMineOnly(next);
      patchListTemplate(SALES_PIPELINE_LIST_ID, { assigneeMeOnly: next }).catch((err) => {
        window.alert(err?.message || '저장에 실패했습니다.');
        setMineOnly(prev);
      });
    },
    [mineOnly]
  );

  /* ---- Drag & Drop ---- */
  const handleDragStart = (e, id) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    e.currentTarget.classList.add('sp-card-dragging');
  };

  const handleDragEnd = (e) => {
    e.currentTarget.classList.remove('sp-card-dragging');
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

  const handleDrop = async (e, targetStage) => {
    e.preventDefault();
    e.currentTarget.classList.remove('sp-drop-hover');
    const rawId = e.dataTransfer.getData('text/plain') || dragId;
    const id = rawId != null ? String(rawId) : '';
    if (!id) return;

    // optimistic update (Mongo _id는 문자열/ObjectId 혼재 가능 — 엄격 비교 방지)
    const prev = { ...grouped };
    const newGrouped = {};
    let movedItem = null;
    let fromStage = null;
    for (const [stage, items] of Object.entries(prev)) {
      newGrouped[stage] = items.filter((i) => {
        if (String(i._id) === id) {
          fromStage = stage;
          movedItem = { ...i, stage: targetStage };
          return false;
        }
        return true;
      });
    }
    if (movedItem) {
      if (!newGrouped[targetStage]) newGrouped[targetStage] = [];
      newGrouped[targetStage] = [movedItem, ...newGrouped[targetStage]];
      setGrouped(newGrouped);
      // recalc totals
      const newTotals = {};
      for (const [stage, items] of Object.entries(newGrouped)) {
        newTotals[stage] = items.reduce((s, o) => s + (o.value || 0), 0);
      }
      setTotals(newTotals);
    }

    try {
      const res = await fetch(`${API_BASE}/sales-opportunities/${id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ stage: targetStage })
      });
      if (!res.ok) throw new Error();
      const data = await res.json().catch(() => ({}));
      fetchData({ silent: true });
      if (fromStage === 'Won' && targetStage !== 'Won') {
        try {
          window.dispatchEvent(new CustomEvent('nexvia-crm-calendar-refresh'));
        } catch {
          /* ignore */
        }
      }
      if (targetStage === 'Won' && data.renewalCalendar) {
        const rc = data.renewalCalendar;
        if (rc.scheduled && (rc.eventStart || rc.noticeEventStart || rc.preReminderEventStart)) {
          try {
            window.dispatchEvent(new CustomEvent('nexvia-crm-calendar-refresh'));
          } catch {
            /* ignore */
          }
          const fmt = (iso) =>
            new Date(iso).toLocaleString('ko-KR', { dateStyle: 'long', timeStyle: 'short' });
          let msg = '회사 캘린더에 일정이 등록되었습니다.\n\n';
          if (rc.noticeEventStart) {
            msg += `· 수주 당일 안내(지금 보는 달에 표시): ${fmt(rc.noticeEventStart)}\n`;
          }
          if (rc.preReminderEventStart) {
            msg += `· 사전 알림(월간=갱신 3주 전 / 연간=갱신 1개월 전): ${fmt(rc.preReminderEventStart)}\n`;
          }
          if (rc.eventStart) {
            msg += `· 실제 갱신 알림(월간=1개월 후 / 연간=1년 후): ${fmt(rc.eventStart)}\n`;
          }
          msg += '\n캘린더는 «회사 일정» 탭에서 확인하세요. 열려 있으면 목록이 갱신됩니다.';
          window.alert(msg);
        } else if (rc.skipReason === 'no_product_id') {
          window.alert(
            '기회에 제품이 연결되어 있지 않아 갱신 일정을 등록하지 않았습니다. 기회 상세에서 제품을 선택한 뒤 다시 수주 성공으로 옮겨 주세요.'
          );
        } else if (rc.skipReason === 'not_subscription') {
          window.alert(
            '선택한 제품의 결제 주기가 월간/연간이 아니어 갱신 일정을 만들지 않았습니다. (영구 등은 제외)'
          );
        } else if (rc.skipReason === 'product_not_found') {
          window.alert('연결된 제품 정보를 찾을 수 없어 갱신 일정을 등록하지 못했습니다.');
        } else if (rc.skipReason === 'calendar_create_failed' || rc.skipReason === 'invalid_anchor') {
          window.alert(
            '갱신 일정 생성에 실패했습니다. 잠시 후 기회 상세에서 «갱신 캘린더» 확인을 눌러 다시 시도해 주세요.'
          );
        } else if (rc.skipReason === 'error' && rc.message) {
          window.alert(`갱신 일정 처리 중 오류: ${rc.message}`);
        } else if (!rc.scheduled && rc.skipReason) {
          window.alert(`갱신 일정이 등록되지 않았습니다. (${rc.skipReason})`);
        }
      }
    } catch {
      setGrouped(prev);
      fetchData();
    }
    setDragId(null);
  };

  const handleDelete = async (id) => {
    if (!isAdminOrAboveRole(getStoredCrmUser()?.role)) {
      window.alert('기회 삭제는 관리자(Admin) 이상만 가능합니다.');
      return;
    }
    if (!window.confirm('이 기회를 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`${API_BASE}/sales-opportunities/${id}`, { method: 'DELETE', headers: getAuthHeader() });
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
  const stageLabels = stageDefinitions.length > 0
    ? Object.fromEntries(stageDefinitions.map((d) => [d.key, d.label]))
    : DEFAULT_STAGE_LABELS;
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

  const totalPipelineValue = useMemo(
    () => boardStages.reduce((sum, st) => sum + (Number(totals[st]) || 0), 0),
    [boardStages, totals]
  );

  const winRatePercent = useMemo(() => {
    const w = (grouped.Won || []).length;
    const l = (grouped.Lost || []).length;
    if (w + l === 0) return null;
    return Math.round((100 * w) / (w + l));
  }, [grouped]);

  /** 관리자·대표: 금액·단계 관리·기회 삭제 등 (Manager 제외) */
  const canViewAdminContent = isAdminOrAboveRole(getStoredCrmUser()?.role);

  const formatOppValue = (opp) => {
    if (!canViewAdminContent) return '—';
    return formatCurrency(opp.value, opp.currency);
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

  return (
    <div className="sp-container">
      {/* Header */}
      <header className="sp-header">
        <div className="sp-header-brand">
          <h2 className="sp-title">세일즈 현황</h2>
          <div className="sp-search-wrap">
            <span className="material-symbols-outlined sp-search-icon">search</span>
            <input className="sp-search" type="text" placeholder="기회 검색..." value={search} onChange={onSearchInput} aria-label="기회 검색" />
          </div>
          <div className="sp-header-filters" role="group" aria-label="목록 필터">
            <label className="sp-filter-label">
              <span className="sp-filter-label-text">제품</span>
              <select
                className="sp-filter-select"
                value={filterProductId}
                onChange={(e) => setFilterProductId(e.target.value)}
                aria-label="제품별 필터"
              >
                <option value="">전체</option>
                {productFilterOptions.map((p) => (
                  <option key={p._id} value={p._id}>
                    {(p.name && String(p.name).trim()) || p.code || String(p._id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="sp-filter-label">
              <span className="sp-filter-label-text">담당</span>
              <select
                className="sp-filter-select"
                value={filterAssigneeId}
                onChange={(e) => setFilterAssigneeId(e.target.value)}
                aria-label="사내 담당자별 필터"
              >
                <option value="">전체</option>
                {assigneeFilterOptions
                  .filter((emp) => emp?.id != null && String(emp.id).trim() !== '')
                  .map((emp) => (
                    <option key={String(emp.id)} value={String(emp.id)}>
                      {(emp.name && String(emp.name).trim()) || emp.email || String(emp.id)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </div>
        <div className="sp-header-right">
          <button
            type="button"
            className={`icon-btn sp-assignee-filter-btn ${mineOnly ? 'active' : ''}`}
            onClick={toggleMineOnly}
            title={mineOnly ? '전체 기회 보기' : '내 기회만 보기'}
            aria-label={mineOnly ? '전체 기회 보기' : '내 기회만 보기'}
          >
            <span className="material-symbols-outlined">person_pin_circle</span>
            <span className="sp-assignee-filter-label">내 기회만 보기</span>
          </button>
          <button type="button" className="sp-add-btn" onClick={() => openAddModal()}>
            <span className="material-symbols-outlined">add</span>
            기회 추가
          </button>
          {canViewAdminContent ? (
            <button type="button" className="sp-header-icon-btn" onClick={() => { setDropZoneListStage(null); setShowStagesModal(true); }} title="파이프라인 단계 관리" aria-label="단계 관리">
              <span className="material-symbols-outlined">tune</span>
            </button>
          ) : null}
          <PageHeaderNotifyChat buttonClassName="sp-header-icon-btn" wrapperClassName="sp-header-quick" />
        </div>
      </header>

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
          <section className="sp-mobile-hero sp-mobile-only" aria-label="파이프라인 요약">
            <h2 className="sp-mobile-hero-title">세일즈 파이프라인</h2>
            <p className="sp-mobile-hero-desc">진행 중인 기회를 단계별로 관리합니다</p>
            <div className="sp-mobile-bento">
              <div className="sp-mobile-bento-card sp-mobile-bento-card--mint">
                <span className="material-symbols-outlined" aria-hidden>payments</span>
                <div>
                  <p className="sp-mobile-bento-label">파이프라인 합계</p>
                  <p className="sp-mobile-bento-value">
                    {canViewAdminContent
                      ? formatCurrency(totalPipelineValue, (grouped[boardStages[0]] || [])[0]?.currency || 'KRW')
                      : '—'}
                  </p>
                </div>
              </div>
              <div className="sp-mobile-bento-card sp-mobile-bento-card--lavender">
                <span className="material-symbols-outlined" aria-hidden>trending_up</span>
                <div>
                  <p className="sp-mobile-bento-label">수주 승률</p>
                  <p className="sp-mobile-bento-value">
                    {winRatePercent != null ? `${winRatePercent}%` : '—'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="sp-mobile-mine-wrap sp-mobile-only" aria-label="등록자 필터">
            <div className="sp-mobile-mine-chips" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={!mineOnly}
                className={`sp-mobile-mine-chip ${!mineOnly ? 'is-active' : ''}`}
                onClick={() => setMineOnlyFromChip(false)}
              >
                전체
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mineOnly}
                className={`sp-mobile-mine-chip ${mineOnly ? 'is-active' : ''}`}
                onClick={() => setMineOnlyFromChip(true)}
              >
                내 기회
              </button>
            </div>
          </section>

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
                    · 예상 {formatCurrency(mobileForecastSum, mobileColCurrency)}
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
              <div className="sp-mobile-deals-list">
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
                      className="sp-card sp-mobile-deal-card"
                      draggable
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
                      <div className="sp-mobile-deal-bottom">
                        <div className="sp-mobile-deal-owner">
                          <span className="sp-mobile-deal-avatar" aria-hidden>
                            {nameInitials(opp.assignedToName)}
                          </span>
                          <span className="sp-mobile-deal-owner-name">{opp.assignedToName || '담당 미지정'}</span>
                        </div>
                        <div className="sp-mobile-deal-value-wrap">
                          <p className="sp-mobile-deal-value">{formatOppValue(opp)}</p>
                          {canViewAdminContent ? renderOppNetMargin(opp) : null}
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
                      className="sp-kanban-col"
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, stage)}
                    >
                      <div className="sp-kanban-col-head">
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
                          aria-label={`${stageLabels[stage] ?? stage}에 기회 추가`}
                        >
                          <span className="material-symbols-outlined">add</span>
                        </button>
                      </div>
                      {stageForecastPercent[stage] != null ? (
                        <p className="sp-kanban-forecast" title="Forecast (expected probability)">
                          Forecast {stageForecastPercent[stage]}%
                        </p>
                      ) : null}
                      {forecastExpectedSum != null ? (
                        <p
                          className="sp-kanban-forecast-expected"
                          title={`이 단계 카드 금액 합 × Forecast ${fp}%`}
                        >
                          예상 매출 {formatCurrency(forecastExpectedSum, colCurrency)}
                        </p>
                      ) : null}
                      <div className="sp-kanban-cards">
                        {items.length === 0 ? (
                          <div className="sp-kanban-empty" aria-hidden>
                            카드를 여기로 드래그하세요
                          </div>
                        ) : (
                          items.map((opp, ci) => {
                            const primary = dealTitlePrimaryLabel(opp) || '—';
                            const sub = cardSubtitleLine(opp);
                            return (
                              <div
                                key={opp._id}
                                className="sp-card sp-card--lucid"
                                draggable
                                onDragStart={(e) => handleDragStart(e, opp._id)}
                                onDragEnd={handleDragEnd}
                                onClick={() => openEditModal(opp._id)}
                              >
                                <div className="sp-card-lucid-top">
                                  <span className={`sp-card-tag sp-card-tag--${ci % 4}`}>{getCardTagText(opp, ci)}</span>
                                  {canViewAdminContent ? (
                                    <button
                                      type="button"
                                      className="sp-card-more"
                                      title="삭제"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDelete(opp._id);
                                      }}
                                    >
                                      <span className="material-symbols-outlined">more_horiz</span>
                                    </button>
                                  ) : null}
                                </div>
                                <h4 className="sp-card-lucid-title">{primary}</h4>
                                <p className="sp-card-lucid-sub">{sub}</p>
                                {opp.contactName && primary !== String(opp.contactName).trim() ? (
                                  <p className="sp-card-lucid-contact">{opp.contactName}</p>
                                ) : null}
                                <div className="sp-card-lucid-footer">
                                  <div className="sp-card-lucid-footer-left">
                                    <span className="sp-card-lucid-value">{formatOppValue(opp)}</span>
                                    {canViewAdminContent ? renderOppNetMargin(opp) : null}
                                  </div>
                                  <span className="sp-card-lucid-avatar" title={opp.assignedToName || ''} aria-hidden>
                                    {nameInitials(opp.assignedToName)}
                                  </span>
                                </div>
                              </div>
                            );
                          })
                        )}
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
                            예상 {formatCurrency(dzForecastSum, dzCurrency)}
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
        </>
      )}

      {!loading && (
        <button
          type="button"
          className="sp-mobile-fab"
          aria-label="기회 추가"
          onClick={() => openAddModal(activeMobileStage || undefined)}
        >
          <span className="material-symbols-outlined">add</span>
        </button>
      )}

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
          onSaved={fetchData}
        />
      )}
      {/* 단계 관리 모달 */}
      {showStagesModal && (
        <PipelineStagesManageModal
          onClose={() => setShowStagesModal(false)}
          onSaved={() => { fetchStageDefinitions(); fetchData(); }}
        />
      )}

      {/* 결과 드롭존(Won/Lost/보류) 기회 목록 모달 */}
      {dropZoneModalCfg && dropZoneListStage ? (
        <DropZoneListModal
          stageKey={dropZoneListStage}
          modalCfg={dropZoneModalCfg}
          forecastPercent={stageForecastPercent[dropZoneListStage]}
          items={dropZoneModalItems}
          onClose={() => setDropZoneListStage(null)}
          onOpenEdit={openEditModal}
          onDelete={handleDelete}
          canViewAdminContent={canViewAdminContent}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          formatOppValue={formatOppValue}
          dealTitlePrimaryLabel={dealTitlePrimaryLabel}
          renderOppNetMargin={renderOppNetMargin}
        />
      ) : null}
    </div>
  );
}
