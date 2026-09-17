/**
 * 엑셀 헤더 → CRM 대상 필드 자동 매칭 (공용).
 *
 * 기존에는 연락처·상품·영업기회·전자결재가 각각 별도의 guess 함수를 갖고 있었고
 * 고객사에는 아예 없었습니다. 규칙 테이블만 주입하면 되도록 엔진을 하나로 모읍니다.
 *
 * 기존 구현 대비 차이:
 *  - 정규화 비교(공백·기호·대소문자·유니코드)를 거쳐 "사업자 번호"와 "사업자번호"를 같게 봅니다.
 *  - 대상별로 따로 스캔하지 않고 전역 점수순 1:1 배정을 합니다.
 *    같은 열이 두 필드에 동시에 걸리는 문제(예: "연락처명"이 이름·전화 규칙에 모두 매칭)를 없앱니다.
 */

/** 비교용 정규화: 유니코드 정규화 + 소문자 + 공백/구분기호 제거 */
export function normalizeHeaderKey(value) {
  const raw = value == null ? '' : String(value);
  let s;
  try {
    s = raw.normalize('NFC');
  } catch (_) {
    s = raw;
  }
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s_\-.()[\]{}/\\·:,'"]/g, '');
}

/** 엑셀이 만들어 내는 내부 키(__rowNum__ 등)는 매칭 대상에서 제외 */
export function isMetaHeaderKey(key) {
  return typeof key === 'string' && key.startsWith('__') && key.endsWith('__');
}

export function usableHeaders(headers) {
  return (Array.isArray(headers) ? headers : []).filter(
    (h) => h != null && String(h).trim() !== '' && !isMetaHeaderKey(String(h))
  );
}

const SCORE_EXACT = 100;
const SCORE_REGEX = 70;
const SCORE_HEADER_CONTAINS_TOKEN = 60;
const SCORE_TOKEN_CONTAINS_HEADER = 45;

/** 최소 점수 — 이보다 낮으면 매칭하지 않고 사용자가 직접 고르게 둡니다. */
const SCORE_FLOOR = 40;

/**
 * 헤더 하나와 토큰 하나의 매칭 점수. 0이면 매칭 없음.
 * 토큰은 문자열(정규화 비교) 또는 RegExp(원본 문자열에 대해 test).
 */
function scoreHeaderAgainstToken(header, normalizedHeader, token) {
  if (token instanceof RegExp) {
    return token.test(String(header).trim()) ? SCORE_REGEX : 0;
  }
  const normalizedToken = normalizeHeaderKey(token);
  if (!normalizedToken || !normalizedHeader) return 0;
  if (normalizedHeader === normalizedToken) return SCORE_EXACT;
  if (normalizedHeader.includes(normalizedToken)) {
    // 토큰이 길수록(= 더 구체적일수록) 신뢰도가 높습니다.
    const specificity = Math.min(12, normalizedToken.length);
    return SCORE_HEADER_CONTAINS_TOKEN + specificity;
  }
  if (normalizedToken.includes(normalizedHeader)) {
    const specificity = Math.min(10, normalizedHeader.length);
    return SCORE_TOKEN_CONTAINS_HEADER + specificity;
  }
  return 0;
}

function bestScoreForTarget(header, normalizedHeader, tokens) {
  let best = 0;
  for (const token of tokens || []) {
    const score = scoreHeaderAgainstToken(header, normalizedHeader, token);
    if (score > best) best = score;
  }
  return best;
}

/**
 * 커스텀 필드(`<prefix>.customFields.<key>`)는 정의의 label/key를 토큰으로 사용합니다.
 */
function tokensForTarget(targetKey, ruleTable, customFieldDefs) {
  const direct = ruleTable?.[targetKey];
  if (direct && direct.length) return direct;

  const match = /^(contact|company|product|opp)\.customFields\.(.+)$/.exec(String(targetKey || ''));
  if (!match) return null;
  const fieldKey = match[2];
  const def = (customFieldDefs || []).find((d) => d && d.key === fieldKey);
  const label = def?.label ? String(def.label).trim() : '';
  return [label, fieldKey].filter(Boolean);
}

/**
 * 대상 필드 목록 ↔ 엑셀 헤더를 점수순으로 1:1 배정.
 * @returns {Record<string, string>} targetKey → header (매칭된 것만)
 */
export function matchHeadersToTargets(targetKeys, headers, ruleTable, options = {}) {
  const { customFieldDefs = [], reservedHeaders = [] } = options;
  const heads = usableHeaders(headers);
  const targets = (Array.isArray(targetKeys) ? targetKeys : []).filter(Boolean);
  if (!heads.length || !targets.length) return {};

  const normalizedByHeader = new Map(heads.map((h) => [h, normalizeHeaderKey(h)]));

  const candidates = [];
  for (const targetKey of targets) {
    const tokens = tokensForTarget(targetKey, ruleTable, customFieldDefs);
    if (!tokens || !tokens.length) continue;
    for (const header of heads) {
      const score = bestScoreForTarget(header, normalizedByHeader.get(header), tokens);
      if (score >= SCORE_FLOOR) candidates.push({ targetKey, header, score });
    }
  }

  // 점수 높은 순 → 동점이면 헤더가 짧은 쪽(덜 모호한 쪽)을 우선.
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.header).length - String(b.header).length;
  });

  const takenHeaders = new Set(reservedHeaders.filter(Boolean));
  const assigned = {};
  for (const candidate of candidates) {
    if (assigned[candidate.targetKey]) continue;
    if (takenHeaders.has(candidate.header)) continue;
    assigned[candidate.targetKey] = candidate.header;
    takenHeaders.add(candidate.header);
  }
  return assigned;
}

/**
 * 단일 대상 필드에 대한 열 추측 (기존 guess*ExcelSourceKey 호환 형태).
 * 1:1 배정이 필요 없는 단발 호출용.
 */
export function guessSourceKeyForTarget(targetKey, headers, ruleTable, options = {}) {
  const assigned = matchHeadersToTargets([targetKey], headers, ruleTable, options);
  return assigned[targetKey] || '';
}

/**
 * 매핑 행 배열의 비어 있거나 파일에 없는 sourceKey를 자동으로 채웁니다.
 *
 * - `sourceType === 'constant'` 행은 건드리지 않습니다.
 * - 이미 유효한(= 현재 파일에 존재하는) sourceKey가 있으면 그대로 둡니다.
 * - 파일에 없는 sourceKey(다른 파일 기준으로 남아 있던 값)는 비우고 다시 추측합니다.
 */
export function autoFillSourceKeys(rows, headers, ruleTable, options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const heads = usableHeaders(headers);
  if (!list.length || !heads.length) return list;

  const headerSet = new Set(heads);
  const keepableRows = list.filter(
    (row) => row && row.sourceType !== 'constant' && row.sourceKey && headerSet.has(row.sourceKey)
  );
  const reservedHeaders = keepableRows.map((row) => row.sourceKey);

  const needTargets = list
    .filter(
      (row) =>
        row &&
        row.sourceType !== 'constant' &&
        row.targetKey &&
        !(row.sourceKey && headerSet.has(row.sourceKey))
    )
    .map((row) => row.targetKey);

  if (!needTargets.length) return list;

  const assigned = matchHeadersToTargets(needTargets, heads, ruleTable, {
    ...options,
    reservedHeaders
  });

  let changed = false;
  let next = list.map((row) => {
    if (!row || row.sourceType === 'constant' || !row.targetKey) return row;
    if (row.sourceKey && headerSet.has(row.sourceKey)) return row;

    const guessed = assigned[row.targetKey] || '';
    if (guessed) {
      changed = true;
      return { ...row, sourceKey: guessed };
    }
    // 이전 파일에서 남은 값이 현재 파일에 없으면 비웁니다(잘못된 미리보기 방지).
    if (row.sourceKey) {
      changed = true;
      return { ...row, sourceKey: '' };
    }
    return row;
  });

  /*
   * 남은 열 중 CRM 에 대응 필드가 있는 것은 매핑 행을 새로 만들어 줍니다.
   * 기본 매핑 행에 없는 필드(고객사 `업종`, 연락처 `직책`·`메모` 등)는
   * 이 단계가 없으면 양쪽에 다 있는데도 "가져오지 않음"으로 남습니다.
   * Salesforce·HubSpot 처럼 맞출 수 있는 건 먼저 맞춰 두고, 빼는 건 사용자가 합니다.
   */
  const { availableTargetKeys, makeRowId } = options;
  if (Array.isArray(availableTargetKeys) && availableTargetKeys.length) {
    const usedHeaders = new Set(
      next.filter((r) => r && r.sourceType !== 'constant' && r.sourceKey).map((r) => r.sourceKey)
    );
    const usedTargets = new Set(next.filter((r) => r && r.targetKey).map((r) => r.targetKey));

    const leftoverHeaders = heads.filter((h) => !usedHeaders.has(h));
    const leftoverTargets = availableTargetKeys.filter((t) => t && !usedTargets.has(t));

    if (leftoverHeaders.length && leftoverTargets.length) {
      const extra = matchHeadersToTargets(leftoverTargets, leftoverHeaders, ruleTable, options);
      const added = Object.entries(extra).map(([targetKey, header]) => ({
        id: typeof makeRowId === 'function' ? makeRowId() : `row-auto-${targetKey}`,
        sourceType: 'field',
        sourceKey: header,
        constantValue: '',
        targetKey
      }));
      if (added.length) {
        changed = true;
        next = [...next, ...added];
      }
    }
  }

  return changed ? next : list;
}

/**
 * 대상 필드가 실제로 값을 받게 되는지:
 * 현재 파일에 있는 열에 연결됐거나, 비어 있지 않은 고정값이 있으면 true.
 * (매핑 행이 존재하는 것만으로는 부족합니다 — 기본 행은 열 없이도 항상 있습니다.)
 */
export function isTargetConnected(rows, headers, targetKey) {
  const heads = new Set(usableHeaders(headers));
  return (Array.isArray(rows) ? rows : []).some((row) => {
    if (!row || row.targetKey !== targetKey) return false;
    if (row.sourceType === 'constant') return String(row.constantValue ?? '').trim() !== '';
    return !!row.sourceKey && heads.has(row.sourceKey);
  });
}

/**
 * 매핑 행들로부터 "엑셀 열 → 대상 필드" 역방향 맵을 만듭니다.
 * 시트 미리보기의 열 헤더 상태 표시에 사용합니다.
 */
export function buildMappingByHeader(rows) {
  const map = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row || row.sourceType === 'constant') return;
    if (!row.sourceKey || !row.targetKey) return;
    // 한 열이 여러 필드에 연결돼 있으면 첫 번째 것을 대표로 보여 줍니다.
    if (!map[row.sourceKey]) map[row.sourceKey] = row.targetKey;
  });
  return map;
}

/**
 * 시트 미리보기의 열 헤더에서 대상 필드를 골랐을 때 매핑 행을 갱신합니다.
 *
 * - targetKey 가 ''이면 그 열의 연결을 끊습니다(= 가져오지 않음).
 * - 한 열은 한 필드에만 연결되도록, 같은 열을 쓰던 다른 행은 비웁니다.
 * - 해당 대상 필드의 행이 없으면 새로 추가합니다.
 *
 * @param {(…args:any)=>string} makeRowId 새 행 id 생성기
 */
export function assignHeaderToTarget(rows, header, targetKey, makeRowId) {
  const list = Array.isArray(rows) ? rows : [];
  const col = String(header || '');
  if (!col) return list;

  // 이 열을 쓰던 기존 연결은 모두 해제.
  let next = list.map((row) =>
    row && row.sourceType !== 'constant' && row.sourceKey === col ? { ...row, sourceKey: '' } : row
  );

  if (!targetKey) return next;

  // 같은 대상을 가진 행이 이미 있으면 재사용합니다.
  // 고정값 행뿐이라면 그 행을 엑셀 열 모드로 바꿉니다 — 새 행을 더하면
  // 한 대상 필드에 매핑이 둘 생겨 서버로 중복 전송됩니다.
  let targetRowIndex = next.findIndex(
    (row) => row && row.sourceType !== 'constant' && row.targetKey === targetKey
  );
  if (targetRowIndex < 0) {
    targetRowIndex = next.findIndex((row) => row && row.targetKey === targetKey);
  }

  if (targetRowIndex >= 0) {
    next = next.map((row, i) => (i === targetRowIndex ? { ...row, sourceType: 'field', sourceKey: col } : row));
    return next;
  }

  const id = typeof makeRowId === 'function' ? makeRowId() : `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return [...next, { id, sourceType: 'field', sourceKey: col, constantValue: '', targetKey }];
}

/* ------------------------------------------------------------------ */
/*  엔티티별 규칙 테이블                                                */
/* ------------------------------------------------------------------ */

/** 고객사 — 기존에 자동 매칭이 전혀 없던 엔티티 */
export const COMPANY_HEADER_RULES = {
  'company.name': [
    '고객사명', '고객사', '기업명', '회사명', '업체명', '법인명', '상호', '상호명',
    '거래처명', '거래처', '회사', '기업', '업체',
    'companyname', 'company', 'accountname', 'account', 'corpname'
  ],
  'company.businessNumber': [
    '사업자등록번호', '사업자번호', '사업자등록', '사업자', '등록번호',
    'businessnumber', 'businessregistrationnumber', 'bizno', 'brn', 'taxid'
  ],
  'company.representativeName': [
    '대표자명', '대표이사', '대표자', '대표명', '대표',
    'representative', 'representativename', 'ceo', 'owner'
  ],
  'company.address': [
    '사업장주소', '사업장소재지', '회사주소', '주소', '소재지', '본사주소',
    'address', 'location', 'addr'
  ],
  'company.industry': ['업종', '업태', '산업', '분야', 'industry', 'sector'],
  'company.code': ['고객사코드', '거래처코드', '코드', 'code', 'accountcode'],
  'company.status': ['상태', '고객사상태', 'status'],
  'company.memo': ['메모', '비고', '특이사항', '참고', 'memo', 'note', 'notes', 'remarks'],
  'company.latitude': ['위도', 'latitude', 'lat'],
  'company.longitude': ['경도', 'longitude', 'lng', 'lon']
};

/** 연락처 — 기존 guessContactExcelSourceKey 의 정규식 규칙을 토큰으로 옮긴 것 */
export const CONTACT_HEADER_RULES = {
  'contact.name': [
    '고객명', '담당자명', '연락처명', '성명', '이름', '담당자', '고객이름',
    'name', 'fullname', 'contactname', 'customername'
  ],
  'contact.email': [
    '이메일주소', '이메일', '메일주소', '전자우편', '메일',
    'email', 'emailaddress', 'mail', 'e-mail'
  ],
  'contact.phone': [
    '휴대폰번호', '휴대전화', '핸드폰번호', '전화번호', '휴대폰', '핸드폰', '연락처',
    '전화', '모바일', 'phone', 'phonenumber', 'mobile', 'tel', 'telephone', 'cellphone', 'hp'
  ],
  'contact.companyName': [
    '고객사명', '회사명', '업체명', '법인명', '기업명', '소속', '거래처명',
    '회사', '기업', '업체', '고객사', 'company', 'companyname', 'organization'
  ],
  'contact.position': [
    '직책', '직위', '직급', '부서', '직명',
    'position', 'title', 'jobtitle', 'role', 'rank', 'department'
  ],
  'contact.address': ['주소', '소재지', 'address', 'location', 'addr'],
  'contact.birthDate': ['생년월일', '생일', 'birthdate', 'birth', 'dob', 'birthday'],
  'contact.status': ['상태', 'status'],
  'contact.memo': ['메모', '비고', '특이사항', 'memo', 'note', 'notes', 'remarks']
};
