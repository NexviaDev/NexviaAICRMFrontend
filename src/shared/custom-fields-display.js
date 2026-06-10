import { useMemo } from 'react';
import { computeCustomFieldFormulas, formatFormulaExpressionForLabel } from '@/lib/custom-field-formula';
import { formatCustomFieldDisplayValue } from '@/lib/custom-field-display-format';
import './custom-fields-display.css';

function formatDisplayValue(def, value, context = {}) {
  return formatCustomFieldDisplayValue(value, def, context);
}

export default function CustomFieldsDisplay({
  definitions = [],
  values = {},
  sectionTitle = '추가된 필드',
  className = '',
  formulaContext = null
}) {
  const computedFormulas = useMemo(() => {
    if (!formulaContext) return {};
    return computeCustomFieldFormulas(definitions, {
      builtIn: formulaContext.builtIn || {},
      customFields: values,
      entityType: formulaContext.entityType,
      definitions
    });
  }, [definitions, formulaContext, values]);

  if (!definitions || definitions.length === 0) return null;

  const entries = definitions
    .map((def) => {
      if (def.type === 'formula') {
        const computed = computedFormulas[def.key];
        if (computed == null) return null;
        return { def, value: computed };
      }
      return { def, value: values[def.key] };
    })
    .filter(Boolean);

  if (entries.length === 0) return null;

  return (
    <section className={`custom-fields-display ${className}`.trim()}>
      <h3 className="custom-fields-display-title">{sectionTitle}</h3>
      <dl className="custom-fields-display-dl">
        {entries.map(({ def, value }) => (
          <div key={def._id} className="custom-fields-display-row">
            <dt>
              {def.label}
              {def.type === 'formula' && def.options?.expression ? (
                <span className="custom-fields-formula-expression-label">
                  {formatFormulaExpressionForLabel(def.options.expression)}
                </span>
              ) : null}
              {def.type === 'formula' ? (
                <span className="custom-fields-display-formula-badge">함수</span>
              ) : null}
            </dt>
            <dd>{formatDisplayValue(def, value, formulaContext?.displayContext || {})}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
