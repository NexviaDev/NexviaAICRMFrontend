import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import CustomerCompanyDetailModal from '../customer-companies/customer-company-detail-modal/customer-company-detail-modal';
import './map.css';

import { API_BASE } from '@/config';
// 지도 도메인 경고("이 웹사이트의 소유자이신가요?") 제거: Google Cloud Console → API 및 서비스 → 사용자 인증 정보 → 해당 키 → 애플리케이션 제한사항 → HTTP 리퍼러에 http://localhost:3000/*, https://실서비스도메인/* 추가
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }; // 서울
const DEFAULT_ZOOM = 11; // 주변 약 30km 이내가 보이도록

/** 지도 기본 스타일 (POI·대중교통 숨김) */
const BASE_MAP_STYLES = [
  { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] }
];

/** 지도 흑백 스타일 (채도 -100 = 완전 흑백, 기본 숨김 유지) */
const GRAYSCALE_MAP_STYLES = [
  { featureType: 'all', stylers: [{ saturation: -100 }] },
  { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] }
];

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 위치 API 옵션: 지하철·이동 시 정확도·실시간 반영용 (고정밀 + 캐시 미사용) */
const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,  // GPS 우선 사용 → 실내/지하철에서도 가능한 한 정확도 향상
  maximumAge: 0,             // 캐시 사용 안 함 → 미세한 실시간 이동 반영
  timeout: 20000             // 첫 위치 대기 20초 (지하철/실내에서는 응답이 느릴 수 있음)
};

/** Google Maps 스크립트 비동기 로드 (loading=async + callback 권장 방식) */
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
    const check = setInterval(() => {
      if (window.google?.maps?.Map) {
        clearInterval(check);
        onLoad(window.google);
      }
    }, 100);
    return () => clearInterval(check);
  }
  const callbackName = '__nexviaMapInit';
  window[callbackName] = function () {
    window.__googleMapsLoading = false;
    window[callbackName] = null;
    onLoad(window.google);
  };
  window.__googleMapsLoading = true;
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&language=ko&libraries=places&loading=async&callback=${callbackName}`;
  script.async = true;
  script.defer = true;
  script.onerror = () => {
    window.__googleMapsLoading = false;
    if (window[callbackName]) window[callbackName] = null;
    onLoad(null);
  };
  document.head.appendChild(script);
}

export default function Map() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [selected, setSelected] = useState(null);
  const [myLocation, setMyLocation] = useState(null);
  const [liveLocationOn, setLiveLocationOn] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const watchIdRef = useRef(null);
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const searchInputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const markersRef = useRef([]);
  const myLocationMarkerRef = useRef(null);
  const lastDisplayedPositionRef = useRef(null); // 부드러운 이동용: 마지막으로 그린 위치
  const locationAnimationFrameRef = useRef(null); // 진행 중인 위치 애니메이션 취소용
  const searchPlaceMarkerRef = useRef(null);
  const markerLabelsRef = useRef([]); // 마커별 말주머니(업체명) InfoWindow 목록
  const initialViewAppliedRef = useRef(false); // 초기 뷰(내 위치/고객사)는 한 번만 적용 → 검색 후 화면이 덮어쓰이지 않도록
  const [showMarkerLabels, setShowMarkerLabels] = useState(false); // 업체명 말주머니 표시 (기본 끔)
  const [searchPlace, setSearchPlace] = useState(null); // Google 검색한 장소 { lat, lng, label }
  const [searchPlaceLoading, setSearchPlaceLoading] = useState(false);
  const [showSearchPlaceMarker, setShowSearchPlaceMarker] = useState(false); // 구글 검색 장소 뱃지 표시 (검색 시 자동 켜짐)
  const [grayscaleMode, setGrayscaleMode] = useState(false); // 지도 흑백 모드
  const [headingFollowOn, setHeadingFollowOn] = useState(false); // 기기 방향에 맞춰 지도 회전 (북이 항상 위가 아님)
  const orientationHandlerRef = useRef(null);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/customer-companies?limit=500`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) {
        setCompanies(data.items);
      } else {
        setCompanies([]);
      }
    } catch (_) {
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  // 지도 탭/창을 다시 열었을 때 최신 고객사 목록 반영
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchCompanies();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [fetchCompanies]);

  // 마운트 시점에 바로 내 위치 요청 (지도보다 먼저 받아서 처음부터 내 위치로 보이게)
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      GEOLOCATION_OPTIONS
    );
  }, []);

  // 지도 로드 시점에 아직 위치가 없으면 한 번 더 내 위치 요청
  useEffect(() => {
    if (!mapReady || !navigator.geolocation || myLocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      GEOLOCATION_OPTIONS
    );
  }, [mapReady, myLocation]);

  const companiesWithCoords = companies.filter((c) => c.latitude != null && c.longitude != null);
  // 지도에는 위경도 있는 고객사는 항상 전부 표시 (검색창은 구글 장소 이동용이라 고객사 필터에 쓰지 않음)
  const companiesToShowOnMap = companiesWithCoords;

  const startLiveLocation = useCallback(() => {
    if (!navigator.geolocation) {
      alert('이 브라우저에서는 현재 위치를 사용할 수 없습니다.');
      return;
    }
    if (watchIdRef.current != null) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => alert('위치를 가져올 수 없습니다.'),
      GEOLOCATION_OPTIONS
    );
    watchIdRef.current = watchId;
    setLiveLocationOn(true);
  }, []);

  const stopLiveLocation = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setLiveLocationOn(false);
    setMyLocation(null);
    if (myLocationMarkerRef.current) {
      myLocationMarkerRef.current.setMap(null);
      myLocationMarkerRef.current = null;
    }
  }, []);

  // 실시간 내 위치 기본 켜기: 지도 준비되면 watch 시작
  useEffect(() => {
    if (!mapReady || !navigator.geolocation || !liveLocationOn) return;
    startLiveLocation();
  }, [mapReady, liveLocationOn, startLiveLocation]);

  // 기기 방향(나침반)에 맞춰 지도 회전 — 핸드폰에서 보는 방향이 위쪽
  useEffect(() => {
    if (!headingFollowOn || !mapInstanceRef.current) return;

    const setMapHeading = (degrees) => {
      const map = mapInstanceRef.current;
      if (!map || typeof map.setHeading !== 'function') return;
      let h = Number(degrees);
      if (Number.isNaN(h)) return;
      while (h < 0) h += 360;
      while (h >= 360) h -= 360;
      map.setHeading(h);
    };

    const onOrientation = (e) => {
      const raw = e.webkitCompassHeading != null ? e.webkitCompassHeading : e.alpha;
      if (raw == null || typeof raw !== 'number') return;
      let h = raw;
      while (h < 0) h += 360;
      while (h >= 360) h -= 360;
      setMapHeading(h);
    };

    orientationHandlerRef.current = onOrientation;
    window.addEventListener('deviceorientation', onOrientation, { passive: true });

    return () => {
      window.removeEventListener('deviceorientation', onOrientation);
      orientationHandlerRef.current = null;
      if (mapInstanceRef.current && typeof mapInstanceRef.current.setHeading === 'function') {
        mapInstanceRef.current.setHeading(0);
      }
    };
  }, [headingFollowOn]);

  const toggleHeadingFollow = useCallback(async () => {
    if (headingFollowOn) {
      setHeadingFollowOn(false);
      return;
    }
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') {
          alert('방향 센서 사용이 허용되지 않았습니다. 설정에서 권한을 켜 주세요.');
          return;
        }
      } catch (err) {
        alert('방향 센서 권한을 요청할 수 없습니다. ' + (err.message || ''));
        return;
      }
    }
    setHeadingFollowOn(true);
  }, [headingFollowOn]);

  useEffect(() => {
    return () => {
      if (locationAnimationFrameRef.current != null) cancelAnimationFrame(locationAnimationFrameRef.current);
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      if (myLocationMarkerRef.current) {
        myLocationMarkerRef.current.setMap(null);
      }
      if (searchPlaceMarkerRef.current) {
        searchPlaceMarkerRef.current.setMap(null);
      }
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    loadGoogleMaps((google) => {
      if (!google || !mapContainerRef.current) {
        setMapReady(false);
        return;
      }
      const map = new google.maps.Map(mapContainerRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: false,
        gestureHandling: 'greedy', // 지도 위에서는 Ctrl 없이 스크롤로 확대/축소, 해당 안내 문구 비표시
        styles: BASE_MAP_STYLES
      });
      mapInstanceRef.current = map;
      setMapReady(true);
    });
  }, []);

  // 흑백 모드 토글 시 지도 스타일 적용
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    mapInstanceRef.current.setOptions({
      styles: grayscaleMode ? GRAYSCALE_MAP_STYLES : BASE_MAP_STYLES
    });
  }, [mapReady, grayscaleMode]);

  // 구글 "이 웹사이트의 소유자이신가요?" 경고 창 숨김 — 검색 입력 시 body 등에 주입되는 요소 감지
  useEffect(() => {
    const hideGoogleOwnerDialog = (node) => {
      if (!node || typeof node.querySelector !== 'function') return;
      const text = node.textContent || '';
      if (text.includes('이 웹사이트의 소유자') || text.includes('제대로 로드할 수 없습니다')) {
        const el = node.nodeType === 1 ? node : node.parentElement;
        if (el && el.style) {
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('visibility', 'hidden', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
        }
      }
      node.querySelectorAll?.('iframe[title*="소유자"], iframe[title*="owner"], .gm-style-cc, .gm-err-container, .gm-err-content').forEach((n) => {
        if (n && n.style) {
          n.style.setProperty('display', 'none', 'important');
          n.style.setProperty('visibility', 'hidden', 'important');
        }
      });
    };
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((n) => {
          if (n && n.nodeType === 1) hideGoogleOwnerDialog(n);
          if (n && n.nodeType === 1 && n.children) {
            Array.from(n.children).forEach(hideGoogleOwnerDialog);
          }
        });
      });
    });
    // 이미 존재하는 경고 요소 숨김 (알려진 선택자)
    document.querySelectorAll('.gm-style-cc, .gm-err-container, .gm-err-content, iframe[title*="소유자"], iframe[title*="owner"]').forEach((el) => {
      if (el && el.style) {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Google Places 자동완성: 주소·장소명 검색 시 구글 제안 목록 표시
  useEffect(() => {
    if (!mapReady || !window.google?.maps?.places || !searchInputRef.current) return;
    if (autocompleteRef.current) return; // 이미 붙였으면 스킵
    const autocomplete = new window.google.maps.places.Autocomplete(searchInputRef.current, {
      types: ['establishment', 'geocode'],
      fields: ['geometry', 'name', 'formatted_address'],
      language: 'ko'
    });
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (!place?.geometry?.location) return;
      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      const label = place.name || place.formatted_address || searchInput.trim();
      setSearchPlace({ lat, lng, label });
      setShowSearchPlaceMarker(true); // 구글 검색 장소에 뱃지 자동 표시
      setSearchInput(place.formatted_address || place.name || label);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.panTo({ lat, lng });
        mapInstanceRef.current.setZoom(14);
        initialViewAppliedRef.current = true; // 검색 결과로 화면 고정, 이후 초기 뷰로 덮어쓰지 않음
      }
    });
    autocompleteRef.current = autocomplete;
    return () => {
      if (window.google?.maps?.event && autocompleteRef.current) {
        window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
      autocompleteRef.current = null;
    };
  }, [mapReady]);

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.google) return;
    const map = mapInstanceRef.current;
    markerLabelsRef.current.forEach((iw) => iw.close());
    markerLabelsRef.current = [];
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const companyName = (name) => (name && String(name).trim()) || '(업체명 없음)';
    const labelContent = (name) =>
      '<div style="padding:6px 10px;font-size:13px;max-width:220px;border-radius:8px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.15);border:1px solid #e0e0e0;">' +
      (companyName(name).replace(/</g, '&lt;').replace(/>/g, '&gt;')) +
      '</div>';

    companiesToShowOnMap.forEach((company) => {
      const lat = company.latitude;
      const lng = company.longitude;
      if (lat == null || lng == null) return;
      const marker = new window.google.maps.Marker({
        position: { lat, lng },
        map,
        title: company.name || '',
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: '#ccff00',
          fillOpacity: 1,
          strokeColor: '#333',
          strokeWeight: 2
        }
      });
      marker.addListener('click', () => setSelected(company));
      const iw = new window.google.maps.InfoWindow({
        content: labelContent(company.name),
        pixelOffset: new window.google.maps.Size(0, -10)
      });
      markerLabelsRef.current.push(iw);
      if (showMarkerLabels) iw.open(map, marker);
      markersRef.current.push(marker);
    });

    // 처음 보이는 뷰: 한 번만 적용 (이후 검색으로 이동한 화면이 덮어쓰이지 않도록)
    if (!initialViewAppliedRef.current) {
      if (myLocation) {
        map.panTo({ lat: myLocation.lat, lng: myLocation.lng });
        map.setZoom(15); // 내 위치 주변으로 확대 (약 2~3km)
        initialViewAppliedRef.current = true;
      } else if (companiesToShowOnMap.length === 1) {
        const c = companiesToShowOnMap[0];
        if (c.latitude != null && c.longitude != null) {
          map.panTo({ lat: c.latitude, lng: c.longitude });
          map.setZoom(14);
          initialViewAppliedRef.current = true;
        }
      } else if (companiesToShowOnMap.length > 1) {
        const bounds = new window.google.maps.LatLngBounds();
        companiesToShowOnMap.forEach((c) => {
          if (c.latitude != null && c.longitude != null) bounds.extend({ lat: c.latitude, lng: c.longitude });
        });
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
          initialViewAppliedRef.current = true;
        }
      }
    }
  }, [mapReady, companiesToShowOnMap, showMarkerLabels, myLocation]);

  // Google 검색한 장소 마커 (주황색) — showSearchPlaceMarker 켜져 있을 때만 표시
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.google) return;
    if (searchPlaceMarkerRef.current) {
      searchPlaceMarkerRef.current.setMap(null);
      searchPlaceMarkerRef.current = null;
    }
    if (!showSearchPlaceMarker || !searchPlace) return;
    const marker = new window.google.maps.Marker({
      position: { lat: searchPlace.lat, lng: searchPlace.lng },
      map: mapInstanceRef.current,
      title: searchPlace.label,
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 12,
        fillColor: '#fb8c00',
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 2
      },
      zIndex: 50
    });
    searchPlaceMarkerRef.current = marker;
    return () => {
      if (searchPlaceMarkerRef.current) {
        searchPlaceMarkerRef.current.setMap(null);
        searchPlaceMarkerRef.current = null;
      }
    };
  }, [mapReady, searchPlace, showSearchPlaceMarker]);

  // 내 위치 마커 생성/갱신 — 갱신 시 부드럽게 이동 (카카오맵·티맵처럼 실시간 미세 이동 느낌)
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.google) return;
    if (!myLocation) {
      lastDisplayedPositionRef.current = null;
      if (locationAnimationFrameRef.current != null) cancelAnimationFrame(locationAnimationFrameRef.current);
      if (myLocationMarkerRef.current) {
        myLocationMarkerRef.current.setMap(null);
        myLocationMarkerRef.current = null;
      }
      return;
    }
    const target = { lat: myLocation.lat, lng: myLocation.lng };
    const marker = myLocationMarkerRef.current;
    if (marker) {
      const from = lastDisplayedPositionRef.current ?? (() => {
        const p = marker.getPosition();
        return p ? { lat: p.lat(), lng: p.lng() } : target;
      })();
      lastDisplayedPositionRef.current = target;
      if (locationAnimationFrameRef.current != null) cancelAnimationFrame(locationAnimationFrameRef.current);
      const DURATION_MS = 450;
      const start = performance.now();
      const easeOutCubic = (t) => 1 - (1 - t) ** 3;
      const tick = () => {
        const elapsed = performance.now() - start;
        const t = Math.min(1, elapsed / DURATION_MS);
        const k = easeOutCubic(t);
        const lat = from.lat + (target.lat - from.lat) * k;
        const lng = from.lng + (target.lng - from.lng) * k;
        if (myLocationMarkerRef.current) myLocationMarkerRef.current.setPosition({ lat, lng });
        if (t < 1) locationAnimationFrameRef.current = requestAnimationFrame(tick);
      };
      locationAnimationFrameRef.current = requestAnimationFrame(tick);
      return;
    }
    lastDisplayedPositionRef.current = target;
    const newMarker = new window.google.maps.Marker({
      position: target,
      map: mapInstanceRef.current,
      title: '내 위치',
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 12,
        fillColor: '#e53935',
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 3
      },
      zIndex: 100
    });
    myLocationMarkerRef.current = newMarker;
    mapInstanceRef.current.panTo(target);
    mapInstanceRef.current.setZoom(15); // 내 위치 주변으로 확대 (약 2~3km)
  }, [mapReady, myLocation]);

  /** 검색창 입력으로 Google 지오코딩 후 해당 위치로 지도 이동 + 마커 표시 */
  const goToSearchPlace = useCallback(() => {
    const query = searchInput.trim();
    if (!query || !mapReady || !window.google?.maps?.Geocoder) return;
    setSearchPlaceLoading(true);
    setSearchPlace(null);
    if (searchPlaceMarkerRef.current) {
      searchPlaceMarkerRef.current.setMap(null);
      searchPlaceMarkerRef.current = null;
    }
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ address: query }, (results, status) => {
      setSearchPlaceLoading(false);
      if (status !== window.google.maps.GeocoderStatus.OK || !results?.[0]?.geometry?.location) {
        return;
      }
      const loc = results[0].geometry.location;
      const lat = loc.lat();
      const lng = loc.lng();
      const label = results[0].formatted_address || query;
      setSearchPlace({ lat, lng, label });
      setShowSearchPlaceMarker(true); // 구글 검색 장소에 뱃지 자동 표시
      if (mapInstanceRef.current) {
        mapInstanceRef.current.panTo({ lat, lng });
        mapInstanceRef.current.setZoom(14);
        initialViewAppliedRef.current = true; // 검색 결과로 화면 고정, 이후 초기 뷰로 덮어쓰지 않음
      }
    });
  }, [searchInput, mapReady]);

  const zoomIn = () => {
    if (mapInstanceRef.current) {
      const z = mapInstanceRef.current.getZoom();
      mapInstanceRef.current.setZoom(Math.min(20, (z || DEFAULT_ZOOM) + 1));
    }
  };

  const zoomOut = () => {
    if (mapInstanceRef.current) {
      const z = mapInstanceRef.current.getZoom();
      mapInstanceRef.current.setZoom(Math.max(1, (z || DEFAULT_ZOOM) - 1));
    }
  };

  const goToMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMyLocation(loc);
        if (mapInstanceRef.current) {
          mapInstanceRef.current.panTo(loc);
          mapInstanceRef.current.setZoom(15); // 내 위치 주변으로 확대
        }
      },
      () => alert('위치를 가져올 수 없습니다.'),
      GEOLOCATION_OPTIONS
    );
  };

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="page map-page">
        <div className="map-fallback">
          <span className="material-symbols-outlined map-fallback-icon">map</span>
          <p>지도를 사용하려면 <code>VITE_GOOGLE_MAPS_API_KEY</code>를 설정해 주세요.</p>
          <p className="map-fallback-hint">frontend/.env 에 추가 후 개발 서버를 재시작하세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page map-page">
      <div className="map-layout">
        <div className="map-main">
          <div ref={mapContainerRef} className="map-canvas map-canvas-google" />

          <div className="map-top-bar">
            <div className="map-controls">
              <div className="map-zoom-btns">
                <button type="button" className="map-ctrl-btn" onClick={zoomIn} aria-label="확대">
                  <span className="material-symbols-outlined">add</span>
                </button>
                <button type="button" className="map-ctrl-btn" onClick={zoomOut} aria-label="축소">
                  <span className="material-symbols-outlined">remove</span>
                </button>
              </div>
              <button
                type="button"
                className={`map-ctrl-btn map-ctrl-btn-circle ${showMarkerLabels ? 'active' : ''}`}
                onClick={() => setShowMarkerLabels((v) => !v)}
                aria-label={showMarkerLabels ? '업체명 말주머니 끄기' : '업체명 말주머니 켜기'}
                title={showMarkerLabels ? '업체명 말주머니 끄기' : '업체명 말주머니 켜기'}
              >
                <span className="material-symbols-outlined">label</span>
              </button>
              <button
                type="button"
                className={`map-ctrl-btn map-ctrl-btn-circle ${liveLocationOn ? 'active' : ''}`}
                onClick={liveLocationOn ? stopLiveLocation : startLiveLocation}
                aria-label={liveLocationOn ? '실시간 위치 끄기' : '내 위치 (실시간)'}
                title={liveLocationOn ? '실시간 위치 끄기' : '실시간 내 위치 켜기'}
              >
                <span className="material-symbols-outlined">my_location</span>
              </button>
              <button
                type="button"
                className={`map-ctrl-btn map-ctrl-btn-circle ${showSearchPlaceMarker ? 'active' : ''}`}
                onClick={() => setShowSearchPlaceMarker((v) => !v)}
                aria-label={showSearchPlaceMarker ? '검색 위치 마커 끄기' : '검색 위치 마커 켜기'}
                title={showSearchPlaceMarker ? '검색 위치 마커 끄기' : '검색 위치 마커 켜기'}
              >
                <span className="material-symbols-outlined">place</span>
              </button>
              <button
                type="button"
                className={`map-ctrl-btn map-ctrl-btn-circle ${grayscaleMode ? 'active' : ''}`}
                onClick={() => setGrayscaleMode((v) => !v)}
                aria-label={grayscaleMode ? '지도 컬러 모드' : '지도 흑백 모드'}
                title={grayscaleMode ? '지도 컬러 모드로 전환' : '지도 흑백 모드로 전환'}
              >
                <span className="material-symbols-outlined">tonality</span>
              </button>
              <button
                type="button"
                className={`map-ctrl-btn map-ctrl-btn-circle ${headingFollowOn ? 'active' : ''}`}
                onClick={toggleHeadingFollow}
                aria-label={headingFollowOn ? '방향 따라 회전 끄기 (북쪽 위)' : '방향 따라 회전 켜기'}
                title={headingFollowOn ? '방향 따라 회전 끄기 (북쪽이 항상 위)' : '방향 따라 회전 켜기 (보는 방향이 위, 핸드폰 권장)'}
              >
                <span className="material-symbols-outlined">explore</span>
              </button>
            </div>
          </div>

          <div className="map-search-bar">
            <div className="map-search-wrap">
              <div className="map-search-row">
                <span className="material-symbols-outlined map-search-icon">search</span>
                <input
                  ref={searchInputRef}
                  type="text"
                  className="map-search-input"
                  placeholder="고객사명·주소 또는 구글 장소 검색 (자동완성 또는 엔터)"
                  value={searchInput}
                  onChange={(e) => {
                    setSearchInput(e.target.value);
                    if (!e.target.value.trim()) setSearchPlace(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      goToSearchPlace();
                    }
                  }}
                  aria-label="지도 검색"
                />
                <button
                  type="button"
                  className="map-search-go-btn"
                  onClick={goToSearchPlace}
                  disabled={!searchInput.trim() || searchPlaceLoading}
                  title="입력한 주소·장소로 지도 이동 (Google 검색)"
                  aria-label="장소로 이동"
                >
                  {searchPlaceLoading ? (
                    <span className="material-symbols-outlined map-search-go-spin">progress_activity</span>
                  ) : (
                    <span className="material-symbols-outlined">explore</span>
                  )}
                </button>
              </div>
              {searchInput.trim() && (
                <span className="map-search-result-count">
                  고객사 {companiesToShowOnMap.length}건
                  {searchPlace && (
                    <> · 검색한 구글 장소 뱃지 {showSearchPlaceMarker ? '표시 중' : '끔 (우측 place 버튼으로 켜기)'}</>
                  )}
                </span>
              )}
            </div>
          </div>

          {myLocation && (
            <div className="map-mylocation-panel">
              <div className="map-mylocation-panel-header">
                <span className="material-symbols-outlined">location_on</span>
                <span>현재 위치</span>
                {liveLocationOn && <span className="map-mylocation-live">실시간</span>}
              </div>
              <p className="map-mylocation-coords">
                {myLocation.lat.toFixed(6)}, {myLocation.lng.toFixed(6)}
              </p>
            </div>
          )}

          {mapReady && companiesWithCoords.length === 0 && companies.length > 0 && (
            <div className="map-hint-panel">
              <p>위도·경도가 있는 고객사만 지도에 표시됩니다. 고객사 추가 시 주소를 검색해서 선택하면 자동 저장됩니다.</p>
            </div>
          )}
        </div>

        {selected && (
          <CustomerCompanyDetailModal
            company={selected}
            onClose={() => setSelected(null)}
            onUpdated={fetchCompanies}
            onDeleted={() => {
              setSelected(null);
              fetchCompanies();
            }}
          />
        )}
      </div>
      {loading && (
        <div className="map-loading">
          <span className="material-symbols-outlined">progress_activity</span>
          불러오는 중…
        </div>
      )}
    </div>
  );
}
