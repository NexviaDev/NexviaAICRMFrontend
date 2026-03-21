import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { NavLink, useNavigate, Link } from 'react-router-dom';
import { getSavedSidebarOrder, patchSidebarOrder, setSavedSidebarOrderLocally } from '@/lib/list-templates';
import './sidebar.css';

/** 메뉴 항목 정의 (추가 시 여기만 수정하면 되고, 저장된 순서와 병합됨). 아이콘은 중복 없이 구분되도록 지정. */
const MENU_ITEMS = [
  { to: '/', icon: 'dashboard', label: '대시보드' },
  { to: '/company-overview', icon: 'domain', label: '사내 현황' },
  { to: '/customer-companies', icon: 'business', label: '고객사 리스트' },
  { to: '/customer-company-employees', icon: 'group', label: '연락처 리스트' },
  { to: '/product-list', icon: 'inventory_2', label: '제품 리스트' },
  { to: '/calendar', icon: 'calendar_month', label: '캘린더' },
  { to: '/meeting-minutes', icon: 'event_note', label: '회의 일지' },
  { to: '/ai-voice', icon: 'mic', label: 'AI 음성 기록' },
  { to: '/email', icon: 'mail', label: '이메일' },
  { to: '/map', icon: 'map', label: '지도' },
  { to: '/todo-list', icon: 'check_box', label: '할 일' },
  { to: '/chat', icon: 'chat', label: 'Chat' },
  { to: '/sales-pipeline', icon: 'view_kanban', label: '세일즈 현황' },
  { to: '/lead-capture', icon: 'ads_click', label: '리드 캡처' },
  { to: '/reports/sales', icon: 'bar_chart', label: '리포트' },
  { to: '/reports/performance', icon: 'trending_up', label: '실적' },
  { to: '/reports/work-report', icon: 'summarize', label: '업무 보고' },
  { to: '#', icon: 'settings', label: '설정' }
];

/** 저장된 순서와 기본 메뉴를 병합 (저장에 없는 새 메뉴는 맨 뒤에) */
function applyOrder(items, order) {
  if (!order || order.length === 0) return [...items];
  const byTo = new Map(items.map((i) => [i.to, i]));
  const ordered = order.map((to) => byTo.get(to)).filter(Boolean);
  const rest = items.filter((i) => !order.includes(i.to));
  return [...ordered, ...rest];
}

function formatCompanyRole(user) {
  if (user?.role === 'owner') return '대표 (Owner)';
  if (user?.role === 'senior') return '책임 (Senior)';
  if (user?.role === 'pending') return '권한 대기';
  if (user?.role === 'staff') return '직원 (Staff)';
  return user?.role || '계정';
}

function isPendingBlockedMenu(user, to) {
  if (user?.role !== 'pending') return false;
  return to !== '/company-overview';
}

export default function Sidebar({ drawerOpen, onCloseDrawer, currentUser }) {
  const navigate = useNavigate();
  const savedOrder = useMemo(() => getSavedSidebarOrder(), []);
  const [orderedItems, setOrderedItems] = useState(() => applyOrder(MENU_ITEMS, savedOrder));
  const [draggingTo, setDraggingTo] = useState(null);
  const [dragOverTo, setDragOverTo] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const draggedToRef = useRef(null);
  const orderedItemsRef = useRef(orderedItems);

  orderedItemsRef.current = orderedItems;

  useEffect(() => {
    const order = getSavedSidebarOrder();
    if (order && order.length > 0) {
      setOrderedItems(applyOrder(MENU_ITEMS, order));
    }
  }, []);

  const storedUser = useMemo(() => {
    try {
      const raw = localStorage.getItem('crm_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);
  const user = currentUser || storedUser;

  const handleDragStart = useCallback((e, itemTo) => {
    e.stopPropagation();
    draggedToRef.current = itemTo;
    setDraggingTo(itemTo);
    e.dataTransfer.setData('text/plain', itemTo);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-sidebar-to', itemTo);
  }, []);

  const handleDragEnd = useCallback(() => {
    draggedToRef.current = null;
    setDraggingTo(null);
    setDragOverTo(null);
  }, []);

  const handleNavDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const row = e.target.closest?.('.sidebar-nav-item');
    const to = row?.getAttribute?.('data-to');
    if (to && to !== draggingTo) setDragOverTo(to);
    else if (!row) setDragOverTo(null);
  }, [draggingTo]);

  const handleNavDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOverTo(null);
  }, []);

  const handleNavDrop = useCallback((e, explicitDropTargetTo) => {
    e.preventDefault();
    e.stopPropagation();
    const row = e.target.closest?.('.sidebar-nav-item');
    const dropTargetTo =
      explicitDropTargetTo ?? row?.getAttribute?.('data-to') ?? dragOverTo;
    setDragOverTo(null);
    const draggedTo =
      draggedToRef.current ||
      e.dataTransfer.getData('text/plain') ||
      e.dataTransfer.getData('application/x-sidebar-to');
    if (!draggedTo || !dropTargetTo || draggedTo === dropTargetTo) return;
    const current = orderedItemsRef.current.map((i) => i.to);
    const fromIdx = current.indexOf(draggedTo);
    const toIdx = current.indexOf(dropTargetTo);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...current];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, draggedTo);
    const reordered = applyOrder(MENU_ITEMS, next);
    setOrderedItems(reordered);
    setSavedSidebarOrderLocally(next);
    setSavingOrder(true);
    patchSidebarOrder(next).catch(() => {}).finally(() => setSavingOrder(false));
  }, [dragOverTo]);

  return (
    <aside className={`sidebar ${drawerOpen ? 'sidebar-drawer-open' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <span className="material-symbols-outlined">hub</span>
        </div>
        <div className="sidebar-brand">
          <h1 className="sidebar-title">Nexvia CRM</h1>
          <p className="sidebar-subtitle">엔터프라이즈</p>
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
      <nav
        className="sidebar-nav"
        onDragOver={handleNavDragOver}
        onDragLeave={handleNavDragLeave}
        onDrop={handleNavDrop}
      >
        {orderedItems.map((item) => (
          (() => {
            const isLocked = isPendingBlockedMenu(user, item.to);
            return (
          <div
            key={item.to}
            data-to={item.to}
            className={`sidebar-nav-item ${draggingTo === item.to ? 'sidebar-nav-item-dragging' : ''} ${dragOverTo === item.to ? 'sidebar-nav-item-drag-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              if (item.to !== draggingTo) setDragOverTo(item.to);
            }}
            onDrop={(e) => handleNavDrop(e, item.to)}
          >
            <span
              className="sidebar-drag-handle"
              draggable
              onDragStart={(e) => handleDragStart(e, item.to)}
              onDragEnd={handleDragEnd}
              title="드래그하여 순서 변경"
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
          })()
        ))}
      </nav>
      {savingOrder && (
        <div className="sidebar-order-saving" aria-live="polite">
          순서 저장 중…
        </div>
      )}
      <div className="sidebar-footer">
        <Link to="/register?edit=1" className="sidebar-user sidebar-user-clickable">
          <div className="sidebar-avatar" />
          <div className="sidebar-user-info">
            <p className="sidebar-user-name">{user?.name || '사용자'}</p>
            <p className="sidebar-user-role">{formatCompanyRole(user)}</p>
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
