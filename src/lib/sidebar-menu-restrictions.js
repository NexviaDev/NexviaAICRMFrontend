import {
  SIDEBAR_CATEGORY_ITEMS,
  SIDEBAR_SUBMENU_ITEMS,
  SIDEBAR_SUBMENU_BY_CATEGORY
} from '@/layout/sidebar-menu-config';
import { hasAdminSiteAccess } from '@/lib/crm-role-utils';

export { SIDEBAR_CATEGORY_ITEMS, SIDEBAR_SUBMENU_ITEMS, SIDEBAR_SUBMENU_BY_CATEGORY };

const ADMIN_SITE_ACCESS_MENU_PATHS = new Set(
  SIDEBAR_SUBMENU_ITEMS.filter((item) => item.adminSiteAccessOnly).map((item) => item.to)
);

function isAdminSiteAccessMenuBlocked(user, menuTo) {
  if (!ADMIN_SITE_ACCESS_MENU_PATHS.has(menuTo)) return false;
  return !hasAdminSiteAccess(user);
}

/** 권한 대기 계정은 사내 현황은 항상 표시 */
export function isSidebarMenuHiddenForUser(user, menuTo) {
  const to = String(menuTo || '').trim();
  if (!to) return false;
  if (user?.role === 'pending' && to === '/company-overview') return false;
  if (isAdminSiteAccessMenuBlocked(user, to)) return true;
  const hidden = user?.hiddenSidebarMenus;
  if (!Array.isArray(hidden) || hidden.length === 0) return false;
  return hidden.includes(to);
}

export function filterSidebarMenuItemForUser(user, item) {
  if (!item) return false;
  return !isSidebarMenuHiddenForUser(user, item.to);
}

function normalizePathname(pathname) {
  const raw = String(pathname || '').split('?')[0].split('#')[0].trim() || '/';
  if (raw.length > 1 && raw.endsWith('/')) return raw.slice(0, -1);
  return raw;
}

/** 현재 URL이 사이드바 메뉴 경로(to) 중 어디에 해당하는지 */
export function resolveSidebarMenuPath(pathname) {
  const path = normalizePathname(pathname);
  if (path === '/dashboard') return '/dashboard';

  let best = null;
  for (const item of SIDEBAR_SUBMENU_ITEMS) {
    const to = item.to;
    if (to === '/dashboard') continue;
    if (path === to || path.startsWith(`${to}/`)) {
      if (!best || to.length > best.length) best = to;
    }
  }
  return best;
}

function canAccessSubscriptionByRole(user) {
  const r = user?.role;
  return r === 'owner' || r === 'admin' || r === 'senior';
}

/** 숨김·권한 제한을 반영한 첫 허용 메뉴 (URL 차단 시 리다이렉트용) */
export function getFirstAllowedSidebarPathForUser(user) {
  if (user?.role === 'pending') return '/company-overview';

  for (const item of SIDEBAR_SUBMENU_ITEMS) {
    if (item.to === '/subscription' && !canAccessSubscriptionByRole(user)) continue;
    if (!isSidebarMenuHiddenForUser(user, item.to)) return item.to;
  }
  return '/company-overview';
}

/** URL 직접 입력 등 — 해당 경로 접근 불가 여부 */
export function isRouteAccessBlockedForUser(user, pathname) {
  const menuPath = resolveSidebarMenuPath(pathname);
  if (!menuPath) return false;
  return isSidebarMenuHiddenForUser(user, menuPath);
}
