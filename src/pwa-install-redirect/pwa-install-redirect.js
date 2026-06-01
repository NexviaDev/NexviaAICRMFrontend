import { useEffect } from 'react';
import {
  PWA_SITE_URL,
  buildAndroidChromeIntentUrl,
  isAndroidDevice,
} from '@/lib/pwa-open-in-chrome';
import './pwa-install-redirect.css';

const INSTALL_LANDING = `${PWA_SITE_URL}?from=install`;

/**
 * QR 코드 전용 — Android는 Chrome으로, iOS·PC는 홈(/)으로 이동
 */
export default function PwaInstallRedirect() {
  useEffect(() => {
    if (isAndroidDevice()) {
      const intentUrl = buildAndroidChromeIntentUrl(INSTALL_LANDING);
      window.location.replace(intentUrl);
      const fallbackTimer = window.setTimeout(() => {
        window.location.replace(INSTALL_LANDING);
      }, 1400);
      return () => window.clearTimeout(fallbackTimer);
    }
    window.location.replace(INSTALL_LANDING);
    return undefined;
  }, []);

  return (
    <div className="pwa-install-redirect" role="status" aria-live="polite">
      <p>설치 페이지로 이동 중입니다…</p>
      <p className="pwa-install-redirect__sub">
        Android에서는 <strong>Chrome</strong>으로 열립니다.
      </p>
    </div>
  );
}
