import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import OpportunityModal from './opportunity-modal/opportunity-modal';
import PipelineStagesManageModal from './pipeline-stages-manage-modal/pipeline-stages-manage-modal';
import WonAllModal from './won-all-modal/won-all-modal';
import './sales-pipeline.css';

import { API_BASE } from '@/config';
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
  Contacted: '접촉 완료',
  ProposalSent: '제안서 발송'
};
const DEFAULT_ACTIVE_STAGES = ['NewLead', 'Contacted', 'ProposalSent'];

const DROP_ZONE_CONFIG = {
  Lost: { icon: 'cancel', label: '기회 상실', colorClass: 'dz-red' },
  Abandoned: { icon: 'archive', label: '보류', colorClass: 'dz-blue' },
  Won: { icon: 'verified', label: '수주 성공', colorClass: 'dz-green' }
};

const WON_STAGE = 'Won';
const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function isWithinOneMonth(opp) {
  const d = opp.updatedAt || opp.createdAt;
  if (!d) return true;
  return new Date(d).getTime() >= Date.now() - ONE_MONTH_MS;
}

function formatCurrency(value, currency) {
  if (!value) return currency === 'KRW' ? '₩0' : '$0';
  if (currency === 'USD') return '$' + value.toLocaleString();
  return '₩' + value.toLocaleString();
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
  const [stageDefinitions, setStageDefinitions] = useState([]);
  const [showStagesModal, setShowStagesModal] = useState(false);
  const [showWonAllModal, setShowWonAllModal] = useState(false);

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

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const res = await fetch(`${API_BASE}/sales-opportunities?${params}`, { headers: getAuthHeader() });
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      setGrouped(data.grouped || {});
      setTotals(data.totals || {});
    } catch {
      setGrouped({});
      setTotals({});
    } finally {
      setLoading(false);
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
    const id = e.dataTransfer.getData('text/plain') || dragId;
    if (!id) return;

    // optimistic update
    const prev = { ...grouped };
    const newGrouped = {};
    let movedItem = null;
    for (const [stage, items] of Object.entries(prev)) {
      newGrouped[stage] = items.filter((i) => {
        if (i._id === id) { movedItem = { ...i, stage: targetStage }; return false; }
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
    } catch {
      setGrouped(prev);
      fetchData();
    }
    setDragId(null);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('이 기회를 삭제하시겠습니까?')) return;
    try {
      await fetch(`${API_BASE}/sales-opportunities/${id}`, { method: 'DELETE', headers: getAuthHeader() });
      fetchData();
    } catch { /* ignore */ }
  };

  const activeStages = stageDefinitions.length > 0
    ? stageDefinitions.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((d) => d.key)
    : DEFAULT_ACTIVE_STAGES;
  const stageLabels = stageDefinitions.length > 0
    ? Object.fromEntries(stageDefinitions.map((d) => [d.key, d.label]))
    : DEFAULT_STAGE_LABELS;

  return (
    <div className="sp-container">
      {/* Header */}
      <header className="sp-header">
        <div className="sp-header-left">
          <h2 className="sp-title">세일즈 현황</h2>
          <button type="button" className="sp-stages-manage-btn" onClick={() => setShowStagesModal(true)} title="파이프라인 단계 관리">
            <span className="material-symbols-outlined">tune</span>
            단계 관리
          </button>
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
        </div>
      </header>

      {/* Kanban Board */}
      {loading ? (
        <div className="sp-loading">
          <span className="material-symbols-outlined sp-spin">progress_activity</span>
          로딩 중...
        </div>
      ) : (
        <div className="sp-board">
          <div className="sp-columns-scroll">
            <div className="sp-columns">
            {activeStages.map((stage) => {
              const items = grouped[stage] || [];
              const total = totals[stage] || 0;
              const mainCurrency = items.length > 0 ? (items[0].currency || 'KRW') : 'KRW';
              return (
                <div
                  key={stage}
                  className="sp-column"
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, stage)}
                >
                  <div className="sp-column-header">
                    <div className="sp-column-title-row">
                      <div className="sp-column-title-wrap">
                        <span className="sp-column-title">{stageLabels[stage] ?? stage}</span>
                        <span className="sp-column-count-pill">{items.length}</span>
                      </div>
                      <button className="sp-column-add" title="이 단계에 추가" onClick={() => openAddModal(stage)} aria-label="추가">
                        <span className="material-symbols-outlined">add</span>
                      </button>
                    </div>
                    <p className="sp-column-total">{formatCurrency(total, mainCurrency)}</p>
                  </div>
                  <div className="sp-cards">
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
                            <span className="sp-card-value">{formatCurrency(opp.value, opp.currency)}</span>
                            <button className="sp-card-delete" title="삭제" onClick={(e) => { e.stopPropagation(); handleDelete(opp._id); }}>
                              <span className="material-symbols-outlined">close</span>
                            </button>
                          </div>
                        </div>
                        {opp.contactName && <p className="sp-card-contact">{opp.contactName}</p>}
                        <div className="sp-card-bottom">
                          <span className="sp-card-assignee">{opp.assignedToName || '\u00A0'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            </div>
          </div>

          {/* Drop Zones - 항상 화면 하단에 고정 표시 */}
          <div className="sp-dropzones-section">
            <h3 className="sp-dropzones-title">Quick Actions / Drop Zones</h3>
            <div className="sp-dropzones">
              {Object.entries(DROP_ZONE_CONFIG).map(([stage, cfg]) => {
                const items = grouped[stage] || [];
                const isWon = stage === WON_STAGE;
                const recentWonItems = isWon ? items.filter(isWithinOneMonth) : items;
                const displayItems = isWon ? recentWonItems : items;
                const isExpanded = expandedZone === stage;
                return (
                  <div key={stage} className="sp-dz-wrapper">
                    <div
                      className={`sp-dropzone ${cfg.colorClass} ${isExpanded ? 'sp-dz-expanded' : ''} ${isWon ? 'sp-dropzone-won' : ''}`}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, stage)}
                      onClick={() => items.length > 0 && setExpandedZone(isExpanded ? null : stage)}
                      style={{ cursor: items.length > 0 ? 'pointer' : 'default' }}
                    >
                      {isWon ? (
                        <>
                          <div className="sp-dz-main-spacer" aria-hidden="true" />
                          <div className="sp-dz-main">
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
                          <div className="sp-dz-viewall-wrap">
                            <button type="button" className="sp-dz-viewall-header-btn" onClick={(e) => { e.stopPropagation(); setShowWonAllModal(true); }}>
                              전체보기 →
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
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
                        </>
                      )}
                    </div>
                    {isExpanded && items.length > 0 && (
                      <div className="sp-dz-items">
                        {displayItems.map((opp) => (
                          <div
                            key={opp._id}
                            className={`sp-card sp-dz-card ${cfg.colorClass} ${isWon ? 'sp-dz-card-locked' : ''}`}
                            draggable={!isWon}
                            onDragStart={isWon ? undefined : (e) => handleDragStart(e, opp._id)}
                            onDragEnd={isWon ? undefined : handleDragEnd}
                            onClick={(e) => { e.stopPropagation(); if (!isWon) openEditModal(opp._id); }}
                          >
                            <div className="sp-card-top">
                              <h4 className="sp-card-title">{opp.customerCompanyName || '\u00A0'}-{opp.title || '\u00A0'}</h4>
                              {!isWon && (
                                <button className="sp-card-delete" title="삭제" onClick={(e) => { e.stopPropagation(); handleDelete(opp._id); }}>
                                  <span className="material-symbols-outlined">close</span>
                                </button>
                              )}
                            </div>
                            <p className="sp-card-contact">{opp.contactName || '\u00A0'}</p>
                            <div className="sp-card-meta">
                              <span className="sp-card-value">{formatCurrency(opp.value, opp.currency)}</span>
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
      )}

      {/* 기회 모달 */}
      {isModalOpen && (
        <OpportunityModal
          mode={modalMode}
          oppId={editOppId}
          defaultStage={defaultStage}
          stageOptions={activeStages.map((key) => ({ value: key, label: stageLabels[key] ?? key })).concat(
            [{ value: 'Lost', label: '기회 상실' }, { value: 'Abandoned', label: '보류' }, { value: 'Won', label: '수주 성공' }]
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

      {/* 수주 성공 전체보기 모달 */}
      {showWonAllModal && (
        <WonAllModal
          items={grouped[WON_STAGE] || []}
          onClose={() => setShowWonAllModal(false)}
        />
      )}
    </div>
  );
}
