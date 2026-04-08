import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { NavLink, useNavigate, Link, useLocation } from 'react-router-dom';
import {
  getSavedSidebarConfig,
  patchSidebarOrder,
  setSavedSidebarConfigLocally,
  normalizeSidebarOrders,
  SIDEBAR_MENU_EPOCH
} from '@/lib/list-templates';
import { API_BASE } from '@/config';
import { resolveDepartmentDisplayFromChart } from '@/lib/org-chart-tree-utils';
import './sidebar.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 사이드바 상단 로고 (Cloudinary CDN) */
const NEXVIA_LOGO_CDN_URL =
  'https://res.cloudinary.com/djcsvvhly/image/upload/v1774253552/NexviaLogo_pid8kz.png';

/** 드롭: 리스트 끝에 삽입 */
const DROP_END = '__end__';

/** 메뉴 항목 정의 (추가 시 여기만 수정하면 되고, 저장된 순서·overflow와 병합됨). */
const MENU_ITEMS = [
  { to: '/', icon: 'dashboard', label: '대시보드' },
  { to: '/company-overview', icon: 'domain', label: '사내 현황' },
  { to: '/customer-companies', icon: 'business', label: '고객사 리스트' },
  { to: '/customer-company-employees', icon: 'group', label: '연락처 리스트' },
  { to: '/product-list', icon: 'inventory_2', label: '제품 리스트' },
  { to: '/meeting-minutes', icon: 'event_note', label: '회의 일지' },
  { to: '/ai-voice', icon: 'mic', label: 'AI 음성 기록' },
  { to: '/email', icon: 'mail', label: '이메일' },
  { to: '/messenger', icon: 'chat_bubble', label: '메신저' },
  { to: '/map', icon: 'map', label: '지도' },
  { to: '/sales-pipeline', icon: 'view_kanban', label: '세일즈 현황' },
  { to: '/lead-capture', icon: 'ads_click', label: '리드 캡처' },
  { to: '/reports/work-report', icon: 'assignment', label: '직원 업무 보고' },
  { to: '/subscription', icon: 'subscriptions', label: '구독관리' }
];

function pathMatchesMenuItem(to, pathname) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** 조직도 노드 id 또는 자유 텍스트 → 사이드바 표시명 */
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

function orderToVisibleItems(order, user) {
  return order
    .map((to) => MENU_ITEMS.find((i) => i.to === to))
    .filter((item) => item && canShowMenuByRole(user, item));
}

/** 같은 리스트 안에서 순서만 바꿈 (to 기준, DROP_END면 맨 끝) */
function reorderWithin(list, draggedTo, dropTargetTo) {
  const next = [...list];
  const fromIdx = next.indexOf(draggedTo);
  if (fromIdx === -1) return list;
  next.splice(fromIdx, 1);
  let toIdx =
    dropTargetTo === DROP_END ? next.length : next.indexOf(dropTargetTo);
  if (dropTargetTo !== DROP_END && toIdx === -1) return list;
  if (dropTargetTo !== DROP_END && fromIdx < toIdx) toIdx -= 1;
  next.splice(toIdx, 0, draggedTo);
  return next;
}

/** main에서 제거 후 overflow에 삽입 */
function moveMainToOverflow(main, overflow, draggedTo, dropTargetTo) {
  if (!main.includes(draggedTo)) return null;
  const nextMain = main.filter((t) => t !== draggedTo);
  const nextOv = [...overflow];
  let idx =
    dropTargetTo === DROP_END ? nextOv.length : nextOv.indexOf(dropTargetTo);
  if (dropTargetTo !== DROP_END && idx === -1) return null;
  nextOv.splice(dropTargetTo === DROP_END ? nextOv.length : idx, 0, draggedTo);
  return { main: nextMain, overflow: nextOv };
}

/** overflow에서 제거 후 main에 삽입 */
function moveOverflowToMain(main, overflow, draggedTo, dropTargetTo) {
  if (!overflow.includes(draggedTo)) return null;
  const nextOv = overflow.filter((t) => t !== draggedTo);
  const nextMain = [...main];
  let idx =
    dropTargetTo === DROP_END ? nextMain.length : nextMain.indexOf(dropTargetTo);
  if (dropTargetTo !== DROP_END && idx === -1) return null;
  nextMain.splice(dropTargetTo === DROP_END ? nextMain.length : idx, 0, draggedTo);
  return { main: nextMain, overflow: nextOv };
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/companies/organization-chart`, {
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const json = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setOrganizationChart(json.organizationChart ?? null);
        }
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

  const [mainOrder, setMainOrder] = useState(() => {
    const { mainOrder: m } = normalizeSidebarOrders(MENU_ITEMS, getSavedSidebarConfig());
    return m;
  });
  const [overflowOrder, setOverflowOrder] = useState(() => {
    const { overflowOrder: o } = normalizeSidebarOrders(MENU_ITEMS, getSavedSidebarConfig());
    return o;
  });
  const [draggingTo, setDraggingTo] = useState(null);
  const [dragFromZone, setDragFromZone] = useState(null);
  const [dragOverDrop, setDragOverDrop] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowWrapRef = useRef(null);
  const draggedToRef = useRef(null);
  const dragFromZoneRef = useRef(null);
  const mainOrderRef = useRef(mainOrder);
  const overflowOrderRef = useRef(overflowOrder);

  mainOrderRef.current = mainOrder;
  overflowOrderRef.current = overflowOrder;
  dragFromZoneRef.current = dragFromZone;

  useEffect(() => {
    const saved = getSavedSidebarConfig();
    const { mainOrder: m, overflowOrder: o } = normalizeSidebarOrders(MENU_ITEMS, saved);
    setMainOrder(m);
    setOverflowOrder(o);

    const allTos = MENU_ITEMS.map((i) => i.to);
    const union = new Set([
      ...(Array.isArray(saved?.order) ? saved.order : []),
      ...(Array.isArray(saved?.overflow) ? saved.overflow : [])
    ]);
    const hadEveryMenu = allTos.every((t) => union.has(t));
    if (!hadEveryMenu) {
      setSavedSidebarConfigLocally({ order: m, overflow: o });
      patchSidebarOrder(m, o).catch(() => {});
    }
  }, [userSyncKey, SIDEBAR_MENU_EPOCH]);

  const mainItems = useMemo(
    () => orderToVisibleItems(mainOrder, user),
    [mainOrder, user]
  );
  const overflowItems = useMemo(
    () => orderToVisibleItems(overflowOrder, user),
    [overflowOrder, user]
  );

  const persistBoth = useCallback((nextMain, nextOverflow) => {
    setSavedSidebarConfigLocally({ order: nextMain, overflow: nextOverflow });
    setSavingOrder(true);
    patchSidebarOrder(nextMain, nextOverflow)
      .catch(() => {})
      .finally(() => setSavingOrder(false));
  }, []);

  const prevPathRef = useRef(location.pathname);

  useEffect(() => {
    const path = location.pathname;
    const inOverflow = overflowItems.some((item) => pathMatchesMenuItem(item.to, path));
    if (inOverflow) {
      setOverflowOpen(true);
    } else {
      const prev = prevPathRef.current;
      const wasInOverflow = overflowItems.some((item) => pathMatchesMenuItem(item.to, prev));
      if (wasInOverflow) setOverflowOpen(false);
    }
    prevPathRef.current = path;
  }, [location.pathname, overflowItems]);

  useEffect(() => {
    if (!overflowOpen) return;
    const onDoc = (e) => {
      /* 메인 메뉴 드래그 핸들 mousedown은 overflow 바깥으로 간주되며, 기존에는 여기서 패널이 닫혀 드롭 불가였음 */
      if (e.target.closest?.('.sidebar-drag-handle')) return;
      if (overflowWrapRef.current && !overflowWrapRef.current.contains(e.target)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [overflowOpen]);

  useEffect(() => {
    if (!overflowOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && !draggingTo) setOverflowOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overflowOpen, draggingTo]);

  const handleDragStart = useCallback((e, itemTo, zone) => {
    e.stopPropagation();
    draggedToRef.current = itemTo;
    dragFromZoneRef.current = zone;
    setDraggingTo(itemTo);
    setDragFromZone(zone);
    if (zone === 'main') setOverflowOpen(true);
    e.dataTransfer.setData('text/plain', itemTo);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-sidebar-to', itemTo);
    e.dataTransfer.setData('application/x-sidebar-zone', zone);
  }, []);

  const handleDragEnd = useCallback(() => {
    draggedToRef.current = null;
    dragFromZoneRef.current = null;
    setDraggingTo(null);
    setDragFromZone(null);
    setDragOverDrop(null);
  }, []);

  const applyDrop = useCallback(
    (targetZone, dropTargetTo) => {
      const dragged = draggedToRef.current;
      const from = dragFromZoneRef.current;
      if (!dragged || !from) return;

      const main = mainOrderRef.current;
      const ov = overflowOrderRef.current;

      let nextMain = main;
      let nextOv = ov;

      if (from === 'main' && targetZone === 'main') {
        nextMain = reorderWithin(main, dragged, dropTargetTo);
        nextOv = ov;
      } else if (from === 'overflow' && targetZone === 'overflow') {
        nextMain = main;
        nextOv = reorderWithin(ov, dragged, dropTargetTo);
      } else if (from === 'main' && targetZone === 'overflow') {
        const moved = moveMainToOverflow(main, ov, dragged, dropTargetTo);
        if (!moved) return;
        nextMain = moved.main;
        nextOv = moved.overflow;
      } else if (from === 'overflow' && targetZone === 'main') {
        const moved = moveOverflowToMain(main, ov, dragged, dropTargetTo);
        if (!moved) return;
        nextMain = moved.main;
        nextOv = moved.overflow;
      } else {
        return;
      }

      setMainOrder(nextMain);
      setOverflowOrder(nextOv);
      persistBoth(nextMain, nextOv);
    },
    [persistBoth]
  );

  const setDropHighlight = useCallback((zone, to) => {
    setDragOverDrop(zone && to != null ? { zone, to } : null);
  }, []);

  const handleMainRowDragOver = useCallback(
    (e, itemTo) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (itemTo !== draggingTo) setDropHighlight('main', itemTo);
    },
    [draggingTo, setDropHighlight]
  );

  const handleOverflowRowDragOver = useCallback(
    (e, itemTo) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (itemTo !== draggingTo) setDropHighlight('overflow', itemTo);
    },
    [draggingTo, setDropHighlight]
  );

  const handleOverflowEndDragOver = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDropHighlight('overflow', DROP_END);
    },
    [setDropHighlight]
  );

  const handleMainDrop = useCallback(
    (e, explicitTargetTo) => {
      e.preventDefault();
      e.stopPropagation();
      const row = e.target.closest?.('[data-sidebar-drop-zone="main"]');
      const dropTo = explicitTargetTo ?? row?.getAttribute?.('data-sidebar-drop-to');
      if (dropTo == null) return;
      applyDrop('main', dropTo);
      handleDragEnd();
    },
    [applyDrop, handleDragEnd]
  );

  const handleOverflowDrop = useCallback(
    (e, explicitTargetTo) => {
      e.preventDefault();
      e.stopPropagation();
      const row = e.target.closest?.('[data-sidebar-drop-zone="overflow"]');
      const dropTo = explicitTargetTo ?? row?.getAttribute?.('data-sidebar-drop-to');
      if (dropTo == null) return;
      applyDrop('overflow', dropTo);
      handleDragEnd();
    },
    [applyDrop, handleDragEnd]
  );

  const navDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOverDrop(null);
  }, []);

  const overflowCount = overflowItems.length;

  return (
    <aside className={`sidebar ${drawerOpen ? 'sidebar-drawer-open' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-header-logo">
          <img
            src={NEXVIA_LOGO_CDN_URL}
            alt="Nexvia CRM"
            decoding="async"
          />
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
      <nav className="sidebar-nav" onDragLeave={navDragLeave}>
        {mainItems.map((item) => {
          const isLocked = isPendingBlockedMenu(user, item.to);
          const over =
            dragOverDrop?.zone === 'main' && dragOverDrop?.to === item.to;
          return (
            <div
              key={item.to}
              data-sidebar-drop-zone="main"
              data-sidebar-drop-to={item.to}
              className={`sidebar-nav-item ${draggingTo === item.to ? 'sidebar-nav-item-dragging' : ''} ${over ? 'sidebar-nav-item-drag-over' : ''}`}
              onDragOver={(e) => handleMainRowDragOver(e, item.to)}
              onDrop={(e) => handleMainDrop(e, item.to)}
            >
              <span
                className="sidebar-drag-handle"
                draggable
                onDragStart={(e) => handleDragStart(e, item.to, 'main')}
                onDragEnd={handleDragEnd}
                title="드래그하여 순서 변경 · 더보기로 이동"
                aria-label="순서 변경"
              >
                <span className="material-symbols-outlined">drag_indicator</span>
              </span>
              <NavLink
                to={item.to}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''} ${isLocked ? 'sidebar-link-locked' : ''}`}
                end={item.to === '/'}
                onClick={(e) => {
                  if (item.to === '#') e.preventDefault();
                  else if (isLocked) {
                    e.preventDefault();
                    window.alert('현재 계정은 권한 대기 상태입니다. 사내 현황에서 회사의 허용을 받아야 다른 메뉴에 접근할 수 있습니다.');
                  } else onCloseDrawer?.();
                }}
              >
                <span className="material-symbols-outlined">{item.icon}</span>
                <span>{item.label}</span>
                {isLocked && <span className="material-symbols-outlined sidebar-lock-icon" aria-hidden>lock</span>}
              </NavLink>
            </div>
          );
        })}

        <div className="sidebar-overflow" ref={overflowWrapRef}>
          <button
            type="button"
            className={`sidebar-overflow-toggle ${overflowOpen ? 'sidebar-overflow-toggle--open' : ''}`}
            onClick={() => setOverflowOpen((v) => !v)}
            aria-expanded={overflowOpen}
            aria-controls="sidebar-overflow-menu"
            id="sidebar-overflow-btn"
          >
            <span className="material-symbols-outlined sidebar-overflow-hamburger" aria-hidden>
              menu
            </span>
            <span className="sidebar-overflow-toggle-label">
              더보기{overflowCount > 0 ? ` (${overflowCount})` : ''}
            </span>
            <span className="material-symbols-outlined sidebar-overflow-chevron" aria-hidden>
              {overflowOpen ? 'expand_less' : 'expand_more'}
            </span>
          </button>
          {overflowOpen ? (
            <div
              className="sidebar-overflow-panel"
              id="sidebar-overflow-menu"
              role="region"
              aria-label="추가 메뉴"
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) {
                  if (dragOverDrop?.zone === 'overflow') setDragOverDrop(null);
                }
              }}
            >
              {overflowItems.length === 0 ? (
                <div
                  data-sidebar-drop-zone="overflow"
                  data-sidebar-drop-to={DROP_END}
                  className={`sidebar-nav-empty-drop ${dragOverDrop?.zone === 'overflow' && dragOverDrop?.to === DROP_END ? 'sidebar-nav-item-drag-over' : ''}`}
                  onDragOver={handleOverflowEndDragOver}
                  onDrop={(e) => handleOverflowDrop(e, DROP_END)}
                >
                  메인에서 항목을 드래그하여 여기에 놓으면 더보기에만 표시됩니다.
                </div>
              ) : null}

              {overflowItems.map((item) => {
                const isLocked = isPendingBlockedMenu(user, item.to);
                const over =
                  dragOverDrop?.zone === 'overflow' && dragOverDrop?.to === item.to;
                return (
                  <div
                    key={item.to}
                    data-sidebar-drop-zone="overflow"
                    data-sidebar-drop-to={item.to}
                    className={`sidebar-overflow-row sidebar-nav-item ${draggingTo === item.to ? 'sidebar-nav-item-dragging' : ''} ${over ? 'sidebar-nav-item-drag-over' : ''}`}
                    onDragOver={(e) => handleOverflowRowDragOver(e, item.to)}
                    onDrop={(e) => handleOverflowDrop(e, item.to)}
                  >
                    <span
                      className="sidebar-drag-handle"
                      draggable
                      onDragStart={(e) => handleDragStart(e, item.to, 'overflow')}
                      onDragEnd={handleDragEnd}
                      title="드래그하여 순서 변경 · 메인으로 이동"
                      aria-label="순서 변경"
                    >
                      <span className="material-symbols-outlined">drag_indicator</span>
                    </span>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        `sidebar-link sidebar-overflow-link ${isActive ? 'active' : ''} ${isLocked ? 'sidebar-link-locked' : ''}`
                      }
                      end={item.to === '/'}
                      onClick={(e) => {
                        if (item.to === '#') e.preventDefault();
                        else if (isLocked) {
                          e.preventDefault();
                          window.alert('현재 계정은 권한 대기 상태입니다. 사내 현황에서 회사의 허용을 받아야 다른 메뉴에 접근할 수 있습니다.');
                        } else {
                          setOverflowOpen(false);
                          onCloseDrawer?.();
                        }
                      }}
                    >
                      <span className="material-symbols-outlined">{item.icon}</span>
                      <span>{item.label}</span>
                      {isLocked ? (
                        <span className="material-symbols-outlined sidebar-lock-icon" aria-hidden>
                          lock
                        </span>
                      ) : null}
                    </NavLink>
                  </div>
                );
              })}

              {overflowItems.length > 0 ? (
                <div
                  data-sidebar-drop-zone="overflow"
                  data-sidebar-drop-to={DROP_END}
                  className={`sidebar-overflow-end-drop ${dragOverDrop?.zone === 'overflow' && dragOverDrop?.to === DROP_END ? 'sidebar-nav-item-drag-over' : ''}`}
                  onDragOver={handleOverflowEndDragOver}
                  onDrop={(e) => handleOverflowDrop(e, DROP_END)}
                >
                  맨 아래에 놓기
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </nav>
      {savingOrder && (
        <div className="sidebar-order-saving" aria-live="polite">
          레이아웃 저장 중…
        </div>
      )}
      <div className="sidebar-footer">
        <Link to="/register?edit=1" className="sidebar-user sidebar-user-clickable">
          <div className="sidebar-avatar" />
          <div className="sidebar-user-info">
            <p className="sidebar-user-name">{user?.name || '사용자'}</p>
            <p className="sidebar-user-role">{departmentLabel}</p>
          </div>
        </Link>
        <button type="button" className="sidebar-logout" onClick={() => { localStorage.removeItem('crm_token'); localStorage.removeItem('crm_user'); navigate('/login', { replace: true }); }}>
          <span className="material-symbols-outlined">logout</span>
          <span>로그아웃</span>
        </button>
      </div>
    </aside>
  );
}
