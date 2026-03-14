import { useState, useEffect, useRef } from 'react';
import CustomFieldsSection from '../../shared/custom-fields-section';
import CustomFieldsManageModal from '../../shared/custom-fields-manage-modal/custom-fields-manage-modal';
import './add-company-modal.css';

import { API_BASE } from '@/config';
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
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

function loadGoogleMaps(onLoad) {
  if (!GOOGLE_MAPS_API_KEY) {
    onLoad(null);
    return;
  }
  if (window.google?.maps?.Map) {
    onLoad(window.google);
    return;
  }
  if (window.__googleMapsLoading) {
    const t = setInterval(() => {
      if (window.google?.maps?.Map) {
        clearInterval(t);
        onLoad(window.google);
      }
    }, 100);
    return () => clearInterval(t);
  }
  const cb = '__nexviaMapPickerInit';
  window[cb] = function () {
    window.__googleMapsLoading = false;
    window[cb] = null;
    onLoad(window.google);
  };
  window.__googleMapsLoading = true;
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&language=ko&loading=async&callback=${cb}`;
  script.async = true;
  script.defer = true;
  script.onerror = () => {
    window.__googleMapsLoading = false;
    if (window[cb]) window[cb] = null;
    onLoad(null);
  };
  document.head.appendChild(script);
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
    customFields: {}
  });
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
  const mapPickerContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const pickerMarkerRef = useRef(null);

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
    if (!company) return;
    setForm({
      name: company.name ?? '',
      representativeName: company.representativeName ?? '',
      businessNumber: company.businessNumber != null ? formatBusinessNumberInput(String(company.businessNumber)) : '',
      address: company.address ?? '',
      latitude: company.latitude ?? null,
      longitude: company.longitude ?? null,
      memo: company.memo ?? '',
      status: (company.status || 'active').toLowerCase(),
      customFields: company.customFields ? { ...company.customFields } : {}
    });
  }, [company]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showMapPicker) setShowMapPicker(false);
      else if (showCustomFieldsModal) setShowCustomFieldsModal(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showCustomFieldsModal, showMapPicker]);

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
    loadGoogleMaps((google) => {
      if (!google?.maps?.Geocoder) {
        setAddressGeocoding(false);
        return;
      }
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ address }, (results, status) => {
        setAddressGeocoding(false);
        if (status !== google.maps.GeocoderStatus.OK || !results?.[0]?.geometry?.location) return;
        const loc = results[0].geometry.location;
        setForm((prev) => ({
          ...prev,
          latitude: loc.lat(),
          longitude: loc.lng()
        }));
      });
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
    setError('');
    if (!form.name?.trim()) {
      setError('고객사명을 입력해 주세요.');
      return;
    }
    setSaving(true);
    const body = {
      name: form.name.trim(),
      representativeName: form.representativeName.trim() || undefined,
      businessNumber: (form.businessNumber || '').replace(/-/g, '').trim() || undefined,
      address: form.address.trim() || undefined,
      latitude: form.latitude != null && Number.isFinite(Number(form.latitude)) ? Number(form.latitude) : undefined,
      longitude: form.longitude != null && Number.isFinite(Number(form.longitude)) ? Number(form.longitude) : undefined,
      memo: form.memo.trim() || undefined,
      customFields: form.customFields && Object.keys(form.customFields).length ? form.customFields : undefined
    };
    if (isEdit) body.status = form.status;
    try {
      const url = isEdit ? `${API_BASE}/customer-companies/${company._id}` : `${API_BASE}/customer-companies`;
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '저장에 실패했습니다.');
        return;
      }
      if (isEdit) {
        const updated = await res.json();
        onUpdated?.(updated);
      } else {
        onSaved?.();
      }
      onClose?.();
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setSaving(false);
    }
  };

  const formContent = (
    <form onSubmit={handleSubmit} className="add-company-modal-form">
      <div className="add-company-modal-body">
        {error && <p className="add-company-modal-error">{error}</p>}
        <div className="add-company-modal-field">
          <label htmlFor="add-company-name">고객사명 <span className="required">*</span></label>
          <input id="add-company-name" name="name" type="text" value={form.name} onChange={handleChange} placeholder="예: (주)넥스비아" required />
        </div>
        <div className="add-company-modal-field">
          <label htmlFor="add-company-business-number">사업자 번호</label>
          <input id="add-company-business-number" name="businessNumber" type="text" inputMode="numeric" autoComplete="off" value={form.businessNumber} onChange={handleChange} placeholder="123-45-67890 (숫자만 입력)" maxLength={12} />
        </div>
        <div className="add-company-modal-field">
          <label htmlFor="add-company-representative">대표이사명</label>
          <input id="add-company-representative" name="representativeName" type="text" value={form.representativeName} onChange={handleChange} placeholder="선택 입력" />
        </div>
        {isEdit && (
          <div className="add-company-modal-field">
            <label htmlFor="add-company-status">상태</label>
            <select id="add-company-status" name="status" value={form.status} onChange={handleChange}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}
        <div className="add-company-modal-field">
            <label htmlFor="add-company-address">주소</label>
            <div className="add-company-address-wrap">
              <input
                id="add-company-address"
                name="address"
                type="text"
                value={form.address}
                onChange={handleChange}
                placeholder="주소 입력 또는 지도에서 위치 선택"
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
          <div className="add-company-modal-field add-company-modal-field-row add-company-lat-lng-row">
            <div className="add-company-modal-field">
              <label htmlFor="add-company-latitude">위도</label>
              <input
                id="add-company-latitude"
                name="latitude"
                type="text"
                inputMode="decimal"
                value={form.latitude != null ? String(form.latitude) : ''}
                onChange={handleChange}
                placeholder="예: 37.5665"
              />
            </div>
            <div className="add-company-modal-field">
              <label htmlFor="add-company-longitude">경도</label>
              <input
                id="add-company-longitude"
                name="longitude"
                type="text"
                inputMode="decimal"
                value={form.longitude != null ? String(form.longitude) : ''}
                onChange={handleChange}
                placeholder="예: 126.978"
              />
            </div>
            {GOOGLE_MAPS_API_KEY && (
              <button
                type="button"
                className="add-company-lat-lng-edit-btn"
                onClick={openMapPicker}
                title="지도에서 위치 직접 수정"
                aria-label="위치 수정"
              >
                <span className="material-symbols-outlined">edit_location</span>
                수정
              </button>
            )}
          </div>
          <div className="add-company-modal-field">
            <label htmlFor="add-company-memo">메모</label>
            <textarea id="add-company-memo" name="memo" value={form.memo} onChange={handleChange} placeholder="선택 입력" rows={3} />
          </div>
        <CustomFieldsSection
          definitions={customDefinitions}
          values={form.customFields || {}}
          onChangeValues={(key, value) => setForm((prev) => ({
            ...prev,
            customFields: { ...(prev.customFields || {}), [key]: value }
          }))}
          fieldClassName="add-company-modal-field"
        />
      </div>
      <div className="add-company-modal-footer">
        <button type="button" className="add-company-modal-extra" onClick={() => setShowCustomFieldsModal(true)}>
          <span className="material-symbols-outlined">add_circle</span>
          추가 필드
        </button>
        <div className="add-company-modal-footer-actions">
          <button type="button" className="add-company-modal-cancel" onClick={onClose}>취소</button>
          <button type="submit" className="add-company-modal-save" disabled={saving}>
            {saving ? '저장 중...' : isEdit ? '저장' : '고객사 저장'}
          </button>
        </div>
      </div>
    </form>
  );

  if (isEdit) {
    return (
      <>
        <div className="add-company-modal-panel-overlay" aria-hidden="true" />
        <div className="add-company-modal-panel" onClick={(e) => e.stopPropagation()}>
          <div className="add-company-modal-panel-inner">
            <header className="add-company-modal-panel-header">
              <h2>고객사 수정</h2>
              <button type="button" className="add-company-modal-panel-close" onClick={onClose} aria-label="닫기">
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
        </div>
      </>
    );
  }

  return (
    <div className="add-company-modal-overlay">
      <div className="add-company-modal" onClick={(e) => e.stopPropagation()}>
        <div className="add-company-modal-header">
          <h3>새 고객사 추가</h3>
          <button type="button" className="add-company-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
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
    </div>
  );
}
