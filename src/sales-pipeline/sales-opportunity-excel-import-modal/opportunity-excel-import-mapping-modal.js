import { previewExcelMappedValue } from '../../customer-companies/customer-companies-excel-import-modal/excel-import-mapping-utils';
import { opportunityMappingRowStatus } from './opportunity-excel-import-utils';
import '../../sales-pipeline/opportunity-modal/opportunity-modal.css';
import '../../shared/excel-import-mapping-modal.css';
import './opportunity-excel-import.css';

export default function OpportunityExcelImportMappingModal({
  onClose,
  saving,
  onProceed,
  excelRows,
  fileInputRef,
  ingestFile,
  dragOver,
  setDragOver,
  onDrop,
  excelFileName,
  targetOptions,
  rows,
  sampleRow,
  sourceOptions,
  effectiveTargetOptions,
  updateRow,
  removeRow,
  addConstantRow,
  summary,
  saveMsg,
  mappingReady
}) {
  const disabled = saving;
  const saveMsgIsError = saveMsg && (saveMsg.includes('실패') || saveMsg.includes('필요') || saveMsg.includes('누락') || saveMsg.includes('수정'));

  return (
    <div
      className="opp-modal-overlay excel-import-map-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sp-excel-map-title"
    >
      <div className="opp-modal excel-import-map-modal" onClick={(e) => e.stopPropagation()}>
        <div className="opp-modal-header">
          <div className="opp-modal-header-left">
            <h3 className="opp-modal-title" id="sp-excel-map-title">
              엑셀 → 영업 기회 매핑
            </h3>
            <span className="excel-import-map-badge excel-import-map-badge--tag">Excel</span>
            <span className="excel-import-map-badge excel-import-map-badge--count" title="업로드된 행 수">
              {excelRows.length > 0 ? `${excelRows.length}행` : '파일 없음'}
            </span>
          </div>
          <button type="button" className="opp-modal-close" onClick={onClose} disabled={disabled} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="opp-modal-form excel-import-map-form">
          <div className="opp-modal-form-layout excel-import-map-form-layout">
            <div className="opp-modal-form-main excel-import-map-form-main">
              <div className="excel-import-map-intro">
                <h2 className="excel-import-map-intro-title">영업 기회 일괄 등록</h2>
                <p className="excel-import-map-intro-desc">
                  엑셀 <strong>첫 행은 헤더</strong>입니다. 각 열을 <strong>기회 필드</strong>에 연결한 뒤{' '}
                  <strong>엑셀 미리보기</strong>로 이동해 원본 표를 확인·수정하고, 이어서 <strong>검증·등록</strong>을
                  진행하세요.
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
                className={`excel-import-map-dropzone ${dragOver ? 'is-dragover' : ''}`}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
              >
                <span className="material-symbols-outlined excel-import-map-dropzone-icon">cloud_upload</span>
                <p className="excel-import-map-dropzone-title">엑셀 파일을 여기에 놓거나 클릭하여 선택</p>
                <p className="excel-import-map-dropzone-hint">.xlsx · .xls · CSV · 행이 많으면 등록에 시간이 걸릴 수 있습니다</p>
                {excelFileName ? (
                  <div className="excel-import-map-file-badge">
                    <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>
                      description
                    </span>
                    {excelFileName}
                  </div>
                ) : null}
              </div>

              <div className="excel-import-map-table-head">
                <div>소스 필드 (엑셀 열)</div>
                <div />
                <div>대상 필드 (영업 기회)</div>
                <div>미리보기</div>
                <div style={{ textAlign: 'right' }}>상태</div>
              </div>

              <div className="excel-import-map-rows">
                {rows.map((row) => {
                  const preview = previewExcelMappedValue(sampleRow, row);
                  const status = opportunityMappingRowStatus(row, preview);
                  const isConst = row.sourceType === 'constant';
                  return (
                    <div key={row.id} className={`excel-import-map-row ${isConst ? 'is-constant' : ''}`}>
                      <div className="excel-import-map-source-cell">
                        <div className="excel-import-map-icon-box">
                          <span className="material-symbols-outlined" style={{ fontSize: '1.15rem' }}>
                            {isConst ? 'add_circle' : 'input'}
                          </span>
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="excel-import-map-source-mode-toggle" role="group">
                            <button
                              type="button"
                              className={!isConst ? 'is-active' : ''}
                              onClick={() => updateRow(row.id, { sourceType: 'field' })}
                              disabled={disabled}
                            >
                              엑셀 열
                            </button>
                            <button
                              type="button"
                              className={isConst ? 'is-active' : ''}
                              onClick={() => updateRow(row.id, { sourceType: 'constant', sourceKey: '' })}
                              disabled={disabled}
                            >
                              고정값
                            </button>
                          </div>
                          {isConst ? (
                            <input
                              type="text"
                              className="opp-input"
                              value={row.constantValue ?? ''}
                              onChange={(e) => updateRow(row.id, { constantValue: e.target.value })}
                              disabled={disabled}
                              placeholder="모든 행에 동일하게 넣을 값"
                            />
                          ) : (
                            <select
                              className="opp-input"
                              value={row.sourceKey || ''}
                              onChange={(e) => updateRow(row.id, { sourceKey: e.target.value })}
                              disabled={disabled || !sourceOptions.length}
                            >
                              <option value="">열 선택…</option>
                              {sourceOptions.map((opt) => (
                                <option key={opt.key} value={opt.key}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                      <div className="excel-import-map-connector-wrap">
                        <div className="excel-import-map-connector" />
                      </div>
                      <div>
                        <select
                          className="opp-input"
                          value={row.targetKey || ''}
                          onChange={(e) => updateRow(row.id, { targetKey: e.target.value })}
                          disabled={disabled}
                        >
                          <option value="">대상 필드…</option>
                          {effectiveTargetOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="excel-import-map-preview">
                        <span className="material-symbols-outlined">visibility</span>
                        {preview || '—'}
                      </div>
                      <div className="excel-import-map-status">
                        <span className={`excel-import-map-badge ${status.type}`}>{status.label}</span>
                        <button
                          type="button"
                          className="excel-import-map-row-delete"
                          onClick={() => removeRow(row.id)}
                          disabled={disabled}
                          aria-label="매핑 행 삭제"
                        >
                          <span className="material-symbols-outlined">delete</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="excel-import-map-footer-card">
                <div className="excel-import-map-footer-hint">
                  <div className="excel-import-map-footer-icon">
                    <span className="material-symbols-outlined">info</span>
                  </div>
                  <div>
                    <p>필수: 제목 · 단계</p>
                    <span>
                      다음 <strong>엑셀 미리보기</strong> 창에서 셀을 고칠 수 있습니다. 검증 단계에서 단계·통화 등 목록
                      불일치 시 <strong style={{ color: '#b91c1c' }}>붉은색</strong> — 모두 수정 후 등록합니다.
                    </span>
                  </div>
                </div>
                <button type="button" className="excel-import-map-btn-add" onClick={addConstantRow} disabled={disabled}>
                  <span className="material-symbols-outlined">add</span>고정값 행 추가
                </button>
              </div>

              <div className="excel-import-map-summary">
                <div className="excel-import-map-summary-card">
                  <span>매핑됨</span>
                  <strong>{summary.mapped}</strong>
                </div>
                <div className="excel-import-map-summary-card">
                  <span>오류·필수 누락</span>
                  <strong>{summary.err}</strong>
                </div>
                <div className="excel-import-map-summary-card">
                  <span>대상 필드 수</span>
                  <strong>{summary.totalOpt}</strong>
                </div>
              </div>

              {saveMsg ? (
                <p className={`excel-import-map-save-msg ${saveMsgIsError ? 'is-error' : ''}`}>{saveMsg}</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="opp-modal-footer opp-excel-import-footer">
          <button
            type="button"
            className="opp-excel-footer-btn opp-excel-footer-btn--ghost"
            onClick={onClose}
            disabled={disabled}
          >
            취소
          </button>
          <button
            type="button"
            className="opp-excel-footer-btn opp-excel-footer-btn--next"
            disabled={disabled || !mappingReady}
            title={!mappingReady ? '제목·단계 매핑과 엑셀 파일을 완료해 주세요' : undefined}
            onClick={onProceed}
          >
            <span className="material-symbols-outlined" aria-hidden>
              table_view
            </span>
            엑셀 미리보기
          </button>
        </div>
      </div>
    </div>
  );
}
