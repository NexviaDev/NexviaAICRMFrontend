/**
 * 엑셀 헤더(열 이름) → 소스 옵션. 대상 필드는 API(crmMappableFields) + 커스텀 정의로 동적 구성.
 */
export function buildExcelSourceOptions(headers = []) {
  const seen = new Set();
  const list = [];
  for (const h of headers) {
    const key = h == null ? '' : String(h);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    list.push({
      key,
      label: key,
      icon: 'table_chart',
      meta: '엑셀'
    });
  }
  return list;
}

export function previewExcelMappedValue(sampleRow, row) {
  if (!row) return '';
  if (row.sourceType === 'constant') return row.constantValue ?? '';
  if (!row.sourceKey) return '';
  const v = sampleRow && typeof sampleRow === 'object' ? sampleRow[row.sourceKey] : undefined;
  if (v == null) return '';
  const s = String(v);
  if (s.length > 80) return `${s.slice(0, 77)}…`;
  return s;
}
