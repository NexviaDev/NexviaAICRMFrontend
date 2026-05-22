import { useEffect } from "react";
import {
  PWA_SITE_URL,
  openInChrome,
  shouldOfferOpenInChrome,
} from "@/lib/pwa-open-in-chrome";
import "./home-pwa-install-modal.css";

function detectIos() {
  if (typeof navigator === "undefined") return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * 스마트폰 — PWA 미설치 시 설치 안내
 * Android: 예전처럼 「설치파일 받기」 한 번에 설치(beforeinstallprompt)
 * iOS: Safari 홈 화면에 추가 안내
 */
export default function HomePwaInstallModal({
  open,
  onClose,
  onInstall,
  installReady,
}) {
  const isIos = detectIos();
  const needsChrome = shouldOfferOpenInChrome();

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="nexvia-home-pwa-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nexvia-home-pwa-modal-title"
    >
      <div className="nexvia-home-pwa-modal__panel">
        <header className="nexvia-home-pwa-modal__header">
          <h2 id="nexvia-home-pwa-modal-title" className="nexvia-home-pwa-modal__title">
            Nexvia CRM 앱 설치
          </h2>
          <button
            type="button"
            className="nexvia-home-pwa-modal__close"
            onClick={onClose}
            aria-label="닫기"
          >
            <span className="material-symbols-outlined" aria-hidden>
              close
            </span>
          </button>
        </header>

        <div className="nexvia-home-pwa-modal__body">
          <p className="nexvia-home-pwa-modal__lead">
            QR 코드로 접속하셨다면 Android에서는 Chrome으로 열립니다. 아래 버튼으로
            Nexvia CRM 설치를 진행할 수 있습니다.
          </p>

          {isIos ? (
            <>
              <p className="nexvia-home-pwa-modal__hint">
                iPhone·iPad는 Safari에서 <strong>홈 화면에 추가</strong>로 설치합니다.
              </p>
              <ol className="nexvia-home-pwa-modal__steps">
                <li>
                  <span className="material-symbols-outlined" aria-hidden>
                    ios_share
                  </span>
                  Safari 하단 <strong>공유</strong> → <strong>홈 화면에 추가</strong>
                </li>
                <li>
                  <span className="material-symbols-outlined" aria-hidden>
                    check_circle
                  </span>
                  추가 후 홈 화면 아이콘으로 실행
                </li>
              </ol>
            </>
          ) : (
            <>
              {needsChrome ? (
                <>
                  <p className="nexvia-home-pwa-modal__hint nexvia-home-pwa-modal__hint--warn">
                    삼성 인터넷 등에서는 PWA 설치가 제한됩니다. 먼저{" "}
                    <strong>Chrome</strong>으로 열어 주세요.
                  </p>
                  <button
                    type="button"
                    className="nexvia-home-pwa-modal__chrome"
                    onClick={() => openInChrome(`${PWA_SITE_URL}?from=install`)}
                  >
                    <span className="material-symbols-outlined" aria-hidden>
                      open_in_browser
                    </span>
                    Chrome에서 열기
                  </button>
                </>
              ) : null}

              <button
                type="button"
                className="nexvia-home-pwa-modal__install"
                onClick={onInstall}
                disabled={!installReady || needsChrome}
              >
                <span className="material-symbols-outlined" aria-hidden>
                  download
                </span>
                설치파일 받기
              </button>

              {!installReady ? (
                <p className="nexvia-home-pwa-modal__waiting" role="status">
                  설치 준비 중입니다. <strong>Google Chrome</strong>으로 접속했는지 확인해
                  주세요.
                </p>
              ) : (
                <p className="nexvia-home-pwa-modal__hint">
                  버튼을 누르면 Android 설치 화면이 열립니다. Play 프로텍트 안내가 나오면
                  공식 사이트 설치이므로 <strong>무시하고 설치하기</strong>를 선택해 주세요.
                </p>
              )}

              <details className="nexvia-home-pwa-modal__manual">
                <summary>버튼이 안 될 때 (메뉴에서 직접 설치)</summary>
                <ol className="nexvia-home-pwa-modal__steps">
                  <li>
                    <span className="material-symbols-outlined" aria-hidden>
                      more_vert
                    </span>
                    Chrome 메뉴 <strong>⋮</strong> → <strong>앱 설치</strong> 또는{" "}
                    <strong>홈 화면에 추가</strong>
                  </li>
                </ol>
              </details>
            </>
          )}

          <button type="button" className="nexvia-home-pwa-modal__later" onClick={onClose}>
            나중에 보기
          </button>
        </div>
      </div>
    </div>
  );
}
