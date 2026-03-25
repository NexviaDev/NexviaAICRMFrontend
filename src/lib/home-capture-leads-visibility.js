/**
 * 홈 대시보드「수신 리드」표시 여부 (브라우저·계정별 localStorage).
 * - permanent: 완료 체크 시 목록에서 제외(복구 UI 없음)
 * - snoozed: { [leadId]: ISO } — 해당 시각 이전까지 숨김, 이후 다시 표시
 */

const STORAGE_PREFIX = 'crm_home_capture_leads_';

export function getLeadVisibilityUserKey() {
  try {
    const u = JSON.parse(localStorage.getItem('crm_user') || '{}');
    return String(u._id || u.id || u.email || 'anon');
  } catch {
    return 'anon';
  }
}

export function loadHomeCaptureLeadVisibility(userKey) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + userKey);
    if (!raw) return { permanent: [], snoozed: {} };
    const j = JSON.parse(raw);
    return {
      permanent: Array.isArray(j.permanent) ? j.permanent.map(String) : [],
      snoozed: j.snoozed && typeof j.snoozed === 'object' && !Array.isArray(j.snoozed) ? { ...j.snoozed } : {}
    };
  } catch {
    return { permanent: [], snoozed: {} };
  }
}

function pruneExpiredSnoozes(snoozed) {
  const now = Date.now();
  const next = {};
  Object.entries(snoozed).forEach(([id, iso]) => {
    const t = new Date(iso).getTime();
    if (!Number.isNaN(t) && t > now) next[id] = iso;
  });
  return next;
}

export function saveHomeCaptureLeadVisibility(userKey, { permanent, snoozed }) {
  try {
    const perm = [...new Set((permanent || []).map(String))];
    const cleaned = pruneExpiredSnoozes(snoozed || {});
    localStorage.setItem(STORAGE_PREFIX + userKey, JSON.stringify({ permanent: perm, snoozed: cleaned }));
  } catch (_) {}
}

export function isLeadVisibleInHome(leadId, { permanent, snoozed }) {
  const id = String(leadId);
  if (permanent.includes(id)) return false;
  const iso = snoozed[id];
  if (!iso) return true;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() >= t;
}

export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
