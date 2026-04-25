import { pingBackendHealth } from '@/lib/backend-wake';

/** 백엔드 `journalFromAudioChunkSession.js` 의 MAX_TOTAL_BYTES 와 동기 */
export const JOURNAL_AUDIO_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

/** 이 크기 초과 시 서버 청크 세션(init → chunk → complete) 사용 (서버 청크 4MB·총 상한은 JOURNAL_AUDIO_MAX_TOTAL_BYTES) */
export const JOURNAL_AUDIO_CHUNK_THRESHOLD = 2 * 1024 * 1024;

/**
 * 업무 기록용 음성: 작은 파일은 단일 multipart, 큰 파일은 순차 청크 업로드 후 동일하게 jobId(202) 반환.
 * @param {object} p
 * @param {string} p.collectionBasePath - 예: `${API_BASE}/customer-company-employees`
 * @param {string} p.targetId - 연락처 또는 고객사 _id
 * @param {File} p.file
 * @param {() => Record<string, string>} p.getAuthHeader
 * @param {(ev: { sent: number, total: number, phase: 'upload' | 'processing' }) => void} [p.onProgress]
 */
export async function uploadJournalAudioFromFile({
  collectionBasePath,
  targetId,
  file,
  getAuthHeader,
  onProgress
}) {
  const tid = encodeURIComponent(String(targetId));
  const base = `${String(collectionBasePath).replace(/\/$/, '')}/${tid}`;

  await pingBackendHealth(getAuthHeader);

  /** JSON.stringify 는 undefined 값 키를 생략하므로, 반드시 숫자로 확정 (File/Blob.size 권장) */
  const fileByteLength =
    typeof file?.size === 'number' && Number.isFinite(file.size) && file.size >= 0 ? Math.floor(file.size) : NaN;
  if (!Number.isFinite(fileByteLength) || fileByteLength < 1) {
    throw new Error(
      '파일 크기(size)를 알 수 없어 업로드할 수 없습니다. 브라우저에서 파일을 다시 선택하거나 다른 형식으로 저장해 주세요.'
    );
  }
  if (fileByteLength > JOURNAL_AUDIO_MAX_TOTAL_BYTES) {
    const mb = Math.round(JOURNAL_AUDIO_MAX_TOTAL_BYTES / (1024 * 1024));
    throw new Error(
      `음성 파일이 서버 허용 크기(약 ${mb}MB)를 넘습니다. 탐색기에서 파일 속성의 크기를 확인한 뒤, 더 짧게 녹음하거나 압축해 주세요.`
    );
  }

  if (fileByteLength <= JOURNAL_AUDIO_CHUNK_THRESHOLD) {
    const form = new FormData();
    form.append('audio', file);
    const res = await fetch(`${base}/history/from-audio`, {
      method: 'POST',
      headers: getAuthHeader(),
      credentials: 'include',
      body: form
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '음성 업로드 처리에 실패했습니다.');
    if (res.status !== 202 || !data.jobId) {
      throw new Error(data.error || '서버 응답 형식을 알 수 없습니다.');
    }
    onProgress?.({ sent: fileByteLength, total: fileByteLength, phase: 'upload' });
    return data;
  }

  const initRes = await fetch(`${base}/history/from-audio/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify({ totalBytes: fileByteLength, fileName: file.name || 'audio' })
  });
  const initData = await initRes.json().catch(() => ({}));
  if (!initRes.ok) throw new Error(initData.error || '업로드 준비에 실패했습니다.');
  const { uploadId, chunkSizeBytes } = initData;
  if (!uploadId) throw new Error(initData.error || 'uploadId를 받지 못했습니다.');
  const chunkCap = 4 * 1024 * 1024;
  const chunkSize = Math.min(Number(chunkSizeBytes) > 0 ? Number(chunkSizeBytes) : chunkCap, chunkCap);

  let offset = 0;
  let chunkIndex = 0;
  while (offset < fileByteLength) {
    if (chunkIndex > 0 && chunkIndex % 3 === 0) {
      try {
        await pingBackendHealth(getAuthHeader);
      } catch (_) {}
    }
    const end = Math.min(offset + chunkSize, fileByteLength);
    const slice = file.slice(offset, end);
    const buf = await slice.arrayBuffer();
    const res = await fetch(`${base}/history/from-audio/chunk`, {
      method: 'POST',
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'application/octet-stream',
        'X-Upload-Id': uploadId,
        'X-Chunk-Index': String(chunkIndex)
      },
      credentials: 'include',
      body: buf
    });
    const errData = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(errData.error || `청크 전송에 실패했습니다. (${chunkIndex + 1}번째)`);
    }
    offset = end;
    chunkIndex += 1;
    onProgress?.({ sent: offset, total: fileByteLength, phase: 'upload' });
  }

  const compRes = await fetch(`${base}/history/from-audio/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify({ uploadId })
  });
  const compData = await compRes.json().catch(() => ({}));
  if (!compRes.ok || compRes.status !== 202 || !compData.jobId) {
    throw new Error(compData.error || '업로드 마무리에 실패했습니다.');
  }
  onProgress?.({ sent: fileByteLength, total: fileByteLength, phase: 'processing' });
  return compData;
}
