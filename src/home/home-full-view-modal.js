import { useEffect } from 'react';
import './home-full-view-modal.css';

/**
 * 홈 모바일: 중첩 스크롤 대신 「전체 보기」 단일 스크롤 모달
 * URL: ?homeView=todo|leads|calendar|channels (home.js에서 동기화)
 */
export default function HomeFullViewModal({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="home-full-view-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="home-full-view-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-full-view-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="home-full-view-head">
          <h2 id="home-full-view-title">{title}</h2>
          <button type="button" className="home-full-view-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined" aria-hidden>
              close
            </span>
          </button>
        </header>
        <div className="home-full-view-body">{children}</div>
      </div>
    </div>
  );
}
