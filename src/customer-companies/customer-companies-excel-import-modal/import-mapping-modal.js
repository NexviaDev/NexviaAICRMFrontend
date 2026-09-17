import AssigneePickerModal from '../../company-overview/assignee-picker-modal/assignee-picker-modal';
import ExcelSheetPreview from '../../shared/excel-sheet-preview';
import ExcelMappingExtras from '../../shared/excel-mapping-extras';
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
  excelHeaders,
  mappingByHeader,
  onMapHeader,
  targetOptions,
  assigneeInputValue,
  onAssigneeInputChange,
  onOpenAssigneePicker,
  showMeBadge,
  rows,
  effectiveTargetOptions,
  /** [{ key, label }] 필수(또는 하나 이상 필요) 대상 필드 */
  requiredTargets = [],
  updateRow,
  removeRow,
  addConstantRow,
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

              <ExcelSheetPreview
                headers={excelHeaders}
                rows={excelRows}
                mappingByHeader={mappingByHeader}
                targetOptions={effectiveTargetOptions}
                onMapHeader={onMapHeader}
                disabled={disabled}
                emptyHint="엑셀 파일을 올리면 열 구성과 내용이 여기에 표시됩니다."
              />

              <ExcelMappingExtras
                rows={rows}
                headers={excelHeaders}
                targetOptions={effectiveTargetOptions}
                requiredTargets={requiredTargets}
                requiredMode="all"
                updateRow={updateRow}
                removeRow={removeRow}
                addConstantRow={addConstantRow}
                disabled={disabled}
                note="사업자번호가 이미 등록돼 있거나 파일 안에서 겹치는 행은 건너뜁니다. 사업자번호가 없는 행은 기업명이 같아도 등록됩니다."
              />

              <p className="excel-import-map-desc">
                열 헤더에서 바로 대상 필드를 바꿀 수 있고, 쓰지 않을 열은{' '}
                <strong>가져오지 않음</strong>으로 두면 됩니다. <strong>가져오기</strong>를 누르면 행별 확인을 거쳐
                결과 화면이 뜨고, 마지막 <strong>확인</strong>을 눌렀을 때만 실제 등록이 시작됩니다.
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
