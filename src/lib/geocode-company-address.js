/**
 * 고객사 저장과 동일: 주소만 있고 위·경도가 비었을 때 서버 geocode → 실패 시 Google Maps Geocoder.
 * add-company-modal · 연락처 등록(고객사 자동 생성)에서 공용 사용.
 */
import { API_BASE } from '@/config';
import { getGoogleMapsApiKey, loadGoogleMapsPromise, geocodeAddressWithGoogleMaps } from '@/lib/google-maps-client';

const GOOGLE_MAPS_API_KEY = getGoogleMapsApiKey();

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** @returns {Promise<{ latitude: number, longitude: number } | null>} */
export async function geocodeAddressForCompanySave(addressText) {
  const address = (addressText || '').trim();
  if (!address) return null;
  try {
    const geoRes = await fetch(`${API_BASE}/customer-companies/geocode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ address, soft: true })
    });
    const geoData = await geoRes.json().catch(() => ({}));
    if (
      geoRes.ok &&
      geoData.ok !== false &&
      geoData.latitude != null &&
      geoData.longitude != null
    ) {
      const latitude = Number(geoData.latitude);
      const longitude = Number(geoData.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return { latitude, longitude };
      }
    }
  } catch (_) {}
  if (!GOOGLE_MAPS_API_KEY) return null;
  const google = await loadGoogleMapsPromise();
  if (!google?.maps?.Geocoder) return null;
  const coords = await geocodeAddressWithGoogleMaps(google, address);
  if (coords?.latitude != null && coords?.longitude != null) return coords;
  return null;
}
