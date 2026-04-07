import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import './pwa-update-prompt.css';

/** 배포 후 새 SW 감지 시 안내 — PWA 캐시로 옛 JS/CSS가 남는 문제 완화 (PC·모바일 동일) */
export default function PwaUpdatePrompt() {
  const intervalRef = useRef(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(swUrl, registration) {
      if (!registration || import.meta.env.DEV) return;
      /** 장시간 열린 탭에서도 주기적으로 새 빌드 확인 (백엔드 슬립과 무관, 브라우저만) */
      intervalRef.current = window.setInterval(() => {
        registration.update().catch(() => {});
      }, 60 * 60 * 1000);
    },
    onRegisterError(err) {
      if (import.meta.env.DEV) console.warn('[PWA] register', err);
    }
  });

  useEffect(() => {
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (offlineReady) {
      const t = window.setTimeout(() => setOfflineReady(false), 4500);
      return () => window.clearTimeout(t);
    }
  }, [offlineReady, setOfflineReady]);

  return (
    <>
      {offlineReady ? (
        <div className="pwa-update-offline-toast" role="status">
          오프라인에서도 이전에 본 화면을 열 수 있습니다.
        </div>
      ) : null}

      {needRefresh ? (
        <div className="pwa-update-banner" role="alert">
          <p className="pwa-update-banner-text">새 버전이 배포되었습니다. 적용하려면 새로고침하세요.</p>
          <div className="pwa-update-banner-actions">
            <button
              type="button"
              className="pwa-update-btn pwa-update-btn--primary"
              onClick={() => {
                void updateServiceWorker(true);
              }}
            >
              지금 새로고침
            </button>
            <button type="button" className="pwa-update-btn pwa-update-btn--ghost" onClick={() => setNeedRefresh(false)}>
              나중에
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
