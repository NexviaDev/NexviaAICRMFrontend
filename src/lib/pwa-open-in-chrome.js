/** PWA 설치·QR 유입 — Android에서 Chrome으로 열기 */
export const PWA_SITE_URL = 'https://www.nexviacrm.co.kr/';
export const PWA_INSTALL_ENTRY_URL = 'https://www.nexviacrm.co.kr/install';

export function isAndroidDevice() {
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(navigator.userAgent);
}

/** 삼성 인터넷·기본 브라우저 — Chrome Intent 전환이 필요한 경우 */
export function isSamsungInternet() {
  if (typeof navigator === 'undefined') return false;
  return /SamsungBrowser/i.test(navigator.userAgent);
}

export function shouldOfferOpenInChrome() {
  return isAndroidDevice() && (isSamsungInternet() || !/Chrome\//i.test(navigator.userAgent));
}

/**
 * Android Intent URL — QR·리다이렉트 페이지에서 Chrome 실행
 * @see https://developer.chrome.com/docs/android/intents
 */
export function buildAndroidChromeIntentUrl(httpsUrl) {
  const parsed = new URL(httpsUrl);
  const intentPath = `${parsed.host}${parsed.pathname}${parsed.search}`;
  const fallback = encodeURIComponent(httpsUrl);
  return (
    `intent://${intentPath}#Intent;` +
    'scheme=https;' +
    'action=android.intent.action.VIEW;' +
    'category=android.intent.category.BROWSABLE;' +
    'package=com.android.chrome;' +
    `S.browser_fallback_url=${fallback};` +
    'end'
  );
}

export function openInChrome(httpsUrl = PWA_SITE_URL) {
  if (typeof window === 'undefined') return;
  const intentUrl = buildAndroidChromeIntentUrl(httpsUrl);
  window.location.assign(intentUrl);
}
