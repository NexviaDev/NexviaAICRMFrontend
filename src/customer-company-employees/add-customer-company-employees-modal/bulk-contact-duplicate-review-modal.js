import { useEffect, useMemo, useState } from 'react';
import './bulk-contact-duplicate-review-modal.css';

const FORCE = 'force';
const EXCLUDE = 'exclude';

function asText(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function rowKeyFromPreResult(preResult, fallbackIndex) {
  const n = Number(preResult?.index);
  return Number.isInteger(n) && n >= 0 ? String(n) : String(fallbackIndex);
}

function matchReasonLabel(reason) {
  if (reason === 'both') return '이름+전화';
  if (reason === 'phone') return '전화';
  if (reason === 'name') return '이름';
  return '중복';
}

function buildIssueRows(review) {
  const importRows = Array.isArray(review?.importRows) ? review.importRows : [];
  const entries = Array.isArray(review?.entries) ? review.entries : [];
  return (review?.preResults || [])
    .map((preResult, fallbackIndex) => {
      const rowIndex = Number(rowKeyFromPreResult(preResult, fallbackIndex));
      const row = importRows[rowIndex] || importRows[fallbackIndex] || {};
      const entry = entries[rowIndex] || entries[fallbackIndex] || {};
      const contactCandidates = Array.isArray(preResult?.contactCandidates) ? preResult.contactCandidates : [];
      const similarCustomerCompanies = Array.isArray(preResult?.similarCustomerCompanies)
        ? preResult.similarCustomerCompanies
        : [];
      return {
        key: rowKeyFromPreResult(preResult, fallbackIndex),
        displayNo: rowIndex + 1,
        row,
        entry,
        contactCandidates,
        similarCustomerCompanies
      };
    })
    .filter((r) => r.contactCandidates.length || r.similarCustomerCompanies.length);
}

export default function BulkContactDuplicateReviewModal({
  review,
  saving,
  onClose,
  onConfirmForce
}) {
  const source = review?.source || 'import';
  const importLike = source === 'import' || source === 'excel';
  const title = importLike ? '대량 등록 — 연락처 중복' : '대량 등록 — 중복·유사';
  const issueRows = useMemo(() => buildIssueRows(review), [review]);
  const [decisions, setDecisions] = useState({});

  useEffect(() => {
    const next = {};
    issueRows.forEach((row) => {
      next[row.key] = decisions[row.key] || EXCLUDE;
    });
    setDecisions(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueRows.map((row) => row.key).join('|')]);

  if (!review || !Array.isArray(review.preResults) || review.preResults.length === 0 || issueRows.length === 0) return null;

  const setAllDecisions = (action) => {
    const next = {};
    issueRows.forEach((row) => {
      next[row.key] = action;
    });
    setDecisions(next);
  };

  const setRowDecision = (key, action) => {
    setDecisions((prev) => ({ ...prev, [key]: action }));
  };

  const confirmSelected = () => {
    const next = {};
    issueRows.forEach((row) => {
      next[row.key] = decisions[row.key] || EXCLUDE;
    });
    onConfirmForce?.({ mode: 'perRow', decisions: next });
  };

  return (
    <div
      className="add-contact-pregate-overlay"
      onClick={() => !saving && onClose?.()}
      role="dialog"
      aria-modal="true"
      aria-label="대량 등록 중복"
    >
      <div className="add-contact-pregate-panel bulk-contact-review-panel" onClick={(e) => e.stopPropagation()}>
        <h3 className="add-contact-pregate-title">{title}</h3>
        <p className="add-contact-pregate-hint">
          {importLike ? (
            <>
              아래 표에서 어떤 연락처가 기존 데이터와 겹치는지 확인한 뒤, 행별로 <strong>강제 등록</strong> 또는{' '}
              <strong>제외</strong>를 선택하세요.
            </>
          ) : (
            <>
              아래 표에서 연락처 중복과 고객사 유사 항목을 확인한 뒤, 행별로 <strong>강제 등록</strong> 또는{' '}
              <strong>제외</strong>를 선택하세요.
            </>
          )}
        </p>
        <div className="bulk-contact-review-quick-actions" role="group" aria-label="일괄 선택">
          <button type="button" onClick={() => setAllDecisions(EXCLUDE)} disabled={saving}>
            전체 제외
          </button>
          <button type="button" onClick={() => setAllDecisions(FORCE)} disabled={saving}>
            전체 강제 등록
          </button>
        </div>
        <div className="bulk-contact-review-table-wrap">
          <table className="bulk-contact-review-table">
            <thead>
              <tr>
                <th>행</th>
                <th>등록 예정</th>
                <th>겹치는 종류</th>
                <th>기존 데이터</th>
                <th>처리</th>
              </tr>
            </thead>
            <tbody>
              {issueRows.map((issueRow) => {
                const row = issueRow.row || {};
                const entry = issueRow.entry || {};
                const contactIssue = issueRow.contactCandidates.length > 0;
                const companyIssue = issueRow.similarCustomerCompanies.length > 0;
                const decision = decisions[issueRow.key] || EXCLUDE;
                return (
                  <tr key={issueRow.key}>
                    <td className="bulk-contact-review-row-no">{issueRow.displayNo}</td>
                    <td>
                      <div className="bulk-contact-review-target">
                        <strong>{asText(row.name || entry.name)}</strong>
                        <span>{asText(row.phone || entry.phone)}</span>
                        <span>{asText(row.companyName || entry.companyName, '개인/미지정')}</span>
                      </div>
                    </td>
                    <td>
                      <div className="bulk-contact-review-badges">
                        {contactIssue ? <span className="bulk-contact-review-badge danger">연락처 중복</span> : null}
                        {companyIssue ? <span className="bulk-contact-review-badge soft">고객사 유사</span> : null}
                      </div>
                    </td>
                    <td>
                      <div className="bulk-contact-review-existing">
                        {issueRow.contactCandidates.slice(0, 3).map((candidate) => (
                          <div key={`c-${candidate._id || candidate.phone || candidate.name}`} className="bulk-contact-review-existing-item">
                            <strong>
                              {asText(candidate.name)} · {asText(candidate.phone)}
                            </strong>
                            <span>
                              {matchReasonLabel(candidate.matchReason)} 일치 · {asText(candidate.companyName || candidate.customerCompanyId?.name, '소속 미지정')}
                            </span>
                          </div>
                        ))}
                        {issueRow.similarCustomerCompanies.slice(0, 3).map((company) => (
                          <div key={`co-${company._id || company.name}`} className="bulk-contact-review-existing-item">
                            <strong>{asText(company.name)}</strong>
                            <span>
                              사업자 {asText(company.businessNumber)} · {asText(company.address, '주소 없음')}
                            </span>
                          </div>
                        ))}
                        {issueRow.contactCandidates.length + issueRow.similarCustomerCompanies.length > 3 ? (
                          <span className="bulk-contact-review-more">
                            외 {issueRow.contactCandidates.length + issueRow.similarCustomerCompanies.length - 3}건
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="bulk-contact-review-choice" role="group" aria-label={`${issueRow.displayNo}행 처리 선택`}>
                        <button
                          type="button"
                          className={decision === FORCE ? 'active force' : ''}
                          onClick={() => setRowDecision(issueRow.key, FORCE)}
                          disabled={saving}
                        >
                          강제 등록
                        </button>
                        <button
                          type="button"
                          className={decision === EXCLUDE ? 'active exclude' : ''}
                          onClick={() => setRowDecision(issueRow.key, EXCLUDE)}
                          disabled={saving}
                        >
                          제외
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="add-contact-pregate-actions add-contact-pregate-actions--bulk">
          <button
            type="button"
            className="add-contact-modal-cancel"
            onClick={() => onClose?.()}
            disabled={saving}
          >
            취소
          </button>
          <button
            type="button"
            className="add-contact-modal-save add-contact-pregate-btn-muted"
            disabled={saving}
            onClick={() => onConfirmForce?.(false)}
          >
            전체 제외로 등록
          </button>
          <button
            type="button"
            className="add-contact-modal-save"
            disabled={saving}
            onClick={confirmSelected}
          >
            선택대로 처리
          </button>
        </div>
      </div>
    </div>
  );
}
