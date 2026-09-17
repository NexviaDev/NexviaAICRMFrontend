/**
 * 업로드한 엑셀을 스프레드시트 형태로 보여 주는 공용 미리보기.
 *
 * 기존에는 매핑 행마다 "첫 데이터 행의 값" 하나만 텍스트로 보여 줘서
 * 파일이 실제로 어떻게 생겼는지, 어떤 열이 버려지는지 알 수 없었습니다.
 * 여기서는 열 단위로 대상 필드 연결 상태를 함께 보여 줍니다.
 */
import { useMemo } from 'react';
import { isMetaHeaderKey } from './excel-header-match';
import './excel-sheet-preview.css';

const DEFAULT_MAX_ROWS = 6;

/** 0 → A, 25 → Z, 26 → AA */
export function columnLetter(index) {
  let n = Number(index);
  if (!Number.isFinite(n) || n < 0) return '';
  let out = '';
  n += 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * "고객사 · 사업자번호 (하이픈 자동)" → "사업자번호"
 * 칩 안에 들어갈 짧은 라벨.
 */
export function shortTargetLabel(label, fallback = '') {
  const raw = String(label || '').trim();
  if (!raw) return fallback;
  const afterPrefix = raw.includes('·') ? raw.slice(raw.lastIndexOf('·') + 1) : raw;
  return afterPrefix.replace(/\s*[(（][^)）]*[)）]\s*$/, '').trim() || fallback;
}

function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'object') return '[객체]';
  return String(value);
}

export default function ExcelSheetPreview({
  headers = [],
  rows = [],
  /** header → targetKey. 매핑되지 않은 열은 키가 없거나 '' */
  mappingByHeader = {},
  /** [{ value, label }] — 헤더에서 직접 매핑을 바꿀 때 쓰는 선택지 */
  targetOptions = [],
  /** (header, targetKey) => void. 주면 헤더가 선택 가능해집니다. */
  onMapHeader,
  maxRows = DEFAULT_MAX_ROWS,
  disabled = false,
  title = '업로드 미리보기',
  emptyHint = '엑셀 파일을 올리면 여기에 내용이 표시됩니다.'
}) {
  const visibleHeaders = useMemo(
    () => (Array.isArray(headers) ? headers : []).filter((h) => h != null && !isMetaHeaderKey(String(h))),
    [headers]
  );

  const visibleRows = useMemo(
    () => (Array.isArray(rows) ? rows : []).slice(0, Math.max(1, maxRows)),
    [rows, maxRows]
  );

  const labelByTarget = useMemo(() => {
    const map = {};
    (targetOptions || []).forEach((opt) => {
      if (opt && opt.value) map[opt.value] = opt.label || opt.value;
    });
    return map;
  }, [targetOptions]);

  const mappedCount = useMemo(
    () => visibleHeaders.filter((h) => mappingByHeader[h]).length,
    [visibleHeaders, mappingByHeader]
  );

  if (!visibleHeaders.length) {
    return (
      <section className="xls-preview xls-preview--empty">
        <div className="xls-preview-empty-inner">
          <span className="material-symbols-outlined">table_view</span>
          <p>{emptyHint}</p>
        </div>
      </section>
    );
  }

  const totalRows = Array.isArray(rows) ? rows.length : 0;
  const unmappedCount = visibleHeaders.length - mappedCount;
  const interactive = typeof onMapHeader === 'function';

  return (
    <section className="xls-preview" aria-label={title}>
      <header className="xls-preview-bar">
        <div className="xls-preview-bar-left">
          <span className="material-symbols-outlined xls-preview-bar-icon">table_view</span>
          <h4 className="xls-preview-title">{title}</h4>
          <span className="xls-preview-scope">
            상위 {visibleRows.length}행 <span className="xls-preview-scope-sep">/</span> 총{' '}
            {totalRows.toLocaleString()}행
          </span>
        </div>
        <div className="xls-preview-legend">
          <span className="xls-preview-legend-item is-mapped">
            <i aria-hidden="true" />
            매핑됨 {mappedCount}
          </span>
          <span className="xls-preview-legend-item is-unmapped">
            <i aria-hidden="true" />
            미매핑 {unmappedCount}
          </span>
        </div>
      </header>

      <div className="xls-preview-scroll">
        <table className="xls-preview-table">
          <thead>
            <tr className="xls-preview-colrow">
              {/* 프로젝트에 .visually-hidden 유틸이 없어 텍스트 대신 aria-label 로 이름을 답니다. */}
              <th className="xls-preview-corner" scope="col" aria-label="행 번호" />
              {visibleHeaders.map((header, i) => (
                <th
                  key={`col-${header}-${i}`}
                  scope="col"
                  className={`xls-preview-colhead ${mappingByHeader[header] ? 'is-mapped' : 'is-unmapped'}`}
                >
                  <span className="xls-preview-colletter">{columnLetter(i)}</span>
                  <span className="xls-preview-colname" title={String(header)}>
                    {String(header)}
                  </span>
                  {interactive ? (
                    <div className="xls-preview-colmap">
                      <span className="material-symbols-outlined xls-preview-colmap-arrow">
                        subdirectory_arrow_right
                      </span>
                      <select
                        className="xls-preview-colmap-select"
                        value={mappingByHeader[header] || ''}
                        disabled={disabled}
                        aria-label={`${header} 열을 연결할 대상 필드`}
                        onChange={(e) => onMapHeader(header, e.target.value)}
                      >
                        <option value="">가져오지 않음</option>
                        {(targetOptions || []).map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {shortTargetLabel(opt.label, opt.value)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <span
                      className={`xls-preview-colchip ${mappingByHeader[header] ? '' : 'is-skip'}`}
                    >
                      {mappingByHeader[header]
                        ? shortTargetLabel(labelByTarget[mappingByHeader[header]], mappingByHeader[header])
                        : '가져오지 않음'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIdx) => (
              <tr key={`row-${rowIdx}`}>
                <th scope="row" className="xls-preview-rownum">
                  {rowIdx + 1}
                </th>
                {visibleHeaders.map((header, colIdx) => {
                  const text = cellText(row?.[header]);
                  return (
                    <td
                      key={`cell-${rowIdx}-${colIdx}`}
                      className={`xls-preview-cell ${mappingByHeader[header] ? 'is-mapped' : 'is-unmapped'} ${
                        text.trim() === '' ? 'is-blank' : ''
                      }`}
                      title={text}
                    >
                      {text.trim() === '' ? <span className="xls-preview-blank">—</span> : text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalRows > visibleRows.length ? (
        <p className="xls-preview-more">
          아래 {(totalRows - visibleRows.length).toLocaleString()}행은 화면에 표시되지 않지만 모두 가져옵니다.
        </p>
      ) : null}
    </section>
  );
}
