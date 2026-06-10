import { getFormulaFieldTypeHint } from '@/lib/custom-field-formula-catalog';
import '../custom-fields-manage-modal/custom-fields-manage-modal.css';

function preventPickerFocusLoss(e) {
  e.preventDefault();
}

export default function CustomFieldsFormulaPickerPanel({
  className = '',
  formulaFieldOptions = [],
  formulaCatalogGroups = [],
  onInsertFieldLabel,
  onInsertFunctionName
}) {
  return (
    <aside
      className={`custom-fields-manage-formula-fields-panel${className ? ` ${className}` : ''}`}
      aria-label="수식 필드·함수"
    >
      <div className="custom-fields-manage-formula-panel-col custom-fields-manage-formula-panel-col--fields">
        <h4 className="custom-fields-manage-formula-fields-title">필드</h4>
        <p className="custom-fields-manage-formula-fields-hint">클릭하여 삽입</p>
        <div className="custom-fields-manage-formula-panel-scroll">
          <ul className="custom-fields-manage-formula-fields-list">
            {formulaFieldOptions.map((opt) => (
              <li key={opt.key}>
                <button
                  type="button"
                  className="custom-fields-manage-formula-field-btn"
                  onMouseDown={preventPickerFocusLoss}
                  onClick={() => onInsertFieldLabel?.(opt.label)}
                >
                                <span className="custom-fields-manage-formula-field-btn-label">{opt.label}</span>
                                {opt.subtitle ? (
                                  <span className="custom-fields-manage-formula-field-btn-desc">{opt.subtitle}</span>
                                ) : null}
                                <span className="custom-fields-manage-formula-field-btn-type">
                    {getFormulaFieldTypeHint(opt.fieldType)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="custom-fields-manage-formula-panel-col custom-fields-manage-formula-panel-col--fn">
        <h4 className="custom-fields-manage-formula-fields-title">함수</h4>
        <p className="custom-fields-manage-formula-fields-hint">회계·금액 함수가 먼저 표시됩니다</p>
        <div className="custom-fields-manage-formula-panel-scroll">
          {formulaCatalogGroups.map((group) => (
            <section key={group.id} className="custom-fields-manage-formula-fn-group">
              <p className="custom-fields-manage-formula-fn-group-label">{group.label}</p>
              <ul className="custom-fields-manage-formula-fn-list">
                {group.items.map((fn) => (
                  <li key={fn.name}>
                    <button
                      type="button"
                      className="custom-fields-manage-formula-fn-btn"
                      title={fn.example}
                      onMouseDown={preventPickerFocusLoss}
                      onClick={() => onInsertFunctionName?.(fn.name)}
                    >
                      <span className="custom-fields-manage-formula-fn-name">{fn.name}</span>
                      <span className="custom-fields-manage-formula-fn-desc">{fn.desc}</span>
                      <span className="custom-fields-manage-formula-fn-example">{fn.example}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </aside>
  );
}
