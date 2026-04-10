import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import './pwa-update-prompt.css';

/**
 * PWA: autoUpdate 모드에서는 새 SW 적용 시 플러그인이 자동으로 페이지를 새로고침합니다.
 * 이 컴포넌트는 오프라인 준비 토스트 + 주기·포커스 시 SW 업데이트 확인만 담당합니다.
 */
export default function PwaUpdatePrompt() {
  const swCleanupRef = useRef(null);

  const { offlineReady: [offlineReady, setOfflineReady] } = useRegisterSW({
    immediate: true,
    onRegisteredSW(swUrl, registration) {
      if (!registration || import.meta.env.DEV) return;
      swCleanupRef.current?.();
      const check = () => registration.update().catch(() => {});
      /** 앱으로 돌아올 때·탭 전환 후 빠르게 새 빌드 반영 (백엔드 슬립과 무관) */
      const onFocus = () => check();
      const onVis = () => {
        if (document.visibilityState === 'visible') check();
      };
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onVis);
      const intervalId = window.setInterval(check, 15 * 60 * 1000);
      swCleanupRef.current = () => {
        window.clearInterval(intervalId);
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onVis);
      };
    },
    onRegisterError(err) {
      if (import.meta.env.DEV) console.warn('[PWA] register', err);
    }
  });

  useEffect(() => {
    return () => {
      swCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (offlineReady) {
      const t = window.setTimeout(() => setOfflineReady(false), 4500);
      return () => window.clearTimeout(t);
    }
  }, [offlineReady, setOfflineReady]);

  return offlineReady ? (
    <div className="pwa-update-offline-toast" role="status">
      오프라인에서도 이전에 본 화면을 열 수 있습니다.
    </div>
  ) : null;
}
