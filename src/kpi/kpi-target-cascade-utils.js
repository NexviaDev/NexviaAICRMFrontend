/**
 * KPI 목표 연·반기·분기·월: Top-down 균등 분해와 Bottom-up 롤업.
 * 매출(revenue)만 사용합니다.
 * 매출: 월 수정 시 분기·반기·연간 롤업; 반기·분기 수정 시 해당 구간 월 균등 분배 후 롤업.
 * 부서: 자식 월 합으로 부모 월·상위 기간 갱신(bubble-up), 회사 매출은 최상위 부서 월 합과 동기화.
 */

/** @param {number} total @param {number} partCount @returns {number[]} */
export function distributeEvenInt(total, partCount) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  const p = Math.max(1, Math.floor(partCount));
  if (p === 0) return [];
  const base = Math.floor(n / p);
  const rem = n - base * p;
  const out = [];
  for (let i = 0; i < p; i += 1) {
    out.push(base + (i < rem ? 1 : 0));
  }
  return out;
}

function sumArr(arr, start, end) {
  let s = 0;
  for (let i = start; i <= end; i += 1) s += Math.max(0, Math.round(Number(arr?.[i]) || 0));
  return s;
}

/**
 * 연간 총액으로 반기·분기·월을 균등 분배 (Top-down).
 * @param {number} annual
 * @returns {{ annual: number, semi: number[], quarter: number[], month: number[] }}
 */
export function topDownFromAnnual(annual) {
  const A = Math.max(0, Math.round(Number(annual) || 0));
  const semi = distributeEvenInt(A, 2);
  const q12 = distributeEvenInt(semi[0], 2);
  const q34 = distributeEvenInt(semi[1], 2);
  const quarter = [...q12, ...q34];
  const month = [];
  for (let qi = 0; qi < 4; qi += 1) {
    month.push(...distributeEvenInt(quarter[qi], 3));
  }
  return { annual: A, semi, quarter, month };
}

/**
 * 12개월 합으로 분기·반기·연간 롤업 (Bottom-up).
 * @param {number[]} month12
 */
export function rollupFromMonths(month12) {
  const m = Array.from({ length: 12 }, (_, i) => Math.max(0, Math.round(Number(month12?.[i]) || 0)));
  const quarter = [0, 1, 2, 3].map((qi) => sumArr(m, qi * 3, qi * 3 + 2));
  const semi = [sumArr(m, 0, 5), sumArr(m, 6, 11)];
  const annual = semi[0] + semi[1];
  return { annual, semi, quarter, month: m };
}

/**
 * Bottom-up 검증 플래그.
 * 하위 합과 맞지 않는 상위(분기·반기·연간)만 표시하고, 하위 월 칸은 표시하지 않습니다.
 * @param {{ month: number[], quarter?: number[], semi?: number[], annual?: number }} params
 * @returns {{ month: boolean[], quarter: boolean[], semi: boolean[], annual: boolean }}
 */
export function computeNeedSyncFlags(params) {
  const intOr = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : Math.max(0, Math.round(Number(fallback) || 0));
  };
  const month = Array.from({ length: 12 }, (_, i) => Math.max(0, Math.round(Number(params.month?.[i]) || 0)));
  const rolledQ = [0, 1, 2, 3].map((qi) => sumArr(month, qi * 3, qi * 3 + 2));
  const rolledSemi = [sumArr(month, 0, 5), sumArr(month, 6, 11)];
  const rolledAnnual = rolledSemi[0] + rolledSemi[1];
  const quarter = Array.from({ length: 4 }, (_, i) => intOr(params.quarter?.[i], rolledQ[i]));
  const semi = [intOr(params.semi?.[0], rolledSemi[0]), intOr(params.semi?.[1], rolledSemi[1])];
  const annual = intOr(params.annual, rolledAnnual);

  const monthFlags = Array(12).fill(false);
  const quarterFlags = [false, false, false, false];
  const semiFlags = [false, false];
  const qSemi = [quarter[0] + quarter[1], quarter[2] + quarter[3]];
  const qAnnual = quarter.reduce((acc, v) => acc + v, 0);

  for (let qi = 0; qi < 4; qi += 1) {
    quarterFlags[qi] = quarter[qi] !== rolledQ[qi];
  }

  semiFlags[0] = semi[0] !== rolledSemi[0] || semi[0] !== qSemi[0];
  semiFlags[1] = semi[1] !== rolledSemi[1] || semi[1] !== qSemi[1];
  const annualFlag = annual !== rolledAnnual || annual !== qAnnual || annual !== semi[0] + semi[1];

  return { month: monthFlags, quarter: quarterFlags, semi: semiFlags, annual: annualFlag };
}

/**
 * 연간 변경 시 하위 전부 Top-down 덮어쓰기.
 */
export function applyAnnualTopDown(annualRevenue) {
  return {
    revenue: topDownFromAnnual(annualRevenue)
  };
}

/** 단일 지표 연간 Top-down */
export function applyAnnualTopDownMetric(prev, metric, rawDigits) {
  const A = Math.max(0, Math.round(Number(String(rawDigits ?? '').replace(/\D/g, '')) || 0));
  const next = topDownFromAnnual(A);
  return {
    ...prev,
    [metric]: next
  };
}

/**
 * 월 입력 후 분기·반기·연간을 월 합계로 롤업 (Bottom-up 시간 축).
 */
export function applyMonthChange(prev, metric, monthIndex, rawDigits) {
  const idx = Math.max(0, Math.min(11, Math.floor(Number(monthIndex) || 0)));
  const v = Math.max(0, Math.round(Number(String(rawDigits ?? '').replace(/\D/g, '')) || 0));
  const cur = prev[metric] || { annual: 0, semi: [0, 0], quarter: [0, 0, 0, 0], month: Array(12).fill(0) };
  const nextMonth = [...(cur.month || Array(12).fill(0))];
  nextMonth[idx] = v;
  const rolled = rollupFromMonths(nextMonth);
  return {
    ...prev,
    [metric]: {
      ...cur,
      ...rolled
    }
  };
}

/** 반기 목표 입력: 해당 6개월 균등 분배 후 전 기간 롤업 (Top-down → 롤업). */
export function applySemiChange(prev, metric, semiIndex, rawDigits) {
  const si = Math.max(0, Math.min(1, Math.floor(Number(semiIndex) || 0)));
  const val = Math.max(0, Math.round(Number(String(rawDigits ?? '').replace(/\D/g, '')) || 0));
  const cur = prev[metric] || { annual: 0, semi: [0, 0], quarter: [0, 0, 0, 0], month: Array(12).fill(0) };
  const months = Array.from({ length: 12 }, (_, i) => Math.max(0, Math.round(Number(cur.month?.[i]) || 0)));
  const start = si === 0 ? 0 : 6;
  const parts = distributeEvenInt(val, 6);
  for (let i = 0; i < 6; i += 1) {
    months[start + i] = parts[i] || 0;
  }
  const rolled = rollupFromMonths(months);
  return {
    ...prev,
    [metric]: {
      ...cur,
      ...rolled
    }
  };
}

/** 분기 목표 입력: 해당 3개월 균등 분배 후 전 기간 롤업. */
export function applyQuarterChange(prev, metric, quarterIndex, rawDigits) {
  const qi = Math.max(0, Math.min(3, Math.floor(Number(quarterIndex) || 0)));
  const val = Math.max(0, Math.round(Number(String(rawDigits ?? '').replace(/\D/g, '')) || 0));
  const cur = prev[metric] || { annual: 0, semi: [0, 0], quarter: [0, 0, 0, 0], month: Array(12).fill(0) };
  const months = Array.from({ length: 12 }, (_, i) => Math.max(0, Math.round(Number(cur.month?.[i]) || 0)));
  const start = qi * 3;
  const parts = distributeEvenInt(val, 3);
  for (let i = 0; i < 3; i += 1) {
    months[start + i] = parts[i] || 0;
  }
  const rolled = rollupFromMonths(months);
  return {
    ...prev,
    [metric]: {
      ...cur,
      ...rolled
    }
  };
}

/** 직속 자식 부서들의 metric 월 배열을 월별 합산 */
export function sumDirectChildrenMonthsMetric(deptMap, treeRows, parentDeptId, metric) {
  const pid = String(parentDeptId || '').trim();
  const children = (treeRows || []).filter((c) => String(c.parentId || '').trim() === pid);
  const month = Array(12).fill(0);
  for (const c of children) {
    const cid = String(c.id || '').trim();
    if (!cid) continue;
    const b = normCascadeBlock(deptMap[cid] || emptyCascadeBlock());
    const cm = b[metric]?.month || [];
    for (let mi = 0; mi < 12; mi += 1) {
      month[mi] += Math.max(0, Math.round(Number(cm[mi]) || 0));
    }
  }
  return month;
}

function addMonthArrays(a, b) {
  return Array.from({ length: 12 }, (_, i) =>
    Math.max(0, Math.round(Number(a?.[i]) || 0)) + Math.max(0, Math.round(Number(b?.[i]) || 0))
  );
}

function subtractMonthArrays(a, b) {
  return Array.from({ length: 12 }, (_, i) =>
    Math.max(0, Math.round(Number(a?.[i]) || 0) - Math.max(0, Math.round(Number(b?.[i]) || 0)))
  );
}

/**
 * 부서 합계 원칙: 해당 부서에 직접 소속된 직원 합만 사용합니다.
 * KPI 목표에서는 조직도 하위 부서를 부모 부서에 더하지 않습니다.
 */
export function sumOwnStaffAndDirectChildrenMonthsMetric(deptMap, treeRows, staffRows, staffCascade, deptId, metric) {
  return metric === 'revenue'
    ? sumStaffRevenueMonthsForDepartment(deptId, staffRows, staffCascade)
    : Array(12).fill(0);
}

/** 월 12칸 롤업 결과로 블록의 한 지표만 갱신 */
export function mergeRolledMetricFromMonths(block, metric, month12) {
  const base = normCascadeBlock(block);
  const rolled = rollupFromMonths(month12);
  return {
    ...base,
    [metric]: {
      ...(base[metric] || {}),
      annual: rolled.annual,
      semi: rolled.semi,
      quarter: rolled.quarter,
      month: rolled.month
    }
  };
}

/**
 * 예전 트리 롤업 호환 함수.
 * KPI 목표에서는 하위 부서를 부모에 더하지 않으므로 상위 부서를 변경하지 않습니다.
 */
export function bubbleUpMetricAncestors(deptMap, treeRows, editedDeptId, metric = 'revenue') {
  return { ...(deptMap || {}) };
}

/**
 * 직원 중심 롤업: 편집된 직원의 소속 부서만 갱신합니다.
 * KPI 목표에서는 상위 부서로 하위 부서 값을 올려 더하지 않습니다.
 */
export function bubbleUpMetricAncestorsWithStaff(
  deptMap,
  treeRows,
  staffRows,
  staffCascade,
  editedDeptId,
  metric = 'revenue'
) {
  const currentId = String(editedDeptId || '').trim();
  let map = { ...deptMap };
  if (currentId) {
    const monthSum = sumOwnStaffAndDirectChildrenMonthsMetric(map, treeRows, staffRows, staffCascade, currentId, metric);
    const block = map[currentId] || emptyCascadeBlock();
    map[currentId] = mergeRolledMetricFromMonths(block, metric, monthSum);
  }
  return map;
}

/**
 * 예전 부모→자식 분배 호환 함수.
 * KPI 목표에서는 하위 부서 개념으로 분배하지 않으므로 입력 맵을 그대로 돌려줍니다.
 */
export function redistributeDirectChildrenAnnualFromParent(deptMap, treeRows, parentDeptId, metric = 'revenue') {
  return { ...(deptMap || {}) };
}

/** 모든 부서 행의 매출 월 합 → 회사 매출 블록 동기화 */
export function syncCompanyRevenueFromRootDepts(companyBlock, deptMap, treeRows) {
  const co = normCascadeBlock(companyBlock);
  const ids = (treeRows || []).map((r) => String(r.id || '').trim()).filter(Boolean);
  const targetIds = ids.length ? ids : rootDepartmentIds(treeRows);
  const month = Array(12).fill(0);
  for (const id of targetIds) {
    const b = normCascadeBlock(deptMap[id] || emptyCascadeBlock());
    const m = b.revenue?.month || [];
    for (let mi = 0; mi < 12; mi += 1) {
      month[mi] += Math.max(0, Math.round(Number(m[mi]) || 0));
    }
  }
  const rolled = rollupFromMonths(month);
  /* ②/③에서 올라온 변경은 ① 회사 연간·반기·분기·월까지 모두 다시 계산합니다. */
  return {
    ...co,
    revenue: {
      ...(co.revenue || {}),
      annual: rolled.annual,
      semi: rolled.semi,
      quarter: rolled.quarter,
      month: rolled.month
    }
  };
}

/** 빈 캐스케이드 블록(매출만) */
export function emptyCascadeBlock() {
  const z = { annual: 0, semi: [0, 0], quarter: [0, 0, 0, 0], month: Array(12).fill(0) };
  return { revenue: { ...z } };
}

/** UI·비교용: 월 배열 12칸이 없으면 빈 블록으로 간주 */
export function normCascadeBlock(b) {
  if (b?.revenue?.month?.length === 12) return b;
  return emptyCascadeBlock();
}

/**
 * ③ 직원 행 기준: 부서(teamKey)별 userId 목록(이름순).
 * @param {Array<{ userId?: string, teamKey?: string, name?: string }>} staffRows
 * @returns {Map<string, string[]>}
 */
export function staffUserIdsByDeptSorted(staffRows) {
  const byDept = new Map();
  for (const r of staffRows || []) {
    const k = String(r.teamKey || '').trim();
    if (!k || k === '_') continue;
    const uid = String(r.userId || '').trim();
    if (!uid) continue;
    if (!byDept.has(k)) byDept.set(k, []);
    byDept.get(k).push({ uid, name: String(r.name || '') });
  }
  const out = new Map();
  for (const [k, arr] of byDept) {
    arr.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    out.set(k, arr.map((x) => x.uid));
  }
  return out;
}

/**
 * 부서 매출 월 12칸을 직원 n명에게 월별 균등 분배 후 직원별 롤업(직원 월 합 = 부서 월).
 * @param {{ annual?: number, semi?: number[], quarter?: number[], month?: number[] }} deptRev
 * @param {string[]} userIdsOrdered
 * @returns {Record<string, { annual: number, semi: number[], quarter: number[], month: number[] }>}
 */
export function splitDeptRevenueEvenlyToStaffRevenue(deptRev, userIdsOrdered) {
  const ids = [...(userIdsOrdered || [])].map((x) => String(x || '').trim()).filter(Boolean);
  const n = ids.length;
  const result = {};
  if (!n) return result;
  const monthTotals = Array.from({ length: 12 }, (_, i) =>
    Math.max(0, Math.round(Number(deptRev?.month?.[i]) || 0))
  );
  const perUserMonths = ids.map(() => Array(12).fill(0));
  for (let mi = 0; mi < 12; mi += 1) {
    const parts = distributeEvenInt(monthTotals[mi], n);
    for (let j = 0; j < n; j += 1) {
      perUserMonths[j][mi] = parts[j] || 0;
    }
  }
  for (let j = 0; j < n; j += 1) {
    result[ids[j]] = rollupFromMonths(perUserMonths[j]);
  }
  return result;
}

/**
 * 한 부서(teamKey)에 속한 직원들의 매출 월 합(12칸).
 */
export function sumStaffRevenueMonthsForDepartment(deptId, staffRows, staffCascade) {
  const did = String(deptId || '').trim();
  const sum = Array(12).fill(0);
  for (const r of staffRows || []) {
    if (String(r.teamKey || '').trim() !== did) continue;
    const uid = String(r.userId || '').trim();
    if (!uid) continue;
    const m = normCascadeBlock(staffCascade[uid]).revenue?.month || [];
    for (let i = 0; i < 12; i += 1) {
      sum[i] += Math.max(0, Math.round(Number(m[i]) || 0));
    }
  }
  return sum;
}

function directStaffCountForDepartment(deptId, staffRows) {
  const did = String(deptId || '').trim();
  return (staffRows || []).filter((r) => String(r.teamKey || '').trim() === did && String(r.userId || '').trim()).length;
}

function ownDeptMonthsWithoutChildren(deptMap, treeRows, deptId, metric) {
  const block = normCascadeBlock(deptMap?.[deptId] || emptyCascadeBlock());
  return block[metric]?.month || Array(12).fill(0);
}

/** 모든 부서를 직원 중심 원칙(직속 직원만)으로 재계산 */
export function rollupDeptCascadeFromStaffAndChildren(prevDeptMap, treeRows, staffRows, staffCascade, metric = 'revenue') {
  const rows = treeRows || [];
  let out = { ...(prevDeptMap || {}) };
  for (const row of rows) {
    const id = String(row.id || '').trim();
    if (!id) continue;
    const ownStaffMonth = metric === 'revenue'
      ? sumStaffRevenueMonthsForDepartment(id, staffRows, staffCascade)
      : Array(12).fill(0);
    const ownDeptMonth = directStaffCountForDepartment(id, staffRows) > 0
      ? ownStaffMonth
      : ownDeptMonthsWithoutChildren(out, treeRows, id, metric);
    out[id] = mergeRolledMetricFromMonths(out[id] || emptyCascadeBlock(), metric, ownDeptMonth);
  }
  return out;
}

/**
 * ③ 직원 월 합계를 해당 부서 ② 매출에 반영 후 회사(전체 부서 합)까지 동기화.
 * @returns {{ deptMap: Record<string, unknown>, companyBlock: unknown }}
 */
export function pushStaffSumIntoDeptCascadeAndUp(
  staffRows,
  staffCascade,
  prevDeptMap,
  treeRows,
  prevCompanyBlock,
  deptId
) {
  const did = String(deptId || '').trim();
  if (!did || did === '_') {
    return {
      deptMap: { ...(prevDeptMap || {}) },
      companyBlock: normCascadeBlock(prevCompanyBlock || emptyCascadeBlock())
    };
  }
  const monthSum = sumOwnStaffAndDirectChildrenMonthsMetric(prevDeptMap, treeRows, staffRows, staffCascade, did, 'revenue');
  const baseDept = prevDeptMap[did] || emptyCascadeBlock();
  let nextDept = { ...prevDeptMap, [did]: mergeRolledMetricFromMonths(baseDept, 'revenue', monthSum) };
  nextDept = bubbleUpMetricAncestorsWithStaff(nextDept, treeRows, staffRows, staffCascade, did, 'revenue');
  const nextCo = syncCompanyRevenueFromRootDepts(prevCompanyBlock, nextDept, treeRows);
  return { deptMap: nextDept, companyBlock: nextCo };
}

/**
 * ② 부서 deptMap 기준으로 ③ 직원 매출을 월별 균등 분배 후 갱신.
 */
export function resyncStaffCascadeFromDeptMap(prevStaffCascade, staffRows, deptMap, treeRows = []) {
  const byDept = staffUserIdsByDeptSorted(staffRows);
  const out = { ...(prevStaffCascade || {}) };
  for (const [deptId, uids] of byDept) {
    if (!uids.length) continue;
    const rev = normCascadeBlock(deptMap[deptId] || emptyCascadeBlock()).revenue;
    const perUser = splitDeptRevenueEvenlyToStaffRevenue(rollupFromMonths(rev.month || Array(12).fill(0)), uids);
    for (const uid of uids) {
      out[uid] = normCascadeBlock({ revenue: perUser[uid] || topDownFromAnnual(0) });
    }
  }
  return out;
}

/** 회사 vs 최상위(depth 0) 부서 합계 불일치 플래그(입력란 붉은 표시용) */
export function emptyRootSumMismatch() {
  const mk = () => ({
    annual: false,
    semi: [false, false],
    quarter: [false, false, false, false],
    month: Array(12).fill(false)
  });
  return { revenue: mk() };
}

/** @param {Array<{ id: string, depth?: number, readOnly?: boolean }>} treeRows */
export function rootDepartmentIds(treeRows) {
  return (treeRows || []).filter((r) => Number(r.depth) === 0).map((r) => String(r.id));
}

/** @param {Array<{ id: string, depth?: number, readOnly?: boolean }>} treeRows */
export function editableRootDepartmentIds(treeRows) {
  return (treeRows || []).filter((r) => Number(r.depth) === 0 && !r.readOnly).map((r) => String(r.id));
}

/** @param {Array<{ id: string, readOnly?: boolean }>} treeRows */
export function editableDepartmentIds(treeRows) {
  return (treeRows || []).filter((r) => !r.readOnly).map((r) => String(r.id)).filter(Boolean);
}

/** 자동 분배에서 제외할 부서 id (문자열 Set) */
export function normalizeExcludeDepartmentIds(excludeDepartmentIds) {
  if (!excludeDepartmentIds) return new Set();
  if (excludeDepartmentIds instanceof Set) {
    return new Set([...excludeDepartmentIds].map((x) => String(x || '').trim()).filter(Boolean));
  }
  if (Array.isArray(excludeDepartmentIds)) {
    return new Set(excludeDepartmentIds.map((x) => String(x || '').trim()).filter(Boolean));
  }
  return new Set();
}

function readOnlyBranchRootIds(treeRows) {
  const rows = treeRows || [];
  const byId = new Map(rows.map((r) => [String(r.id || '').trim(), r]));
  return rows
    .filter((r) => {
      if (!r?.readOnly) return false;
      const parentId = String(r.parentId || '').trim();
      return !parentId || !byId.get(parentId)?.readOnly;
    })
    .map((r) => String(r.id || '').trim())
    .filter(Boolean);
}

function splitCompanyMetricMonthsToEditableDepartments(
  companyBlock,
  treeRows,
  prevDeptMap,
  metric,
  targetMonthIndexes = null,
  excludeDepartmentIds
) {
  const exclude = normalizeExcludeDepartmentIds(excludeDepartmentIds);
  const allEdit = editableDepartmentIds(treeRows);
  const editIds = allEdit.filter((id) => !exclude.has(id));
  if (!allEdit.length) return { ...prevDeptMap };
  const readOnlyFixedIds = readOnlyBranchRootIds(treeRows);
  const co = normCascadeBlock(companyBlock);
  const cm = co[metric]?.month || Array(12).fill(0);
  const targetSet = targetMonthIndexes
    ? new Set(targetMonthIndexes.map((x) => Math.max(0, Math.min(11, Math.floor(Number(x) || 0)))))
    : new Set(Array.from({ length: 12 }, (_, i) => i));
  const out = { ...prevDeptMap };
  const ownMonthsById = {};
  for (const id of allEdit) {
    const b = normCascadeBlock(out[id] || emptyCascadeBlock());
    ownMonthsById[id] = [...(b[metric]?.month || Array(12).fill(0))];
  }
  for (const mi of targetSet) {
    const monthTotal = Math.max(0, Math.round(Number(cm[mi]) || 0));
    let fixedSum = 0;
    for (const rid of readOnlyFixedIds) {
      const b = out[rid] ? normCascadeBlock(out[rid]) : emptyCascadeBlock();
      fixedSum += Math.max(0, Math.round(Number(b[metric]?.month?.[mi]) || 0));
    }
    const toAssign = Math.max(0, monthTotal - fixedSum);
    for (const id of allEdit) {
      if (exclude.has(id)) ownMonthsById[id][mi] = 0;
    }
    if (editIds.length > 0) {
      const parts = distributeEvenInt(toAssign, editIds.length);
      const rotation = editIds.length ? mi % editIds.length : 0;
      editIds.forEach((id, idx) => {
        const partIdx = (idx - rotation + editIds.length) % editIds.length;
        ownMonthsById[id][mi] = parts[partIdx] || 0;
      });
    }
  }

  for (const id of allEdit) {
    if (!id || !ownMonthsById[id]) continue;
    const month = ownMonthsById[id];
    out[id] = mergeRolledMetricFromMonths(out[id] || emptyCascadeBlock(), metric, month);
  }
  return out;
}

/**
 * 회사 목표 연간(매출)을 편집 가능한 부서 «행» 수 n으로 균등 분배합니다.
 * 편집 가능 부서는 먼저 0으로 비운 뒤 각 행에 `연간 총액/n`(정수 나머지 균등 배분)을 Top-down으로 넣습니다.
 * 상·하위 합산이 아니라 «표에 보이는 각 행이 동일 연간»이 되도록 쓰는 경로입니다(회사 연간 입력 핸들러에서 롤업 생략과 함께 사용).
 * @param {'revenue'} metric
 */
export function splitCompanyAnnualEvenAcrossEditableDepartmentRows(
  companyBlock,
  treeRows,
  prevDeptMap,
  metric,
  excludeDepartmentIds
) {
  if (metric !== 'revenue') return { ...prevDeptMap };
  const exclude = normalizeExcludeDepartmentIds(excludeDepartmentIds);
  const allEdit = editableDepartmentIds(treeRows);
  const editIds = allEdit.filter((id) => !exclude.has(id));
  if (!allEdit.length) return { ...prevDeptMap };
  const annualTotal = Math.max(
    0,
    Math.round(Number(normCascadeBlock(companyBlock)[metric]?.annual) || 0)
  );
  const parts = editIds.length > 0 ? distributeEvenInt(annualTotal, editIds.length) : [];
  const out = { ...prevDeptMap };
  const rows = treeRows || [];
  const z = topDownFromAnnual(0);
  for (const row of rows) {
    const id = String(row.id || '').trim();
    if (!id || row.readOnly) continue;
    if (!allEdit.includes(id)) continue;
    const base = out[id] || emptyCascadeBlock();
    out[id] = { ...base, [metric]: z };
  }
  editIds.forEach((id, idx) => {
    const share = parts[idx] || 0;
    const base = out[id] || emptyCascadeBlock();
    out[id] = { ...base, [metric]: topDownFromAnnual(share) };
  });
  return out;
}

/**
 * 회사 목표의 월 배열을 편집 가능한 전체 부서 행에 균등 분배합니다.
 * KPI 목표에서는 하위 부서를 부모 부서에 더하지 않습니다.
 * @param {'revenue'} metric
 */
export function splitCompanyMetricMonthsToEditableRoots(companyBlock, treeRows, prevDeptMap, metric, excludeDepartmentIds) {
  return splitCompanyMetricMonthsToEditableDepartments(
    companyBlock,
    treeRows,
    prevDeptMap,
    metric,
    null,
    excludeDepartmentIds
  );
}

/**
 * 예전 부모→자식 일괄 분배 호환 함수.
 * KPI 목표에서는 하위 부서 개념으로 분배하지 않으므로 입력 맵을 그대로 돌려줍니다.
 */
export function cascadeParentAnnualDownTree(treeRows, prevDeptMap) {
  return { ...(prevDeptMap || {}) };
}

/** 회사 반기 값을 상·하위 구분 없이 편집 가능한 전체 부서의 직속 직원 몫에 균등 분배 */
export function distributeCompanySemiToEditableRoots(
  prevDeptMap,
  treeRows,
  metric,
  semiIdx,
  semiTotal,
  excludeDepartmentIds
) {
  const si = Math.max(0, Math.min(1, Math.floor(Number(semiIdx) || 0)));
  const month = Array(12).fill(0);
  const parts = distributeEvenInt(Math.max(0, Math.round(Number(semiTotal) || 0)), 6);
  const start = si * 6;
  for (let i = 0; i < 6; i += 1) month[start + i] = parts[i] || 0;
  return splitCompanyMetricMonthsToEditableDepartments(
    { [metric]: rollupFromMonths(month) },
    treeRows,
    prevDeptMap,
    metric,
    Array.from({ length: 6 }, (_, i) => start + i),
    excludeDepartmentIds
  );
}

/** 회사 분기 값을 상·하위 구분 없이 편집 가능한 전체 부서의 직속 직원 몫에 균등 분배 */
export function distributeCompanyQuarterToEditableRoots(
  prevDeptMap,
  treeRows,
  metric,
  quarterIdx,
  quarterTotal,
  excludeDepartmentIds
) {
  const qi = Math.max(0, Math.min(3, Math.floor(Number(quarterIdx) || 0)));
  const month = Array(12).fill(0);
  const parts = distributeEvenInt(Math.max(0, Math.round(Number(quarterTotal) || 0)), 3);
  const start = qi * 3;
  for (let i = 0; i < 3; i += 1) month[start + i] = parts[i] || 0;
  return splitCompanyMetricMonthsToEditableDepartments(
    { [metric]: rollupFromMonths(month) },
    treeRows,
    prevDeptMap,
    metric,
    Array.from({ length: 3 }, (_, i) => start + i),
    excludeDepartmentIds
  );
}

/**
 * 회사 블록과 ② 부서 행 전체 합계를 항목별로 비교.
 * KPI 목표에서는 하위 부서를 부모 부서에 더하지 않고, 각 부서 행을 독립 목표로 봅니다.
 * @returns {{ mismatch: ReturnType<typeof emptyRootSumMismatch>, detailLines: string[], hasMismatch: boolean }}
 */
export function compareCompanyToRootDeptSums(companyBlock, deptMap, treeRows) {
  const mismatch = emptyRootSumMismatch();
  const detailLines = [];
  const deptIds = (treeRows || []).map((r) => String(r.id || '').trim()).filter(Boolean);
  if (!deptIds.length) return { mismatch, detailLines, hasMismatch: false };

  const co = normCascadeBlock(companyBlock);

  const sumDept = (metric, selector) => {
    let s = 0;
    for (const id of deptIds) {
      const b = deptMap?.[id] ? normCascadeBlock(deptMap[id]) : emptyCascadeBlock();
      s += Math.max(0, Math.round(Number(selector(b[metric])) || 0));
    }
    return s;
  };

  const push = (metric, label, coVal, sumVal, flagSetter, tol = 0) => {
    const c = Math.max(0, Math.round(Number(coVal) || 0));
    const r = Math.max(0, Math.round(Number(sumVal) || 0));
    if (Math.abs(c - r) <= Math.max(0, Math.round(Number(tol) || 0))) return;
    flagSetter();
    const diff = r - c;
    const diffStr = diff > 0 ? `+${diff.toLocaleString('ko-KR')}` : diff.toLocaleString('ko-KR');
    const unit = metric === 'revenue' ? '원' : '개';
    detailLines.push(
      `${metric === 'revenue' ? '매출' : '프로젝트'} ${label}: 회사 ${c.toLocaleString('ko-KR')}${unit} — 부서 전체 합 ${r.toLocaleString('ko-KR')}${unit} (차이 ${diffStr})`
    );
  };

  /* 프로젝트 목표 입력은 UI에서 제외 — 저장 전 검증은 매출만 회사·부서 전체 합 일치 여부로 판단 */
  for (const metric of ['revenue']) {
    const m = co[metric];
    const n = deptIds.length;
    const coAnnual = Math.max(0, Math.round(Number(m.annual) || 0));
    const intTol = Math.max(n, 24);

    push(
      metric,
      '연간',
      coAnnual,
      sumDept(metric, (mm) => mm?.annual),
      () => {
        mismatch[metric].annual = true;
      },
      intTol
    );
    for (let si = 0; si < 2; si += 1) {
      const siLabel = si === 0 ? '상반기(1H)' : '하반기(2H)';
      const coSi = Math.max(0, Math.round(Number(m.semi?.[si]) || 0));
      push(
        metric,
        siLabel,
        coSi,
        sumDept(metric, (mm) => mm?.semi?.[si]),
        () => {
          mismatch[metric].semi[si] = true;
        },
        intTol
      );
    }
    for (let qi = 0; qi < 4; qi += 1) {
      const coQ = Math.max(0, Math.round(Number(m.quarter?.[qi]) || 0));
      push(
        metric,
        `Q${qi + 1}`,
        coQ,
        sumDept(metric, (mm) => mm?.quarter?.[qi]),
        () => {
          mismatch[metric].quarter[qi] = true;
        },
        intTol
      );
    }
    for (let mi = 0; mi < 12; mi += 1) {
      const coM = Math.max(0, Math.round(Number(m.month?.[mi]) || 0));
      push(
        metric,
        `${mi + 1}월`,
        coM,
        sumDept(metric, (mm) => mm?.month?.[mi]),
        () => {
          mismatch[metric].month[mi] = true;
        },
        intTol
      );
    }
  }

  return { mismatch, detailLines, hasMismatch: detailLines.length > 0 };
}
