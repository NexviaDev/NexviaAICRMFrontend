/**
 * 업무 기록 본문을 문단·문장 단위로 나눠 타임라인 렌더용.
 * @returns {string[][]} 문단별 문장 배열
 */
export function splitContentIntoBlocks(text) {
  if (!text || typeof text !== 'string') return [];
  const trimmed = text.trim().replace(/\r\n/g, '\n');
  if (!trimmed) return [];

  if (/^[\s]*[-•*]\s/m.test(trimmed) || /^[\s]*\d+[.)]\s/m.test(trimmed)) {
    return trimmed
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => [line]);
  }

  const paragraphs = trimmed.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  return paragraphs.map((para) => splitParagraphIntoSentences(para));
}

function splitParagraphIntoSentences(para) {
  const sentences = para.split(/(?<=[.!?。？！…])\s*/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length > 1) return sentences;
  if (para.length <= 96) return [para];
  const chunks = [];
  let rest = para;
  while (rest.length > 96) {
    let cut = rest.lastIndexOf(' ', 96);
    if (cut < 32) cut = rest.lastIndexOf('，', 96);
    if (cut < 32) cut = rest.lastIndexOf(',', 96);
    if (cut < 32) cut = 96;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.length ? chunks : [para];
}

/** textarea·저장 직전: 문장마다 줄바꿈 */
export function formatJournalTextForDisplay(text) {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim().replace(/\r\n/g, '\n');
  if (!trimmed) return '';
  if (trimmed.includes('\n')) return trimmed;
  const sentences = trimmed.split(/(?<=[.!?。？！…])\s*/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length > 1) return sentences.join('\n');
  return trimmed;
}
