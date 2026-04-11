/**
 * 제품 리스트 아바타와 add-product 카테고리 선택 UI가 동일 아이콘·톤을 쓰도록 공통 정의
 */

/**
 * 카테고리 문자열(소문자) 부분 일치 — product-list resolveProductAvatar
 */
export const CATEGORY_AVATAR_RULES = [
  { icon: 'desktop_windows', tone: 0, keys: ['office', '오피스', '문서', 'productivity'] },
  { icon: 'architecture', tone: 1, keys: ['cad'] },
  { icon: 'precision_manufacturing', tone: 2, keys: ['cam', '가공', 'machining', 'nc '] },
  { icon: 'science', tone: 3, keys: ['cae', 'simulation', '시뮬', 'fea', 'cfd', '해석', 'multiphysics'] },
  { icon: 'shield', tone: 0, keys: ['security', '보안', '암호'] },
  { icon: 'cloud', tone: 1, keys: ['cloud', '클라우드', 'saas'] },
  { icon: 'database', tone: 2, keys: ['data', '데이터', 'database', 'dbms'] },
  { icon: 'router', tone: 3, keys: ['network', '네트워크', 'nw'] },
  { icon: 'code', tone: 1, keys: ['dev', 'sdk', 'api', '개발', '플러그인'] },
  { icon: 'palette', tone: 2, keys: ['design', '디자인', '그래픽', '렌더'] }
];

/** DB에 저장하는 소문자 key → 리스트와 동일 icon + tone */
const PRESET_KEY_AVATAR = {
  office: { icon: 'desktop_windows', tone: 0 },
  cad: { icon: 'architecture', tone: 1 },
  cam: { icon: 'precision_manufacturing', tone: 2 },
  cae: { icon: 'science', tone: 3 },
  security: { icon: 'shield', tone: 0 },
  cloud: { icon: 'cloud', tone: 1 },
  data: { icon: 'database', tone: 2 },
  network: { icon: 'router', tone: 3 },
  dev: { icon: 'code', tone: 1 },
  design: { icon: 'palette', tone: 2 },
  other: { icon: 'edit_note', tone: 3 }
};

/**
 * @param {string} key - office, cad, …, other / 빈 문자열은 null
 * @returns {{ icon: string, tone: number } | null}
 */
export function getPresetCategoryAvatar(key) {
  if (key == null || key === '') return null;
  return PRESET_KEY_AVATAR[key] || null;
}
