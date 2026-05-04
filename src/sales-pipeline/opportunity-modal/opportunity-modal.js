import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import CustomerCompanySearchModal from '../../customer-companies/customer-company-search-modal/customer-company-search-modal';
import CustomerCompanyEmployeesSearchModal from '../../customer-company-employees/customer-company-employees-search-modal/customer-company-employees-search-modal';
import ProductSearchModal from '../product-search-modal/product-search-modal';
import ParticipantModal from '@/shared/participant-modal/participant-modal';
import '../../customer-companies/customer-company-detail-modal/customer-company-detail-modal.css';
import './opportunity-modal.css';
import { RegisterSaleDocsCrmTable, formatDriveFileDate } from '@/shared/register-sale-docs-drive';

import { API_BASE, MAX_DRIVE_JSON_UPLOAD_BYTES } from '@/config';
import {
  buildDriveFolderUrl,
  buildDriveFileDeleteUrl,
  isValidDriveNodeId,
  pickDriveFolderOpenUrl,
  sanitizeDriveFolderWebViewLink
} from '@/lib/google-drive-url';
import { pingBackendHealth } from '@/lib/backend-wake';
import { pruneDriveUploadedFilesIndex, syncDriveUploadedFilesIndex } from '@/lib/drive-uploaded-files-prune';
import { pollJournalFromAudioJob } from '@/lib/journal-from-audio-poll';
import { suggestedPriceFromProduct, OPPORTUNITY_PRICE_BASIS_OPTIONS } from '@/lib/product-price-utils';
import { getUserVisibleApiError } from '@/lib/api-error';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import { buildStageForecastPercentMap } from '../pipeline-forecast-utils';
import { resolveDepartmentDisplayFromChart } from '@/lib/org-chart-tree-utils';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const STAGE_OPTIONS = [
  { value: 'NewLead', label: '신규 리드' },
  { value: 'Contacted', label: '연락 완료' },
  { value: 'ProposalSent', label: '제안서 전달' },
  { value: 'TechDemo', label: '기술 시연' },
  { value: 'Quotation', label: '견적' },
  { value: 'Negotiation', label: '최종 협상' },
  { value: 'Won', label: '수주 성공' },
  { value: 'Lost', label: '기회 상실' },
  { value: 'Abandoned', label: '보류' }
];

const PRODUCT_BILLING_LABELS = { Monthly: '월간', Annual: '연간', Perpetual: '영구' };

function getInitialInternalAssignee() {
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

function formatNumberInput(val) {
  const num = String(val).replace(/[^0-9]/g, '');
  if (!num) return '';
  return Number(num).toLocaleString();
}

function parseNumber(val) {
  return Number(String(val).replace(/[^0-9]/g, '')) || 0;
}

/**
 * 수금 행을 날짜 오름차순으로 누적했을 때, 누적액이 계약금 이상이 되는 **그날**(그 행의 날짜).
 * 같은 날짜에 여러 행이 있으면 그날 누적이 넘는 첫 행 기준(날짜 문자열은 동일).
 */
function fullCollectionDateFromCumulativeEntries(collectionEntries, contractTarget) {
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

function newOppLineId() {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function newCollectionEntryId() {
  return `collection-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function newCommissionRecipientId() {
  return `commission-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function createEmptyCommissionRow() {
  return { id: newCommissionRecipientId(), remarks: '', commissionAmount: '' };
}

/** 행에 commissionRecipients가 아직 없을 때(레거시·예외) 안정적인 단일 빈 행 id */
function emptyCommissionRowForLine(lineId) {
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

function mapServerCommissionRowsToClient(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  if (arr.length === 0) return [createEmptyCommissionRow()];
  return arr.map((r) => ({
    id: newCommissionRecipientId(),
    remarks: legacyCommissionRemarksFromServerRow(r).slice(0, 2000),
    commissionAmount: Number(r?.commissionAmount) > 0 ? Number(r.commissionAmount).toLocaleString() : ''
  }));
}

function clientLineCommissionHasData(rows) {
  if (!Array.isArray(rows)) return false;
  return rows.some(
    (r) => String(r?.remarks || '').trim() || parseNumber(r?.commissionAmount) > 0
  );
}

function computeLineFinalAmount(line) {
  const qty = Math.max(0, Number(line.quantity) || 1);
  const unit = parseNumber(line.unitPrice) || 0;
  let subtotal = qty * unit;
  const dRate = Math.max(0, Math.min(100, Number(line.discountRate) || 0));
  const dAmount = parseNumber(line.discountAmount) || 0;
  if (dRate > 0) subtotal = subtotal * (1 - dRate / 100);
  subtotal = Math.max(0, subtotal - dAmount);
  return Math.round(subtotal);
}

function computeLineDeduction(line) {
  const qty = Math.max(0, Number(line.quantity) || 1);
  const unit = parseNumber(line.unitPrice) || 0;
  const subtotal = qty * unit;
  return Math.max(0, subtotal - computeLineFinalAmount(line));
}

function buildLineFromProduct(product, priceBasisPref = 'consumer') {
  const basis = priceBasisPref === 'channel' ? 'channel' : 'consumer';
  const price = suggestedPriceFromProduct(product, basis);
  const cost = Number(product.costPrice);
  const qty = 1;
  const pc =
    Number.isFinite(cost) && cost >= 0 && qty > 0 ? Math.round(cost * qty).toLocaleString() : '';
  return {
    lineId: newOppLineId(),
    productId: String(product._id),
    productName: product.name || '',
    unitPrice: price > 0 ? price.toLocaleString() : '',
    priceBasis: basis,
    channelDistributor: '',
    quantity: '1',
    discountRate: '',
    discountAmount: '',
    purchaseCostTotal: pc,
    commissionRecipients: [createEmptyCommissionRow()]
  };
}

function getCurrentUserId() {
  try {
    const raw = localStorage.getItem('crm_user');
    const u = raw ? JSON.parse(raw) : null;
    return u?._id || u?.id || null;
  } catch {
    return null;
  }
}

function formatCommentDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

/** customer-company-detail-modal.js `toDatetimeLocalValue` 와 동일 */
function toDatetimeLocalValue(date) {
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
function toDateInputValue(date) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 날짜 입력 기본값: 오늘(로컬) */
function todayDateInputValue() {
  return toDateInputValue(new Date());
}

/** `YYYY-MM-DD` 문자열을 로컬 자정으로 파싱. 형식 불일치 시 null */
function localMidnightFromYyyyMmDd(s) {
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
function isYyyyMmDdStrictlyAfterToday(dateStr) {
  const d = localMidnightFromYyyyMmDd(dateStr);
  if (!d) return false;
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return d > t;
}

function isCommentAuthor(comment, userId) {
  if (userId == null || !comment?.userId) return false;
  return String(comment.userId) === String(userId);
}

function sanitizeFolderNamePart(s, maxLen) {
  const t = String(s ?? '')
    .replace(/[/\\*?:<>"|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (maxLen == null || maxLen <= 0) return t;
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function getDriveFolderIdFromLink(url) {
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
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

/** 담당자의 소속사 문자열로 고객사 DB에서 한 건 매칭 (정확 일치 우선) */
async function resolveCustomerCompanyByAffiliationName(nameTrim) {
  if (!nameTrim) return null;
  const res = await fetch(`${API_BASE}/customer-companies?search=${encodeURIComponent(nameTrim)}&limit=40`, { headers: getAuthHeader() });
  const data = await res.json().catch(() => ({}));
  const items = Array.isArray(data.items) ? data.items : [];
  const lower = nameTrim.toLowerCase();
  const exact = items.find((c) => (c.name || '').trim().toLowerCase() === lower);
  return exact || items[0] || null;
}

async function fetchRegisteredDriveParentId() {
  const rootRes = await fetch(`${API_BASE}/custom-field-definitions/drive-root`, { headers: getAuthHeader() });
  const rootJson = await rootRes.json().catch(() => ({}));
  const driveRootUrl = (rootJson.driveRootUrl != null && String(rootJson.driveRootUrl).trim()) ? String(rootJson.driveRootUrl).trim() : '';
  return getDriveFolderIdFromLink(driveRootUrl);
}

/** customer-company-employees-detail-modal Drive 로직과 동일한 기본 폴더명 */
async function buildContactBaseFolderName(contact) {
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
function buildPersonalContactFolderName(contact) {
  const namePart = sanitizeFolderNamePart(contact?.name || '이름없음', 80);
  const contactPart = sanitizeFolderNamePart(contact?.phone || contact?.email || '미등록', 40);
  return `${namePart}_${contactPart}`;
}

/**
 * 연락처 증서·자료 루트만 ensure — 제품별 하위 폴더는 만들지 않음. 고객사 DB 확정이면 고객사 폴더와 동일.
 * @param {{ forcePersonalFolder?: boolean }} [opts] — true면 고객사가 있어도 개인 폴더 규칙으로만 생성
 */
async function ensureOppContactDriveRoot(contact, opts = {}) {
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

function fileToBase64(file) {
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
function organizeComments(comments) {
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

export default function OpportunityModal({
  mode, oppId, defaultStage, stageOptions, onClose, onSaved,
  initialCustomerCompany = null, initialContact = null, initialPersonalPurchase = false
}) {
  const isEdit = mode === 'edit';
  const stageSelectOptions = Array.isArray(stageOptions) && stageOptions.length > 0 ? stageOptions : STAGE_OPTIONS;
  const firstStageValue = stageSelectOptions[0]?.value || 'NewLead';
  const [form, setForm] = useState(() => ({
    customerCompanyId: '',
    customerCompanyName: '',
    customerCompanyEmployeeId: '',
    contactName: '',
    currency: 'KRW',
    stage: defaultStage || 'NewLead',
    description: '',
    saleDate: '',
    expectedCloseMonth: '',
    startDate: '',
    targetDate: '',
    contractAmount: '',
    fullCollectionCompleteDate: '',
    invoiceAmount: '',
    invoiceAmountDate: '',
    ...getInitialInternalAssignee()
  }));
  const [collectionEntries, setCollectionEntries] = useState(() => ([
    { id: newCollectionEntryId(), amount: '', date: '' }
  ]));
  /** 제품별 행: 가격 기준·단가·수량·할인·매입원가·기타 금액(표시용) */
  const [lineItems, setLineItems] = useState([]);
  /** 편집 시 GET value — effect 의존용(opportunityValueRef만으로는 리렌더 없음) */
  const [fetchedOppValue, setFetchedOppValue] = useState(0);
  /** productId → 제품 문서(필드 표시·순마진) */
  const [productById, setProductById] = useState({});
  const [businessNumber, setBusinessNumber] = useState(
    String(initialCustomerCompany?.businessNumber ?? initialContact?.customerCompanyBusinessNumber ?? '')
  );
  /** 개인 구매: 고객사 미연결(customerCompanyId 없음) — 이름만 있는 레거시 수주 포함·고객사 필드 비활성 */
  const [personalPurchase, setPersonalPurchase] = useState(false);
  const [channelDistributorList, setChannelDistributorList] = useState([]);
  /** 고객사가 DB에서 선택되고 사업자번호가 있을 때만 고객사 Drive(회사 상세와 동일). 개인 구매 시에는 사용 안 함 */
  const hasConfirmedCompanyDrive =
    !personalPurchase && Boolean((form.customerCompanyId || '').trim() && String(businessNumber || '').trim());
  const isContactOnlyDrive = personalPurchase
    ? Boolean((form.customerCompanyEmployeeId || '').trim())
    : (!hasConfirmedCompanyDrive && Boolean((form.customerCompanyEmployeeId || '').trim()));

  const [driveFolderLink, setDriveFolderLink] = useState('');
  const [driveFolderId, setDriveFolderId] = useState(null);
  const [driveUploading, setDriveUploading] = useState(false);
  const [crmListDropActive, setCrmListDropActive] = useState(false);
  const [driveUploadNotice, setDriveUploadNotice] = useState('');
  const [crmDriveUploads, setCrmDriveUploads] = useState([]);
  /** Drive API로 가져온 동일 폴더의 파일 목록 (웹에서 직접 업로드한 항목 포함) */
  const [driveApiFiles, setDriveApiFiles] = useState([]);
  const [loadingDriveFolderList, setLoadingDriveFolderList] = useState(false);
  const [driveListError, setDriveListError] = useState('');
  const [driveIndexSyncing, setDriveIndexSyncing] = useState(false);
  const [driveOpeningRegisteredLink, setDriveOpeningRegisteredLink] = useState(false);
  const [contactFolderDisplayName, setContactFolderDisplayName] = useState('');
  const [documentRefs, setDocumentRefs] = useState([]);
  const [driveError, setDriveError] = useState('');
  const [driveDocDeletingId, setDriveDocDeletingId] = useState('');
  const fileInputRef = useRef(null);
  const driveRootEnsureInFlightRef = useRef(false);
  const purchaseCostEditedLineIdsRef = useRef(new Set());
  const [showCompanySearchModal, setShowCompanySearchModal] = useState(false);
  const [showContactSearchModal, setShowContactSearchModal] = useState(false);
  const [showProductSearchModal, setShowProductSearchModal] = useState(false);
  const [showInternalAssigneePicker, setShowInternalAssigneePicker] = useState(false);
  /** 사내 담당자 이름 매핑용 (/companies/overview employees) */
  const [companyEmployees, setCompanyEmployees] = useState([]);
  /** overview 응답 company.organizationChart — companyDepartment(노드 id) → 표시명 */
  const [overviewOrgChart, setOverviewOrgChart] = useState(null);

  /** ParticipantModal directory용 — overview 직원 id → _id */
  const teamMembersForParticipantModal = useMemo(
    () =>
      (companyEmployees || []).map((e) => {
        const deptId = String(e.companyDepartment || e.department || '').trim();
        const departmentDisplay =
          String(e.departmentDisplay || '').trim() ||
          resolveDepartmentDisplayFromChart(overviewOrgChart, deptId) ||
          undefined;
        return {
          _id: e.id,
          name: e.name,
          email: e.email,
          phone: e.phone || '',
          companyDepartment: deptId,
          department: e.department || deptId,
          departmentDisplay
        };
      }),
    [companyEmployees, overviewOrgChart]
  );

  /** 모달 열 때 전달: 이미 담당이 있으면 그대로, 없으면 로그인 사용자 1명 기본 */
  const internalAssigneeParticipantSelected = useMemo(() => {
    const uid = (form.assignedToUserId || '').trim();
    if (uid) {
      const nm = (form.assignedToName || '').trim();
      const emp = companyEmployees.find((e) => e?.id != null && String(e.id) === uid);
      return [{ userId: uid, name: nm || (emp?.name && String(emp.name).trim()) || emp?.email || '—' }];
    }
    const me = getStoredCrmUser();
    const myId = me?._id != null ? String(me._id) : '';
    if (!myId) return [];
    const emp = companyEmployees.find((e) => e?.id != null && String(e.id) === myId);
    const nm =
      (emp?.name && String(emp.name).trim()) ||
      (me?.name && String(me.name).trim()) ||
      (me?.email && String(me.email).trim()) ||
      '나';
    return [{ userId: myId, name: nm }];
  }, [form.assignedToUserId, form.assignedToName, companyEmployees]);

  const currentUserForParticipantModal = useMemo(() => {
    const me = getStoredCrmUser();
    return me?._id ? { _id: me._id } : null;
  }, []);

  const [saving, setSaving] = useState(false);
  const [loadingOpp, setLoadingOpp] = useState(false);
  const [error, setError] = useState('');
  const [showProductFields, setShowProductFields] = useState(false);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [journalDateTime, setJournalDateTime] = useState(() => toDatetimeLocalValue(new Date()));
  const [savingJournal, setSavingJournal] = useState(false);
  const [audioUploading, setAudioUploading] = useState(false);
  const [audioDropActive, setAudioDropActive] = useState(false);
  const [journalInputError, setJournalInputError] = useState('');
  const [journalSummaryNotice, setJournalSummaryNotice] = useState(null);
  const oppJournalAudioInputRef = useRef(null);
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [replyingToId, setReplyingToId] = useState(null);
  const [replyText, setReplyText] = useState('');
  /** 서버에서 불러온 직후 단계 — 저장 시 Won→다른 단계면 갱신 캘린더 삭제 반영용 */
  const stageAtLoadRef = useRef(null);
  const fullCollectionDateTouchedRef = useRef(false);
  /** 편집 시 GET 기회의 value(제품 행 없을 때 수주 시 계약금 자동 기입용) */
  const opportunityValueRef = useRef(0);

  const currentUserId = useMemo(() => getCurrentUserId(), []);
  const canDeleteOpportunity = useMemo(() => isAdminOrAboveRole(getStoredCrmUser()?.role), []);
  const canRemoveChannelDistributor = useMemo(() => isAdminOrAboveRole(getStoredCrmUser()?.role), []);

  const removeChannelDistributor = useCallback(
    async (name) => {
      if (!canRemoveChannelDistributor || !name) return;
      try {
        await pingBackendHealth(getAuthHeader);
        const res = await fetch(`${API_BASE}/companies/channel-distributors`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify({ remove: String(name) })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.items)) {
          setChannelDistributorList(data.items);
        } else {
          window.alert(data.error || '유통사를 제거할 수 없습니다.');
        }
      } catch {
        window.alert('유통사를 제거할 수 없습니다.');
      }
    },
    [canRemoveChannelDistributor]
  );

  const fetchOpp = useCallback(async () => {
    if (!isEdit || !oppId) return;
    setFetchedOppValue(0);
    setLoadingOpp(true);
    try {
      const res = await fetch(`${API_BASE}/sales-opportunities/${oppId}`, { headers: getAuthHeader() });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const valueNum = Math.max(0, Number(data.value)) || 0;
      opportunityValueRef.current = valueNum;
      setFetchedOppValue(valueNum);
      const cc = data.customerCompanyId;
      const emp = data.customerCompanyEmployeeId;
      const ccIdHas = !!(cc?._id || cc);
      setPersonalPurchase(!ccIdHas);
      const product = data.productId;
      const loadedStage = data.stage || 'NewLead';
      stageAtLoadRef.current = loadedStage;
      const rawAt = data.assignedTo;
      const atId =
        rawAt && typeof rawAt === 'object' && rawAt._id != null
          ? String(rawAt._id)
          : rawAt
            ? String(rawAt)
            : '';
      const ym = data.expectedCloseMonth != null ? String(data.expectedCloseMonth).trim() : '';
      const contractAmountValue = Number(data.contractAmount) > 0 ? Number(data.contractAmount).toLocaleString() : '';
      const invoiceAmountValue = Number(data.invoiceAmount) > 0 ? Number(data.invoiceAmount).toLocaleString() : '';
      setForm({
        customerCompanyId: cc?._id || cc || '',
        customerCompanyName: cc?.name || '',
        customerCompanyEmployeeId: emp?._id || emp || '',
        contactName: data.contactName || '',
        currency: data.currency || 'KRW',
        stage: loadedStage,
        description: data.description || '',
        saleDate: toDateInputValue(data.saleDate) || '',
        expectedCloseMonth: /^\d{4}-\d{2}$/.test(ym) ? ym : '',
        startDate: toDateInputValue(data.startDate),
        targetDate: toDateInputValue(data.targetDate),
        contractAmount: contractAmountValue,
        fullCollectionCompleteDate: toDateInputValue(data.fullCollectionCompleteDate),
        invoiceAmount: invoiceAmountValue,
        invoiceAmountDate: toDateInputValue(data.invoiceAmountDate),
        assignedToUserId: atId,
        assignedToName: (data.assignedToName && String(data.assignedToName).trim()) || ''
      });
      const loadedCollections = Array.isArray(data.collectionEntries) ? data.collectionEntries : [];
      setCollectionEntries(
        loadedCollections.length > 0
          ? loadedCollections.map((entry) => ({
            id: newCollectionEntryId(),
            amount: Number(entry?.amount) > 0 ? Number(entry.amount).toLocaleString() : '',
            date: toDateInputValue(entry?.date)
          }))
          : [{ id: newCollectionEntryId(), amount: '', date: '' }]
      );
      const loadedComm = Array.isArray(data.commissionRecipients) ? data.commissionRecipients : [];
      fullCollectionDateTouchedRef.current = Boolean(data.fullCollectionCompleteDate);
      purchaseCostEditedLineIdsRef.current = new Set();

      const mapServerLineToClient = (li, idx) => {
        const pid = li.productId?._id || li.productId;
        const qty = li.quantity ?? 1;
        const unit = li.unitPrice ?? 0;
        const rate = li.discountRate ?? 0;
        const amt = li.discountAmount ?? 0;
        const snapCost = Number(li.productCostPriceSnapshot) || 0;
        const pc = snapCost > 0 && qty > 0 ? Math.round(snapCost * qty).toLocaleString() : '';
        return {
          lineId: `loaded-${idx}-${pid || idx}`,
          productId: pid ? String(pid) : '',
          productName: li.productName || li.productId?.name || '',
          unitPrice: unit > 0 ? unit.toLocaleString() : '',
          priceBasis: li.unitPriceBasis === 'channel' ? 'channel' : 'consumer',
          channelDistributor: String(li.channelDistributor || '').trim(),
          quantity: String(qty),
          discountRate: rate > 0 ? String(rate) : '',
          discountAmount: amt > 0 ? amt.toLocaleString() : '',
          purchaseCostTotal: pc,
          commissionRecipients: mapServerCommissionRowsToClient(li.commissionRecipients)
        };
      };

      if (Array.isArray(data.lineItems) && data.lineItems.length > 0) {
        let clientLines = data.lineItems.map(mapServerLineToClient);
        if (
          loadedComm.length > 0 &&
          !clientLines.some((l) => clientLineCommissionHasData(l.commissionRecipients))
        ) {
          clientLines = clientLines.map((l, i) =>
            i === 0 ? { ...l, commissionRecipients: mapServerCommissionRowsToClient(loadedComm) } : l
          );
        }
        setLineItems(clientLines);
        const nextDocs = {};
        for (let i = 0; i < data.lineItems.length; i++) {
          const li = data.lineItems[i];
          const pid = li.productId?._id || li.productId;
          if (!pid || nextDocs[String(pid)]) continue;
          try {
            const pres = await fetch(`${API_BASE}/products/${pid}`, { headers: getAuthHeader() });
            if (pres.ok) {
              const pdoc = await pres.json();
              if (pdoc?._id) nextDocs[String(pid)] = pdoc;
            }
          } catch {
            /* ignore */
          }
        }
        setProductById(nextDocs);
      } else {
        const qty = data.quantity ?? 1;
        const unit = data.unitPrice ?? 0;
        const unitForDisplay = unit > 0 ? unit : (data.value && qty >= 1 ? Math.round(data.value / qty) : 0);
        const rate = data.discountRate ?? (data.discountType === 'rate' ? data.discountValue : 0);
        const amt = data.discountAmount ?? (data.discountType === 'amount' ? data.discountValue : 0);
        const loadedProductId = product?._id || product || '';
        const snapCost = Number(data.productCostPriceSnapshot) || 0;
        const pc = snapCost > 0 && qty > 0 ? Math.round(snapCost * qty).toLocaleString() : '';
        if (loadedProductId) {
          setLineItems([
            {
              lineId: `legacy-${loadedProductId}`,
              productId: String(loadedProductId),
              productName: product?.name || '',
              unitPrice: unitForDisplay > 0 ? unitForDisplay.toLocaleString() : '',
              priceBasis: data.unitPriceBasis === 'channel' ? 'channel' : 'consumer',
              channelDistributor: String(data.channelDistributor || '').trim(),
              quantity: String(qty),
              discountRate: rate > 0 ? String(rate) : '',
              discountAmount: amt > 0 ? amt.toLocaleString() : '',
              purchaseCostTotal: pc,
              commissionRecipients: mapServerCommissionRowsToClient(loadedComm)
            }
          ]);
          try {
            const pres = await fetch(`${API_BASE}/products/${loadedProductId}`, { headers: getAuthHeader() });
            if (pres.ok) {
              const pdoc = await pres.json();
              if (pdoc?._id) setProductById({ [String(loadedProductId)]: pdoc });
              else setProductById({});
            } else setProductById({});
          } catch {
            setProductById({});
          }
        } else {
          setLineItems([]);
          setProductById({});
        }
      }
      setBusinessNumber(String(cc?.businessNumber ?? ''));
      setDriveFolderLink(String(data.driveFolderLink || ''));
      setDriveFolderId(getDriveFolderIdFromLink(String(data.driveFolderLink || '')));
      const ccIdLoad = cc?._id || cc || '';
      const empIdLoad = emp?._id || emp || '';
      const bnLoad = String(cc?.businessNumber ?? '').trim();
      if (ccIdLoad && bnLoad) {
        try {
          const cres = await fetch(`${API_BASE}/customer-companies/${ccIdLoad}`, { headers: getAuthHeader() });
          const cdata = await cres.json().catch(() => ({}));
          if (cres.ok && cdata?._id) {
            setCrmDriveUploads(Array.isArray(cdata.driveUploadedFiles) ? cdata.driveUploadedFiles : []);
          }
        } catch (_) {
          setCrmDriveUploads([]);
        }
      } else if (empIdLoad) {
        try {
          const eres = await fetch(`${API_BASE}/customer-company-employees/${empIdLoad}`, { headers: getAuthHeader() });
          const edata = await eres.json().catch(() => ({}));
          if (eres.ok && edata?._id) {
            setCrmDriveUploads(Array.isArray(edata.driveUploadedFiles) ? edata.driveUploadedFiles : []);
          }
        } catch (_) {
          setCrmDriveUploads([]);
        }
      } else {
        setCrmDriveUploads([]);
      }
      setDocumentRefs(Array.isArray(data.documentRefs)
        ? data.documentRefs.map((url) => (typeof url === 'string' ? { url, name: '파일' } : { url: url?.url, name: url?.name || '파일' })).filter((d) => d?.url)
        : []);
      setShowProductFields(false);
      setComments(Array.isArray(data.comments) ? data.comments : []);
      setNewComment('');
      setJournalDateTime(toDatetimeLocalValue(new Date()));
      setJournalInputError('');
      setJournalSummaryNotice(null);
      setCommentError('');
      setEditingCommentId(null);
      setEditDraft('');
      setReplyingToId(null);
      setReplyText('');
    } catch {
      setError('기회 정보를 불러올 수 없습니다.');
    } finally {
      setLoadingOpp(false);
    }
  }, [isEdit, oppId]);

  useEffect(() => {
    fetchOpp();
  }, [fetchOpp]);

  useEffect(() => {
    if (!isEdit) setFetchedOppValue(0);
  }, [isEdit]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/companies/overview`, { headers: getAuthHeader() })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data?.employees)) setCompanyEmployees(data.employees);
        setOverviewOrgChart(data?.company?.organizationChart ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /** 편집 시 서버에 이름만 비어 있는 경우 overview 직원 목록으로 보강 */
  useEffect(() => {
    const uid = (form.assignedToUserId || '').trim();
    if (!uid || (form.assignedToName || '').trim()) return;
    const emp = companyEmployees.find((e) => e?.id != null && String(e.id) === uid);
    if (!emp?.name) return;
    setForm((f) => ({ ...f, assignedToName: String(emp.name).trim() }));
  }, [companyEmployees, form.assignedToUserId, form.assignedToName]);

  useEffect(() => {
    if (isEdit) return;
    if (initialCustomerCompany?._id || initialCustomerCompany?.name) {
      setForm((f) => ({
        ...f,
        customerCompanyId: initialCustomerCompany?._id || f.customerCompanyId,
        customerCompanyName: initialCustomerCompany?.name || f.customerCompanyName
      }));
      setBusinessNumber(String(initialCustomerCompany?.businessNumber ?? ''));
    } else if (initialContact?._id || initialContact?.name) {
      const icc = initialContact?.customerCompanyId;
      const hasIc = !!(icc && (typeof icc === 'object' ? icc._id : icc));
      const forcePersonal = initialPersonalPurchase === true;
      if (!hasIc || forcePersonal) setPersonalPurchase(true);
      const attachCompany = hasIc && !forcePersonal;
      setForm((f) => ({
        ...f,
        contactName: initialContact?.name || f.contactName,
        customerCompanyEmployeeId: initialContact?._id || f.customerCompanyEmployeeId,
        ...(attachCompany
          ? {
              customerCompanyId: typeof icc === 'object' ? icc._id : icc,
              customerCompanyName: (typeof icc === 'object' ? icc.name : '') || initialContact?.customerCompanyName || ''
            }
          : { customerCompanyId: '', customerCompanyName: '' })
      }));
      setBusinessNumber(
        attachCompany
          ? String(
              initialContact?.customerCompanyBusinessNumber ??
                (typeof icc === 'object' && icc != null ? icc.businessNumber : '') ??
                ''
            )
          : ''
      );
    }
  }, [isEdit, initialCustomerCompany, initialContact, initialPersonalPurchase]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showProductSearchModal) setShowProductSearchModal(false);
      else if (showInternalAssigneePicker) setShowInternalAssigneePicker(false);
      else if (showContactSearchModal) setShowContactSearchModal(false);
      else if (showCompanySearchModal) setShowCompanySearchModal(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    onClose,
    showCompanySearchModal,
    showContactSearchModal,
    showProductSearchModal,
    showInternalAssigneePicker
  ]);

  /** 단계 미선택(또는 현재 단계가 옵션에 없음)인 경우 첫 번째 단계를 자동 선택 */
  useEffect(() => {
    const available = stageSelectOptions.map((s) => s.value);
    setForm((prev) => {
      if (prev.stage && available.includes(prev.stage)) return prev;
      return { ...prev, stage: firstStageValue };
    });
  }, [stageSelectOptions, firstStageValue]);

  const handleChange = (key, val) => {
    setForm((f) => ({ ...f, [key]: val }));
    setError('');
  };

  const handleStageButtonClick = (nextStage) => {
    setError('');
    if (nextStage === 'Won' && form.stage !== 'Won') {
      const saleTrim = String(form.saleDate || '').trim();
      const today = todayDateInputValue();
      /* 수주·판매일(계약일 기준): 미래 사전알림일 등은 실제 수주 전환 시 오늘로 맞춤. 시작일·구매 예정일은 수동 유지 */
      const saleDateNext =
        saleTrim && !isYyyyMmDdStrictlyAfterToday(saleTrim) ? saleTrim : today;
      const lineSum = lineItems.reduce((s, l) => s + computeLineFinalAmount(l), 0);
      const fromValue = opportunityValueRef.current || 0;
      const contractNum = Math.round(lineSum > 0 ? lineSum : fromValue);
      let contractAmountStr = '';
      if (contractNum > 0) contractAmountStr = contractNum.toLocaleString();
      else if (parseNumber(form.contractAmount) > 0) contractAmountStr = form.contractAmount;
      setForm((f) => ({
        ...f,
        stage: 'Won',
        saleDate: saleDateNext,
        ...(contractAmountStr ? { contractAmount: contractAmountStr } : {})
      }));
      return;
    }
    setForm((f) => ({ ...f, stage: nextStage }));
  };

  const handleCollectionAmountChange = (entryId, value) => {
    const nextValue = formatNumberInput(value);
    setCollectionEntries((prev) => prev.map((entry) => (
      entry.id === entryId ? { ...entry, amount: nextValue } : entry
    )));
  };

  const handleCollectionDateChange = (entryId, value) => {
    setCollectionEntries((prev) => prev.map((entry) => (
      entry.id === entryId ? { ...entry, date: value } : entry
    )));
  };

  const addCollectionEntry = () => {
    setCollectionEntries((prev) => [...prev, { id: newCollectionEntryId(), amount: '', date: '' }]);
  };

  const removeCollectionEntry = (entryId) => {
    setCollectionEntries((prev) => {
      if (prev.length <= 1) return [{ id: newCollectionEntryId(), amount: '', date: '' }];
      return prev.filter((entry) => entry.id !== entryId);
    });
  };

  const addCommissionRecipientToLine = (lineId) => {
    setLineItems((prev) =>
      prev.map((l) => {
        if (l.lineId !== lineId) return l;
        const cr =
          Array.isArray(l.commissionRecipients) && l.commissionRecipients.length > 0
            ? l.commissionRecipients
            : [emptyCommissionRowForLine(l.lineId)];
        return { ...l, commissionRecipients: [...cr, createEmptyCommissionRow()] };
      })
    );
  };

  const removeCommissionRecipientFromLine = (lineId, recipientId) => {
    setLineItems((prev) =>
      prev.map((l) => {
        if (l.lineId !== lineId) return l;
        const cr = Array.isArray(l.commissionRecipients) ? l.commissionRecipients.filter((r) => r.id !== recipientId) : [];
        return { ...l, commissionRecipients: cr.length > 0 ? cr : [emptyCommissionRowForLine(l.lineId)] };
      })
    );
  };

  const updateCommissionRecipientOnLine = (lineId, recipientId, patch) => {
    setLineItems((prev) =>
      prev.map((l) => {
        if (l.lineId !== lineId) return l;
        const base =
          Array.isArray(l.commissionRecipients) && l.commissionRecipients.length > 0
            ? l.commissionRecipients
            : [emptyCommissionRowForLine(l.lineId)];
        return {
          ...l,
          commissionRecipients: base.map((r) => (r.id === recipientId ? { ...r, ...patch } : r))
        };
      })
    );
  };

  const driveFolderName = useMemo(() => {
    const namePart = sanitizeFolderNamePart(form.customerCompanyName || '미소속');
    const numPart = sanitizeFolderNamePart(String(businessNumber || '').replace(/\D/g, '')) || '미등록';
    return `${namePart}_${numPart}`;
  }, [form.customerCompanyName, businessNumber]);

  const driveFolderNameDisplay = useMemo(() => {
    if (personalPurchase) {
      return contactFolderDisplayName || '—';
    }
    if (hasConfirmedCompanyDrive) return driveFolderName;
    return '—';
  }, [personalPurchase, hasConfirmedCompanyDrive, driveFolderName, contactFolderDisplayName]);

  useEffect(() => {
    if (!personalPurchase || !form.customerCompanyEmployeeId?.trim()) {
      setContactFolderDisplayName('');
      return;
    }
    let cancelled = false;
    (async () => {
      const cr = await fetch(`${API_BASE}/customer-company-employees/${form.customerCompanyEmployeeId}`, { headers: getAuthHeader() });
      const contact = await cr.json().catch(() => ({}));
      if (cancelled || !cr.ok || !contact?._id) return;
      const name = buildPersonalContactFolderName(contact);
      if (!cancelled) setContactFolderDisplayName(name);
    })();
    return () => { cancelled = true; };
  }, [form.customerCompanyEmployeeId, personalPurchase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await pingBackendHealth(getAuthHeader);
        const res = await fetch(`${API_BASE}/companies/channel-distributors`, { headers: getAuthHeader() });
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok || !Array.isArray(data.items)) return;
        setChannelDistributorList(data.items);
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const lineItemsAutoCostKey = useMemo(
    () => lineItems.map((l) => `${l.lineId}:${l.productId}:${l.quantity}`).join('|'),
    [lineItems]
  );

  /** 매입 원가: 행별 제품·수량 기준 자동(해당 행을 사용자가 직접 수정한 경우는 덮어쓰지 않음) */
  useEffect(() => {
    setLineItems((lines) => {
      let changed = false;
      const next = lines.map((line) => {
        if (!line.productId) {
          if (line.purchaseCostTotal !== '') {
            changed = true;
            return { ...line, purchaseCostTotal: '' };
          }
          return line;
        }
        if (purchaseCostEditedLineIdsRef.current.has(line.lineId)) return line;
        const p = productById[line.productId];
        if (!p) return line;
        const cost = Number(p.costPrice);
        if (!Number.isFinite(cost) || cost < 0) return line;
        const qty = Math.max(0, Number(line.quantity) || 1);
        const formatted = Math.round(cost * qty) > 0 ? Math.round(cost * qty).toLocaleString() : '';
        if (line.purchaseCostTotal === formatted) return line;
        changed = true;
        return { ...line, purchaseCostTotal: formatted };
      });
      return changed ? next : lines;
    });
  }, [productById, lineItemsAutoCostKey]);

  /*
   * 계약금 ↔ 전체 최종(제품 행 합)
   * - 행 합 > 0: 항상 계약금을 행 합과 동일하게 맞춤.
   * - 행 합 === 0: 계약금이 비어 있을 때만 서버 value로 채움(합이 0인데 매번 덮어써서 기존 계약금·value가 사라지는 것 방지).
   */
  useEffect(() => {
    const lineSum = lineItems.reduce((sum, line) => sum + computeLineFinalAmount(line), 0);
    const fromLines = Math.round(lineSum);
    const fromValue = Math.round(Math.max(0, Number(fetchedOppValue) || 0));
    const base = fromLines > 0 ? fromLines : fromValue;
    if (base <= 0) return;
    const formatted = base.toLocaleString();
    setForm((f) => {
      if ((f.contractAmount || '') === formatted) return f;
      if (fromLines > 0) return { ...f, contractAmount: formatted };
      if (parseNumber(f.contractAmount) === 0) return { ...f, contractAmount: formatted };
      return f;
    });
  }, [lineItems, fetchedOppValue]);

  useEffect(() => {
    if (fullCollectionDateTouchedRef.current) return;
    const target = Math.max(0, parseNumber(form.contractAmount));
    const collected = collectionEntries.reduce((sum, e) => sum + Math.max(0, parseNumber(e?.amount)), 0);
    const completionDate =
      target > 0 && collected >= target
        ? fullCollectionDateFromCumulativeEntries(collectionEntries, target)
        : '';
    if (completionDate) {
      setForm((f) =>
        f.fullCollectionCompleteDate === completionDate ? f : { ...f, fullCollectionCompleteDate: completionDate }
      );
    } else {
      setForm((f) => (f.fullCollectionCompleteDate === '' ? f : { ...f, fullCollectionCompleteDate: '' }));
    }
  }, [collectionEntries, form.contractAmount]);

  const driveMongoRegisteredUrl = useMemo(() => {
    const id = driveFolderId;
    const raw = driveFolderLink;
    const fromDb = id ? sanitizeDriveFolderWebViewLink(raw, id) : '';
    if (fromDb) return fromDb;
    return driveFolderLink || '';
  }, [driveFolderId, driveFolderLink]);

  /** 상태상 driveFolderId가 비어 있어도 저장 링크에서 폴더 ID를 뽑을 수 있으면 목록 API에 사용 */
  const effectiveDriveFolderIdForList = useMemo(() => {
    const a = driveFolderId != null && String(driveFolderId).trim() ? String(driveFolderId).trim() : '';
    if (a && isValidDriveNodeId(a)) return a;
    const fromLink = getDriveFolderIdFromLink(driveFolderLink || '');
    return fromLink && isValidDriveNodeId(fromLink) ? fromLink : '';
  }, [driveFolderId, driveFolderLink]);

  const mergedDriveDocsSorted = useMemo(() => {
    const byId = new Map();
    for (const row of crmDriveUploads || []) {
      const id = row.driveFileId && String(row.driveFileId).trim();
      if (!id) continue;
      byId.set(id, {
        driveFileId: id,
        name: row.name || '파일',
        modifiedTime: row.modifiedTime || '',
        webViewLink: row.webViewLink || '',
        uploadedAt: row.uploadedAt
      });
    }
    for (const f of driveApiFiles || []) {
      if (!f || f.mimeType === DRIVE_FOLDER_MIME) continue;
      const id = f.id && String(f.id).trim();
      if (!id) continue;
      const apiTime = f.modifiedTime || '';
      const apiLink =
        (f.webViewLink && String(f.webViewLink).trim()) ||
        `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
      if (byId.has(id)) {
        const prev = byId.get(id);
        byId.set(id, {
          ...prev,
          name: prev.name || f.name || '파일',
          modifiedTime: apiTime || prev.modifiedTime,
          webViewLink: prev.webViewLink || apiLink
        });
      } else {
        byId.set(id, {
          driveFileId: id,
          name: f.name || '파일',
          modifiedTime: apiTime,
          webViewLink: apiLink,
          uploadedAt: null
        });
      }
    }
    return [...byId.values()].sort((a, b) => {
      const ta = new Date(a.modifiedTime || a.uploadedAt || 0).getTime();
      const tb = new Date(b.modifiedTime || b.uploadedAt || 0).getTime();
      return tb - ta;
    });
  }, [crmDriveUploads, driveApiFiles]);

  const refreshDriveFolderList = useCallback(async (folderIdOverride) => {
    const raw =
      folderIdOverride != null && String(folderIdOverride).trim()
        ? String(folderIdOverride).trim()
        : driveFolderId != null && String(driveFolderId).trim()
          ? String(driveFolderId).trim()
          : getDriveFolderIdFromLink(driveFolderLink || '') || '';
    if (!raw || !isValidDriveNodeId(raw)) {
      setDriveApiFiles([]);
      setDriveListError('');
      return;
    }
    setLoadingDriveFolderList(true);
    setDriveListError('');
    try {
      await pingBackendHealth(getAuthHeader);
      const res = await fetch(
        `${API_BASE}/drive/files?folderId=${encodeURIComponent(raw)}&pageSize=100`,
        { headers: getAuthHeader(), credentials: 'include' }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.files)) {
        setDriveApiFiles(data.files);
        setDriveListError('');
      } else {
        setDriveApiFiles([]);
        const msg =
          (data && (data.error || data.message)) ||
          (res.status === 404 ? 'Drive 폴더를 찾을 수 없습니다.' : '') ||
          'Drive 폴더 목록을 가져오지 못했습니다.';
        setDriveListError(String(msg));
      }
    } catch {
      setDriveApiFiles([]);
      setDriveListError('Drive 폴더 목록을 불러오지 못했습니다. 네트워크를 확인해 주세요.');
    } finally {
      setLoadingDriveFolderList(false);
    }
  }, [driveFolderId, driveFolderLink]);

  useEffect(() => {
    refreshDriveFolderList();
  }, [driveFolderId, driveFolderLink, refreshDriveFolderList]);

  /** Drive 폴더 목록과 비교해 MongoDB driveUploadedFiles 에 없는 항목만 추가 (웹에서만 올린 대용량 등) */
  const syncCrmDriveUploadedFilesIndex = useCallback(async (folderIdOverride) => {
    const raw =
      folderIdOverride != null && String(folderIdOverride).trim()
        ? String(folderIdOverride).trim()
        : effectiveDriveFolderIdForList;
    const fid = raw && isValidDriveNodeId(raw) ? raw : '';
    if (!fid || (!hasConfirmedCompanyDrive && !isContactOnlyDrive)) return { added: 0 };
    const opts = { getAuthHeader, folderId: fid };
    if (hasConfirmedCompanyDrive && (form.customerCompanyId || '').trim()) {
      opts.customerCompanyId = String(form.customerCompanyId).trim();
    } else if (isContactOnlyDrive && (form.customerCompanyEmployeeId || '').trim()) {
      opts.customerCompanyEmployeeId = String(form.customerCompanyEmployeeId).trim();
    } else {
      return { added: 0 };
    }
    const { added, error } = await syncDriveUploadedFilesIndex(opts);
    if (error) {
      setDriveListError(String(error));
      return { added: 0, error };
    }
    setDriveListError('');
    return { added };
  }, [
    effectiveDriveFolderIdForList,
    hasConfirmedCompanyDrive,
    isContactOnlyDrive,
    form.customerCompanyId,
    form.customerCompanyEmployeeId
  ]);

  const ensureOppDriveRoot = useCallback(async () => {
    if (hasConfirmedCompanyDrive && form.customerCompanyId) {
      const r = await fetch(`${API_BASE}/drive/folders/ensure`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          folderName: driveFolderName,
          customerCompanyId: String(form.customerCompanyId)
        })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.id) {
        throw new Error(data.error || '폴더를 준비할 수 없습니다.');
      }
      if (!isValidDriveNodeId(String(data.id))) {
        throw new Error('Drive 폴더 ID 형식이 올바르지 않습니다.');
      }
      const folderLink = sanitizeDriveFolderWebViewLink(data.webViewLink, data.id);
      if (!folderLink) throw new Error('Drive 폴더 링크를 만들 수 없습니다.');
      setDriveFolderId(data.id);
      setDriveFolderLink(folderLink);
      return { id: data.id, webViewLink: folderLink };
    }
    if (isContactOnlyDrive && form.customerCompanyEmployeeId) {
      const cr = await fetch(`${API_BASE}/customer-company-employees/${form.customerCompanyEmployeeId}`, { headers: getAuthHeader() });
      const contact = await cr.json().catch(() => ({}));
      if (!cr.ok || !contact?._id) {
        throw new Error(contact.error || '연락처를 불러올 수 없습니다.');
      }
      const result = await ensureOppContactDriveRoot(contact, { forcePersonalFolder: personalPurchase });
      if (!result.ok) throw new Error(result.error || '폴더를 준비할 수 없습니다.');
      setDriveFolderId(result.id);
      setDriveFolderLink(result.webViewLink);
      return { id: result.id, webViewLink: result.webViewLink };
    }
    return null;
  }, [
    hasConfirmedCompanyDrive,
    isContactOnlyDrive,
    form.customerCompanyId,
    form.customerCompanyEmployeeId,
    driveFolderName,
    personalPurchase
  ]);

  /** Mongo에 저장된 폴더 ID가 Drive에 실제로 있는지(폴더·비휴지통) */
  const verifyDriveFolderMeta = useCallback(async (folderId) => {
    if (!folderId || !isValidDriveNodeId(String(folderId))) return false;
    try {
      await pingBackendHealth(getAuthHeader);
      const res = await fetch(`${API_BASE}/drive/files/${encodeURIComponent(folderId)}`, {
        headers: getAuthHeader(),
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return false;
      if (data.mimeType !== DRIVE_FOLDER_MIME) return false;
      if (data.trashed) return false;
      return true;
    } catch {
      return false;
    }
  }, []);

  /** 삭제·무효 등으로 메타가 깨진 저장 폴더 ID만 DB에서 비움 → 이후 ensure 가 이름으로 다시 찾거나 생성 */
  const clearStoredDriveFolderInDb = useCallback(async () => {
    if (hasConfirmedCompanyDrive && (form.customerCompanyId || '').trim()) {
      const res = await fetch(`${API_BASE}/customer-companies/${String(form.customerCompanyId).trim()}`, {
        method: 'PATCH',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          driveCustomerRootFolderId: null,
          driveCustomerRootFolderWebViewLink: null
        })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(getUserVisibleApiError(d, '고객사 Drive 저장 정보를 초기화할 수 없습니다.'));
      return;
    }
    if (isContactOnlyDrive && (form.customerCompanyEmployeeId || '').trim()) {
      const res = await fetch(`${API_BASE}/customer-company-employees/${String(form.customerCompanyEmployeeId).trim()}`, {
        method: 'PATCH',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          driveRootFolderId: '',
          driveRootFolderWebViewLink: ''
        })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(getUserVisibleApiError(d, '연락처 Drive 저장 정보를 초기화할 수 없습니다.'));
    }
  }, [hasConfirmedCompanyDrive, isContactOnlyDrive, form.customerCompanyId, form.customerCompanyEmployeeId]);

  const refreshCrmDriveUploads = useCallback(async () => {
    if (hasConfirmedCompanyDrive && form.customerCompanyId) {
      const res = await fetch(`${API_BASE}/customer-companies/${form.customerCompanyId}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?._id) {
        setCrmDriveUploads(Array.isArray(data.driveUploadedFiles) ? data.driveUploadedFiles : []);
      }
      return;
    }
    if (isContactOnlyDrive && form.customerCompanyEmployeeId) {
      const res = await fetch(`${API_BASE}/customer-company-employees/${form.customerCompanyEmployeeId}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?._id) {
        setCrmDriveUploads(Array.isArray(data.driveUploadedFiles) ? data.driveUploadedFiles : []);
      }
    }
  }, [hasConfirmedCompanyDrive, isContactOnlyDrive, form.customerCompanyId, form.customerCompanyEmployeeId]);

  const handleDeleteMergedDriveDoc = useCallback(
    async (row) => {
      const fid = row?.driveFileId && String(row.driveFileId).trim();
      if (!fid || !isValidDriveNodeId(fid)) return;
      if (!hasConfirmedCompanyDrive && !isContactOnlyDrive) return;
      if (!window.confirm(`「${row.name || '파일'}」을 Drive 휴지통으로 옮기고 목록에서 제거할까요?`)) return;
      setDriveDocDeletingId(fid);
      setDriveError('');
      try {
        await pingBackendHealth(getAuthHeader);
        const opts =
          hasConfirmedCompanyDrive && (form.customerCompanyId || '').trim()
            ? { customerCompanyId: String(form.customerCompanyId).trim() }
            : { customerCompanyEmployeeId: String(form.customerCompanyEmployeeId).trim() };
        const url = buildDriveFileDeleteUrl(fid, opts);
        const res = await fetch(url, { method: 'DELETE', headers: getAuthHeader(), credentials: 'include' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setDriveError(data.error || '삭제에 실패했습니다.');
          return;
        }
        await refreshCrmDriveUploads();
        await refreshDriveFolderList();
        setDriveUploadNotice('파일을 삭제했습니다.');
        window.setTimeout(() => setDriveUploadNotice(''), 5000);
      } catch (_) {
        setDriveError('삭제 중 오류가 났습니다.');
      } finally {
        setDriveDocDeletingId('');
      }
    },
    [
      hasConfirmedCompanyDrive,
      isContactOnlyDrive,
      form.customerCompanyId,
      form.customerCompanyEmployeeId,
      refreshCrmDriveUploads,
      refreshDriveFolderList
    ]
  );

  useEffect(() => {
    setDriveUploadNotice('');
  }, [hasConfirmedCompanyDrive, isContactOnlyDrive, form.customerCompanyId, form.customerCompanyEmployeeId]);

  useEffect(() => {
    if (!hasConfirmedCompanyDrive && !isContactOnlyDrive) {
      setCrmDriveUploads([]);
      setDriveApiFiles([]);
      setDriveListError('');
      setDriveIndexSyncing(false);
      setDriveOpeningRegisteredLink(false);
      setDriveFolderId(null);
      setDriveFolderLink('');
      return;
    }
    if (driveRootEnsureInFlightRef.current) return;
    driveRootEnsureInFlightRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        let out = await ensureOppDriveRoot();
        if (cancelled) return;
        let repaired = false;
        if (out?.id) {
          const metaOk = await verifyDriveFolderMeta(out.id);
          if (!metaOk) {
            await clearStoredDriveFolderInDb();
            if (cancelled) return;
            out = await ensureOppDriveRoot();
            repaired = true;
          }
        }
        if (cancelled) return;
        await refreshCrmDriveUploads();
        const fid =
          out?.id && isValidDriveNodeId(String(out.id).trim()) ? String(out.id).trim() : '';
        if (fid && !cancelled) {
          if (hasConfirmedCompanyDrive && (form.customerCompanyId || '').trim()) {
            await syncCrmDriveUploadedFilesIndex(fid);
            if (cancelled) return;
            await pruneDriveUploadedFilesIndex({
              getAuthHeader,
              folderId: fid,
              customerCompanyId: String(form.customerCompanyId).trim()
            });
          } else if (isContactOnlyDrive && (form.customerCompanyEmployeeId || '').trim()) {
            await syncCrmDriveUploadedFilesIndex(fid);
            if (cancelled) return;
            await pruneDriveUploadedFilesIndex({
              getAuthHeader,
              folderId: fid,
              customerCompanyEmployeeId: String(form.customerCompanyEmployeeId).trim()
            });
          }
          if (!cancelled) await refreshCrmDriveUploads();
        }
        if (!cancelled) setDriveError('');
        if (repaired && !cancelled) {
          setDriveUploadNotice('저장된 Drive 폴더를 찾을 수 없어 새로 연결했습니다.');
          window.setTimeout(() => setDriveUploadNotice(''), 8000);
        }
      } catch (e) {
        if (!cancelled) setDriveError((prev) => prev || e?.message || 'Drive 폴더를 준비할 수 없습니다.');
      } finally {
        driveRootEnsureInFlightRef.current = false;
      }
    })();
    return () => { cancelled = true; };
  }, [
    hasConfirmedCompanyDrive,
    isContactOnlyDrive,
    form.customerCompanyId,
    form.customerCompanyEmployeeId,
    ensureOppDriveRoot,
    refreshCrmDriveUploads,
    verifyDriveFolderMeta,
    clearStoredDriveFolderInDb,
    syncCrmDriveUploadedFilesIndex
  ]);

  const addDocumentRef = useCallback((url, name) => {
    const link = (url || '').trim();
    if (!link) return;
    setDocumentRefs((prev) => (prev.some((r) => (typeof r === 'string' ? r : r?.url) === link) ? prev : [...prev, { url: link, name: name || '파일' }]));
  }, []);

  const handleDirectFileUpload = useCallback(async (files) => {
    const filesArray = Array.from(files || []);
    if (!filesArray.length) return;
    if (!hasConfirmedCompanyDrive && !isContactOnlyDrive) {
      setDriveError('고객사(목록에서 선택·사업자번호 확인) 또는 담당자(연락처)를 선택해 주세요.');
      return;
    }
    setDriveUploading(true);
    setDriveError('');
    setDriveUploadNotice('');
    let folderIdForListRefresh = null;
    try {
      let parentId = driveFolderId;
      if (!parentId) {
        try {
          const ensured = await ensureOppDriveRoot();
          parentId = ensured?.id || null;
        } catch (e) {
          setDriveError(e.message || '폴더를 준비할 수 없습니다.');
          return;
        }
        if (!parentId) {
          setDriveError('폴더를 준비할 수 없습니다.');
          return;
        }
      }
      folderIdForListRefresh = parentId;
      const tooLargeForApi = filesArray.filter((file) => Number(file?.size || 0) > MAX_DRIVE_JSON_UPLOAD_BYTES);
      const apiUploadFiles = filesArray.filter((file) => Number(file?.size || 0) <= MAX_DRIVE_JSON_UPLOAD_BYTES);
      if (tooLargeForApi.length > 0) {
        const folderUrlForLarge =
          buildDriveFolderUrl(parentId) || pickDriveFolderOpenUrl(parentId, driveFolderLink);
        const names = tooLargeForApi.slice(0, 3).map((file) => file.name).join(', ');
        const more = tooLargeForApi.length > 3 ? ` 외 ${tooLargeForApi.length - 3}건` : '';
        const canOpenFolder =
          folderUrlForLarge &&
          typeof folderUrlForLarge === 'string' &&
          folderUrlForLarge.startsWith('https://drive.google.com/') &&
          !folderUrlForLarge.includes('undefined');
        if (canOpenFolder) {
          window.open(folderUrlForLarge, '_blank', 'noopener,noreferrer');
        }
        setDriveError(
          canOpenFolder
            ? `약 ${Math.floor(MAX_DRIVE_JSON_UPLOAD_BYTES / (1024 * 1024))}MB를 넘는 파일은 이 창에서 한 번에 올릴 수 없습니다. 해당 Google Drive 폴더를 새 창으로 열었으니, 거기에서 직접 업로드해 주세요: ${names}${more}`
            : `약 ${Math.floor(MAX_DRIVE_JSON_UPLOAD_BYTES / (1024 * 1024))}MB를 넘는 파일은 이 창에서 한 번에 올릴 수 없습니다. 폴더 주소를 확인한 뒤 Drive에서 직접 올려 주세요: ${names}${more}`
        );
        if (canOpenFolder && !apiUploadFiles.length) {
          setDriveUploadNotice('업로드 후 「목록 새로고침」으로 CRM 목록에 반영할 수 있습니다.');
          window.setTimeout(() => setDriveUploadNotice(''), 8000);
        }
      }
      if (!apiUploadFiles.length) {
        return;
      }
      let uploadFailed = false;
      let uploadedOkCount = 0;
      for (const file of apiUploadFiles) {
        try {
          const contentBase64 = await fileToBase64(file);
          if (!contentBase64) {
            uploadFailed = true;
            setDriveError((prev) => prev || `"${file.name}" 파일 읽기에 실패했습니다.`);
            continue;
          }
          const uploadBody = {
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            contentBase64,
            parentFolderId: parentId
          };
          if (hasConfirmedCompanyDrive && form.customerCompanyId) {
            uploadBody.customerCompanyId = String(form.customerCompanyId);
          } else {
            uploadBody.customerCompanyEmployeeId = String(form.customerCompanyEmployeeId);
          }
          const up = await fetch(`${API_BASE}/drive/upload`, {
            method: 'POST',
            headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(uploadBody)
          });
          const upData = await up.json().catch(() => ({}));
          if (!up.ok) {
            uploadFailed = true;
            setDriveError((prev) => prev || upData.error || upData.details || '업로드 실패');
            continue;
          }
          if (upData.webViewLink) {
            addDocumentRef(upData.webViewLink, upData.name || file.name);
            uploadedOkCount += 1;
          }
        } catch (err) {
          uploadFailed = true;
          setDriveError((prev) => prev || err?.message || '업로드 중 오류가 났습니다.');
        }
      }
      if (!uploadFailed && uploadedOkCount > 0) {
        setDriveUploadNotice(`${uploadedOkCount}개 파일을 업로드했습니다. CRM 기록 목록에도 저장되었습니다.`);
        window.setTimeout(() => setDriveUploadNotice(''), 8000);
        await refreshCrmDriveUploads();
      }
    } catch (err) {
      setDriveError(err?.message || 'Drive에 연결할 수 없습니다.');
    } finally {
      if (folderIdForListRefresh) {
        void refreshDriveFolderList(folderIdForListRefresh);
      }
      setDriveUploading(false);
    }
  }, [
    hasConfirmedCompanyDrive,
    isContactOnlyDrive,
    form.customerCompanyId,
    form.customerCompanyEmployeeId,
    driveFolderId,
    driveFolderLink,
    ensureOppDriveRoot,
    addDocumentRef,
    refreshCrmDriveUploads,
    refreshDriveFolderList
  ]);

  const handleRefreshDriveDocList = useCallback(async () => {
    setDriveIndexSyncing(true);
    try {
      await pingBackendHealth(getAuthHeader);
      const fid = effectiveDriveFolderIdForList;
      const { added } = await syncCrmDriveUploadedFilesIndex();
      if (fid && hasConfirmedCompanyDrive && (form.customerCompanyId || '').trim()) {
        await pruneDriveUploadedFilesIndex({
          getAuthHeader,
          folderId: fid,
          customerCompanyId: String(form.customerCompanyId).trim()
        });
      } else if (fid && isContactOnlyDrive && (form.customerCompanyEmployeeId || '').trim()) {
        await pruneDriveUploadedFilesIndex({
          getAuthHeader,
          folderId: fid,
          customerCompanyEmployeeId: String(form.customerCompanyEmployeeId).trim()
        });
      }
      await refreshCrmDriveUploads();
      await refreshDriveFolderList();
      if (added > 0) {
        setDriveUploadNotice(`Drive에만 있던 파일 ${added}건을 CRM 목록(MongoDB)에 반영했습니다.`);
        window.setTimeout(() => setDriveUploadNotice(''), 8000);
      }
    } finally {
      setDriveIndexSyncing(false);
    }
  }, [
    effectiveDriveFolderIdForList,
    hasConfirmedCompanyDrive,
    isContactOnlyDrive,
    form.customerCompanyId,
    form.customerCompanyEmployeeId,
    syncCrmDriveUploadedFilesIndex,
    refreshCrmDriveUploads,
    refreshDriveFolderList
  ]);

  /** CRM 저장 주소: 실제 폴더가 없으면 DB 초기화 후 ensure 로 새 링크로 열기 */
  const handleCrmDriveRegisteredLinkClick = useCallback(
    async (e) => {
      e.preventDefault();
      const fid = effectiveDriveFolderIdForList;
      const url = driveMongoRegisteredUrl;
      if (!fid || !url) return;
      if (driveOpeningRegisteredLink) return;
      setDriveOpeningRegisteredLink(true);
      try {
        await pingBackendHealth(getAuthHeader);
        const ok = await verifyDriveFolderMeta(fid);
        if (ok) {
          window.open(url, '_blank', 'noopener,noreferrer');
          return;
        }
        await clearStoredDriveFolderInDb();
        const out = await ensureOppDriveRoot();
        await refreshCrmDriveUploads();
        await refreshDriveFolderList();
        const openUrl =
          (out && out.webViewLink) ||
          (out && out.id ? sanitizeDriveFolderWebViewLink('', out.id) : '') ||
          url;
        window.open(openUrl, '_blank', 'noopener,noreferrer');
        setDriveUploadNotice('저장된 Drive 폴더를 찾을 수 없어 새로 연결했습니다.');
        window.setTimeout(() => setDriveUploadNotice(''), 8000);
      } catch (err) {
        setDriveError(err?.message || 'Drive 폴더를 열 수 없습니다.');
      } finally {
        setDriveOpeningRegisteredLink(false);
      }
    },
    [
      effectiveDriveFolderIdForList,
      driveMongoRegisteredUrl,
      driveOpeningRegisteredLink,
      verifyDriveFolderMeta,
      clearStoredDriveFolderInDb,
      ensureOppDriveRoot,
      refreshCrmDriveUploads,
      refreshDriveFolderList
    ]
  );

  const canDocsUpload =
    Boolean(hasConfirmedCompanyDrive || isContactOnlyDrive) && !driveUploading;

  const handleDocsDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (canDocsUpload) setCrmListDropActive(true);
  }, [canDocsUpload]);

  const handleDocsDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (canDocsUpload) setCrmListDropActive(true);
  }, [canDocsUpload]);

  const handleDocsDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) setCrmListDropActive(false);
  }, []);

  const handleDocsDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setCrmListDropActive(false);
    if (canDocsUpload && e.dataTransfer?.files?.length) handleDirectFileUpload(e.dataTransfer.files);
  }, [canDocsUpload, handleDirectFileUpload]);

  const updateLine = useCallback((lineId, patch) => {
    setLineItems((rows) => rows.map((row) => (row.lineId === lineId ? { ...row, ...patch } : row)));
    setError('');
  }, []);

  const handleLineUnitPriceChange = (lineId, e) => {
    updateLine(lineId, { unitPrice: formatNumberInput(e.target.value) });
  };
  const handleLineDiscountRateChange = (lineId, e) => {
    const v = e.target.value.replace(/[^0-9.]/g, '');
    updateLine(lineId, { discountRate: v });
  };
  const handleLineDiscountAmountChange = (lineId, e) => {
    updateLine(lineId, { discountAmount: formatNumberInput(e.target.value) });
  };

  const handleLinePurchaseCostChange = (lineId, e) => {
    const v = formatNumberInput(e.target.value);
    if (String(v).replace(/,/g, '').trim() !== '') purchaseCostEditedLineIdsRef.current.add(lineId);
    else purchaseCostEditedLineIdsRef.current.delete(lineId);
    updateLine(lineId, { purchaseCostTotal: v });
  };

  const removeLine = useCallback((lineId) => {
    purchaseCostEditedLineIdsRef.current.delete(lineId);
    setLineItems((rows) => {
      const dropped = rows.find((r) => r.lineId === lineId);
      const pidToDrop = dropped?.productId;
      const nextRows = rows.filter((r) => r.lineId !== lineId);
      if (pidToDrop) {
        const stillUsed = nextRows.some((l) => l.productId === pidToDrop);
        if (!stillUsed) {
          setProductById((prev) => {
            const n = { ...prev };
            delete n[pidToDrop];
            return n;
          });
        }
      }
      return nextRows;
    });
    setError('');
  }, []);

  const computeTotalFinalAmount = () =>
    lineItems.reduce((sum, line) => sum + computeLineFinalAmount(line), 0);

  const formatCurrencyDisplay = (num, currency) => {
    const n = Number(num);
    if (!Number.isFinite(n)) return '—';
    const s = n.toLocaleString();
    if (currency === 'USD') return `${s} 달러`;
    if (currency === 'JPY') return `${s} 엔`;
    return `${s} 원`;
  };

  const computeTotalDeduction = () =>
    lineItems.reduce((sum, line) => sum + computeLineDeduction(line), 0);

  /** 행별 매입 원가 합계(숫자): 입력값 우선, 없으면 제품 원가×수량 */
  const getEffectivePurchaseCostForLine = (line) => {
    const raw = String(line.purchaseCostTotal ?? '').replace(/,/g, '').trim();
    if (raw !== '') {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) return Math.round(n);
    }
    const p = line.productId ? productById[line.productId] : null;
    if (!p) return null;
    const cost = Number(p.costPrice);
    if (!Number.isFinite(cost) || cost < 0) return null;
    const qty = Math.max(0, Number(line.quantity) || 1);
    return Math.round(cost * qty);
  };

  /** 행별 순마진 */
  const computeLineNetMargin = (line) => {
    const costTotal = getEffectivePurchaseCostForLine(line);
    if (costTotal == null) return null;
    return computeLineFinalAmount(line) - costTotal;
  };

  /** 전체 순마진(행 합계) */
  const computeTotalNetMargin = () => {
    if (lineItems.length === 0) return null;
    let sum = 0;
    let any = false;
    for (const line of lineItems) {
      const m = computeLineNetMargin(line);
      if (m != null) {
        any = true;
        sum += m;
      }
    }
    return any ? sum : null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const names = lineItems.map((l) => l.productName?.trim()).filter(Boolean);
    const titleToUse =
      (names.length ? names.join(', ') : '') ||
      form.customerCompanyName?.trim() ||
      form.contactName?.trim() ||
      '';
    if (!titleToUse) {
      setError('고객사·담당자·제품 중 하나는 선택해 주세요.');
      return;
    }
    const selectedStage = stageSelectOptions.some((s) => s.value === form.stage) ? form.stage : firstStageValue;
    if (selectedStage === 'Won') {
      const sdWon = String(form.saleDate || '').trim();
      if (!sdWon) {
        setError('수주 성공으로 저장하려면 본문 상단의 수주·판매일을 입력하거나, 안내 배너에서 「오늘 날짜로 적용」을 눌러 주세요.');
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      await pingBackendHealth(getAuthHeader);
      const distsToRegister = new Set();
      for (const line of lineItems) {
        if (line.priceBasis === 'channel') {
          const d = String(line.channelDistributor || '').trim();
          if (d && !channelDistributorList.includes(d)) distsToRegister.add(d);
        }
      }
      for (const distTrim of distsToRegister) {
        const cdRes = await fetch(`${API_BASE}/companies/channel-distributors`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify({ add: distTrim })
        });
        const cdData = await cdRes.json().catch(() => ({}));
        if (!cdRes.ok) {
          throw new Error(cdData.error || '유통사 목록에 추가할 수 없습니다.');
        }
        if (Array.isArray(cdData.items)) setChannelDistributorList(cdData.items);
      }

      const sd = String(form.saleDate || '').trim();
      let saleDatePayload = null;
      if (sd) {
        const parsed = new Date(`${sd}T12:00:00`);
        saleDatePayload = !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
      }

      const toIsoDate = (v) => {
        const s = String(v || '').trim();
        if (!s) return null;
        const parsed = new Date(`${s}T12:00:00`);
        return !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
      };
      const targetDateRaw = String(form.targetDate || '').trim();
      const targetYm = /^\d{4}-\d{2}-\d{2}$/.test(targetDateRaw) ? targetDateRaw.slice(0, 7) : '';
      const ymFallback = String(form.expectedCloseMonth || '').trim();
      const expectedCloseMonthPayload = /^\d{4}-\d{2}$/.test(targetYm)
        ? targetYm
        : /^\d{4}-\d{2}$/.test(ymFallback)
          ? ymFallback
          : '';

      const lineItemsPayload = lineItems.map((li) => ({
        productId: li.productId || null,
        productName: li.productName?.trim() || '',
        unitPrice: parseNumber(li.unitPrice),
        unitPriceBasis: li.priceBasis === 'channel' ? 'channel' : 'consumer',
        channelDistributor: li.priceBasis === 'channel' ? String(li.channelDistributor || '').trim() : '',
        quantity: Math.max(0, Number(li.quantity) || 1),
        discountRate: Math.max(0, Math.min(100, Number(li.discountRate) || 0)),
        discountAmount: parseNumber(li.discountAmount) || 0,
        commissionRecipients: (Array.isArray(li.commissionRecipients) ? li.commissionRecipients : [])
          .map((r) => ({
            remarks: String(r.remarks || '').trim().slice(0, 2000),
            commissionAmount: parseNumber(r.commissionAmount) || 0
          }))
          .filter((r) => r.remarks || r.commissionAmount > 0)
      }));
      const collectionEntriesPayload = collectionEntries
        .map((entry) => {
          const amount = parseNumber(entry.amount);
          const date = toIsoDate(entry.date);
          if (amount <= 0 && !date) return null;
          return { amount: Math.max(0, amount), date };
        })
        .filter(Boolean);

      const body = {
        title: titleToUse,
        customerCompanyId: form.customerCompanyId || null,
        customerCompanyEmployeeId: form.customerCompanyEmployeeId || null,
        contactName: form.contactName.trim(),
        lineItems: lineItemsPayload,
        currency: form.currency,
        stage: selectedStage,
        description: form.description.trim(),
        documentRefs: documentRefs.filter((d) => d?.url),
        driveFolderLink: (driveFolderLink || '').trim() || undefined,
        saleDate: saleDatePayload,
        assignedTo: (form.assignedToUserId || '').trim() || null,
        expectedCloseMonth: expectedCloseMonthPayload,
        startDate: toIsoDate(form.startDate),
        targetDate: toIsoDate(form.targetDate),
        contractAmount: parseNumber(form.contractAmount) || 0,
        contractAmountDate: toIsoDate(form.saleDate),
        fullCollectionCompleteDate: toIsoDate(form.fullCollectionCompleteDate),
        invoiceAmount: parseNumber(form.invoiceAmount) || 0,
        invoiceAmountDate: toIsoDate(form.invoiceAmountDate),
        collectionEntries: collectionEntriesPayload
      };
      const url = isEdit
        ? `${API_BASE}/sales-opportunities/${oppId}`
        : `${API_BASE}/sales-opportunities`;
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body)
      });
      const savedPayload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(savedPayload.error || '저장 실패');
      }
      if (savedPayload.renewalCalendar?.followUpOpportunityId) {
        try {
          window.dispatchEvent(new CustomEvent('nexvia-crm-pipeline-refresh'));
        } catch {
          /* ignore */
        }
      }
      if (isEdit && stageAtLoadRef.current === 'Won' && selectedStage !== 'Won') {
        try {
          window.dispatchEvent(new CustomEvent('nexvia-crm-calendar-refresh'));
        } catch {
          /* ignore */
        }
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit || !oppId) return;
    if (!canDeleteOpportunity) {
      window.alert('기회 삭제는 관리자(Admin) 이상만 가능합니다.');
      return;
    }
    if (!window.confirm('이 기회를 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`${API_BASE}/sales-opportunities/${oppId}`, { method: 'DELETE', headers: getAuthHeader() });
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        window.alert(data.error || '삭제 권한이 없습니다.');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.alert(data.error || '삭제에 실패했습니다.');
        return;
      }
      try {
        window.dispatchEvent(new CustomEvent('nexvia-crm-calendar-refresh'));
      } catch {
        /* ignore */
      }
      onSaved();
      onClose();
    } catch {
      /* ignore */
    }
  };

  /**
   * 고객사·연락처 지원/업무 기록 API — 메모 저장·코멘트 답글 등에서 동일 규칙으로 사용.
   * @returns {Promise<{ journalSummaryNotice: { type: string, text: string } | null }>}
   */
  const postSupportHistoryForOpportunity = useCallback(
    async (content, { createdAt } = {}) => {
      const trimmed = String(content || '').trim();
      if (!trimmed) throw new Error('내용이 비어 있습니다.');
      const companyId = form.customerCompanyId;
      const contactEmpId = form.customerCompanyEmployeeId;
      if (!companyId && !contactEmpId) {
        throw new Error('고객사 또는 담당자(연락처)를 선택해 주세요.');
      }
      const requestBody = JSON.stringify({
        content: trimmed,
        ...(createdAt ? { createdAt } : {})
      });

      let empRecord = null;
      if (contactEmpId) {
        try {
          const er = await fetch(`${API_BASE}/customer-company-employees/${contactEmpId}`, { headers: getAuthHeader() });
          empRecord = await er.json().catch(() => ({}));
          if (!er.ok || !empRecord?._id) empRecord = null;
        } catch {
          empRecord = null;
        }
      }
      const empCc = empRecord?.customerCompanyId?._id ?? empRecord?.customerCompanyId;
      const skipCompanyPostBecauseEmployeeCovers =
        Boolean(contactEmpId && empCc && companyId && String(empCc) === String(companyId));

      let journalSummaryNotice = null;

      if (contactEmpId && empRecord) {
        const resEmp = await fetch(`${API_BASE}/customer-company-employees/${contactEmpId}/history`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          ...(requestBody.length <= 60 * 1024 ? { keepalive: true } : {}),
          body: requestBody
        });
        const dataEmp = await resEmp.json().catch(() => ({}));
        if (!resEmp.ok) throw new Error(dataEmp.error || '연락처 업무 기록 저장에 실패했습니다.');
      } else if (contactEmpId && !empRecord) {
        throw new Error('담당자(연락처) 정보를 불러올 수 없습니다.');
      }

      if (companyId && !skipCompanyPostBecauseEmployeeCovers) {
        const res = await fetch(`${API_BASE}/customer-companies/${companyId}/history`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          ...(requestBody.length <= 60 * 1024 ? { keepalive: true } : {}),
          body: requestBody
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '고객사 업무 기록 저장에 실패했습니다.');
      }

      return { journalSummaryNotice };
    },
    [form.customerCompanyId, form.customerCompanyEmployeeId]
  );

  const handleSaveOppJournal = async () => {
    const content = newComment.trim();
    const companyId = form.customerCompanyId;
    const contactEmpId = form.customerCompanyEmployeeId;
    if (!content || !oppId) return;
    if (!companyId && !contactEmpId) {
      setJournalInputError('고객사 또는 담당자(연락처)를 선택해 주세요.');
      return;
    }
    setJournalInputError('');
    setJournalSummaryNotice(null);
    setSavingJournal(true);
    try {
      const createdAt =
        journalDateTime && !Number.isNaN(new Date(journalDateTime).getTime())
          ? new Date(journalDateTime).toISOString()
          : undefined;
      const { journalSummaryNotice: noticeFromHistory } = await postSupportHistoryForOpportunity(content, { createdAt });
      if (noticeFromHistory) setJournalSummaryNotice(noticeFromHistory);

      const resComment = await fetch(`${API_BASE}/sales-opportunities/${oppId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ text: content })
      });
      const dataComment = await resComment.json().catch(() => ({}));
      if (!resComment.ok) {
        throw new Error(
          dataComment.error || '기회 코멘트 반영에 실패했습니다. 업무 기록은 저장되었을 수 있습니다.'
        );
      }
      setComments(Array.isArray(dataComment.comments) ? dataComment.comments : []);
      setNewComment('');
      setJournalDateTime(toDatetimeLocalValue(new Date()));
    } catch (err) {
      setJournalInputError(err.message || '저장에 실패했습니다.');
    } finally {
      setSavingJournal(false);
    }
  };

  const uploadAudioForOpportunityJournal = useCallback(
    async (filesLike) => {
      const companyId = form.customerCompanyId;
      const contactEmpId = form.customerCompanyEmployeeId;
      const files = Array.from(filesLike || []).filter((f) => f && f instanceof File);
      if (!files.length || savingJournal || audioUploading) return;
      if (!companyId && !contactEmpId) return;
      const accept = /\.(mp3|wav|m4a|webm)$/i;
      const audioTypes = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm'];
      const file = files.find((f) => accept.test(f.name) || audioTypes.includes(f.type));
      if (!file) {
        setJournalInputError('MP3, WAV, M4A, WebM 파일만 업로드할 수 있습니다.');
        return;
      }
      setJournalInputError('');
      setJournalSummaryNotice({
        type: 'info',
        text:
          '음성 파일을 올렸습니다. 전사·요약은 서버에서 진행하며, 진행 중에도 연결이 끊기지 않도록 짧게 상태를 확인합니다.'
      });
      await pingBackendHealth(getAuthHeader);
      setAudioUploading(true);
      try {
        const fd = new FormData();
        fd.append('audio', file);
        const useContactAudio = Boolean(contactEmpId);
        const res = await fetch(
          useContactAudio
            ? `${API_BASE}/customer-company-employees/${contactEmpId}/history/from-audio`
            : `${API_BASE}/customer-companies/${companyId}/history/from-audio`,
          {
            method: 'POST',
            headers: getAuthHeader(),
            credentials: 'include',
            body: fd
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '음성 업로드 처리에 실패했습니다.');
        if (res.status === 202 && data.jobId) {
          setJournalSummaryNotice({
            type: 'info',
            text: 'AssemblyAI 전사 및 Gemini 요약 진행 중입니다. 잠시만 기다려 주세요…'
          });
          const pollUrl = useContactAudio
            ? `${API_BASE}/customer-company-employees/${contactEmpId}/history/from-audio/jobs/${encodeURIComponent(
                data.jobId
              )}`
            : `${API_BASE}/customer-companies/${companyId}/history/from-audio/jobs/${encodeURIComponent(data.jobId)}`;
          const result = await pollJournalFromAudioJob(pollUrl, getAuthHeader);
          setNewComment(result.content || '');
          setJournalDateTime(toDatetimeLocalValue(new Date()));
          setJournalSummaryNotice({
            type: 'info',
            text:
              '요약이 입력창에 채워졌습니다. 내용 확인 후 "메모 저장"을 눌러 등록해 주세요. 개인정보 보호를 위해 AssemblyAI 전사 데이터는 삭제 요청되었습니다.'
          });
        } else {
          throw new Error(data.error || '서버 응답 형식을 알 수 없습니다.');
        }
      } catch (e) {
        setJournalInputError(e.message || '음성 업로드 처리에 실패했습니다.');
      } finally {
        setAudioUploading(false);
      }
    },
    [audioUploading, form.customerCompanyId, form.customerCompanyEmployeeId, savingJournal]
  );

  const { roots, childrenMap } = useMemo(() => organizeComments(comments), [comments]);
  const commentById = useMemo(() => {
    const m = new Map();
    (Array.isArray(comments) ? comments : []).forEach((c) => {
      const cid = c?._id != null ? String(c._id) : c?.id != null ? String(c.id) : '';
      if (cid) m.set(cid, c);
    });
    return m;
  }, [comments]);

  const handleAddComment = async (parentCommentId = null) => {
    const text = (parentCommentId ? replyText : newComment).trim();
    if (!text || !oppId) return;
    setCommentBusy(true);
    setCommentError('');
    try {
      if (isEdit && (form.customerCompanyId || form.customerCompanyEmployeeId)) {
        const historyText = parentCommentId ? `[기회 코멘트 답글] ${text}` : text;
        await postSupportHistoryForOpportunity(historyText, {});
      }
      const res = await fetch(`${API_BASE}/sales-opportunities/${oppId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          text,
          ...(parentCommentId ? { parentCommentId } : {})
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '코멘트를 등록할 수 없습니다.');
      setComments(Array.isArray(data.comments) ? data.comments : []);
      if (parentCommentId) {
        setReplyText('');
        setReplyingToId(null);
      } else {
        setNewComment('');
      }
    } catch (err) {
      setCommentError(err.message || '코멘트 등록에 실패했습니다.');
    } finally {
      setCommentBusy(false);
    }
  };

  const handleSaveEditComment = async (commentId) => {
    const text = editDraft.trim();
    if (!text || !oppId || !commentId) return;
    setCommentBusy(true);
    setCommentError('');
    try {
      const res = await fetch(`${API_BASE}/sales-opportunities/${oppId}/comments/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ text })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '코멘트를 수정할 수 없습니다.');
      setComments(Array.isArray(data.comments) ? data.comments : []);
      setEditingCommentId(null);
      setEditDraft('');
    } catch (err) {
      setCommentError(err.message || '코멘트 수정에 실패했습니다.');
    } finally {
      setCommentBusy(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!oppId || !commentId) return;
    if (!window.confirm('이 코멘트를 삭제하시겠습니까?')) return;
    setCommentBusy(true);
    setCommentError('');
    try {
      const res = await fetch(`${API_BASE}/sales-opportunities/${oppId}/comments/${commentId}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '코멘트를 삭제할 수 없습니다.');
      setComments(Array.isArray(data.comments) ? data.comments : []);
      if (editingCommentId === commentId) {
        setEditingCommentId(null);
        setEditDraft('');
      }
      if (replyingToId === commentId) {
        setReplyingToId(null);
        setReplyText('');
      }
    } catch (err) {
      setCommentError(err.message || '코멘트 삭제에 실패했습니다.');
    } finally {
      setCommentBusy(false);
    }
  };

  function renderCommentItem(c) {
    const id = String(c._id || c.id);
    const mine = isCommentAuthor(c, currentUserId);
    const isEditing = editingCommentId === id;
    const replies = childrenMap.get(id) || [];
    const parentId = c.parentCommentId != null ? String(c.parentCommentId) : null;
    const parentComment = parentId ? commentById.get(parentId) : null;

    return (
      <li key={id} className="opp-comment-item">
        {parentComment ? (
          <p className="opp-comment-reply-hint">
            <span className="material-symbols-outlined" aria-hidden>subdirectory_arrow_right</span>
            {parentComment.authorName || '사용자'}님에게 답글
          </p>
        ) : null}
        <div className="opp-comment-meta">
          <span className="opp-comment-author">{c.authorName || '사용자'}</span>
          <span className="opp-comment-date">
            {formatCommentDate(c.createdAt)}
            {c.updatedAt && c.createdAt && new Date(c.updatedAt) > new Date(c.createdAt) ? ' · 수정됨' : ''}
          </span>
          {!isEditing ? (
            <span className="opp-comment-actions">
              <button
                type="button"
                className="opp-comment-action-btn"
                disabled={commentBusy}
                onClick={() => {
                  if (replyingToId === id) {
                    setReplyingToId(null);
                    setReplyText('');
                  } else {
                    setReplyingToId(id);
                    setReplyText('');
                    setEditingCommentId(null);
                    setEditDraft('');
                  }
                }}
              >
                답글
              </button>
              {mine ? (
                <>
                  <button
                    type="button"
                    className="opp-comment-action-btn"
                    disabled={commentBusy}
                    onClick={() => {
                      setEditingCommentId(id);
                      setEditDraft(c.text || '');
                      setReplyingToId(null);
                      setReplyText('');
                    }}
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    className="opp-comment-action-btn opp-comment-action-btn--danger"
                    disabled={commentBusy}
                    onClick={() => handleDeleteComment(id)}
                  >
                    삭제
                  </button>
                </>
              ) : null}
            </span>
          ) : null}
        </div>
        {isEditing ? (
          <div className="opp-comment-edit">
            <textarea
              className="opp-textarea opp-comment-edit-input"
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              rows={3}
              maxLength={5000}
            />
            <div className="opp-comment-edit-btns">
              <button type="button" className="opp-comment-cancel-btn" disabled={commentBusy} onClick={() => { setEditingCommentId(null); setEditDraft(''); }}>
                취소
              </button>
              <button type="button" className="opp-comment-save-btn" disabled={commentBusy || !editDraft.trim()} onClick={() => handleSaveEditComment(id)}>
                {commentBusy ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        ) : (
          <p className="opp-comment-text">{c.text}</p>
        )}
        {replyingToId === id && !isEditing ? (
          <div className="opp-comment-reply-compose">
            <textarea
              className="opp-textarea"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={`${c.authorName || '사용자'}님에게 답글 작성...`}
              rows={2}
              maxLength={5000}
              disabled={commentBusy}
            />
            <div className="opp-comment-reply-compose-row">
              <button type="button" className="opp-comment-cancel-btn" disabled={commentBusy} onClick={() => { setReplyingToId(null); setReplyText(''); }}>
                취소
              </button>
              <button
                type="button"
                className="opp-comment-add-btn"
                disabled={commentBusy || !replyText.trim()}
                onClick={() => handleAddComment(id)}
                aria-label="답글 등록"
                title="답글 등록"
              >
                <span className={'material-symbols-outlined' + (commentBusy ? ' opp-comment-add-btn-icon--spin' : '')} aria-hidden>
                  {commentBusy ? 'progress_activity' : 'send'}
                </span>
              </button>
            </div>
          </div>
        ) : null}
        {replies.length > 0 ? (
          <ul className="opp-comment-replies">
            {replies.map((r) => renderCommentItem(r))}
          </ul>
        ) : null}
      </li>
    );
  }

  const netMarginAmount = computeTotalNetMargin();

  const [pipelineStageDefinitions, setPipelineStageDefinitions] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/custom-field-definitions?entityType=salesPipelineStage`, { headers: getAuthHeader() })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setPipelineStageDefinitions(Array.isArray(data?.items) ? data.items : []);
      })
      .catch(() => {
        if (!cancelled) setPipelineStageDefinitions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stageForecastMap = useMemo(
    () => buildStageForecastPercentMap(pipelineStageDefinitions),
    [pipelineStageDefinitions]
  );

  const totalFinalForForecast = computeTotalFinalAmount();
  const forecastPctForStage = stageForecastMap[form.stage];
  const forecastExpectedRevenue =
    lineItems.length > 0 && Number.isFinite(forecastPctForStage) && Number.isFinite(totalFinalForForecast)
      ? Math.round(totalFinalForForecast * (forecastPctForStage / 100))
      : null;
  const forecastStageLabel =
    stageSelectOptions.find((s) => s.value === form.stage)?.label || form.stage;
  const isWonStage = form.stage === 'Won';
  const modalTitle = isWonStage
    ? (isEdit ? '계약 완료' : '새 계약 완료 추가')
    : (isEdit ? '기회 수정' : '새 영업 기회 추가');
  const totalCommissionAmount = lineItems.reduce(
    (sum, line) =>
      sum +
      (Array.isArray(line.commissionRecipients) ? line.commissionRecipients : []).reduce(
        (s, r) => s + parseNumber(r.commissionAmount),
        0
      ),
    0
  );
  const netMarginAfterCommission =
    netMarginAmount != null ? netMarginAmount - totalCommissionAmount : null;

  const headerSalesAssigneeName =
    (form.assignedToName || '').trim() ||
    (() => {
      const uid = (form.assignedToUserId || '').trim();
      if (!uid) return '';
      const emp = companyEmployees.find((e) => e?.id != null && String(e.id) === uid);
      if (!emp) return '';
      return (
        (emp.name && String(emp.name).trim()) ||
        (emp.email && String(emp.email).trim()) ||
        ''
      );
    })();

  const headerSalesAssigneeEmployee = useMemo(() => {
    const uid = (form.assignedToUserId || '').trim();
    if (!uid) return null;
    return companyEmployees.find((e) => e?.id != null && String(e.id) === uid) || null;
  }, [form.assignedToUserId, companyEmployees]);

  const headerSalesAssigneeDepartmentLabel = useMemo(() => {
    const emp = headerSalesAssigneeEmployee;
    if (!emp) return '—';
    const raw = String(emp.department || emp.companyDepartment || '').trim();
    if (!raw) return '—';
    const fromApi = String(emp.departmentDisplay || '').trim();
    if (fromApi) return fromApi;
    const resolved = String(resolveDepartmentDisplayFromChart(overviewOrgChart, raw) || '').trim();
    return resolved || raw || '—';
  }, [headerSalesAssigneeEmployee, overviewOrgChart]);

  return (
    <div className="opp-modal-overlay">
      <div className="opp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="opp-modal-header">
          <div className="opp-modal-header-left opp-modal-header-left--title-row">
            <div className="opp-modal-title-row">
              <h3 className="opp-modal-title">{modalTitle}</h3>
              <div className="opp-modal-header-assignee" role="group" aria-label="판매 담당">
                <span className="opp-modal-header-assignee-label">판매 담당</span>
                <span className="opp-modal-header-assignee-hit">
                  <button
                    type="button"
                    className={`opp-modal-header-assignee-name${headerSalesAssigneeName ? '' : ' is-empty'}`}
                    onClick={() => setShowInternalAssigneePicker(true)}
                    aria-label={`판매 담당 변경. 현재 ${headerSalesAssigneeName || '미지정'}`}
                  >
                    {headerSalesAssigneeName || '미지정'}
                  </button>
                  {/* 이름↔말주머니 사이 호버 끊김 방지(드래그 복사 시 유지) */}
                  <span className="opp-modal-header-assignee-bubble-bridge" aria-hidden="true" />
                  <div
                    className="opp-modal-header-assignee-bubble"
                    role="tooltip"
                    aria-hidden="true"
                  >
                    {headerSalesAssigneeEmployee ? (
                      <dl className="opp-modal-header-assignee-bubble-dl">
                        <dt>부서</dt>
                        <dd>{headerSalesAssigneeDepartmentLabel}</dd>
                        <dt>이름</dt>
                        <dd>
                          {String(headerSalesAssigneeEmployee.name || headerSalesAssigneeName || '').trim() || '—'}
                        </dd>
                        <dt>연락처</dt>
                        <dd>{String(headerSalesAssigneeEmployee.phone || '').trim() || '—'}</dd>
                        <dt>이메일</dt>
                        <dd>{String(headerSalesAssigneeEmployee.email || '').trim() || '—'}</dd>
                        {String(headerSalesAssigneeEmployee.roleLabel || '').trim() ? (
                          <>
                            <dt>구분</dt>
                            <dd>{String(headerSalesAssigneeEmployee.roleLabel).trim()}</dd>
                          </>
                        ) : null}
                      </dl>
                    ) : (form.assignedToUserId || '').trim() ? (
                      <p className="opp-modal-header-assignee-bubble-note">
                        사내 직원 목록에서 이 담당의 상세를 찾지 못했습니다. 이름을 눌러 다시 선택할 수 있습니다.
                      </p>
                    ) : (
                      <p className="opp-modal-header-assignee-bubble-note">
                        이름을 눌러 사내 영업 담당을 지정할 수 있습니다. 저장 시 인계·인수 안내 메일이 발송될 수 있습니다.
                      </p>
                    )}
                  </div>
                </span>
              </div>
            </div>
          </div>
          <button type="button" className="opp-modal-close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {loadingOpp ? (
          <div className="opp-modal-loading">로딩 중...</div>
        ) : (
          <>
            <div className="opp-modal-form">
              <div className="opp-modal-form-layout">
                <form
                  className="opp-modal-form-main"
                  id="opp-form"
                  onSubmit={(e) => {
                    const sub = e.nativeEvent?.submitter;
                    if (!sub || !sub.classList.contains('opp-save-btn')) {
                      e.preventDefault();
                      return;
                    }
                    void handleSubmit(e);
                  }}
                >
              {/* 고객사 / 담당자 2열 — 라벨·줄 높이 동일 */}
              <div className="opp-form-grid-2 opp-form-grid-2--company-contact">
                <div className="opp-label">
                  <div className="opp-label-top">
                    <span>고객사</span>
                  </div>
                  <div className={'opp-company-wrap' + (personalPurchase ? ' opp-company-wrap--disabled' : '')}>
                    <span className="opp-company-display">{form.customerCompanyName || '고객사 선택'}</span>
                    <button
                      type="button"
                      className="opp-company-search-btn"
                      disabled={personalPurchase}
                      onClick={() => { if (!personalPurchase) setShowCompanySearchModal(true); }}
                    >
                      <span className="material-symbols-outlined">search</span>
                      검색
                    </button>
                  </div>
                </div>
                <div className="opp-label">
                  <div className="opp-label-top opp-label-top--with-personal-btn">
                    <span>구매 담당자</span>
                    <label className="opp-personal-purchase-check">
                      <span className="opp-personal-purchase-check-text">개인구매</span>
                      <input
                        type="checkbox"
                        checked={personalPurchase}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setPersonalPurchase(next);
                          if (next) {
                            setForm((f) => ({ ...f, customerCompanyId: '', customerCompanyName: '' }));
                            setBusinessNumber('');
                          }
                        }}
                      />
                    </label>
                  </div>
                  <div className="opp-company-wrap">
                    <span className="opp-company-display">{form.contactName || '담당자 선택'}</span>
                    <button type="button" className="opp-company-search-btn" onClick={() => setShowContactSearchModal(true)}>
                      <span className="material-symbols-outlined">search</span>
                      검색
                    </button>
                  </div>
                </div>
              </div>

              {/* 제품 - 다중 선택 + 제품 추가 */}
              <div className="opp-label">
                <span>제품</span>
                <div className="opp-product-pills">
                  {lineItems.map((line) => (
                    <span key={line.lineId} className="opp-product-pill">
                      {line.productName || '제품'}
                      <button type="button" onClick={() => removeLine(line.lineId)} aria-label="제거">
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </span>
                  ))}
                  <button type="button" className="opp-product-add-btn" onClick={() => setShowProductSearchModal(true)}>
                    <span className="material-symbols-outlined">add</span>
                    제품 추가
                  </button>
                </div>
              </div>

              {lineItems.length > 0 && Object.keys(productById).length > 0 ? (
                <>
                  <label className="opp-label opp-checkbox-wrap">
                    <input type="checkbox" checked={showProductFields} onChange={(e) => setShowProductFields(e.target.checked)} />
                    <span>제품 관련 필드 표시</span>
                  </label>
                  {showProductFields && (
                    <div className="opp-product-fields">
                      {lineItems.map((line) => {
                        const selectedProduct = line.productId ? productById[line.productId] : null;
                        if (!selectedProduct) return null;
                        return (
                          <div key={line.lineId} className="opp-product-fields-block">
                            <div className="opp-product-fields-title">{selectedProduct.name || line.productName}</div>
                            <dl className="opp-product-fields-list">
                              {selectedProduct.code != null && selectedProduct.code !== '' && <><dt>코드</dt><dd>{selectedProduct.code}</dd></>}
                              {selectedProduct.category != null && selectedProduct.category !== '' && <><dt>카테고리</dt><dd>{selectedProduct.category}</dd></>}
                              {selectedProduct.version != null && selectedProduct.version !== '' && <><dt>버전</dt><dd>{selectedProduct.version}</dd></>}
                              {selectedProduct.billingType != null && selectedProduct.billingType !== '' && <><dt>결제 유형</dt><dd>{PRODUCT_BILLING_LABELS[selectedProduct.billingType] ?? selectedProduct.billingType}</dd></>}
                              {selectedProduct.status != null && selectedProduct.status !== '' && <><dt>상태</dt><dd>{selectedProduct.status}</dd></>}
                              {selectedProduct.customFields && typeof selectedProduct.customFields === 'object' && Object.entries(selectedProduct.customFields).filter(([, v]) => v != null && v !== '').map(([k, v]) => (
                                <React.Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></React.Fragment>
                              ))}
                            </dl>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : null}

              {/* 단계 - 버튼 그룹 */}
              <div className="opp-label">
                <span>단계</span>
                <div className="opp-stage-group">
                  {stageSelectOptions.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      className={'opp-stage-btn' + (form.stage === s.value ? ' opp-stage-btn--selected' : '')}
                      onClick={() => handleStageButtonClick(s.value)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 제품별 가격 기준 · 유통 · 단가 */}
              {lineItems.map((line) => (
                <section key={line.lineId} className="opp-line-block">
                  <div className="opp-line-block-head">
                    <span className="opp-line-block-title">{line.productName || '제품'}</span>
                  </div>
                  <div className="opp-label">
                    <span>가격 기준</span>
                    <p className="opp-price-basis-hint">제품 목록의 다이렉트 세일즈·유통 세일즈와 같은 가격 축을 선택합니다. 선택 시 해당 행 단가가 자동 채워집니다.</p>
                    <div className="opp-price-basis-group" role="group" aria-label={`가격 기준 ${line.productName || ''}`}>
                      {OPPORTUNITY_PRICE_BASIS_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={'opp-price-basis-btn' + (line.priceBasis === opt.value ? ' opp-price-basis-btn--selected' : '')}
                          onClick={async () => {
                            const basis = opt.value;
                            setError('');
                            let product = line.productId ? productById[line.productId] : null;
                            if (!product && line.productId) {
                              try {
                                const pres = await fetch(`${API_BASE}/products/${line.productId}`, { headers: getAuthHeader() });
                                if (pres.ok) {
                                  const pdoc = await pres.json();
                                  if (pdoc?._id) {
                                    product = pdoc;
                                    setProductById((prev) => ({ ...prev, [line.productId]: pdoc }));
                                  }
                                }
                              } catch {
                                /* ignore */
                              }
                            }
                            const sug = product ? suggestedPriceFromProduct(product, basis) : 0;
                            updateLine(line.lineId, {
                              priceBasis: basis,
                              channelDistributor: basis !== 'channel' ? '' : line.channelDistributor,
                              unitPrice: product && sug > 0 ? sug.toLocaleString() : line.unitPrice
                            });
                            if (product) {
                              setForm((f) => ({ ...f, currency: product.currency || f.currency || 'KRW' }));
                            }
                          }}
                          title={opt.desc}
                        >
                          <span className="opp-price-basis-btn-label">{opt.label}</span>
                          <span className="opp-price-basis-btn-sub">{opt.shortLabel}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {line.priceBasis === 'channel' ? (
                    <div className="opp-label opp-channel-distributor-block">
                      <span>유통사</span>
                      <p className="opp-price-basis-hint">저장 시 목록에 없는 이름은 회사 템플릿에 자동 등록됩니다. Admin 이상만 목록에서 제거할 수 있습니다.</p>
                      <div className="opp-channel-distributor-row">
                        <input
                          type="text"
                          className="opp-input opp-channel-distributor-input"
                          list={`opp-ch-dl-${line.lineId}`}
                          value={line.channelDistributor}
                          onChange={(e) => updateLine(line.lineId, { channelDistributor: e.target.value })}
                          placeholder="유통사명 입력 또는 선택"
                          maxLength={200}
                        />
                        <datalist id={`opp-ch-dl-${line.lineId}`}>
                          {channelDistributorList.map((x) => (
                            <option key={x} value={x} />
                          ))}
                        </datalist>
                        <select
                          className="opp-select opp-channel-distributor-select"
                          defaultValue=""
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v) updateLine(line.lineId, { channelDistributor: v });
                          }}
                          aria-label="등록된 유통사 목록에서 선택"
                        >
                          <option value="">목록에서 선택</option>
                          {channelDistributorList.map((x) => (
                            <option key={x} value={x}>{x}</option>
                          ))}
                        </select>
                      </div>
                      {channelDistributorList.length > 0 ? (
                        <ul className="opp-channel-distributor-chips" aria-label="등록된 유통사">
                          {channelDistributorList.map((x) => (
                            <li key={x} className="opp-channel-distributor-chip">
                              <span className="opp-channel-distributor-chip-text">{x}</span>
                              {canRemoveChannelDistributor ? (
                                <button
                                  type="button"
                                  className="opp-channel-distributor-chip-remove"
                                  onClick={() => void removeChannelDistributor(x)}
                                  aria-label={`${x} 목록에서 제거`}
                                  title="목록에서 제거 (Admin 이상)"
                                >
                                  ×
                                </button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="opp-financial-grid">
                    <div className="opp-label">
                      <span>단가</span>
                      <input
                        type="text"
                        className="opp-input"
                        value={line.unitPrice}
                        onChange={(e) => handleLineUnitPriceChange(line.lineId, e)}
                        placeholder="0"
                        inputMode="numeric"
                      />
                    </div>
                    <label className="opp-label">
                      <span>수량</span>
                      <input
                        type="number"
                        className="opp-input"
                        min={1}
                        value={line.quantity}
                        onChange={(e) => updateLine(line.lineId, { quantity: e.target.value })}
                        placeholder="1"
                      />
                    </label>
                    <div className="opp-label opp-label--span2 opp-discount-purchase-split">
                      <div className="opp-discount-purchase-split-inner">
                        <label className="opp-label opp-label--nested">
                          <span>할인율 (%)</span>
                          <input
                            type="text"
                            className="opp-input"
                            value={line.discountRate}
                            onChange={(e) => handleLineDiscountRateChange(line.lineId, e)}
                            placeholder="0"
                            inputMode="decimal"
                          />
                        </label>
                        <label className="opp-label opp-label--nested">
                          <span>매입 원가</span>
                          <input
                            type="text"
                            className="opp-input"
                            value={line.purchaseCostTotal}
                            onChange={(e) => handleLinePurchaseCostChange(line.lineId, e)}
                            placeholder="0"
                            inputMode="numeric"
                            title="직접 입력 가능. 제품을 선택하면 원가×수량이 한 번 채워지며 이후에도 수정할 수 있습니다."
                          />
                        </label>
                      </div>
                    </div>
                    <label className="opp-label opp-label--span2">
                      <span>차감금액</span>
                      <input
                        type="text"
                        className="opp-input"
                        value={line.discountAmount}
                        onChange={(e) => handleLineDiscountAmountChange(line.lineId, e)}
                        placeholder="0"
                        inputMode="numeric"
                      />
                    </label>
                  </div>

                  <section
                    className="opp-commission-section"
                    aria-label={`${line.productName || '제품'} 기타 금액`}
                  >
                    <div className="opp-commission-head">
                      <span className="opp-commission-title">기타 금액</span>
                      <button
                        type="button"
                        className="opp-commission-add"
                        onClick={() => addCommissionRecipientToLine(line.lineId)}
                        aria-label={`${line.productName || '제품'} 기타 금액 행 추가`}
                        title="행 추가"
                      >
                        <span className="material-symbols-outlined" aria-hidden>add</span>
                      </button>
                    </div>
                    <p className="opp-commission-hint">
                      이 제품 행에 반영할 기타 금액입니다. 비고는 선택이며, 순마진 계산에서 기타 금액 합만큼 차감됩니다.
                    </p>
                    {(() => {
                      const commRows =
                        Array.isArray(line.commissionRecipients) && line.commissionRecipients.length > 0
                          ? line.commissionRecipients
                          : [emptyCommissionRowForLine(line.lineId)];
                      return commRows.map((row, idx) => (
                      <div key={row.id} className="opp-commission-row">
                        <label className="opp-label opp-commission-field opp-commission-field--remarks">
                          <span>비고</span>
                          <textarea
                            className="opp-input opp-textarea opp-commission-remarks"
                            value={row.remarks}
                            onChange={(e) =>
                              updateCommissionRecipientOnLine(line.lineId, row.id, { remarks: e.target.value })
                            }
                            placeholder="필요 시만 입력"
                            maxLength={2000}
                            rows={2}
                            spellCheck={false}
                          />
                        </label>
                        <label className="opp-label opp-commission-field opp-commission-field--amount">
                          <span>금액</span>
                          <input
                            type="text"
                            className="opp-input"
                            inputMode="numeric"
                            value={row.commissionAmount}
                            onChange={(e) =>
                              updateCommissionRecipientOnLine(line.lineId, row.id, {
                                commissionAmount: formatNumberInput(e.target.value)
                              })
                            }
                            placeholder="0"
                          />
                        </label>
                        <button
                          type="button"
                          className="opp-commission-remove"
                          onClick={() => removeCommissionRecipientFromLine(line.lineId, row.id)}
                          disabled={commRows.length <= 1}
                          aria-label={`${line.productName || '제품'} 기타 금액 행 ${idx + 1} 제거`}
                          title="행 제거"
                        >
                          <span className="material-symbols-outlined" aria-hidden>delete</span>
                        </button>
                      </div>
                      ));
                    })()}
                  </section>
                </section>
              ))}

              {/* 계산 요약: 제품별 + 전체 합계 — 제품 행이 있을 때만 표시 */}
              {lineItems.length > 0 ? (
                <div className="opp-summary-box">
                  {lineItems.map((line) => {
                    const lineFinal = computeLineFinalAmount(line);
                    const lineComm = (Array.isArray(line.commissionRecipients) ? line.commissionRecipients : []).reduce(
                      (s, r) => s + parseNumber(r.commissionAmount),
                      0
                    );
                    const lineNet = computeLineNetMargin(line);
                    const lineNetShown = lineNet != null ? lineNet - lineComm : null;
                    return (
                    <div key={line.lineId} className="opp-summary-per-line">
                      <div className="opp-summary-per-line-title">{line.productName || '제품'}</div>
                      <div className="opp-summary-line-metrics" role="group" aria-label={`${line.productName || '제품'} 요약`}>
                        <div className="opp-summary-line-metric">
                          <span className="opp-summary-line-label">차감</span>
                          <span className="opp-summary-line-val">- {formatCurrencyDisplay(computeLineDeduction(line), form.currency)}</span>
                        </div>
                        <div className="opp-summary-line-metric opp-summary-line-metric--main">
                          <span className="opp-summary-line-label">최종</span>
                          <span className="opp-summary-line-val opp-summary-line-val--main">{formatCurrencyDisplay(lineFinal, form.currency)}</span>
                        </div>
                        <div className="opp-summary-line-metric opp-summary-line-metric--margin">
                          <span className="opp-summary-line-label">순마진</span>
                          <span className="opp-summary-line-val opp-summary-line-val--margin">
                            {line.productId && productById[line.productId] && lineNetShown != null
                              ? formatCurrencyDisplay(lineNetShown, form.currency)
                              : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                    );
                  })}
                  <div className="opp-summary-divider" aria-hidden />
                  <div className="opp-summary-total-block">
                    <div className="opp-summary-total-grid">
                      <div className="opp-summary-total-stack">
                        <div className="opp-summary-total-pill opp-summary-total-pill--deduct">
                          <span className="opp-summary-total-pill-label">전체 차감</span>
                          <span className="opp-summary-total-pill-val">- {formatCurrencyDisplay(computeTotalDeduction(), form.currency)}</span>
                        </div>
                        <div className="opp-summary-total-pill opp-summary-total-pill--margin" aria-label="마진 합계">
                          <span className="opp-summary-total-pill-label">마진 합계</span>
                          <span className="opp-summary-total-pill-val opp-summary-total-pill-val--margin">
                            {netMarginAfterCommission != null ? formatCurrencyDisplay(netMarginAfterCommission, form.currency) : '—'}
                          </span>
                        </div>
                        {forecastExpectedRevenue != null ? (
                          <div
                            className="opp-summary-total-pill opp-summary-total-pill--forecast"
                            aria-label="Forecast 예상 매출"
                            title={`전체 최종 금액 × 단계 Forecast (${forecastPctForStage}%)`}
                          >
                            <span className="opp-summary-total-pill-label">Forecast</span>
                            <span className="opp-summary-total-pill-meta">{forecastStageLabel} · {forecastPctForStage}%</span>
                            <span className="opp-summary-total-pill-val opp-summary-total-pill-val--forecast">
                              {formatCurrencyDisplay(forecastExpectedRevenue, form.currency)}
                            </span>
                          </div>
                        ) : null}
                      </div>
                      <div className="opp-summary-total-hero" aria-label="전체 최종 금액">
                        <span className="opp-summary-total-hero-label">전체 최종</span>
                        <span className="opp-summary-total-hero-val">
                          {formatCurrencyDisplay(computeTotalFinalAmount(), form.currency)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* 증서 · 자료 — 저장된 기회(수정)에서만. Drive 테이블은 shared/register-sale-docs-drive.js */}
              {isEdit ? (
                <section className="customer-company-detail-section register-sale-docs opp-modal-register-sale-docs">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => { handleDirectFileUpload(e.target.files); e.target.value = ''; }}
                    disabled={!canDocsUpload}
                    aria-hidden="true"
                  />
                  <div className="customer-company-detail-section-head">
                    <h3 className="customer-company-detail-section-title">
                      <span className="material-symbols-outlined">folder</span>
                      증서 · 자료
                    </h3>
                    <button
                      type="button"
                      className="customer-company-detail-btn-all"
                      onClick={() => { if (canDocsUpload && fileInputRef.current) fileInputRef.current.click(); }}
                      disabled={!canDocsUpload}
                      title={
                        canDocsUpload
                          ? '파일 추가'
                          : driveUploading
                            ? '업로드 중'
                            : '고객사(사업자번호 포함) 또는 담당자 선택 후 업로드 가능'
                      }
                      aria-label="파일 추가"
                    >
                      <span className="material-symbols-outlined">add</span>
                    </button>
                  </div>
                  
                  <div
                    className={`register-sale-docs-crm-uploads ${crmListDropActive ? 'register-sale-docs-crm-uploads--drop-active' : ''} ${driveUploading || !canDocsUpload ? 'register-sale-docs-crm-uploads--disabled' : ''}`}
                    onDragEnter={handleDocsDragEnter}
                    onDragOver={handleDocsDragOver}
                    onDragLeave={handleDocsDragLeave}
                    onDrop={handleDocsDrop}
                  >
                    <div className="opp-register-sale-docs-crm-title-row">
                      <h4 className="register-sale-docs-crm-uploads-title">
                        <span className="material-symbols-outlined">history_edu</span>
                        리스트
                      </h4>
                      {effectiveDriveFolderIdForList ? (
                        <button
                          type="button"
                          className="opp-register-sale-docs-crm-refresh"
                          onClick={() => void handleRefreshDriveDocList()}
                          disabled={driveUploading || loadingDriveFolderList || driveIndexSyncing}
                          title="Drive 폴더와 CRM 저장 목록을 맞춘 뒤, 화면을 새로고침합니다"
                        >
                          <span className="material-symbols-outlined" aria-hidden="true">
                            refresh
                          </span>
                          목록 새로고침
                        </button>
                      ) : null}
                    </div>
                    <p className="register-sale-docs-crm-uploads-hint">
                      CRM에 기록된 파일과, 같은 폴더를 Drive API로 조회한 항목을 합쳐 표시합니다. Drive 웹에서만 올린 파일을 CRM 저장 목록(MongoDB)에도 넣으려면 「목록 새로고침」으로 동기화하세요. 제품별 하위 폴더는 만들지 않습니다.
                    </p>
                    {driveListError ? (
                      <p className="register-sale-docs-error" role="alert">
                        {driveListError}
                      </p>
                    ) : null}
                    {mergedDriveDocsSorted.length === 0 ? (
                      <div
                        className={`register-sale-docs-crm-empty ${crmListDropActive ? 'register-sale-docs-crm-empty--active' : ''}`}
                        onClick={() => {
                          if (canDocsUpload && fileInputRef.current) fileInputRef.current.click();
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if ((e.key === 'Enter' || e.key === ' ') && canDocsUpload && fileInputRef.current) {
                            e.preventDefault();
                            fileInputRef.current.click();
                          }
                        }}
                      >
                        <span className="material-symbols-outlined register-sale-docs-crm-empty-icon">inbox</span>
                        <span className="register-sale-docs-crm-empty-text">
                          {driveUploading
                            ? '업로드 중…'
                            : loadingDriveFolderList
                              ? '폴더 목록을 불러오는 중…'
                              : '등록된 항목이 없습니다. 파일을 여기에 놓거나 위쪽 추가 버튼으로 올리세요. Drive 웹에서만 올린 뒤에는 「목록 새로고침」을 눌러 주세요.'}
                        </span>
                      </div>
                    ) : (
                      <RegisterSaleDocsCrmTable
                        rows={mergedDriveDocsSorted}
                        formatDriveFileDate={formatDriveFileDate}
                        driveUploading={driveUploading}
                        crmDriveDeletingId={driveDocDeletingId}
                        onDeleteRow={handleDeleteMergedDriveDoc}
                      />
                    )}
                  </div>
                  {driveError ? <p className="register-sale-docs-error">{driveError}</p> : null}
                  {driveUploadNotice && !driveError ? (
                    <p className="register-sale-docs-success" role="status">
                      {driveUploadNotice}
                    </p>
                  ) : null}
                </section>
              ) : null}

              {isEdit && oppId ? (
                <div className="opp-comments-section">
                  <div className="opp-comments-heading">코멘트</div>

                  <ul className="opp-comments-list">
                    {roots.map((c) => renderCommentItem(c))}
                  </ul>
                  <div className="customer-company-detail-journal-input-wrap opp-modal-journal-like-company-detail">
                    <p className="opp-comments-hint opp-modal-journal-hint">
                      루트 메모는 고객사 상세의 「지원 및 업무 기록」 또는 연락처 상세의 「업무 기록」과 동일하게 등록됩니다. (등록일시·음성 → 메모 저장)
                    </p>
                    {!form.customerCompanyId && !form.customerCompanyEmployeeId ? (
                      <p className="customer-company-detail-journal-error">고객사 또는 담당자(연락처)를 선택한 뒤 업무 기록을 등록할 수 있습니다.</p>
                    ) : (
                      <>
                        {journalInputError ? (
                          <p className="customer-company-detail-journal-error">{journalInputError}</p>
                        ) : null}
                        <div className="customer-company-detail-journal-datetime-row">
                          <label htmlFor="opp-modal-journal-datetime" className="customer-company-detail-journal-datetime-label">
                            등록일시
                          </label>
                          <input
                            id="opp-modal-journal-datetime"
                            type="datetime-local"
                            className="customer-company-detail-journal-datetime"
                            value={journalDateTime}
                            onChange={(e) => setJournalDateTime(e.target.value)}
                            disabled={savingJournal || audioUploading}
                            aria-label="업무 기록 등록일시"
                          />
                        </div>
                        <textarea
                          className="customer-company-detail-journal-input"
                          placeholder="회사 단위 메모 또는 업무 기록 (여러 직원 미팅 등)..."
                          rows={3}
                          maxLength={5000}
                          value={newComment}
                          onChange={(e) => setNewComment(e.target.value)}
                          disabled={savingJournal || audioUploading || commentBusy}
                        />
                        <input
                          ref={oppJournalAudioInputRef}
                          type="file"
                          accept="audio/*,.mp3,.wav,.m4a,.webm"
                          className="customer-company-detail-audio-input-hidden"
                          onChange={(e) => {
                            if (e.target.files?.length) uploadAudioForOpportunityJournal(e.target.files);
                            e.target.value = '';
                          }}
                          aria-hidden="true"
                        />
                        <div
                          className={`customer-company-detail-journal-audio-drop ${audioDropActive ? 'is-dragover' : ''} ${audioUploading ? 'is-uploading' : ''}`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!audioUploading && !savingJournal) setAudioDropActive(true);
                          }}
                          onDragLeave={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!e.currentTarget.contains(e.relatedTarget)) setAudioDropActive(false);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setAudioDropActive(false);
                            if (!audioUploading && !savingJournal && e.dataTransfer?.files?.length) {
                              uploadAudioForOpportunityJournal(e.dataTransfer.files);
                            }
                          }}
                        >
                          <span className="material-symbols-outlined">audio_file</span>
                          <span>
                            {audioUploading
                              ? '음성 처리 중… 전사·요약이 끝나면 AssemblyAI에 올린 음성 원본은 서버에서 자동 삭제됩니다.'
                              : '음성 파일 드래그앤드롭 또는 선택 (MP3/WAV/M4A/WebM). 처리가 끝나면 AssemblyAI 쪽 음성·전사 원본은 삭제됩니다.'}
                          </span>
                          <button
                            type="button"
                            className="customer-company-detail-journal-audio-btn"
                            onClick={() => oppJournalAudioInputRef.current?.click()}
                            disabled={audioUploading || savingJournal}
                          >
                            파일 선택
                          </button>
                        </div>
                        <div className="customer-company-detail-journal-actions">
                          <button
                            type="button"
                            className="customer-company-detail-journal-save"
                            onClick={handleSaveOppJournal}
                            disabled={
                              savingJournal ||
                              audioUploading ||
                              !newComment.trim() ||
                              (!form.customerCompanyId && !form.customerCompanyEmployeeId)
                            }
                          >
                            {savingJournal ? '저장 중...' : '메모 저장'}
                          </button>
                        </div>
                        {journalSummaryNotice?.text ? (
                          <p
                            className={`customer-company-detail-summary-notice is-${journalSummaryNotice.type || 'info'}`}
                          >
                            {journalSummaryNotice.text}
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                  {commentError ? <p className="opp-comment-error">{commentError}</p> : null}
                </div>
              ) : null}

              {error && <p className="opp-error">{error}</p>}
                </form>
                <aside className="opp-modal-form-finance" aria-label="기회 일정 및 계약·계산서·수금">
                  <div className="opp-form-dates-top opp-form-dates-top--sidebar" aria-label="기회 일정">
                    <div className="opp-form-dates-top-field">
                      <span className="opp-form-dates-top-label">시작일</span>
                      <input
                        type="date"
                        className="opp-input opp-input--date"
                        value={form.startDate}
                        onChange={(e) => handleChange('startDate', e.target.value)}
                      />
                    </div>
                    <div className="opp-form-dates-top-field">
                      <span className="opp-form-dates-top-label">구매 예정 날짜</span>
                      <input
                        type="date"
                        className="opp-input opp-input--date"
                        value={form.targetDate}
                        onChange={(e) => handleChange('targetDate', e.target.value)}
                      />
                    </div>
                    <div className="opp-form-dates-top-field">
                      <span className="opp-form-dates-top-label">계약일</span>
                      <input
                        type="date"
                        className="opp-input opp-input--date"
                        value={form.saleDate}
                        onChange={(e) => handleChange('saleDate', e.target.value)}
                        aria-label="계약일"
                      />
                    </div>
                    <div className="opp-form-dates-top-field opp-form-dates-top-field--block">
                      <span className="opp-form-dates-top-label">전체 완료 날짜</span>
                      <input
                        type="date"
                        className="opp-input opp-input--date"
                        value={form.fullCollectionCompleteDate}
                        onChange={(e) => {
                          fullCollectionDateTouchedRef.current = true;
                          handleChange('fullCollectionCompleteDate', e.target.value);
                        }}
                        aria-label="전체 완료 날짜"
                      />
                      <p className="opp-form-dates-top-hint">
                        수금 누적이 계약 금액 이상이 되면, 수금일 중 가장 늦은 날짜로 자동 채워집니다. 필요 시 수정할 수 있습니다.
                      </p>
                    </div>
                  </div>
                  <section className="opp-finance-section">
                    <div className="opp-finance-heading">계약·계산서·수금 관리</div>
                    <div className="opp-finance-cards">
                      <div className="opp-finance-card">
                        <div className="opp-finance-card-title">계약금액</div>
                        <div className="opp-finance-grid opp-finance-grid--single">
                          <label className="opp-label">
                            <span>금액</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9,]*"
                              className="opp-input"
                              placeholder="숫자만 입력"
                              value={form.contractAmount}
                              onChange={(e) => handleChange('contractAmount', formatNumberInput(e.target.value))}
                            />
                          </label>
                        </div>
                        <p className="opp-finance-card-hint">계약일은 위쪽 「계약일」과 동일합니다.</p>
                      </div>

                      <div className="opp-finance-card">
                        <div className="opp-finance-card-title">계산서 금액</div>
                        <div className="opp-finance-grid">
                          <label className="opp-label">
                            <span>금액</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9,]*"
                              className="opp-input"
                              placeholder="숫자만 입력"
                              value={form.invoiceAmount}
                              onChange={(e) => handleChange('invoiceAmount', formatNumberInput(e.target.value))}
                            />
                          </label>
                          <label className="opp-label">
                            <span>날짜</span>
                            <input
                              type="date"
                              className="opp-input opp-input--date"
                              value={form.invoiceAmountDate}
                              onChange={(e) => handleChange('invoiceAmountDate', e.target.value)}
                            />
                          </label>
                        </div>
                      </div>

                      <div className="opp-finance-card">
                        <div className="opp-finance-collection-head">
                          <span className="opp-finance-subheading">수금 완료금액 (누적)</span>
                          <button
                            type="button"
                            className="opp-btn-light opp-btn-icon"
                            onClick={addCollectionEntry}
                            aria-label="수금 항목 추가"
                            title="수금 항목 추가"
                          >
                            <span className="material-symbols-outlined" aria-hidden="true">add</span>
                          </button>
                        </div>
                        <div className="opp-finance-collection-list">
                          {collectionEntries.map((entry, index) => (
                            <div key={entry.id} className="opp-finance-collection-row">
                              <label className="opp-label">
                                <span>{`수금 ${index + 1} 금액`}</span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9,]*"
                                  className="opp-input"
                                  placeholder="숫자만 입력"
                                  value={entry.amount}
                                  onChange={(e) => handleCollectionAmountChange(entry.id, e.target.value)}
                                />
                              </label>
                              <label className="opp-label">
                                <span>{`수금 ${index + 1} 날짜`}</span>
                                <input
                                  type="date"
                                  className="opp-input opp-input--date"
                                  value={entry.date}
                                  onChange={(e) => handleCollectionDateChange(entry.id, e.target.value)}
                                />
                              </label>
                              <button
                                type="button"
                                className="opp-btn-light opp-btn-light--danger opp-btn-icon"
                                onClick={() => removeCollectionEntry(entry.id)}
                                disabled={collectionEntries.length <= 1}
                                aria-label={`수금 ${index + 1} 항목 삭제`}
                                title="수금 항목 삭제"
                              >
                                <span className="material-symbols-outlined" aria-hidden="true">delete</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                </aside>
              </div>
            </div>

            <div className="opp-modal-footer">
              {isEdit && canDeleteOpportunity ? (
                <button type="button" className="opp-delete-btn" onClick={handleDelete}>
                  <span className="material-symbols-outlined">delete</span>
                  삭제
                </button>
              ) : null}
              <button type="button" className="opp-cancel-btn" onClick={onClose}>취소</button>
              <button type="submit" form="opp-form" className="opp-save-btn" disabled={saving}>
                {saving ? '저장 중...' : isEdit ? '수정' : '추가'}
              </button>
            </div>
          </>
        )}
        {showCompanySearchModal && (
          <CustomerCompanySearchModal
            onClose={() => setShowCompanySearchModal(false)}
            onSelect={(company) => {
              setPersonalPurchase(false);
              setForm((f) => ({
                ...f,
                customerCompanyId: company._id,
                customerCompanyName: company.name || '',
                customerCompanyEmployeeId: ''
              }));
              setBusinessNumber(String(company?.businessNumber ?? ''));
              setShowCompanySearchModal(false);
            }}
          />
        )}
        {showContactSearchModal && (
          <CustomerCompanyEmployeesSearchModal
            customerCompanyId={form.customerCompanyId || null}
            onClose={() => setShowContactSearchModal(false)}
            onSelect={async (contact) => {
              const empId = contact._id != null ? String(contact._id) : '';
              let nextCcId = '';
              let nextCcName = '';
              let nextBn = '';
              if (contact.customerCompanyId) {
                const cc = contact.customerCompanyId;
                if (typeof cc === 'object' && cc !== null && cc._id) {
                  nextCcId = cc._id;
                  nextCcName = cc.name || contact.company || '';
                  nextBn = String(cc.businessNumber ?? '');
                } else {
                  const cid = cc;
                  try {
                    const ccRes = await fetch(`${API_BASE}/customer-companies/${cid}`, { headers: getAuthHeader() });
                    const ccData = await ccRes.json().catch(() => ({}));
                    if (ccRes.ok && ccData._id) {
                      nextCcId = ccData._id;
                      nextCcName = ccData.name || contact.company || '';
                      nextBn = String(ccData.businessNumber ?? '');
                    }
                  } catch (_) { /* ignore */ }
                }
              } else if ((contact.company || '').trim()) {
                const resolved = await resolveCustomerCompanyByAffiliationName(String(contact.company).trim());
                if (resolved) {
                  nextCcId = resolved._id;
                  nextCcName = resolved.name || '';
                  nextBn = String(resolved.businessNumber ?? '');
                }
              }
              setForm((f) => ({
                ...f,
                contactName: contact.name || '',
                customerCompanyEmployeeId: empId,
                ...(personalPurchase
                  ? {}
                  : nextCcId
                    ? { customerCompanyId: nextCcId, customerCompanyName: nextCcName }
                    : { customerCompanyId: '', customerCompanyName: '' })
              }));
              if (!personalPurchase) setBusinessNumber(nextBn);
              setShowContactSearchModal(false);
            }}
          />
        )}
        {showProductSearchModal && (
          <ProductSearchModal
            onClose={() => setShowProductSearchModal(false)}
            onSelect={(products) => {
              const list = Array.isArray(products) ? products : products ? [products] : [];
              if (!list.length) return;
              setLineItems((prev) => [...prev, ...list.map((p) => buildLineFromProduct(p, 'consumer'))]);
              setProductById((prev) => {
                const next = { ...prev };
                for (const p of list) {
                  if (p?._id) next[String(p._id)] = p;
                }
                return next;
              });
              setForm((f) => ({
                ...f,
                currency: list[0]?.currency || f.currency || 'KRW'
              }));
              setShowProductFields(false);
              setShowProductSearchModal(false);
            }}
          />
        )}
        {showInternalAssigneePicker ? (
          <ParticipantModal
            title="사내 영업 담당 선택"
            bulkAddLabel="표시된 인원 모두 선택에 반영"
            teamMembers={teamMembersForParticipantModal}
            selected={internalAssigneeParticipantSelected}
            currentUser={currentUserForParticipantModal}
            onClose={() => setShowInternalAssigneePicker(false)}
            onConfirm={(picked) => {
              setShowInternalAssigneePicker(false);
              if (!picked || picked.length === 0) {
                setForm((f) => ({ ...f, assignedToUserId: '', assignedToName: '' }));
                return;
              }
              const last = picked[picked.length - 1];
              const id = String(last.userId || '').trim();
              const namePick = String(last.name || '').trim();
              const emp = companyEmployees.find((e) => e?.id != null && String(e.id) === id);
              const nameFromList = emp?.name != null ? String(emp.name).trim() : '';
              const name = namePick || nameFromList;
              setForm((f) => ({
                ...f,
                assignedToUserId: id,
                assignedToName: name || (id ? f.assignedToName : '')
              }));
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
