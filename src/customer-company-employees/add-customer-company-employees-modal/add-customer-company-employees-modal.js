import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import GoogleContactsModal from '../google-contacts-modal/google-contacts-modal';
import CustomerCompanySearchModal from '../../customer-companies/customer-company-search-modal/customer-company-search-modal';
import CustomFieldsSection from '../../shared/custom-fields-section';
import AssigneePickerModal from '../../company-overview/assignee-picker-modal/assignee-picker-modal';
import '../../customer-companies/add-company-modal/add-company-modal.css';
import './add-customer-company-employees-modal.css';
import ContactImportPreviewModal from './contact-import-preview-modal';
import ContactSavePregateModal from './contact-save-pregate-modal';
import CustomerCompanyDetailModal from '../../customer-companies/customer-company-detail-modal/customer-company-detail-modal';

import { API_BASE } from '@/config';
import { normalizeBulkImportCompanyGroupKey } from '@/lib/bulk-import-company-group-key';
import { geocodeAddressForCompanySave } from '@/lib/geocode-company-address';
import { buildDriveFileDeleteUrl, getDriveFileIdFromUrl, isValidDriveNodeId, sanitizeDriveFolderWebViewLink } from '@/lib/google-drive-url';
import { pingBackendHealth } from '@/lib/backend-wake';
import { pruneDriveUploadedFilesIndex, syncDriveUploadedFilesIndex } from '@/lib/drive-uploaded-files-prune';
import {
  RegisterSaleDocsCrmTable,
  fileToBase64,
  formatDriveFileDate,
  keepLatestBusinessCardRowOnlyInDriveUploads,
  runDriveDirectFileUpload,
  sortDriveUploadedFiles
} from '@/shared/register-sale-docs-drive';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const CONTACT_STATUS_PRESET_VALUES = ['Lead', 'Active', 'Pending', 'Inactive'];
/** 드롭다운에 함께 표시할 설명 (저장값은 왼쪽 키 그대로) */
const CONTACT_STATUS_DESCRIPTIONS = {
  Lead: '잠재 리드 · 첫 접촉 전',
  Active: '진행 중 · 활성',
  Pending: '대기 · 보류',
  Inactive: '비활성 · 종료'
};

function formatPhoneInput(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.startsWith('010') && digits.length <= 11) {
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
  }
  if (digits.startsWith('02') && digits.length <= 10) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

function sanitizeFolderNamePart(s, maxLen = 80) {
  const t = String(s ?? '')
    .replace(/[/\\*?:<>"|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

/** 증서·자료·명함 루트 — 항상 [개인명]_[연락처] */
function buildPersonalDriveFolderName(contactLike) {
  const namePart = sanitizeFolderNamePart(contactLike?.name || '이름없음', 80);
  const contactPart = sanitizeFolderNamePart(contactLike?.phone || contactLike?.email || '미등록', 40);
  return `${namePart}_${contactPart}`;
}

/** 고객사 확정 시 상위 폴더 — [고객사명]_[사업자번호] */
function buildCompanyDriveFolderName(contactLike) {
  const namePart = sanitizeFolderNamePart(
    contactLike?.customerCompanyId?.name || contactLike?.companyName || '미소속',
    80
  );
  const numPart =
    sanitizeFolderNamePart(
      contactLike?.customerCompanyId?.businessNumber != null
        ? String(contactLike.customerCompanyId.businessNumber).replace(/\D/g, '')
        : ''
    ) || '미등록';
  return `${namePart}_${numPart}`;
}

function getDriveFolderIdFromLink(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.trim().match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

/** Drive 업로드용: 고객사명·연락처 기반 파일명 (add-company 사업자등록증 명명 규칙과 동일한 방식) */
/** 폼 값이 객체일 수 있어 명함 업로드·폴더 분기용으로만 정규화 */
function normalizeSnapshotCompanyId(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object' && raw._id) return String(raw._id);
  const s = String(raw).trim();
  return s || null;
}

function buildBusinessCardDriveFileName(snapshot, file) {
  const namePart = sanitizeFolderNamePart(snapshot.name || '이름없음', 50).replace(/\s+/g, '_') || '이름없음';
  const contactRaw = (snapshot.phone || snapshot.email || '미등록').trim();
  const contactPart = sanitizeFolderNamePart(contactRaw.replace(/[^\w\s가-힣@.-]/g, ' '), 45).replace(/\s+/g, '_') || '미등록';
  const m = (file?.type || '').toLowerCase();
  let ext = 'jpg';
  if (m.includes('png')) ext = 'png';
  else if (m.includes('webp')) ext = 'webp';
  else if (m.includes('gif')) ext = 'gif';
  else {
    const fn = file?.name || '';
    const i = fn.lastIndexOf('.');
    if (i >= 0) ext = fn.slice(i + 1).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'jpg';
  }
  const base = `명함_${namePart}_${contactPart}.${ext}`;
  return base.length > 200 ? `${base.slice(0, 196 - ext.length)}.${ext}` : base;
}

function isTxtFile(file) {
  if (!file) return false;
  const n = (file.name || '').toLowerCase();
  return file.type === 'text/plain' || n.endsWith('.txt');
}

function isBusinessCardLikeFile(file) {
  if (!file) return false;
  if (isTxtFile(file)) return true;
  return (file.type || '').startsWith('image/');
}

/** 파일 2개 이상일 때만 배치 미리보기 (TXT 1개는 명함 이미지 1개와 동일하게 폼 기입) */
function shouldUseContactBatchPreview(files) {
  const arr = Array.from(files || []);
  return arr.length >= 2;
}

/** 다른 앱·브라우저에서 복사한 이미지(캡처 등) → File — Ctrl+V 붙여넣기용 */
function clipboardDataToImageFile(clipboardData) {
  if (!clipboardData) return null;
  const items = clipboardData.items;
  if (items && items.length) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f && String(f.type || '').startsWith('image/')) return f;
      }
      if (item.type && String(item.type).startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          const t = blob.type || item.type || 'image/png';
          const ext = t.includes('png')
            ? 'png'
            : t.includes('jpeg') || t.includes('jpg')
              ? 'jpg'
              : t.includes('webp')
                ? 'webp'
                : t.includes('gif')
                  ? 'gif'
                  : 'png';
          return new File([blob], `clipboard-${Date.now()}.${ext}`, { type: t });
        }
      }
    }
  }
  const { files } = clipboardData;
  if (files && files.length) {
    const f = files[0];
    if (f && String(f.type || '').startsWith('image/')) return f;
  }
  return null;
}

/** 연락처 담당자 초기값: 수정 시 = 저장된 값만(없으면 빈 배열), 등록 시 = 현재 사용자 1명 */
function getInitialAssigneeIds(isEditMode, contact) {
  if (isEditMode && contact != null) {
    if (!Array.isArray(contact.assigneeUserIds)) return [];
    return contact.assigneeUserIds
      .map((id) => {
        if (id == null) return null;
        const raw = id._id ?? id.id ?? id;
        return raw ? String(raw) : null;
      })
      .filter(Boolean);
  }
  try {
    const u = JSON.parse(localStorage.getItem('crm_user') || '{}');
    return u?._id ? [String(u._id)] : [];
  } catch (_) {
    return [];
  }
}

/** 폼 초기값: 등록/수정에 따라 담당자만 다르게, 나머지는 contact 또는 initialCustomerCompany 기준 */
function buildInitialForm(contact, initialCustomerCompany) {
  const isEditMode = Boolean(contact && (contact._id || contact.id));
  const assigneeUserIds = getInitialAssigneeIds(isEditMode, contact);

  const base = {
    name: '',
    company: '',
    email: '',
    phone: '',
    position: '',
    leadSource: '',
    address: '',
    birthDate: '',
    memo: '',
    customerCompanyId: '',
    customFields: {},
    assigneeUserIds,
    status: 'Lead'
  };

  if (isEditMode && contact) {
    const companyId = contact.customerCompanyId?._id ?? contact.customerCompanyId ?? '';
    const companyName = companyId
      ? (typeof contact.company === 'string' ? contact.company : (contact.company?.name ?? ''))
      : ((contact.companyName && String(contact.companyName).trim())
        || (typeof contact.company === 'string' ? contact.company : (contact.company?.name ?? '')) || '');
    return {
      ...base,
      name: String(contact.name ?? '').replace(/\s/g, ''),
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      position: contact.position ?? '',
      leadSource: contact.leadSource ?? '',
      address: contact.address ?? '',
      birthDate: contact.birthDate ?? '',
      memo: contact.memo ?? '',
      company: companyName,
      customerCompanyId: companyId ? String(companyId) : '',
      customFields: contact.customFields ? { ...contact.customFields } : {},
      assigneeUserIds,
      status: contact.status || 'Lead'
    };
  }

  if (initialCustomerCompany && (initialCustomerCompany._id || initialCustomerCompany.name)) {
    return {
      ...base,
      company: initialCustomerCompany.name || '',
      customerCompanyId: initialCustomerCompany._id || '',
      address: initialCustomerCompany.address != null ? String(initialCustomerCompany.address).trim() : ''
    };
  }

  return base;
}

export default function AddContactModal({ onClose, onSaved, onUpdated, initialCustomerCompany, contact }) {
  const isEditMode = Boolean(contact && (contact._id || contact.id));
  /** 신규 등록 시에만 고객사 상세에서 넘어온 회사를 고정(수정 모드에서는 항상 검색·변경 가능) */
  const fixedCompany = !isEditMode && !!(initialCustomerCompany && initialCustomerCompany._id);

  const [form, setForm] = useState(() => buildInitialForm(contact, initialCustomerCompany));
  const [linkedCompanyBusinessNumber, setLinkedCompanyBusinessNumber] = useState('');
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [companyEmployeesForDisplay, setCompanyEmployeesForDisplay] = useState([]);
  const [customDefinitions, setCustomDefinitions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showCompanySearchModal, setShowCompanySearchModal] = useState(false);
  const [showBulkGoogle, setShowBulkGoogle] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  /** 저장 직전: 이름/전화 OR 중복, 또는 신규 고객사명 유사 중복 */
  const [preSaveReview, setPreSaveReview] = useState(null);
  /** 저장 전 확인 중: 유사 고객사 행 클릭 시 상세 모달(상위 z-index) */
  const [companyDetailPeek, setCompanyDetailPeek] = useState(null);
  /** 대량(Google/명함): save-preflight 결과 후 사용자 선택 */
  const [bulkPreReview, setBulkPreReview] = useState(null);

  useEffect(() => {
    if (!isEditMode || !contact) {
      setLinkedCompanyBusinessNumber('');
      return;
    }
    const cc = contact.customerCompanyId;
    if (cc && typeof cc === 'object' && cc.businessNumber != null && String(cc.businessNumber).trim()) {
      setLinkedCompanyBusinessNumber(String(cc.businessNumber).trim());
    } else if (contact.company && typeof contact.company === 'object' && contact.company.businessNumber != null) {
      setLinkedCompanyBusinessNumber(String(contact.company.businessNumber).trim());
    } else {
      setLinkedCompanyBusinessNumber('');
    }
  }, [isEditMode, contact]);

  /** 고객사 칸·검색 선택 모두 비었을 때 = 개인 연락처 (고정 고객사 맥락이 아닐 때만) */
  const isIndividual = useMemo(() => {
    if (fixedCompany) return false;
    const hasId = !!String(form.customerCompanyId || '').trim();
    const hasCompanyText = !!(form.company || '').trim();
    return !hasId && !hasCompanyText;
  }, [fixedCompany, form.customerCompanyId, form.company]);

  const statusOptions = useMemo(() => {
    const current = String(form.status || '').trim() || 'Lead';
    const values = Array.from(new Set([current, ...CONTACT_STATUS_PRESET_VALUES]));
    return values.map((value) => ({
      value,
      label: CONTACT_STATUS_DESCRIPTIONS[value] || '사용자 지정·저장된 키'
    }));
  }, [form.status]);

  const cardInputRef = useRef(null);
  const driveFileInputRef = useRef(null);
  /** 명함 리스트 영역: 드래그·클릭만 로컬 준비(저장 시 업로드) */
  const businessCardListInputRef = useRef(null);
  /** 연락처 모달 본문 — 클립보드 이미지 붙여넣기 캡처(포커스가 모달 안에 있을 때) */
  const modalPanelRef = useRef(null);
  const [businessCardFile, setBusinessCardFile] = useState(null);
  const [businessCardDropActive, setBusinessCardDropActive] = useState(false);
  const [extractingBusinessCard, setExtractingBusinessCard] = useState(false);
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [importPreviewItems, setImportPreviewItems] = useState([]);
  const [importPreviewLoading, setImportPreviewLoading] = useState(false);
  const [importBulkSaving, setImportBulkSaving] = useState(false);

  const contactId = contact?._id ?? contact?.id ?? null;
  const [displayedContact, setDisplayedContact] = useState(null);
  useEffect(() => {
    setDisplayedContact((prev) => ({ ...(prev || {}), ...(contact || {}) }));
  }, [contact]);

  const contactToShow = displayedContact || contact || {};
  const companyIdForSales = contactToShow?.customerCompanyId?._id ?? contactToShow?.customerCompanyId ?? null;
  /** 고객사가 DB에서 확인 가능(사업자 번호 있음)일 때만 고객사 Drive 폴더·CRM 리스트 — 상세 모달과 동일 */
  const hasConfirmedCompany = Boolean(
    companyIdForSales &&
      contactToShow?.customerCompanyId?.businessNumber &&
      String(contactToShow.customerCompanyId.businessNumber).trim()
  );

  const driveFolderName = useMemo(() => buildPersonalDriveFolderName(contactToShow), [contactToShow]);

  const companyDriveFolderName = useMemo(() => {
    if (!hasConfirmedCompany) return '';
    return buildCompanyDriveFolderName(contactToShow);
  }, [hasConfirmedCompany, contactToShow]);

  const crmDriveUploadsSorted = useMemo(() => {
    const raw = contactToShow?.driveUploadedFiles;
    const sorted = sortDriveUploadedFiles(raw);
    return keepLatestBusinessCardRowOnlyInDriveUploads(sorted, contactToShow);
  }, [contactToShow?.driveUploadedFiles, contactToShow?.name, contactToShow?.phone, contactToShow?.email]);

  /** 이 블록 표는 명함만: `명함_` 파일명 + 동일 연락처 최신 1건. CRM 배열에 없고 businessCardDriveUrl 만 있을 때 보조 1행 */
  const crmBusinessCardRowsOnly = useMemo(() => {
    const fromList = crmDriveUploadsSorted.filter((row) => String(row?.name || '').startsWith('명함_'));
    if (fromList.length > 0) return fromList;
    const url = (contactToShow.businessCardDriveUrl || '').trim();
    if (!url) return [];
    const fid = getDriveFileIdFromUrl(url);
    const base = {
      name: '명함',
      webViewLink: url,
      modifiedTime: contactToShow.updatedAt || '',
      uploadedAt: contactToShow.updatedAt || ''
    };
    if (fid && isValidDriveNodeId(fid)) {
      return [{ ...base, driveFileId: fid }];
    }
    return [{ ...base, driveFileId: '' }];
  }, [crmDriveUploadsSorted, contactToShow.businessCardDriveUrl, contactToShow.updatedAt]);

  /** 명함 리스트 표시: 준비된 파일이 있으면 그걸만(저장 시 반영), 없으면 서버 CRM 행 */
  const businessCardTableRows = useMemo(() => {
    if (businessCardFile) {
      const snapshot = {
        name: form.name.replace(/\s/g, '').trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        customerCompanyId: form.customerCompanyId,
        isIndividual,
        companyLabel: form.company.trim()
      };
      return [
        {
          driveFileId: '__pending__',
          name: buildBusinessCardDriveFileName(snapshot, businessCardFile),
          webViewLink: '',
          modifiedTime: '',
          uploadedAt: '',
          isPendingUpload: true
        }
      ];
    }
    return crmBusinessCardRowsOnly;
  }, [
    businessCardFile,
    crmBusinessCardRowsOnly,
    form.name,
    form.phone,
    form.email,
    form.customerCompanyId,
    form.company,
    isIndividual
  ]);

  const [driveFolderId, setDriveFolderId] = useState(null);
  const [driveFolderLink, setDriveFolderLink] = useState('');
  const [driveUploading, setDriveUploading] = useState(false);
  const [driveError, setDriveError] = useState('');
  const [driveUploadNotice, setDriveUploadNotice] = useState('');
  const [crmListDropActive, setCrmListDropActive] = useState(false);
  const [crmDriveDeletingId, setCrmDriveDeletingId] = useState('');
  const driveRootEnsureInFlightRef = useRef(false);

  /** [개인명]_[연락처] 폴더 링크 — 증서·자료·명함 루트 */
  const driveMongoRegisteredUrl = useMemo(() => {
    const id = contactToShow?.driveRootFolderId || driveFolderId;
    const raw = contactToShow?.driveRootFolderWebViewLink;
    const fromDb = id ? sanitizeDriveFolderWebViewLink(raw, id) : '';
    if (fromDb) return fromDb;
    return driveFolderLink || '';
  }, [contactToShow?.driveRootFolderId, contactToShow?.driveRootFolderWebViewLink, driveFolderId, driveFolderLink]);

  /** 고객사 루트 [고객사명]_[사업자번호] — Mongo 고객사 또는 연락처에 캐시된 부모 ID */
  const companyDriveRegisteredUrl = useMemo(() => {
    if (!hasConfirmedCompany) return '';
    const id =
      contactToShow?.customerCompanyId?.driveCustomerRootFolderId || contactToShow?.driveCustomerRootFolderId;
    const raw =
      contactToShow?.customerCompanyId?.driveCustomerRootFolderWebViewLink ||
      contactToShow?.driveCustomerRootFolderWebViewLink;
    const fromDb = id ? sanitizeDriveFolderWebViewLink(raw, id) : '';
    return fromDb || '';
  }, [
    hasConfirmedCompany,
    contactToShow?.customerCompanyId?.driveCustomerRootFolderId,
    contactToShow?.customerCompanyId?.driveCustomerRootFolderWebViewLink,
    contactToShow?.driveCustomerRootFolderId,
    contactToShow?.driveCustomerRootFolderWebViewLink
  ]);

  useEffect(() => {
    const id = contactToShow?.driveRootFolderId;
    const linkRaw = contactToShow?.driveRootFolderWebViewLink;
    if (!id || !isValidDriveNodeId(String(id))) return;
    const sanitized = sanitizeDriveFolderWebViewLink(linkRaw, id);
    if (!sanitized) return;
    setDriveFolderId(id);
    setDriveFolderLink(sanitized);
  }, [contactId, contactToShow?.driveRootFolderId, contactToShow?.driveRootFolderWebViewLink]);

  useEffect(() => {
    setDriveUploadNotice('');
  }, [contactId]);

  const ensureDriveRootFolder = useCallback(
    async (contactOverride) => {
      const c = contactOverride || contactToShow;
      const pid = c?._id ?? c?.id ?? contactId;
      const personalFolderName = buildPersonalDriveFolderName(c);
      if (!personalFolderName || !pid) return null;

      const cc = c?.customerCompanyId;
      const companyObj = typeof cc === 'object' && cc ? cc : null;
      const cid = companyObj?._id ?? (typeof cc === 'string' && cc.trim() ? cc : null);
      const hasBn = companyObj?.businessNumber && String(companyObj.businessNumber).trim();
      const confirmed = Boolean(cid && hasBn);

      if (confirmed && cid) {
        const cfolderName = buildCompanyDriveFolderName(c);
        const r1 = await fetch(`${API_BASE}/drive/folders/ensure`, {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            folderName: cfolderName,
            customerCompanyId: String(cid)
          })
        });
        const data1 = await r1.json().catch(() => ({}));
        if (!r1.ok || !data1.id) {
          throw new Error(data1.error || '고객사 Drive 폴더를 준비할 수 없습니다.');
        }
        const companyFolderId = String(data1.id);
        const companyFolderLink = sanitizeDriveFolderWebViewLink(data1.webViewLink, companyFolderId);
        if (!companyFolderLink) {
          throw new Error('고객사 Drive 폴더 링크를 만들 수 없습니다.');
        }

        const r2 = await fetch(`${API_BASE}/drive/folders/ensure`, {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            folderName: personalFolderName,
            parentFolderId: companyFolderId,
            customerCompanyEmployeeId: String(pid)
          })
        });
        const data2 = await r2.json().catch(() => ({}));
        if (!r2.ok || !data2.id) {
          throw new Error(data2.error || '연락처 개인 폴더를 준비할 수 없습니다.');
        }
        if (!isValidDriveNodeId(String(data2.id))) {
          throw new Error('Drive 폴더 ID 형식이 올바르지 않습니다.');
        }
        const folderLink = sanitizeDriveFolderWebViewLink(data2.webViewLink, data2.id);
        if (!folderLink) {
          throw new Error('Drive 폴더 링크를 만들 수 없습니다.');
        }
        setDriveFolderId(data2.id);
        setDriveFolderLink(folderLink);
        setDisplayedContact((prev) => ({
          ...(prev || {}),
          driveRootFolderId: data2.id,
          driveRootFolderWebViewLink: folderLink,
          driveCustomerRootFolderId: companyFolderId,
          driveCustomerRootFolderWebViewLink: companyFolderLink,
          customerCompanyId: {
            ...(typeof prev?.customerCompanyId === 'object' && prev.customerCompanyId ? prev.customerCompanyId : {}),
            _id: cid,
            name: companyObj?.name ?? prev?.customerCompanyId?.name,
            businessNumber: companyObj?.businessNumber ?? prev?.customerCompanyId?.businessNumber,
            driveCustomerRootFolderId: companyFolderId,
            driveCustomerRootFolderWebViewLink: companyFolderLink
          }
        }));
        return { id: data2.id, webViewLink: folderLink };
      }

      const rootRes = await fetch(`${API_BASE}/custom-field-definitions/drive-root`, { headers: getAuthHeader() });
      const rootJson = await rootRes.json().catch(() => ({}));
      const driveRootUrl =
        rootJson.driveRootUrl != null && String(rootJson.driveRootUrl).trim() ? String(rootJson.driveRootUrl).trim() : '';
      if (!driveRootUrl) {
        throw new Error('회사 공유 드라이브 경로를 먼저 설정해 주세요. (회사 개요 → 전체 공유 드라이브 주소)');
      }
      const registeredFolderId = getDriveFolderIdFromLink(driveRootUrl);
      if (!registeredFolderId) {
        throw new Error('드라이브 경로 형식이 올바르지 않습니다.');
      }
      const r = await fetch(`${API_BASE}/drive/folders/ensure`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          folderName: personalFolderName,
          parentFolderId: registeredFolderId,
          customerCompanyEmployeeId: String(pid)
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
      if (!folderLink) {
        throw new Error('Drive 폴더 링크를 만들 수 없습니다.');
      }
      setDriveFolderId(data.id);
      setDriveFolderLink(folderLink);
      setDisplayedContact((prev) => ({
        ...(prev || {}),
        driveRootFolderId: data.id,
        driveRootFolderWebViewLink: folderLink,
        driveCustomerRootFolderId: registeredFolderId,
        driveCustomerRootFolderWebViewLink: sanitizeDriveFolderWebViewLink(null, registeredFolderId)
      }));
      return { id: data.id, webViewLink: folderLink };
    },
    [contactId, contactToShow]
  );

  useEffect(() => {
    if (!contactId || !driveFolderName || !isEditMode) return;
    if (driveRootEnsureInFlightRef.current) return;
    driveRootEnsureInFlightRef.current = true;
    (async () => {
      try {
        await ensureDriveRootFolder();
      } catch (err) {
        setDriveError((prev) => prev || (err?.message || 'Drive 폴더를 준비할 수 없습니다.'));
      } finally {
        driveRootEnsureInFlightRef.current = false;
      }
    })();
  }, [contactId, driveFolderName, hasConfirmedCompany, isEditMode, ensureDriveRootFolder]);

  /** 수정 모달: Drive 직속 파일 ↔ Mongo 목록 동기화(추가 후 정리) */
  useEffect(() => {
    const fid = contactToShow?.driveRootFolderId;
    if (!contactId || !fid || !isValidDriveNodeId(String(fid).trim())) return undefined;
    let cancelled = false;
    (async () => {
      await syncDriveUploadedFilesIndex({
        getAuthHeader,
        folderId: String(fid).trim(),
        customerCompanyEmployeeId: String(contactId)
      });
      if (cancelled) return;
      await pruneDriveUploadedFilesIndex({
        getAuthHeader,
        folderId: String(fid).trim(),
        customerCompanyEmployeeId: String(contactId)
      });
      if (cancelled) return;
      try {
        const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}`, { headers: getAuthHeader() });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?._id) setDisplayedContact((prev) => ({ ...(prev || {}), ...data }));
      } catch (_) {}
    })();
    return () => {
      cancelled = true;
    };
  }, [contactId, contactToShow?.driveRootFolderId]);

  const handleDirectFileUpload = useCallback(
    async (files) => {
      await runDriveDirectFileUpload({
        files,
        driveFolderId,
        driveFolderLink,
        ensureParentFolder: ensureDriveRootFolder,
        buildUploadBody: (file, contentBase64, parentId) => ({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          contentBase64,
          parentFolderId: parentId,
          customerCompanyEmployeeId: String(contactId)
        }),
        getAuthHeader,
        setDriveUploading,
        setDriveError,
        setDriveUploadNotice,
        onSuccess: async () => {
          try {
            const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}`, { headers: getAuthHeader() });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data?._id) setDisplayedContact((prev) => ({ ...(prev || {}), ...data }));
          } catch (_) {}
        }
      });
    },
    [contactId, driveFolderId, driveFolderLink, ensureDriveRootFolder]
  );

  const handleDeleteCrmDriveFile = useCallback(
    async (row) => {
      if (row?.isPendingUpload || String(row?.driveFileId || '') === '__pending__') {
        setBusinessCardFile(null);
        setDriveError('');
        return;
      }
      const fid = row?.driveFileId && String(row.driveFileId).trim();
      if (!fid || !contactId || !isValidDriveNodeId(fid)) return;
      if (!window.confirm(`「${row.name || '파일'}」을 Drive 휴지통으로 옮기고 목록에서 제거할까요?`)) return;
      setCrmDriveDeletingId(fid);
      setDriveError('');
      try {
        await pingBackendHealth(getAuthHeader);
        const url = buildDriveFileDeleteUrl(fid, { customerCompanyEmployeeId: String(contactId) });
        const res = await fetch(url, { method: 'DELETE', headers: getAuthHeader(), credentials: 'include' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setDriveError(data.error || '삭제에 실패했습니다.');
          return;
        }
        const r2 = await fetch(`${API_BASE}/customer-company-employees/${contactId}`, { headers: getAuthHeader() });
        const data2 = await r2.json().catch(() => ({}));
        if (r2.ok && data2?._id) setDisplayedContact((prev) => ({ ...(prev || {}), ...data2 }));
        setDriveUploadNotice('파일을 삭제했습니다.');
        window.setTimeout(() => setDriveUploadNotice(''), 5000);
      } catch (_) {
        setDriveError('삭제 중 오류가 났습니다.');
      } finally {
        setCrmDriveDeletingId('');
      }
    },
    [contactId]
  );

  const fetchCustomDefinitions = async () => {
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=contact`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) setCustomDefinitions(data.items);
    } catch (_) {}
  };

  useEffect(() => {
    fetchCustomDefinitions();
  }, []);

  /** 수정 모드에서 열린 연락처(contact)가 바뀌면 폼을 그 연락처 기준으로 다시 채움 (담당자 포함) */
  useEffect(() => {
    if (!contactId) return;
    setForm(buildInitialForm(contact, initialCustomerCompany));
  }, [contactId]);

  useEffect(() => {
    setBusinessCardFile(null);
  }, [contactId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/companies/overview`, { headers: getAuthHeader() })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.employees)) setCompanyEmployeesForDisplay(data.employees);
      });
    return () => { cancelled = true; };
  }, []);

  const assigneeIdToName = useMemo(() => {
    const map = {};
    (companyEmployeesForDisplay || []).forEach((e) => {
      const id = e.id != null ? String(e.id) : null;
      if (id) map[id] = e.name || e.email || id;
    });
    return map;
  }, [companyEmployeesForDisplay]);

  const assigneeInputValue = (form.assigneeUserIds || [])
    .map((id) => assigneeIdToName[String(id)] || id)
    .join(', ');

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showBulkGoogle) setShowBulkGoogle(false);
      else if (showAssigneePicker) setShowAssigneePicker(false);
      else if (showCompanySearchModal) setShowCompanySearchModal(false);
      else if (showImportPreview) setShowImportPreview(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showAssigneePicker, showBulkGoogle, showCompanySearchModal, showImportPreview]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'phone') setForm((prev) => ({ ...prev, phone: formatPhoneInput(value) }));
    else if (name === 'name') setForm((prev) => ({ ...prev, name: value.replace(/\s/g, '') }));
    else setForm((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  /** 고객사 직접 입력 시 DB 연결 해제(customerCompanyId null로 저장됨) */
  const handleCompanyInputChange = (e) => {
    setForm((prev) => ({ ...prev, company: e.target.value, customerCompanyId: '' }));
    setLinkedCompanyBusinessNumber('');
    setError('');
  };

  /** 명함 이미지 → Gemini 추출 → 폼 기입 (회사명은 고객사 칸에, 이름은 띄어쓰기 제거) */
  const extractFromBusinessCardAndFillForm = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('명함은 이미지 파일만 등록할 수 있습니다.');
      return;
    }
    setExtractingBusinessCard(true);
    setError('');
    try {
      await pingBackendHealth(getAuthHeader);
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/customer-company-employees/extract-from-business-card`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '명함에서 정보를 읽지 못했습니다.');
        return;
      }
      setForm((prev) => {
        const cn = data.companyName && String(data.companyName).trim();
        const nameNoSpace = (s) => String(s || '').replace(/\s/g, '');
        const next = {
          ...prev,
          name: nameNoSpace(data.name && String(data.name).trim()) || nameNoSpace(prev.name),
          email: (data.email && String(data.email).trim()) || prev.email,
          phone: data.phone ? formatPhoneInput(String(data.phone)) : prev.phone,
          position: (data.position && String(data.position).trim()) || prev.position,
          address: (data.address && String(data.address).trim()) || prev.address
        };
        if (!fixedCompany && cn) {
          next.company = cn;
          next.customerCompanyId = '';
        }
        return next;
      });
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setExtractingBusinessCard(false);
    }
  };

  /** TXT 1개 → preview-import 후 연락처 1건이면 명함 단건과 동일하게 폼 반영, 2건 이상이면 배치 미리보기(수정 모드는 1건만) */
  const extractFromTxtAndFillForm = async (file) => {
    if (!file) return;
    setExtractingBusinessCard(true);
    setError('');
    try {
      await pingBackendHealth(getAuthHeader);
      const fd = new FormData();
      fd.append('files', file);
      const res = await fetch(`${API_BASE}/customer-company-employees/preview-import`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '텍스트에서 정보를 읽지 못했습니다.');
        return;
      }
      const items = Array.isArray(data.items) ? data.items : [];
      const valid = items.filter(
        (r) => !r.error && ((r.name || '').trim() || (r.email || '').trim() || (r.phone || '').trim())
      );
      if (!valid.length) {
        const firstErr = items.find((r) => r.error);
        setError(firstErr?.error || '추출된 연락처가 없습니다.');
        return;
      }
      if (valid.length > 1) {
        if (isEditMode) {
          setError('수정 모드에서는 TXT에서 연락처 한 건만 추출된 경우만 폼에 반영할 수 있습니다.');
          return;
        }
        setImportPreviewItems(items);
        setShowImportPreview(true);
        return;
      }
      const row = valid[0];
      const nameNoSpace = (s) => String(s || '').replace(/\s/g, '');
      setForm((prev) => {
        const cn = (row.companyName && String(row.companyName).trim()) || '';
        const next = {
          ...prev,
          name: nameNoSpace(row.name && String(row.name).trim()) || nameNoSpace(prev.name),
          email: (row.email && String(row.email).trim()) || prev.email,
          phone: row.phone ? formatPhoneInput(String(row.phone)) : prev.phone,
          position: (row.position && String(row.position).trim()) || prev.position,
          address: (row.address && String(row.address).trim()) || prev.address
        };
        if (!fixedCompany && cn) {
          next.company = cn;
          next.customerCompanyId = '';
        }
        return next;
      });
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setExtractingBusinessCard(false);
    }
  };

  const runContactPreviewImport = useCallback(async (files) => {
    const arr = Array.from(files || []).filter((f) => isBusinessCardLikeFile(f));
    if (!arr.length) {
      setError('파일을 추가해 주세요.');
      return;
    }
    setImportPreviewLoading(true);
    setError('');
    try {
      await pingBackendHealth(getAuthHeader);
      const fd = new FormData();
      arr.forEach((f) => fd.append('files', f));
      const res = await fetch(`${API_BASE}/customer-company-employees/preview-import`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '미리보기에 실패했습니다.');
        return;
      }
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) {
        setError('추출된 연락처가 없습니다.');
        return;
      }
      setImportPreviewItems(items);
      setShowImportPreview(true);
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setImportPreviewLoading(false);
    }
  }, []);

  const buildBulkEntryFromImportRow = (row) => {
    const cn = (row.companyName || '').trim();
    if (fixedCompany && initialCustomerCompany?._id) {
      return {
        name: String(row.name || '').replace(/\s/g, '').trim(),
        phone: row.phone ? formatPhoneInput(String(row.phone)) : '',
        companyName: '',
        customerCompanyId: String(initialCustomerCompany._id)
      };
    }
    if (cn) {
      return {
        name: String(row.name || '').replace(/\s/g, '').trim(),
        phone: row.phone ? formatPhoneInput(String(row.phone)) : '',
        companyName: cn,
        customerCompanyId: ''
      };
    }
    return {
      name: String(row.name || '').replace(/\s/g, '').trim(),
      phone: row.phone ? formatPhoneInput(String(row.phone)) : '',
      companyName: '',
      customerCompanyId: ''
    };
  };

  const runImportRowsBulk = async (rows, preResults, forceAll) => {
    const assigneeUserIds = Array.isArray(form.assigneeUserIds) ? form.assigneeUserIds : [];
    const batchCustomerCompanyIdByNormKey = new Map();
    let success = 0;
    let fail = 0;
    let skipped = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const entry = buildBulkEntryFromImportRow(row);
      const pr = (preResults && preResults[i]) || {};
      const hold = rowNeedsImportBulkHold(pr, entry);
      if (hold && !forceAll) {
        skipped += 1;
        continue;
      }
      try {
        const payload = {
          name: String(row.name || '').replace(/\s/g, '').trim(),
          email: (row.email || '').trim(),
          phone: row.phone ? formatPhoneInput(String(row.phone)) : '',
          position: (row.position || '').trim() || undefined,
          address: (row.address || '').trim() || undefined,
          status: 'Lead',
          assigneeUserIds
        };
        if (fixedCompany && initialCustomerCompany?._id) {
          payload.customerCompanyId = String(initialCustomerCompany._id);
          if ((form.company || '').trim()) payload.companyName = (form.company || '').trim();
        } else {
          const cn = (row.companyName || '').trim();
          if (cn) {
            const gk = normalizeBulkImportCompanyGroupKey(cn);
            const reuseId = gk ? batchCustomerCompanyIdByNormKey.get(gk) : null;
            if (reuseId) {
              payload.customerCompanyId = reuseId;
              payload.companyName = cn;
            } else {
              payload.customerCompanyId = null;
              payload.companyName = cn;
              payload.forceCreateNewCustomerCompany = true;
            }
          } else {
            payload.isIndividual = true;
            payload.customerCompanyId = null;
            payload.companyName = '';
          }
        }
        if (form.customFields && Object.keys(form.customFields).length) {
          payload.customFields = form.customFields;
        }
        if (!payload.name && !payload.email && !payload.phone) {
          fail += 1;
          continue;
        }
        if (hold && forceAll) {
          if ((pr.contactCandidates || []).length) payload.forceCreateDespiteContactDuplicate = true;
        }
        const res = await fetch(`${API_BASE}/customer-company-employees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          success += 1;
          if (!(fixedCompany && initialCustomerCompany?._id)) {
            const cn = (row.companyName || '').trim();
            if (cn && data.customerCompanyId) {
              const gk = normalizeBulkImportCompanyGroupKey(cn);
              if (gk && !batchCustomerCompanyIdByNormKey.has(gk)) {
                batchCustomerCompanyIdByNormKey.set(gk, String(data.customerCompanyId));
              }
            }
          }
        } else fail += 1;
      } catch {
        fail += 1;
      }
    }
    return { success, fail, skipped, total: rows.length };
  };

  const confirmBulkContactImport = async () => {
    const rows = importPreviewItems.filter(
      (r) => !r.error && ((r.name || '').trim() || (r.email || '').trim() || (r.phone || '').trim())
    );
    if (!rows.length) {
      setError('등록할 유효한 행이 없습니다.');
      return;
    }
    setImportBulkSaving(true);
    setError('');
    setBulkPreReview(null);
    try {
      await pingBackendHealth(getAuthHeader);
      const entries = rows.map((r) => buildBulkEntryFromImportRow(r));
      const preRes = await fetch(`${API_BASE}/customer-company-employees/save-preflight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ entries })
      });
      const preData = await preRes.json().catch(() => ({}));
      if (!preRes.ok) {
        setError(preData.error || '대량 등록을 미리 확인하는 데 실패했습니다.');
        return;
      }
      const preResults = Array.isArray(preData.results) ? preData.results : [];
      const anyHold = preResults.some((r, i) => rowNeedsImportBulkHold(r, entries[i] || {}));
      if (anyHold) {
        setBulkPreReview({
          source: 'import',
          importRows: rows,
          preResults,
          entries
        });
        return;
      }
      const { success, fail, skipped, total } = await runImportRowsBulk(rows, preResults, false);
      setShowImportPreview(false);
      setImportPreviewItems([]);
      if (success > 0) {
        const msg = `등록 ${success}건${skipped ? `, 제외 ${skipped}건` : ''}${fail ? `, 실패 ${fail}건` : ''} (총 ${total}건).`;
        window.alert(msg);
        onSaved?.();
        onClose?.();
      } else {
        setError(`등록에 실패했습니다. (${fail}건${skipped ? `, 제외 ${skipped}건` : ''})`);
      }
    } catch {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setImportBulkSaving(false);
    }
  };

  const processBusinessCardFileSelection = useCallback(
    (fileList) => {
      const arr = Array.from(fileList || []).filter((f) => isBusinessCardLikeFile(f));
      if (!arr.length) {
        setError('지원 형식: 이미지, TXT 메모');
        return;
      }
      if (isEditMode) {
        if (arr.length > 1) {
          setError('수정 모드에서는 명함 파일을 하나만 선택해 주세요.');
          return;
        }
        if (arr.length === 1 && isTxtFile(arr[0])) {
          extractFromTxtAndFillForm(arr[0]);
          return;
        }
        if (arr.length === 1 && (arr[0].type || '').startsWith('image/')) {
          setBusinessCardFile(arr[0]);
          extractFromBusinessCardAndFillForm(arr[0]);
          return;
        }
        setError('수정 모드에서는 명함 이미지 또는 TXT 한 개만 선택할 수 있습니다.');
        return;
      }
      if (shouldUseContactBatchPreview(arr)) {
        runContactPreviewImport(arr);
        return;
      }
      if (arr.length === 1) {
        if (isTxtFile(arr[0])) {
          extractFromTxtAndFillForm(arr[0]);
        } else {
          setBusinessCardFile(arr[0]);
          extractFromBusinessCardAndFillForm(arr[0]);
        }
      }
    },
    [isEditMode, runContactPreviewImport, fixedCompany]
  );

  /** 수정 모드 · 명함 리스트 드롭: 이미지·TXT → Gemini로 폼 반영, 그 외 → Drive 즉시 업로드(증서·기타) */
  const handleEditModeBusinessCardListDrop = useCallback(
    (files) => {
      const filesArray = Array.from(files || []);
      if (!filesArray.length) return;
      const certLike = filesArray.filter((f) => isBusinessCardLikeFile(f));
      const nonCert = filesArray.filter((f) => !isBusinessCardLikeFile(f));
      if (!certLike.length) {
        void handleDirectFileUpload(filesArray);
        return;
      }
      if (nonCert.length > 0) {
        setDriveError('명함(이미지·TXT)과 다른 형식을 함께 놓을 수 없습니다. 나누어 주세요.');
        return;
      }
      if (certLike.length > 1) {
        setDriveError('수정 모드에서는 명함 파일을 하나만 놓아 주세요.');
        return;
      }
      const file = certLike[0];
      if (isTxtFile(file)) {
        void extractFromTxtAndFillForm(file);
        return;
      }
      setBusinessCardFile(file);
      setDriveError('');
      void extractFromBusinessCardAndFillForm(file);
    },
    [handleDirectFileUpload, extractFromBusinessCardAndFillForm, extractFromTxtAndFillForm]
  );

  /** 클립보드에 이미지가 있을 때 붙여넣기 → 드래그 앤 드롭과 동일하게 명함 인식 */
  useLayoutEffect(() => {
    const panel = modalPanelRef.current;
    if (!panel) return undefined;
    const onPaste = (e) => {
      if (showBulkGoogle || showImportPreview || showCompanySearchModal || showAssigneePicker || preSaveReview || bulkPreReview) return;
      if (extractingBusinessCard || importPreviewLoading || driveUploading) return;
      if (saving) return;
      const file = clipboardDataToImageFile(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      if (isEditMode && contactId) {
        handleEditModeBusinessCardListDrop([file]);
      } else {
        processBusinessCardFileSelection([file]);
      }
    };
    panel.addEventListener('paste', onPaste, true);
    return () => panel.removeEventListener('paste', onPaste, true);
  }, [
    showBulkGoogle,
    showImportPreview,
    showCompanySearchModal,
    showAssigneePicker,
    preSaveReview,
    bulkPreReview,
    extractingBusinessCard,
    importPreviewLoading,
    driveUploading,
    saving,
    isEditMode,
    contactId,
    handleEditModeBusinessCardListDrop,
    processBusinessCardFileSelection
  ]);

  /**
   * 연락처 저장 후 명함 업로드:
   *  등록폴더 / [고객사명]_[사업자번호](있을 때) / [개인명]_[연락처] / business card
   */
  const performBusinessCardUpload = useCallback(async (empId, file, snapshot) => {
    const rootRes = await fetch(`${API_BASE}/custom-field-definitions/drive-root`, { headers: getAuthHeader() });
    const rootJson = await rootRes.json().catch(() => ({}));
    const driveRootUrl = rootJson.driveRootUrl != null ? String(rootJson.driveRootUrl).trim() : '';
    if (!driveRootUrl) {
      return { ok: false, error: '회사 공유 드라이브 경로를 먼저 설정해 주세요. (회사 개요 → 전체 공유 드라이브 주소)' };
    }
    const registeredFolderId = getDriveFolderIdFromLink(driveRootUrl);
    if (!registeredFolderId) {
      return { ok: false, error: '드라이브 경로 형식이 올바르지 않습니다.' };
    }

    const ccId = normalizeSnapshotCompanyId(snapshot.customerCompanyId);
    let parentForPersonalFolder = registeredFolderId;
    let companyFolderLink = '';
    let companyFolderId = '';

    if (ccId) {
      let ccName = snapshot.companyLabel || '';
      let ccBn = '';
      try {
        const ccRes = await fetch(`${API_BASE}/customer-companies/${ccId}`, { headers: getAuthHeader() });
        const cc = await ccRes.json().catch(() => ({}));
        if (ccRes.ok && cc._id) {
          ccName = cc.name || ccName;
          ccBn = cc.businessNumber || '';
        }
      } catch (_) {}
      const bnPart = String(ccBn || '').replace(/\D/g, '') || '미등록';
      const companyFolderName = `${sanitizeFolderNamePart(ccName || '미소속', 80)}_${sanitizeFolderNamePart(bnPart, 20)}`;
      const ensureCompany = await fetch(`${API_BASE}/drive/folders/ensure`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ folderName: companyFolderName, customerCompanyId: String(ccId) })
      });
      const companyData = await ensureCompany.json().catch(() => ({}));
      if (!ensureCompany.ok || !companyData.id) {
        return { ok: false, error: companyData.error || '고객사 Drive 폴더를 준비할 수 없습니다.' };
      }
      companyFolderId = String(companyData.id);
      companyFolderLink = sanitizeDriveFolderWebViewLink(companyData.webViewLink, companyFolderId);
      parentForPersonalFolder = companyFolderId;
    }

    const contactLike = {
      name: snapshot.name,
      phone: snapshot.phone,
      email: snapshot.email
    };
    const personalFolderName = buildPersonalDriveFolderName(contactLike);
    const ensurePersonal = await fetch(`${API_BASE}/drive/folders/ensure`, {
      method: 'POST',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        folderName: personalFolderName,
        parentFolderId: parentForPersonalFolder,
        customerCompanyEmployeeId: String(empId)
      })
    });
    const personalData = await ensurePersonal.json().catch(() => ({}));
    if (!ensurePersonal.ok || !personalData.id) {
      return { ok: false, error: personalData.error || '연락처 개인 폴더를 준비할 수 없습니다.' };
    }
    const personalFolderId = String(personalData.id);
    const personalFolderLink = sanitizeDriveFolderWebViewLink(personalData.webViewLink, personalFolderId);

    const bcRes = await fetch(`${API_BASE}/drive/folders/ensure`, {
      method: 'POST',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ folderName: 'business card', parentFolderId: personalFolderId })
    });
    const bcData = await bcRes.json().catch(() => ({}));
    if (!bcRes.ok || !bcData.id) {
      return { ok: false, error: bcData.error || 'business card 폴더를 준비할 수 없습니다.' };
    }

    const contentBase64 = await fileToBase64(file);
    if (!contentBase64) {
      return { ok: false, error: '파일 변환에 실패했습니다.' };
    }
    const uploadBody = {
      name: buildBusinessCardDriveFileName(snapshot, file),
      mimeType: file.type || 'image/jpeg',
      contentBase64,
      parentFolderId: bcData.id,
      customerCompanyEmployeeId: String(empId)
    };
    const uploadRes = await fetch(`${API_BASE}/drive/upload`, {
      method: 'POST',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(uploadBody)
    });
    const uploadData = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok || !uploadData.webViewLink) {
      return { ok: false, error: uploadData.error || 'Drive 명함 업로드에 실패했습니다.' };
    }

    const patchBody = {
      businessCardDriveUrl: uploadData.webViewLink,
      driveRootFolderId: personalFolderId,
      driveRootFolderWebViewLink: personalFolderLink || '',
      driveCustomerRootFolderId: ccId ? companyFolderId || parentForPersonalFolder : registeredFolderId,
      driveCustomerRootFolderWebViewLink: ccId
        ? companyFolderLink || sanitizeDriveFolderWebViewLink(null, parentForPersonalFolder)
        : sanitizeDriveFolderWebViewLink(null, registeredFolderId)
    };
    const patchRes = await fetch(`${API_BASE}/customer-company-employees/${empId}`, {
      method: 'PATCH',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody)
    });
    if (!patchRes.ok) {
      const pe = await patchRes.json().catch(() => ({}));
      return { ok: false, error: pe.error || '명함 Drive 링크 저장에 실패했습니다.' };
    }
    const patchedEmployee = await patchRes.json().catch(() => ({}));
    return { ok: true, businessCardDriveUrl: uploadData.webViewLink, patchedEmployee };
  }, []);

  const buildBulkEntryFromGoogle = (c, useFixedCompany) => {
    const gCompany = (c.company || '').trim();
    return {
      name: String(c.name || '').replace(/\s/g, '').trim(),
      phone: c.phone ? formatPhoneInput(c.phone).trim() : '',
      companyName: useFixedCompany ? '' : gCompany,
      customerCompanyId: useFixedCompany && initialCustomerCompany?._id ? String(initialCustomerCompany._id) : ''
    };
  };

  const rowNeedsBulkHold = (pr, entry) => {
    if (!pr) return false;
    if ((pr.contactCandidates || []).length) return true;
    const willCo = (entry.companyName || '').trim() && !(String(entry.customerCompanyId || '').trim());
    if (willCo && (pr.similarCustomerCompanies || []).length) return true;
    return false;
  };

  /** 명함 일괄 등록: 고객사 유사는 무시하고 진행 — 이름·전화 중복만 미리보류 */
  const rowNeedsImportBulkHold = (pr, entry) => {
    if (!pr) return false;
    if ((pr.contactCandidates || []).length) return true;
    return false;
  };

  const runGoogleBulkLoop = async (contacts, preResults, forceAll) => {
    const useFixedCompany = !!(initialCustomerCompany && initialCustomerCompany._id);
    const batchCustomerCompanyIdByNormKey = new Map();
    const currentUserId = (() => {
      try {
        const u = JSON.parse(localStorage.getItem('crm_user') || '{}');
        return u?._id ? String(u._id) : null;
      } catch (_) {
        return null;
      }
    })();
    let success = 0;
    let fail = 0;
    let skipped = 0;
    for (let i = 0; i < contacts.length; i += 1) {
      const c = contacts[i];
      const entry = buildBulkEntryFromGoogle(c, useFixedCompany);
      const pr = (preResults && preResults[i]) || {};
      const hold = rowNeedsBulkHold(pr, entry);
      if (hold && !forceAll) {
        skipped += 1;
        continue;
      }
      try {
        const gCompany = (c.company || '').trim();
        const payload = {
          name: String(c.name || '').replace(/\s/g, '').trim(),
          email: (c.email || '').trim(),
          phone: c.phone ? formatPhoneInput(c.phone).trim() : '',
          position: (c.title || '').trim(),
          companyName: useFixedCompany ? '' : gCompany,
          address: (useFixedCompany && initialCustomerCompany?.address)
            ? String(initialCustomerCompany.address).trim()
            : (c.address || '').trim(),
          birthDate: (c.birthday || '').trim(),
          memo: (c.biography || '').trim() || undefined,
          status: 'Lead',
          isIndividual: !useFixedCompany && !gCompany,
          assigneeUserIds: currentUserId ? [currentUserId] : []
        };
        if (useFixedCompany) payload.customerCompanyId = initialCustomerCompany._id;
        if (!useFixedCompany && gCompany) {
          const gk = normalizeBulkImportCompanyGroupKey(gCompany);
          const reuseId = gk ? batchCustomerCompanyIdByNormKey.get(gk) : null;
          payload.customerCompanyId = reuseId || null;
        }
        if (!payload.name && !payload.email && !payload.phone) {
          fail += 1;
          continue;
        }
        if (hold && forceAll) {
          if ((pr.contactCandidates || []).length) payload.forceCreateDespiteContactDuplicate = true;
          if (
            (entry.companyName || '').trim() &&
            !(String(entry.customerCompanyId || '').trim()) &&
            (pr.similarCustomerCompanies || []).length
          ) {
            payload.forceCreateNewCustomerCompany = true;
          }
        }
        const res = await fetch(`${API_BASE}/customer-company-employees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          success += 1;
          if (!useFixedCompany && gCompany && data.customerCompanyId) {
            const gk = normalizeBulkImportCompanyGroupKey(gCompany);
            if (gk && !batchCustomerCompanyIdByNormKey.has(gk)) {
              batchCustomerCompanyIdByNormKey.set(gk, String(data.customerCompanyId));
            }
          }
        } else fail += 1;
      } catch (_) {
        fail += 1;
      }
    }
    return { success, fail, skipped, total: contacts.length };
  };

  const handleBulkImport = async (contacts) => {
    if (!contacts || contacts.length === 0) return;
    setBulkResult(null);
    setError('');
    setBulkPreReview(null);
    const useFixedCompany = !!(initialCustomerCompany && initialCustomerCompany._id);
    setBulkSaving(true);
    try {
      await pingBackendHealth(getAuthHeader);
      const entries = contacts.map((c) => buildBulkEntryFromGoogle(c, useFixedCompany));
      const preRes = await fetch(`${API_BASE}/customer-company-employees/save-preflight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ entries })
      });
      const preData = await preRes.json().catch(() => ({}));
      if (!preRes.ok) {
        setError(preData.error || '대량 등록을 미리 확인하는 데 실패했습니다.');
        return;
      }
      const preResults = Array.isArray(preData.results) ? preData.results : [];
      const anyHold = preResults.some((r, i) => rowNeedsBulkHold(r, entries[i] || {}));
      if (anyHold) {
        setBulkPreReview({ source: 'google', contacts, preResults, entries });
        return;
      }
      const { success, fail, skipped, total } = await runGoogleBulkLoop(contacts, preResults, false);
      setBulkResult({ success, fail, skipped, total });
      if (success > 0) onSaved?.();
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setBulkSaving(false);
    }
  };

  const resolveBulkPreReview = async (forceAll) => {
    if (!bulkPreReview) return;
    const b = bulkPreReview;
    setBulkPreReview(null);
    if (b.source === 'google') {
      setBulkSaving(true);
      try {
        const { success, fail, skipped, total } = await runGoogleBulkLoop(b.contacts, b.preResults, forceAll);
        setBulkResult({ success, fail, skipped, total });
        if (success > 0) onSaved?.();
      } catch (_) {
        setError('대량 등록 중 오류가 났습니다.');
      } finally {
        setBulkSaving(false);
      }
      return;
    }
    setImportBulkSaving(true);
    try {
      const { success, fail, skipped, total } = await runImportRowsBulk(b.importRows, b.preResults, forceAll);
      setShowImportPreview(false);
      setImportPreviewItems([]);
      if (success > 0) {
        window.alert(
          `등록 ${success}건${skipped ? `, 제외 ${skipped}건` : ''}${fail ? `, 실패 ${fail}건` : ''} (총 ${total}건).`
        );
        onSaved?.();
        onClose?.();
      } else {
        setError(`등록에 실패했습니다. (${fail}건${skipped ? `, 제외 ${skipped}건` : ''})`);
      }
    } catch (_) {
      setError('대량 등록 중 오류가 났습니다.');
    } finally {
      setImportBulkSaving(false);
    }
  };

  const runContactSave = async (
    e,
    {
      forceCreateDespiteContactDuplicate = false,
      forceCreateNewCustomerCompany = false,
      /** 저장 직전에만 병합(React setState 비동기 대비 — 기존 고객사 연결 등) */
      formPatch = null
    } = {}
  ) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    setError('');
    setPreSaveReview(null);
    const f = formPatch && typeof formPatch === 'object' ? { ...form, ...formPatch } : form;
    const hasName = !!(f.name && f.name.trim());
    const hasEmail = !!(f.email && f.email.trim());
    const hasPhone = !!(f.phone && f.phone.trim());
    const hasContactBit = hasName || hasEmail || hasPhone;
    if (!hasContactBit) {
      setError('이름, 이메일, 전화번호 중 최소 한 가지는 입력해 주세요.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: f.name.replace(/\s/g, '').trim(),
        email: f.email.trim(),
        phone: f.phone.trim(),
        position: (f.position || '').trim() || undefined,
        leadSource: (f.leadSource || '').trim() || undefined,
        address: (f.address || '').trim() || undefined,
        birthDate: (f.birthDate || '').trim() || undefined,
        memo: (f.memo || '').trim() || undefined,
        status: (f.status && String(f.status).trim()) || 'Lead'
      };
      if (isIndividual) {
        payload.isIndividual = true;
        payload.customerCompanyId = null;
        payload.companyName = '';
      } else {
        const companyId = String(f.customerCompanyId || '').trim();
        if (companyId) {
          payload.customerCompanyId = companyId;
          if ((f.company || '').trim()) payload.companyName = (f.company || '').trim();
        } else {
          payload.customerCompanyId = null;
          payload.companyName = (f.company || '').trim();
        }
      }
      if (f.customFields && Object.keys(f.customFields).length) payload.customFields = f.customFields;
      payload.assigneeUserIds = Array.isArray(f.assigneeUserIds) ? f.assigneeUserIds : [];
      if (forceCreateDespiteContactDuplicate) {
        payload.forceCreateDespiteContactDuplicate = true;
      }
      if (forceCreateNewCustomerCompany) {
        payload.forceCreateNewCustomerCompany = true;
      }

      const companyIdStr = String(f.customerCompanyId || '').trim();
      const companyNameTrim = (f.company || '').trim();
      const creatingCustomerCompanyByName = !isIndividual && !companyIdStr && !!companyNameTrim;
      const addrTrim = (f.address || '').trim();
      if (creatingCustomerCompanyByName) {
        payload.companyAddress = addrTrim;
        if (addrTrim) {
          try {
            const coords = await geocodeAddressForCompanySave(addrTrim);
            if (coords?.latitude != null && coords?.longitude != null) {
              payload.customerCompanyLatitude = coords.latitude;
              payload.customerCompanyLongitude = coords.longitude;
            }
          } catch (_) {}
        }
      }

      const url = isEditMode ? `${API_BASE}/customer-company-employees/${contact._id || contact.id}` : `${API_BASE}/customer-company-employees`;
      const method = isEditMode ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && data.code === 'SIMILAR_CUSTOMER_COMPANY' && Array.isArray(data.similarCustomerCompanies)) {
          setError(data.error || '비슷한 상호의 고객사가 이미 있습니다.');
          setPreSaveReview({
            contactCandidates: [],
            similarCustomerCompanies: data.similarCustomerCompanies
          });
        } else if (res.status === 409 && data.duplicateId) {
          setError(data.error || '동일한 이름·연락처가 이미 있습니다.');
        } else {
          setError(data.error || (isEditMode ? '수정에 실패했습니다.' : '저장에 실패했습니다.'));
        }
        return;
      }
      const empId = isEditMode ? (contact._id || contact.id) : (data._id || data.id);
      const snapshot = {
        name: f.name.replace(/\s/g, '').trim(),
        phone: f.phone.trim(),
        email: f.email.trim(),
        customerCompanyId: f.customerCompanyId,
        isIndividual,
        companyLabel: f.company.trim()
      };
      let merged = data;
      try {
        const detailRes = await fetch(`${API_BASE}/customer-company-employees/${empId}`, { headers: getAuthHeader() });
        const detail = await detailRes.json().catch(() => ({}));
        if (detailRes.ok && detail._id) merged = detail;
      } catch (_) {}
      setDisplayedContact((prev) => ({ ...(prev || {}), ...merged }));

      let payloadOut = merged;
      if (businessCardFile && empId) {
        const up = await performBusinessCardUpload(empId, businessCardFile, snapshot);
        if (!up.ok) {
          setError(
            `${isEditMode ? '연락처는 저장되었으나' : '연락처는 등록되었으나'} 명함 저장에 실패했습니다. ${up.error || ''}`.trim()
          );
          if (isEditMode) onUpdated?.(data);
          else onSaved?.(merged);
          onClose?.();
          return;
        }
        payloadOut = {
          ...merged,
          ...(up.patchedEmployee && typeof up.patchedEmployee === 'object' ? up.patchedEmployee : {}),
          businessCardDriveUrl: up.businessCardDriveUrl
        };
        setDisplayedContact((prev) => ({ ...(prev || {}), ...payloadOut }));
      } else {
        try {
          await ensureDriveRootFolder(merged);
        } catch (ensureErr) {
          setDriveError((prev) => prev || ensureErr?.message || 'Drive 폴더를 준비할 수 없습니다.');
        }
      }

      try {
        const syncRes = await fetch(`${API_BASE}/customer-company-employees/${empId}/sync-drive-folder`, {
          method: 'POST',
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const syncData = await syncRes.json().catch(() => ({}));
        if (syncRes.ok && syncData._id) {
          setDisplayedContact((prev) => ({ ...(prev || {}), ...syncData }));
          payloadOut = { ...payloadOut, ...syncData };
        }
      } catch (_) {}

      setBusinessCardFile(null);
      if (isEditMode) {
        onUpdated?.(payloadOut);
        onClose?.();
      } else {
        onSaved?.(payloadOut);
        onClose?.();
      }
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const hasName = !!(form.name && form.name.trim());
    const hasEmail = !!(form.email && form.email.trim());
    const hasPhone = !!(form.phone && form.phone.trim());
    const hasContactBit = hasName || hasEmail || hasPhone;
    if (!hasContactBit) {
      setError('이름, 이메일, 전화번호 중 최소 한 가지는 입력해 주세요.');
      return;
    }
    setSaving(true);
    try {
      await pingBackendHealth(getAuthHeader);
      const editingEmployeeId =
        (contact?._id ?? contact?.id ?? displayedContact?._id ?? displayedContact?.id) ?? null;
      const cParams = new URLSearchParams();
      cParams.set('name', (form.name || '').replace(/\s/g, '').trim());
      cParams.set('phone', (form.phone || '').trim());
      if (editingEmployeeId != null && String(editingEmployeeId).trim() !== '') {
        cParams.set('excludeEmployeeId', String(editingEmployeeId));
      }
      const cRes = await fetch(`${API_BASE}/customer-company-employees/duplicate-candidates?${cParams.toString()}`, {
        headers: getAuthHeader()
      });
      const cData = await cRes.json().catch(() => ({}));
      let contactCandidates = Array.isArray(cData.candidates) ? cData.candidates : [];
      if (editingEmployeeId != null && String(editingEmployeeId).trim() !== '') {
        const ex = String(editingEmployeeId);
        contactCandidates = contactCandidates.filter((c) => c && String(c._id) !== ex);
      }
      const companyIdStrP = String(form.customerCompanyId || '').trim();
      const companyNameTrimP = (form.company || '').trim();
      const willCreateCompanyByName = !isIndividual && !companyIdStrP && !!companyNameTrimP;
      let similarCustomerCompanies = [];
      if (willCreateCompanyByName) {
        const sParams = new URLSearchParams({ name: companyNameTrimP });
        const sRes = await fetch(`${API_BASE}/customer-companies/similar-name-candidates?${sParams.toString()}`, {
          headers: getAuthHeader()
        });
        const sData = await sRes.json().catch(() => ({}));
        similarCustomerCompanies = Array.isArray(sData.similar) ? sData.similar : [];
      }
      if (contactCandidates.length > 0 || similarCustomerCompanies.length > 0) {
        setPreSaveReview({ contactCandidates, similarCustomerCompanies });
        return;
      }
    } catch (_) {
      setError('중복·유사 상호를 확인하는 중 오류가 났습니다.');
      return;
    } finally {
      setSaving(false);
    }
    await runContactSave(null, {});
  };

  return (
    <div className={`add-contact-modal-overlay ${isEditMode ? 'add-contact-modal-overlay--slide' : ''}`}>
      <div
        ref={modalPanelRef}
        className={`add-contact-modal ${isEditMode ? 'add-contact-modal--slide' : ''}`}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        {showBulkGoogle && (
          <GoogleContactsModal
            mode="bulk"
            onBulkSelect={(contacts) => { setShowBulkGoogle(false); handleBulkImport(contacts); }}
            onClose={() => setShowBulkGoogle(false)}
          />
        )}
        <div className="add-contact-modal-header">
          <h3>{isEditMode ? '연락처 수정' : '새 연락처 추가'}</h3>
          <button type="button" className="add-contact-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="add-contact-modal-form">
          <div className="add-contact-modal-body">
          {!isEditMode && (
            <>
              <button
                type="button"
                className="add-contact-google-import"
                onClick={() => setShowBulkGoogle(true)}
              >
                <img src="https://www.gstatic.com/images/branding/product/1x/contacts_2022_48dp.png" alt="" className="add-contact-google-icon" />
                Google 주소록에서 가져오기
              </button>
              {bulkSaving && (
                <div className="add-contact-bulk-progress">
                  <span className="material-symbols-outlined add-contact-bulk-spinner">sync</span>
                  대량 등록 중… 잠시 기다려 주세요.
                </div>
              )}
              {bulkResult && (
                <div className={`add-contact-bulk-result ${bulkResult.fail > 0 ? 'has-fail' : ''}`}>
                  <span className="material-symbols-outlined">{bulkResult.fail > 0 ? 'info' : 'check_circle'}</span>
                  총 {bulkResult.total}명 중 <strong>{bulkResult.success}명</strong> 등록 완료
                  {bulkResult.skipped > 0 && <>, {bulkResult.skipped}명 제외(중복·유사)</>}
                  {bulkResult.fail > 0 && <>, {bulkResult.fail}명 실패</>}
                  <button type="button" className="add-contact-bulk-dismiss" onClick={() => setBulkResult(null)}>×</button>
                </div>
              )}
            </>
          )}
          {isEditMode && contactId ? (
            <section className="customer-company-detail-section register-sale-docs" aria-label="증서 · 자료">
              <input
                ref={cardInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = '';
                  if (file) {
                    setBusinessCardFile(file);
                    extractFromBusinessCardAndFillForm(file);
                  }
                }}
                aria-hidden="true"
              />
              <input
                ref={driveFileInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => { handleDirectFileUpload(e.target.files); e.target.value = ''; }}
                disabled={driveUploading}
                aria-hidden="true"
              />
              <input
                ref={businessCardListInputRef}
                type="file"
                accept="image/*,.txt,text/plain"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  e.target.value = '';
                  if (f) handleEditModeBusinessCardListDrop([f]);
                }}
                aria-hidden="true"
              />
              <div className="customer-company-detail-section-head">
                <h3 className="customer-company-detail-section-title">
                  <span className="material-symbols-outlined">folder</span>
                  증서 · 자료
                </h3>
                <div className="register-sale-docs-section-actions">
                  <button
                    type="button"
                    className="customer-company-detail-btn-all"
                    onClick={() => {
                      if (!driveUploading && !extractingBusinessCard && driveFileInputRef.current) {
                        driveFileInputRef.current.click();
                      }
                    }}
                    disabled={driveUploading || extractingBusinessCard}
                    title="파일 추가"
                    aria-label="파일 추가"
                  >
                    <span className="material-symbols-outlined">add</span>
                  </button>
                  <button
                    type="button"
                    className="customer-company-detail-btn-all"
                    onClick={() => { if (!extractingBusinessCard && !driveUploading && cardInputRef.current) cardInputRef.current.click(); }}
                    disabled={extractingBusinessCard || driveUploading}
                    title="명함 인식으로 폼 채우기"
                    aria-label="명함 인식으로 폼 채우기"
                  >
                    <span className="material-symbols-outlined">swap_horiz</span>
                  </button>
                </div>
              </div>
              <div
                className={`register-sale-docs-crm-uploads ${crmListDropActive ? 'register-sale-docs-crm-uploads--drop-active' : ''} ${driveUploading || saving || extractingBusinessCard || importPreviewLoading ? 'register-sale-docs-crm-uploads--disabled' : ''}`}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!driveUploading && !saving && !extractingBusinessCard && !importPreviewLoading) setCrmListDropActive(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!driveUploading && !saving && !extractingBusinessCard && !importPreviewLoading) setCrmListDropActive(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!e.currentTarget.contains(e.relatedTarget)) setCrmListDropActive(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCrmListDropActive(false);
                  if (driveUploading || saving || extractingBusinessCard || importPreviewLoading) return;
                  const list = e.dataTransfer?.files;
                  if (!list?.length) return;
                  handleEditModeBusinessCardListDrop(list);
                }}
              >
                <h4 className="register-sale-docs-crm-uploads-title">
                  <span className="material-symbols-outlined">badge</span>
                  명함 리스트
                </h4>
                <p className="register-sale-docs-crm-uploads-hint">
                  드래그 앤 드롭(다중 가능) 또는 클릭. 캡처 화면을 클립보드에 둔 뒤 이 창을 클릭한 다음 붙여넣기(Ctrl+V)로도 가능합니다.
               </p>
                {businessCardTableRows.length === 0 ? (
                  <div
                    className={`register-sale-docs-crm-empty ${crmListDropActive ? 'register-sale-docs-crm-empty--active' : ''}`}
                    onClick={() => {
                      if (
                        !driveUploading &&
                        !saving &&
                        !extractingBusinessCard &&
                        !importPreviewLoading &&
                        businessCardListInputRef.current
                      ) {
                        businessCardListInputRef.current.click();
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (
                        (e.key === 'Enter' || e.key === ' ') &&
                        !driveUploading &&
                        !saving &&
                        !extractingBusinessCard &&
                        !importPreviewLoading &&
                        businessCardListInputRef.current
                      ) {
                        e.preventDefault();
                        businessCardListInputRef.current.click();
                      }
                    }}
                  >
                    <span className="material-symbols-outlined register-sale-docs-crm-empty-icon">inbox</span>
                    <span className="register-sale-docs-crm-empty-text">
                      {saving
                        ? '저장 중…'
                        : driveUploading
                          ? '다른 파일 업로드 중…'
                          : extractingBusinessCard || importPreviewLoading
                            ? '명함에서 정보를 읽는 중…'
                            : '등록된 명함이 없습니다. 명함 이미지·TXT를 놓으면 폼에 반영되고, 클릭하면 이미지만 준비합니다.'}
                    </span>
                  </div>
                ) : (
                  <RegisterSaleDocsCrmTable
                    rows={businessCardTableRows}
                    formatDriveFileDate={formatDriveFileDate}
                    driveUploading={driveUploading}
                    crmDriveDeletingId={crmDriveDeletingId}
                    onDeleteRow={handleDeleteCrmDriveFile}
                  />
                )}
              </div>
              {driveError && <p className="register-sale-docs-error">{driveError}</p>}
              {driveUploadNotice && !driveError && (
                <p className="register-sale-docs-success" role="status">
                  {driveUploadNotice}
                </p>
              )}
            </section>
          ) : (
            <section className="add-company-section" aria-label="명함 등록">
              <h3 className="add-company-section-title">명함 일괄</h3>
              <p className="add-company-upload-hint" style={{ marginBottom: '0.5rem' }}>
                드래그 앤 드롭(다중 가능) 또는 클릭. 캡처 화면을 클립보드에 둔 뒤 이 창을 클릭한 다음 붙여넣기(Ctrl+V)로도 가능합니다.
              </p>
              <input
                ref={cardInputRef}
                type="file"
                accept="image/*,.txt,text/plain"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const list = e.target.files;
                  if (list?.length) processBusinessCardFileSelection(list);
                  e.target.value = '';
                }}
                aria-hidden="true"
              />
              <div
                className={`add-company-upload-zone ${businessCardDropActive ? 'add-company-upload-zone-active' : ''} ${extractingBusinessCard || importPreviewLoading ? 'add-company-upload-zone-disabled' : ''}`}
                onDragOver={(ev) => { ev.preventDefault(); ev.stopPropagation(); if (!extractingBusinessCard && !importPreviewLoading) setBusinessCardDropActive(true); }}
                onDragLeave={(ev) => { ev.preventDefault(); ev.stopPropagation(); setBusinessCardDropActive(false); }}
                onDrop={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  setBusinessCardDropActive(false);
                  if (ev.dataTransfer?.files?.length) {
                    processBusinessCardFileSelection(ev.dataTransfer.files);
                  }
                }}
                onClick={() => { if (!extractingBusinessCard && !importPreviewLoading && cardInputRef.current) cardInputRef.current.click(); }}
                role="button"
                tabIndex={0}
                onKeyDown={(ev) => {
                  if ((ev.key === 'Enter' || ev.key === ' ') && !extractingBusinessCard && !importPreviewLoading && cardInputRef.current) {
                    ev.preventDefault();
                    cardInputRef.current.click();
                  }
                }}
                aria-label="명함 이미지·TXT 첨부 (드래그 앤 드롭 또는 클릭)"
              >
                <div className="add-company-upload-icon-wrap">
                  <span className="material-symbols-outlined add-company-upload-icon">upload_file</span>
                </div>
                {extractingBusinessCard || importPreviewLoading ? (
                  <p className="add-company-upload-title">{importPreviewLoading ? '일괄 분석 중…' : '명함에서 정보를 읽는 중…'}</p>
                ) : businessCardFile ? (
                  <p className="add-company-upload-title add-company-upload-filename">{businessCardFile.name}</p>
                ) : (
                  <>
                    <p className="add-company-upload-title">파일을 드래그하거나 클릭하여 업로드하세요</p>
                    <p className="add-company-upload-hint">자동 입력·미리보기 후 등록. 저장 시 Drive business card 폴더.</p>
                  </>
                )}
              </div>
            </section>
          )}
          {error && <p className="add-contact-modal-error">{error}</p>}
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-name">이름</label>
            <input
              id="add-contact-name"
              name="name"
              type="text"
              value={form.name}
              onChange={handleChange}
              placeholder="띄어쓰기 없이 예: 홍길동"
              autoComplete="name"
            />
          </div>
          <div className="add-contact-modal-field add-contact-company-field">
            <label htmlFor="add-contact-company">고객사</label>
            {fixedCompany ? (
              <div className="add-contact-company-wrap">
                <span className="add-contact-company-display" title="이 고객사에서 연락처 추가 시 고객사가 고정됩니다.">{form.company}</span>
              </div>
            ) : (
              <div className="add-contact-company-wrap">
                <input
                  id="add-contact-company"
                  name="company"
                  type="text"
                  className="add-contact-company-text-input"
                  value={form.company}
                  onChange={handleCompanyInputChange}
                  placeholder=""
                  autoComplete="organization"
                  aria-describedby="add-contact-company-hint"
                />
                <button
                  type="button"
                  className="add-contact-company-search"
                  title="고객사 검색"
                  onClick={() => setShowCompanySearchModal(true)}
                >
                  <span className="material-symbols-outlined">search</span>
                  검색
                </button>
              </div>
            )}

          </div>
          {isEditMode && form.customerCompanyId ? (
            <div className="add-contact-modal-field">
              <label htmlFor="add-contact-company-bn">사업자등록번호</label>
              <input
                id="add-contact-company-bn"
                type="text"
                readOnly
                disabled
                value={linkedCompanyBusinessNumber || '—'}
                className="add-contact-company-text-input"
                title="검색으로 고객사를 선택하면 표시됩니다."
              />
            </div>
          ) : null}
          <div className="add-contact-modal-row">
            <div className="add-contact-modal-field">
              <label htmlFor="add-contact-email">이메일</label>
              <input id="add-contact-email" name="email" type="email" value={form.email} onChange={handleChange} placeholder="example@company.com" />
            </div>
            <div className="add-contact-modal-field">
              <label htmlFor="add-contact-phone">전화번호</label>
              <input id="add-contact-phone" name="phone" type="tel" inputMode="numeric" autoComplete="tel" value={form.phone} onChange={handleChange} placeholder="010-0000-0000" maxLength={13} />
            </div>
          </div>
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-position">직책</label>
            <input id="add-contact-position" name="position" type="text" value={form.position} onChange={handleChange} placeholder="예: 과장, 팀장" />
          </div>
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-status">상태 키값</label>
            <div className="add-contact-status-row add-contact-status-row--full">
              <select
                id="add-contact-status"
                name="status"
                className="add-contact-status-select"
                value={form.status || 'Lead'}
                onChange={handleChange}
              >
                {statusOptions.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {value} — {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-lead-source">유입 경로</label>
            <input
              id="add-contact-lead-source"
              name="leadSource"
              type="text"
              value={form.leadSource}
              onChange={handleChange}
              placeholder="예: 웹, 지인 소개, 전시회"
            />
          </div>
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-address">주소</label>
            <input id="add-contact-address" name="address" type="text" value={form.address} onChange={handleChange} placeholder="주소" />
          </div>
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-birthDate">생일</label>
            <input id="add-contact-birthDate" name="birthDate" type="text" value={form.birthDate} onChange={handleChange} placeholder="예: 1990-01-15 또는 01-15" />
          </div>
          <div className="add-contact-modal-field">
            <label htmlFor="add-contact-memo">메모</label>
            <textarea id="add-contact-memo" name="memo" value={form.memo} onChange={handleChange} placeholder="메모 (Google 연락처 소개 등)" rows={2} className="add-contact-memo-input" />
          </div>
          <div className="add-contact-modal-field add-contact-assignees-wrap">
            <label htmlFor="add-contact-assignee-input">담당자</label>
            <div className="add-contact-assignee-input-wrap">
              <input
                id="add-contact-assignee-input"
                type="text"
                readOnly
                className="add-contact-assignee-input"
                placeholder="검색 아이콘으로 담당자 선택"
                value={assigneeInputValue}
                aria-label="담당자 (검색으로만 수정 가능)"
              />
              <button
                type="button"
                className="add-contact-assignee-search-icon-btn"
                onClick={() => setShowAssigneePicker(true)}
                title="담당자 검색"
                aria-label="담당자 검색"
              >
                <span className="material-symbols-outlined">search</span>
              </button>
            </div>
          </div>
            <CustomFieldsSection
              definitions={customDefinitions}
              values={form.customFields || {}}
              onChangeValues={(key, value) => setForm((prev) => ({
                ...prev,
                customFields: { ...(prev.customFields || {}), [key]: value }
              }))}
              fieldClassName="add-contact-modal-field"
            />
          </div>
          <div className="add-contact-modal-footer">
            <div className="add-contact-modal-footer-actions">
              <button type="button" className="add-contact-modal-cancel" onClick={onClose}>취소</button>
              <button type="submit" className="add-contact-modal-save" disabled={saving || extractingBusinessCard || importPreviewLoading || driveUploading}>{saving ? '저장 중...' : isEditMode ? '저장' : '연락처 저장'}</button>
            </div>
          </div>
        </form>
        {showAssigneePicker && (
          <AssigneePickerModal
            open={showAssigneePicker}
            onClose={() => setShowAssigneePicker(false)}
            selectedIds={form.assigneeUserIds || []}
            onConfirm={(ids) => setForm((prev) => ({ ...prev, assigneeUserIds: ids }))}
          />
        )}
        {showCompanySearchModal && (
          <CustomerCompanySearchModal
            onClose={() => setShowCompanySearchModal(false)}
            onSelect={(company) => {
              setForm((prev) => ({ ...prev, company: company.name || '', customerCompanyId: company._id }));
              setLinkedCompanyBusinessNumber(
                company.businessNumber != null && String(company.businessNumber).trim()
                  ? String(company.businessNumber).trim()
                  : ''
              );
              setShowCompanySearchModal(false);
            }}
          />
        )}
        <ContactImportPreviewModal
          open={showImportPreview}
          items={importPreviewItems}
          bulkSaving={importBulkSaving}
          fixedCompany={fixedCompany}
          onClose={() => !importBulkSaving && setShowImportPreview(false)}
          onConfirm={confirmBulkContactImport}
        />
        <ContactSavePregateModal
          review={preSaveReview}
          saving={saving}
          isEditMode={isEditMode}
          onClose={() => setPreSaveReview(null)}
          onConfirmForce={(flags) => {
            setPreSaveReview(null);
            void runContactSave(null, flags);
          }}
          onOpenCompanyDetail={(co) => setCompanyDetailPeek(co)}
          onLinkExistingCompany={(co) => {
            const pr = preSaveReview;
            const cCount = (pr?.contactCandidates || []).length ?? 0;
            const id = String(co._id || '').trim();
            const nm = (co.name || '').trim();
            const bnRaw = co.businessNumber != null ? String(co.businessNumber).trim() : '';
            setLinkedCompanyBusinessNumber(bnRaw);
            setForm((prev) => ({ ...prev, customerCompanyId: id, company: nm || prev.company }));
            void runContactSave(null, {
              formPatch: { customerCompanyId: id, company: nm },
              forceCreateDespiteContactDuplicate: !isEditMode && cCount > 0,
              forceCreateNewCustomerCompany: false
            });
          }}
        />
        {bulkPreReview && (bulkPreReview.preResults || []).length > 0 && (
          <div
            className="add-contact-pregate-overlay"
            onClick={() => !bulkSaving && !importBulkSaving && setBulkPreReview(null)}
            role="dialog"
            aria-modal="true"
            aria-label="대량 등록 중복"
          >
            <div className="add-contact-pregate-panel" onClick={(e) => e.stopPropagation()}>
              <h3 className="add-contact-pregate-title">
                {bulkPreReview.source === 'import' ? '대량 등록 — 연락처 중복' : '대량 등록 — 중복·유사'}
              </h3>
              <p className="add-contact-pregate-hint">
                {bulkPreReview.source === 'import' ? (
                  <>
                    일부 행이 기존 연락처(이름·전화)와 겹칩니다. 겹치는 행을 <strong>빼고</strong> 등록할지, <strong>강제로 모두</strong> 넣을지
                    선택하세요. (고객사 유사는 이 단계에서 막지 않습니다.)
                  </>
                ) : (
                  <>
                    일부 행이 기존 연락처(이름·전화)와 겹치거나, 비슷한 상호의 고객사가 있습니다. 겹치는 행을 <strong>빼고</strong> 등록할지,{' '}
                    <strong>강제로 모두</strong> 넣을지 선택하세요.
                  </>
                )}
              </p>
              <div className="add-contact-pregate-actions add-contact-pregate-actions--bulk">
                <button
                  type="button"
                  className="add-contact-modal-cancel"
                  onClick={() => setBulkPreReview(null)}
                  disabled={bulkSaving || importBulkSaving}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="add-contact-modal-save add-contact-pregate-btn-muted"
                  disabled={bulkSaving || importBulkSaving}
                  onClick={() => void resolveBulkPreReview(false)}
                >
                  {bulkPreReview.source === 'import' ? '중복 행 제외' : '중복·유사 행 제외'}
                </button>
                <button
                  type="button"
                  className="add-contact-modal-save"
                  disabled={bulkSaving || importBulkSaving}
                  onClick={() => void resolveBulkPreReview(true)}
                >
                  강제로 모두 등록
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {companyDetailPeek ? (
        <div className="add-cc-emp-company-detail-peek">
          <CustomerCompanyDetailModal
            company={companyDetailPeek}
            onClose={() => setCompanyDetailPeek(null)}
            onUpdated={(u) => {
              setCompanyDetailPeek((prev) =>
                prev && u?._id && String(u._id) === String(prev._id) ? { ...prev, ...u } : prev
              );
            }}
            onDeleted={() => setCompanyDetailPeek(null)}
          />
        </div>
      ) : null}
    </div>
  );
}
