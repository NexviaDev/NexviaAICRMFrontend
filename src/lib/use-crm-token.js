import { useEffect, useState } from 'react';

/** localStorage crm_token 동기화 (로그인·로그아웃 후 라우트 트리 갱신) */
export function useCrmToken() {
  const [token, setToken] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('crm_token') : null,
  );

  useEffect(() => {
    const sync = () => setToken(localStorage.getItem('crm_token'));
    window.addEventListener('storage', sync);
    window.addEventListener('focus', sync);
    window.addEventListener('nexvia-auth-changed', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener('nexvia-auth-changed', sync);
    };
  }, []);

  return token;
}

export function notifyCrmAuthChanged() {
  window.dispatchEvent(new Event('nexvia-auth-changed'));
}

/** 비로그인 전용 — 로그인 상태면 대시보드로 */
export function useGuestOnlyRedirect() {
  const token = useCrmToken();
  return token ? '/dashboard' : null;
}
