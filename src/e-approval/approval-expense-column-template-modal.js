import { useEffect, useMemo, useState } from 'react';
import {
  EXPENSE_COLUMN_TYPES,
  normalizeExpenseColumnTemplateColumns
} from './approval-expense-column-template';
import '../sales-pipeline/opportunity-modal/opportunity-modal.css';
import '../shared/excel-import-mapping-modal.css';
import './approval-expense-column-template-modal.css';

export default function ApprovalExpenseColumnTemplateModal({
  open,
  columns,
  saving = false,
  onClose,
  onSave
}) {
  const [draftCols, setDraftCols] = useState(() => normalizeExpenseColumnTemplateColumns(columns));
  const [keyListEditor, setKeyListEditor] = useState({
    open: false,
    colKey: '',
    colLabel: '',
    rows: []
  });
  const disabled = saving;

  useEffect(() => {
    if (!open) return;
    setDraftCols(normalizeExpenseColumnTemplateColumns(columns));
  }, [columns, open]);

  const rows = useMemo(() => normalizeExpenseColumnTemplateColumns(draftCols), [draftCols]);

  const updateCol = (key, patch) => {
    setDraftCols((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  };

  const move = (key, dir) => {
    setDraftCols((prev) => {
      const idx = prev.findIndex((c) => c.key === key);
      if (idx < 0) return prev;
      const to = dir === 'up' ? idx - 1 : idx + 1;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const openKeyListEditor = (col) => {
    setKeyListEditor({
      open: true,
      colKey: col.key,
      colLabel: col.label || col.key,
      rows: Array.isArray(col.allowedValues) && col.allowedValues.length > 0 ? [...col.allowedValues] : ['']
    });
  };

  const closeKeyListEditor = () => {
    setKeyListEditor({ open: false, colKey: '', colLabel: '', rows: [] });
  };

  const patchKeyListRow = (index, value) => {
    setKeyListEditor((prev) => ({
      ...prev,
      rows: prev.rows.map((v, i) => (i === index ? value : v))
    }));
  };

  const addKeyListRow = () => {
    setKeyListEditor((prev) => ({ ...prev, rows: [...prev.rows, ''] }));
  };

  const removeKeyListRow = (index) => {
    setKeyListEditor((prev) => ({
      ...prev,
      rows: prev.rows.length <= 1 ? prev.rows : prev.rows.filter((_, i) => i !== index)
    }));
  };

  const saveKeyListEditor = () => {
    const next = [];
    const seen = new Set();
    keyListEditor.rows.forEach((raw) => {
      const value = String(raw || '').trim();
      if (!value || seen.has(value)) return;
      next.push(value);
      seen.add(value);
    });
    updateCol(keyListEditor.colKey, { allowedValues: next });
    closeKeyListEditor();
  };

  const handleSave = () => {
    const normalized = normalizeExpenseColumnTemplateColumns(draftCols);
    onSave?.(normalized);
  };

  if (!open) return null;

  return (
    <div className="opp-modal-overlay expense-coltpl-overlay" role="dialog" aria-modal="true" aria-labelledby="expense-coltpl-title">
      <div className="opp-modal expense-coltpl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="opp-modal-header">
          <div className="opp-modal-header-left">
            <h3 className="opp-modal-title" id="expense-coltpl-title">지출 컬럼 템플릿 설정</h3>
          </div>
          <button type="button" className="opp-modal-close" onClick={onClose} disabled={disabled} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="opp-modal-form expense-coltpl-body">
          <p className="expense-coltpl-desc">
            회사 기준 컬럼을 관리합니다. 타입이 <strong>날짜</strong>이면 캘린더·현재 날짜 편의 기능이,
            타입이 <strong>금액</strong>이면 숫자 입력 + 자동 쉼표가 적용됩니다.
            Key 값 목록이 있는 컬럼은 드롭다운 선택 + 직접 타이핑 입력을 함께 지원합니다.
          </p>
          <div className="expense-coltpl-table">
            <div className="expense-coltpl-head">
              <span>표시</span>
              <span>라벨</span>
              <span>타입</span>
              <span>Key 값 목록</span>
              <span>필수</span>
              <span>순서</span>
              <span>작업</span>
            </div>
            {rows.map((col, idx) => (
              <div key={col.key} className="expense-coltpl-row">
                <label className="expense-coltpl-cell-center">
                  <input
                    type="checkbox"
                    checked={!!col.enabled}
                    onChange={(e) => updateCol(col.key, { enabled: e.target.checked })}
                    disabled={disabled || col.key === 'category'}
                  />
                </label>
                <input
                  className="opp-input"
                  value={col.label}
                  onChange={(e) => updateCol(col.key, { label: e.target.value })}
                  disabled={disabled}
                />
                <select
                  className="opp-select"
                  value={col.type}
                  onChange={(e) => updateCol(col.key, { type: e.target.value })}
                  disabled={disabled || !col.isCustom}
                >
                  {EXPENSE_COLUMN_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <div className="expense-coltpl-keylist-cell">
                  {col.type !== 'text' ? (
                    <span className="expense-coltpl-fixed">타입 제한</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="expense-coltpl-keylist-edit-btn"
                        onClick={() => openKeyListEditor(col)}
                        disabled={disabled}
                      >
                        목록 수정
                      </button>
                      <span className="expense-coltpl-keylist-count">
                        {Array.isArray(col.allowedValues) ? col.allowedValues.length : 0}개
                      </span>
                    </>
                  )}
                </div>
                <label className="expense-coltpl-cell-center">
                  <input
                    type="checkbox"
                    checked={!!col.required}
                    onChange={(e) => updateCol(col.key, { required: e.target.checked })}
                    disabled={disabled || col.key === 'category'}
                  />
                </label>
                <div className="expense-coltpl-order-btns">
                  <button type="button" onClick={() => move(col.key, 'up')} disabled={disabled || idx === 0}>▲</button>
                  <button type="button" onClick={() => move(col.key, 'down')} disabled={disabled || idx === rows.length - 1}>▼</button>
                </div>
                <div className="expense-coltpl-cell-center">
                  <span className="expense-coltpl-fixed">기본</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="opp-modal-footer">
          <button type="button" className="opp-cancel-btn" onClick={onClose} disabled={disabled}>
            <span className="material-symbols-outlined">close</span>
            취소
          </button>
          <button type="button" className="opp-save-btn" onClick={handleSave} disabled={disabled}>
            <span className="material-symbols-outlined">save</span>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>

      {keyListEditor.open ? (
        <div className="expense-coltpl-keylist-overlay" role="dialog" aria-modal="true" aria-label="Key 값 목록 수정">
          <div className="expense-coltpl-keylist-modal" onClick={(e) => e.stopPropagation()}>
            <div className="expense-coltpl-keylist-head">
              <h4>{keyListEditor.colLabel} Key 값 목록</h4>
              <button type="button" className="opp-modal-close" onClick={closeKeyListEditor} disabled={disabled}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="expense-coltpl-keylist-table">
              <div className="expense-coltpl-keylist-table-head">
                <span>No</span>
                <span>값</span>
                <span>삭제</span>
              </div>
              {keyListEditor.rows.map((value, idx) => (
                <div key={`key-list-row-${idx}`} className="expense-coltpl-keylist-row">
                  <span>{idx + 1}</span>
                  <input
                    className="opp-input"
                    value={value}
                    onChange={(e) => patchKeyListRow(idx, e.target.value)}
                    placeholder="예: 아침식대"
                    disabled={disabled}
                  />
                  <button
                    type="button"
                    className="expense-coltpl-keylist-delete"
                    onClick={() => removeKeyListRow(idx)}
                    disabled={disabled || keyListEditor.rows.length <= 1}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
            <div className="expense-coltpl-keylist-foot">
              <button type="button" className="expense-coltpl-keylist-add" onClick={addKeyListRow} disabled={disabled}>
                <span className="material-symbols-outlined">add</span>
                값 추가
              </button>
              <div className="expense-coltpl-keylist-actions">
                <button type="button" className="opp-cancel-btn" onClick={closeKeyListEditor} disabled={disabled}>
                  취소
                </button>
                <button type="button" className="opp-save-btn" onClick={saveKeyListEditor} disabled={disabled}>
                  저장
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
