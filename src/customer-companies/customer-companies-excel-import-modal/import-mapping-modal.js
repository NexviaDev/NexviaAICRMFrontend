import AssigneePickerModal from '../../company-overview/assignee-picker-modal/assignee-picker-modal';
import { previewExcelMappedValue } from './excel-import-mapping-utils';
import {
  rowStatus
} from '../../lead-capture/lead-capture-crm-mapping/lead-capture-crm-mapping-utils';

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
    <div className="lc-crm-map-overlay" role="dialog" aria-modal="true" aria-labelledby="cc-excel-map-title">
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
            <h2 id="cc-excel-map-title">엑셀 → 고객사 매핑</h2>
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
              {saving ? '처리 중…' : '가져오기'}
            </button>
          </div>
        </header>

        <div className="lc-crm-map-body">
          <div className="lc-crm-map-title-block">
            <h1>고객사 일괄 등록</h1>
            <p className="lc-crm-map-lead-hint">
              엑셀 <strong>첫 행은 헤더</strong>(열 이름)로 사용됩니다. 각 열을 <strong>고객사 필드</strong>에 연결한 뒤{' '}
              <strong>가져오기</strong>를 누르세요. 대상 필드는 서버 스키마에서 자동으로 불러오며, 커스텀 필드가 추가되면
              여기에도 반영됩니다.
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
            <p className="cc-excel-dropzone-hint">.xlsx · .xls · CSV · 최대 500행 (서버 제한)</p>
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
            미리보기는 <strong>첫 데이터 행</strong> 기준입니다. <strong>가져오기</strong> 후 중복 검사가 끝나면 결과 화면이 뜹니다.
            보류는 「이 그룹 적용」을 눌러 즉시 처리 예정 목록으로 옮기고, 마지막 <strong>확인</strong>을 눌렀을 때만 MongoDB 등록이 시작됩니다.
          </p>
          <p className="lc-crm-map-target-desc" style={{ marginTop: '-0.5rem', marginBottom: '1rem' }}>
            필수 매핑: <strong>사업자 번호, 고객사 명, 대표자명, 주소</strong>
          </p>
          {targetOptions.length === 0 && (
            <p className="lc-crm-map-source-meta" style={{ marginTop: '-0.35rem', marginBottom: '0.85rem', color: '#b45309' }}>
              대상 필드 API 응답이 비어 기본 필드 목록으로 표시 중입니다.
            </p>
          )}
          <div className="add-company-field add-company-field-assignee" style={{ marginBottom: '1rem' }}>
            <label className="add-company-label" htmlFor="cc-import-assignee-input">담당자</label>
            <div className="add-company-assignee-input-wrap">
              <input
                id="cc-import-assignee-input"
                type="text"
                className="add-company-input"
                placeholder="담당자를 선택해 주세요"
                value={assigneeInputValue}
                onChange={(e) => onAssigneeInputChange(e.target.value)}
              />
              <button
                type="button"
                className="add-company-assignee-search-icon-btn"
                onClick={onOpenAssigneePicker}
                title="담당자 선택"
                aria-label="담당자 선택"
              >
                <span className="material-symbols-outlined">search</span>
              </button>
            </div>
            {showMeBadge && (
              <div style={{ marginTop: '0.45rem' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    padding: '0.2rem 0.6rem',
                    borderRadius: '999px',
                    background: '#e8f3ff',
                    color: '#295b8c',
                    fontSize: '0.75rem',
                    fontWeight: 700
                  }}
                >
                  나
                </span>
              </div>
            )}
            <p className="lc-crm-map-source-meta" style={{ marginTop: '0.35rem' }}>
              담당자를 선택하지 않으면 로그인한 사용자 본인으로 등록됩니다.
            </p>
          </div>

          <div className="lc-crm-map-table-head">
            <div>소스 필드 (엑셀 열)</div>
            <div />
            <div>대상 필드 (고객사 CRM)</div>
            <div>미리보기</div>
            <div style={{ textAlign: 'right' }}>상태</div>
          </div>

          <div className="lc-crm-map-rows">
            {rows.map((row) => {
              const preview = previewExcelMappedValue(sampleRow, row);
              const status = rowStatus(row, preview, registerTarget);
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
                  <div>
                    <select
                      className="lc-crm-map-select"
                      value={row.targetKey}
                      onChange={(e) => updateRow(row.id, { targetKey: e.target.value })}
                    >
                      <option value="">대상 선택…</option>
                      {effectiveTargetOptions.map((target) => (
                        <option key={target.value} value={target.value}>
                          {target.label}
                        </option>
                      ))}
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
                <p>동적 필드</p>
                <span>
                  고객사 스키마·커스텀 필드 정의는 API에서 가져옵니다. 새 필드를 DB에 추가하면 다음에 모달을 열 때 대상
                  목록에 자동 반영됩니다.
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
                고객사만
              </p>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.65rem', color: '#64748b' }}>
                중복(상호+사업자번호)은 스킵
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
      {showAssigneePicker && (
        <AssigneePickerModal
          open={showAssigneePicker}
          onClose={onCloseAssigneePicker}
          selectedIds={assigneeUserIds || []}
          onConfirm={onConfirmAssigneePicker}
        />
      )}
    </div>
  );
}
