/** 설명란에 붙이는 고객사 방문 블록 (제거 시 이 구간만 정확히 잘라냄) */
const MARK_START = '\n\n---\n[Nexvia CRM · 고객사 방문]\n';
const CONTACT_MARK_START = '\n\n---\n[Nexvia CRM · 연락처 방문]\n';
const MARK_END = '\n---';

export function stripRelatedCompanyDescriptionBlock(text) {
  return String(text || '').replace(/\n\n---\n\[Nexvia CRM · 고객사 방문\][\s\S]*?\n---\s*/g, '').trimEnd();
}

export function stripRelatedContactDescriptionBlock(text) {
  return String(text || '').replace(/\n\n---\n\[Nexvia CRM · 연락처 방문\][\s\S]*?\n---\s*/g, '').trimEnd();
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

/** 등록 고객사 소속이면 고객사명·주소 줄 추가, 아니면 이름·연락처·이메일만 */
export function buildRelatedContactDescriptionBlock(rel) {
  const name = (rel?.name || '').trim() || '—';
  const phone = (rel?.phone || '').trim() || '—';
  const email = (rel?.email || '').trim() || '—';
  const lines = [`이름: ${name}`, `연락처: ${phone}`, `이메일: ${email}`];
  const cn = (rel?.companyName || '').trim();
  const ca = (rel?.companyAddress || '').trim();
  if (cn) {
    lines.push(`고객사: ${cn}`);
    lines.push(`장소: ${ca || '주소 미등록'}`);
  }
  return `${CONTACT_MARK_START}${lines.join('\n')}${MARK_END}`;
}

export function ensureRelatedContactDescription(description, related) {
  const base = stripRelatedContactDescriptionBlock(description);
  if (!related || !related._id) return base;
  const block = buildRelatedContactDescriptionBlock(related);
  const t = base.trim();
  if (!t) return block.trim();
  return `${t}${block}`;
}

/** 고객사 블록 후 연락처 블록 순으로 설명 정리 */
export function ensureAllRelatedVisitDescriptions(description, relatedCompany, relatedContact) {
  let d = stripRelatedContactDescriptionBlock(stripRelatedCompanyDescriptionBlock(description || ''));
  d = d.trimEnd();
  d = ensureRelatedCompanyDescription(d, relatedCompany);
  d = ensureRelatedContactDescription(d, relatedContact);
  return d;
}
