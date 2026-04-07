/**
 * Capacitor 네이티브 앱에서만 window.__nexviaGeolocation 을 주입합니다.
 * map.js 의 getGeolocationService() 가 이 객체를 우선 사용 → Fused Location 등 네이티브 엔진.
 * 일반 브라우저·PWA(웹만)에서는 isNativePlatform() 이 false 이므로 아무 것도 하지 않습니다.
 */
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

function toDomPosition(cap) {
  if (!cap?.coords) return null;
  const c = cap.coords;
  return {
    coords: {
      latitude: c.latitude,
      longitude: c.longitude,
      accuracy: typeof c.accuracy === 'number' ? c.accuracy : 0,
      altitude: c.altitude ?? null,
      altitudeAccuracy: c.altitudeAccuracy ?? null,
      heading: c.heading ?? null,
      speed: c.speed ?? null
    },
    timestamp: cap.timestamp ?? Date.now()
  };
}

function toDomError(err, codeFallback = 2) {
  const msg = err?.message || String(err || 'POSITION_UNAVAILABLE');
  return {
    code: codeFallback,
    message: msg,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3
  };
}

function toCapOptions(options) {
  const o = options || {};
  const timeout = typeof o.timeout === 'number' && o.timeout > 0 ? o.timeout : 60000;
  return {
    /** 웹 Geolocation 기본값과 동일: 명시할 때만 GPS 우선(느림). 생략 시 네트워크·퓨즈 우선으로 첫 위치가 빨라짐 */
    enableHighAccuracy: o.enableHighAccuracy === true,
    timeout,
    maximumAge: typeof o.maximumAge === 'number' ? o.maximumAge : 0,
    interval: timeout,
    /** 지도 실시간 위치 반응 — 너무 낮으면 배터리·발열 증가 (Android/iOS 플러그인 동작에 따름) */
    minimumUpdateInterval: 200,
    enableLocationFallback: true
  };
}

function installNexviaNativeGeolocation() {
  if (typeof window === 'undefined') return;
  if (!Capacitor.isNativePlatform()) return;
  if (window.__nexviaGeolocation) return;

  let numericWatchId = 1;
  /** @type {Map<number, { callbackId?: string, cancelled: boolean }>} */
  const watchState = new Map();

  async function ensureLocationPermission() {
    try {
      const st = await Geolocation.checkPermissions();
      if (st.location === 'granted') return;
      await Geolocation.requestPermissions({ permissions: ['location'] });
    } catch {
      /* 권한 API 실패 시에도 getCurrentPosition 에서 처리 */
    }
  }

  window.__nexviaGeolocation = {
    getCurrentPosition(success, error, options) {
      void (async () => {
        try {
          await ensureLocationPermission();
          const pos = await Geolocation.getCurrentPosition(toCapOptions(options));
          success(toDomPosition(pos));
        } catch (e) {
          if (typeof error === 'function') error(toDomError(e, 2));
        }
      })();
    },

    watchPosition(success, error, options) {
      const id = numericWatchId++;
      watchState.set(id, { cancelled: false });

      void (async () => {
        try {
          await ensureLocationPermission();
          const capOpts = toCapOptions(options);
          const callbackId = await Geolocation.watchPosition(capOpts, (pos, err) => {
            const st = watchState.get(id);
            if (!st || st.cancelled) return;
            if (err) {
              if (typeof error === 'function') error(toDomError(err, 2));
              return;
            }
            if (pos && typeof success === 'function') success(toDomPosition(pos));
          });

          const st = watchState.get(id);
          if (!st) return;
          if (st.cancelled) {
            await Geolocation.clearWatch({ id: callbackId });
            watchState.delete(id);
            return;
          }
          st.callbackId = callbackId;
        } catch (e) {
          watchState.delete(id);
          if (typeof error === 'function') error(toDomError(e, 2));
        }
      })();

      return id;
    },

    clearWatch(id) {
      const st = watchState.get(id);
      if (!st) return;
      st.cancelled = true;
      if (st.callbackId) {
        void Geolocation.clearWatch({ id: st.callbackId });
        watchState.delete(id);
      }
    }
  };
}

installNexviaNativeGeolocation();
