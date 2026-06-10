/** TSV 복사용 — 셀 값 이스케이프 */
export function escapeTsvCell(value) {
  const s = String(value ?? '');
  if (/[\t\n\r"]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** 선택 영역 → 클립보드 TSV */
export function buildTsvFromMatrix(matrix) {
  return (matrix || [])
    .map((row) => (row || []).map(escapeTsvCell).join('\t'))
    .join('\n');
}

/** 클립보드 TSV → 2차원 배열 */
export function parseTsvToMatrix(text) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === '\t') {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  });
}

export function normalizeGridSelection(start, end) {
  if (!start || !end) return null;
  return {
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startCol: Math.min(start.col, end.col),
    endCol: Math.max(start.col, end.col)
  };
}

export function isCellInGridSelection(row, col, selection) {
  const box = normalizeGridSelection(selection?.start, selection?.end);
  if (!box) return false;
  return row >= box.startRow && row <= box.endRow && col >= box.startCol && col <= box.endCol;
}
