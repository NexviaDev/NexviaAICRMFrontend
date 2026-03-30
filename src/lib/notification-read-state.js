const STORAGE_KEY = 'crm_notification_last_seen_at';

/** @param {unknown} notifications */
function maxPublishedAtMs(notifications) {
  if (!Array.isArray(notifications) || notifications.length === 0) return null;
  let max = 0;
  for (const n of notifications) {
    const t = new Date(n?.publishedAt || n?.createdAt || 0).getTime();
    if (!Number.isNaN(t) && t > max) max = t;
  }
  return max > 0 ? max : null;
}

export function getLastSeenPublishedAtMs() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * 공지 페이지를 열었을 때 호출 — 현재 목록 기준으로 모두 읽음 처리.
 * @param {unknown[]} notifications
 */
export function markNotificationsAsSeen(notifications) {
  const max = maxPublishedAtMs(notifications);
  const prev = getLastSeenPublishedAtMs();
  if (max == null) {
    if (prev == null) localStorage.setItem(STORAGE_KEY, new Date().toISOString());
  } else {
    const nextMs = prev == null ? max : Math.max(prev, max);
    localStorage.setItem(STORAGE_KEY, new Date(nextMs).toISOString());
  }
  try {
    window.dispatchEvent(new CustomEvent('crm-notifications-seen'));
  } catch {
    /* ignore */
  }
}

/**
 * @param {unknown[]} notifications
 */
export function hasUnreadNotifications(notifications) {
  if (!Array.isArray(notifications) || notifications.length === 0) return false;
  const max = maxPublishedAtMs(notifications);
  if (max == null) return false;
  const lastSeen = getLastSeenPublishedAtMs();
  if (lastSeen == null) return true;
  return max > lastSeen;
}

/**
 * GET /notifications/badge 의 latestPublishedAt(ISO)과 로컬 읽음 시각 비교.
 * @param {string | null | undefined} iso
 */
export function hasUnreadFromLatestPublishedAt(iso) {
  if (iso == null || iso === '') return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const lastSeen = getLastSeenPublishedAtMs();
  if (lastSeen == null) return true;
  return t > lastSeen;
}
