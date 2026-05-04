import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import CustomerCompanyDetailModal from '../customer-companies/customer-company-detail-modal/customer-company-detail-modal';
import MapCompanyPickerModal from './map-company-picker-modal';
import './map.css';

import { API_BASE } from '@/config';
// 지도 도메인 경고("이 웹사이트의 소유자이신가요?") 제거: Google Cloud Console → API 및 서비스 → 사용자 인증 정보 → 해당 키 → 애플리케이션 제한사항 → HTTP 리퍼러에 http://localhost:3000/*, https://실서비스도메인/* 추가
// Geolocation API(대략 위치): Console에서 「Geolocation API」 사용 설정 필요(Maps JavaScript API와 별도)
// Places Autocomplete 미사용 — 과금·요청 폭주 방지. 주소는 엔터/검색 버튼 → Geocoding만(세션 캐시).
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

function getCurrentUserIdFromStorage() {
  try {
    const u = JSON.parse(localStorage.getItem('crm_user') || '{}');
    return u?._id ? String(u._id) : null;
  } catch {
    return null;
  }
}

/**
 * 담당자 기준 마커 색 구분
 * @returns {'mine'|'other'|'none'}
 */
function getCompanyAssigneePinKind(company, myUserId) {
  const ids = Array.isArray(company.assigneeUserIds) ? company.assigneeUserIds : [];
  if (!ids.length) return 'none';
  if (myUserId && ids.some((id) => String(id) === myUserId)) return 'mine';
  return 'other';
}

/**
 * 실시간 내 위치
 * - 데스크톱: 첫 표시는 캐시 우선(빠름), watch는 저부하(고정밀 끔) — 노트북 GPS 없을 때 타임아웃 완화
 * - 모바일/터치: 네이버·카카오 앱처럼 쓰려면 watch를 enableHighAccuracy 로 두지 않으면 셀타워 위치만 반복되어 정확도가 크게 떨어짐
 */
const GEOLOCATION_OPTIONS_CACHE_FIRST = {
  enableHighAccuracy: false,
  maximumAge: 10 * 60 * 1000,
  timeout: 2200
};

const GEOLOCATION_OPTIONS_FRESH_NETWORK = {
  enableHighAccuracy: false,
  maximumAge: 0,
  timeout: 14000
};

/** 데스크톱·비터치: 연속 추적 시 네트워크 위주(배터리·콜드 GPS 회피) */
const GEOLOCATION_OPTIONS_WATCH = {
  enableHighAccuracy: false,
  maximumAge: 20000,
  timeout: 22000
};

/** 모바일: watch 자체를 GPS 우선 — 저정확 watch가 고정밀 1회 샘플을 계속 덮어쓰는 문제 방지 */
function getGeolocationWatchOptions() {
  if (shouldTryGpsRefinement()) {
    return {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 30000
    };
  }
  return GEOLOCATION_OPTIONS_WATCH;
}

/** GPS 안테나 — 콜드 스타트 후 늦게 잡히는 경우 보조 */
const GEOLOCATION_OPTIONS_GPS_REFINE = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 30000
};

function shouldTryGpsRefinement() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Mobi|Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  try {
    return window.matchMedia?.('(pointer: coarse)')?.matches === true;
  } catch {
    return false;
  }
}

/** 실시간 내 위치 반투명 원 — 지표 기준 고정 반경(m). 화면 픽셀 크기와 무관하게 지상 거리는 동일 */
const MY_LOCATION_CIRCLE_RADIUS_M = 2000;
const MY_LOCATION_CIRCLE_FIT_PADDING = { top: 56, right: 48, bottom: 100, left: 48 };

/** 한 프레임에 추가할 고객사 마커 수 — 전부 한꺼번에 그리면 메인 스레드가 멈춰 첫 화면이 느려짐 */
const MAP_MARKER_CHUNK_SIZE = 32;

/**
 * 고객사 위치 — 압정형 핀(SVG). 내 담당: 빨강, 타인 담당: 노랑, 미담당: 녹색(채도 높은 색).
 * 좌표는 핀 끝(anchor)이 위치에 오도록 맞춤.
 * @param {'mine'|'other'|'none'} pinKind
 */
function buildCompanyPinMarkerIcon(google, pinKind) {
  let fill;
  let stroke;
  if (pinKind === 'mine') {
    fill = '#e53935';
    stroke = '#7f0000';
  } else if (pinKind === 'other') {
    fill = '#ffeb3b';
    stroke = '#f57f17';
  } else {
    fill = '#43a047';
    stroke = '#1b5e20';
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48"><path d="M18 2C9.7 2 3 8.5 3 16.8c0 7.5 15 29.2 15 29.2S33 24.3 33 16.8C33 8.5 26.3 2 18 2z" fill="${fill}" stroke="${stroke}" stroke-width="1.25" stroke-linejoin="round"/><circle cx="18" cy="16.5" r="5" fill="#ffffff" stroke="${stroke}" stroke-width="0.9"/></svg>`;
  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  return {
    url,
    scaledSize: new google.maps.Size(30, 40),
    anchor: new google.maps.Point(15, 40)
  };
}

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
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&language=ko&loading=async&callback=${callbackName}`;
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
 * 403: 동일 키에「Geolocation API」를 API 제한에 추가하고, Maps와 같이 결제·HTTP 리퍼러 제한을 맞춤.
 * 한 번 403이면 sessionStorage + localStorage 에 건너뛰기 저장 → 이후에는 요청을 보내지 않아 네트워크 콘솔 403 반복이 사라짐.
 * 완전히 끄려면 .env 에 VITE_SKIP_GOOGLE_CONSIDER_IP=true
 */
const GEOLOCATE_CONSIDER_IP_SKIP_KEY = 'nexvia_geolocate_consider_ip_skip';

function shouldSkipGoogleConsiderIpGeolocate() {
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(GEOLOCATE_CONSIDER_IP_SKIP_KEY) === '1') {
      return true;
    }
    if (typeof localStorage !== 'undefined' && localStorage.getItem(GEOLOCATE_CONSIDER_IP_SKIP_KEY) === '1') {
      return true;
    }
  } catch {
    /* 사생활 모드 등 */
  }
  return false;
}

function rememberSkipGoogleConsiderIpGeolocate() {
  try {
    sessionStorage.setItem(GEOLOCATE_CONSIDER_IP_SKIP_KEY, '1');
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(GEOLOCATE_CONSIDER_IP_SKIP_KEY, '1');
  } catch {
    /* ignore */
  }
}

async function fetchGoogleConsiderIpApproximate(apiKey) {
  if (!apiKey || typeof fetch === 'undefined') return null;
  if (import.meta.env.VITE_SKIP_GOOGLE_CONSIDER_IP === 'true') return null;
  try {
    if (shouldSkipGoogleConsiderIpGeolocate()) {
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
      rememberSkipGoogleConsiderIpGeolocate();
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

/** Geocoding API 호출 줄이기 — 동일 검색어는 세션 동안 재사용 */
const GEOCODE_CACHE_STORAGE_KEY = 'nexvia_map_geocode_v1';
const GEOCODE_CACHE_MAX_ENTRIES = 80;
const GEOCODE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeGeocodeCacheKey(raw) {
  return String(raw || '').trim().toLowerCase();
}

function loadGeocodeCacheObject() {
  if (typeof sessionStorage === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(GEOCODE_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return {};
    const now = Date.now();
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (
        v &&
        typeof v.lat === 'number' &&
        typeof v.lng === 'number' &&
        typeof v.ts === 'number' &&
        now - v.ts < GEOCODE_CACHE_TTL_MS
      ) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function getGeocodeFromCache(queryKey) {
  const k = normalizeGeocodeCacheKey(queryKey);
  if (!k) return null;
  const obj = loadGeocodeCacheObject();
  const hit = obj[k];
  if (!hit) return null;
  return { lat: hit.lat, lng: hit.lng, label: typeof hit.label === 'string' ? hit.label : '' };
}

function saveGeocodeToCache(queryKey, { lat, lng, label }) {
  const k = normalizeGeocodeCacheKey(queryKey);
  if (!k || typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) return;
  try {
    const obj = loadGeocodeCacheObject();
    obj[k] = { lat, lng, label: label != null ? String(label) : '', ts: Date.now() };
    const keys = Object.keys(obj);
    if (keys.length > GEOCODE_CACHE_MAX_ENTRIES) {
      keys.sort((a, b) => (obj[a].ts || 0) - (obj[b].ts || 0));
      for (let i = 0; i < keys.length - GEOCODE_CACHE_MAX_ENTRIES; i++) {
        delete obj[keys[i]];
      }
    }
    sessionStorage.setItem(GEOCODE_CACHE_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* 할당량 초과·사생활 모드 */
  }
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

function isCompanyStaleByUpdatedAt(company, months = 3) {
  const refRaw = company?.updatedAt || company?.createdAt;
  if (!refRaw) return false;
  const ref = new Date(refRaw);
  if (Number.isNaN(ref.getTime())) return false;
  const threshold = new Date();
  threshold.setMonth(threshold.getMonth() - months);
  return ref.getTime() < threshold.getTime();
}

const MAP_SHOW_IDS_QUERY = 'mapShowIds';

export default function Map({
  embedded = false,
  initialFocusCompanyId = null,
  initialOpenCompanyModal = false,
  initialZoom = 16,
  /** 일반 /map 진입 시 기본은 «내 담당»만 (전체는 툴바에서 전환). URL focusCompanyId 있을 때만 전체 조회로 시작 */
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
  const markersRef = useRef([]);
  const koreaLabelMarkersRef = useRef([]);
  const koreaLabelListenersRef = useRef([]);
  const searchPlaceMarkerRef = useRef(null);
  const markerLabelsRef = useRef([]); // 마커별 말주머니(업체명) InfoWindow 목록
  const initialViewAppliedRef = useRef(false); // 초기 뷰(내 위치/고객사 fit 등)는 한 번만 적용 → 검색 후 화면이 덮어쓰이지 않도록
  const [showMarkerLabels, setShowMarkerLabels] = useState(false); // 업체명 말주머니 표시 (기본 끔)
  const [searchPlace, setSearchPlace] = useState(null); // Google 검색한 장소 { lat, lng, label }
  const [searchPlaceLoading, setSearchPlaceLoading] = useState(false);
  const [grayscaleMode, setGrayscaleMode] = useState(false); // 지도 흑백 모드
  const [headingFollowOn, setHeadingFollowOn] = useState(false); // 기기 방향에 맞춰 지도 회전 (북이 항상 위가 아님)
  const orientationHandlerRef = useRef(null);
  const [myLocation, setMyLocation] = useState(null);
  const [liveLocationOn, setLiveLocationOn] = useState(false);
  const watchIdRef = useRef(null);
  const gpsRefineTimeoutRef = useRef(null);
  const gpsRefineLateTimeoutRef = useRef(null);
  const locationSamplesRef = useRef([]);
  const myLocationAccuracyCircleRef = useRef(null);
  const lastRefinedLocationRef = useRef(null);
  const focusRequestHandledRef = useRef(false);
  /** 지도 검색으로 붙인 focusCompanyId 등은 URL에 남김 — 외부 딥링크 처리 후에는 제거 */
  const skipStripFocusParamsRef = useRef(false);
  /** 상세 모달에서 /map 진입 시: 해당 고객사 1건을 먼저 그리고, 잠시 뒤 전체 목록 로딩 */
  const [focusedOnlyBoot, setFocusedOnlyBoot] = useState(() => !embedded && Boolean(focusCompanyId));

  /** null = 위·경도 있는 고객사 전부 표시, Set = 해당 id만 마커 표시 */
  const [mapOnlyShowIds, setMapOnlyShowIds] = useState(null);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [staleOnlyMode, setStaleOnlyMode] = useState(false);

  useEffect(() => {
    focusRequestHandledRef.current = false;
  }, [focusCompanyId]);

  useEffect(() => {
    setFocusedOnlyBoot(!embedded && Boolean(focusCompanyId));
  }, [embedded, focusCompanyId]);

  const fetchFocusedCompanyOnly = useCallback(async () => {
    if (!focusCompanyId) return false;
    try {
      const res = await fetch(`${API_BASE}/customer-companies/${encodeURIComponent(String(focusCompanyId))}`, {
        headers: getAuthHeader()
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?._id) {
        setCompanies([data]);
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
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
    let cancelled = false;
    let timerId = null;
    (async () => {
      if (focusedOnlyBoot && focusCompanyId) {
        const bootOk = await fetchFocusedCompanyOnly();
        if (!cancelled && bootOk) setLoading(false);
        timerId = window.setTimeout(() => {
          if (cancelled) return;
          setFocusedOnlyBoot(false);
        }, 260);
        return;
      }
      fetchCompanies();
    })();
    return () => {
      cancelled = true;
      if (timerId != null) window.clearTimeout(timerId);
    };
  }, [fetchCompanies, fetchFocusedCompanyOnly, focusedOnlyBoot, focusCompanyId]);

  // assigneeMeOnly 전환 시 initialViewAppliedRef 를 리셋하지 않음 — 리셋하면 마커 effect 가
  // fitBounds / setZoom(14) 를 다시 호출해 사용자가 확대해 둔 뷰가 풀림.

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

    if (gpsRefineTimeoutRef.current != null) {
      clearTimeout(gpsRefineTimeoutRef.current);
      gpsRefineTimeoutRef.current = null;
    }
    if (gpsRefineLateTimeoutRef.current != null) {
      clearTimeout(gpsRefineLateTimeoutRef.current);
      gpsRefineLateTimeoutRef.current = null;
    }

    const applyPos = (pos) => {
      const w = pushGeolocationSample(locationSamplesRef, pos);
      if (!w) return;
      const damped = dampLargeJump(lastRefinedLocationRef.current, w);
      lastRefinedLocationRef.current = damped;
      setMyLocation({ lat: damped.lat, lng: damped.lng, accuracy: damped.accuracy });
    };

    const noop = () => {};

    /** 캐시 없음·타임아웃 시에만 네트워크 신규 좌표 1회 (watch와 병행) */
    const onCacheMiss = () => {
      try {
        geo.getCurrentPosition(applyPos, noop, GEOLOCATION_OPTIONS_FRESH_NETWORK);
      } catch {
        /* 동기 throw */
      }
    };

    try {
      geo.getCurrentPosition(applyPos, onCacheMiss, GEOLOCATION_OPTIONS_CACHE_FIRST);
    } catch {
      /* 일부 환경에서 동기 throw */
    }

    const watchId = geo.watchPosition(applyPos, noop, getGeolocationWatchOptions());
    watchIdRef.current = watchId;

    if (shouldTryGpsRefinement()) {
      gpsRefineTimeoutRef.current = window.setTimeout(() => {
        gpsRefineTimeoutRef.current = null;
        try {
          geo.getCurrentPosition(applyPos, noop, GEOLOCATION_OPTIONS_GPS_REFINE);
        } catch {
          /* 동기 throw */
        }
      }, 480);
      /** GPS 냉시작 시 첫 보정만으로 부족할 때 — 네이티브/웹 모두 늦게 잠기는 경우 대비 */
      gpsRefineLateTimeoutRef.current = window.setTimeout(() => {
        gpsRefineLateTimeoutRef.current = null;
        try {
          geo.getCurrentPosition(applyPos, noop, GEOLOCATION_OPTIONS_GPS_REFINE);
        } catch {
          /* 동기 throw */
        }
      }, 2800);
    }

    setLiveLocationOn(true);
  }, []);

  const stopLiveLocation = useCallback(() => {
    if (gpsRefineTimeoutRef.current != null) {
      clearTimeout(gpsRefineTimeoutRef.current);
      gpsRefineTimeoutRef.current = null;
    }
    if (gpsRefineLateTimeoutRef.current != null) {
      clearTimeout(gpsRefineLateTimeoutRef.current);
      gpsRefineLateTimeoutRef.current = null;
    }
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

  const companiesWithCoords = useMemo(
    () => companies.filter((c) => c.latitude != null && c.longitude != null),
    [companies]
  );

  const companiesWithCoordsByUpdatedAt = useMemo(() => {
    if (!staleOnlyMode) return companiesWithCoords;
    return companiesWithCoords.filter((c) => isCompanyStaleByUpdatedAt(c, 3));
  }, [companiesWithCoords, staleOnlyMode]);

  const companiesToShowOnMap = useMemo(() => {
    if (!mapOnlyShowIds || mapOnlyShowIds.size === 0) return companiesWithCoordsByUpdatedAt;
    return companiesWithCoordsByUpdatedAt.filter((c) => mapOnlyShowIds.has(String(c._id)));
  }, [companiesWithCoordsByUpdatedAt, mapOnlyShowIds]);

  /** 고객사 목록에서 `/map?mapShowIds=...` 로 넘어온 경우: 선택만 표시 후 URL 정리 */
  useEffect(() => {
    if (embedded) return;
    const raw = searchParams.get(MAP_SHOW_IDS_QUERY);
    if (!raw || !String(raw).trim()) return;
    const ids = String(raw)
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length) setMapOnlyShowIds(new Set(ids));
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(MAP_SHOW_IDS_QUERY);
        return next;
      },
      { replace: true }
    );
  }, [embedded, searchParams, setSearchParams]);

  const mapFilterFitKey = useMemo(() => {
    if (!mapOnlyShowIds || mapOnlyShowIds.size === 0) return '';
    const pts = companiesWithCoords
      .filter((c) => mapOnlyShowIds.has(String(c._id)))
      .map((c) => `${String(c._id)}:${Number(c.latitude)},${Number(c.longitude)}`);
    return pts.sort().join('|');
  }, [mapOnlyShowIds, companiesWithCoords]);

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.google?.maps) return;
    if (!mapFilterFitKey) return;
    const withCoord = companiesWithCoords.filter(
      (c) => mapOnlyShowIds?.has(String(c._id)) && Number.isFinite(Number(c.latitude)) && Number.isFinite(Number(c.longitude))
    );
    if (withCoord.length === 0) return;
    const map = mapInstanceRef.current;
    if (withCoord.length === 1) {
      const c = withCoord[0];
      map.panTo({ lat: Number(c.latitude), lng: Number(c.longitude) });
      map.setZoom(15);
      return;
    }
    const bounds = new window.google.maps.LatLngBounds();
    withCoord.forEach((c) => bounds.extend({ lat: Number(c.latitude), lng: Number(c.longitude) }));
    if (!bounds.isEmpty()) map.fitBounds(bounds, { top: 72, right: 56, bottom: 140, left: 56 });
  }, [mapReady, mapFilterFitKey, companiesWithCoords, mapOnlyShowIds]);

  const openMapCompanyPicker = useCallback(() => {
    setMapPickerOpen(true);
  }, []);

  const clearMapOnlyFilter = useCallback(() => {
    setMapOnlyShowIds(null);
  }, []);

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
      if (gpsRefineTimeoutRef.current != null) {
        clearTimeout(gpsRefineTimeoutRef.current);
        gpsRefineTimeoutRef.current = null;
      }
      if (watchIdRef.current != null) {
        getGeolocationService()?.clearWatch(watchIdRef.current);
      }
      markersRef.current.forEach((m) => {
        window.google?.maps?.event?.clearInstanceListeners?.(m);
        m.setMap(null);
      });
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

  /** 내 위치가 먼저 잡히면 지도 중심만 1회 이동 (GPS 틱마다 마커 전체 재생성하지 않도록 myLocation은 마커 effect에서 제외) */
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !myLocation || initialViewAppliedRef.current) return;
    const map = mapInstanceRef.current;
    map.panTo({ lat: myLocation.lat, lng: myLocation.lng });
    map.setZoom(15);
    initialViewAppliedRef.current = true;
  }, [mapReady, myLocation]);

  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.google) return;
    const map = mapInstanceRef.current;
    let cancelled = false;

    const clearCompanyMarkers = () => {
      markerLabelsRef.current.forEach((iw) => iw.close());
      markerLabelsRef.current = [];
      markersRef.current.forEach((m) => {
        window.google.maps.event.clearInstanceListeners(m);
        m.setMap(null);
      });
      markersRef.current = [];
    };

    clearCompanyMarkers();

    const myUserId = getCurrentUserIdFromStorage();

    const list = companiesToShowOnMap.filter((c) => c.latitude != null && c.longitude != null);

    // 좌표만으로 초기 뷰를 먼저 잡음 → 마커 DOM/스프라이트 생성을 기다리지 않음
    if (!initialViewAppliedRef.current) {
      if (list.length === 1) {
        const c = list[0];
        map.panTo({ lat: c.latitude, lng: c.longitude });
        map.setZoom(14);
        initialViewAppliedRef.current = true;
      } else if (list.length > 1) {
        const bounds = new window.google.maps.LatLngBounds();
        list.forEach((c) => bounds.extend({ lat: c.latitude, lng: c.longitude }));
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
          initialViewAppliedRef.current = true;
        }
      }
    }

    const companyName = (name) => (name && String(name).trim()) || '(업체명 없음)';
    const escapeIw = (s) =>
      String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const labelContent = (name) =>
      `<div class="map-company-iw-label" title="${escapeIw(companyName(name))}">${escapeIw(companyName(name))}</div>`;

    let idx = 0;
    const addChunk = () => {
      if (cancelled) return;
      const end = Math.min(idx + MAP_MARKER_CHUNK_SIZE, list.length);
      for (; idx < end; idx++) {
        const company = list[idx];
        const lat = company.latitude;
        const lng = company.longitude;
        const pinKind = getCompanyAssigneePinKind(company, myUserId);
        const zBase = pinKind === 'mine' ? 2000 : pinKind === 'other' ? 1200 : 400;
        const marker = new window.google.maps.Marker({
          position: { lat, lng },
          map,
          title: company.name || '',
          optimized: true,
          /** 겹침 시 내 담당 → 타인 담당 → 미담당 순으로 앞에 그려짐 */
          zIndex: zBase + idx,
          icon: buildCompanyPinMarkerIcon(window.google, pinKind)
        });
        marker.addListener('click', () => setSelected(company));
        if (showMarkerLabels) {
          const iw = new window.google.maps.InfoWindow({
            content: labelContent(company.name),
            pixelOffset: new window.google.maps.Size(0, -6),
            /** 다수 말주머니 연속 open 시 지도가 마지막 창으로 맞춰지며 뷰가 뒤로 튀는 것 방지 */
            disableAutoPan: true
          });
          iw.open(map, marker);
          markerLabelsRef.current.push(iw);
        }
        markersRef.current.push(marker);
      }
      if (idx < list.length && !cancelled) {
        requestAnimationFrame(addChunk);
      }
    };

    // 첫 청크는 동기로 그려 첫 화면이 한 프레임 늦지 않게 함. 이후만 rAF로 나머지를 쪼갬.
    if (list.length > 0) {
      addChunk();
    }

    return () => {
      cancelled = true;
      clearCompanyMarkers();
    };
  }, [mapReady, companiesToShowOnMap, showMarkerLabels]);

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

  // Google 검색·고객사 1건 포커스 등으로 잡힌 위치 마커 (주황색) — searchPlace 가 있을 때만
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !window.google) return;
    if (searchPlaceMarkerRef.current) {
      searchPlaceMarkerRef.current.setMap(null);
      searchPlaceMarkerRef.current = null;
    }
    if (!searchPlace) return;
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
  }, [mapReady, searchPlace]);

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
          setSearchPlace(null);
          return;
        }
      }
    }

    if (!window.google.maps.Geocoder) return;

    const cachedGeo = getGeocodeFromCache(query);
    if (cachedGeo) {
      clearFocusParamsFromUrl();
      setSearchPlace(null);
      if (searchPlaceMarkerRef.current) {
        searchPlaceMarkerRef.current.setMap(null);
        searchPlaceMarkerRef.current = null;
      }
      const label = cachedGeo.label || query;
      setSearchPlace({ lat: cachedGeo.lat, lng: cachedGeo.lng, label });
      if (mapInstanceRef.current) {
        mapInstanceRef.current.panTo({ lat: cachedGeo.lat, lng: cachedGeo.lng });
        mapInstanceRef.current.setZoom(14);
        initialViewAppliedRef.current = true;
      }
      return;
    }

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
      saveGeocodeToCache(query, { lat, lng, label });
      setSearchPlace({ lat, lng, label });
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
            <div className="map-toolbar-cluster">
              <div className="map-controls">
              <div className="map-zoom-btns">
                <button type="button" className="map-ctrl-btn map-ctrl-btn-circle" onClick={zoomIn} aria-label="확대">
                  <span className="material-symbols-outlined">add</span>
                </button>
                <button type="button" className="map-ctrl-btn map-ctrl-btn-circle" onClick={zoomOut} aria-label="축소">
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
              <button
                type="button"
                className={`map-ctrl-btn map-ctrl-btn-circle map-assignee-scope-toggle ${assigneeMeOnly ? 'active' : ''}`}
                onClick={() => setAssigneeMeOnly((v) => !v)}
                aria-pressed={assigneeMeOnly}
                title={
                  assigneeMeOnly
                    ? '지금: 내 담당만 — 클릭하면 전체 고객사'
                    : '지금: 전체 고객사 — 클릭하면 내 담당만'
                }
                aria-label={
                  assigneeMeOnly ? '전체 고객사 보기로 전환' : '내 담당 고객사만 보기로 전환'
                }
              >
                <span className="material-symbols-outlined">
                  {assigneeMeOnly ? 'person_pin_circle' : 'public'}
                </span>
              </button>
              <button
                type="button"
                className={`map-ctrl-btn map-ctrl-btn-circle ${staleOnlyMode ? 'active' : ''}`}
                onClick={() => setStaleOnlyMode((v) => !v)}
                aria-pressed={staleOnlyMode}
                title={staleOnlyMode ? '지금: 3개월 이상 미갱신만 표시 — 클릭하면 전체' : '지금: 전체 표시 — 클릭하면 3개월 이상 미갱신만'}
                aria-label={staleOnlyMode ? '전체 업체 표시로 전환' : '3개월 이상 미갱신 업체만 보기로 전환'}
              >
                <span className="material-symbols-outlined">
                  {staleOnlyMode ? 'event_busy' : 'schedule'}
                </span>
              </button>
              </div>
            </div>
          </div>

          <div className="map-search-bar">
            <div className="map-search-wrap">
              <div className="map-search-row">
                {!embedded ? (
                  <button
                    type="button"
                    className="map-search-picker-btn"
                    onClick={openMapCompanyPicker}
                    title="체크한 고객사만 지도 마커로 표시"
                    aria-label="고객사 선택"
                  >
                    <span className="material-symbols-outlined" aria-hidden>
                      filter_list
                    </span>
                    <span className="map-search-picker-btn-label">고객사 선택</span>
                  </button>
                ) : null}
                <div className="map-search-input-shell">
                  <span className="material-symbols-outlined map-search-icon">search</span>
                  <input
                    ref={searchInputRef}
                    type="text"
                    className="map-search-input"
                    placeholder="등록 고객사명 또는 주소·장소 (엔터·검색: 고객사 우선, 없으면 지오코딩 1회)"
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
                </div>
                <button
                  type="button"
                  className="map-search-go-btn"
                  onClick={goToSearchPlace}
                  disabled={!searchInput.trim() || searchPlaceLoading}
                  title="입력한 주소·장소로 지도 이동 (지오코딩, 동일 검색은 캐시)"
                  aria-label="장소로 이동"
                >
                  {searchPlaceLoading ? (
                    <span className="material-symbols-outlined map-search-go-spin">progress_activity</span>
                  ) : (
                    <span className="material-symbols-outlined">explore</span>
                  )}
                </button>
              </div>
              {(searchInput.trim() || (mapOnlyShowIds && mapOnlyShowIds.size > 0)) && (
                <span className="map-search-result-count">
                  {mapOnlyShowIds && mapOnlyShowIds.size > 0 ? (
                    <>마커 표시: 선택 {companiesToShowOnMap.length}곳 · </>
                  ) : null}
                  {assigneeMeOnly ? '내 담당(좌표)' : '전체(좌표)'} {companiesWithCoordsByUpdatedAt.length}곳
                  {staleOnlyMode ? ' · 3개월 이상 미갱신 필터' : null}
                  {searchInput.trim() && searchPlace ? <> · 검색 위치 마커 표시 중</> : null}
                </span>
              )}
              {!embedded && mapOnlyShowIds && mapOnlyShowIds.size > 0 ? (
                <div className="map-search-secondary">
                  <button
                    type="button"
                    className="map-search-secondary-btn map-search-secondary-btn-muted"
                    onClick={clearMapOnlyFilter}
                    title="좌표 있는 고객사 전부 다시 표시"
                  >
                    전체 마커
                  </button>
                </div>
              ) : null}
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

      <MapCompanyPickerModal
        open={mapPickerOpen}
        companies={companiesWithCoords}
        initialSelectedIds={mapOnlyShowIds}
        getAuthHeader={getAuthHeader}
        onClose={() => setMapPickerOpen(false)}
        onConfirm={(idSet) => {
          setMapOnlyShowIds(idSet.size > 0 ? idSet : null);
          setMapPickerOpen(false);
        }}
      />

      {!mapReady && (
        <div className="map-loading">
          <span className="material-symbols-outlined">progress_activity</span>
          지도 불러오는 중…
        </div>
      )}
      {mapReady && loading && (
        <div className="map-loading-companies" role="status" aria-live="polite">
          <span className="material-symbols-outlined">progress_activity</span>
          고객사 목록 불러오는 중…
        </div>
      )}
    </div>
  );
}
