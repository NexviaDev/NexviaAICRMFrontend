/**
 * 엑셀 셀 수식(A1 스타일) → CRM 수식(=[필드라벨] …) 환산
 * - 같은 행의 열 참조 → 라벨 맵에 있으면 [라벨] (CRM 필드 또는 엑셀 헤더)
 * - $I$1 등 다른 행·절대참조는 그대로 두어 미리보기 「모두 바꾸기」로 처리
 * - 헤더 행 위치(1행/5행 등)는 호출측 파서가 정함 — 이 모듈은 하드코딩하지 않음
 */

const CELL_REF_RE = /(\$?)([A-Za-z]+)(\$?)(\d+)\b/g;

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A → 0, Z → 25, AA → 26 */
export function excelColLettersToIndex(letters) {
  const s = String(letters || '').toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return -1;
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return n - 1;
}

export function excelColIndexToLetters(index) {
  let n = Number(index);
  if (!Number.isFinite(n) || n < 0) return '';
  let s = '';
  n += 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * @param {string} formulaRaw — `=J6*$I$1` 또는 `J6*$I$1`
 * @param {{ excelRow1Based: number, colIndexToLabel: Map<number,string>|Record<number,string> }} ctx
 * @returns {{ ok: boolean, formula: string, convertedCount: number, leftoverRefs: string[] }}
 */
export function convertExcelFormulaToCrm(formulaRaw, ctx = {}) {
  const excelRow1Based = Number(ctx.excelRow1Based);
  const colIndexToLabel =
    ctx.colIndexToLabel instanceof Map
      ? ctx.colIndexToLabel
      : new Map(
          Object.entries(ctx.colIndexToLabel || {}).map(([k, v]) => [Number(k), v])
        );

  let raw = String(formulaRaw ?? '').trim();
  if (!raw) return { ok: false, formula: '', convertedCount: 0, leftoverRefs: [] };

  const hadEq = raw.startsWith('=');
  let expr = hadEq ? raw.slice(1).trim() : raw;
  if (!expr) return { ok: false, formula: '', convertedCount: 0, leftoverRefs: [] };

  let convertedCount = 0;
  const leftoverRefs = [];

  expr = expr.replace(CELL_REF_RE, (full, _absCol, letters, _absRow, rowStr) => {
    const rowNum = Number(rowStr);
    const colIdx = excelColLettersToIndex(letters);
    const sameRow =
      Number.isFinite(excelRow1Based) &&
      excelRow1Based > 0 &&
      Number.isFinite(rowNum) &&
      rowNum === excelRow1Based;

    if (sameRow && colIdx >= 0) {
      const label = colIndexToLabel.get(colIdx);
      if (label) {
        convertedCount += 1;
        return `[${label}]`;
      }
    }
    leftoverRefs.push(full);
    return full;
  });

  return {
    ok: true,
    formula: `=${expr}`,
    convertedCount,
    leftoverRefs: [...new Set(leftoverRefs)]
  };
}

/**
 * 매핑·헤더로 열 인덱스 → CRM 수식 라벨 맵 구성
 * @param {string[]} orderedHeaders — 시트 열 순서대로의 헤더(빈 열은 '')
 * @param {Array<{ sourceType?: string, sourceKey?: string, targetKey?: string }>} mappingRows
 * @param {Array<{ value: string, label: string }>} targetOptions
 * @param {(targetKey: string) => boolean} [isFormulaCapable]
 */
export function buildExcelColIndexToFormulaLabelMap(
  orderedHeaders,
  mappingRows,
  targetOptions = [],
  isFormulaCapable = () => true
) {
  const labelByTarget = new Map(
    (targetOptions || []).map((o) => [String(o.value), String(o.label || o.value).trim()])
  );
  const headerToLabel = new Map();

  for (const row of mappingRows || []) {
    if (row?.sourceType === 'constant') continue;
    const sk = String(row?.sourceKey || '').trim();
    const tk = String(row?.targetKey || '').trim();
    if (!sk || !tk || tk === 'ignore') continue;
    if (!isFormulaCapable(tk)) continue;
    const label = labelByTarget.get(tk) || tk;
    if (!label) continue;
    headerToLabel.set(sk, label);
  }

  const colIndexToLabel = new Map();
  (orderedHeaders || []).forEach((h, idx) => {
    const key = String(h || '').trim();
    if (!key) return;
    const label = headerToLabel.get(key);
    if (label) colIndexToLabel.set(idx, label);
  });
  return colIndexToLabel;
}

/**
 * 미리보기 그리드 문자열 치환 (수식·일반 셀)
 * @param {object} [opts]
 * @param {boolean} [opts.matchCase]
 * @param {Set<string>|null} [opts.allowedCellKeys] — `${rowIndex}\u0000${headerKey}` 만 치환. null/undefined면 전체
 */
export function replaceAllInExcelDraftRows(rows, findText, replaceText, { matchCase = false, allowedCellKeys = null } = {}) {
  const find = String(findText ?? '');
  if (!find) {
    return {
      rows: Array.isArray(rows) ? rows.map((r) => ({ ...r })) : [],
      changedCells: 0,
      changedRows: 0,
      scoped: Boolean(allowedCellKeys)
    };
  }
  const flags = matchCase ? 'g' : 'gi';
  let re;
  try {
    re = new RegExp(escapeRegExp(find), flags);
  } catch {
    return {
      rows: Array.isArray(rows) ? rows.map((r) => ({ ...r })) : [],
      changedCells: 0,
      changedRows: 0,
      scoped: Boolean(allowedCellKeys)
    };
  }
  const replacement = String(replaceText ?? '');
  const scope = allowedCellKeys instanceof Set ? allowedCellKeys : null;
  let changedCells = 0;
  let changedRows = 0;
  const next = (rows || []).map((row, rowIndex) => {
    let rowChanged = false;
    const out = { ...row };
    for (const [key, val] of Object.entries(row || {})) {
      if (key.startsWith('__')) continue;
      if (scope && !scope.has(`${rowIndex}\u0000${key}`)) continue;
      const s = val == null ? '' : String(val);
      if (!s) continue;
      if (matchCase ? !s.includes(find) : !s.toLowerCase().includes(find.toLowerCase())) continue;
      const replaced = s.replace(re, replacement);
      if (replaced !== s) {
        out[key] = replaced;
        changedCells += 1;
        rowChanged = true;
      }
    }
    if (rowChanged) changedRows += 1;
    return out;
  });
  return { rows: next, changedCells, changedRows, scoped: Boolean(scope) };
}
