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
  }
];

/**
 * @param {{ activeTab: string; onTabChange: (id: string) => void }} props
 */
export function OpportunityModalFormSectionTabs({ activeTab, onTabChange }) {
  return (
    <nav className="opp-section-nav-tabs" aria-label="입력 섹션">
      <ul className="opp-section-nav-tabs-list" role="tablist">
        {OPP_FORM_SECTION_TABS.map((t) => {
          const isActive = activeTab === t.id;
          return (
            <li key={t.id} className="opp-section-nav-tabs-item" role="presentation">
              <button
                type="button"
                className={`opp-section-nav-tabs-link${isActive ? ' opp-section-nav-tabs-link--active' : ''}`}
                role="tab"
                id={t.btnId}
                aria-selected={isActive}
                aria-controls={t.panelId}
                tabIndex={isActive ? 0 : -1}
                onClick={() => onTabChange(t.id)}
              >
                {t.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
