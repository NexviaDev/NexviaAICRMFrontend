import { useState, useRef, useCallback, useMemo } from 'react';
import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession, getAuthHeader } from '@/lib/crm-auth';
import { API_BASE } from '@/config';
import {
  getMentionState,
  filterParticipantsForMention,
  insertMentionAt,
  renderMessageWithMentions
} from '@/lib/project-comment-mentions';

function formatCommentTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ApprovalCommentsPanel({ docId, comments = [], mentionable = [], currentUser, onCommentsChange }) {
  const [newComment, setNewComment] = useState('');
  const [replyDrafts, setReplyDrafts] = useState({});
  const [openReplyId, setOpenReplyId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mentionRange, setMentionRange] = useState(null);
  const textareaRef = useRef(null);
  const replyRef = useRef(null);

  const participants = useMemo(
    () => mentionable.map((p) => ({ userId: String(p.userId), name: p.name || '' })),
    [mentionable]
  );

  const mentionCandidates = useMemo(
    () => filterParticipantsForMention(participants, mentionRange?.query || ''),
    [mentionRange, participants]
  );

  const syncMention = useCallback((text, caret) => {
    setMentionRange(getMentionState(text, caret));
  }, []);

  const applyMention = useCallback((name) => {
    if (!mentionRange) return;
    const { text, caret } = insertMentionAt(newComment, mentionRange.startIndex, mentionRange.endIndex, name);
    setNewComment(text);
    setMentionRange(null);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(caret, caret);
      }
    });
  }, [mentionRange, newComment]);

  const postComment = useCallback(async () => {
    const message = newComment.trim();
    if (!message || !docId) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/approvals/${encodeURIComponent(docId)}/comments`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: JSON.stringify({ message })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '코멘트 저장에 실패했습니다.');
      setNewComment('');
      setMentionRange(null);
      onCommentsChange?.(data.comments || []);
    } catch (e) {
      setError(e.message || '코멘트 저장에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }, [docId, newComment, onCommentsChange]);

  const postReply = useCallback(async (commentId) => {
    const message = String(replyDrafts[commentId] || '').trim();
    if (!message || !docId || !commentId) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(
        `${API_BASE}/approvals/${encodeURIComponent(docId)}/comments/${encodeURIComponent(commentId)}/replies`,
        {
          method: 'POST',
          headers: getAuthHeader(),
          body: JSON.stringify({ message })
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '답글 저장에 실패했습니다.');
      setReplyDrafts((prev) => ({ ...prev, [commentId]: '' }));
      setOpenReplyId(null);
      onCommentsChange?.(data.comments || []);
    } catch (e) {
      setError(e.message || '답글 저장에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }, [docId, onCommentsChange, replyDrafts]);

  const meName = currentUser?.name || currentUser?.email || '';

  return (
    <aside className="approval-comments-panel">
      <div className="approval-comments-panel-head">
        <h3 className="approval-comments-panel-title">코멘트</h3>
        <span className="approval-comments-panel-count">{comments.length}</span>
      </div>
      <p className="approval-comments-panel-hint">기안자·결재선만 @이름 으로 멘션할 수 있습니다.</p>

      <div className="approval-comments-composer">
        <textarea
          ref={textareaRef}
          className="approval-comments-input"
          rows={3}
          value={newComment}
          onChange={(e) => {
            setNewComment(e.target.value);
            syncMention(e.target.value, e.target.selectionStart);
          }}
          onClick={(e) => syncMention(e.target.value, e.target.selectionStart)}
          onKeyUp={(e) => syncMention(e.target.value, e.target.selectionStart)}
          placeholder="의견을 남기세요. @이름 으로 멘션"
          maxLength={2000}
          disabled={busy}
        />
        {mentionRange && mentionCandidates.length > 0 ? (
          <ul className="approval-comments-mention-list" role="listbox">
            {mentionCandidates.map((p) => (
              <li key={p.userId}>
                <button type="button" className="approval-comments-mention-btn" onMouseDown={(e) => { e.preventDefault(); applyMention(p.name); }}>
                  @{p.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <button type="button" className="approval-comments-submit" onClick={() => void postComment()} disabled={busy || !newComment.trim()}>
          {busy ? '전송 중…' : '등록'}
        </button>
      </div>

      {error ? <p className="approval-comments-error">{error}</p> : null}

      <div className="approval-comments-list">
        {comments.length === 0 ? (
          <p className="approval-comments-empty">아직 코멘트가 없습니다.</p>
        ) : (
          comments.map((c) => (
            <article key={String(c._id)} className="approval-comments-card">
              <div className="approval-comments-card-head">
                <strong>{c.name || '사용자'}</strong>
                <time>{formatCommentTime(c.createdAt)}</time>
              </div>
              <p className="approval-comments-card-body">{renderMessageWithMentions(c.message)}</p>
              <button
                type="button"
                className="approval-comments-reply-toggle"
                onClick={() => setOpenReplyId((prev) => (prev === String(c._id) ? null : String(c._id)))}
              >
                답글
              </button>
              {(c.replies || []).map((r) => (
                <div key={String(r._id)} className="approval-comments-reply">
                  <div className="approval-comments-card-head">
                    <strong>{r.name || '사용자'}</strong>
                    <time>{formatCommentTime(r.createdAt)}</time>
                  </div>
                  <p className="approval-comments-card-body">{renderMessageWithMentions(r.message)}</p>
                </div>
              ))}
              {openReplyId === String(c._id) ? (
                <div className="approval-comments-reply-form">
                  <textarea
                    ref={replyRef}
                    className="approval-comments-input approval-comments-input--compact"
                    rows={2}
                    value={replyDrafts[c._id] || ''}
                    onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [c._id]: e.target.value }))}
                    placeholder={meName ? `${meName} 님의 답글` : '답글 입력'}
                    maxLength={2000}
                    disabled={busy}
                  />
                  <button type="button" className="approval-comments-submit approval-comments-submit--small" onClick={() => void postReply(c._id)} disabled={busy || !String(replyDrafts[c._id] || '').trim()}>
                    답글 등록
                  </button>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
