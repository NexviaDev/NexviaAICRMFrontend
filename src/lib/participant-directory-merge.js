import { resolveDepartmentDisplayFromChart } from '@/lib/org-chart-tree-utils';

/**
 * 사내현황(companies/overview) 직원 목록을 기준으로 팀원 API(calendar-events/team-members) 데이터와 병합합니다.
 * 팀 API는 동의(consent)한 사용자만 주므로 overview만 쓰면 부서 표시가 약할 수 있고, 팀만 쓰면 목록이 비거나 줄어듭니다.
 *
 * @param {Array<object>} teamMembers - team-members 응답의 members
 * @param {{ employees?: Array, company?: { organizationChart?: object } } | null | undefined} overview - overview JSON
 * @returns {Array<object>}
 */
export function buildParticipantDirectoryFromOverview(teamMembers, overview) {
  const team = Array.isArray(teamMembers) ? teamMembers : [];
  const employees = overview?.employees;
  if (!Array.isArray(employees) || employees.length === 0) {
    return team.length ? [...team].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko')) : [];
  }

  const chart = overview?.company?.organizationChart;
  const teamById = new Map(team.map((m) => [String(m._id), m]));
  const seen = new Set();
  const rows = [];

  for (const e of employees) {
    if (e?.id == null) continue;
    const id = String(e.id);
    seen.add(id);
    const tm = teamById.get(id);
    const dept = String(tm?.companyDepartment ?? e.department ?? '').trim();
    const departmentDisplay =
      tm?.departmentDisplay ||
      resolveDepartmentDisplayFromChart(chart, dept) ||
      dept;

    if (tm) {
      const avT = tm.avatar != null && String(tm.avatar).trim() ? String(tm.avatar).trim() : '';
      const avE = e.avatar != null && String(e.avatar).trim() ? String(e.avatar).trim() : '';
      rows.push({
        ...tm,
        phone: tm.phone || e.phone || '',
        companyDepartment: dept,
        department: tm.department || dept,
        departmentDisplay: departmentDisplay || tm.departmentDisplay,
        avatar: avT || avE
      });
    } else {
      rows.push({
        _id: e.id,
        name: e.name,
        email: e.email,
        phone: e.phone || '',
        avatar: e.avatar || '',
        role: e.role,
        companyDepartment: dept,
        department: dept,
        departmentDisplay: departmentDisplay || undefined
      });
    }
  }

  for (const m of team) {
    if (seen.has(String(m._id))) continue;
    rows.push(m);
  }

  rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
  return rows;
}
