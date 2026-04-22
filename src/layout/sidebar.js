import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { NavLink, useNavigate, Link, useLocation } from 'react-router-dom';
import {
  getSavedSidebar2LevelConfig,
  getSavedSidebarConfig,
  patchSidebarLayout,
  setSavedSidebar2LevelConfigLocally,
  normalizeSidebar2LevelConfig
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

const DROP_END = '__end__';
const SIDEBAR_DRAG_ITEM_MIME = 'application/x-nexvia-sidebar-item';

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
  { to: '/email', icon: 'mail', label: '이메일', category: 'etc' },
  { to: '/subscription', icon: 'subscriptions', label: '구독관리', category: 'etc' }
];

const SUBMENU_BY_TO = Object.fromEntries(SUBMENU_ITEMS.map((item) => [item.to, item]));
const SUBMENU_BY_CATEGORY = CATEGORY_ITEMS.reduce((acc, category) => {
  acc[category.key] = SUBMENU_ITEMS.filter((item) => item.category === category.key);
  return acc;
}, {});

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

function isPendingBlockedMenu(user, to) {
  if (user?.role !== 'pending') return false;
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

function reorderWithin(list, draggedKey, dropTargetKey) {
  const next = [...list];
  const fromIdx = next.indexOf(draggedKey);
  if (fromIdx === -1) return list;
  next.splice(fromIdx, 1);
  let toIdx = dropTargetKey === DROP_END ? next.length : next.indexOf(dropTargetKey);
  if (dropTargetKey !== DROP_END && toIdx === -1) return list;
  if (dropTargetKey !== DROP_END && fromIdx < toIdx) toIdx -= 1;
  next.splice(toIdx, 0, draggedKey);
  return next;
}

function reorderByPlacement(list, draggedKey, dropTargetKey, place = 'before') {
  if (dropTargetKey === DROP_END) {
    return reorderWithin(list, draggedKey, DROP_END);
  }
  const next = [...list];
  const fromIdx = next.indexOf(draggedKey);
  const targetIdx = next.indexOf(dropTargetKey);
  if (fromIdx === -1 || targetIdx === -1) return list;
  next.splice(fromIdx, 1);
  let insertIdx = place === 'after' ? targetIdx + 1 : targetIdx;
  if (fromIdx < targetIdx) insertIdx -= 1;
  if (insertIdx < 0) insertIdx = 0;
  if (insertIdx > next.length) insertIdx = next.length;
  next.splice(insertIdx, 0, draggedKey);
  return next;
}

function moveItemBetweenCategories(itemOrdersByCategory, itemTo, targetCategoryKey) {
  const next = {};
  const sourceEntries = Object.entries(itemOrdersByCategory || {});
  for (const [categoryKey, order] of sourceEntries) {
    const safeOrder = Array.isArray(order) ? order : [];
    next[categoryKey] = safeOrder.filter((to) => to !== itemTo);
  }
  const targetOrder = Array.isArray(next[targetCategoryKey]) ? next[targetCategoryKey] : [];
  if (!targetOrder.includes(itemTo)) targetOrder.push(itemTo);
  next[targetCategoryKey] = targetOrder;
  return next;
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
  const [draggingItemTo, setDraggingItemTo] = useState(null);
  const [itemDropHint, setItemDropHint] = useState(null);
  const [itemCrossMoveCategory, setItemCrossMoveCategory] = useState(null);
  const draggingItemToRef = useRef(null);

  const initialConfig = useMemo(() => {
    const modern = getSavedSidebar2LevelConfig();
    if (modern) return normalizeFromAnySavedConfig(modern);
    const legacy = getSavedSidebarConfig();
    return normalizeFromAnySavedConfig(legacy);
  }, []);

  const [categoryOrder, setCategoryOrder] = useState(initialConfig.categoryOrder);
  const [itemOrdersByCategory, setItemOrdersByCategory] = useState(initialConfig.itemOrdersByCategory);
  const [activeCategory, setActiveCategory] = useState(initialConfig.activeCategory);

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
    return () => { cancelled = true; };
  }, []);

  const departmentLabel = useMemo(
    () => getSidebarDepartmentLabel(user, organizationChart),
    [user, organizationChart]
  );

  const persistSidebarLayout = useCallback((nextCategoryOrder, nextItemOrdersByCategory, nextActiveCategory) => {
    const payload = {
      categoryOrder: nextCategoryOrder,
      itemOrdersByCategory: nextItemOrdersByCategory,
      activeCategory: nextActiveCategory
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

  const handleItemDragStart = useCallback((e, itemTo) => {
    e.stopPropagation();
    draggingItemToRef.current = itemTo;
    setDraggingItemTo(itemTo);
    e.dataTransfer.setData(SIDEBAR_DRAG_ITEM_MIME, itemTo);
    e.dataTransfer.setData('text/plain', itemTo);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleItemDragEnd = useCallback(() => {
    draggingItemToRef.current = null;
    setDraggingItemTo(null);
    setItemDropHint(null);
    setItemCrossMoveCategory(null);
  }, []);

  const handleItemDrop = useCallback((e, dropTargetTo, place = 'before') => {
    e.preventDefault();
    e.stopPropagation();
    if (!activeCategory) return;
    const dragged = draggingItemToRef.current ||
      e.dataTransfer.getData(SIDEBAR_DRAG_ITEM_MIME) ||
      e.dataTransfer.getData('text/plain');
    if (!dragged) return;
    const current = itemOrdersByCategory?.[activeCategory] || [];
    const next = reorderByPlacement(current, dragged, dropTargetTo, place);
    const nextByCategory = { ...itemOrdersByCategory, [activeCategory]: next };
    setItemOrdersByCategory(nextByCategory);
    persistSidebarLayout(categoryOrder, nextByCategory, activeCategory);
    handleItemDragEnd();
  }, [activeCategory, categoryOrder, handleItemDragEnd, itemOrdersByCategory, persistSidebarLayout]);

  const handleItemDropToCategory = useCallback((e, targetCategoryKey) => {
    e.preventDefault();
    e.stopPropagation();
    const dragged = draggingItemToRef.current ||
      e.dataTransfer.getData(SIDEBAR_DRAG_ITEM_MIME) ||
      e.dataTransfer.getData('text/plain');
    if (!dragged || !targetCategoryKey) return;
    const nextByCategory = moveItemBetweenCategories(itemOrdersByCategory, dragged, targetCategoryKey);
    setItemOrdersByCategory(nextByCategory);
    setActiveCategory(targetCategoryKey);
    setSavedSidebar2LevelConfigLocally({ activeCategory: targetCategoryKey });
    persistSidebarLayout(categoryOrder, nextByCategory, targetCategoryKey);
    handleItemDragEnd();
  }, [categoryOrder, handleItemDragEnd, itemOrdersByCategory, persistSidebarLayout]);

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
                  className={`sidebar-category-button ${isActive ? 'sidebar-category-button-active' : ''} ${itemCrossMoveCategory === category.key ? 'sidebar-category-button-drop-target' : ''}`}
                  onDragOver={(e) => {
                    if (!draggingItemToRef.current) return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                    setItemCrossMoveCategory(category.key);
                  }}
                  onDrop={(e) => {
                    if (!draggingItemToRef.current) return;
                    e.preventDefault();
                    e.stopPropagation();
                    handleItemDropToCategory(e, category.key);
                  }}
                  onClick={(e) => {
                    if (draggingItemToRef.current) {
                      e.preventDefault();
                      return;
                    }
                    handleCategoryClick(category.key);
                  }}
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
          onDragOver={(e) => {
            if (!draggingItemTo) return;
            e.preventDefault();
            setItemDropHint({ to: DROP_END, place: 'after' });
          }}
          onDrop={(e) => {
            if (!draggingItemTo) return;
            handleItemDrop(e, DROP_END, 'after');
          }}
        >
          {!activeCategory ? (
            <div className="sidebar-submenu-empty">대분류 아이콘을 선택해 주세요.</div>
          ) : (
            <>
              {activeItems.map((item) => {
                const isLocked = isPendingBlockedMenu(user, item.to);
                const isOver = itemDropHint?.to === item.to;
                const overBefore = isOver && itemDropHint?.place === 'before';
                const overAfter = isOver && itemDropHint?.place === 'after';
                return (
                  <div
                    key={item.to}
                    className={`sidebar-nav-item ${draggingItemTo === item.to ? 'sidebar-nav-item-dragging' : ''} ${isOver ? 'sidebar-nav-item-drag-over' : ''} ${overBefore ? 'sidebar-drop-before' : ''} ${overAfter ? 'sidebar-drop-after' : ''}`}
                    draggable
                    onDragStart={(e) => handleItemDragStart(e, item.to)}
                    onDragEnd={handleItemDragEnd}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (draggingItemTo === item.to) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const place = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                      setItemDropHint({ to: item.to, place });
                    }}
                    onDrop={(e) => handleItemDrop(e, item.to, itemDropHint?.place || 'before')}
                  >
                    <NavLink
                      to={item.to}
                      className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''} ${isLocked ? 'sidebar-link-locked' : ''}`}
                      end={item.to === '/'}
                      draggable={false}
                      onClick={(e) => {
                        if (isLocked) {
                          e.preventDefault();
                          window.alert('현재 계정은 권한 대기 상태입니다. 사내 현황에서 회사의 허용을 받아야 다른 메뉴에 접근할 수 있습니다.');
                          return;
                        }
                        onCloseDrawer?.();
                      }}
                    >
                      <span className="material-symbols-outlined">{item.icon}</span>
                      <span>{item.label}</span>
                      {isLocked ? <span className="material-symbols-outlined sidebar-lock-icon" aria-hidden>lock</span> : null}
                    </NavLink>
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
