import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { NavLink, useNavigate, Link, useLocation } from 'react-router-dom';
import {
  getSavedSidebar2LevelConfig,
  getSavedSidebarConfig,
  patchSidebarLayout,
  setSavedSidebar2LevelConfigLocally,
  normalizeSidebar2LevelConfig,
  SIDEBAR_MENU_EPOCH
} from '@/lib/list-templates';
import { API_BASE } from '@/config';
import { resolveDepartmentDisplayFromChart } from '@/lib/org-chart-tree-utils';
import './sidebar.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const NEXVIA_LOGO_CDN_URL =
  'https://res.cloudinary.com/djcsvvhly/image/upload/v1774253552/NexviaLogo_pid8kz.png';

const CATEGORY_ITEMS = [
  { key: 'inhouse', label: '사내 업무', icon: 'arrow_circle_left' },
  { key: 'outside', label: '사외 업무', icon: 'globe' },
  { key: 'schedule', label: '일정', icon: 'event' },
  { key: 'etc', label: '기타', icon: 'more_horiz' }
];

const SUBMENU_ITEMS = [
  { to: '/', icon: 'dashboard', label: '대시보드', category: 'inhouse' },
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
  { to: '/subscription', icon: 'subscriptions', label: '구독관리', category: 'etc' }
];

const SUBMENU_BY_TO = Object.fromEntries(SUBMENU_ITEMS.map((item) => [item.to, item]));
const SUBMENU_BY_CATEGORY = CATEGORY_ITEMS.reduce((acc, category) => {
  acc[category.key] = SUBMENU_ITEMS.filter((item) => item.category === category.key);
  return acc;
}, {});

const SUBMENU_DROP_ZONE = 'submenu';

function pathMatchesMenuItem(to, pathname) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}

function findCategoryByPath(pathname) {
  const found = SUBMENU_ITEMS.find((item) => pathMatchesMenuItem(item.to, pathname));
  return found?.category || null;
}

function getSidebarDepartmentLabel(user, orgChartRoot) {
  const raw = String(user?.companyDepartment || user?.department || '').trim();
  if (!raw) return '—';
  const explicit = String(user?.companyDepartmentDisplay || user?.departmentDisplay || '').trim();
  if (explicit) return explicit;
  return resolveDepartmentDisplayFromChart(orgChartRoot, raw) || raw;
}

function isPendingBlockedMenu(user, itemOrTo) {
  if (user?.role !== 'pending') return false;
  const item = typeof itemOrTo === 'object' && itemOrTo != null && 'to' in itemOrTo ? itemOrTo : null;
  if (item?.external) return false;
  const to = item ? item.to : itemOrTo;
  return to !== '/company-overview';
}

function canShowMenuByRole(user, item) {
  if (!item) return false;
  if (item.to === '/subscription') {
    const r = user?.role;
    return r === 'owner' || r === 'admin' || r === 'senior';
  }
  return true;
}

/**
 * 같은 리스트 안에서 순서만 바꿈 (to 기준).
 * 드롭한 행 위치에 맞춤: 한 칸 제거한 뒤 원래 dropIdx 자리에 넣으면 위·아래 이동이 모두 맞음.
 */
function reorderWithin(list, draggedTo, dropTargetTo) {
  const next = [...list];
  const fromIdx = next.indexOf(draggedTo);
  if (fromIdx === -1) return list;
  const dropIdx = next.indexOf(dropTargetTo);
  if (dropIdx === -1) return list;
  if (fromIdx === dropIdx) return list;
  next.splice(fromIdx, 1);
  next.splice(dropIdx, 0, draggedTo);
  return next;
}

function isSidebarHandleReorderDrag(dataTransfer) {
  try {
    return Boolean(dataTransfer?.types && Array.from(dataTransfer.types).includes('application/x-sidebar-to'));
  } catch {
    return false;
  }
}

function normalizeFromAnySavedConfig(saved) {
  return normalizeSidebar2LevelConfig(CATEGORY_ITEMS, SUBMENU_BY_CATEGORY, saved);
}

export default function Sidebar({ drawerOpen, onCloseDrawer, currentUser }) {
  const navigate = useNavigate();
  const location = useLocation();
  const storedUser = useMemo(() => {
    try {
      const raw = localStorage.getItem('crm_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);
  const user = currentUser || storedUser;
  const userSyncKey = user?._id || user?.id || user?.email || '';
  const [organizationChart, setOrganizationChart] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);

  const [draggingTo, setDraggingTo] = useState(null);
  const [dragOverDrop, setDragOverDrop] = useState(null);
  const draggedToRef = useRef(null);
  const itemOrdersByCategoryRef = useRef(null);
  const activeCategoryRef = useRef(null);
  const categoryOrderRef = useRef(null);

  const initialConfig = useMemo(() => {
    const modern = getSavedSidebar2LevelConfig();
    if (modern) return normalizeFromAnySavedConfig(modern);
    const legacy = getSavedSidebarConfig();
    return normalizeFromAnySavedConfig(legacy);
  }, []);

  const [categoryOrder, setCategoryOrder] = useState(initialConfig.categoryOrder);
  const [itemOrdersByCategory, setItemOrdersByCategory] = useState(initialConfig.itemOrdersByCategory);
  const [activeCategory, setActiveCategory] = useState(initialConfig.activeCategory);

  itemOrdersByCategoryRef.current = itemOrdersByCategory;
  activeCategoryRef.current = activeCategory;
  categoryOrderRef.current = categoryOrder;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/companies/organization-chart`, {
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const json = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setOrganizationChart(json.organizationChart ?? null);
      } catch {
        /* 조직도 없어도 사이드바는 동작 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const departmentLabel = useMemo(
    () => getSidebarDepartmentLabel(user, organizationChart),
    [user, organizationChart]
  );

  const persistSidebarLayout = useCallback((nextCategoryOrder, nextItemOrdersByCategory, nextActiveCategory) => {
    const payload = {
      categoryOrder: nextCategoryOrder,
      itemOrdersByCategory: nextItemOrdersByCategory,
      activeCategory: nextActiveCategory,
      menuEpoch: SIDEBAR_MENU_EPOCH
    };
    setSavedSidebar2LevelConfigLocally(payload);
    setSavingOrder(true);
    patchSidebarLayout(payload)
      .catch(() => {})
      .finally(() => setSavingOrder(false));
  }, []);

  useEffect(() => {
    const modern = getSavedSidebar2LevelConfig();
    const legacy = getSavedSidebarConfig();
    const normalized = normalizeFromAnySavedConfig(modern || legacy);
    setCategoryOrder(normalized.categoryOrder);
    setItemOrdersByCategory(normalized.itemOrdersByCategory);
    setActiveCategory(normalized.activeCategory);
    persistSidebarLayout(
      normalized.categoryOrder,
      normalized.itemOrdersByCategory,
      normalized.activeCategory
    );
  }, [userSyncKey, persistSidebarLayout]);

  useEffect(() => {
    const matchedCategory = findCategoryByPath(location.pathname);
    if (!matchedCategory) return;
    setActiveCategory(matchedCategory);
    setSavedSidebar2LevelConfigLocally({ activeCategory: matchedCategory });
  }, [location.pathname]);

  const visibleCategoryOrder = useMemo(
    () =>
      categoryOrder.filter((categoryKey) =>
        (SUBMENU_BY_CATEGORY[categoryKey] || []).some((item) => canShowMenuByRole(user, item))
      ),
    [categoryOrder, user]
  );

  const activeItems = useMemo(() => {
    if (!activeCategory) return [];
    const orderedTos = itemOrdersByCategory?.[activeCategory] || [];
    return orderedTos
      .map((to) => SUBMENU_BY_TO[to])
      .filter((item) => item && canShowMenuByRole(user, item));
  }, [activeCategory, itemOrdersByCategory, user]);

  const handleCategoryClick = useCallback((categoryKey) => {
    setActiveCategory((prev) => {
      const next = prev === categoryKey ? null : categoryKey;
      setSavedSidebar2LevelConfigLocally({ activeCategory: next });
      return next;
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    draggedToRef.current = null;
    setDraggingTo(null);
    setDragOverDrop(null);
  }, []);

  const applySubmenuReorder = useCallback(
    (dropTargetTo) => {
      const dragged = draggedToRef.current;
      const cat = activeCategoryRef.current;
      if (!dragged || !cat) return;
      const main = itemOrdersByCategoryRef.current?.[cat] || [];
      const nextList = reorderWithin(main, dragged, dropTargetTo);
      const nextByCategory = { ...itemOrdersByCategoryRef.current, [cat]: nextList };
      setItemOrdersByCategory(nextByCategory);
      persistSidebarLayout(categoryOrderRef.current, nextByCategory, cat);
    },
    [persistSidebarLayout]
  );

  const handleDragStart = useCallback((e, itemTo) => {
    e.stopPropagation();
    draggedToRef.current = itemTo;
    setDraggingTo(itemTo);
    e.dataTransfer.setData('text/plain', itemTo);
    e.dataTransfer.setData('application/x-sidebar-to', itemTo);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleSubmenuDrop = useCallback(
    (e, explicitTargetTo) => {
      if (!draggedToRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const row = e.target.closest?.(`[data-sidebar-drop-zone="${SUBMENU_DROP_ZONE}"]`);
      const dropTo = explicitTargetTo ?? row?.getAttribute?.('data-sidebar-drop-to');
      if (dropTo == null) return;
      applySubmenuReorder(dropTo);
      handleDragEnd();
    },
    [applySubmenuReorder, handleDragEnd]
  );

  const setDropHighlight = useCallback((to) => {
    setDragOverDrop(to != null ? { zone: SUBMENU_DROP_ZONE, to } : null);
  }, []);

  const handleSubmenuRowDragOver = useCallback(
    (e, itemTo) => {
      const reorderDrag =
        isSidebarHandleReorderDrag(e.dataTransfer) || Boolean(draggedToRef.current);
      if (!reorderDrag) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (itemTo !== draggingTo) setDropHighlight(itemTo);
    },
    [draggingTo, setDropHighlight]
  );

  const navDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOverDrop(null);
  }, []);

  return (
    <aside className={`sidebar ${drawerOpen ? 'sidebar-drawer-open' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-header-logo">
          <Link
            to="/"
            className="sidebar-header-logo-link"
            onClick={() => onCloseDrawer?.()}
            aria-label="홈(대시보드)으로 이동"
          >
            <img src={NEXVIA_LOGO_CDN_URL} alt="Nexvia CRM" decoding="async" />
          </Link>
        </div>
        {drawerOpen && (
          <button
            type="button"
            className="sidebar-drawer-close"
            onClick={onCloseDrawer}
            aria-label="메뉴 닫기"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        )}
      </div>

      <nav className="sidebar-nav sidebar-nav-twolevel">
        <div className="sidebar-category-rail">
          {visibleCategoryOrder.map((categoryKey) => {
            const category = CATEGORY_ITEMS.find((c) => c.key === categoryKey);
            if (!category) return null;
            const isActive = activeCategory === category.key;
            return (
              <div key={category.key} className="sidebar-category-wrap">
                <button
                  type="button"
                  className={`sidebar-category-button ${isActive ? 'sidebar-category-button-active' : ''}`}
                  onClick={() => handleCategoryClick(category.key)}
                  title={category.label}
                  aria-label={category.label}
                >
                  <span className="material-symbols-outlined">{category.icon}</span>
                </button>
              </div>
            );
          })}
        </div>

        <div
          className="sidebar-submenu-pane"
          onDragLeave={activeCategory ? navDragLeave : undefined}
        >
          {!activeCategory ? (
            <div className="sidebar-submenu-empty">대분류 아이콘을 선택해 주세요.</div>
          ) : (
            <>
              {activeItems.map((item) => {
                const isLocked = isPendingBlockedMenu(user, item);
                const over =
                  dragOverDrop?.zone === SUBMENU_DROP_ZONE && dragOverDrop?.to === item.to;
                const linkTitle = isLocked
                  ? undefined
                  : item.external
                    ? `${item.label} — 클릭: 새 탭. 분할 탭은 페이지에서 자동 지정 불가(Chrome: 링크 우클릭 →「분할 화면에서 링크 열기」또는 창 왼쪽·오른쪽 끝으로 드래그, 설정에서 가장자리 드롭 허용 필요).`
                    : `${item.label} — 링크를 끌면 새 탭·Chrome 분할 보기(창 좌우 끝·우클릭「분할 화면에서 링크 열기」).`;
                return (
                  <div
                    key={item.to}
                    data-sidebar-drop-zone={SUBMENU_DROP_ZONE}
                    data-sidebar-drop-to={item.to}
                    className={`sidebar-nav-item ${draggingTo === item.to ? 'sidebar-nav-item-dragging' : ''} ${over ? 'sidebar-nav-item-drag-over' : ''}`}
                    onDragOver={(e) => handleSubmenuRowDragOver(e, item.to)}
                    onDrop={(e) => handleSubmenuDrop(e, item.to)}
                  >
                    <span
                      className="sidebar-drag-handle"
                      draggable={!isLocked}
                      onDragStart={isLocked ? undefined : (e) => handleDragStart(e, item.to)}
                      onDragEnd={handleDragEnd}
                      title={isLocked ? '권한 대기 중에는 순서를 바꿀 수 없습니다' : '드래그하여 순서 변경'}
                      aria-label={`${item.label} 순서 변경`}
                    >
                      <span className="material-symbols-outlined" aria-hidden>
                        drag_indicator
                      </span>
                    </span>
                    {item.external && item.href ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`sidebar-link sidebar-link-external ${isLocked ? 'sidebar-link-locked' : ''}`}
                        draggable={!isLocked}
                        title={linkTitle}
                        onClick={(e) => {
                          if (isLocked) {
                            e.preventDefault();
                            window.alert(
                              '현재 계정은 권한 대기 상태입니다. 사내 현황에서 회사의 허용을 받아야 다른 메뉴에 접근할 수 있습니다.'
                            );
                            return;
                          }
                          onCloseDrawer?.();
                        }}
                      >
                        <span className="sidebar-link-label">{item.label}</span>
                        {isLocked ? (
                          <span className="material-symbols-outlined sidebar-lock-icon" aria-hidden>
                            lock
                          </span>
                        ) : null}
                      </a>
                    ) : (
                      <NavLink
                        to={item.to}
                        className={({ isActive }) =>
                          `sidebar-link ${isActive ? 'active' : ''} ${isLocked ? 'sidebar-link-locked' : ''}`
                        }
                        end={item.to === '/'}
                        draggable={!isLocked}
                        title={linkTitle}
                        onClick={(e) => {
                          if (isLocked) {
                            e.preventDefault();
                            window.alert(
                              '현재 계정은 권한 대기 상태입니다. 사내 현황에서 회사의 허용을 받아야 다른 메뉴에 접근할 수 있습니다.'
                            );
                            return;
                          }
                          onCloseDrawer?.();
                        }}
                      >
                        <span className="sidebar-link-label">{item.label}</span>
                        {isLocked ? (
                          <span className="material-symbols-outlined sidebar-lock-icon" aria-hidden>
                            lock
                          </span>
                        ) : null}
                      </NavLink>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </nav>

      {savingOrder && (
        <div className="sidebar-order-saving" aria-live="polite">
          레이아웃 저장 중…
        </div>
      )}

      <div className="sidebar-footer">
        <Link to="/register?edit=1" className="sidebar-user sidebar-user-clickable">
          {user?.avatar ? (
            <img src={user.avatar} alt="" className="sidebar-avatar sidebar-avatar-img" />
          ) : (
            <div className="sidebar-avatar sidebar-avatar-fallback" aria-hidden>
              <span className="material-symbols-outlined">person</span>
            </div>
          )}
          <div className="sidebar-user-info">
            <p className="sidebar-user-name">{user?.name || '사용자'}</p>
            <p className="sidebar-user-role">{departmentLabel}</p>
          </div>
        </Link>
        <button
          type="button"
          className="sidebar-logout"
          onClick={() => {
            localStorage.removeItem('crm_token');
            localStorage.removeItem('crm_user');
            navigate('/login', { replace: true });
          }}
        >
          <span className="material-symbols-outlined">logout</span>
          <span>로그아웃</span>
        </button>
      </div>
    </aside>
  );
}
