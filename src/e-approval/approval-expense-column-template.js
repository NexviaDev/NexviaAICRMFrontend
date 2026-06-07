export const EXPENSE_BUILTIN_COLUMN_KEYS = ['expenseDate', 'amount', 'category', 'content', 'user', 'note'];
export const EXPENSE_COLUMN_TYPES = ['date', 'amount', 'text'];
const DEFAULT_EXPENSE_CATEGORY_VALUES = [
  '아침식대',
  '점심식대',
  '저녁식대',
  '야근식대',
  '간식비',
  '접대비',
  '회의비',
  '워크숍비',
  '세미나비',
  '교육비',
  '도서구입비',
  '사무용품비',
  '소모품비',
  '복리후생비',
  '출장교통비',
  '출장숙박비',
  '출장일비',
  '택시비',
  '대중교통비',
  '주차비',
  '통행료',
  '유류비',
  '차량유지비',
  '렌터카비',
  '통신비',
  '인터넷비',
  '클라우드사용료',
  '소프트웨어구독료',
  '서버호스팅비',
  '도메인비',
  '마케팅광고비',
  '홍보비',
  '배송비',
  '인쇄비',
  '번역비',
  '디자인외주비',
  '개발외주비',
  '장비구입비',
  '장비임차비',
  '수선유지비',
  '수수료',
  '세금공과금',
  '보험료',
  '회식비',
  '경조사비',
  '기타'
];

function normalizeAllowedValues(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  raw.forEach((v) => {
    const item = String(v || '').trim().slice(0, 50);
    if (!item || seen.has(item)) return;
    seen.add(item);
    out.push(item);
  });
  return out;
}

export function defaultExpenseColumnTemplateColumns() {
  return [
    { key: 'expenseDate', label: '날짜', type: 'date', required: true, enabled: true, isCustom: false, valueSource: 'custom', allowedValues: [] },
    { key: 'amount', label: '금액', type: 'amount', required: true, enabled: true, isCustom: false, valueSource: 'custom', allowedValues: [] },
    { key: 'category', label: '분류', type: 'text', required: true, enabled: true, isCustom: false, valueSource: 'key', allowedValues: [...DEFAULT_EXPENSE_CATEGORY_VALUES] },
    { key: 'content', label: '내용', type: 'text', required: false, enabled: true, isCustom: false, valueSource: 'custom', allowedValues: [] },
    { key: 'user', label: '사용자', type: 'text', required: false, enabled: true, isCustom: false, valueSource: 'custom', allowedValues: [] },
    { key: 'note', label: '비고', type: 'text', required: false, enabled: true, isCustom: false, valueSource: 'custom', allowedValues: [] }
  ];
}

export function normalizeExpenseColumnTemplateColumns(rawColumns) {
  const defaults = defaultExpenseColumnTemplateColumns();
  const builtins = new Set(EXPENSE_BUILTIN_COLUMN_KEYS);
  const typeSet = new Set(EXPENSE_COLUMN_TYPES);
  const defaultMap = new Map(defaults.map((c) => [c.key, c]));
  const src = Array.isArray(rawColumns) ? rawColumns : [];
  const out = [];
  const seen = new Set();

  for (const row of src) {
    if (!row || typeof row !== 'object') continue;
    const key = String(row.key || '').trim().slice(0, 40);
    if (!key || seen.has(key) || !builtins.has(key)) continue;
    const base = defaultMap.get(key);
    const rawType = String(row.type || '').trim();
    const type = typeSet.has(rawType) ? rawType : (base?.type || 'text');
    const label = String(row.label || base?.label || key).trim().slice(0, 40) || (base?.label || key);
    const normalizedAllowedValues = (base?.type || type) === 'text'
      ? normalizeAllowedValues(row.allowedValues || base?.allowedValues)
      : [];
    const allowedValues = (base?.type || type) === 'text'
      ? (key === 'category' && normalizedAllowedValues.length === 0
        ? [...DEFAULT_EXPENSE_CATEGORY_VALUES]
        : normalizedAllowedValues)
      : [];
    const valueSource = (base?.type || type) === 'text'
      ? (row.valueSource === 'key' ? 'key' : (base?.valueSource || 'custom'))
      : 'custom';
    out.push({
      key,
      label,
      type: base?.type || type,
      required: key === 'category' ? true : (row.required !== undefined ? !!row.required : !!base?.required),
      enabled: key === 'category' ? true : (row.enabled !== undefined ? !!row.enabled : true),
      isCustom: false,
      valueSource,
      allowedValues
    });
    seen.add(key);
  }
  for (const col of defaults) {
    if (!seen.has(col.key)) out.push({ ...col });
  }
  return out;
}

export function getExpenseColumnTemplateFromOverview(overviewResponse) {
  return normalizeExpenseColumnTemplateColumns(
    overviewResponse?.company?.expenseLineTemplate?.columns
  );
}

export function expenseColumnToDisplayLabel(col) {
  const requiredSuffix = col?.required ? ' *' : '';
  return `${col?.label || col?.key || '컬럼'}${requiredSuffix}`;
}
