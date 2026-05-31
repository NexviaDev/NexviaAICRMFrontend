import { Fragment } from 'react';

/** @ 뒤 멘션 쿼리 — caret 기준 */
export function getMentionState(text, caretIndex) {
  const value = String(text ?? '');
  const caret = Math.max(0, Math.min(Number(caretIndex) || 0, value.length));
  const before = value.slice(0, caret);
  const atIndex = before.lastIndexOf('@');
  if (atIndex < 0) return null;
  const between = before.slice(atIndex + 1);
  if (/\s/.test(between)) return null;
  return {
    query: between,
    startIndex: atIndex,
    endIndex: caret
  };
}

export function filterParticipantsForMention(participants, query) {
  const q = String(query || '').trim().toLowerCase();
  const list = Array.isArray(participants) ? participants : [];
  if (!q) return list;
  return list.filter((row) => String(row?.name || '').toLowerCase().includes(q));
}

export function insertMentionAt(text, startIndex, endIndex, name) {
  const safeName = String(name || '').trim();
  if (!safeName) return { text: String(text || ''), caret: endIndex };
  const head = String(text || '').slice(0, startIndex);
  const tail = String(text || '').slice(endIndex);
  const mention = `@${safeName} `;
  const next = `${head}${mention}${tail}`;
  return { text: next, caret: head.length + mention.length };
}

export function renderMessageWithMentions(message) {
  const text = String(message || '');
  if (!text.includes('@')) return text;
  const parts = text.split(/(@[^\s@]+)/g);
  return parts.map((part, index) => {
    if (part.startsWith('@') && part.length > 1) {
      return (
        <span key={`m-${index}`} className="pfm-mention-tag">
          {part}
        </span>
      );
    }
    return <Fragment key={`t-${index}`}>{part}</Fragment>;
  });
}

export function extractMentionTokens(message) {
  const tokens = [];
  const re = /@([^\s@]+)/gu;
  let match;
  const text = String(message || '');
  while ((match = re.exec(text)) !== null) {
    const token = String(match[1] || '').trim();
    if (token) tokens.push(token);
  }
  return tokens;
}

/** 참여자 이름과 정확히 일치하는 @토큰만 유효 */
export function resolveValidMentionNames(message, participants) {
  const tokens = extractMentionTokens(message);
  if (!tokens.length) return [];
  const names = new Set(
    (Array.isArray(participants) ? participants : [])
      .map((row) => String(row?.name || '').trim())
      .filter(Boolean)
  );
  return [...new Set(tokens.filter((token) => names.has(token)))];
}
