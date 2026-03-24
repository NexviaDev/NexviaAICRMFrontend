import { useState, useMemo, useRef, useCallback } from 'react';
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
 * 새 할 일 추가 모달 — 참여자는 + 로 사내 명단(검색·체크·Shift 범위 선택) 후 배지로 표시
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
  companyMembers,
  currentUserId
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerSelected, setPickerSelected] = useState(() => new Set());
  const anchorIndexRef = useRef(null);

  /** 본인 제외, 이름순 — 명단·Shift 범위 인덱스 기준 */
  const rosterList = useMemo(() => {
    return companyMembers
      .filter((m) => idKey(m._id) !== idKey(currentUserId))
      .slice()
      .sort((a, b) =>
        (a.name || a.email || '').localeCompare(b.name || b.email || '', 'ko')
      );
  }, [companyMembers, currentUserId]);

  const filteredRoster = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return rosterList;
    return rosterList.filter((m) => {
      const name = (m.name || '').toLowerCase();
      const email = (m.email || '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [rosterList, pickerSearch]);

  const openPicker = useCallback(() => {
    const ids = form.participantIds || [];
    setPickerSelected(new Set(ids.map((x) => idKey(x))));
    setPickerSearch('');
    anchorIndexRef.current = null;
    setPickerOpen(true);
  }, [form.participantIds]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
  }, []);

  const confirmPicker = useCallback(() => {
    const ids = Array.from(pickerSelected).filter(Boolean);
    setForm((p) => ({ ...p, participantIds: ids }));
    setPickerOpen(false);
  }, [pickerSelected, setForm]);

  const handlePickerRowClick = useCallback(
    (index, memberId, e) => {
      e.preventDefault();
      const id = idKey(memberId);
      const list = filteredRoster;
      if (!list.length) return;

      if (e.shiftKey && anchorIndexRef.current !== null) {
        const a = Math.min(anchorIndexRef.current, index);
        const b = Math.max(anchorIndexRef.current, index);
        setPickerSelected((prev) => {
          const next = new Set(prev);
          for (let i = a; i <= b; i++) {
            const row = list[i];
            if (row) next.add(idKey(row._id));
          }
          return next;
        });
        anchorIndexRef.current = index;
      } else {
        setPickerSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        anchorIndexRef.current = index;
      }
    },
    [filteredRoster]
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
  const memberById = useMemo(() => {
    const map = new Map();
    companyMembers.forEach((m) => m._id != null && map.set(idKey(m._id), m));
    return map;
  }, [companyMembers]);

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
                onClick={openPicker}
                aria-label="참여자 추가"
                title="사내 명단에서 선택"
              >
                <span className="material-symbols-outlined">add</span>
              </button>
            </div>
            {rosterList.length === 0 && (
              <p className="atm-participants-hint">표시할 사내 명단이 없습니다.</p>
            )}
          </div>

          <div className="atm-actions">
            <button type="button" className="atm-btn-cancel" onClick={onClose}>
              취소
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!form.listId || form.listId === '__new__'}
            >
              <span className="material-symbols-outlined">add</span>
              추가
            </button>
          </div>
        </form>
      </div>

      {pickerOpen && (
        <div
          className="atm-picker-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="atm-picker-title"
        >
          <div className="atm-picker-dialog">
            <header className="atm-picker-header">
              <h3 id="atm-picker-title" className="atm-picker-title">
                사내 명단
              </h3>
              <p className="atm-picker-hint">
                체크로 선택 · Shift+클릭으로 범위 선택
              </p>
            </header>
            <div className="atm-picker-search">
              <span className="material-symbols-outlined atm-picker-search-icon" aria-hidden>
                search
              </span>
              <input
                type="search"
                className="atm-picker-search-input"
                placeholder="이름 또는 이메일 검색"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                aria-label="명단 검색"
              />
            </div>
            <div className="atm-picker-list" role="listbox" aria-multiselectable="true">
              {filteredRoster.length === 0 ? (
                <p className="atm-picker-empty">검색 결과가 없습니다.</p>
              ) : (
                filteredRoster.map((m, index) => {
                  const checked = pickerSelected.has(idKey(m._id));
                  return (
                    <div
                      key={idKey(m._id)}
                      role="option"
                      aria-selected={checked}
                      className={`atm-picker-row ${checked ? 'atm-picker-row--selected' : ''}`}
                      onClick={(e) => handlePickerRowClick(index, m._id, e)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handlePickerRowClick(index, m._id, e);
                        }
                      }}
                      tabIndex={0}
                    >
                      <input
                        type="checkbox"
                        className="atm-picker-checkbox"
                        readOnly
                        checked={checked}
                        tabIndex={-1}
                        aria-hidden
                      />
                      <span className="atm-picker-name">{m.name || m.email || m._id}</span>
                      {m.email && m.name && (
                        <span className="atm-picker-email">{m.email}</span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <div className="atm-picker-actions">
              <button type="button" className="atm-btn-cancel" onClick={closePicker}>
                취소
              </button>
              <button type="button" className="btn-primary" onClick={confirmPicker}>
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
