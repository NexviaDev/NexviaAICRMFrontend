import { isAdminOrAboveRole } from '@/lib/crm-role-utils';

function uidStr(user) {
  if (!user) return '';
  return String(user._id ?? user.id ?? '').trim();
}

function creatorId(project) {
  if (!project) return '';
  return String(project.createdBy ?? '').trim();
}

function isParticipant(user, project) {
  const uid = uidStr(user);
  if (!uid) return false;
  const parts = Array.isArray(project?.participants) ? project.participants : [];
  return parts.some((p) => p.userId != null && String(p.userId) === uid);
}

/** 백엔드 `projects.js` canEditProject 와 동일 */
export function canEditProject(user, project) {
  if (!user || !project) return false;
  const uid = uidStr(user);
  if (!uid) return false;
  const cid = creatorId(project);
  if (cid && cid === uid) return true;
  if (isAdminOrAboveRole(user.role)) return true;
  return isParticipant(user, project);
}

/** 백엔드 `projects.js` canDeleteProject 와 동일 */
export function canDeleteProject(user, project) {
  if (!user || !project) return false;
  const uid = uidStr(user);
  if (!uid) return false;
  const cid = creatorId(project);
  if (cid && cid === uid) return true;
  return isAdminOrAboveRole(user.role);
}

/** POST /projects — hasConsent. 프론트는 권한 대기(pending) 제외 */
export function canCreateProject(user) {
  if (!user) return false;
  const r = String(user.role || '').trim().toLowerCase();
  return r !== 'pending';
}
