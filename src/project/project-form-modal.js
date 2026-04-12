import { useState, useEffect, useCallback, Fragment, useMemo, useRef } from 'react';
import ParticipantModal from '@/shared/participant-modal/participant-modal';
import { CommentAuthorAvatar } from '@/shared/comment-author-avatar';
import { buildParticipantDirectoryFromOverview } from '@/lib/participant-directory-merge';
import { getStoredCrmUser } from '@/lib/crm-role-utils';
import { canEditProject, canCreateProject } from '@/lib/project-permissions';
import { API_BASE } from '@/config';
import './project-form-modal.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function defaultStages() {
  return [
    { id: newId(), label: '시작', kind: 'start' },
    { id: newId(), label: '완료', kind: 'end' }
  ];
}

function idKeyModal(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'object' && v !== null && v._id != null) return String(v._id);
  return String(v).trim();
}

function parseCrmUser() {
  try {
    const raw = localStorage.getItem('crm_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 로그인 사용자 — 참여자 행 { userId, name } */
function selfParticipantEntry() {
  const u = parseCrmUser();
  if (!u || u._id == null || u._id === '') return null;
  const name = String(u.name || u.fullName || u.email || '나').trim() || '나';
  return { userId: u._id, name };
}

function mergeSelfIntoParticipants(list) {
  const self = selfParticipantEntry();
  if (!self) return Array.isArray(list) ? [...list] : [];
  const arr = Array.isArray(list) ? [...list] : [];
  if (arr.some((p) => String(p.userId) === String(self.userId))) return arr;
  return [self, ...arr];
}

function formatDtModal(iso) {
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

/** 수정 시 자기 자신·하위 프로젝트는 상위 후보에서 제외 */
function collectDescendantIds(allProjects, rootId) {
  const rs = String(rootId);
  const childrenMap = new Map();
  for (const p of allProjects) {
    const par = p.parentProjectId ? String(p.parentProjectId) : '';
    if (!childrenMap.has(par)) childrenMap.set(par, []);
    childrenMap.get(par).push(p);
  }
  const out = new Set();
  const stack = [...(childrenMap.get(rs) || [])];
  while (stack.length) {
    const n = stack.pop();
    out.add(String(n._id));
    for (const c of childrenMap.get(String(n._id)) || []) stack.push(c);
  }
  return out;
}

export default function ProjectFormModal({
  open,
  project,
  onClose,
  onSaved,
  onRemoteUpdate,
  allProjects = [],
  defaultParentProject = null,
  defaultParentStageId = null
}) {
  const isEdit = Boolean(project?._id);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [clientLabel, setClientLabel] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [parentProjectId, setParentProjectId] = useState('');
  const [parentStageId, setParentStageId] = useState('');
  const [stages, setStages] = useState(defaultStages);
  const [participants, setParticipants] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [participantOpen, setParticipantOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /** 수정 모드 코멘트: '' = 전체, 아니면 stage id */
  const [editCommentScope, setEditCommentScope] = useState('');
  const [editCommentDraft, setEditCommentDraft] = useState('');
  const [commentPosting, setCommentPosting] = useState(false);
  /** 워크플로 단계 목록이 채워진 뒤 defaultParentStageId 한 번 더 맞춤 (검증 effect가 먼저 지우는 경우 방지) */
  const stageDefaultSyncedRef = useRef(false);

  const fetchTeamMembers = useCallback(() => {
    const headers = getAuthHeader();
    Promise.all([
      fetch(`${API_BASE}/calendar-events/team-members`, { headers }).then((r) => r.json().catch(() => ({}))),
      fetch(`${API_BASE}/companies/overview`, { headers }).then((r) => r.json().catch(() => ({})))
    ])
      .then(([teamData, overviewData]) => {
        const fromTeam = Array.isArray(teamData?.members) ? teamData.members : [];
        const merged = buildParticipantDirectoryFromOverview(
          fromTeam,
          overviewData && typeof overviewData === 'object' ? overviewData : null
        );
        setTeamMembers(merged);
      })
      .catch(() => {});
  }, []);

  const parentOptionsExcluded = useMemo(() => {
    if (!isEdit || !project?._id) return new Set();
    const ex = new Set([String(project._id)]);
    for (const id of collectDescendantIds(allProjects, project._id)) ex.add(id);
    return ex;
  }, [isEdit, project, allProjects]);

  const parentSelectOptions = useMemo(() => {
    return allProjects
      .filter((p) => p?._id && !parentOptionsExcluded.has(String(p._id)))
      .map((p) => ({ id: String(p._id), title: (p.title || '').trim() || '—' }))
      .sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  }, [allProjects, parentOptionsExcluded]);

  /** 상위 프로젝트 문서: 목록에 없으면 defaultParentProject(워크플로에서 열 때)로 단계 표시 */
  const parentDocForWorkflow = useMemo(() => {
    if (!parentProjectId) return null;
    const fromList = allProjects.find((x) => String(x._id) === String(parentProjectId));
    if (fromList) return fromList;
    if (defaultParentProject && String(defaultParentProject._id) === String(parentProjectId)) {
      return defaultParentProject;
    }
    return null;
  }, [allProjects, parentProjectId, defaultParentProject]);

  /** 선택한 상위 프로젝트의 워크플로 전 단계 (시작·중간·완료) */
  const parentWorkflowStages = useMemo(() => {
    if (!parentProjectId) return [];
    const st = Array.isArray(parentDocForWorkflow?.stages) ? parentDocForWorkflow.stages : [];
    const kindLabel = (k) => (k === 'start' ? '시작' : k === 'end' ? '완료' : '중간');
    return st.map((s, i, arr) => {
      const kind = s.kind || (i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle');
      return {
        id: String(s.id),
        label: `[${kindLabel(kind)}] ${(s.label || '').trim() || '단계'}`
      };
    });
  }, [parentDocForWorkflow, parentProjectId]);

  useEffect(() => {
    if (!open) return;
    stageDefaultSyncedRef.current = false;
    fetchTeamMembers();
    if (project && project._id) {
      setTitle(project.title || '');
      setDescription(project.description || '');
      setClientLabel(project.clientLabel || '');
      setParentProjectId(project.parentProjectId ? String(project.parentProjectId) : '');
      setParentStageId(project.parentStageId ? String(project.parentStageId) : '');
      if (project.dueDate) {
        const d = new Date(project.dueDate);
        setDueDate(
          Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        );
      } else setDueDate('');
      setStages(
        Array.isArray(project.stages) && project.stages.length >= 2
          ? project.stages.map((s, i, arr) => ({
              id: s.id,
              label: s.label || '',
              kind: i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'
            }))
          : defaultStages()
      );
      setParticipants(
        mergeSelfIntoParticipants(
          (project.participants || []).map((p) => ({
            userId: p.userId,
            name: p.name || ''
          }))
        )
      );
    } else {
      setTitle('');
      setDescription('');
      setClientLabel('');
      setDueDate('');
      setParentProjectId(defaultParentProject?._id ? String(defaultParentProject._id) : '');
      setParentStageId(defaultParentStageId ? String(defaultParentStageId) : '');
      setStages(defaultStages());
      setParticipants(mergeSelfIntoParticipants([]));
    }
    setError('');
    setEditCommentScope('');
    setEditCommentDraft('');
  }, [open, project, fetchTeamMembers, defaultParentProject, defaultParentStageId]);

  /** 신규 + 워크플로에서 들어온 경우: 단계 목록이 준비된 뒤 상위 단계 id를 확실히 맞춤 */
  useEffect(() => {
    if (!open || isEdit || stageDefaultSyncedRef.current) return;
    if (!defaultParentStageId || !defaultParentProject?._id) return;
    if (String(parentProjectId) !== String(defaultParentProject._id)) return;
    if (parentWorkflowStages.length === 0) return;
    const sid = String(defaultParentStageId);
    if (!parentWorkflowStages.some((s) => s.id === sid)) return;
    setParentStageId(sid);
    stageDefaultSyncedRef.current = true;
  }, [open, isEdit, defaultParentStageId, defaultParentProject, parentProjectId, parentWorkflowStages]);

  useEffect(() => {
    if (!parentProjectId) {
      setParentStageId('');
      return;
    }
    /* 목록이 아직 비어 있으면(동기화 직후) 유효성 검사 생략 — 잘못 지우지 않음 */
    if (parentWorkflowStages.length === 0) return;
    if (!parentStageId) return;
    const ok = parentWorkflowStages.some((s) => s.id === parentStageId);
    if (!ok) setParentStageId('');
  }, [parentProjectId, parentWorkflowStages, parentStageId]);

  const addMiddleStage = () => {
    setStages((prev) => {
      if (prev.length < 2) return prev;
      const mid = {
        id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: '중간 단계',
        kind: 'middle'
      };
      const next = [...prev];
      next.splice(next.length - 1, 0, mid);
      return next;
    });
  };

  const removeStageAt = (idx) => {
    setStages((prev) => {
      if (prev.length <= 2 || idx === 0 || idx === prev.length - 1) return prev;
      return prev.filter((_, i) => i !== idx);
    });
  };

  const updateStageLabel = (idx, label) => {
    setStages((prev) => prev.map((s, i) => (i === idx ? { ...s, label } : s)));
  };

  const removeParticipant = (userId) => {
    const self = selfParticipantEntry();
    if (self && String(userId) === String(self.userId)) return;
    setParticipants((prev) => prev.filter((p) => String(p.userId) !== String(userId)));
  };

  const me = useMemo(() => getStoredCrmUser(), []);
  const canMutateProject = useMemo(() => {
    if (!isEdit) return canCreateProject(me);
    if (!project?._id) return false;
    return canEditProject(me, project);
  }, [isEdit, project, me]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canMutateProject) {
      setError(isEdit ? '수정 권한이 없습니다.' : '등록 권한이 없습니다.');
      return;
    }
    const t = title.trim();
    if (!t) {
      setError('제목을 입력해 주세요.');
      return;
    }
    const body = {
      title: t,
      description: description.trim(),
      clientLabel: clientLabel.trim(),
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      parentProjectId: parentProjectId ? parentProjectId : null,
      parentStageId: parentProjectId && parentStageId ? parentStageId : null,
      stages: stages.map((s, i, arr) => ({
        id: s.id,
        label: (s.label || '').trim() || (i === 0 ? '시작' : i === arr.length - 1 ? '완료' : '단계'),
        kind: i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'
      })),
      participants: mergeSelfIntoParticipants(participants).map((p) => ({
        userId: p.userId,
        name: p.name || ''
      }))
    };
    setSaving(true);
    setError('');
    try {
      const url = isEdit ? `${API_BASE}/projects/${project._id}` : `${API_BASE}/projects`;
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
      onSaved?.(data);
      onClose?.();
    } catch (err) {
      setError(err.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const currentUser = parseCrmUser();

  const teamByUserId = useMemo(() => {
    const m = new Map();
    for (const mem of teamMembers) {
      if (mem?._id != null) m.set(String(mem._id), mem);
    }
    return m;
  }, [teamMembers]);

  const participantAvatarProps = useCallback(
    (p) => {
      const self = parseCrmUser();
      if (self && String(p.userId) === String(self._id)) {
        return {
          avatar: self.avatar != null && String(self.avatar).trim() ? String(self.avatar).trim() : '',
          avatarPublicId:
            self.avatarPublicId != null && String(self.avatarPublicId).trim()
              ? String(self.avatarPublicId).trim()
              : ''
        };
      }
      const mem = teamByUserId.get(String(p.userId));
      return {
        avatar: mem?.avatar != null && String(mem.avatar).trim() ? String(mem.avatar).trim() : '',
        avatarPublicId:
          mem?.avatarPublicId != null && String(mem.avatarPublicId).trim()
            ? String(mem.avatarPublicId).trim()
            : ''
      };
    },
    [teamByUserId]
  );

  const editCommentsFiltered = useMemo(() => {
    if (!isEdit || !project?._id) return [];
    const list = Array.isArray(project.comments) ? project.comments : [];
    if (!editCommentScope) return list.filter((c) => !c.stageId);
    return list.filter((c) => c.stageId && idKeyModal(c.stageId) === editCommentScope);
  }, [isEdit, project, editCommentScope]);

  const postEditComment = async (e) => {
    e.preventDefault();
    if (!isEdit || !project?._id) return;
    const text = editCommentDraft.trim();
    if (!text) return;
    setCommentPosting(true);
    try {
      const payload = { body: text };
      if (editCommentScope) payload.stageId = editCommentScope;
      const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(project._id)}/comments`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data._id) {
        setEditCommentDraft('');
        onRemoteUpdate?.(data);
      } else window.alert(data.error || '코멘트 등록에 실패했습니다.');
    } catch (err) {
      window.alert(err.message || '코멘트 등록에 실패했습니다.');
    } finally {
      setCommentPosting(false);
    }
  };

  if (!open) return null;

  const isSubCreate = !isEdit && Boolean(defaultParentProject?._id);
  const modalTitle = isEdit
    ? '프로젝트 수정'
    : isSubCreate
      ? defaultParentStageId
        ? '워크플로 단계 서브 프로젝트'
        : '서브 프로젝트 등록'
      : '새 프로젝트 등록';
  const submitLabel = saving ? '저장 중…' : isEdit ? '저장' : '등록하기';

  return (
    <div className="project-form-overlay" role="dialog" aria-modal="true" aria-labelledby="project-form-title">
      <div className="project-form-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="project-form-head">
          <h2 id="project-form-title">{modalTitle}</h2>
          <button type="button" className="project-form-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <form className="project-form-body" onSubmit={handleSubmit} noValidate>
          {error ? <p className="project-form-error">{error}</p> : null}
          {isEdit && project?._id && !canEditProject(me, project) ? (
            <p className="project-form-perm-hint" role="status">
              이 프로젝트를 수정할 권한이 없습니다. 아래 내용은 열람만 가능합니다. (코멘트 등록은 가능할 수 있습니다.)
            </p>
          ) : null}
          {!isEdit && !canCreateProject(me) ? (
            <p className="project-form-perm-hint" role="status">
              프로젝트를 새로 등록할 권한이 없습니다.
            </p>
          ) : null}

          <fieldset className="project-form-main-fieldset" disabled={!canMutateProject}>
          <div className="project-form-fields-grid">
            <label className="project-form-label project-form-label--full">
              상위 프로젝트 (선택)
              <select
                className="project-form-input project-form-select"
                value={parentProjectId}
                onChange={(e) => setParentProjectId(e.target.value)}
                aria-label="상위 프로젝트"
              >
                <option value="">최상위 프로젝트 (상위 없음)</option>
                {parentSelectOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.title}
                  </option>
                ))}
              </select>
              {isEdit ? (
                <span className="project-form-parent-hint">
                  자기 자신·이 프로젝트의 하위 프로젝트는 상위로 지정할 수 없습니다.
                </span>
              ) : isSubCreate && defaultParentProject?.title ? (
                <span className="project-form-parent-hint">
                  「{defaultParentProject.title}」의 하위로 등록합니다. 필요 시 위에서 상위를 바꿀 수 있습니다.
                </span>
              ) : (
                <span className="project-form-parent-hint">
                  상위를 지정하면 서브 프로젝트로 묶입니다. 비우면 최상위로 등록됩니다.
                </span>
              )}
            </label>

            {parentWorkflowStages.length > 0 ? (
              <div className="project-form-label project-form-label--full">
                상위 워크플로 단계 (선택)
                <div
                  className="project-form-parent-stage-pick"
                  role="radiogroup"
                  aria-label="상위 워크플로 단계"
                >
                  {parentWorkflowStages.map((s) => {
                    const sid = String(s.id);
                    const on = parentStageId === sid;
                    return (
                      <button
                        key={sid}
                        type="button"
                        className={`project-form-parent-stage-chip${on ? ' project-form-parent-stage-chip--on' : ''}`}
                        role="radio"
                        aria-checked={on}
                        title={s.label}
                        onClick={() => setParentStageId(sid)}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
                <span className="project-form-parent-hint">
                  시작·중간·완료 중 한 단계에 연결할 수 있습니다. 연결하면 상위 카드 워크플로 메뉴에서 해당 단계로 묶입니다.
                </span>
              </div>
            ) : null}

            <label className="project-form-label project-form-label--full">
              프로젝트 제목
              <input
                className="project-form-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={200}
                placeholder="예: 2024 상반기 디자인 리뉴얼"
              />
            </label>

            <label className="project-form-label">
              고객사 / 클라이언트 (선택)
              <input
                className="project-form-input"
                value={clientLabel}
                onChange={(e) => setClientLabel(e.target.value)}
                maxLength={120}
                placeholder="예: 넥스비아"
              />
            </label>

            <label className="project-form-label">
              목표 완료일 (선택)
              <div className="project-form-date-wrap">
                <input type="date" className="project-form-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </label>

            <label className="project-form-label project-form-label--full">
              프로젝트 설명
              <textarea
                className="project-form-input project-form-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="프로젝트의 주요 목표와 핵심 내용을 입력하세요."
              />
            </label>
          </div>

          <div className="project-form-stages-panel">
            <div className="project-form-stages-head">
              <h3 className="project-form-stages-title">진행 단계 설정</h3>
              <button type="button" className="project-form-link-btn" onClick={addMiddleStage}>
                <span className="material-symbols-outlined">add</span>
                단계 추가
              </button>
            </div>
            <p className="project-form-hint">첫 단계는 시작, 마지막 단계는 완료를 의미합니다. 가운데는 자유롭게 추가·삭제할 수 있습니다.</p>
            <div className="project-form-stage-pipeline" role="list">
              {stages.map((s, idx) => (
                <Fragment key={s.id}>
                  {idx > 0 ? (
                    <span className="project-form-stage-arrow material-symbols-outlined" aria-hidden>
                      arrow_forward
                    </span>
                  ) : null}
                  <div
                    role="listitem"
                    className={[
                      'project-form-stage-node',
                      idx === 0 ? 'project-form-stage-node--start' : '',
                      idx === stages.length - 1 ? 'project-form-stage-node--end' : '',
                      idx > 0 && idx < stages.length - 1 ? 'project-form-stage-node--middle' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <input
                      className="project-form-stage-node-input"
                      value={s.label}
                      onChange={(e) => updateStageLabel(idx, e.target.value)}
                      placeholder={idx === 0 ? '예: 착수' : idx === stages.length - 1 ? '예: 납품' : '단계 이름'}
                      aria-label={idx === 0 ? '시작 단계 이름' : idx === stages.length - 1 ? '완료 단계 이름' : '중간 단계 이름'}
                    />
                    {idx > 0 && idx < stages.length - 1 ? (
                      <button
                        type="button"
                        className="project-form-stage-node-remove"
                        onClick={() => removeStageAt(idx)}
                        aria-label="단계 삭제"
                      >
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    ) : null}
                  </div>
                </Fragment>
              ))}
            </div>
          </div>

          <div className="project-form-participants-block">
            <span className="project-form-participants-label">참여자 추가</span>
            <div className="project-form-participants-row">
              <button
                type="button"
                className="project-form-add-person"
                onClick={() => setParticipantOpen(true)}
                aria-label="참여자 선택"
                title="사내 직원에서 선택"
              >
                <span className="material-symbols-outlined">add</span>
              </button>
              {participants.length === 0 ? (
                <span className="project-form-empty">참여자가 없습니다. + 를 눌러 추가하세요.</span>
              ) : (
                participants.map((p) => {
                  const isSelf =
                    currentUser && String(p.userId) === String(currentUser._id);
                  const av = participantAvatarProps(p);
                  return (
                    <div
                      key={String(p.userId)}
                      className={`project-form-person-pill${isSelf ? ' project-form-person-pill--self' : ''}`}
                    >
                      <CommentAuthorAvatar
                        name={p.name}
                        avatar={av.avatar}
                        avatarPublicId={av.avatarPublicId}
                        className="project-form-person-avatar"
                        size={64}
                      />
                      <span className="project-form-person-name">
                        {p.name || '—'}
                        {isSelf ? <span className="project-form-person-self-tag">본인</span> : null}
                      </span>
                      <button
                        type="button"
                        className="project-form-person-remove"
                        disabled={Boolean(isSelf)}
                        onClick={() => removeParticipant(p.userId)}
                        aria-label={isSelf ? '본인은 참여자에서 제외할 수 없습니다' : `${p.name || '참여자'} 제거`}
                        title={isSelf ? '본인은 참여자에서 제외할 수 없습니다' : undefined}
                      >
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          </fieldset>

          <footer className="project-form-footer">
            <button type="button" className="project-form-footer-cancel" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="project-form-footer-submit" disabled={saving || !canMutateProject}>
              {submitLabel}
            </button>
          </footer>
        </form>

        {isEdit && project?._id ? (
          <div className="project-form-edit-comments">
            <h3 className="project-form-edit-comments-h">코멘트</h3>
            <p className="project-form-edit-comments-desc">
              프로젝트 전체 공통 코멘트와 단계별 코멘트를 구분해 남길 수 있습니다. (저장 버튼과 별도로 즉시 등록됩니다.)
            </p>
            <div className="project-form-edit-comments-scope" role="tablist">
              <button
                type="button"
                role="tab"
                className={`project-form-edit-scope-chip${!editCommentScope ? ' project-form-edit-scope-chip--on' : ''}`}
                onClick={() => setEditCommentScope('')}
              >
                전체
              </button>
              {stages.map((s) => {
                const sid = String(s.id);
                const on = editCommentScope === sid;
                return (
                  <button
                    key={sid}
                    type="button"
                    role="tab"
                    className={`project-form-edit-scope-chip${on ? ' project-form-edit-scope-chip--on' : ''}`}
                    onClick={() => setEditCommentScope(sid)}
                  >
                    {s.label || '단계'}
                  </button>
                );
              })}
            </div>
            <ul className="project-form-edit-comment-list">
              {editCommentsFiltered.map((c) => (
                <li key={String(c._id)} className="project-form-edit-comment-item">
                  <CommentAuthorAvatar
                    name={c.authorName}
                    avatar={c.authorAvatar}
                    avatarPublicId={c.authorAvatarPublicId}
                    className="project-form-edit-comment-av"
                    size={56}
                  />
                  <div>
                    <div className="project-form-edit-comment-meta">
                      <strong>{c.authorName || '—'}</strong>
                      <time dateTime={c.createdAt}>{formatDtModal(c.createdAt)}</time>
                    </div>
                    <p className="project-form-edit-comment-body">{c.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <form className="project-form-edit-comment-form" onSubmit={postEditComment}>
              <input
                type="text"
                className="project-form-input"
                placeholder={
                  editCommentScope
                    ? `「${stages.find((x) => String(x.id) === editCommentScope)?.label || '단계'}」 코멘트…`
                    : '프로젝트 전체 코멘트…'
                }
                value={editCommentDraft}
                onChange={(e) => setEditCommentDraft(e.target.value)}
                disabled={commentPosting}
              />
              <button type="submit" className="btn-primary" disabled={commentPosting}>
                {commentPosting ? '등록 중…' : '코멘트 등록'}
              </button>
            </form>
          </div>
        ) : null}
      </div>
      {participantOpen ? (
        <ParticipantModal
          teamMembers={teamMembers}
          selected={participants}
          currentUser={currentUser}
          title="프로젝트 참여자 선택"
          onClose={() => setParticipantOpen(false)}
          onConfirm={(sel) => {
            setParticipants(
              mergeSelfIntoParticipants(
                sel.map((s) => {
                  const m = teamMembers.find((t) => String(t._id) === String(s.userId));
                  return { userId: s.userId, name: s.name || (m && m.name) || '' };
                })
              )
            );
            setParticipantOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
