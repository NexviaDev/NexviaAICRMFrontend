/**
 * /ai-voice 와 동일한 음성 업로드·전사 대기·요약 확보.
 * (직접 업로드 + 대용량 청크 분할)
 */
import { API_BASE } from '@/config';
import { crmFetchInit } from '@/lib/crm-auth';
import { pingBackendHealth } from '@/lib/backend-wake';
import { notifyVoiceTranscriptionUsageChanged } from '@/lib/voice-transcription-usage';

export const VOICE_DIRECT_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
const AUDIO_NAME_RE = /\.(mp3|wav|m4a|webm)$/i;
const AUDIO_MIME = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm', 'audio/webm;codecs=opus'];

export function isAllowedVoiceAudioFile(file) {
  if (!file || !(file instanceof File)) return false;
  return AUDIO_NAME_RE.test(file.name || '') || AUDIO_MIME.some((t) => String(file.type || '').startsWith(t.split(';')[0]));
}

async function uploadChunked(file, title, onStatus) {
  const s = await fetch(`${API_BASE}/voice-recordings/chunked/session`, crmFetchInit({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      totalBytes: file.size,
      mimeType: file.type || ''
    })
  }));
  const sData = await s.json().catch(() => ({}));
  if (!s.ok) throw new Error(sData.error || '분할 업로드 준비 실패');
  const { sessionId, chunkSizeBytes } = sData;
  if (!sessionId || !Number(chunkSizeBytes)) throw new Error('분할 업로드 준비 실패');

  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSizeBytes));
  let offset = 0;
  let chunkIdx = 0;
  while (offset < file.size) {
    chunkIdx += 1;
    onStatus?.(`긴 파일 분할 전송 ${chunkIdx}/${totalChunks}…`);
    const end = Math.min(offset + chunkSizeBytes, file.size);
    const slice = file.slice(offset, end);
    const form = new FormData();
    form.append('chunk', slice, file.name);
    form.append('offset', String(offset));
    const r = await fetch(
      `${API_BASE}/voice-recordings/chunked/${encodeURIComponent(sessionId)}/chunk`,
      crmFetchInit({ method: 'POST', body: form })
    );
    const rData = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(rData.error || '조각 전송 실패');
    offset = Number(rData.receivedBytes) || offset + slice.size;
    if (rData.done || offset >= file.size) break;
  }

  onStatus?.('서버에서 전사 요청 중…');
  const done = await fetch(
    `${API_BASE}/voice-recordings/chunked/${encodeURIComponent(sessionId)}/complete`,
    crmFetchInit({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    })
  );
  const doneData = await done.json().catch(() => ({}));
  if (!done.ok) {
    const err = new Error(doneData.error || '등록 실패');
    err.status = done.status;
    err.code = doneData.code;
    throw err;
  }
  return doneData;
}

/**
 * 음성 파일 업로드 → VoiceRecording 문서 반환 (status: queued|processing|completed…)
 */
export async function uploadVoiceRecordingFile(file, { title, onStatus, getAuthHeader } = {}) {
  if (!isAllowedVoiceAudioFile(file)) {
    throw new Error('MP3, WAV, M4A, WebM 파일만 업로드할 수 있습니다.');
  }
  await pingBackendHealth(getAuthHeader);
  const baseTitle = String(title || file.name.replace(/\.[^.]+$/, '') || '채팅 녹음').trim() || '채팅 녹음';

  let data;
  if (file.size > VOICE_DIRECT_UPLOAD_MAX_BYTES) {
    data = await uploadChunked(file, baseTitle, onStatus);
  } else {
    onStatus?.('업로드 중…');
    const form = new FormData();
    form.append('audio', file);
    form.append('title', baseTitle);
    const res = await fetch(`${API_BASE}/voice-recordings`, crmFetchInit({ method: 'POST', body: form }));
    const resData = await res.json().catch(() => ({}));
    if (!res.ok && res.status === 413 && resData.useChunkedUpload) {
      data = await uploadChunked(file, baseTitle, onStatus);
    } else if (!res.ok) {
      const err = new Error(resData.error || '업로드 실패');
      err.status = res.status;
      err.code = resData.code;
      throw err;
    } else {
      data = resData;
    }
  }
  notifyVoiceTranscriptionUsageChanged();
  return data;
}

async function fetchVoiceRecording(id) {
  const res = await fetch(`${API_BASE}/voice-recordings/${encodeURIComponent(id)}`, crmFetchInit());
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '음성 기록을 불러오지 못했습니다.');
  return data;
}

async function ensureSummary(id, existingSummary) {
  const cur = String(existingSummary || '').trim();
  if (cur) return cur;
  const res = await fetch(
    `${API_BASE}/voice-recordings/${encodeURIComponent(id)}/summarize`,
    crmFetchInit({ method: 'POST' })
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요약 생성에 실패했습니다.');
  return String(data.summary || '').trim();
}

/**
 * 전사 완료까지 폴링 후 요약 문자열 반환 (/ai-voice 와 동일 파이프라인)
 * @returns {Promise<{ recording: object, summary: string }>}
 */
export async function waitForVoiceRecordingSummary(recordingId, { onStatus, pollMs = 3000, signal } = {}) {
  const id = String(recordingId || '').trim();
  if (!id) throw new Error('음성 기록 ID가 없습니다.');

  onStatus?.('전사 중… (길면 수 분 걸릴 수 있습니다)');
  let detail = await fetchVoiceRecording(id);

  while (detail.status === 'processing' || detail.status === 'queued') {
    if (signal?.aborted) {
      const err = new Error('취소되었습니다.');
      err.code = 'ABORTED';
      throw err;
    }
    await new Promise((r) => setTimeout(r, pollMs));
    detail = await fetchVoiceRecording(id);
  }

  if (detail.status === 'error') {
    throw new Error(detail.errorMessage || detail.error || '전사에 실패했습니다.');
  }
  if (detail.status !== 'completed') {
    throw new Error('전사 상태를 확인할 수 없습니다.');
  }

  onStatus?.('요약 준비 중…');
  const summary = await ensureSummary(id, detail.summary);
  if (!summary) throw new Error('요약 내용이 비어 있습니다.');
  notifyVoiceTranscriptionUsageChanged();
  return { recording: { ...detail, summary }, summary };
}

/**
 * 업로드 → 전사 대기 → 요약까지 한 번에
 */
export async function uploadVoiceAndGetSummary(file, opts = {}) {
  const rec = await uploadVoiceRecordingFile(file, opts);
  const id = rec?._id || rec?.id;
  return waitForVoiceRecordingSummary(id, opts);
}
