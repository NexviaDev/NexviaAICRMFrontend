import './add-company-modal.css';

/**
 * 여러 증빙(이미지·PDF·TXT) 업로드 시 Gemini 분석 결과 — 등록 예정 표시 전용 모달
 */
export default function CompanyImportPreviewModal({
  open,
  items,
  bulkSaving,
  onClose,
  onConfirm
}) {
  if (!open) return null;

  return (
    <div
      className="add-company-import-preview-overlay"
      onClick={() => !bulkSaving && onClose?.()}
      role="dialog"
      aria-modal="true"
      aria-label="고객사 등록 예정"
    >
      <div className="add-company-import-preview-panel" onClick={(e) => e.stopPropagation()}>
        <h3 className="add-company-section-title">고객사 등록 예정</h3>
        <p className="add-company-upload-hint">
          여러 이미지·PDF·메모장(TXT)을 올리면 아래 표와 같이 <strong>등록될 예정</strong>입니다. 내용을 확인한 뒤 「확인 후 등록」을 누르면 실제로 저장됩니다.
          (서버에 Geocoding 키가 있으면 위·경도가 채워질 수 있습니다.)
        </p>
        <div className="add-company-import-preview-table-wrap">
          <table className="add-company-import-preview-table">
            <thead>
              <tr>
                <th>출처</th>
                <th>고객사명</th>
                <th>사업자번호</th>
                <th>대표</th>
                <th>주소</th>
                <th>위도</th>
                <th>경도</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {(items || []).map((row, idx) => (
                <tr key={idx}>
                  <td>{row.sourceLabel || '-'}</td>
                  <td>{row.name || '-'}</td>
                  <td>{row.businessNumber || '-'}</td>
                  <td>{row.representativeName || '-'}</td>
                  <td>{row.address || '-'}</td>
                  <td>{row.latitude != null ? String(row.latitude).slice(0, 12) : '-'}</td>
                  <td>{row.longitude != null ? String(row.longitude).slice(0, 12) : '-'}</td>
                  <td className={row.error ? 'add-company-import-preview-err' : ''}>{row.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="add-company-import-preview-actions">
          <button type="button" className="add-company-btn-cancel" disabled={bulkSaving} onClick={() => onClose?.()}>
            취소
          </button>
          <button
            type="button"
            className="btn-primary add-company-btn-save"
            disabled={bulkSaving}
            onClick={() => onConfirm?.()}
          >
            <span className="material-symbols-outlined">save</span>
            {bulkSaving ? '등록 중...' : '확인 후 등록'}
          </button>
        </div>
      </div>
    </div>
  );
}
