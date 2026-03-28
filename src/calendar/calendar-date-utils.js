/** ISO 순간 → 서울 달력 YYYY-MM-DD (종일 일정·월 그리드에 공통 사용) */
export function formatDateInSeoulYmd(d) {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

/** YYYY-MM-DD 하루 전 */
export function ymdMinusOneDay(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (!y || !m || !d) return String(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** YYYY-MM-DD 하루 후 */
export function ymdAddOneDay(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (!y || !m || !d) return String(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/**
 * CRM 종일: DB end는 Google과 동일하게 '다음 날 0시(배타)'.
 * 서울 기준으로 배타 종료일과 시작일이 같은 달력이면 하루짜리로 본다(ymdMinusOneDay 하면 시작보다 작아져 그리드에서 사라짐).
 */
export function crmAllDayInclusiveEndYmd(startYmd, endExclusiveYmd) {
  if (!startYmd || !endExclusiveYmd) return startYmd || endExclusiveYmd;
  if (endExclusiveYmd <= startYmd) return startYmd;
  const last = ymdMinusOneDay(endExclusiveYmd);
  return last < startYmd ? startYmd : last;
}
