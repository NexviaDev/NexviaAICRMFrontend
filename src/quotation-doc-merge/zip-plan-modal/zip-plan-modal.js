import { useEffect, useState } from 'react';
import './zip-plan-modal.css';

export default function ZipPlanModal({ open, plan, onCancel, onConfirm }) {
  const [policy, setPolicy] = useState('rename');

  useEffect(() => {
    if (open) setPolicy('rename');
  }, [open]);

  if (!open || !plan) return null;

  const hasCollision = Boolean(plan.hasRawCollisions);
  const listEntries =
    hasCollision && policy === 'overwrite' && Array.isArray(plan.entriesOverwrite) && plan.entriesOverwrite.length
      ? plan.entriesOverwrite
      : Array.isArray(plan.entries)
        ? plan.entries
        : [];

  return (
    <div className="qdm-zip-modal-root" role="dialog" aria-modal="true" aria-labelledby="qdm-zip-modal-title">
      <div className="qdm-zip-modal-overlay" aria-hidden />
      <div className="qdm-zip-modal-panel">
        <div className="qdm-zip-modal-head">
          <h2 id="qdm-zip-modal-title" className="qdm-zip-modal-title">
            {hasCollision ? 'ZIP 안 파일명이 겹칩니다' : 'ZIP 파일명 확인'}
          </h2>
          <button type="button" className="qdm-zip-modal-close" onClick={onCancel} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {hasCollision ? (
          <div className="qdm-zip-modal-collision">
            <p className="qdm-zip-modal-warn">
              같은 날·같은 기본 이름(고객사명 또는 ZIP 파일명)으로 저장되는 행이 2건 이상입니다. Windows에서 복사할 때처럼{' '}
              <strong>(2), (3)…</strong>를 붙이거나, <strong>같은 이름은 마지막 행 문서만</strong> ZIP에 넣을 수 있습니다.
            </p>
            <fieldset className="qdm-zip-modal-fieldset">
              <legend className="qdm-zip-modal-legend">처리 방식</legend>
              <label className="qdm-zip-modal-radio">
                <input type="radio" name="zip-collision" checked={policy === 'rename'} onChange={() => setPolicy('rename')} />
                <span>
                  <strong>이름 자동 변경</strong> — 겹치면 <code className="qdm-zip-inline-code">(2)</code>,{' '}
                  <code className="qdm-zip-inline-code">(3)</code> … (행마다 파일 1개씩 ZIP에 포함)
                </span>
              </label>
              <label className="qdm-zip-modal-radio">
                <input
                  type="radio"
                  name="zip-collision"
                  checked={policy === 'overwrite'}
                  onChange={() => setPolicy('overwrite')}
                />
                <span>
                  <strong>덮어쓰기</strong> — ZIP 안 파일명은 그대로 두고, 같은 이름은 <strong>아래 목록 순서에서 마지막 행</strong>만
                  남깁니다.
                </span>
              </label>
            </fieldset>
          </div>
        ) : (
          <p className="qdm-zip-modal-desc">아래 이름으로 ZIP에 들어갑니다.</p>
        )}

        <ul className="qdm-zip-modal-list">
          {listEntries.map((e) => (
            <li key={e.rowIndex} className={e.windowsStyleRenamed ? 'qdm-zip-modal-li--renamed' : ''}>
              <span className="qdm-zip-modal-idx">행 {e.rowIndex + 1}</span>
              <code className="qdm-zip-modal-name">{e.fileName}</code>
            </li>
          ))}
        </ul>

        {hasCollision && policy === 'overwrite' ? (
          <p className="qdm-zip-modal-footnote">덮어쓰기 선택 시 ZIP에 포함되는 파일 개수가 행 수보다 적을 수 있습니다.</p>
        ) : null}

        <div className="qdm-zip-modal-actions">
          <button type="button" className="qdm-btn qdm-btn-ghost" onClick={onCancel}>
            취소
          </button>
          <button type="button" className="qdm-btn qdm-btn-primary" onClick={() => onConfirm({ zipCollisionPolicy: policy })}>
            ZIP 받기
          </button>
        </div>
      </div>
    </div>
  );
}
