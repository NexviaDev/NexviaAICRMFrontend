import '../../customer-companies/add-company-modal/add-company-modal.css';

/**
 * 명함 이미지·TXT 여러 개 업로드 시 분석 결과 — 등록 예정 표시
 * (고객사 유사 검사 없이 일괄 등록은 부모 runImportRowsBulk에서 처리)
 */
export default function ContactImportPreviewModal({ open, items, bulkSaving, fixedCompany, onClose, onConfirm }) {
  if (!open) return null;

  return (
    <div
      className="add-company-import-preview-overlay"
      onClick={() => !bulkSaving && onClose?.()}
      role="dialog"
      aria-modal="true"
      aria-label="연락처 등록 예정"
    >
      <div className="add-company-import-preview-panel add-contact-import-preview-panel" onClick={(e) => e.stopPropagation()}>
        <h3 className="add-company-section-title">연락처 등록 예정</h3>
        <p className="add-company-upload-hint">
          여러 명함 이미지·메모장(TXT)을 올리면 아래 표와 같이 <strong>등록될 예정</strong>입니다. 「확인 후 등록」 시 고객사 유사 여부 없이 저장을 시도합니다(같은 배치 안 표기만 다른 상호는 하나의 고객사로 합쳐 저장됩니다).
          {fixedCompany ? ' 현재 고객사 맥락이 고정되어 있으면 모두 해당 고객사에 연결됩니다.' : ''}
        </p>
        <div className="add-company-import-preview-table-wrap">
          <table className="add-company-import-preview-table">
            <thead>
              <tr>
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
          <button
            type="button"
            className="add-company-btn-cancel add-contact-import-btn-outline"
            disabled={bulkSaving}
            onClick={() => onClose?.()}
          >
            취소
          </button>
          <button
            type="button"
            className="btn-primary add-contact-import-btn-confirm"
            disabled={bulkSaving}
            onClick={() => onConfirm?.()}
          >
            <span className="material-symbols-outlined" aria-hidden>
              {bulkSaving ? 'hourglass_empty' : 'check_circle'}
            </span>
            {bulkSaving ? '등록 중…' : '확인 후 등록'}
          </button>
        </div>
      </div>
    </div>
  );
}
