import { useState, useEffect, useCallback } from 'react';
import {
  CRM_PUSH_STATUS_EVENT,
  canUsePushNotifications,
  disablePushNotifications,
  enablePushNotifications,
  getFcmServiceWorkerDiagnostics,
  getPushNotificationStatus
} from '@/lib/push-notifications';

export function useSidebarPush(userSyncKey) {
  const [pushStatus, setPushStatus] = useState({
    supported: false,
    permission: 'default',
    registered: false
  });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const status = await getPushNotificationStatus();
    setPushStatus(status);
    return status;
  }, []);

  useEffect(() => {
    if (!userSyncKey) return undefined;
    let cancelled = false;
    refresh().catch(() => {
      if (!cancelled) {
        setPushStatus({ supported: false, permission: 'unsupported', registered: false });
      }
    });
    const onExternal = (e) => {
      const detail = e?.detail;
      if (detail && typeof detail === 'object') {
        setPushStatus(detail);
      } else {
        void refresh();
      }
    };
    window.addEventListener(CRM_PUSH_STATUS_EVENT, onExternal);
    return () => {
      cancelled = true;
      window.removeEventListener(CRM_PUSH_STATUS_EVENT, onExternal);
    };
  }, [userSyncKey, refresh]);

  const togglePush = useCallback(async () => {
    if (busy) return;
    if (!canUsePushNotifications()) {
      window.alert('이 브라우저는 푸시 알림을 지원하지 않습니다.');
      return;
    }
    if (pushStatus.permission === 'denied') {
      window.alert(
        '브라우저에서 알림이 차단되어 있습니다. 주소창 자물쇠(ⓘ) → 알림 허용 후 다시 눌러 주세요.'
      );
      return;
    }
    setBusy(true);
    try {
      if (pushStatus.registered) {
        const result = await disablePushNotifications();
        if (!result.ok) throw new Error(result.error || '푸시 알림 해제에 실패했습니다.');
      } else {
        const result = await enablePushNotifications({ forceRefresh: true });
        if (!result.ok) {
          throw new Error(result.error || '알림 설정을 완료하지 못했습니다.');
        }
        const sw = await getFcmServiceWorkerDiagnostics();
        if (!sw.ok && sw.message) {
          window.alert(sw.message);
        }
      }
      await refresh();
    } catch (err) {
      window.alert(err?.message || '알림 설정 중 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }, [busy, pushStatus.permission, pushStatus.registered, refresh]);

  const alarmTitle = !pushStatus.supported
    ? '이 브라우저는 푸시를 지원하지 않습니다'
    : pushStatus.permission === 'denied'
      ? '브라우저에서 알림이 차단됨 — 사이트 설정에서 허용'
      : pushStatus.registered
        ? '푸시 알림 켜짐 — 탭하면 끄기 (공지·일정·PC 등록 일정)'
        : '푸시 알림 꺼짐 — 탭하면 켜기 (폰에서 새 토큰 등록)';

  return { pushStatus, busy, togglePush, alarmTitle };
}
