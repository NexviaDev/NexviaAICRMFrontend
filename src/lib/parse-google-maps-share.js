/** 구글맵 공유 텍스트·URL에서 위·경도 추출 */

const MAPS_URL_RE =
  /(?:google\.[\w.]+\/maps|maps\.google|maps\.app\.goo\.gl|maps\.app\.goo|goo\.gl\/maps|g\.co\/maps)/i;

export function looksLikeMapsUrl(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  if (/^geo:/i.test(u)) return true;
  return MAPS_URL_RE.test(u);
}

export function looksLikeGoogleMapsShare(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (MAPS_URL_RE.test(s)) return true;
  if (/^geo:/i.test(s)) return true;
  const url = extractMapsShareUrl(s);
  if (url && looksLikeMapsUrl(url)) return true;
  return extractLatLngFromText(s) != null;
}

/** 공유 텍스트 안에서 구글맵 URL 우선 추출 */
export function extractMapsShareUrl(text) {
  const s = String(text || '');
  const urls = s.match(/https?:\/\/[^\s<>"']+/gi) || [];
  for (const raw of urls) {
    const clean = raw.replace(/[),.;\]]+$/, '');
    if (looksLikeMapsUrl(clean)) return clean;
  }
  return urls[0] ? urls[0].replace(/[),.;\]]+$/, '') : null;
}

export function extractFirstUrl(text) {
  return extractMapsShareUrl(text);
}

function parseCoordPair(a, b) {
  const lat = Number(a);
  const lng = Number(b);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * @returns {{ lat: number, lng: number } | null}
 */
export function parseGoogleMapsCoords(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  let s = raw;
  try {
    if (/^geo:/i.test(raw)) {
      const geoQ = raw.match(/[?&]q=(-?\d+(?:\.\d+)?)[,+](-?\d+(?:\.\d+)?)/i);
      if (geoQ) {
        const p = parseCoordPair(geoQ[1], geoQ[2]);
        if (p) return p;
      }
      const geoDirect = raw.match(/^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
      if (geoDirect) {
        const p = parseCoordPair(geoDirect[1], geoDirect[2]);
        if (p) return p;
      }
    }
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      s = `${u.href} ${decodeURIComponent(u.pathname + u.search + (u.hash || ''))}`;
    }
  } catch {
    /* not a URL */
  }

  const patterns = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&]q=(-?\d+(?:\.\d+)?)[,%2C+\s]+(-?\d+(?:\.\d+)?)/i,
    /[?&]ll=(-?\d+(?:\.\d+)?)[,%2C+\s]+(-?\d+(?:\.\d+)?)/i,
    /[?&]center=(-?\d+(?:\.\d+)?)[,%2C+\s]+(-?\d+(?:\.\d+)?)/i,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i,
    /!8m2!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i,
    /\/(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)(?:\/|$|\?)/
  ];

  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const p = parseCoordPair(m[1], m[2]);
      if (p) return p;
    }
  }

  return extractLatLngFromText(s);
}

function extractLatLngFromText(s) {
  const m = String(s).match(/(-?\d{1,2}(?:\.\d+)?)\s*[,，]\s*(-?\d{2,3}(?:\.\d+)?)/);
  if (!m) return null;
  return parseCoordPair(m[1], m[2]);
}

/** redirect 따라가야 하는 단축·공유 링크 */
export function needsMapsUrlExpand(url) {
  const u = String(url || '').toLowerCase();
  return (
    u.includes('maps.app.goo.gl') ||
    u.includes('maps.app.goo') ||
    u.includes('goo.gl/') ||
    u.includes('g.co/maps') ||
    u.includes('goo.gl/maps')
  );
}

/** @deprecated needsMapsUrlExpand 사용 */
export function isShortGoogleMapsUrl(url) {
  return needsMapsUrlExpand(url);
}
