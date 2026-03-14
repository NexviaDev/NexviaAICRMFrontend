import { useState, useEffect, useRef } from 'react';
import './custom-fields-section.css';

/**
 * 추가된 필드 값 입력만 표시 (정의 추가/삭제는 custom-fields-manage-modal에서).
 * 다중 선택: 드롭다운으로 표시, 각 옵션 왼쪽에 체크박스(높이 중앙 정렬).
 */
export default function CustomFieldsSection({
  definitions = [],
  values = {},
  onChangeValues,
  fieldClassName = ''
}) {
  const [openMultiselectKey, setOpenMultiselectKey] = useState(null);
  const multiselectRef = useRef(null);

  useEffect(() => {
    if (openMultiselectKey == null) return;
    const onDocClick = (e) => {
      if (multiselectRef.current && !multiselectRef.current.contains(e.target)) {
        setOpenMultiselectKey(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [openMultiselectKey]);

  const handleValueChange = (key, type) => (e) => {
    const v = type === 'checkbox' ? e.target.checked : e.target.value;
    onChangeValues?.(key, v);
  };

  const handleMultiselectToggle = (key, choice, currentArr) => () => {
    const arr = Array.isArray(currentArr) ? [...currentArr] : [];
    const idx = arr.indexOf(choice);
    if (idx === -1) arr.push(choice);
    else arr.splice(idx, 1);
    onChangeValues?.(key, arr);
  };

  const getMultiselectTriggerLabel = (displayValue) => {
    const arr = Array.isArray(displayValue) ? displayValue : [];
    if (arr.length === 0) return '선택';
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return `${arr[0]}, ${arr[1]}`;
    return `${arr[0]} 외 ${arr.length - 1}개`;
  };

  if (!definitions || definitions.length === 0) return null;

  return (
    <>
      <div className={`${fieldClassName} custom-fields-section-title`.trim()}>
        <span className="custom-fields-section-label">추가된 필드</span>
      </div>
      {definitions.map((def) => {
        const key = def.key;
        const val = values[key];
        const displayValue = val !== undefined && val !== null ? val : '';
        const id = `custom-${key}`;
        const label = def.label || key;
        const required = !!def.required;
        const choices = (def.options && def.options.choices) || [];
        const isMultiselectOpen = openMultiselectKey === key;

        return (
          <div key={def._id} className={`${fieldClassName} custom-fields-value-row`.trim()}>
            <div className="custom-fields-value-input-wrap">
              {def.type === 'checkbox' ? (
                <label className="custom-fields-checkbox-label" htmlFor={id}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={!!displayValue}
                    onChange={handleValueChange(key, 'checkbox')}
                  />
                  <span>{label}{required ? ' *' : ''}</span>
                </label>
              ) : def.type === 'select' ? (
                <>
                  <label htmlFor={id}>{label}{required ? ' *' : ''}</label>
                  <select
                    id={id}
                    value={displayValue}
                    onChange={handleValueChange(key, 'text')}
                    required={required}
                  >
                    <option value="">선택</option>
                    {choices.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </>
              ) : def.type === 'multiselect' ? (
                <div className="custom-fields-multiselect-wrap" ref={key === openMultiselectKey ? multiselectRef : null}>
                  <span className="custom-fields-value-label">{label}{required ? ' *' : ''}</span>
                  <button
                    type="button"
                    className="custom-fields-multiselect-trigger"
                    onClick={() => setOpenMultiselectKey(isMultiselectOpen ? null : key)}
                    aria-expanded={isMultiselectOpen}
                    aria-haspopup="listbox"
                  >
                    <span className="custom-fields-multiselect-trigger-text">{getMultiselectTriggerLabel(displayValue)}</span>
                    <span className="material-symbols-outlined custom-fields-multiselect-chevron">{isMultiselectOpen ? 'expand_less' : 'expand_more'}</span>
                  </button>
                  {isMultiselectOpen && (
                    <div className="custom-fields-multiselect-dropdown" role="listbox">
                      {choices.map((c) => (
                        <label
                          key={c}
                          role="option"
                          aria-selected={Array.isArray(displayValue) && displayValue.includes(c)}
                          className="custom-fields-multiselect-option"
                        >
                          <input
                            type="checkbox"
                            checked={Array.isArray(displayValue) && displayValue.includes(c)}
                            onChange={handleMultiselectToggle(key, c, displayValue)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span>{c}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <label htmlFor={id}>{label}{required ? ' *' : ''}</label>
                  <input
                    id={id}
                    type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'}
                    value={displayValue}
                    onChange={handleValueChange(key, 'text')}
                    required={required}
                  />
                </>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
