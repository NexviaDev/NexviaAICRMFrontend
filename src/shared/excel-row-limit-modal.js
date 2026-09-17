/**
 * 엑셀 가져오기 — 행 수 상한 초과 안내 모달 (공용).
 * 매핑 모달(z-index 1400) 위에 뜹니다.
 */
import { useEffect, useRef } from 'react';
import './excel-row-limit-modal.css';

export default function ExcelRowLimitModal({ notice, onClose }) {
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!notice) return undefined;
    confirmRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [notice, onClose]);

  if (!notice) return null;

  const { rowCount, maxRows, fileName = '', unitLabel = '행' } = notice;
  const over = Math.max(0, rowCount - maxRows);
  const fileCount = Math.max(2, Math.ceil(rowCount / maxRows));
  const fmt = (n) => Number(n || 0).toLocaleString();

  return (
    <div className="xrl-overlay" role="presentation" onClick={onClose}>
      <div
        className="xrl-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="xrl-title"
        aria-describedby="xrl-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="xrl-icon" aria-hidden="true">
          <span className="material-symbols-outlined">block</span>
        </div>

        <h3 className="xrl-title" id="xrl-title">
          한 번에 올릴 수 있는 건수를 넘었습니다
        </h3>
        {fileName ? (
          <p className="xrl-file" title={fileName}>
            <span className="material-symbols-outlined">description</span>
            {fileName}
          </p>
        ) : null}

        <div className="xrl-stats">
          <div className="xrl-stat">
            <span className="xrl-stat-label">파일</span>
            <span className="xrl-stat-num is-over">
              {fmt(rowCount)}
              <small>{unitLabel}</small>
            </span>
          </div>
          <div className="xrl-stat">
            <span className="xrl-stat-label">최대</span>
            <span className="xrl-stat-num">
              {fmt(maxRows)}
              <small>{unitLabel}</small>
            </span>
          </div>
          <div className="xrl-stat">
            <span className="xrl-stat-label">초과</span>
            <span className="xrl-stat-num is-over">
              +{fmt(over)}
              <small>{unitLabel}</small>
            </span>
          </div>
        </div>

        <div className="xrl-bar" aria-hidden="true">
          <div className="xrl-bar-fill" style={{ width: `${Math.min(100, (maxRows / rowCount) * 100)}%` }} />
        </div>

        <p className="xrl-desc" id="xrl-desc">
          파일을 <strong>{fmt(maxRows)}{unitLabel} 이하</strong>로 나눠서 올려 주세요.
          <br />
          이 파일은 <strong>{fileCount}개</strong>로 나누면 됩니다. 파일은 불러오지 않았습니다.
        </p>

        <button type="button" ref={confirmRef} className="xrl-confirm" onClick={onClose}>
          확인
        </button>
      </div>
    </div>
  );
}
