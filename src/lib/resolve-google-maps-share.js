import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';
import {
  extractMapsShareUrl,
  looksLikeGoogleMapsShare,
  looksLikeMapsUrl,
  needsMapsUrlExpand,
  parseGoogleMapsCoords
} from '@/lib/parse-google-maps-share';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 구글맵 공유 텍스트 → { lat, lng, resolvedUrl? }
 * @param {{ timeoutMs?: number }} [options] — 지도 버튼 등: 짧은 타임아웃(기본 25초)
 */
export async function resolveGoogleMapsShare(text, options = {}) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('공유 내용이 비어 있습니다.');

  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 25000;

  const mapsUrl = extractMapsShareUrl(raw);
  const direct =
    parseGoogleMapsCoords(raw) ||
    (mapsUrl && !needsMapsUrlExpand(mapsUrl) ? parseGoogleMapsCoords(mapsUrl) : null);

  if (direct) {
    return { lat: direct.lat, lng: direct.lng, resolvedUrl: mapsUrl || raw };
  }

  const canTryServer =
    looksLikeGoogleMapsShare(raw) ||
    Boolean(mapsUrl) ||
    /^https?:\/\//i.test(raw) ||
    /^geo:/i.test(raw);

  if (!canTryServer) {
    throw new Error(
      '구글맵에서 「공유」한 링크 전체를 붙여 넣어 주세요. (예: maps.app.goo.gl 또는 google.com/maps)'
    );
  }

  await Promise.race([
    pingBackendHealth(getAuthHeader),
    new Promise((resolve) => {
      window.setTimeout(resolve, Math.min(2500, timeoutMs));
    })
  ]);

  const controller = new AbortController();
  const abortId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE}/api/maps-share/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader()
      },
      body: JSON.stringify({ text: raw }),
      signal: controller.signal
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || '위치를 가져오지 못했습니다.');
    }
    if (!Number.isFinite(data.lat) || !Number.isFinite(data.lng)) {
      throw new Error('좌표 형식이 올바르지 않습니다.');
    }
    return data;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('위치 확인 시간이 초과되었습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.');
    }
    throw err;
  } finally {
    window.clearTimeout(abortId);
  }
}
