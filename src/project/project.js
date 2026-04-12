import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { API_BASE } from '@/config';
import { getStoredCrmUser } from '@/lib/crm-role-utils';
import { canEditProject, canDeleteProject, canCreateProject } from '@/lib/project-permissions';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import { CommentAuthorAvatar } from '@/shared/comment-author-avatar';
import ProjectFormModal from './project-form-modal';
import './project.css';
import './project2-sample.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatDue(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return '—';
  }
}

/** Project2.html — D-45 형식 마감까지 남은 일수(음수면 지남) */
function dueCountdownLabel(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    const diff = Math.ceil((d - now) / (24 * 60 * 60 * 1000));
    if (diff > 0) return `D-${diff}`;
    if (diff === 0) return 'D-Day';
    return `D+${Math.abs(diff)}`;
  } catch {
    return '—';
  }
}

function formatDt(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

function parseCrmUser() {
  try {
    const raw = localStorage.getItem('crm_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 로그인 사용자 — 참여자 행 { userId, name } (project-form-modal과 동일) */
function selfParticipantEntry() {
  const u = parseCrmUser();
  if (!u || u._id == null || u._id === '') return null;
  const name = String(u.name || u.fullName || u.email || '나').trim() || '나';
  return { userId: u._id, name };
}

/** 저장 목록에 본인이 없으면 표시용으로만 앞에 합침 */
function mergeSelfIntoParticipants(list) {
  const self = selfParticipantEntry();
  if (!self) return Array.isArray(list) ? [...list] : [];
  const arr = Array.isArray(list) ? [...list] : [];
  if (arr.some((p) => String(p.userId) === String(self.userId))) return arr;
  return [self, ...arr];
}

/** parentProjectId 등 — populate 객체·ObjectId 모두 문자열 id로 통일 */
function idKey(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'object' && v !== null && v._id != null) return String(v._id);
  return String(v).trim();
}

/** 상위–하위 프로젝트 연결 비교 시 양쪽 모두 idKey로 통일 (한쪽만 String 하면 트리가 비어 보일 수 있음) */
function sameProjectId(a, b) {
  const ka = idKey(a);
  const kb = idKey(b);
  return ka !== '' && ka === kb;
}

/** 코멘트 입력란 state 키 — 전체는 projectId만, 단계는 projectId::stageId */
function commentDraftKey(projectId, stageId) {
  const pid = String(projectId);
  return stageId ? `${pid}::${idKey(stageId)}` : pid;
}

function filterCommentsByScope(comments, stageId) {
  const list = Array.isArray(comments) ? comments : [];
  if (!stageId) return list.filter((c) => !c.stageId);
  const sk = idKey(stageId);
  return list.filter((c) => c.stageId && idKey(c.stageId) === sk);
}

/**
 * Project2.html 트리와 동일 — 가로 스트립이 아니라 ml-10 + tree-line 아래 세로 단계 행(L3 느낌).
 * 상단 타임라인과 동일한 진행 규칙(완료/진행/예정).
 */
function SubProjectStagesTreeRows({
  currentUser,
  project,
  stages,
  idKeyFn,
  compact = false,
  workflowStageMenu,
  toggleWorkflowStageMenu
}) {
  const canEditStage = canEditProject(currentUser, project);
  const curK = idKeyFn(project.currentStageId);
  let activeIdx = stages.findIndex((st) => idKeyFn(st.id) === curK);
  if (activeIdx < 0) activeIdx = 0;
  const lastStage = stages[stages.length - 1];
  const doneAll = lastStage && curK === idKeyFn(lastStage.id);
  const pid = String(project._id);

  /** Sample Design/Project2.html: `ml-10 … relative tree-line` 안에 `tree-item` — 세로·가로 연결선이 같은 기준으로 맞음 */
  return (
    <div className="project-p2-facade-tree-nest tree-line project-p2-facade-tree-nest--workflow-stages">
      {stages.map((s, idx) => {
        const sid = idKeyFn(s.id);
        let mode;
        if (doneAll) mode = 'done';
        else if (idx < activeIdx) mode = 'done';
        else if (idx === activeIdx) mode = 'current';
        else mode = 'todo';

        const ico =
          mode === 'done' ? 'check_circle' : mode === 'current' ? 'trip_origin' : 'radio_button_unchecked';

        const menuOpen =
          workflowStageMenu &&
          workflowStageMenu.subtreeOnly &&
          workflowStageMenu.projectId === pid &&
          idKey(workflowStageMenu.stageId) === sid;

        return (
          <div key={`${String(project._id)}-wfrow-${sid || idx}`} className="project-p2-facade-tree-item relative tree-item">
            <button
              type="button"
              className={`project-p2-facade-tree-row project-p2-facade-tree-row-l3 project-p2-facade-tree-row--stage project-p2-facade-tree-stage-hit project-p2-facade-tree-row--stage-${mode}${compact ? ' project-p2-facade-tree-row--stage-compact' : ''}${!canEditStage ? ' project-p2-facade-tree-stage-hit--readonly' : ''}`}
              data-project-stage-dropdown
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label={`${s.label || '단계'} — 단계 메뉴`}
              disabled={!canEditStage}
              onClick={(e) => {
                if (!canEditStage) return;
                toggleWorkflowStageMenu(project, s, {
                  subtreeOnly: true,
                  clientX: e.clientX,
                  clientY: e.clientY
                });
              }}
              onContextMenu={(e) => {
                if (!canEditStage) return;
                e.preventDefault();
                toggleWorkflowStageMenu(project, s, {
                  subtreeOnly: true,
                  clientX: e.clientX,
                  clientY: e.clientY
                });
              }}
            >
              <div className="project-p2-facade-tree-l3-main">
                <span className={`material-symbols-outlined project-p2-facade-tree-stage-ico${mode === 'todo' ? ' project-p2-facade-tree-stage-ico--muted' : ''}`} aria-hidden>
                  {ico}
                </span>
                <h4 className="project-p2-facade-tree-h4">
                  {s.label || '단계'}
                  {mode === 'current' ? <span className="project-p2-facade-tree-stage-em"> (진행중)</span> : null}
                </h4>
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** dueDate 없을 때만 Pending으로 두지 않고, 워크플로 상의 현재 단계로 진행 여부 판단 */
function subtreeStatusPill(sub, idKeyFn) {
  const stages = Array.isArray(sub.stages) ? sub.stages : [];
  const curK = idKeyFn(sub.currentStageId);
  const lastStage = stages[stages.length - 1];
  if (lastStage && curK === idKeyFn(lastStage.id)) return 'done';
  if (stages.length >= 2 && curK) {
    const ok = stages.some((s) => idKeyFn(s.id) === curK);
    if (ok) return 'ip';
  }
  if (sub.dueDate) return 'ip';
  return 'pending';
}

/** 코멘트 1건 — 답글이 있으면 기본 접힘, 펼칠 때만 목록·입력 표시 */
function ProjectCommentBlock({
  c,
  projectId,
  formatDt,
  replyDraft,
  setReplyDraft,
  submitReply
}) {
  const pid = String(projectId);
  const replies = Array.isArray(c.replies) ? c.replies : [];
  const [repliesOpen, setRepliesOpen] = useState(false);

  return (
    <li className="project-comment-block">
      <div className="project-comment-main">
        <CommentAuthorAvatar
          name={c.authorName}
          avatar={c.authorAvatar}
          avatarPublicId={c.authorAvatarPublicId}
          className="project-comment-av"
          size={64}
        />
        <div className="project-comment-body">
          <div className="project-comment-head">
            <strong>{c.authorName || '—'}</strong>
            <time dateTime={c.createdAt}>{formatDt(c.createdAt)}</time>
          </div>
          <div className="project-comment-bubble">{c.body}</div>
        </div>
      </div>
      {replies.length > 0 ? (
        <>
          <button
            type="button"
            className="project-comment-replies-toggle"
            aria-expanded={repliesOpen}
            onClick={() => setRepliesOpen((v) => !v)}
          >
            답글 {replies.length}개 · {repliesOpen ? '접기' : '펼치기'}
          </button>
          {repliesOpen ? (
            <div className="project-comment-replies-panel">
              {replies.map((r) => (
                <div key={String(r._id)} className="project-reply-row">
                  <CommentAuthorAvatar
                    name={r.authorName}
                    avatar={r.authorAvatar}
                    avatarPublicId={r.authorAvatarPublicId}
                    className="project-comment-av project-reply-av"
                    size={64}
                  />
                  <div className="project-comment-body">
                    <div className="project-comment-head">
                      <strong>{r.authorName || '—'}</strong>
                      <time dateTime={r.createdAt}>{formatDt(r.createdAt)}</time>
                    </div>
                    <div className="project-reply-bubble">{r.body}</div>
                  </div>
                </div>
              ))}
              <form className="project-reply-form" onSubmit={(e) => submitReply(projectId, c._id, e)}>
                <input
                  type="text"
                  placeholder="답글 입력…"
                  value={replyDraft[`${pid}:${c._id}`] || ''}
                  onChange={(e) =>
                    setReplyDraft((d) => ({
                      ...d,
                      [`${pid}:${c._id}`]: e.target.value
                    }))
                  }
                />
                <button type="submit" className="btn-outline project-reply-send">
                  답글
                </button>
              </form>
            </div>
          ) : null}
        </>
      ) : (
        <form className="project-reply-form project-reply-form--under-bubble" onSubmit={(e) => submitReply(projectId, c._id, e)}>
          <input
            type="text"
            placeholder="답글 입력…"
            value={replyDraft[`${pid}:${c._id}`] || ''}
            onChange={(e) =>
              setReplyDraft((d) => ({
                ...d,
                [`${pid}:${c._id}`]: e.target.value
              }))
            }
          />
          <button type="submit" className="btn-outline project-reply-send">
            답글
          </button>
        </form>
      )}
    </li>
  );
}

/** 구조적 하위 트리 — 카드 바로 아래 인라인 코멘트(해당 서브 프로젝트 전체 스코프) */
function SubProjectTreeComments({
  sub,
  allItems,
  formatDt,
  commentDraft,
  setCommentDraft,
  replyDraft,
  setReplyDraft,
  submitComment,
  submitReply
}) {
  const doc = allItems.find((x) => String(x._id) === String(sub._id)) || sub;
  const comments = Array.isArray(doc.comments) ? doc.comments : [];
  const scoped = filterCommentsByScope(comments, '');
  const draftKey = commentDraftKey(doc._id, '');
  const pid = doc._id;
  const labelId = `sub-tree-comments-label-${String(pid)}`;
  const bodyId = `sub-tree-comments-body-${String(pid)}`;
  /** 기본 접음 — 코멘트가 많을 때 세로 스크롤 부담 완화 */
  const [commentsOpen, setCommentsOpen] = useState(false);

  return (
    <div id={`sub-tree-comments-${String(pid)}`} className="project-p2-facade-subtree-comments">
      <button
        type="button"
        className="project-p2-facade-subtree-comments-toggle"
        id={labelId}
        aria-expanded={commentsOpen}
        aria-controls={bodyId}
        onClick={() => setCommentsOpen((v) => !v)}
      >
        <span className="project-p2-facade-subtree-comments-h">코멘트 · 답글</span>
        {scoped.length > 0 ? (
          <span className="project-p2-facade-subtree-comments-count" aria-hidden>
            {scoped.length}
          </span>
        ) : null}
        <span
          className={`material-symbols-outlined project-p2-facade-subtree-comments-chevron${
            commentsOpen ? ' project-p2-facade-subtree-comments-chevron--open' : ''
          }`}
          aria-hidden
        >
          expand_more
        </span>
      </button>
      {commentsOpen ? (
        <div id={bodyId} className="project-p2-facade-subtree-comments-body" role="region" aria-labelledby={labelId}>
          <ul className="project-comment-list">
            {scoped.map((c) => (
              <ProjectCommentBlock
                key={String(c._id)}
                c={c}
                projectId={pid}
                formatDt={formatDt}
                replyDraft={replyDraft}
                setReplyDraft={setReplyDraft}
                submitReply={submitReply}
              />
            ))}
          </ul>
          <form className="project-new-comment" onSubmit={(e) => submitComment(pid, e, '')}>
            <input
              type="text"
              placeholder="이 하위 프로젝트 코멘트…"
              value={commentDraft[draftKey] || ''}
              onChange={(e) =>
                setCommentDraft((d) => ({
                  ...d,
                  [draftKey]: e.target.value
                }))
              }
            />
            <button type="submit" className="btn-primary">
              등록
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

/** Project2.html 과 동일 마크업/클래스 체계 — 구조적 하위 프로젝트 트리 */
function ProjectSubtreeNode({
  currentUser,
  sub,
  allItems,
  depth,
  idKeyFn,
  openEdit,
  onDelete,
  formatDue,
  resolveParticipantAvatar,
  subTreeExpandedId,
  toggleSubTreeExpand,
  commentDraft,
  setCommentDraft,
  replyDraft,
  setReplyDraft,
  submitComment,
  submitReply,
  openCreateSub,
  workflowStageMenu,
  toggleWorkflowStageMenu,
  l1Index = 0,
  siblingIndex = 0
}) {
  const canEditSub = canEditProject(currentUser, sub);
  const canDeleteSub = canDeleteProject(currentUser, sub);
  const canCreateSub = canCreateProject(currentUser);
  const nested = allItems.filter((c) => idKeyFn(c.parentProjectId) === idKeyFn(sub._id));
  const participants = Array.isArray(sub.participants) ? sub.participants : [];
  const stages = Array.isArray(sub.stages) ? sub.stages : [];
  const pillVar = subtreeStatusPill(sub, idKeyFn);
  const pillClass =
    pillVar === 'done'
      ? 'project-p2-facade-tree-pill project-p2-facade-tree-pill--done'
      : pillVar === 'pending'
        ? 'project-p2-facade-tree-pill project-p2-facade-tree-pill--pending'
        : 'project-p2-facade-tree-pill project-p2-facade-tree-pill--ip';
  const pillText =
    pillVar === 'done' ? 'Completed' : pillVar === 'pending' ? 'Pending' : 'In Progress';

  if (depth >= 2) {
    const subIdStr = String(sub._id);
    const expanded = subTreeExpandedId === subIdStr;
    return (
      <div className="project-p2-facade-tree-item relative tree-item">
        <div className="project-p2-facade-tree-row project-p2-facade-tree-row-l3">
          <div
            className="project-p2-facade-tree-l3-row-hit"
            role="button"
            tabIndex={0}
            aria-expanded={expanded}
            aria-label={`${sub.title || '하위 프로젝트'} — 단계·코멘트 펼치기`}
            onClick={() => toggleSubTreeExpand(sub._id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSubTreeExpand(sub._id);
              }
            }}
          >
            <span
              className={`material-symbols-outlined project-p2-facade-tree-row-chevron project-p2-facade-tree-row-chevron--compact${expanded ? ' project-p2-facade-tree-row-chevron--open' : ''}`}
              aria-hidden
            >
              keyboard_arrow_down
            </span>
            <div className="project-p2-facade-tree-l3-main">
              <span className="material-symbols-outlined project-p2-facade-tree-ico-l3" aria-hidden>
                description
              </span>
              <h4 className="project-p2-facade-tree-h4">{sub.title || '—'}</h4>
            </div>
          </div>
          <button
            type="button"
            className="project-p2-facade-tree-add-ico-sm"
            aria-label="하위 프로젝트 추가"
            disabled={!canCreateSub}
            onClick={() => canCreateSub && openCreateSub(sub)}
          >
            <span className="material-symbols-outlined">add_circle</span>
          </button>
        </div>
        {expanded ? (
          <div className="project-p2-facade-tree-bundle project-p2-facade-tree-bundle--l3" id={`sub-tree-bundle-${subIdStr}`}>
            {stages.length > 0 ? (
              <SubProjectStagesTreeRows
                currentUser={currentUser}
                project={sub}
                stages={stages}
                idKeyFn={idKeyFn}
                compact
                workflowStageMenu={workflowStageMenu}
                toggleWorkflowStageMenu={toggleWorkflowStageMenu}
              />
            ) : null}
            <SubProjectTreeComments
              sub={sub}
              allItems={allItems}
              formatDt={formatDt}
              commentDraft={commentDraft}
              setCommentDraft={setCommentDraft}
              replyDraft={replyDraft}
              setReplyDraft={setReplyDraft}
              submitComment={submitComment}
              submitReply={submitReply}
            />
            {nested.length > 0 ? (
              <div className="project-p2-facade-tree-nest tree-line">
                {nested.map((ch, chIdx) => (
                  <ProjectSubtreeNode
                    key={String(ch._id)}
                    currentUser={currentUser}
                    sub={ch}
                    allItems={allItems}
                    depth={depth + 1}
                    idKeyFn={idKeyFn}
                    openEdit={openEdit}
                    onDelete={onDelete}
                    formatDue={formatDue}
                    resolveParticipantAvatar={resolveParticipantAvatar}
                    subTreeExpandedId={subTreeExpandedId}
                    toggleSubTreeExpand={toggleSubTreeExpand}
                    commentDraft={commentDraft}
                    setCommentDraft={setCommentDraft}
                    replyDraft={replyDraft}
                    setReplyDraft={setReplyDraft}
                    submitComment={submitComment}
                    submitReply={submitReply}
                    openCreateSub={openCreateSub}
                    workflowStageMenu={workflowStageMenu}
                    toggleWorkflowStageMenu={toggleWorkflowStageMenu}
                    l1Index={0}
                    siblingIndex={chIdx}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const icon =
    depth === 0
      ? l1Index % 2 === 0
        ? 'account_tree'
        : 'shield'
      : depth === 1
        ? siblingIndex % 2 === 1
          ? 'sync_alt'
          : 'schema'
        : 'schema';
  const icoClass = depth === 0 ? 'project-p2-facade-tree-ico-l1' : 'project-p2-facade-tree-ico-l2';

  /** Project2.html: L1만 마감/시작 메타 — L2는 뱃지만 */
  const dateLineL1 =
    depth === 0
      ? pillVar === 'done'
        ? null
        : pillVar === 'pending'
          ? (
              <span className="project-p2-facade-tree-date">시작 예정: {formatDue(sub.dueDate)}</span>
            )
          : (
              <span className="project-p2-facade-tree-date">마감일: {formatDue(sub.dueDate)}</span>
            )
      : null;

  const l1ChatDelete = l1Index % 2 === 0;
  const subIdStr = String(sub._id);
  const expanded = subTreeExpandedId === subIdStr;

  return (
    <div className={depth === 0 ? 'project-p2-facade-tree-l1' : 'project-p2-facade-tree-item relative tree-item'}>
      <div className="project-p2-facade-tree-row">
        <div
          className="project-p2-facade-tree-row-main project-p2-facade-tree-row-main--expandable"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label={`${sub.title || '하위 프로젝트'} — 단계·코멘트 펼치기`}
          onClick={() => toggleSubTreeExpand(sub._id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleSubTreeExpand(sub._id);
            }
          }}
        >
          <span
            className={`material-symbols-outlined project-p2-facade-tree-row-chevron${expanded ? ' project-p2-facade-tree-row-chevron--open' : ''}`}
            aria-hidden
          >
            keyboard_arrow_down
          </span>
          <span className={`material-symbols-outlined ${icoClass}`} aria-hidden>
            {icon}
          </span>
          <div>
            <h3 className="project-p2-facade-tree-h3">{sub.title || '—'}</h3>
            <div className="project-p2-facade-tree-meta">
              <span className={pillClass}>{pillText}</span>
              {dateLineL1}
            </div>
          </div>
        </div>
        {depth === 0 ? (
          <div className="project-p2-facade-tree-side">
            {l1ChatDelete ? (
              <div className="project-p2-facade-tree-avatars">
                {participants.slice(0, 3).map((a, i) => {
                  const av = resolveParticipantAvatar(a.userId);
                  return (
                    <CommentAuthorAvatar
                      key={`${sub._id}-av-${i}`}
                      name={a.name}
                      avatar={av.avatar}
                      avatarPublicId={av.avatarPublicId}
                      className="project-p2-facade-tree-av"
                      size={28}
                    />
                  );
                })}
                {participants.length > 3 ? (
                  <span className="project-p2-facade-tree-av">+{participants.length - 3}</span>
                ) : null}
              </div>
            ) : (canEditSub || canDeleteSub ? (
              <div className="project-p2-facade-tree-l1-ibtns">
                {canEditSub ? (
                  <button type="button" className="project-p2-facade-tree-ibtn" aria-label="수정" onClick={() => openEdit(sub)}>
                    <span className="material-symbols-outlined">edit</span>
                  </button>
                ) : null}
                {canDeleteSub ? (
                  <button
                    type="button"
                    className="project-p2-facade-tree-ibtn project-p2-facade-tree-ibtn--danger"
                    aria-label="삭제"
                    onClick={() => onDelete(sub)}
                  >
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                ) : null}
              </div>
            ) : null)}
          </div>
        ) : (
          <div className="project-p2-facade-tree-side project-p2-facade-tree-side-tight">
            {participants.length > 0 ? (
              <div className="project-p2-facade-tree-avatars">
                {participants.slice(0, 3).map((a, i) => {
                  const av = resolveParticipantAvatar(a.userId);
                  return (
                    <CommentAuthorAvatar
                      key={`${sub._id}-av-${i}`}
                      name={a.name}
                      avatar={av.avatar}
                      avatarPublicId={av.avatarPublicId}
                      className="project-p2-facade-tree-av"
                      size={28}
                    />
                  );
                })}
              </div>
            ) : null}
            <button
              type="button"
              className="project-p2-facade-tree-chipbtn"
              onClick={() => toggleSubTreeExpand(sub._id)}
            >
              {expanded ? '접기' : '상세'}
            </button>
          </div>
        )}
      </div>
      {expanded ? (
        <div className="project-p2-facade-tree-bundle" id={`sub-tree-bundle-${subIdStr}`}>
          {stages.length > 0 ? (
            <SubProjectStagesTreeRows
              currentUser={currentUser}
              project={sub}
              stages={stages}
              idKeyFn={idKeyFn}
              compact={false}
              workflowStageMenu={workflowStageMenu}
              toggleWorkflowStageMenu={toggleWorkflowStageMenu}
            />
          ) : null}
          <SubProjectTreeComments
            sub={sub}
            allItems={allItems}
            formatDt={formatDt}
            commentDraft={commentDraft}
            setCommentDraft={setCommentDraft}
            replyDraft={replyDraft}
            setReplyDraft={setReplyDraft}
            submitComment={submitComment}
            submitReply={submitReply}
          />
          {nested.length > 0 ? (
            <div className="project-p2-facade-tree-nest tree-line">
              {nested.map((ch, chIdx) => (
                <ProjectSubtreeNode
                  key={String(ch._id)}
                  currentUser={currentUser}
                  sub={ch}
                  allItems={allItems}
                  depth={depth + 1}
                  idKeyFn={idKeyFn}
                  openEdit={openEdit}
                  onDelete={onDelete}
                  formatDue={formatDue}
                  resolveParticipantAvatar={resolveParticipantAvatar}
                  subTreeExpandedId={subTreeExpandedId}
                  toggleSubTreeExpand={toggleSubTreeExpand}
                  commentDraft={commentDraft}
                  setCommentDraft={setCommentDraft}
                  replyDraft={replyDraft}
                  setReplyDraft={setReplyDraft}
                  submitComment={submitComment}
                  submitReply={submitReply}
                  openCreateSub={openCreateSub}
                  workflowStageMenu={workflowStageMenu}
                  toggleWorkflowStageMenu={toggleWorkflowStageMenu}
                  l1Index={0}
                  siblingIndex={chIdx}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Project2.html 타임라인 — 단일 행 (완료: 전체 체크 / 진행: 링·(진행중) / 예정: 흐림) */
function Project2LinearTimeline({
  currentUser,
  project,
  stages,
  done,
  dueLabel,
  idKeyFn,
  toggleWorkflowStageMenu,
  onWorkflowStageContextMenu,
  workflowStageMenu,
  stageMenuAnchorRef
}) {
  const canEditWf = canEditProject(currentUser, project);
  const curK = idKeyFn(project.currentStageId);
  let activeIdx = stages.findIndex((st) => idKeyFn(st.id) === curK);
  if (activeIdx < 0) activeIdx = 0;

  return (
    <div className="project-p2-facade-wf-card">
      <div className="project-p2-facade-wf-head">
        <h2 className="project-p2-facade-wf-title">
          <span className="material-symbols-outlined" aria-hidden>
            analytics
          </span>
          타임라인 워크플로우
        </h2>
        <span className={`project-p2-facade-wf-due${done ? ' project-p2-facade-wf-due--muted' : ''}`}>
          {done ? '완료' : dueLabel}
        </span>
      </div>
      {stages.length === 0 ? (
        <p className="project-p2-facade-lead project-p2-facade-lead--layered">
          등록된 단계가 없습니다. 편집에서 단계를 추가하세요.
        </p>
      ) : (
        <div className="project-p2-facade-wf-track">
          <div className="project-p2-facade-wf-line" aria-hidden />
          {stages.map((s, idx) => {
            const sid = idKeyFn(s.id);
            let mode;
            if (done) mode = 'done';
            else if (idx < activeIdx) mode = 'done';
            else if (idx === activeIdx) mode = 'current';
            else mode = 'todo';
            const menuOpen =
              workflowStageMenu &&
              !workflowStageMenu.subtreeOnly &&
              workflowStageMenu.projectId === String(project._id) &&
              workflowStageMenu.stageId === sid;
            const labelText = mode === 'current' ? `${s.label || '단계'} (진행중)` : s.label || '단계';
            return (
              <div
                key={`${String(project._id)}-p2-${sid || idx}`}
                className={`project-p2-facade-wf-step${mode === 'todo' ? ' project-p2-facade-wf-step--todo' : ''}`}
                data-project-stage-dropdown
              >
                <div className="project-p2-facade-wf-icon-slot">
                  {mode === 'done' ? (
                    <button
                      type="button"
                      className="project-p2-facade-wf-icon-done"
                      ref={menuOpen ? stageMenuAnchorRef : undefined}
                      disabled={!canEditWf}
                      onClick={() => canEditWf && toggleWorkflowStageMenu(project, s)}
                      onContextMenu={(e) => {
                        if (!canEditWf) return;
                        onWorkflowStageContextMenu(e, project, s);
                      }}
                      aria-expanded={menuOpen}
                      aria-haspopup="menu"
                      aria-label={s.label || '단계'}
                    >
                      <span className="material-symbols-outlined">check</span>
                    </button>
                  ) : null}
                  {mode === 'current' ? (
                    <button
                      type="button"
                      className="project-p2-facade-wf-icon-current"
                      ref={menuOpen ? stageMenuAnchorRef : undefined}
                      disabled={!canEditWf}
                      onClick={() => canEditWf && toggleWorkflowStageMenu(project, s)}
                      onContextMenu={(e) => {
                        if (!canEditWf) return;
                        onWorkflowStageContextMenu(e, project, s);
                      }}
                      aria-expanded={menuOpen}
                      aria-haspopup="menu"
                      aria-label={s.label || '단계'}
                    >
                      <span className="project-p2-facade-wf-dot" />
                    </button>
                  ) : null}
                  {mode === 'todo' ? (
                    <button
                      type="button"
                      className="project-p2-facade-wf-icon-todo"
                      ref={menuOpen ? stageMenuAnchorRef : undefined}
                      disabled={!canEditWf}
                      onClick={() => canEditWf && toggleWorkflowStageMenu(project, s)}
                      onContextMenu={(e) => {
                        if (!canEditWf) return;
                        onWorkflowStageContextMenu(e, project, s);
                      }}
                      aria-expanded={menuOpen}
                      aria-haspopup="menu"
                      aria-label={s.label || '단계'}
                    />
                  ) : null}
                </div>
                <span
                  className={`project-p2-facade-wf-label${mode === 'current' ? ' project-p2-facade-wf-label--active' : ''}${mode === 'todo' ? ' project-p2-facade-wf-label--todo' : ''}`}
                >
                  {labelText}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 서브 프로젝트 자체 워크플로의 현재 단계 — 메인 단계와 동일 아이콘(시작/중간/완료) */
function SubProjectStageIcon({ project }) {
  const stages = Array.isArray(project?.stages) ? project.stages : [];
  const curK = idKey(project?.currentStageId);
  let idx = stages.findIndex((st) => idKey(st.id) === curK);
  if (idx < 0) idx = 0;
  const n = stages.length;
  if (n === 0) {
    return <span className="material-symbols-outlined">radio_button_checked</span>;
  }
  if (idx === 0) {
    return <span className="material-symbols-outlined">flag</span>;
  }
  if (idx === n - 1) {
    return <span className="material-symbols-outlined">task_alt</span>;
  }
  return <span className="material-symbols-outlined">radio_button_checked</span>;
}

export default function Project() {
  const me = useMemo(() => getStoredCrmUser(), []);
  const canCreate = canCreateProject(me);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  /** 서브 프로젝트 등록 시 미리 채울 상위 프로젝트 */
  const [formParentProject, setFormParentProject] = useState(null);
  /** 워크플로 단계에서 서브 생성 시 연결할 stage id */
  const [formParentStage, setFormParentStage] = useState(null);
  /** { projectId, stageId } — 단계 클릭 시 드롭다운 메뉴 */
  const [workflowStageMenu, setWorkflowStageMenu] = useState(null);
  /** 포털 드롭다운 위치 (뷰포트 fixed) */
  const [stageMenuPos, setStageMenuPos] = useState(null);
  const stageMenuAnchorRef = useRef(null);
  const [commentDraft, setCommentDraft] = useState({});
  const [replyDraft, setReplyDraft] = useState({});
  /** 구조적 하위 트리에서 인라인 코멘트 패널을 연 서브 프로젝트 id */
  const [subTreeExpandedId, setSubTreeExpandedId] = useState(null);
  /** 팀원·사내현황 API — 참여자 userId → avatar / avatarPublicId (본인은 crm_user 우선) */
  const [employeeAvatarByUserId, setEmployeeAvatarByUserId] = useState(() => new Map());

  const toggleSubTreeExpand = useCallback((subId) => {
    const sid = String(subId);
    setSubTreeExpandedId((v) => (v === sid ? null : sid));
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/projects?limit=200`, {
        headers: getAuthHeader(),
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) setItems(data.items);
      else setItems([]);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    const headers = getAuthHeader();
    Promise.all([
      fetch(`${API_BASE}/calendar-events/team-members`, { headers }).then((r) => r.json().catch(() => ({}))),
      fetch(`${API_BASE}/companies/overview`, { headers }).then((r) => r.json().catch(() => ({})))
    ])
      .then(([teamData, overviewData]) => {
        const map = new Map();
        const fromOverview = Array.isArray(overviewData?.employees) ? overviewData.employees : [];
        const fromTeam = Array.isArray(teamData?.members) ? teamData.members : [];
        for (const e of fromOverview) {
          if (e?.id == null) continue;
          const id = String(e.id);
          map.set(id, {
            avatar: e.avatar != null && String(e.avatar).trim() ? String(e.avatar).trim() : '',
            avatarPublicId: ''
          });
        }
        for (const m of fromTeam) {
          if (m?._id == null) continue;
          const id = String(m._id);
          const prev = map.get(id) || { avatar: '', avatarPublicId: '' };
          map.set(id, {
            avatar:
              m.avatar != null && String(m.avatar).trim() ? String(m.avatar).trim() : prev.avatar,
            avatarPublicId:
              m.avatarPublicId != null && String(m.avatarPublicId).trim()
                ? String(m.avatarPublicId).trim()
                : prev.avatarPublicId
          });
        }
        setEmployeeAvatarByUserId(map);
      })
      .catch(() => {});
  }, []);

  const resolveParticipantAvatar = useCallback(
    (userId) => {
      const uid = String(userId ?? '');
      const self = parseCrmUser();
      if (self && uid === String(self._id)) {
        return {
          avatar: self.avatar != null && String(self.avatar).trim() ? String(self.avatar).trim() : '',
          avatarPublicId:
            self.avatarPublicId != null && String(self.avatarPublicId).trim()
              ? String(self.avatarPublicId).trim()
              : ''
        };
      }
      const row = employeeAvatarByUserId.get(uid);
      return {
        avatar: row?.avatar || '',
        avatarPublicId: row?.avatarPublicId || ''
      };
    },
    [employeeAvatarByUserId]
  );

  useLayoutEffect(() => {
    if (!subTreeExpandedId) return;
    const el =
      document.getElementById(`sub-tree-bundle-${subTreeExpandedId}`) ||
      document.getElementById(`sub-tree-comments-${subTreeExpandedId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [subTreeExpandedId]);

  useEffect(() => {
    if (!workflowStageMenu) return;
    const close = (e) => {
      const root = e.target.closest?.('[data-project-stage-dropdown]');
      if (!root) setWorkflowStageMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [workflowStageMenu]);

  /** 워크플로 드롭다운: body 포털용 데이터 */
  const stageMenuView = useMemo(() => {
    if (!workflowStageMenu) return null;
    const { projectId, stageId } = workflowStageMenu;
    const parent = items.find((x) => String(x._id) === String(projectId));
    if (!parent) return null;
    const stage = (Array.isArray(parent.stages) ? parent.stages : []).find(
      (st) => idKey(st.id) === idKey(stageId)
    );
    if (!stage) return null;
    const sid = idKey(stageId);
    const subs = items.filter(
      (c) => sameProjectId(c.parentProjectId, projectId) && idKey(c.parentStageId) === sid
    );
    return { parent, stage, subs };
  }, [workflowStageMenu, items]);

  useLayoutEffect(() => {
    if (!workflowStageMenu) {
      setStageMenuPos(null);
      return;
    }
    let rafId = 0;
    let attempts = 0;
    const place = () => {
      /** 구조적 하위 단계: 클릭 지점 기준 우측·아래로 메뉴 */
      if (
        workflowStageMenu.subtreeOnly &&
        typeof workflowStageMenu.clientX === 'number' &&
        typeof workflowStageMenu.clientY === 'number'
      ) {
        const margin = 8;
        const offset = 6;
        const estW = 280;
        const estH = 140;
        let left = workflowStageMenu.clientX + offset;
        let top = workflowStageMenu.clientY + offset;
        if (left + estW > window.innerWidth - margin) {
          left = Math.max(margin, window.innerWidth - estW - margin);
        }
        if (top + estH > window.innerHeight - margin) {
          top = Math.max(margin, workflowStageMenu.clientY - estH - offset);
        }
        if (left < margin) left = margin;
        if (top < margin) top = margin;
        setStageMenuPos({ top, left, anchor: 'cursor' });
        return;
      }

      const el = stageMenuAnchorRef.current;
      if (!el) {
        if (attempts < 24) {
          attempts += 1;
          rafId = requestAnimationFrame(place);
        }
        return;
      }
      const r = el.getBoundingClientRect();
      const margin = 8;
      const estH = 320;
      let top = r.bottom + margin;
      if (top + estH > window.innerHeight - margin) {
        top = Math.max(margin, r.top - estH - margin);
      }
      setStageMenuPos({ top, left: r.left + r.width / 2, anchor: 'center' });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [workflowStageMenu]);

  const projectById = useMemo(() => {
    const m = new Map();
    for (const x of items) {
      if (x?._id) m.set(String(x._id), x);
    }
    return m;
  }, [items]);

  /** 목록에는 최상위만; 서브는 상위 카드 워크플로 안에서만 표시 */
  const rootItems = useMemo(() => items.filter((x) => !idKey(x.parentProjectId)), [items]);

  const childProjectsOf = (parentId) =>
    items.filter((c) => sameProjectId(c.parentProjectId, parentId));

  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      const sid = String(id);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  };

  const mergeProject = useCallback((p) => {
    if (!p?._id) return;
    setItems((prev) => {
      const i = prev.findIndex((x) => String(x._id) === String(p._id));
      if (i === -1) return [p, ...prev];
      const next = [...prev];
      next[i] = p;
      return next;
    });
  }, []);

  const setCurrentStage = async (projectId, stageId) => {
    try {
      const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentStageId: stageId })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data._id) mergeProject(data);
      else window.alert(data.error || '단계 변경에 실패했습니다.');
    } catch (e) {
      window.alert(e.message || '단계 변경에 실패했습니다.');
    }
  };

  const submitComment = async (projectId, e, stageIdOpt) => {
    e.preventDefault();
    const sid = stageIdOpt && String(stageIdOpt).trim() ? String(stageIdOpt) : '';
    const key = commentDraftKey(projectId, sid);
    const text = String(commentDraft[key] || '').trim();
    if (!text) return;
    try {
      const payload = { body: text };
      if (sid) payload.stageId = sid;
      const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/comments`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data._id) {
        mergeProject(data);
        setCommentDraft((d) => ({ ...d, [key]: '' }));
      } else window.alert(data.error || '댓글 등록에 실패했습니다.');
    } catch (err) {
      window.alert(err.message || '댓글 등록에 실패했습니다.');
    }
  };

  const submitReply = async (projectId, commentId, e) => {
    e.preventDefault();
    const key = `${projectId}:${commentId}`;
    const text = String(replyDraft[key] || '').trim();
    if (!text) return;
    try {
      const res = await fetch(
        `${API_BASE}/projects/${encodeURIComponent(projectId)}/comments/${encodeURIComponent(commentId)}/replies`,
        {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ body: text })
        }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data._id) {
        mergeProject(data);
        setReplyDraft((d) => ({ ...d, [key]: '' }));
      } else window.alert(data.error || '답글 등록에 실패했습니다.');
    } catch (err) {
      window.alert(err.message || '답글 등록에 실패했습니다.');
    }
  };

  const onDelete = (p) => {
    if (!window.confirm(`「${p.title}」프로젝트를 삭제할까요?`)) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(p._id)}`, {
          method: 'DELETE',
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '삭제에 실패했습니다.');
        setItems((prev) => prev.filter((x) => String(x._id) !== String(p._id)));
        setExpanded((ex) => {
          const next = new Set(ex);
          next.delete(String(p._id));
          return next;
        });
      } catch (e) {
        window.alert(e.message || '삭제에 실패했습니다.');
      }
    })();
  };

  const openCreate = () => {
    setWorkflowStageMenu(null);
    setEditingProject(null);
    setFormParentProject(null);
    setFormParentStage(null);
    setFormOpen(true);
  };

  const openCreateSub = (p) => {
    setWorkflowStageMenu(null);
    setEditingProject(null);
    setFormParentProject(p);
    setFormParentStage(null);
    setFormOpen(true);
  };

  const openCreateSubFromStage = (parent, stage) => {
    setWorkflowStageMenu(null);
    setEditingProject(null);
    setFormParentProject(parent);
    setFormParentStage({ id: idKey(stage.id), label: stage.label });
    setFormOpen(true);
  };

  const openEdit = (p) => {
    setWorkflowStageMenu(null);
    setEditingProject(p);
    setFormParentProject(null);
    setFormParentStage(null);
    setFormOpen(true);
  };

  /** 좌·우클릭: 현재 진행 단계는 바꾸지 않고 메뉴만 엽니다. 단계 변경은 메뉴의 「해당 단계로 설정」에서만 합니다. */
  const toggleWorkflowStageMenu = (p, s, opts = {}) => {
    const subtreeOnly = !!opts.subtreeOnly;
    const pid = String(p._id);
    const sid = idKey(s.id);
    const clientX = opts.clientX;
    const clientY = opts.clientY;
    setWorkflowStageMenu((prev) => {
      if (
        prev &&
        prev.projectId === pid &&
        prev.stageId === sid &&
        !!prev.subtreeOnly === subtreeOnly
      ) {
        return null;
      }
      return {
        projectId: pid,
        stageId: sid,
        subtreeOnly,
        clientX: subtreeOnly ? clientX : undefined,
        clientY: subtreeOnly ? clientY : undefined
      };
    });
  };

  const onWorkflowStageContextMenu = (e, p, s) => {
    e.preventDefault();
    toggleWorkflowStageMenu(p, s);
  };

  return (
    <div className="page project-page">
      <header className="page-header project-page-toolbar">
        <div className="project-page-toolbar-spacer" aria-hidden />
        <div className="header-actions project-page-toolbar-actions">
          <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" />
        </div>
      </header>

      <div className="page-content project-page-content project-page-content--p2">
        <div className="project-page-top">
          <div>
            <h2 className="project-page-title">프로젝트</h2>
            <p className="page-desc project-page-desc">
              회사 단위로 프로젝트를 등록하고 단계·참여자·코멘트를 관리합니다.
            </p>
          </div>
          <div className="project-page-actions">
            {canCreate ? (
              <button type="button" className="btn-primary" onClick={openCreate}>
                <span className="material-symbols-outlined">add</span>
                새 프로젝트
              </button>
            ) : null}
          </div>
        </div>

        {loading ? (
          <p className="project-page-empty">불러오는 중…</p>
        ) : rootItems.length === 0 ? (
          <p className="project-page-empty">등록된 프로젝트가 없습니다. 「새 프로젝트」로 추가해 보세요.</p>
        ) : (
          <ul className="project-accordion-list">
            {rootItems.map((p) => {
              const isOpen = expanded.has(String(p._id));
              const parentPid = p.parentProjectId ? String(p.parentProjectId) : '';
              const parentTitle = parentPid ? projectById.get(parentPid)?.title : null;
              const stages = Array.isArray(p.stages) ? p.stages : [];
              const subs = childProjectsOf(p._id);
              const subsOrdered = [...subs].sort((a, b) => {
                const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
                const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
                return tb - ta;
              });
              const curK = idKey(p.currentStageId);
              const participants = mergeSelfIntoParticipants(
                Array.isArray(p.participants) ? p.participants : []
              );
              const comments = Array.isArray(p.comments) ? p.comments : [];
              const lastStage = stages[stages.length - 1];
              const done = lastStage && curK === idKey(lastStage.id);
              const canEditP = canEditProject(me, p);
              const canDeleteP = canDeleteProject(me, p);
              return (
                <li
                  key={p._id}
                  className={`project-accordion-item${parentPid ? ' project-accordion-item--sub' : ''}${isOpen ? ' project-accordion-item--open' : ''}`}
                >
                  <div
                    className="project-accordion-trigger"
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleExpand(p._id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleExpand(p._id);
                      }
                    }}
                  >
                    <div className="project-accordion-trigger-main">
                      <div className="project-accordion-icon" aria-hidden>
                        <span className="material-symbols-outlined">layers</span>
                      </div>
                      <div>
                        <h2 className="project-accordion-title">{p.title || '—'}</h2>
                        <p className="project-accordion-meta">
                          {[
                            parentTitle ? `상위 · ${parentTitle}` : null,
                            p.clientLabel ? String(p.clientLabel).trim() : null,
                            `목표 완료 ${formatDue(p.dueDate)}`
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                    </div>
                    <div className="project-accordion-trigger-right">
                      <div className="project-accordion-avatars" aria-hidden>
                        {participants.slice(0, 4).map((a, i) => {
                          const av = resolveParticipantAvatar(a.userId);
                          return (
                            <CommentAuthorAvatar
                              key={`${p._id}-p-${i}`}
                              name={a.name}
                              avatar={av.avatar}
                              avatarPublicId={av.avatarPublicId}
                              className="project-accordion-av"
                              size={30}
                            />
                          );
                        })}
                        {participants.length > 4 ? (
                          <span className="project-accordion-av project-accordion-av--more">
                            +{participants.length - 4}
                          </span>
                        ) : null}
                      </div>
                      <span
                        className={`project-status-pill${done ? ' project-status-pill--done' : ''}`}
                      >
                        {done ? '완료 단계' : '진행 중'}
                      </span>
                      <div className="project-accordion-actions" onClick={(e) => e.stopPropagation()}>
                        {canCreate ? (
                          <button
                            type="button"
                            className="icon-btn small"
                            aria-label="서브 프로젝트 추가"
                            title="서브 프로젝트 추가"
                            onClick={() => openCreateSub(p)}
                          >
                            <span className="material-symbols-outlined">account_tree</span>
                          </button>
                        ) : null}
                        {canEditP ? (
                          <button
                            type="button"
                            className="icon-btn small"
                            aria-label="수정"
                            onClick={() => openEdit(p)}
                          >
                            <span className="material-symbols-outlined">edit</span>
                          </button>
                        ) : null}
                        {canDeleteP ? (
                          <button
                            type="button"
                            className="icon-btn small project-icon-danger"
                            aria-label="삭제"
                            onClick={() => onDelete(p)}
                          >
                            <span className="material-symbols-outlined">delete</span>
                          </button>
                        ) : null}
                      </div>
                      <span
                        className={`material-symbols-outlined project-chevron${isOpen ? ' project-chevron--open' : ''}`}
                        aria-hidden
                      >
                        expand_more
                      </span>
                    </div>
                  </div>

                  {isOpen ? (
                    <div className="project-accordion-panel project-accordion-panel--p2">
                      <div className="project-p2-facade">
                        <div className="project-p2-facade-main">
                          <div className="project-p2-facade-header">
                            <div className="project-p2-facade-bc" aria-label="위치">
                              <span>Workspace</span>
                              <span className="material-symbols-outlined project-p2-facade-bc-sep" aria-hidden>
                                chevron_right
                              </span>
                              <span>Projects</span>
                              <span className="material-symbols-outlined project-p2-facade-bc-sep" aria-hidden>
                                chevron_right
                              </span>
                              <span className="project-p2-facade-bc-current">{p.title || '—'}</span>
                            </div>
                            <div className="project-p2-facade-hero-row">
                              <div>
                                <h1 className="project-p2-facade-h1">{p.title || '—'}</h1>
                                <p className="project-p2-facade-lead">
                                  {p.description
                                    ? p.description
                                    : p.clientLabel
                                      ? String(p.clientLabel).trim()
                                      : '엔터프라이즈 급 인프라 확장을 위한 데이터 아키텍처 재설계 및 클라우드 네이티브 환경 구축 프로젝트입니다.'}
                                </p>
                              </div>
                              <div className="project-p2-facade-hero-btns">
                                {canCreate ? (
                                  <button
                                    type="button"
                                    className="project-p2-facade-btn-primary"
                                    onClick={() => openCreateSub(p)}
                                  >
                                    하위 프로젝트 추가
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          {/* Sample Design/Project2.html — Workflow Timeline: section.mb-12 > 카드 한 블록만 (단계별 서브 스트립 없음) */}
                          <section className="project-p2-facade-wf-section">
                            <Project2LinearTimeline
                              currentUser={me}
                              project={p}
                              stages={stages}
                              done={done}
                              dueLabel={dueCountdownLabel(p.dueDate)}
                              idKeyFn={idKey}
                              toggleWorkflowStageMenu={toggleWorkflowStageMenu}
                              onWorkflowStageContextMenu={onWorkflowStageContextMenu}
                              workflowStageMenu={workflowStageMenu}
                              stageMenuAnchorRef={stageMenuAnchorRef}
                            />
                          </section>

                          <section
                            className="project-panel-section project-comments-section"
                            id={`project-p2-comments-${p._id}`}
                          >
                            <h3 className="project-panel-h">코멘트 · 답글</h3>
                            {(() => {
                              const scope = '';
                              const scoped = filterCommentsByScope(comments, scope);
                              const draftKey = commentDraftKey(p._id, scope);
                              return (
                                <>
                                  <ul className="project-comment-list">
                                    {scoped.map((c) => (
                                      <ProjectCommentBlock
                                        key={String(c._id)}
                                        c={c}
                                        projectId={p._id}
                                        formatDt={formatDt}
                                        replyDraft={replyDraft}
                                        setReplyDraft={setReplyDraft}
                                        submitReply={submitReply}
                                      />
                                    ))}
                                  </ul>
                                  <form
                                    className="project-new-comment"
                                    onSubmit={(e) => submitComment(p._id, e, scope)}
                                  >
                                    <input
                                      type="text"
                                      placeholder="프로젝트 전체 코멘트…"
                                      value={commentDraft[draftKey] || ''}
                                      onChange={(e) =>
                                        setCommentDraft((d) => ({
                                          ...d,
                                          [draftKey]: e.target.value
                                        }))
                                      }
                                    />
                                    <button type="submit" className="btn-primary">
                                      등록
                                    </button>
                                  </form>
                                </>
                              );
                            })()}
                          </section>

                          <section className="project-p2-facade-tree-section">
                            <div className="project-p2-facade-tree-head">
                              <h2 className="project-p2-facade-tree-h2">구조적 하위 프로젝트</h2>
                              <div className="project-p2-facade-tree-head-meta">
                                <span>정렬: 최신순</span>
                                <span className="material-symbols-outlined project-p2-facade-tree-filter" aria-hidden>
                                  filter_list
                                </span>
                              </div>
                            </div>
                            <div className="project-p2-facade-tree-box">
                              {subsOrdered.length > 0
                                ? subsOrdered.map((sub, l1Idx) => (
                                    <ProjectSubtreeNode
                                      key={String(sub._id)}
                                      currentUser={me}
                                      sub={sub}
                                      allItems={items}
                                      depth={0}
                                      idKeyFn={idKey}
                                      openEdit={openEdit}
                                      onDelete={onDelete}
                                      formatDue={formatDue}
                                      resolveParticipantAvatar={resolveParticipantAvatar}
                                      subTreeExpandedId={subTreeExpandedId}
                                      toggleSubTreeExpand={toggleSubTreeExpand}
                                      commentDraft={commentDraft}
                                      setCommentDraft={setCommentDraft}
                                      replyDraft={replyDraft}
                                      setReplyDraft={setReplyDraft}
                                      submitComment={submitComment}
                                      submitReply={submitReply}
                                      openCreateSub={openCreateSub}
                                      workflowStageMenu={workflowStageMenu}
                                      toggleWorkflowStageMenu={toggleWorkflowStageMenu}
                                      l1Index={l1Idx}
                                    />
                                  ))
                                : null}
                              {canCreate ? (
                                <button
                                  type="button"
                                  className="project-p2-facade-tree-add"
                                  onClick={() => openCreateSub(p)}
                                >
                                  <span className="material-symbols-outlined project-p2-facade-tree-add-ico" aria-hidden>
                                    add_circle
                                  </span>
                                  <span className="project-p2-facade-tree-add-title">새 하위 프로젝트 생성</span>
                                  <span className="project-p2-facade-tree-add-sub">
                                    무제한 단계의 계층 구조를 생성할 수 있습니다.
                                  </span>
                                </button>
                              ) : null}
                            </div>
                          </section>

                      <section className="project-panel-section">
                        <h3 className="project-panel-h">참여자</h3>
                        <div className="project-participant-grid">
                          {participants.length === 0 ? (
                            <span className="project-muted">등록된 참여자가 없습니다. 수정에서 추가하세요.</span>
                          ) : (
                            participants.map((a, i) => {
                              const av = resolveParticipantAvatar(a.userId);
                              return (
                                <div key={`${p._id}-part-${i}`} className="project-participant-card">
                                  <CommentAuthorAvatar
                                    name={a.name}
                                    avatar={av.avatar}
                                    avatarPublicId={av.avatarPublicId}
                                    className="project-participant-av"
                                    size={32}
                                  />
                                  <span className="project-participant-name">{a.name || '—'}</span>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </section>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {workflowStageMenu && stageMenuPos && stageMenuView
        ? createPortal(
            <div
              className="project-stage-dropdown project-stage-dropdown--portal"
              data-project-stage-dropdown
              role="menu"
              style={{
                position: 'fixed',
                top: stageMenuPos.top,
                left: stageMenuPos.left,
                transform: stageMenuPos.anchor === 'cursor' ? 'none' : 'translateX(-50%)',
                zIndex: 200
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {canEditProject(me, stageMenuView.parent) ? (
                <button
                  type="button"
                  className="project-stage-dropdown-item"
                  role="menuitem"
                  onClick={() => {
                    setCurrentStage(stageMenuView.parent._id, idKey(stageMenuView.stage.id));
                    setWorkflowStageMenu(null);
                  }}
                >
                  <span className="material-symbols-outlined">flag_circle</span>
                  해당 단계로 설정
                </button>
              ) : null}
              {canEditProject(me, stageMenuView.parent) ? (
                <button
                  type="button"
                  className="project-stage-dropdown-item"
                  role="menuitem"
                  onClick={() => openEdit(stageMenuView.parent)}
                >
                  <span className="material-symbols-outlined">edit</span>
                  프로젝트 수정
                </button>
              ) : null}
              {!workflowStageMenu.subtreeOnly && canCreate ? (
                <button
                  type="button"
                  className="project-stage-dropdown-item project-stage-dropdown-item--secondary"
                  role="menuitem"
                  onClick={() => openCreateSubFromStage(stageMenuView.parent, stageMenuView.stage)}
                >
                  <span className="material-symbols-outlined">add_circle</span>
                  서브 프로젝트 만들기
                </button>
              ) : null}
              {!workflowStageMenu.subtreeOnly && stageMenuView.subs.length > 0 ? (
                <div className="project-stage-dropdown-subs">
                  <span className="project-stage-dropdown-subs-label">이 단계의 서브</span>
                  <ul className="project-stage-dropdown-sublist">
                    {stageMenuView.subs.map((sub) => (
                      <li key={String(sub._id)} className="project-stage-dropdown-subrow">
                        <span className="project-stage-dropdown-sublead" aria-hidden>
                          <span className="project-stage-node-inner project-stage-node-inner--tiny">
                            <SubProjectStageIcon project={sub} />
                          </span>
                        </span>
                        <span className="project-stage-dropdown-subtitle">{sub.title || '—'}</span>
                        <span className="project-stage-dropdown-subactions">
                          {canEditProject(me, sub) ? (
                            <button
                              type="button"
                              className="icon-btn small"
                              aria-label="수정"
                              onClick={() => openEdit(sub)}
                            >
                              <span className="material-symbols-outlined">edit</span>
                            </button>
                          ) : null}
                          {canDeleteProject(me, sub) ? (
                            <button
                              type="button"
                              className="icon-btn small project-icon-danger"
                              aria-label="삭제"
                              onClick={() => onDelete(sub)}
                            >
                              <span className="material-symbols-outlined">delete</span>
                            </button>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>,
            document.body
          )
        : null}

      {formOpen ? (
        <ProjectFormModal
          open={formOpen}
          project={editingProject}
          allProjects={items}
          defaultParentProject={formParentProject}
          defaultParentStageId={formParentStage?.id || null}
          onClose={() => {
            setFormOpen(false);
            setEditingProject(null);
            setFormParentProject(null);
            setFormParentStage(null);
          }}
          onSaved={(saved) => {
            mergeProject(saved);
            fetchList();
          }}
          onRemoteUpdate={(doc) => {
            mergeProject(doc);
            setEditingProject((prev) =>
              prev && String(prev._id) === String(doc._id) ? doc : prev
            );
          }}
        />
      ) : null}
    </div>
  );
}
