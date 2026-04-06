import { useMemo } from 'react';
import { phoneToSmsHref } from '../sms-draft-modal/sms-draft-modal';
import { contactSnapshotKey } from '../sms-bulk-history';
import './sms-bulk-history-modal.css';

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   entries: Array<{ id: string, title?: string, body?: string, contacts?: unknown[], createdAt?: string, lastSentAt?: string }>,
 *   pickableContacts: Array<{ _id?: string, name?: string, company?: string, phone?: string }>,
 *   onResend: (entry: object) => void,
 *   onDeleteEntry: (id: string) => void,
 *   onUpdateEntryContacts: (entryId: string, contacts: unknown[]) => void
 * }} props
 */
export default function SmsBulkHistoryModal({
  open,
  onClose,
  entries,
  pickableContacts = [],
  onResend,
  onDeleteEntry,
  onUpdateEntryContacts
}) {
  const addableByEntry = useMemo(() => {
    const map = new Map();
    for (const entry of entries || []) {
      const inKeys = new Set((entry.contacts || []).map((c) => contactSnapshotKey(c)));
      const addable = (pickableContacts || []).filter((row) => {
        if (!phoneToSmsHref(row?.phone, '')) return false;
        return !inKeys.has(contactSnapshotKey(row));
      });
      map.set(entry.id, addable);
    }
    return map;
  }, [entries, pickableContacts]);

  if (!open) return null;

  return (
    <div
      className="cce-sms-history-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="cce-sms-history-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cce-sms-history-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cce-sms-history-head">
          <h3 id="cce-sms-history-title">단체 문자 기록</h3>
          <button type="button" className="cce-sms-history-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <p className="cce-sms-history-hint">
          「문자 앱으로 열기 (단체)」를 눌렀을 때의 제목·본문·수신자가 이 기기 브라우저에만 저장됩니다. 다시 보내면 같은 항목이 갱신됩니다. 참여자는 아래에서 수정할 수 있으며, 추가는 현재 목록(이 페이지)에 보이는 연락처에서만 선택할 수 있습니다.
        </p>
        {!entries?.length ? (
          <p className="cce-sms-history-empty">아직 저장된 단체 문자 기록이 없습니다.</p>
        ) : (
          <ul className="cce-sms-history-list">
            {entries.map((entry) => {
              const contacts = Array.isArray(entry.contacts) ? entry.contacts : [];
              const n = contacts.length;
              const preview = String(entry.body || '').replace(/\s+/g, ' ').trim().slice(0, 120);
              const created = formatWhen(entry.createdAt);
              const last = entry.lastSentAt ? formatWhen(entry.lastSentAt) : null;
              const addable = addableByEntry.get(entry.id) || [];

              return (
                <li key={entry.id} className="cce-sms-history-item">
                  <div className="cce-sms-history-item-top">
                    <strong className="cce-sms-history-item-title">{entry.title || '(제목 없음)'}</strong>
                    <span className="cce-sms-history-item-meta">
                      최초 저장 {created}
                      {last ? ` · 마지막 문자 앱 열기 ${last}` : ''}
                      {' · '}
                      수신 {n}명
                    </span>
                  </div>

                  {n > 0 ? (
                    <ul className="cce-sms-history-participants" aria-label="참여 수신자">
                      {contacts.map((c, i) => (
                        <li key={`${entry.id}-p-${contactSnapshotKey(c)}-${i}`} className="cce-sms-history-chip">
                          <div className="cce-sms-history-chip-main">
                            <span className="cce-sms-history-chip-name">
                              {c?.name || '이름 없음'}
                              {c?.company ? <span className="cce-sms-history-chip-company"> · {c.company}</span> : null}
                            </span>
                            <span className="cce-sms-history-chip-phone">{c?.phone || '—'}</span>
                          </div>
                          <button
                            type="button"
                            className="cce-sms-history-chip-remove"
                            aria-label={`${c?.name || '수신자'} 제거`}
                            title="목록에서 제거"
                            onClick={() => {
                              const next = contacts.filter((_, idx) => idx !== i);
                              onUpdateEntryContacts(entry.id, next);
                            }}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="cce-sms-history-add-hint">수신자가 없습니다. 아래에서 추가하거나 다시 보내기 전에 모달에서 수신자를 확인하세요.</p>
                  )}

                  <div className="cce-sms-history-add-row">
                    <select
                      className="cce-sms-history-add-select"
                      defaultValue=""
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        const row = pickableContacts.find((r) => String(r._id) === String(v));
                        e.target.value = '';
                        if (!row || !phoneToSmsHref(row.phone, '')) return;
                        const keys = new Set(contacts.map((c) => contactSnapshotKey(c)));
                        if (keys.has(contactSnapshotKey(row))) return;
                        const snap = {
                          _id: row._id,
                          name: row.name,
                          company: row.company,
                          phone: row.phone
                        };
                        onUpdateEntryContacts(entry.id, [...contacts, snap]);
                      }}
                      aria-label="현재 목록에서 참여자 추가"
                    >
                      <option value="">현재 목록에서 참여자 추가…</option>
                      {addable.map((row) => (
                        <option key={String(row._id)} value={String(row._id)}>
                          {(row.name || '이름 없음') + (row.phone ? ` (${row.phone})` : '')}
                        </option>
                      ))}
                    </select>
                  </div>
                  {pickableContacts.length === 0 ? (
                    <p className="cce-sms-history-add-hint">목록이 비어 있으면 추가할 수 없습니다. 연락처가 보이는 페이지에서 이 창을 연 뒤 선택하세요.</p>
                  ) : addable.length === 0 ? (
                    <p className="cce-sms-history-add-hint">이 페이지에서 추가할 수 있는 연락처가 없거나 이미 모두 포함되었습니다.</p>
                  ) : null}

                  {preview ? (
                    <p className="cce-sms-history-item-preview">
                      {preview}
                      {String(entry.body || '').length > 120 ? '…' : ''}
                    </p>
                  ) : null}
                  <div className="cce-sms-history-item-actions">
                    <button
                      type="button"
                      className="btn-outline cce-sms-history-resend"
                      onClick={() => onResend(entry)}
                    >
                      다시 보내기
                    </button>
                    <button
                      type="button"
                      className="cce-sms-history-delete"
                      onClick={() => onDeleteEntry(entry.id)}
                      aria-label="이 기록 삭제"
                    >
                      <span className="material-symbols-outlined">delete</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
