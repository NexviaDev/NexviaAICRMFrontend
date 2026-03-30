import { API_BASE } from '@/config';

/**
 * Railway 무료 티어 슬립(~30초) 대응 주기 핑(ms).
 * - 기본 20000 (20초).
 * - VITE_BACKEND_KEEPALIVE_INTERVAL_MS=0 이면 주기 핑 비활성화 (유료·항상 켜짐 인스턴스 권장).
 * - 긴 작업 직전 pingBackendHealth() 는 그대로 호출되는 곳에서 유지됩니다.
 */
function parseKeepaliveIntervalMs() {
  const raw =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_KEEPALIVE_INTERVAL_MS != null
      ? String(import.meta.env.VITE_BACKEND_KEEPALIVE_INTERVAL_MS).trim()
      : '';
  if (raw === '') return 20000;
  const n = Number(raw);
  if (Number.isNaN(n) || n < 0) return 20000;
  return n;
}

export const BACKEND_KEEPALIVE_INTERVAL_MS = parseKeepaliveIntervalMs();

/** 주기적 /health 핑을 쓸지 여부 (0이면 끔) */
export const BACKEND_KEEPALIVE_INTERVAL_ENABLED = BACKEND_KEEPALIVE_INTERVAL_MS > 0;

/**
 * 장시간 POST(음성 전사 등) 전에 호출해 슬립 중인 백엔드를 깨운 뒤 본 요청을 보냅니다.
 * @param {() => Record<string, string>} getAuthHeader Bearer 등
 */
export async function pingBackendHealth(getAuthHeader) {
  const headers = typeof getAuthHeader === 'function' ? getAuthHeader() : {};
  try {
    await fetch(`${API_BASE}/health`, { headers, credentials: 'include' });
  } catch (_) {
    /* ignore */
  }
}
