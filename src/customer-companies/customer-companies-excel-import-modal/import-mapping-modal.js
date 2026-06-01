import AssigneePickerModal from '../../company-overview/assignee-picker-modal/assignee-picker-modal';
import { previewExcelMappedValue } from './excel-import-mapping-utils';
import { rowStatus } from '../../lead-capture/lead-capture-crm-mapping/lead-capture-crm-mapping-utils';
import '../../sales-pipeline/opportunity-modal/opportunity-modal.css';
import '../../shared/excel-import-mapping-modal.css';

export default function ImportMappingModal({
  onClose,
  saving,
  previewChecking,
  inProgressJob,
  onImport,
  excelRows,
  fileInputRef,
  ingestFile,
  dragOver,
  setDragOver,
  onDrop,
  excelFileName,
  targetOptions,
  assigneeInputValue,
  onAssigneeInputChange,
  onOpenAssigneePicker,
  showMeBadge,
  rows,
  sampleRow,
  registerTarget,
  sourceOptions,
  effectiveTargetOptions,
  updateRow,
  removeRow,
  addConstantRow,
  summary,
  saveMsg,
  showAssigneePicker,
  assigneeUserIds,
  assigneeIdToName,
  onCloseAssigneePicker,
  onConfirmAssigneePicker
}) {
  const disabled = saving || previewChecking || !!inProgressJob?.jobId;
  const saveMsgIsError = saveMsg && (saveMsg.includes('실패') || saveMsg.includes('필요'));

  return (
    <div
      className="opp-modal-overlay excel-import-map-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cc-excel-map-title"
    >
      <div className="opp-modal excel-import-map-modal" onClick={(e) => e.stopPropagation()}>
        <div className="opp-modal-header">
          <div className="opp-modal-header-left">
            <h3 className="opp-modal-title" id="cc-excel-map-title">
              엑셀 → 기업 매핑
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
                <h2 className="excel-import-map-intro-title">기업 일괄 등록</h2>
                <p className="excel-import-map-intro-desc">
                  엑셀 <strong>첫 행은 헤더</strong>(열 이름)로 사용됩니다. 각 열을 <strong>기업 필드</strong>에 연결한 뒤{' '}
                  <strong>가져오기</strong>를 누르세요. 대상 필드는 서버 스키마에서 자동으로 불러오며, 커스텀 필드가
                  추가되면 여기에도 반영됩니다.
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
                onDragOver={(e) => {
                  e.preventDefault();
                }}
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
                <p className="excel-import-map-dropzone-hint">.xlsx · .xls · CSV · 최대 500행 (서버 제한)</p>
                {excelFileName ? (
                  <div className="excel-import-map-file-badge">
                    <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>
                      description
                    </span>
                    {excelFileName}
                  </div>
                ) : null}
              </div>

              <p className="excel-import-map-desc">
                미리보기는 <strong>첫 데이터 행</strong> 기준입니다. <strong>가져오기</strong> 후 행별 미리보기가
                끝나면 결과 화면이 뜹니다. 보류는 「이 그룹 적용」을 눌러 즉시 처리 예정 목록으로 옮기고, 마지막{' '}
                <strong>확인</strong>을 눌렀을 때만 MongoDB 등록이 시작됩니다.
              </p>
              <p className="excel-import-map-desc excel-import-map-desc--tight">
                필수 매핑: <strong>사업자 번호, 기업명, 대표자명, 주소</strong>
              </p>
              {targetOptions.length === 0 ? (
                <p className="excel-import-map-warn-meta">대상 필드 API 응답이 비어 기본 필드 목록으로 표시 중입니다.</p>
              ) : null}

              <label className="opp-label excel-import-map-assignee" htmlFor="cc-import-assignee-input">
                <span>담당자</span>
                <div className="excel-import-map-assignee-row">
                  <input
                    id="cc-import-assignee-input"
                    type="text"
                    className="opp-input"
                    placeholder="담당자를 선택해 주세요"
                    value={assigneeInputValue}
                    onChange={(e) => onAssigneeInputChange(e.target.value)}
                    disabled={disabled}
                  />
                  <button
                    type="button"
                    className="excel-import-map-assignee-search"
                    onClick={onOpenAssigneePicker}
                    title="담당자 선택"
                    aria-label="담당자 선택"
                    disabled={disabled}
                  >
                    <span className="material-symbols-outlined">search</span>
                  </button>
                </div>
                {showMeBadge ? <span className="excel-import-map-me-badge">나</span> : null}
                <p className="excel-import-map-source-meta">
                  담당자를 선택하지 않으면 로그인한 사용자 본인으로 등록됩니다.
                </p>
              </label>

              <div className="excel-import-map-table-head">
                <div>소스 필드 (엑셀 열)</div>
                <div />
                <div>대상 필드 (기업 CRM)</div>
                <div>미리보기</div>
                <div style={{ textAlign: 'right' }}>상태</div>
              </div>

              <div className="excel-import-map-rows">
                {rows.map((row) => {
                  const preview = previewExcelMappedValue(sampleRow, row);
                  const status = rowStatus(row, preview, registerTarget);
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
                          <div
                            className="excel-import-map-source-mode-toggle"
                            role="group"
                            aria-label="소스: 엑셀 열 또는 고정값"
                          >
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
                              onClick={() => updateRow(row.id, { sourceType: 'constant' })}
                              disabled={disabled}
                            >
                              고정값
                            </button>
                          </div>
                          {isConst ? (
                            <input
                              className="opp-input excel-import-map-input"
                              placeholder="값 입력…"
                              value={row.constantValue}
                              onChange={(e) => updateRow(row.id, { constantValue: e.target.value })}
                              disabled={disabled}
                            />
                          ) : (
                            <>
                              <select
                                className="opp-select excel-import-map-select"
                                value={row.sourceKey}
                                onChange={(e) => updateRow(row.id, { sourceKey: e.target.value })}
                                disabled={disabled}
                              >
                                <option value="">소스 선택…</option>
                                {sourceOptions.map((source) => (
                                  <option key={source.key} value={source.key}>
                                    {source.label}
                                  </option>
                                ))}
                              </select>
                              <p className="excel-import-map-source-meta">
                                {sourceOptions.find((item) => item.key === row.sourceKey)?.meta || ''}
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="excel-import-map-connector-wrap">
                        <div className="excel-import-map-connector" />
                      </div>
                      <div>
                        <select
                          className="opp-select excel-import-map-select"
                          value={row.targetKey}
                          onChange={(e) => updateRow(row.id, { targetKey: e.target.value })}
                          disabled={disabled}
                        >
                          <option value="">대상 선택…</option>
                          {effectiveTargetOptions.map((target) => (
                            <option key={target.value} value={target.value}>
                              {target.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="excel-import-map-preview">
                        <span className="material-symbols-outlined">visibility</span>
                        <span>{preview || '—'}</span>
                      </div>
                      <div className="excel-import-map-status">
                        <span
                          className={`excel-import-map-badge ${status.type === 'ok' ? 'ok' : status.type === 'warn' ? 'warn' : status.type === 'err' ? 'err' : 'muted'}`}
                        >
                          {status.type === 'ok' && <span className="material-symbols-outlined">check_circle</span>}
                          {status.type === 'warn' && <span className="material-symbols-outlined">priority_high</span>}
                          {status.type === 'err' && <span className="material-symbols-outlined">error</span>}
                          {status.label}
                        </span>
                        {rows.length > 1 && (
                          <button
                            type="button"
                            className="excel-import-map-row-delete"
                            onClick={() => removeRow(row.id)}
                            aria-label="행 삭제"
                            disabled={disabled}
                          >
                            <span className="material-symbols-outlined">delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="excel-import-map-footer-card">
                <div className="excel-import-map-footer-hint">
                  <div className="excel-import-map-footer-icon">
                    <span className="material-symbols-outlined">lightbulb</span>
                  </div>
                  <div>
                    <p>동적 필드 · 소스 전환</p>
                    <span>
                      기업 스키마·커스텀 필드 정의는 API에서 가져옵니다. 각 매핑 행에서 <strong>엑셀 열</strong>과{' '}
                      <strong>고정값</strong>을 전환할 수 있어, 같은 행에서 엑셀 소스 선택과 수기 입력을 골라 쓸 수
                      있습니다.
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="excel-import-map-btn-add"
                  onClick={addConstantRow}
                  disabled={disabled}
                  title="기본은 고정값이며, 각 행에서 엑셀 열로 바꿀 수 있습니다."
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '1.15rem' }}>
                    add
                  </span>
                  매핑 행 추가
                </button>
              </div>

              <div className="excel-import-map-summary">
                <div className="excel-import-map-summary-card">
                  <p>매핑된 대상</p>
                  <p className="num">
                    {summary.mapped} / {rows.length}
                  </p>
                  <div className="excel-import-map-bar">
                    <div style={{ width: `${rows.length ? Math.min(100, (summary.mapped / rows.length) * 100) : 0}%` }} />
                  </div>
                </div>
                <div className="excel-import-map-summary-card">
                  <p>주의</p>
                  <p className="num rose">{summary.err}</p>
                  <p className="sub">미리보기 = 첫 데이터 행</p>
                </div>
                <div className="excel-import-map-summary-card">
                  <p>등록</p>
                  <p className="num" style={{ fontSize: '1rem' }}>
                    기업만
                  </p>
                  <p className="sub">DB와 상호·사업자번호가 같아도 신규 등록</p>
                </div>
              </div>

              {saveMsg ? (
                <p className={`excel-import-map-save-msg ${saveMsgIsError ? 'err' : ''}`}>{saveMsg}</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="opp-modal-footer">
          <button type="button" className="opp-cancel-btn" onClick={onClose} disabled={disabled}>
            <span className="material-symbols-outlined">close</span>
            취소
          </button>
          <button type="button" className="opp-save-btn" onClick={onImport} disabled={disabled}>
            <span className="material-symbols-outlined">play_arrow</span>
            {saving ? '처리 중…' : '가져오기'}
          </button>
        </div>
      </div>

      {showAssigneePicker ? (
        <AssigneePickerModal
          open={showAssigneePicker}
          onClose={onCloseAssigneePicker}
          selectedIds={assigneeUserIds || []}
          onConfirm={onConfirmAssigneePicker}
        />
      ) : null}
    </div>
  );
}
