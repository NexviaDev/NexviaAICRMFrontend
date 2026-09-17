import {
  matchHeadersToTargets,
  autoFillSourceKeys,
  buildMappingByHeader,
  assignHeaderToTarget,
  isTargetConnected,
  COMPANY_HEADER_RULES,
  CONTACT_HEADER_RULES
} from '../excel-header-match.js';

let failures = 0;
/** 객체는 키 순서와 무관하게 비교 */
function stable(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(stable));
  if (value && typeof value === 'object') {
    return JSON.stringify(
      Object.keys(value)
        .sort()
        .map((k) => [k, value[k]])
    );
  }
  return JSON.stringify(value);
}
function check(label, actual, expected) {
  const a = stable(actual);
  const e = stable(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      expected ${e}\n      actual   ${a}`);
}

// 1. 고객사 전형적인 한글 양식
check(
  '고객사 · 한글 헤더',
  matchHeadersToTargets(
    ['company.name', 'company.businessNumber', 'company.representativeName', 'company.address'],
    ['회사명', '사업자 번호', '대표자명', '주소'],
    COMPANY_HEADER_RULES
  ),
  {
    'company.name': '회사명',
    'company.businessNumber': '사업자 번호',
    'company.representativeName': '대표자명',
    'company.address': '주소'
  }
);

// 2. 고객사 · 상호/사업자등록번호 변형 + 영문 혼용
check(
  '고객사 · 변형 헤더',
  matchHeadersToTargets(
    ['company.name', 'company.businessNumber', 'company.representativeName', 'company.address'],
    ['상호명', '사업자등록번호', '대표이사', '사업장 소재지'],
    COMPANY_HEADER_RULES
  ),
  {
    'company.name': '상호명',
    'company.businessNumber': '사업자등록번호',
    'company.representativeName': '대표이사',
    'company.address': '사업장 소재지'
  }
);

// 3. 핵심 회귀: "연락처명"이 이름과 전화에 동시에 걸리면 안 됨
check(
  '연락처 · 연락처명 vs 연락처 충돌',
  matchHeadersToTargets(
    ['contact.name', 'contact.phone'],
    ['연락처명', '연락처'],
    CONTACT_HEADER_RULES
  ),
  { 'contact.name': '연락처명', 'contact.phone': '연락처' }
);

// 4. 회사명이 고객사명/연락처 회사명 어느 쪽이든 하나만 차지
check(
  '연락처 · 기본 5열',
  matchHeadersToTargets(
    ['contact.name', 'contact.email', 'contact.phone', 'contact.companyName', 'contact.position'],
    ['이름', '이메일', '휴대폰', '회사명', '직책'],
    CONTACT_HEADER_RULES
  ),
  {
    'contact.name': '이름',
    'contact.email': '이메일',
    'contact.phone': '휴대폰',
    'contact.companyName': '회사명',
    'contact.position': '직책'
  }
);

// 5. 매칭할 수 없는 헤더는 비워 둬야 함 (억지 매칭 금지)
check(
  '무관한 헤더는 매칭 안 함',
  matchHeadersToTargets(
    ['company.name', 'company.businessNumber'],
    ['컬럼1', '컬럼2'],
    COMPANY_HEADER_RULES
  ),
  {}
);

// 6. autoFillSourceKeys — 리드캡처 잔재 키를 실제 엑셀 열로 교체
const rows = [
  { id: 'co1', sourceType: 'field', sourceKey: 'customFields.company', targetKey: 'company.name' },
  { id: 'co2', sourceType: 'field', sourceKey: 'name', targetKey: 'company.representativeName' },
  { id: 'co0', sourceType: 'field', sourceKey: 'customFields.business_number', targetKey: 'company.businessNumber' },
  { id: 'co3', sourceType: 'field', sourceKey: 'customFields.address', targetKey: 'company.address' },
  { id: 'co4', sourceType: 'constant', sourceKey: '', constantValue: 'lead', targetKey: 'company.status' }
];
const filled = autoFillSourceKeys(rows, ['기업명', '사업자번호', '대표자명', '주소'], COMPANY_HEADER_RULES);
check(
  'autoFill · 고객사 기본 행',
  filled.map((r) => [r.targetKey, r.sourceKey]),
  [
    ['company.name', '기업명'],
    ['company.representativeName', '대표자명'],
    ['company.businessNumber', '사업자번호'],
    ['company.address', '주소'],
    ['company.status', '']
  ]
);

// 7. 고정값 행은 절대 건드리지 않음
check('autoFill · 고정값 보존', filled[4].constantValue, 'lead');

// 8. 사용자가 이미 고른 유효한 열은 유지 + 그 열을 다른 필드가 뺏지 않음
const userPicked = [
  { sourceType: 'field', sourceKey: '주소', targetKey: 'company.name' },
  { sourceType: 'field', sourceKey: '', targetKey: 'company.address' }
];
check(
  'autoFill · 사용자 선택 보존',
  autoFillSourceKeys(userPicked, ['주소', '소재지'], COMPANY_HEADER_RULES).map((r) => [r.targetKey, r.sourceKey]),
  [
    ['company.name', '주소'],
    ['company.address', '소재지']
  ]
);

// 9. 커스텀 필드는 정의 라벨로 매칭
check(
  '커스텀 필드 라벨 매칭',
  matchHeadersToTargets(['company.customFields.grade'], ['등급'], COMPANY_HEADER_RULES, {
    customFieldDefs: [{ key: 'grade', label: '등급' }]
  }),
  { 'company.customFields.grade': '등급' }
);

// 10. __rowNum__ 같은 메타 키는 후보에서 제외
check(
  '메타 헤더 제외',
  matchHeadersToTargets(['company.name'], ['__rowNum__', '회사명'], COMPANY_HEADER_RULES),
  { 'company.name': '회사명' }
);

// 11. buildMappingByHeader — 고정값 행은 제외
check(
  'buildMappingByHeader',
  buildMappingByHeader([
    { sourceType: 'field', sourceKey: '기업명', targetKey: 'company.name' },
    { sourceType: 'constant', sourceKey: '', constantValue: 'lead', targetKey: 'company.status' },
    { sourceType: 'field', sourceKey: '', targetKey: 'company.memo' }
  ]),
  { 기업명: 'company.name' }
);

// 12. 헤더에서 대상 선택 — 기존 행에 연결
check(
  'assignHeaderToTarget · 기존 행 연결',
  assignHeaderToTarget(
    [
      { id: 'a', sourceType: 'field', sourceKey: '', targetKey: 'company.name' },
      { id: 'b', sourceType: 'field', sourceKey: '', targetKey: 'company.address' }
    ],
    '상호명',
    'company.name',
    () => 'new'
  ).map((r) => [r.targetKey, r.sourceKey]),
  [
    ['company.name', '상호명'],
    ['company.address', '']
  ]
);

// 13. 같은 열을 다른 필드로 옮기면 이전 연결은 끊김
check(
  'assignHeaderToTarget · 열 재배정',
  assignHeaderToTarget(
    [
      { id: 'a', sourceType: 'field', sourceKey: '주소', targetKey: 'company.name' },
      { id: 'b', sourceType: 'field', sourceKey: '', targetKey: 'company.address' }
    ],
    '주소',
    'company.address',
    () => 'new'
  ).map((r) => [r.targetKey, r.sourceKey]),
  [
    ['company.name', ''],
    ['company.address', '주소']
  ]
);

// 14. '가져오지 않음' 선택 시 연결 해제
check(
  "assignHeaderToTarget · 가져오지 않음",
  assignHeaderToTarget(
    [{ id: 'a', sourceType: 'field', sourceKey: '메모', targetKey: 'company.memo' }],
    '메모',
    '',
    () => 'new'
  ).map((r) => [r.targetKey, r.sourceKey]),
  [['company.memo', '']]
);

// 15. 대상 행이 없으면 새로 추가
check(
  'assignHeaderToTarget · 행 신규 추가',
  assignHeaderToTarget([], '업종', 'company.industry', () => 'new').map((r) => [
    r.id,
    r.targetKey,
    r.sourceKey,
    r.sourceType
  ]),
  [['new', 'company.industry', '업종', 'field']]
);

// 16. 고정값 행은 열 해제 대상이 아님
check(
  'assignHeaderToTarget · 고정값 행 보존',
  assignHeaderToTarget(
    [{ id: 'c', sourceType: 'constant', sourceKey: '', constantValue: 'lead', targetKey: 'company.status' }],
    '상태',
    'company.status',
    () => 'new'
  ).map((r) => [r.targetKey, r.sourceKey, r.sourceType]),
  [['company.status', '상태', 'field']]
);

// 17. 기본 행에 없는 필드도 대상 옵션에 있으면 행을 새로 만들어 연결
const withExtra = autoFillSourceKeys(
  [
    { id: 'a', sourceType: 'field', sourceKey: '', targetKey: 'company.name' },
    { id: 'b', sourceType: 'field', sourceKey: '', targetKey: 'company.address' }
  ],
  ['회사명', '주소', '업종'],
  COMPANY_HEADER_RULES,
  {
    availableTargetKeys: ['company.name', 'company.address', 'company.industry', 'company.memo'],
    makeRowId: () => 'auto1'
  }
);
check(
  'autoFill · 남은 열을 새 행으로 연결',
  withExtra.map((r) => [r.targetKey, r.sourceKey]),
  [
    ['company.name', '회사명'],
    ['company.address', '주소'],
    ['company.industry', '업종']
  ]
);

// 18. 이미 그 대상의 행이 있으면 중복으로 추가하지 않음
check(
  'autoFill · 중복 행 추가 안 함',
  autoFillSourceKeys(
    [{ id: 'a', sourceType: 'field', sourceKey: '업종', targetKey: 'company.industry' }],
    ['업종'],
    COMPANY_HEADER_RULES,
    { availableTargetKeys: ['company.industry'], makeRowId: () => 'auto1' }
  ).length,
  1
);

// 19. 고정값으로 이미 쓰는 대상은 새 행을 만들지 않음
check(
  'autoFill · 고정값 대상은 건너뜀',
  autoFillSourceKeys(
    [{ id: 'c', sourceType: 'constant', sourceKey: '', constantValue: 'lead', targetKey: 'company.status' }],
    ['상태'],
    COMPANY_HEADER_RULES,
    { availableTargetKeys: ['company.status'], makeRowId: () => 'auto1' }
  ).length,
  1
);

// 20. availableTargetKeys 를 안 주면 기존 동작 그대로(행 추가 없음)
check(
  'autoFill · 옵션 없으면 행 추가 없음',
  autoFillSourceKeys(
    [{ id: 'a', sourceType: 'field', sourceKey: '', targetKey: 'company.name' }],
    ['회사명', '업종'],
    COMPANY_HEADER_RULES
  ).length,
  1
);

// 21~24. isTargetConnected — 행이 있는 것만으로는 연결로 보지 않음
const connRows = [
  { sourceType: 'field', sourceKey: 'customFields.company', targetKey: 'company.name' },
  { sourceType: 'field', sourceKey: '주소', targetKey: 'company.address' },
  { sourceType: 'constant', sourceKey: '', constantValue: 'lead', targetKey: 'company.status' },
  { sourceType: 'constant', sourceKey: '', constantValue: '  ', targetKey: 'company.memo' }
];
check('연결 · 파일에 없는 열이면 미연결', isTargetConnected(connRows, ['주소'], 'company.name'), false);
check('연결 · 파일에 있는 열이면 연결', isTargetConnected(connRows, ['주소'], 'company.address'), true);
check('연결 · 고정값 있으면 연결', isTargetConnected(connRows, ['주소'], 'company.status'), true);
check('연결 · 공백 고정값은 미연결', isTargetConnected(connRows, ['주소'], 'company.memo'), false);

console.log(failures === 0 ? '\n전부 통과' : `\n실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
