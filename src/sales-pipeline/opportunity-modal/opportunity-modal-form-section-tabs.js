import React from 'react';

/** 기회 모달 본문 섹션 탭 — `oppFormSectionTab` 값과 패널 id·버튼 id와 동기 */
export const OPP_FORM_SECTION_TABS = [
  {
    id: 'basic',
    label: '기본 정보',
    btnId: 'opp-section-tab-btn-basic',
    panelId: 'opp-section-tab-panel-basic'
  },
  {
    id: 'products',
    label: '제품·금액',
    btnId: 'opp-section-tab-btn-products',
    panelId: 'opp-section-tab-panel-products'
  },
  {
    id: 'schedule',
    label: '일정',
    btnId: 'opp-section-tab-btn-schedule',
    panelId: 'opp-section-tab-panel-schedule'
  },
  {
    id: 'records',
    label: '증서·기록',
    btnId: 'opp-section-tab-btn-records',
    panelId: 'opp-section-tab-panel-records'
  }
];

/**
 * @param {{ activeTab: string; onTabChange: (id: string) => void }} props
 */
export function OpportunityModalFormSectionTabs({ activeTab, onTabChange }) {
  return (
    <div className="opp-modal-tabs-bar">
      <div className="opp-modal-tabs-bar-head">
        <span className="opp-modal-tabs-bar-label" id="opp-form-section-tablist-label">
          입력 섹션
        </span>
      </div>
      <div className="opp-modal-tabs" role="tablist" aria-labelledby="opp-form-section-tablist-label">
        {OPP_FORM_SECTION_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`opp-modal-tab${activeTab === t.id ? ' opp-modal-tab--active' : ''}`}
            role="tab"
            id={t.btnId}
            aria-selected={activeTab === t.id}
            aria-controls={t.panelId}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
