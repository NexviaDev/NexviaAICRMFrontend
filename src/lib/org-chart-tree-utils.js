export function findOrgChartNodeById(node, id) {
  if (!node || id == null || id === '') return null;
  const sid = String(id);
  if (String(node.id) === sid) return node;
  for (const c of node.children || []) {
    const f = findOrgChartNodeById(c, sid);
    if (f) return f;
  }
  return null;
}

/** 조직 노드 → 목록/피커에 쓸 부서 표시 문자열 */
export function formatOrgChartNodeDeptLabel(node) {
  if (!node || typeof node !== 'object') return '';
  const n = String(node.name || '').trim();
  const r = String(node.roleLabel || '').trim();
  if (!n) return '';
  return r ? `${n} (${r})` : n;
}

/** DB에 저장된 부서(조직 노드 id)를 조직도 루트로 해석해 표시명으로 바꿉니다. 트리 없음·미매칭 시 id 그대로. */
export function resolveDepartmentDisplayFromChart(orgRoot, storedDeptId) {
  const s = String(storedDeptId || '').trim();
  if (!s) return '';
  if (!orgRoot) return s;
  const n = findOrgChartNodeById(orgRoot, s);
  if (n) return formatOrgChartNodeDeptLabel(n) || s;
  return s;
}

export function flattenOrgChartNodeIds(node) {
  const out = [];
  function walk(n) {
    if (!n || typeof n !== 'object') return;
    const id = String(n.id || '').trim();
    if (id) out.push(id);
    for (const c of n.children || []) walk(c);
  }
  walk(node);
  return out;
}

/** 선택한 조직 노드와 그 하위 노드의 id 집합 (직원 companyDepartment 매칭용) */
export function collectAllowedMemberDeptIds(orgRoot, selectedNodeIds) {
  const allowed = new Set();
  for (const sid of selectedNodeIds) {
    const n = findOrgChartNodeById(orgRoot, sid);
    if (!n) continue;
    (function walk(x) {
      if (!x) return;
      const id = String(x.id || '').trim();
      if (id) allowed.add(id);
      for (const c of x.children || []) walk(c);
    }(n));
  }
  return allowed;
}

/**
 * 선택한 조직 노드 id만 (하위 부서 제외).
 * 직원의 companyDepartment가 해당 노드 id와 일치할 때만 같은 부서로 간주합니다.
 */
export function collectExactSelectedMemberDeptIds(orgRoot, selectedNodeIds) {
  const allowed = new Set();
  for (const sid of selectedNodeIds) {
    const n = findOrgChartNodeById(orgRoot, sid);
    if (!n) continue;
    const id = String(n.id || '').trim();
    if (id) allowed.add(id);
  }
  return allowed;
}
