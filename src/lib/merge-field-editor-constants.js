/** 필드 값 종류(Word는 항상 문자 치환, Excel은 숫자 종류일 때만 셀 형식 적용 가능) */
export const MERGE_FIELD_VALUE_KINDS = [
  { id: 'text', label: '문자' },
  { id: 'number', label: '숫자·날짜·서식(Excel)' }
];

/** valueKind 가 number 일 때 Excel 표시 형식 */
export const MERGE_EXCEL_FORMATS = [
  { id: 'general', label: '일반' },
  { id: 'short_date', label: '간단 날짜' },
  { id: 'long_date', label: '자세한 날짜' },
  { id: 'accounting', label: '회계(₩)' },
  { id: 'number', label: '숫자' },
  { id: 'percent', label: '백분율' }
];
