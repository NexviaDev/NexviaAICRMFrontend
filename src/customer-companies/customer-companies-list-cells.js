/**
 * 고객사 목록(customer-companies.js)과 동일한 셀 표시 규칙 — 열 순서·템플릿은 부모가 주는 displayColumns로 맞춤
 */
import { CUSTOM_FIELDS_PREFIX } from '@/lib/customer-company-search-fields';

const ADDRESS_LIST_DISPLAY_MAX = 15;

export const COMPANY_STATUS_LABEL = { active: '활성', inactive: '비활성', lead: '리드' };

export function formatBusinessNumber(num) {
  if (!num) return '—';
  const s = String(num).replace(/\D/g, '');
  if (s.length <= 3) return s;
  if (s.length <= 5) return `${s.slice(0, 3)}-${s.slice(3)}`;
  return `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5, 10)}`;
}

export function formatAddressForList(address) {
  if (address === undefined || address === null || address === '') return '—';
  const s = String(address);
  return s.length > ADDRESS_LIST_DISPLAY_MAX ? `${s.slice(0, ADDRESS_LIST_DISPLAY_MAX)}...` : s;
}

/** 기업명 아바타 이니셜 (연락처 리스트 getNameInitials 와 동일 규칙) */
export function getNameInitials(name) {
  const s = (name || '?').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  }
  return s.slice(0, 2).toUpperCase();
}

/**
 * @param {object} row - 고객사 문서
 * @param {string} key - 컬럼 키
 * @param {Record<string, string>} assigneeIdToName
 * @param {boolean} assigneeNamesReady
 */
export function cellValue(row, key, assigneeIdToName = {}, assigneeNamesReady = false) {
  if (key === 'name') return row.name || '—';
  if (key === 'representativeName') return row.representativeName || '—';
  if (key === 'industry') return row.industry || '—';
  if (key === 'businessNumber') return formatBusinessNumber(row.businessNumber);
  if (key === 'address') return formatAddressForList(row.address);
  if (key === 'status') {
    const st = (row.status || 'active').toLowerCase();
    return COMPANY_STATUS_LABEL[st] || row.status || '—';
  }
  if (key === 'assigneeUserIds') {
    const ids = Array.isArray(row.assigneeUserIds) ? row.assigneeUserIds : [];
    const names = ids.map((id) => assigneeIdToName[String(id)] || '').filter(Boolean);
    if (names.length) return names.join(', ');
    if (ids.length === 0) return '—';
    return assigneeNamesReady ? '—' : '담당자 불러오는 중...';
  }
  if (key.startsWith(CUSTOM_FIELDS_PREFIX)) {
    const fieldKey = key.slice(CUSTOM_FIELDS_PREFIX.length);
    const v = row.customFields?.[fieldKey];
    return v !== undefined && v !== null && v !== '' ? String(v) : '—';
  }
  return '—';
}
