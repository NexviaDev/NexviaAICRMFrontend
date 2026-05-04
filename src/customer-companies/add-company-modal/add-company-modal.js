import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import CustomFieldsSection from '../../shared/custom-fields-section';
import AssigneePickerModal from '../../company-overview/assignee-picker-modal/assignee-picker-modal';
import CompanyImportPreviewModal from './company-import-preview-modal';
import './add-company-modal.css';

import { API_BASE } from '@/config';
import { getUserVisibleApiError } from '@/lib/api-error';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import {
  buildDriveFileDeleteUrl,
  getDriveFileIdFromUrl,
  isValidDriveNodeId,
  sanitizeDriveFolderWebViewLink
} from '@/lib/google-drive-url';
import { pingBackendHealth } from '@/lib/backend-wake';
import { pruneDriveUploadedFilesIndex, syncDriveUploadedFilesIndex } from '@/lib/drive-uploaded-files-prune';
import {
  RegisterSaleDocsCrmTable,
  fileToBase64,
  formatDriveFileDate,
  mergeCertificateRowIntoDriveUploads,
  resolveCompanyDriveMongoRegisteredUrl,
  runDriveDirectFileUpload,
  sortDriveUploadedFiles
} from '@/shared/register-sale-docs-drive';
import {
  getGoogleMapsApiKey,
  loadGoogleMaps,
  loadGoogleMapsPromise,
  geocodeAddressWithGoogleMaps
} from '@/lib/google-maps-client';
import { geocodeAddressForCompanySave } from '@/lib/geocode-company-address';
import { mapWithConcurrency } from '@/lib/map-with-concurrency';

const GOOGLE_MAPS_API_KEY = getGoogleMapsApiKey();
/** 일괄 등록 시 주소→좌표 보완을 동시에 처리할 최대 개수 */
const BULK_IMPORT_GEOCODE_CONCURRENCY = 4;
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

/** Drive 저장 시 파일명: 사업자등록증_기업명_사업자번호.확장자 */
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

export default function AddCompanyModal({ company, onClose, onSaved, onUpdated }) {
  const isEdit = Boolean(company);
  /** 수정 모드: 기업명 변경은 서버가 Admin 이상만 허용 — UI에서도 동일하게 막음 */
  const canEditCompanyNameInEdit = useMemo(
    () => !isEdit || isAdminOrAboveRole(getStoredCrmUser()?.role),
    [isEdit]
  );
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /** POST 전 유사 상호 — 사용자가 `그래도 신규` 선택 시 body.forceCreateDespiteSimilar */
  const [preSaveCompany, setPreSaveCompany] = useState(null);
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
  const [driveUploading, setDriveUploading] = useState(false);
  const [driveError, setDriveError] = useState('');
  const [driveUploadNotice, setDriveUploadNotice] = useState('');
  /** 상세 모달과 동일: MongoDB driveUploadedFiles 기반 리스트 + CRM 업로드 영역 드롭 하이라이트 */
  const [displayedCompany, setDisplayedCompany] = useState(null);
  const [crmListDropActive, setCrmListDropActive] = useState(false);
  const [crmDriveDeletingId, setCrmDriveDeletingId] = useState('');
  const mapPickerContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const pickerMarkerRef = useRef(null);
  const certificateInputRef = useRef(null);
  const fileInputRef = useRef(null);
  /** 루트 폴더 ensure — 저장된 ID를 보지 않고 이름 기준으로 재조회/생성 */
  const driveRootEnsureInFlightRef = useRef(false);
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

  useEffect(() => {
    setDisplayedCompany((prev) => ({ ...(prev || {}), ...(company || {}) }));
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

  const companyToShow = displayedCompany || company || {};

  const crmDriveUploadsSorted = useMemo(
    () => sortDriveUploadedFiles(companyToShow?.driveUploadedFiles),
    [companyToShow?.driveUploadedFiles]
  );

  const crmDriveTableRows = useMemo(
    () => mergeCertificateRowIntoDriveUploads(crmDriveUploadsSorted, companyToShow),
    [crmDriveUploadsSorted, companyToShow?.businessRegistrationCertificateDriveUrl, companyToShow?.updatedAt]
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

  const ensureCompanyDriveRootFolder = useCallback(async () => {
    if (!driveFolderName) return null;
    const r = await fetch(`${API_BASE}/drive/folders/ensure`, {
      method: 'POST',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        folderName: driveFolderName,
        ...(company?._id ? { customerCompanyId: String(company._id) } : {})
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.id) {
      throw new Error(getUserVisibleApiError(data, '폴더를 준비할 수 없습니다.'));
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
    setDisplayedCompany((prev) => ({
      ...(prev || {}),
      ...(company || {}),
      driveCustomerRootFolderId: data.id,
      driveCustomerRootFolderWebViewLink: folderLink
    }));
    return { id: data.id, webViewLink: folderLink };
  }, [driveFolderName, company]);

  /** MongoDB에 저장된 루트 폴더 ID·링크로 로컬 Drive 상태 동기화 (고객사 상세 모달과 동일) */
  useEffect(() => {
    const id = companyToShow?.driveCustomerRootFolderId;
    const linkRaw = companyToShow?.driveCustomerRootFolderWebViewLink;
    if (!id || !isValidDriveNodeId(String(id).trim())) return;
    const sanitized = sanitizeDriveFolderWebViewLink(linkRaw, id);
    if (!sanitized) return;
    setDriveFolderId(id);
    setDriveFolderLink(sanitized);
  }, [companyToShow?.driveCustomerRootFolderId, companyToShow?.driveCustomerRootFolderWebViewLink]);

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

  /** 수정 모달: Drive 직속 파일 ↔ Mongo 목록 동기화(추가 후 정리) */
  useEffect(() => {
    const cid = companyToShow?._id;
    const fid = companyToShow?.driveCustomerRootFolderId;
    if (!isEdit || !cid || !fid || !isValidDriveNodeId(String(fid).trim())) return undefined;
    let cancelled = false;
    (async () => {
      await syncDriveUploadedFilesIndex({
        getAuthHeader,
        folderId: String(fid).trim(),
        customerCompanyId: String(cid)
      });
      if (cancelled) return;
      await pruneDriveUploadedFilesIndex({
        getAuthHeader,
        folderId: String(fid).trim(),
        customerCompanyId: String(cid)
      });
      if (cancelled) return;
      try {
        const res = await fetch(`${API_BASE}/customer-companies/${cid}`, { headers: getAuthHeader() });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?._id) setDisplayedCompany((prev) => ({ ...(prev || {}), ...data }));
      } catch (_) {}
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, companyToShow?._id, companyToShow?.driveCustomerRootFolderId]);

  const handleDirectFileUpload = useCallback(
    async (files) => {
      const companyId = company?._id ? String(company._id) : null;
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
          customerCompanyId: companyId
        }),
        getAuthHeader,
        setDriveUploading,
        setDriveError,
        setDriveUploadNotice,
        canStart: () => Boolean(companyId),
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
    [company?._id, driveFolderId, driveFolderLink, ensureCompanyDriveRootFolder]
  );

  const handleDeleteCrmDriveFile = useCallback(
    async (row) => {
      const fid = row?.driveFileId && String(row.driveFileId).trim();
      const companyId = company?._id ? String(company._id) : null;
      if (!fid || !companyId || !isValidDriveNodeId(fid)) return;
      if (!window.confirm(`「${row.name || '파일'}」을 Drive 휴지통으로 옮기고 목록에서 제거할까요?`)) return;
      setCrmDriveDeletingId(fid);
      setDriveError('');
      try {
        await pingBackendHealth(getAuthHeader);
        const url = buildDriveFileDeleteUrl(fid, { customerCompanyId: companyId });
        const res = await fetch(url, { method: 'DELETE', headers: getAuthHeader(), credentials: 'include' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setDriveError(getUserVisibleApiError(data, '삭제에 실패했습니다.'));
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
    [company?._id, company, displayedCompany]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showMapPicker) setShowMapPicker(false);
      else if (showAssigneePicker) setShowAssigneePicker(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showAssigneePicker, showMapPicker]);

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

  /** 사업자 등록증 파일로 Gemini 추출 → 폼 기입 → 주소로 위·경도 자동 조회 (신규·수정 공통) */
  const extractFromCertificateAndFillForm = async (file) => {
    if (!file) return;
    setExtractingCertificate(true);
    setError('');
    try {
      await pingBackendHealth(getAuthHeader);
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/customer-companies/extract-from-certificate`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getUserVisibleApiError(data, '증빙에서 정보를 읽지 못했습니다.'));
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

  /** TXT 1개 → preview-import로 추출 후, 고객사 1건이면 PDF 단건과 동일하게 폼·위경도 반영 (2건 이상이면 배치 미리보기; 수정 모드는 1건만) */
  const extractFromTxtAndFillForm = async (file) => {
    if (!file) return;
    setExtractingCertificate(true);
    setError('');
    try {
      await pingBackendHealth(getAuthHeader);
      const fd = new FormData();
      fd.append('files', file);
      const res = await fetch(`${API_BASE}/customer-companies/preview-import`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getUserVisibleApiError(data, '텍스트에서 정보를 읽지 못했습니다.'));
        return;
      }
      const items = Array.isArray(data.items) ? data.items : [];
      const valid = items.filter(
        (r) => !r.error && ((r.name || '').trim() || (r.address || '').trim() || (r.businessNumber || '').trim())
      );
      if (!valid.length) {
        const firstErr = items.find((r) => r.error);
        setError(firstErr?.error || '추출된 고객사가 없습니다.');
        return;
      }
      if (valid.length > 1) {
        if (isEdit) {
          setError('수정 모드에서는 TXT에서 고객사 한 건만 추출된 경우만 폼에 반영할 수 있습니다.');
          return;
        }
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
      await pingBackendHealth(getAuthHeader);
      const fd = new FormData();
      arr.forEach((f) => fd.append('files', f));
      const res = await fetch(`${API_BASE}/customer-companies/preview-import`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getUserVisibleApiError(data, '미리보기에 실패했습니다.'));
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
    await pingBackendHealth(getAuthHeader);
    const rowsPrepared = await mapWithConcurrency(rows, BULK_IMPORT_GEOCODE_CONCURRENCY, async (row) => {
      const bn = row.businessNumber ? String(row.businessNumber).replace(/\D/g, '').slice(0, 10) : '';
      const addressTrimmed = row.address ? String(row.address).trim() : '';
      let latitudeNum =
        row.latitude != null && Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : null;
      let longitudeNum =
        row.longitude != null && Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : null;
      if (addressTrimmed && (latitudeNum == null || longitudeNum == null)) {
        const coords = await geocodeAddressForCompanySave(addressTrimmed);
        if (coords) {
          latitudeNum = coords.latitude;
          longitudeNum = coords.longitude;
        }
      }
      return { row, bn, addressTrimmed, latitudeNum, longitudeNum };
    });

    for (const prep of rowsPrepared) {
      try {
        const { row, bn, addressTrimmed, latitudeNum, longitudeNum } = prep;
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
        if (arr.length > 1) {
          setError('수정 모드에서는 증빙 파일을 하나만 선택해 주세요.');
          return;
        }
        if (arr.length === 1 && isTxtFile(arr[0])) {
          extractFromTxtAndFillForm(arr[0]);
          return;
        }
        if (arr.length === 1) {
          queueCertificateFile(arr[0]);
          extractFromCertificateAndFillForm(arr[0]);
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

  const handleEditModeDrop = useCallback(
    (files) => {
      const filesArray = Array.from(files || []);
      if (!filesArray.length) return;
      const certLike = filesArray.filter((f) => isCertificateLikeFile(f));
      const nonCert = filesArray.filter((f) => !isCertificateLikeFile(f));
      if (!certLike.length) {
        handleDirectFileUpload(filesArray);
        return;
      }
      if (nonCert.length > 0) {
        setError('증빙(이미지·PDF·TXT)과 다른 형식을 함께 놓을 수 없습니다. 나누어 주세요.');
        return;
      }
      if (certLike.length > 1) {
        setError('수정 모드에서는 증빙 파일을 하나만 놓아 주세요.');
        return;
      }
      const file = certLike[0];
      if (isTxtFile(file)) {
        void extractFromTxtAndFillForm(file);
        return;
      }
      queueCertificateFile(file);
      void extractFromCertificateAndFillForm(file);
    },
    [queueCertificateFile, extractFromCertificateAndFillForm, extractFromTxtAndFillForm, handleDirectFileUpload]
  );


  const runCompanySave = async (e, { forceCreateDespiteSimilar = false } = {}) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (submittingRef.current) return;
    setError('');
    setPreSaveCompany(null);
    if (!form.name?.trim()) {
      setError('기업명을 입력해 주세요.');
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      await pingBackendHealth(getAuthHeader);
      if (!isEdit && !forceCreateDespiteSimilar) {
        const p = new URLSearchParams({ name: form.name.trim() });
        const sRes = await fetch(`${API_BASE}/customer-companies/similar-name-candidates?${p.toString()}`, {
          headers: getAuthHeader()
        });
        const sData = await sRes.json().catch(() => ({}));
        const sim = Array.isArray(sData.similar) ? sData.similar : [];
        if (sim.length) {
          setPreSaveCompany({ similar: sim });
          setSaving(false);
          submittingRef.current = false;
          return;
        }
      }
    } catch {
      setError('유사 상호를 확인하는 중 오류가 났습니다.');
      setSaving(false);
      submittingRef.current = false;
      return;
    }
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
      status: (form.status && String(form.status).trim()) || 'active',
      customFields: form.customFields && Object.keys(form.customFields).length ? form.customFields : undefined,
      assigneeUserIds: Array.isArray(form.assigneeUserIds) ? form.assigneeUserIds : []
    };
    if (!isEdit && forceCreateDespiteSimilar) {
      body.forceCreateDespiteSimilar = true;
    }
    try {
      const url = isEdit ? `${API_BASE}/customer-companies/${company._id}` : `${API_BASE}/customer-companies`;
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && data.code === 'SIMILAR_CUSTOMER_COMPANY' && Array.isArray(data.similarCustomerCompanies)) {
          setError(getUserVisibleApiError(data, '비슷한 상호의 고객사가 이미 있습니다.'));
          setPreSaveCompany({ similar: data.similarCustomerCompanies });
        } else {
          setError(getUserVisibleApiError(data, '저장에 실패했습니다.'));
        }
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
          setError(getUserVisibleApiError(infoData, '고객사는 저장되었으나 information 폴더를 준비할 수 없습니다.'));
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
          setError(getUserVisibleApiError(uploadData, '고객사는 저장되었으나 사업자 등록증 Drive 업로드에 실패했습니다.'));
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
        if (patchRes.ok && patched._id) {
          finalCompany = { ...data, ...patched };
        } else {
          setError(getUserVisibleApiError(patched, '고객사는 저장되었으나 등록증 링크를 반영하지 못했습니다.'));
          return;
        }
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

  const handleSubmit = (e) => runCompanySave(e, {});

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
            {certificateFile && (
              <div className="register-sale-docs-cert-pending">
                <span className="material-symbols-outlined" style={{ fontSize: '1.1rem' }}>upload_file</span>
                <span className="register-sale-docs-cert-pending-name">{certificateFile.name}</span>
                <button type="button" className="register-sale-docs-cert-pending-cancel" onClick={() => setCertificateFile(null)}>
                  <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>close</span>
                </button>
              </div>
            )}
            <div className="register-sale-docs-drive-meta" aria-live="polite">
              <div className="register-sale-docs-drive-meta-row">
                <span className="register-sale-docs-drive-meta-label">폴더명</span>
                <code className="register-sale-docs-drive-meta-code" title="공유 드라이브 루트 아래 이 이름으로 준비됩니다">
                  {driveFolderName}
                </code>
              </div>
              {driveMongoRegisteredUrl ? (
                <div className="register-sale-docs-drive-meta-row register-sale-docs-drive-meta-row--link">
                  <span className="register-sale-docs-drive-meta-label">CRM 저장 주소</span>
                  <a
                    href={driveMongoRegisteredUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="register-sale-docs-drive-meta-link"
                  >
                    {driveMongoRegisteredUrl.length > 64
                      ? `${driveMongoRegisteredUrl.slice(0, 48)}…`
                      : driveMongoRegisteredUrl}
                  </a>
                </div>
              ) : (
                <p className="register-sale-docs-drive-meta-pending">
                  저장 후 CRM에 Drive 링크가 표시됩니다. 공유 드라이브 루트는 회사 개요 「전체 공유 드라이브 주소」에서 설정합니다.
                </p>
              )}
            </div>
            <div
              className={`register-sale-docs-crm-uploads ${crmListDropActive ? 'register-sale-docs-crm-uploads--drop-active' : ''} ${driveUploading || extractingCertificate || importPreviewLoading ? 'register-sale-docs-crm-uploads--disabled' : ''}`}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!driveUploading && !extractingCertificate && !importPreviewLoading) setCrmListDropActive(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!driveUploading && !extractingCertificate && !importPreviewLoading) setCrmListDropActive(true);
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
                if (!driveUploading && !extractingCertificate && !importPreviewLoading && e.dataTransfer?.files?.length) {
                  handleEditModeDrop(e.dataTransfer.files);
                }
              }}
            >
              <h4 className="register-sale-docs-crm-uploads-title">
                <span className="material-symbols-outlined">history_edu</span>
                리스트
              </h4>
              <p className="register-sale-docs-crm-uploads-hint">
                드래그 앤 드롭 또는 클릭. 증빙(이미지·PDF·TXT)은 한 번에 한 개만, AI로 폼 반영.
              </p>
              {crmDriveTableRows.length === 0 ? (
                <div
                  className={`register-sale-docs-crm-empty ${crmListDropActive ? 'register-sale-docs-crm-empty--active' : ''}`}
                  onClick={() => {
                    if (!driveUploading && !extractingCertificate && !importPreviewLoading && fileInputRef.current) {
                      fileInputRef.current.click();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (
                      (e.key === 'Enter' || e.key === ' ') &&
                      !driveUploading &&
                      !extractingCertificate &&
                      !importPreviewLoading &&
                      fileInputRef.current
                    ) {
                      e.preventDefault();
                      fileInputRef.current.click();
                    }
                  }}
                >
                  <span className="material-symbols-outlined register-sale-docs-crm-empty-icon">inbox</span>
                  <span className="register-sale-docs-crm-empty-text">
                    {driveUploading
                      ? '업로드 중…'
                      : extractingCertificate || importPreviewLoading
                        ? 'AI가 증빙에서 정보를 읽는 중…'
                        : '등록된 항목이 없습니다. 증빙을 놓으면 폼 반영, 일반 파일은 위 추가.'}
                  </span>
                </div>
              ) : (
                <RegisterSaleDocsCrmTable
                  rows={crmDriveTableRows}
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
          <section className="add-company-section">
            <h3 className="add-company-section-title">사업자등록증 일괄</h3>
            <p className="add-company-upload-hint" style={{ marginBottom: '0.5rem' }}>
              드래그 앤 드롭(다중 가능) 또는 클릭. 이미지·PDF·TXT.
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
                  <p className="add-company-upload-hint">자동 입력·미리보기 후 등록. 저장 시 Drive 폴더.</p>
                </>
              )}
            </div>
          </section>
        )}
        {/* 기본 정보 2열 그리드 */}
        <section className="add-company-section add-company-grid-2">
          <div className="add-company-field">
            <label className="add-company-label" htmlFor="add-company-name">기업명 <span className="add-company-required">*</span></label>
            <input
              id="add-company-name"
              name="name"
              type="text"
              value={form.name}
              onChange={handleChange}
              className="add-company-input"
              placeholder="기업명을 입력하세요"
              required
              disabled={isEdit && !canEditCompanyNameInEdit}
              title={
                isEdit && !canEditCompanyNameInEdit
                  ? '기업명(상호) 변경은 관리자(Admin) 이상만 가능합니다. 대표자명·주소 등은 수정할 수 있습니다.'
                  : undefined
              }
            />
          </div>
          <div className="add-company-field">
            <label className="add-company-label" htmlFor="add-company-business-number">사업자등록번호</label>
            <input id="add-company-business-number" name="businessNumber" type="text" inputMode="numeric" autoComplete="off" value={form.businessNumber} onChange={handleChange} className="add-company-input" placeholder="000-00-00000" maxLength={12} />
          </div>
          <div className="add-company-field" style={{ gridColumn: '1 / -1' }}>
            <label className="add-company-label" htmlFor="add-company-industry">업종</label>
            <input id="add-company-industry" name="industry" type="text" value={form.industry} onChange={handleChange} className="add-company-input" placeholder="예: 제조업, 도소매, IT 서비스" autoComplete="organization-title" />
          </div>
          <div className="add-company-row-representative-assignee">
            <div className="add-company-field add-company-field-representative">
              <label className="add-company-label" htmlFor="add-company-representative">대표자명</label>
              <input id="add-company-representative" name="representativeName" type="text" value={form.representativeName} onChange={handleChange} className="add-company-input" placeholder="대표자 성함을 입력하세요" />
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
          <div className="add-company-field">
            <label className="add-company-label" htmlFor="add-company-status">상태 키값</label>
            <div className="add-company-status-row">
              <input
                id="add-company-status"
                name="status"
                type="text"
                value={form.status}
                onChange={handleChange}
                className="add-company-input"
                placeholder="예: active, inactive, lead 또는 자유 키값"
                list="add-company-status-presets"
              />
              <span className="add-company-status-hint">예: active=운영, lead=잠재</span>
            </div>
            <datalist id="add-company-status-presets">
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </datalist>
          </div>
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
          <h3 className="add-company-section-title">사용자 정의 필드</h3>
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
          {preSaveCompany && (preSaveCompany.similar || []).length > 0 && (
            <div
              className="add-company-pregate-overlay"
              onClick={() => !saving && setPreSaveCompany(null)}
              role="dialog"
              aria-modal="true"
              aria-label="유사 고객사"
            >
              <div className="add-company-pregate-panel" onClick={(e) => e.stopPropagation()}>
                <h3 className="add-company-pregate-title">비슷한 상호의 고객사</h3>
                <p className="add-company-pregate-hint">아래와 유사한 고객사가 이미 등록되어 있습니다. 그대로 <strong>새로 추가</strong>할지, 취소하고 목록·검색에서 기존 건에 맞출지 정해 주세요.</p>
                <ul className="add-company-pregate-list">
                  {(preSaveCompany.similar || []).slice(0, 20).map((c) => (
                    <li key={String(c._id)}>
                      <span className="add-company-pregate-name">{c.name || '—'}</span>
                      {c.businessNumber ? (
                        <span className="add-company-pregate-bn">사업자 {String(c.businessNumber).replace(/(\d{3})(\d{2})(\d{5})/, '$1-$2-$3')}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <div className="add-company-pregate-actions">
                  <button type="button" className="add-company-btn-cancel" onClick={() => setPreSaveCompany(null)} disabled={saving}>
                    취소
                  </button>
                  <button
                    type="button"
                    className="btn-primary add-company-btn-save"
                    disabled={saving}
                    onClick={() => {
                      setPreSaveCompany(null);
                      void runCompanySave(null, { forceCreateDespiteSimilar: true });
                    }}
                  >
                    그래도 신규로 등록
                  </button>
                </div>
              </div>
            </div>
          )}
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
          <h2 className="add-company-modal-header-title">새 기업 추가</h2>
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
      {preSaveCompany && (preSaveCompany.similar || []).length > 0 && (
        <div
          className="add-company-pregate-overlay"
          onClick={() => !saving && setPreSaveCompany(null)}
          role="dialog"
          aria-modal="true"
          aria-label="유사 고객사"
        >
          <div className="add-company-pregate-panel" onClick={(e) => e.stopPropagation()}>
            <h3 className="add-company-pregate-title">비슷한 상호의 고객사</h3>
            <p className="add-company-pregate-hint">아래와 유사한 고객사가 이미 등록되어 있습니다. 그대로 <strong>새로 추가</strong>할지, 취소하고 목록·검색에서 기존 건에 맞출지 정해 주세요.</p>
            <ul className="add-company-pregate-list">
              {(preSaveCompany.similar || []).slice(0, 20).map((c) => (
                <li key={String(c._id)}>
                  <span className="add-company-pregate-name">{c.name || '—'}</span>
                  {c.businessNumber ? (
                    <span className="add-company-pregate-bn">사업자 {String(c.businessNumber).replace(/(\d{3})(\d{2})(\d{5})/, '$1-$2-$3')}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="add-company-pregate-actions">
              <button type="button" className="add-company-btn-cancel" onClick={() => setPreSaveCompany(null)} disabled={saving}>
                취소
              </button>
              <button
                type="button"
                className="btn-primary add-company-btn-save"
                disabled={saving}
                onClick={() => {
                  setPreSaveCompany(null);
                  void runCompanySave(null, { forceCreateDespiteSimilar: true });
                }}
              >
                그래도 신규로 등록
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
