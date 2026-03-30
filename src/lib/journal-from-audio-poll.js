/**
 * POST /history/from-audio 가 202 + jobId 를 주면, job 완료까지 폴링 (ai-voice 상세 폴링과 유사).
 */
export async function pollJournalFromAudioJob(pollUrl, getAuthHeader, options = {}) {
  const intervalMs = options.intervalMs ?? 3000;
  const maxMs = options.maxMs ?? 15 * 60 * 1000;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res = await fetch(pollUrl, { headers: getAuthHeader(), credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '처리 상태를 불러오지 못했습니다.');
    if (data.status === 'completed') return data;
    if (data.status === 'error') throw new Error(data.error || '음성 처리에 실패했습니다.');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('음성 처리 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.');
}
