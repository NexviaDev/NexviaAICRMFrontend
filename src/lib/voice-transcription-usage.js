import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '@/config';
import { AI_VOICE_LIST_POLL_MS } from '@/lib/polling-intervals';

export const VOICE_TRANSCRIPTION_USAGE_CHANGED = 'crm-voice-transcription-usage-changed';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 전사 사용량(초) → 표시용 */
export function formatHoursMinutesShort(sec) {
  if (sec == null || Number.isNaN(Number(sec))) return '—';
  const n = Math.max(0, Math.floor(Number(sec)));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분`;
}

export function formatMonthKeyLabel(monthKey) {
  if (!monthKey || typeof monthKey !== 'string') return '';
  const [y, mo] = monthKey.split('-');
  if (!y || !mo) return monthKey;
  return `${y}년 ${Number(mo)}월`;
}

export function isTranscriptionQuotaExceeded(usageStats) {
  if (!usageStats?.limitSeconds) return false;
  return usageStats.remainingSeconds <= 0 || usageStats.usedSeconds >= usageStats.limitSeconds;
}

export function notifyVoiceTranscriptionUsageChanged() {
  try {
    window.dispatchEvent(new CustomEvent(VOICE_TRANSCRIPTION_USAGE_CHANGED));
  } catch {
    /* ignore */
  }
}

export async function fetchVoiceTranscriptionUsage() {
  const res = await fetch(`${API_BASE}/voice-recordings/usage-stats`, { headers: getAuthHeader() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '전사 사용량 조회 실패');
  return data;
}

/**
 * AI 음성·고객사·연락처 업무기록 — 동일 월 40시간 한도 표시.
 * @param {{ pollWhileProcessing?: boolean }} [options]
 */
export function useVoiceTranscriptionUsage(options = {}) {
  const pollWhileProcessing = options.pollWhileProcessing === true;
  const [usageStats, setUsageStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const data = await fetchVoiceTranscriptionUsage();
      setUsageStats(data);
    } catch (e) {
      if (!silent) {
        setError(e.message || '전사 사용량 조회 실패');
        setUsageStats(null);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  useEffect(() => {
    const onChanged = () => void refresh(true);
    window.addEventListener(VOICE_TRANSCRIPTION_USAGE_CHANGED, onChanged);
    return () => window.removeEventListener(VOICE_TRANSCRIPTION_USAGE_CHANGED, onChanged);
  }, [refresh]);

  useEffect(() => {
    if (!pollWhileProcessing) return undefined;
    const id = setInterval(() => void refresh(true), AI_VOICE_LIST_POLL_MS);
    return () => clearInterval(id);
  }, [pollWhileProcessing, refresh]);

  const quotaExceeded = isTranscriptionQuotaExceeded(usageStats);

  return { usageStats, loading, error, refresh, quotaExceeded };
}
