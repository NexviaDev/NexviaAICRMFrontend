import { previewExcelMappedValue } from '../../customer-companies/customer-companies-excel-import-modal/excel-import-mapping-utils';
import { PRODUCT_TARGET_OPTIONS_FALLBACK, productRowStatus } from './product-excel-import-utils';

export default function ProductImportMappingModal({
  onClose,
  saving,
  onImport,
  excelRows,
  fileInputRef,
  ingestFile,
  dragOver,
  setDragOver,
  onDrop,
  excelFileName,
  targetOptions,
  sourceOptions = [],
  rows,
  sampleRow,
  updateRow,
  removeRow,
  addConstantRow,
  summary,
  saveMsg
}) {
  const disabled = saving;
  const saveMsgIsError = saveMsg && (saveMsg.includes('실패') || saveMsg.includes('필요'));
  const effectiveTargets =
    Array.isArray(targetOptions) && targetOptions.length > 0 ? targetOptions : PRODUCT_TARGET_OPTIONS_FALLBACK;
  const baseTargets = effectiveTargets.filter((t) => t?.value && !String(t.value).startsWith('product.customFields'));
  const customTargets = effectiveTargets.filter((t) => t?.value && String(t.value).startsWith('product.customFields'));

  return (
    <div className="lc-crm-map-overlay" role="dialog" aria-modal="true" aria-labelledby="pl-excel-map-title">
      <div className="lc-crm-map-panel" onClick={(e) => e.stopPropagation()}>
        <header className="lc-crm-map-head">
          <div className="lc-crm-map-head-left">
            <button
              type="button"
              className="lc-crm-map-btn-discard"
              onClick={onClose}
              aria-label="뒤로"
              disabled={disabled}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '1.25rem', verticalAlign: 'middle' }}>
                arrow_back
              </span>
            </button>
            <h2 id="pl-excel-map-title">엑셀 → 제품 매핑</h2>
            <span className="lc-crm-map-draft">Excel</span>
            <span className="lc-crm-map-lead-count" title="업로드된 행 수">
              {excelRows.length > 0 ? `${excelRows.length}행` : '파일 없음'}
            </span>
          </div>
          <div className="lc-crm-map-head-actions">
            <button type="button" className="lc-crm-map-btn-discard" onClick={onClose} disabled={disabled}>
              닫기
            </button>
            <button type="button" className="lc-crm-map-btn-save" onClick={onImport} disabled={disabled}>
              <span className="material-symbols-outlined" style={{ fontSize: '1.1rem' }}>
                play_arrow
              </span>
              {saving ? '등록 중…' : '가져오기'}
            </button>
          </div>
        </header>

        <div className="lc-crm-map-body">
          <div className="lc-crm-map-title-block">
            <h1>제품 일괄 등록</h1>
            <p className="lc-crm-map-lead-hint">
              엑셀 <strong>첫 행은 헤더</strong>(열 이름)로 사용됩니다. 각 열을 <strong>제품 필드</strong>에 연결한 뒤{' '}
              <strong>가져오기</strong>를 누르세요. 커스텀 필드는 정의에 맞춰 대상 목록에 표시됩니다.
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            className="visually-hidden"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void ingestFile(file);
              e.target.value = '';
            }}
          />

          <div
            role="button"
            tabIndex={0}
            className={`cc-excel-dropzone ${dragOver ? 'is-dragover' : ''}`}
            onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            <span className="material-symbols-outlined cc-excel-dropzone-icon">cloud_upload</span>
            <p className="cc-excel-dropzone-title">엑셀 파일을 여기에 놓거나 클릭하여 선택</p>
            <p className="cc-excel-dropzone-hint">.xlsx · .xls · CSV · 최대 {500}행 권장</p>
            {excelFileName ? (
              <div className="cc-excel-file-badge">
                <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>
                  description
                </span>
                {excelFileName}
              </div>
            ) : null}
          </div>

          <p className="lc-crm-map-target-desc" style={{ marginBottom: '1rem' }}>
            미리보기는 <strong>첫 데이터 행</strong> 기준입니다. 필수: <strong>제품명</strong> 매핑.
          </p>
          <p className="lc-crm-map-target-desc" style={{ marginTop: '-0.5rem', marginBottom: '1rem' }}>
            대상 필드: <strong>제품명</strong>, <strong>버전</strong>, <strong>결제 주기</strong>,{' '}
            <strong>카테고리·분류</strong>, 코드·가격·통화·상태 등 — 아래에서 열과 연결하세요.
          </p>

          <div className="lc-crm-map-table-head">
            <div>소스 필드 (엑셀 열)</div>
            <div />
            <div>대상 필드 (제품 CRM)</div>
            <div>미리보기</div>
            <div style={{ textAlign: 'right' }}>상태</div>
          </div>

          <div className="lc-crm-map-rows">
            {rows.map((row) => {
              const preview = previewExcelMappedValue(sampleRow, row);
              const status = productRowStatus(row, preview);
              const isConst = row.sourceType === 'constant';
              return (
                <div key={row.id} className={`lc-crm-map-row ${isConst ? 'is-constant' : ''}`}>
                  <div className="lc-crm-map-source-cell">
                    <div className="lc-crm-map-icon-box">
                      <span className="material-symbols-outlined" style={{ fontSize: '1.15rem' }}>
                        {isConst ? 'add_circle' : 'input'}
                      </span>
                    </div>
                    <p>{isConst ? '고정값' : '엑셀 열'}</p>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {isConst ? (
                        <input
                          className="lc-crm-map-input"
                          style={{ marginTop: '0.35rem' }}
                          placeholder="값 입력…"
                          value={row.constantValue}
                          onChange={(e) => updateRow(row.id, { constantValue: e.target.value })}
                        />
                      ) : (
                        <>
                          <select
                            className="lc-crm-map-select"
                            value={row.sourceKey}
                            onChange={(e) => updateRow(row.id, { sourceKey: e.target.value })}
                          >
                            <option value="">소스 선택…</option>
                            {sourceOptions.map((source) => (
                              <option key={source.key} value={source.key}>
                                {source.label}
                              </option>
                            ))}
                          </select>
                          <p className="lc-crm-map-source-meta">
                            {sourceOptions.find((item) => item.key === row.sourceKey)?.meta || ''}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="lc-crm-map-connector-wrap" style={{ display: 'flex', alignItems: 'center' }}>
                    <div className="lc-crm-map-connector" />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <select
                      className="lc-crm-map-select"
                      value={row.targetKey}
                      onChange={(e) => updateRow(row.id, { targetKey: e.target.value })}
                    >
                      <option value="">대상 선택…</option>
                      {baseTargets.length > 0 ? (
                        <optgroup label="제품 기본 필드">
                          {baseTargets.map((target) => (
                            <option key={target.value} value={target.value}>
                              {target.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {customTargets.length > 0 ? (
                        <optgroup label="추가 필드 (커스텀)">
                          {customTargets.map((target) => (
                            <option key={target.value} value={target.value}>
                              {target.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </select>
                  </div>
                  <div className="lc-crm-map-preview">
                    <span className="material-symbols-outlined">visibility</span>
                    <span>{preview || '—'}</span>
                  </div>
                  <div
                    className="lc-crm-map-status"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      gap: '0.35rem',
                      flexWrap: 'wrap'
                    }}
                  >
                    {!isConst && (
                      <span
                        className={`lc-crm-map-badge ${status.type === 'ok' ? 'ok' : status.type === 'warn' ? 'warn' : status.type === 'err' ? 'err' : 'muted'}`}
                      >
                        {status.type === 'ok' && <span className="material-symbols-outlined">check_circle</span>}
                        {status.type === 'warn' && <span className="material-symbols-outlined">priority_high</span>}
                        {status.type === 'err' && <span className="material-symbols-outlined">error</span>}
                        {status.label}
                      </span>
                    )}
                    {rows.length > 1 && (
                      <button
                        type="button"
                        className="lc-crm-map-row-delete"
                        onClick={() => removeRow(row.id)}
                        aria-label="행 삭제"
                      >
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="lc-crm-map-footer-card">
            <div className="lc-crm-map-footer-hint">
              <div className="lc-crm-map-footer-icon">
                <span className="material-symbols-outlined">lightbulb</span>
              </div>
              <div>
                <p>내보내기 양식</p>
                <span>
                  제품 목록의 「내보내기」로 받은 엑셀 열 이름과 맞추면 매핑이 자동으로 잡히는 경우가 많습니다.
                </span>
              </div>
            </div>
            <button type="button" className="lc-crm-map-btn-add-const" onClick={addConstantRow}>
              <span className="material-symbols-outlined" style={{ fontSize: '1.15rem' }}>
                add
              </span>
              고정값 추가
            </button>
          </div>

          <div className="lc-crm-map-summary">
            <div className="lc-crm-map-summary-card">
              <p>매핑된 대상</p>
              <p className="num">
                {summary.mapped} / {rows.length}
              </p>
              <div className="lc-crm-map-bar">
                <div style={{ width: `${rows.length ? Math.min(100, (summary.mapped / rows.length) * 100) : 0}%` }} />
              </div>
            </div>
            <div className="lc-crm-map-summary-card">
              <p>주의</p>
              <p className="num rose">{summary.err}</p>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.65rem', color: '#64748b' }}>
                미리보기 = 첫 데이터 행
              </p>
            </div>
            <div className="lc-crm-map-summary-card">
              <p>등록</p>
              <p className="num" style={{ fontSize: '1rem' }}>
                제품만
              </p>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.65rem', color: '#64748b' }}>
                행마다 POST 저장
              </p>
            </div>
          </div>

          {saveMsg && (
            <p className={`lc-crm-map-save-msg ${saveMsgIsError ? 'err' : ''}`}>
              {saveMsg}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
