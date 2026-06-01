/**
 * 사이드바 메뉴 정의 + 로그인 시 적용할 기본 템플릿(순서 고정).
 * SIDEBAR_MENU_EPOCH 변경 시 저장된 순서는 무시되고 이 기본값으로 다시 맞춥니다.
 */

export const SIDEBAR_CATEGORY_ITEMS = [
  { key: 'inhouse', label: '사내 업무', icon: 'arrow_circle_left' },
  { key: 'outside', label: '사외 업무', icon: 'globe' },
  { key: 'schedule', label: '일정', icon: 'event' },
  { key: 'etc', label: '기타', icon: 'more_horiz' },
  {
    key: 'remote',
    label: '원격지원',
    icon: 'headset_mic',
    externalHref: 'http://helpu.kr/Nexvia'
  }
];

/** 기본 템플릿 메뉴 순서 — 이 배열 순서 그대로 유지 */
export const SIDEBAR_SUBMENU_ITEMS = [
  { to: '/dashboard', icon: 'dashboard', label: '대시보드', category: 'inhouse' },
  { to: '/company-overview', icon: 'domain', label: '사내 현황', category: 'inhouse' },
  { to: '/meeting-minutes', icon: 'event_note', label: '회의 일지', category: 'inhouse' },
  { to: '/reports/work-report', icon: 'assignment', label: '직원 업무 보고', category: 'inhouse' },
  { to: '/product-list', icon: 'inventory_2', label: '제품 리스트', category: 'inhouse' },
  { to: '/kpi', icon: 'analytics', label: '성과분석', category: 'inhouse' },
  { to: '/customer-company-employees', icon: 'group', label: '연락처 리스트', category: 'outside' },
  { to: '/customer-companies', icon: 'business', label: '기업 리스트', category: 'outside' },
  { to: '/sales-pipeline', icon: 'view_kanban', label: '세일즈 현황', category: 'outside' },
  { to: '/map', icon: 'map', label: '지도', category: 'outside' },
  { to: '/lead-capture', icon: 'ads_click', label: '리드 캡처', category: 'outside' },
  { to: '/calendar', icon: 'calendar_month', label: '캘린더', category: 'schedule' },
  { to: '/project', icon: 'folder', label: '프로젝트', category: 'schedule' },
  { to: '/todo-list', icon: 'checklist', label: 'Todo List', category: 'schedule' },
  { to: '/ai-voice', icon: 'mic', label: 'AI 음성 기록', category: 'etc' },
  { to: '/quotation-doc-merge', icon: 'merge_type', label: '문서 메일머지', category: 'etc' },
  { to: '/subscription', icon: 'subscriptions', label: '구독관리', category: 'etc' }
];

export const SIDEBAR_SUBMENU_BY_CATEGORY = SIDEBAR_CATEGORY_ITEMS.reduce((acc, category) => {
  acc[category.key] = SIDEBAR_SUBMENU_ITEMS.filter((item) => item.category === category.key);
  return acc;
}, {});

/** @param {number} menuEpoch */
export function buildDefaultSidebar2LevelTemplate(menuEpoch) {
  const categoryOrder = SIDEBAR_CATEGORY_ITEMS.map((c) => c.key);
  const itemOrdersByCategory = {};
  for (const category of SIDEBAR_CATEGORY_ITEMS) {
    itemOrdersByCategory[category.key] = (SIDEBAR_SUBMENU_BY_CATEGORY[category.key] || []).map(
      (item) => item.to
    );
  }
  return {
    categoryOrder,
    itemOrdersByCategory,
    activeCategory: 'inhouse',
    menuEpoch,
    order: SIDEBAR_SUBMENU_ITEMS.map((item) => item.to),
    overflow: []
  };
}
