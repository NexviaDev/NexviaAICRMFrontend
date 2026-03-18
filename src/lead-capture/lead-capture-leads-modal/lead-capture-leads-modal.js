import { useState, useMemo } from 'react';
import './lead-capture-leads-modal.css';

export default function LeadCaptureLeadsModal({
  open,
  onClose,
  channelLeads,
  selectedLeadIds,
  onLeadCheckboxChange,
  onSelectAllLeads,
  onPreviewImage,
  onOpenMapping
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return channelLeads;
    const q = search.trim().toLowerCase();
    return channelLeads.filter((lead) => {
      const cf = lead.customFields || {};
      return (
        (lead.name || '').toLowerCase().includes(q) ||
        (lead.email || '').toLowerCase().includes(q) ||
        (cf.company || '').toLowerCase().includes(q) ||
        (cf.phone || '').toLowerCase().includes(q)
      );
    });
  }, [channelLeads, search]);

  if (!open) return null;

  const allFilteredIds = filtered.map((l) => String(l._id));
  const allChecked =
    filtered.length > 0 &&
    allFilteredIds.every((id) => selectedLeadIds.includes(id));

  const handleSelectAllFiltered = (checked) => {
    if (checked) {
      const merged = new Set([...selectedLeadIds.map(String), ...allFilteredIds]);
      onSelectAllLeads(true, Array.from(merged));
    } else {
      const remove = new Set(allFilteredIds);
      const remaining = selectedLeadIds.filter((id) => !remove.has(String(id)));
      onSelectAllLeads(false, remaining);
    }
  };

  const handleOpenMappingFromModal = () => {
    onClose?.();
    setTimeout(() => onOpenMapping?.(), 80);
  };

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
            <span className="lead-capture-leads-modal-count">{channelLeads.length}건</span>
          </h2>
          <div className="lead-capture-leads-modal-header-actions">
            <button
              type="button"
              className="lead-capture-leads-modal-mapping-btn"
              onClick={handleOpenMappingFromModal}
              title={selectedLeadIds.length > 0 ? `선택 ${selectedLeadIds.length}건 매핑` : '전체 리드 매핑'}
            >
              <span className="material-symbols-outlined">conversion_path</span>
              데이터 매핑{selectedLeadIds.length > 0 ? ` (${selectedLeadIds.length})` : ''}
            </button>
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

        <div className="lead-capture-leads-modal-search-bar">
          <span className="material-symbols-outlined lead-capture-leads-modal-search-icon">search</span>
          <input
            type="text"
            className="lead-capture-leads-modal-search-input"
            placeholder="이름, 이메일, 회사명, 연락처 검색…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="lead-capture-leads-modal-search-clear"
              onClick={() => setSearch('')}
              aria-label="검색 초기화"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          )}
          {search.trim() && (
            <span className="lead-capture-leads-modal-search-count">
              {filtered.length}건
            </span>
          )}
        </div>

        <div className="lead-capture-leads-modal-body">
          {filtered.length === 0 ? (
            <p className="lead-capture-empty-cell">
              {search.trim() ? '검색 결과가 없습니다.' : '수신된 리드가 없습니다.'}
            </p>
          ) : (
            <table className="lead-capture-table lead-capture-leads-table">
              <thead>
                <tr>
                  <th className="lead-capture-th-checkbox">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={(e) => handleSelectAllFiltered(e.target.checked)}
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
                {filtered.map((lead) => {
                  const globalIdx = channelLeads.indexOf(lead);
                  const cf = lead.customFields || {};
                  const businessCard = cf.business_card;
                  const isImageUrl =
                    typeof businessCard === 'string' &&
                    (businessCard.startsWith('data:image') || businessCard.startsWith('http'));
                  const isSelected = selectedLeadIds.includes(String(lead._id));
                  return (
                    <tr key={lead._id} className={isSelected ? 'lead-capture-row-selected' : ''}>
                      <td className="lead-capture-td-checkbox">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onLeadCheckboxChange(lead._id, globalIdx, false)}
                          onClick={(e) => {
                            if (e.shiftKey) {
                              e.preventDefault();
                              onLeadCheckboxChange(lead._id, globalIdx, true);
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
