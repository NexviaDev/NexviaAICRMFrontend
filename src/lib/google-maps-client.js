/**
 * add-company-modal 등과 공유: Maps JS API 로드 + 주소 → 위·경도 (클라이언트 Geocoder)
 */

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

export function getGoogleMapsApiKey() {
  return GOOGLE_MAPS_API_KEY;
}

export function loadGoogleMaps(onLoad) {
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

export function loadGoogleMapsPromise() {
  return new Promise((resolve) => {
    loadGoogleMaps(resolve);
  });
}

/**
 * add-company-modal의 geocodeAddressToForm과 동일한 Geocoder 호출
 * @returns {Promise<{ latitude: number, longitude: number } | null>}
 */
export function geocodeAddressWithGoogleMaps(google, address) {
  return new Promise((resolve) => {
    if (!google?.maps?.Geocoder) return resolve(null);
    const addr = (address || '').trim();
    if (!addr) return resolve(null);
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: addr }, (results, status) => {
      if (status !== google.maps.GeocoderStatus.OK || !results?.[0]?.geometry?.location) return resolve(null);
      const loc = results[0].geometry.location;
      resolve({ latitude: loc.lat(), longitude: loc.lng() });
    });
  });
}
