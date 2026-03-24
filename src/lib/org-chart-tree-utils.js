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
