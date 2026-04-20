/**
 * 배열을 동시에 최대 `concurrency`개까지 처리해 결과를 입력 순서대로 반환합니다.
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, concurrency, fn) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const n = items.length;
  const c = Math.max(1, Math.min(Number(concurrency) || 4, n));
  const results = new Array(n);
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= n) break;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: c }, () => worker()));
  return results;
}
