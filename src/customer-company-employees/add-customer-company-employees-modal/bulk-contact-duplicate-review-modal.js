import { useEffect, useMemo, useState } from 'react';
import './add-customer-company-employees-modal.css';
import './bulk-contact-duplicate-review-modal.css';
import { BULK_ROW_EXCLUDE, BULK_ROW_FORCE, BULK_ROW_MERGE } from './bulk-contact-merge-utils';

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

function candidateId(candidate) {
  return String(candidate?._id || '').trim();
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
      return {
        key: rowKeyFromPreResult(preResult, fallbackIndex),
        displayNo: rowIndex + 1,
        row,
        entry,
        contactCandidates
      };
    })
    .filter((r) => r.contactCandidates.length > 0);
}

export default function BulkContactDuplicateReviewModal({
  review,
  saving,
  onClose,
  onConfirmForce
}) {
  const source = review?.source || 'import';
  const importLike = source === 'import' || source === 'excel';
  const title = '대량 등록 — 연락처 중복';
  const issueRows = useMemo(() => buildIssueRows(review), [review]);
  const [decisions, setDecisions] = useState({});
  const [mergeContactIds, setMergeContactIds] = useState({});

  useEffect(() => {
    const nextDecisions = {};
    const nextContact = {};
    issueRows.forEach((row) => {
      nextDecisions[row.key] = decisions[row.key] || BULK_ROW_EXCLUDE;
      if (mergeContactIds[row.key]) nextContact[row.key] = mergeContactIds[row.key];
    });
    setDecisions(nextDecisions);
    setMergeContactIds(nextContact);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueRows.map((row) => row.key).join('|')]);

  useEffect(() => {
    if (!review || !Array.isArray(review.preResults) || review.preResults.length === 0 || issueRows.length === 0) {
      return undefined;
    }
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      if (saving) return;
      e.preventDefault();
      onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [review, saving, onClose, issueRows.length]);

  if (!review || !Array.isArray(review.preResults) || review.preResults.length === 0 || issueRows.length === 0) return null;

  const clearMergeForRow = (key) => {
    setMergeContactIds((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const setAllDecisions = (action) => {
    const next = {};
    issueRows.forEach((row) => {
      next[row.key] = action;
    });
    setDecisions(next);
    if (action !== BULK_ROW_MERGE) {
      setMergeContactIds({});
    }
  };

  const setRowDecision = (key, action) => {
    setDecisions((prev) => ({ ...prev, [key]: action }));
    if (action !== BULK_ROW_MERGE) clearMergeForRow(key);
  };

  const selectMergeContact = (rowKey, employeeId) => {
    const id = String(employeeId || '').trim();
    if (!id) return;
    setDecisions((prev) => ({ ...prev, [rowKey]: BULK_ROW_MERGE }));
    setMergeContactIds((prev) => ({ ...prev, [rowKey]: id }));
  };

  const confirmSelected = () => {
    for (const row of issueRows) {
      const d = decisions[row.key] || BULK_ROW_EXCLUDE;
      if (d !== BULK_ROW_MERGE) continue;
      if (!mergeContactIds[row.key]) {
        window.alert(`${row.displayNo}행: 병합할 기존 연락처를 목록에서 선택해 주세요.`);
        return;
      }
    }

    const next = {};
    issueRows.forEach((row) => {
      next[row.key] = decisions[row.key] || BULK_ROW_EXCLUDE;
    });
    onConfirmForce?.({
      mode: 'perRow',
      decisions: next,
      mergeContactIds: { ...mergeContactIds },
      mergeCompanyIds: {}
    });
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
              아래 표에서 겹치는 연락처를 확인하세요. <strong>기존 연락처</strong>를 누르면 해당 건에 병합됩니다(빈
              필드만 채움). 또는 행별로 <strong>강제 등록</strong>·<strong>제외</strong>를 선택할 수 있습니다.
            </>
          ) : (
            <>
              아래 표에서 연락처 중복을 확인하세요. <strong>기존 연락처</strong>를 눌러 병합하거나, 행별로{' '}
              <strong>강제 등록</strong>·<strong>제외</strong>를 선택하세요.
            </>
          )}
        </p>
        <div className="bulk-contact-review-quick-actions" role="group" aria-label="일괄 선택">
          <button
            type="button"
            className="add-contact-modal-save"
            onClick={() => setAllDecisions(BULK_ROW_EXCLUDE)}
            disabled={saving}
          >
            전체 제외
          </button>
          <button
            type="button"
            className="add-contact-modal-save"
            onClick={() => setAllDecisions(BULK_ROW_FORCE)}
            disabled={saving}
          >
            전체 강제 등록
          </button>
          <button
            type="button"
            className="add-contact-modal-save"
            disabled={saving}
            onClick={() => onConfirmForce?.(false)}
          >
            전체 제외로 등록
          </button>
        </div>
        <div className="bulk-contact-review-table-wrap">
          <table className="bulk-contact-review-table">
            <thead>
              <tr>
                <th>행</th>
                <th>등록 예정</th>
                <th>겹침</th>
                <th>기존 연락처 (클릭하여 병합)</th>
                <th>처리</th>
              </tr>
            </thead>
            <tbody>
              {issueRows.map((issueRow) => {
                const row = issueRow.row || {};
                const entry = issueRow.entry || {};
                const decision = decisions[issueRow.key] || BULK_ROW_EXCLUDE;
                const pickedContactId = mergeContactIds[issueRow.key] || '';
                const isMerge = decision === BULK_ROW_MERGE;
                return (
                  <tr key={issueRow.key} className={isMerge ? 'bulk-contact-review-row--merge' : undefined}>
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
                        <span className="bulk-contact-review-badge danger">연락처 중복</span>
                        {isMerge ? <span className="bulk-contact-review-badge merge">병합</span> : null}
                      </div>
                    </td>
                    <td>
                      <div className="bulk-contact-review-existing">
                        {issueRow.contactCandidates.map((candidate) => {
                          const cid = candidateId(candidate);
                          const selected = isMerge && pickedContactId === cid;
                          return (
                            <button
                              key={`c-${cid || candidate.phone || candidate.name}`}
                              type="button"
                              className={`bulk-contact-review-existing-item bulk-contact-review-pick${
                                selected ? ' bulk-contact-review-pick--selected' : ''
                              }`}
                              disabled={saving || !cid}
                              onClick={() => selectMergeContact(issueRow.key, cid)}
                              title="이 연락처에 등록 예정 정보 병합"
                            >
                              <strong>
                                {asText(candidate.name)} · {asText(candidate.phone)}
                              </strong>
                              <span>
                                {matchReasonLabel(candidate.matchReason)} 일치 ·{' '}
                                {asText(candidate.companyName || candidate.customerCompanyId?.name, '소속 미지정')}
                              </span>
                              {selected ? <span className="bulk-contact-review-pick-mark">선택됨 · 병합</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td>
                      <div className="bulk-contact-review-choice" role="group" aria-label={`${issueRow.displayNo}행 처리 선택`}>
                        <button
                          type="button"
                          className={`add-contact-modal-save bulk-contact-review-choice-btn${
                            decision === BULK_ROW_FORCE ? '' : ' bulk-contact-review-choice-btn--idle'
                          }`}
                          onClick={() => setRowDecision(issueRow.key, BULK_ROW_FORCE)}
                          disabled={saving}
                        >
                          강제 등록
                        </button>
                        <button
                          type="button"
                          className={`add-contact-modal-save bulk-contact-review-choice-btn${
                            decision === BULK_ROW_EXCLUDE ? '' : ' bulk-contact-review-choice-btn--idle'
                          }`}
                          onClick={() => setRowDecision(issueRow.key, BULK_ROW_EXCLUDE)}
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
          <button type="button" className="add-contact-modal-save" disabled={saving} onClick={confirmSelected}>
            선택대로 처리
          </button>
          <button
            type="button"
            className="add-contact-modal-cancel"
            onClick={() => onClose?.()}
            disabled={saving}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
