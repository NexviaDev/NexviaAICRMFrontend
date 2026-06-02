import { useState, useMemo, useCallback } from 'react';
import ParticipantModal from '@/shared/participant-modal/participant-modal';
import './add-todo-modal.css';

function initialsForMember(m) {
  const n = (m?.name || m?.email || '').trim();
  if (!n) return '?';
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

function idKey(id) {
  return id != null ? String(id) : '';
}

/**
 * 새 할 일 추가 모달 — 참여자는 ParticipantModal(조직도·검색)로 선택
 */
export default function AddTodoModal({
  onClose,
  form,
  setForm,
  taskLists,
  createListTitle,
  setCreateListTitle,
  handleCreateList,
  creatingList,
  addTask,
  addingTask = false,
  companyMembers,
  currentUserId
}) {
  const [showParticipantModal, setShowParticipantModal] = useState(false);

  const currentUser = useMemo(() => {
    if (!currentUserId) return null;
    const m = companyMembers.find((x) => idKey(x._id) === idKey(currentUserId));
    if (m) return { _id: m._id, name: m.name, email: m.email };
    return { _id: currentUserId };
  }, [companyMembers, currentUserId]);

  const memberById = useMemo(() => {
    const map = new Map();
    companyMembers.forEach((m) => m._id != null && map.set(idKey(m._id), m));
    return map;
  }, [companyMembers]);

  const selectedParticipants = useMemo(
    () =>
      (form.participantIds || []).map((pid) => {
        const m = memberById.get(idKey(pid));
        return {
          userId: pid,
          name: m?.name || m?.email || idKey(pid)
        };
      }),
    [form.participantIds, memberById]
  );

  const handleParticipantConfirm = useCallback(
    (selected) => {
      setForm((p) => ({
        ...p,
        participantIds: (selected || []).map((x) => x.userId).filter(Boolean)
      }));
      setShowParticipantModal(false);
    },
    [setForm]
  );

  const removeParticipantBadge = useCallback(
    (memberId) => {
      const id = idKey(memberId);
      setForm((p) => ({
        ...p,
        participantIds: (p.participantIds || []).filter((x) => idKey(x) !== id)
      }));
    },
    [setForm]
  );

  const participantIds = form.participantIds || [];

  return (
    <div
      className="add-todo-modal atm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-todo-modal-title"
    >
      <div className="atm-dialog">
        <header className="atm-header">
          <h2 id="add-todo-modal-title" className="atm-title">
            새 할 일 추가
          </h2>
          <button type="button" className="atm-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <form onSubmit={addTask} className="atm-form">
          <div className="atm-field">
            <label className="atm-label" htmlFor="todo-add-title">
              제목
            </label>
            <input
              id="todo-add-title"
              className="atm-input"
              type="text"
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="할 일 제목을 입력하세요"
              required
            />
          </div>

          <div className="atm-grid-2">
            <div className="atm-field">
              <span className="atm-label">목록</span>
              <div className="atm-select-wrap">
                <select
                  className="atm-input atm-select"
                  value={form.listId}
                  onChange={(e) => setForm((p) => ({ ...p, listId: e.target.value }))}
                  aria-label="목록"
                >
                  <option value="">목록 선택</option>
                  {taskLists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.title}
                    </option>
                  ))}
                  <option value="__new__">+ 새 목록 만들기</option>
                </select>
                <span className="material-symbols-outlined atm-select-chevron" aria-hidden>
                  expand_more
                </span>
              </div>
              {form.listId === '__new__' && (
                <div className="atm-new-list">
                  <input
                    type="text"
                    className="atm-input atm-input-inline"
                    value={createListTitle}
                    onChange={(e) => setCreateListTitle(e.target.value)}
                    placeholder="새 목록 이름"
                    aria-label="새 목록 이름"
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleCreateList}
                    disabled={creatingList || !createListTitle?.trim()}
                  >
                    {creatingList ? '만드는 중…' : '만들기'}
                  </button>
                </div>
              )}
            </div>

            <div className="atm-field">
              <label className="atm-label" htmlFor="todo-add-due">
                마감일
              </label>
              <input
                id="todo-add-due"
                className="atm-input atm-input-date"
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
              />
            </div>
          </div>

          {!form.allDay && (
            <div className="atm-field">
              <label className="atm-label" htmlFor="todo-add-time">
                시간
              </label>
              <input
                id="todo-add-time"
                className="atm-input"
                type="time"
                value={form.dueTime}
                onChange={(e) => setForm((p) => ({ ...p, dueTime: e.target.value }))}
              />
            </div>
          )}

          <div className="atm-field">
            <label className="atm-label" htmlFor="todo-add-desc">
              메모
            </label>
            <textarea
              id="todo-add-desc"
              className="atm-textarea"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="상세 내용을 입력하세요..."
              rows={4}
            />
          </div>

          <div className="atm-options-row">
            <label className="atm-allday">
              <input
                type="checkbox"
                checked={form.allDay}
                onChange={(e) => setForm((p) => ({ ...p, allDay: e.target.checked }))}
              />
              <span>종일</span>
            </label>
            <div className="atm-importance">
              <span className="atm-importance-dot" aria-hidden />
              <span className="atm-importance-text">중요도: 보통</span>
            </div>
          </div>

          <div className="atm-field atm-participants-block">
            <span className="atm-label">참여자</span>
            <div className="atm-participant-badges">
              {participantIds.map((pid) => {
                const m = memberById.get(idKey(pid));
                const label = m?.name || m?.email || idKey(pid);
                return (
                  <span key={idKey(pid)} className="atm-badge">
                    <span className="atm-badge-avatar" aria-hidden>
                      {initialsForMember(m || { name: label })}
                    </span>
                    <span className="atm-badge-label">{label}</span>
                    <button
                      type="button"
                      className="atm-badge-remove"
                      onClick={() => removeParticipantBadge(pid)}
                      aria-label={`${label} 제거`}
                    >
                      <span className="material-symbols-outlined">close</span>
                    </button>
                  </span>
                );
              })}
              <button
                type="button"
                className="atm-participant-add-btn"
                onClick={() => setShowParticipantModal(true)}
                aria-label="참여자 추가"
                title="사내 명단에서 선택"
              >
                <span className="material-symbols-outlined">add</span>
              </button>
            </div>
          </div>

          <div className="atm-actions">
            <button type="button" className="atm-btn-cancel" onClick={onClose}>
              취소
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={addingTask || !form.listId || form.listId === '__new__'}
              aria-busy={addingTask}
            >
              <span className="material-symbols-outlined">add</span>
              {addingTask ? '추가 중…' : '추가'}
            </button>
          </div>
        </form>
      </div>

      {showParticipantModal && (
        <ParticipantModal
          teamMembers={companyMembers}
          selected={selectedParticipants}
          currentUser={currentUser}
          title="참여자 선택"
          bulkAddLabel="표시된 인원 모두 참여자에 추가"
          onConfirm={handleParticipantConfirm}
          onClose={() => setShowParticipantModal(false)}
        />
      )}
    </div>
  );
}
