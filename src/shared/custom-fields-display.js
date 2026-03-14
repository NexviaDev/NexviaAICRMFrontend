import './custom-fields-display.css';

/**
 * 추가된 필드 정의 + 값을 읽기 전용으로 표시 (상세 모달용).
 */
function formatDisplayValue(def, value) {
  if (value === undefined || value === null) return '—';
  if (def.type === 'checkbox') return value ? '예' : '아니오';
  if (def.type === 'multiselect' && Array.isArray(value)) {
    return value.length ? value.join(', ') : '—';
  }
  if (typeof value === 'string' && !value.trim()) return '—';
  return String(value);
}

export default function CustomFieldsDisplay({ definitions = [], values = {}, sectionTitle = '추가된 필드', className = '' }) {
  if (!definitions || definitions.length === 0) return null;

  const entries = definitions.map((def) => ({ def, value: values[def.key] }));

  return (
    <section className={`custom-fields-display ${className}`.trim()}>
      <h3 className="custom-fields-display-title">{sectionTitle}</h3>
      <dl className="custom-fields-display-dl">
        {entries.map(({ def, value }) => (
          <div key={def._id} className="custom-fields-display-row">
            <dt>{def.label}</dt>
            <dd>{formatDisplayValue(def, value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
