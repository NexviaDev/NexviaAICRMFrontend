import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import AllEmployeesModal from './all-employees-modal/all-employees-modal';
import AllHistoryModal from './all-history-modal/all-history-modal';
import ProductSalesModal from '../../shared/product-sales-modal/product-sales-modal';
import OpportunityModal from '../../sales-pipeline/opportunity-modal/opportunity-modal';
import ContactDetailModal from '../../customer-company-employees/customer-company-employees-detail-modal/customer-company-employees-detail-modal';
import AddCompanyModal from '../add-company-modal/add-company-modal';
import CustomFieldsDisplay from '../../shared/custom-fields-display';
import './customer-company-detail-modal.css';

import { API_BASE } from '@/config';
import { getStoredCrmUser, isManagerOrAboveRole, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import { pingBackendHealth, BACKEND_KEEPALIVE_INTERVAL_MS, BACKEND_KEEPALIVE_INTERVAL_ENABLED } from '@/lib/backend-wake';
import { pollJournalFromAudioJob } from '@/lib/journal-from-audio-poll';
import { pruneDriveUploadedFilesIndex, syncDriveUploadedFilesIndex } from '@/lib/drive-uploaded-files-prune';
import { getGoogleMapsApiKey } from '@/lib/google-maps-client';
import {
  buildDriveFileDeleteUrl,
  getDriveFileIdFromUrl,
  isValidDriveNodeId,
  sanitizeDriveFolderWebViewLink
} from '@/lib/google-drive-url';
import {
  RegisterSaleDocsCrmTable,
  formatDriveFileDate,
  resolveCompanyDriveMongoRegisteredUrl,
  runDriveDirectFileUpload,
  sortDriveUploadedFiles
} from '@/shared/register-sale-docs-drive';
import {
  getSavedCustomerCompanyDetailModalPresentation,
  patchCustomerCompanyDetailModalTemplate
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

/**
 * embed iframe 대신 Static Maps 이미지 1장만 요청 — 모달 체감 속도 개선.
 * GCP에서 Maps Static API 사용 설정 필요(키는 JS API와 동일 VITE_GOOGLE_MAPS_API_KEY).
 */
function buildCompanyStaticMapPreviewUrl(company) {
  const key = getGoogleMapsApiKey();
  if (!key) return null;
  const lat = Number(company?.latitude);
  const lng = Number(company?.longitude);
  const addr = (company?.address && String(company.address).trim()) || '';
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const u = new URL('https://maps.googleapis.com/maps/api/staticmap');
    u.searchParams.set('center', `${lat},${lng}`);
    u.searchParams.set('zoom', '15');
    u.searchParams.set('size', '640x640');
    u.searchParams.set('scale', '2');
    u.searchParams.set('key', key);
    u.searchParams.set('language', 'ko');
    u.searchParams.set('markers', `color:0x0d9488|${lat},${lng}`);
    return u.toString();
  }
  if (addr) {
    const u = new URL('https://maps.googleapis.com/maps/api/staticmap');
    u.searchParams.set('center', addr);
    u.searchParams.set('zoom', '15');
    u.searchParams.set('size', '640x640');
    u.searchParams.set('scale', '2');
    u.searchParams.set('key', key);
    u.searchParams.set('language', 'ko');
    return u.toString();
  }
  return null;
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
  const [summaryRefreshLoading, setSummaryRefreshLoading] = useState(false);
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
  const [driveUploadNotice, setDriveUploadNotice] = useState('');
  /** CRM 리스트 영역 드롭 하이라이트 */
  const [crmListDropActive, setCrmListDropActive] = useState(false);
  const [crmDriveDeletingId, setCrmDriveDeletingId] = useState('');
  const [dragInModal, setDragInModal] = useState(false);
  /** ensure 응답 driveVisibility: 공유 드라이브면 팀원은 멤버십 필요 / 내 드라이브면 타 계정에 안 보일 수 있음 */
  const [driveVisibility, setDriveVisibility] = useState('unknown');
  const fileInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const modalContentRef = useRef(null);
  const [showRegisteredNamePopover, setShowRegisteredNamePopover] = useState(false);
  const [certificateImageError, setCertificateImageError] = useState(false);
  const companyNameButtonRef = useRef(null);
  const registeredNamePopoverRef = useRef(null);
  const [displayedCompany, setDisplayedCompany] = useState(company);
  /** listTemplates.customerCompanyDetailModal.presentation — 우측 패널(side) · 중앙(center) */
  const [detailPresentation, setDetailPresentation] = useState(() =>
    getSavedCustomerCompanyDetailModalPresentation()
  );
  const [detailPresentationSaving, setDetailPresentationSaving] = useState(false);
  /** 가운데 모달: 왼쪽 레일 탭 — 직원 / 제품판매 / Drive */
  const [centerMainTab, setCenterMainTab] = useState('employees');
  const companyToShow = displayedCompany || company || {};
  const companyId = companyToShow?._id || company?._id;
  const hasMapCoords = Number.isFinite(Number(companyToShow?.latitude)) && Number.isFinite(Number(companyToShow?.longitude));

  const mapEmbedSrc = useMemo(() => {
    if (hasMapCoords) {
      return `https://www.google.com/maps?q=${Number(companyToShow.latitude)},${Number(companyToShow.longitude)}&z=15&output=embed`;
    }
    if (companyToShow?.address) {
      return `https://www.google.com/maps?q=${encodeURIComponent(String(companyToShow.address))}&z=15&output=embed`;
    }
    return '';
  }, [hasMapCoords, companyToShow?.latitude, companyToShow?.longitude, companyToShow?.address]);

  const staticMapPreviewUrl = useMemo(
    () => buildCompanyStaticMapPreviewUrl(companyToShow),
    [companyToShow?.latitude, companyToShow?.longitude, companyToShow?.address]
  );

  const [staticMapLoadFailed, setStaticMapLoadFailed] = useState(false);
  useEffect(() => {
    setStaticMapLoadFailed(false);
  }, [companyId, staticMapPreviewUrl]);

  useEffect(() => {
    setDetailPresentation(getSavedCustomerCompanyDetailModalPresentation());
  }, [companyId]);

  useEffect(() => {
    setCenterMainTab('employees');
  }, [companyId]);

  const toggleDetailPresentation = useCallback(async () => {
    const next = detailPresentation === 'center' ? 'side' : 'center';
    setDetailPresentationSaving(true);
    try {
      await patchCustomerCompanyDetailModalTemplate({ presentation: next });
      setDetailPresentation(next);
    } catch (err) {
      window.alert(err?.message || '표시 방식 저장에 실패했습니다.');
    } finally {
      setDetailPresentationSaving(false);
    }
  }, [detailPresentation]);

  const useStaticPreview = Boolean(staticMapPreviewUrl) && !staticMapLoadFailed;

  const [mapEmbedSrcDeferred, setMapEmbedSrcDeferred] = useState(null);
  useEffect(() => {
    if (useStaticPreview || !mapEmbedSrc) {
      setMapEmbedSrcDeferred(null);
      return undefined;
    }
    const id = window.setTimeout(() => setMapEmbedSrcDeferred(mapEmbedSrc), 320);
    return () => window.clearTimeout(id);
  }, [useStaticPreview, mapEmbedSrc, companyId]);

  const openCompanyOnMap = useCallback(() => {
    if (!companyId) return;
    const q = new URLSearchParams();
    q.set('focusCompanyId', String(companyId));
    q.set('zoom', '18');
    const nm = (companyToShow?.name && String(companyToShow.name).trim()) || '';
    if (nm) q.set('focusName', nm);
    const path = `/map?${q.toString()}`;
    /**
     * 지도 페이지는 `openCompanyModal=1`이면 포커스 직후 상세 모달을 다시 띄움 — 이미 상세에서 온 경우 지도만 가리게 됨.
     * 고객사 목록 URL 정리(onClose)와 navigate가 한 틱에서 겹치면 이동이 묻히는 경우가 있어 navigate는 microtask로 분리.
     */
    onClose?.();
    queueMicrotask(() => {
      navigate(path);
    });
  }, [companyId, companyToShow?.name, navigate, onClose]);

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

  /** 음성 전사 등 장시간 요청 중 Railway 슬립 방지 — VITE_BACKEND_KEEPALIVE_INTERVAL_MS=0 이면 주기 핑 생략 */
  useEffect(() => {
    if (!audioUploading || !BACKEND_KEEPALIVE_INTERVAL_ENABLED) return;
    const id = setInterval(() => {
      pingBackendHealth(getAuthHeader);
    }, BACKEND_KEEPALIVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [audioUploading]);

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

  const crmDriveUploadsSorted = useMemo(
    () => sortDriveUploadedFiles(companyToShow?.driveUploadedFiles),
    [companyToShow?.driveUploadedFiles]
  );

  const driveMongoRegisteredUrl = useMemo(
    () => resolveCompanyDriveMongoRegisteredUrl(companyToShow, driveFolderId, driveFolderLink),
    [
      companyToShow?.driveCustomerRootFolderId,
      companyToShow?.driveCustomerRootFolderWebViewLink,
      driveFolderId,
      driveFolderLink
    ]
  );

  const driveFolderSavedInMongo = Boolean(
    companyToShow?.driveCustomerRootFolderId &&
      isValidDriveNodeId(String(companyToShow.driveCustomerRootFolderId).trim())
  );

  /** 상세 GET 등으로 MongoDB에 drive 필드가 들어온 뒤 루트 폴더 상태 동기화(다른 계정도 동일 링크 표시) */
  useEffect(() => {
    const id = companyToShow?.driveCustomerRootFolderId;
    const linkRaw = companyToShow?.driveCustomerRootFolderWebViewLink;
    if (!id || !isValidDriveNodeId(String(id))) return;
    const sanitized = sanitizeDriveFolderWebViewLink(linkRaw, id);
    if (!sanitized) return;
    setDriveFolderId(id);
    setDriveFolderLink(sanitized);
  }, [companyId, companyToShow?.driveCustomerRootFolderId, companyToShow?.driveCustomerRootFolderWebViewLink]);

  /** React Strict Mode 이중 useEffect로 ensure가 두 번 호출되어 Drive에 동일 폴더가 2개 생기는 것 방지 */
  const driveRootEnsureInFlightRef = useRef(false);

  const ensureCompanyDriveRootFolder = useCallback(async () => {
    if (!driveFolderName) return null;
    const r = await fetch(`${API_BASE}/drive/folders/ensure`, {
      method: 'POST',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        folderName: driveFolderName,
        ...(companyId ? { customerCompanyId: String(companyId) } : {})
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.id) {
      throw new Error(data.error || '폴더를 준비할 수 없습니다.');
    }
    if (!isValidDriveNodeId(String(data.id))) {
      throw new Error('Drive 폴더 ID 형식이 올바르지 않습니다. 관리자에게 문의해 주세요.');
    }
    const folderLink = sanitizeDriveFolderWebViewLink(data.webViewLink, data.id);
    if (!folderLink) {
      throw new Error('Drive 폴더 링크를 만들 수 없습니다.');
    }
    setDriveFolderId(data.id);
    setDriveFolderLink(folderLink);
    setDriveVisibility(
      data.driveVisibility === 'sharedDrive' || data.driveVisibility === 'myDrive' ? data.driveVisibility : 'unknown'
    );
    setDisplayedCompany((prev) => ({
      ...(prev || {}),
      driveCustomerRootFolderId: data.id,
      driveCustomerRootFolderWebViewLink: folderLink
    }));
    return { id: data.id, webViewLink: folderLink };
  }, [driveFolderName, companyId]);

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
    setDriveUploadNotice('');
    setDriveVisibility('unknown');
  }, [companyId]);

  /**
   * 부모(목록)의 company 객체는 driveUploadedFiles·Drive 루트 필드가 최신이 아닐 수 있음.
   * 동일 고객사로 merge 시 이 필드들을 prop으로 덮어쓰면 prune/GET 직후 목록이 다시 옛 데이터로 돌아감.
   */
  useEffect(() => {
    setDisplayedCompany((prev) => {
      const incoming = company || {};
      const prevId = String(prev?._id ?? '');
      const nextId = String(incoming._id ?? '');
      if (nextId && nextId !== prevId) {
        return { ...incoming };
      }
      const {
        driveUploadedFiles: _driveFiles,
        driveCustomerRootFolderId: _rootId,
        driveCustomerRootFolderWebViewLink: _rootLink,
        ...rest
      } = incoming;
      return { ...(prev || {}), ...rest };
    });
  }, [company]);

  /**
   * Drive 루트 폴더 ensure 후에만 sync/prune 실행 — ensure 전에 sync가 돌면 Mongo의 folderId와 불일치해 추가가 0건으로 끝날 수 있음.
   * ensure 성공 시 반환 id로 동기화하고, 실패 시에만 GET으로 읽은 driveCustomerRootFolderId 로 재시도.
   */
  useEffect(() => {
    if (!companyId || !driveFolderName) return undefined;
    if (driveRootEnsureInFlightRef.current) return undefined;
    driveRootEnsureInFlightRef.current = true;
    let cancelled = false;
    const refreshCompanyDriveFields = async () => {
      try {
        const res = await fetch(`${API_BASE}/customer-companies/${companyId}`, { headers: getAuthHeader() });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && data?._id) {
          setDisplayedCompany((prev) => ({ ...(prev || {}), ...data }));
        }
      } catch (_) {}
    };
    const runIndexSyncForFolder = async (folderIdRaw) => {
      const fid = folderIdRaw != null && String(folderIdRaw).trim() ? String(folderIdRaw).trim() : '';
      if (!fid || !isValidDriveNodeId(fid)) return;
      const syncRes = await syncDriveUploadedFilesIndex({
        getAuthHeader,
        folderId: fid,
        customerCompanyId: String(companyId)
      });
      if (syncRes.error) setDriveError((prev) => prev || syncRes.error);
      if (cancelled) return;
      const pruneRes = await pruneDriveUploadedFilesIndex({
        getAuthHeader,
        folderId: fid,
        customerCompanyId: String(companyId)
      });
      if (pruneRes.error) setDriveError((prev) => prev || pruneRes.error);
      if (!cancelled) await refreshCompanyDriveFields();
    };
    (async () => {
      try {
        const out = await ensureCompanyDriveRootFolder();
        if (cancelled) return;
        if (out?.id && isValidDriveNodeId(String(out.id).trim())) {
          await runIndexSyncForFolder(out.id);
        }
      } catch (err) {
        setDriveError((prev) => prev || (err?.message || 'Drive 고객사 폴더를 준비할 수 없습니다.'));
        if (!cancelled) {
          try {
            const res = await fetch(`${API_BASE}/customer-companies/${companyId}`, { headers: getAuthHeader() });
            const data = await res.json().catch(() => ({}));
            const stored = data?.driveCustomerRootFolderId && String(data.driveCustomerRootFolderId).trim();
            if (res.ok && stored && isValidDriveNodeId(stored)) {
              await runIndexSyncForFolder(stored);
            }
          } catch (_) {}
        }
      } finally {
        driveRootEnsureInFlightRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, driveFolderName, ensureCompanyDriveRootFolder]);

  const handleDirectFileUpload = useCallback(
    async (files) => {
      await runDriveDirectFileUpload({
        files,
        driveFolderId,
        driveFolderLink,
        ensureParentFolder: ensureCompanyDriveRootFolder,
        buildUploadBody: (file, contentBase64, parentId) => ({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          contentBase64,
          parentFolderId: parentId,
          ...(companyId ? { customerCompanyId: String(companyId) } : {})
        }),
        getAuthHeader,
        setDriveUploading,
        setDriveError,
        setDriveUploadNotice,
        onSuccess: async () => {
          if (!companyId) return;
          try {
            const res = await fetch(`${API_BASE}/customer-companies/${companyId}`, { headers: getAuthHeader() });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data?._id) setDisplayedCompany((prev) => ({ ...(prev || {}), ...data }));
          } catch (_) {}
        }
      });
    },
    [companyId, driveFolderId, driveFolderLink, ensureCompanyDriveRootFolder]
  );

  const handleDeleteCrmDriveFile = useCallback(
    async (row) => {
      const fid = row?.driveFileId && String(row.driveFileId).trim();
      if (!fid || !companyId || !isValidDriveNodeId(fid)) return;
      if (!window.confirm(`「${row.name || '파일'}」을 Drive 휴지통으로 옮기고 목록에서 제거할까요?`)) return;
      setCrmDriveDeletingId(fid);
      setDriveError('');
      try {
        await pingBackendHealth(getAuthHeader);
        const url = buildDriveFileDeleteUrl(fid, { customerCompanyId: String(companyId) });
        const res = await fetch(url, { method: 'DELETE', headers: getAuthHeader(), credentials: 'include' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setDriveError(data.error || '삭제에 실패했습니다.');
          return;
        }
        const certUrl = (displayedCompany || company)?.businessRegistrationCertificateDriveUrl;
        const certFid = certUrl ? getDriveFileIdFromUrl(String(certUrl).trim()) : null;
        if (certFid && certFid === fid) {
          const patchRes = await fetch(`${API_BASE}/customer-companies/${companyId}`, {
            method: 'PATCH',
            headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ businessRegistrationCertificateDriveUrl: null })
          });
          const patched = await patchRes.json().catch(() => ({}));
          if (patchRes.ok && patched?._id) {
            setDisplayedCompany((prev) => ({ ...(prev || {}), ...patched }));
          }
        }
        const r2 = await fetch(`${API_BASE}/customer-companies/${companyId}`, { headers: getAuthHeader() });
        const data2 = await r2.json().catch(() => ({}));
        if (r2.ok && data2?._id) setDisplayedCompany((prev) => ({ ...(prev || {}), ...data2 }));
        setDriveUploadNotice('파일을 삭제했습니다.');
        window.setTimeout(() => setDriveUploadNotice(''), 5000);
      } catch (_) {
        setDriveError('삭제 중 오류가 났습니다.');
      } finally {
        setCrmDriveDeletingId('');
      }
    },
    [companyId, company, displayedCompany]
  );

  /** 고객사 상세 — 직원 미리보기: 등록일 최신순 최대 5명 */
  const employeesPreviewRecent = useMemo(() => {
    const list = Array.isArray(employees) ? [...employees] : [];
    const regTime = (e) => {
      const d = e?.createdAt;
      if (!d) return 0;
      const n = new Date(d).getTime();
      return Number.isFinite(n) ? n : 0;
    };
    list.sort((a, b) => regTime(b) - regTime(a));
    return list.slice(0, 5);
  }, [employees]);

  if (!company) return null;

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
      if (showDeleteConfirm) setShowDeleteConfirm(false);
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
  }, [onClose, showDeleteConfirm, contactForDetailModal, showEditModal, showAllHistoryModal, showAllEmployeesModal, showProductSalesModal, showRegisterSaleModal]);

  const handleDeleteHistory = async (historyId) => {
    if (!historyId) return;
    if (!isAdminOrAboveRole(getStoredCrmUser()?.role)) {
      window.alert('업무 기록 삭제는 대표(Owner) 또는 관리자(Admin)만 가능합니다.');
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
      text:
        '음성 파일을 올렸습니다. 전사·요약은 서버에서 진행하며, 진행 중에도 연결이 끊기지 않도록 짧게 상태를 확인합니다.'
    });
    await pingBackendHealth(getAuthHeader);
    setAudioUploading(true);
    try {
      const form = new FormData();
      form.append('audio', file);
      const res = await fetch(`${API_BASE}/customer-companies/${companyId}/history/from-audio`, {
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
        const pollUrl = `${API_BASE}/customer-companies/${companyId}/history/from-audio/jobs/${encodeURIComponent(data.jobId)}`;
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

  const requestWorkSummaryGemini = useCallback(async () => {
    if (!companyId || summaryRefreshLoading) return;
    if (!historyItems.length) {
      setSummaryNotice({ type: 'muted', text: '요약할 업무 기록을 먼저 등록해 주세요.' });
      return;
    }
    setSummaryNotice(null);
    setSummaryRefreshLoading(true);
    try {
      await pingBackendHealth(getAuthHeader);
      const res = await fetch(`${API_BASE}/customer-companies/${companyId}/work-summary/refresh`, {
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
        await fetchCompanyDetail();
        return;
      }
      setDisplayedCompany((prev) => ({
        ...(prev || {}),
        summaryStatus: 'queued',
        summaryError: '',
        summaryQueuedForHistoryAt: data.summaryQueuedForHistoryAt || new Date().toISOString()
      }));
      setSummaryNotice({
        type: 'info',
        text: '최신 고객사 업무 기록을 기준으로 Gemini 요약을 요청했습니다. 모달을 닫아도 서버에서 계속 처리됩니다.'
      });
      await fetchCompanyDetail();
    } catch (_) {
      setSummaryNotice({ type: 'muted', text: '서버에 연결할 수 없습니다.' });
    } finally {
      setSummaryRefreshLoading(false);
    }
  }, [companyId, fetchCompanyDetail, historyItems.length, summaryRefreshLoading]);

  const handleDeleteCompany = async () => {
    if (!companyId) return;
    if (!isAdminOrAboveRole(getStoredCrmUser()?.role)) {
      window.alert('삭제는 대표(Owner) 또는 관리자(Admin)만 가능합니다.');
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

  const canMutate = isManagerOrAboveRole(getStoredCrmUser()?.role);
  const canDeleteCompany = isAdminOrAboveRole(getStoredCrmUser()?.role);

  function renderJournalAside(extraAsideClass) {
    return (
      <aside
        className={`ccd-center-journal${extraAsideClass ? ` ${extraAsideClass}` : ''}`}
        aria-label="지원 및 업무 기록"
      >
        <section className="customer-company-detail-section customer-company-detail-section--journal-rail">
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
              <div className="customer-company-detail-summary-title-row">
                <div className="customer-company-detail-summary-title-with-refresh">
                  <strong>최근 전체 업무 요약</strong>
                  <button
                    type="button"
                    className={`customer-company-detail-summary-refresh-btn${summaryRefreshLoading ? ' is-loading' : ''}`}
                    onClick={requestWorkSummaryGemini}
                    disabled={
                      summaryRefreshLoading
                      || !historyItems.length
                      || companyToShow?.summaryStatus === 'queued'
                      || companyToShow?.summaryStatus === 'processing'
                    }
                    aria-busy={summaryRefreshLoading}
                    aria-label={summaryRefreshLoading ? '요약 최신화 요청 중' : '업무 요약 최신화 (Gemini)'}
                    title={summaryRefreshLoading ? '요청 중…' : '업무 요약 최신화 (Gemini)'}
                  >
                    <span
                      className={`material-symbols-outlined customer-company-detail-summary-refresh-btn-icon${
                        summaryRefreshLoading ? ' customer-company-detail-summary-refresh-btn-icon--spin' : ''
                      }`}
                      aria-hidden
                    >
                      {summaryRefreshLoading ? 'progress_activity' : 'sync'}
                    </span>
                  </button>
                </div>
                <span className={`customer-company-detail-summary-status is-${companyToShow?.summaryStatus || 'idle'}`}>
                  {summaryStatusText[companyToShow?.summaryStatus || 'idle'] || '요약 대기'}
                </span>
              </div>
            </div>
            <p className="customer-company-detail-summary-text">
              {companyToShow?.summary?.trim()
                ? companyToShow.summary
                : (companyToShow?.summaryStatus === 'queued' || companyToShow?.summaryStatus === 'processing'
                  ? '최신 고객사 업무 기록을 기준으로 Gemini가 요약을 만드는 중입니다. 모달을 닫아도 나중에 다시 확인할 수 있습니다.'
                  : '아직 저장된 고객사 업무 요약이 없습니다. 업무 기록을 쌓은 뒤 위 최신화 아이콘으로 필요할 때만 요약을 요청해 주세요.')}
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
                  ? '음성 처리 중… 전사·요약이 끝나면 AssemblyAI에 올린 음성 원본은 서버에서 자동 삭제됩니다.'
                  : '음성 파일 드래그앤드롭 또는 선택 (MP3/WAV/M4A/WebM). 처리가 끝나면 AssemblyAI 쪽 음성·전사 원본은 삭제됩니다.'}
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
                          title="업무 기록 삭제 (Owner / Admin)"
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
      </aside>
    );
  }

  return (
    <div
      className={`customer-company-detail-root customer-company-detail-root--${detailPresentation}`}
    >
      <div className="customer-company-detail-overlay" aria-hidden="true" />
      <div
        ref={modalContentRef}
        className="customer-company-detail-panel"
        onDragEnter={(e) => { e.preventDefault(); setDragInModal(true); }}
        onDragLeave={(e) => { if (!modalContentRef.current?.contains(e.relatedTarget)) setDragInModal(false); }}
      >
        <div
          className={`customer-company-detail-inner${detailPresentation === 'center' ? ' customer-company-detail-inner--center' : ''}`}
        >
          <header className="customer-company-detail-header">
            <div className="customer-company-detail-header-title">
              <span className="material-symbols-outlined">business</span>
              <h2>기업 세부정보</h2>
            </div>
            <div className="customer-company-detail-header-actions">
              <button
                type="button"
                className={`customer-company-detail-icon-btn customer-company-detail-layout-toggle${detailPresentation === 'center' ? ' is-layout-center' : ''}`}
                onClick={toggleDetailPresentation}
                disabled={detailPresentationSaving}
                title={
                  detailPresentation === 'side'
                    ? '가운데 모달로 전환 (내 설정에 저장)'
                    : '우측 패널로 전환 (내 설정에 저장)'
                }
                aria-label={
                  detailPresentation === 'side'
                    ? '고객사 상세를 화면 가운데 모달로 표시'
                    : '고객사 상세를 우측에서 슬라이드 패널로 표시'
                }
                aria-pressed={detailPresentation === 'center'}
              >
                <span
                  className={`material-symbols-outlined${detailPresentationSaving ? ' customer-company-detail-layout-toggle-spin' : ''}`}
                  aria-hidden
                >
                  {detailPresentationSaving
                    ? 'progress_activity'
                    : detailPresentation === 'side'
                      ? 'filter_center_focus'
                      : 'dock_to_right'}
                </span>
              </button>
              {canMutate ? (
                <button type="button" className="customer-company-detail-icon-btn" onClick={() => setShowEditModal(true)} title="수정 (Manager 이상)">
                  <span className="material-symbols-outlined">edit</span>
                </button>
              ) : null}
              {canDeleteCompany ? (
                <button type="button" className="customer-company-detail-icon-btn customer-company-detail-delete-btn" onClick={() => setShowDeleteConfirm(true)} title="삭제 (Admin 이상)">
                  <span className="material-symbols-outlined">delete</span>
                </button>
              ) : null}
              <button type="button" className="customer-company-detail-icon-btn" onClick={onClose} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          </header>

          {showDeleteConfirm && canDeleteCompany && (
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

          <div
            className={`customer-company-detail-body${detailPresentation === 'center' ? ' customer-company-detail-body--center' : ''}`}
          >
            <div className={`ccd-top-pair${detailPresentation === 'center' ? ' ccd-top-pair--split' : ''}`}>
              <div className="ccd-top-pair-left">
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
                    {mapEmbedSrc || staticMapPreviewUrl ? (
                      useStaticPreview ? (
                        <img
                          src={staticMapPreviewUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          draggable={false}
                          onError={() => setStaticMapLoadFailed(true)}
                          className="customer-company-detail-card-map-static"
                        />
                      ) : mapEmbedSrcDeferred ? (
                        <iframe
                          title={`${companyToShow.name || '업체'} 위치 미리보기`}
                          src={mapEmbedSrcDeferred}
                          loading="lazy"
                          referrerPolicy="no-referrer-when-downgrade"
                          className="customer-company-detail-card-map-iframe"
                        />
                      ) : (
                        <div className="customer-company-detail-card-map-loading">
                          <span className="material-symbols-outlined" aria-hidden>map</span>
                          <span>지도 불러오는 중…</span>
                        </div>
                      )
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
                  {companyToShow.industry && (
                    <div className="customer-company-detail-meta-item">
                      <span className="material-symbols-outlined">domain</span>
                      <span>업종: {companyToShow.industry}</span>
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
              </div>
            </div>

            {detailPresentation === 'center' && renderJournalAside('ccd-center-journal--top-row')}

            <CustomFieldsDisplay
              definitions={customDefinitions}
              values={companyToShow.customFields || {}}
              className="customer-company-detail-custom-fields"
            />

            <div className="ccd-main-grid">
              <nav className="ccd-center-rail" aria-label="본문 구역">
                <button
                  type="button"
                  className={`ccd-center-rail-btn${centerMainTab === 'employees' ? ' is-active' : ''}`}
                  onClick={() => setCenterMainTab('employees')}
                  aria-pressed={detailPresentation === 'center' && centerMainTab === 'employees'}
                  title="직원 리스트"
                >
                  <span className="material-symbols-outlined">groups</span>
                </button>
                <button
                  type="button"
                  className={`ccd-center-rail-btn${centerMainTab === 'products' ? ' is-active' : ''}`}
                  onClick={() => setCenterMainTab('products')}
                  aria-pressed={detailPresentation === 'center' && centerMainTab === 'products'}
                  title="제품 판매 현황"
                >
                  <span className="material-symbols-outlined">inventory_2</span>
                </button>
                <button
                  type="button"
                  className={`ccd-center-rail-btn${centerMainTab === 'drive' ? ' is-active' : ''}`}
                  onClick={() => setCenterMainTab('drive')}
                  aria-pressed={detailPresentation === 'center' && centerMainTab === 'drive'}
                  title="증서 · 자료 (Google Drive)"
                >
                  <span className="material-symbols-outlined">folder_open</span>
                </button>
              </nav>

              <div className="ccd-middle-column">
            <div
              className={`ccd-tab-panel${detailPresentation === 'center' && centerMainTab === 'employees' ? ' is-active' : ''}`}
              data-ccd-tab="employees"
              role="tabpanel"
              id="ccd-tabpanel-employees"
              aria-hidden={detailPresentation === 'center' && centerMainTab !== 'employees'}
            >
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
              {loadingEmployees ? (
                <p className="customer-company-detail-employees-empty">불러오는 중...</p>
              ) : employeesPreviewRecent.length === 0 ? (
                <p className="customer-company-detail-employees-empty">등록된 직원이 없습니다.</p>
              ) : (
                <div className="customer-company-detail-employee-preview">
                  <ul className="customer-company-detail-employees-list">
                    {employeesPreviewRecent.map((emp) => (
                      <li key={String(emp._id || emp.id || '')} className="customer-company-detail-employee-item">
                        <div className="customer-company-detail-employee-name">{emp.name || '—'}</div>
                        <div className="customer-company-detail-employee-meta">
                          {emp.phone && (
                            <span className="customer-company-detail-employee-meta-item">
                              <span className="material-symbols-outlined">phone</span>
                              {emp.phone}
                            </span>
                          )}
                          {emp.email && (
                            <span className="customer-company-detail-employee-meta-item">
                              <span className="material-symbols-outlined">mail</span>
                              {emp.email}
                            </span>
                          )}
                          {!emp.phone && !emp.email && (
                            <span className="customer-company-detail-employee-meta-item">연락처 없음</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
            </div>

            <div
              className={`ccd-tab-panel${detailPresentation === 'center' && centerMainTab === 'products' ? ' is-active' : ''}`}
              data-ccd-tab="products"
              role="tabpanel"
              id="ccd-tabpanel-products"
              aria-hidden={detailPresentation === 'center' && centerMainTab !== 'products'}
            >
            <section className="customer-company-detail-section">
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
                    <span className="material-symbols-outlined">add</span> 세일즈 추가
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
                <p className="customer-company-detail-employees-empty">제품판매 이력이 없습니다.</p>
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
            </div>

            <div
              className={`ccd-tab-panel${detailPresentation === 'center' && centerMainTab === 'drive' ? ' is-active' : ''}`}
              data-ccd-tab="drive"
              role="tabpanel"
              id="ccd-tabpanel-drive"
              aria-hidden={detailPresentation === 'center' && centerMainTab !== 'drive'}
            >
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
                  if (!driveUploading && e.dataTransfer?.files?.length) {
                    const arr = Array.from(e.dataTransfer.files);
                    const picked = arr.length > 1 ? [arr[arr.length - 1]] : arr;
                    handleDirectFileUpload(picked);
                  }
                }}
              >
                <h4 className="register-sale-docs-crm-uploads-title">
                  <span className="material-symbols-outlined"></span>
                  리스트
                </h4>
                <p className="register-sale-docs-crm-uploads-hint">
                  루트 폴더에 올려 CRM에 기록된 파일만 표시됩니다. 사업자등록증은 상단 회사명 옆에서 확인할 수 있습니다. 여러 파일을 한 번에 놓으면 가장 마지막 파일만 업로드됩니다. Drive 웹에서만 넣은 파일은 동기화에 안 잡힐 수 있으니, 가능하면 이 화면에서 업로드해 주세요.
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
            </div>
              </div>

            {detailPresentation === 'side' && renderJournalAside('ccd-center-journal--side-below')}
            </div>
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
              <OpportunityModal
                mode="create"
                defaultStage="Won"
                initialCustomerCompany={{ _id: companyId, name: companyToShow.name, businessNumber: companyToShow.businessNumber }}
                onClose={() => setShowRegisterSaleModal(false)}
                onSaved={() => { setShowRegisterSaleModal(false); fetchProductSales(); }}
              />
            )}
            {selectedSaleForEdit && (
              <OpportunityModal
                mode="edit"
                oppId={selectedSaleForEdit._id}
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
          </div>
        </div>
      </div>
    </div>
  );
}
