import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import CustomerCompanyDetailModal from '../customer-companies/customer-company-detail-modal/customer-company-detail-modal';
import './map.css';

import { API_BASE } from '@/config';
// 지도 도메인 경고("이 웹사이트의 소유자이신가요?") 제거: Google Cloud Console → API 및 서비스 → 사용자 인증 정보 → 해당 키 → 애플리케이션 제한사항 → HTTP 리퍼러에 http://localhost:3000/*, https://실서비스도메인/* 추가
// Geolocation API(대략 위치): Console에서 「Geolocation API」 사용 설정 필요(Maps JavaScript API와 별도)
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }; // 서울
const DEFAULT_ZOOM = 11; // 주변 약 30km 이내가 보이도록

/** 지도 기본 스타일 (POI·대중교통 숨김) */
const BASE_MAP_STYLES = [
  { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] }
];

/** 지도 흑백 스타일 (채도 -100 = 완전 흑백, 기본 숨김 유지) */
const GRAYSCALE_MAP_STYLES = [
  { featureType: 'all', stylers: [{ saturation: -100 }] },
  { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] }
];

/** 지도 기본 수역 라벨 대신 항상 고정 표시할 한국 표기 라벨 */
const MAP_KOREA_LABEL_MARKERS = [
  { key: 'east-sea', text: '동해', lat: 37.65, lng: 130.55, className: 'map-korea-label map-korea-label-sea' },
  { key: 'west-sea', text: '서해', lat: 36.55, lng: 124.9, className: 'map-korea-label map-korea-label-sea' },
  { key: 'dokdo', text: '독도', lat: 37.2414, lng: 131.8663, className: 'map-korea-label map-korea-label-dokdo' }
];

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 실시간 추적 옵션
 * - enableHighAccuracy: false → Wi‑Fi/기지국 위치가 먼저 잡혀 첫 점이 훨씬 빠름(GPS는 수십 초 걸릴 수 있음). 정밀도는 다소 낮을 수 있음.
 * - maximumAge > 0 → 직전에 받은 좌표 재사용 허용으로 첫 콜백 지연 완화
 */
const GEOLOCATION_OPTIONS_WATCH = {
  enableHighAccuracy: false,
  maximumAge: 15000,
  timeout: 12000
};

/** 내 위치 켤 때 한 번: 캐시 허용·짧은 타임아웃으로 가능한 빨리 첫 마커 표시 → 이후 watch가 보정 */
const GEOLOCATION_OPTIONS_QUICK_PRIME = {
  enableHighAccuracy: false,
  maximumAge: 300000,
  timeout: 5000
};

/** 실시간 내 위치 반투명 원 — 지표 기준 고정 반경(m). 화면 픽셀 크기와 무관하게 지상 거리는 동일 */
const MY_LOCATION_CIRCLE_RADIUS_M = 2000;
const MY_LOCATION_CIRCLE_FIT_PADDING = { top: 56, right: 48, bottom: 100, left: 48 };

/**
 * PWA·브라우저: navigator.geolocation.
 * Capacitor: `lib/nexvia-native-geolocation.js` 가 네이티브일 때만 `window.__nexviaGeolocation` 주입.
 */
function getGeolocationService() {
  if (typeof window === 'undefined') return null;
  const native = window.__nexviaGeolocation;
  if (
    native &&
    typeof native.getCurrentPosition === 'function' &&
    typeof native.watchPosition === 'function' &&
    typeof native.clearWatch === 'function'
  ) {
    return native;
  }
  return navigator.geolocation || null;
}

/** 평활화 버퍼를 짧게 — 반응은 빨라지고, GPS 튐은 dampLargeJump·이상치 제거로 완화 */
const LOCATION_SAMPLE_MAX_STILL = 4;
const LOCATION_SAMPLE_MAX_MOVING = 3;
const LOCATION_SAMPLE_MAX_AGE_MS = 12000;
/** m/s — 보행(느린 이동)도 빨리 “이동 중” 스무딩으로 전환 */
const LOCATION_SPEED_MOVING_MS = 0.85;
/** 정지 시 “최근 N ms” 샘플만 사용 (이전 18s는 반응이 느려짐) */
const LOCATION_STILL_RECENT_MS = 6000;

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function medianNum(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function removeSpatialOutliers(samples) {
  if (samples.length < 3) return samples;
  const medLat = medianNum(samples.map((s) => s.lat));
  const medLng = medianNum(samples.map((s) => s.lng));
  const medAcc = medianNum(samples.map((s) => s.accuracy));
  const center = { lat: medLat, lng: medLng };
  const thresholdM = Math.max(95, medAcc * 2.2 + 25);
  const filtered = samples.filter((s) => haversineMeters(center, s) <= thresholdM);
  return filtered.length >= 1 ? filtered : samples;
}

function weightedGeolocationMean(buf) {
  if (!buf.length) return null;
  let sw = 0;
  let slat = 0;
  let slng = 0;
  const latestAcc = buf[buf.length - 1].accuracy;
  for (const s of buf) {
    const w = 1 / (s.accuracy * s.accuracy + 1);
    sw += w;
    slat += s.lat * w;
    slng += s.lng * w;
  }
  return { lat: slat / sw, lng: slng / sw, accuracy: latestAcc };
}

function dampLargeJump(prev, next) {
  if (!prev) return next;
  if (prev.accuracy >= 85 && next.accuracy < prev.accuracy * 0.72 && next.accuracy < 140) {
    return next;
  }
  const d = haversineMeters(prev, next);
  const maxJump = 4.2 * Math.max(next.accuracy, prev.accuracy || 50, 20) + 40;
  if (d <= maxJump || next.accuracy <= 55) return next;
  const t = Math.min(0.58, maxJump / d);
  return {
    lat: prev.lat + (next.lat - prev.lat) * t,
    lng: prev.lng + (next.lng - prev.lng) * t,
    accuracy: Math.max(next.accuracy, prev.accuracy || 0)
  };
}

/**
 * @param {{ current: Array<{ lat: number, lng: number, accuracy: number, ts: number }> }} bufferRef
 */
function pushGeolocationSample(bufferRef, pos) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const rawAcc = pos.coords.accuracy;
  const accuracy = typeof rawAcc === 'number' && rawAcc > 0 ? rawAcc : 150;
  const speed = pos.coords.speed;
  const ts = Date.now();
  const buf = bufferRef.current;
  buf.push({ lat, lng, accuracy, ts });

  const cutoff = ts - LOCATION_SAMPLE_MAX_AGE_MS;
  bufferRef.current = buf.filter((s) => s.ts >= cutoff);

  const maxSamples =
    speed != null && !Number.isNaN(speed) && speed > LOCATION_SPEED_MOVING_MS
      ? LOCATION_SAMPLE_MAX_MOVING
      : LOCATION_SAMPLE_MAX_STILL;
  while (bufferRef.current.length > maxSamples) bufferRef.current.shift();

  const raw = bufferRef.current.map(({ lat: la, lng: ln, accuracy: ac, ts: t }) => ({
    lat: la,
    lng: ln,
    accuracy: ac,
    ts: t
  }));
  const spatial = removeSpatialOutliers(raw);
  const moving = speed != null && !Number.isNaN(speed) && speed > LOCATION_SPEED_MOVING_MS;

  if (moving) {
    const wMean = weightedGeolocationMean(
      spatial.map(({ lat: la, lng: ln, accuracy: ac }) => ({ lat: la, lng: ln, accuracy: ac }))
    );
    return wMean;
  }

  const now = Date.now();
  const recent = spatial.filter((s) => now - s.ts < LOCATION_STILL_RECENT_MS);
  const pool = recent.length ? recent : spatial;
  const sorted = [...pool].sort((a, b) => a.accuracy - b.accuracy);
  const top = sorted.slice(0, Math.min(3, sorted.length));
  if (top.length === 1) {
    return { lat: top[0].lat, lng: top[0].lng, accuracy: top[0].accuracy };
  }
  let sw = 0;
  let slat = 0;
  let slng = 0;
  for (const s of top) {
    const w = 1 / (s.accuracy * s.accuracy + 1);
    sw += w;
    slat += s.lat * w;
    slng += s.lng * w;
  }
  return { lat: slat / sw, lng: slng / sw, accuracy: top[0].accuracy };
}

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

/**
 * Google Geolocation API — https://developers.google.com/maps/documentation/geolocation/overview
 *
 * 웹 브라우저는 보안상 Wi‑Fi AP 목록·기지국 정보를 JS에 넘기지 않아, Geolocation API의 “풀 스펙”(Wi‑Fi/셀 혼합)은
 * 네이티브 앱에서만 의미가 큼. 여기서는 { considerIp: true } 만 사용 → 요청을 보낸 **클라이언트 IP** 기반 대략 위치.
 * GPS/브라우저 geolocation보다 거칠지만 초기 지도 중심을 서울 고정보다 나을 수 있음.
 *
 * 백엔드 프록시로 호출하면 Google이 보는 IP가 서버라 사용자 위치가 아니게 되므로, 브라우저에서 직접 호출(키는 지도와 동일하게 이미 클라이언트에 있음).
 *
 * 403: Cloud Console에서「Geolocation API」사용 설정·결제·키 제한 확인. 반복 호출은 세션에서 건너뜀(콘솔 스팸 완화).
 * 완전히 끄려면 .env 에 VITE_SKIP_GOOGLE_CONSIDER_IP=true
 */
const GEOLOCATE_CONSIDER_IP_SKIP_KEY = 'nexvia_geolocate_consider_ip_skip';

async function fetchGoogleConsiderIpApproximate(apiKey) {
  if (!apiKey || typeof fetch === 'undefined') return null;
  if (import.meta.env.VITE_SKIP_GOOGLE_CONSIDER_IP === 'true') return null;
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(GEOLOCATE_CONSIDER_IP_SKIP_KEY) === '1') {
      return null;
    }
    const res = await fetch(
      `https://www.googleapis.com/geolocation/v1/geolocate?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ considerIp: true })
      }
    );
    if (res.status === 403 || res.status === 401) {
      try {
        sessionStorage.setItem(GEOLOCATE_CONSIDER_IP_SKIP_KEY, '1');
      } catch {
        /* 사생활 모드 등 */
      }
      return null;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) return null;
    const loc = data.location;
    if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return null;
    const accuracy = typeof data.accuracy === 'number' && data.accuracy > 0 ? data.accuracy : 5000;
    return { lat: loc.lat, lng: loc.lng, accuracy };
  } catch {
    return null;
  }
}

function zoomForGoogleIpAccuracyMeters(acc) {
  if (acc >= 25000) return 9;
  if (acc >= 12000) return 10;
  if (acc >= 6000) return 11;
  return 12;
}

/** 검색어로 등록 고객사 매칭 (위·경도가 있는 항목만). 부분 일치·완전 일치 */
function matchCompaniesBySearchQuery(companies, rawQuery) {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return [];
  return companies.filter((c) => {
    if (c.latitude == null || c.longitude == null) return false;
    const name = (c.name && String(c.name).trim()) || '';
    if (!name) return false;
    const nl = name.toLowerCase();
    return nl === q || nl.includes(q) || q.includes(nl);
  });
}

export default function Map({
  embedded = false,
  initialFocusCompanyId = null,
  initialOpenCompanyModal = false,
  initialZoom = 16,
  assigneeMeOnlyDefault = true,
  allowCompanyDetailModal = true
} = {}) {
  const mapDataYear = new Date().getFullYear();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusCompanyId = embedded ? initialFocusCompanyId : searchParams.get('focusCompanyId');
  const focusNameFromUrl = embedded ? null : searchParams.get('focusName');
  const openCompanyModal = embedded ? Boolean(initialOpenCompanyModal) : searchParams.get('openCompanyModal') === '1';
  const requestedZoom = embedded ? Number(initialZoom) : Number(searchParams.get('zoom'));
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  /** URL로 특정 고객사 포커스 시에는 전체 목록을 불러와 해당 건이 누락되지 않게 함 */
  const [assigneeMeOnly, setAssigneeMeOnly] = useState(
    () => (!embedded && focusCompanyId ? false : assigneeMeOnlyDefault)
  );
  /** 고객사 상세에서 넘어올 때 검색창에 업체명을 바로 채움 */
  const [searchInput, setSearchInput] = useState(
    () => (focusNameFromUrl && String(focusNameFromUrl).trim()) || ''
  );
  const [selected, setSelected] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const searchInputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const markersRef = useRef([]);
  const koreaLabelMarkersRef = useRef([]);
  const koreaLabelListenersRef = useRef([]);
  const searchPlaceMarkerRef = useRef(null);
  const markerLabelsRef = useRef([]); // 마커별 말주머니(업체명) InfoWindow 목록
  const initialViewAppliedRef = useRef(false); // 초기 뷰(내 위치/고객사 fit 등)는 한 번만 적용 → 검색 후 화면이 덮어쓰이지 않도록
  const [showMarkerLabels, setShowMarkerLabels] = useState(false); // 업체명 말주머니 표시 (기본 끔)
  const [searchPlace, setSearchPlace] = useState(null); // Google 검색한 장소 { lat, lng, label }
  const [searchPlaceLoading, setSearchPlaceLoading] = useState(false);
  const [showSearchPlaceMarker, setShowSearchPlaceMarker] = useState(false); // 구글 검색 장소 뱃지 표시 (검색 시 자동 켜짐)
  const [grayscaleMode, setGrayscaleMode] = useState(false); // 지도 흑백 모드
  const [headingFollowOn, setHeadingFollowOn] = useState(false); // 기기 방향에 맞춰 지도 회전 (북이 항상 위가 아님)
  const orientationHandlerRef = useRef(null);
  const [myLocation, setMyLocation] = useState(null);
  const [liveLocationOn, setLiveLocationOn] = useState(false);
  const watchIdRef = useRef(null);
  const locationSamplesRef = useRef([]);
  const myLocationAccuracyCircleRef = useRef(null);
  const lastRefinedLocationRef = useRef(null);
  const focusRequestHandledRef = useRef(false);
  /** 지도 검색으로 붙인 focusCompanyId 등은 URL에 남김 — 외부 딥링크 처리 후에는 제거 */
  const skipStripFocusParamsRef = useRef(false);

  useEffect(() => {
    focusRequestHandledRef.current = false;
  }, [focusCompanyId]);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (assigneeMeOnly) params.set('assigneeMe', '1');
      const res = await fetch(`${API_BASE}/customer-companies?${params.toString()}`, { headers: getAuthHeader() });
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
  }, [assigneeMeOnly]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  useEffect(() => {
    initialViewAppliedRef.current = false;
  }, [assigneeMeOnly]);

  // 지도 탭/창을 다시 열었을 때 최신 고객사 목록 반영
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchCompanies();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [fetchCompanies]);

  const startLiveLocation = useCallback(() => {
    const geo = getGeolocationService();
    if (!geo) return;
    if (watchIdRef.current != null) return;
    locationSamplesRef.current = [];
    lastRefinedLocationRef.current = null;

    const applyPos = (pos) => {
      const w = pushGeolocationSample(locationSamplesRef, pos);
      if (!w) return;
      const damped = dampLargeJump(lastRefinedLocationRef.current, w);
      lastRefinedLocationRef.current = damped;
      setMyLocation({ lat: damped.lat, lng: damped.lng, accuracy: damped.accuracy });
    };

    try {
      geo.getCurrentPosition(applyPos, () => {}, GEOLOCATION_OPTIONS_QUICK_PRIME);
    } catch {
      /* 일부 환경에서 동기 throw */
    }

    const watchId = geo.watchPosition(applyPos, () => {}, GEOLOCATION_OPTIONS_WATCH);
    watchIdRef.current = watchId;
    setLiveLocationOn(true);
  }, []);

  const stopLiveLocation = useCallback(() => {
    if (watchIdRef.current != null) {
      getGeolocationService()?.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    locationSamplesRef.current = [];
    lastRefinedLocationRef.current = null;
    setLiveLocationOn(false);
    setMyLocation(null);
    const circle = myLocationAccuracyCircleRef.current;
    if (circle) {
      circle.setMap(null);
      myLocationAccuracyCircleRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!liveLocationOn) return;
    let cancelled = false;
    const lockRef = { current: null };

    const requestLock = async () => {
      try {
        if (cancelled || typeof navigator === 'undefined' || !navigator.wakeLock?.request) return;
        if (document.visibilityState !== 'visible') return;
        lockRef.current?.release?.().catch?.(() => {});
        lockRef.current = await navigator.wakeLock.request('screen');
      } catch {
        /* 미지원·거부 */
      }
    };

    void requestLock();

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && liveLocationOn && !cancelled) void requestLock();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      lockRef.current?.release?.().catch?.(() => {});
      lockRef.current = null;
    };
  }, [liveLocationOn]);

  const companiesWithCoords = companies.filter((c) => c.latitude != null && c.longitude != null);
  // 지도에는 위경도 있는 고객사는 항상 전부 표시 (검색창은 구글 장소 이동용이라 고객사 필터에 쓰지 않음)
  const companiesToShowOnMap = companiesWithCoords;

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
        if (permission !== 'granted') return;
      } catch {
        return;
      }
    }
    setHeadingFollowOn(true);
  }, [headingFollowOn]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) {
        getGeolocationService()?.clearWatch(watchIdRef.current);
      }
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      koreaLabelMarkersRef.current.forEach((m) => m.setMap(null));
      koreaLabelMarkersRef.current = [];
      koreaLabelListenersRef.current.forEach((l) => l.remove?.());
      koreaLabelListenersRef.current = [];
      if (myLocationAccuracyCircleRef.current) {
        myLocationAccuracyCircleRef.current.setMap(null);
        myLocationAccuracyCircleRef.current = null;
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

  /** 동해/서해/독도 고정 라벨: 초기 표시 지연 방지를 위해 tilesloaded 시점에도 재확인 */
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.google?.maps?.Marker) return;
    const map = mapInstanceRef.current;
    const ensureKoreaLabels = () => {
      koreaLabelMarkersRef.current.forEach((m) => m.setMap(null));
      koreaLabelMarkersRef.current = MAP_KOREA_LABEL_MARKERS.map((label) =>
        new window.google.maps.Marker({
          position: { lat: label.lat, lng: label.lng },
          map,
          clickable: false,
          draggable: false,
          optimized: false,
          zIndex: 3,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            // scale 0은 일부 환경에서 첫 렌더가 지연될 수 있어 아주 작은 투명 원으로 고정
            scale: 1,
            fillOpacity: 0,
            strokeOpacity: 0
          },
          label: {
            text: label.text,
            className: label.className,
            color: '#1f2937',
            fontSize: '16px',
            fontWeight: '700'
          }
        })
      );
    };

    ensureKoreaLabels();
    const onceTilesLoaded = window.google.maps.event.addListenerOnce(map, 'tilesloaded', ensureKoreaLabels);
    koreaLabelListenersRef.current = [onceTilesLoaded];

    return () => {
      koreaLabelMarkersRef.current.forEach((m) => m.setMap(null));
      koreaLabelMarkersRef.current = [];
      koreaLabelListenersRef.current.forEach((l) => l.remove?.());
      koreaLabelListenersRef.current = [];
    };
  }, [mapReady]);

  // Geolocation API(considerIp): 브라우저 GPS·고객사 초기 뷰보다 먼저 도착하면 대략 지역만 지도 중심으로 잡음(initialViewAppliedRef는 건드리지 않음 → 이후 내 위치/고객사가 덮어씀)
  useEffect(() => {
    if (!mapReady || !GOOGLE_MAPS_API_KEY) return;
    let cancelled = false;
    (async () => {
      const rough = await fetchGoogleConsiderIpApproximate(GOOGLE_MAPS_API_KEY);
      if (cancelled || !rough || !mapInstanceRef.current || initialViewAppliedRef.current) return;
      const map = mapInstanceRef.current;
      map.panTo({ lat: rough.lat, lng: rough.lng });
      map.setZoom(zoomForGoogleIpAccuracyMeters(rough.accuracy));
    })();
    return () => {
      cancelled = true;
    };
  }, [mapReady]);

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
        map.setZoom(15);
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

  // 외부(예: 고객사 상세 모달)에서 전달된 고객사 포커스 요청 처리
  useEffect(() => {
    if (!focusCompanyId || focusRequestHandledRef.current) return;
    const target = companies.find((row) => String(row?._id || '') === String(focusCompanyId));
    if (!target) return;
    const nm = (target.name && String(target.name).trim()) || '';
    if (nm) setSearchInput(nm);
    const lat = Number(target.latitude);
    const lng = Number(target.longitude);
    if (mapReady && mapInstanceRef.current && Number.isFinite(lat) && Number.isFinite(lng)) {
      mapInstanceRef.current.panTo({ lat, lng });
      mapInstanceRef.current.setZoom(Number.isFinite(requestedZoom) ? Math.min(20, Math.max(1, requestedZoom)) : 16);
      initialViewAppliedRef.current = true;
    }
    if (openCompanyModal && allowCompanyDetailModal) setSelected(target);
    focusRequestHandledRef.current = true;
    if (!embedded) {
      if (skipStripFocusParamsRef.current) {
        skipStripFocusParamsRef.current = false;
      } else {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete('focusCompanyId');
          next.delete('focusName');
          next.delete('openCompanyModal');
          next.delete('zoom');
          return next;
        }, { replace: true });
      }
    }
  }, [focusCompanyId, openCompanyModal, companies, mapReady, requestedZoom, setSearchParams, embedded, allowCompanyDetailModal]);

  /** 내 위치 — 지상 반경 고정 원(m). 점 마커 없음. */
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.google) return;
    if (!myLocation) {
      if (myLocationAccuracyCircleRef.current) {
        myLocationAccuracyCircleRef.current.setMap(null);
        myLocationAccuracyCircleRef.current = null;
      }
      return;
    }
    const map = mapInstanceRef.current;
    const center = { lat: myLocation.lat, lng: myLocation.lng };
    const radiusM = MY_LOCATION_CIRCLE_RADIUS_M;
    const fitCircleOnce = () => {
      const circle = myLocationAccuracyCircleRef.current;
      if (!circle || typeof map.fitBounds !== 'function') return;
      const b = circle.getBounds();
      if (!b) return;
      window.google.maps.event.trigger(map, 'resize');
      map.fitBounds(b, MY_LOCATION_CIRCLE_FIT_PADDING);
    };
    if (!myLocationAccuracyCircleRef.current) {
      const circle = new window.google.maps.Circle({
        strokeColor: '#e53935',
        strokeOpacity: 0,
        strokeWeight: 0,
        fillColor: '#e53935',
        fillOpacity: 0.12,
        map,
        center,
        radius: radiusM,
        zIndex: 99,
        clickable: false
      });
      myLocationAccuracyCircleRef.current = circle;
      map.panTo(center);
      fitCircleOnce();
      /* 실제 폰: 레이아웃·주소창 확정 전 getBounds/fitBounds가 틀어지는 경우 보정 (에뮬레이터는 보통 한 번에 맞음) */
      window.setTimeout(fitCircleOnce, 350);
    } else {
      myLocationAccuracyCircleRef.current.setCenter(center);
      myLocationAccuracyCircleRef.current.setRadius(radiusM);
    }
  }, [mapReady, myLocation]);

  /**
   * 실제 모바일에서 visualViewport resize가 과하게 잡혀 줌이 들쭉날쭉해지는 문제 방지:
   * 지도 캔버스 요소의 실제 크기 변화만 ResizeObserver로 재맞춤 (회전·분할 화면 등).
   */
  useEffect(() => {
    if (!mapReady || !liveLocationOn || !myLocation) return;
    const el = mapContainerRef.current;
    const map = mapInstanceRef.current;
    if (!el || !map || typeof ResizeObserver === 'undefined' || !window.google?.maps?.event) return;

    let debounceId = 0;
    let lastW = Math.round(el.getBoundingClientRect().width);
    let lastH = Math.round(el.getBoundingClientRect().height);

    const refitCircleInView = () => {
      const circle = myLocationAccuracyCircleRef.current;
      if (!circle) return;
      const b = circle.getBounds();
      if (!b || typeof map.fitBounds !== 'function') return;
      window.google.maps.event.trigger(map, 'resize');
      map.fitBounds(b, MY_LOCATION_CIRCLE_FIT_PADDING);
    };

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      const w = Math.round(cr.width);
      const h = Math.round(cr.height);
      if (w <= 0 || h <= 0) return;
      if (Math.abs(w - lastW) < 12 && Math.abs(h - lastH) < 12) return;
      lastW = w;
      lastH = h;
      window.clearTimeout(debounceId);
      debounceId = window.setTimeout(refitCircleInView, 120);
    });

    ro.observe(el);

    return () => {
      ro.disconnect();
      window.clearTimeout(debounceId);
    };
  }, [mapReady, liveLocationOn, myLocation]);

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

  const clearFocusParamsFromUrl = useCallback(() => {
    if (embedded) return;
    skipStripFocusParamsRef.current = false;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('focusCompanyId');
      next.delete('focusName');
      next.delete('zoom');
      return next;
    }, { replace: true });
  }, [embedded, setSearchParams]);

  /** 검색: ① 등록 고객사명 우선 → 지도 이동 ② 없으면 Google 지오코딩 */
  const goToSearchPlace = useCallback(() => {
    const query = searchInput.trim();
    if (!query || !mapReady || !window.google?.maps) return;

    let companyHits = matchCompaniesBySearchQuery(companies, query);
    const qLower = query.trim().toLowerCase();
    companyHits = [...companyHits].sort((a, b) => {
      const an = ((a.name || '').trim()).toLowerCase();
      const bn = ((b.name || '').trim()).toLowerCase();
      const ae = an === qLower ? 1 : 0;
      const be = bn === qLower ? 1 : 0;
      if (be !== ae) return be - ae;
      return (an.length || 0) - (bn.length || 0);
    });
    if (companyHits.length >= 1) {
      setSearchPlaceLoading(false);
      setSearchPlace(null);
      if (searchPlaceMarkerRef.current) {
        searchPlaceMarkerRef.current.setMap(null);
        searchPlaceMarkerRef.current = null;
      }
      const map = mapInstanceRef.current;
      if (!map) return;

      if (companyHits.length === 1) {
        const c = companyHits[0];
        const lat = Number(c.latitude);
        const lng = Number(c.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          setSearchPlace({ lat, lng, label: c.name || query });
          setShowSearchPlaceMarker(true);
          map.panTo({ lat, lng });
          map.setZoom(16);
          initialViewAppliedRef.current = true;
          if (!embedded) {
            skipStripFocusParamsRef.current = true;
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              next.set('focusCompanyId', String(c._id));
              next.set('zoom', '16');
              const nm = (c.name && String(c.name).trim()) || '';
              if (nm) next.set('focusName', nm);
              else next.delete('focusName');
              return next;
            }, { replace: true });
          }
          return;
        }
      } else {
        const bounds = new window.google.maps.LatLngBounds();
        let extended = false;
        companyHits.forEach((c) => {
          const lat = Number(c.latitude);
          const lng = Number(c.longitude);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            bounds.extend({ lat, lng });
            extended = true;
          }
        });
        if (extended && !bounds.isEmpty()) {
          clearFocusParamsFromUrl();
          map.fitBounds(bounds, { top: 72, right: 56, bottom: 100, left: 56 });
          initialViewAppliedRef.current = true;
          setShowSearchPlaceMarker(false);
          setSearchPlace(null);
          return;
        }
      }
    }

    if (!window.google.maps.Geocoder) return;
    clearFocusParamsFromUrl();
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
  }, [searchInput, mapReady, companies, embedded, setSearchParams, clearFocusParamsFromUrl]);

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

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className={`page map-page ${embedded ? 'map-page-embedded' : ''}`}>
        <div className="map-fallback">
          <span className="material-symbols-outlined map-fallback-icon">map</span>
          <p>지도를 사용하려면 <code>VITE_GOOGLE_MAPS_API_KEY</code>를 설정해 주세요.</p>
          <p className="map-fallback-hint">frontend/.env 에 추가 후 개발 서버를 재시작하세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`page map-page ${embedded ? 'map-page-embedded' : ''}`}>
      <div className="map-layout">
        <div className="map-main">
          <div ref={mapContainerRef} className="map-canvas map-canvas-google" />

          <div className="map-top-bar">
            <div className="map-controls">
              <button
                type="button"
                className={`map-filter-chip map-filter-chip--icon-only ${assigneeMeOnly ? 'active' : ''}`}
                onClick={() => setAssigneeMeOnly((prev) => !prev)}
                aria-label={assigneeMeOnly ? '전체 고객사 보기' : '내 담당 고객사만 보기'}
                title={assigneeMeOnly ? '전체 고객사 보기' : '내 담당 고객사만 보기'}
              >
                <span className="material-symbols-outlined">person_pin_circle</span>
              </button>
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
                className={`map-ctrl-btn map-ctrl-btn-circle ${liveLocationOn ? 'active' : ''}`}
                onClick={liveLocationOn ? stopLiveLocation : startLiveLocation}
                aria-label={liveLocationOn ? '실시간 위치 끄기' : '실시간 내 위치 켜기 (버튼을 눌렀을 때만)'}
                title={liveLocationOn ? '실시간 위치 끄기' : '실시간 내 위치 켜기 — 페이지 로드 시에는 실행되지 않습니다'}
              >
                <span className="material-symbols-outlined">my_location</span>
              </button>
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
                  placeholder="등록 고객사명·주소·장소 검색 (엔터 시 고객사 우선, 없으면 주소 지오코딩)"
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
                  {assigneeMeOnly ? '내 담당 고객사' : '전체 고객사'} {companiesToShowOnMap.length}건
                  {searchPlace && (
                    <> · 검색한 구글 장소 뱃지 {showSearchPlaceMarker ? '표시 중' : '끔 (우측 place 버튼으로 켜기)'}</>
                  )}
                </span>
              )}
            </div>
          </div>

          <div className="map-data-year-badge" aria-label="지도 데이터 기준 연도">
            지도 데이터: Google · {mapDataYear}
          </div>

          {mapReady && companiesWithCoords.length === 0 && companies.length > 0 && (
            <div className="map-hint-panel">
              <p>위도·경도가 있는 고객사만 지도에 표시됩니다. 고객사 추가 시 주소를 검색해서 선택하면 자동 저장됩니다.</p>
            </div>
          )}
        </div>

        {allowCompanyDetailModal && selected && (
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
