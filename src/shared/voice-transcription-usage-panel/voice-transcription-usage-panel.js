import {
  formatHoursMinutesShort,
  formatMonthKeyLabel,
  isTranscriptionQuotaExceeded
} from '@/lib/voice-transcription-usage';
import './voice-transcription-usage-panel.css';

/**
 * AI 음성·고객사·연락처 업무기록 공통 — 월 40시간 전사 사용량.
 * @param {{ usageStats: object|null, loading?: boolean, error?: string, compact?: boolean, className?: string }} props
 */
export default function VoiceTranscriptionUsagePanel({
  usageStats,
  loading = false,
  error = '',
  compact = false,
  className = ''
}) {
  const quotaExceeded = isTranscriptionQuotaExceeded(usageStats);
  const rootClass = [
    'voice-transcription-usage-panel',
    compact ? 'voice-transcription-usage-panel--compact' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass} aria-label="전사 사용량">
      <div className="voice-transcription-usage-panel-head">
        <span className="material-symbols-outlined" aria-hidden>
          analytics
        </span>
        <span className="voice-transcription-usage-panel-title">전사 사용량</span>
      </div>
      {loading && !usageStats ? (
        <div className="voice-transcription-usage-panel-skeleton" aria-busy="true">
          <span className="voice-transcription-usage-panel-skeleton-line" />
          <span className="voice-transcription-usage-panel-skeleton-bar" />
        </div>
      ) : null}
      {error ? <p className="voice-transcription-usage-panel-err">{error}</p> : null}
      {usageStats ? (
        <>
          <p className="voice-transcription-usage-panel-current">
            <span className="voice-transcription-usage-panel-label">{formatMonthKeyLabel(usageStats.currentMonthKey)}</span>
            <span className="voice-transcription-usage-panel-value">
              {formatHoursMinutesShort(usageStats.usedSeconds)} / {formatHoursMinutesShort(usageStats.limitSeconds)}
            </span>
            <span className="voice-transcription-usage-panel-remain">
              남음 <strong>{formatHoursMinutesShort(usageStats.remainingSeconds)}</strong>
            </span>
          </p>
          <div className="voice-transcription-usage-panel-bar-wrap" aria-hidden>
            <div
              className={`voice-transcription-usage-panel-bar-fill${quotaExceeded ? ' is-full' : ''}`}
              style={{
                width: `${Math.min(100, (usageStats.usedSeconds / Math.max(1, usageStats.limitSeconds)) * 100)}%`
              }}
            />
          </div>
          <p className="voice-transcription-usage-panel-note">
            AI 음성·고객사·연락처 업무기록 음성 합산 · 한국(서울) 기준 · 월 최대 40시간
          </p>
        </>
      ) : null}
    </div>
  );
}
