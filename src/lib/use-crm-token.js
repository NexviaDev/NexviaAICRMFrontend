import { useEffect, useState } from 'react';
import { hasCrmSession } from '@/lib/crm-auth';

/** CRM 로그인 세션 동기화 (crm_user + HttpOnly 쿠키) */
export function useCrmToken() {
  const [active, setActive] = useState(() =>
    typeof window !== 'undefined' ? hasCrmSession() : false,
  );

  useEffect(() => {
    const sync = () => setActive(hasCrmSession());
    window.addEventListener('storage', sync);
    window.addEventListener('focus', sync);
    window.addEventListener('nexvia-auth-changed', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener('nexvia-auth-changed', sync);
    };
  }, []);

  return active ? 'session' : '';
}

export function notifyCrmAuthChanged() {
  window.dispatchEvent(new Event('nexvia-auth-changed'));
}

/** 비로그인 전용 — 로그인 상태면 대시보드로 */
export function useGuestOnlyRedirect() {
  const token = useCrmToken();
  return token ? '/dashboard' : null;
}
