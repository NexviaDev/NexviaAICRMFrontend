/** 환율 추이 모달 URL 쿼리 키·기간 옵션 (JSX 없음 — dev ESM 안정용) */
export const RATE_CHART_PARAM = 'rateChart';
export const RATE_PERIOD_PARAM = 'ratePeriod';

export const RATE_PERIODS = [
  { id: 'daily', label: '일별' },
  { id: 'monthly', label: '월별' },
  { id: 'quarterly', label: '분기별' },
  { id: 'semiannual', label: '반기별' },
  { id: 'yearly', label: '연도별' }
];
