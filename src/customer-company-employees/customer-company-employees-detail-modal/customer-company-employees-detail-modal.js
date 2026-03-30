import { useState, useEffect, useCallback, useRef } from 'react';
import CustomFieldsDisplay from '../../shared/custom-fields-display';
import CustomFieldsSection from '../../shared/custom-fields-section';
import ProductSalesModal from '../../shared/product-sales-modal/product-sales-modal';
import RegisterSaleModal from '../../product-list/register-sale-modal/register-sale-modal';
import AddContactModal from '../add-customer-company-employees-modal/add-customer-company-employees-modal';
import DriveLargeFileWarningModal from '../../shared/drive-large-file-warning-modal/drive-large-file-warning-modal';
import './customer-company-employees-detail-modal.css';

import { API_BASE } from '@/config';
import { getStoredCrmUser, isSeniorOrAboveRole } from '@/lib/crm-role-utils';
import { pingBackendHealth, BACKEND_KEEPALIVE_INTERVAL_MS, BACKEND_KEEPALIVE_INTERVAL_ENABLED } from '@/lib/backend-wake';
import { pollJournalFromAudioJob } from '@/lib/journal-from-audio-poll';

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

const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const MAX_DRIVE_API_UPLOAD_SIZE = 5 * 1024 * 1024;

function getDriveFolderIdFromLink(url) {
  if (!url || typeof url !== 'string') return null;
  const s = url.trim();
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
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
  const [showProductSalesModal, setShowProductSalesModal] = useState(false);
  const [showRegisterSaleModal, setShowRegisterSaleModal] = useState(false);
  const [selectedSaleForEdit, setSelectedSaleForEdit] = useState(null);
  const [productSalesList, setProductSalesList] = useState([]);
  const [loadingProductSales, setLoadingProductSales] = useState(true);
  const [driveFolderLink, setDriveFolderLink] = useState('');
  const [driveFolderId, setDriveFolderId] = useState(null);
  const [driveUploading, setDriveUploading] = useState(false);
  const [driveError, setDriveError] = useState('');
  const [largeFileWarning, setLargeFileWarning] = useState({ open: false, files: [], folderUrl: '' });
  const [docsDropActive, setDocsDropActive] = useState(false);
  const [dragInModal, setDragInModal] = useState(false);
  const [driveEmbedKey, setDriveEmbedKey] = useState(0);
  const [driveCurrentFolderId, setDriveCurrentFolderId] = useState(null);
  const [driveBreadcrumb, setDriveBreadcrumb] = useState([]);
  const [driveFilesList, setDriveFilesList] = useState([]);
  const [loadingDriveFiles, setLoadingDriveFiles] = useState(false);
  const driveFileInputRef = useRef(null);
  const audioInputRef = useRef(null);

  const [driveFolderName, setDriveFolderName] = useState('');

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
      if (largeFileWarning.open) setLargeFileWarning({ open: false, files: [], folderUrl: '' });
      else if (showRegisterSaleModal) setShowRegisterSaleModal(false);
      else if (showProductSalesModal) setShowProductSalesModal(false);
      else if (showCardImageModal) setShowCardImageModal(false);
      else if (showContactCardEmptyPopover) setShowContactCardEmptyPopover(false);
      else if (showDeleteConfirm) setShowDeleteConfirm(false);
      else if (editing) {
        setEditing(false);
        setEditForm({});
        setEditError('');
      } else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, editing, showDeleteConfirm, showCardImageModal, showContactCardEmptyPopover, showProductSalesModal, showRegisterSaleModal, largeFileWarning.open]);

  useEffect(() => {
    setDisplayedContact((prev) => ({ ...(prev || {}), ...(contact || {}) }));
  }, [contact]);

  const contactToShow = displayedContact || contact || {};
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

  const fetchContactDetail = useCallback(async () => {
    if (!contactId) return null;
    try {
      const res = await fetch(`${API_BASE}/customer-company-employees/${contactId}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?._id) return null;
      setDisplayedContact((prev) => ({ ...(prev || {}), ...data }));
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

  if (!contact) return null;

  const companyIdForSales = contactToShow?.customerCompanyId?._id ?? contactToShow?.customerCompanyId ?? null;
  const companyNameForSales = contactToShow?.customerCompanyId?.name ?? contactToShow?.companyName ?? '';
  /** 고객사가 customer-companies에서 확인 가능(사업자 번호 있음)일 때만 소속으로 표시; 아니면 소속 없음으로 간주 */
  const hasConfirmedCompany = companyIdForSales && contactToShow?.customerCompanyId?.businessNumber && String(contactToShow.customerCompanyId.businessNumber).trim();

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
      if (companyIdForSales) params.set('customerCompanyId', companyIdForSales);
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
  }, [contactId, companyIdForSales]);

  /**
   * Drive 폴더 초기화:
   *  - customerCompanyId가 있으면 → 등록폴더 / [고객사명]_[사업자번호]
   *  - customerCompanyId가 null 이면 → 등록폴더 / [이름]_[연락처]
   *  폴더가 없으면 ensure로 새로 만들고, driveRootFolderId를 연락처에 PATCH 저장.
   */
  useEffect(() => {
    if (!contact) return;
    let cancelled = false;
    (async () => {
      try {
        const rootRes = await fetch(`${API_BASE}/custom-field-definitions/drive-root`, { headers: getAuthHeader() });
        const rootJson = await rootRes.json().catch(() => ({}));
        const driveRootUrl = (rootJson.driveRootUrl != null && String(rootJson.driveRootUrl).trim()) ? String(rootJson.driveRootUrl).trim() : '';
        if (cancelled || !driveRootUrl) return;
        const registeredFolderId = getDriveFolderIdFromLink(driveRootUrl);
        if (!registeredFolderId) return;

        const ccId = contact.customerCompanyId?._id ?? contact.customerCompanyId ?? null;
        let folderName;

        if (ccId) {
          let ccName = contact.customerCompanyId?.name || contact.companyName || '';
          let ccBn = contact.customerCompanyId?.businessNumber || '';
          if (!ccName || !ccBn) {
            try {
              const ccRes = await fetch(`${API_BASE}/customer-companies/${ccId}`, { headers: getAuthHeader() });
              const ccData = await ccRes.json().catch(() => ({}));
              if (cancelled) return;
              if (ccRes.ok && ccData._id) {
                ccName = ccData.name || ccName;
                ccBn = ccData.businessNumber || ccBn;
              }
            } catch (_) {}
          }
          const bnPart = String(ccBn || '').replace(/\D/g, '') || '미등록';
          folderName = `${sanitizeFolderNamePart(ccName || '미소속', 80)}_${sanitizeFolderNamePart(bnPart, 20)}`;
        } else {
          const namePart = sanitizeFolderNamePart(contact.name || '이름없음', 80);
          const contactPart = sanitizeFolderNamePart(contact.phone || contact.email || '미등록', 40);
          folderName = `${namePart}_${contactPart}`;
        }

        if (cancelled) return;
        setDriveFolderName(folderName);

        const r = await fetch(`${API_BASE}/drive/folders/ensure`, {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ folderName, parentFolderId: registeredFolderId })
        });
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok && data.id) {
          setDriveFolderId(data.id);
          setDriveFolderLink(data.webViewLink || `https://drive.google.com/drive/folders/${data.id}`);
          if (contact.driveRootFolderId !== data.id) {
            fetch(`${API_BASE}/customer-company-employees/${contact._id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
              body: JSON.stringify({ driveRootFolderId: data.id })
            }).catch(() => {});
          }
        }
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [contactId]);

  useEffect(() => {
    if (driveFolderId && driveFolderName) {
      setDriveCurrentFolderId(driveFolderId);
      setDriveBreadcrumb([{ id: driveFolderId, name: driveFolderName }]);
    } else {
      setDriveCurrentFolderId(null);
      setDriveBreadcrumb([]);
      setDriveFilesList([]);
    }
  }, [driveFolderId, driveFolderName]);

  const fetchDriveFiles = useCallback(async () => {
    if (!driveCurrentFolderId) {
      setDriveFilesList([]);
      return;
    }
    setLoadingDriveFiles(true);
    try {
      const res = await fetch(`${API_BASE}/drive/files?folderId=${encodeURIComponent(driveCurrentFolderId)}&pageSize=100`, {
        headers: getAuthHeader()
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.files)) {
        setDriveFilesList(data.files);
      } else {
        setDriveFilesList([]);
      }
    } catch (_) {
      setDriveFilesList([]);
    } finally {
      setLoadingDriveFiles(false);
    }
  }, [driveCurrentFolderId]);

  useEffect(() => {
    fetchDriveFiles();
  }, [fetchDriveFiles]);

  const handleDirectFileUpload = useCallback(
    async (files) => {
      const filesArray = Array.from(files || []);
      if (!filesArray.length) return;
      setDriveUploading(true);
      setDriveError('');
      try {
        let parentId = driveCurrentFolderId || driveFolderId;
        if (!parentId) {
          if (!driveFolderName) {
            setDriveError('Drive 폴더가 아직 준비되지 않았습니다. 잠시 뒤 다시 시도해 주세요.');
            setDriveUploading(false);
            return;
          }
          const rootRes = await fetch(`${API_BASE}/custom-field-definitions/drive-root`, { headers: getAuthHeader() });
          const rootJson = await rootRes.json().catch(() => ({}));
          const driveRootUrl = (rootJson.driveRootUrl != null && String(rootJson.driveRootUrl).trim()) ? String(rootJson.driveRootUrl).trim() : '';
          if (!driveRootUrl) {
            setDriveError('회사 공유 드라이브 경로를 먼저 설정해 주세요. (회사 개요 → 전체 공유 드라이브 주소)');
            setDriveUploading(false);
            return;
          }
          const registeredFolderId = getDriveFolderIdFromLink(driveRootUrl);
          if (!registeredFolderId) {
            setDriveError('드라이브 경로 형식이 올바르지 않습니다.');
            setDriveUploading(false);
            return;
          }
          const r = await fetch(`${API_BASE}/drive/folders/ensure`, {
            method: 'POST',
            headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ folderName: driveFolderName, parentFolderId: registeredFolderId })
          });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) {
            setDriveError(data.error || '폴더를 준비할 수 없습니다.');
            setDriveUploading(false);
            return;
          }
          parentId = data.id;
          setDriveFolderId(parentId);
          setDriveFolderLink(data.webViewLink || `https://drive.google.com/drive/folders/${parentId}`);
        }
        const directDriveFiles = filesArray.filter((file) => Number(file?.size || 0) > MAX_DRIVE_API_UPLOAD_SIZE);
        const apiUploadFiles = filesArray.filter((file) => Number(file?.size || 0) <= MAX_DRIVE_API_UPLOAD_SIZE);
        if (directDriveFiles.length > 0) {
          const names = directDriveFiles.slice(0, 3).map((file) => file.name).join(', ');
          const more = directDriveFiles.length > 3 ? ` 외 ${directDriveFiles.length - 3}건` : '';
          setDriveError(`5MB 초과 파일은 API로 바로 올릴 수 없습니다: ${names}${more}`);
          setLargeFileWarning({
            open: true,
            files: directDriveFiles.map((file) => ({ name: file.name, size: file.size })),
            folderUrl: `https://drive.google.com/drive/folders/${parentId}`
          });
        }
        if (!apiUploadFiles.length) {
          return;
        }
        const uploadOne = async (file) => {
          const contentBase64 = await fileToBase64(file);
          if (!contentBase64) {
            setDriveError((e) => (e ? e : `"${file.name}" 변환 실패`));
            return;
          }
          const up = await fetch(`${API_BASE}/drive/upload`, {
            method: 'POST',
            headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              name: file.name,
              mimeType: file.type || 'application/octet-stream',
              contentBase64,
              parentFolderId: parentId
            })
          });
          const upData = await up.json().catch(() => ({}));
          if (!up.ok) setDriveError((e) => (e ? e : (upData.error || '업로드 실패')));
        };
        await Promise.all(apiUploadFiles.map((file) => uploadOne(file)));
        fetchDriveFiles();
      } catch (_) {
        setDriveError('Drive에 연결할 수 없습니다.');
      } finally {
        setDriveUploading(false);
        setDriveEmbedKey((k) => k + 1);
      }
    },
    [driveFolderName, driveFolderId, driveCurrentFolderId, fetchDriveFiles, contactId]
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
        if (data.summaryQueued) {
          setDisplayedContact((prev) => ({
            ...(prev || {}),
            summaryStatus: 'queued',
            summaryError: '',
            summaryQueuedForHistoryAt: data.summaryQueuedForHistoryAt || createdAt || new Date().toISOString()
          }));
          setSummaryNotice({
            type: 'info',
            text: '최신 업무 기록을 기준으로 Gemini 요약을 요청했습니다. 모달을 닫아도 서버에서 계속 처리됩니다.'
          });
        } else if (data.summarySkippedReason === 'older_than_latest_history') {
          setSummaryNotice({
            type: 'muted',
            text: '등록한 업무 기록 일시가 기존 최신 업무 기록보다 과거라서, 이번 기록은 요약 갱신 대상에서 제외되었습니다.'
          });
        }
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
    if (!isSeniorOrAboveRole(getStoredCrmUser()?.role)) {
      window.alert('업무 기록 삭제는 대표(Owner) 또는 책임(Senior)만 가능합니다.');
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

  const handleAddToGoogleContacts = async () => {
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
    if (!isSeniorOrAboveRole(getStoredCrmUser()?.role)) {
      window.alert('수정은 대표(Owner) 또는 책임(Senior)만 가능합니다.');
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
    if (!isSeniorOrAboveRole(getStoredCrmUser()?.role)) {
      setEditError('수정은 대표(Owner) 또는 책임(Senior)만 가능합니다.');
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
    if (!isSeniorOrAboveRole(getStoredCrmUser()?.role)) {
      window.alert('삭제는 대표(Owner) 또는 책임(Senior)만 가능합니다.');
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

  const canMutate = isSeniorOrAboveRole(getStoredCrmUser()?.role);

  return (
    <>
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
        className="contact-detail-panel"
        onDragEnter={(e) => { e.preventDefault(); setDragInModal(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragInModal(false); }}
      >
        <div className="contact-detail-inner">
          <header className="contact-detail-header">
            <div className="contact-detail-header-title">
              <span className="material-symbols-outlined">account_circle</span>
              <h2>{editing ? '연락처 수정' : '연락처 세부정보'}</h2>
            </div>
            <div className="contact-detail-header-actions">
              {!editing && (
                <>
                  <button
                    type="button"
                    className="contact-detail-icon-btn contact-detail-google-btn"
                    onClick={handleAddToGoogleContacts}
                    disabled={googleSaving}
                    title="구글 주소록에 등록"
                    aria-label="구글 주소록에 등록"
                  >
                    <img src="https://www.gstatic.com/images/branding/product/1x/contacts_2022_48dp.png" alt="" className="contact-detail-google-icon" />
                  </button>
                  {canMutate ? (
                    <>
                      <button type="button" className="contact-detail-icon-btn" onClick={startEdit} title="수정 (Owner / Senior)">
                        <span className="material-symbols-outlined">edit</span>
                      </button>
                      <button type="button" className="contact-detail-icon-btn contact-detail-delete-btn" onClick={() => setShowDeleteConfirm(true)} title="삭제 (Owner / Senior)">
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    </>
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

          {/* 삭제 확인 */}
          {showDeleteConfirm && canMutate && (
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

          <div className="contact-detail-body">
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
                      {!contact.company && !contact.companyName && !contact.email && !contact.phone && !contact.position && !contact.address && !contact.birthDate && !contact.memo && (
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
                <section className="customer-company-detail-section">
                  <div className="customer-company-detail-section-head">
                    <h3 className="customer-company-detail-section-title">
                      <span className="material-symbols-outlined">inventory_2</span>
                      제품 판매 현황
                    </h3>
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
                    <p className="customer-company-detail-employees-empty">이 고객사에 대한 제품 판매 기회가 없습니다.</p>
                  ) : (
                    <div className="customer-company-detail-product-sales-preview">
                      <ul className="customer-company-detail-product-sales-preview-list">
                        {productSalesList.slice(0, 3).map((row) => (
                          <li key={row._id} className="customer-company-detail-product-sales-preview-item">
                            <span className="customer-company-detail-product-sales-preview-product">
                              {row.productName || '—'}
                            </span>
                            <span className="customer-company-detail-product-sales-preview-title">{row.title || '—'}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>

                {/* 증서 · 자료 (Google Drive: [이름]_[연락처] 폴더) */}
                <section className="customer-company-detail-section register-sale-docs">
                  <input
                    ref={driveFileInputRef}
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
                      onClick={() => { if (!driveUploading && driveFileInputRef.current) driveFileInputRef.current.click(); }}
                      disabled={driveUploading}
                      title="파일 추가"
                      aria-label="파일 추가"
                    >
                      <span className="material-symbols-outlined">add</span>
                    </button>
                  </div>
                  {driveFolderLink && getDriveFolderIdFromLink(driveFolderLink) ? (
                    <div
                      className={`register-sale-docs-list-wrap ${docsDropActive ? 'register-sale-docs-dropzone-active' : ''} ${driveUploading ? 'register-sale-docs-dropzone-disabled' : ''}`}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!driveUploading) setDocsDropActive(true); }}
                      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDocsDropActive(false); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDocsDropActive(false);
                        if (!driveUploading && e.dataTransfer?.files?.length) handleDirectFileUpload(e.dataTransfer.files);
                      }}
                      aria-label="Drive 폴더 (폴더 클릭 시 들어가기, 파일 클릭 시 열기)"
                    >
                      {driveBreadcrumb.length > 0 && (
                        <div className="register-sale-docs-breadcrumb">
                          {driveBreadcrumb.map((seg, i) => (
                            <span key={seg.id}>
                              {i > 0 && <span className="register-sale-docs-breadcrumb-sep"> &gt; </span>}
                              <button
                                type="button"
                                className="register-sale-docs-breadcrumb-btn"
                                onClick={() => {
                                  setDriveCurrentFolderId(seg.id);
                                  setDriveBreadcrumb((b) => b.slice(0, i + 1));
                                }}
                              >
                                {seg.name}
                              </button>
                            </span>
                          ))}
                          <a
                            href={driveCurrentFolderId ? `https://drive.google.com/drive/folders/${driveCurrentFolderId}` : driveFolderLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="register-sale-docs-open-drive"
                            title="Drive에서 열기"
                          >
                            <span className="material-symbols-outlined">open_in_new</span>
                          </a>
                        </div>
                      )}
                      {loadingDriveFiles ? (
                        <p className="register-sale-docs-loading">목록 불러오는 중…</p>
                      ) : driveFilesList.length === 0 ? (
                        <div
                          className={`register-sale-docs-dropzone register-sale-docs-dropzone-inline ${docsDropActive ? 'register-sale-docs-dropzone-active' : ''} ${driveUploading ? 'register-sale-docs-dropzone-disabled' : ''}`}
                          onClick={() => { if (!driveUploading && driveFileInputRef.current) driveFileInputRef.current.click(); }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !driveUploading && driveFileInputRef.current) driveFileInputRef.current.click(); }}
                        >
                          <span className="material-symbols-outlined register-sale-docs-dropzone-icon">upload_file</span>
                          <span>{driveUploading ? '업로드 중…' : '비어 있음. 클릭하거나 파일을 놓아 추가'}</span>
                        </div>
                      ) : (
                        <ul className="register-sale-docs-file-list">
                          {driveFilesList.map((item) => {
                            const isFolder = item.mimeType === DRIVE_FOLDER_MIME;
                            const link = isFolder
                              ? null
                              : (item.webViewLink || `https://drive.google.com/file/d/${item.id}/view`);
                            return (
                              <li key={item.id}>
                                <button
                                  type="button"
                                  className={`register-sale-docs-file-row ${isFolder ? 'register-sale-docs-file-row--folder' : 'register-sale-docs-file-row--file'}`}
                                  onClick={() => {
                                    if (isFolder) {
                                      setDriveCurrentFolderId(item.id);
                                      setDriveBreadcrumb((b) => [...b, { id: item.id, name: item.name || '폴더' }]);
                                    } else if (link) {
                                      window.open(link, '_blank', 'noopener,noreferrer');
                                    }
                                  }}
                                >
                                  <span className="material-symbols-outlined register-sale-docs-file-icon">
                                    {isFolder ? 'folder' : 'description'}
                                  </span>
                                  <span className="register-sale-docs-file-name">{item.name || (isFolder ? '폴더' : '파일')}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {driveUploading ? (
                        <div className="register-sale-docs-embed-overlay">업로드 중…</div>
                      ) : docsDropActive ? (
                        <div className="register-sale-docs-embed-overlay">여기에 놓기</div>
                      ) : null}
                    </div>
                  ) : (
                    <div
                      className={`register-sale-docs-dropzone ${docsDropActive ? 'register-sale-docs-dropzone-active' : ''} ${driveUploading ? 'register-sale-docs-dropzone-disabled' : ''}`}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!driveUploading) setDocsDropActive(true); }}
                      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDocsDropActive(false); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDocsDropActive(false);
                        if (!driveUploading && e.dataTransfer?.files?.length) handleDirectFileUpload(e.dataTransfer.files);
                      }}
                      onClick={() => { if (!driveUploading && driveFileInputRef.current) driveFileInputRef.current.click(); }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !driveUploading && driveFileInputRef.current) driveFileInputRef.current.click(); }}
                      aria-label="파일 업로드 (드래그 앤 드롭 또는 클릭)"
                    >
                      <span className="material-symbols-outlined register-sale-docs-dropzone-icon">upload_file</span>
                      <span>{driveUploading ? '업로드 중…' : '파일을 여기에 놓거나 클릭하여 선택'}</span>
                    </div>
                  )}
                  {driveError && <p className="register-sale-docs-error">{driveError}</p>}
                </section>

                <section className="contact-detail-section">
                  <div className="contact-detail-section-head">
                    <h3>업무 기록</h3>
                    <span className="contact-detail-section-badge">{historyItems.length}건</span>
                  </div>
                  <div className={`contact-detail-summary-card ${contactToShow?.summaryStatus === 'error' ? 'is-error' : ''}`}>
                    <div className="contact-detail-summary-head">
                      <strong>업무 요약</strong>
                      <span className={`contact-detail-summary-status is-${contactToShow?.summaryStatus || 'idle'}`}>
                        {summaryStatusText[contactToShow?.summaryStatus || 'idle'] || '요약 대기'}
                      </span>
                    </div>
                    <p className="contact-detail-summary-text">
                      {contactToShow?.summary?.trim()
                        ? contactToShow.summary
                        : (contactToShow?.summaryStatus === 'queued' || contactToShow?.summaryStatus === 'processing'
                          ? '최신 업무 기록을 기준으로 Gemini가 요약을 만드는 중입니다. 모달을 닫아도 나중에 다시 확인할 수 있습니다.'
                          : '아직 저장된 업무 요약이 없습니다. 최신 업무 기록을 등록하면 자동으로 요약됩니다.')}
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
                          ? '음성 처리 중... (AssemblyAI 전사 → Gemini 분류/요약)'
                          : '음성 파일 드래그앤드롭 또는 선택 (MP3/WAV/M4A/WebM)'}
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
                                  title="업무 기록 삭제 (Owner / Senior)"
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
        <RegisterSaleModal
          saleId={selectedSaleForEdit._id}
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
        <RegisterSaleModal
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
      <DriveLargeFileWarningModal
        open={largeFileWarning.open}
        files={largeFileWarning.files}
        onClose={() => setLargeFileWarning({ open: false, files: [], folderUrl: '' })}
        onConfirm={() => {
          const url = largeFileWarning.folderUrl;
          setLargeFileWarning({ open: false, files: [], folderUrl: '' });
          if (url) window.open(url, '_blank', 'noopener,noreferrer');
        }}
      />
    </>
  );
}
