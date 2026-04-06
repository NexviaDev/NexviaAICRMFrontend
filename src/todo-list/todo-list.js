import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '@/config';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import AddTodoModal from './add-todo-modal/add-todo-modal';
import TodoDetailModal from './todo-detail-modal/todo-detail-modal';
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

export default function TodoList({ embedded = false }) {
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
  const [detailTask, setDetailTask] = useState(null);

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

  /** @param {{ silent?: boolean }} [options] — silent: 완료/삭제 등 이후에는 목록을 숨기지 않고 갱신만 함 */
  const fetchTasks = useCallback(async (options = {}) => {
    const silent = options.silent === true;
    if (!taskListId) return;
    if (!silent) setLoading(true);
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
      if (!silent) setLoading(false);
    }
  }, [taskListId]);

  useEffect(() => {
    fetchTaskLists();
  }, [fetchTaskLists]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meRes = await fetch(`${API_BASE}/auth/me`, { headers: getAuthHeader(), credentials: 'include' });
        if (!meRes.ok || cancelled) return;
        const me = await meRes.json();
        setCurrentUserId(me.user?._id || me._id);
      } catch (_) {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      await fetchTasks({ silent: true });
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
      await fetchTasks({ silent: true });
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
      if (listId === taskListId) await fetchTasks({ silent: true });
    } catch (err) {
      setError(err.message);
    }
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
    <div className={`todo-page ${embedded ? 'todo-page-embedded' : ''}`}>
      {!embedded && (
      <header className="todo-header">
        <div className="todo-header-left">
          <div className="todo-header-title-wrap">
            <span className="material-symbols-outlined todo-header-icon">checklist</span>
            <h2 className="todo-header-title">할 일 (Todo List)</h2>
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
          <button type="button" className="btn-primary" onClick={() => setShowAddModal(true)}>
            <span className="material-symbols-outlined">add</span>
            새 할 일
          </button>
          <div className="todo-header-trailing">
            <div className="todo-avatar" style={{ backgroundImage: `url(${AVATAR_PLACEHOLDER})` }} aria-hidden />
            <PageHeaderNotifyChat buttonClassName="todo-icon-btn" wrapperClassName="todo-header-notify-chat" />
          </div>
        </div>
      </header>
      )}

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
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleComplete(task);
                    }}
                    disabled={togglingId === task.id}
                    aria-label={task.status === STATUS_COMPLETED ? '완료 해제' : '완료'}
                  >
                    <span className="material-symbols-outlined">
                      {task.status === STATUS_COMPLETED ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                  </button>
                  <div
                    className="todo-list-content todo-list-content--open-detail"
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetailTask(task)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDetailTask(task);
                      }
                    }}
                    aria-label="상세 보기"
                  >
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
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(task.id);
                    }}
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

      {detailTask && taskListId && (
        <TodoDetailModal
          taskListId={taskListId}
          task={detailTask}
          onClose={() => setDetailTask(null)}
          currentUserId={currentUserId}
          onMarkComplete={handleToggleComplete}
          markCompleteBusy={togglingId === detailTask?.id}
        />
      )}

      {!embedded && showAddModal && (
        <AddTodoModal
          onClose={() => setShowAddModal(false)}
          form={form}
          setForm={setForm}
          taskLists={taskLists}
          createListTitle={createListTitle}
          setCreateListTitle={setCreateListTitle}
          handleCreateList={handleCreateList}
          creatingList={creatingList}
          addTask={addTask}
          companyMembers={companyMembers}
          currentUserId={currentUserId}
        />
      )}
    </div>
  );
}
