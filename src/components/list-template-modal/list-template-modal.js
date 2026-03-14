import { useState, useEffect } from 'react';
import './list-template-modal.css';

/**
 * 리스트 컬럼 표시/숨김 및 순서 설정 모달.
 * @param {string} listId - customerCompanies | customerCompanyEmployees | productList
 * @param {{ key: string, label: string }[]} columns - 현재 사용 중인 컬럼 정의 (순서 반영)
 * @param {{ [key: string]: boolean }} visible - 필드별 표시 여부
 * @param {string[]} columnOrder - 열 순서
 * @param {(payload: { visible: {}, columnOrder: string[] }) => void} onSave
 * @param {() => void} onClose
 */
export default function ListTemplateModal({ listId, columns, visible, columnOrder, onSave, onClose }) {
  const [localVisible, setLocalVisible] = useState(() => ({ ...visible }));
  const [localOrder, setLocalOrder] = useState(() => [...(columnOrder || [])]);

  useEffect(() => {
    setLocalVisible({ ...visible });
    setLocalOrder([...(columnOrder || [])]);
  }, [visible, columnOrder]);

  const handleToggle = (key) => {
    setLocalVisible((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleMove = (index, delta) => {
    const next = [...localOrder];
    const to = index + delta;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    setLocalOrder(next);
  };

  const handleSave = () => {
    onSave({ visible: localVisible, columnOrder: localOrder });
    onClose();
  };

  return (
    <div className="list-template-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="리스트 열 설정">
      <div className="list-template-modal" onClick={(e) => e.stopPropagation()}>
        <div className="list-template-modal-header">
          <h3>리스트 열 설정</h3>
          <button type="button" className="list-template-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="list-template-modal-body">
          <p className="list-template-modal-hint">표시할 열을 선택하고 순서를 변경할 수 있습니다.</p>
          <ul className="list-template-modal-list">
            {localOrder.map((key, index) => {
              const col = columns.find((c) => c.key === key) || { key, label: key };
              return (
                <li key={col.key} className="list-template-modal-item">
                  <label className="list-template-modal-item-label">
                    <input
                      type="checkbox"
                      checked={!!localVisible[col.key]}
                      onChange={() => handleToggle(col.key)}
                    />
                    <span>{col.label}</span>
                  </label>
                  <div className="list-template-modal-item-actions">
                    <button
                      type="button"
                      className="icon-btn small"
                      disabled={index === 0}
                      onClick={() => handleMove(index, -1)}
                      aria-label="왼쪽으로 이동"
                    >
                      <span className="material-symbols-outlined">chevron_left</span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn small"
                      disabled={index === localOrder.length - 1}
                      onClick={() => handleMove(index, 1)}
                      aria-label="오른쪽으로 이동"
                    >
                      <span className="material-symbols-outlined">chevron_right</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="list-template-modal-footer">
          <button type="button" className="btn-outline" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary" onClick={handleSave}>저장</button>
        </div>
      </div>
    </div>
  );
}
