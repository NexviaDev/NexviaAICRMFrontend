import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { crmFetchInit } from '@/lib/crm-auth';
import { useNavigate, useParams } from 'react-router-dom';
import './employee-work-report.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import { API_BASE } from '@/config';

const PAGE_SIZE = 10;

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

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function startOfWeekMonday(d) {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function getPeriodRange(period, now = new Date()) {
  if (period === 'today') {
    return { start: startOfDay(now), end: endOfDay(now), label: '오늘' };
  }
  if (period === 'week') {
    const start = startOfWeekMonday(now);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start, end: endOfDay(end), label: '이번 주' };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end, label: '이번 달' };
}

function formatRangeLabel(start, end) {
  const f = (d) =>
    `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  return `${f(start)} ~ ${f(end)}`;
}

function initialsFromName(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

function activityKind(title) {
  const t = String(title || '');
  if (t.startsWith('[일정]')) return 'calendar';
  if (t.startsWith('[영업]')) return 'sales';
  if (t.startsWith('[지원]')) return 'support';
  return 'other';
}

function kindMeta(kind) {
  if (kind === 'calendar') return { label: '일정', className: 'is-calendar', icon: 'event' };
  if (kind === 'sales') return { label: '영업 기회', className: 'is-sales', icon: 'bolt' };
  if (kind === 'support') return { label: '기술지원', className: 'is-support', icon: 'support_agent' };
  return { label: '기타', className: 'is-other', icon: 'description' };
}

function statusMeta(status) {
  if (status === 'Completed') return { label: '완료', className: 'is-done' };
  if (status === 'In Progress') return { label: '진행 중', className: 'is-progress' };
  return { label: '예정', className: 'is-pending' };
}

function daysUntilLabel(date) {
  const target = startOfDay(date);
  const today = startOfDay(new Date());
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'D-Day';
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

function resolveAvatarUrl(...candidates) {
  for (const c of candidates) {
    const s = String(c || '').trim();
    if (s) return s;
  }
  return '';
}

function readLocalCrmUserAvatar() {
  try {
    const raw = localStorage.getItem('crm_user');
    if (!raw) return { id: '', avatar: '' };
    const u = JSON.parse(raw);
    return {
      id: String(u?._id || u?.id || ''),
      avatar: String(u?.avatar || '').trim()
    };
  } catch (_) {
    return { id: '', avatar: '' };
  }
}

function downloadCsv(filename, rows) {
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['일시', '시간', '구분', '제목', '상세', '상태'];
  const lines = [header.map(escape).join(',')];
  rows.forEach((r) => {
    lines.push(
      [r.date, r.time, kindMeta(r.kind).label, r.title, r.sub, statusMeta(r.status).label]
        .map(escape)
        .join(',')
    );
  });
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function EmployeeWorkReport() {
  const navigate = useNavigate();
  const { employeeId } = useParams();
  const [companyUsers, setCompanyUsers] = useState([]);
  const [organizationChart, setOrganizationChart] = useState(null);
  const [currentUserId, setCurrentUserId] = useState('');
  const [meAvatar, setMeAvatar] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedUserAvatar, setSelectedUserAvatar] = useState('');
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [calendarItems, setCalendarItems] = useState([]);
  const [salesItems, setSalesItems] = useState([]);
  const [workHistoryItems, setWorkHistoryItems] = useState([]);
  const [pages, setPages] = useState({ previous: 1, today: 1, upcoming: 1 });
  const [period, setPeriod] = useState('month');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [listQuery, setListQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const pastRef = useRef(null);
  const todayRef = useRef(null);
  const upcomingRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meRes, overviewRes] = await Promise.all([
          fetch(`${API_BASE}/auth/me`, crmFetchInit()),
          fetch(`${API_BASE}/companies/overview`, crmFetchInit())
        ]);
        const meJson = await meRes.json().catch(() => ({}));
        const overviewJson = await overviewRes.json().catch(() => ({}));
        const me = meJson?.user || meJson || {};
        const meId = String(me?._id || me?.id || '');
        const mePhoto = String(me?.avatar || '').trim();
        const localUser = readLocalCrmUserAvatar();
        const users = Array.isArray(overviewJson?.employees) ? overviewJson.employees : [];
        const enrichedUsers = users.map((u) => {
          const uid = String(u.id || u._id || '');
          const fromApi = String(u.avatar || '').trim();
          if (fromApi) return u;
          if (meId && uid === meId && mePhoto) return { ...u, avatar: mePhoto };
          if (localUser.id && uid === localUser.id && localUser.avatar) {
            return { ...u, avatar: localUser.avatar };
          }
          return u;
        });
        if (cancelled) return;
        setCurrentUserId(meId);
        setMeAvatar(mePhoto || (localUser.id === meId ? localUser.avatar : '') || '');
        setCompanyUsers(enrichedUsers);
        setOrganizationChart(overviewJson?.company?.organizationChart || null);

        const routeEmployeeId = employeeId ? String(employeeId) : '';
        const canUseRouteUser = routeEmployeeId && enrichedUsers.some((u) => String(u.id || u._id || '') === routeEmployeeId);
        setSelectedUserId(canUseRouteUser ? routeEmployeeId : meId);
      } catch (_) {
        if (!cancelled) {
          setCurrentUserId('');
          setCompanyUsers([]);
          setSelectedUserId('');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedUserId) return () => {};
    (async () => {
      setLoading(true);
      setSelectedUserAvatar('');
      try {
        const now = new Date();
        const timeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
        const timeMax = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999).toISOString();
        const [calendarRes, salesRes] = await Promise.all([
          fetch(
            `${API_BASE}/calendar-events?start=${encodeURIComponent(timeMin)}&end=${encodeURIComponent(timeMax)}`,
            crmFetchInit()
          ),
          fetch(`${API_BASE}/sales-opportunities`, crmFetchInit())
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
        const wrRes = await fetch(
          `${API_BASE}/reports/work-report?userId=${encodeURIComponent(selectedUserId)}`,
          crmFetchInit()
        );
        const wrJson = await wrRes.json().catch(() => ({}));
        if (!cancelled) {
          setWorkHistoryItems(Array.isArray(wrJson?.activities) ? wrJson.activities : []);
          setSelectedUserAvatar(String(wrJson?.employee?.avatar || '').trim());
        }
      } catch (_) {
        if (!cancelled) {
          setWorkHistoryItems([]);
          setSelectedUserAvatar('');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedUserId]);

  const selectedUser = useMemo(() => {
    return companyUsers.find((u) => String(u.id || u._id || '') === String(selectedUserId)) || null;
  }, [companyUsers, selectedUserId]);

  useEffect(() => {
    setAvatarBroken(false);
  }, [selectedUserId, selectedUser?.avatar, selectedUserAvatar, meAvatar]);

  const resolvedAvatarUrl = useMemo(() => {
    const localUser = readLocalCrmUserAvatar();
    const isSelf = String(selectedUserId || '') && String(selectedUserId) === String(currentUserId);
    return resolveAvatarUrl(
      selectedUser?.avatar,
      selectedUserAvatar,
      isSelf ? meAvatar : '',
      isSelf && localUser.id === String(currentUserId) ? localUser.avatar : ''
    );
  }, [selectedUser, selectedUserAvatar, selectedUserId, currentUserId, meAvatar]);

  const roleLabel = (role) => {
    if (role === 'owner') return '대표 (Owner)';
    if (role === 'admin' || role === 'senior') return '관리자 (Admin)';
    if (role === 'manager' || role === 'practitioner' || role === 'contributor') return '실무자 (Manager)';
    if (role === 'staff') return '직원 (Staff)';
    if (role === 'pending') return '권한 대기 (Pending)';
    return '직원';
  };

  const timelineActivities = useMemo(() => {
    const selectedId = String(selectedUserId || '');
    if (!selectedId) return [];
    const nowMs = Date.now();
    const rows = [];

    calendarItems
      .filter((ev) => String(ev.userId || '') === selectedId)
      .forEach((ev) => {
        const start = new Date(ev.start || Date.now());
        const startMs = Number.isNaN(start.getTime()) ? nowMs : start.getTime();
        const status =
          ev.end && new Date(ev.end).getTime() < nowMs
            ? 'Completed'
            : startMs <= nowMs
              ? 'In Progress'
              : 'Pending';
        const title = `[일정] ${ev.title || '(제목 없음)'}`;
        rows.push({
          id: `calendar:${ev._id || Math.random()}`,
          kind: 'calendar',
          createdAt: new Date(startMs),
          date: new Date(startMs).toLocaleDateString('ko-KR').replace(/\s/g, ''),
          time: new Date(startMs).toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }),
          title,
          sub: ev.visibility === 'private' ? '개인 일정' : '회사 일정',
          related: ev.visibility === 'private' ? '개인' : '회사',
          status
        });
      });

    salesItems
      .filter((opp) => String(opp.assignedTo || '') === selectedId)
      .forEach((opp) => {
        const ts = new Date(opp.updatedAt || opp.createdAt || Date.now());
        const stage = String(opp.stage || '');
        const title = `[영업] ${opp.title || '(제목 없음)'}`;
        rows.push({
          id: `sales:${opp._id || Math.random()}`,
          kind: 'sales',
          createdAt: ts,
          date: ts.toLocaleDateString('ko-KR').replace(/\s/g, ''),
          time: ts.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }),
          title,
          sub: `${opp.customerCompanyName || '고객사 미지정'} · 단계: ${stage || 'NewLead'}`,
          related: opp.customerCompanyName || '고객사 미지정',
          relatedMeta: `단계: ${stage || 'NewLead'}`,
          status: stage === 'Won' || stage === 'Closed' ? 'Completed' : 'Pending'
        });
      });

    workHistoryItems.forEach((h) => {
      const ts = h?.createdAt ? new Date(h.createdAt) : new Date();
      const title = `[지원] ${h.title || '업무 기록'}`;
      rows.push({
        id: `history:${h.id || Math.random()}`,
        kind: 'support',
        rawId: h.id || '',
        customerCompanyId: h.customerCompanyId || '',
        customerCompanyEmployeeId: h.customerCompanyEmployeeId || '',
        createdAt: ts,
        date: h.date || ts.toLocaleDateString('ko-KR').replace(/\s/g, ''),
        time: h.time || ts.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }),
        title,
        sub: h.sub || '고객사/연락처 지원 이력',
        related: h.sub || '기술지원',
        status: 'Completed'
      });
    });

    return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [selectedUserId, calendarItems, salesItems, workHistoryItems]);

  const periodRange = useMemo(() => getPeriodRange(period), [period]);

  const filteredActivities = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return timelineActivities.filter((a) => {
      const t = a.createdAt.getTime();
      if (t < periodRange.start.getTime() || t > periodRange.end.getTime()) return false;
      if (!q) return true;
      return (
        String(a.title || '').toLowerCase().includes(q) ||
        String(a.sub || '').toLowerCase().includes(q) ||
        String(a.related || '').toLowerCase().includes(q)
      );
    });
  }, [timelineActivities, periodRange, listQuery]);

  const todayStart = useMemo(() => startOfDay(new Date()), [filteredActivities.length, selectedUserId, period]);
  const todayEnd = useMemo(() => {
    const d = new Date(todayStart);
    d.setDate(d.getDate() + 1);
    return d;
  }, [todayStart]);

  const previousAll = useMemo(
    () => filteredActivities.filter((a) => a.createdAt < todayStart),
    [filteredActivities, todayStart]
  );
  const todayAll = useMemo(
    () => filteredActivities.filter((a) => a.createdAt >= todayStart && a.createdAt < todayEnd),
    [filteredActivities, todayStart, todayEnd]
  );
  const upcomingAll = useMemo(
    () => filteredActivities.filter((a) => a.createdAt >= todayEnd),
    [filteredActivities, todayEnd]
  );

  const sectionMeta = {
    previous: {
      key: 'previous',
      label: '이전 업무',
      desc: '조회 기간 내 과거 일정·영업·지원 기록',
      items: previousAll,
      tone: 'brand'
    },
    today: {
      key: 'today',
      label: '금일 업무',
      desc: '오늘 일정 및 당일 활동 기록',
      items: todayAll,
      tone: 'sky'
    },
    upcoming: {
      key: 'upcoming',
      label: '예정 업무',
      desc: '앞으로 예정된 일정·영업 활동',
      items: upcomingAll,
      tone: 'amber'
    }
  };

  const visibleSections = useMemo(() => {
    if (sectionFilter === 'previous') return ['previous'];
    if (sectionFilter === 'today') return ['today'];
    if (sectionFilter === 'upcoming') return ['upcoming'];
    return ['previous', 'today', 'upcoming'];
  }, [sectionFilter]);

  const tasksDone = filteredActivities.filter((a) => a.status === 'Completed').length;
  const inProgressOrPending = filteredActivities.filter((a) => a.status !== 'Completed').length;
  const completionRate =
    filteredActivities.length > 0 ? Math.round((tasksDone / filteredActivities.length) * 100) : 0;

  const emp = {
    name: selectedUser?.name || '직원 미선택',
    title: roleLabel(selectedUser?.role),
    email: selectedUser?.email || '-',
    location:
      resolveDeptDisplay(organizationChart, selectedUser?.departmentDisplay || selectedUser?.department) ||
      '-',
    avatarUrl: resolvedAvatarUrl,
    activityCount: filteredActivities.length,
    tasksDone,
    completionRate,
    pendingCount: inProgressOrPending
  };

  useEffect(() => {
    setPages({ previous: 1, today: 1, upcoming: 1 });
  }, [employeeId, selectedUserId, period, listQuery, sectionFilter]);

  const openActivityLink = (a) => {
    if (!a) return;
    if (a.kind === 'support' || String(a.title || '').startsWith('[지원]')) {
      if (a.customerCompanyEmployeeId) {
        navigate(`/customer-company-employees?modal=detail&id=${encodeURIComponent(a.customerCompanyEmployeeId)}`);
        return;
      }
      if (a.customerCompanyId) {
        navigate(`/customer-companies?modal=detail&id=${encodeURIComponent(a.customerCompanyId)}`);
      }
      return;
    }
    if (a.kind === 'calendar' || String(a.title || '').startsWith('[일정]')) {
      navigate('/calendar');
      return;
    }
    if (a.kind === 'sales' || String(a.title || '').startsWith('[영업]')) {
      navigate('/sales-pipeline');
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

  const scrollToSection = useCallback((key) => {
    setSectionFilter(key === 'all' ? 'all' : key);
    const map = { previous: pastRef, today: todayRef, upcoming: upcomingRef };
    const ref = map[key];
    if (key !== 'all' && ref?.current) {
      window.setTimeout(() => {
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 40);
    }
  }, []);

  const handleExport = () => {
    const name = (emp.name || 'employee').replace(/\s+/g, '_');
    downloadCsv(`work-report-${name}-${period}.csv`, filteredActivities);
  };

  const rangeText = formatRangeLabel(periodRange.start, periodRange.end);

  const renderSectionTable = (key) => {
    const meta = sectionMeta[key];
    const pg = pagedSection(key);
    const refMap = { previous: pastRef, today: todayRef, upcoming: upcomingRef };
    return (
      <section
        key={key}
        ref={refMap[key]}
        id={`wr-${key}`}
        className={`wr-ref-section wr-ref-section--${meta.tone}`}
      >
        <div className="wr-ref-section-head">
          <div className="wr-ref-section-head-main">
            <div className={`wr-ref-section-icon tone-${meta.tone}`}>
              <span className="material-symbols-outlined" aria-hidden>
                {key === 'today' ? 'today' : key === 'upcoming' ? 'event_upcoming' : 'history'}
              </span>
            </div>
            <div>
              <div className="wr-ref-section-title-row">
                <h3>{meta.label}</h3>
                <span className="wr-ref-count-pill">{pg.total}건</span>
              </div>
              <p className="wr-ref-section-desc">{meta.desc}</p>
            </div>
          </div>
          <span className="wr-ref-period-chip">조회 기간: {rangeText}</span>
        </div>

        {pg.items.length === 0 ? (
          <div className="wr-ref-empty">
            <span className="material-symbols-outlined" aria-hidden>
              assignment
            </span>
            <h4>등록된 {meta.label} 기록이 없습니다.</h4>
            <p>
              {key === 'today'
                ? '오늘 일정·영업·지원 활동이 여기 표시됩니다. 캘린더나 영업 파이프라인에서 등록해 보세요.'
                : '선택한 기간·직원에 해당하는 기록이 없습니다.'}
            </p>
            <div className="wr-ref-empty-actions">
              <button type="button" className="wr-ref-btn wr-ref-btn--ghost" onClick={() => navigate('/calendar')}>
                캘린더 열기
              </button>
              <button
                type="button"
                className="wr-ref-btn wr-ref-btn--primary"
                onClick={() => navigate('/sales-pipeline')}
              >
                영업 파이프라인
              </button>
            </div>
          </div>
        ) : key === 'upcoming' ? (
          <>
            <ul className="wr-ref-upcoming-list">
              {pg.items.map((a) => {
                const km = kindMeta(a.kind || activityKind(a.title));
                const sm = statusMeta(a.status);
                return (
                  <li key={a.id || `${a.date}-${a.time}-${a.title}`} className="wr-ref-upcoming-card">
                    <div className="wr-ref-upcoming-card-main">
                      <div className="wr-ref-upcoming-card-top">
                        <span className={`wr-ref-tag ${km.className}`}>
                          <span className="material-symbols-outlined" aria-hidden>
                            {km.icon}
                          </span>
                          {km.label}
                        </span>
                        <span className="wr-ref-d-badge">{daysUntilLabel(a.createdAt)}</span>
                      </div>
                      <button type="button" className="wr-ref-task-link" onClick={() => openActivityLink(a)}>
                        {a.title}
                      </button>
                      <p className="wr-ref-task-sub">{a.sub}</p>
                      <div className="wr-ref-upcoming-meta">
                        <span>
                          <span className="material-symbols-outlined" aria-hidden>
                            schedule
                          </span>
                          {a.date} · {a.time}
                        </span>
                        <span>
                          <span className="material-symbols-outlined" aria-hidden>
                            business
                          </span>
                          {a.related || '—'}
                        </span>
                        <span className={`wr-ref-status ${sm.className}`}>{sm.label}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="wr-ref-btn wr-ref-btn--ghost wr-ref-upcoming-go"
                      onClick={() => openActivityLink(a)}
                    >
                      관련 화면
                      <span className="material-symbols-outlined" aria-hidden>
                        arrow_forward
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="wr-ref-pagination">
              <p>
                총 <strong>{pg.total}</strong>건 중 <strong>{pg.start}</strong>–<strong>{pg.end}</strong>건 표시
              </p>
              <div className="wr-ref-pagination-btns">
                <button
                  type="button"
                  disabled={pg.page <= 1}
                  onClick={() => setSectionPage(key, 1)}
                  aria-label="첫 페이지"
                >
                  «
                </button>
                <button
                  type="button"
                  disabled={pg.page <= 1}
                  onClick={() => setSectionPage(key, pg.page - 1)}
                  aria-label="이전"
                >
                  ‹
                </button>
                {getPageNumbers(pg.page, pg.totalPages).map((n, i) =>
                  n === '...' ? (
                    <span key={`e-${key}-${i}`} className="wr-ref-ellipsis">
                      …
                    </span>
                  ) : (
                    <button
                      key={`${key}-${n}`}
                      type="button"
                      className={pg.page === n ? 'is-active' : ''}
                      aria-current={pg.page === n ? 'page' : undefined}
                      onClick={() => setSectionPage(key, n)}
                    >
                      {n}
                    </button>
                  )
                )}
                <button
                  type="button"
                  disabled={pg.page >= pg.totalPages}
                  onClick={() => setSectionPage(key, pg.page + 1)}
                  aria-label="다음"
                >
                  ›
                </button>
                <button
                  type="button"
                  disabled={pg.page >= pg.totalPages}
                  onClick={() => setSectionPage(key, pg.totalPages)}
                  aria-label="마지막 페이지"
                >
                  »
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="wr-ref-table-wrap">
              <table className="wr-ref-table">
                <thead>
                  <tr>
                    <th>일시</th>
                    <th>구분</th>
                    <th>업무 제목 · 상세</th>
                    <th>연계</th>
                    <th>상태</th>
                    <th className="is-right">이동</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.items.map((a) => {
                    const km = kindMeta(a.kind || activityKind(a.title));
                    const sm = statusMeta(a.status);
                    return (
                      <tr key={a.id || `${a.date}-${a.time}-${a.title}`}>
                        <td>
                          <div className="wr-ref-date">
                            <strong>{a.date}</strong>
                            <span>{a.time}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`wr-ref-tag ${km.className}`}>
                            <span className="material-symbols-outlined" aria-hidden>
                              {km.icon}
                            </span>
                            {km.label}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="wr-ref-task-link"
                            onClick={() => openActivityLink(a)}
                          >
                            {a.title}
                          </button>
                          <p className="wr-ref-task-sub">{a.sub}</p>
                        </td>
                        <td>
                          <div className="wr-ref-related">
                            <strong>{a.related || '—'}</strong>
                            {a.relatedMeta ? <span>{a.relatedMeta}</span> : null}
                          </div>
                        </td>
                        <td>
                          <span className={`wr-ref-status ${sm.className}`}>{sm.label}</span>
                        </td>
                        <td className="is-right">
                          <button
                            type="button"
                            className="wr-ref-icon-btn"
                            aria-label="관련 화면으로 이동"
                            title="관련 화면으로 이동"
                            onClick={() => openActivityLink(a)}
                          >
                            <span className="material-symbols-outlined" aria-hidden>
                              open_in_new
                            </span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 모바일 카드 목록 */}
            <ul className="wr-ref-mobile-list">
              {pg.items.map((a) => {
                const km = kindMeta(a.kind || activityKind(a.title));
                const sm = statusMeta(a.status);
                return (
                  <li key={`m-${a.id || `${a.date}-${a.time}-${a.title}`}`} className="wr-ref-mobile-card">
                    <div className="wr-ref-mobile-card-top">
                      <span className={`wr-ref-tag ${km.className}`}>{km.label}</span>
                      <span className={`wr-ref-status ${sm.className}`}>{sm.label}</span>
                    </div>
                    <button type="button" className="wr-ref-task-link" onClick={() => openActivityLink(a)}>
                      {a.title}
                    </button>
                    <p className="wr-ref-task-sub">{a.sub}</p>
                    <div className="wr-ref-mobile-card-meta">
                      <span>
                        {a.date} · {a.time}
                      </span>
                      <span>{a.related || '—'}</span>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="wr-ref-pagination">
              <p>
                총 <strong>{pg.total}</strong>건 중 <strong>{pg.start}</strong>–<strong>{pg.end}</strong>건 표시
              </p>
              <div className="wr-ref-pagination-btns">
                <button
                  type="button"
                  disabled={pg.page <= 1}
                  onClick={() => setSectionPage(key, 1)}
                  aria-label="첫 페이지"
                >
                  «
                </button>
                <button
                  type="button"
                  disabled={pg.page <= 1}
                  onClick={() => setSectionPage(key, pg.page - 1)}
                  aria-label="이전"
                >
                  ‹
                </button>
                {getPageNumbers(pg.page, pg.totalPages).map((n, i) =>
                  n === '...' ? (
                    <span key={`e-${key}-${i}`} className="wr-ref-ellipsis">
                      …
                    </span>
                  ) : (
                    <button
                      key={`${key}-${n}`}
                      type="button"
                      className={pg.page === n ? 'is-active' : ''}
                      aria-current={pg.page === n ? 'page' : undefined}
                      onClick={() => setSectionPage(key, n)}
                    >
                      {n}
                    </button>
                  )
                )}
                <button
                  type="button"
                  disabled={pg.page >= pg.totalPages}
                  onClick={() => setSectionPage(key, pg.page + 1)}
                  aria-label="다음"
                >
                  ›
                </button>
                <button
                  type="button"
                  disabled={pg.page >= pg.totalPages}
                  onClick={() => setSectionPage(key, pg.totalPages)}
                  aria-label="마지막 페이지"
                >
                  »
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    );
  };

  return (
    <div className="page work-report-page work-report-page--ref">
      <header className="wr-ref-topbar">
        <div className="wr-ref-topbar-text">
          <div className="wr-ref-title-row">
            <h1>직원 업무 보고</h1>
          </div>
          <p className="wr-ref-subtitle">직원별 일정·영업·기술지원 활동을 한곳에서 확인합니다.</p>
        </div>
        <div className="wr-ref-topbar-tools">
          <label className="wr-ref-search">
            <span className="material-symbols-outlined" aria-hidden>
              search
            </span>
            <input
              type="search"
              value={listQuery}
              onChange={(e) => setListQuery(e.target.value)}
              placeholder="업무명, 고객사, 내용 검색…"
              aria-label="업무 검색"
            />
          </label>
          <label className="wr-ref-user-select-wrap">
            <span className="wr-ref-user-dot" aria-hidden />
            <select
              className="wr-ref-user-select"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              aria-label="직원 선택"
            >
              {companyUsers.map((u) => {
                const uid = String(u.id || u._id || '');
                return (
                  <option key={uid} value={uid}>
                    {u.name || u.email || uid}
                    {u.role ? ` (${roleLabel(u.role)})` : ''}
                  </option>
                );
              })}
            </select>
          </label>
          <div className="wr-ref-period-seg" role="group" aria-label="조회 기간">
            {[
              { id: 'month', label: '이번 달' },
              { id: 'week', label: '이번 주' },
              { id: 'today', label: '오늘' }
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={period === opt.id ? 'is-active' : ''}
                onClick={() => setPeriod(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <PageHeaderNotifyChat buttonClassName="wr-ref-notify-btn" wrapperClassName="wr-ref-notify-wrap" />
        </div>
      </header>

      <div className="page-content wr-ref-content">
        <section className="wr-ref-bento" aria-label="직원 요약">
          <article className="wr-ref-profile-card">
            <div className="wr-ref-avatar-wrap">
              {emp.avatarUrl && !avatarBroken ? (
                <img
                  src={emp.avatarUrl}
                  alt=""
                  className="wr-ref-avatar wr-ref-avatar--photo"
                  onError={() => setAvatarBroken(true)}
                />
              ) : (
                <div className="wr-ref-avatar wr-ref-avatar--fallback" aria-hidden>
                  {initialsFromName(emp.name)}
                </div>
              )}
              {selectedUserId && String(selectedUserId) === String(currentUserId) ? (
                <span className="wr-ref-online-dot" title="본인 계정" />
              ) : null}
            </div>
            <div className="wr-ref-profile-body">
              <div className="wr-ref-profile-name-row">
                <h2>{emp.name}</h2>
                <span className="wr-ref-role-chip">{emp.title}</span>
              </div>
              <p className="wr-ref-profile-meta">
                <span className="material-symbols-outlined" aria-hidden>
                  mail
                </span>
                {emp.email}
              </p>
              <p className="wr-ref-profile-meta">
                <span className="material-symbols-outlined" aria-hidden>
                  location_on
                </span>
                {emp.location}
              </p>
            </div>
          </article>

          <article className="wr-ref-kpi">
            <div className="wr-ref-kpi-head">
              <span>활동 기록</span>
              <span className="wr-ref-kpi-icon tone-indigo">
                <span className="material-symbols-outlined" aria-hidden>
                  schedule
                </span>
              </span>
            </div>
            <p className="wr-ref-kpi-value">
              {emp.activityCount}
              <small>건</small>
            </p>
            <p className="wr-ref-kpi-foot">{periodRange.label} 조회 기준</p>
          </article>

          <article className="wr-ref-kpi">
            <div className="wr-ref-kpi-head">
              <span>완료 업무</span>
              <span className="wr-ref-kpi-icon tone-emerald">
                <span className="material-symbols-outlined" aria-hidden>
                  check_circle
                </span>
              </span>
            </div>
            <p className="wr-ref-kpi-value">
              {emp.tasksDone}
              <small>/ {emp.activityCount} 건</small>
            </p>
            <div className="wr-ref-progress">
              <div className="wr-ref-progress-track">
                <div className="wr-ref-progress-bar" style={{ width: `${emp.completionRate}%` }} />
              </div>
              <span>{emp.completionRate}%</span>
            </div>
          </article>

          <article className="wr-ref-kpi">
            <div className="wr-ref-kpi-head">
              <span>예정 · 대기</span>
              <span className="wr-ref-kpi-icon tone-amber">
                <span className="material-symbols-outlined" aria-hidden>
                  event
                </span>
              </span>
            </div>
            <p className="wr-ref-kpi-value">
              {emp.pendingCount}
              <small>건</small>
            </p>
            <p className="wr-ref-kpi-foot">진행 중 · 예정 합계</p>
          </article>

          <article className="wr-ref-kpi wr-ref-kpi--dark">
            <div className="wr-ref-kpi-head">
              <span>완료율</span>
              <span className="wr-ref-grade">실측</span>
            </div>
            <p className="wr-ref-kpi-value">
              {emp.completionRate}
              <small>/ 100</small>
            </p>
            <p className="wr-ref-kpi-foot">완료 ÷ 전체 활동</p>
          </article>
        </section>

        <section className="wr-ref-tabs-bar" aria-label="목록 필터">
          <div className="wr-ref-tabs">
            {[
              { id: 'all', label: '전체 업무', count: filteredActivities.length },
              { id: 'previous', label: '이전 업무', count: previousAll.length },
              { id: 'today', label: '금일 업무', count: todayAll.length },
              { id: 'upcoming', label: '예정 업무', count: upcomingAll.length }
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`wr-ref-tab${sectionFilter === tab.id ? ' is-active' : ''}`}
                onClick={() => scrollToSection(tab.id)}
              >
                {sectionFilter === tab.id ? <span className="wr-ref-tab-dot" aria-hidden /> : null}
                <span>{tab.label}</span>
                <span className="wr-ref-tab-count">{tab.count}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="wr-ref-btn wr-ref-btn--ghost"
            onClick={handleExport}
            disabled={filteredActivities.length === 0}
          >
            <span className="material-symbols-outlined" aria-hidden>
              download
            </span>
            CSV 다운로드
          </button>
        </section>

        {loading ? <p className="wr-ref-loading">불러오는 중…</p> : null}

        {visibleSections.map((key) => renderSectionTable(key))}
      </div>
    </div>
  );
}
