/**
 * 시트 범위 복사/붙여넣기용 TSV — 셀 안 줄바꿈·탭이 있으면 따옴표로 감싼다(엑셀 호환).
 */
export function quoteTsvField(v) {
  const s = String(v ?? '').replace(/\r/g, '');
  if (/[\t\n"]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * 엑셀에서 복사한 TSV → 2차원 배열 (따옴표·셀 안 줄바꿈 지원).
 */
export function parseTsvGrid(text) {
  const s = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const grid = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === '\t') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      grid.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  row.push(field);
  if (row.some((c) => c !== '') || row.length > 1) grid.push(row);
  return grid;
}
