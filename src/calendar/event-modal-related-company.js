/** 설명란에 붙이는 고객사 방문 블록 (제거 시 이 구간만 정확히 잘라냄) */
const MARK_START = '\n\n---\n[Nexvia CRM · 고객사 방문]\n';
const CONTACT_MARK_START = '\n\n---\n[Nexvia CRM · 연락처 방문]\n';
const MARK_END = '\n---';

/** Windows CRLF 등이 섞이면 strip 정규식이 매칭 실패 → 저장 시 블록이 한 번 더 붙음 */
function normalizeNewlines(s) {
  return String(s || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** 끝 \n--- 가 잘렸거나 맨 앞이 --- 로만 시작하는 구버전도 제거 (반복 호출로 연속 중복 정리) */
const RE_COMPANY_VISIT_BLOCK =
  /(?:^|\n\n)---\n\[Nexvia CRM · 고객사 방문\][\s\S]*?(?:\n---|$)/g;
const RE_CONTACT_VISIT_BLOCK =
  /(?:^|\n\n)---\n\[Nexvia CRM · 연락처 방문\][\s\S]*?(?:\n---|$)/g;

function stripUntilStable(text, re) {
  const source = re.source;
  const flags = re.flags;
  let d = normalizeNewlines(text);
  let prev;
  do {
    prev = d;
    d = d.replace(new RegExp(source, flags), '');
  } while (d !== prev);
  return d.trimEnd();
}

export function stripRelatedCompanyDescriptionBlock(text) {
  return stripUntilStable(text, RE_COMPANY_VISIT_BLOCK);
}

export function stripRelatedContactDescriptionBlock(text) {
  return stripUntilStable(text, RE_CONTACT_VISIT_BLOCK);
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
  let d = stripRelatedContactDescriptionBlock(stripRelatedCompanyDescriptionBlock(normalizeNewlines(description || '')));
  d = d.trimEnd();
  d = ensureRelatedCompanyDescription(d, relatedCompany);
  d = ensureRelatedContactDescription(d, relatedContact);
  return d;
}
