/**
 * opportunity-modal 전용 순수 유틸·Drive 보조 API.
 * UI/상태 없음 — 단위 테스트·재사용 용이.
 */
import { API_BASE } from '@/config';
import { sanitizeDriveFolderWebViewLink } from '@/lib/google-drive-url';
import {
  parseNumber,
  newCommissionRecipientId,
  createEmptyCommissionRow
} from '@/lib/sales-opportunity-form-shared';
import { getStoredCrmUser } from '@/lib/crm-role-utils';

export function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function newDocMailAddressBookId() {
  return `dm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 쉼표·세미콜론·줄바꿈으로 구분된 주소 문자열을 합치고 중복 제거 */
export function mergeEmailListStrings(...parts) {
  const set = new Set();
  for (const p of parts) {
    String(p || '')
      .split(/[,;\n\r]+/)
      .forEach((x) => {
        const t = x.trim();
        if (t) set.add(t);
      });
  }
  return Array.from(set).join(', ');
}

export function normalizeMongoIdCandidate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'object' && v?._id != null) return String(v._id).trim();
  return String(v).trim();
}

export function isLikelyMongoObjectId(v) {
  return /^[a-f0-9]{24}$/i.test(normalizeMongoIdCandidate(v));
}

export const PRODUCT_BILLING_LABELS = { Monthly: '월간', Annual: '연간', Perpetual: '영구' };

export function getInitialInternalAssignee() {
  try {
    const u = getStoredCrmUser();
    return {
      assignedToUserId: u?._id ? String(u._id) : '',
      assignedToName: (u?.name && String(u.name).trim()) || ''
    };
  } catch (_) {
    return { assignedToUserId: '', assignedToName: '' };
  }
}

/**
 * 수금 행을 날짜 오름차순으로 누적했을 때, 누적액이 계약금 이상이 되는 **그날**(그 행의 날짜).
 * 같은 날짜에 여러 행이 있으면 그날 누적이 넘는 첫 행 기준(날짜 문자열은 동일).
 */
export function fullCollectionDateFromCumulativeEntries(collectionEntries, contractTarget) {
  const target = Math.max(0, contractTarget);
  if (target <= 0) return '';

  const rows = (collectionEntries || [])
    .map((e) => ({
      amt: Math.max(0, parseNumber(e?.amount)),
      d: String(e?.date || '').trim()
    }))
    .filter((r) => r.amt > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.d))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));

  let cum = 0;
  for (const r of rows) {
    cum += r.amt;
    if (cum >= target) return r.d;
  }
  return '';
}

export function newCollectionEntryId() {
  return `collection-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** 행에 commissionRecipients가 아직 없을 때(레거시·예외) 안정적인 단일 빈 행 id */
export function emptyCommissionRowForLine(lineId) {
  return { id: `comm-blank-${lineId}`, remarks: '', commissionAmount: '' };
}

function legacyCommissionRemarksFromServerRow(r) {
  const rem = String(r?.remarks || '').trim();
  if (rem) return rem;
  const name = String(r?.recipientName || '').trim();
  const phone = String(r?.recipientPhone || '').trim();
  if (!name && !phone) return '';
  return [name, phone].filter(Boolean).join(' · ');
}

export function mapServerCommissionRowsToClient(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  if (arr.length === 0) return [createEmptyCommissionRow()];
  return arr.map((r) => ({
    id: newCommissionRecipientId(),
    remarks: legacyCommissionRemarksFromServerRow(r).slice(0, 2000),
    commissionAmount: Number(r?.commissionAmount) > 0 ? Number(r.commissionAmount).toLocaleString() : ''
  }));
}

export function clientLineCommissionHasData(rows) {
  if (!Array.isArray(rows)) return false;
  return rows.some(
    (r) => String(r?.remarks || '').trim() || parseNumber(r?.commissionAmount) > 0
  );
}

export function computeLineFinalAmount(line) {
  const qty = Math.max(0, Number(line.quantity) || 1);
  const unit = parseNumber(line.unitPrice) || 0;
  let subtotal = qty * unit;
  const dRate = Math.max(0, Math.min(100, Number(line.discountRate) || 0));
  const dAmount = parseNumber(line.discountAmount) || 0;
  if (dRate > 0) subtotal = subtotal * (1 - dRate / 100);
  subtotal = Math.max(0, subtotal - dAmount);
  return Math.round(subtotal);
}

export function computeLineDeduction(line) {
  const qty = Math.max(0, Number(line.quantity) || 1);
  const unit = parseNumber(line.unitPrice) || 0;
  const subtotal = qty * unit;
  return Math.max(0, subtotal - computeLineFinalAmount(line));
}

export function getCurrentUserId() {
  try {
    const raw = localStorage.getItem('crm_user');
    const u = raw ? JSON.parse(raw) : null;
    return u?._id || u?.id || null;
  } catch {
    return null;
  }
}

export function formatCommentDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

/** customer-company-detail-modal.js `toDatetimeLocalValue` 와 동일 */
export function toDatetimeLocalValue(date) {
  if (!date) return '';
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

/** `<input type="date" />` 용 (로컬 날짜) */
export function toDateInputValue(date) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 날짜 입력 기본값: 오늘(로컬) */
export function todayDateInputValue() {
  return toDateInputValue(new Date());
}

/** `YYYY-MM-DD` 문자열을 로컬 자정으로 파싱. 형식 불일치 시 null */
export function localMidnightFromYyyyMmDd(s) {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

/** 수주일이 «오늘»보다 미래인지(갱신 사전 알림일 등). 비교는 로컬 달력 기준 */
export function isYyyyMmDdStrictlyAfterToday(dateStr) {
  const d = localMidnightFromYyyyMmDd(dateStr);
  if (!d) return false;
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return d > t;
}

export function isCommentAuthor(comment, userId) {
  if (userId == null || !comment?.userId) return false;
  return String(comment.userId) === String(userId);
}

export function sanitizeFolderNamePart(s, maxLen) {
  const t = String(s ?? '')
    .replace(/[/\\*?:<>"|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (maxLen == null || maxLen <= 0) return t;
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

export function getDriveFolderIdFromLink(url) {
  if (!url || typeof url !== 'string') return null;
  const s = url.trim();
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  try {
    const u = new URL(s);
    const id = u.searchParams.get('id');
    if (id && /^[a-zA-Z0-9_-]+$/.test(id) && id.length >= 10 && id.length <= 128) return id;
  } catch (_) {
    /* ignore */
  }
  return null;
}

/** Drive API listFiles — 폴더 항목 제외용 */
export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

/** 담당자의 소속사 문자열로 고객사 DB에서 한 건 매칭 (정확 일치 우선) */
export async function resolveCustomerCompanyByAffiliationName(nameTrim) {
  if (!nameTrim) return null;
  const res = await fetch(`${API_BASE}/customer-companies?search=${encodeURIComponent(nameTrim)}&limit=40`, { headers: getAuthHeader() });
  const data = await res.json().catch(() => ({}));
  const items = Array.isArray(data.items) ? data.items : [];
  const lower = nameTrim.toLowerCase();
  const exact = items.find((c) => (c.name || '').trim().toLowerCase() === lower);
  return exact || items[0] || null;
}

export async function fetchRegisteredDriveParentId() {
  const rootRes = await fetch(`${API_BASE}/custom-field-definitions/drive-root`, { headers: getAuthHeader() });
  const rootJson = await rootRes.json().catch(() => ({}));
  const driveRootUrl = (rootJson.driveRootUrl != null && String(rootJson.driveRootUrl).trim()) ? String(rootJson.driveRootUrl).trim() : '';
  return getDriveFolderIdFromLink(driveRootUrl);
}

/** customer-company-employees-detail-modal Drive 로직과 동일한 기본 폴더명 */
export async function buildContactBaseFolderName(contact) {
  const ccId = contact.customerCompanyId?._id ?? contact.customerCompanyId ?? null;
  if (ccId) {
    let ccName = contact.customerCompanyId?.name || contact.company || '';
    let ccBn = contact.customerCompanyId?.businessNumber || '';
    if (!ccName || !ccBn) {
      try {
        const ccRes = await fetch(`${API_BASE}/customer-companies/${ccId}`, { headers: getAuthHeader() });
        const ccData = await ccRes.json().catch(() => ({}));
        if (ccRes.ok && ccData._id) {
          ccName = ccData.name || ccName;
          ccBn = ccData.businessNumber || ccBn;
        }
      } catch (_) { /* ignore */ }
    }
    const bnPart = String(ccBn || '').replace(/\D/g, '') || '미등록';
    return `${sanitizeFolderNamePart(ccName || '미소속', 80)}_${sanitizeFolderNamePart(bnPart, 20)}`;
  }
  const namePart = sanitizeFolderNamePart(contact.name || '이름없음', 80);
  const contactPart = sanitizeFolderNamePart(contact.phone || contact.email || '미등록', 40);
  return `${namePart}_${contactPart}`;
}

/** 개인 구매 등: 항상 [이름]_[연락처] 폴더명 (고객사 소속이 있어도 동일 규칙으로 강제) */
export function buildPersonalContactFolderName(contact) {
  const namePart = sanitizeFolderNamePart(contact?.name || '이름없음', 80);
  const contactPart = sanitizeFolderNamePart(contact?.phone || contact?.email || '미등록', 40);
  return `${namePart}_${contactPart}`;
}

/**
 * 연락처 증서·자료 루트만 ensure — 제품별 하위 폴더는 만들지 않음. 고객사 DB 확정이면 고객사 폴더와 동일.
 * @param {{ forcePersonalFolder?: boolean }} [opts] — true면 고객사가 있어도 개인 폴더 규칙으로만 생성
 */
export async function ensureOppContactDriveRoot(contact, opts = {}) {
  const forcePersonal = opts.forcePersonalFolder === true;
  const ccRaw = contact.customerCompanyId;
  const ccId = ccRaw?._id ?? ccRaw ?? null;
  const bn =
    typeof ccRaw === 'object' && ccRaw != null && ccRaw.businessNumber != null
      ? String(ccRaw.businessNumber).trim()
      : '';
  const hasConfirmedCompany = ccId && bn;

  if (hasConfirmedCompany && !forcePersonal) {
    const folderName = await buildContactBaseFolderName(contact);
    const r = await fetch(`${API_BASE}/drive/folders/ensure`, {
      method: 'POST',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ folderName, customerCompanyId: String(ccId) })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.id) {
      return { ok: false, error: data.error || '폴더를 준비할 수 없습니다.', id: null, webViewLink: '' };
    }
    const webViewLink =
      sanitizeDriveFolderWebViewLink(data.webViewLink, data.id) || `https://drive.google.com/drive/folders/${data.id}`;
    return { ok: true, id: data.id, webViewLink, error: '' };
  }

  const registeredFolderId = await fetchRegisteredDriveParentId();
  if (!registeredFolderId) {
    return { ok: false, error: 'Google Drive 등록 폴더를 찾을 수 없습니다.', id: null, webViewLink: '' };
  }
  const baseFolderName = forcePersonal ? buildPersonalContactFolderName(contact) : await buildContactBaseFolderName(contact);
  const r = await fetch(`${API_BASE}/drive/folders/ensure`, {
    method: 'POST',
    headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      folderName: baseFolderName,
      parentFolderId: registeredFolderId,
      customerCompanyEmployeeId: String(contact._id)
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.id) {
    return { ok: false, error: data.error || '연락처 폴더를 준비할 수 없습니다.', id: null, webViewLink: '' };
  }
  const webViewLink =
    sanitizeDriveFolderWebViewLink(data.webViewLink, data.id) || `https://drive.google.com/drive/folders/${data.id}`;
  return { ok: true, id: data.id, webViewLink, error: '' };
}

export function fileToBase64(file) {
  return file.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  });
}

/** 평면 코멘트 배열 → 루트 목록 + 부모 id → 자식 배열 맵 */
export function organizeComments(comments) {
  const list = Array.isArray(comments) ? [...comments] : [];
  const byId = new Map();
  list.forEach((c) => {
    const id = c?._id != null ? String(c._id) : c?.id != null ? String(c.id) : '';
    if (id) byId.set(id, c);
  });
  const sortByDate = (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  const childrenMap = new Map();
  const roots = [];
  list.forEach((c) => {
    const id = c?._id != null ? String(c._id) : c?.id != null ? String(c.id) : '';
    if (!id) return;
    const pid = c.parentCommentId != null ? String(c.parentCommentId) : '';
    if (!pid || !byId.has(pid)) {
      roots.push(c);
    } else {
      if (!childrenMap.has(pid)) childrenMap.set(pid, []);
      childrenMap.get(pid).push(c);
    }
  });
  roots.sort(sortByDate);
  childrenMap.forEach((arr) => arr.sort(sortByDate));
  return { roots, childrenMap };
}
