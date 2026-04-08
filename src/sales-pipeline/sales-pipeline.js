import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import OpportunityModal from './opportunity-modal/opportunity-modal';
import PipelineStagesManageModal from './pipeline-stages-manage-modal/pipeline-stages-manage-modal';
import './sales-pipeline.css';
import './sales-pipeline-responsive.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';

import { API_BASE } from '@/config';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
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
  ProposalSent: '제안서 발송',
  Negotiation: '최종 협상',
  Won: '수주 성공'
};
const DEFAULT_ACTIVE_STAGES = ['NewLead', 'Contacted', 'ProposalSent', 'Negotiation', 'Won'];

const DROP_ZONE_CONFIG = {
  Won: { icon: 'emoji_events', label: '수주 성공', colorClass: 'dz-green' },
  Lost: { icon: 'cancel', label: '기회 상실', colorClass: 'dz-red' },
  Abandoned: { icon: 'archive', label: '보류', colorClass: 'dz-blue' }
};

function formatCurrency(value, currency) {
  if (!value) return currency === 'KRW' ? '₩0' : '$0';
  if (currency === 'USD') return '$' + value.toLocaleString();
  return '₩' + value.toLocaleString();
}

function nameInitials(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

export default function SalesPipeline() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [grouped, setGrouped] = useState({});
  const [totals, setTotals] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dragId, setDragId] = useState(null);
  const [expandedZone, setExpandedZone] = useState(null);
  const searchTimer = useRef(null);
  const [healthPinged, setHealthPinged] = useState(false);
  const [listMeta, setListMeta] = useState(null);
  const [stageDefinitions, setStageDefinitions] = useState([]);
  const [showStagesModal, setShowStagesModal] = useState(false);
  /** 모바일: 칩으로 선택한 파이프라인 단계(해당 단계 카드만 목록 표시) */
  const [mobileListStage, setMobileListStage] = useState(null);

  const modalMode = searchParams.get(MODAL_PARAM);
  const editOppId = searchParams.get(OPP_ID_PARAM);
  const defaultStage = searchParams.get(STAGE_PARAM);
  const isModalOpen = modalMode === MODAL_ADD || modalMode === MODAL_EDIT;

  const openAddModal = (stage) => {
    const p = new URLSearchParams(searchParams);
    p.set(MODAL_PARAM, MODAL_ADD);
    if (stage) p.set(STAGE_PARAM, stage);
    setSearchParams(p);
  };

  const openEditModal = (id) => {
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
  }, [search]);

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
            msg += `· 사전 알림(월간=갱신 2주 전 / 연간=갱신 1개월 전): ${fmt(rc.preReminderEventStart)}\n`;
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
  const stageToneByKey = useMemo(() => {
    const tone = {};
    boardStages.forEach((stage, idx) => {
      tone[stage] = `tone-${idx % 5}`;
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

  return (
    <div className="sp-container">
      {/* Header */}
      <header className="sp-header">
        <div className="sp-header-left">
          <h2 className="sp-title">세일즈 현황</h2>
          {canViewAdminContent ? (
            <button type="button" className="sp-stages-manage-btn" onClick={() => setShowStagesModal(true)} title="파이프라인 단계 관리">
              <span className="material-symbols-outlined">tune</span>
              단계 관리
            </button>
          ) : null}
        </div>
        <div className="sp-header-right">
          <div className="sp-search-wrap">
            <span className="material-symbols-outlined sp-search-icon">search</span>
            <input className="sp-search" type="text" placeholder="기회 검색..." value={search} onChange={onSearchInput} />
          </div>
          <button className="sp-add-btn" onClick={() => openAddModal()}>
            <span className="material-symbols-outlined">add</span>
            기회 추가
          </button>
          <PageHeaderNotifyChat buttonClassName="sp-quick-icon-btn" wrapperClassName="sp-header-quick" />
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
                  const sub =
                    (opp.contactName && String(opp.contactName).trim()) ||
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
                            {[opp.customerCompanyName, opp.title].filter(Boolean).join(' · ') || '—'}
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
                        <p className="sp-mobile-deal-value">{formatOppValue(opp)}</p>
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
              <div className="sp-stage-overview">
            {boardStages.map((stage, idx) => {
              const items = grouped[stage] || [];
              const total = totals[stage] || 0;
              const mainCurrency = items.length > 0 ? (items[0].currency || 'KRW') : 'KRW';
              return (
                <div
                  key={`overview-${stage}`}
                  className="sp-stage-overview-item"
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, stage)}
                >
                  <div className={`sp-stage-overview-card ${stageToneByKey[stage] || 'tone-0'}`}>
                    <span className="sp-stage-overview-title">{stageLabels[stage] ?? stage}</span>
                    <button className="sp-column-add" title="이 단계에 추가" onClick={() => openAddModal(stage)} aria-label="추가">
                      <span className="material-symbols-outlined">add</span>
                    </button>
                  </div>
                  <div className="sp-stage-overview-metrics">
                    <p>{items.length}</p>
                    <span>파이프라인 단계</span>
                  </div>
                  <div className={`sp-column-header ${stageToneByKey[stage] || 'tone-0'}`}>
                    <div className="sp-column-title-row">
                      <div className="sp-column-title-spacer" />
                    </div>
                  </div>
                  <div className="sp-cards sp-cards-inline">
                    {items.map((opp) => (
                      <div
                        key={opp._id}
                        className="sp-card"
                        draggable
                        onDragStart={(e) => handleDragStart(e, opp._id)}
                        onDragEnd={handleDragEnd}
                        onClick={() => openEditModal(opp._id)}
                      >
                        <div className="sp-card-top">
                          <h4 className="sp-card-title">{opp.customerCompanyName || '\u00A0'}-{opp.title || '\u00A0'}</h4>
                          <div className="sp-card-top-right">
                            <span className="sp-card-value">{formatOppValue(opp)}</span>
                            {canViewAdminContent ? (
                              <button className="sp-card-delete" title="삭제" onClick={(e) => { e.stopPropagation(); handleDelete(opp._id); }}>
                                <span className="material-symbols-outlined">close</span>
                              </button>
                            ) : null}
                          </div>
                        </div>
                        {opp.contactName && <p className="sp-card-contact">{opp.contactName}</p>}
                        <div className="sp-card-bottom">
                          <span className="sp-card-assignee">{opp.assignedToName || '\u00A0'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {idx < boardStages.length - 1 && (
                    <span className="material-symbols-outlined sp-stage-overview-arrow" aria-hidden>chevron_right</span>
                  )}
                </div>
              );
            })}
              </div>
            </div>

          {/* Drop Zones - 항상 화면 하단에 고정 표시 */}
          <div className="sp-dropzones-section">
            <h3 className="sp-dropzones-title">
              <span className="sp-dz-title-desktop">Quick Actions / Drop Zones</span>
              <span className="sp-dz-title-mobile">빠른 처리 · 드롭 영역</span>
            </h3>
            <div className="sp-dropzones">
              {Object.entries(DROP_ZONE_CONFIG).map(([stage, cfg]) => {
                const items = grouped[stage] || [];
                const isExpanded = expandedZone === stage;
                return (
                  <div key={stage} className="sp-dz-wrapper">
                    <div
                      className={`sp-dropzone ${cfg.colorClass} ${isExpanded ? 'sp-dz-expanded' : ''}`}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, stage)}
                      onClick={() => items.length > 0 && setExpandedZone(isExpanded ? null : stage)}
                      style={{ cursor: items.length > 0 ? 'pointer' : 'default' }}
                    >
                      <span className="material-symbols-outlined sp-dz-icon">{cfg.icon}</span>
                      <span className="sp-dz-label">{cfg.label}</span>
                      {items.length > 0 && (
                        <span className="sp-dz-count">
                          {items.length}건
                          <span className="material-symbols-outlined sp-dz-chevron">
                            {isExpanded ? 'expand_less' : 'expand_more'}
                          </span>
                        </span>
                      )}
                    </div>
                    {isExpanded && items.length > 0 && (
                      <div className="sp-dz-items">
                        {items.map((opp) => (
                          <div
                            key={opp._id}
                            className={`sp-card sp-dz-card ${cfg.colorClass}`}
                            draggable
                            onDragStart={(e) => handleDragStart(e, opp._id)}
                            onDragEnd={handleDragEnd}
                            onClick={(e) => { e.stopPropagation(); openEditModal(opp._id); }}
                          >
                            <div className="sp-card-top">
                              <h4 className="sp-card-title">{opp.customerCompanyName || '\u00A0'}-{opp.title || '\u00A0'}</h4>
                              {canViewAdminContent ? (
                                <button className="sp-card-delete" title="삭제" onClick={(e) => { e.stopPropagation(); handleDelete(opp._id); }}>
                                  <span className="material-symbols-outlined">close</span>
                                </button>
                              ) : null}
                            </div>
                            <p className="sp-card-contact">{opp.contactName || '\u00A0'}</p>
                            <div className="sp-card-meta">
                              <span className="sp-card-value">{formatOppValue(opp)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
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
    </div>
  );
}
