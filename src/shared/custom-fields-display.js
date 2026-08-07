import { useMemo } from 'react';
import { computeCustomFieldFormulas, formatFormulaExpressionForLabel } from '@/lib/custom-field-formula';
import {
  formatCustomFieldDisplayValue,
  normalizeCustomFieldDefinition
} from '@/lib/custom-field-display-format';
import { filterActiveCustomFieldDefinitions } from '@/lib/custom-field-definition-utils';
import './custom-fields-display.css';

function formatDisplayValue(def, value, context = {}) {
  return formatCustomFieldDisplayValue(value, normalizeCustomFieldDefinition(def), context);
}

export default function CustomFieldsDisplay({
  definitions = [],
  values = {},
  sectionTitle = '추가된 필드',
  className = '',
  formulaContext = null,
  /** 등록 초기값 비교(기회 라인 카탈로그 스냅샷 등) — key → raw value */
  initialValues = null,
  initialLabel = '등록 초기'
}) {
  const activeDefinitions = useMemo(
    () => filterActiveCustomFieldDefinitions(definitions),
    [definitions]
  );

  const productFormulas =
    formulaContext?.customFieldFormulas && typeof formulaContext.customFieldFormulas === 'object'
      ? formulaContext.customFieldFormulas
      : {};

  const computedFormulas = useMemo(() => {
    if (!formulaContext) return {};
    return computeCustomFieldFormulas(activeDefinitions, {
      builtIn: formulaContext.builtIn || {},
      customFields: values,
      entityType: formulaContext.entityType,
      definitions: activeDefinitions,
      pricingProfile: formulaContext.pricingProfile || null,
      customFieldFormulas: productFormulas,
      missingCustomRefAsZero: Boolean(formulaContext.missingCustomRefAsZero)
    });
  }, [activeDefinitions, formulaContext, values, productFormulas]);

  if (!activeDefinitions || activeDefinitions.length === 0) return null;

  const entries = activeDefinitions
    .map((def) => {
      if (def.type === 'formula' || productFormulas[def.key]) {
        const computed = computedFormulas[def.key];
        if (computed != null) {
          return {
            def,
            value: computed,
            expression: productFormulas[def.key] || def.options?.expression || '',
            isFormula: true
          };
        }
        return {
          def,
          value: values[def.key],
          expression: productFormulas[def.key] || def.options?.expression || '',
          isFormula: true
        };
      }
      return { def, value: values[def.key], expression: '', isFormula: false };
    })
    .filter(Boolean);

  if (entries.length === 0) return null;

  const hasInitial = initialValues && typeof initialValues === 'object';

  return (
    <section className={`custom-fields-display ${className}`.trim()}>
      <h3 className="custom-fields-display-title">{sectionTitle}</h3>
      <dl className="custom-fields-display-dl">
        {entries.map(({ def, value, expression, isFormula }) => {
          const initialRaw = hasInitial ? initialValues[def.key] : undefined;
          const showInitial = hasInitial && initialRaw != null && String(initialRaw).trim() !== '';
          return (
            <div key={def._id} className="custom-fields-display-row">
              <dt>
                {def.label}
                {isFormula && expression ? (
                  <span className="custom-fields-formula-expression-label">
                    {formatFormulaExpressionForLabel(expression)}
                  </span>
                ) : null}
                {isFormula ? (
                  <span className="custom-fields-display-formula-badge">함수</span>
                ) : null}
              </dt>
              <dd>
                <div className="custom-fields-display-value">
                  {formatDisplayValue(def, value, formulaContext?.displayContext || {})}
                </div>
                {showInitial ? (
                  <div className="custom-fields-display-initial">
                    {initialLabel}:{' '}
                    {formatDisplayValue(def, initialRaw, formulaContext?.displayContext || {})}
                  </div>
                ) : null}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
