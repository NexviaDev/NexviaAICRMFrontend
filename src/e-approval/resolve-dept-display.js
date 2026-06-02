import { resolveDepartmentDisplayFromChart } from '@/lib/org-chart-tree-utils';

/** companyDepartment(조직 노드 id) → 화면용 부서명 */
export function resolveDeptDisplayLabel(rawDept, orgChart, user) {
  const raw = String(rawDept || '').trim();
  if (!raw) return '';
  const explicit = String(user?.companyDepartmentDisplay || user?.departmentDisplay || '').trim();
  if (explicit) return explicit;
  return String(resolveDepartmentDisplayFromChart(orgChart, raw) || '').trim() || raw;
}
