import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import CustomFieldsSection from '../../shared/custom-fields-section';
import CustomFieldsManageModal from '../../shared/custom-fields-manage-modal/custom-fields-manage-modal';
import AssigneePickerModal from '../../company-overview/assignee-picker-modal/assignee-picker-modal';
import DriveLargeFileWarningModal from '../../shared/drive-large-file-warning-modal/drive-large-file-warning-modal';
import './add-company-modal.css';

import { API_BASE } from '@/config';
import {
  getGoogleMapsApiKey,
  loadGoogleMaps,
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
  const [form, setForm] = useState({
    name: '',
    representativeName: '',
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
    const namePart = sanitizeFolderNamePart(form.name || '미소속');
    const numPart = sanitizeFolderNamePart((form.businessNumber || '').replace(/-/g, '')) || '미등록';
    return `${namePart}_${numPart}`;
  }, [form.name, form.businessNumber]);

  /* Drive 루트 폴더: 수정 모드에서 이미 저장된 driveRootFolderId가 있으면 사용 */
  useEffect(() => {
    if (!isEdit || !company?.driveRootFolderId) {
      setDriveFolderId(null);
      setDriveFolderLink('');
      return;
    }
    const storedFolderId = String(company.driveRootFolderId).trim();
    setDriveFolderId(storedFolderId);
    setDriveFolderLink(`https://drive.google.com/drive/folders/${storedFolderId}`);
  }, [isEdit, company?.driveRootFolderId]);

  /* 증서·자료: 루트 아래 information 폴더로 진입 (중복 검사는 백엔드 ensureFolder에서 처리) */
  useEffect(() => {
    if (!driveFolderId || !driveFolderName) {
      setDriveInformationFolderId(null);
      setDriveCurrentFolderId(null);
      setDriveBreadcrumb([]);
      setDriveFilesList([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/drive/folders/ensure`, {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ folderName: INFORMATION_FOLDER_NAME, parentFolderId: driveFolderId })
        });
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok && data.id) {
          setDriveInformationFolderId(data.id);
          setDriveCurrentFolderId(data.id);
          setDriveBreadcrumb([
            { id: driveFolderId, name: driveFolderName },
            { id: data.id, name: INFORMATION_FOLDER_NAME }
          ]);
        } else {
          setDriveInformationFolderId(null);
          setDriveCurrentFolderId(driveFolderId);
          setDriveBreadcrumb([{ id: driveFolderId, name: driveFolderName }]);
        }
      } catch (_) {
        if (!cancelled) {
          setDriveInformationFolderId(null);
          setDriveCurrentFolderId(driveFolderId);
          setDriveBreadcrumb([{ id: driveFolderId, name: driveFolderName }]);
        }
      }
    })();
    return () => { cancelled = true; };
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
      const companyId = isEdit && company?._id ? String(company._id) : null;
      setDriveUploading(true);
      setDriveError('');
      try {
        let parentId = driveCurrentFolderId || driveInformationFolderId || driveFolderId;
        if (!parentId) {
          const r = await fetch(`${API_BASE}/drive/folders/ensure`, {
            method: 'POST',
            headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ folderName: driveFolderName })
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
          if (companyId) {
            fetch(`${API_BASE}/customer-companies/${companyId}`, {
              method: 'PATCH',
              headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ driveRootFolderId: parentId })
            }).then(() => {}).catch(() => {});
          }
          const infoRes = await fetch(`${API_BASE}/drive/folders/ensure`, {
            method: 'POST',
            headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ folderName: INFORMATION_FOLDER_NAME, parentFolderId: parentId })
          });
          const infoData = await infoRes.json().catch(() => ({}));
          if (infoRes.ok && infoData.id) {
            parentId = infoData.id;
            setDriveInformationFolderId(infoData.id);
          }
        } else if (parentId === driveFolderId && driveInformationFolderId) {
          parentId = driveInformationFolderId;
        } else if (parentId === driveFolderId) {
          const infoRes = await fetch(`${API_BASE}/drive/folders/ensure`, {
            method: 'POST',
            headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ folderName: INFORMATION_FOLDER_NAME, parentFolderId: driveFolderId })
          });
          const infoData = await infoRes.json().catch(() => ({}));
          if (infoRes.ok && infoData.id) {
            parentId = infoData.id;
            setDriveInformationFolderId(infoData.id);
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
    [driveFolderName, driveFolderId, driveInformationFolderId, driveCurrentFolderId, fetchDriveFiles, isEdit, company?._id]
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

  /** 주소 옆 지도 버튼: 주소 있으면 위·경도 자동 채우기, 없으면 지도 피커 열기 */
  const onAddressMapClick = () => {
    if ((form.address || '').trim()) {
      geocodeAddressToForm();
    } else {
      setShowMapPicker(true);
    }
  };

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
        }
      }
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setExtractingCertificate(false);
    }
  };

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
    const body = {
      name: form.name.trim(),
      representativeName: form.representativeName.trim() || undefined,
      businessNumber: (form.businessNumber || '').replace(/-/g, '').trim() || undefined,
      address: form.address.trim() || undefined,
      latitude: form.latitude != null && Number.isFinite(Number(form.latitude)) ? Number(form.latitude) : undefined,
      longitude: form.longitude != null && Number.isFinite(Number(form.longitude)) ? Number(form.longitude) : undefined,
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
        let rootFolderId = isEdit && company.driveRootFolderId ? String(company.driveRootFolderId).trim() : null;
        if (!rootFolderId) {
          const namePart = sanitizeFolderNamePart(form.name || '미소속');
          const numPart = sanitizeFolderNamePart((form.businessNumber || '').replace(/-/g, '')) || '미등록';
          const driveFolderName = `${namePart}_${numPart}`;
          const ensureRes = await fetch(`${API_BASE}/drive/folders/ensure`, {
            method: 'POST',
            headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ folderName: driveFolderName })
          });
          const ensureData = await ensureRes.json().catch(() => ({}));
          if (!ensureRes.ok || !ensureData.id) {
            setError(ensureData.error || '고객사는 저장되었으나 Drive 폴더를 준비할 수 없습니다.');
            return;
          }
          rootFolderId = ensureData.id;
        }
        const ensureData = { id: rootFolderId };
        const infoRes = await fetch(`${API_BASE}/drive/folders/ensure`, {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ folderName: INFORMATION_FOLDER_NAME, parentFolderId: ensureData.id })
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
            businessRegistrationCertificateDriveUrl: uploadData.webViewLink,
            driveRootFolderId: ensureData.id
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
                setCertificateFile(file);
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
        ) : (
          <section className="add-company-section">
            <h3 className="add-company-section-title">사업자등록증 업로드</h3>
            <input
              ref={certificateInputRef}
              type="file"
              accept="image/*,.pdf"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setCertificateFile(file);
                e.target.value = '';
                if (file) extractFromCertificateAndFillForm(file);
              }}
              aria-hidden="true"
            />
            <div
              className={`add-company-upload-zone ${certificateDropActive ? 'add-company-upload-zone-active' : ''} ${extractingCertificate ? 'add-company-upload-zone-disabled' : ''}`}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!extractingCertificate) setCertificateDropActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setCertificateDropActive(false); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setCertificateDropActive(false);
                const file = e.dataTransfer?.files?.[0];
                if (file) {
                  setCertificateFile(file);
                  extractFromCertificateAndFillForm(file);
                }
              }}
              onClick={() => { if (!extractingCertificate && certificateInputRef.current) certificateInputRef.current.click(); }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !extractingCertificate && certificateInputRef.current) { e.preventDefault(); certificateInputRef.current.click(); } }}
              aria-label="사업자 등록증 첨부 (드래그 앤 드롭 또는 클릭)"
            >
              <div className="add-company-upload-icon-wrap">
                <span className="material-symbols-outlined add-company-upload-icon">upload_file</span>
              </div>
              {extractingCertificate ? (
                <p className="add-company-upload-title">증빙에서 정보를 읽는 중…</p>
              ) : certificateFile ? (
                <p className="add-company-upload-title add-company-upload-filename">{certificateFile.name}</p>
              ) : (
                <>
                  <p className="add-company-upload-title">파일을 드래그하거나 클릭하여 업로드하세요</p>
                  <p className="add-company-upload-hint">사업자등록증을 업로드하면 정보를 자동으로 입력합니다.</p>
                </>
              )}
            </div>
          </section>
        )}
        {/* 기본 정보 2열 그리드 */}
        <section className="add-company-section add-company-grid-2">
          <div className="add-company-field">
            <label className="add-company-label" htmlFor="add-company-name">고객사명 <span className="add-company-required">*</span></label>
            <input id="add-company-name" name="name" type="text" value={form.name} onChange={handleChange} className="add-company-input" placeholder="고객사명을 입력하세요" required />
          </div>
          <div className="add-company-field">
            <label className="add-company-label" htmlFor="add-company-business-number">사업자등록번호</label>
            <input id="add-company-business-number" name="businessNumber" type="text" inputMode="numeric" autoComplete="off" value={form.businessNumber} onChange={handleChange} className="add-company-input" placeholder="000-00-00000" maxLength={12} />
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
                <button
                  type="button"
                  className="add-company-address-map-btn"
                  onClick={onAddressMapClick}
                  disabled={addressGeocoding}
                  title={form.address?.trim() ? '입력한 주소로 위·경도 자동 채우기' : '지도에서 위치 선택'}
                  aria-label={form.address?.trim() ? '주소로 위·경도 채우기' : '지도에서 위치 선택'}
                >
                  {addressGeocoding ? (
                    <span className="material-symbols-outlined add-company-map-btn-spin">progress_activity</span>
                  ) : (
                    <span className="material-symbols-outlined">map</span>
                  )}
                </button>
              )}
            </div>
          </div>
          <div className="add-company-lat-row">
            <div className="add-company-field">
              <label className="add-company-label add-company-label-muted" htmlFor="add-company-latitude">위도 (Latitude)</label>
              <input id="add-company-latitude" name="latitude" type="text" inputMode="decimal" value={form.latitude != null ? String(form.latitude) : ''} onChange={handleChange} className="add-company-input" placeholder="37.5665" />
            </div>
            <div className="add-company-field">
              <label className="add-company-label add-company-label-muted" htmlFor="add-company-longitude">경도 (Longitude)</label>
              <input id="add-company-longitude" name="longitude" type="text" inputMode="decimal" value={form.longitude != null ? String(form.longitude) : ''} onChange={handleChange} className="add-company-input" placeholder="126.9780" />
            </div>
            <div className="add-company-field add-company-field-btn">
              {GOOGLE_MAPS_API_KEY ? (
                <button type="button" className="add-company-btn-sync" onClick={onAddressMapClick} disabled={addressGeocoding} title="주소로 위·경도 채우기 또는 지도에서 선택">
                  <span className="material-symbols-outlined">sync</span>
                  위치 동기화
                </button>
              ) : (
                <button type="button" className="add-company-btn-sync" onClick={() => geocodeAddressToForm()} disabled={addressGeocoding || !(form.address || '').trim()} title="주소로 위·경도 채우기">
                  <span className="material-symbols-outlined">sync</span>
                  위치 동기화
                </button>
              )}
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
            <button type="button" className="add-company-btn-field-add" onClick={() => setShowCustomFieldsModal(true)}>
              <span className="material-symbols-outlined">add</span>
              필드 추가
            </button>
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
          {showCustomFieldsModal && (
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
                <p className="add-company-map-picker-hint">주소 검색 후 해당 위치로 이동 · 지도 클릭으로 위치 조정 후 확인하면 위도·경도가 저장됩니다.</p>
                <div className="add-company-map-picker-search">
                  <input
                    type="text"
                    value={pickerSearchQuery}
                    onChange={(e) => setPickerSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), pickerSearch())}
                    placeholder="주소 검색 후 해당 위치로 이동"
                  />
                  <button type="button" className="add-company-map-picker-search-btn" onClick={pickerSearch} disabled={pickerSearching}>
                    {pickerSearching ? '검색 중…' : '검색'}
                  </button>
                </div>
                <div ref={mapPickerContainerRef} className="add-company-map-picker-canvas" />
                <div className="add-company-map-picker-actions">
                  <button type="button" className="add-company-map-picker-cancel" onClick={() => setShowMapPicker(false)}>취소</button>
                  <button type="button" className="add-company-map-picker-confirm" onClick={pickerConfirm}>확인 (위·경도 적용)</button>
                </div>
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
      {showCustomFieldsModal && (
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
            <p className="add-company-map-picker-hint">주소 검색 후 해당 위치로 이동 · 지도 클릭으로 위치 조정 후 확인하면 위도·경도가 저장됩니다.</p>
            <div className="add-company-map-picker-search">
              <input
                type="text"
                value={pickerSearchQuery}
                onChange={(e) => setPickerSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), pickerSearch())}
                placeholder="주소 검색 후 해당 위치로 이동"
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
              <button type="button" className="add-company-map-picker-confirm" onClick={pickerConfirm}>
                확인 (위·경도 적용)
              </button>
            </div>
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
    </div>
  );
}
