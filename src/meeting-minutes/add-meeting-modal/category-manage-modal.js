export default function CategoryManageModal({
  show,
  categoryInput,
  setCategoryInput,
  handleAddCategory,
  categoryOptions,
  defaultMeetingCategories,
  handleRemoveCategory,
  onClose
}) {
  if (!show) return null;

  return (
    <div className="add-meeting-category-modal-overlay">
      <div className="add-meeting-category-modal" onClick={(e) => e.stopPropagation()}>
        <div className="add-meeting-category-modal-head">
          <h3>카테고리 관리</h3>
          <button type="button" className="add-meeting-remove-btn" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="add-meeting-category-modal-body">
          <div className="add-meeting-category-add-row">
            <input
              type="text"
              value={categoryInput}
              onChange={(e) => setCategoryInput(e.target.value)}
              placeholder="새 카테고리 입력"
              className="add-meeting-input"
            />
            <button
              type="button"
              className="add-meeting-category-add-btn"
              onClick={handleAddCategory}
            >
              등록
            </button>
          </div>

          <div className="add-meeting-category-list">
            {categoryOptions.map((c) => (
              <label key={c} className="add-meeting-category-list-item">
                <span className="add-meeting-category-list-name">{c}</span>
                {defaultMeetingCategories.includes(c) ? (
                  <span className="add-meeting-category-default-badge">기본</span>
                ) : (
                  <button type="button" className="add-meeting-remove-btn" onClick={() => handleRemoveCategory(c)} aria-label={`${c} 삭제`}>
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                )}
              </label>
            ))}
          </div>
        </div>
        <div className="add-meeting-category-modal-foot">
          <button type="button" className="add-meeting-modal-btn-cancel" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
