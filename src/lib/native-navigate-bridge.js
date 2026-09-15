/**
 * Android 위젯 등 네이티브에서 주입하는 window.__nexviaNavigate 연결.
 * BrowserRouter 컨텍스트 안에서만 사용합니다.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function NativeNavigateBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    window.__nexviaNavigate = (path) => {
      if (typeof path !== 'string' || !path) return;
      const next = path.startsWith('/') ? path : `/${path}`;
      navigate(next);
    };
    return () => {
      try {
        if (typeof window.__nexviaNavigate === 'function') {
          delete window.__nexviaNavigate;
        }
      } catch {
        /* ignore */
      }
    };
  }, [navigate]);

  return null;
}
