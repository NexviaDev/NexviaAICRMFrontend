/**
 * 시트 미리보기(ExcelSheetPreview)로 열→필드 연결을 대신한 뒤에도 남는 두 가지:
 *  1) 필수 필드 연결 상태 — 미리보기는 파일에 있는 열만 보여 주므로,
 *     필수 필드에 맞는 열이 아예 없으면 누락 사실이 화면에 드러나지 않습니다.
 *  2) 고정값 — "모든 행의 상태 = lead" 처럼 엑셀 열이 아닌 값을 넣는 매핑.
 */
import { columnLetter, shortTargetLabel } from './excel-sheet-preview';
import './excel-mapping-extras.css';

function describeRequired(targetKey, rows, headers, labelByTarget) {
  const label = shortTargetLabel(labelByTarget[targetKey], targetKey);
  const row = (rows || []).find((r) => {
    if (!r || r.targetKey !== targetKey) return false;
    if (r.sourceType === 'constant') return String(r.constantValue ?? '').trim() !== '';
    return !!r.sourceKey && headers.includes(r.sourceKey);
  });
  if (!row) return { label, ok: false, detail: '연결 필요' };
  if (row.sourceType === 'constant') return { label, ok: true, detail: `고정값 "${row.constantValue}"` };
  const col = columnLetter(headers.indexOf(row.sourceKey));
  return { label, ok: true, detail: `${col}열 · ${row.sourceKey}` };
}

export default function ExcelMappingExtras({
  rows = [],
  headers = [],
  targetOptions = [],
  /** [{ key, label? }] */
  requiredTargets = [],
  /** 'all' = 전부 필요(고객사) · 'any' = 하나 이상(연락처: 이름·이메일·전화) */
  requiredMode = 'all',
  requiredHint = '',
  updateRow,
  removeRow,
  addConstantRow,
  disabled = false,
  note = null
}) {
  const hasFile = Array.isArray(headers) && headers.length > 0;
  const labelByTarget = Object.fromEntries((targetOptions || []).map((o) => [o.value, o.label || o.value]));
  const required = requiredTargets.map((t) => ({ key: t.key, ...describeRequired(t.key, rows, headers, labelByTarget) }));
  const missing = required.filter((r) => !r.ok);
  const requiredOk = requiredMode === 'any' ? required.some((r) => r.ok) : missing.length === 0;
  const constantRows = (rows || []).filter((r) => r && r.sourceType === 'constant');

  return (
    <section className="xme">
      {hasFile && required.length > 0 ? (
        <div className={`xme-block ${requiredOk ? 'is-ok' : 'is-missing'}`}>
          <div className="xme-block-head">
            <span className="material-symbols-outlined xme-block-icon">
              {requiredOk ? 'task_alt' : 'error'}
            </span>
            <h4 className="xme-block-title">
              {requiredMode === 'any' ? '필수 연결 (하나 이상)' : '필수 연결'}
            </h4>
            <span className="xme-block-meta">
              {requiredOk
                ? '가져올 준비가 됐습니다'
                : requiredMode === 'any'
                  ? '아래 중 하나 이상을 연결해 주세요'
                  : `${missing.length}개 필드에 맞는 열이 없습니다`}
            </span>
          </div>
          <ul className="xme-chips">
            {required.map((r) => (
              <li key={r.key} className={`xme-chip ${r.ok ? 'is-ok' : 'is-missing'}`}>
                <span className="material-symbols-outlined">{r.ok ? 'check' : 'priority_high'}</span>
                <strong>{r.label}</strong>
                <span className="xme-chip-detail">{r.detail}</span>
              </li>
            ))}
          </ul>
          {!requiredOk ? (
            <p className="xme-hint">
              {requiredHint ||
                '위 미리보기의 열 머리글에서 필드를 고르거나, 파일에 해당 열이 없으면 아래에서 고정값으로 넣어 주세요.'}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="xme-block">
        <div className="xme-block-head">
          <span className="material-symbols-outlined xme-block-icon is-muted">push_pin</span>
          <h4 className="xme-block-title">고정값</h4>
          <span className="xme-block-meta">모든 행에 같은 값을 넣습니다</span>
          <button type="button" className="xme-add" onClick={addConstantRow} disabled={disabled}>
            <span className="material-symbols-outlined">add</span>
            추가
          </button>
        </div>

        {constantRows.length === 0 ? (
          <p className="xme-empty">예: 상태를 전부 “lead”로 등록하고 싶을 때 추가하세요.</p>
        ) : (
          <ul className="xme-constants">
            {constantRows.map((row) => (
              <li key={row.id} className="xme-constant">
                <select
                  className="opp-select xme-constant-target"
                  value={row.targetKey || ''}
                  onChange={(e) => updateRow(row.id, { targetKey: e.target.value })}
                  disabled={disabled}
                  aria-label="고정값을 넣을 필드"
                >
                  <option value="">필드 선택…</option>
                  {(targetOptions || []).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {shortTargetLabel(opt.label, opt.value)}
                    </option>
                  ))}
                </select>
                <span className="xme-constant-eq" aria-hidden="true">
                  =
                </span>
                <input
                  className="opp-input xme-constant-value"
                  placeholder="값 입력"
                  value={row.constantValue ?? ''}
                  onChange={(e) => updateRow(row.id, { constantValue: e.target.value })}
                  disabled={disabled}
                  aria-label="고정값"
                />
                <button
                  type="button"
                  className="xme-remove"
                  onClick={() => removeRow(row.id)}
                  disabled={disabled}
                  aria-label="고정값 삭제"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {note ? <p className="xme-note">{note}</p> : null}
    </section>
  );
}
