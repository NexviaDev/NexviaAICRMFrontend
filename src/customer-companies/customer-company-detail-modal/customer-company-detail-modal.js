import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import AllEmployeesModal from './all-employees-modal/all-employees-modal';
import AllHistoryModal from './all-history-modal/all-history-modal';
import ProductSalesModal from '../../shared/product-sales-modal/product-sales-modal';
import RegisterSaleModal from '../../product-list/register-sale-modal/register-sale-modal';
import ContactDetailModal from '../../customer-company-employees/customer-company-employees-detail-modal/customer-company-employees-detail-modal';
import AddCompanyModal from '../add-company-modal/add-company-modal';
import CustomFieldsDisplay from '../../shared/custom-fields-display';
import DriveLargeFileWarningModal from '../../shared/drive-large-file-warning-modal/drive-large-file-warning-modal';
import './customer-company-detail-modal.css';

import { API_BASE } from '@/config';
import { getStoredCrmUser, isSeniorOrAboveRole } from '@/lib/crm-role-utils';

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

function formatBusinessNumber(num) {
  if (!num) return '—';
  const s = String(num).replace(/\D/g, '');
  if (s.length <= 3) return s;
  if (s.length <= 5) return `${s.slice(0, 3)}-${s.slice(3)}`;
  return `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5, 10)}`;
}

const STATUS_LABEL = { active: '활성', inactive: '비활성', lead: '리드' };

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

function sanitizeFolderNamePart(s) {
  return String(s ?? '')
    .replace(/[/\\*?:<>"|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
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

/** 고객사 세부정보 모달 - customer-companies-detail.html 기반 */
export default function CustomerCompanyDetailModal({ company, onClose, onUpdated, onDeleted }) {
  const navigate = useNavigate();
  const [historyItems, setHistoryItems] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [journalText, setJournalText] = useState('');
  const [journalDateTime, setJournalDateTime] = useState(() => toDatetimeLocalValue(new Date()));
  const [savingNote, setSavingNote] = useState(false);
  const [audioUploading, setAudioUploading] = useState(false);
  const [audioDropActive, setAudioDropActive] = useState(false);
  const [journalError, setJournalError] = useState('');
  const [summaryNotice, setSummaryNotice] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [showAllEmployeesModal, setShowAllEmployeesModal] = useState(false);
  const [showAllHistoryModal, setShowAllHistoryModal] = useState(false);
  const [showProductSalesModal, setShowProductSalesModal] = useState(false);
  const [showRegisterSaleModal, setShowRegisterSaleModal] = useState(false);
  const [selectedSaleForEdit, setSelectedSaleForEdit] = useState(null);
  const [productSalesList, setProductSalesList] = useState([]);
  const [loadingProductSales, setLoadingProductSales] = useState(true);
  const [contactForDetailModal, setContactForDetailModal] = useState(null);
  const [customDefinitions, setCustomDefinitions] = useState([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
  const fileInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const modalContentRef = useRef(null);
  const [showRegisteredNamePopover, setShowRegisteredNamePopover] = useState(false);
  const [certificateImageError, setCertificateImageError] = useState(false);
  const companyNameButtonRef = useRef(null);
  const registeredNamePopoverRef = useRef(null);
  const [displayedCompany, setDisplayedCompany] = useState(company);
  const companyToShow = displayedCompany || company || {};
  const companyId = companyToShow?._id || company?._id;
  const hasMapCoords = Number.isFinite(Number(companyToShow?.latitude)) && Number.isFinite(Number(companyToShow?.longitude));
  const mapPreviewSrc = hasMapCoords
    ? `https://www.google.com/maps?q=${Number(companyToShow.latitude)},${Number(companyToShow.longitude)}&z=15&output=embed`
    : (companyToShow?.address ? `https://www.google.com/maps?q=${encodeURIComponent(String(companyToShow.address))}&z=15&output=embed` : '');

  const openCompanyOnMap = useCallback(() => {
    if (!companyId) return;
    const q = new URLSearchParams();
    q.set('focusCompanyId', String(companyId));
    q.set('zoom', '16');
    const nm = (companyToShow?.name && String(companyToShow.name).trim()) || '';
    if (nm) q.set('focusName', nm);
    /** 경로 이동만 수행 — onClose에서 setSearchParams만 호출하면 같은 틱에 navigate가 무시되어 /map으로 가지 못함 */
    navigate(`/map?${q.toString()}`);
  }, [companyId, companyToShow?.name, navigate]);

  /* 등록된 사업자 등록증 팝오버: 바깥 클릭 시 닫기 */
  useEffect(() => {
    if (!showRegisteredNamePopover) return;
    const handleClick = (e) => {
      const btn = companyNameButtonRef.current;
      const pop = registeredNamePopoverRef.current;
      if (btn?.contains(e.target) || pop?.contains(e.target)) return;
      setShowRegisteredNamePopover(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showRegisteredNamePopover]);

  /* 팝오버 열릴 때 이미지 에러 초기화 */
  useEffect(() => {
    if (showRegisteredNamePopover) setCertificateImageError(false);
  }, [showRegisteredNamePopover]);

  const driveFolderName = (() => {
    if (!companyToShow?._id) return '미소속_미등록';
    const namePart = sanitizeFolderNamePart(companyToShow.name || '미소속');
    /** 사업자번호는 숫자만 사용 — add-company-modal·백엔드 sanitize와 동일 규칙으로 폴더명 통일 */
    const numPart =
      sanitizeFolderNamePart(
        companyToShow.businessNumber != null ? String(companyToShow.businessNumber).replace(/\D/g, '') : ''
      ) || '미등록';
    return `${namePart}_${numPart}`;
  })();

  /** React Strict Mode 이중 useEffect로 ensure가 두 번 호출되어 Drive에 동일 폴더가 2개 생기는 것 방지 */
  const driveRootEnsureInFlightRef = useRef(false);

  const ensureCompanyDriveRootFolder = useCallback(async () => {
    if (!driveFolderName) return null;
    const r = await fetch(`${API_BASE}/drive/folders/ensure`, {
      method: 'POST',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ folderName: driveFolderName })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.id) {
      throw new Error(data.error || '폴더를 준비할 수 없습니다.');
    }
    const folderLink = data.webViewLink || `https://drive.google.com/drive/folders/${data.id}`;
    setDriveFolderId(data.id);
    setDriveFolderLink(folderLink);
    return { id: data.id, webViewLink: folderLink };
  }, [driveFolderName]);

  const fetchCustomDefinitions = async () => {
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=customerCompany`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) setCustomDefinitions(data.items);
    } catch (_) {}
  };

  useEffect(() => {
    fetchCustomDefinitions();
  }, [companyId]);

  useEffect(() => {
    setDisplayedCompany((prev) => ({ ...(prev || {}), ...(company || {}) }));
  }, [company]);

  /* Drive 루트 폴더: 저장된 ID 대신 이름으로 항상 재조회 후 없으면 생성 */
  useEffect(() => {
    if (!companyId || !driveFolderName) return;
    if (driveRootEnsureInFlightRef.current) return;
    driveRootEnsureInFlightRef.current = true;
    (async () => {
      try {
        await ensureCompanyDriveRootFolder();
      } catch (_) {
      } finally {
        driveRootEnsureInFlightRef.current = false;
      }
    })();
  }, [companyId, driveFolderName, ensureCompanyDriveRootFolder]);

  /* 증서·자료 현재 폴더: 루트 폴더가 준비되면 동기화 */
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
    if (!driveFolderName) {
      setDriveFilesList([]);
      return;
    }
    setLoadingDriveFiles(true);
    try {
      /**
       * Google Drive 사용 시마다 먼저 [회사명]_[사업자번호] 루트가 실제 목록에 있는지 확인.
       * 삭제되었으면 새로 만들고 그 최신 ID를 기준으로 이어서 사용한다.
       */
      let targetFolderId = driveCurrentFolderId;
      const isRootContext = !targetFolderId || targetFolderId === driveFolderId;
      if (isRootContext) {
        const ensuredRoot = await ensureCompanyDriveRootFolder();
        targetFolderId = ensuredRoot?.id || null;
        if (!targetFolderId) {
          setDriveFilesList([]);
          return;
        }
        if (driveCurrentFolderId !== targetFolderId) setDriveCurrentFolderId(targetFolderId);
        if (driveFolderId !== targetFolderId) setDriveBreadcrumb([{ id: targetFolderId, name: driveFolderName }]);
      }
      if (!targetFolderId) {
        setDriveFilesList([]);
        return;
      }
      const res = await fetch(`${API_BASE}/drive/files?folderId=${encodeURIComponent(targetFolderId)}&pageSize=100`, {
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
  }, [driveCurrentFolderId, driveFolderId, driveFolderName, ensureCompanyDriveRootFolder]);

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
          try {
            const ensured = await ensureCompanyDriveRootFolder();
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
    [driveFolderId, driveCurrentFolderId, ensureCompanyDriveRootFolder, fetchDriveFiles]
  );

  if (!company) return null;

  /** 지원 업무기록 기준 가장 최근 한 명의 직원 정보 */
  const latestEmployeeByHistory =
    historyItems.length > 0 && employees.length > 0
      ? employees.find((e) => String(e._id) === String(historyItems[0].customerCompanyEmployeeId)) || null
      : null;

  const status = (companyToShow.status || 'active').toLowerCase();
  const displayStatus = STATUS_LABEL[status] || companyToShow.status || '활성';

  const fetchHistory = async () => {
    if (!companyId) return;
    setLoadingHistory(true);
    try {
      const res = await fetch(`${API_BASE}/customer-companies/${companyId}/history`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setHistoryItems(data.items || []);
      else setHistoryItems([]);
    } catch (_) {
      setHistoryItems([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const fetchEmployees = async () => {
    if (!companyId) return;
    setLoadingEmployees(true);
    try {
      const res = await fetch(`${API_BASE}/customer-company-employees?customerCompanyId=${companyId}&limit=100`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setEmployees(data.items || []);
      else setEmployees([]);
    } catch (_) {
      setEmployees([]);
    } finally {
      setLoadingEmployees(false);
    }
  };

  const fetchProductSales = async () => {
    if (!companyId) return;
    setLoadingProductSales(true);
    try {
      const res = await fetch(`${API_BASE}/sales-opportunities?customerCompanyId=${companyId}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.grouped) {
        const flat = (Object.values(data.grouped) || []).flat();
        const companyIdStr = String(companyId);
        const onlyWithCompany = flat.filter((item) => {
          const itemCompanyId = item.customerCompanyId?._id ?? item.customerCompanyId;
          return itemCompanyId != null && String(itemCompanyId) === companyIdStr;
        });
        setProductSalesList(onlyWithCompany);
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
    fetchHistory();
    fetchEmployees();
    fetchProductSales();
  }, [companyId]);

  useEffect(() => {
    setJournalDateTime(toDatetimeLocalValue(new Date()));
    setSummaryNotice(null);
  }, [companyId]);

  const fetchCompanyDetail = useCallback(async () => {
    if (!companyId) return null;
    try {
      const res = await fetch(`${API_BASE}/customer-companies/${companyId}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?._id) return null;
      setDisplayedCompany((prev) => ({ ...(prev || {}), ...data }));
      return data;
    } catch (_) {
      return null;
    }
  }, [companyId]);

  useEffect(() => {
    fetchCompanyDetail();
  }, [fetchCompanyDetail]);

  useEffect(() => {
    if (!companyId) return undefined;
    if (!['queued', 'processing'].includes(companyToShow?.summaryStatus)) return undefined;
    const timer = window.setInterval(() => {
      fetchCompanyDetail();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [companyId, companyToShow?.summaryStatus, fetchCompanyDetail]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (largeFileWarning.open) setLargeFileWarning({ open: false, files: [], folderUrl: '' });
      else if (showDeleteConfirm) setShowDeleteConfirm(false);
      else if (contactForDetailModal) setContactForDetailModal(null);
      else if (showEditModal) setShowEditModal(false);
      else if (showAllHistoryModal) setShowAllHistoryModal(false);
      else if (showAllEmployeesModal) setShowAllEmployeesModal(false);
      else if (showRegisterSaleModal) setShowRegisterSaleModal(false);
      else if (showProductSalesModal) setShowProductSalesModal(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showDeleteConfirm, contactForDetailModal, showEditModal, showAllHistoryModal, showAllEmployeesModal, showProductSalesModal, showRegisterSaleModal, largeFileWarning.open]);

  const handleDeleteHistory = async (historyId) => {
    if (!historyId) return;
    if (!isSeniorOrAboveRole(getStoredCrmUser()?.role)) {
      window.alert('업무 기록 삭제는 대표(Owner) 또는 책임(Senior)만 가능합니다.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/customer-companies/${companyId}/history/${historyId}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      if (res.ok) {
        fetchHistory();
        fetchCompanyDetail();
      }
    } catch (_) {}
  };

  const handleSaveNote = async () => {
    const content = journalText.trim();
    if (!content) return;
    setJournalError('');
    setSummaryNotice(null);
    setSavingNote(true);
    try {
      const createdAt = journalDateTime && !Number.isNaN(new Date(journalDateTime).getTime())
        ? new Date(journalDateTime).toISOString()
        : undefined;
      const requestBody = JSON.stringify({ content, ...(createdAt ? { createdAt } : {}) });
      const res = await fetch(`${API_BASE}/customer-companies/${companyId}/history`, {
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
          setDisplayedCompany((prev) => ({
            ...(prev || {}),
            summaryStatus: 'queued',
            summaryError: '',
            summaryQueuedForHistoryAt: data.summaryQueuedForHistoryAt || createdAt || new Date().toISOString()
          }));
          setSummaryNotice({
            type: 'info',
            text: '최신 고객사 업무 기록을 기준으로 Gemini 요약을 요청했습니다. 모달을 닫아도 서버에서 계속 처리됩니다.'
          });
        } else if (data.summarySkippedReason === 'older_than_latest_history') {
          setSummaryNotice({
            type: 'muted',
            text: '등록한 업무 기록 일시가 기존 최신 기록보다 과거라서, 이번 기록은 요약 갱신 대상에서 제외되었습니다.'
          });
        }
        fetchHistory();
        fetchCompanyDetail();
      } else {
        setJournalError(data.error || '저장에 실패했습니다.');
      }
    } catch (_) {
      setJournalError('서버에 연결할 수 없습니다.');
    } finally {
      setSavingNote(false);
    }
  };

  const uploadAudioForJournal = useCallback(async (filesLike) => {
    const files = Array.from(filesLike || []).filter((f) => f && f instanceof File);
    if (!files.length || !companyId || savingNote || audioUploading) return;
    const accept = /\.(mp3|wav|m4a|webm)$/i;
    const audioTypes = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm'];
    const file = files.find((f) => accept.test(f.name) || audioTypes.includes(f.type));
    if (!file) {
      setJournalError('MP3, WAV, M4A, WebM 파일만 업로드할 수 있습니다.');
      return;
    }
    setJournalError('');
    setSummaryNotice({
      type: 'info',
      text: '음성 파일을 처리 중입니다. AssemblyAI 전사 후 Gemini가 분류/요약합니다.'
    });
    setAudioUploading(true);
    try {
      const form = new FormData();
      form.append('audio', file);
      const res = await fetch(`${API_BASE}/customer-companies/${companyId}/history/from-audio`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: form
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '음성 업로드 처리에 실패했습니다.');
      setJournalText(data.content || '');
      setJournalDateTime(toDatetimeLocalValue(new Date()));
      setSummaryNotice({
        type: 'info',
        text: '요약이 입력창에 채워졌습니다. 내용 확인 후 "메모 저장"을 눌러 등록해 주세요. 개인정보 보호를 위해 AssemblyAI 전사 데이터는 삭제 요청되었습니다.'
      });
    } catch (e) {
      setJournalError(e.message || '음성 업로드 처리에 실패했습니다.');
    } finally {
      setAudioUploading(false);
    }
  }, [audioUploading, companyId, fetchCompanyDetail, savingNote]);

  const summaryStatusText = {
    idle: '요약 대기',
    queued: 'Gemini 요약 대기 중...',
    processing: 'Gemini 요약 생성 중...',
    completed: '최신 요약',
    error: '요약 실패'
  };

  const handleDeleteCompany = async () => {
    if (!companyId) return;
    if (!isSeniorOrAboveRole(getStoredCrmUser()?.role)) {
      window.alert('삭제는 대표(Owner) 또는 책임(Senior)만 가능합니다.');
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/customer-companies/${companyId}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      if (res.ok) {
        onDeleted?.();
        onClose?.();
      } else {
        const data = await res.json().catch(() => ({}));
        setShowDeleteConfirm(false);
        window.alert(data.error || '삭제에 실패했습니다.');
      }
    } catch (_) {
      setShowDeleteConfirm(false);
      window.alert('서버에 연결할 수 없습니다.');
    } finally {
      setDeleting(false);
    }
  };

  const canMutate = isSeniorOrAboveRole(getStoredCrmUser()?.role);

  return (
    <>
      <div className="customer-company-detail-overlay" aria-hidden="true" />
      <div
        ref={modalContentRef}
        className="customer-company-detail-panel"
        onDragEnter={(e) => { e.preventDefault(); setDragInModal(true); }}
        onDragLeave={(e) => { if (!modalContentRef.current?.contains(e.relatedTarget)) setDragInModal(false); }}
      >
        <div className="customer-company-detail-inner">
          <header className="customer-company-detail-header">
            <div className="customer-company-detail-header-title">
              <span className="material-symbols-outlined">business</span>
              <h2>고객사 세부정보</h2>
            </div>
            <div className="customer-company-detail-header-actions">
              {canMutate ? (
                <>
                  <button type="button" className="customer-company-detail-icon-btn" onClick={() => setShowEditModal(true)} title="수정 (Owner / Senior)">
                    <span className="material-symbols-outlined">edit</span>
                  </button>
                  <button type="button" className="customer-company-detail-icon-btn customer-company-detail-delete-btn" onClick={() => setShowDeleteConfirm(true)} title="삭제 (Owner / Senior)">
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                </>
              ) : null}
              <button type="button" className="customer-company-detail-icon-btn" onClick={onClose} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          </header>

          {showDeleteConfirm && canMutate && (
            <div className="customer-company-detail-delete-confirm">
              <span className="material-symbols-outlined">warning</span>
              <p>이 고객사를 삭제하시겠습니까?<br />삭제하면 소속 연락처·업무 기록 등 관련 데이터에 영향을 줄 수 있습니다.</p>
              <div className="customer-company-detail-delete-confirm-btns">
                <button type="button" className="customer-company-detail-confirm-cancel" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>취소</button>
                <button type="button" className="customer-company-detail-confirm-delete" onClick={handleDeleteCompany} disabled={deleting}>
                  {deleting ? '삭제 중...' : '삭제'}
                </button>
              </div>
            </div>
          )}

          <div className="customer-company-detail-body">
            <section className="customer-company-detail-card">
              <div className="customer-company-detail-card-map-col">
                <div className="customer-company-detail-card-map">
                  <button
                    type="button"
                    className="customer-company-detail-card-map-btn"
                    onClick={openCompanyOnMap}
                    disabled={!companyId}
                    title={companyId ? '/map으로 이동해 해당 업체를 검색·표시합니다.' : '고객사 정보가 없습니다.'}
                  >
                    {mapPreviewSrc ? (
                      <iframe
                        title={`${companyToShow.name || '업체'} 위치 미리보기`}
                        src={mapPreviewSrc}
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        className="customer-company-detail-card-map-iframe"
                      />
                    ) : (
                      <div className="customer-company-detail-card-map-empty">
                        <span className="material-symbols-outlined">map</span>
                        <span>주소/좌표 없음</span>
                      </div>
                    )}
                  </button>
                </div>
              </div>
              <div className="customer-company-detail-info">
                <div className="customer-company-detail-name-row">
                  <div className="customer-company-detail-name-wrap">
                    <button
                      type="button"
                      ref={companyNameButtonRef}
                      className="customer-company-detail-name-link"
                      onClick={() => {
                        if (companyToShow.businessRegistrationCertificateDriveUrl) {
                          window.open(companyToShow.businessRegistrationCertificateDriveUrl, '_blank', 'noopener,noreferrer');
                          return;
                        }
                        setShowRegisteredNamePopover((v) => !v);
                      }}
                      aria-expanded={showRegisteredNamePopover}
                      aria-haspopup="dialog"
                      aria-label="회사명 클릭 시 등록된 사업자 등록증 보기"
                    >
                      <h1 className="customer-company-detail-name">{companyToShow.name || '—'}</h1>
                      <span className="material-symbols-outlined customer-company-detail-name-link-icon">info</span>
                    </button>
                    {showRegisteredNamePopover && (
                      <div
                        ref={registeredNamePopoverRef}
                        className="customer-company-detail-registered-name-popover customer-company-detail-certificate-popover"
                        role="dialog"
                        aria-label="등록된 사업자 등록증"
                      >
                        <div className="customer-company-detail-registered-name-popover-title">등록된 사업자 등록증</div>
                        {companyToShow.businessRegistrationCertificateUrl ? (
                          <div className="customer-company-detail-certificate-body">
                            {!certificateImageError && (
                              <img
                                src={companyToShow.businessRegistrationCertificateUrl}
                                alt="사업자 등록증"
                                className="customer-company-detail-certificate-img"
                                onError={() => setCertificateImageError(true)}
                              />
                            )}
                            {certificateImageError && (
                              <p className="customer-company-detail-certificate-doc-hint">문서(PDF)는 아래 링크로 확인하세요.</p>
                            )}
                            <a
                              href={companyToShow.businessRegistrationCertificateUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="customer-company-detail-certificate-link"
                            >
                              새 탭에서 보기
                              <span className="material-symbols-outlined">open_in_new</span>
                            </a>
                          </div>
                        ) : (
                          <p className="customer-company-detail-certificate-empty">등록된 사업자 등록증이 없습니다.</p>
                        )}
                        <button
                          type="button"
                          className="customer-company-detail-registered-name-popover-close"
                          onClick={() => setShowRegisteredNamePopover(false)}
                          aria-label="닫기"
                        >
                          <span className="material-symbols-outlined">close</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <span className={`customer-company-detail-status-badge status-${status}`}>{displayStatus}</span>
                </div>
                <div className="customer-company-detail-meta">
                  {companyToShow.businessNumber != null && (
                    <div className="customer-company-detail-meta-item">
                      <span className="material-symbols-outlined">badge</span>
                      <span>사업자번호: {formatBusinessNumber(companyToShow.businessNumber)}</span>
                    </div>
                  )}
                  {companyToShow.representativeName && (
                    <div className="customer-company-detail-meta-item">
                      <span className="material-symbols-outlined">person</span>
                      <span>대표: {companyToShow.representativeName}</span>
                    </div>
                  )}
                  {companyToShow.address && (
                    <div className="customer-company-detail-meta-item full">
                      <span className="material-symbols-outlined">location_on</span>
                      <span>{companyToShow.address}</span>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <CustomFieldsDisplay
              definitions={customDefinitions}
              values={companyToShow.customFields || {}}
              className="customer-company-detail-custom-fields"
            />

            <section className="customer-company-detail-section">
              <div className="customer-company-detail-section-head">
                <h3 className="customer-company-detail-section-title">
                  <span className="material-symbols-outlined">group</span>
                  직원 리스트
                </h3>
                {!loadingEmployees && (
                  <button
                    type="button"
                    className="customer-company-detail-btn-all"
                    onClick={() => setShowAllEmployeesModal(true)}
                  >
                    전체 보기
                    <span className="material-symbols-outlined">arrow_forward</span>
                  </button>
                )}
              </div>
              {loadingEmployees || loadingHistory ? (
                <p className="customer-company-detail-employees-empty">불러오는 중...</p>
              ) : latestEmployeeByHistory ? (
                <div className="customer-company-detail-employee-preview">
                  <span className="customer-company-detail-employee-preview-label">지원 업무기록 기준 (가장 최근)</span>
                  <div className="customer-company-detail-employee-item">
                    <div className="customer-company-detail-employee-name">{latestEmployeeByHistory.name || '—'}</div>
                    <div className="customer-company-detail-employee-meta">
                      {latestEmployeeByHistory.phone && (
                        <span className="customer-company-detail-employee-meta-item">
                          <span className="material-symbols-outlined">phone</span>
                          {latestEmployeeByHistory.phone}
                        </span>
                      )}
                      {latestEmployeeByHistory.email && (
                        <span className="customer-company-detail-employee-meta-item">
                          <span className="material-symbols-outlined">mail</span>
                          {latestEmployeeByHistory.email}
                        </span>
                      )}
                      {!latestEmployeeByHistory.phone && !latestEmployeeByHistory.email && (
                        <span className="customer-company-detail-employee-meta-item">연락처 없음</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : employees.length === 0 ? (
                <p className="customer-company-detail-employees-empty">등록된 직원이 없습니다.</p>
              ) : (
                <p className="customer-company-detail-employees-empty">최근 업무 기록이 없어 표시할 직원이 없습니다. 전체 보기에서 목록을 확인하세요.</p>
              )}
            </section>

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

            {/* 증서 · 자료 (Google Drive: [고객사]_[사업자번호] 폴더) */}
            <section className="customer-company-detail-section register-sale-docs">
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
                  {/* 경로(브레드크럼): 클릭 시 해당 단계로 이동 */}
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
                      onClick={() => { if (!driveUploading && fileInputRef.current) fileInputRef.current.click(); }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !driveUploading && fileInputRef.current) fileInputRef.current.click(); }}
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
                  onClick={() => { if (!driveUploading && fileInputRef.current) fileInputRef.current.click(); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !driveUploading && fileInputRef.current) fileInputRef.current.click(); }}
                  aria-label="파일 업로드 (드래그 앤 드롭 또는 클릭)"
                >
                  <span className="material-symbols-outlined register-sale-docs-dropzone-icon">upload_file</span>
                  <span>{driveUploading ? '업로드 중…' : '파일을 여기에 놓거나 클릭하여 선택'}</span>
                </div>
              )}
              {driveError && <p className="register-sale-docs-error">{driveError}</p>}
            </section>

            {showProductSalesModal && (
              <ProductSalesModal
                companyName={companyToShow.name}
                companyId={companyId}
                items={productSalesList}
                driveFolderLink={driveFolderLink || undefined}
                onClose={() => setShowProductSalesModal(false)}
                onAddSale={() => { setShowProductSalesModal(false); setShowRegisterSaleModal(true); }}
                onSelectItem={(row) => { setShowProductSalesModal(false); setSelectedSaleForEdit(row); }}
              />
            )}
            {showRegisterSaleModal && (
              <RegisterSaleModal
                initialCustomerCompany={{ _id: companyId, name: companyToShow.name, businessNumber: companyToShow.businessNumber }}
                onClose={() => setShowRegisterSaleModal(false)}
                onSaved={() => { setShowRegisterSaleModal(false); fetchProductSales(); }}
              />
            )}
            {selectedSaleForEdit && (
              <RegisterSaleModal
                saleId={selectedSaleForEdit._id}
                initialCustomerCompany={{ _id: companyId, name: companyToShow.name, businessNumber: companyToShow.businessNumber }}
                onClose={() => setSelectedSaleForEdit(null)}
                onSaved={() => { setSelectedSaleForEdit(null); fetchProductSales(); }}
              />
            )}

            {showAllEmployeesModal && (
              <AllEmployeesModal
                employees={employees}
                customerCompany={company}
                onClose={() => setShowAllEmployeesModal(false)}
                onSelectContact={(emp) => {
                  setContactForDetailModal(emp);
                  setShowAllEmployeesModal(false);
                }}
                onRefreshEmployees={fetchEmployees}
              />
            )}

            {contactForDetailModal && (
              <ContactDetailModal
                contact={contactForDetailModal}
                onClose={() => setContactForDetailModal(null)}
                onUpdated={() => {
                  fetchEmployees();
                  fetchHistory();
                  fetchCompanyDetail();
                }}
              />
            )}

            {showEditModal && canMutate && (
              <AddCompanyModal
                company={companyToShow}
                onClose={() => setShowEditModal(false)}
                onUpdated={(updatedCompany) => {
                  setDisplayedCompany((prev) => ({ ...(prev || {}), ...(updatedCompany || {}) }));
                  setShowEditModal(false);
                  onUpdated?.(updatedCompany);
                }}
              />
            )}

            {showAllHistoryModal && (
              <AllHistoryModal
                historyItems={historyItems}
                companyId={companyId}
                onClose={() => setShowAllHistoryModal(false)}
                onRefresh={fetchHistory}
              />
            )}

            <section className="customer-company-detail-section">
              <div className="customer-company-detail-section-head">
                <h3 className="customer-company-detail-section-title">
                  <span className="material-symbols-outlined">history_edu</span>
                  지원 및 업무 기록
                </h3>
                {!loadingHistory && historyItems.length > 0 && (
                  <button
                    type="button"
                    className="customer-company-detail-btn-all"
                    onClick={() => setShowAllHistoryModal(true)}
                  >
                    전체 보기
                    <span className="material-symbols-outlined">arrow_forward</span>
                  </button>
                )}
              </div>
              <div className={`customer-company-detail-summary-card ${companyToShow?.summaryStatus === 'error' ? 'is-error' : ''}`}>
                <div className="customer-company-detail-summary-head">
                  <strong>최근 전체 업무 요약</strong>
                  <span className={`customer-company-detail-summary-status is-${companyToShow?.summaryStatus || 'idle'}`}>
                    {summaryStatusText[companyToShow?.summaryStatus || 'idle'] || '요약 대기'}
                  </span>
                </div>
                <p className="customer-company-detail-summary-text">
                  {companyToShow?.summary?.trim()
                    ? companyToShow.summary
                    : (companyToShow?.summaryStatus === 'queued' || companyToShow?.summaryStatus === 'processing'
                      ? '최신 고객사 업무 기록을 기준으로 Gemini가 요약을 만드는 중입니다. 모달을 닫아도 나중에 다시 확인할 수 있습니다.'
                      : '아직 저장된 고객사 업무 요약이 없습니다. 최신 업무 기록을 등록하면 자동으로 요약됩니다.')}
                </p>
                {companyToShow?.summaryUpdatedAt && (
                  <p className="customer-company-detail-summary-meta">
                    마지막 요약: {formatHistoryDate(companyToShow.summaryUpdatedAt)}
                  </p>
                )}
                {companyToShow?.summaryError && (
                  <p className="customer-company-detail-summary-error">{companyToShow.summaryError}</p>
                )}
                {summaryNotice?.text && (
                  <p className={`customer-company-detail-summary-notice is-${summaryNotice.type || 'info'}`}>
                    {summaryNotice.text}
                  </p>
                )}
                {Array.isArray(companyToShow.relatedCalendarVisits) && companyToShow.relatedCalendarVisits.length > 0 ? (
                  <div className="customer-company-detail-summary-calendar" aria-label="연결된 캘린더 방문">
                    <div className="customer-company-detail-summary-calendar-title">
                      <span className="material-symbols-outlined" aria-hidden>calendar_month</span>
                      예정된 방문 (캘린더)
                    </div>
                    <ul className="customer-company-detail-summary-calendar-list">
                      {companyToShow.relatedCalendarVisits.map((v) => (
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
              <div className="customer-company-detail-journal-input-wrap">
                {journalError && <p className="customer-company-detail-journal-error">{journalError}</p>}
                <div className="customer-company-detail-journal-datetime-row">
                  <label htmlFor="customer-company-detail-journal-datetime" className="customer-company-detail-journal-datetime-label">등록일시</label>
                  <input
                    id="customer-company-detail-journal-datetime"
                    type="datetime-local"
                    className="customer-company-detail-journal-datetime"
                    value={journalDateTime}
                    onChange={(e) => setJournalDateTime(e.target.value)}
                    aria-label="업무 기록 등록일시"
                  />
                </div>
                <textarea
                  className="customer-company-detail-journal-input"
                  placeholder="회사 단위 메모 또는 업무 기록 (여러 직원 미팅 등)..."
                  rows={3}
                  value={journalText}
                  onChange={(e) => setJournalText(e.target.value)}
                />
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.webm"
                  className="customer-company-detail-audio-input-hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) uploadAudioForJournal(e.target.files);
                    e.target.value = '';
                  }}
                  aria-hidden="true"
                />
                <div
                  className={`customer-company-detail-journal-audio-drop ${audioDropActive ? 'is-dragover' : ''} ${audioUploading ? 'is-uploading' : ''}`}
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
                    className="customer-company-detail-journal-audio-btn"
                    onClick={() => audioInputRef.current?.click()}
                    disabled={audioUploading || savingNote}
                  >
                    파일 선택
                  </button>
                </div>
                <div className="customer-company-detail-journal-actions">
                  <button
                    type="button"
                    className="customer-company-detail-journal-save"
                    onClick={handleSaveNote}
                    disabled={savingNote || audioUploading || !journalText.trim()}
                  >
                    {savingNote ? '저장 중...' : '메모 저장'}
                  </button>
                </div>
              </div>
              <div className="customer-company-detail-timeline">
                {loadingHistory ? (
                  <p className="customer-company-detail-timeline-empty">불러오는 중...</p>
                ) : historyItems.length === 0 ? (
                  <p className="customer-company-detail-timeline-empty">등록된 업무 기록이 없습니다.</p>
                ) : (
                  historyItems.map((entry) => (
                    <div key={entry._id} className="customer-company-detail-timeline-item">
                      <div className="customer-company-detail-timeline-dot" />
                      <div className="customer-company-detail-timeline-card">
                        <div className="customer-company-detail-timeline-head">
                          <div>
                            {entry.employeeName && <span className="customer-company-detail-timeline-emp">{entry.employeeName}</span>}
                            <time>{formatHistoryDate(entry.createdAt)}</time>
                          </div>
                          {canMutate ? (
                            <button
                              type="button"
                              className="customer-company-detail-timeline-delete"
                              onClick={() => handleDeleteHistory(entry._id)}
                              aria-label="삭제"
                              title="업무 기록 삭제 (Owner / Senior)"
                            >
                              <span className="material-symbols-outlined">delete</span>
                            </button>
                          ) : null}
                        </div>
                        <div className="customer-company-detail-timeline-content-wrap">
                          {splitContentIntoBlocks(entry.content).map((paragraphSentences, pIdx) => (
                            <p key={pIdx} className="customer-company-detail-timeline-paragraph">
                              {paragraphSentences.map((sentence, sIdx) => (
                                <span key={sIdx} className="customer-company-detail-timeline-sentence">{sentence}{sIdx < paragraphSentences.length - 1 ? ' ' : ''}</span>
                              ))}
                            </p>
                          ))}
                        </div>
                        <div className="customer-company-detail-timeline-footer">
                          <span className="customer-company-detail-timeline-logged">
                            등록: {(entry.createdByCurrentName !== undefined ? entry.createdByCurrentName : entry.createdByName) || '—'}
                            {(entry.createdByCurrentContact !== undefined ? entry.createdByCurrentContact : entry.createdByContact) ? ' · ' + (entry.createdByCurrentContact !== undefined ? entry.createdByCurrentContact : entry.createdByContact) : ''}
                            {entry.createdByChanged && <span className="customer-company-detail-timeline-changed"> 변경됨</span>}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
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
