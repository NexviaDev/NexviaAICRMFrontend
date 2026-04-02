import '../../customer-companies/add-company-modal/add-company-modal.css';

/**
 * 명함 이미지·TXT 여러 개 업로드 시 Gemini 분석 결과 — 등록 예정 표시 전용 모달
 */
export default function ContactImportPreviewModal({
  open,
  items,
  bulkSaving,
  fixedCompany,
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
      aria-label="연락처 등록 예정"
    >
      <div className="add-company-import-preview-panel" onClick={(e) => e.stopPropagation()}>
        <h3 className="add-company-section-title">연락처 등록 예정</h3>
        <p className="add-company-upload-hint">
          여러 명함 이미지·메모장(TXT)을 올리면 아래 표와 같이 <strong>등록될 예정</strong>입니다. 내용을 확인한 뒤 「확인 후 등록」을 누르면 실제로 저장됩니다.
          {fixedCompany ? ' 현재 고객사 맥락이 고정되어 있으면 모두 해당 고객사에 연결됩니다.' : ''}
        </p>
        <div className="add-company-import-preview-table-wrap">
          <table className="add-company-import-preview-table">
            <thead>
              <tr>
                <th>출처</th>
                <th>이름</th>
                <th>이메일</th>
                <th>전화</th>
                <th>직책</th>
                <th>고객사</th>
                <th>주소</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {(items || []).map((row, idx) => (
                <tr key={idx}>
                  <td>{row.sourceLabel || '—'}</td>
                  <td>{row.name || '—'}</td>
                  <td>{row.email || '—'}</td>
                  <td>{row.phone || '—'}</td>
                  <td>{row.position || '—'}</td>
                  <td>{row.companyName || '—'}</td>
                  <td>{row.address || '—'}</td>
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
          <button type="button" className="add-company-btn-save" disabled={bulkSaving} onClick={() => onConfirm?.()}>
            {bulkSaving ? '등록 중…' : '확인 후 등록'}
          </button>
        </div>
      </div>
    </div>
  );
}
