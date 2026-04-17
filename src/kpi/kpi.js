import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE } from '@/config';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import KpiDetailModal from './kpi-detail-modal/kpi-detail-modal';
import KpiTargetModal from './kpi-target-modal/kpi-target-modal';
import './kpi.css';

const PERIODS = [
  { key: 'monthly', label: '월간' },
  { key: 'quarterly', label: '분기' },
  { key: 'semiannual', label: '반기' },
  { key: 'annual', label: '연간' }
];

const KPI_SCOPE_OPTIONS = [
  { key: 'team', label: '팀별' },
  { key: 'user', label: '개인별' }
];
const KPI_LIST_MODAL_PARAM = 'kpiList';
const KPI_LIST_METRIC_PARAM = 'kpiMetric';
const KPI_TARGET_MODAL_PARAM = 'kpiTarget';

function formatOrgDeptPickerLabel(node) {
  if (!node || typeof node !== 'object') return '';
  const n = String(node.name || '').trim();
  const r = String(node.roleLabel || '').trim();
  if (!n) return '';
  return r ? `${n} (${r})` : n;
}

function flattenOrgChartOptions(node, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  const id = String(node.id || '').trim();
  if (id) acc.push({ id, label: formatOrgDeptPickerLabel(node) });
  for (const c of node.children || []) flattenOrgChartOptions(c, acc);
  return acc;
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

function resolveDeptDisplay(orgChartRoot, stored) {
  const s = String(stored || '').trim();
  if (!s) return '';
  const node = findOrgChartNodeById(orgChartRoot, s);
  if (node) return formatOrgDeptPickerLabel(node);
  return s;
}

function getInitials(name) {
  const source = String(name || '').trim().replace(/\s+/g, '');
  if (!source) return '?';
  if (source.length <= 2) return source;
  return `${source[0]}${source[source.length - 1]}`;
}

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('ko-KR');
}

function formatRevenue(value) {
  return `${formatNumber(Math.round(Number(value) || 0))}원`;
}

function formatDelta(current, previous, suffix = '') {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev <= 0 && cur <= 0) return { text: `변동 없음${suffix}`, positive: true };
  if (prev <= 0) return { text: `신규 ${formatNumber(cur)}${suffix}`, positive: true };
  const diffPct = ((cur - prev) / prev) * 100;
  const sign = diffPct >= 0 ? '+' : '';
  return {
    text: `${sign}${diffPct.toFixed(1)}%`,
    positive: diffPct >= 0
  };
}

function calcAchievement(current, target) {
  const cur = Number(current) || 0;
  const tgt = Number(target) || 0;
  if (tgt <= 0) return 0;
  return Math.max(0, Math.min(999, Math.round((cur / tgt) * 100)));
}

function buildPeriodDescription(periodType, label) {
  const name = PERIODS.find((item) => item.key === periodType)?.label || label || '현재 기간';
  if (periodType === 'monthly') return `${name} 실적과 전달 대비 변화를 확인합니다.`;
  if (periodType === 'quarterly') return `${name} 실적과 직전 분기 비교, 목표 진행률을 함께 봅니다.`;
  if (periodType === 'semiannual') return `${name} 누적 실적과 직전 반기 대비 차이를 확인합니다.`;
  return `${name} 누적 실적과 직전 연도 대비 흐름을 확인합니다.`;
}

function getCurrentPeriodValueForType(periodType, now = new Date()) {
  const month = now.getMonth() + 1;
  if (periodType === 'quarterly') return Math.ceil(month / 3);
  if (periodType === 'semiannual') return month <= 6 ? 1 : 2;
  if (periodType === 'annual') return 1;
  return month;
}

function buildPeriodValueOptions(periodType) {
  if (periodType === 'quarterly') {
    return [
      { value: 1, label: '1분기' },
      { value: 2, label: '2분기' },
      { value: 3, label: '3분기' },
      { value: 4, label: '4분기' }
    ];
  }
  if (periodType === 'semiannual') {
    return [
      { value: 1, label: '상반기' },
      { value: 2, label: '하반기' }
    ];
  }
  if (periodType === 'annual') {
    return [{ value: 1, label: '연간' }];
  }
  return Array.from({ length: 12 }, (_, idx) => ({ value: idx + 1, label: `${idx + 1}월` }));
}

function buildDetailRows(dashboard, metricKey = 'all') {
  const metrics = dashboard?.metrics || {};
  const target = dashboard?.target || {};
  const revenueCurrent = Number(metrics?.revenue?.current) || 0;
  const revenuePrevious = Number(metrics?.revenue?.previous) || 0;
  const revenueTarget = Number(metrics?.revenue?.target) || 0;
  const dealsCurrent = Number(metrics?.wonDeals?.current) || 0;
  const dealsPrevious = Number(metrics?.wonDeals?.previous) || 0;
  const projectsCurrent = Number(metrics?.completedProjects?.current) || 0;
  const projectsPrevious = Number(metrics?.completedProjects?.previous) || 0;
  const projectsTarget = Number(metrics?.completedProjects?.target) || Number(target?.targetProjects) || 0;
  const activeProjectsCurrent = Number(metrics?.activeProjects?.current) || 0;
  const activeProjectsPrevious = Number(metrics?.activeProjects?.previous) || 0;
  const workCurrent = Number(metrics?.workLogs?.current) || 0;
  const workPrevious = Number(metrics?.workLogs?.previous) || 0;

  const avgDealValue = dealsCurrent > 0
    ? revenueCurrent / dealsCurrent
    : dealsPrevious > 0
      ? revenuePrevious / Math.max(1, dealsPrevious)
      : 0;
  const dealTarget = revenueTarget > 0 && avgDealValue > 0
    ? Math.max(1, Math.round(revenueTarget / avgDealValue))
    : Math.max(dealsCurrent, dealsPrevious, 1);
  const workTarget = projectsTarget > 0
    ? Math.max(projectsTarget * 3, workPrevious, 1)
    : Math.max(workCurrent, workPrevious, 1);
  const formatGap = (key, value) => {
    const safe = Math.max(0, Number(value) || 0);
    if (key === 'revenue') return formatRevenue(safe);
    if (key === 'projects' || key === 'activeProjects') return `${formatNumber(safe)}개`;
    return `${formatNumber(safe)}건`;
  };

  const rawRows = [
    {
      key: 'revenue',
      label: '매출액',
      previous: revenuePrevious,
      current: revenueCurrent,
      target: revenueTarget,
      previousDisplay: formatRevenue(revenuePrevious),
      currentDisplay: formatRevenue(revenueCurrent),
      targetDisplay: revenueTarget > 0 ? formatRevenue(revenueTarget) : '미설정'
    },
    {
      key: 'wonDeals',
      label: '수주 건수',
      previous: dealsPrevious,
      current: dealsCurrent,
      target: dealTarget,
      previousDisplay: `${formatNumber(dealsPrevious)}건`,
      currentDisplay: `${formatNumber(dealsCurrent)}건`,
      targetDisplay: `${formatNumber(dealTarget)}건`
    },
    {
      key: 'projects',
      label: '완료 프로젝트',
      previous: projectsPrevious,
      current: projectsCurrent,
      target: projectsTarget,
      previousDisplay: `${formatNumber(projectsPrevious)}개`,
      currentDisplay: `${formatNumber(projectsCurrent)}개`,
      targetDisplay: projectsTarget > 0 ? `${formatNumber(projectsTarget)}개` : '미설정',
      summaryText: projectsTarget > 0 ? `목표 ${formatNumber(projectsTarget)}개` : '목표 미설정'
    },
    {
      key: 'activeProjects',
      label: '진행중 프로젝트',
      previous: activeProjectsPrevious,
      current: activeProjectsCurrent,
      target: 0,
      previousDisplay: `${formatNumber(activeProjectsPrevious)}개`,
      currentDisplay: `${formatNumber(activeProjectsCurrent)}개`,
      targetDisplay: '-',
      summaryText: '백엔드 진행중 기준'
    },
    {
      key: 'workLogs',
      label: '업무 기록',
      previous: workPrevious,
      current: workCurrent,
      target: workTarget,
      previousDisplay: `${formatNumber(workPrevious)}건`,
      currentDisplay: `${formatNumber(workCurrent)}건`,
      targetDisplay: `${formatNumber(workTarget)}건`
    }
  ];

  const maxValue = Math.max(
    1,
    ...rawRows.flatMap((row) => [row.previous, row.current, row.target])
  );

  const allRows = rawRows.map((row) => ({
    ...row,
    achievementPct: row.target > 0 ? calcAchievement(row.current, row.target) : null,
    gapDisplay:
      row.key === 'activeProjects'
        ? '백엔드 stage 기준 진행중'
        : row.target > 0
        ? row.current >= row.target
          ? `목표 초과 ${formatGap(row.key, row.current - row.target)}`
          : `목표까지 ${formatGap(row.key, row.target - row.current)}`
        : '목표 미설정',
    previousPct: row.previous > 0 ? Math.max(8, Math.round((row.previous / maxValue) * 100)) : 0,
    currentPct: row.current > 0 ? Math.max(8, Math.round((row.current / maxValue) * 100)) : 0,
    targetPct: row.target > 0 ? Math.max(8, Math.round((row.target / maxValue) * 100)) : 0
  }));

  if (metricKey === 'revenue') return allRows.filter((row) => row.key === 'revenue');
  if (metricKey === 'wonDeals') return allRows.filter((row) => row.key === 'wonDeals');
  if (metricKey === 'projects') return allRows.filter((row) => row.key === 'projects' || row.key === 'activeProjects');
  if (metricKey === 'workLogs') return allRows.filter((row) => row.key === 'workLogs');
  return allRows.filter((row) => row.key !== 'activeProjects');
}

function buildChartRows(dashboard) {
  return buildDetailRows(dashboard, 'all');
}

function getDetailModalMeta(metricKey) {
  if (metricKey === 'revenue') {
    return {
      title: '수주 매출 상세',
      description: '현재 기간의 수주 매출 건을 개별 항목으로 확인합니다.'
    };
  }
  if (metricKey === 'wonDeals') {
    return {
      title: '수주 성공 상세',
      description: '현재 기간의 수주 성공 건을 개별 항목으로 확인합니다.'
    };
  }
  if (metricKey === 'projects') {
    return {
      title: '프로젝트 상세',
      description: '현재 범위에 속한 프로젝트를 낱개 단위로 확인합니다.'
    };
  }
  if (metricKey === 'workLogs') {
    return {
      title: '업무 기록 상세',
      description: '현재 기간의 업무 기록을 개별 항목으로 확인합니다.'
    };
  }
  return {
    title: 'KPI 상세',
    description: '차트에 보이는 핵심 지표를 표 형식으로 더 자세히 확인합니다.'
  };
}

function resolveChecklistScope(scopeType, departmentId, userId) {
  if (scopeType === 'team' && departmentId) {
    return { scopeType: 'team', scopeId: String(departmentId || '').trim() };
  }
  if (scopeType === 'user' && userId) {
    return { scopeType: 'user', scopeId: String(userId || '').trim() };
  }
  return { scopeType: 'company', scopeId: '' };
}

function mergeChecklistItems(rows, checklistItems = []) {
  const byKey = new Map(
    (Array.isArray(checklistItems) ? checklistItems : []).map((item) => [String(item?.itemKey || '').trim(), item])
  );
  return rows.map((row) => {
    const saved = byKey.get(row.key);
    return {
      ...row,
      score: Math.max(0, Number(saved?.score) || 0),
      checked: Boolean(saved?.checked)
    };
  });
}

function normalizeDetailItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    key: String(item?.key || '').trim(),
    label: String(item?.label || '항목'),
    currentDisplay: String(item?.currentDisplay || ''),
    previousDisplay: String(item?.previousDisplay || ''),
    targetDisplay: String(item?.targetDisplay || '-'),
    summaryText: String(item?.summaryText || ''),
    gapDisplay: String(item?.gapDisplay || ''),
    customerCompanyDisplay: String(item?.customerCompanyDisplay || '').trim(),
    businessNumberDisplay: String(item?.businessNumberDisplay || '').trim(),
    productName: String(item?.productName || '').trim(),
    quantity: Math.max(0, Number(item?.quantity) || 0),
    unitPriceLabel: String(item?.unitPriceLabel || '').trim(),
    contactPhone: String(item?.contactPhone || '').trim(),
    contactEmail: String(item?.contactEmail || '').trim(),
    assigneeDisplay: String(item?.assigneeDisplay || '').trim(),
    contactDisplay: String(item?.contactDisplay || '').trim(),
    dateLabelTitle: String(item?.dateLabelTitle || '완료일').trim(),
    completedDateDisplay: String(item?.completedDateDisplay || '').trim(),
    detailLines: (Array.isArray(item?.detailLines) ? item.detailLines : []).map((line) => String(line || '').trim()).filter(Boolean),
    achievementPct: item?.achievementPct == null ? null : Number(item.achievementPct)
  })).filter((item) => item.key);
}

function hasChecklistSummary(summary) {
  return Boolean(summary && Number(summary?.totalCount) > 0);
}

function getUserName() {
  try {
    const raw = localStorage.getItem('crm_user');
    const user = raw ? JSON.parse(raw) : null;
    const name = String(user?.name || '').trim();
    return name || '사용자';
  } catch {
    return '사용자';
  }
}

function getStoredUser() {
  try {
    const raw = localStorage.getItem('crm_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function Kpi() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [period, setPeriod] = useState('monthly');
  const [scopeType, setScopeType] = useState('team');
  const [selectedScopeDepartment, setSelectedScopeDepartment] = useState('');
  const [selectedScopeUser, setSelectedScopeUser] = useState('');
  const [viewBy, setViewBy] = useState('overall');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedRank, setSelectedRank] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [targetRevenueInput, setTargetRevenueInput] = useState('');
  const [targetProjectsInput, setTargetProjectsInput] = useState('');
  const [targetNote, setTargetNote] = useState('');
  const [savingTarget, setSavingTarget] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [targetOverview, setTargetOverview] = useState(null);
  const [targetModalScopeType, setTargetModalScopeType] = useState('team');
  const [targetModalDepartmentId, setTargetModalDepartmentId] = useState('');
  const [targetModalUserId, setTargetModalUserId] = useState('');
  const [targetModalPeriodType, setTargetModalPeriodType] = useState('monthly');
  const [targetModalYear, setTargetModalYear] = useState(new Date().getFullYear());
  const [targetModalPeriodValue, setTargetModalPeriodValue] = useState(getCurrentPeriodValueForType('monthly'));
  const [targetModalRevenue, setTargetModalRevenue] = useState('');
  const [targetModalProjects, setTargetModalProjects] = useState('');
  const [targetModalNote, setTargetModalNote] = useState('');
  const [targetModalLoading, setTargetModalLoading] = useState(false);
  const [targetModalSaving, setTargetModalSaving] = useState(false);
  const [targetModalMessage, setTargetModalMessage] = useState('');
  const [checklistSummaryByMetric, setChecklistSummaryByMetric] = useState({});
  const [detailChecklistItems, setDetailChecklistItems] = useState([]);
  const [detailChecklistLoading, setDetailChecklistLoading] = useState(false);
  const [detailChecklistSaving, setDetailChecklistSaving] = useState(false);
  const [detailChecklistMessage, setDetailChecklistMessage] = useState('');

  const displayName = useMemo(() => getUserName(), []);
  const storedUser = useMemo(() => getStoredUser(), []);
  const currentUserId = String(storedUser?._id || storedUser?.id || overview?.me?.id || '').trim();
  const availableDepartments = dashboard?.filters?.availableDepartments || [];
  const availableRanks = dashboard?.filters?.availableRanks || [];
  const overviewEmployees = overview?.employees || [];
  const overviewOrgChart = overview?.company?.organizationChart || null;
  const currentEmployee = useMemo(
    () => overviewEmployees.find((employee) => String(employee.id) === currentUserId) || null,
    [overviewEmployees, currentUserId]
  );
  const currentDepartmentId = String(currentEmployee?.department || '').trim();
  const scopeDepartmentOptions = useMemo(() => {
    const orgOptions = flattenOrgChartOptions(overviewOrgChart, []);
    const seen = new Set(orgOptions.map((item) => item.id));
    const legacy = [];
    for (const employee of overviewEmployees) {
      const raw = String(employee?.department || '').trim();
      if (!raw || seen.has(raw)) continue;
      seen.add(raw);
      legacy.push({ id: raw, label: resolveDeptDisplay(overviewOrgChart, raw) || raw });
    }
    return [...orgOptions, ...legacy].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  }, [overviewEmployees, overviewOrgChart]);
  const scopeUserOptions = useMemo(() => (
    [...overviewEmployees]
      .map((employee) => ({
        id: String(employee.id),
        name: employee.name || employee.email || '사용자',
        avatar: String(employee.avatar || '').trim(),
        label: `${employee.name || employee.email || '사용자'} · ${resolveDeptDisplay(overviewOrgChart, employee.department) || '부서 미배정'}`
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  ), [overviewEmployees, overviewOrgChart]);
  const selectedScopeUserOption = useMemo(
    () => scopeUserOptions.find((item) => item.id === selectedScopeUser) || null,
    [scopeUserOptions, selectedScopeUser]
  );
  const targetModalDepartmentOptions = useMemo(() => (
    currentDepartmentId
      ? scopeDepartmentOptions.filter((item) => item.id === currentDepartmentId)
      : []
  ), [scopeDepartmentOptions, currentDepartmentId]);
  const targetModalUserOptions = useMemo(() => (
    currentUserId
      ? scopeUserOptions.filter((item) => item.id === currentUserId)
      : []
  ), [scopeUserOptions, currentUserId]);

  useEffect(() => {
    let cancelled = false;
    const fetchOverview = async () => {
      try {
        const res = await fetch(`${API_BASE}/companies/overview`, {
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || '사내 현황 데이터를 불러오지 못했습니다.');
        if (!cancelled) setOverview(json);
      } catch (_) {
        if (!cancelled) setOverview(null);
      }
    };
    fetchOverview();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ periodType: period, viewBy });
    params.set('scopeType', scopeType);
    if (scopeType === 'team' && selectedScopeDepartment) params.set('departmentId', selectedScopeDepartment);
    if (scopeType === 'user' && selectedScopeUser) params.set('userId', selectedScopeUser);
    if (selectedDepartment) params.set('department', selectedDepartment);
    if (selectedRank) params.set('rank', selectedRank);

    const fetchDashboard = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE}/kpi/dashboard?${params.toString()}`, {
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || 'KPI 데이터를 불러오지 못했습니다.');
        if (cancelled) return;
        setDashboard(json);
        setTargetRevenueInput(String(Number(json?.target?.targetRevenue) || 0));
        setTargetProjectsInput(String(Number(json?.target?.targetProjects) || 0));
        setTargetNote(String(json?.target?.note || ''));
      } catch (err) {
        if (!cancelled) {
          setDashboard(null);
          setError(err.message || 'KPI 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchDashboard();
    return () => { cancelled = true; };
  }, [period, scopeType, selectedScopeDepartment, selectedScopeUser, viewBy, selectedDepartment, selectedRank]);

  useEffect(() => {
    setSelectedDepartment('');
    setSelectedRank('');
  }, [viewBy, period]);

  useEffect(() => {
    if (scopeType === 'team') setSelectedScopeUser('');
    if (scopeType === 'user') setSelectedScopeDepartment('');
  }, [scopeType]);

  useEffect(() => {
    if (scopeType !== 'user') return;
    if (selectedScopeUser) return;
    if (scopeUserOptions.length === 0) return;
    const preferredUser =
      scopeUserOptions.find((item) => item.id === currentUserId) ||
      scopeUserOptions[0];
    if (preferredUser?.id) setSelectedScopeUser(preferredUser.id);
  }, [scopeType, selectedScopeUser, scopeUserOptions, currentUserId]);

  const currentPeriodLabel = dashboard?.period?.current?.label || (PERIODS.find((item) => item.key === period)?.label || '현재 기간');
  const comparisonRows = useMemo(() => buildChartRows(dashboard), [dashboard]);
  const isListModalOpen = searchParams.get(KPI_LIST_MODAL_PARAM) === '1';
  const selectedListMetric = String(searchParams.get(KPI_LIST_METRIC_PARAM) || 'all').trim() || 'all';
  const isTargetModalOpen = searchParams.get(KPI_TARGET_MODAL_PARAM) === '1';
  const detailModalRows = useMemo(() => buildDetailRows(dashboard, selectedListMetric), [dashboard, selectedListMetric]);
  const detailModalMeta = useMemo(() => getDetailModalMeta(selectedListMetric), [selectedListMetric]);
  const checklistScope = useMemo(
    () => resolveChecklistScope(scopeType, selectedScopeDepartment, selectedScopeUser),
    [scopeType, selectedScopeDepartment, selectedScopeUser]
  );
  const checklistPeriod = dashboard?.period?.current || null;
  const leaderboardRows = dashboard?.leaderboard?.items || [];
  const target = dashboard?.target || {};
  const metrics = dashboard?.metrics || {};
  const targetOverviewScopeId = scopeType === 'team' ? selectedScopeDepartment : selectedScopeUser;
  const targetOverviewScopeLabel = scopeType === 'team'
    ? scopeDepartmentOptions.find((item) => item.id === selectedScopeDepartment)?.label || ''
    : scopeUserOptions.find((item) => item.id === selectedScopeUser)?.name || '';
  const targetOverviewTitle = scopeType === 'team'
    ? targetOverviewScopeLabel ? `${targetOverviewScopeLabel} 목표 현황` : '팀 목표 현황'
    : targetOverviewScopeLabel ? `${targetOverviewScopeLabel} 목표 현황` : '개인 목표 현황';
  const targetModalPeriodOptions = useMemo(
    () => buildPeriodValueOptions(targetModalPeriodType),
    [targetModalPeriodType]
  );

  const cards = useMemo(() => {
    const revenueDelta = formatDelta(metrics?.revenue?.current, metrics?.revenue?.previous);
    const wonDelta = formatDelta(metrics?.wonDeals?.current, metrics?.wonDeals?.previous, '건');
    const projectDelta = formatDelta(metrics?.completedProjects?.current, metrics?.completedProjects?.previous, '개');
    const workDelta = formatDelta(metrics?.workLogs?.current, metrics?.workLogs?.previous, '건');
    return [
      {
        key: 'revenue',
        detailKey: 'revenue',
        label: '수주 매출',
        value: formatRevenue(metrics?.revenue?.current),
        unit: target?.targetRevenue > 0 ? `목표 ${formatRevenue(target?.targetRevenue)}` : '목표 미설정',
        delta: revenueDelta.text,
        positive: revenueDelta.positive,
        icon: 'payments',
        tone: 'mint'
      },
      {
        key: 'wonDeals',
        detailKey: 'wonDeals',
        label: '수주 성공',
        value: `${formatNumber(metrics?.wonDeals?.current)}건`,
        unit: `이전 ${formatNumber(metrics?.wonDeals?.previous)}건`,
        delta: wonDelta.text,
        positive: wonDelta.positive,
        icon: 'workspace_premium',
        tone: 'sky'
      },
      {
        key: 'projects',
        detailKey: 'projects',
        label: '완료 프로젝트',
        value: `${formatNumber(metrics?.completedProjects?.current)}개`,
        unit: target?.targetProjects > 0 ? `목표 ${formatNumber(target?.targetProjects)}개` : '목표 미설정',
        delta: projectDelta.text,
        positive: projectDelta.positive,
        icon: 'assignment_turned_in',
        tone: 'blue'
      },
      {
        key: 'workLogs',
        detailKey: 'workLogs',
        label: '업무 기록',
        value: `${formatNumber(metrics?.workLogs?.current)}건`,
        unit: `이전 ${formatNumber(metrics?.workLogs?.previous)}건`,
        delta: workDelta.text,
        positive: workDelta.positive,
        icon: 'edit_note',
        tone: 'sky'
      }
    ];
  }, [metrics, target]);

  const goalRate = calcAchievement(metrics?.revenue?.current, target?.targetRevenue);
  const projectGoalRate = calcAchievement(metrics?.completedProjects?.current, target?.targetProjects);
  const strongestLeaderboard = leaderboardRows[0];
  const workInsightDelta = formatDelta(metrics?.workLogs?.current, metrics?.workLogs?.previous, '건');
  const insightCards = useMemo(() => ([
    {
      key: 'revenue-goal',
      tone: 'goal',
      title: '매출 목표 달성률',
      kind: 'ring',
      value: `${goalRate}%`,
      description:
        target?.targetRevenue > 0
          ? `현재 매출 ${formatRevenue(metrics?.revenue?.current)}으로 목표 ${formatRevenue(target?.targetRevenue)} 대비 ${goalRate}% 달성했습니다.`
          : `현재 매출은 ${formatRevenue(metrics?.revenue?.current)}이며 아직 목표액이 설정되지 않았습니다.`
    },
    {
      key: 'project-goal',
      tone: 'project',
      title: '완료 프로젝트 달성률',
      kind: 'ring',
      value: `${projectGoalRate}%`,
      description:
        target?.targetProjects > 0
          ? `완료 프로젝트 ${formatNumber(metrics?.completedProjects?.current)}개로 목표 ${formatNumber(target?.targetProjects)}개 대비 ${projectGoalRate}% 달성했습니다.`
          : `현재 완료 프로젝트는 ${formatNumber(metrics?.completedProjects?.current)}개이며 아직 목표가 설정되지 않았습니다.`
    },
    {
      key: 'leader',
      tone: 'recommendation',
      title: '이번 기간 선두',
      kind: 'icon',
      icon: 'military_tech',
      description: strongestLeaderboard
        ? `${strongestLeaderboard.name}님이 현재 ${strongestLeaderboard.score.toFixed(1)}점으로 선두입니다. ${strongestLeaderboard.departmentDisplay || strongestLeaderboard.department || '미지정'} 부서에서 가장 높은 성과를 보이고 있습니다.`
        : '아직 집계된 리더보드 데이터가 없습니다.'
    },
    {
      key: 'work-logs',
      tone: 'activity',
      title: '업무 기록 흐름',
      kind: 'icon',
      icon: 'edit_note',
      description: `현재 업무 기록은 ${formatNumber(metrics?.workLogs?.current)}건이며 이전 기간 ${formatNumber(metrics?.workLogs?.previous)}건 대비 ${workInsightDelta.text} 변화했습니다.`
    }
  ]), [goalRate, projectGoalRate, strongestLeaderboard, metrics, target, workInsightDelta]);
  const scopeTitle = scopeType === 'team' ? '팀별 KPI 대시보드' : '개인별 KPI 대시보드';
  const scopeDescription = scopeType === 'team'
    ? `${displayName}님, 사내 현황의 부서 기준으로 팀 KPI를 비교할 수 있습니다.`
    : `${displayName}님, 사내 현황의 직원 기준으로 개인 KPI를 비교할 수 있습니다.`;

  const handleSaveTarget = async (e) => {
    e.preventDefault();
    if (!dashboard?.period?.current) return;
    setSavingTarget(true);
    setSaveMessage('');
    try {
      const res = await fetch(`${API_BASE}/kpi/targets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader()
        },
        credentials: 'include',
        body: JSON.stringify({
          year: dashboard.period.current.year,
          periodType: dashboard.period.current.periodType,
          periodValue: dashboard.period.current.periodValue,
          targetRevenue: Number(targetRevenueInput) || 0,
          targetProjects: Number(targetProjectsInput) || 0,
          note: targetNote
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || '목표 저장에 실패했습니다.');
      setDashboard((prev) => prev ? { ...prev, target: json.target } : prev);
      setSaveMessage(json?.message || '목표가 저장되었습니다.');
    } catch (err) {
      setSaveMessage(err.message || '목표 저장에 실패했습니다.');
    } finally {
      setSavingTarget(false);
    }
  };

  useEffect(() => {
    if (!dashboard?.period?.current) return;
    setTargetModalPeriodType(period);
    setTargetModalYear(dashboard.period.current.year);
    setTargetModalPeriodValue(dashboard.period.current.periodValue);
    setTargetModalScopeType(scopeType);
    setTargetModalDepartmentId(currentDepartmentId);
    setTargetModalUserId(currentUserId);
  }, [dashboard?.period?.current, period, scopeType, currentDepartmentId, currentUserId]);

  useEffect(() => {
    setTargetModalPeriodValue(getCurrentPeriodValueForType(targetModalPeriodType, new Date(targetModalYear, 0, 1)));
  }, [targetModalPeriodType, targetModalYear]);

  useEffect(() => {
    if (targetModalScopeType === 'team') {
      setTargetModalDepartmentId(currentDepartmentId);
    } else {
      setTargetModalUserId(currentUserId);
    }
  }, [targetModalScopeType, currentDepartmentId, currentUserId]);

  useEffect(() => {
    const activeScopeId = targetModalScopeType === 'team' ? targetModalDepartmentId : targetModalUserId;
    if (!isTargetModalOpen) return;
    if (!activeScopeId) {
      setTargetModalRevenue('');
      setTargetModalProjects('');
      setTargetModalNote('');
      setTargetModalMessage('');
      return;
    }
    let cancelled = false;
    const fetchTarget = async () => {
      setTargetModalLoading(true);
      try {
        const params = new URLSearchParams({
          year: String(targetModalYear),
          periodType: targetModalPeriodType,
          periodValue: String(targetModalPeriodValue),
          scopeType: targetModalScopeType,
          scopeId: activeScopeId
        });
        const res = await fetch(`${API_BASE}/kpi/targets?${params.toString()}`, {
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || '목표 정보를 불러오지 못했습니다.');
        if (cancelled) return;
        setTargetModalRevenue(String(Number(json?.target?.targetRevenue) || 0));
        setTargetModalProjects(String(Number(json?.target?.targetProjects) || 0));
        setTargetModalNote(String(json?.target?.note || ''));
      } catch (err) {
        if (!cancelled) {
          setTargetModalRevenue('');
          setTargetModalProjects('');
          setTargetModalNote('');
          setTargetModalMessage(err.message || '목표 정보를 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) setTargetModalLoading(false);
      }
    };
    fetchTarget();
    return () => { cancelled = true; };
  }, [isTargetModalOpen, targetModalScopeType, targetModalDepartmentId, targetModalUserId, targetModalYear, targetModalPeriodType, targetModalPeriodValue]);

  useEffect(() => {
    const activeScopeId = scopeType === 'team' ? selectedScopeDepartment : selectedScopeUser;
    if (!activeScopeId) {
      setTargetOverview(null);
      return;
    }
    let cancelled = false;
    const fetchOverview = async () => {
      try {
        const params = new URLSearchParams({
          year: String(dashboard?.period?.current?.year || new Date().getFullYear()),
          scopeType: scopeType,
          scopeId: activeScopeId
        });
        const res = await fetch(`${API_BASE}/kpi/targets/overview?${params.toString()}`, {
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || '목표 현황을 불러오지 못했습니다.');
        if (!cancelled) setTargetOverview(json);
      } catch (_) {
        if (!cancelled) setTargetOverview(null);
      }
    };
    fetchOverview();
    return () => { cancelled = true; };
  }, [scopeType, selectedScopeDepartment, selectedScopeUser, dashboard?.period?.current?.year, saveMessage]);

  useEffect(() => {
    if (!checklistPeriod) {
      setChecklistSummaryByMetric({});
      return;
    }
    let cancelled = false;
    const fetchChecklistSummary = async () => {
      try {
        const params = new URLSearchParams({
          year: String(checklistPeriod.year),
          periodType: checklistPeriod.periodType,
          periodValue: String(checklistPeriod.periodValue),
          scopeType: checklistScope.scopeType
        });
        if (checklistScope.scopeId) params.set('scopeId', checklistScope.scopeId);
        const res = await fetch(`${API_BASE}/kpi/checklists/summary?${params.toString()}`, {
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || '체크리스트 요약을 불러오지 못했습니다.');
        if (!cancelled) setChecklistSummaryByMetric(json?.byMetric || {});
      } catch (_) {
        if (!cancelled) setChecklistSummaryByMetric({});
      }
    };
    fetchChecklistSummary();
    return () => { cancelled = true; };
  }, [checklistPeriod?.year, checklistPeriod?.periodType, checklistPeriod?.periodValue, checklistScope.scopeType, checklistScope.scopeId]);

  useEffect(() => {
    if (!isListModalOpen) return;
    if (selectedListMetric === 'all' && detailModalRows.length === 0) {
      setDetailChecklistItems([]);
      setDetailChecklistMessage('');
      return;
    }
    if (!checklistPeriod) {
      setDetailChecklistItems(mergeChecklistItems(detailModalRows, []));
      setDetailChecklistMessage('');
      return;
    }
    let cancelled = false;
    const fetchChecklist = async () => {
      setDetailChecklistLoading(true);
      setDetailChecklistMessage('');
      try {
        let baseItems = detailModalRows;
        if (selectedListMetric !== 'all') {
          const detailParams = new URLSearchParams({
            year: String(checklistPeriod.year),
            periodType: checklistPeriod.periodType,
            periodValue: String(checklistPeriod.periodValue),
            scopeType: checklistScope.scopeType,
            metricKey: selectedListMetric
          });
          if (checklistScope.scopeId) detailParams.set('scopeId', checklistScope.scopeId);
          const detailRes = await fetch(`${API_BASE}/kpi/detail-items?${detailParams.toString()}`, {
            headers: getAuthHeader(),
            credentials: 'include'
          });
          const detailJson = await detailRes.json().catch(() => ({}));
          if (!detailRes.ok) throw new Error(detailJson?.error || '상세 리스트를 불러오지 못했습니다.');
          baseItems = normalizeDetailItems(detailJson?.items || []);
        }

        const params = new URLSearchParams({
          year: String(checklistPeriod.year),
          periodType: checklistPeriod.periodType,
          periodValue: String(checklistPeriod.periodValue),
          scopeType: checklistScope.scopeType,
          metricKey: selectedListMetric
        });
        if (checklistScope.scopeId) params.set('scopeId', checklistScope.scopeId);
        const res = await fetch(`${API_BASE}/kpi/checklists?${params.toString()}`, {
          headers: getAuthHeader(),
          credentials: 'include'
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || '체크리스트를 불러오지 못했습니다.');
        if (cancelled) return;
        setDetailChecklistItems(mergeChecklistItems(baseItems, json?.checklist?.items || []));
      } catch (err) {
        if (!cancelled) {
          setDetailChecklistItems(mergeChecklistItems(selectedListMetric === 'all' ? detailModalRows : [], []));
          setDetailChecklistMessage(err.message || '체크리스트를 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) setDetailChecklistLoading(false);
      }
    };
    fetchChecklist();
    return () => { cancelled = true; };
  }, [
    isListModalOpen,
    selectedListMetric,
    detailModalRows,
    checklistPeriod?.year,
    checklistPeriod?.periodType,
    checklistPeriod?.periodValue,
    checklistScope.scopeType,
    checklistScope.scopeId
  ]);

  const openListModal = (metricKey = 'all') => {
    const next = new URLSearchParams(searchParams);
    next.set(KPI_LIST_MODAL_PARAM, '1');
    if (metricKey && metricKey !== 'all') next.set(KPI_LIST_METRIC_PARAM, metricKey);
    else next.delete(KPI_LIST_METRIC_PARAM);
    setSearchParams(next);
  };

  const openTargetModal = () => {
    const next = new URLSearchParams(searchParams);
    next.set(KPI_TARGET_MODAL_PARAM, '1');
    setSearchParams(next);
  };

  const closeListModal = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(KPI_LIST_MODAL_PARAM);
    next.delete(KPI_LIST_METRIC_PARAM);
    setSearchParams(next, { replace: true });
  };

  const closeTargetModal = () => {
    const next = new URLSearchParams(searchParams);
    next.delete(KPI_TARGET_MODAL_PARAM);
    setSearchParams(next, { replace: true });
  };

  const handleChecklistScoreChange = (itemKey, value) => {
    setDetailChecklistItems((prev) => prev.map((item) => (
      item.key === itemKey ? { ...item, score: Math.max(0, Number(value) || 0) } : item
    )));
  };

  const handleSaveChecklist = async () => {
    if (!checklistPeriod) return;
    setDetailChecklistSaving(true);
    setDetailChecklistMessage('');
    try {
      const res = await fetch(`${API_BASE}/kpi/checklists`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader()
        },
        credentials: 'include',
        body: JSON.stringify({
          metricKey: selectedListMetric,
          scopeType: checklistScope.scopeType,
          scopeId: checklistScope.scopeId,
          year: checklistPeriod.year,
          periodType: checklistPeriod.periodType,
          periodValue: checklistPeriod.periodValue,
          items: detailChecklistItems.map((item) => ({
            itemKey: item.key,
            score: Math.max(0, Number(item.score) || 0),
            checked: Boolean(item.checked)
          }))
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || '체크리스트 저장에 실패했습니다.');
      const savedItems = json?.checklist?.items || [];
      setDetailChecklistItems((prev) => mergeChecklistItems(prev, savedItems));
      setDetailChecklistMessage(json?.message || '체크리스트가 저장되었습니다.');
      if (selectedListMetric !== 'all') {
        setChecklistSummaryByMetric((prev) => ({
          ...prev,
          [selectedListMetric]: json?.checklist?.summary || prev?.[selectedListMetric]
        }));
      }
    } catch (err) {
      setDetailChecklistMessage(err.message || '체크리스트 저장에 실패했습니다.');
    } finally {
      setDetailChecklistSaving(false);
    }
  };

  const handleSaveTargetModal = async (e) => {
    e.preventDefault();
    const scopeId = targetModalScopeType === 'team' ? targetModalDepartmentId : targetModalUserId;
    if (!scopeId) {
      setTargetModalMessage(targetModalScopeType === 'team' ? '팀을 선택해 주세요.' : '직원을 선택해 주세요.');
      return;
    }
    setTargetModalSaving(true);
    setTargetModalMessage('');
    try {
      const res = await fetch(`${API_BASE}/kpi/targets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
        body: JSON.stringify({
          scopeType: targetModalScopeType,
          scopeId,
          year: Number(targetModalYear) || new Date().getFullYear(),
          periodType: targetModalPeriodType,
          periodValue: Number(targetModalPeriodValue) || 1,
          targetRevenue: Number(targetModalRevenue) || 0,
          targetProjects: Number(targetModalProjects) || 0,
          note: targetModalNote
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || '목표 저장에 실패했습니다.');
      setTargetModalMessage(json?.message || '목표가 저장되었습니다.');
      setSaveMessage(json?.message || '목표가 저장되었습니다.');
      if (
        scopeType === targetModalScopeType &&
        ((scopeType === 'team' && selectedScopeDepartment === targetModalDepartmentId) ||
          (scopeType === 'user' && selectedScopeUser === targetModalUserId))
      ) {
        setDashboard((prev) => prev ? { ...prev, target: json.target } : prev);
      }
    } catch (err) {
      setTargetModalMessage(err.message || '목표 저장에 실패했습니다.');
    } finally {
      setTargetModalSaving(false);
    }
  };

  return (
    <div className="page kpi-page">
      <header className="page-header kpi-page-header">
        <div className="kpi-page-header-spacer" />
        <div className="kpi-page-header-actions">
          <PageHeaderNotifyChat noWrapper buttonClassName="icon-btn" />
        </div>
      </header>

      <div className="page-content kpi-page-content">
        <section className="kpi-hero">
          <div className="kpi-hero-copy">
            <nav className="kpi-breadcrumb" aria-label="현재 위치">
              <span>성과 관리</span>
              <span className="material-symbols-outlined" aria-hidden>chevron_right</span>
              <span className="kpi-breadcrumb-current">KPI 분석</span>
            </nav>
            <h1>{scopeTitle}</h1>
            <p>{scopeDescription} {currentPeriodLabel} 기준 KPI 흐름과 목표 달성 현황을 한눈에 확인할 수 있습니다.</p>
          </div>

          <div className="kpi-hero-actions">
            <div className="kpi-scope-period-row">
              <div className="kpi-scope-switch" role="tablist" aria-label="조회 범위">
                {KPI_SCOPE_OPTIONS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={scopeType === item.key ? 'is-active' : ''}
                    onClick={() => setScopeType(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="kpi-period-switch" role="tablist" aria-label="조회 기간">
                {PERIODS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={period === item.key ? 'is-active' : ''}
                    onClick={() => setPeriod(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="kpi-scope-select-row">
              {scopeType === 'team' ? (
                <select
                  className="kpi-scope-select"
                  value={selectedScopeDepartment}
                  onChange={(e) => setSelectedScopeDepartment(e.target.value)}
                  aria-label="부서 검색"
                >
                  <option value="">전체 부서</option>
                  {scopeDepartmentOptions.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              ) : (
                <div className="kpi-scope-select-wrap">
                  {selectedScopeUserOption?.avatar ? (
                    <img src={selectedScopeUserOption.avatar} alt="" className="kpi-scope-select-avatar kpi-scope-select-avatar-img" />
                  ) : (
                    <div className="kpi-scope-select-avatar kpi-scope-select-avatar-fallback" aria-hidden>
                      <span className="material-symbols-outlined">person</span>
                    </div>
                  )}
                  <select
                    className="kpi-scope-select kpi-scope-select-with-avatar"
                    value={selectedScopeUser}
                    onChange={(e) => setSelectedScopeUser(e.target.value)}
                    aria-label="직원 검색"
                    disabled={scopeUserOptions.length === 0}
                  >
                    {scopeUserOptions.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </div>
              )}
              <button type="button" className="kpi-target-open-button" onClick={openTargetModal}>
                목표 설정
              </button>
            </div>
          </div>
        </section>

        {error ? (
          <div className="kpi-status-banner kpi-status-banner-error" role="alert">{error}</div>
        ) : null}
        {saveMessage ? (
          <div className="kpi-status-banner kpi-status-banner-info" role="status">{saveMessage}</div>
        ) : null}

        <section className="kpi-summary-grid" aria-label="핵심 KPI">
          {(loading ? [] : cards).map((card) => {
            const checklistKey = card.detailKey || card.key;
            const clSummary = checklistSummaryByMetric?.[checklistKey];
            const showCl = hasChecklistSummary(clSummary);
            const totalScore = showCl ? Math.max(0, Number(clSummary.totalScore) || 0) : 0;
            const totalItems = showCl ? Math.max(0, Number(clSummary.totalCount) || 0) : 0;
            const checkedN = showCl ? Math.max(0, Number(clSummary.checkedCount) || 0) : 0;
            const checkedPts = showCl ? Math.max(0, Number(clSummary.checkedScore) || 0) : 0;
            return (
              <button
                key={card.key}
                type="button"
                className="kpi-summary-card kpi-summary-card-button"
                onClick={() => openListModal(checklistKey)}
              >
                <div className="kpi-summary-top">
                  <div className={`kpi-summary-icon tone-${card.tone}`}>
                    <span className="material-symbols-outlined" aria-hidden>{card.icon}</span>
                  </div>
                  <span className={`kpi-summary-delta ${card.positive ? 'is-positive' : 'is-negative'}`}>
                    {card.delta}
                  </span>
                </div>
                <div className="kpi-summary-copy">
                  <p>{card.label}</p>
                  <h2>
                    {card.value} <span>{card.unit}</span>
                  </h2>
                </div>
                {showCl ? (
                  <div className="kpi-summary-footer">
                    <div className="kpi-summary-checklist-total" aria-label={`${card.label} 체크리스트 총점`}>
                      <span className="kpi-summary-checklist-total-label">총점</span>
                      <span className="kpi-summary-checklist-total-num">{formatNumber(totalScore)}</span>
                      <span className="kpi-summary-checklist-total-suffix">점</span>
                    </div>
                    <p className="kpi-summary-checklist-sub">
                      항목 {formatNumber(totalItems)}개
                      {checkedN > 0 ? ` · 완료 ${formatNumber(checkedN)}건(${formatNumber(checkedPts)}점 반영)` : null}
                    </p>
                  </div>
                ) : null}
              </button>
            );
          })}
          {loading ? (
            Array.from({ length: 4 }).map((_, idx) => (
              <article key={`loading-${idx}`} className="kpi-summary-card kpi-summary-card-loading">
                <div className="kpi-skeleton kpi-skeleton-icon" />
                <div className="kpi-skeleton kpi-skeleton-title" />
                <div className="kpi-skeleton kpi-skeleton-value" />
              </article>
            ))
          ) : null}
        </section>

        <section className="kpi-main-grid">
          <article className="kpi-panel kpi-comparison-panel">
            <div className="kpi-panel-head">
              <div>
                <h3>{currentPeriodLabel} 성과 비교</h3>
                <p>{buildPeriodDescription(period, currentPeriodLabel)}</p>
              </div>
              <div className="kpi-comparison-actions">
                <button type="button" className="kpi-link-button" onClick={() => openListModal('all')}>리스트 보기</button>
                <div className="kpi-legend" aria-hidden>
                  <span><i className="legend-dot legend-dot-current" />현재</span>
                  <span><i className="legend-dot legend-dot-previous" />이전</span>
                  <span><i className="legend-dot legend-dot-target" />목표</span>
                </div>
              </div>
            </div>

            <div className="kpi-bar-chart" aria-label="비교 막대 차트">
              {comparisonRows.map((row) => (
                <div key={row.label} className="kpi-bar-group">
                  <div className="kpi-bar-pair">
                    <div className="kpi-target-line" style={{ bottom: `${row.targetPct}%` }}>
                      <span>{row.targetDisplay}</span>
                    </div>
                    <div className="kpi-bar kpi-bar-previous" style={{ height: `${row.previousPct}%` }} />
                    <div className="kpi-bar kpi-bar-current" style={{ height: `${row.currentPct}%` }} />
                  </div>
                  <div className="kpi-bar-label-stack">
                    <strong>{row.label}</strong>
                    <p>현재 {row.currentDisplay} / 이전 {row.previousDisplay}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <aside className="kpi-panel kpi-manual-panel">
            <div className="kpi-panel-head">
              <div>
                <h3>{targetOverviewTitle}</h3>
                <p>선택한 범위의 월별·분기별·반기별·연간 목표를 확인합니다.</p>
              </div>
            </div>
            <div className="kpi-target-overview-body">
              {!targetOverviewScopeId ? (
                <p className="kpi-manual-note kpi-target-empty-note">
                  {scopeType === 'team' ? '팀 목표를 보려면 부서를 먼저 선택해 주세요.' : '개인 목표를 불러오는 중입니다.'}
                </p>
              ) : targetOverview?.items?.length ? (
                <div className="kpi-target-overview-list">
                  {targetOverview.items.map((item) => (
                    <article
                      key={`${item.scopeType}-${item.periodType}-${item.periodValue}`}
                      className={`kpi-target-overview-card tone-${item.periodType}`}
                    >
                      <div className="kpi-target-overview-top">
                        <strong>{PERIODS.find((periodItem) => periodItem.key === item.periodType)?.label || item.periodType}</strong>
                        <span>{item.label}</span>
                      </div>
                      <p className="kpi-target-overview-metric">목표액 {formatRevenue(item.targetRevenue)}</p>
                      <p className="kpi-target-overview-metric">목표 프로젝트 {formatNumber(item.targetProjects)}개</p>
                      <small className="kpi-target-overview-note">{item.note || '메모 없음'}</small>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="kpi-manual-note kpi-target-empty-note">아직 저장된 목표가 없습니다.</p>
              )}
            </div>
          </aside>
        </section>

        <section className="kpi-panel kpi-leaderboard-panel">
          <div className="kpi-panel-head kpi-leaderboard-head">
            <div>
              <h3>직원 리더보드</h3>
              <p>{currentPeriodLabel} 기준 성과 점수 순위입니다. 부서별/직급별 보기로 전환할 수 있습니다.</p>
            </div>
            <div className="kpi-leaderboard-controls">
              <div className="kpi-view-switch" role="tablist" aria-label="리더보드 보기">
                <button type="button" className={viewBy === 'overall' ? 'is-active' : ''} onClick={() => setViewBy('overall')}>전체</button>
                <button type="button" className={viewBy === 'department' ? 'is-active' : ''} onClick={() => setViewBy('department')}>부서별</button>
                <button type="button" className={viewBy === 'rank' ? 'is-active' : ''} onClick={() => setViewBy('rank')}>직급별</button>
              </div>
              {viewBy === 'department' ? (
                <select value={selectedDepartment} onChange={(e) => setSelectedDepartment(e.target.value)} className="kpi-filter-select">
                  <option value="">전체 부서</option>
                  {availableDepartments.map((department) => (
                    <option key={department} value={department}>{department}</option>
                  ))}
                </select>
              ) : null}
              {viewBy === 'rank' ? (
                <select value={selectedRank} onChange={(e) => setSelectedRank(e.target.value)} className="kpi-filter-select">
                  <option value="">전체 직급</option>
                  {availableRanks.map((rank) => (
                    <option key={rank.value} value={rank.value}>{rank.label}</option>
                  ))}
                </select>
              ) : null}
            </div>
          </div>

          <div className="kpi-leaderboard-table-wrap">
            <table className="kpi-leaderboard-table">
              <thead>
                <tr>
                  <th>순위</th>
                  <th>직원명</th>
                  <th>부서</th>
                  <th>직급</th>
                  <th>종합 점수</th>
                  <th>성과 추이</th>
                </tr>
              </thead>
              <tbody>
                {leaderboardRows.map((row) => (
                  <tr key={`${period}-${row.rankNo}-${row.userId}`}>
                    <td>
                      <div className={`kpi-rank-badge ${row.rankNo === 1 ? 'is-top' : ''}`}>{row.rankNo}</div>
                    </td>
                    <td>
                      <div className="kpi-user-cell">
                        <div className="kpi-user-avatar">{getInitials(row.name)}</div>
                        <strong>{row.name}</strong>
                      </div>
                    </td>
                    <td>{row.departmentDisplay || row.department}</td>
                    <td>{row.rankLabel}</td>
                    <td>
                      <span className="kpi-score-value">{row.score.toFixed(1)}</span>
                    </td>
                    <td>
                      <div className="kpi-mini-trend" aria-hidden>
                        {row.trend.map((value, idx) => (
                          <i key={`${row.userId}-trend-${idx}`} style={{ height: `${value}%` }} />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && leaderboardRows.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="kpi-empty-cell">표시할 직원 데이터가 없습니다.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="kpi-insight-grid">
          {insightCards.map((item) => (
            <article key={item.key} className={`kpi-insight-card tone-${item.tone}`}>
              {item.kind === 'ring' ? (
                <div className={`kpi-progress-ring tone-${item.tone}`} aria-hidden>
                  <span>{item.value}</span>
                </div>
              ) : (
                <div className={`kpi-recommendation-icon tone-${item.tone}`} aria-hidden>
                  <span className="material-symbols-outlined">{item.icon}</span>
                </div>
              )}
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
            </article>
          ))}
        </section>

        {isListModalOpen ? (
          <KpiDetailModal
            periodLabel={currentPeriodLabel}
            title={detailModalMeta.title}
            description={detailModalMeta.description}
            items={detailChecklistItems}
            loading={detailChecklistLoading}
            saving={detailChecklistSaving}
            message={detailChecklistMessage}
            onScoreChange={handleChecklistScoreChange}
            onSave={handleSaveChecklist}
            onClose={closeListModal}
          />
        ) : null}
        {isTargetModalOpen ? (
          <KpiTargetModal
            scopeType={targetModalScopeType}
            onScopeTypeChange={setTargetModalScopeType}
            departmentId={targetModalDepartmentId}
            onDepartmentChange={setTargetModalDepartmentId}
            userId={targetModalUserId}
            onUserChange={setTargetModalUserId}
            departmentOptions={targetModalDepartmentOptions}
            userOptions={targetModalUserOptions}
            periodType={targetModalPeriodType}
            onPeriodTypeChange={setTargetModalPeriodType}
            periodValue={targetModalPeriodValue}
            onPeriodValueChange={setTargetModalPeriodValue}
            periodValueOptions={targetModalPeriodOptions}
            year={targetModalYear}
            onYearChange={setTargetModalYear}
            targetRevenue={targetModalRevenue}
            onTargetRevenueChange={setTargetModalRevenue}
            targetProjects={targetModalProjects}
            onTargetProjectsChange={setTargetModalProjects}
            targetNote={targetModalNote}
            onTargetNoteChange={setTargetModalNote}
            loading={targetModalLoading}
            saving={targetModalSaving}
            message={targetModalMessage}
            onSubmit={handleSaveTargetModal}
            onClose={closeTargetModal}
          />
        ) : null}
      </div>
    </div>
  );
}
