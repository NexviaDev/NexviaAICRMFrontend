import './project-title-entry-modal.css';

export default function ProjectTitleEntryModal({
  month,
  monthLabel,
  projectTitles = [],
  projectTitleDraft = '',
  participantDraftIds = [],
  canSelectParticipants = false,
  participantOptions = [],
  editable,
  loading,
  onDraftChange,
  onParticipantDraftChange,
  onAdd,
  onClose
}) {
  const selectedSet = new Set((Array.isArray(participantDraftIds) ? participantDraftIds : []).map((v) => String(v || '').trim()));
  const handleToggleParticipant = (id) => {
    const sid = String(id || '').trim();
    if (!sid) return;
    const next = selectedSet.has(sid)
      ? [...selectedSet].filter((v) => v !== sid)
      : [...selectedSet, sid];
    onParticipantDraftChange(next);
  };

  return (
    <div className="project-title-entry-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="project-title-entry-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-title-entry-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="project-title-entry-modal-header">
          <h3 id="project-title-entry-modal-title">{monthLabel} 프로젝트 제목 등록</h3>
          <button type="button" className="project-title-entry-modal-close" onClick={onClose} aria-label="모달 닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <p className="project-title-entry-modal-guide">완료일이 {month}월인 프로젝트 기준으로 제목을 추가해 주세요.</p>
        {canSelectParticipants ? (
          <div className="project-title-entry-modal-participant-box">
            <p className="project-title-entry-modal-participant-guide">같은 부서 및 하위 부서 참여자만 선택 가능합니다.</p>
            <div className="project-title-entry-modal-participant-list">
              {participantOptions.map((user) => (
                <label key={user.id} className="project-title-entry-modal-participant-item">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(user.id)}
                    onChange={() => handleToggleParticipant(user.id)}
                    disabled={!editable || loading}
                  />
                  <span>{user.label}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
        <div className="project-title-entry-modal-input-row">
          <input
            type="text"
            value={projectTitleDraft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAdd();
              }
            }}
            disabled={!editable || loading}
            placeholder="프로젝트 제목"
            aria-label={`${monthLabel} 프로젝트 제목 입력`}
          />
          <button type="button" onClick={onAdd} disabled={!editable || loading}>
            추가
          </button>
        </div>
        <div className="project-title-entry-modal-list">
          {projectTitles.length > 0 ? (
            projectTitles.map((title, idx) => (
              <span key={`${month}-project-title-${idx}`} className="project-title-entry-modal-chip">
                {title}
              </span>
            ))
          ) : (
            <p className="project-title-entry-modal-empty">등록된 프로젝트 제목이 없습니다.</p>
          )}
        </div>
      </div>
    </div>
  );
}
