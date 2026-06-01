import { useEffect, useRef } from 'react';
import { pingBackendHealth } from '@/lib/backend-wake';

const JOB_POLL_MS = 8000;

/**
 * 업로드 완료 후 서버 백그라운드 전사·요약·메모 자동 등록 상태를 가볍게 확인 (모달을 막지 않음).
 */
export function useJournalAudioJobWatcher({ pollUrl, getAuthHeader, enabled, onCompleted, onError }) {
  const completedRef = useRef(false);

  useEffect(() => {
    completedRef.current = false;
    if (!enabled || !pollUrl) return undefined;

    let cancelled = false;

    const tick = async () => {
      if (cancelled || completedRef.current) return;
      try {
        const res = await fetch(pollUrl, {
          headers: typeof getAuthHeader === 'function' ? getAuthHeader() : getAuthHeader || {},
          credentials: 'include'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '처리 상태를 불러오지 못했습니다.');
        if (data.status === 'completed') {
          completedRef.current = true;
          onCompleted?.(data);
          return;
        }
        if (data.status === 'error') {
          completedRef.current = true;
          onError?.(new Error(data.error || '음성 처리에 실패했습니다.'));
        }
      } catch (_) {
        /* 네트워크 끊김 등 — 서버 백그라운드 처리는 계속됨. 폴링만 다음 틱에 재시도 */
      }
    };

    void tick();
    const id = setInterval(() => void tick(), JOB_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollUrl, enabled, getAuthHeader, onCompleted, onError]);
}

/**
 * 음성 파일 업로드만 수행하고 jobId·pollUrl 반환 (전사·요약은 서버 백그라운드).
 */
export async function queueJournalAudioBackgroundJob({
  uploadJournalAudioFromFile,
  collectionBasePath,
  targetId,
  file,
  getAuthHeader,
  workCategory,
  contactChannel,
  onUploadProgress
}) {
  await pingBackendHealth(getAuthHeader);
  const data = await uploadJournalAudioFromFile({
    collectionBasePath,
    targetId,
    file,
    getAuthHeader,
    workCategory,
    contactChannel,
    onProgress: onUploadProgress
  });
  if (!data?.jobId) {
    throw new Error(data?.error || '서버 응답 형식을 알 수 없습니다.');
  }
  const pollUrl = `${String(collectionBasePath).replace(/\/$/, '')}/${encodeURIComponent(String(targetId))}/history/from-audio/jobs/${encodeURIComponent(data.jobId)}`;
  return { jobId: data.jobId, pollUrl };
}
