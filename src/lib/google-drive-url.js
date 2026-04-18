/**
 * Google Drive 웹 링크 생성·검증 (잘못된 ID로 /folders/undefined 열리며 Google 404가 나는 것 방지)
 */
import { API_BASE } from '@/config';

export function isValidDriveNodeId(id) {
  if (id == null) return false;
  const s = String(id).trim();
  if (s.length < 10 || s.length > 128) return false;
  const lower = s.toLowerCase();
  if (lower === 'undefined' || lower === 'null' || lower === 'nan') return false;
  return /^[a-zA-Z0-9_-]+$/.test(s);
}

export function buildDriveFolderUrl(folderId) {
  if (!isValidDriveNodeId(folderId)) return '';
  return `https://drive.google.com/drive/folders/${String(folderId).trim()}`;
}

/** Drive 파일 webViewLink 등에서 파일 ID 추출 (사업자등록증 전용 필드와 driveUploadedFiles 구분에 사용) */
export function getDriveFileIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.trim().match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

/** API가 준 webViewLink 가 있으면 그대로, 없거나 이상하면 폴더 ID로 표준 URL */
export function sanitizeDriveFolderWebViewLink(webViewLink, folderId) {
  if (webViewLink && typeof webViewLink === 'string') {
    const t = webViewLink.trim();
    if (t.startsWith('https://drive.google.com/') && !t.includes('undefined')) {
      return t;
    }
  }
  return buildDriveFolderUrl(folderId);
}

/**
 * 새 탭으로 열 폴더 URL — 현재 폴더 ID 우선, 없으면 저장된 링크(유효한 경우만)
 */
export function pickDriveFolderOpenUrl(currentFolderId, storedFolderLink) {
  const fromId = buildDriveFolderUrl(currentFolderId);
  if (fromId) return fromId;
  if (storedFolderLink && typeof storedFolderLink === 'string') {
    const t = storedFolderLink.trim();
    if (t.startsWith('https://drive.google.com/') && !t.includes('undefined')) {
      return t;
    }
  }
  return '';
}

/**
 * DELETE /api/drive/files/:fileId (Drive 휴지통 + 선택 시 CRM driveUploadedFiles $pull)
 * @param {string} fileId
 * @param {{ customerCompanyId?: string, customerCompanyEmployeeId?: string }} [opts]
 */
export function buildDriveFileDeleteUrl(fileId, opts = {}) {
  const qs = new URLSearchParams();
  if (opts.customerCompanyId) qs.set('customerCompanyId', String(opts.customerCompanyId));
  if (opts.customerCompanyEmployeeId) qs.set('customerCompanyEmployeeId', String(opts.customerCompanyEmployeeId));
  const q = qs.toString();
  return `${API_BASE}/drive/files/${encodeURIComponent(String(fileId).trim())}${q ? `?${q}` : ''}`;
}
