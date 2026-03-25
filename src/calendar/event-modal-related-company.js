/** 설명란에 붙이는 고객사 방문 블록 (제거 시 이 구간만 정확히 잘라냄) */
const MARK_START = '\n\n---\n[Nexvia CRM · 고객사 방문]\n';
const MARK_END = '\n---';

export function stripRelatedCompanyDescriptionBlock(text) {
  return String(text || '').replace(/\n\n---\n\[Nexvia CRM · 고객사 방문\][\s\S]*?\n---\s*/g, '').trimEnd();
}

export function buildRelatedCompanyDescriptionBlock(name, address) {
  const place = (address || '').trim() || '주소 미등록';
  const n = (name || '').trim() || '고객사';
  return `${MARK_START}고객사: ${n}\n장소: ${place}${MARK_END}`;
}

export function ensureRelatedCompanyDescription(description, related) {
  const base = stripRelatedCompanyDescriptionBlock(description);
  if (!related || !related._id) return base;
  const block = buildRelatedCompanyDescriptionBlock(related.name, related.address);
  const t = base.trim();
  if (!t) return block.trim();
  return `${t}${block}`;
}
