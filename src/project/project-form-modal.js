import { useEffect, useMemo, useState } from 'react';
import { API_BASE, MAX_DRIVE_JSON_UPLOAD_BYTES } from '@/config';
import ParticipantModal from '@/shared/participant-modal/participant-modal';
import './project-form-modal.css';

const STAGE_OPTIONS = [
  { value: 'todo', label: '해야 할 일' },
  { value: 'progress', label: '진행 중' },
  { value: 'review', label: '검토' },
  { value: 'done', label: '완료' }
];

const PRIORITY_OPTIONS = [
  { value: '낮음', label: '낮음' },
  { value: '보통', label: '보통' },
  { value: '높음', label: '높음' }
];

function normalizeMember(row) {
  const userId = String(row?._id || row?.id || row?.userId || '').trim();
  if (!userId) return null;
  return {
    userId,
    name: String(row?.name || row?.displayName || row?.email || '구성원').trim(),
    avatar: String(row?.avatar || '').trim()
  };
}

function toDateInputValue(input) {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function initialsFromName(name = '') {
  const text = String(name).trim();
  if (!text) return '?';
  return text.slice(-2);
}

function formatCommentDate(input) {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function tempId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function sanitizeFolderNamePart(input) {
  return String(input || '')
    .replace(/[/\\*?:<>"|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildStampedFolderName(title, stamp) {
  const safeTitle = sanitizeFolderNamePart(title) || '프로젝트';
  return `${safeTitle}_[${stamp}]`;
}

function formatFolderStamp(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('_') + '-' + [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0')
  ].join('_');
}

function fileToBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

export default function ProjectFormModal({
  mode = 'create',
  companyContext = null,
  teamMembers = [],
  currentUser = null,
  stageOptions,
  initialProject = null,
  saving = false,
  onSubmit,
  onClose
}) {
  const teamOptions = useMemo(
    () => (Array.isArray(teamMembers) ? teamMembers.map(normalizeMember).filter(Boolean) : []),
    [teamMembers]
  );

  const boardStages = useMemo(() => {
    if (Array.isArray(stageOptions) && stageOptions.length) return stageOptions;
    return STAGE_OPTIONS;
  }, [stageOptions]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [stage, setStage] = useState('todo');
  const [tag, setTag] = useState('');
  const [priority, setPriority] = useState('보통');
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedNamesById, setSelectedNamesById] = useState({});
  const [selectedAvatarsById, setSelectedAvatarsById] = useState({});
  const [missionsByUserId, setMissionsByUserId] = useState({});
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [replyDraftByCommentId, setReplyDraftByCommentId] = useState({});
  const [showParticipantPicker, setShowParticipantPicker] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [driveFolderId, setDriveFolderId] = useState('');
  const [driveFolderLink, setDriveFolderLink] = useState('');
  const [folderStamp, setFolderStamp] = useState('');
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveError, setDriveError] = useState('');
  const [driveUploadNotice, setDriveUploadNotice] = useState('');

  useEffect(() => {
    const initialParticipants = Array.isArray(initialProject?.participants) ? initialProject.participants : [];
    const initialMissions = Array.isArray(initialProject?.participantMissions) ? initialProject.participantMissions : [];
    const nextMissions = {};
    for (const row of initialParticipants) {
      const userId = String(row?.userId || '').trim();
      if (!userId) continue;
      const mission = String(row?.mission || '').trim();
      if (mission) nextMissions[userId] = mission;
    }
    for (const row of initialMissions) {
      const userId = String(row?.userId || '').trim();
      if (!userId) continue;
      if (!nextMissions[userId]) nextMissions[userId] = String(row?.mission || '');
    }

    setTitle(String(initialProject?.title || initialProject?.name || ''));
    setDescription(String(initialProject?.description || ''));
    setStartDate(toDateInputValue(initialProject?.startDateIso || ''));
    setDueDate(toDateInputValue(initialProject?.dueDateIso || ''));
    setStage(String(initialProject?.stage || boardStages[0]?.value || 'todo'));
    setTag(String(initialProject?.tag || ''));
    setPriority(String(initialProject?.priority || '보통'));
    setSelectedIds(initialParticipants.map((p) => String(p?.userId || '')).filter(Boolean));
    setSelectedNamesById(
      initialParticipants.reduce((acc, row) => {
        const userId = String(row?.userId || '').trim();
        if (!userId) return acc;
        acc[userId] = String(row?.name || '').trim() || '구성원';
        return acc;
      }, {})
    );
    setSelectedAvatarsById({});
    setMissionsByUserId(nextMissions);
    setComments(Array.isArray(initialProject?.comments) ? initialProject.comments : []);
    setAttachments(Array.isArray(initialProject?.attachmentsList) ? initialProject.attachmentsList : []);
    setPendingFiles([]);
    setDriveFolderId(String(initialProject?.driveFolderId || ''));
    setDriveFolderLink(String(initialProject?.driveFolderLink || ''));
    setFolderStamp('');
    setDriveError('');
    setDriveUploadNotice('');
    setNewComment('');
    setReplyDraftByCommentId({});
  }, [initialProject, boardStages]);

  useEffect(() => {
    if (boardStages.some((row) => row.value === stage)) return;
    setStage(boardStages[0]?.value || 'todo');
  }, [boardStages, stage]);

  const selectedParticipants = useMemo(() => {
    const byId = new Map(teamOptions.map((member) => [member.userId, member]));
    return selectedIds.map((userId) => (
      byId.get(userId) || { userId, name: selectedNamesById[userId] || '구성원', avatar: selectedAvatarsById[userId] || '' }
    ));
  }, [selectedIds, selectedNamesById, selectedAvatarsById, teamOptions]);

  const selectedForModal = useMemo(
    () => selectedParticipants.map((row) => ({ userId: row.userId, name: row.name })),
    [selectedParticipants]
  );

  const companyFolderName = useMemo(() => {
    const companyName = sanitizeFolderNamePart(companyContext?.name || '');
    const businessNumber = sanitizeFolderNamePart(String(companyContext?.businessNumber || '').replace(/\D/g, ''));
    if (!companyName && !businessNumber) return '';
    return `${companyName || '미등록'}_${businessNumber || '미등록'}`;
  }, [companyContext]);

  useEffect(() => {
    if (mode !== 'edit') return;
    if (!title.trim() || driveFolderId || !String(companyContext?.driveRootUrl || '').trim()) return;
    let cancelled = false;
    (async () => {
      try {
        const folder = await ensureAttachmentFolder();
        if (cancelled) return;
        setDriveFolderId(folder.id);
        setDriveFolderLink(folder.webViewLink);
      } catch (err) {
        if (!cancelled) setDriveError(err.message || 'Drive 폴더를 준비할 수 없습니다.');
      }
    })();
    return () => { cancelled = true; };
  }, [mode, title, driveFolderId, companyContext?.driveRootUrl]);

  const handleConfirmParticipants = (picked) => {
    const normalized = Array.isArray(picked) ? picked : [];
    const nextIds = normalized
      .map((row) => String(row?.userId || '').trim())
      .filter(Boolean);
    setSelectedIds(nextIds);
    setSelectedNamesById(
      normalized.reduce((acc, row) => {
        const userId = String(row?.userId || '').trim();
        if (!userId) return acc;
        acc[userId] = String(row?.name || '').trim() || '구성원';
        return acc;
      }, {})
    );
    setSelectedAvatarsById(
      normalized.reduce((acc, row) => {
        const userId = String(row?.userId || '').trim();
        if (!userId) return acc;
        const matched = teamOptions.find((member) => member.userId === userId);
        acc[userId] = String(row?.avatar || matched?.avatar || '').trim();
        return acc;
      }, {})
    );
    setMissionsByUserId((prev) => {
      const next = {};
      for (const userId of nextIds) next[userId] = prev[userId] || '';
      return next;
    });
    setShowParticipantPicker(false);
  };

  const removeParticipant = (userId) => {
    const id = String(userId);
    setSelectedIds((prev) => prev.filter((row) => row !== id));
    setSelectedNamesById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSelectedAvatarsById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setMissionsByUserId((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const addComment = () => {
    const message = String(newComment || '').trim();
    if (!message) return;
    setComments((prev) => [
      ...prev,
      {
        _id: tempId('comment'),
        userId: currentUser?._id || '',
        name: currentUser?.name || '사용자',
        avatar: currentUser?.avatar || '',
        message,
        createdAt: new Date().toISOString(),
        replies: []
      }
    ]);
    setNewComment('');
  };

  const removeComment = (commentId) => {
    const id = String(commentId);
    setComments((prev) => prev.filter((row) => String(row?._id) !== id));
    setReplyDraftByCommentId((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const addReply = (commentId) => {
    const id = String(commentId);
    const message = String(replyDraftByCommentId[id] || '').trim();
    if (!message) return;
    setComments((prev) => prev.map((row) => (
      String(row?._id) !== id
        ? row
        : {
          ...row,
          replies: [
            ...(Array.isArray(row?.replies) ? row.replies : []),
            {
              _id: tempId('reply'),
              userId: currentUser?._id || '',
              name: currentUser?.name || '사용자',
              avatar: currentUser?.avatar || '',
              message,
              createdAt: new Date().toISOString()
            }
          ]
        }
    )));
    setReplyDraftByCommentId((prev) => ({ ...prev, [id]: '' }));
  };

  const removeReply = (commentId, replyId) => {
    const cid = String(commentId);
    const rid = String(replyId);
    setComments((prev) => prev.map((row) => (
      String(row?._id) !== cid
        ? row
        : {
          ...row,
          replies: (Array.isArray(row?.replies) ? row.replies : []).filter((reply) => String(reply?._id) !== rid)
        }
    )));
  };

  const ensureAttachmentFolder = async () => {
    if (!String(companyContext?.driveRootUrl || '').trim()) {
      throw new Error('회사 공유 Drive 주소가 없습니다. 회사 개요에서 먼저 등록해 주세요.');
    }
    if (driveFolderId && driveFolderLink) {
      return { id: driveFolderId, webViewLink: driveFolderLink };
    }

    const companyRootRes = await fetch(`${API_BASE}/drive/folders/ensure`, {
      method: 'POST',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ folderName: companyFolderName || '미등록_미등록' })
    });
    const companyRootData = await companyRootRes.json().catch(() => ({}));
    if (!companyRootRes.ok || !companyRootData?.id) {
      throw new Error(companyRootData?.error || '회사 Drive 폴더를 준비할 수 없습니다.');
    }

    const projectRootRes = await fetch(`${API_BASE}/drive/folders/ensure`, {
      method: 'POST',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ folderName: 'Project', parentFolderId: companyRootData.id })
    });
    const projectRootData = await projectRootRes.json().catch(() => ({}));
    if (!projectRootRes.ok || !projectRootData?.id) {
      throw new Error(projectRootData?.error || 'Project 폴더를 준비할 수 없습니다.');
    }

    const nextStamp = folderStamp || formatFolderStamp(new Date());
    const leafName = buildStampedFolderName(title, nextStamp);
    const taskFolderRes = await fetch(`${API_BASE}/drive/folders/ensure`, {
      method: 'POST',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ folderName: leafName, parentFolderId: projectRootData.id })
    });
    const taskFolderData = await taskFolderRes.json().catch(() => ({}));
    if (!taskFolderRes.ok || !taskFolderData?.id) {
      throw new Error(taskFolderData?.error || '프로젝트 첨부 폴더를 준비할 수 없습니다.');
    }

    const link = taskFolderData.webViewLink || `https://drive.google.com/drive/folders/${taskFolderData.id}`;
    setFolderStamp(nextStamp);
    setDriveFolderId(taskFolderData.id);
    setDriveFolderLink(link);
    return { id: taskFolderData.id, webViewLink: link };
  };

  const syncAttachmentsFromDrive = async () => {
    if (!driveFolderId) return;
    setDriveBusy(true);
    setDriveError('');
    try {
      const res = await fetch(`${API_BASE}/drive/files?folderId=${encodeURIComponent(driveFolderId)}&pageSize=100`, {
        headers: getAuthHeader(),
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Drive 파일 목록을 불러오지 못했습니다.');
      setAttachments(
        (Array.isArray(data?.files) ? data.files : [])
          .filter((item) => item?.mimeType !== 'application/vnd.google-apps.folder')
          .map((item) => ({
            fileId: item.id,
            name: item.name || '파일',
            webViewLink: item.webViewLink || `https://drive.google.com/file/d/${item.id}/view`,
            mimeType: item.mimeType || '',
            size: 0,
            createdAt: item.modifiedTime || new Date().toISOString()
          }))
      );
    } catch (err) {
      setDriveError(err.message || 'Drive 파일 목록을 불러오지 못했습니다.');
    } finally {
      setDriveBusy(false);
    }
  };

  const removeAttachment = (attachmentIdOrLink) => {
    const key = String(attachmentIdOrLink || '');
    setAttachments((prev) => prev.filter((item) => String(item.fileId || item.webViewLink || item._id) !== key));
  };

  const removePendingFile = (index) => {
    setPendingFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const handlePickFiles = (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length) {
      setPendingFiles((prev) => [...prev, ...files]);
      setDriveError('');
    }
    event.target.value = '';
  };

  const uploadPendingFiles = async () => {
    if (!pendingFiles.length) {
      return { attachmentsToSave: attachments, folderId: driveFolderId, folderLink: driveFolderLink };
    }
    setDriveUploadNotice('');
    const folder = await ensureAttachmentFolder();
    const tooLargeFiles = pendingFiles.filter((file) => Number(file?.size || 0) > MAX_DRIVE_JSON_UPLOAD_BYTES);
    const apiFiles = pendingFiles.filter((file) => Number(file?.size || 0) <= MAX_DRIVE_JSON_UPLOAD_BYTES);

    if (tooLargeFiles.length) {
      const folderUrlForLarge = String(folder.webViewLink || '').trim();
      const names = tooLargeFiles.slice(0, 3).map((file) => file.name).join(', ');
      const more = tooLargeFiles.length > 3 ? ` 외 ${tooLargeFiles.length - 3}건` : '';
      const canOpenFolder =
        folderUrlForLarge &&
        folderUrlForLarge.startsWith('https://drive.google.com/') &&
        !folderUrlForLarge.includes('undefined');
      if (canOpenFolder) {
        window.open(folderUrlForLarge, '_blank', 'noopener,noreferrer');
      }
      setDriveError(
        canOpenFolder
          ? `약 ${Math.floor(MAX_DRIVE_JSON_UPLOAD_BYTES / (1024 * 1024))}MB를 넘는 파일은 이 창에서 한 번에 올릴 수 없습니다. 해당 Google Drive 폴더를 새 창으로 열었으니, 거기에서 직접 업로드해 주세요: ${names}${more}`
          : `약 ${Math.floor(MAX_DRIVE_JSON_UPLOAD_BYTES / (1024 * 1024))}MB를 넘는 파일은 이 창에서 한 번에 올릴 수 없습니다. 폴더 주소를 확인한 뒤 Drive에서 직접 올려 주세요: ${names}${more}`
      );
      if (canOpenFolder && !apiFiles.length) {
        setDriveUploadNotice('업로드 후 「목록 새로고침」으로 CRM 목록에 반영할 수 있습니다.');
        window.setTimeout(() => setDriveUploadNotice(''), 8000);
      }
    }

    const uploadedAttachments = [];
    for (const file of apiFiles) {
      const contentBase64 = await fileToBase64(file);
      if (!contentBase64) throw new Error(`"${file.name}" 파일을 읽지 못했습니다.`);
      const res = await fetch(`${API_BASE}/drive/upload`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          contentBase64,
          parentFolderId: folder.id
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `"${file.name}" 업로드에 실패했습니다.`);
      uploadedAttachments.push({
        fileId: data.id || '',
        name: data.name || file.name,
        webViewLink: data.webViewLink || '',
        mimeType: data.mimeType || file.type || '',
        size: Number(file.size) || 0,
        createdAt: new Date().toISOString()
      });
    }

    const attachmentsToSave = [...attachments, ...uploadedAttachments];
    setAttachments(attachmentsToSave);
    setPendingFiles([]);
    return { attachmentsToSave, folderId: folder.id, folderLink: folder.webViewLink, hasLargeFiles: tooLargeFiles.length > 0 };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const safeTitle = String(title || '').trim();
    if (!safeTitle) {
      window.alert('프로젝트 제목을 입력해 주세요.');
      return;
    }

    const participants = selectedParticipants.map((row) => ({
      userId: row.userId,
      name: row.name,
      mission: String(missionsByUserId[row.userId] || '').trim()
    }));

    const participantMissions = selectedParticipants.map((row) => ({
      userId: row.userId,
      name: row.name,
      mission: String(missionsByUserId[row.userId] || '').trim()
    }));

    setDriveBusy(true);
    setDriveError('');
    try {
      const uploadResult = await uploadPendingFiles();
      await onSubmit?.({
        name: safeTitle,
        title: safeTitle,
        description: String(description || '').trim(),
        startDate: startDate || '',
        dueDate: dueDate || '',
        stage,
        tag: String(tag || '').trim(),
        priority,
        participants,
        participantMissions,
        comments,
        driveFolderId: uploadResult.folderId || driveFolderId || '',
        driveFolderLink: uploadResult.folderLink || driveFolderLink || '',
        attachments: uploadResult.attachmentsToSave || attachments
      });
    } catch (err) {
      setDriveError(err.message || '첨부 처리 중 오류가 발생했습니다.');
    } finally {
      setDriveBusy(false);
    }
  };

  return (
    <div className="pfm-overlay" role="dialog" aria-modal="true" aria-labelledby="pfm-title">
      <div className="pfm-panel">
        <div className="pfm-head">
          <div>
            <h2 id="pfm-title" className="pfm-title">
              {mode === 'edit' ? '프로젝트 수정' : '새 프로젝트 등록'}
            </h2>
            <p className="pfm-lead">
              {mode === 'edit'
                ? '선택한 프로젝트 정보를 수정합니다.'
                : '제목·일정·참여자와 임무를 입력해 새 프로젝트를 등록합니다.'}
            </p>
          </div>
          <button type="button" className="pfm-close" onClick={onClose} disabled={saving || driveBusy} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form className="pfm-form" onSubmit={handleSubmit}>
          <div className="pfm-body">
            <div className="pfm-field">
              <label className="pfm-label-caps" htmlFor="pfm-title-input">프로젝트 제목</label>
              <input
                id="pfm-title-input"
                className="pfm-input-surface"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder="예: 2024 상반기 디자인 리뉴얼"
              />
            </div>

            <div className="pfm-field">
              <label className="pfm-label-caps" htmlFor="pfm-description">프로젝트 설명</label>
              <textarea
                id="pfm-description"
                className="pfm-input-surface"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="프로젝트의 주요 목표와 핵심 내용을 입력하세요."
                maxLength={2000}
              />
            </div>

            <section className="pfm-block">
              <label className="pfm-label-caps">참여자</label>
              <div className="pfm-participant-row">
                <button
                  type="button"
                  className="pfm-participant-add"
                  onClick={() => setShowParticipantPicker(true)}
                  aria-label="참여자 추가"
                  disabled={saving || driveBusy}
                >
                  <span className="material-symbols-outlined">add</span>
                </button>
                <div className="pfm-participant-pills">
                  {selectedParticipants.map((member) => (
                    <div key={member.userId} className="pfm-participant-pill">
                      {member.avatar ? (
                        <img src={member.avatar} alt="" className="pfm-participant-avatar pfm-participant-avatar-img" />
                      ) : (
                        <span className="pfm-participant-avatar" aria-hidden>{initialsFromName(member.name)}</span>
                      )}
                      <span className="pfm-participant-name">{member.name}</span>
                      <button
                        type="button"
                        className="pfm-participant-remove"
                        onClick={() => removeParticipant(member.userId)}
                        aria-label={`${member.name} 제거`}
                        disabled={saving || driveBusy}
                      >
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              {selectedParticipants.length === 0 ? (
                <p className="pfm-empty">원형 버튼을 눌러 참여자를 선택하세요.</p>
              ) : null}
            </section>

            <section className="pfm-section">
              <h3 className="pfm-section-title">참여자별 임무 부여</h3>
              <div className="pfm-mission-list">
                {selectedParticipants.length === 0 ? (
                  <p className="pfm-empty">참여자를 먼저 추가하면 임무를 입력할 수 있습니다.</p>
                ) : selectedParticipants.map((member) => (
                  <div key={member.userId} className="pfm-mission-row">
                    <p>{member.name}</p>
                    <input
                      className="pfm-input-surface pfm-input-surface--compact"
                      type="text"
                      value={missionsByUserId[member.userId] || ''}
                      onChange={(e) => setMissionsByUserId((prev) => ({ ...prev, [member.userId]: e.target.value }))}
                      placeholder="예: API 명세 확정, 테스트 케이스 작성"
                      maxLength={500}
                    />
                  </div>
                ))}
              </div>
            </section>

            <section className="pfm-section pfm-drive-section">
              <input
                id="pfm-attachment-input"
                className="pfm-drive-file-input"
                type="file"
                multiple
                onChange={handlePickFiles}
                disabled={saving || driveBusy}
                aria-hidden="true"
              />
              <div className="pfm-drive-head">
                <h3 className="pfm-drive-title">
                  <span className="material-symbols-outlined">folder</span>
                  첨부 자료
                </h3>
                <label
                  htmlFor="pfm-attachment-input"
                  className={`pfm-drive-add-btn ${(saving || driveBusy) ? 'is-disabled' : ''}`}
                  title="파일 추가"
                  aria-label="파일 추가"
                >
                  <span className="material-symbols-outlined">add</span>
                </label>
              </div>

              {driveFolderLink ? (
                <div className="pfm-drive-link-wrap">
                  <a className="pfm-drive-link" href={driveFolderLink} target="_blank" rel="noreferrer">
                    <span className="material-symbols-outlined">open_in_new</span>
                    Google Drive 폴더 열기
                  </a>
                </div>
              ) : null}

              {driveError ? <p className="pfm-drive-error">{driveError}</p> : null}
              {driveUploadNotice && !driveError ? (
                <p className="pfm-drive-notice" role="status">
                  {driveUploadNotice}
                </p>
              ) : null}

              <div className="pfm-drive-list-wrap">
                <div className="pfm-drive-list-topbar">
                  <p className="pfm-drive-list-label">업로드 예정 및 등록된 파일</p>
                  <button
                    type="button"
                    className="pfm-drive-open-action"
                    onClick={syncAttachmentsFromDrive}
                    disabled={saving || driveBusy || !driveFolderId}
                    title="Drive 새로고침"
                    aria-label="Drive 새로고침"
                  >
                    <span className="material-symbols-outlined">refresh</span>
                  </button>
                </div>

                {pendingFiles.length === 0 && attachments.length === 0 ? (
                  <div className={`pfm-drive-empty ${saving || driveBusy ? 'is-disabled' : ''}`}>
                    <span className="material-symbols-outlined pfm-drive-empty-icon">upload_file</span>
                    <span>
                      {mode === 'edit'
                        ? '비어 있습니다. 상단 + 버튼으로 파일을 추가하세요.'
                        : '저장 후 Drive 폴더가 준비되며 파일을 업로드할 수 있습니다.'}
                    </span>
                  </div>
                ) : (
                  <div className="pfm-drive-groups">
                    {pendingFiles.length ? (
                      <div className="pfm-drive-group">
                        <p className="pfm-drive-group-title">저장 시 업로드 예정</p>
                        <div className="pfm-drive-file-list">
                          {pendingFiles.map((file, index) => (
                            <div key={`${file.name}-${file.size}-${index}`} className="pfm-drive-file-row">
                              <div className="pfm-drive-file-main">
                                <span className="material-symbols-outlined pfm-drive-file-icon">upload_file</span>
                                <div className="pfm-drive-file-text">
                                  <strong>{file.name}</strong>
                                  <span>{Math.max(1, Math.round((Number(file.size) || 0) / 1024))} KB</span>
                                </div>
                              </div>
                              <button type="button" className="pfm-comment-remove-btn" onClick={() => removePendingFile(index)} disabled={saving || driveBusy}>
                                제외
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {attachments.length ? (
                      <div className="pfm-drive-group">
                        <p className="pfm-drive-group-title">등록된 첨부</p>
                        <div className="pfm-drive-file-list">
                          {attachments.map((item) => {
                            const attachmentKey = String(item.fileId || item.webViewLink || item._id);
                            return (
                              <div key={attachmentKey} className="pfm-drive-file-row">
                                <a className="pfm-drive-file-link" href={item.webViewLink} target="_blank" rel="noreferrer">
                                  <span className="material-symbols-outlined pfm-drive-file-icon">description</span>
                                  <span className="pfm-drive-file-name">{item.name}</span>
                                </a>
                                <button type="button" className="pfm-comment-remove-btn" onClick={() => removeAttachment(attachmentKey)} disabled={saving || driveBusy}>
                                  제거
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </section>

            <section className="pfm-section">
              <h3 className="pfm-section-title">코멘트</h3>
              <div className="pfm-comment-composer">
                <textarea
                  className="pfm-input-surface pfm-comment-textarea"
                  rows={3}
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="코멘트를 입력하세요."
                  maxLength={2000}
                />
                <div className="pfm-comment-composer-actions">
                  <button type="button" className="pfm-comment-add-btn" onClick={addComment} disabled={saving || driveBusy || !String(newComment || '').trim()}>
                    코멘트 추가
                  </button>
                </div>
              </div>
              <div className="pfm-comment-list">
                {comments.length === 0 ? (
                  <p className="pfm-empty">등록된 코멘트가 없습니다.</p>
                ) : comments.map((comment) => (
                  <article key={String(comment._id)} className="pfm-comment-card">
                    <div className="pfm-comment-head">
                      <div className="pfm-comment-author">
                        {comment.avatar ? (
                          <img src={comment.avatar} alt="" className="pfm-comment-avatar pfm-comment-avatar-img" />
                        ) : (
                          <span className="pfm-comment-avatar" aria-hidden>{initialsFromName(comment.name)}</span>
                        )}
                        <div>
                          <strong>{comment.name || '사용자'}</strong>
                          <span>{formatCommentDate(comment.createdAt)}</span>
                        </div>
                      </div>
                      <button type="button" className="pfm-comment-remove-btn" onClick={() => removeComment(comment._id)} disabled={saving || driveBusy}>
                        삭제
                      </button>
                    </div>
                    <p className="pfm-comment-message">{comment.message}</p>

                    <div className="pfm-reply-list">
                      {(Array.isArray(comment.replies) ? comment.replies : []).map((reply) => (
                        <div key={String(reply._id)} className="pfm-reply-card">
                          <div className="pfm-comment-author">
                            {reply.avatar ? (
                              <img src={reply.avatar} alt="" className="pfm-comment-avatar pfm-comment-avatar-img" />
                            ) : (
                              <span className="pfm-comment-avatar" aria-hidden>{initialsFromName(reply.name)}</span>
                            )}
                            <div>
                              <strong>{reply.name || '사용자'}</strong>
                              <span>{formatCommentDate(reply.createdAt)}</span>
                            </div>
                          </div>
                          <p className="pfm-comment-message">{reply.message}</p>
                          <button type="button" className="pfm-comment-remove-btn pfm-comment-remove-btn--reply" onClick={() => removeReply(comment._id, reply._id)} disabled={saving || driveBusy}>
                            답글 삭제
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="pfm-reply-composer">
                      <input
                        className="pfm-input-surface pfm-input-surface--compact"
                        type="text"
                        value={replyDraftByCommentId[String(comment._id)] || ''}
                        onChange={(e) => setReplyDraftByCommentId((prev) => ({ ...prev, [String(comment._id)]: e.target.value }))}
                        placeholder="답글을 입력하세요."
                        maxLength={2000}
                      />
                      <button type="button" className="pfm-comment-add-btn" onClick={() => addReply(comment._id)} disabled={saving || driveBusy || !String(replyDraftByCommentId[String(comment._id)] || '').trim()}>
                        답글
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="pfm-section">
              <h3 className="pfm-section-title">칸반 단계</h3>
              <p className="pfm-hint">현재 칸반 단계 중 처음에 넣을 위치를 선택합니다.</p>
              <div className="pfm-stage-strip" role="radiogroup" aria-label="칸반 단계">
                {boardStages.map((item) => (
                  <span key={item.value} className="pfm-stage-strip-seg">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={stage === item.value}
                      className={`pfm-stage-pill ${stage === item.value ? 'is-selected' : ''}`}
                      onClick={() => setStage(item.value)}
                      disabled={saving}
                    >
                      {item.label}
                    </button>
                  </span>
                ))}
              </div>
            </section>

            <section className="pfm-section">
              <h3 className="pfm-section-title">중요도</h3>
              <div className="pfm-priority-strip" role="radiogroup" aria-label="중요도">
                {PRIORITY_OPTIONS.map((item) => (
                  <span key={item.value} className="pfm-stage-strip-seg">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={priority === item.value}
                      className={`pfm-priority-pill pfm-priority-pill--${item.value === '높음' ? 'high' : item.value === '낮음' ? 'low' : 'medium'} ${priority === item.value ? 'is-selected' : ''}`}
                      onClick={() => setPriority(item.value)}
                      disabled={saving || driveBusy}
                    >
                      {item.label}
                    </button>
                  </span>
                ))}
              </div>
            </section>

            <div className="pfm-date-grid">
              <div className="pfm-field">
                <label className="pfm-label-caps" htmlFor="pfm-start-date">시작일</label>
                <input
                  id="pfm-start-date"
                  className="pfm-input-surface"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>

              <div className="pfm-field">
                <label className="pfm-label-caps" htmlFor="pfm-due-date">만료날짜</label>
                <input
                  id="pfm-due-date"
                  className="pfm-input-surface"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="pfm-footer">
            <button type="button" className="pfm-btn-cancel" onClick={onClose} disabled={saving || driveBusy}>
              취소
            </button>
            <button type="submit" className="pfm-btn-submit" disabled={saving || driveBusy}>
              {saving || driveBusy ? '저장 중…' : mode === 'edit' ? '수정 저장' : '등록하기'}
            </button>
          </div>
        </form>
      </div>

      {showParticipantPicker ? (
        <ParticipantModal
          teamMembers={teamMembers}
          selected={selectedForModal}
          currentUser={currentUser}
          title="프로젝트 참여자 선택"
          bulkAddLabel="표시된 인원 모두 프로젝트 참여자로 추가"
          onConfirm={handleConfirmParticipants}
          onClose={() => setShowParticipantPicker(false)}
        />
      ) : null}

    </div>
  );
}
