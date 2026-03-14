import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '@/config';
import './todo-list.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Google Tasks API: status is "needsAction" | "completed" */
const STATUS_NEEDS_ACTION = 'needsAction';
const STATUS_COMPLETED = 'completed';

const AVATAR_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2394a3b8"%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/%3E%3C/svg%3E';

/** RFC 3339 date-only for Google Tasks (due field) */
function toDueRfc3339(dateStr) {
  if (!dateStr) return undefined;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10) + 'T00:00:00.000Z';
}

export default function TodoList() {
  const [taskLists, setTaskLists] = useState([]);
  const [taskListId, setTaskListId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    dueDate: '',
    dueTime: '',
    allDay: true,
    listId: '',
    participantIds: []
  });
  const [createListTitle, setCreateListTitle] = useState('');
  const [creatingList, setCreatingList] = useState(false);
  const [companyMembers, setCompanyMembers] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const fetchTaskLists = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/google-tasks/lists`, { headers: getAuthHeader(), credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '할 일 목록을 불러올 수 없습니다.');
      }
      const data = await res.json();
      const items = data.items || [];
      setTaskLists(items);
      if (items.length > 0) setTaskListId((prev) => prev || items[0].id);
      if (items.length === 0) setError('Google 할 일 목록이 없습니다. Google Tasks에서 목록을 만든 뒤 다시 시도해 주세요.');
    } catch (err) {
      setError(err.message || '할 일 목록 조회 실패');
      setTaskListId(null);
      setTaskLists([]);
    }
  }, []);

  const fetchTasks = useCallback(async () => {
    if (!taskListId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/google-tasks/lists/${encodeURIComponent(taskListId)}/tasks`, {
        headers: getAuthHeader(),
        credentials: 'include'
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '할 일을 불러올 수 없습니다.');
      }
      const data = await res.json();
      setTasks(data.items || []);
    } catch (err) {
      setError(err.message || '할 일 조회 실패');
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [taskListId]);

  useEffect(() => {
    fetchTaskLists();
  }, [fetchTaskLists]);

  useEffect(() => {
    if (taskListId) fetchTasks();
    else setTasks([]);
  }, [taskListId, fetchTasks]);

  useEffect(() => {
    if (!showAddModal) return;
    setCreateListTitle('');
    setForm((p) => ({ ...p, listId: taskListId || '', dueDate: p.dueDate || '', dueTime: '', allDay: true, participantIds: p.participantIds || [] }));
    (async () => {
      try {
        const [meRes, membersRes] = await Promise.all([
          fetch(`${API_BASE}/auth/me`, { headers: getAuthHeader(), credentials: 'include' }),
          fetch(`${API_BASE}/calendar-events/team-members`, { headers: getAuthHeader(), credentials: 'include' })
        ]);
        if (meRes.ok) {
          const me = await meRes.json();
          setCurrentUserId(me.user?._id || me._id);
        }
        if (membersRes.ok) {
          const data = await membersRes.json();
          setCompanyMembers(data.members || []);
        }
      } catch (_) {}
    })();
  }, [showAddModal, taskListId]);

  const filteredTasks = search.trim()
    ? tasks.filter(
        (t) =>
          (t.title || '').toLowerCase().includes(search.trim().toLowerCase()) ||
          (t.notes || '').toLowerCase().includes(search.trim().toLowerCase())
      )
    : tasks;

  const handleToggleComplete = async (task) => {
    if (!taskListId || togglingId) return;
    const newStatus = task.status === STATUS_COMPLETED ? STATUS_NEEDS_ACTION : STATUS_COMPLETED;
    setTogglingId(task.id);
    try {
      const res = await fetch(
        `${API_BASE}/google-tasks/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(task.id)}`,
        {
          method: 'PATCH',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            status: newStatus,
            ...(newStatus === STATUS_COMPLETED ? { completed: new Date().toISOString() } : {})
          })
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '상태 변경 실패');
      }
      await fetchTasks();
    } catch (err) {
      setError(err.message);
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (taskId) => {
    if (!taskListId || deletingId) return;
    setDeletingId(taskId);
    try {
      const res = await fetch(
        `${API_BASE}/google-tasks/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
        { method: 'DELETE', headers: getAuthHeader(), credentials: 'include' }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '삭제 실패');
      }
      await fetchTasks();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateList = async (e) => {
    e.preventDefault();
    if (!createListTitle?.trim() || creatingList) return;
    setCreatingList(true);
    try {
      const res = await fetch(`${API_BASE}/google-tasks/lists`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: createListTitle.trim() })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '목록 생성 실패');
      }
      const created = await res.json();
      setCreateListTitle('');
      await fetchTaskLists();
      setTaskListId(created.id);
      setForm((p) => ({ ...p, listId: created.id }));
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingList(false);
    }
  };

  const addTask = async (e) => {
    e.preventDefault();
    if (!form.title?.trim()) return;
    const listId = form.listId || taskListId;
    if (!listId) {
      setError('목록을 선택하거나 새 목록을 만든 뒤 추가해 주세요.');
      return;
    }
    try {
      let notes = (form.description || '').trim();
      if (!form.allDay && form.dueTime) notes = (notes ? notes + '\n' : '') + '시간: ' + form.dueTime;
      const body = { title: form.title.trim() };
      if (notes) body.notes = notes;
      const due = toDueRfc3339(form.dueDate);
      if (due) body.due = due;
      if (Array.isArray(form.participantIds) && form.participantIds.length > 0) body.participantIds = form.participantIds;
      const res = await fetch(`${API_BASE}/google-tasks/lists/${encodeURIComponent(listId)}/tasks`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '추가 실패');
      }
      setForm({ title: '', description: '', dueDate: '', dueTime: '', allDay: true, listId: '', participantIds: [] });
      setShowAddModal(false);
      if (listId === taskListId) await fetchTasks();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleParticipant = (userId) => {
    setForm((p) => {
      const ids = p.participantIds || [];
      const next = ids.includes(userId) ? ids.filter((id) => id !== userId) : [...ids, userId];
      return { ...p, participantIds: next };
    });
  };

  const formatDue = (dueStr) => {
    if (!dueStr) return '';
    try {
      const d = new Date(dueStr);
      return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dueStr;
    }
  };

  return (
    <div className="todo-page">
      <header className="todo-header">
        <div className="todo-header-left">
          <div className="todo-header-title-wrap">
            <span className="material-symbols-outlined todo-header-icon">checklist</span>
            <h2 className="todo-header-title">할 일 (Google Tasks)</h2>
          </div>
          <div className="todo-search-wrap">
            <span className="material-symbols-outlined todo-search-icon">search</span>
            <input
              type="text"
              className="todo-search-input"
              placeholder="검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="검색"
            />
          </div>
        </div>
        <div className="todo-header-right">
          <button type="button" className="todo-btn-new" onClick={() => setShowAddModal(true)}>
            <span className="material-symbols-outlined">add</span>
            새 할 일
          </button>
          <div className="todo-header-icons">
            <button type="button" className="todo-icon-btn" aria-label="알림">
              <span className="material-symbols-outlined">notifications</span>
              <span className="todo-noti-dot" />
            </button>
            <button type="button" className="todo-icon-btn" aria-label="포럼">
              <span className="material-symbols-outlined">chat_bubble</span>
            </button>
            <div className="todo-avatar" style={{ backgroundImage: `url(${AVATAR_PLACEHOLDER})` }} aria-hidden />
          </div>
        </div>
      </header>

      <div className="todo-list-container">
        {error && (
          <div className="todo-list-error">
            <span className="material-symbols-outlined">error</span>
            {error}
          </div>
        )}
        {loading && (
          <p className="todo-list-loading">불러오는 중...</p>
        )}
        {!loading && taskListId && !error && (
          <ul className="todo-list-single">
            {filteredTasks.length === 0 ? (
              <li className="todo-list-empty">할 일이 없습니다. 새 할 일을 추가해 보세요.</li>
            ) : (
              filteredTasks.map((task) => (
                <li
                  key={task.id}
                  className={`todo-list-row ${task.status === STATUS_COMPLETED ? 'todo-list-row-done' : ''}`}
                >
                  <button
                    type="button"
                    className="todo-list-check"
                    onClick={() => handleToggleComplete(task)}
                    disabled={togglingId === task.id}
                    aria-label={task.status === STATUS_COMPLETED ? '완료 해제' : '완료'}
                  >
                    <span className="material-symbols-outlined">
                      {task.status === STATUS_COMPLETED ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                  </button>
                  <div className="todo-list-content">
                    <span className="todo-list-title">{task.title || '(제목 없음)'}</span>
                    {(task.notes || task.due) && (
                      <div className="todo-list-meta">
                        {task.notes && <span className="todo-list-notes">{task.notes}</span>}
                        {task.due && <span className="todo-list-due">{formatDue(task.due)}</span>}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="todo-list-delete"
                    onClick={() => handleDelete(task.id)}
                    disabled={deletingId === task.id}
                    aria-label="삭제"
                  >
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {showAddModal && (
        <div className="todo-modal-overlay" onClick={() => setShowAddModal(false)} role="dialog" aria-modal="true">
          <div className="todo-modal" onClick={(e) => e.stopPropagation()}>
            <div className="todo-modal-header">
              <h3>새 할 일</h3>
              <button type="button" className="todo-modal-close" onClick={() => setShowAddModal(false)} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={addTask} className="todo-modal-form">
              <div className="todo-modal-field">
                <label htmlFor="todo-add-title">제목 *</label>
                <input
                  id="todo-add-title"
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="할 일 제목"
                  required
                />
              </div>
              <div className="todo-modal-field">
                <label>목록</label>
                <select
                  value={form.listId}
                  onChange={(e) => setForm((p) => ({ ...p, listId: e.target.value }))}
                  className="todo-modal-select"
                >
                  <option value="">목록 선택</option>
                  {taskLists.map((list) => (
                    <option key={list.id} value={list.id}>{list.title}</option>
                  ))}
                  <option value="__new__">+ 새 목록 만들기</option>
                </select>
                {form.listId === '__new__' && (
                  <div className="todo-modal-new-list">
                    <input
                      type="text"
                      value={createListTitle}
                      onChange={(e) => setCreateListTitle(e.target.value)}
                      placeholder="새 목록 이름"
                      className="todo-modal-input-inline"
                    />
                    <button type="button" className="todo-btn-small" onClick={handleCreateList} disabled={creatingList || !createListTitle?.trim()}>
                      {creatingList ? '만드는 중…' : '만들기'}
                    </button>
                  </div>
                )}
              </div>
              <div className="todo-modal-field">
                <label htmlFor="todo-add-desc">메모</label>
                <textarea
                  id="todo-add-desc"
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="메모 (선택)"
                  rows={3}
                />
              </div>
              <div className="todo-modal-field todo-modal-row">
                <div className="todo-modal-field">
                  <label htmlFor="todo-add-due">마감일</label>
                  <input
                    id="todo-add-due"
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
                  />
                </div>
                <div className="todo-modal-field todo-modal-allday">
                  <label className="todo-modal-check-label">
                    <input
                      type="checkbox"
                      checked={form.allDay}
                      onChange={(e) => setForm((p) => ({ ...p, allDay: e.target.checked }))}
                    />
                    종일
                  </label>
                </div>
                {!form.allDay && (
                  <div className="todo-modal-field">
                    <label htmlFor="todo-add-time">시간</label>
                    <input
                      id="todo-add-time"
                      type="time"
                      value={form.dueTime}
                      onChange={(e) => setForm((p) => ({ ...p, dueTime: e.target.value }))}
                    />
                  </div>
                )}
              </div>
              <div className="todo-modal-field">
                <label>참여자 (같은 회사 직원)</label>
                <div className="todo-modal-participants">
                  {companyMembers
                    .filter((m) => m._id !== currentUserId)
                    .map((m) => (
                      <label key={m._id} className="todo-modal-participant-item">
                        <input
                          type="checkbox"
                          checked={(form.participantIds || []).includes(m._id)}
                          onChange={() => toggleParticipant(m._id)}
                        />
                        <span>{m.name || m.email || m._id}</span>
                      </label>
                    ))}
                  {companyMembers.filter((m) => m._id !== currentUserId).length === 0 && (
                    <span className="todo-modal-participants-empty">선택 가능한 팀원이 없습니다.</span>
                  )}
                </div>
              </div>
              <div className="todo-modal-actions">
                <button type="button" className="todo-btn-cancel" onClick={() => setShowAddModal(false)}>취소</button>
                <button type="submit" className="todo-btn-new" disabled={!form.listId || form.listId === '__new__'}>추가</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
