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

/** 헤더·소스키 비교용(공백·대소문자·유니코드 정규화) */
export function normalizeExcelHeaderKey(h) {
  try {
    return String(h == null ? '' : h).trim().normalize('NFC').toLowerCase();
  } catch {
    return String(h == null ? '' : h).trim().toLowerCase();
  }
}

/**
 * 엑셀 행에서 소스 열 값 읽기: 키 정확 일치 후, 없으면 모든 키에 대해 정규화 비교.
 * (한글 헤더 vs 영문 기본 매핑 불일치는 `guessContactExcelSourceKey`로 보완)
 */
export function readExcelMappedCell(excelRow, sourceKey) {
  if (!excelRow || typeof excelRow !== 'object' || sourceKey == null || sourceKey === '') return '';
  if (Object.prototype.hasOwnProperty.call(excelRow, sourceKey)) {
    const v0 = excelRow[sourceKey];
    return v0 == null ? '' : String(v0);
  }
  const want = normalizeExcelHeaderKey(sourceKey);
  if (!want) return '';
  for (const k of Object.keys(excelRow)) {
    if (normalizeExcelHeaderKey(k) === want) {
      const v = excelRow[k];
      return v == null ? '' : String(v);
    }
  }
  return '';
}

export function previewExcelMappedValue(sampleRow, row) {
  if (!row) return '';
  if (row.sourceType === 'constant') return row.constantValue ?? '';
  if (!row.sourceKey) return '';
  const v = readExcelMappedCell(sampleRow && typeof sampleRow === 'object' ? sampleRow : {}, row.sourceKey);
  if (v == null || v === '') return '';
  const s = String(v);
  if (s.length > 80) return `${s.slice(0, 77)}…`;
  return s;
}
