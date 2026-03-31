import { Fragment, useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './employee-work-report.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';

import { API_BASE } from '@/config';

const PAGE_SIZE = 10;
const STATUS_COMPLETED = 'completed';

/** 페이지네이션에 표시할 번호 목록 (현재 페이지 주변 + 첫/끝, 생략은 '...') */
function getPageNumbers(current, total) {
  if (total <= 0) return [];
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('...');
    result.push(sorted[i]);
  }
  return result;
}

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function findOrgChartNodeById(node, id) {
  if (!node || id == null || id === '') return null;
  const sid = String(id);
  if (String(node.id) === sid) return node;
  for (const c of node.children || []) {
    const found = findOrgChartNodeById(c, sid);
    if (found) return found;
  }
  return null;
}

function formatOrgDeptPickerLabel(node) {
  if (!node || typeof node !== 'object') return '';
  const n = String(node.name || '').trim();
  const r = String(node.roleLabel || '').trim();
  if (!n) return '';
  return r ? `${n} (${r})` : n;
}

function resolveDeptDisplay(orgChartRoot, stored) {
  const s = String(stored || '').trim();
  if (!s) return '';
  const n = findOrgChartNodeById(orgChartRoot, s);
  if (n) return formatOrgDeptPickerLabel(n);
  return s;
}

export default function EmployeeWorkReport() {
  const navigate = useNavigate();
  const { employeeId } = useParams();
  const [companyUsers, setCompanyUsers] = useState([]);
  const [organizationChart, setOrganizationChart] = useState(null);
  const [currentUserId, setCurrentUserId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [todoItems, setTodoItems] = useState([]);
  const [calendarItems, setCalendarItems] = useState([]);
  const [salesItems, setSalesItems] = useState([]);
  const [workHistoryItems, setWorkHistoryItems] = useState([]);
  const [pages, setPages] = useState({ previous: 1, today: 1, upcoming: 1 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meRes, overviewRes] = await Promise.all([
          fetch(`${API_BASE}/auth/me`, { headers: getAuthHeader() }),
          fetch(`${API_BASE}/companies/overview`, { headers: getAuthHeader() })
        ]);
        const meJson = await meRes.json().catch(() => ({}));
        const overviewJson = await overviewRes.json().catch(() => ({}));
        const me = meJson?.user || meJson || {};
        const meId = String(me?._id || '');
        const users = Array.isArray(overviewJson?.employees) ? overviewJson.employees : [];
        if (cancelled) return;
        setCurrentUserId(meId);
        setCompanyUsers(users);
        setOrganizationChart(overviewJson?.company?.organizationChart || null);

        const routeEmployeeId = employeeId ? String(employeeId) : '';
        const canUseRouteUser = routeEmployeeId && users.some((u) => String(u.id || u._id || '') === routeEmployeeId);
        setSelectedUserId(canUseRouteUser ? routeEmployeeId : meId);
      } catch (_) {
        if (!cancelled) {
          setCurrentUserId('');
          setCompanyUsers([]);
          setSelectedUserId('');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [employeeId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedUserId) return () => {};
    (async () => {
      const headers = getAuthHeader();
      try {
        const now = new Date();
        const timeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
        const timeMax = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999).toISOString();
        const [calendarRes, salesRes] = await Promise.all([
          fetch(`${API_BASE}/calendar-events?start=${encodeURIComponent(timeMin)}&end=${encodeURIComponent(timeMax)}`, { headers }),
          fetch(`${API_BASE}/sales-opportunities`, { headers })
        ]);
        const calendarJson = await calendarRes.json().catch(() => ({}));
        const salesJson = await salesRes.json().catch(() => ({}));
        if (!cancelled) {
          setCalendarItems(Array.isArray(calendarJson?.items) ? calendarJson.items : []);
          const grouped = salesJson?.grouped && typeof salesJson.grouped === 'object' ? salesJson.grouped : {};
          setSalesItems(Object.values(grouped).flat());
        }
      } catch (_) {
        if (!cancelled) {
          setCalendarItems([]);
          setSalesItems([]);
        }
      }
      try {
        const wrRes = await fetch(`${API_BASE}/reports/work-report?userId=${encodeURIComponent(selectedUserId)}`, { headers });
        const wrJson = await wrRes.json().catch(() => ({}));
        if (!cancelled) {
          setWorkHistoryItems(Array.isArray(wrJson?.activities) ? wrJson.activities : []);
        }
      } catch (_) {
        if (!cancelled) setWorkHistoryItems([]);
      }

      if (selectedUserId !== currentUserId) {
        if (!cancelled) setTodoItems([]);
      } else {
        try {
          const listsRes = await fetch(`${API_BASE}/google-tasks/lists`, { headers, credentials: 'include' });
          const listsJson = await listsRes.json().catch(() => ({}));
          const lists = Array.isArray(listsJson?.items) ? listsJson.items : [];
          const taskRows = [];
          await Promise.all(
            lists.map(async (list) => {
              const listId = list?.id;
              if (!listId) return;
              const taskRes = await fetch(`${API_BASE}/google-tasks/lists/${encodeURIComponent(listId)}/tasks`, { headers, credentials: 'include' });
              const taskJson = await taskRes.json().catch(() => ({}));
              const items = Array.isArray(taskJson?.items) ? taskJson.items : [];
              items.forEach((t) => taskRows.push({ ...t, _taskListTitle: list.title || '' }));
            })
          );
          if (!cancelled) setTodoItems(taskRows);
        } catch (_) {
          if (!cancelled) setTodoItems([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedUserId, currentUserId]);

  const selectedUser = useMemo(() => {
    return companyUsers.find((u) => String(u.id || u._id || '') === String(selectedUserId)) || null;
  }, [companyUsers, selectedUserId]);

  const roleLabel = (role) => {
    if (role === 'owner') return '대표 (Owner)';
    if (role === 'senior') return '책임 (Senior)';
    if (role === 'staff') return '직원 (Staff)';
    if (role === 'pending') return '권한 대기 (Pending)';
    return '직원';
  };

  const timelineActivities = useMemo(() => {
    const selectedId = String(selectedUserId || '');
    if (!selectedId) return [];
    const nowMs = Date.now();
    const rows = [];

    if (selectedId === String(currentUserId || '')) {
      todoItems.forEach((t) => {
        const due = t?.due ? new Date(t.due) : null;
        const ts = due && !Number.isNaN(due.getTime()) ? due : new Date(t?.updated || t?.completed || t?.created || Date.now());
        rows.push({
          id: `todo:${t.id || Math.random()}`,
          createdAt: ts,
          date: ts.toLocaleDateString('ko-KR').replace(/\s/g, ''),
          time: ts.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }),
          title: `[할 일] ${t.title || '(제목 없음)'}`,
          sub: t._taskListTitle ? `목록: ${t._taskListTitle}` : '개인 할 일',
          status: t.status === STATUS_COMPLETED ? 'Completed' : 'Pending'
        });
      });
    }

    calendarItems
      .filter((ev) => String(ev.userId || '') === selectedId)
      .forEach((ev) => {
        const start = new Date(ev.start || Date.now());
        const startMs = Number.isNaN(start.getTime()) ? nowMs : start.getTime();
        const status = ev.end && new Date(ev.end).getTime() < nowMs ? 'Completed' : (startMs <= nowMs ? 'In Progress' : 'Pending');
        rows.push({
          id: `calendar:${ev._id || Math.random()}`,
          createdAt: new Date(startMs),
          date: new Date(startMs).toLocaleDateString('ko-KR').replace(/\s/g, ''),
          time: new Date(startMs).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }),
          title: `[일정] ${ev.title || '(제목 없음)'}`,
          sub: ev.visibility === 'private' ? '개인 일정' : '회사 일정',
          status
        });
      });

    salesItems
      .filter((opp) => String(opp.assignedTo || '') === selectedId)
      .forEach((opp) => {
        const ts = new Date(opp.updatedAt || opp.createdAt || Date.now());
        const stage = String(opp.stage || '');
        rows.push({
          id: `sales:${opp._id || Math.random()}`,
          createdAt: ts,
          date: ts.toLocaleDateString('ko-KR').replace(/\s/g, ''),
          time: ts.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }),
          title: `[영업] ${opp.title || '(제목 없음)'}`,
          sub: `${opp.customerCompanyName || '고객사 미지정'} · 단계: ${stage || 'NewLead'}`,
          status: stage === 'Won' || stage === 'Closed' ? 'Completed' : 'Pending'
        });
      });

    workHistoryItems.forEach((h) => {
      const ts = h?.createdAt ? new Date(h.createdAt) : new Date();
      rows.push({
        id: `history:${h.id || Math.random()}`,
        rawId: h.id || '',
        customerCompanyId: h.customerCompanyId || '',
        customerCompanyEmployeeId: h.customerCompanyEmployeeId || '',
        createdAt: ts,
        date: h.date || ts.toLocaleDateString('ko-KR').replace(/\s/g, ''),
        time: h.time || ts.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }),
        title: `[지원] ${h.title || '업무 기록'}`,
        sub: h.sub || '고객사/고객사 회원 지원 이력',
        status: 'Completed'
      });
    });

    return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [selectedUserId, currentUserId, todoItems, calendarItems, salesItems, workHistoryItems]);

  const tasksDone = timelineActivities.filter((a) => a.status === 'Completed').length;
  const completionRate = timelineActivities.length > 0 ? Math.round((tasksDone / timelineActivities.length) * 100) : 0;
  const emp = {
    name: selectedUser?.name || '직원 미선택',
    title: roleLabel(selectedUser?.role),
    email: selectedUser?.email || '-',
    location: resolveDeptDisplay(organizationChart, selectedUser?.departmentDisplay || selectedUser?.department) || '-',
    hoursLogged: timelineActivities.length,
    tasksDone,
    completionRate
  };

  const activities = timelineActivities;
  const total = activities.length;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const previousAll = activities.filter((a) => a.createdAt < todayStart);
  const todayAll = activities.filter((a) => a.createdAt >= todayStart && a.createdAt < todayEnd);
  const upcomingAll = activities.filter((a) => a.createdAt >= todayEnd);
  const sectionMeta = {
    previous: { label: '이전 업무', items: previousAll },
    today: { label: '금일 업무', items: todayAll },
    upcoming: { label: '예정 업무', items: upcomingAll }
  };
  const salesCount = activities.filter((a) => a.title.startsWith('[영업]')).length;
  const meetingCount = activities.filter((a) => a.title.startsWith('[일정]')).length;
  const adminCount = Math.max(0, total - salesCount - meetingCount);
  const workload = total > 0
    ? {
        sales: Math.round((salesCount / total) * 100),
        meetings: Math.round((meetingCount / total) * 100),
        admin: Math.max(0, 100 - Math.round((salesCount / total) * 100) - Math.round((meetingCount / total) * 100))
      }
    : { sales: 0, meetings: 0, admin: 0 };
  const rating = Number((((workload.sales * 0.05) + (completionRate * 0.05))).toFixed(1));
  const rangeText = activities.length > 0
    ? `${activities[activities.length - 1].date || '-'} - ${activities[0].date || '-'}`
    : '기록 없음';

  useEffect(() => {
    setPages({ previous: 1, today: 1, upcoming: 1 });
  }, [employeeId, total]);

  const openActivityLink = (a) => {
    if (!a) return;
    if (String(a.title || '').startsWith('[지원]')) {
      if (a.customerCompanyEmployeeId) {
        navigate(`/customer-company-employees?modal=detail&id=${encodeURIComponent(a.customerCompanyEmployeeId)}`);
        return;
      }
      if (a.customerCompanyId) {
        navigate(`/customer-companies?modal=detail&id=${encodeURIComponent(a.customerCompanyId)}`);
      }
      return;
    }
    if (String(a.title || '').startsWith('[일정]')) {
      navigate('/calendar');
      return;
    }
    if (String(a.title || '').startsWith('[영업]')) {
      navigate('/sales-pipeline');
      return;
    }
    if (String(a.title || '').startsWith('[할 일]')) {
      navigate('/todo-list');
    }
  };

  const pagedSection = (key) => {
    const items = sectionMeta[key].items;
    const page = pages[key] || 1;
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const startIndex = (safePage - 1) * PAGE_SIZE;
    const paged = items.slice(startIndex, startIndex + PAGE_SIZE);
    return {
      total: items.length,
      totalPages,
      page: safePage,
      start: items.length > 0 ? startIndex + 1 : 0,
      end: startIndex + paged.length,
      items: paged
    };
  };

  const setSectionPage = (key, page) => {
    setPages((prev) => ({ ...prev, [key]: page }));
  };

  return (
    <div className="page work-report-page">
      <header className="page-header work-report-header">
        <h2>직원 업무 보고</h2>
        <div className="header-search">
          <span className="material-symbols-outlined work-report-user-select-icon">person_search</span>
          <select
            className="work-report-user-select"
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            aria-label="직원 선택"
          >
            {companyUsers.map((u) => {
              const uid = String(u.id || u._id || '');
              return (
                <option key={uid} value={uid}>
                  {u.name || u.email || uid}
                </option>
              );
            })}
          </select>
        </div>
        <div className="header-actions">
          <div className="date-picker">
            <span className="material-symbols-outlined">calendar_month</span>
            <span>{rangeText}</span>
            <span className="material-symbols-outlined">expand_more</span>
          </div>
          <button type="button" className="icon-btn"><span className="material-symbols-outlined">download</span></button>
          <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" />
        </div>
      </header>

      <div className="page-content">
        <div className="employee-summary panel">
          <div className="employee-profile">
            <div className="employee-avatar-wrap">
              <div className="employee-avatar" />
            </div>
            <div className="employee-info">
              <h3>{emp.name}</h3>
              <p className="employee-title">{emp.title}</p>
              <div className="employee-meta">
                <span><span className="material-symbols-outlined">mail</span> {emp.email}</span>
                <span><span className="material-symbols-outlined">location_on</span> {emp.location}</span>
              </div>
            </div>
          </div>
          <div className="employee-stats">
            <div className="stat-box">
              <p className="stat-box-label">근무 시간</p>
              <p className="stat-box-value">{emp.hoursLogged}</p>
              <p className="stat-box-meta up"><span className="material-symbols-outlined">trending_up</span> 전월 대비 12%</p>
            </div>
            <div className="stat-box">
              <p className="stat-box-label">완료 업무</p>
              <p className="stat-box-value">{emp.tasksDone}</p>
              <p className="stat-box-meta"><span className="material-symbols-outlined">check_circle</span> 완료율 {emp.completionRate}%</p>
            </div>
          </div>
        </div>

        {['previous', 'today', 'upcoming'].map((key) => {
          const meta = sectionMeta[key];
          const pg = pagedSection(key);
          return (
            <div key={key} className="panel table-panel">
              <div className="panel-head work-report-timeline-head">
                <h4 className="work-report-timeline-title">
                  <span className="material-symbols-outlined">timeline</span>
                  {meta.label}
                </h4>
              </div>
              <div className="table-wrap">
                <table className="data-table activity-table">
                  <thead>
                    <tr>
                      <th>일시</th>
                      <th>업무 제목</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.items.map((a) => (
                      <tr key={a.id || `${a.date}-${a.time}-${a.title}`}>
                        <td>
                          <div className="date-cell">
                            <span className="date-main">{a.date}</span>
                            <span className="date-sub">{a.time}</span>
                          </div>
                        </td>
                        <td>
                          <p className="task-title">
                            <button
                              type="button"
                              className="work-report-activity-link"
                              onClick={() => openActivityLink(a)}
                            >
                              {a.title}
                            </button>
                          </p>
                          <p className="task-sub">{a.sub}</p>
                        </td>
                      </tr>
                    ))}
                    {pg.items.length === 0 && (
                      <tr>
                        <td colSpan={2}>등록된 업무 기록이 없습니다.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="pagination-bar">
                <p className="pagination-info">
                  <strong>{pg.total}</strong>건 중 <strong>{pg.start}</strong>–<strong>{pg.end}</strong>건 표시
                </p>
                <div className="pagination-btns">
                  <button type="button" className="pagination-btn small" aria-label="첫 페이지" disabled={pg.page <= 1} onClick={() => setSectionPage(key, 1)}>
                    <span className="material-symbols-outlined">first_page</span>
                  </button>
                  <button type="button" className="pagination-btn small" aria-label="이전 페이지" disabled={pg.page <= 1} onClick={() => setSectionPage(key, pg.page - 1)}>
                    <span className="material-symbols-outlined">chevron_left</span>
                  </button>
                  {getPageNumbers(pg.page, pg.totalPages).map((n, i) =>
                    n === '...' ? (
                      <span key={`ellipsis-${key}-${i}`} className="pagination-ellipsis" aria-hidden>…</span>
                    ) : (
                      <button
                        key={`${key}-${n}`}
                        type="button"
                        className={`pagination-btn small ${pg.page === n ? 'active' : ''}`}
                        aria-label={`${n}페이지`}
                        aria-current={pg.page === n ? 'page' : undefined}
                        onClick={() => setSectionPage(key, n)}
                      >
                        {n}
                      </button>
                    )
                  )}
                  <button type="button" className="pagination-btn small" aria-label="다음 페이지" disabled={pg.page >= pg.totalPages} onClick={() => setSectionPage(key, pg.page + 1)}>
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                  <button type="button" className="pagination-btn small" aria-label="마지막 페이지" disabled={pg.page >= pg.totalPages} onClick={() => setSectionPage(key, pg.totalPages)}>
                    <span className="material-symbols-outlined">last_page</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        <div className="insights-grid">
          <div className="panel workload-panel">
            <div className="panel-head">
              <h4>업무 부하 분포</h4>
              <span className="material-symbols-outlined text-muted">info</span>
            </div>
            <div className="workload-bars">
              <div className="workload-item">
                <div className="workload-label"><span>영업·파이프라인</span><span className="font-bold">{workload.sales}%</span></div>
                <div className="workload-bar-wrap"><div className="workload-bar primary" style={{ width: workload.sales + '%' }} /></div>
              </div>
              <div className="workload-item">
                <div className="workload-label"><span>회의·동기화</span><span className="font-bold">{workload.meetings ?? 25}%</span></div>
                <div className="workload-bar-wrap"><div className="workload-bar blue" style={{ width: (workload.meetings ?? 25) + '%' }} /></div>
              </div>
              <div className="workload-item">
                <div className="workload-label"><span>관리 업무</span><span className="font-bold">{workload.admin}%</span></div>
                <div className="workload-bar-wrap"><div className="workload-bar gray" style={{ width: (workload.admin ?? 15) + '%' }} /></div>
              </div>
            </div>
          </div>
          <div className="panel rating-panel">
            <h4>효율 점수</h4>
            <p className="rating-desc">업무 완료율과 근무 시간 비율 기준입니다.</p>
            <p className="rating-value">{rating}</p>
            <p className="rating-badge">우수</p>
            <button type="button" className="rating-btn">전체 분석 보기</button>
          </div>
        </div>
      </div>
    </div>
  );
}
