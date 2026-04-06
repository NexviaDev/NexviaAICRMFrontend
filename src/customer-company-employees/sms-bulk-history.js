/** 브라우저 localStorage — 단체 문자 열기 기록 (같은 PC·브라우저) */

export const SMS_BULK_HISTORY_KEY = 'nexvia_crm_sms_bulk_history_v1';
const MAX_ENTRIES = 100;

export function loadSmsBulkHistory() {
  try {
    const raw = localStorage.getItem(SMS_BULK_HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveSmsBulkHistory(entries) {
  try {
    const trimmed = entries.slice(0, MAX_ENTRIES);
    localStorage.setItem(SMS_BULK_HISTORY_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota 등 */
  }
}

/**
 * @param {{ title: string, body: string, contacts: Array<{ _id?: string, name?: string, company?: string, phone?: string }> }} record
 */
export function appendSmsBulkHistory(record) {
  const list = loadSmsBulkHistory();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  list.unshift({
    id,
    createdAt: now,
    lastSentAt: now,
    title: String(record.title || '').trim() || '(제목 없음)',
    body: String(record.body || ''),
    contacts: Array.isArray(record.contacts) ? record.contacts : []
  });
  saveSmsBulkHistory(list);
  return list;
}

export function removeSmsBulkHistoryEntry(id) {
  const list = loadSmsBulkHistory().filter((e) => e.id !== id);
  saveSmsBulkHistory(list);
  return list;
}

/** 같은 연락처·전화 중복 제거용 키 */
export function contactSnapshotKey(c) {
  if (c?._id != null && String(c._id).trim() !== '') return `id:${String(c._id)}`;
  const p = String(c?.phone ?? '')
    .trim()
    .replace(/[^\d+]/g, '');
  return `ph:${p}`;
}

/**
 * @param {string} id
 * @param {Partial<{ title: string, body: string, contacts: unknown[], lastSentAt: string }>} patch
 */
export function updateSmsBulkHistoryEntry(id, patch) {
  const list = loadSmsBulkHistory();
  const idx = list.findIndex((e) => e.id === id);
  if (idx < 0) return list;
  const prev = list[idx];
  list[idx] = {
    ...prev,
    ...patch,
    contacts: patch.contacts !== undefined ? patch.contacts : prev.contacts
  };
  saveSmsBulkHistory(list);
  return list;
}

/**
 * 문자 앱으로 열기 직후 저장 — `existingId`가 있으면 같은 항목만 갱신(새 줄 생기지 않음)
 * @param {{ title: string, body: string, contacts: unknown[], existingId?: string }} payload
 */
export function saveBulkSmsAfterSend(payload) {
  const title = String(payload.title || '').trim() || '(제목 없음)';
  const body = String(payload.body || '');
  const contacts = Array.isArray(payload.contacts) ? payload.contacts : [];
  const { existingId } = payload;
  if (existingId) {
    return updateSmsBulkHistoryEntry(existingId, {
      title,
      body,
      contacts,
      lastSentAt: new Date().toISOString()
    });
  }
  return appendSmsBulkHistory({ title, body, contacts });
}
