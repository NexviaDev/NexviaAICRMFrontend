import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import CustomFieldsDisplay from '../../shared/custom-fields-display';
import CustomFieldsSection from '../../shared/custom-fields-section';
import ProductSalesModal from '../../shared/product-sales-modal/product-sales-modal';
import OpportunityModal from '../../sales-pipeline/opportunity-modal/opportunity-modal';
import AddContactModal from '../add-customer-company-employees-modal/add-customer-company-employees-modal';
import './customer-company-employees-detail-modal.css';

import { API_BASE } from '@/config';
import { getStoredCrmUser, isManagerOrAboveRole, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import { pingBackendHealth, BACKEND_KEEPALIVE_INTERVAL_MS, BACKEND_KEEPALIVE_INTERVAL_ENABLED } from '@/lib/backend-wake';
import { pollJournalFromAudioJob } from '@/lib/journal-from-audio-poll';
import { pruneDriveUploadedFilesIndex, syncDriveUploadedFilesIndex } from '@/lib/drive-uploaded-files-prune';
import { buildDriveFileDeleteUrl, isValidDriveNodeId, sanitizeDriveFolderWebViewLink } from '@/lib/google-drive-url';
import {
  RegisterSaleDocsCrmTable,
  formatDriveFileDate,
  keepLatestBusinessCardRowOnlyInDriveUploads,
  runDriveDirectFileUpload,
  sortDriveUploadedFiles
} from '@/shared/register-sale-docs-drive';
import {
  getSavedCustomerCompanyEmployeesDetailModalPresentation,
  patchCustomerCompanyEmployeesDetailModalTemplate
} from '@/lib/list-templates';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatHistoryDate(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) + ' • ' + date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function formatCalendarVisitWhen(ev) {
  if (!ev?.start) return '—';
  const s = new Date(ev.start);
  if (ev.allDay) return s.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  return s.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 업무 기록 내용을 문단·문장 단위로 나눠서 렌더용 배열로 반환 */
function splitContentIntoBlocks(text) {
  if (!text || typeof text !== 'string') return [];
  const trimmed = text.trim();
  if (!trimmed) return [];
  const paragraphs = trimmed.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  return paragraphs.map((para) => {
    const sentences = para.split(/(?<=[.!?。？！])\s+/).map((s) => s.trim()).filter(Boolean);
    return sentences.length ? sentences : [para];
  });
}

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

const statusClass = { Active: 'status-active', Pending: 'status-pending', Lead: 'status-lead', Inactive: 'status-inactive' };
const statusLabel = { Active: '활성', Pending: '대기', Lead: '리드', Inactive: '비활성' };
const statusHint = {
  Lead: '아직 접촉만 한 잠재 고객',
  Active: '현재 거래 진행 중이거나 소통 중인 고객',
  Pending: '제안서 발송 또는 회신 대기 중',
  Inactive: '거래 종료 또는 더 이상 관리하지 않는 고객'
};
const STATUS_OPTIONS = ['Lead', 'Active', 'Pending', 'Inactive'];

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

/** Drive 폴더명용: 사용 불가 문자 치환 후, 너무 길면 잘라서 반환 (기본 이름 80자, 연락처 40자) */
function sanitizeFolderNamePart(s, maxLen = 80) {
  const t = String(s ?? '')
    .replace(/[/\\*?:<>"|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function getDriveFolderIdFromLink(url) {
  if (!url || typeof url !== 'string') return null;
  const s = url.trim();
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function buildPersonalDriveFolderName(contactLike) {
  const namePart = sanitizeFolderNamePart(contactLike?.name || '이름없음', 80);
  const contactPart = sanitizeFolderNamePart(contactLike?.phone || contactLike?.email || '미등록', 40);
  return `${namePart}_${contactPart}`;
}

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

export default function ContactDetailModal({ contact, onClose, onUpdated }) {
  const [journalText, setJournalText] = useState('');
  const [journalDateTime, setJournalDateTime] = useState(() => toDatetimeLocalValue(new Date()));
  const [historyItems, setHistoryItems] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [savingNote, setSavingNote] = useState(false);
  const [audioUploading, setAudioUploading] = useState(false);
  const [audioDropActive, setAudioDropActive] = useState(false);
  const [error, setError] = useState('');
  const [summaryNotice, setSummaryNotice] = useState(null);
  const [summaryRefreshLoading, setSummaryRefreshLoading] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [companyList, setCompanyList] = useState([]);
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false);
  const [loadingCompanySearch, setLoadingCompanySearch] = useState(false);
  const companyWrapRef = useRef(null);
  const [customDefinitions, setCustomDefinitions] = useState([]);

  const [displayedContact, setDisplayedContact] = useState(contact);
  const [showCardImageModal, setShowCardImageModal] = useState(false);
  const [showContactCardEmptyPopover, setShowContactCardEmptyPopover] = useState(false);
  const contactNameCardPopoverRef = useRef(null);
  const [googleSaving, setGoogleSaving] = useState(false);
  const [googleResult, setGoogleResult] = useState(null);
  const [showGoogleConfirm, setShowGoogleConfirm] = useState(false);
  const [showProductSalesModal, setShowProductSalesModal] = useState(false);
  const [showRegisterSaleModal, setShowRegisterSaleModal] = useState(false);
  const [selectedSaleForEdit, setSelectedSaleForEdit] = useState(null);
  const [productSalesList, setProductSalesList] = useState([]);
  const [loadingProductSales, setLoadingProductSales] = useState(true);
  const [driveFolderLink, setDriveFolderLink] = useState('');
  const [driveFolderId, setDriveFolderId] = useState(null);
  const [driveUploading, setDriveUploading] = useState(false);
  const [driveError, setDriveError] = useState('');
  const [driveUploadNotice, setDriveUploadNotice] = useState('');
  const [crmListDropActive, setCrmListDropActive] = useState(false);
  const [crmDriveDeletingId, setCrmDriveDeletingId] = useState('');
  const [dragInModal, setDragInModal] = useState(false);
  const fileInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const modalContentRef = useRef(null);
  const driveRootEnsureInFlightRef = useRef(false);
  /** listTemplates.customerCompanyEmployeesDetailModal.presentation — 우측 패널(side) · 중앙(center) */
  const [detailPresentation, setDetailPresentation] = useState(() =>
    getSavedCustomerCompanyEmployeesDetailModalPresentation()
  );
  const [detailPresentationSaving, setDetailPresentationSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=contact`, { headers: getAuthHeader() });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(data.items)) setCustomDefinitions(data.items);
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, []);

  /** 음성 전사 등 장시간 요청 중 Railway 슬립 방지 — VITE_BACKEND_KEEPALIVE_INTERVAL_MS=0 이면 주기 핑 생략 */
  useEffect(() => {
    if (!audioUploading || !BACKEND_KEEPALIVE_INTERVAL_ENABLED) return;
    const id = setInterval(() => {
      pingBackendHealth(getAuthHeader);
    }, BACKEND_KEEPALIVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [audioUploading]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (companyWrapRef.current && !companyWrapRef.current.contains(e.target)) {
        setCompanyDropdownOpen(false);
      }
      if (contactNameCardPopoverRef.current && !contactNameCardPopoverRef.current.contains(e.target)) {
        setShowContactCardEmptyPopover(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showRegisterSaleModal) setShowRegisterSaleModal(false);
      else if (showProductSalesModal) setShowProductSalesModal(false);
      else if (showCardImageModal) setShowCardImageModal(false);
      else if (showContactCardEmptyPopover) setShowContactCardEmptyPopover(false);
      else if (showGoogleConfirm) setShowGoogleConfirm(false);
      else if (showDeleteConfirm) setShowDeleteConfirm(false);
      else if (editing) {
        setEditing(false);
        setEditForm({});
        setEditError('');
      } else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, editing, showDeleteConfirm, showCardImageModal, showContactCardEmptyPopover, showGoogleConfirm, showProductSalesModal, showRegisterSaleModal]);

  useEffect(() => {
    setDisplayedContact((prev) => ({ ...(prev || {}), ...(contact || {}) }));
  }, [contact]);

  const contactToShow = displayedContact || contact || {};
  const companyIdForSales = contactToShow?.customerCompanyId?._id ?? contactToShow?.customerCompanyId ?? null;
  const companyNameForSales = contactToShow?.customerCompanyId?.name ?? contactToShow?.companyName ?? '';
  /** 고객사가 DB에서 확인 가능(사업자 번호 있음)일 때만 고객사 Drive 폴더·CRM 리스트 사용 */
  const hasConfirmedCompany = Boolean(
    companyIdForSales &&
      contactToShow?.customerCompanyId?.businessNumber &&
      String(contactToShow.customerCompanyId.businessNumber).trim()
  );
  const businessCardImageUrl = contactToShow.businessCardImageUrl || '';
  const businessCardDriveUrl = contactToShow.businessCardDriveUrl || '';
  const hasBusinessCardImage = !!businessCardImageUrl;
  const hasAnyBusinessCard = hasBusinessCardImage || !!businessCardDriveUrl;

  const openBusinessCardView = useCallback(() => {
    if (businessCardImageUrl) {
      setShowContactCardEmptyPopover(false);
      setShowCardImageModal(true);
    } else if (businessCardDriveUrl) {
      setShowContactCardEmptyPopover(false);
      window.open(businessCardDriveUrl, '_blank', 'noopener,noreferrer');
    } else {
      setShowContactCardEmptyPopover((v) => !v);
    }
  }, [businessCardImageUrl, businessCardDriveUrl]);
  const status = contactToShow.status || 'Lead';
  const displayStatus = statusLabel[status] || status;
  const contactId = contact?._id;

  useEffect(() => {
    setDetailPresentation(getSavedCustomerCompanyEmployeesDetailModalPresentation());
  }, [contactId]);

  const toggleDetailPresentation = useCallback(async () => {
    const next = detailPresentation === 'center' ? 'side' : 'center';
    setDetailPresentationSaving(true);
    try {
      await patchCustomerCompanyEmployeesDetailModalTemplate({ presentation: next });
      setDetailPresentation(next);
    } catch (err) {
      window.alert(err?.message || '표시 방식 저장에 실패했습니다.');
    } finally {
      setDetailPresentationSaving(false);
    }
  }, [detailPresentation]);

  const fetchContactDetail = useCallback(async () => {
    if (!contactId) return null;
    try {
      const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?._id) return null;
      setDisplayedContact((prev) => ({ ...(prev || {}), ...data }));
      try {
        const syncRes = await fetch(`${API_BASE}/customer-company-employees/${contactId}/sync-drive-folder`, {
          method: 'POST',
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const syncData = await syncRes.json().catch(() => ({}));
        if (syncRes.ok && syncData._id) {
          setDisplayedContact((prev) => ({ ...(prev || {}), ...syncData }));
          return syncData;
        }
      } catch (_) {}
      return data;
    } catch (_) {
      return null;
    }
  }, [contactId]);

  const fetchHistory = async () => {
    if (!contactId) return;
    setLoadingHistory(true);
    try {
      const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}/history`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setHistoryItems(data.items || []);
      else setHistoryItems([]);
    } catch (_) {
      setHistoryItems([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [contactId]);

  useEffect(() => {
    fetchContactDetail();
  }, [fetchContactDetail]);

  /** Drive 폴더 직속 파일 ↔ Mongo driveUploadedFiles 동기화: Drive에만 있는 건 추가 후, Drive에 없는 CRM 행만 제거 */
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
      if (!cancelled) fetchContactDetail();
    })();
    return () => {
      cancelled = true;
    };
  }, [contactId, contactToShow?.driveRootFolderId, fetchContactDetail]);

  useEffect(() => {
    if (!contactId) return undefined;
    if (!['queued', 'processing'].includes(contactToShow?.summaryStatus)) return undefined;
    const timer = window.setInterval(() => {
      fetchContactDetail();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [contactId, contactToShow?.summaryStatus, fetchContactDetail]);

  useEffect(() => {
    setJournalDateTime(toDatetimeLocalValue(new Date()));
    setSummaryNotice(null);
  }, [contactId]);

  const fetchProductSales = async () => {
    if (!contactId) {
      setProductSalesList([]);
      setLoadingProductSales(false);
      return;
    }
    setLoadingProductSales(true);
    try {
      const params = new URLSearchParams();
      params.set('customerCompanyEmployeeId', contactId);
      const res = await fetch(`${API_BASE}/sales-opportunities?${params}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.grouped) {
        const flat = (Object.values(data.grouped) || []).flat();
        setProductSalesList(flat);
      } else {
        setProductSalesList([]);
      }
    } catch (_) {
      setProductSalesList([]);
    } finally {
      setLoadingProductSales(false);
    }
  };

  useEffect(() => {
    fetchProductSales();
  }, [contactId]);

  const driveFolderName = useMemo(() => buildPersonalDriveFolderName(contactToShow), [contactToShow]);

  const crmDriveUploadsSorted = useMemo(() => {
    const raw = contactToShow?.driveUploadedFiles;
    const sorted = sortDriveUploadedFiles(raw);
    return keepLatestBusinessCardRowOnlyInDriveUploads(sorted, contactToShow);
  }, [contactToShow?.driveUploadedFiles, contactToShow?.name, contactToShow?.phone, contactToShow?.email]);

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
    if (!contactId || !driveFolderName) return;
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
  }, [contactId, driveFolderName, ensureDriveRootFolder]);

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

  const handleSaveNote = async () => {
    const content = journalText.trim();
    if (!content) return;
    setError('');
    setSummaryNotice(null);
    setSavingNote(true);
    try {
      const createdAt = journalDateTime ? new Date(journalDateTime).toISOString() : undefined;
      const requestBody = JSON.stringify({ content, ...(createdAt && !Number.isNaN(new Date(journalDateTime).getTime()) ? { createdAt } : {}) });
      const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        ...(requestBody.length <= 60 * 1024 ? { keepalive: true } : {}),
        body: requestBody
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setJournalText('');
        setJournalDateTime(toDatetimeLocalValue(new Date()));
        fetchHistory();
        fetchContactDetail();
      } else {
        setError(data.error || '저장에 실패했습니다.');
      }
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setSavingNote(false);
    }
  };

  const uploadAudioForJournal = useCallback(async (filesLike) => {
    const files = Array.from(filesLike || []).filter((f) => f && f instanceof File);
    if (!files.length || !contactId || savingNote || audioUploading) return;
    const accept = /\.(mp3|wav|m4a|webm)$/i;
    const audioTypes = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm'];
    const file = files.find((f) => accept.test(f.name) || audioTypes.includes(f.type));
    if (!file) {
      setError('MP3, WAV, M4A, WebM 파일만 업로드할 수 있습니다.');
      return;
    }
    setError('');
    setSummaryNotice({
      type: 'info',
      text:
        '음성 파일을 올렸습니다. 전사·요약은 서버에서 진행하며, 진행 중에도 연결이 끊기지 않도록 짧게 상태를 확인합니다.'
    });
    await pingBackendHealth(getAuthHeader);
    setAudioUploading(true);
    try {
      const form = new FormData();
      form.append('audio', file);
      const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}/history/from-audio`, {
        method: 'POST',
        headers: getAuthHeader(),
        credentials: 'include',
        body: form
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '음성 업로드 처리에 실패했습니다.');
      if (res.status === 202 && data.jobId) {
        setSummaryNotice({
          type: 'info',
          text: 'AssemblyAI 전사 및 Gemini 요약 진행 중입니다. 잠시만 기다려 주세요…'
        });
        const pollUrl = `${API_BASE}/customer-company-employees/${contactId}/history/from-audio/jobs/${encodeURIComponent(data.jobId)}`;
        const result = await pollJournalFromAudioJob(pollUrl, getAuthHeader);
        setJournalText(result.content || '');
        setJournalDateTime(toDatetimeLocalValue(new Date()));
        setSummaryNotice({
          type: 'info',
          text: '요약이 입력창에 채워졌습니다. 내용 확인 후 "메모 저장"을 눌러 등록해 주세요. 개인정보 보호를 위해 AssemblyAI 전사 데이터는 삭제 요청되었습니다.'
        });
      } else {
        throw new Error(data.error || '서버 응답 형식을 알 수 없습니다.');
      }
    } catch (e) {
      setError(e.message || '음성 업로드 처리에 실패했습니다.');
    } finally {
      setAudioUploading(false);
    }
  }, [audioUploading, contactId, savingNote]);

  const handleDeleteHistory = async (historyId) => {
    if (!historyId) return;
    if (!isAdminOrAboveRole(getStoredCrmUser()?.role)) {
      window.alert('업무 기록 삭제는 대표(Owner) 또는 관리자(Admin)만 가능합니다.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}/history/${historyId}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      if (res.ok) {
        fetchHistory();
        fetchContactDetail();
      }
    } catch (_) {}
  };

  const summaryStatusText = {
    idle: '요약 대기',
    queued: 'Gemini 요약 대기 중...',
    processing: 'Gemini 요약 생성 중...',
    completed: '최신 요약',
    error: '요약 실패'
  };

  const requestWorkSummaryGemini = useCallback(async () => {
    if (!contactId || summaryRefreshLoading) return;
    if (!historyItems.length) {
      setSummaryNotice({ type: 'muted', text: '요약할 업무 기록을 먼저 등록해 주세요.' });
      return;
    }
    setSummaryNotice(null);
    setSummaryRefreshLoading(true);
    try {
      await pingBackendHealth(getAuthHeader);
      const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}/work-summary/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSummaryNotice({ type: 'muted', text: data.error || '요약 요청에 실패했습니다.' });
        return;
      }
      if (data.alreadyPending) {
        setSummaryNotice({
          type: 'info',
          text: '이미 요약이 진행 중입니다. 잠시 후 다시 확인해 주세요.'
        });
        await fetchContactDetail();
        return;
      }
      setDisplayedContact((prev) => ({
        ...(prev || {}),
        summaryStatus: 'queued',
        summaryError: '',
        summaryQueuedForHistoryAt: data.summaryQueuedForHistoryAt || new Date().toISOString()
      }));
      setSummaryNotice({
        type: 'info',
        text: '최신 업무 기록을 기준으로 Gemini 요약을 요청했습니다. 모달을 닫아도 서버에서 계속 처리됩니다.'
      });
      await fetchContactDetail();
    } catch (_) {
      setSummaryNotice({ type: 'muted', text: '서버에 연결할 수 없습니다.' });
    } finally {
      setSummaryRefreshLoading(false);
    }
  }, [contactId, fetchContactDetail, historyItems.length, summaryRefreshLoading]);

  const handleAddToGoogleContacts = async () => {
    setShowGoogleConfirm(false);
    const c = displayedContact || contact;
    const companyName = c.customerCompanyId?.name ?? c.companyName ?? '';
    const payload = {
      name: (c.name || '').trim() || undefined,
      email: (c.email || '').trim() || undefined,
      phone: (c.phone || '').trim() || undefined,
      company: companyName.trim() || undefined
    };
    if (!payload.name && !payload.email && !payload.phone) {
      setGoogleResult({ error: '이름, 이메일, 연락처 중 하나 이상 필요합니다.' });
      return;
    }
    setGoogleResult(null);
    setGoogleSaving(true);
    try {
      const res = await fetch(`${API_BASE}/google-contacts/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ contacts: [payload] })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGoogleResult({ error: data.error || '구글 주소록 등록에 실패했습니다.', needsReauth: data.needsReauth });
        return;
      }
      setGoogleResult({ success: data.success, fail: data.fail, total: data.total });
      if (data.success > 0) setTimeout(() => setGoogleResult(null), 3000);
    } catch (_) {
      setGoogleResult({ error: '서버에 연결할 수 없습니다.' });
    } finally {
      setGoogleSaving(false);
    }
  };

  const startEdit = () => {
    if (!isManagerOrAboveRole(getStoredCrmUser()?.role)) {
      window.alert('수정은 실무자(Manager) 이상만 가능합니다.');
      return;
    }
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditError('');
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    if (name === 'phone') setEditForm((prev) => ({ ...prev, phone: formatPhoneInput(value) }));
    else setEditForm((prev) => ({ ...prev, [name]: value }));
    if (name === 'company') setEditForm((prev) => ({ ...prev, customerCompanyId: '' }));
    setEditError('');
  };

  const handleCompanySearch = async () => {
    setLoadingCompanySearch(true);
    setCompanyDropdownOpen(false);
    try {
      const res = await fetch(`${API_BASE}/customer-companies`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setCompanyList([]); return; }
      const items = data.items || [];
      const searchTrim = (editForm.company || '').trim().toLowerCase();
      const filtered = searchTrim
        ? items.filter((c) => (c.name || '').toLowerCase().includes(searchTrim))
        : items;
      setCompanyList(filtered);
      setCompanyDropdownOpen(true);
    } catch (_) {
      setCompanyList([]);
    } finally {
      setLoadingCompanySearch(false);
    }
  };

  const handleCompanySelect = (cc) => {
    setEditForm((prev) => ({ ...prev, company: cc.name || '', customerCompanyId: cc._id }));
    setCompanyDropdownOpen(false);
  };

  const handleIndividualChange = (e) => {
    const checked = e.target.checked;
    setEditForm((prev) => ({
      ...prev,
      isIndividual: checked,
      ...(checked ? { company: '', customerCompanyId: '' } : {})
    }));
    setCompanyDropdownOpen(false);
  };

  const handleEditSubmit = async () => {
    if (!isManagerOrAboveRole(getStoredCrmUser()?.role)) {
      setEditError('수정은 실무자(Manager) 이상만 가능합니다.');
      return;
    }
    setEditError('');
    const hasName = !!(editForm.name && editForm.name.trim());
    const hasEmail = !!(editForm.email && editForm.email.trim());
    const hasPhone = !!(editForm.phone && editForm.phone.trim());
    const hasCompany = !editForm.isIndividual && !!editForm.customerCompanyId;
    if (!hasCompany && !hasName && !hasEmail && !hasPhone) {
      setEditError('이름, 고객사, 이메일, 전화번호 중 최소한 하나는 기입이 되어야 합니다.');
      return;
    }
    if (!editForm.isIndividual && !editForm.customerCompanyId && (editForm.company || '').trim()) {
      setEditError('고객사를 검색에서 선택해 주세요.');
      return;
    }
    setEditSaving(true);
    try {
      const payload = {
        name: editForm.name.trim(),
        email: editForm.email.trim(),
        phone: editForm.phone.trim(),
        position: (editForm.position || '').trim() || undefined,
        address: (editForm.address || '').trim() || undefined,
        birthDate: (editForm.birthDate || '').trim() || undefined,
        memo: (editForm.memo || '').trim() || undefined,
        status: editForm.status
      };
      if (editForm.isIndividual) {
        payload.isIndividual = true;
        payload.customerCompanyId = null;
      } else if (editForm.customerCompanyId) {
        payload.customerCompanyId = editForm.customerCompanyId;
        payload.isIndividual = false;
      }
      if (editForm.companyName !== undefined) payload.companyName = (editForm.companyName || '').trim() || undefined;
      if (editForm.customFields && Object.keys(editForm.customFields).length) {
        payload.customFields = editForm.customFields;
      }
      const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEditError(data.error || '수정에 실패했습니다.');
        return;
      }
      setEditing(false);
      onUpdated?.();
    } catch (_) {
      setEditError('서버에 연결할 수 없습니다.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isAdminOrAboveRole(getStoredCrmUser()?.role)) {
      window.alert('삭제는 대표(Owner) 또는 관리자(Admin)만 가능합니다.');
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      if (res.ok) {
        onUpdated?.();
        onClose?.();
      } else {
        const data = await res.json().catch(() => ({}));
        setEditError(data.error || '삭제에 실패했습니다.');
        setShowDeleteConfirm(false);
      }
    } catch (_) {
      setEditError('서버에 연결할 수 없습니다.');
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  const canMutate = isManagerOrAboveRole(getStoredCrmUser()?.role);
  const canDeleteContact = isAdminOrAboveRole(getStoredCrmUser()?.role);

  if (!contact) return null;

  return (
    <div className={`contact-detail-root contact-detail-root--${detailPresentation}`}>
      {editing && canMutate && (
        <AddContactModal
          contact={contact}
          onClose={() => setEditing(false)}
          onUpdated={(updated) => {
            onUpdated?.(updated);
            setEditing(false);
          }}
        />
      )}
      <div className="contact-detail-overlay" aria-hidden="true" />
      <div
        ref={modalContentRef}
        className="contact-detail-panel"
        onDragEnter={(e) => { e.preventDefault(); setDragInModal(true); }}
        onDragLeave={(e) => { if (!modalContentRef.current?.contains(e.relatedTarget)) setDragInModal(false); }}
      >
        <div className={`contact-detail-inner${detailPresentation === 'center' ? ' contact-detail-inner--center' : ''}`}>
          <header className="contact-detail-header">
            <div className="contact-detail-header-title">
              <span className="material-symbols-outlined">account_circle</span>
              <h2>연락처 세부정보</h2>
            </div>
            <div className="contact-detail-header-actions">
              {!editing && (
                <>
                  <button
                    type="button"
                    className={`contact-detail-icon-btn contact-detail-layout-toggle${detailPresentation === 'center' ? ' is-layout-center' : ''}`}
                    onClick={toggleDetailPresentation}
                    disabled={detailPresentationSaving}
                    title={
                      detailPresentation === 'side'
                        ? '가운데 모달로 전환 (내 설정에 저장)'
                        : '우측 패널로 전환 (내 설정에 저장)'
                    }
                    aria-label={
                      detailPresentation === 'side'
                        ? '연락처 상세를 화면 가운데 모달로 표시'
                        : '연락처 상세를 우측에서 슬라이드 패널로 표시'
                    }
                    aria-pressed={detailPresentation === 'center'}
                  >
                    <span
                      className={`material-symbols-outlined${detailPresentationSaving ? ' contact-detail-layout-toggle-spin' : ''}`}
                      aria-hidden
                    >
                      {detailPresentationSaving
                        ? 'progress_activity'
                        : detailPresentation === 'side'
                          ? 'filter_center_focus'
                          : 'dock_to_right'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="contact-detail-icon-btn contact-detail-google-btn"
                    onClick={() => setShowGoogleConfirm(true)}
                    disabled={googleSaving}
                    title="구글 주소록에 등록"
                    aria-label="구글 주소록에 등록"
                  >
                    <img src="https://www.gstatic.com/images/branding/product/1x/contacts_2022_48dp.png" alt="" className="contact-detail-google-icon" />
                  </button>
                  {canMutate ? (
                    <button type="button" className="contact-detail-icon-btn" onClick={startEdit} title="수정 (Manager 이상)">
                      <span className="material-symbols-outlined">edit</span>
                    </button>
                  ) : null}
                  {canDeleteContact ? (
                    <button type="button" className="contact-detail-icon-btn contact-detail-delete-btn" onClick={() => setShowDeleteConfirm(true)} title="삭제 (Admin 이상)">
                      <span className="material-symbols-outlined">delete</span>
                    </button>
                  ) : null}
                </>
              )}
              <button type="button" className="contact-detail-icon-btn" onClick={editing ? cancelEdit : onClose} aria-label={editing ? '수정 취소' : '닫기'}>
                <span className="material-symbols-outlined">{editing ? 'undo' : 'close'}</span>
              </button>
            </div>
          </header>

          {googleResult && (
            <div className={`contact-detail-google-result ${googleResult.error ? 'error' : 'ok'}`}>
              <span className="material-symbols-outlined">{googleResult.error ? 'error' : 'check_circle'}</span>
              <span>
                {googleResult.error
                  ? <>{googleResult.error}{googleResult.needsReauth && ' (Google 계정으로 재로그인 필요)'}</>
                  : `구글 주소록에 등록되었습니다.`}
              </span>
              <button type="button" className="contact-detail-google-result-dismiss" onClick={() => setGoogleResult(null)} aria-label="닫기">×</button>
            </div>
          )}

          {showGoogleConfirm && (
            <div className="contact-detail-google-confirm">
              <span className="material-symbols-outlined">help</span>
              <p>이 연락처를 구글 주소록에 등록하시겠습니까?</p>
              <div className="contact-detail-google-confirm-btns">
                <button
                  type="button"
                  className="contact-detail-confirm-cancel"
                  onClick={() => setShowGoogleConfirm(false)}
                  disabled={googleSaving}
                >
                  아니오
                </button>
                <button
                  type="button"
                  className="contact-detail-confirm-submit"
                  onClick={handleAddToGoogleContacts}
                  disabled={googleSaving}
                >
                  {googleSaving ? '등록 중...' : '예'}
                </button>
              </div>
            </div>
          )}

          {/* 삭제 확인 */}
          {showDeleteConfirm && canDeleteContact && (
            <div className="contact-detail-delete-confirm">
              <span className="material-symbols-outlined">warning</span>
              <p>이 연락처를 삭제하시겠습니까?<br />삭제하면 업무 기록도 함께 삭제됩니다.</p>
              <div className="contact-detail-delete-confirm-btns">
                <button type="button" className="contact-detail-confirm-cancel" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>취소</button>
                <button type="button" className="contact-detail-confirm-delete" onClick={handleDelete} disabled={deleting}>
                  {deleting ? '삭제 중...' : '삭제'}
                </button>
              </div>
            </div>
          )}

          <div className={`contact-detail-body${detailPresentation === 'center' ? ' contact-detail-body--center' : ''}`}>
            {editing ? null : (
              /* ── 조회 모드: 고객사 상세와 동일한 한 장 카드 + 메타 리스트 구조 ── */
              <>
                <section className="contact-detail-main-card customer-company-detail-card">
                  <div className="customer-company-detail-info">
                    <div className="customer-company-detail-name-row">
                      <div className="customer-company-detail-name-wrap" ref={contactNameCardPopoverRef}>
                        <button
                          type="button"
                          className="customer-company-detail-name-link contact-detail-name-card-link"
                          onClick={openBusinessCardView}
                          aria-expanded={showContactCardEmptyPopover}
                          aria-haspopup="dialog"
                          aria-label="이름 클릭 시 명함 보기"
                        >
                          <h1 className="customer-company-detail-name contact-detail-name-in-card">{contactToShow.name || '—'}</h1>
                          <span className="material-symbols-outlined customer-company-detail-name-link-icon">
                            {hasAnyBusinessCard ? 'badge' : 'contact_page'}
                          </span>
                        </button>
                        {showContactCardEmptyPopover && (
                          <div
                            className="customer-company-detail-registered-name-popover customer-company-detail-certificate-popover contact-detail-card-empty-popover"
                            role="dialog"
                            aria-label="명함 안내"
                          >
                            <div className="customer-company-detail-registered-name-popover-title">명함</div>
                            <p className="customer-company-detail-certificate-empty">등록된 명함이 없습니다.</p>
                            <p className="contact-detail-card-empty-hint">연락처 수정 등 다른 화면에서 명함을 등록할 수 있습니다.</p>
                            <button
                              type="button"
                              className="customer-company-detail-registered-name-popover-close"
                              onClick={() => setShowContactCardEmptyPopover(false)}
                              aria-label="닫기"
                            >
                              <span className="material-symbols-outlined">close</span>
                            </button>
                          </div>
                        )}
                      </div>
                      <span className={`contact-detail-status-badge ${statusClass[status] || ''}`}>{displayStatus}</span>
                    </div>
                    <div className="customer-company-detail-meta">
                      {(contact.company || contact.companyName) && (
                        <div className="customer-company-detail-meta-item">
                          <span className="material-symbols-outlined">business</span>
                          <span>{contact.company || contact.companyName}</span>
                        </div>
                      )}
                      {contact.email && (
                        <div className="customer-company-detail-meta-item">
                          <span className="material-symbols-outlined">mail</span>
                          <span>{contact.email}</span>
                        </div>
                      )}
                      {contact.phone && (
                        <div className="customer-company-detail-meta-item">
                          <span className="material-symbols-outlined">call</span>
                          <span>{contact.phone}</span>
                        </div>
                      )}
                      {contact.position && (
                        <div className="customer-company-detail-meta-item">
                          <span className="material-symbols-outlined">badge</span>
                          <span>{contact.position}</span>
                        </div>
                      )}
                      {contact.leadSource && (
                        <div className="customer-company-detail-meta-item">
                          <span className="material-symbols-outlined">travel_explore</span>
                          <span>{contact.leadSource}</span>
                        </div>
                      )}
                      {contact.address && (
                        <div className="customer-company-detail-meta-item full">
                          <span className="material-symbols-outlined">location_on</span>
                          <span>{contact.address}</span>
                        </div>
                      )}
                      {contact.birthDate && (
                        <div className="customer-company-detail-meta-item">
                          <span className="material-symbols-outlined">cake</span>
                          <span>{contact.birthDate}</span>
                        </div>
                      )}
                      {contact.memo && (
                        <div className="customer-company-detail-meta-item full contact-detail-meta-memo">
                          <span className="material-symbols-outlined">note</span>
                          <span className="contact-detail-memo-value">{contact.memo}</span>
                        </div>
                      )}
                      {!contact.company && !contact.companyName && !contact.email && !contact.phone && !contact.position && !contact.leadSource && !contact.address && !contact.birthDate && !contact.memo && (
                        <div className="customer-company-detail-meta-item">
                          <span className="material-symbols-outlined">info</span>
                          <span>등록된 연락처 정보가 없습니다.</span>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <CustomFieldsDisplay
                  definitions={customDefinitions}
                  values={contact.customFields || {}}
                  className="contact-detail-custom-fields"
                />

                {/* 제품 판매 현황 - customer-company-detail-modal (368-403)과 동일 구조·디자인·로직 */}
                <section className="customer-company-detail-section contact-detail-sales-section">
                  <div className="customer-company-detail-section-head">
                    <div className="customer-company-detail-section-title-with-sales">
                      <h3 className="customer-company-detail-section-title">
                        <span className="material-symbols-outlined">inventory_2</span>
                        제품 판매 현황
                      </h3>
                      <button
                        type="button"
                        className="customer-company-detail-btn-sales-add"
                        onClick={() => setShowRegisterSaleModal(true)}
                      >
                        <span className="material-symbols-outlined">add</span>세일즈 추가
                      </button>
                    </div>
                    {!loadingProductSales && (
                      <button
                        type="button"
                        className="customer-company-detail-btn-all"
                        onClick={() => setShowProductSalesModal(true)}
                      >
                        전체 보기
                        <span className="material-symbols-outlined">arrow_forward</span>
                      </button>
                    )}
                  </div>
                  {loadingProductSales ? (
                    <p className="customer-company-detail-employees-empty">불러오는 중...</p>
                  ) : productSalesList.length === 0 ? (
                    <p className="customer-company-detail-employees-empty">제품판매 이력이 없습니다. </p>
                  ) : (
                    <div className="customer-company-detail-product-sales-preview">
                      <ul className="customer-company-detail-product-sales-preview-list">
                        {productSalesList.slice(0, 3).map((row) => (
                          <li key={row._id} className="customer-company-detail-product-sales-preview-item">
                            <span className="customer-company-detail-product-sales-preview-title">{row.title || '—'}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>

                {/* 증서 · 자료 — 개인 폴더 [이름]_[연락처], 고객사 소속 시 고객사 루트 아래 */}
                <section className="customer-company-detail-section register-sale-docs contact-detail-drive-section">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => { handleDirectFileUpload(e.target.files); e.target.value = ''; }}
                    disabled={driveUploading}
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
                      onClick={() => { if (!driveUploading && fileInputRef.current) fileInputRef.current.click(); }}
                      disabled={driveUploading}
                      title="파일 추가"
                      aria-label="파일 추가"
                    >
                      <span className="material-symbols-outlined">add</span>
                    </button>
                  </div>
                  <div
                    className={`register-sale-docs-crm-uploads ${crmListDropActive ? 'register-sale-docs-crm-uploads--drop-active' : ''} ${driveUploading ? 'register-sale-docs-crm-uploads--disabled' : ''}`}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!driveUploading) setCrmListDropActive(true);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!driveUploading) setCrmListDropActive(true);
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
                      if (!driveUploading && e.dataTransfer?.files?.length) handleDirectFileUpload(e.dataTransfer.files);
                    }}
                  >
                    <h4 className="register-sale-docs-crm-uploads-title">
                      <span className="material-symbols-outlined">history_edu</span>
                      리스트
                    </h4>
                    <p className="register-sale-docs-crm-uploads-hint">
                      업로드가 완료되면 제목·수정일·링크가 MongoDB에 저장되어 여기에 표시됩니다. 파일을 끌어 놓거나 위쪽 「증서 · 자료」의 추가 버튼으로 올릴 수 있습니다.
                    </p>
                    {crmDriveUploadsSorted.length === 0 ? (
                      <div
                        className={`register-sale-docs-crm-empty ${crmListDropActive ? 'register-sale-docs-crm-empty--active' : ''}`}
                        onClick={() => {
                          if (!driveUploading && fileInputRef.current) fileInputRef.current.click();
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if ((e.key === 'Enter' || e.key === ' ') && !driveUploading && fileInputRef.current) {
                            e.preventDefault();
                            fileInputRef.current.click();
                          }
                        }}
                      >
                        <span className="material-symbols-outlined register-sale-docs-crm-empty-icon">inbox</span>
                        <span className="register-sale-docs-crm-empty-text">
                          {driveUploading ? '업로드 중…' : '등록된 항목이 없습니다. 파일을 여기에 놓거나 위쪽 추가 버튼으로 올리세요.'}
                        </span>
                      </div>
                    ) : (
                      <RegisterSaleDocsCrmTable
                        rows={crmDriveUploadsSorted}
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

                <section className="contact-detail-section contact-detail-section--journal-column">
                  <div className="contact-detail-section-head">
                    <h3>업무 기록</h3>
                    <span className="contact-detail-section-badge">{historyItems.length}건</span>
                  </div>
                  <div className={`contact-detail-summary-card ${contactToShow?.summaryStatus === 'error' ? 'is-error' : ''}`}>
                    <div className="contact-detail-summary-head">
                      <div className="contact-detail-summary-title-row">
                        <div className="contact-detail-summary-title-with-refresh">
                          <strong>업무 요약</strong>
                          <button
                            type="button"
                            className={`contact-detail-summary-refresh-btn${summaryRefreshLoading ? ' is-loading' : ''}`}
                            onClick={requestWorkSummaryGemini}
                            disabled={
                              summaryRefreshLoading
                              || !historyItems.length
                              || contactToShow?.summaryStatus === 'queued'
                              || contactToShow?.summaryStatus === 'processing'
                            }
                            aria-busy={summaryRefreshLoading}
                            aria-label={summaryRefreshLoading ? '요약 최신화 요청 중' : '업무 요약 최신화 (Gemini)'}
                            title={summaryRefreshLoading ? '요청 중…' : '업무 요약 최신화 (Gemini)'}
                          >
                            <span
                              className={`material-symbols-outlined contact-detail-summary-refresh-btn-icon${
                                summaryRefreshLoading ? ' contact-detail-summary-refresh-btn-icon--spin' : ''
                              }`}
                              aria-hidden
                            >
                              {summaryRefreshLoading ? 'progress_activity' : 'sync'}
                            </span>
                          </button>
                        </div>
                        <span className={`contact-detail-summary-status is-${contactToShow?.summaryStatus || 'idle'}`}>
                          {summaryStatusText[contactToShow?.summaryStatus || 'idle'] || '요약 대기'}
                        </span>
                      </div>
                    </div>
                    <p className="contact-detail-summary-text">
                      {contactToShow?.summary?.trim()
                        ? contactToShow.summary
                        : (contactToShow?.summaryStatus === 'queued' || contactToShow?.summaryStatus === 'processing'
                          ? '최신 업무 기록을 기준으로 Gemini가 요약을 만드는 중입니다. 모달을 닫아도 나중에 다시 확인할 수 있습니다.'
                          : '아직 저장된 업무 요약이 없습니다. 업무 기록을 쌓은 뒤 위 최신화 아이콘으로 필요할 때만 요약을 요청해 주세요.')}
                    </p>
                    {contactToShow?.summaryUpdatedAt && (
                      <p className="contact-detail-summary-meta">
                        마지막 요약: {formatHistoryDate(contactToShow.summaryUpdatedAt)}
                      </p>
                    )}
                    {contactToShow?.summaryError && (
                      <p className="contact-detail-summary-error">{contactToShow.summaryError}</p>
                    )}
                    {summaryNotice?.text && (
                      <p className={`contact-detail-summary-notice is-${summaryNotice.type || 'info'}`}>
                        {summaryNotice.text}
                      </p>
                    )}
                    {Array.isArray(contactToShow.relatedCalendarVisits) && contactToShow.relatedCalendarVisits.length > 0 ? (
                      <div className="customer-company-detail-summary-calendar" aria-label="연결된 캘린더 방문">
                        <div className="customer-company-detail-summary-calendar-title">
                          <span className="material-symbols-outlined" aria-hidden>calendar_month</span>
                          예정된 방문 (캘린더)
                        </div>
                        <ul className="customer-company-detail-summary-calendar-list">
                          {contactToShow.relatedCalendarVisits.map((v) => (
                            <li key={String(v._id)}>
                              <span className="customer-company-detail-summary-calendar-when">{formatCalendarVisitWhen(v)}</span>
                              <span className="customer-company-detail-summary-calendar-event">{v.title || '일정'}</span>
                              {v.assigneeLine ? (
                                <span className="customer-company-detail-summary-calendar-who"> · {v.assigneeLine}</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                  <div className="contact-detail-journal-input-wrap">
                    {error && <p className="contact-detail-journal-error">{error}</p>}
                    <div className="contact-detail-journal-datetime-row">
                      <label htmlFor="contact-detail-journal-datetime" className="contact-detail-journal-datetime-label">등록일시</label>
                      <input
                        id="contact-detail-journal-datetime"
                        type="datetime-local"
                        className="contact-detail-journal-datetime"
                        value={journalDateTime}
                        onChange={(e) => setJournalDateTime(e.target.value)}
                        aria-label="업무 기록 등록일시"
                      />
                    </div>
                    <textarea
                      className="contact-detail-journal-input"
                      placeholder="새 메모 또는 기록을 입력하세요..."
                      rows={3}
                      value={journalText}
                      onChange={(e) => setJournalText(e.target.value)}
                    />
                    <input
                      ref={audioInputRef}
                      type="file"
                      accept="audio/*,.mp3,.wav,.m4a,.webm"
                      className="contact-detail-audio-input-hidden"
                      onChange={(e) => {
                        if (e.target.files?.length) uploadAudioForJournal(e.target.files);
                        e.target.value = '';
                      }}
                      aria-hidden="true"
                    />
                    <div
                      className={`contact-detail-journal-audio-drop ${audioDropActive ? 'is-dragover' : ''} ${audioUploading ? 'is-uploading' : ''}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!audioUploading && !savingNote) setAudioDropActive(true);
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
                        if (!audioUploading && !savingNote && e.dataTransfer?.files?.length) {
                          uploadAudioForJournal(e.dataTransfer.files);
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
                        className="contact-detail-journal-audio-btn"
                        onClick={() => audioInputRef.current?.click()}
                        disabled={audioUploading || savingNote}
                      >
                        파일 선택
                      </button>
                    </div>
                    <div className="contact-detail-journal-actions">
                      <button
                        type="button"
                        className="contact-detail-save-note-btn"
                        disabled={savingNote || audioUploading || !journalText.trim()}
                        onClick={handleSaveNote}
                      >
                        {savingNote ? '저장 중...' : '메모 저장'}
                      </button>
                    </div>
                  </div>
                  <div className="contact-detail-timeline">
                    {loadingHistory ? (
                      <p className="contact-detail-timeline-empty">불러오는 중...</p>
                    ) : historyItems.length === 0 ? (
                      <p className="contact-detail-timeline-empty">등록된 업무 기록이 없습니다.</p>
                    ) : (
                      historyItems.map((entry) => (
                        <div key={entry._id} className="contact-detail-timeline-item">
                          <div className="contact-detail-timeline-icon">
                            <span className="material-symbols-outlined">history_edu</span>
                          </div>
                          <div className="contact-detail-timeline-content">
                            <div className="contact-detail-timeline-meta">
                              <span className="contact-detail-timeline-user">
                                {(entry.createdByCurrentName !== undefined ? entry.createdByCurrentName : entry.createdByName) || '—'}
                                {(entry.createdByCurrentContact !== undefined ? entry.createdByCurrentContact : entry.createdByContact) && ` · ${entry.createdByCurrentContact !== undefined ? entry.createdByCurrentContact : entry.createdByContact}`}
                                {entry.createdByChanged && <span className="contact-detail-timeline-changed"> 변경됨</span>}
                              </span>
                              <time>{formatHistoryDate(entry.createdAt)}</time>
                              {canMutate ? (
                                <button
                                  type="button"
                                  className="contact-detail-timeline-delete"
                                  onClick={() => handleDeleteHistory(entry._id)}
                                  aria-label="삭제"
                                  title="업무 기록 삭제 (Owner / Admin)"
                                >
                                  <span className="material-symbols-outlined">delete</span>
                                </button>
                              ) : null}
                            </div>
                            <div className="contact-detail-timeline-text-wrap">
                              {splitContentIntoBlocks(entry.content).map((paragraphSentences, pIdx) => (
                                <p key={pIdx} className="contact-detail-timeline-paragraph">
                                  {paragraphSentences.map((sentence, sIdx) => (
                                    <span key={sIdx} className="contact-detail-timeline-sentence">{sentence}{sIdx < paragraphSentences.length - 1 ? ' ' : ''}</span>
                                  ))}
                                </p>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>

      {showProductSalesModal && (
        <ProductSalesModal
          companyName={companyNameForSales}
          companyId={companyIdForSales}
          items={productSalesList}
          driveFolderLink={driveFolderLink || undefined}
          onClose={() => setShowProductSalesModal(false)}
          onAddSale={() => { setShowProductSalesModal(false); setShowRegisterSaleModal(true); }}
          onSelectItem={(row) => { setShowProductSalesModal(false); setSelectedSaleForEdit(row); }}
        />
      )}
      {selectedSaleForEdit && (
        <OpportunityModal
          mode="edit"
          oppId={selectedSaleForEdit._id}
          initialContact={{
            _id: contactId,
            name: contactToShow?.name,
            ...(hasConfirmedCompany
              ? {
                  customerCompanyId: companyIdForSales,
                  customerCompanyName: companyNameForSales,
                  customerCompanyBusinessNumber: contactToShow?.customerCompanyId?.businessNumber
                }
              : {})
          }}
          onClose={() => setSelectedSaleForEdit(null)}
          onSaved={() => { setSelectedSaleForEdit(null); fetchProductSales(); }}
        />
      )}
      {showRegisterSaleModal && (
        <OpportunityModal
          mode="create"
          defaultStage="Won"
          initialPersonalPurchase
          initialContact={{
            _id: contactId,
            name: contactToShow?.name,
            ...(hasConfirmedCompany
              ? {
                  customerCompanyId: companyIdForSales,
                  customerCompanyName: companyNameForSales,
                  customerCompanyBusinessNumber: contactToShow?.customerCompanyId?.businessNumber
                }
              : {})
          }}
          onClose={() => setShowRegisterSaleModal(false)}
          onSaved={() => { setShowRegisterSaleModal(false); fetchProductSales(); }}
        />
      )}

      {showCardImageModal && businessCardImageUrl && (
        <div
          className="contact-detail-card-image-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="명함 이미지 미리보기"
        >
          <div className="contact-detail-card-image-content">
            <button
              type="button"
              className="contact-detail-card-image-close"
              onClick={() => setShowCardImageModal(false)}
              aria-label="닫기"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
            <img src={businessCardImageUrl} alt="명함" className="contact-detail-card-image-img" />
          </div>
        </div>
      )}
    </div>
  );
}
