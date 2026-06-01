/**
 * 첫 페인트·대시보드 API 이후에 무거운 부가 요청을 실행 (슬립·동시 접속 부담 완화).
 * @param {() => void} fn
 * @param {{ timeout?: number, delayMs?: number }} [options]
 * @returns {() => void} cancel
 */
export function deferAfterPaint(fn, options = {}) {
  const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : 2800;
  const delayMs = Number(options.delayMs) > 0 ? Number(options.delayMs) : 400;
  let cancelled = false;
  let idleId;
  let timeoutId;

  const run = () => {
    if (!cancelled) fn();
  };

  if (typeof window !== 'undefined' && typeof requestIdleCallback === 'function') {
    idleId = requestIdleCallback(run, { timeout });
  } else if (typeof window !== 'undefined') {
    timeoutId = window.setTimeout(run, delayMs);
  } else {
    run();
  }

  return () => {
    cancelled = true;
    if (idleId != null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(idleId);
    }
    if (timeoutId != null) {
      clearTimeout(timeoutId);
    }
  };
}
