import { useCallback, useEffect, useRef, useState } from 'react';
import { looksLikeGoogleMapsShare } from '@/lib/parse-google-maps-share';
import { resolveGoogleMapsShare } from '@/lib/resolve-google-maps-share';
import './map-google-share-panel.css';

/**
 * 구글맵 「공유」 링크 → 내 위치 반영
 */
export default function MapGoogleSharePanel({ open, onClose, onApplied, initialText = '' }) {
  const [text, setText] = useState(initialText);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoHint, setAutoHint] = useState('');
  const appliedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setText(initialText || '');
    setError('');
    setAutoHint('');
    appliedRef.current = false;
  }, [open, initialText]);

  const applyText = useCallback(
    async (raw, { fromClipboard = false } = {}) => {
      const value = String(raw || '').trim();
      if (!value) {
        setError('공유 링크를 붙여 넣어 주세요.');
        return;
      }
      setLoading(true);
      setError('');
      try {
        const result = await resolveGoogleMapsShare(value);
        appliedRef.current = true;
        onApplied?.(result);
        onClose?.();
      } catch (e) {
        setError(e.message || '위치를 적용하지 못했습니다.');
        if (fromClipboard) setAutoHint('');
      } finally {
        setLoading(false);
      }
    },
    [onApplied, onClose]
  );

  const readClipboard = useCallback(async () => {
    if (!navigator.clipboard?.readText) {
      setError('이 브라우저에서는 클립보드 읽기를 지원하지 않습니다. 링크를 직접 붙여 넣어 주세요.');
      return;
    }
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip?.trim()) {
        setError('클립보드가 비어 있습니다. 구글맵에서 「공유」 후 다시 시도해 주세요.');
        return;
      }
      setText(clip.trim());
      if (looksLikeGoogleMapsShare(clip)) {
        setAutoHint('클립보드에서 링크를 읽었습니다. 적용을 눌러 주세요.');
        await applyText(clip, { fromClipboard: true });
      } else {
        setAutoHint('클립보드 내용을 붙였습니다. 구글맵 링크인지 확인 후 적용해 주세요.');
      }
    } catch {
      setError('클립보드 접근이 거부되었습니다. 링크를 직접 붙여 넣어 주세요.');
    }
  }, [applyText]);

  useEffect(() => {
    if (!open || initialText) return undefined;
    const timer = window.setTimeout(() => {
      void readClipboard();
    }, 320);
    return () => window.clearTimeout(timer);
  }, [open, initialText, readClipboard]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="map-gmaps-share-modal" role="dialog" aria-modal="true" aria-labelledby="map-gmaps-share-title">
      <div className="map-gmaps-share-modal__panel">
        <header className="map-gmaps-share-modal__header">
          <h2 id="map-gmaps-share-title">구글맵 위치 가져오기</h2>
          <button type="button" className="map-gmaps-share-modal__close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined" aria-hidden>
              close
            </span>
          </button>
        </header>

        <div className="map-gmaps-share-modal__body">
          <p className="map-gmaps-share-modal__lead">
            구글맵에서 <strong>공유 → 링크 복사</strong>한 뒤, 아래에 붙여 넣거나 클립보드 불러오기를
            사용하세요. (maps.app.goo.gl · google.com/maps · google.co.kr/maps)
          </p>

          {autoHint ? <p className="map-gmaps-share-modal__hint">{autoHint}</p> : null}
          {error ? <p className="map-gmaps-share-modal__error">{error}</p> : null}

          <textarea
            className="map-gmaps-share-modal__input"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="https://maps.app.goo.gl/… 또는 공유 텍스트 전체"
            aria-label="구글맵 공유 링크"
          />

          <button
            type="button"
            className="map-gmaps-share-modal__secondary"
            onClick={readClipboard}
            disabled={loading}
          >
            <span className="material-symbols-outlined" aria-hidden>
              content_paste
            </span>
            클립보드에서 불러오기
          </button>

          <button
            type="button"
            className="map-gmaps-share-modal__primary"
            onClick={() => applyText(text)}
            disabled={loading || !text.trim()}
          >
            <span className="material-symbols-outlined" aria-hidden>
              pin_drop
            </span>
            {loading ? '위치 확인 중…' : '지도에 내 위치로 적용'}
          </button>
        </div>
      </div>
    </div>
  );
}
