import { useState, useEffect, useCallback } from 'react';
import './todo-list.css';

const STORAGE_KEY = 'nexvia_todo_list';
const STATUS_TODO = 'todo';
const STATUS_IN_PROGRESS = 'inProgress';
const STATUS_DONE = 'done';

const COLUMNS = [
  { id: STATUS_TODO, title: '시작 (To Do)' },
  { id: STATUS_IN_PROGRESS, title: '진행중 (In Progress)' },
  { id: STATUS_DONE, title: '완료 (Completed)' }
];

const DEFAULT_TASKS = [
  { id: '1', title: 'Update Client Proposal', description: 'Review the final draft for the Q4 contract and update the pricing table based on the latest figures.', priority: 'high', dueDate: 'Oct 24', status: STATUS_TODO },
  { id: '2', title: 'Database Migration', description: 'Plan the schema changes for the new user profile module and backup existing data.', priority: 'medium', dueDate: 'Oct 26', status: STATUS_TODO },
  { id: '3', title: 'UI/UX Redesign', description: 'Finalizing the dashboard wireframes based on user feedback sessions.', priority: 'medium', dueDate: 'Ongoing', status: STATUS_IN_PROGRESS },
  { id: '4', title: 'Weekly Team Sync', description: 'Discuss project timelines and individual roadblocks for the upcoming week.', priority: 'low', dueDate: 'Done', status: STATUS_DONE },
  { id: '5', title: 'API Documentation', description: 'Complete the Swagger docs for the authentication endpoints.', priority: 'medium', dueDate: 'Oct 19', status: STATUS_DONE }
];

const AVATAR_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2394a3b8"%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/%3E%3C/svg%3E';

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TASKS;
    const list = JSON.parse(raw);
    return Array.isArray(list) && list.length > 0 ? list : DEFAULT_TASKS;
  } catch {
    return DEFAULT_TASKS;
  }
}

function saveTasks(tasks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (_) {}
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export default function TodoList() {
  const [tasks, setTasks] = useState([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium', dueDate: '' });
  const [dragTaskId, setDragTaskId] = useState(null);
  const [dropTargetColId, setDropTargetColId] = useState(null);

  useEffect(() => {
    setTasks(loadTasks());
  }, []);

  const persist = useCallback((nextTasks) => {
    setTasks(nextTasks);
    saveTasks(nextTasks);
  }, []);

  const filteredTasks = search.trim()
    ? tasks.filter(
        (t) =>
          (t.title || '').toLowerCase().includes(search.trim().toLowerCase()) ||
          (t.description || '').toLowerCase().includes(search.trim().toLowerCase())
      )
    : tasks;

  const getTasksByStatus = (status) => filteredTasks.filter((t) => t.status === status);

  const moveTask = (id, newStatus) => {
    persist(tasks.map((t) => (t.id === id ? { ...t, status: newStatus } : t)));
  };

  const addTask = (e) => {
    e.preventDefault();
    if (!form.title?.trim()) return;
    const d = form.dueDate ? new Date(form.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    persist([
      ...tasks,
      {
        id: generateId(),
        title: form.title.trim(),
        description: (form.description || '').trim(),
        priority: form.priority || 'medium',
        dueDate: d,
        status: STATUS_TODO
      }
    ]);
    setForm({ title: '', description: '', priority: 'medium', dueDate: '' });
    setShowAddModal(false);
  };

  const updateTask = (id, updates) => {
    persist(tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)));
    setEditingId(null);
  };

  const deleteTask = (id) => {
    persist(tasks.filter((t) => t.id !== id));
    setEditingId(null);
  };

  const startEdit = (task) => {
    setEditingId(task.id);
    setForm({
      title: task.title,
      description: task.description || '',
      priority: task.priority || 'medium',
      dueDate: task.dueDate || ''
    });
  };

  const submitEdit = (e) => {
    e.preventDefault();
    if (!editingId || !form.title?.trim()) return;
    updateTask(editingId, {
      title: form.title.trim(),
      description: (form.description || '').trim(),
      priority: form.priority || 'medium',
      dueDate: (form.dueDate || '').trim() || null
    });
    setForm({ title: '', description: '', priority: 'medium', dueDate: '' });
  };

  const priorityClass = (p) => {
    if (p === 'high') return 'task-priority-high';
    if (p === 'low') return 'task-priority-low';
    if (p === 'medium') return 'task-priority-medium';
    return 'task-priority-medium';
  };

  const priorityLabel = (p) => (p === 'high' ? 'High' : p === 'low' ? 'Low' : 'Medium');

  const handleCardDragStart = (e, task) => {
    if (editingId === task.id) return;
    const cardEl = e.currentTarget.closest?.('.todo-card') || e.currentTarget;
    e.dataTransfer.setData('text/plain', JSON.stringify({ taskId: task.id, status: task.status }));
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({ taskId: task.id, status: task.status }));
    setDragTaskId(task.id);
    if (cardEl && e.dataTransfer.setDragImage) {
      const rect = cardEl.getBoundingClientRect();
      e.dataTransfer.setDragImage(cardEl, rect.width / 2, rect.height / 2);
    }
  };

  const handleCardDragEnd = () => {
    setDragTaskId(null);
    setDropTargetColId(null);
  };

  const handleColumnDragOver = (e, colId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetColId(colId);
  };

  const handleColumnDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDropTargetColId(null);
  };

  const handleColumnDrop = (e, targetColId) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetColId(null);
    setDragTaskId(null);
    const raw = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('application/json');
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const taskId = data?.taskId;
      const currentStatus = data?.status;
      if (!taskId || currentStatus === targetColId) return;
      moveTask(taskId, targetColId);
    } catch (_) {}
  };

  return (
    <div className="todo-page">
      <header className="todo-header">
        <div className="todo-header-left">
          <div className="todo-header-title-wrap">
            <span className="material-symbols-outlined todo-header-icon">view_kanban</span>
            <h2 className="todo-header-title">Task Board</h2>
          </div>
          <div className="todo-search-wrap">
            <span className="material-symbols-outlined todo-search-icon">search</span>
            <input
              type="text"
              className="todo-search-input"
              placeholder="Search tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search tasks"
            />
          </div>
        </div>
        <div className="todo-header-right">
          <button type="button" className="todo-btn-new" onClick={() => setShowAddModal(true)}>
            <span className="material-symbols-outlined">add</span>
            New Task
          </button>
          <div className="todo-header-icons">
            <button type="button" className="todo-icon-btn" aria-label="알림">
              <span className="material-symbols-outlined">notifications</span>
              <span className="todo-noti-dot" />
            </button>
            <button type="button" className="todo-icon-btn" aria-label="포럼">
              <span className="material-symbols-outlined">forum</span>
            </button>
            <div className="todo-avatar" style={{ backgroundImage: `url(${AVATAR_PLACEHOLDER})` }} aria-hidden />
          </div>
        </div>
      </header>

      <div className="todo-tabs">
        <button type="button" className={`todo-tab ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
          All Tasks
        </button>
        <button type="button" className={`todo-tab ${activeTab === 'my' ? 'active' : ''}`} onClick={() => setActiveTab('my')}>
          My Tasks
        </button>
        <button type="button" className={`todo-tab ${activeTab === 'team' ? 'active' : ''}`} onClick={() => setActiveTab('team')}>
          Team Tasks
        </button>
      </div>

      <div className="todo-board">
        <div className="todo-board-inner">
          {COLUMNS.map((col) => {
            const columnTasks = getTasksByStatus(col.id);
            return (
              <div key={col.id} className="todo-column">
                <div className="todo-column-head">
                  <div className="todo-column-title-wrap">
                    <h3 className="todo-column-title">{col.title}</h3>
                    <span className="todo-column-count">{columnTasks.length}</span>
                  </div>
                  <button type="button" className="todo-column-more" aria-label="더보기">
                    <span className="material-symbols-outlined">more_horiz</span>
                  </button>
                </div>
                <div
                  className={`todo-column-cards ${dropTargetColId === col.id ? 'todo-column-cards-drop' : ''}`}
                  onDragOver={(e) => handleColumnDragOver(e, col.id)}
                  onDragLeave={handleColumnDragLeave}
                  onDrop={(e) => handleColumnDrop(e, col.id)}
                >
                  {columnTasks.map((task) => (
                    <div
                      key={task.id}
                      className={`todo-card ${col.id === STATUS_IN_PROGRESS ? 'todo-card-progress' : ''} ${col.id === STATUS_DONE ? 'todo-card-done' : ''} ${dragTaskId === task.id ? 'todo-card-dragging' : ''}`}
                      draggable={editingId !== task.id}
                      onDragStart={(e) => handleCardDragStart(e, task)}
                      onDragEnd={handleCardDragEnd}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTargetColId(col.id); }}
                      onDrop={(e) => { e.preventDefault(); handleColumnDrop(e, col.id); }}
                    >
                      {editingId === task.id ? (
                        <form onSubmit={submitEdit} className="todo-card-edit-form">
                          <input
                            type="text"
                            value={form.title}
                            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                            placeholder="제목"
                            className="todo-edit-input"
                            autoFocus
                          />
                          <textarea
                            value={form.description}
                            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                            placeholder="설명"
                            className="todo-edit-textarea"
                            rows={2}
                          />
                          <select
                            value={form.priority}
                            onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
                            className="todo-edit-select"
                          >
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                          </select>
                          <input
                            type="text"
                            value={form.dueDate}
                            onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
                            placeholder="e.g. Oct 24, Ongoing, Done"
                            className="todo-edit-input"
                          />
                          <div className="todo-edit-actions">
                            <button type="button" className="todo-btn-cancel" onClick={() => setEditingId(null)}>취소</button>
                            <button type="submit" className="todo-btn-save">저장</button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div className="todo-card-top">
                            <span
                              className="todo-card-drag-handle"
                              draggable
                              onDragStart={(e) => handleCardDragStart(e, task)}
                              onDragEnd={handleCardDragEnd}
                              title="드래그하여 이동"
                              aria-label="드래그하여 다른 칸으로 이동"
                            >
                              <span className="material-symbols-outlined">drag_indicator</span>
                            </span>
                            <span className={`todo-priority ${priorityClass(task.priority)}`}>{priorityLabel(task.priority)}</span>
                            {col.id === STATUS_DONE ? (
                              <span className="material-symbols-outlined todo-card-done-icon">check_circle</span>
                            ) : (
                              <button type="button" className="todo-card-edit" onClick={() => startEdit(task)} aria-label="수정">
                                <span className="material-symbols-outlined">edit</span>
                              </button>
                            )}
                          </div>
                          <h4 className="todo-card-title">{task.title}</h4>
                          {task.description && <p className="todo-card-desc">{task.description}</p>}
                          <div className="todo-card-footer">
                            <div className="todo-card-date">
                              <span className="material-symbols-outlined">
                                {col.id === STATUS_DONE ? 'event_available' : 'schedule'}
                              </span>
                              <span>{task.dueDate || (col.id === STATUS_DONE ? 'Done' : '')}</span>
                            </div>
                            <div className="todo-card-footer-right">
                              {col.id !== STATUS_TODO && (
                                <button type="button" className="todo-move-btn" onClick={() => moveTask(task.id, STATUS_TODO)} title="To Do로">↩</button>
                              )}
                              {col.id !== STATUS_IN_PROGRESS && (
                                <button type="button" className="todo-move-btn" onClick={() => moveTask(task.id, STATUS_IN_PROGRESS)} title="진행중">▶</button>
                              )}
                              {col.id !== STATUS_DONE && (
                                <button type="button" className="todo-move-btn" onClick={() => moveTask(task.id, STATUS_DONE)} title="완료">✓</button>
                              )}
                              {col.id === STATUS_DONE && (
                                <>
                                  <button type="button" className="todo-delete-btn" onClick={() => startEdit(task)} aria-label="수정">
                                    <span className="material-symbols-outlined">edit</span>
                                  </button>
                                  <button type="button" className="todo-delete-btn" onClick={() => deleteTask(task.id)} aria-label="삭제">
                                    <span className="material-symbols-outlined">delete</span>
                                  </button>
                                </>
                              )}
                              <img src={AVATAR_PLACEHOLDER} alt="" className="todo-card-avatar" />
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showAddModal && (
        <div className="todo-modal-overlay" onClick={() => setShowAddModal(false)} role="dialog" aria-modal="true">
          <div className="todo-modal" onClick={(e) => e.stopPropagation()}>
            <div className="todo-modal-header">
              <h3>New Task</h3>
              <button type="button" className="todo-modal-close" onClick={() => setShowAddModal(false)} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={addTask} className="todo-modal-form">
              <div className="todo-modal-field">
                <label htmlFor="todo-add-title">Title *</label>
                <input
                  id="todo-add-title"
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="Task title"
                  required
                />
              </div>
              <div className="todo-modal-field">
                <label htmlFor="todo-add-desc">Description</label>
                <textarea
                  id="todo-add-desc"
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Description"
                  rows={3}
                />
              </div>
              <div className="todo-modal-row">
                <div className="todo-modal-field">
                  <label htmlFor="todo-add-priority">Priority</label>
                  <select
                    id="todo-add-priority"
                    value={form.priority}
                    onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div className="todo-modal-field">
                  <label htmlFor="todo-add-due">Due date</label>
                  <input
                    id="todo-add-due"
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
                  />
                </div>
              </div>
              <div className="todo-modal-actions">
                <button type="button" className="todo-btn-cancel" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="todo-btn-new">Add</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
