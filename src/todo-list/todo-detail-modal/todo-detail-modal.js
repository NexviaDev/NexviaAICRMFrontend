import { useState, useEffect, useMemo, useCallback } from 'react';
import './todo-detail-modal.css';
import { API_BASE } from '@/config';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatCommentDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

/** 샘플 디자인처럼 상대 시각 */
function formatCommentRelative(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 45) return '방금 전';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}분 전`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}시간 전`;
    const days = Math.floor(hr / 24);
    if (days < 7) return `${days}일 전`;
    return formatCommentDate(iso);
  } catch {
    return formatCommentDate(iso);
  }
}

function isCommentAuthor(comment, userId) {
  if (userId == null || !comment?.userId) return false;
  return String(comment.userId) === String(userId);
}

function organizeComments(comments) {
  const list = Array.isArray(comments) ? [...comments] : [];
  const byId = new Map();
  list.forEach((c) => {
    const id = c?._id != null ? String(c._id) : c?.id != null ? String(c.id) : '';
    if (id) byId.set(id, c);
  });
  const sortByDate = (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  const childrenMap = new Map();
  const roots = [];
  list.forEach((c) => {
    const id = c?._id != null ? String(c._id) : c?.id != null ? String(c.id) : '';
    if (!id) return;
    const pid = c.parentCommentId != null ? String(c.parentCommentId) : '';
    if (!pid || !byId.has(pid)) {
      roots.push(c);
    } else {
      if (!childrenMap.has(pid)) childrenMap.set(pid, []);
      childrenMap.get(pid).push(c);
    }
  });
  roots.sort(sortByDate);
  childrenMap.forEach((arr) => arr.sort(sortByDate));
  return { roots, childrenMap };
}

function formatDueLong(dueStr) {
  if (!dueStr) return '';
  try {
    const d = new Date(dueStr);
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return dueStr;
  }
}

function initials(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2);
}

/** Enter만 등록·저장, Shift / Ctrl / ⌘ + Enter는 줄바꿈 */
function commentTextareaKeyDown(e, onSubmit) {
  if (e.key !== 'Enter') return;
  if (e.shiftKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  onSubmit();
}

const STATUS_COMPLETED = 'completed';

/**
 * 할 일 상세 — Sample Design (LucidCRM) 레이아웃: 배지·메타 카드·코멘트 버블·푸터 액션 바
 */
export default function TodoDetailModal({
  taskListId,
  task,
  onClose,
  currentUserId,
  onMarkComplete,
  markCompleteBusy = false
}) {
  const [meta, setMeta] = useState(null);
  const [comments, setComments] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [detailError, setDetailError] = useState('');
  const [newComment, setNewComment] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [replyingToId, setReplyingToId] = useState(null);
  const [replyText, setReplyText] = useState('');

  const baseUrl = useMemo(() => {
    if (!taskListId || !task?.id) return null;
    return `${API_BASE}/google-tasks/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(task.id)}`;
  }, [taskListId, task?.id]);

  const isDone = task?.status === STATUS_COMPLETED;

  const loadDetail = useCallback(async () => {
    if (!baseUrl) return;
    setLoadingDetail(true);
    setDetailError('');
    try {
      const res = await fetch(`${baseUrl}/detail`, { headers: getAuthHeader(), credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '상세 정보를 불러올 수 없습니다.');
      setMeta(data.meta || null);
      setComments(Array.isArray(data.comments) ? data.comments : []);
      setNewComment('');
      setCommentError('');
      setEditingCommentId(null);
      setEditDraft('');
      setReplyingToId(null);
      setReplyText('');
    } catch (e) {
      setDetailError(e.message || '조회 실패');
      setMeta(null);
      setComments([]);
    } finally {
      setLoadingDetail(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const { roots, childrenMap } = useMemo(() => organizeComments(comments), [comments]);
  const commentById = useMemo(() => {
    const m = new Map();
    (Array.isArray(comments) ? comments : []).forEach((c) => {
      const cid = c?._id != null ? String(c._id) : c?.id != null ? String(c.id) : '';
      if (cid) m.set(cid, c);
    });
    return m;
  }, [comments]);

  const participants = meta?.participants?.length ? meta.participants : [];
  const visibleParticipants = participants.slice(0, 3);
  const moreCount = Math.max(0, participants.length - 3);

  const handleAddComment = async (parentCommentId = null) => {
    const text = (parentCommentId ? replyText : newComment).trim();
    if (!text || !baseUrl) return;
    setCommentBusy(true);
    setCommentError('');
    try {
      const res = await fetch(`${baseUrl}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          text,
          ...(parentCommentId ? { parentCommentId } : {})
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '코멘트를 등록할 수 없습니다.');
      setComments(Array.isArray(data.comments) ? data.comments : []);
      if (parentCommentId) {
        setReplyText('');
        setReplyingToId(null);
      } else {
        setNewComment('');
      }
    } catch (err) {
      setCommentError(err.message || '코멘트 등록에 실패했습니다.');
    } finally {
      setCommentBusy(false);
    }
  };

  const handleSaveEditComment = async (commentId) => {
    const text = editDraft.trim();
    if (!text || !baseUrl || !commentId) return;
    setCommentBusy(true);
    setCommentError('');
    try {
      const res = await fetch(`${baseUrl}/comments/${encodeURIComponent(commentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ text })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '코멘트를 수정할 수 없습니다.');
      setComments(Array.isArray(data.comments) ? data.comments : []);
      setEditingCommentId(null);
      setEditDraft('');
    } catch (err) {
      setCommentError(err.message || '코멘트 수정에 실패했습니다.');
    } finally {
      setCommentBusy(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!baseUrl || !commentId) return;
    if (!window.confirm('이 코멘트를 삭제하시겠습니까?')) return;
    setCommentBusy(true);
    setCommentError('');
    try {
      const res = await fetch(`${baseUrl}/comments/${encodeURIComponent(commentId)}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '코멘트를 삭제할 수 없습니다.');
      setComments(Array.isArray(data.comments) ? data.comments : []);
      if (editingCommentId === commentId) {
        setEditingCommentId(null);
        setEditDraft('');
      }
      if (replyingToId === commentId) {
        setReplyingToId(null);
        setReplyText('');
      }
    } catch (err) {
      setCommentError(err.message || '코멘트 삭제에 실패했습니다.');
    } finally {
      setCommentBusy(false);
    }
  };

  function renderCommentItem(c, depth = 0) {
    const id = String(c._id || c.id);
    const mine = isCommentAuthor(c, currentUserId);
    const isEditing = editingCommentId === id;
    const replies = childrenMap.get(id) || [];
    const parentId = c.parentCommentId != null ? String(c.parentCommentId) : null;
    const parentComment = parentId ? commentById.get(parentId) : null;

    return (
      <li key={id} className={`tdm-comment-item ${depth > 0 ? 'tdm-comment-item--reply' : ''}`}>
        {parentComment ? (
          <p className="tdm-comment-reply-hint">
            <span className="material-symbols-outlined" aria-hidden>
              subdirectory_arrow_right
            </span>
            {parentComment.authorName || '사용자'}님에게 답글
          </p>
        ) : null}
        <div className="tdm-comment-row">
          <div className="tdm-avatar" aria-hidden>
            {initials(c.authorName)}
          </div>
          <div className="tdm-comment-main">
            <div className="tdm-comment-meta">
              <span className="tdm-comment-author">{c.authorName || '사용자'}</span>
              <span className="tdm-comment-date">{formatCommentRelative(c.createdAt)}</span>
              {!isEditing ? (
                <span className="tdm-comment-actions">
                  <button
                    type="button"
                    className="tdm-comment-action-btn"
                    disabled={commentBusy}
                    onClick={() => {
                      if (replyingToId === id) {
                        setReplyingToId(null);
                        setReplyText('');
                      } else {
                        setReplyingToId(id);
                        setReplyText('');
                        setEditingCommentId(null);
                        setEditDraft('');
                      }
                    }}
                  >
                    답글
                  </button>
                  {mine ? (
                    <>
                      <button
                        type="button"
                        className="tdm-comment-action-btn"
                        disabled={commentBusy}
                        onClick={() => {
                          setEditingCommentId(id);
                          setEditDraft(c.text || '');
                          setReplyingToId(null);
                          setReplyText('');
                        }}
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        className="tdm-comment-action-btn tdm-comment-action-btn--danger"
                        disabled={commentBusy}
                        onClick={() => handleDeleteComment(id)}
                      >
                        삭제
                      </button>
                    </>
                  ) : null}
                </span>
              ) : null}
            </div>
            {isEditing ? (
              <div className="tdm-comment-edit">
                <textarea
                  className="tdm-textarea tdm-comment-edit-input"
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) =>
                    commentTextareaKeyDown(e, () => {
                      if (!commentBusy && editDraft.trim()) handleSaveEditComment(id);
                    })
                  }
                  rows={3}
                  maxLength={5000}
                />
                <div className="tdm-comment-edit-btns">
                  <button
                    type="button"
                    className="tdm-btn tdm-btn--ghost"
                    disabled={commentBusy}
                    onClick={() => {
                      setEditingCommentId(null);
                      setEditDraft('');
                    }}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="tdm-btn tdm-btn--primary-sm"
                    disabled={commentBusy || !editDraft.trim()}
                    onClick={() => handleSaveEditComment(id)}
                  >
                    {commentBusy ? '저장 중…' : '저장'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="tdm-comment-bubble">
                <p className="tdm-comment-text">{c.text}</p>
              </div>
            )}
            {replyingToId === id && !isEditing ? (
              <div className="tdm-comment-reply-compose">
                <textarea
                  className="tdm-textarea"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) =>
                    commentTextareaKeyDown(e, () => {
                      if (!commentBusy && replyText.trim()) handleAddComment(id);
                    })
                  }
                  placeholder={`${c.authorName || '사용자'}님에게 답글 작성...`}
                  rows={2}
                  maxLength={5000}
                  disabled={commentBusy}
                />
                <div className="tdm-comment-reply-compose-row">
                  <button
                    type="button"
                    className="tdm-btn tdm-btn--ghost"
                    disabled={commentBusy}
                    onClick={() => {
                      setReplyingToId(null);
                      setReplyText('');
                    }}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="tdm-comment-send-btn"
                    disabled={commentBusy || !replyText.trim()}
                    onClick={() => handleAddComment(id)}
                    aria-label="답글 등록"
                    title="답글 등록"
                  >
                    <span
                      className={
                        'material-symbols-outlined' + (commentBusy ? ' tdm-comment-send-btn--spin' : '')
                      }
                      aria-hidden
                    >
                      {commentBusy ? 'progress_activity' : 'send'}
                    </span>
                  </button>
                </div>
              </div>
            ) : null}
            {replies.length > 0 ? (
              <ul className="tdm-comment-replies">{replies.map((r) => renderCommentItem(r, depth + 1))}</ul>
            ) : null}
          </div>
        </div>
      </li>
    );
  }

  const commentCount = comments.length;

  return (
    <div className="tdm-overlay" role="presentation">
      <div
        className="tdm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tdm-title"
        onClick={(e) => e.stopPropagation()}
      >
        {loadingDetail ? (
          <div className="tdm-loading">로딩 중...</div>
        ) : (
          <>
            <div className="tdm-header">
              <div className="tdm-header-main">
                <span
                  className={`tdm-status-badge ${isDone ? 'tdm-status-badge--done' : 'tdm-status-badge--active'}`}
                >
                  {isDone ? '완료' : '진행중'}
                </span>
                <h2 id="tdm-title" className="tdm-title">
                  {task?.title || '(제목 없음)'}
                </h2>
              </div>
              <button type="button" className="tdm-close" onClick={onClose} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="tdm-scroll">
              {detailError ? <p className="tdm-error-banner">{detailError}</p> : null}

              {task?.notes ? (
                <p className="tdm-description">{task.notes}</p>
              ) : (
                <p className="tdm-description tdm-description--empty">설명이 없습니다.</p>
              )}

              <div className="tdm-meta-card">
                <div className="tdm-meta-cell">
                  <span className="tdm-meta-label">작성자</span>
                  <div className="tdm-meta-author">
                    <div className="tdm-avatar tdm-avatar--sm">{initials(meta?.authorDisplay)}</div>
                    <span className="tdm-meta-value">{meta?.authorDisplay || '—'}</span>
                  </div>
                </div>
                <div className="tdm-meta-cell">
                  <span className="tdm-meta-label">참여자</span>
                  <div className="tdm-participant-stack">
                    {visibleParticipants.length > 0 ? (
                      <>
                        {visibleParticipants.map((p) => (
                          <div
                            key={String(p.userId)}
                            className="tdm-avatar tdm-avatar--stack"
                            title={p.name}
                          >
                            {initials(p.name)}
                          </div>
                        ))}
                        {moreCount > 0 ? (
                          <div className="tdm-avatar tdm-avatar--more" aria-hidden>
                            +{moreCount}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="tdm-meta-muted">—</span>
                    )}
                  </div>
                </div>
                <div className="tdm-meta-cell">
                  <span className="tdm-meta-label">마감일</span>
                  <div className="tdm-due-row">
                    {task?.due ? (
                      <>
                        <span className="material-symbols-outlined tdm-due-icon" aria-hidden>
                          calendar_today
                        </span>
                        <span className="tdm-due-text">{formatDueLong(task.due)}</span>
                      </>
                    ) : (
                      <span className="tdm-meta-muted">없음</span>
                    )}
                  </div>
                </div>
              </div>

              <section className="tdm-comments-section" aria-label="코멘트">
                <div className="tdm-comments-head">
                  <h3 className="tdm-comments-title">코멘트</h3>
                  <span className="tdm-comments-count">{commentCount}</span>
                </div>
                <p className="tdm-comments-hint">
                  할 일에 대한 메모와 답글을 남깁니다. 본인이 작성한 코멘트만 수정·삭제할 수 있습니다.
                </p>
                <ul className="tdm-comments-list">{roots.map((c) => renderCommentItem(c, 0))}</ul>

                <div className="tdm-compose-row">
                  <div className="tdm-avatar tdm-avatar--me" aria-hidden>
                    <span className="material-symbols-outlined">person</span>
                  </div>
                  <div className="tdm-compose-wrap">
                    <textarea
                      className="tdm-textarea tdm-compose-textarea"
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      onKeyDown={(e) =>
                        commentTextareaKeyDown(e, () => {
                          if (!commentBusy && newComment.trim()) handleAddComment();
                        })
                      }
                      placeholder="메시지를 입력하세요..."
                      rows={3}
                      maxLength={5000}
                      disabled={commentBusy}
                    />
                    <button
                      type="button"
                      className="tdm-compose-send"
                      disabled={commentBusy || !newComment.trim()}
                      onClick={() => handleAddComment()}
                      aria-label={commentBusy ? '등록 중' : '코멘트 등록'}
                      title={commentBusy ? '등록 중' : '코멘트 등록'}
                    >
                      <span
                        className={
                          'material-symbols-outlined' + (commentBusy ? ' tdm-compose-send--spin' : '')
                        }
                        style={{ fontVariationSettings: "'FILL' 1" }}
                        aria-hidden
                      >
                        {commentBusy ? 'progress_activity' : 'send'}
                      </span>
                    </button>
                  </div>
                </div>
                {commentError ? <p className="tdm-comment-error">{commentError}</p> : null}
              </section>
            </div>

            <div className="tdm-footer">
              <div className="tdm-footer-left" aria-hidden="true">
                <span className="tdm-footer-fake">
                  <span className="material-symbols-outlined">attach_file</span>
                  <span>첨부파일</span>
                </span>
                <span className="tdm-footer-fake">
                  <span className="material-symbols-outlined">checklist</span>
                  <span>체크리스트</span>
                </span>
              </div>
              <div className="tdm-footer-actions">
                <button type="button" className="tdm-btn tdm-btn--close" onClick={onClose}>
                  닫기
                </button>
                {typeof onMarkComplete === 'function' ? (
                  <button
                    type="button"
                    className="tdm-btn tdm-btn--done"
                    disabled={markCompleteBusy}
                    onClick={() => onMarkComplete(task)}
                  >
                    {markCompleteBusy ? '처리 중…' : isDone ? '진행 중으로 되돌리기' : '완료로 표시'}
                  </button>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
