/**
 * 주기 폴링 간격(ms). Vite 빌드 시 VITE_* 로 조정 (미설정 시 아래 기본값).
 * 값이 너무 작으면 서버·외부 API 부하가 커질 수 있습니다.
 */
function parseIntervalMs(envKey, defaultMs, minMs = 3000) {
  const raw =
    typeof import.meta !== 'undefined' && import.meta.env?.[envKey] != null
      ? String(import.meta.env[envKey]).trim()
      : '';
  if (raw === '') return defaultMs;
  const n = Number(raw);
  if (Number.isNaN(n) || n < minMs) return defaultMs;
  return n;
}

/** 메신저 열린 대화 메시지 폴링 (기본 10초) */
export const MESSENGER_MESSAGE_POLL_MS = parseIntervalMs(
  'VITE_MESSENGER_MESSAGE_POLL_MS',
  10000,
  5000
);

/** 레이아웃: 엑셀 import job 상태 확인 (기본 12초) */
export const LAYOUT_EXCEL_IMPORT_POLL_MS = parseIntervalMs(
  'VITE_LAYOUT_EXCEL_IMPORT_POLL_MS',
  12000,
  5000
);

/** AI 음성: 전사 대기 중 목록 silent 갱신 (기본 12초) */
export const AI_VOICE_LIST_POLL_MS = parseIntervalMs('VITE_AI_VOICE_LIST_POLL_MS', 12000, 5000);

/** 상단 공지 미읽음 배지 폴링 (기본 90초) */
export const NOTIFICATION_BADGE_POLL_MS = parseIntervalMs(
  'VITE_NOTIFICATION_BADGE_POLL_MS',
  90000,
  10000
);
