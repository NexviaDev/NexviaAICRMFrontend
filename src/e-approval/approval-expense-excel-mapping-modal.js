import { useEffect, useMemo, useRef, useState } from 'react';
import { formatNumberInput } from '@/lib/sales-opportunity-form-shared';
import { readSpreadsheetFileToRows } from '@/lib/spreadsheet-file-read';
import {
  buildExcelSourceOptions,
  normalizeExcelHeaderKey,
  previewExcelMappedValue,
  readExcelMappedCell
} from '@/customer-companies/customer-companies-excel-import-modal/excel-import-mapping-utils';
import { toExpenseDateTimeValue } from './approval-expense-utils';
import { normalizeExpenseColumnTemplateColumns } from './approval-expense-column-template';
import '../sales-pipeline/opportunity-modal/opportunity-modal.css';
import '../shared/excel-import-mapping-modal.css';

function newRowId() {
  return `expense-map-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultMappingRows() {
  return [];
}

function buildDefaultRows(targetOptions) {
  return targetOptions.map((target) => ({
    id: newRowId(),
    sourceType: 'field',
    sourceKey: '',
    constantValue: '',
    targetKey: target.value
  }));
}

function guessSourceKey(headers, targetKey) {
  const normalizedHeaders = headers.map((h) => ({
    raw: h,
    norm: normalizeExcelHeaderKey(h)
  }));
  const aliases = {
    expenseDate: ['날짜', '지출일', '사용일', 'date', 'expense_date'],
    amount: ['금액', '지출금액', '총액', 'amount', 'price'],
    category: ['분류', '항목', '카테고리', 'category', 'type'],
    content: ['내용', '내역', '설명', 'content', 'description'],
    user: ['사용자', '담당자', '작성자', 'user', 'assignee'],
    note: ['비고', '메모', 'note', 'memo']
  };
  const wants = (aliases[targetKey] || []).map((v) => normalizeExcelHeaderKey(v));
  const hit = normalizedHeaders.find((h) => wants.includes(h.norm));
  return hit ? String(hit.raw) : '';
}

function rowStatus(row, preview) {
  if (!row.targetKey) return { type: 'err', label: '대상 없음' };
  if (row.sourceType === 'constant') {
    return String(row.constantValue || '').trim() ? { type: 'ok', label: 'VALID' } : { type: 'warn', label: '값 입력' };
  }
  if (!row.sourceKey) return { type: 'warn', label: '소스 선택' };
  return String(preview || '').trim() ? { type: 'ok', label: 'VALID' } : { type: 'muted', label: '빈 값' };
}

function placeholderForTarget(target) {
  if (!target) return '';
  if (target.type === 'date') return 'YYYY-MM-DD HH:mm';
  if (target.type === 'amount') return '0';
  return target.label || target.value;
}

function normalizeImportedField(target, raw) {
  if (!target) return '';
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return '';
  if (target.type === 'date') return toExpenseDateTimeValue(v);
  if (target.type === 'amount') return formatNumberInput(v);
  return v;
}

export default function ApprovalExpenseExcelMappingModal({
  open,
  onClose,
  onImport,
  saving = false,
  columnTemplateColumns
}) {
  const targetOptions = useMemo(
    () => normalizeExpenseColumnTemplateColumns(columnTemplateColumns)
      .filter((c) => c.enabled !== false)
      .map((c) => ({ value: c.key, label: c.label, type: c.type })),
    [columnTemplateColumns]
  );
  const targetByKey = useMemo(
    () => new Map(targetOptions.map((o) => [o.value, o])),
    [targetOptions]
  );
  const fileInputRef = useRef(null);
  const [excelRows, setExcelRows] = useState([]);
  const [excelFileName, setExcelFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [rows, setRows] = useState(defaultMappingRows);
  const [saveMsg, setSaveMsg] = useState('');

  const sourceOptions = useMemo(() => {
    const headers = Object.keys(excelRows[0] || {});
    return buildExcelSourceOptions(headers);
  }, [excelRows]);

  const sampleRow = excelRows[0] || {};
  const mappedCount = rows.filter((r) => r.targetKey && ((r.sourceType === 'constant' && String(r.constantValue || '').trim()) || (r.sourceType !== 'constant' && r.sourceKey))).length;

  useEffect(() => {
    if (!open) return;
    setRows((prev) => {
      const next = prev
        .map((r) => (targetByKey.has(r.targetKey) ? r : { ...r, targetKey: '' }))
        .filter((r) => r.targetKey || r.sourceType === 'constant');
      if (next.length > 0) return next;
      return buildDefaultRows(targetOptions);
    });
  }, [open, targetByKey, targetOptions]);

  const syncGuessedSource = (headers) => {
    const next = rows.map((r) => {
      if (r.sourceType !== 'field') return r;
      if (r.sourceKey) return r;
      const guessed = guessSourceKey(headers, r.targetKey);
      return guessed ? { ...r, sourceKey: guessed } : r;
    });
    setRows(next);
  };

  const ingestFile = async (file) => {
    setSaveMsg('');
    try {
      const parsed = await readSpreadsheetFileToRows(file);
      if (!parsed.length) {
        setExcelRows([]);
        setExcelFileName(file?.name || '');
        setSaveMsg('엑셀 데이터 행이 없습니다.');
        return;
      }
      setExcelRows(parsed);
      setExcelFileName(file?.name || '');
      syncGuessedSource(Object.keys(parsed[0] || {}));
    } catch (e) {
      setSaveMsg(e?.message || '엑셀을 읽지 못했습니다.');
    }
  };

  const onDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) await ingestFile(file);
  };

  const updateRow = (id, patch) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addConstantRow = () => {
    setRows((prev) => [
      ...prev,
      { id: newRowId(), sourceType: 'constant', sourceKey: '', constantValue: '', targetKey: '' }
    ]);
  };

  const removeRow = (id) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  };

  const handleImport = () => {
    setSaveMsg('');
    if (!excelRows.length) {
      setSaveMsg('먼저 엑셀 파일을 업로드해 주세요.');
      return;
    }
    const activeRows = rows.filter((r) => r.targetKey && (r.sourceType === 'constant' || r.sourceKey));
    if (!activeRows.length) {
      setSaveMsg('최소 1개 이상 매핑이 필요합니다.');
      return;
    }

    const mapped = excelRows
      .map((excelRow) => {
        const line = {
          expenseDate: '',
          amount: '',
          category: '',
          content: '',
          user: '',
          note: '',
          customValues: {}
        };
        activeRows.forEach((r) => {
          const rawVal = r.sourceType === 'constant'
            ? r.constantValue
            : readExcelMappedCell(excelRow, r.sourceKey);
          const target = targetByKey.get(r.targetKey);
          if (!target) return;
          const normalized = normalizeImportedField(target, rawVal);
          if (['expenseDate', 'amount', 'category', 'content', 'user', 'note'].includes(target.value)) {
            line[target.value] = normalized;
          } else {
            line.customValues[target.value] = normalized;
          }
        });
        return line;
      })
      .filter((line) => (
        Object.entries(line).some(([k, v]) => (
          k === 'customValues'
            ? Object.values(v || {}).some((x) => String(x || '').trim())
            : String(v || '').trim()
        ))
      ));

    if (!mapped.length) {
      setSaveMsg('가져올 지출 행이 없습니다. 매핑/값을 확인해 주세요.');
      return;
    }
    onImport?.(mapped);
    onClose?.();
  };

  if (!open) return null;

  const disabled = saving;
  const saveMsgIsError = Boolean(saveMsg);

  return (
    <div className="opp-modal-overlay excel-import-map-overlay" role="dialog" aria-modal="true" aria-labelledby="expense-excel-map-title">
      <div className="opp-modal excel-import-map-modal" onClick={(e) => e.stopPropagation()}>
        <div className="opp-modal-header">
          <div className="opp-modal-header-left">
            <h3 className="opp-modal-title" id="expense-excel-map-title">엑셀 → 지출결의서 매핑</h3>
            <span className="excel-import-map-badge excel-import-map-badge--tag">Excel</span>
            <span className="excel-import-map-badge excel-import-map-badge--count">
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
                <h2 className="excel-import-map-intro-title">지출 항목 일괄 가져오기</h2>
                <p className="excel-import-map-intro-desc">
                  엑셀 첫 행은 헤더로 사용됩니다. 회사별 지출 컬럼 템플릿에 맞춰 열을 연결한 뒤 가져오세요.
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
                onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={(e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
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
                <p className="excel-import-map-dropzone-title">엑셀 파일을 놓거나 클릭하여 선택</p>
                <p className="excel-import-map-dropzone-hint">.xlsx · .xls · CSV</p>
                {excelFileName ? (
                  <div className="excel-import-map-file-badge">
                    <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>description</span>
                    {excelFileName}
                  </div>
                ) : null}
              </div>

              <div className="excel-import-map-table-head">
                <div>소스 필드 (엑셀 열)</div>
                <div />
                <div>대상 필드 (지출)</div>
                <div>미리보기</div>
                <div style={{ textAlign: 'right' }}>상태</div>
              </div>

              <div className="excel-import-map-rows">
                {rows.map((row) => {
                  const preview = previewExcelMappedValue(sampleRow, row);
                  const status = rowStatus(row, preview);
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
                          <div className="excel-import-map-source-mode-toggle" role="group" aria-label="소스 방식">
                            <button type="button" className={!isConst ? 'is-active' : ''} onClick={() => updateRow(row.id, { sourceType: 'field' })} disabled={disabled}>엑셀 열</button>
                            <button type="button" className={isConst ? 'is-active' : ''} onClick={() => updateRow(row.id, { sourceType: 'constant' })} disabled={disabled}>고정값</button>
                          </div>
                          {isConst ? (
                            <input
                              className="opp-input excel-import-map-input"
                              placeholder={placeholderForTarget(targetByKey.get(row.targetKey)) || '값 입력…'}
                              value={row.constantValue}
                              onChange={(e) => updateRow(row.id, { constantValue: e.target.value })}
                              disabled={disabled}
                            />
                          ) : (
                            <select
                              className="opp-select excel-import-map-select"
                              value={row.sourceKey}
                              onChange={(e) => updateRow(row.id, { sourceKey: e.target.value })}
                              disabled={disabled}
                            >
                              <option value="">소스 선택…</option>
                              {sourceOptions.map((source) => (
                                <option key={source.key} value={source.key}>{source.label}</option>
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
                          className="opp-select excel-import-map-select"
                          value={row.targetKey}
                          onChange={(e) => updateRow(row.id, { targetKey: e.target.value })}
                          disabled={disabled}
                        >
                          <option value="">대상 선택…</option>
                          {targetOptions.map((target) => (
                            <option key={target.value} value={target.value}>{target.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="excel-import-map-preview">
                        <span className="material-symbols-outlined">visibility</span>
                        <span>{preview || '—'}</span>
                      </div>
                      <div className="excel-import-map-status">
                        <span className={`excel-import-map-badge ${status.type === 'ok' ? 'ok' : status.type === 'warn' ? 'warn' : status.type === 'err' ? 'err' : 'muted'}`}>
                          {status.label}
                        </span>
                        {rows.length > 1 ? (
                          <button
                            type="button"
                            className="excel-import-map-row-delete"
                            onClick={() => removeRow(row.id)}
                            aria-label="행 삭제"
                            disabled={disabled}
                          >
                            <span className="material-symbols-outlined">delete</span>
                          </button>
                        ) : null}
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
                    <p>매핑 가이드</p>
                    <span>현재 회사 템플릿 컬럼에 맞춰 매핑하면 행 단위로 가져옵니다.</span>
                  </div>
                </div>
                <button type="button" className="excel-import-map-btn-add" onClick={addConstantRow} disabled={disabled}>
                  <span className="material-symbols-outlined" style={{ fontSize: '1.15rem' }}>add</span>
                  매핑 행 추가
                </button>
              </div>

              <div className="excel-import-map-summary">
                <div className="excel-import-map-summary-card">
                  <p>매핑된 대상</p>
                  <p className="num">{mappedCount} / {rows.length}</p>
                </div>
                <div className="excel-import-map-summary-card">
                  <p>가져올 행</p>
                  <p className="num">{excelRows.length}</p>
                </div>
                <div className="excel-import-map-summary-card">
                  <p>형식</p>
                  <p className="num" style={{ fontSize: '1rem' }}>지출결의서</p>
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
          <button type="button" className="opp-save-btn" onClick={handleImport} disabled={disabled}>
            <span className="material-symbols-outlined">play_arrow</span>
            {saving ? '처리 중…' : '가져오기'}
          </button>
        </div>
      </div>
    </div>
  );
}
