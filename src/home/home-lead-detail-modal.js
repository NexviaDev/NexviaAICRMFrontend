import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { API_BASE } from '@/config';
import { formatPhone } from '@/register/phoneFormat';
import '../sales-pipeline/opportunity-modal/opportunity-modal.css';
import './home-lead-detail-modal.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getCurrentUserId() {
  try {
    const raw = localStorage.getItem('crm_user');
    const u = raw ? JSON.parse(raw) : null;
    return u?._id || u?.id || null;
  } catch {
    return null;
  }
}

function formatCommentDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
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

function formatLeadPhoneDisplay(lead) {
  const cf = lead?.customFields;
  const raw =
    cf && cf.phone != null && String(cf.phone).trim() !== ''
      ? cf.phone
      : lead?.phone != null && String(lead.phone).trim() !== ''
        ? lead.phone
        : '';
  if (raw === '' || raw == null) return '—';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('82') && digits.length >= 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 0) return '—';
  return formatPhone(digits);
}

function formatReceivedAt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

/** customFields 키 표시용 (스네이크 등 그대로도 허용) */
function prettyFieldKey(key) {
  const k = String(key);
  if (k === 'phone') return '연락처';
  if (k === 'business_card') return '명함';
  return k;
}

export default function HomeLeadDetailModal({
  open,
  formId,
  leadId,
  channelLabel,
  channelSource,
  onClose,
  onUpdated
}) {
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [lead, setLead] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [replyingToId, setReplyingToId] = useState(null);
  const [replyText, setReplyText] = useState('');

  const currentUserId = useMemo(() => getCurrentUserId(), []);

  const loadLead = useCallback(async () => {
    if (!formId || !leadId) return;
    setLoading(true);
    setFetchError('');
    try {
      const res = await fetch(`${API_BASE}/lead-capture-forms/${formId}/leads/${leadId}`, {
        headers: getAuthHeader(),
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '리드를 불러올 수 없습니다.');
      setLead(data);
      setComments(Array.isArray(data.comments) ? data.comments : []);
      setNewComment('');
      setCommentError('');
      setEditingCommentId(null);
      setEditDraft('');
      setReplyingToId(null);
      setReplyText('');
    } catch (e) {
      setFetchError(e.message || '조회 실패');
      setLead(null);
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [formId, leadId]);

  useEffect(() => {
    if (!open || !formId || !leadId) return;
    loadLead();
  }, [open, formId, leadId, loadLead]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const { roots, childrenMap } = useMemo(() => organizeComments(comments), [comments]);
  const commentById = useMemo(() => {
    const m = new Map();
    (Array.isArray(comments) ? comments : []).forEach((c) => {
      const cid = c?._id != null ? String(c._id) : c?.id != null ? String(c.id) : '';
      if (cid) m.set(cid, c);
    });
    return m;
  }, [comments]);

  const baseCommentUrl = `${API_BASE}/lead-capture-forms/${formId}/leads/${leadId}/comments`;

  const handleAddComment = async (parentCommentId = null) => {
    const text = (parentCommentId ? replyText : newComment).trim();
    if (!text || !formId || !leadId) return;
    setCommentBusy(true);
    setCommentError('');
    try {
      const res = await fetch(baseCommentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
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
      onUpdated?.();
    } catch (err) {
      setCommentError(err.message || '코멘트 등록에 실패했습니다.');
    } finally {
      setCommentBusy(false);
    }
  };

  const handleSaveEditComment = async (commentId) => {
    const text = editDraft.trim();
    if (!text || !commentId) return;
    setCommentBusy(true);
    setCommentError('');
    try {
      const res = await fetch(`${baseCommentUrl}/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
        body: JSON.stringify({ text })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '코멘트를 수정할 수 없습니다.');
      setComments(Array.isArray(data.comments) ? data.comments : []);
      setEditingCommentId(null);
      setEditDraft('');
      onUpdated?.();
    } catch (err) {
      setCommentError(err.message || '코멘트 수정에 실패했습니다.');
    } finally {
      setCommentBusy(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!commentId) return;
    if (!window.confirm('이 코멘트를 삭제하시겠습니까?')) return;
    setCommentBusy(true);
    setCommentError('');
    try {
      const res = await fetch(`${baseCommentUrl}/${commentId}`, {
        method: 'DELETE',
        headers: getAuthHeader(),
        credentials: 'include'
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
      onUpdated?.();
    } catch (err) {
      setCommentError(err.message || '코멘트 삭제에 실패했습니다.');
    } finally {
      setCommentBusy(false);
    }
  };

  function renderCommentItem(c) {
    const id = String(c._id || c.id);
    const mine = isCommentAuthor(c, currentUserId);
    const isEditing = editingCommentId === id;
    const replies = childrenMap.get(id) || [];
    const parentId = c.parentCommentId != null ? String(c.parentCommentId) : null;
    const parentComment = parentId ? commentById.get(parentId) : null;

    return (
      <li key={id} className="opp-comment-item">
        {parentComment ? (
          <p className="opp-comment-reply-hint">
            <span className="material-symbols-outlined" aria-hidden>subdirectory_arrow_right</span>
            {parentComment.authorName || '사용자'}님에게 답글
          </p>
        ) : null}
        <div className="opp-comment-meta">
          <span className="opp-comment-author">{c.authorName || '사용자'}</span>
          <span className="opp-comment-date">
            {formatCommentDate(c.createdAt)}
            {c.updatedAt && c.createdAt && new Date(c.updatedAt) > new Date(c.createdAt) ? ' · 수정됨' : ''}
          </span>
          {!isEditing ? (
            <span className="opp-comment-actions">
              <button
                type="button"
                className="opp-comment-action-btn"
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
                    className="opp-comment-action-btn"
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
                    className="opp-comment-action-btn opp-comment-action-btn--danger"
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
          <div className="opp-comment-edit">
            <textarea
              className="opp-textarea opp-comment-edit-input"
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              rows={3}
              maxLength={5000}
            />
            <div className="opp-comment-edit-btns">
              <button type="button" className="opp-comment-cancel-btn" disabled={commentBusy} onClick={() => { setEditingCommentId(null); setEditDraft(''); }}>
                취소
              </button>
              <button type="button" className="opp-comment-save-btn" disabled={commentBusy || !editDraft.trim()} onClick={() => handleSaveEditComment(id)}>
                {commentBusy ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        ) : (
          <p className="opp-comment-text">{c.text}</p>
        )}
        {replyingToId === id && !isEditing ? (
          <div className="opp-comment-reply-compose">
            <textarea
              className="opp-textarea"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={`${c.authorName || '사용자'}님에게 답글 작성...`}
              rows={2}
              maxLength={5000}
              disabled={commentBusy}
            />
            <div className="opp-comment-reply-compose-row">
              <button type="button" className="opp-comment-cancel-btn" disabled={commentBusy} onClick={() => { setReplyingToId(null); setReplyText(''); }}>
                취소
              </button>
              <button
                type="button"
                className="opp-comment-add-btn"
                disabled={commentBusy || !replyText.trim()}
                onClick={() => handleAddComment(id)}
                aria-label="답글 등록"
                title="답글 등록"
              >
                <span className={'material-symbols-outlined' + (commentBusy ? ' opp-comment-add-btn-icon--spin' : '')} aria-hidden>
                  {commentBusy ? 'progress_activity' : 'send'}
                </span>
              </button>
            </div>
          </div>
        ) : null}
        {replies.length > 0 ? (
          <ul className="opp-comment-replies">
            {replies.map((r) => renderCommentItem(r))}
          </ul>
        ) : null}
      </li>
    );
  }

  const customFieldEntries = useMemo(() => {
    const cf = lead?.customFields;
    if (!cf || typeof cf !== 'object') return [];
    return Object.entries(cf).filter(([k, v]) => v !== undefined && v !== null && v !== '' && k !== 'phone');
  }, [lead]);

  if (!open) return null;

  return (
    <div className="hld-overlay" role="dialog" aria-modal="true" aria-labelledby="hld-title" onClick={onClose}>
      <div className="hld-modal" onClick={(e) => e.stopPropagation()}>
        <div className="hld-header">
          <h3 id="hld-title" className="hld-title">수신 리드 상세</h3>
          <button type="button" className="hld-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {loading ? (
          <div className="hld-body hld-loading">불러오는 중…</div>
        ) : fetchError ? (
          <div className="hld-body">
            <p className="hld-error">{fetchError}</p>
            <button type="button" className="hld-retry" onClick={loadLead}>다시 시도</button>
          </div>
        ) : lead ? (
          <div className="hld-body hld-scroll">
            <div className="hld-section">
              <div className="hld-badges">
                <span className="hld-badge" title="캡처 채널">{channelLabel || '—'}</span>
                <span className="hld-badge hld-badge--muted">{channelSource || '—'}</span>
              </div>
              <dl className="hld-dl">
                <dt>이름</dt>
                <dd>{lead.name || '—'}</dd>
                <dt>이메일</dt>
                <dd><a href={lead.email ? `mailto:${lead.email}` : undefined}>{lead.email || '—'}</a></dd>
                <dt>연락처</dt>
                <dd>{formatLeadPhoneDisplay(lead)}</dd>
                <dt>유입 출처</dt>
                <dd>{lead.source || '—'}</dd>
                <dt>수신 시각</dt>
                <dd>{formatReceivedAt(lead.receivedAt)}</dd>
              </dl>
            </div>

            {customFieldEntries.length > 0 ? (
              <div className="hld-section">
                <h4 className="hld-subtitle">추가 필드</h4>
                <dl className="hld-dl hld-dl--compact">
                  {customFieldEntries.map(([key, val]) => {
                    if (key === 'business_card' && typeof val === 'string' && (val.startsWith('http') || val.startsWith('//'))) {
                      return (
                        <React.Fragment key={key}>
                          <dt>{prettyFieldKey(key)}</dt>
                          <dd>
                            <a href={val} target="_blank" rel="noopener noreferrer" className="hld-link">이미지 보기</a>
                            <div className="hld-card-thumb-wrap">
                              <img src={val} alt="" className="hld-card-thumb" />
                            </div>
                          </dd>
                        </React.Fragment>
                      );
                    }
                    return (
                      <React.Fragment key={key}>
                        <dt>{prettyFieldKey(key)}</dt>
                        <dd>{typeof val === 'object' ? JSON.stringify(val) : String(val)}</dd>
                      </React.Fragment>
                    );
                  })}
                </dl>
              </div>
            ) : null}

            <div className="hld-section opp-comments-section">
              <div className="opp-comments-heading">코멘트</div>
              <p className="opp-comments-hint">이 리드에 대한 메모와 답글입니다. 본인이 작성한 코멘트만 수정·삭제할 수 있습니다.</p>
              <ul className="opp-comments-list hld-comments-list">
                {roots.map((c) => renderCommentItem(c))}
              </ul>
              <div className="opp-comment-compose">
                <div className="opp-comment-compose-wrap">
                  <textarea
                    className="opp-textarea opp-comment-compose-textarea"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="코멘트를 입력하세요."
                    rows={2}
                    maxLength={5000}
                    disabled={commentBusy}
                  />
                  <button
                    type="button"
                    className="opp-comment-add-btn opp-comment-add-btn--inset"
                    disabled={commentBusy || !newComment.trim()}
                    onClick={() => handleAddComment()}
                    aria-label={commentBusy ? '등록 중' : '코멘트 등록'}
                    title={commentBusy ? '등록 중' : '코멘트 등록'}
                  >
                    <span className={'material-symbols-outlined' + (commentBusy ? ' opp-comment-add-btn-icon--spin' : '')} aria-hidden>
                      {commentBusy ? 'progress_activity' : 'send'}
                    </span>
                  </button>
                </div>
              </div>
              {commentError ? <p className="opp-comment-error">{commentError}</p> : null}
            </div>
          </div>
        ) : null}

        <div className="hld-footer">
          <button type="button" className="hld-footer-btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
