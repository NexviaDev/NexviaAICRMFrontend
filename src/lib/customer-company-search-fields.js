/** API `searchField` 와 동기 — 백엔드 `customerCompanies.list` 의 단일 필드 검색·커스텀 `customFields.*` */
export const CUSTOM_FIELDS_PREFIX = 'customFields.';

export const BASE_SEARCH_FIELD_OPTIONS = [
  { key: 'name', label: '기업명' },
  { key: 'representativeName', label: '대표자' },
  { key: 'businessNumber', label: '사업자 번호' },
  { key: 'industry', label: '업종' },
  { key: 'address', label: '주소' },
  { key: 'status', label: '상태' },
  { key: 'assigneeUserIds', label: '담당자' },
  { key: 'memo', label: '메모' },
  { key: 'code', label: '코드' }
];
