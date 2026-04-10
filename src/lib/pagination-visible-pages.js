/** 페이지 번호 최대 5개: 현재 기준 ±2, 끝에서는 윈도우가 밀림 (총 페이지 5 이하면 전부) */
export function getVisiblePageNumbers(current, total) {
  const t = Math.max(1, Number(total) || 1);
  const c = Math.min(Math.max(1, Number(current) || 1), t);
  if (t <= 5) return Array.from({ length: t }, (_, i) => i + 1);
  const start = Math.min(Math.max(1, c - 2), t - 4);
  return Array.from({ length: 5 }, (_, i) => start + i);
}
