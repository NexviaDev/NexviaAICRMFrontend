import './lead-capture-leads-modal.css';

export default function LeadCaptureLeadsModal({
  open,
  onClose,
  channelLeads,
  selectedLeadIds,
  onLeadCheckboxChange,
  onSelectAllLeads,
  onPreviewImage,
  onSaveContacts,
  savingContacts
}) {
  if (!open) return null;
  const hasSelection = selectedLeadIds.length > 0;

  return (
    <div
      className="lead-capture-leads-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lead-capture-leads-modal-title"
      onClick={onClose}
    >
      <div className="lead-capture-leads-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="lead-capture-leads-modal-header">
          <h2 id="lead-capture-leads-modal-title" className="lead-capture-leads-modal-title">
            수신된 리드 전체
          </h2>
          <div className="lead-capture-leads-modal-header-actions">
            {hasSelection && (
              <button
                type="button"
                className="lead-capture-leads-modal-save-btn"
                onClick={onSaveContacts}
                disabled={savingContacts}
                aria-label="선택한 리드를 연락처로 저장"
                title="연락처 저장"
              >
                <span className="material-symbols-outlined">person_add</span>
                <span className="lead-capture-leads-modal-save-label">연락처 저장</span>
              </button>
            )}
            <button
              type="button"
              className="lead-capture-form-modal-close"
              onClick={onClose}
              aria-label="닫기"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
        <div className="lead-capture-leads-modal-body">
          {channelLeads.length === 0 ? (
            <p className="lead-capture-empty-cell">수신된 리드가 없습니다.</p>
          ) : (
            <table className="lead-capture-table lead-capture-leads-table">
              <thead>
                <tr>
                  <th className="lead-capture-th-checkbox">
                    <input
                      type="checkbox"
                      checked={
                        channelLeads.length > 0 &&
                        selectedLeadIds.length === channelLeads.length &&
                        channelLeads.every((l) => selectedLeadIds.includes(String(l._id)))
                      }
                      onChange={(e) => onSelectAllLeads(e.target.checked)}
                      aria-label="전체 선택"
                    />
                  </th>
                  <th>회사명</th>
                  <th>이름</th>
                  <th>연락처</th>
                  <th>이메일</th>
                  <th>명함</th>
                </tr>
              </thead>
              <tbody>
                {channelLeads.map((lead, idx) => {
                  const cf = lead.customFields || {};
                  const businessCard = cf.business_card;
                  const isImageUrl =
                    typeof businessCard === 'string' &&
                    (businessCard.startsWith('data:image') || businessCard.startsWith('http'));
                  const isSelected = selectedLeadIds.includes(String(lead._id));
                  return (
                    <tr key={lead._id}>
                      <td className="lead-capture-td-checkbox">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onLeadCheckboxChange(lead._id, idx, false)}
                          onClick={(e) => {
                            if (e.shiftKey) {
                              e.preventDefault();
                              onLeadCheckboxChange(lead._id, idx, true);
                            }
                          }}
                          aria-label={`${lead.name || '리드'} 선택`}
                        />
                      </td>
                      <td>{cf.company || '—'}</td>
                      <td className="lead-capture-cell-name">{lead.name}</td>
                      <td>{cf.phone || '—'}</td>
                      <td>{lead.email}</td>
                      <td>
                        {businessCard ? (
                          isImageUrl ? (
                            <button
                              type="button"
                              className="lead-capture-view-image-btn"
                              onClick={() => onPreviewImage(businessCard)}
                              aria-label="보기"
                            >
                              <span className="material-symbols-outlined">visibility</span>
                            </button>
                          ) : (
                            <span className="lead-capture-cell-custom">첨부됨</span>
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
