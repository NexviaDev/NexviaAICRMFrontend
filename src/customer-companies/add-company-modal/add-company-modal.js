import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import CustomFieldsSection from '../../shared/custom-fields-section';
import CustomFieldsManageModal from '../../shared/custom-fields-manage-modal/custom-fields-manage-modal';
import AssigneePickerModal from '../../company-overview/assignee-picker-modal/assignee-picker-modal';
import DriveLargeFileWarningModal from '../../shared/drive-large-file-warning-modal/drive-large-file-warning-modal';
import CompanyImportPreviewModal from './company-import-preview-modal';
import './add-company-modal.css';

import { API_BASE } from '@/config';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import {
  getGoogleMapsApiKey,
  loadGoogleMaps,
  loadGoogleMapsPromise,
  geocodeAddressWithGoogleMaps
} from '@/lib/google-maps-client';

const GOOGLE_MAPS_API_KEY = getGoogleMapsApiKey();
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 };
const DEFAULT_ZOOM = 14;
function getPickerMarkerIcon(google) {
  if (!google?.maps?.SymbolPath) return undefined;
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 12,
    fillColor: '#ccff00',
    fillOpacity: 1,
    strokeColor: '#333',
    strokeWeight: 2
  };
}

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 저장 시 주소만 있고 위·경도가 비었을 때 사용. 서버 geocode → 실패 시 클라이언트 Maps Geocoder.
 * @returns {Promise<{ latitude: number, longitude: number } | null>}
 */
async function geocodeAddressForCompanySave(addressText) {
  const address = (addressText || '').trim();
  if (!address) return null;
  try {
    const geoRes = await fetch(`${API_BASE}/customer-companies/geocode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ address })
    });
    const geoData = await geoRes.json().catch(() => ({}));
    if (geoRes.ok && geoData.latitude != null && geoData.longitude != null) {
      const latitude = Number(geoData.latitude);
      const longitude = Number(geoData.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return { latitude, longitude };
      }
    }
  } catch (_) {}
  if (!GOOGLE_MAPS_API_KEY) return null;
  const google = await loadGoogleMapsPromise();
  if (!google?.maps?.Geocoder) return null;
  const coords = await geocodeAddressWithGoogleMaps(google, address);
  if (coords?.latitude != null && coords?.longitude != null) return coords;
  return null;
}

/** 사업자번호: 숫자만 허용, 10자리까지 입력 시 123-45-67890 형식으로 자동 구분 */
function formatBusinessNumberInput(value) {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 10)}`;
}

const STATUS_OPTIONS = [
  { value: 'active', label: '활성' },
  { value: 'inactive', label: '비활성' },
  { value: 'lead', label: '리드' }
];

function sanitizeFolderNamePart(s) {
  return String(s ?? '')
    .replace(/[/\\*?:<>"|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
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

const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

function getDriveFolderIdFromLink(url) {
  if (!url || typeof url !== 'string') return null;
  const s = url.trim();
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

/** Drive 파일 URL에서 파일 ID 추출 (기존 사업자등록증 삭제 시 사용) */
function getDriveFileIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.trim().match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function isTxtFile(file) {
  const n = String(file?.name || '').toLowerCase();
  return String(file?.type || '').toLowerCase() === 'text/plain' || n.endsWith('.txt');
}

function isCertificateLikeFile(file) {
  const mime = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  return (
    mime.startsWith('image/')
    || mime === 'application/pdf'
    || name.endsWith('.pdf')
    || isTxtFile(file)
  );
}

/** 2개 이상 파일이면 배치 미리보기 (TXT 1개는 단건 PDF와 동일하게 폼 기입) */
function shouldUseCompanyBatchPreview(fileList) {
  const arr = Array.from(fileList || []);
  return arr.length >= 2;
}

/** Drive 저장 시 파일명: 사업자등록증_고객사명_사업자번호.확장자 */
function buildCertificateDriveFileName(companyName, businessNumberRaw, mimeType, originalFileName) {
  const namePart = sanitizeFolderNamePart(companyName || '미소속').replace(/\s+/g, '_').slice(0, 60) || '미소속';
  const bnPart = String(businessNumberRaw || '').replace(/\D/g, '').slice(0, 12) || '미등록';
  const m = (mimeType || '').toLowerCase();
  let ext = 'pdf';
  if (m.includes('pdf')) ext = 'pdf';
  else if (m.includes('jpeg') || m.includes('jpg')) ext = 'jpg';
  else if (m.includes('png')) ext = 'png';
  else if (m.includes('webp')) ext = 'webp';
  else {
    const fn = originalFileName || '';
    const i = fn.lastIndexOf('.');
    if (i >= 0) ext = fn.slice(i + 1).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'jpg';
  }
  const base = `사업자등록증_${namePart}_${bnPart}.${ext}`;
  return base.length > 200 ? `${base.slice(0, 196 - ext.length)}.${ext}` : base;
}

const INFORMATION_FOLDER_NAME = 'information';
const MAX_DRIVE_API_UPLOAD_SIZE = 5 * 1024 * 1024;

export default function AddCompanyModal({ company, onClose, onSaved, onUpdated }) {
  const isEdit = Boolean(company);
  const canManageCustomFieldDefinitions = isAdminOrAboveRole(getStoredCrmUser()?.role);
  const [form, setForm] = useState({
    name: '',
    representativeName: '',
    industry: '',
    businessNumber: '',
    address: '',
    latitude: null,
    longitude: null,
    memo: '',
    status: 'active',
    customFields: {},
    assigneeUserIds: (() => { const id = (() => { try { const u = JSON.parse(localStorage.getItem('crm_user') || '{}'); return u?._id ? String(u._id) : null; } catch (_) { return null; } })(); return id ? [id] : []; })()
  });
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [companyEmployeesForDisplay, setCompanyEmployeesForDisplay] = useState([]); // 담당자 input 표시용 이름 매핑
  const [assigneeDisplayText, setAssigneeDisplayText] = useState(undefined); // 수기 수정 가능 (undefined면 선택된 ID 기준 표시)
  const [customDefinitions, setCustomDefinitions] = useState([]);
  const [showCustomFieldsModal, setShowCustomFieldsModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [pickerSearchQuery, setPickerSearchQuery] = useState('');
  const [pickerSearching, setPickerSearching] = useState(false);
  const [pickerLat, setPickerLat] = useState(null);
  const [pickerLng, setPickerLng] = useState(null);
  const [pickerMapReady, setPickerMapReady] = useState(false);
  const [addressGeocoding, setAddressGeocoding] = useState(false);
  const [certificateFile, setCertificateFile] = useState(null);
  const [certificateDropActive, setCertificateDropActive] = useState(false);
  const [extractingCertificate, setExtractingCertificate] = useState(false);
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [importPreviewItems, setImportPreviewItems] = useState([]);
  const [importPreviewLoading, setImportPreviewLoading] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);

  const [driveFolderLink, setDriveFolderLink] = useState('');
  const [driveFolderId, setDriveFolderId] = useState(null);
  const [driveInformationFolderId, setDriveInformationFolderId] = useState(null);
  const [driveUploading, setDriveUploading] = useState(false);
  const [driveError, setDriveError] = useState('');
  const [largeFileWarning, setLargeFileWarning] = useState({ open: false, files: [], folderUrl: '' });
  const [driveCurrentFolderId, setDriveCurrentFolderId] = useState(null);
  const [driveBreadcrumb, setDriveBreadcrumb] = useState([]);
  const [driveFilesList, setDriveFilesList] = useState([]);
  const [loadingDriveFiles, setLoadingDriveFiles] = useState(false);
  const [docsDropActive, setDocsDropActive] = useState(false);
  const mapPickerContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const pickerMarkerRef = useRef(null);
  const certificateInputRef = useRef(null);
  const driveFileInputRef = useRef(null);
  /** 루트 폴더 ensure — 저장된 ID를 보지 않고 이름 기준으로 재조회/생성 */
  const driveRootEnsureInFlightRef = useRef(false);
  /** information 하위 폴더 ensure — Strict Mode 중복 호출 방지 */
  const driveInformationEnsureInFlightRef = useRef(false);
  const submittingRef = useRef(false);

  const fetchCustomDefinitions = async () => {
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=customerCompany`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) setCustomDefinitions(data.items);
    } catch (_) {}
  };

  useEffect(() => {
    fetchCustomDefinitions();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/companies/overview`, { headers: getAuthHeader() })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.employees)) setCompanyEmployeesForDisplay(data.employees);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!company) return;
    const fromCompany = Array.isArray(company.assigneeUserIds) ? company.assigneeUserIds.map((id) => String(id)) : [];
    setForm((prev) => ({
      ...prev,
      name: company.name ?? '',
      representativeName: company.representativeName ?? '',
      industry: company.industry ?? '',
      businessNumber: company.businessNumber != null ? formatBusinessNumberInput(String(company.businessNumber)) : '',
      address: company.address ?? '',
      latitude: company.latitude ?? null,
      longitude: company.longitude ?? null,
      memo: company.memo ?? '',
      status: (company.status || 'active').toLowerCase(),
      customFields: company.customFields ? { ...company.customFields } : {},
      assigneeUserIds: fromCompany
    }));
    setCertificateFile(null);
    setAssigneeDisplayText(undefined);
  }, [company]);

  const assigneeIdToName = useMemo(() => {
    const map = {};
    (companyEmployeesForDisplay || []).forEach((e) => {
      const id = e.id != null ? String(e.id) : null;
      if (id) map[id] = e.name || e.email || id;
    });
    return map;
  }, [companyEmployeesForDisplay]);

  const assigneeInputValue = assigneeDisplayText !== undefined && assigneeDisplayText !== null
    ? assigneeDisplayText
    : (form.assigneeUserIds || []).map((id) => assigneeIdToName[String(id)] || id).join(', ');

  const driveFolderName = useMemo(() => {
    /**
     * 수정 모드 첫 렌더에서는 form 기본값이 비어 있어 '미소속_미등록'이 먼저 계산될 수 있음.
     * 이때 드래그앤드롭을 바로 하면 잘못된 폴더가 생기므로, 초기값은 company 데이터를 우선 사용.
     */
    const sourceName = (form.name || '').trim() || (isEdit ? String(company?.name || '').trim() : '');
    const sourceBusinessNumber =
      (form.businessNumber || '').trim() || (isEdit ? String(company?.businessNumber || '').trim() : '');
    const namePart = sanitizeFolderNamePart(sourceName || '미소속');
    const numPart = sanitizeFolderNamePart(sourceBusinessNumber.replace(/\D/g, '')) || '미등록';
    return `${namePart}_${numPart}`;
  }, [form.name, form.businessNumber, isEdit, company?.name, company?.businessNumber]);

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

  const ensureCompanyDriveInformationFolder = useCallback(async () => {
    const ensuredRoot = await ensureCompanyDriveRootFolder();
    const rootId = ensuredRoot?.id || null;
    if (!rootId) throw new Error('폴더를 준비할 수 없습니다.');
    const r = await fetch(`${API_BASE}/drive/folders/ensure`, {
      method: 'POST',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ folderName: INFORMATION_FOLDER_NAME, parentFolderId: rootId })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.id) {
      throw new Error(data.error || 'information 폴더를 준비할 수 없습니다.');
    }
    setDriveInformationFolderId(data.id);
    return {
      rootId,
      rootLink: ensuredRoot.webViewLink || `https://drive.google.com/drive/folders/${rootId}`,
      infoId: data.id
    };
  }, [ensureCompanyDriveRootFolder]);

  /* Drive 루트 폴더: 수정 모달 진입 시 이름 기준으로 재조회 후 없으면 생성 */
  useEffect(() => {
    if (!isEdit || !company?._id || !driveFolderName) {
      setDriveFolderId(null);
      setDriveFolderLink('');
      return;
    }
    if (driveRootEnsureInFlightRef.current) return;
    driveRootEnsureInFlightRef.current = true;
    ensureCompanyDriveRootFolder()
      .catch(() => {
        setDriveFolderId(null);
        setDriveFolderLink('');
      })
      .finally(() => {
        driveRootEnsureInFlightRef.current = false;
      });
  }, [isEdit, company?._id, driveFolderName, ensureCompanyDriveRootFolder]);

  /* 증서·자료: 루트 아래 information 폴더로 진입 (중복 검사는 백엔드 ensureFolder에서 처리) */
  useEffect(() => {
    if (!driveFolderId || !driveFolderName) {
      setDriveInformationFolderId(null);
      setDriveCurrentFolderId(null);
      setDriveBreadcrumb([]);
      setDriveFilesList([]);
      return;
    }
    if (driveInformationEnsureInFlightRef.current) return;
    driveInformationEnsureInFlightRef.current = true;
    (async () => {
      try {
        const ensured = await ensureCompanyDriveInformationFolder();
        if (ensured?.infoId) {
          setDriveCurrentFolderId(ensured.infoId);
          setDriveBreadcrumb([
            { id: ensured.rootId, name: driveFolderName },
            { id: ensured.infoId, name: INFORMATION_FOLDER_NAME }
          ]);
        } else {
          setDriveInformationFolderId(null);
          setDriveCurrentFolderId(driveFolderId);
          setDriveBreadcrumb([{ id: driveFolderId, name: driveFolderName }]);
        }
      } catch (_) {
        setDriveInformationFolderId(null);
        setDriveCurrentFolderId(driveFolderId);
        setDriveBreadcrumb([{ id: driveFolderId, name: driveFolderName }]);
      } finally {
        driveInformationEnsureInFlightRef.current = false;
      }
    })();
  }, [driveFolderId, driveFolderName, ensureCompanyDriveInformationFolder]);

  const fetchDriveFiles = useCallback(async () => {
    if (!driveFolderName) {
      setDriveFilesList([]);
      return;
    }
    setLoadingDriveFiles(true);
    try {
      /**
       * Google Drive 사용 시마다 먼저 [회사명]_[사업자번호] 와 information 폴더가 실제 목록에 있는지 확인.
       * 삭제되었으면 재생성한 뒤 최신 ID를 기준으로 목록을 읽는다.
       */
      let targetFolderId = driveCurrentFolderId;
      const isInfoContext =
        !targetFolderId ||
        targetFolderId === driveInformationFolderId ||
        targetFolderId === driveFolderId;
      if (isInfoContext) {
        const ensured = await ensureCompanyDriveInformationFolder();
        targetFolderId = ensured?.infoId || ensured?.rootId || null;
        if (ensured?.infoId) {
          setDriveCurrentFolderId(ensured.infoId);
          setDriveBreadcrumb([
            { id: ensured.rootId, name: driveFolderName },
            { id: ensured.infoId, name: INFORMATION_FOLDER_NAME }
          ]);
        }
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
  }, [driveCurrentFolderId, driveInformationFolderId, driveFolderId, driveFolderName, ensureCompanyDriveInformationFolder]);

  useEffect(() => {
    fetchDriveFiles();
  }, [fetchDriveFiles]);

  const handleDirectFileUpload = useCallback(
    async (files) => {
      const filesArray = Array.from(files || []);
      if (!filesArray.length) return;
      const companyId = isEdit && company?._id ? String(company._id) : null;
      setDriveUploading(true);
      setDriveError('');
      try {
        let parentId = driveCurrentFolderId || driveInformationFolderId || driveFolderId;
        if (!parentId) {
          try {
            const ensured = await ensureCompanyDriveInformationFolder();
            parentId = ensured?.infoId || ensured?.rootId || null;
          } catch (e) {
            setDriveError(e.message || '폴더를 준비할 수 없습니다.');
            return;
          }
          if (!parentId) {
            setDriveError('폴더를 준비할 수 없습니다.');
            return;
          }
        } else if (parentId === driveFolderId && driveInformationFolderId) {
          parentId = driveInformationFolderId;
        } else if (parentId === driveFolderId) {
          try {
            const ensured = await ensureCompanyDriveInformationFolder();
            parentId = ensured?.infoId || ensured?.rootId || driveFolderId;
          } catch (e) {
            setDriveError(e.message || 'information 폴더를 준비할 수 없습니다.');
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
      }
    },
    [driveFolderId, driveInformationFolderId, driveCurrentFolderId, ensureCompanyDriveInformationFolder, fetchDriveFiles]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (largeFileWarning.open) setLargeFileWarning({ open: false, files: [], folderUrl: '' });
      else if (showMapPicker) setShowMapPicker(false);
      else if (showAssigneePicker) setShowAssigneePicker(false);
      else if (showCustomFieldsModal) setShowCustomFieldsModal(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showAssigneePicker, showCustomFieldsModal, showMapPicker, largeFileWarning.open]);

  // 지도 피커: 열릴 때 Google Maps 로드 후 지도 초기화 + 주소 있으면 바로 검색
  useEffect(() => {
    if (!showMapPicker || !mapPickerContainerRef.current) return;
    const addressToSearch = (form.address || '').trim();
    setPickerLat(form.latitude);
    setPickerLng(form.longitude);
    setPickerSearchQuery(form.address || '');
    loadGoogleMaps((google) => {
      if (!google || !mapPickerContainerRef.current) {
        setPickerMapReady(false);
        return;
      }
      const center = form.latitude != null && form.longitude != null
        ? { lat: form.latitude, lng: form.longitude }
        : DEFAULT_CENTER;
      const map = new google.maps.Map(mapPickerContainerRef.current, {
        center,
        zoom: DEFAULT_ZOOM,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl: true,
        gestureHandling: 'greedy',
        scrollwheel: true,
        styles: [
          { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] }
        ]
      });
      mapInstanceRef.current = map;
      if (form.latitude != null && form.longitude != null) {
        const marker = new google.maps.Marker({
          position: { lat: form.latitude, lng: form.longitude },
          map,
          draggable: true,
          icon: getPickerMarkerIcon(google)
        });
        marker.addListener('dragend', () => {
          const p = marker.getPosition();
          setPickerLat(p.lat());
          setPickerLng(p.lng());
        });
        pickerMarkerRef.current = marker;
      }
      map.addListener('click', (e) => {
        const lat = e.latLng.lat();
        const lng = e.latLng.lng();
        setPickerLat(lat);
        setPickerLng(lng);
        if (pickerMarkerRef.current) {
          pickerMarkerRef.current.setPosition(e.latLng);
        } else {
          const marker = new google.maps.Marker({
            position: e.latLng,
            map,
            draggable: true,
            icon: getPickerMarkerIcon(google)
          });
          marker.addListener('dragend', () => {
            const p = marker.getPosition();
            setPickerLat(p.lat());
            setPickerLng(p.lng());
          });
          pickerMarkerRef.current = marker;
        }
      });
      setPickerMapReady(true);

      // 주소가 있으면 열자마자 해당 위치로 검색(이동 + 마커)
      if (addressToSearch && google.maps.Geocoder) {
        setPickerSearching(true);
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address: addressToSearch }, (results, status) => {
          setPickerSearching(false);
          if (status !== google.maps.GeocoderStatus.OK || !results?.[0]?.geometry?.location) return;
          const loc = results[0].geometry.location;
          const lat = loc.lat();
          const lng = loc.lng();
          setPickerLat(lat);
          setPickerLng(lng);
          map.panTo({ lat, lng });
          map.setZoom(DEFAULT_ZOOM);
          if (pickerMarkerRef.current) {
            pickerMarkerRef.current.setPosition({ lat, lng });
          } else {
            const marker = new google.maps.Marker({
              position: { lat, lng },
              map,
              draggable: true,
              icon: getPickerMarkerIcon(google)
            });
            marker.addListener('dragend', () => {
              const p = marker.getPosition();
              setPickerLat(p.lat());
              setPickerLng(p.lng());
            });
            pickerMarkerRef.current = marker;
          }
        });
      }
    });
    return () => {
      if (pickerMarkerRef.current) {
        pickerMarkerRef.current.setMap(null);
        pickerMarkerRef.current = null;
      }
      mapInstanceRef.current = null;
      setPickerMapReady(false);
    };
  }, [showMapPicker]);

  const pickerSearch = () => {
    const q = (pickerSearchQuery || '').trim();
    if (!q || !window.google?.maps?.Geocoder) return;
    setPickerSearching(true);
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ address: q }, (results, status) => {
      setPickerSearching(false);
      if (status !== window.google.maps.GeocoderStatus.OK || !results?.[0]?.geometry?.location) return;
      const loc = results[0].geometry.location;
      const lat = loc.lat();
      const lng = loc.lng();
      setPickerLat(lat);
      setPickerLng(lng);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.panTo({ lat, lng });
        mapInstanceRef.current.setZoom(DEFAULT_ZOOM);
      }
      if (pickerMarkerRef.current) {
        pickerMarkerRef.current.setPosition({ lat, lng });
      } else if (window.google?.maps?.Marker && mapInstanceRef.current) {
        const marker = new window.google.maps.Marker({
          position: { lat, lng },
          map: mapInstanceRef.current,
          draggable: true,
          icon: getPickerMarkerIcon(window.google)
        });
        marker.addListener('dragend', () => {
          const p = marker.getPosition();
          setPickerLat(p.lat());
          setPickerLng(p.lng());
        });
        pickerMarkerRef.current = marker;
      }
    });
  };

  const pickerConfirm = () => {
    if (pickerLat != null && pickerLng != null) {
      setForm((prev) => ({ ...prev, latitude: pickerLat, longitude: pickerLng }));
      if (!form.address?.trim() && window.google?.maps?.Geocoder) {
        const geocoder = new window.google.maps.Geocoder();
        geocoder.geocode(
          { location: { lat: pickerLat, lng: pickerLng } },
          (results, status) => {
            if (status === window.google.maps.GeocoderStatus.OK && results?.[0]?.formatted_address) {
              setForm((prev) => ({ ...prev, address: results[0].formatted_address }));
            }
          }
        );
      }
    }
    setShowMapPicker(false);
  };

  /** 주소로 위·경도 자동 채우기 (지도 모달 없이) */
  const geocodeAddressToForm = () => {
    const address = (form.address || '').trim();
    if (!address) return;
    if (!GOOGLE_MAPS_API_KEY) return;
    setAddressGeocoding(true);
    loadGoogleMaps(async (google) => {
      if (!google?.maps?.Geocoder) {
        setAddressGeocoding(false);
        return;
      }
      const coords = await geocodeAddressWithGoogleMaps(google, address);
      setAddressGeocoding(false);
      if (!coords) return;
      setForm((prev) => ({
        ...prev,
        latitude: coords.latitude,
        longitude: coords.longitude
      }));
    });
  };

  /** 지도 모달 열기 — 항상 클릭/드래그로 좌표 선택 가능 */
  const openMapPicker = () => setShowMapPicker(true);

  /** 사업자 등록증 파일로 Gemini 추출 → 폼 기입 → 주소로 위·경도 자동 조회 */
  const extractFromCertificateAndFillForm = async (file) => {
    if (!file || isEdit) return;
    setExtractingCertificate(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/customer-companies/extract-from-certificate`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '증빙에서 정보를 읽지 못했습니다.');
        return;
      }
      setForm((prev) => ({
        ...prev,
        name: (data.name && String(data.name).trim()) || prev.name,
        businessNumber: data.businessNumber ? formatBusinessNumberInput(String(data.businessNumber)) : prev.businessNumber,
        representativeName: (data.representativeName && String(data.representativeName).trim()) || prev.representativeName,
        industry: (data.industry && String(data.industry).trim()) || prev.industry,
        address: (data.address && String(data.address).trim()) || prev.address
      }));
      const addressTrimmed = data.address && String(data.address).trim();
      if (addressTrimmed) {
        const geoRes = await fetch(`${API_BASE}/customer-companies/geocode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify({ address: addressTrimmed })
        });
        const geoData = await geoRes.json().catch(() => ({}));
        if (geoRes.ok && geoData.latitude != null && geoData.longitude != null) {
          setForm((prev) => ({ ...prev, latitude: geoData.latitude, longitude: geoData.longitude }));
        } else if (GOOGLE_MAPS_API_KEY) {
          loadGoogleMaps(async (google) => {
            const coords = await geocodeAddressWithGoogleMaps(google, addressTrimmed);
            if (coords?.latitude != null && coords?.longitude != null) {
              setForm((prev) => ({
                ...prev,
                latitude: coords.latitude,
                longitude: coords.longitude
              }));
            }
          });
        }
      }
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setExtractingCertificate(false);
    }
  };

  /** TXT 1개 → preview-import로 추출 후, 고객사 1건이면 PDF 단건과 동일하게 폼·위경도 반영 (2건 이상이면 배치 미리보기) */
  const extractFromTxtAndFillForm = async (file) => {
    if (!file || isEdit) return;
    setExtractingCertificate(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('files', file);
      const res = await fetch(`${API_BASE}/customer-companies/preview-import`, {
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
      const valid = items.filter((r) => !r.error && (r.name || '').trim());
      if (!valid.length) {
        const firstErr = items.find((r) => r.error);
        setError(firstErr?.error || '추출된 고객사가 없습니다.');
        return;
      }
      if (valid.length > 1) {
        setImportPreviewItems(items);
        setShowImportPreview(true);
        return;
      }
      const row = valid[0];
      const bn = row.businessNumber ? formatBusinessNumberInput(String(row.businessNumber)) : '';
      let latitudeNum =
        row.latitude != null && Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : null;
      let longitudeNum =
        row.longitude != null && Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : null;
      const addressTrimmed = row.address ? String(row.address).trim() : '';
      setForm((prev) => ({
        ...prev,
        name: (row.name && String(row.name).trim()) || prev.name,
        businessNumber: bn || prev.businessNumber,
        representativeName: (row.representativeName && String(row.representativeName).trim()) || prev.representativeName,
        industry: (row.industry && String(row.industry).trim()) || prev.industry,
        address: addressTrimmed || prev.address,
        latitude: latitudeNum,
        longitude: longitudeNum
      }));
      if (addressTrimmed && (latitudeNum == null || longitudeNum == null)) {
        const coords = await geocodeAddressForCompanySave(addressTrimmed);
        if (coords) {
          setForm((prev) => ({
            ...prev,
            latitude: coords.latitude,
            longitude: coords.longitude
          }));
        }
      }
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setExtractingCertificate(false);
    }
  };

  const runCompanyPreviewImport = useCallback(async (files) => {
    const arr = Array.from(files || []).filter((f) => isCertificateLikeFile(f));
    if (!arr.length) {
      setError('파일을 추가해 주세요.');
      return;
    }
    setImportPreviewLoading(true);
    setError('');
    try {
      const fd = new FormData();
      arr.forEach((f) => fd.append('files', f));
      const res = await fetch(`${API_BASE}/customer-companies/preview-import`, {
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
        setError('추출된 고객사가 없습니다.');
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

  const confirmBulkCompanyImport = async () => {
    const rows = importPreviewItems.filter((r) => !r.error && (r.name || '').trim());
    if (!rows.length) {
      setError('등록할 유효한 행이 없습니다.');
      return;
    }
    setBulkSaving(true);
    setError('');
    let ok = 0;
    let fail = 0;
    const assigneeUserIds = Array.isArray(form.assigneeUserIds) ? form.assigneeUserIds : [];
    for (const row of rows) {
      try {
        const bn = row.businessNumber ? String(row.businessNumber).replace(/\D/g, '').slice(0, 10) : '';
        const addressTrimmed = row.address ? String(row.address).trim() : '';
        let latitudeNum =
          row.latitude != null && Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : null;
        let longitudeNum =
          row.longitude != null && Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : null;
        // 단건 저장(handleSubmit)과 동일: 주소는 있는데 위·경도가 비었으면 서버/클라이언트 지오코딩 보완
        if (addressTrimmed && (latitudeNum == null || longitudeNum == null)) {
          const coords = await geocodeAddressForCompanySave(addressTrimmed);
          if (coords) {
            latitudeNum = coords.latitude;
            longitudeNum = coords.longitude;
          }
        }
        const body = {
          name: String(row.name || '').trim(),
          representativeName: row.representativeName ? String(row.representativeName).trim() : undefined,
          industry: row.industry ? String(row.industry).trim() : undefined,
          businessNumber: bn || undefined,
          address: addressTrimmed || undefined,
          latitude: latitudeNum != null ? latitudeNum : undefined,
          longitude: longitudeNum != null ? longitudeNum : undefined,
          assigneeUserIds
        };
        const res = await fetch(`${API_BASE}/customer-companies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify(body)
        });
        if (res.ok) ok += 1;
        else fail += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkSaving(false);
    setShowImportPreview(false);
    setImportPreviewItems([]);
    if (ok > 0) {
      window.alert(`등록 완료: ${ok}건${fail ? `, 실패 ${fail}건` : ''}.`);
      onSaved?.();
      onClose?.();
    } else {
      setError(`등록에 실패했습니다. (${fail}건)`);
    }
  };

  const queueCertificateFile = useCallback((file) => {
    if (!file) return;
    setCertificateFile(file);
    setError('');
  }, []);

  const processCertificateFileSelection = useCallback(
    (fileList) => {
      const arr = Array.from(fileList || []).filter((f) => isCertificateLikeFile(f));
      if (!arr.length) {
        setError('지원 형식: 이미지, PDF, TXT 메모');
        return;
      }
      if (isEdit) {
        if (arr.length === 1 && !isTxtFile(arr[0])) {
          queueCertificateFile(arr[0]);
          extractFromCertificateAndFillForm(arr[0]);
        } else if (arr.length > 1) {
          setError('수정 모드에서는 증빙 파일을 하나만 선택해 주세요.');
        } else {
          setError('수정 모드에서는 이미지 또는 PDF 한 개만 선택할 수 있습니다.');
        }
        return;
      }
      if (shouldUseCompanyBatchPreview(arr)) {
        runCompanyPreviewImport(arr);
        return;
      }
      if (arr.length === 1) {
        if (isTxtFile(arr[0])) {
          extractFromTxtAndFillForm(arr[0]);
        } else {
          queueCertificateFile(arr[0]);
          extractFromCertificateAndFillForm(arr[0]);
        }
      }
    },
    [isEdit, queueCertificateFile, runCompanyPreviewImport]
  );

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'businessNumber') {
      setForm((prev) => ({ ...prev, businessNumber: formatBusinessNumberInput(value) }));
    } else if (name === 'latitude' || name === 'longitude') {
      const num = value.trim() === '' ? null : Number(value);
      setForm((prev) => ({ ...prev, [name]: Number.isFinite(num) ? num : value }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
    setError('');
  };

  const handleEditModeDrop = useCallback((files) => {
    const filesArray = Array.from(files || []);
    if (!filesArray.length) return;
    if (
      filesArray.length === 1
      && isCertificateLikeFile(filesArray[0])
      && !isTxtFile(filesArray[0])
    ) {
      queueCertificateFile(filesArray[0]);
      return;
    }
    handleDirectFileUpload(filesArray);
  }, [queueCertificateFile, handleDirectFileUpload]);


  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setError('');
    if (!form.name?.trim()) {
      setError('고객사명을 입력해 주세요.');
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    const addressTrimmed = form.address.trim();
    let latitudeNum =
      form.latitude != null && Number.isFinite(Number(form.latitude)) ? Number(form.latitude) : null;
    let longitudeNum =
      form.longitude != null && Number.isFinite(Number(form.longitude)) ? Number(form.longitude) : null;
    if (addressTrimmed && (latitudeNum == null || longitudeNum == null)) {
      const coords = await geocodeAddressForCompanySave(addressTrimmed);
      if (coords) {
        latitudeNum = coords.latitude;
        longitudeNum = coords.longitude;
        setForm((prev) => ({ ...prev, latitude: coords.latitude, longitude: coords.longitude }));
      }
    }
    const body = {
      name: form.name.trim(),
      representativeName: form.representativeName.trim() || undefined,
      industry: form.industry.trim() || undefined,
      businessNumber: (form.businessNumber || '').replace(/-/g, '').trim() || undefined,
      address: addressTrimmed || undefined,
      latitude: latitudeNum != null ? latitudeNum : undefined,
      longitude: longitudeNum != null ? longitudeNum : undefined,
      memo: form.memo.trim() || undefined,
      customFields: form.customFields && Object.keys(form.customFields).length ? form.customFields : undefined,
      assigneeUserIds: Array.isArray(form.assigneeUserIds) ? form.assigneeUserIds : []
    };
    if (isEdit) body.status = form.status;
    try {
      const url = isEdit ? `${API_BASE}/customer-companies/${company._id}` : `${API_BASE}/customer-companies`;
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '저장에 실패했습니다.');
        return;
      }
      let finalCompany = data;
      const companyIdForCert = isEdit ? company._id : (data._id || data.id);
      if (certificateFile && companyIdForCert) {
        let rootFolderId = driveFolderId || null;
        if (!rootFolderId) {
          try {
            const ensured = await ensureCompanyDriveRootFolder();
            rootFolderId = ensured?.id || null;
          } catch (e) {
            setError(e.message || '고객사는 저장되었으나 Drive 폴더를 준비할 수 없습니다.');
            return;
          }
          if (!rootFolderId) {
            setError('고객사는 저장되었으나 Drive 폴더를 준비할 수 없습니다.');
            return;
          }
        }
        const infoRes = await fetch(`${API_BASE}/drive/folders/ensure`, {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ folderName: INFORMATION_FOLDER_NAME, parentFolderId: rootFolderId })
        });
        const infoData = await infoRes.json().catch(() => ({}));
        if (!infoRes.ok || !infoData.id) {
          setError(infoData.error || '고객사는 저장되었으나 information 폴더를 준비할 수 없습니다.');
          return;
        }
        if (isEdit && company?.businessRegistrationCertificateDriveUrl) {
          const existingFileId = getDriveFileIdFromUrl(company.businessRegistrationCertificateDriveUrl);
          if (existingFileId) {
            try {
              await fetch(`${API_BASE}/drive/files/${encodeURIComponent(existingFileId)}`, {
                method: 'DELETE',
                headers: getAuthHeader(),
                credentials: 'include'
              });
            } catch (_) {}
          }
        }
        const contentBase64 = await fileToBase64(certificateFile);
        if (!contentBase64) {
          setError('고객사는 저장되었으나 사업자 등록증 파일 변환에 실패했습니다.');
          return;
        }
        const uploadRes = await fetch(`${API_BASE}/drive/upload`, {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: buildCertificateDriveFileName(
              form.name,
              form.businessNumber,
              certificateFile.type,
              certificateFile.name
            ),
            mimeType: certificateFile.type || 'application/octet-stream',
            contentBase64,
            parentFolderId: infoData.id
          })
        });
        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok || !uploadData.webViewLink) {
          setError(uploadData.error || '고객사는 저장되었으나 사업자 등록증 Drive 업로드에 실패했습니다.');
          return;
        }
        const patchRes = await fetch(`${API_BASE}/customer-companies/${companyIdForCert}`, {
          method: 'PATCH',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessRegistrationCertificateDriveUrl: uploadData.webViewLink
          })
        });
        const patched = await patchRes.json().catch(() => ({}));
        if (patchRes.ok && patched._id) finalCompany = { ...data, ...patched };
      }
      if (isEdit) {
        onUpdated?.(finalCompany);
      } else {
        onSaved?.(finalCompany);
      }
      onClose?.();
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setSaving(false);
      submittingRef.current = false;
    }
  };

  const formContent = (
    <form onSubmit={handleSubmit} className="add-company-modal-form">
      <div className="add-company-modal-body">
        {error && <p className="add-company-modal-error">{error}</p>}
        {/* 사업자등록증 · 자료 */}
        {isEdit && driveFolderId ? (
          <section className="customer-company-detail-section register-sale-docs">
            <input
              ref={certificateInputRef}
              type="file"
              accept="image/*,.pdf"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                queueCertificateFile(file);
                e.target.value = '';
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
            <div className="customer-company-detail-section-head">
              <h3 className="customer-company-detail-section-title">
                <span className="material-symbols-outlined">folder</span>
                사업자등록증 · 자료
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
            {certificateFile && (
              <div className="register-sale-docs-cert-pending">
                <span className="material-symbols-outlined" style={{ fontSize: '1.1rem' }}>upload_file</span>
                <span className="register-sale-docs-cert-pending-name">{certificateFile.name}</span>
                <button type="button" className="register-sale-docs-cert-pending-cancel" onClick={() => setCertificateFile(null)}>
                  <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>close</span>
                </button>
              </div>
            )}
            {driveFolderLink && getDriveFolderIdFromLink(driveFolderLink) ? (
              <div
                className={`register-sale-docs-list-wrap ${docsDropActive ? 'register-sale-docs-dropzone-active' : ''} ${driveUploading ? 'register-sale-docs-dropzone-disabled' : ''}`}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!driveUploading) setDocsDropActive(true); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDocsDropActive(false); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDocsDropActive(false);
                  if (!driveUploading && e.dataTransfer?.files?.length) handleEditModeDrop(e.dataTransfer.files);
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
                  if (!driveUploading && e.dataTransfer?.files?.length) handleEditModeDrop(e.dataTransfer.files);
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
        ) : (
          <section className="add-company-section">
            <h3 className="add-company-section-title">사업자등록증 일괄</h3>
            <p className="add-company-upload-hint" style={{ marginBottom: '0.5rem' }}>
              아래 영역에 이미지·PDF·TXT를 드래그 앤 드롭하거나 클릭하여 선택하세요. 여러 개 또는 TXT 한 개면 Gemini로 분류 후 표에서 확인하고 등록합니다. 이미지·PDF 한 개만 올리면 폼에 바로 채웁니다.
            </p>
            <input
              ref={certificateInputRef}
              type="file"
              accept="image/*,.pdf,.txt,text/plain"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                const list = e.target.files;
                if (list?.length) processCertificateFileSelection(list);
                e.target.value = '';
              }}
              aria-hidden="true"
            />
            <div
              className={`add-company-upload-zone ${certificateDropActive ? 'add-company-upload-zone-active' : ''} ${extractingCertificate || importPreviewLoading ? 'add-company-upload-zone-disabled' : ''}`}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!extractingCertificate && !importPreviewLoading) setCertificateDropActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setCertificateDropActive(false); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setCertificateDropActive(false);
                if (e.dataTransfer?.files?.length) {
                  processCertificateFileSelection(e.dataTransfer.files);
                }
              }}
              onClick={() => { if (!extractingCertificate && !importPreviewLoading && certificateInputRef.current) certificateInputRef.current.click(); }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !extractingCertificate && !importPreviewLoading && certificateInputRef.current) { e.preventDefault(); certificateInputRef.current.click(); } }}
              aria-label="사업자 등록증 파일 첨부 (드래그 앤 드롭 또는 클릭)"
            >
              <div className="add-company-upload-icon-wrap">
                <span className="material-symbols-outlined add-company-upload-icon">upload_file</span>
              </div>
              {extractingCertificate || importPreviewLoading ? (
                <p className="add-company-upload-title">{importPreviewLoading ? '일괄 분석 중…' : '증빙에서 정보를 읽는 중…'}</p>
              ) : certificateFile ? (
                <p className="add-company-upload-title add-company-upload-filename">{certificateFile.name}</p>
              ) : (
                <>
                  <p className="add-company-upload-title">파일을 드래그하거나 클릭 (여러 개 가능)</p>
                  <p className="add-company-upload-hint">이미지·PDF·TXT. 2개 이상 또는 TXT 한 개는 미리보기 후 등록.</p>
                </>
              )}
            </div>
          </section>
        )}
        {/* 기본 정보 2열 그리드 */}
        <section className="add-company-section add-company-grid-2">
          <div className="add-company-field">
            <label className="add-company-label" htmlFor="add-company-name">고객사명 <span className="add-company-required">*</span></label>
            <input id="add-company-name" name="name" type="text" value={form.name} onChange={handleChange} className="add-company-input" placeholder="고객사명을 입력하세요" required disabled={isEdit} title={isEdit ? '수정 모드에서는 고객사명을 바꿀 수 없습니다.' : undefined} />
          </div>
          <div className="add-company-field">
            <label className="add-company-label" htmlFor="add-company-business-number">사업자등록번호</label>
            <input id="add-company-business-number" name="businessNumber" type="text" inputMode="numeric" autoComplete="off" value={form.businessNumber} onChange={handleChange} className="add-company-input" placeholder="000-00-00000" maxLength={12} disabled={isEdit} title={isEdit ? '수정 모드에서는 사업자등록번호를 바꿀 수 없습니다.' : undefined} />
          </div>
          <div className="add-company-field" style={{ gridColumn: '1 / -1' }}>
            <label className="add-company-label" htmlFor="add-company-industry">업종</label>
            <input id="add-company-industry" name="industry" type="text" value={form.industry} onChange={handleChange} className="add-company-input" placeholder="예: 제조업, 도소매, IT 서비스" autoComplete="organization-title" />
          </div>
          <div className="add-company-row-representative-assignee">
            <div className="add-company-field add-company-field-representative">
              <label className="add-company-label" htmlFor="add-company-representative">대표자명</label>
              <input id="add-company-representative" name="representativeName" type="text" value={form.representativeName} onChange={handleChange} className="add-company-input" placeholder="대표자 성함을 입력하세요" disabled={isEdit} title={isEdit ? '수정 모드에서는 대표자명을 바꿀 수 없습니다.' : undefined} />
            </div>
            <div className="add-company-field add-company-field-assignee">
              <label className="add-company-label" htmlFor="add-company-assignee-input">담당자</label>
              <div className="add-company-assignee-input-wrap">
                <input
                  id="add-company-assignee-input"
                  type="text"
                  className="add-company-input add-company-input-with-icon"
                  placeholder="검색 아이콘으로 선택하거나 수기 입력"
                  value={assigneeInputValue}
                  onChange={(e) => setAssigneeDisplayText(e.target.value)}
                  aria-label="담당자"
                />
                <button
                  type="button"
                  className="add-company-assignee-search-icon-btn"
                  onClick={() => setShowAssigneePicker(true)}
                  title="담당자 검색"
                  aria-label="담당자 검색"
                >
                  <span className="material-symbols-outlined">search</span>
                </button>
              </div>
            </div>
          </div>
          {isEdit ? (
            <div className="add-company-field">
              <label className="add-company-label" htmlFor="add-company-status">상태</label>
              <select id="add-company-status" name="status" value={form.status} onChange={handleChange} className="add-company-input">
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="add-company-field" aria-hidden="true" />
          )}
        </section>
        {/* 주소 */}
        <section className="add-company-section">
          <div className="add-company-field">
            <label className="add-company-label" htmlFor="add-company-address">주소</label>
            <div className="add-company-address-input-wrap">
              <input
                id="add-company-address"
                name="address"
                type="text"
                value={form.address}
                onChange={handleChange}
                className="add-company-input add-company-input-with-icon"
                placeholder="주소를 검색하거나 직접 입력하세요"
              />
              {GOOGLE_MAPS_API_KEY && (
                <div className="add-company-address-map-actions">
                  <button
                    type="button"
                    className="add-company-address-map-btn"
                    onClick={geocodeAddressToForm}
                    disabled={addressGeocoding || !(form.address || '').trim()}
                    title="입력한 주소로 위·경도 자동 채우기 (지도 없이)"
                    aria-label="주소로 위경도 채우기"
                  >
                    {addressGeocoding ? (
                      <span className="material-symbols-outlined add-company-map-btn-spin">progress_activity</span>
                    ) : (
                      <span className="material-symbols-outlined">travel_explore</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="add-company-address-map-btn add-company-address-map-btn--pick"
                    onClick={openMapPicker}
                    title="지도를 열어 클릭한 위치의 좌표를 사용 · 상단 검색으로 이동 후 핀을 옮길 수 있음"
                    aria-label="지도에서 위치 찍기"
                  >
                    <span className="material-symbols-outlined">add_location</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="add-company-lat-row add-company-lat-row--hidden" aria-hidden="true">
            <div className="add-company-field">
              <label className="add-company-label add-company-label-muted" htmlFor="add-company-latitude">위도 (Latitude)</label>
              <input id="add-company-latitude" name="latitude" type="text" inputMode="decimal" value={form.latitude != null ? String(form.latitude) : ''} onChange={handleChange} className="add-company-input" placeholder="37.5665" tabIndex={-1} />
            </div>
            <div className="add-company-field">
              <label className="add-company-label add-company-label-muted" htmlFor="add-company-longitude">경도 (Longitude)</label>
              <input id="add-company-longitude" name="longitude" type="text" inputMode="decimal" value={form.longitude != null ? String(form.longitude) : ''} onChange={handleChange} className="add-company-input" placeholder="126.9780" tabIndex={-1} />
            </div>
          </div>
        </section>
        {/* 메모 */}
        <section className="add-company-section">
          <div className="add-company-field">
            <label className="add-company-label" htmlFor="add-company-memo">메모 / 특이사항</label>
            <textarea id="add-company-memo" name="memo" value={form.memo} onChange={handleChange} className="add-company-textarea" placeholder="고객사에 대한 참고사항을 입력하세요" rows={3} />
          </div>
        </section>
        {/* 사용자 정의 필드 */}
        <section className="add-company-section add-company-section-custom">
          <div className="add-company-custom-head">
            <h3 className="add-company-section-title">사용자 정의 필드</h3>
            {canManageCustomFieldDefinitions ? (
              <button type="button" className="add-company-btn-field-add" onClick={() => setShowCustomFieldsModal(true)}>
                <span className="material-symbols-outlined">add</span>
                필드 추가
              </button>
            ) : null}
          </div>
          <CustomFieldsSection
            definitions={customDefinitions}
            values={form.customFields || {}}
            onChangeValues={(key, value) => setForm((prev) => ({
              ...prev,
              customFields: { ...(prev.customFields || {}), [key]: value }
            }))}
            fieldClassName="add-company-field add-company-custom-field"
          />
        </section>
      </div>
      <footer className="add-company-modal-footer">
        <button type="button" className="add-company-btn-cancel" onClick={onClose}>취소</button>
        <button type="submit" className="btn-primary add-company-btn-save" disabled={saving}>
          <span className="material-symbols-outlined">save</span>
          {saving ? '저장 중...' : isEdit ? '저장' : '고객사 저장'}
        </button>
      </footer>
    </form>
  );

  if (isEdit) {
    return (
      <>
        <div className="add-company-modal-panel-overlay" aria-hidden="true" />
        <div className="add-company-modal-panel" onClick={(e) => e.stopPropagation()}>
          <div className="add-company-modal-panel-inner">
            <header className="add-company-modal-header-sample">
              <div className="add-company-modal-header-icon-wrap">
                <span className="material-symbols-outlined add-company-modal-header-icon">domain</span>
              </div>
              <h2 className="add-company-modal-header-title">고객사 수정</h2>
              <button type="button" className="add-company-modal-close-sample" onClick={onClose} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </header>
            {formContent}
          </div>
          {showAssigneePicker && (
            <AssigneePickerModal
              open={showAssigneePicker}
              onClose={() => setShowAssigneePicker(false)}
              selectedIds={form.assigneeUserIds || []}
              onConfirm={(ids) => {
                setForm((prev) => ({ ...prev, assigneeUserIds: ids }));
                const names = (ids || []).map((id) => assigneeIdToName[String(id)] || id).join(', ');
                setAssigneeDisplayText(names);
              }}
            />
          )}
          {showCustomFieldsModal && canManageCustomFieldDefinitions && (
            <CustomFieldsManageModal
              entityType="customerCompany"
              onClose={() => setShowCustomFieldsModal(false)}
              onFieldAdded={() => fetchCustomDefinitions()}
              apiBase={API_BASE}
              getAuthHeader={getAuthHeader}
            />
          )}
          {showMapPicker && GOOGLE_MAPS_API_KEY && (
            <div
              className="add-company-map-picker-modal-overlay"
              onClick={() => setShowMapPicker(false)}
              role="dialog"
              aria-modal="true"
              aria-label="위치 선택"
            >
              <div className="add-company-map-picker-modal" onClick={(e) => e.stopPropagation()}>
                <div className="add-company-map-picker-modal-header">
                  <h3>위치 선택</h3>
                  <button type="button" className="add-company-map-picker-modal-close" onClick={() => setShowMapPicker(false)} aria-label="닫기">
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
                <p className="add-company-map-picker-hint">
                  상단에서 주소·장소를 검색해 이동하거나, <strong>지도를 직접 클릭</strong>해 핀을 놓을 수 있습니다. 핀은 드래그로 미세 조정 후「확인」하면 위도·경도가 폼에 반영됩니다.
                </p>
                <div className="add-company-map-picker-search">
                  <input
                    type="text"
                    value={pickerSearchQuery}
                    onChange={(e) => setPickerSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), pickerSearch())}
                    placeholder="주소·장소 검색 (선택)"
                  />
                  <button type="button" className="add-company-map-picker-search-btn" onClick={pickerSearch} disabled={pickerSearching}>
                    {pickerSearching ? '검색 중…' : '검색'}
                  </button>
                </div>
                <div ref={mapPickerContainerRef} className="add-company-map-picker-canvas" />
                <div className="add-company-map-picker-actions">
                  <button type="button" className="add-company-map-picker-cancel" onClick={() => setShowMapPicker(false)}>취소</button>
                  <button
                    type="button"
                    className="add-company-map-picker-confirm"
                    onClick={pickerConfirm}
                    disabled={pickerLat == null || pickerLng == null}
                    title={pickerLat == null || pickerLng == null ? '지도를 클릭해 위치를 먼저 찍어 주세요' : undefined}
                  >
                    확인 (위·경도 적용)
                  </button>
                </div>
              </div>
            </div>
          )}
          <CompanyImportPreviewModal
            open={showImportPreview}
            items={importPreviewItems}
            bulkSaving={bulkSaving}
            onClose={() => !bulkSaving && setShowImportPreview(false)}
            onConfirm={confirmBulkCompanyImport}
          />
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
        </div>
      </>
    );
  }

  return (
    <div className="add-company-modal-overlay">
      <div className="add-company-modal add-company-modal-sample" onClick={(e) => e.stopPropagation()}>
        <header className="add-company-modal-header-sample">
          <div className="add-company-modal-header-icon-wrap">
            <span className="material-symbols-outlined add-company-modal-header-icon">domain</span>
          </div>
          <h2 className="add-company-modal-header-title">새 고객사 추가</h2>
          <button type="button" className="add-company-modal-close-sample" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        {formContent}
      </div>
      {showCustomFieldsModal && canManageCustomFieldDefinitions && (
        <CustomFieldsManageModal
          entityType="customerCompany"
          onClose={() => setShowCustomFieldsModal(false)}
          onFieldAdded={() => fetchCustomDefinitions()}
          apiBase={API_BASE}
          getAuthHeader={getAuthHeader}
        />
      )}
      {showAssigneePicker && (
        <AssigneePickerModal
          open={showAssigneePicker}
          onClose={() => setShowAssigneePicker(false)}
          selectedIds={form.assigneeUserIds || []}
          onConfirm={(ids) => {
            setForm((prev) => ({ ...prev, assigneeUserIds: ids }));
            const names = (ids || []).map((id) => assigneeIdToName[String(id)] || id).join(', ');
            setAssigneeDisplayText(names);
          }}
        />
      )}
      {showMapPicker && GOOGLE_MAPS_API_KEY && (
        <div
          className="add-company-map-picker-modal-overlay"
          onClick={() => setShowMapPicker(false)}
          role="dialog"
          aria-modal="true"
          aria-label="위치 선택"
        >
          <div className="add-company-map-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="add-company-map-picker-modal-header">
              <h3>위치 선택</h3>
              <button type="button" className="add-company-map-picker-modal-close" onClick={() => setShowMapPicker(false)} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p className="add-company-map-picker-hint">
              상단에서 주소·장소를 검색해 이동하거나, <strong>지도를 직접 클릭</strong>해 핀을 놓을 수 있습니다. 핀은 드래그로 미세 조정 후「확인」하면 위도·경도가 폼에 반영됩니다.
            </p>
            <div className="add-company-map-picker-search">
              <input
                type="text"
                value={pickerSearchQuery}
                onChange={(e) => setPickerSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), pickerSearch())}
                placeholder="주소·장소 검색 (선택)"
              />
              <button type="button" className="add-company-map-picker-search-btn" onClick={pickerSearch} disabled={pickerSearching}>
                {pickerSearching ? '검색 중…' : '검색'}
              </button>
            </div>
            <div ref={mapPickerContainerRef} className="add-company-map-picker-canvas" />
            <div className="add-company-map-picker-actions">
              <button type="button" className="add-company-map-picker-cancel" onClick={() => setShowMapPicker(false)}>
                취소
              </button>
              <button
                type="button"
                className="add-company-map-picker-confirm"
                onClick={pickerConfirm}
                disabled={pickerLat == null || pickerLng == null}
                title={pickerLat == null || pickerLng == null ? '지도를 클릭해 위치를 먼저 찍어 주세요' : undefined}
              >
                확인 (위·경도 적용)
              </button>
            </div>
          </div>
        </div>
      )}
      <CompanyImportPreviewModal
        open={showImportPreview}
        items={importPreviewItems}
        bulkSaving={bulkSaving}
        onClose={() => !bulkSaving && setShowImportPreview(false)}
        onConfirm={confirmBulkCompanyImport}
      />
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
    </div>
  );
}
