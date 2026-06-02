import { resolveDepartmentDisplayFromChart } from '@/lib/org-chart-tree-utils';

/** team-members / overview 직원 객체에서 동일인 식별용 id */
function resolveMemberId(member) {
  if (!member || typeof member !== 'object') return '';
  const raw = member._id ?? member.userId ?? member.id;
  if (raw == null || raw === '') return '';
  return String(raw);
}

function normalizeMemberRow(member, patch = {}) {
  const id = resolveMemberId(member);
  if (!id) return null;
  return {
    ...member,
    _id: member._id ?? member.userId ?? member.id,
    ...patch
  };
}

/**
 * 사내현황(companies/overview) 직원 목록을 기준으로 팀원 API(calendar-events/team-members) 데이터와 병합합니다.
 * 팀 API는 동의(consent)한 사용자만 주므로 overview만 쓰면 부서 표시가 약할 수 있고, 팀만 쓰면 목록이 비거나 줄어듭니다.
 *
 * @param {Array<object>} teamMembers - team-members 응답의 members (또는 _id/userId/id 를 가진 목록)
 * @param {{ employees?: Array, company?: { organizationChart?: object } } | null | undefined} overview - overview JSON
 * @returns {Array<object>}
 */
export function buildParticipantDirectoryFromOverview(teamMembers, overview) {
  const team = Array.isArray(teamMembers) ? teamMembers : [];
  const employees = overview?.employees;
  if (!Array.isArray(employees) || employees.length === 0) {
    const fallback = team
      .map((m) => normalizeMemberRow(m))
      .filter(Boolean);
    const byId = new Map();
    for (const row of fallback) {
      byId.set(String(row._id), row);
    }
    return [...byId.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
  }

  const chart = overview?.company?.organizationChart;
  const teamById = new Map();
  for (const m of team) {
    const id = resolveMemberId(m);
    if (id) teamById.set(id, m);
  }
  const seen = new Set();
  const rows = [];

  for (const e of employees) {
    const id = String(e?.id ?? e?._id ?? '').trim();
    if (!id || seen.has(id)) continue;
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
      const row = normalizeMemberRow(tm, {
        name: tm.name || e.name,
        email: tm.email || e.email,
        phone: tm.phone || e.phone || '',
        companyDepartment: dept,
        department: tm.department || dept,
        departmentDisplay: departmentDisplay || tm.departmentDisplay,
        avatar: avT || avE,
        role: tm.role ?? e.role
      });
      if (row) rows.push(row);
    } else {
      rows.push({
        _id: e.id ?? e._id,
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
    const id = resolveMemberId(m);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const dept = String(m.companyDepartment ?? m.department ?? '').trim();
    const row = normalizeMemberRow(m, {
      phone: m.phone || '',
      companyDepartment: dept,
      department: m.department || dept,
      departmentDisplay:
        m.departmentDisplay ||
        resolveDepartmentDisplayFromChart(chart, dept) ||
        dept
    });
    if (row) rows.push(row);
  }

  rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
  return rows;
}
